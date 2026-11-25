import type { AudioCueId } from '../contracts/audio';
import type { IModRegistry } from '../contracts/mod';
import type {
  EnemyEntity,
  GameMode,
  InputState,
  ISimulation,
  Loadout,
  ParallaxEntity,
  PartIndex,
  ParticleEntity,
  PilotProfile,
  PlayerState,
  ProjectileEntity,
  ReplayFrame,
  ReplayRecording,
  SimAudioEvent,
  SimPhase,
  SimSnapshot,
} from '../contracts/sim';
import type {
  BodySpec,
  EnemyKind,
  EnemySpec,
  EngineSpec,
  GameDataBundle,
  ProjectileSpec,
  SpawnCoordinatorSpec,
  WeaponSpec,
} from '../contracts/vault';
import { computeAutopilotInput } from './autopilot';
import { clamp, distPointToBoxSq, distPointToSegmentSq, shortestAngleDiffDeg } from './math';
import { type KillSource, MissionTracker } from './missions';
import { ModRegistry } from './mod-registry';
import { SeededRng } from './prng';

const ENEMY_SCORE_VALUES: Record<EnemyKind, number> = {
  Fighter: 20,
  Jet: 40,
  Boat: 50,
  BigBoat: 250,
  Submarine: 300,
  Ace: 150,
  LaserAce: 300,
  AceMarine: 600,
  Missile: 10,
  Blimp: 1000,
};

const ENEMY_DIMENSIONS: Record<EnemyKind, { w: number; h: number; r: number }> = {
  Fighter: { w: 20, h: 20, r: 12 },
  Jet: { w: 20, h: 20, r: 12 },
  Ace: { w: 45, h: 45, r: 22 },
  LaserAce: { w: 45, h: 45, r: 22 },
  Boat: { w: 60, h: 17, r: 24 },
  BigBoat: { w: 300, h: 50, r: 64 },
  Submarine: { w: 198, h: 36, r: 44 },
  AceMarine: { w: 240, h: 36, r: 52 },
  Missile: { w: 24, h: 10, r: 10 },
  Blimp: { w: 550, h: 219, r: 105 },
};

const COMBO_MAX = 20;
const COMBO_MAX_TIMER = 180;
const COMBO_WARNING_THRESHOLD = 60;
const HEAL_DELAY_TICKS = 12;
const LASER_BEAM_LENGTH = 520;
const NUKE_MAX_RADIUS = 440;
const PLASMA_AOE_RADIUS = 84;
const BOMB_AOE_RADIUS = 56;
const DEATH_TICKS_DURATION = 90;

export function encodeInputMask(input: InputState): number {
  return (
    (input.left ? 1 : 0) |
    (input.right ? 2 : 0) |
    (input.thrust ? 4 : 0) |
    (input.fire ? 8 : 0)
  );
}

export function decodeInputMask(mask: number): InputState {
  return {
    left: (mask & 1) !== 0,
    right: (mask & 2) !== 0,
    thrust: (mask & 4) !== 0,
    fire: (mask & 8) !== 0,
  };
}

export function createDefaultProfile(): PilotProfile {
  return {
    version: 1,
    unlockedWeapons: [0],
    unlockedBodies: [0],
    unlockedEngines: [0],
    completedMissions: [],
    activeMissionIds: [],
    highScoreNormal: 0,
    highScoreSfmt: 0,
    selectedPaletteId: 'original',
    sfmtUnlocked: false,
    lastLoadout: { weapon: 0, body: 0, engine: 0 },
    lastMode: 'normal',
    lastSeed: 1,
    totalKills: {},
    stats: {
      sorties: 0,
      totalScore: 0,
      bestCombo: 1,
    },
  };
}

function cloneProfile(p: PilotProfile): PilotProfile {
  return {
    version: p.version,
    unlockedWeapons: [...p.unlockedWeapons],
    unlockedBodies: [...p.unlockedBodies],
    unlockedEngines: [...p.unlockedEngines],
    completedMissions: [...p.completedMissions],
    activeMissionIds: [...p.activeMissionIds],
    highScoreNormal: p.highScoreNormal,
    highScoreSfmt: p.highScoreSfmt,
    selectedPaletteId: p.selectedPaletteId,
    sfmtUnlocked: p.sfmtUnlocked,
    lastLoadout: { ...p.lastLoadout },
    lastMode: p.lastMode,
    lastSeed: p.lastSeed,
    totalKills: { ...p.totalKills },
    stats: { ...p.stats },
  };
}

function resolvePartSpec<T extends { id: number }>(
  byId: readonly T[],
  map: Record<string, T>,
  id: number,
): T {
  const direct = byId[id];
  if (direct && direct.id === id) return direct;
  const fromArray = byId.find((item) => item.id === id);
  if (fromArray) return fromArray;
  const all = Object.values(map);
  return all.find((item) => item.id === id) ?? all[0]!;
}

function getEnemySpec(
  map: Record<string, EnemySpec>,
  kind: EnemyKind,
): EnemySpec {
  const key = kind.toLowerCase();
  if (map[key]) return map[key]!;
  if (map[kind]) return map[kind]!;
  const found = Object.values(map).find(
    (s) => s.key.toLowerCase() === key || s.name.toLowerCase() === key,
  );
  if (found) return found;
  return Object.values(map)[0]!;
}

function isBoatLike(kind: EnemyKind): boolean {
  return (
    kind === 'Boat' ||
    kind === 'BigBoat' ||
    kind === 'Submarine' ||
    kind === 'AceMarine'
  );
}

function isPointInEnemyHitbox(
  px: number,
  py: number,
  radius: number,
  enemy: EnemyEntity,
): boolean {
  if (enemy.width > enemy.height * 1.8) {
    return (
      Math.abs(px - enemy.x) <= enemy.width * 0.48 + radius &&
      Math.abs(py - enemy.y) <= enemy.height * 0.55 + radius
    );
  }
  const dx = px - enemy.x;
  const dy = py - enemy.y;
  const r = enemy.hitRadius + radius;
  return dx * dx + dy * dy <= r * r;
}

function isSegmentHittingEnemy(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
  enemy: EnemyEntity,
): boolean {
  if (enemy.width > enemy.height * 1.8) {
    // Sub-sample fast segment against rectangular ship/blimp hull
    const dist = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(dist / 12));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const sx = ax + (bx - ax) * t;
      const sy = ay + (by - ay) * t;
      if (isPointInEnemyHitbox(sx, sy, radius, enemy)) return true;
    }
    return false;
  }
  const r = enemy.hitRadius + radius;
  return distPointToSegmentSq(enemy.x, enemy.y, ax, ay, bx, by) <= r * r;
}

function isAoeHittingEnemy(
  cx: number,
  cy: number,
  aoeRadius: number,
  enemy: EnemyEntity,
): boolean {
  if (enemy.width > enemy.height * 1.8) {
    return (
      distPointToBoxSq(
        cx,
        cy,
        enemy.x,
        enemy.y,
        enemy.width * 0.48,
        enemy.height * 0.55,
      ) <=
      aoeRadius * aoeRadius
    );
  }
  const dx = cx - enemy.x;
  const dy = cy - enemy.y;
  const r = aoeRadius + enemy.hitRadius;
  return dx * dx + dy * dy <= r * r;
}

/**
 * Deterministic 60Hz LUFTRAUSERS Simulation Core (Pure, Zero-DOM).
 */
export class Simulation implements ISimulation {
  private readonly data: GameDataBundle;
  private readonly modRegistry: IModRegistry;
  private readonly rng: SeededRng;
  private readonly missionTracker: MissionTracker;

  private profile: PilotProfile;
  private phase: SimPhase = 'hangar';
  private mode: GameMode = 'normal';
  private paused = false;
  private autopilotEnabled = false;
  private seed = 1;

  private tick = 0;
  private hitstopTicks = 0;
  private screenShake = 0;
  private nukeFlashTicks = 0;
  private launchTicks = 0;
  private deathTicks = 0;

  private score = 0;
  private combo = 1;
  private comboTimer = 0;
  private comboWarning = false;
  private difficulty = 60;
  private difficultyTimer = 0;
  private spawnTimer = 15;
  private parallaxTimer = 60;

  private killsThisSortie = 0;
  private killsByKind: Record<string, number> = {};
  private comboKillStreak = 0;
  private bestComboThisSortie = 1;
  private continuousFireTicks = 0;
  private lastFirePressed = false;
  private lastPlayerHitTick = -1000;
  private distinctKindsThisSortie = new Set<EnemyKind>();
  private sortieFinalized = false;
  private hitSoundIndex = 0;

  private nextEntityId = 1;
  private player: PlayerState;
  private enemies: EnemyEntity[] = [];
  private projectiles: ProjectileEntity[] = [];
  private particles: ParticleEntity[] = [];
  private parallax: ParallaxEntity[] = [];
  private audioEvents: SimAudioEvent[] = [];
  private replayFrames: ReplayFrame[] = [];
  private enemyRamGrace = new Map<number, number>();

  private cameraTargetX = 0;
  private cameraTargetY = -120;

  constructor(
    data: GameDataBundle,
    modRegistry?: IModRegistry,
    initialProfile?: PilotProfile,
  ) {
    this.data = data;
    this.modRegistry = modRegistry ?? new ModRegistry(true);
    this.profile = initialProfile ? cloneProfile(initialProfile) : createDefaultProfile();
    this.seed = (this.profile.lastSeed >>> 0) || 1;
    this.rng = new SeededRng(this.seed);
    this.mode = this.profile.lastMode;
    this.difficulty = this.getSpawnCoordinator().initialDifficulty;

    this.missionTracker = new MissionTracker(this.data.global.missions, this.profile);
    this.player = this.buildPlayerState(this.profile.lastLoadout);
  }

  private getSpawnCoordinator(): SpawnCoordinatorSpec {
    return this.mode === 'sfmt'
      ? this.data.spawnCoordinatorSfmt
      : this.data.spawnCoordinator;
  }

  private getEnemyMap(): Record<string, EnemySpec> {
    return this.mode === 'sfmt' ? this.data.enemiesSfmt : this.data.enemies;
  }

