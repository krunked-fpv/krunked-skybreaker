import type { EnemyEntity, InputState, SimSnapshot } from '../contracts/sim';
import { clamp, shortestAngleDiffDeg } from './math';

interface ThreatVector {
  escapeAngleDeg: number;
  urgency: number;
}

function findIncomingThreat(snapshot: SimSnapshot): ThreatVector | null {
  const { player, projectiles, enemies, seaLevel, spaceLevel } = snapshot;
  let bestUrgency = 0;
  let bestEscapeX = 0;
  let bestEscapeY = 0;

  const evaluateThreat = (tx: number, ty: number, tvx: number, tvy: number, radius: number): void => {
    const dx = tx - player.x;
    const dy = ty - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 220) return;

    const rvx = tvx - player.vx;
    const rvy = tvy - player.vy;
    const relSpeedSq = rvx * rvx + rvy * rvy;
    const tClosest =
      relSpeedSq > 1e-4 ? clamp(-(dx * rvx + dy * rvy) / relSpeedSq, 0, 18) : 0;

    const missX = dx + rvx * tClosest;
    const missY = dy + rvy * tClosest;
    const missDist = Math.hypot(missX, missY);
    if (missDist > radius + 24) return;

    const urgency = (220 - dist) / 220 + (18 - tClosest) / 18;
    if (urgency > bestUrgency) {
      bestUrgency = urgency;
      // Pick perpendicular escape direction biased away from sea & space hazards.
      const perp1X = -rvy;
      const perp1Y = rvx;
      const perp2X = rvy;
      const perp2Y = -rvx;
      const midAlt = (seaLevel + spaceLevel) * 0.45;
      const preferUp = player.y > midAlt;
      const score1 = preferUp ? -perp1Y : perp1Y;
      const score2 = preferUp ? -perp2Y : perp2Y;
      if (Math.hypot(perp1X, perp1Y) > 1e-4) {
        bestEscapeX = score1 >= score2 ? perp1X : perp2X;
        bestEscapeY = score1 >= score2 ? perp1Y : perp2Y;
      } else {
        bestEscapeX = -dx;
        bestEscapeY = -dy;
      }
    }
  };

  for (const p of projectiles) {
    if (p.owner !== 'enemy') continue;
    evaluateThreat(p.x, p.y, p.vx, p.vy, p.radius + 8);
  }
  for (const e of enemies) {
    if (!e.active) continue;
    if (e.kind === 'Missile') {
      evaluateThreat(e.x, e.y, e.vx, e.vy, e.hitRadius + 10);
    }
  }

  if (bestUrgency <= 0) return null;
  return {
    escapeAngleDeg: (Math.atan2(bestEscapeY, bestEscapeX) * 180) / Math.PI,
    urgency: bestUrgency,
  };
}

