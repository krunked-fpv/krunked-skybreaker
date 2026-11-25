import type {
  EnemyEntity,
  InputState,
  PlayerState,
  ProjectileEntity,
  SimSnapshot,
} from '../contracts/sim';
import { clamp, shortestAngleDiffDeg } from './math';

interface ThreatVector {
  escapeAngleDeg: number;
  urgency: number;
}

interface TargetPosition {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

function getWeaponLeadSpeed(weaponId: number): number {
  switch (weaponId) {
    case 1:
      return 42;
    case 4:
      return 10;
    case 3:
      return 14;
    case 6:
      return 38;
    case 7:
      return 14;
    case 8:
      return 60;
    default:
      return 22;
  }
}

function getFireEnvelope(weaponId: number): { maxErrDeg: number; maxDist: number } {
  switch (weaponId) {
    case 1:
      return { maxErrDeg: 22, maxDist: 520 };
    case 3:
      return { maxErrDeg: 75, maxDist: 620 };
    case 6:
      return { maxErrDeg: 18, maxDist: 640 };
    case 7:
      return { maxErrDeg: 30, maxDist: 420 };
    case 8:
      return { maxErrDeg: 35, maxDist: 260 };
    default:
      return { maxErrDeg: 32, maxDist: 580 };
  }
}

function findIncomingThreatForPlayer(
  player: PlayerState,
  projectiles: readonly ProjectileEntity[],
  enemies: readonly EnemyEntity[],
  seaLevel: number,
  spaceLevel: number,
  treatOpponentProjectilesAsThreat = false,
): ThreatVector | null {
  let bestUrgency = 0;
  let bestEscapeX = 0;
  let bestEscapeY = 0;
  const selfSlot = player.playerIndex ?? 1;

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
    const isThreat = treatOpponentProjectilesAsThreat
      ? p.owner === 'enemy' || (p.ownerPlayer !== undefined && p.ownerPlayer !== selfSlot)
      : p.owner === 'enemy';
    if (!isThreat) continue;
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

function selectEnemyTargetForPlayer(
  player: PlayerState,
  enemies: readonly EnemyEntity[],
  seaLevel: number,
): EnemyEntity | null {
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

function computeFlightAndFireInput(
  player: PlayerState,
  target: TargetPosition | null,
  threat: ThreatVector | null,
  seaLevel: number,
  spaceLevel: number,
): InputState {
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
      const projSpeed = getWeaponLeadSpeed(player.weaponSpec.id);
      const leadTicks = Math.min(22, dist / projSpeed);
      const aimX = target.x + target.vx * leadTicks;
      let aimY = target.y + target.vy * leadTicks;

      // Avoid diving straight into ocean surface when chasing low targets.
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
  if (!inhibitFire && target) {
    const dist = Math.hypot(target.x - player.x, target.y - player.y);
    const targetAngle =
      (Math.atan2(target.y - player.y, target.x - player.x) * 180) / Math.PI;
    const fireErr = Math.abs(shortestAngleDiffDeg(player.angleDeg, targetAngle));
    const envelope = getFireEnvelope(player.weaponSpec.id);
    fire = fireErr < envelope.maxErrDeg && dist < envelope.maxDist;
  }

  return { left, right, thrust, fire };
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

  const { player, enemies, projectiles, seaLevel, spaceLevel } = snapshot;
  const threat = findIncomingThreatForPlayer(player, projectiles, enemies, seaLevel, spaceLevel);
  const target = selectEnemyTargetForPlayer(player, enemies, seaLevel);
  return computeFlightAndFireInput(player, target, threat, seaLevel, spaceLevel);
}

/**
 * Autonomous Player 2 AI controller for Act II 2P Co-op mode.
 * Uses identical sea/space safety, threat dodging, healing, and lead pursuit for `snapshot.player2`.
 */
export function computeCoopP2BotInput(snapshot: SimSnapshot): InputState {
  if (snapshot.phase !== 'playing' || !snapshot.player2 || !snapshot.player2.alive) {
    return { left: false, right: false, thrust: false, fire: false };
  }

  const { player2, enemies, projectiles, seaLevel, spaceLevel } = snapshot;
  const threat = findIncomingThreatForPlayer(player2, projectiles, enemies, seaLevel, spaceLevel);
  const target = selectEnemyTargetForPlayer(player2, enemies, seaLevel);
  return computeFlightAndFireInput(player2, target, threat, seaLevel, spaceLevel);
}

/**
 * Autonomous AI controller for P2 in Act II 1v1 Dogfight Arena mode.
 * Applies sea/space safety, dodges opponent projectiles, heals when low HP, and executes lead pursuit.
 */
export function computeDogfightBotInput(
  self: PlayerState,
  opponent: PlayerState,
  seaLevel: number,
  spaceLevel: number,
  projectiles: readonly ProjectileEntity[],
): InputState {
  if (!self.alive) {
    return { left: false, right: false, thrust: false, fire: false };
  }

  const threat = findIncomingThreatForPlayer(
    self,
    projectiles,
    [],
    seaLevel,
    spaceLevel,
    true,
  );
  const target: TargetPosition | null = opponent.alive ? opponent : null;
  return computeFlightAndFireInput(self, target, threat, seaLevel, spaceLevel);
}