  private resolveAircraft(loadout: Loadout): {
    weaponSpec: WeaponSpec;
    bodySpec: BodySpec;
    engineSpec: EngineSpec;
    planeName: string;
    isUrauser: boolean;
    maxHealth: number;
  } {
    const weaponSpec = resolvePartSpec(
      this.data.player.weaponsById,
      this.data.player.weapons,
      loadout.weapon,
    );
    const rawBodySpec = resolvePartSpec(
      this.data.player.bodiesById,
      this.data.player.bodyparts,
      loadout.body,
    );
    const engineSpec = resolvePartSpec(
      this.data.player.enginesById,
      this.data.player.engines,
      loadout.engine,
    );

    const isUrauser =
      loadout.weapon === 5 && loadout.body === 5 && loadout.engine === 5;

    const entry = this.data.global.planenames.find(
      (p) =>
        p.weapon === loadout.weapon &&
        p.body === loadout.body &&
        p.engine === loadout.engine,
    );

    let planeName: string;
    if (isUrauser) {
      planeName = entry?.name ?? 'URAUSER';
    } else if (
      loadout.weapon === 5 ||
      loadout.body === 5 ||
      loadout.engine === 5
    ) {
      planeName = '???';
    } else {
      planeName = entry?.name ?? 'original';
    }

    const bodySpec: BodySpec = isUrauser
      ? { ...rawBodySpec, maxhealth: 120, healingspd: 0.01 }
      : { ...rawBodySpec };
    const maxHealth = isUrauser ? 120 : bodySpec.maxhealth;

    return {
      weaponSpec,
      bodySpec,
      engineSpec,
      planeName,
      isUrauser,
      maxHealth,
    };
  }

  private buildPlayerState(loadout: Loadout): PlayerState {
    const resolved = this.resolveAircraft(loadout);
    const seaLevel = this.data.room.sealevel;
    return {
      x: 0,
      y: seaLevel - 32,
      prevX: 0,
      prevY: seaLevel - 32,
      vx: 0,
      vy: -5.5,
      angleDeg: -90,
      prevAngleDeg: -90,
      health: resolved.maxHealth,
      maxHealth: resolved.maxHealth,
      alive: true,
      boosting: false,
      wasBoosting: false,
      firing: false,
      healing: false,
      healingTicks: 0,
      underwater: false,
      inSpace: false,
      fireCooldown: 0,
      gungineCooldown: 0,
      bombCooldown: 0,
      flashTicks: 0,
      burnTicks: 0,
      envWaterFactor: 0,
      envSpaceFactor: 0,
      nukeTriggered: false,
      nukeRadius: 0,
      nukeTicks: 0,
      isUrauser: resolved.isUrauser,
      loadout: { ...loadout },
      planeName: resolved.planeName,
      engineSpec: resolved.engineSpec,
      bodySpec: resolved.bodySpec,
      weaponSpec: resolved.weaponSpec,
      boostAnimFrame: 0,
    };
  }

  launch(loadout: Loadout, mode: GameMode, seed?: number): void {
    this.mode = mode;
    if (seed !== undefined) {
      this.seed = seed >>> 0;
    }
    this.rng.setSeed(this.seed);
    this.paused = false;

    this.profile.lastLoadout = { ...loadout };
    this.profile.lastMode = mode;
    this.profile.lastSeed = this.seed;

    this.tick = 0;
    this.hitstopTicks = 0;
    this.screenShake = 0;
    this.nukeFlashTicks = 0;
    this.launchTicks = 18;
    this.deathTicks = 0;

    this.score = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.comboWarning = false;
    this.difficulty = this.getSpawnCoordinator().initialDifficulty;
    this.difficultyTimer = 0;
    this.spawnTimer = 15;
    this.parallaxTimer = 45;

    this.killsThisSortie = 0;
    this.killsByKind = {};
    this.comboKillStreak = 0;
    this.bestComboThisSortie = 1;
    this.continuousFireTicks = 0;
    this.lastFirePressed = false;
    this.lastPlayerHitTick = -1000;
    this.distinctKindsThisSortie.clear();
    this.sortieFinalized = false;
    this.hitSoundIndex = 0;

    this.nextEntityId = 1;
    this.enemies = [];
    this.projectiles = [];
    this.particles = [];
    this.parallax = [];
    this.audioEvents = [];
    this.replayFrames = [];
    this.enemyRamGrace.clear();

    this.player = this.buildPlayerState(loadout);
    this.phase = 'playing';
    this.cameraTargetX = this.player.x;
    this.cameraTargetY = clamp(
      this.player.y - 40,
      this.data.room.spacelevel + 160,
      this.data.room.sealevel + 60,
    );

    this.missionTracker.startSortie(loadout, this.profile);

    this.emitAudio('sndlaunch', this.player.x, this.player.y);
    this.emitAudio('sndsplashl', 0, this.data.room.sealevel);
    if (mode === 'sfmt') {
      this.emitAudio('sndsfmt');
    }
    this.spawnParticle('splashB', 0, this.data.room.sealevel);
  }

  returnToHangar(): void {
    if (this.phase === 'dying') {
      this.finalizeSortieStats();
    }
    this.phase = 'hangar';
    this.paused = false;
    this.enemies = [];
    this.projectiles = [];
    this.particles = [];
    this.audioEvents = [];
    this.player = this.buildPlayerState(this.player.loadout);
    this.missionTracker.refreshActiveMissions(this.player.loadout, this.profile);
  }

  setLoadout(loadout: Loadout): void {
    this.profile.lastLoadout = { ...loadout };
    this.player = this.buildPlayerState(loadout);
    this.missionTracker.refreshActiveMissions(loadout, this.profile);
  }