function selectTarget(snapshot: SimSnapshot): EnemyEntity | null {
  const { player, enemies, seaLevel } = snapshot;
  const waterproof = player.engineSpec.waterproof;
  let best: EnemyEntity | null = null;
  let bestScore = Infinity;

  for (const e of enemies) {
    if (!e.active) continue;
    if (!waterproof && e.y > seaLevel + 18) continue;

    const dist = Math.hypot(e.x - player.x, e.y - player.y);
    let score = dist;
    if (e.kind === 'Missile') score *= 0.75;
    if (e.health <= 10) score *= 0.8;
    if (e.y > seaLevel - 30 && player.y > seaLevel - 140) score += 180;
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

/**
 * Pure 60Hz autonomous Ace Pilot controller.
 * Avoids sea (unless waterproof) and space ceiling (y < -1100), dodges projectiles,
 * halts firing to heal when HP < 48% (up to 85%), and leads targets using stall-whip turns.
 */
export function computeAutopilotInput(snapshot: SimSnapshot): InputState {
  if (snapshot.phase !== 'playing' || !snapshot.player.alive) {
    return { left: false, right: false, thrust: false, fire: false };
  }

  const { player, seaLevel, spaceLevel } = snapshot;
  const waterproof = player.engineSpec.waterproof;
  const hpRatio = player.maxHealth > 0 ? player.health / player.maxHealth : 1;
  const shouldHeal = hpRatio < 0.48 || (player.healing && hpRatio < 0.85);

  const predictedY = player.y + player.vy * 14;
  const seaDanger =
    !waterproof && (player.y > seaLevel - 140 || predictedY > seaLevel - 40);
  const underwaterTooDeep = waterproof && player.y > seaLevel + 90;
  const spaceDanger =
    player.y < spaceLevel + 220 || predictedY < spaceLevel + 130;

  let desiredAngleDeg = player.angleDeg;
  let forceThrust: boolean | null = null;
  let inhibitFire = shouldHeal;

  if (seaDanger || underwaterTooDeep) {
    // Pull steeply upward away from water, biasing slightly horizontally toward mid-screen.
    const horizBias = player.vx >= 0 ? 18 : -18;
    desiredAngleDeg = -90 + horizBias;
    const rad = (player.angleDeg * Math.PI) / 180;
    forceThrust = Math.sin(rad) < 0.2 || player.y > seaLevel - 65;
    if (player.weaponSpec.id === 1) {
      inhibitFire = true;
    }
  } else if (spaceDanger) {
    // Nose down away from upper space ceiling.
    const horizBias = player.vx >= 0 ? -25 : 25;
    desiredAngleDeg = 90 + horizBias;
    const rad = (player.angleDeg * Math.PI) / 180;
    forceThrust = Math.sin(rad) > 0.25;
    if (player.weaponSpec.id === 1) {
      inhibitFire = true;
    }
  } else {
    const threat = findIncomingThreat(snapshot);
    const target = selectTarget(snapshot);

    if (threat && (shouldHeal || threat.urgency > 0.85)) {
      desiredAngleDeg = threat.escapeAngleDeg;
      forceThrust = true;
    } else if (shouldHeal) {
      // Evasive cruise at comfortable mid-altitude while repairing.
      const cruiseY = (seaLevel + spaceLevel) * 0.36;
      const targetX = player.x + (player.vx >= 0 ? 220 : -220);
      desiredAngleDeg = (Math.atan2(cruiseY - player.y, targetX - player.x) * 180) / Math.PI;
      forceThrust = Math.hypot(player.vx, player.vy) < 4.5;
    } else if (target) {
      const dist = Math.hypot(target.x - player.x, target.y - player.y);
      const projSpeed =
        player.weaponSpec.id === 1
          ? 42
          : player.weaponSpec.id === 4
            ? 10
            : player.weaponSpec.id === 3
              ? 14
              : 22;
      const leadTicks = Math.min(22, dist / projSpeed);
      const aimX = target.x + target.vx * leadTicks;
      let aimY = target.y + target.vy * leadTicks;

      // Avoid diving straight into ocean surface when chasing boats.
      if (!waterproof && player.y > seaLevel - 160 && aimY > seaLevel - 40) {
        aimY = seaLevel - 120;
      }

      desiredAngleDeg = (Math.atan2(aimY - player.y, aimX - player.x) * 180) / Math.PI;
    } else {
      // Patrol band around mid-sky while awaiting spawns.
      const patrolY = -360;
      const dirX = player.vx >= 0 ? 180 : -180;
      desiredAngleDeg = (Math.atan2(patrolY - player.y, dirX) * 180) / Math.PI;
    }
  }

  const angleErr = shortestAngleDiffDeg(player.angleDeg, desiredAngleDeg);
  const deadzone = 3.0;
  const left = angleErr < -deadzone;
  const right = angleErr > deadzone;

  let thrust: boolean;
  if (forceThrust !== null) {
    thrust = forceThrust;
  } else {
    const speed = Math.hypot(player.vx, player.vy);
    const inSafeAir =
      player.y < seaLevel - 160 && player.y > spaceLevel + 240;
    if (Math.abs(angleErr) > 36 && inSafeAir) {
      // Stall-and-whip: release thrust to snap turn at unboosted turnspeed.
      thrust = false;
    } else {
      thrust = Math.abs(angleErr) <= 45 || speed < 3.5;
    }
  }

  let fire = false;
  if (!inhibitFire) {
    const target = selectTarget(snapshot);
    if (target) {
      const dist = Math.hypot(target.x - player.x, target.y - player.y);
      const targetAngle =
        (Math.atan2(target.y - player.y, target.x - player.x) * 180) / Math.PI;
      const fireErr = Math.abs(shortestAngleDiffDeg(player.angleDeg, targetAngle));

      if (player.weaponSpec.id === 1) {
        fire = fireErr < 22 && dist < 520;
      } else if (player.weaponSpec.id === 3) {
        fire = fireErr < 75 && dist < 620;
      } else {
        fire = fireErr < 32 && dist < 580;
      }
    }
  }

  return { left, right, thrust, fire };
}