  setMode(mode: GameMode): void {
    this.mode = mode;
    this.profile.lastMode = mode;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setAutopilot(enabled: boolean): void {
    this.autopilotEnabled = enabled;
  }

  damagePlayer(amount: number): void {
    if (!this.player.alive || amount <= 0) return;
    this.applyDamageToPlayer(amount, true);
  }

  spawnEnemy(kind: EnemyKind, x?: number, y?: number): EnemyEntity {
    const specMap = this.getEnemyMap();
    const spec = getEnemySpec(specMap, kind);
    const dims = ENEMY_DIMENSIONS[kind];
    const seaLevel = this.data.room.sealevel;
    const spaceLevel = this.data.room.spacelevel;

    const spawnSide = this.rng.chance(0.5) ? 1 : -1;
    const ex =
      x !== undefined ? x : this.player.x + spawnSide * this.rng.range(360, 460);

    let ey: number;
    if (y !== undefined) {
      ey = y;
    } else if (kind === 'Boat' || kind === 'BigBoat') {
      ey = seaLevel;
    } else if (kind === 'Submarine' || kind === 'AceMarine') {
      ey = seaLevel + 24;
    } else if (kind === 'Blimp') {
      ey = spaceLevel + (spec.spawnceilingoffset ?? -200);
    } else if (kind === 'Missile') {
      ey = seaLevel;
    } else {
      ey = clamp(
        this.player.y + this.rng.range(-180, 180),
        spaceLevel + 120,
        seaLevel - 80,
      );
    }

    const dirToPlayer = ex <= this.player.x ? 1 : -1;
    let vx = 0;
    let vy = 0;
    let angleDeg = dirToPlayer > 0 ? 0 : 180;
    let state: EnemyEntity['state'] = 'cruise';
    let fallFrames = 0;
    let surfaceTimer = 0;
    let fireTimer = 30;
    let salvoCooldown = 30;
    let salvoRemaining = 0;

    if (kind === 'Fighter') {
      const spd = spec.initvelocity || 8;
      vx = dirToPlayer * spd;
      fireTimer = (spec.fireinterval || 20) + this.rng.range(0, spec.fireintervalrand || 40);
      state = 'chase';
    } else if (kind === 'Jet') {
      const spd = spec.speed || spec.initvelocity || 20;
      vx = dirToPlayer * spd;
      fireTimer = spec.fireinterval < 1e6 ? spec.fireinterval : 999999999;
      state = 'cruise';
    } else if (kind === 'Ace' || kind === 'LaserAce') {
      const spd = spec.initvelocity || 6;
      vx = dirToPlayer * spd;
      state = 'chase';
      fireTimer = 45;
      salvoRemaining = 0;
      this.emitAudio('sndacespawn', ex, ey);
    } else if (kind === 'Boat' || kind === 'BigBoat') {
      const spd = (spec.initvelocity || 0.5) + this.rng.range(0, spec.velocityvariance || 0.5);
      vx = (this.rng.chance(0.5) ? 1 : -1) * spd;
      angleDeg = vx >= 0 ? 0 : 180;
      salvoCooldown =
        (spec.firesalvotimer || 60) +
        this.rng.range(0, spec.firesalvotimerrand || 60);
    } else if (kind === 'Submarine' || kind === 'AceMarine') {
      vx = dirToPlayer * 0.4;
      vy = spec.initvelocity || -0.5;
      state = 'surfacing';
      surfaceTimer = (spec.surfacetimer || 80) + 40;
      salvoCooldown = spec.firesalvotimer || 30;
      fireTimer = spec.firstacelaunchinterval || 30;
    } else if (kind === 'Missile') {
      vy = spec.initvelocity || -2.0;
      angleDeg = -90;
      state = 'chase';
      this.emitAudio('sndmisspawn', ex, ey);
    } else if (kind === 'Blimp') {
      const spd = (spec.initvelocity || 0.5) + this.rng.range(0, spec.velocityvariance || 0.5);
      vx = dirToPlayer * spd;
      angleDeg = dirToPlayer > 0 ? 0 : 180;
      state = ey < spaceLevel ? 'falling' : 'cruise';
      fallFrames =
        ey < spaceLevel ? (spec.fallnumframes || 300) : 0;
      salvoCooldown = (spec.firesalvotimer || 50) + this.rng.range(0, spec.firesalvotimerrand || 30);
    }

    const gunAngleDeg =
      (Math.atan2(this.player.y - ey, this.player.x - ex) * 180) / Math.PI;

    const entity: EnemyEntity = {
      id: this.nextEntityId++,
      kind,
      x: ex,
      y: ey,
      prevX: ex,
      prevY: ey,
      vx,
      vy,
      angleDeg,
      gunAngleDeg,
      health: spec.health,
      maxHealth: spec.health,
      active: true,
      state,
      aiTimer: 0,
      fireTimer,
      salvoRemaining,
      salvoCooldown,
      surfaceTimer,
      fallFrames,
      lifetime: spec.lifetime || 0,
      activationTimer: spec.activationtimer || 0,
      flashTicks: 0,
      hitRadius: dims.r,
      width: dims.w,
      height: dims.h,
      scoreValue: ENEMY_SCORE_VALUES[kind],
      difficultyWeight: spec.difficultyweight,
      spriteMain: spec.bodysprite ?? spec.sprite ?? 'fighter_body',
      spriteSecondary: spec.wingssprite,
      spriteGun: spec.spritegun,
      laserActive: false,
      laserLength: 0,
    };

    this.enemies.push(entity);
    return entity;
  }

  step(input: InputState): SimSnapshot {
    this.audioEvents = [];

    if (this.paused || this.phase === 'hangar' || this.phase === 'gameover') {
      return this.getSnapshot();
    }

    const effectiveInput: InputState =
      this.phase === 'playing'
        ? this.autopilotEnabled
          ? computeAutopilotInput(this.getSnapshot())
          : input
        : { left: false, right: false, thrust: false, fire: false };

    this.tick++;
    this.replayFrames.push({
      tick: this.tick,
      mask: encodeInputMask(effectiveInput),
    });

    if (this.launchTicks > 0) this.launchTicks--;
    if (this.nukeFlashTicks > 0) this.nukeFlashTicks--;
    if (this.screenShake > 0) {
      this.screenShake = Math.max(0, this.screenShake * 0.85 - 0.1);
    }

    if (this.hitstopTicks > 0) {
      this.hitstopTicks--;
      return this.getSnapshot();
    }

    if (this.phase === 'playing') {
      this.updatePlayerAerodynamics(effectiveInput);
      this.updatePlayerHealing(effectiveInput);
      this.updatePlayerWeapons(effectiveInput);
      this.updateComboTimer();
      this.updateSpawnDirector();
      this.updateParallax();
    } else if (this.phase === 'dying') {
      this.updateDyingSequence();
    }

    this.updateEnemies();
    this.updateProjectiles();
    if (this.phase === 'playing' && this.player.alive) {
      this.checkPlayerEnemyCollisions();
    }
    this.updateParticles();

    // Cleanup inactive enemies & decremented collision grace counters
    this.enemies = this.enemies.filter((e) => e.active);
    for (const [eid, grace] of this.enemyRamGrace.entries()) {
      if (grace <= 1) {
        this.enemyRamGrace.delete(eid);
      } else {
        this.enemyRamGrace.set(eid, grace - 1);
      }
    }

    // Update camera target with velocity lead
    this.cameraTargetX = this.player.x + this.player.vx * 14;
    this.cameraTargetY = clamp(
      this.player.y + this.player.vy * 10,
      this.data.room.spacelevel + 160,
      this.data.room.sealevel + 80,
    );

    if (this.phase === 'playing' || this.phase === 'dying') {
      const completed = this.missionTracker.onScoreAndCombo(
        this.score,
        this.combo,
        this.player.loadout,
        this.profile,
      );
      if (completed.length > 0) {
        this.emitAudio('sndpopup');
      }
    }

    this.lastFirePressed = effectiveInput.fire;
    return this.getSnapshot();
  }

  private updatePlayerAerodynamics(input: InputState): void {
    const p = this.player;
    const engine = p.engineSpec;
    const body = p.bodySpec;
    const weapon = p.weaponSpec;
    const seaLevel = this.data.room.sealevel;
    const spaceLevel = this.data.room.spacelevel;

    p.prevX = p.x;
    p.prevY = p.y;
    p.prevAngleDeg = p.angleDeg;
    if (p.flashTicks > 0) p.flashTicks--;
    if (p.burnTicks > 0) p.burnTicks--;

    // Apply any unlocked Act II FlightMutators
    for (const mutator of this.modRegistry.getActiveFlightMutators()) {
      mutator.apply?.(p, input, 1 / 60);
    }

    p.wasBoosting = p.boosting;
    p.boosting = input.thrust && p.alive;

    // 1. Stall-and-Whip turn rate + Laser 1/3 divisor
    let turnRate = p.boosting ? engine.turnspeedboost : engine.turnspeed;
    if (weapon.id === 1 && input.fire) {
      turnRate /= this.modRegistry.vanillaProfile.laserTurnDivisor;
    }
    const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    p.angleDeg += steer * turnRate;

    // 2. Thrust, boostadd rising edge, velocity alignment, gravity, drag
    const rad = (p.angleDeg * Math.PI) / 180;
    const cosRad = Math.cos(rad);
    const sinRad = Math.sin(rad);
    const maxSpeed = engine.maximumspeed * body.speedmodifier;

    if (p.boosting) {
      if (!p.wasBoosting) {
        if (engine.boostadd > 0) {
          p.vx += cosRad * engine.boostadd;
          p.vy += sinRad * engine.boostadd;
        }
        this.emitAudio(p.underwater ? 'snduboost' : 'sndboost', p.x, p.y);
        p.boostAnimFrame = 0;
      }

      const accel = engine.acceleration * 0.45;
      p.vx += cosRad * accel;
      p.vy += sinRad * accel;
      p.boostAnimFrame = (p.boostAnimFrame + 1) % 60;

      // Align velocity subtly via motionadddirection / motionaddimageangle
      const spdBeforeAlign = Math.hypot(p.vx, p.vy);
      if (spdBeforeAlign > 0.01) {
        const velAngleDeg = (Math.atan2(p.vy, p.vx) * 180) / Math.PI;
        const angleDelta = shortestAngleDiffDeg(velAngleDeg, p.angleDeg);
        const alignStrength =
          (engine.motionadddirection || 0) + (engine.motionaddimageangle || 0);
        const rotRad = (angleDelta * alignStrength * Math.PI) / 180;
        const c = Math.cos(rotRad);
        const s = Math.sin(rotRad);
        const nvx = p.vx * c - p.vy * s;
        const nvy = p.vx * s + p.vy * c;
        p.vx = nvx;
        p.vy = nvy;
      }

      p.vy += engine.gravity;

      const spd = Math.hypot(p.vx, p.vy);
      if (spd > maxSpeed && maxSpeed > 0) {
        const scale = maxSpeed / spd;
        p.vx *= scale;
        p.vy *= scale;
      }

      // Gungine rear bullets every 3 ticks while boosting
      if (engine.flags.includes('gun-engine')) {
        if (p.gungineCooldown > 0) {
          p.gungineCooldown--;
        }
        if (p.gungineCooldown <= 0) {
          p.gungineCooldown = 3;
          const rearAngleDeg = p.angleDeg + 180;
          const rearRad = (rearAngleDeg * Math.PI) / 180;
          const bSpec = this.getProjectileSpec('bullet');
          const bSpd = bSpec.speed || 24;
          const bx = p.x + Math.cos(rearRad) * 12;
          const by = p.y + Math.sin(rearRad) * 12;
          this.spawnProjectile({
            owner: 'player',
            kind: 'bullet',
            x: bx,
            y: by,
            vx: Math.cos(rearRad) * bSpd,
            vy: Math.sin(rearRad) * bSpd,
            angleDeg: rearAngleDeg,
            ttl: bSpec.ttl || 60,
            dmg: bSpec.dmg || 4,
            radius: 6,
            targetId: null,
            piercing: false,
            aoeRadius: 0,
            fromGungine: true,
          });
          this.emitAudio('sndgungine', p.x, p.y);
        }
      }
    } else {
      if (p.wasBoosting) {
        this.emitAudio('sndunboost', p.x, p.y);
        if (engine.boostendparticle) {
          this.spawnParticle(engine.boostendparticle, p.x, p.y);
        }
      }
      p.gungineCooldown = 0;

      p.vy += engine.gravity;
      const spd = Math.hypot(p.vx, p.vy);
      if (spd > 1e-4) {
        const nextSpd = Math.max(
          engine.minimumspeed,
          spd * (1 - engine.friction),
        );
        const scale = nextSpd / spd;
        p.vx *= scale;
        p.vy *= scale;
      } else if (engine.minimumspeed > 0) {
        p.vx = cosRad * engine.minimumspeed;
        p.vy = sinRad * engine.minimumspeed;
      }
    }

    // 3. Sea Level & Space Ceiling environmental forces
    const wasUnderwater = p.underwater;
    const nowUnderwater = p.y > seaLevel;
    p.underwater = nowUnderwater;

    if (nowUnderwater !== wasUnderwater) {
      const speed = Math.hypot(p.vx, p.vy);
      this.emitAudio(speed > 6 ? 'sndsplashl' : 'sndsplashm', p.x, seaLevel);
      this.spawnParticle(speed > 6 ? 'splashM' : 'splashS', p.x, seaLevel);
    }

    if (nowUnderwater) {
      p.envWaterFactor = Math.min(1, p.envWaterFactor + engine.wateracceleration);
      p.vy -= engine.waterforce * (0.6 + p.envWaterFactor);

      if (!engine.waterproof) {
        const diff = shortestAngleDiffDeg(p.angleDeg, -90);
        const rotStep = Math.min(
          Math.abs(diff),
          this.data.player.settings.waterrotationforcedegrees,
        );
        p.angleDeg += Math.sign(diff) * rotStep;

        const hpRatio = p.maxHealth > 0 ? p.health / p.maxHealth : 1;
        const waterDmg =
          hpRatio < engine.waterlowhpperc
            ? engine.waterdmglowhp
            : engine.waterdmg;
        if (waterDmg > 0) {
          this.applyDamageToPlayer(waterDmg, false);
        }
      }

      if (p.y < seaLevel + 24 && this.tick % 4 === 0) {
        this.spawnParticle('watertrail', p.x, seaLevel);
      }
    } else {
      p.envWaterFactor *= engine.environmentfriction;
      if (p.envWaterFactor < engine.environmentmin) {
        p.envWaterFactor = 0;
      }
    }

    const nowInSpace = p.y < spaceLevel;
    p.inSpace = nowInSpace;
    if (nowInSpace) {
      p.envSpaceFactor = Math.min(1, p.envSpaceFactor + engine.spaceacceleration);
      p.vy += engine.spaceforce * (0.6 + p.envSpaceFactor);
      const hpRatio = p.maxHealth > 0 ? p.health / p.maxHealth : 1;
      const spaceDmg =
        hpRatio < engine.spacelowhpperc
          ? engine.spacedmglowhp
          : engine.spacedmg;
      if (spaceDmg > 0) {
        this.applyDamageToPlayer(spaceDmg, false);
      }
    } else {
      p.envSpaceFactor *= engine.environmentfriction;
      if (p.envSpaceFactor < engine.environmentmin) {
        p.envSpaceFactor = 0;
      }
    }

    p.x += p.vx;
    p.y += p.vy;
  }

  private updatePlayerHealing(input: InputState): void {
    const p = this.player;
    if (!p.alive) {
      p.healing = false;
      p.healingTicks = 0;
      return;
    }

    if (input.fire) {
      p.healing = false;
      p.healingTicks = 0;
      return;
    }

    const canHeal =
      p.health < p.maxHealth &&
      (!p.underwater || p.engineSpec.waterproof) &&
      !p.inSpace;

    if (!canHeal) {
      p.healing = false;
      p.healingTicks = 0;
      return;
    }

    p.healingTicks++;
    if (p.healingTicks >= HEAL_DELAY_TICKS) {
      p.healing = true;
      const prevHp = p.health;
      const healAmt = p.isUrauser ? 0.01 : p.bodySpec.healingspd;
      p.health = Math.min(p.maxHealth, p.health + healAmt);

      if (p.healingTicks === HEAL_DELAY_TICKS || p.healingTicks % 10 === 0) {
        if (p.health < p.maxHealth) {
          this.emitAudio('sndheal', p.x, p.y);
        }
      }
      if (p.healingTicks % 3 === 0) {
        this.spawnParticle('repair', p.x, p.y);
      }
      if (prevHp < p.maxHealth && p.health >= p.maxHealth) {
        p.healing = false;
        p.healingTicks = 0;
        this.emitAudio('sndhealed', p.x, p.y);
      }
    }
  }

  private getProjectileSpec(id: string): ProjectileSpec {
    return (
      this.data.projectiles[id] ?? {
        id,
        ttl: 60,
        dmg: 4,
        speed: 24,
        degreesoffset: 0,
        sfxfire: '',
        flags: '',
      }
    );
  }

  private updatePlayerWeapons(input: InputState): void {
    const p = this.player;
    if (!p.alive) return;

    p.firing = input.fire;
    if (input.fire) {
      this.continuousFireTicks++;
    } else {
      this.continuousFireTicks = 0;
    }

    if (p.fireCooldown > 0) {
      p.fireCooldown--;
      if (p.weaponSpec.id === 4 && p.fireCooldown === 0) {
        this.emitAudio('sndcannonreload', p.x, p.y);
      } else if (
        p.weaponSpec.id === 4 &&
        input.fire &&
        !this.lastFirePressed
      ) {
        this.emitAudio('sndcannonfail', p.x, p.y);
      }
    }

    if (p.bombCooldown > 0) {
      p.bombCooldown--;
    }

    // Bomb body special: drop gravity-assisted bomb every 24 ticks when firing/boosting
    if (
      p.bodySpec.flags.includes('body-drop-bomb') &&
      (input.fire || input.thrust) &&
      p.bombCooldown <= 0
    ) {
      p.bombCooldown = 24;
      this.spawnProjectile({
        owner: 'player',
        kind: 'bomb',
        x: p.x,
        y: p.y + 6,
        vx: p.vx * 0.8,
        vy: p.vy * 0.5 + 1.5,
        angleDeg: 90,
        ttl: 90,
        dmg: 16,
        radius: 10,
        targetId: null,
        piercing: false,
        aoeRadius: BOMB_AOE_RADIUS,
        fromGungine: false,
      });
    }

    if (!input.fire || p.fireCooldown > 0) return;

    const rad = (p.angleDeg * Math.PI) / 180;
    const muzzleX = p.x + Math.cos(rad) * 12;
    const muzzleY = p.y + Math.sin(rad) * 12;

    if (p.isUrauser) {
      this.fireUrauserVolley(muzzleX, muzzleY);
      return;
    }

    const weapon = p.weaponSpec;
    switch (weapon.id) {
      case 1: {
        // Laser: interval 1, continuous piercing 520px ray, 1 dmg/tick
        p.fireCooldown = weapon.interval || 1;
        const spec = this.getProjectileSpec('laser');
        const beamDmg = spec.dmg || 1;
        const endX = p.x + Math.cos(rad) * LASER_BEAM_LENGTH;
        const endY = p.y + Math.sin(rad) * LASER_BEAM_LENGTH;

        this.spawnProjectile({
          owner: 'player',
          kind: 'laser',
          x: muzzleX,
          y: muzzleY,
          vx: Math.cos(rad) * LASER_BEAM_LENGTH,
          vy: Math.sin(rad) * LASER_BEAM_LENGTH,
          angleDeg: p.angleDeg,
          ttl: 1,
          dmg: beamDmg,
          radius: 5,
          targetId: null,
          piercing: true,
          aoeRadius: 0,
          fromGungine: false,
          beamLength: LASER_BEAM_LENGTH,
        });

        for (const enemy of this.enemies) {
          if (!enemy.active) continue;
          if (isSegmentHittingEnemy(p.x, p.y, endX, endY, 5, enemy)) {
            this.damageEnemy(enemy, beamDmg, 'laser', false);
          }
        }
        if (Math.sin(rad) > 0 && endY >= this.data.room.sealevel && p.y < this.data.room.sealevel) {
          const hitX =
            p.x +
            ((this.data.room.sealevel - p.y) / Math.max(0.01, Math.sin(rad))) *
              Math.cos(rad);
          if (this.tick % 4 === 0) {
            this.spawnParticle('lasersplash', hitX, this.data.room.sealevel);
          }
        }
        this.emitAudio('sndlaser', p.x, p.y);
        break;
      }
      case 2: {
        // Spread: interval 9, 5 pellets across spread 6 deg step, recoil 1.5
        p.fireCooldown = weapon.interval || 9;
        const spec = this.getProjectileSpec('spreadbullet');
        const num = weapon.numbullets || 5;
        const step = weapon.spread || 6;
        const spd = spec.speed || 20;
        const dmg = spec.dmg || 2;
        const ttl = spec.ttl || 40;
        for (let i = 0; i < num; i++) {
          const offset = (i - (num - 1) / 2) * step;
          const a = p.angleDeg + offset;
          const ar = (a * Math.PI) / 180;
          this.spawnProjectile({
            owner: 'player',
            kind: 'spreadbullet',
            x: muzzleX,
            y: muzzleY,
            vx: Math.cos(ar) * spd,
            vy: Math.sin(ar) * spd,
            angleDeg: a,
            ttl,
            dmg,
            radius: 6,
            targetId: null,
            piercing: false,
            aoeRadius: 0,
            fromGungine: false,
          });
        }
        const recoil = weapon.recoil || 1.5;
        p.vx -= Math.cos(rad) * recoil;
        p.vy -= Math.sin(rad) * recoil;
        this.spawnParticle('spreadfireFlash', muzzleX, muzzleY);
        this.emitAudio('sndspread', p.x, p.y);
        break;
      }
      case 3: {
        // Missiles: interval 5, strict max 4 active
        p.fireCooldown = weapon.interval || 5;
        const cap = weapon.maxbullets || 4;
        const activeMissiles = this.projectiles.filter(
          (pr) => pr.owner === 'player' && pr.kind === 'missile',
        ).length;
        if (activeMissiles >= cap) {
          this.emitAudio('sndmisempty', p.x, p.y);
          break;
        }
        const spec = this.getProjectileSpec('missile');
        const spd = spec.speed || 4;
        const target = this.findNearestEnemy(p.x, p.y);
        this.spawnProjectile({
          owner: 'player',
          kind: 'missile',
          x: muzzleX,
          y: muzzleY,
          vx: Math.cos(rad) * spd,
          vy: Math.sin(rad) * spd,
          angleDeg: p.angleDeg,
          ttl: spec.ttl || 40,
          dmg: spec.dmg || 6,
          radius: 8,
          targetId: target ? target.id : null,
          piercing: false,
          aoeRadius: 0,
          fromGungine: false,
        });
        this.spawnParticle('missilefireFlash', muzzleX, muzzleY);
        this.emitAudio('sndmissile', p.x, p.y);
        break;
      }
      case 4: {
        // Cannon: interval 79, plasmaball dmg 20, speed 10, ttl 60, AOE 84
        p.fireCooldown = weapon.interval || 79;
        const spec = this.getProjectileSpec('plasmaball');
        const spd = spec.speed || 10;
        this.spawnProjectile({
          owner: 'player',
          kind: 'plasmaball',
          x: muzzleX,
          y: muzzleY,
          vx: Math.cos(rad) * spd,
          vy: Math.sin(rad) * spd,
          angleDeg: p.angleDeg,
          ttl: spec.ttl || 60,
          dmg: spec.dmg || 20,
          radius: 12,
          targetId: null,
          piercing: false,
          aoeRadius: PLASMA_AOE_RADIUS,
          fromGungine: false,
        });
        this.spawnParticle('plasmafireflash', muzzleX, muzzleY);
        this.emitAudio('sndcannon', p.x, p.y);
        break;
      }
      default: {
        // Original & Weapon 5 (non-Urauser fallback): bullet interval 3
        p.fireCooldown = weapon.interval || 3;
        const spec = this.getProjectileSpec(weapon.projectile || 'bullet');
        const jitter = spec.degreesoffset || 3;
        const a = p.angleDeg + this.rng.range(-jitter, jitter);
        const ar = (a * Math.PI) / 180;
        const spd = spec.speed || 24;
        this.spawnProjectile({
          owner: 'player',
          kind: 'bullet',
          x: muzzleX,
          y: muzzleY,
          vx: Math.cos(ar) * spd,
          vy: Math.sin(ar) * spd,
          angleDeg: a,
          ttl: spec.ttl || 60,
          dmg: spec.dmg || 4,
          radius: 6,
          targetId: null,
          piercing: false,
          aoeRadius: 0,
          fromGungine: false,
        });
        this.spawnParticle('fireFlash', muzzleX, muzzleY);
        this.emitAudio('sndbullet', p.x, p.y);
        break;
      }
    }
  }

  private fireUrauserVolley(muzzleX: number, muzzleY: number): void {
    const p = this.player;
    p.fireCooldown = 4;
    const rad = (p.angleDeg * Math.PI) / 180;

    // Heavy 5-pellet spread
    for (let i = 0; i < 5; i++) {
      const a = p.angleDeg + (i - 2) * 7;
      const ar = (a * Math.PI) / 180;
      this.spawnProjectile({
        owner: 'player',
        kind: 'spreadbullet',
        x: muzzleX,
        y: muzzleY,
        vx: Math.cos(ar) * 22,
        vy: Math.sin(ar) * 22,
        angleDeg: a,
        ttl: 45,
        dmg: 5,
        radius: 7,
        targetId: null,
        piercing: false,
        aoeRadius: 0,
        fromGungine: false,
      });
    }

    // Piercing heavy beam
    const beamLen = 560;
    const endX = p.x + Math.cos(rad) * beamLen;
    const endY = p.y + Math.sin(rad) * beamLen;
    this.spawnProjectile({
      owner: 'player',
      kind: 'laser',
      x: muzzleX,
      y: muzzleY,
      vx: Math.cos(rad) * beamLen,
      vy: Math.sin(rad) * beamLen,
      angleDeg: p.angleDeg,
      ttl: 1,
      dmg: 2,
      radius: 6,
      targetId: null,
      piercing: true,
      aoeRadius: 0,
      fromGungine: false,
      beamLength: beamLen,
    });
    for (const enemy of this.enemies) {
      if (!enemy.active) continue;
      if (isSegmentHittingEnemy(p.x, p.y, endX, endY, 6, enemy)) {
        this.damageEnemy(enemy, 2, 'laser', false);
      }
    }

    this.emitAudio('sndspread', p.x, p.y);
    this.emitAudio('sndlaser', p.x, p.y);
  }

  private updateComboTimer(): void {
    if (this.comboTimer > 0) {
      this.comboTimer--;
      if (this.comboTimer > 0 && this.comboTimer < COMBO_WARNING_THRESHOLD && this.combo > 1) {
        if (!this.comboWarning) {
          this.emitAudio('sndcombowarn');
        }
        this.comboWarning = true;
      } else if (this.comboTimer === 0) {
        this.comboWarning = false;
        this.comboKillStreak = 0;
        if (this.combo > 1) {
          this.combo = 1;
          this.emitAudio('sndcombodrop');
        }
      }
    }
  }

  private updateSpawnDirector(): void {
    const coord = this.getSpawnCoordinator();

    // Difficulty increments every 60 ticks (1s)
    this.difficultyTimer++;
    if (this.difficultyTimer >= 60) {
      this.difficultyTimer = 0;
      for (const step of coord.increaseDifficulty) {
        if (this.difficulty < step.max) {
          this.difficulty += step.add;
        }
      }
    }

    if (this.spawnTimer > 0) {
      this.spawnTimer--;
      return;
    }

    const totalWeight = this.enemies.reduce(
      (sum, e) => sum + (e.active ? e.difficultyWeight : 0),
      0,
    );
    if (totalWeight >= this.difficulty || this.enemies.length >= 28) {
      this.spawnTimer = 15;
      return;
    }

    let chosenTier = coord.spawnlist[0];
    for (const tier of coord.spawnlist) {
      if (this.difficulty >= tier.difficulty) {
        chosenTier = tier;
      }
    }
    if (!chosenTier || chosenTier.choose.length === 0) {
      this.spawnTimer = 30;
      return;
    }

    let kind = this.rng.pick(chosenTier.choose);

    const boatCount = this.enemies.filter((e) => e.active && isBoatLike(e.kind)).length;
    if (
      isBoatLike(kind) &&
      this.enemies.length > 0 &&
      boatCount / this.enemies.length >= coord.maxPercentageBoats
    ) {
      kind = 'Fighter';
    }

    const aceCount = this.enemies.filter(
      (e) => e.active && (e.kind === 'Ace' || e.kind === 'LaserAce'),
    ).length;
    if (kind === 'Ace') {
      if (aceCount >= this.difficulty * coord.maxNumAcePerDifficultyPerc) {
        kind = 'Fighter';
      } else if (this.rng.chance(coord.aceToLaserAceChance)) {
        kind = 'LaserAce';
      }
    }

    const blimpCount = this.enemies.filter((e) => e.active && e.kind === 'Blimp').length;
    if (kind === 'Blimp') {
      if (blimpCount >= this.difficulty * coord.maxNumBlimpsPerDifficultyPerc) {
        kind = 'Fighter';
      }
    }

    if (kind === 'Submarine') {
      const subKills = this.killsByKind['Submarine'] ?? 0;
      if (
        subKills >= coord.minNumSubmarineKillsForAceMarine &&
        this.rng.chance(coord.submarineToAceMarineChance)
      ) {
        kind = 'AceMarine';
      }
    }

    this.spawnEnemy(kind);
    this.spawnTimer = Math.max(14, Math.round(38 - Math.min(20, this.difficulty / 45)));
  }

  private updateParallax(): void {
    const seaLevel = this.data.room.sealevel;
    for (const item of this.parallax) {
      item.x += item.vx;
      item.frame = (item.frame + 1) % 60;
    }
    this.parallax = this.parallax.filter(
      (item) => Math.abs(item.x - this.player.x) <= 1200,
    );

    if (this.parallaxTimer > 0) {
      this.parallaxTimer--;
      return;
    }

    const baseInterval = Math.max(
      90,
      this.data.parallax.timer0 -
        Math.floor(this.difficulty / 100) * this.data.parallax.timer0subtrmult,
    );
    this.parallaxTimer = baseInterval;

    if (this.parallax.length >= 12) return;

    const eligibleStages = this.data.parallax.stages.filter(
      (s) => this.difficulty >= s.minimumDifficulty && s.spawn.length > 0,
    );
    if (eligibleStages.length === 0) return;

    const stage = this.rng.pick(eligibleStages);
    const rawSpawn = this.rng.pick(stage.spawn);
    const reversed = rawSpawn.endsWith('r');
    const baseKind = reversed ? rawSpawn.slice(0, -1) : rawSpawn;
    const side = reversed ? 1 : -1;
    const x = this.player.x + side * this.rng.range(460, 720);

    let spriteName = 'bg_boat';
    let y = seaLevel;
    let vx = reversed ? -0.4 : 0.4;
    let depth = 8;

    if (baseKind === 'bgJet') {
      spriteName = 'bg_jet';
      y = this.rng.range(-720, -160);
      vx = reversed ? -2.6 : 2.6;
      depth = 10;
    } else if (baseKind === 'bgSub') {
      spriteName = 'bg_sub';
      y = seaLevel;
      vx = reversed ? -0.3 : 0.3;
      depth = 9;
    } else if (baseKind === 'bgBlimp') {
      spriteName = 'bg_blimp';
      y = this.rng.range(-920, -340);
      vx = reversed ? -0.25 : 0.25;
      depth = 12;
    }

    this.parallax.push({
      id: this.nextEntityId++,
      kind: baseKind,
      spriteName,
      x,
      y,
      vx,
      reversed,
      depth,
      frame: 0,
    });
  }

  private updateEnemies(): void {
    const specMap = this.getEnemyMap();
    const seaLevel = this.data.room.sealevel;
    const spaceLevel = this.data.room.spacelevel;

    for (const enemy of this.enemies) {
      if (!enemy.active) continue;
      enemy.prevX = enemy.x;
      enemy.prevY = enemy.y;
      if (enemy.flashTicks > 0) enemy.flashTicks--;

      const spec = getEnemySpec(specMap, enemy.kind);
      const dx = this.player.x - enemy.x;
      const dy = this.player.y - enemy.y;
      const dist = Math.hypot(dx, dy);
      const angleToPlayer = (Math.atan2(dy, dx) * 180) / Math.PI;

      switch (enemy.kind) {
        case 'Fighter': {
          const turnRate =
            (spec.reaction || 0.3) * 8 + (spec.turnvariance || 3);
          const diff = shortestAngleDiffDeg(enemy.angleDeg, angleToPlayer);
          enemy.angleDeg += clamp(diff, -turnRate, turnRate);

          // Sea and space avoidance
          if (enemy.y > seaLevel - (spec.reactionseaheighta || 100)) {
            const upDiff = shortestAngleDiffDeg(enemy.angleDeg, -90);
            enemy.angleDeg += clamp(upDiff, -turnRate * 1.4, turnRate * 1.4);
          } else if (enemy.y < spaceLevel + (spec.reactionspaceheightoffseta || 100)) {
            const dnDiff = shortestAngleDiffDeg(enemy.angleDeg, 90);
            enemy.angleDeg += clamp(dnDiff, -turnRate * 1.4, turnRate * 1.4);
          }

          const targetSpd =
            dist > (spec.boostdstplayer || 320)
              ? (spec.maxspeed || 6) + (spec.boostdstspeed || 3)
              : spec.maxspeed || 6;
          const r = (enemy.angleDeg * Math.PI) / 180;
          enemy.vx += Math.cos(r) * (spec.constantforce || 0.6);
          enemy.vy += Math.sin(r) * (spec.constantforce || 0.6) + (spec.gravity || 0.05);
          const spd = Math.hypot(enemy.vx, enemy.vy);
          if (spd > targetSpd) {
            enemy.vx = (enemy.vx / spd) * targetSpd;
            enemy.vy = (enemy.vy / spd) * targetSpd;
          }

          if (this.phase === 'playing' && this.player.alive) {
            if (enemy.fireTimer > 0) {
              enemy.fireTimer--;
            } else if (dist > (spec.minfiredist || 40) && dist < 640) {
              enemy.fireTimer =
                (spec.fireinterval || 20) +
                this.rng.range(0, spec.fireintervalrand || 90);
              this.spawnEnemyBullet(
                enemy.x,
                enemy.y,
                angleToPlayer,
                spec.bulletspeed || 14,
              );
            }
          }
          break;
        }
        case 'Jet': {
          const flyDir = enemy.vx >= 0 ? 1 : -1;
          const targetSpd = spec.speed || 20;
          enemy.vx += flyDir * 0.5;
          if (Math.abs(enemy.vx) > targetSpd) {
            enemy.vx = flyDir * targetSpd;
          }
          enemy.vy += clamp(
            Math.sign(dy) * (spec.constantplayerchaseforce || 0.4),
            -(spec.maxvspeed || 6),
            spec.maxvspeed || 6,
          );
          enemy.vy *= 1 - (spec.vspeedthrottler || 0.1);
          if (enemy.y > seaLevel - (spec.reactionseaheighta || 60)) {
            enemy.vy -= spec.environmentalyforce || 1.0;
          } else if (enemy.y < spaceLevel + (spec.reactionspaceheightoffseta || 60)) {
            enemy.vy += spec.environmentalyforce || 1.0;
          }
          enemy.angleDeg = (Math.atan2(enemy.vy, enemy.vx) * 180) / Math.PI;

          // Turn around past turndistance
          const passed = flyDir > 0 ? enemy.x - this.player.x : this.player.x - enemy.x;
          if (passed > (spec.turndistance || 600)) {
            enemy.vx = -flyDir * (spec.initvelocity || 8);
          }

          if (this.tick % 2 === 0) {
            this.spawnParticle('jet_trail', enemy.x, enemy.y);
          }

          // SFMT Jet fires when fireinterval < 1e6; Normal Jet has 999999999999
          if (
            this.phase === 'playing' &&
            this.player.alive &&
            spec.fireinterval < 1_000_000
          ) {
            if (enemy.fireTimer > 0) {
              enemy.fireTimer--;
            } else if (dist < 820) {
              enemy.fireTimer = Math.max(1, spec.fireinterval);
              this.spawnEnemyBullet(
                enemy.x,
                enemy.y,
                angleToPlayer,
                Math.max(5, spec.bulletspeed || 5),
              );
            }
          }
          break;
        }
        case 'Ace':
        case 'LaserAce': {
          const turnRate = enemy.kind === 'LaserAce' ? 4.2 : 5.5;
          const diff = shortestAngleDiffDeg(enemy.angleDeg, angleToPlayer);
          enemy.angleDeg += clamp(diff, -turnRate, turnRate);
          if (enemy.y > seaLevel - 110) {
            enemy.angleDeg += clamp(
              shortestAngleDiffDeg(enemy.angleDeg, -90),
              -turnRate * 1.5,
              turnRate * 1.5,
            );
          } else if (enemy.y < spaceLevel + 110) {
            enemy.angleDeg += clamp(
              shortestAngleDiffDeg(enemy.angleDeg, 90),
              -turnRate * 1.5,
              turnRate * 1.5,
            );
          }

          const maxSpd =
            dist > (spec.boostdstplayer || 300)
              ? (spec.maxspeed || 4) + (spec.boostdstspeed || 5)
              : spec.maxspeed || 4 + 3;
          const r = (enemy.angleDeg * Math.PI) / 180;
          enemy.vx += Math.cos(r) * 0.7;
          enemy.vy += Math.sin(r) * 0.7 + (spec.gravity || 0.4) * 0.4;
          const spd = Math.hypot(enemy.vx, enemy.vy);
          if (spd > maxSpd) {
            enemy.vx = (enemy.vx / spd) * maxSpd;
            enemy.vy = (enemy.vy / spd) * maxSpd;
          }

          if (this.phase === 'playing' && this.player.alive) {
            if (enemy.kind === 'LaserAce') {
              if (enemy.salvoRemaining > 0) {
                enemy.laserActive = true;
                enemy.laserLength = 420;
                const gDiff = shortestAngleDiffDeg(enemy.gunAngleDeg, angleToPlayer);
                enemy.gunAngleDeg += clamp(gDiff, -1.8, 1.8);
                enemy.salvoRemaining--;

                const lr = (enemy.gunAngleDeg * Math.PI) / 180;
                const lx2 = enemy.x + Math.cos(lr) * enemy.laserLength;
                const ly2 = enemy.y + Math.sin(lr) * enemy.laserLength;
                if (
                  enemy.salvoRemaining % 4 === 0 &&
                  this.player.flashTicks <= 0 &&
                  distPointToSegmentSq(
                    this.player.x,
                    this.player.y,
                    enemy.x,
                    enemy.y,
                    lx2,
                    ly2,
                  ) <= 144
                ) {
                  this.applyDamageToPlayer(1.5, true);
                }
              } else {
                enemy.laserActive = false;
                if (enemy.fireTimer > 0) {
                  enemy.fireTimer--;
                } else if (dist < 600) {
                  enemy.gunAngleDeg = angleToPlayer;
                  enemy.salvoRemaining = spec.bulletspersalvo || 60;
                  enemy.fireTimer = 110;
                  this.emitAudio('sndlaser', enemy.x, enemy.y);
                }
              }
            } else {
              if (enemy.salvoRemaining > 0) {
                if (enemy.salvoCooldown <= 0) {
                  enemy.salvoCooldown = spec.bulletfireinterval || 3;
                  enemy.salvoRemaining--;
                  this.spawnEnemyBullet(
                    enemy.x,
                    enemy.y,
                    angleToPlayer + this.rng.range(-4, 4),
                    spec.bulletspeed || 20,
                  );
                } else {
                  enemy.salvoCooldown--;
                }
              } else if (enemy.fireTimer > 0) {
                enemy.fireTimer--;
              } else if (dist < 620) {
                enemy.salvoRemaining = spec.bulletspersalvo || 12;
                enemy.salvoCooldown = 0;
                enemy.fireTimer = 85;
              }
            }
          } else {
            enemy.laserActive = false;
          }
          break;
        }
        case 'Boat':
        case 'BigBoat': {
          enemy.y = seaLevel;
          enemy.vy = 0;
          if (this.tick % 6 === 0) {
            this.spawnParticle(
              enemy.kind === 'BigBoat' ? 'bigboattrail' : 'boattrail',
              enemy.x,
              seaLevel,
            );
          }

          if (this.phase === 'playing' && this.player.alive) {
            const desiredGun = clamp(angleToPlayer, -175, -5);
            const gDiff = shortestAngleDiffDeg(enemy.gunAngleDeg, desiredGun);
            const rotSpd = spec.gunrotationspeed || 2;
            enemy.gunAngleDeg += clamp(gDiff, -rotSpd, rotSpd);

            if (enemy.salvoRemaining > 0) {
              if (enemy.fireTimer <= 0) {
                enemy.fireTimer = spec.bulletfireinterval || 10;
                enemy.salvoRemaining--;
                this.spawnEnemyBullet(
                  enemy.x,
                  enemy.y - 8,
                  enemy.gunAngleDeg + this.rng.range(-3, 3),
                  spec.bulletspeed || 10,
                );
              } else {
                enemy.fireTimer--;
              }
            } else if (enemy.salvoCooldown > 0) {
              enemy.salvoCooldown--;
            } else if (dist < 720) {
              const numBoats = this.enemies.filter(
                (b) => b.active && (b.kind === 'Boat' || b.kind === 'BigBoat'),
              ).length;
              enemy.salvoRemaining = spec.bulletspersalvo || 3;
              enemy.fireTimer = 0;
              enemy.salvoCooldown =
                (spec.firesalvotimer || 90) +
                this.rng.range(0, spec.firesalvotimerrand || 120) +
                numBoats * (spec.salvofirelimiterperboatmultiplier || 4);
            }
          }
          break;
        }
        case 'Submarine':
        case 'AceMarine': {
          if (enemy.state === 'surfacing') {
            enemy.y += enemy.vy || -0.5;
            if (enemy.y <= seaLevel) {
              enemy.y = seaLevel;
              enemy.vy = 0;
              enemy.state = 'firing';
              this.spawnParticle('splashSub', enemy.x, seaLevel);
            }
          } else if (enemy.state === 'firing') {
            enemy.y = seaLevel;
            if (this.phase === 'playing' && this.player.alive) {
              if (enemy.kind === 'AceMarine') {
                if (enemy.fireTimer > 0) {
                  enemy.fireTimer--;
                } else {
                  const aceCount = this.enemies.filter(
                    (e) => e.active && e.kind === 'Ace',
                  ).length;
                  if (aceCount < 3) {
                    this.spawnEnemy('Ace', enemy.x, seaLevel - 16);
                  }
                  enemy.fireTimer = spec.acelaunchinterval || 40;
                }
              }

              if (enemy.salvoCooldown > 0) {
                enemy.salvoCooldown--;
              } else {
                const activeEnemyMissiles = this.enemies.filter(
                  (e) => e.active && e.kind === 'Missile',
                ).length;
                if (activeEnemyMissiles < 8) {
                  this.spawnEnemy('Missile', enemy.x, seaLevel - 6);
                }
                enemy.salvoCooldown = spec.projectilefireinterval || 45;
              }
            }

            enemy.surfaceTimer--;
            if (enemy.surfaceTimer <= 0) {
              enemy.state = 'submerging';
              enemy.vy = spec.sinkingspeed || 0.5;
            }
          } else if (enemy.state === 'submerging') {
            enemy.y += Math.max(0.4, enemy.vy);
            if (enemy.y > seaLevel + 140) {
              enemy.active = false;
            }
          }
          break;
        }
        case 'Missile': {
          if (enemy.lifetime > 0) {
            enemy.lifetime--;
            if (enemy.lifetime <= 0) {
              enemy.active = false;
              this.spawnParticle('smoke', enemy.x, enemy.y);
              break;
            }
          }

          if (enemy.activationTimer > 0) {
            enemy.activationTimer--;
            enemy.vy += spec.gravity || 0.1;
          } else {
            const diff = shortestAngleDiffDeg(enemy.angleDeg, angleToPlayer);
            enemy.angleDeg += clamp(diff, -4.5, 4.5);
            const r = (enemy.angleDeg * Math.PI) / 180;
            const mSpd = 7.5;
            enemy.vx = Math.cos(r) * mSpd;
            enemy.vy = Math.sin(r) * mSpd;
            if (this.tick % 2 === 0) {
              this.spawnParticle('missiletrail', enemy.x, enemy.y);
            }
          }
          break;
        }
        case 'Blimp': {
          if (enemy.fallFrames > 0) {
            enemy.fallFrames--;
            enemy.vy = spec.spawnfallspeed || 1;
            if (enemy.fallFrames === 0) {
              enemy.state = 'cruise';
              enemy.vy = 0;
            }
          } else {
            enemy.vy = 0;
          }

          if (this.phase === 'playing' && this.player.alive) {
            const gDiff = shortestAngleDiffDeg(enemy.gunAngleDeg, angleToPlayer);
            const rotSpd = spec.gunrotationspeed || 1;
            enemy.gunAngleDeg += clamp(gDiff, -rotSpd, rotSpd);

            if (enemy.salvoRemaining > 0) {
              if (enemy.fireTimer <= 0) {
                enemy.fireTimer = spec.bulletfireinterval || 1;
                enemy.salvoRemaining--;
                this.spawnEnemyBullet(
                  enemy.x,
                  enemy.y + 24,
                  enemy.gunAngleDeg + this.rng.range(-12, 12),
                  spec.bulletspeed || 10,
                );
              } else {
                enemy.fireTimer--;
              }
            } else if (enemy.salvoCooldown > 0) {
              enemy.salvoCooldown--;
            } else if (dist < 900) {
              enemy.salvoRemaining = spec.bulletspersalvo || 32;
              enemy.fireTimer = 0;
              enemy.salvoCooldown =
                (spec.firesalvotimer || 50) +
                this.rng.range(0, spec.firesalvotimerrand || 30);
            }
          }
          break;
        }
      }

      enemy.x += enemy.vx;
      enemy.y += enemy.vy;

      const maxDespawnDist = enemy.kind === 'Blimp' ? 2400 : 1600;
      if (Math.abs(enemy.x - this.player.x) > maxDespawnDist) {
        enemy.active = false;
      }
    }
  }

  private spawnEnemyBullet(
    x: number,
    y: number,
    angleDeg: number,
    speed: number,
  ): void {
    const spec = this.getProjectileSpec('ebullet');
    const r = (angleDeg * Math.PI) / 180;
    this.spawnProjectile({
      owner: 'enemy',
      kind: 'ebullet',
      x,
      y,
      vx: Math.cos(r) * speed,
      vy: Math.sin(r) * speed,
      angleDeg,
      ttl: spec.ttl || 180,
      dmg: spec.dmg || 6,
      radius: 5,
      targetId: null,
      piercing: false,
      aoeRadius: 0,
      fromGungine: false,
    });
    this.emitAudio(
      this.rng.chance(0.5) ? 'sndebullet' : 'sndebullet2',
      x,
      y,
    );
  }

  private updateProjectiles(): void {
    const seaLevel = this.data.room.sealevel;
    const nextList: ProjectileEntity[] = [];

    for (const proj of this.projectiles) {
      proj.prevX = proj.x;
      proj.prevY = proj.y;
      proj.ttl--;

      if (proj.kind === 'laser' || proj.kind === 'elaser') {
        if (proj.ttl > 0) {
          nextList.push(proj);
        }
        continue;
      }

      if (proj.kind === 'missile' && proj.owner === 'player') {
        let target = this.enemies.find(
          (e) => e.active && e.id === proj.targetId,
        );
        if (!target) {
          target = this.findNearestEnemy(proj.x, proj.y) ?? undefined;
          proj.targetId = target ? target.id : null;
        }
        const curSpd = Math.hypot(proj.vx, proj.vy);
        const nextSpd = Math.min(14, curSpd + 0.55);
        if (target) {
          const desired =
            (Math.atan2(target.y - proj.y, target.x - proj.x) * 180) / Math.PI;
          const diff = shortestAngleDiffDeg(proj.angleDeg, desired);
          proj.angleDeg += clamp(diff, -9, 9);
        }
        const r = (proj.angleDeg * Math.PI) / 180;
        proj.vx = Math.cos(r) * nextSpd;
        proj.vy = Math.sin(r) * nextSpd;
        if (this.tick % 2 === 0) {
          this.spawnParticle('missiletrail', proj.x, proj.y);
        }
      } else if (proj.kind === 'bomb') {
        proj.vy += 0.25;
        proj.angleDeg = (Math.atan2(proj.vy, proj.vx) * 180) / Math.PI;
      }

      proj.x += proj.vx;
      proj.y += proj.vy;

      let consumed = false;

      if (proj.owner === 'player') {
        for (const enemy of this.enemies) {
          if (!enemy.active) continue;
          if (
            isSegmentHittingEnemy(
              proj.prevX,
              proj.prevY,
              proj.x,
              proj.y,
              proj.radius,
              enemy,
            )
          ) {
            if (proj.aoeRadius > 0) {
              this.detonatePlayerAoe(proj);
            } else {
              const source: KillSource = proj.fromGungine
                ? 'gungine'
                : proj.kind === 'spreadbullet'
                  ? 'spread'
                  : proj.kind === 'missile'
                    ? 'missile'
                    : 'bullet';
              this.damageEnemy(enemy, proj.dmg, source, false);
              this.spawnParticle('bullet_hit', proj.x, proj.y);
            }
            consumed = true;
            break;
          }
        }

        // Bomb or plasmaball detonation on expiry / bomb water hit
        if (!consumed) {
          const bombWaterHit = proj.kind === 'bomb' && proj.y >= seaLevel;
          if (proj.aoeRadius > 0 && (proj.ttl <= 0 || bombWaterHit)) {
            this.detonatePlayerAoe(proj);
            if (bombWaterHit) {
              this.spawnParticle('splashM', proj.x, seaLevel);
            }
            consumed = true;
          }
        }
      } else if (this.phase === 'playing' && this.player.alive) {
        if (
          this.player.flashTicks <= 0 &&
          distPointToSegmentSq(
            this.player.x,
            this.player.y,
            proj.prevX,
            proj.prevY,
            proj.x,
            proj.y,
          ) <=
            (8 + proj.radius) * (8 + proj.radius)
        ) {
          this.applyDamageToPlayer(proj.dmg, true);
          this.spawnParticle('ebullet_fade', proj.x, proj.y);
          consumed = true;
        }
      }

      if (!consumed && proj.ttl > 0) {
        nextList.push(proj);
      }
    }

    this.projectiles = nextList;
  }

  private detonatePlayerAoe(proj: ProjectileEntity): void {
    const source: KillSource = proj.kind === 'bomb' ? 'bomb' : 'cannon';
    let hits = 0;
    for (const enemy of this.enemies) {
      if (!enemy.active) continue;
      if (isAoeHittingEnemy(proj.x, proj.y, proj.aoeRadius, enemy)) {
        hits++;
      }
    }
    const multiKill = hits > 1;
    for (const enemy of this.enemies) {
      if (!enemy.active) continue;
      if (isAoeHittingEnemy(proj.x, proj.y, proj.aoeRadius, enemy)) {
        this.damageEnemy(enemy, proj.dmg, source, multiKill);
      }
    }

    if (proj.kind === 'plasmaball') {
      this.emitAudio('sndcannonexplo', proj.x, proj.y);
      this.spawnParticle('plasma_hit', proj.x, proj.y);
      this.screenShake = Math.max(this.screenShake, 4);
    } else {
      this.emitAudio('sndexplom', proj.x, proj.y);
      this.spawnParticle('explode_small', proj.x, proj.y);
      this.screenShake = Math.max(this.screenShake, 2.5);
    }
  }

  private checkPlayerEnemyCollisions(): void {
    const p = this.player;
    const body = p.bodySpec;
    const speed = Math.hypot(p.vx, p.vy);
    const isMeleeBody = body.id === 2 || body.impactrecvdmgmult === 0;

    for (const enemy of this.enemies) {
      if (!enemy.active) continue;
      if (!isPointInEnemyHitbox(p.x, p.y, 10, enemy)) continue;

      if (enemy.kind === 'Missile') {
        const spec = getEnemySpec(this.getEnemyMap(), 'Missile');
        enemy.active = false;
        this.spawnParticle('explode_small', enemy.x, enemy.y);
        if (!isMeleeBody) {
          this.applyDamageToPlayer(
            Math.max(1, (spec.damageonhit || 4) * body.impactrecvdmgmult * 4),
            true,
          );
          this.hitstopTicks = Math.max(this.hitstopTicks, body.impactsleeptime);
          this.screenShake = Math.max(this.screenShake, body.impactcamshake);
        }
        continue;
      }

      if (isMeleeBody) {
        if ((this.enemyRamGrace.get(enemy.id) ?? 0) > 0) continue;
        this.enemyRamGrace.set(enemy.id, 8);
        const ramDamage = Math.max(24, Math.round(speed * 5) + 16);
        this.damageEnemy(enemy, ramDamage, 'melee', false);
      } else {
        if (p.flashTicks > 0) continue;
        const selfDmg = Math.max(1, 16 * body.impactrecvdmgmult);
        this.applyDamageToPlayer(selfDmg, true);
        p.flashTicks = Math.max(p.flashTicks, 12);
        this.hitstopTicks = Math.max(this.hitstopTicks, body.impactsleeptime);
        this.screenShake = Math.max(this.screenShake, body.impactcamshake);
        p.vx *= body.impactspeedmult || 0.9;
        p.vy *= body.impactspeedmult || 0.9;

        const critBonus =
          speed >= (body.impactdealcritical || 10)
            ? 1 + (body.impactdealcriticaldmg || 0.5)
            : 1;
        const dealDmg =
          Math.max(10, speed * 3) *
          (1 + (body.impactdealdmgmult || 0.25)) *
          critBonus;
        this.damageEnemy(enemy, dealDmg, 'melee', false);
      }
    }
  }

  private damageEnemy(
    enemy: EnemyEntity,
    amount: number,
    source: KillSource,
    aoeOrMultiKill: boolean,
  ): void {
    if (!enemy.active || amount <= 0) return;
    enemy.health -= amount;
    enemy.flashTicks = 4;

    if (enemy.health <= 0) {
      this.killEnemy(enemy, source, aoeOrMultiKill);
    } else if (source !== 'laser' || this.tick % 4 === 0) {
      const hitSfx: readonly AudioCueId[] = [
        'sndhit1',
        'sndhit2',
        'sndhit3',
        'sndhit4',
      ];
      const cue = hitSfx[this.hitSoundIndex % hitSfx.length]!;
      this.hitSoundIndex++;
      this.emitAudio(cue, enemy.x, enemy.y);
    }
  }

  private killEnemy(
    enemy: EnemyEntity,
    source: KillSource,
    aoeOrMultiKill: boolean,
  ): void {
    if (!enemy.active) return;
    enemy.active = false;
    enemy.laserActive = false;

    this.killsThisSortie++;
    this.killsByKind[enemy.kind] = (this.killsByKind[enemy.kind] ?? 0) + 1;
    this.profile.totalKills[enemy.kind] =
      (this.profile.totalKills[enemy.kind] ?? 0) + 1;
    this.distinctKindsThisSortie.add(enemy.kind);

    const prevCombo = this.combo;
    this.combo = Math.min(COMBO_MAX, this.combo + 1);
    this.comboTimer = COMBO_MAX_TIMER;
    this.comboWarning = false;
    this.comboKillStreak++;
    this.bestComboThisSortie = Math.max(this.bestComboThisSortie, this.combo);

    this.score += enemy.scoreValue * this.combo;

    if (prevCombo < COMBO_MAX && this.combo === COMBO_MAX) {
      this.emitAudio('sndmaxcombo');
    }
    const addCue: AudioCueId =
      this.combo < 7 ? 'sndadd1' : this.combo < 14 ? 'sndadd2' : 'sndadd3';
    this.emitAudio(addCue, enemy.x, enemy.y);

    if (enemy.kind === 'Blimp') {
      this.emitAudio('sndboatdie', enemy.x, enemy.y);
      this.emitAudio('sndexplom', enemy.x, enemy.y);
      this.spawnParticle('explode_big', enemy.x, enemy.y);
      this.hitstopTicks = Math.max(this.hitstopTicks, 4);
      this.screenShake = Math.max(this.screenShake, 8);
      this.profile.sfmtUnlocked = true;
    } else if (isBoatLike(enemy.kind)) {
      this.emitAudio('sndboatdie', enemy.x, enemy.y);
      this.spawnParticle(
        enemy.kind === 'BigBoat' || enemy.kind === 'AceMarine'
          ? 'explode_big'
          : 'explode_medium',
        enemy.x,
        enemy.y,
      );
      if (enemy.kind !== 'Boat') {
        this.hitstopTicks = Math.max(this.hitstopTicks, 2);
      }
      this.screenShake = Math.max(this.screenShake, 4);
    } else if (enemy.kind === 'Jet') {
      this.emitAudio('sndjetdie', enemy.x, enemy.y);
      this.spawnParticle('explode_small', enemy.x, enemy.y);
      this.screenShake = Math.max(this.screenShake, 2);
    } else if (enemy.kind === 'Missile') {
      this.emitAudio('sndexplom', enemy.x, enemy.y);
      this.spawnParticle('explode_small', enemy.x, enemy.y);
    } else {
      this.emitAudio('sndplanedie', enemy.x, enemy.y);
      const isAce = enemy.kind === 'Ace' || enemy.kind === 'LaserAce';
      this.spawnParticle(isAce ? 'explode_medium' : 'explode_small', enemy.x, enemy.y);
      if (isAce) {
        this.hitstopTicks = Math.max(this.hitstopTicks, 2);
        this.screenShake = Math.max(this.screenShake, 4);
      }
    }

    const p = this.player;
    const completed = this.missionTracker.onKill(
      {
        enemyKind: enemy.kind,
        killSource: source,
        combo: this.combo,
        comboKillStreak: this.comboKillStreak,
        underwater: p.underwater,
        boosting: p.boosting,
        firing: p.firing,
        healthRatio: p.maxHealth > 0 ? p.health / p.maxHealth : 1,
        stalling: !p.boosting && p.vy > 0,
        mode: this.mode,
        continuousFireTicks: this.continuousFireTicks,
        aoeOrMultiKill,
        lastPlayerHitTick: this.lastPlayerHitTick,
        currentTick: this.tick,
        distinctKindsThisSortie: this.distinctKindsThisSortie,
      },
      p.loadout,
      this.profile,
    );
    if (completed.length > 0) {
      this.emitAudio('sndpopup');
    }
  }

  private applyDamageToPlayer(amount: number, emitHitCue: boolean): void {
    const p = this.player;
    if (!p.alive || amount <= 0) return;

    p.health = Math.max(0, p.health - amount);
    if (emitHitCue) {
      p.flashTicks = Math.max(p.flashTicks, 6);
      this.lastPlayerHitTick = this.tick;
      this.screenShake = Math.max(this.screenShake, 3);
      this.emitAudio('sndplayerhit', p.x, p.y);
      this.spawnParticle('player_hit', p.x, p.y);
    }

    if (p.health <= 0) {
      this.killPlayer();
    }
  }

  private killPlayer(): void {
    const p = this.player;
    if (!p.alive) return;
    p.alive = false;
    p.healing = false;
    p.boosting = false;
    p.firing = false;
    this.phase = 'dying';
    this.deathTicks = DEATH_TICKS_DURATION;

    this.emitAudio('sndplayerdie', p.x, p.y);
    this.spawnParticle('explode_big', p.x, p.y);
    this.screenShake = Math.max(this.screenShake, 8);

    if (p.bodySpec.flags.includes('nuke-on-death') || p.isUrauser) {
      p.nukeTriggered = true;
      p.nukeTicks = 60;
      p.nukeRadius = 120;
      this.nukeFlashTicks = 30;
      this.screenShake = Math.max(this.screenShake, 12);
      this.emitAudio('sndnuke', p.x, p.y);
      this.applyNukeBlastDamage();
    }

    this.finalizeSortieStats();
  }

  private updateDyingSequence(): void {
    const p = this.player;
    if (p.nukeTriggered && p.nukeTicks > 0) {
      p.nukeTicks--;
      p.nukeRadius = Math.min(NUKE_MAX_RADIUS, p.nukeRadius + 20);
      this.applyNukeBlastDamage();
    }

    this.deathTicks--;
    if (this.deathTicks <= 0) {
      this.phase = 'gameover';
      this.finalizeSortieStats();
    }
  }

  private applyNukeBlastDamage(): void {
    const p = this.player;
    for (const enemy of this.enemies) {
      if (!enemy.active) continue;
      if (isAoeHittingEnemy(p.x, p.y, p.nukeRadius, enemy)) {
        this.damageEnemy(enemy, 9999, 'nuke', true);
      }
    }
    this.updateHighScores();
  }

  private updateHighScores(): void {
    if (this.mode === 'sfmt') {
      if (this.score > this.profile.highScoreSfmt) {
        this.profile.highScoreSfmt = this.score;
      }
    } else if (this.score > this.profile.highScoreNormal) {
      this.profile.highScoreNormal = this.score;
    }
    if (this.bestComboThisSortie > this.profile.stats.bestCombo) {
      this.profile.stats.bestCombo = this.bestComboThisSortie;
    }
  }

  private finalizeSortieStats(): void {
    this.updateHighScores();
    if (!this.sortieFinalized) {
      this.sortieFinalized = true;
      this.profile.stats.sorties++;
      this.profile.stats.totalScore += this.score;
    }
  }

  private updateParticles(): void {
    const seaLevel = this.data.room.sealevel;
    const next: ParticleEntity[] = [];

    for (const pt of this.particles) {
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.vy += pt.gravity;
      if (pt.friction > 0) {
        pt.vx *= 1 - pt.friction;
        pt.vy *= 1 - pt.friction;
      }
      pt.frame += pt.frameSpeed;
      pt.ttl--;

      if (!pt.allowBelowSea && pt.y > seaLevel) {
        continue;
      }
      if (pt.ttl > 0 && (pt.loop || pt.frame < pt.frameCount)) {
        next.push(pt);
      }
    }
    this.particles = next;
  }

  private spawnProjectile(
    init: Omit<ProjectileEntity, 'id' | 'prevX' | 'prevY' | 'maxTtl'>,
  ): void {
    this.projectiles.push({
      ...init,
      id: this.nextEntityId++,
      prevX: init.x,
      prevY: init.y,
      maxTtl: init.ttl,
    });
  }

  private spawnParticle(kind: string, x: number, y: number): void {
    if (this.particles.length >= 160) return;

    const genericSpec = this.data.fx.generic[kind];
    const expSpec = this.data.fx.explosions[kind];
    if (genericSpec) {
      const ttl =
        (genericSpec.ttl || 16) +
        (genericSpec.ttlrand ? this.rng.range(0, genericSpec.ttlrand) : 0);
      const speed =
        (genericSpec.initvelocity || 0) +
        (genericSpec.initvelocityrand
          ? this.rng.range(0, genericSpec.initvelocityrand)
          : 0);
      const angle = genericSpec.imageanglerand
        ? this.rng.range(0, genericSpec.imageanglerand)
        : 0;
      const r = (angle * Math.PI) / 180;
      this.particles.push({
        id: this.nextEntityId++,
        kind,
        spriteName: genericSpec.spritename,
        x,
        y,
        vx: Math.cos(r) * speed,
        vy:
          Math.sin(r) * speed +
          (genericSpec.vspeed || 0) +
          (genericSpec.vspeedrand
            ? this.rng.range(-genericSpec.vspeedrand, genericSpec.vspeedrand)
            : 0),
        angleDeg: angle,
        scaleX: 1,
        scaleY: genericSpec.scaley || 1,
        frame: 0,
        frameSpeed:
          (genericSpec.imagespeed || 0.4) +
          (genericSpec.imagespeedrand
            ? this.rng.range(0, genericSpec.imagespeedrand)
            : 0),
        frameCount: 10,
        ttl: Math.max(1, Math.round(ttl)),
        maxTtl: Math.max(1, Math.round(ttl)),
        depth: genericSpec.depth,
        loop: genericSpec.loop,
        allowBelowSea: genericSpec.allowbelowsea ?? true,
        friction: genericSpec.friction || 0,
        gravity: 0,
        isExplosion: false,
      });
      return;
    }

    if (expSpec) {
      this.particles.push({
        id: this.nextEntityId++,
        kind,
        spriteName: expSpec.spritename,
        x,
        y,
        vx: 0,
        vy: 0,
        angleDeg: expSpec.imageanglerand
          ? this.rng.range(0, expSpec.imageanglerand)
          : 0,
        scaleX: 1,
        scaleY: 1,
        frame: 0,
        frameSpeed: 0.6,
        frameCount: 20,
        ttl: 24,
        maxTtl: 24,
        depth: expSpec.depth,
        loop: false,
        allowBelowSea: true,
        friction: 0,
        gravity: 0,
        isExplosion: true,
      });
      return;
    }

    this.particles.push({
      id: this.nextEntityId++,
      kind,
      spriteName: kind.startsWith('fx_') ? kind : `fx_${kind}`,
      x,
      y,
      vx: 0,
      vy: 0,
      angleDeg: 0,
      scaleX: 1,
      scaleY: 1,
      frame: 0,
      frameSpeed: 0.4,
      frameCount: 8,
      ttl: 18,
      maxTtl: 18,
      depth: -5,
      loop: false,
      allowBelowSea: true,
      friction: 0,
      gravity: 0,
      isExplosion: false,
    });
  }

  private findNearestEnemy(x: number, y: number): EnemyEntity | null {
    let best: EnemyEntity | null = null;
    let bestDistSq = Infinity;
    for (const e of this.enemies) {
      if (!e.active) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const dSq = dx * dx + dy * dy;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = e;
      }
    }
    return best;
  }

  private emitAudio(cue: AudioCueId, x?: number, y?: number): void {
    this.audioEvents.push({ cue, x, y });
  }

  getSnapshot(): SimSnapshot {
    return {
      tick: this.tick,
      phase: this.phase,
      mode: this.mode,
      paused: this.paused,
      hitstopTicks: this.hitstopTicks,
      screenShake: this.screenShake,
      nukeFlashTicks: this.nukeFlashTicks,
      launchTicks: this.launchTicks,
      deathTicks: this.deathTicks,
      score: this.score,
      combo: this.combo,
      comboTimer: this.comboTimer,
      comboMaxTimer: COMBO_MAX_TIMER,
      comboWarning: this.comboWarning,
      difficulty: this.difficulty,
      killsThisSortie: this.killsThisSortie,
      killsByKind: { ...this.killsByKind },
      player: {
        ...this.player,
        loadout: { ...this.player.loadout },
      },
      enemies: this.enemies.map((e) => ({ ...e })),
      projectiles: this.projectiles.map((pr) => ({ ...pr })),
      particles: this.particles.map((pt) => ({ ...pt })),
      parallax: this.parallax.map((px) => ({ ...px })),
      cameraTargetX: this.cameraTargetX,
      cameraTargetY: this.cameraTargetY,
      audioEvents: this.audioEvents.map((ev) => ({ ...ev })),
      completedMissionsThisSortie: [...this.missionTracker.getCompletedThisSortie()],
      activeMissions: this.missionTracker.getActiveMissions(),
      missionProgress: this.missionTracker.getProgressSnapshot(),
      profile: cloneProfile(this.profile),
      seaLevel: this.data.room.sealevel,
      spaceLevel: this.data.room.spacelevel,
      autopilotEnabled: this.autopilotEnabled,
      seed: this.seed,
    };
  }

  getReplay(): ReplayRecording {
    return {
      seed: this.seed,
      mode: this.mode,
      loadout: { ...this.player.loadout },
      profileId: this.modRegistry.vanillaProfile.profileId,
      frames: this.replayFrames.map((f) => ({ ...f })),
      finalScore: this.score,
      finalTicks: this.tick,
    };
  }

  getProfile(): PilotProfile {
    return cloneProfile(this.profile);
  }

  setProfile(profile: PilotProfile): void {
    this.profile = cloneProfile(profile);
    this.mode = this.profile.lastMode;
    this.missionTracker.syncFromProfile(this.profile);
    this.player = this.buildPlayerState(this.profile.lastLoadout);
    this.missionTracker.refreshActiveMissions(this.player.loadout, this.profile);
  }

  resetProfile(): void {
    this.profile = createDefaultProfile();
    this.mode = this.profile.lastMode;
    this.missionTracker.syncFromProfile(this.profile);
    this.player = this.buildPlayerState(this.profile.lastLoadout);
    this.missionTracker.refreshActiveMissions(this.player.loadout, this.profile);
  }

  unlockAll(): void {
    const allParts: PartIndex[] = [0, 1, 2, 3, 4, 5];
    this.profile.unlockedWeapons = [...allParts];
    this.profile.unlockedBodies = [...allParts];
    this.profile.unlockedEngines = [...allParts];
    this.profile.sfmtUnlocked = true;
  }
}

/**
 * Deterministically replays a recorded sortie from tick 0 and returns the final snapshot.
 */
export function replaySimulation(
  data: GameDataBundle,
  recording: ReplayRecording,
  modRegistry?: IModRegistry,
): SimSnapshot {
  const sim = new Simulation(data, modRegistry);
  sim.launch(recording.loadout, recording.mode, recording.seed);
  for (const frame of recording.frames) {
    sim.step(decodeInputMask(frame.mask));
  }
  return sim.getSnapshot();
}
