import type { AudioCueId } from '../contracts/audio';
import {
  DEFAULT_ACT2_MOD_FLAGS,
  DEFAULT_SHADER_FX,
  type Act2ModFlags,
  type CustomBossKind,
  type IModRegistry,
  type MultiplayerMode,
} from '../contracts/mod';
import type {
  DogfightState,
  EnemyEntity,
  GameMode,
  GhostPose,
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
  ShockwaveEvent,
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
import {
  computeAutopilotInput,
  computeCoopP2BotInput,
  computeDogfightBotInput,
} from './autopilot';
import { clamp, distPointToBoxSq, distPointToSegmentSq, shortestAngleDiffDeg } from './math';
import { type KillSource, MissionTracker } from './missions';
import { registerAct2ModPacks, resolveModdedPlaneName } from './mod-packs';
import { ModRegistry } from './mod-registry';
import { SeededRng } from './prng';
import { computeDailySeed, GhostRunner } from './replay-ghost';

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
  Dreadnought: 1500,
  SkyCarrier: 2000,
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
  Dreadnought: { w: 390, h: 66, r: 84 },
  SkyCarrier: { w: 580, h: 220, r: 112 },
};

const BASE_BOSS_TEMPLATE: EnemySpec = {
  key: 'dreadnought',
  name: 'Dreadnought',
  sprite: 'big_boat',
  spritegun: 'big_boat_gun',
  difficultyweight: 800,
  health: 500,
  initvelocity: 0.55,
  velocityvariance: 0.25,
  gravity: 0,
  friction: 0,
  constantforce: 0,
  environmentaldmg: 0,
  environmentalyforce: 0,
  reaction: 0,
  reactionvariance: 0,
  turnvariance: 0,
  turnspeedvariance: 0,
  minspeed: 0.3,
  maxspeed: 0.8,
  initmaxspeed: 0.8,
  minspeedvariance: 0,
  maxspeedvariance: 0,
  speed: 0.55,
  maxvspeed: 0,
  vspeedthrottler: 0,
  constantplayerchaseforce: 0,
  turndistance: 0,
  turndistancerand: 0,
  fireinterval: 4,
  fireintervalrand: 0,
  minfiredist: 0,
  bulletspeed: 12,
  boostdstplayer: 0,
  boostdstspeed: 0,
  airethinktimer: 0,
  airethinktimerrand: 0,
  reactionseaheighta: 0,
  reactionseaheightb: 0,
  reactionspaceheightoffseta: 0,
  reactionspaceheightoffsetb: 0,
  reactionchangea: 0,
  reactionchangeb: 0,
  initbulletspersalvo: 24,
  bulletspersalvo: 24,
  bulletfireinterval: 2,
  firesalvotimer: 85,
  firesalvotimerrand: 25,
  salvofirelimiterperboatmultiplier: 0,
  gunrotationspeed: 3,
  surfacetimer: 0,
  sinkingtimer: 0,
  sinkingspeed: 0,
  firstacelaunchinterval: 0,
  acelaunchinterval: 150,
  projectilefireinterval: 150,
  lifetime: 0,
  activationtimer: 0,
  damageonhit: 10,
  spawnceilingoffset: 220,
  spawnfallspeed: 2,
  fallnumframes: 300,
};

const ACT2_BOSS_SPECS: Partial<Record<EnemyKind, EnemySpec>> = {
  Dreadnought: BASE_BOSS_TEMPLATE,
  SkyCarrier: {
    ...BASE_BOSS_TEMPLATE,
    key: 'skycarrier',
    name: 'SkyCarrier',
    sprite: 'blimp',
    spritegun: 'big_boat_gun',
    difficultyweight: 1000,
    health: 750,
    initvelocity: 0.45,
    speed: 0.45,
    bulletspeed: 11,
    initbulletspersalvo: 16,
    bulletspersalvo: 16,
    bulletfireinterval: 3,
    firesalvotimer: 75,
    firesalvotimerrand: 20,
    gunrotationspeed: 2,
    spawnceilingoffset: 220,
    spawnfallspeed: 2,
    fallnumframes: 300,
  },
};

const COMBO_MAX = 20;
const COMBO_MAX_TIMER = 180;
const COMBO_WARNING_THRESHOLD = 60;
const HEAL_DELAY_TICKS = 12;
const LASER_BEAM_LENGTH = 520;
const NUKE_MAX_RADIUS = 420;
const PLASMA_AOE_RADIUS = 80;
const BOMB_AOE_RADIUS = 48;
const DEATH_TICKS_DURATION = 90;
const LAUNCH_TICKS_DURATION = 18;
const LAUNCH_INITIAL_VY = -9.5;
const RAILGUN_SPEED = 38;
const RAILGUN_DMG = 28;
const RAILGUN_TTL = 24;
const FLAK_SHELL_SPEED = 14;
const FLAK_SHELL_TTL = 18;
const FLAK_SHELL_DMG = 8;
const FLAK_PROXIMITY_PX = 48;
const FLAK_SHARD_COUNT = 6;
const FLAK_SHARD_SPEED = 18;
const FLAK_SHARD_DMG = 6;
const FLAK_SHARD_TTL = 18;
const LIGHTNING_RANGE_PX = 260;
const LIGHTNING_CONE_DEG = 38;
const LIGHTNING_CHAIN_PX = 160;
const LIGHTNING_MAX_TARGETS = 3;
const LIGHTNING_DMG = 14;
const LIGHTNING_VISUAL_TTL = 5; // Decrements once on spawn tick so snapshot ttl starts at 4
const AEGIS_SHIELD_COOLDOWN_TICKS = 300;
const VAMPIRE_LIFESTEAL_HP = 2.5;
const COOP_RESPAWN_TICKS = 300;
const DOGFIGHT_ROUND_BANNER_TICKS = 75;
const DOGFIGHT_BEST_OF = 5;
const DOGFIGHT_WINS_NEEDED = 3;
const MAX_ACTIVE_SHOCKWAVES = 4;
const MAX_PROJECTILES = 240;

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
    ...(p.dailyHighScores ? { dailyHighScores: { ...p.dailyHighScores } } : {}),
  };
}

function cloneModFlags(flags: Act2ModFlags): Act2ModFlags {
  return {
    moddedEnabled: flags.moddedEnabled,
    arsenalBosses: flags.arsenalBosses,
    replayGhost: flags.replayGhost,
    dailySeed: flags.dailySeed,
    shaderFx: { ...flags.shaderFx },
    multiplayerMode: flags.multiplayerMode,
    p2BotEnabled: flags.p2BotEnabled,
  };
}

function clampPartToVanilla(part: PartIndex): PartIndex {
  return part > 5 ? 0 : part;
}

function clampLoadoutToVanilla(loadout: Loadout): Loadout {
  return {
    weapon: clampPartToVanilla(loadout.weapon),
    body: clampPartToVanilla(loadout.body),
    engine: clampPartToVanilla(loadout.engine),
  };
}

function isSameLoadout(a: Loadout, b: Loadout): boolean {
  return a.weapon === b.weapon && a.body === b.body && a.engine === b.engine;
}

function resolvePartSpec<T extends { id: number }>(
  byId: readonly T[],
  map: Record<string, T>,
  id: number,
  extra: readonly T[] = [],
): T {
  const fromExtra = extra.find((item) => item.id === id);
  if (fromExtra) return fromExtra;
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
  const bossFallback = ACT2_BOSS_SPECS[kind];
  if (bossFallback) return bossFallback;
  return Object.values(map)[0]!;
}

function isBoatLike(kind: EnemyKind): boolean {
  return (
    kind === 'Boat' ||
    kind === 'BigBoat' ||
    kind === 'Submarine' ||
    kind === 'AceMarine' ||
    kind === 'Dreadnought'
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

function isWithinFlakProximity(px: number, py: number, enemy: EnemyEntity): boolean {
  if (enemy.width > enemy.height * 1.8) {
    return (
      distPointToBoxSq(
        px,
        py,
        enemy.x,
        enemy.y,
        enemy.width * 0.48,
        enemy.height * 0.55,
      ) <
      FLAK_PROXIMITY_PX * FLAK_PROXIMITY_PX
    );
  }
  const dx = px - enemy.x;
  const dy = py - enemy.y;
  return dx * dx + dy * dy < FLAK_PROXIMITY_PX * FLAK_PROXIMITY_PX;
}

function resolveFireCooldown(baseInterval: number, body: BodySpec): number {
  const raw = body.flags.includes('body-overclock')
    ? Math.round(baseInterval * 0.75)
    : baseInterval;
  return Math.max(1, raw);
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
  private finalizedScoreAdded = 0;
  private hitSoundIndex = 0;

  private nextEntityId = 1;
  private player: PlayerState;
  private player2: PlayerState | null = null;
  private p2Loadout: Loadout = { weapon: 0, body: 0, engine: 0 };
  private p1RespawnTicks = 0;
  private p2RespawnTicks = 0;
  private dogfight: DogfightState | null = null;
  private dogfightRamGrace = 0;

  private enemies: EnemyEntity[] = [];
  private projectiles: ProjectileEntity[] = [];
  private particles: ParticleEntity[] = [];
  private parallax: ParallaxEntity[] = [];
  private shockwaves: ShockwaveEvent[] = [];
  private audioEvents: SimAudioEvent[] = [];
  private replayFrames: ReplayFrame[] = [];
  private enemyRamGrace = new Map<number, number>();
  private piercingHitIds = new Map<number, Set<number>>();

  private modFlags: Act2ModFlags = cloneModFlags(DEFAULT_ACT2_MOD_FLAGS);
  private ghostReplay: ReplayRecording | null = null;
  private ghostRunner: GhostRunner | null = null;
  private dailySeedId: string | null = null;
  private nextBossDifficulty = 160;
  private bossWaveIndex = 0;

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

    if (!this.modRegistry.isVanillaLocked()) {
      const customWeapons = this.modRegistry.getCustomWeapons?.() ?? [];
      const customBodies = this.modRegistry.getCustomBodies?.() ?? [];
      const customEngines = this.modRegistry.getCustomEngines?.() ?? [];
      const customBosses = this.modRegistry.getCustomBosses?.() ?? [];
      this.modFlags = {
        moddedEnabled: true,
        arsenalBosses:
          customWeapons.length > 0 ||
          customBodies.length > 0 ||
          customEngines.length > 0 ||
          customBosses.length > 0,
        replayGhost: false,
        dailySeed: false,
        shaderFx: this.modRegistry.getEffectiveShaderFx?.() ?? { ...DEFAULT_SHADER_FX },
        multiplayerMode: this.modRegistry.getEffectiveMultiplayerMode?.() ?? 'solo',
        p2BotEnabled: true,
      };
    }

    this.missionTracker = new MissionTracker(this.data.global.missions, this.profile);
    this.player = this.buildPlayerState(this.profile.lastLoadout);
  }

  private getEffectiveMultiplayerMode(): MultiplayerMode {
    if (this.modRegistry.isVanillaLocked()) {
      return 'solo';
    }
    return this.modRegistry.getEffectiveMultiplayerMode?.() ?? this.modFlags.multiplayerMode;
  }

  private areCustomPartsEnabled(): boolean {
    return (
      !this.modRegistry.isVanillaLocked() &&
      this.modFlags.moddedEnabled &&
      this.modFlags.arsenalBosses
    );
  }

  private sanitizeLoadoutForFlags(loadout: Loadout): Loadout {
    return this.areCustomPartsEnabled()
      ? { ...loadout }
      : clampLoadoutToVanilla(loadout);
  }

  private refreshPlayerLoadoutPreservePose(
    existing: PlayerState,
    loadout: Loadout,
    playerIndex?: 1 | 2,
  ): PlayerState {
    const next = this.buildPlayerState(loadout, playerIndex);
    next.x = existing.x;
    next.prevX = existing.prevX;
    next.y = existing.y;
    next.prevY = existing.prevY;
    next.vx = existing.vx;
    next.vy = existing.vy;
    next.angleDeg = existing.angleDeg;
    next.prevAngleDeg = existing.prevAngleDeg;
    next.alive = existing.alive;
    next.health = existing.alive
      ? Math.min(existing.health, next.maxHealth)
      : 0;
    return next;
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
    sanitizedLoadout: Loadout;
  } {
    const customPartsEnabled = this.areCustomPartsEnabled();
    const effectiveLoadout = this.sanitizeLoadoutForFlags(loadout);
    const customWeapons = customPartsEnabled
      ? (this.modRegistry.getCustomWeapons?.() ?? [])
      : [];
    const customBodies = customPartsEnabled
      ? (this.modRegistry.getCustomBodies?.() ?? [])
      : [];
    const customEngines = customPartsEnabled
      ? (this.modRegistry.getCustomEngines?.() ?? [])
      : [];

    const weaponSpec = resolvePartSpec(
      this.data.player.weaponsById,
      this.data.player.weapons,
      effectiveLoadout.weapon,
      customWeapons,
    );
    const rawBodySpec = resolvePartSpec(
      this.data.player.bodiesById,
      this.data.player.bodyparts,
      effectiveLoadout.body,
      customBodies,
    );
    const engineSpec = resolvePartSpec(
      this.data.player.enginesById,
      this.data.player.engines,
      effectiveLoadout.engine,
      customEngines,
    );

    const isUrauser =
      effectiveLoadout.weapon === 5 &&
      effectiveLoadout.body === 5 &&
      effectiveLoadout.engine === 5;

    const entry = this.data.global.planenames.find(
      (p) =>
        p.weapon === effectiveLoadout.weapon &&
        p.body === effectiveLoadout.body &&
        p.engine === effectiveLoadout.engine,
    );

    let planeName: string;
    if (
      customPartsEnabled &&
      (effectiveLoadout.weapon >= 6 ||
        effectiveLoadout.body >= 6 ||
        effectiveLoadout.engine >= 6)
    ) {
      planeName = resolveModdedPlaneName(
        effectiveLoadout.weapon,
        effectiveLoadout.body,
        effectiveLoadout.engine,
        entry?.name ?? 'RAUSER',
      );
    } else if (isUrauser) {
      planeName = entry?.name ?? 'URAUSER';
    } else if (
      effectiveLoadout.weapon === 5 ||
      effectiveLoadout.body === 5 ||
      effectiveLoadout.engine === 5
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
      sanitizedLoadout: effectiveLoadout,
    };
  }

  private buildPlayerState(loadout: Loadout, playerIndex?: 1 | 2): PlayerState {
    const resolved = this.resolveAircraft(loadout);
    const seaLevel = this.data.room.sealevel;
    const hasAegis =
      this.areCustomPartsEnabled() &&
      resolved.bodySpec.flags.includes('body-aegis-shield');

    const state: PlayerState = {
      x: 0,
      y: seaLevel - 32,
      prevX: 0,
      prevY: seaLevel - 32,
      vx: 0,
      vy: LAUNCH_INITIAL_VY,
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
      loadout: { ...resolved.sanitizedLoadout },
      planeName: resolved.planeName,
      engineSpec: resolved.engineSpec,
      bodySpec: resolved.bodySpec,
      weaponSpec: resolved.weaponSpec,
      boostAnimFrame: 0,
    };

    if (hasAegis) {
      state.shieldReady = true;
      state.shieldCooldown = 0;
    }
    if (playerIndex !== undefined) {
      state.playerIndex = playerIndex;
    }
    return state;
  }

  setModFlags(flags: Partial<Act2ModFlags>): void {
    const nextFlags: Act2ModFlags = {
      ...this.modFlags,
      ...flags,
      shaderFx: {
        ...this.modFlags.shaderFx,
        ...(flags.shaderFx ?? {}),
      },
    };
    this.modFlags = nextFlags;
    registerAct2ModPacks(this.modRegistry, this.modFlags);

    if (!this.modFlags.moddedEnabled) {
      this.shockwaves = [];
      this.player2 = null;
      this.dogfight = null;
      this.dailySeedId = null;
      this.p1RespawnTicks = 0;
      this.p2RespawnTicks = 0;
    } else if (this.modFlags.replayGhost && this.ghostReplay && !this.ghostRunner) {
      this.ghostRunner = new GhostRunner(this.data, this.ghostReplay);
    }

    if (!this.areCustomPartsEnabled()) {
      this.profile.lastLoadout = clampLoadoutToVanilla(this.profile.lastLoadout);
      this.p2Loadout = clampLoadoutToVanilla(this.p2Loadout);
      if (this.phase === 'hangar') {
        this.player = this.buildPlayerState(this.profile.lastLoadout);
      } else {
        const clampedP1 = clampLoadoutToVanilla(this.player.loadout);
        if (!isSameLoadout(clampedP1, this.player.loadout)) {
          this.player = this.modFlags.moddedEnabled
            ? this.refreshPlayerLoadoutPreservePose(
                this.player,
                clampedP1,
                this.player.playerIndex,
              )
            : this.buildPlayerState(clampedP1);
        }
        if (this.player2) {
          const clampedP2 = clampLoadoutToVanilla(this.player2.loadout);
          if (!isSameLoadout(clampedP2, this.player2.loadout)) {
            this.player2 = this.refreshPlayerLoadoutPreservePose(
              this.player2,
              clampedP2,
              this.player2.playerIndex ?? 2,
            );
          }
        }
      }
      this.missionTracker.refreshActiveMissions(this.player.loadout, this.profile);
    } else if (this.phase === 'hangar') {
      this.player = this.buildPlayerState(this.profile.lastLoadout);
    }
  }

  getModFlags(): Act2ModFlags {
    return cloneModFlags(this.modFlags);
  }

  setGhostReplay(replay: ReplayRecording | null): void {
    this.ghostReplay = replay;
    this.ghostRunner = replay ? new GhostRunner(this.data, replay) : null;
  }

  getDailySeed(date?: Date): { dateId: string; seed: number } {
    return computeDailySeed(date);
  }

  setP2Loadout(loadout: Loadout): void {
    this.p2Loadout = this.sanitizeLoadoutForFlags(loadout);
    if (this.player2) {
      const idx = this.player2.playerIndex ?? 2;
      const prevX = this.player2.x;
      const prevY = this.player2.y;
      const prevAngle = this.player2.angleDeg;
      this.player2 = this.buildPlayerState(this.p2Loadout, idx);
      this.player2.x = prevX;
      this.player2.prevX = prevX;
      this.player2.y = prevY;
      this.player2.prevY = prevY;
      this.player2.angleDeg = prevAngle;
      this.player2.prevAngleDeg = prevAngle;
    }
  }

  getP2Loadout(): Loadout {
    return { ...this.p2Loadout };
  }

  launch(loadout: Loadout, mode: GameMode, seed?: number): void {
    const modded = !this.modRegistry.isVanillaLocked();
    const effectiveLoadout = this.sanitizeLoadoutForFlags(loadout);
    this.p2Loadout = this.sanitizeLoadoutForFlags(this.p2Loadout);
    const mpMode = this.getEffectiveMultiplayerMode();

    this.mode = mode;
    if (modded && this.modFlags.dailySeed) {
      const daily = computeDailySeed();
      this.dailySeedId = daily.dateId;
      this.seed = seed !== undefined ? seed >>> 0 : daily.seed;
    } else {
      this.dailySeedId = null;
      if (seed !== undefined) {
        this.seed = seed >>> 0;
      }
    }
    this.rng.setSeed(this.seed);
    this.paused = false;

    this.profile.lastLoadout = { ...effectiveLoadout };
    this.profile.lastMode = mode;
    this.profile.lastSeed = this.seed;

    this.tick = 0;
    this.hitstopTicks = 0;
    this.screenShake = 0;
    this.nukeFlashTicks = 0;
    this.launchTicks = LAUNCH_TICKS_DURATION;
    this.deathTicks = 0;

    this.score = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.comboWarning = false;
    this.difficulty = this.getSpawnCoordinator().initialDifficulty;
    this.difficultyTimer = 0;
    this.spawnTimer = 15;
    this.parallaxTimer = 45;
    this.nextBossDifficulty = 160;
    this.bossWaveIndex = 0;

    this.killsThisSortie = 0;
    this.killsByKind = {};
    this.comboKillStreak = 0;
    this.bestComboThisSortie = 1;
    this.continuousFireTicks = 0;
    this.lastFirePressed = false;
    this.lastPlayerHitTick = -1000;
    this.distinctKindsThisSortie.clear();
    this.sortieFinalized = false;
    this.finalizedScoreAdded = 0;
    this.hitSoundIndex = 0;

    this.nextEntityId = 1;
    this.enemies = [];
    this.projectiles = [];
    this.particles = [];
    this.parallax = [];
    this.shockwaves = [];
    this.audioEvents = [];
    this.replayFrames = [];
    this.enemyRamGrace.clear();
    this.piercingHitIds.clear();
    this.p1RespawnTicks = 0;
    this.p2RespawnTicks = 0;
    this.dogfightRamGrace = 0;

    if (mpMode === 'dogfight1v1') {
      this.player = this.buildPlayerState(effectiveLoadout, 1);
      this.player2 = this.buildPlayerState(this.p2Loadout, 2);
      this.dogfight = {
        p1Wins: 0,
        p2Wins: 0,
        round: 1,
        bestOf: DOGFIGHT_BEST_OF,
        roundBannerTicks: 0,
        winner: null,
        lastScorer: null,
      };
      this.resetDogfightRoundState();
      this.launchTicks = 0;
      this.phase = 'playing';
      this.cameraTargetX = 0;
      this.cameraTargetY = -260;
    } else if (mpMode === 'coop2p') {
      const seaLevel = this.data.room.sealevel;
      this.player = this.buildPlayerState(effectiveLoadout, 1);
      this.player.x = -70;
      this.player.prevX = -70;
      this.player.y = seaLevel - 32;
      this.player.prevY = seaLevel - 32;

      this.player2 = this.buildPlayerState(this.p2Loadout, 2);
      this.player2.x = 70;
      this.player2.prevX = 70;
      this.player2.y = seaLevel - 32;
      this.player2.prevY = seaLevel - 32;

      this.dogfight = null;
      this.phase = 'launching';
      this.cameraTargetX = 0;
      this.cameraTargetY = clamp(
        this.player.y - 40,
        this.data.room.spacelevel + 160,
        seaLevel + 60,
      );
      this.emitAudio('sndlaunch', this.player.x, this.player.y);
      this.emitAudio('sndsplashl', 0, seaLevel);
      this.spawnParticle('splashB', -70, seaLevel);
      this.spawnParticle('splashB', 70, seaLevel);
    } else {
      this.player = this.buildPlayerState(effectiveLoadout);
      this.player2 = null;
      this.dogfight = null;
      this.phase = 'launching';
      this.cameraTargetX = this.player.x;
      this.cameraTargetY = clamp(
        this.player.y - 40,
        this.data.room.spacelevel + 160,
        this.data.room.sealevel + 60,
      );
      this.emitAudio('sndlaunch', this.player.x, this.player.y);
      this.emitAudio('sndsplashl', 0, this.data.room.sealevel);
      if (mode === 'sfmt') {
        this.emitAudio('sndsfmt');
      }
      this.spawnParticle('splashB', 0, this.data.room.sealevel);
    }

    this.missionTracker.startSortie(effectiveLoadout, this.profile);
    if (mpMode === 'dogfight1v1' && mode === 'sfmt') {
      this.emitAudio('sndsfmt');
    } else if (mpMode === 'coop2p' && mode === 'sfmt') {
      this.emitAudio('sndsfmt');
    }
  }

  private resetDogfightRoundState(): void {
    const p1Loadout = this.player.loadout;
    const p2Loadout = this.player2?.loadout ?? this.p2Loadout;
    this.player = this.buildPlayerState(p1Loadout, 1);
    this.player.x = -220;
    this.player.prevX = -220;
    this.player.y = -260;
    this.player.prevY = -260;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.angleDeg = 0;
    this.player.prevAngleDeg = 0;

    this.player2 = this.buildPlayerState(p2Loadout, 2);
    this.player2.x = 220;
    this.player2.prevX = 220;
    this.player2.y = -260;
    this.player2.prevY = -260;
    this.player2.vx = 0;
    this.player2.vy = 0;
    this.player2.angleDeg = 180;
    this.player2.prevAngleDeg = 180;

    this.projectiles = [];
    this.piercingHitIds.clear();
    this.dogfightRamGrace = 0;
  }

  returnToHangar(): void {
    if (this.phase === 'dying' || this.phase === 'gameover') {
      this.finalizeSortieStats();
    }
    this.phase = 'hangar';
    this.launchTicks = 0;
    this.deathTicks = 0;
    this.paused = false;
    this.enemies = [];
    this.projectiles = [];
    this.particles = [];
    this.shockwaves = [];
    this.audioEvents = [];
    this.piercingHitIds.clear();
    this.player2 = null;
    this.dogfight = null;
    this.p1RespawnTicks = 0;
    this.p2RespawnTicks = 0;
    this.player = this.buildPlayerState(this.player.loadout);
    this.missionTracker.refreshActiveMissions(this.player.loadout, this.profile);
  }

  setLoadout(loadout: Loadout): void {
    const effective = this.sanitizeLoadoutForFlags(loadout);
    this.profile.lastLoadout = { ...effective };
    this.player = this.buildPlayerState(effective);
    this.missionTracker.refreshActiveMissions(effective, this.profile);
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
    this.applyDamageToTargetPlayer(this.player, amount, true);
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
    } else if (kind === 'Boat' || kind === 'BigBoat' || kind === 'Dreadnought') {
      ey = seaLevel;
    } else if (kind === 'Submarine' || kind === 'AceMarine') {
      ey = seaLevel + 24;
    } else if (kind === 'Blimp') {
      ey = spaceLevel + (spec.spawnceilingoffset ?? -200);
    } else if (kind === 'SkyCarrier') {
      ey = spaceLevel + (spec.spawnceilingoffset ?? 220);
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
    let carrierLaunchTimer: number | undefined;

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
    } else if (kind === 'Dreadnought') {
      const spd = spec.initvelocity || 0.55;
      vx = dirToPlayer * spd;
      angleDeg = dirToPlayer > 0 ? 0 : 180;
      salvoCooldown = spec.firesalvotimer || 60;
      this.emitAudio('sndacespawn', ex, ey);
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
    } else if (kind === 'SkyCarrier') {
      const spd = spec.initvelocity || 0.45;
      vx = dirToPlayer * spd;
      angleDeg = dirToPlayer > 0 ? 0 : 180;
      const targetAlt = -480;
      if (ey < targetAlt) {
        const fallSpeed = spec.spawnfallspeed || 2;
        state = 'falling';
        fallFrames = Math.max(1, Math.ceil((targetAlt - ey) / fallSpeed));
        vy = fallSpeed;
      } else {
        state = 'cruise';
        fallFrames = 0;
      }
      salvoCooldown = spec.firesalvotimer || 75;
      carrierLaunchTimer = 150;
      this.emitAudio('sndacespawn', ex, ey);
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
      ...(carrierLaunchTimer !== undefined ? { carrierLaunchTimer } : {}),
    };

    this.enemies.push(entity);
    return entity;
  }

  /**
   * Spawns a 3-Ace V-formation squadron sharing a `squadronId`.
   */
  spawnAceSquadron(centerX?: number, centerY?: number): EnemyEntity[] {
    const seaLevel = this.data.room.sealevel;
    const spaceLevel = this.data.room.spacelevel;
    const side = this.rng.chance(0.5) ? 1 : -1;
    const cx =
      centerX !== undefined
        ? centerX
        : this.player.x + side * this.rng.range(380, 460);
    const cy =
      centerY !== undefined
        ? centerY
        : clamp(this.player.y + this.rng.range(-120, 120), spaceLevel + 160, seaLevel - 140);
    const dirToPlayer = cx <= this.player.x ? 1 : -1;
    const squadronId = this.nextEntityId++;

    const offsets: readonly [number, number][] = [
      [0, 0],
      [-56 * dirToPlayer, -38],
      [-56 * dirToPlayer, 38],
    ];

    const spawned: EnemyEntity[] = [];
    for (const [ox, oy] of offsets) {
      const ace = this.spawnEnemy('Ace', cx + ox, clamp(cy + oy, spaceLevel + 100, seaLevel - 80));
      ace.squadronId = squadronId;
      spawned.push(ace);
    }
    return spawned;
  }

  step(input: InputState): SimSnapshot {
    const mpMode = this.getEffectiveMultiplayerMode();
    if (!this.modRegistry.isVanillaLocked() && mpMode !== 'solo') {
      let autoP2Input: InputState = { left: false, right: false, thrust: false, fire: false };
      if (this.modFlags.p2BotEnabled && this.phase === 'playing' && this.player2?.alive) {
        if (mpMode === 'dogfight1v1') {
          if (!this.dogfight || this.dogfight.roundBannerTicks <= 0) {
            autoP2Input = computeDogfightBotInput(
              this.player2,
              this.player,
              this.data.room.sealevel,
              this.data.room.spacelevel,
              this.projectiles,
            );
          }
        } else {
          autoP2Input = computeCoopP2BotInput(this.getSnapshot());
        }
      }
      return this.step2P(input, autoP2Input);
    }

    return this.stepSinglePlayerInternal(input);
  }

  step2P(p1Input: InputState, p2Input: InputState): SimSnapshot {
    const mpMode = this.getEffectiveMultiplayerMode();
    if (this.modRegistry.isVanillaLocked() || mpMode === 'solo') {
      return this.stepSinglePlayerInternal(p1Input);
    }

    this.audioEvents = [];

    if (this.paused || this.phase === 'hangar' || this.phase === 'gameover') {
      return this.getSnapshot();
    }

    const effectiveP1Input: InputState =
      this.phase === 'playing'
        ? this.autopilotEnabled
          ? computeAutopilotInput(this.getSnapshot())
          : p1Input
        : { left: false, right: false, thrust: false, fire: false };
    const effectiveP2Input: InputState =
      this.phase === 'playing'
        ? p2Input
        : { left: false, right: false, thrust: false, fire: false };

    this.tick++;
    this.replayFrames.push({
      tick: this.tick,
      mask: encodeInputMask(effectiveP1Input),
    });

    if (this.nukeFlashTicks > 0) this.nukeFlashTicks--;
    if (this.screenShake > 0) {
      this.screenShake = Math.max(0, this.screenShake * 0.85 - 0.1);
    }
    this.updateShockwaves();

    if (mpMode === 'dogfight1v1' && this.dogfight && this.dogfight.roundBannerTicks > 0) {
      this.dogfight.roundBannerTicks--;
      if (this.hitstopTicks > 0) {
        this.hitstopTicks--;
      }
      this.updateParticles();
      if (this.dogfight.roundBannerTicks === 0) {
        if (this.dogfight.winner !== null) {
          this.phase = 'gameover';
          this.finalizeSortieStats();
        } else {
          this.dogfight.round++;
          this.resetDogfightRoundState();
        }
      }
      this.lastFirePressed = effectiveP1Input.fire;
      return this.getSnapshot();
    }

    if (this.hitstopTicks > 0) {
      this.hitstopTicks--;
      return this.getSnapshot();
    }

    if (this.phase === 'launching') {
      this.updateLaunchingSequenceFor(this.player, false);
      if (this.player2) {
        this.updateLaunchingSequenceFor(this.player2, true);
      }
    } else if (this.phase === 'playing') {
      if (mpMode === 'dogfight1v1') {
        this.stepDogfightCombat(effectiveP1Input, effectiveP2Input);
      } else {
        this.stepCoopCombat(effectiveP1Input, effectiveP2Input);
      }
    } else if (this.phase === 'dying') {
      this.updateDyingSequence();
    }

    if (mpMode === 'coop2p') {
      this.updateEnemies();
      this.updateProjectiles();
      if (this.phase === 'playing') {
        if (this.player.alive) {
          this.checkPlayerEnemyCollisionsFor(this.player, 1);
        }
        if (this.player2?.alive) {
          this.checkPlayerEnemyCollisionsFor(this.player2, 2);
        }
      }
    } else {
      // dogfight1v1: still advance projectiles & check PvP hits if actively fighting
      if (this.phase === 'playing' && (!this.dogfight || this.dogfight.roundBannerTicks === 0)) {
        this.updateProjectiles();
        this.checkDogfightCollisions();
        this.resolveDogfightKnockouts();
      }
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
    if (this.dogfightRamGrace > 0) {
      this.dogfightRamGrace--;
    }

    this.updateMultiplayerCamera();

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

    this.lastFirePressed = effectiveP1Input.fire;
    return this.getSnapshot();
  }

  private stepSinglePlayerInternal(input: InputState): SimSnapshot {
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

    if (this.nukeFlashTicks > 0) this.nukeFlashTicks--;
    if (this.screenShake > 0) {
      this.screenShake = Math.max(0, this.screenShake * 0.85 - 0.1);
    }
    if (!this.modRegistry.isVanillaLocked()) {
      this.updateShockwaves();
    }

    if (this.hitstopTicks > 0) {
      this.hitstopTicks--;
      return this.getSnapshot();
    }

    if (this.phase === 'launching') {
      this.updateLaunchingSequenceFor(this.player, true);
    } else if (this.phase === 'playing') {
      this.updatePlayerAerodynamics(this.player, effectiveInput);
      this.updatePlayerWeapons(this.player, effectiveInput, true);
      this.updatePlayerHealing(this.player, effectiveInput);
      this.updateComboTimer();
      this.updateSpawnDirector();
      this.updateParallax();
    } else if (this.phase === 'dying') {
      this.updateDyingSequence();
    }

    this.updateEnemies();
    this.updateProjectiles();
    if (this.phase === 'playing' && this.player.alive) {
      this.checkPlayerEnemyCollisionsFor(this.player, 1);
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

  private stepCoopCombat(p1Input: InputState, p2Input: InputState): void {
    const p1 = this.player;
    const p2 = this.player2;

    if (p1.alive) {
      this.updatePlayerAerodynamics(p1, p1Input);
      this.updatePlayerWeapons(p1, p1Input, true);
      this.updatePlayerHealing(p1, p1Input);
    } else if (p2?.alive) {
      if (this.p1RespawnTicks > 0) {
        this.p1RespawnTicks--;
      }
      if (this.p1RespawnTicks <= 0) {
        this.respawnCoopPlayer(p1, p2, -48);
      }
    }

    if (p2) {
      if (p2.alive) {
        this.updatePlayerAerodynamics(p2, p2Input);
        this.updatePlayerWeapons(p2, p2Input, false);
        this.updatePlayerHealing(p2, p2Input);
      } else if (p1.alive) {
        if (this.p2RespawnTicks > 0) {
          this.p2RespawnTicks--;
        }
        if (this.p2RespawnTicks <= 0) {
          this.respawnCoopPlayer(p2, p1, 48);
        }
      }
    }

    if (!p1.alive && (!p2 || !p2.alive)) {
      this.enterDyingPhase();
      return;
    }

    this.updateComboTimer();
    this.updateSpawnDirector();
    this.updateParallax();
  }

  private respawnCoopPlayer(
    deadPlayer: PlayerState,
    partner: PlayerState,
    offsetX: number,
  ): void {
    const seaLevel = this.data.room.sealevel;
    const spaceLevel = this.data.room.spacelevel;
    const rx = partner.x + offsetX;
    const ry = clamp(partner.y - 32, spaceLevel + 180, seaLevel - 60);

    deadPlayer.x = rx;
    deadPlayer.prevX = rx;
    deadPlayer.y = ry;
    deadPlayer.prevY = ry;
    deadPlayer.vx = 0;
    deadPlayer.vy = -4;
    deadPlayer.angleDeg = -90;
    deadPlayer.prevAngleDeg = -90;
    deadPlayer.health = deadPlayer.maxHealth;
    deadPlayer.alive = true;
    deadPlayer.boosting = false;
    deadPlayer.wasBoosting = false;
    deadPlayer.firing = false;
    deadPlayer.healing = false;
    deadPlayer.healingTicks = 0;
    deadPlayer.underwater = false;
    deadPlayer.inSpace = false;
    deadPlayer.fireCooldown = 0;
    deadPlayer.gungineCooldown = 0;
    deadPlayer.bombCooldown = 0;
    deadPlayer.flashTicks = 30;
    deadPlayer.burnTicks = 0;
    deadPlayer.envWaterFactor = 0;
    deadPlayer.envSpaceFactor = 0;
    deadPlayer.nukeTriggered = false;
    deadPlayer.nukeRadius = 0;
    deadPlayer.nukeTicks = 0;
    if (deadPlayer.bodySpec.flags.includes('body-aegis-shield')) {
      deadPlayer.shieldReady = true;
      deadPlayer.shieldCooldown = 0;
    }
    this.emitAudio('sndlaunch', rx, ry);
  }

  private stepDogfightCombat(p1Input: InputState, p2Input: InputState): void {
    const p1 = this.player;
    const p2 = this.player2;
    if (!p2 || !this.dogfight) return;

    // Catch external KOs (e.g., debug damagePlayer) before advancing round combat
    if (!p1.alive || !p2.alive) {
      this.resolveDogfightKnockouts();
      return;
    }

    this.updatePlayerAerodynamics(p1, p1Input);
    this.updatePlayerWeapons(p1, p1Input, true);
    this.updatePlayerHealing(p1, p1Input);

    this.updatePlayerAerodynamics(p2, p2Input);
    this.updatePlayerWeapons(p2, p2Input, false);
    this.updatePlayerHealing(p2, p2Input);
  }

  private checkDogfightCollisions(): void {
    const p1 = this.player;
    const p2 = this.player2;
    if (!p2 || !p1.alive || !p2.alive || this.dogfightRamGrace > 0) return;

    const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    if (dist <= 20) {
      this.dogfightRamGrace = 12;
      const p1Melee = p1.bodySpec.id === 2 || p1.bodySpec.impactrecvdmgmult === 0;
      const p2Melee = p2.bodySpec.id === 2 || p2.bodySpec.impactrecvdmgmult === 0;
      const p1Speed = Math.hypot(p1.vx, p1.vy);
      const p2Speed = Math.hypot(p2.vx, p2.vy);
      const p1Deal = Math.max(8, p1Speed * 2.5);
      const p2Deal = Math.max(8, p2Speed * 2.5);

      if (!p1Melee) {
        this.applyDamageToTargetPlayer(p1, p2Deal * Math.max(0.2, p1.bodySpec.impactrecvdmgmult * 2), true);
      }
      if (!p2Melee) {
        this.applyDamageToTargetPlayer(p2, p1Deal * Math.max(0.2, p2.bodySpec.impactrecvdmgmult * 2), true);
      }
    }
  }

  private resolveDogfightKnockouts(): void {
    if (!this.dogfight || !this.player2 || this.dogfight.roundBannerTicks > 0) return;
    const p1Alive = this.player.alive;
    const p2Alive = this.player2.alive;
    if (p1Alive && p2Alive) return;

    if (!p1Alive && !p2Alive) {
      // Simultaneous KO tie round: reset cleanly without awarding win or freezing
      this.dogfight.lastScorer = null;
      this.dogfight.roundBannerTicks = DOGFIGHT_ROUND_BANNER_TICKS;
      this.hitstopTicks = Math.max(this.hitstopTicks, 6);
      this.screenShake = Math.max(this.screenShake, 10);
      this.emitShockwave(this.player.x, this.player.y, 120, 1.0, 22);
      this.emitShockwave(this.player2.x, this.player2.y, 120, 1.0, 22);
      return;
    }

    if (p1Alive && !p2Alive) {
      this.dogfight.p1Wins++;
      this.dogfight.lastScorer = 1;
      this.score += 500;
      this.dogfight.roundBannerTicks = DOGFIGHT_ROUND_BANNER_TICKS;
      this.hitstopTicks = Math.max(this.hitstopTicks, 6);
      this.screenShake = Math.max(this.screenShake, 10);
      this.emitShockwave(this.player2.x, this.player2.y, 140, 1.0, 22);
      if (this.dogfight.p1Wins >= DOGFIGHT_WINS_NEEDED) {
        this.dogfight.winner = 1;
      }
      return;
    }

    this.dogfight.p2Wins++;
    this.dogfight.lastScorer = 2;
    this.dogfight.roundBannerTicks = DOGFIGHT_ROUND_BANNER_TICKS;
    this.hitstopTicks = Math.max(this.hitstopTicks, 6);
    this.screenShake = Math.max(this.screenShake, 10);
    this.emitShockwave(this.player.x, this.player.y, 140, 1.0, 22);
    if (this.dogfight.p2Wins >= DOGFIGHT_WINS_NEEDED) {
      this.dogfight.winner = 2;
    }
  }

  private updateMultiplayerCamera(): void {
    const seaLevel = this.data.room.sealevel;
    const spaceLevel = this.data.room.spacelevel;
    const p1 = this.player;
    const p2 = this.player2;

    if (!p2) {
      this.cameraTargetX = p1.x + p1.vx * 14;
      this.cameraTargetY = clamp(p1.y + p1.vy * 10, spaceLevel + 160, seaLevel + 80);
      return;
    }

    if (p1.alive && p2.alive) {
      const midX = (p1.x + p2.x) * 0.5;
      const midY = (p1.y + p2.y) * 0.5;
      this.cameraTargetX = midX + (p1.vx + p2.vx) * 5;
      this.cameraTargetY = clamp(midY, spaceLevel + 160, seaLevel + 80);
    } else if (p2.alive) {
      this.cameraTargetX = p2.x + p2.vx * 14;
      this.cameraTargetY = clamp(p2.y + p2.vy * 10, spaceLevel + 160, seaLevel + 80);
    } else {
      this.cameraTargetX = p1.x + p1.vx * 14;
      this.cameraTargetY = clamp(p1.y + p1.vy * 10, spaceLevel + 160, seaLevel + 80);
    }
  }

  private updateLaunchingSequenceFor(p: PlayerState, advancePhase: boolean): void {
    p.prevX = p.x;
    p.prevY = p.y;
    p.prevAngleDeg = p.angleDeg;
    p.boosting = true;
    p.wasBoosting = true;
    p.boostAnimFrame = (p.boostAnimFrame + 1) % 60;

    // Propel cleanly upward out of the submarine past y = -180 before entering playing
    p.vy = Math.min(-6.5, p.vy + 0.05);
    p.x += p.vx;
    p.y += p.vy;

    if (advancePhase) {
      if (this.launchTicks > 0) {
        this.launchTicks--;
      }
      if (this.launchTicks <= 0) {
        this.phase = 'playing';
      }
    }
  }

  private updatePlayerAerodynamics(p: PlayerState, input: InputState): void {
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
            ...(p.playerIndex !== undefined ? { ownerPlayer: p.playerIndex } : {}),
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
          this.applyDamageToTargetPlayer(p, waterDmg, false);
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
        this.applyDamageToTargetPlayer(p, spaceDmg, false);
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

  private updatePlayerHealing(p: PlayerState, input: InputState): void {
    if (!p.alive) {
      p.healing = false;
      p.healingTicks = 0;
      return;
    }

    // Act II Aegis energy shield recharge
    if (p.bodySpec.flags.includes('body-aegis-shield') && !p.shieldReady) {
      const nextCd = (p.shieldCooldown ?? 0) - 1;
      if (nextCd <= 0) {
        p.shieldReady = true;
        p.shieldCooldown = 0;
      } else {
        p.shieldCooldown = nextCd;
      }
    }

    if (input.fire || p.fireCooldown > 0) {
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

  private getOpponentPlayer(p: PlayerState): PlayerState | null {
    if (!this.player2) return null;
    if (p.playerIndex === 2) return this.player;
    return this.player2;
  }

  private updatePlayerWeapons(
    p: PlayerState,
    input: InputState,
    isP1: boolean,
  ): void {
    if (!p.alive) return;

    p.firing = input.fire;
    if (isP1) {
      if (input.fire) {
        this.continuousFireTicks++;
      } else {
        this.continuousFireTicks = 0;
      }
    }

    if (p.fireCooldown > 0) {
      p.fireCooldown--;
      if (p.weaponSpec.id === 4 && p.fireCooldown === 0) {
        this.emitAudio('sndcannonreload', p.x, p.y);
      } else if (
        isP1 &&
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

    const ownerTag = p.playerIndex !== undefined ? { ownerPlayer: p.playerIndex } : {};

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
        ...ownerTag,
      });
    }

    if (!input.fire || p.fireCooldown > 0) return;

    const rad = (p.angleDeg * Math.PI) / 180;
    const muzzleX = p.x + Math.cos(rad) * 12;
    const muzzleY = p.y + Math.sin(rad) * 12;
    const mpMode = this.getEffectiveMultiplayerMode();
    const isDogfight = !this.modRegistry.isVanillaLocked() && mpMode === 'dogfight1v1';

    if (p.isUrauser) {
      this.fireUrauserVolley(p, muzzleX, muzzleY);
      return;
    }

    const weapon = p.weaponSpec;
    switch (weapon.id) {
      case 1: {
        // Laser: interval 1, continuous piercing 520px ray, 1 dmg/tick
        p.fireCooldown = resolveFireCooldown(weapon.interval || 1, p.bodySpec);
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
          ttl: 2,
          dmg: beamDmg,
          radius: 5,
          targetId: null,
          piercing: true,
          aoeRadius: 0,
          fromGungine: false,
          beamLength: LASER_BEAM_LENGTH,
          ...ownerTag,
        });

        for (const enemy of this.enemies) {
          if (!enemy.active) continue;
          if (isSegmentHittingEnemy(p.x, p.y, endX, endY, 5, enemy)) {
            this.damageEnemy(enemy, beamDmg, 'laser', false, p);
          }
        }
        if (isDogfight) {
          const opp = this.getOpponentPlayer(p);
          if (
            opp &&
            opp.alive &&
            opp.flashTicks <= 0 &&
            distPointToSegmentSq(opp.x, opp.y, p.x, p.y, endX, endY) <= 13 * 13
          ) {
            this.applyDamageToTargetPlayer(opp, beamDmg, true);
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
        p.fireCooldown = resolveFireCooldown(weapon.interval || 9, p.bodySpec);
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
            ...ownerTag,
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
        p.fireCooldown = resolveFireCooldown(weapon.interval || 5, p.bodySpec);
        const cap = weapon.maxbullets || 4;
        const activeMissiles = this.projectiles.filter(
          (pr) =>
            pr.owner === 'player' &&
            pr.kind === 'missile' &&
            (pr.ownerPlayer ?? 1) === (p.playerIndex ?? 1),
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
          ...ownerTag,
        });
        this.spawnParticle('missilefireFlash', muzzleX, muzzleY);
        this.emitAudio('sndmissile', p.x, p.y);
        break;
      }
      case 4: {
        // Cannon: interval 79, plasmaball dmg 20, speed 10, ttl 60, AOE 80
        p.fireCooldown = resolveFireCooldown(weapon.interval || 79, p.bodySpec);
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
          ...ownerTag,
        });
        this.spawnParticle('plasmafireflash', muzzleX, muzzleY);
        this.emitAudio('sndcannon', p.x, p.y);
        break;
      }
      case 6: {
        // Act II Railgun: hypersonic piercing slug + shockwave + recoil
        p.fireCooldown = resolveFireCooldown(weapon.interval || 28, p.bodySpec);
        this.spawnProjectile({
          owner: 'player',
          kind: 'railslug',
          x: muzzleX,
          y: muzzleY,
          vx: Math.cos(rad) * RAILGUN_SPEED,
          vy: Math.sin(rad) * RAILGUN_SPEED,
          angleDeg: p.angleDeg,
          ttl: RAILGUN_TTL,
          dmg: RAILGUN_DMG,
          radius: 6,
          targetId: null,
          piercing: true,
          aoeRadius: 0,
          fromGungine: false,
          ...ownerTag,
        });
        const recoil = weapon.recoil || 2.2;
        p.vx -= Math.cos(rad) * recoil;
        p.vy -= Math.sin(rad) * recoil;
        this.emitShockwave(muzzleX, muzzleY, 55, 0.7, 14);
        this.spawnParticle('plasmafireflash', muzzleX, muzzleY);
        this.emitAudio('sndcannon', p.x, p.y);
        break;
      }
      case 7: {
        // Act II Flak: airburst shrapnel shell splitting into 6 radial shards
        p.fireCooldown = resolveFireCooldown(weapon.interval || 18, p.bodySpec);
        this.spawnProjectile({
          owner: 'player',
          kind: 'flakshell',
          x: muzzleX,
          y: muzzleY,
          vx: Math.cos(rad) * FLAK_SHELL_SPEED,
          vy: Math.sin(rad) * FLAK_SHELL_SPEED,
          angleDeg: p.angleDeg,
          ttl: FLAK_SHELL_TTL,
          dmg: FLAK_SHELL_DMG,
          radius: 8,
          targetId: null,
          piercing: false,
          aoeRadius: 0,
          fromGungine: false,
          ...ownerTag,
        });
        const recoil = weapon.recoil || 0.8;
        p.vx -= Math.cos(rad) * recoil;
        p.vy -= Math.sin(rad) * recoil;
        this.spawnParticle('spreadfireFlash', muzzleX, muzzleY);
        this.emitAudio('sndspread', p.x, p.y);
        break;
      }
      case 8: {
        // Act II Chain Lightning: 260px ±38° primary + up to 2 hops within 160px (3 total!)
        p.fireCooldown = resolveFireCooldown(weapon.interval || 16, p.bodySpec);
        this.fireChainLightning(p, rad, isDogfight, ownerTag);
        break;
      }
      default: {
        // Original & Weapon 5 (non-Urauser fallback): bullet interval 3
        p.fireCooldown = resolveFireCooldown(weapon.interval || 3, p.bodySpec);
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
          ...ownerTag,
        });
        this.spawnParticle('fireFlash', muzzleX, muzzleY);
        this.emitAudio('sndbullet', p.x, p.y);
        break;
      }
    }
  }

  private fireChainLightning(
    p: PlayerState,
    rad: number,
    isDogfight: boolean,
    ownerTag: { ownerPlayer?: 1 | 2 },
  ): void {
    const arcPoints: { x: number; y: number }[] = [{ x: p.x, y: p.y }];
    let primaryTargetId: number | null = null;

    if (isDogfight) {
      const opp = this.getOpponentPlayer(p);
      if (opp && opp.alive) {
        const dx = opp.x - p.x;
        const dy = opp.y - p.y;
        const dist = Math.hypot(dx, dy);
        const targetAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (
          dist <= LIGHTNING_RANGE_PX &&
          Math.abs(shortestAngleDiffDeg(p.angleDeg, targetAngle)) <= LIGHTNING_CONE_DEG
        ) {
          arcPoints.push({ x: opp.x, y: opp.y });
          this.applyDamageToTargetPlayer(opp, LIGHTNING_DMG, true);
        }
      }
    } else {
      let primary: EnemyEntity | null = null;
      let bestDist = Infinity;

      for (const enemy of this.enemies) {
        if (!enemy.active) continue;
        const dx = enemy.x - p.x;
        const dy = enemy.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist > LIGHTNING_RANGE_PX) continue;
        const targetAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (Math.abs(shortestAngleDiffDeg(p.angleDeg, targetAngle)) > LIGHTNING_CONE_DEG) {
          continue;
        }
        if (dist < bestDist) {
          bestDist = dist;
          primary = enemy;
        }
      }

      if (primary) {
        primaryTargetId = primary.id;
        const hitTargets: EnemyEntity[] = [primary];
        const hitIds = new Set<number>([primary.id]);

        while (hitTargets.length < LIGHTNING_MAX_TARGETS) {
          const anchor = hitTargets[hitTargets.length - 1]!;
          let nextTarget: EnemyEntity | null = null;
          let nextDist = Infinity;
          for (const candidate of this.enemies) {
            if (!candidate.active || hitIds.has(candidate.id)) continue;
            const d = Math.hypot(candidate.x - anchor.x, candidate.y - anchor.y);
            if (d <= LIGHTNING_CHAIN_PX && d < nextDist) {
              nextDist = d;
              nextTarget = candidate;
            }
          }
          if (!nextTarget) break;
          hitTargets.push(nextTarget);
          hitIds.add(nextTarget.id);
        }

        for (const t of hitTargets) {
          arcPoints.push({ x: t.x, y: t.y });
        }

        const multi = hitTargets.length > 1;
        for (const t of hitTargets) {
          this.damageEnemy(t, LIGHTNING_DMG, 'laser', multi, p);
        }
      }
    }

    if (arcPoints.length === 1) {
      arcPoints.push({
        x: p.x + Math.cos(rad) * 140,
        y: p.y + Math.sin(rad) * 140,
      });
    }

    this.spawnProjectile({
      owner: 'player',
      kind: 'lightningarc',
      x: p.x,
      y: p.y,
      vx: 0,
      vy: 0,
      angleDeg: p.angleDeg,
      ttl: LIGHTNING_VISUAL_TTL,
      dmg: 0,
      radius: 4,
      targetId: primaryTargetId,
      piercing: false,
      aoeRadius: 0,
      fromGungine: false,
      arcPoints,
      ...ownerTag,
    });
    this.emitAudio('sndlaser', p.x, p.y);
  }

  private fireUrauserVolley(
    p: PlayerState,
    muzzleX: number,
    muzzleY: number,
  ): void {
    p.fireCooldown = resolveFireCooldown(4, p.bodySpec);
    const rad = (p.angleDeg * Math.PI) / 180;
    const ownerTag = p.playerIndex !== undefined ? { ownerPlayer: p.playerIndex } : {};
    const isDogfight =
      !this.modRegistry.isVanillaLocked() &&
      this.getEffectiveMultiplayerMode() === 'dogfight1v1';

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
        ...ownerTag,
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
      ttl: 2,
      dmg: 2,
      radius: 6,
      targetId: null,
      piercing: true,
      aoeRadius: 0,
      fromGungine: false,
      beamLength: beamLen,
      ...ownerTag,
    });
    for (const enemy of this.enemies) {
      if (!enemy.active) continue;
      if (isSegmentHittingEnemy(p.x, p.y, endX, endY, 6, enemy)) {
        this.damageEnemy(enemy, 2, 'laser', false, p);
      }
    }
    if (isDogfight) {
      const opp = this.getOpponentPlayer(p);
      if (
        opp &&
        opp.alive &&
        opp.flashTicks <= 0 &&
        distPointToSegmentSq(opp.x, opp.y, p.x, p.y, endX, endY) <= 14 * 14
      ) {
        this.applyDamageToTargetPlayer(opp, 2, true);
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

    // Act II deterministic Mega-Boss waves (only when modded & arsenalBosses active)
    if (!this.modRegistry.isVanillaLocked()) {
      const customBosses: readonly CustomBossKind[] =
        this.modRegistry.getCustomBosses?.() ?? [];
      if (customBosses.length > 0 && this.difficulty >= this.nextBossDifficulty) {
        const hasMegaBoss = this.enemies.some(
          (e) =>
            e.active &&
            (e.kind === 'Dreadnought' || e.kind === 'SkyCarrier'),
        );
        const bossChoice = customBosses[this.bossWaveIndex % customBosses.length]!;
        if (bossChoice === 'AceSquadron') {
          this.spawnAceSquadron();
          this.bossWaveIndex++;
          this.nextBossDifficulty += 120;
        } else if (!hasMegaBoss) {
          this.spawnEnemy(bossChoice);
          this.bossWaveIndex++;
          this.nextBossDifficulty += 120;
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

  private getTargetPlayerForEnemy(enemy: EnemyEntity): PlayerState {
    if (!this.player2) return this.player;
    if (this.player.alive && this.player2.alive) {
      const d1 = Math.hypot(this.player.x - enemy.x, this.player.y - enemy.y);
      const d2 = Math.hypot(this.player2.x - enemy.x, this.player2.y - enemy.y);
      return d2 < d1 ? this.player2 : this.player;
    }
    if (this.player2.alive) return this.player2;
    return this.player;
  }

  private anyActivePlayerAlive(): boolean {
    return this.player.alive || Boolean(this.player2?.alive);
  }

  private updateEnemies(): void {
    const specMap = this.getEnemyMap();
    const seaLevel = this.data.room.sealevel;
    const spaceLevel = this.data.room.spacelevel;
    const anyAlive = this.anyActivePlayerAlive();

    for (const enemy of this.enemies) {
      if (!enemy.active) continue;
      enemy.prevX = enemy.x;
      enemy.prevY = enemy.y;
      if (enemy.flashTicks > 0) enemy.flashTicks--;

      const spec = getEnemySpec(specMap, enemy.kind);
      const targetPlayer = this.getTargetPlayerForEnemy(enemy);
      const dx = targetPlayer.x - enemy.x;
      const dy = targetPlayer.y - enemy.y;
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

          if (this.phase === 'playing' && anyAlive) {
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
          const passed = flyDir > 0 ? enemy.x - targetPlayer.x : targetPlayer.x - enemy.x;
          if (passed > (spec.turndistance || 600)) {
            enemy.vx = -flyDir * (spec.initvelocity || 8);
          }

          if (this.tick % 2 === 0) {
            this.spawnParticle('jet_trail', enemy.x, enemy.y);
          }

          // SFMT Jet fires when fireinterval < 1e6; Normal Jet has 999999999999
          if (
            this.phase === 'playing' &&
            anyAlive &&
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
              : (spec.maxspeed || 4) + 3;
          const r = (enemy.angleDeg * Math.PI) / 180;
          enemy.vx += Math.cos(r) * 0.7;
          enemy.vy += Math.sin(r) * 0.7 + (spec.gravity || 0.4) * 0.4;
          const spd = Math.hypot(enemy.vx, enemy.vy);
          if (spd > maxSpd) {
            enemy.vx = (enemy.vx / spd) * maxSpd;
            enemy.vy = (enemy.vy / spd) * maxSpd;
          }

          if (this.phase === 'playing' && anyAlive) {
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
                if (enemy.salvoRemaining % 4 === 0) {
                  for (const pl of [this.player, this.player2]) {
                    if (
                      pl &&
                      pl.alive &&
                      pl.flashTicks <= 0 &&
                      distPointToSegmentSq(pl.x, pl.y, enemy.x, enemy.y, lx2, ly2) <= 144
                    ) {
                      this.applyDamageToTargetPlayer(pl, 1.5, true);
                    }
                  }
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

          if (this.phase === 'playing' && anyAlive) {
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
        case 'Dreadnought': {
          enemy.y = seaLevel;
          enemy.vy = 0;
          if (this.tick % 5 === 0) {
            this.spawnParticle('bigboattrail', enemy.x, seaLevel);
          }
          if (this.phase === 'playing' && anyAlive) {
            const desiredGun = clamp(angleToPlayer, -175, -5);
            const gDiff = shortestAngleDiffDeg(enemy.gunAngleDeg, desiredGun);
            const rotSpd = spec.gunrotationspeed || 3;
            enemy.gunAngleDeg += clamp(gDiff, -rotSpd, rotSpd);

            if (enemy.salvoRemaining > 0) {
              if (enemy.fireTimer <= 0) {
                enemy.fireTimer = spec.bulletfireinterval || 2;
                // Twin artillery turrets firing rapid 24-bullet bursts
                const fired = Math.min(2, enemy.salvoRemaining);
                enemy.salvoRemaining -= fired;
                this.spawnEnemyArtillery(
                  enemy.x - 75,
                  enemy.y - 16,
                  enemy.gunAngleDeg + this.rng.range(-4, 4),
                  spec.bulletspeed || 12,
                );
                if (fired === 2) {
                  this.spawnEnemyArtillery(
                    enemy.x + 75,
                    enemy.y - 16,
                    enemy.gunAngleDeg + this.rng.range(-4, 4),
                    spec.bulletspeed || 12,
                  );
                }
              } else {
                enemy.fireTimer--;
              }
            } else if (enemy.salvoCooldown > 0) {
              enemy.salvoCooldown--;
            } else if (dist < 900) {
              enemy.salvoRemaining = 24;
              enemy.fireTimer = 0;
              enemy.salvoCooldown =
                (spec.firesalvotimer || 85) +
                this.rng.range(0, spec.firesalvotimerrand || 25);
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
            if (this.phase === 'playing' && anyAlive) {
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

          if (this.phase === 'playing' && anyAlive) {
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
        case 'SkyCarrier': {
          const targetAlt = -480;
          if (enemy.fallFrames > 0 && enemy.y < targetAlt) {
            enemy.fallFrames--;
            enemy.vy = spec.spawnfallspeed || 2;
            if (enemy.y + enemy.vy >= targetAlt || enemy.fallFrames === 0) {
              enemy.y = targetAlt;
              enemy.vy = 0;
              enemy.fallFrames = 0;
              enemy.state = 'cruise';
            }
          } else {
            enemy.vy = 0;
            enemy.state = 'cruise';
          }

          if (this.phase === 'playing' && anyAlive) {
            // Periodically launch Fighter / Jet interceptors every 150 ticks
            const launchCd = (enemy.carrierLaunchTimer ?? 150) - 1;
            if (launchCd <= 0) {
              enemy.carrierLaunchTimer = 150;
              if (this.enemies.length < 28) {
                const interceptorKind: EnemyKind = this.rng.chance(0.5)
                  ? 'Fighter'
                  : 'Jet';
                this.spawnEnemy(interceptorKind, enemy.x, enemy.y + 18);
              }
            } else {
              enemy.carrierLaunchTimer = launchCd;
            }

            const gDiff = shortestAngleDiffDeg(enemy.gunAngleDeg, angleToPlayer);
            const rotSpd = spec.gunrotationspeed || 2;
            enemy.gunAngleDeg += clamp(gDiff, -rotSpd, rotSpd);

            if (enemy.salvoRemaining > 0) {
              if (enemy.fireTimer <= 0) {
                enemy.fireTimer = spec.bulletfireinterval || 3;
                enemy.salvoRemaining--;
                this.spawnEnemyBullet(
                  enemy.x,
                  enemy.y + 24,
                  enemy.gunAngleDeg + this.rng.range(-8, 8),
                  spec.bulletspeed || 11,
                );
              } else {
                enemy.fireTimer--;
              }
            } else if (enemy.salvoCooldown > 0) {
              enemy.salvoCooldown--;
            } else if (dist < 900) {
              enemy.salvoRemaining = spec.bulletspersalvo || 16;
              enemy.fireTimer = 0;
              enemy.salvoCooldown =
                (spec.firesalvotimer || 75) +
                this.rng.range(0, spec.firesalvotimerrand || 20);
            }
          }
          break;
        }
      }

      enemy.x += enemy.vx;
      enemy.y += enemy.vy;

      const maxDespawnDist =
        enemy.kind === 'Blimp' ||
        enemy.kind === 'Dreadnought' ||
        enemy.kind === 'SkyCarrier'
          ? 2600
          : 1600;
      if (Math.abs(enemy.x - targetPlayer.x) > maxDespawnDist) {
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

  private spawnEnemyArtillery(
    x: number,
    y: number,
    angleDeg: number,
    speed: number,
  ): void {
    const r = (angleDeg * Math.PI) / 180;
    this.spawnProjectile({
      owner: 'enemy',
      kind: 'artillery',
      x,
      y,
      vx: Math.cos(r) * speed,
      vy: Math.sin(r) * speed,
      angleDeg,
      ttl: 180,
      dmg: 7,
      radius: 6,
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

  private resolveProjectileShooter(proj: ProjectileEntity): PlayerState {
    if (proj.ownerPlayer === 2 && this.player2) {
      return this.player2;
    }
    return this.player;
  }

  private updateProjectiles(): void {
    const seaLevel = this.data.room.sealevel;
    const nextList: ProjectileEntity[] = [];
    const spawnedDuringStep: ProjectileEntity[] = [];
    const isDogfight =
      !this.modRegistry.isVanillaLocked() &&
      this.getEffectiveMultiplayerMode() === 'dogfight1v1';

    for (const proj of this.projectiles) {
      proj.prevX = proj.x;
      proj.prevY = proj.y;
      proj.ttl--;

      if (
        proj.kind === 'laser' ||
        proj.kind === 'elaser' ||
        proj.kind === 'lightningarc'
      ) {
        if (proj.ttl > 0) {
          nextList.push(proj);
        }
        continue;
      }

      if (proj.kind === 'missile' && proj.owner === 'player') {
        const curSpd = Math.hypot(proj.vx, proj.vy);
        const nextSpd = Math.min(14, curSpd + 0.55);
        if (isDogfight) {
          const shooter = this.resolveProjectileShooter(proj);
          const opp = this.getOpponentPlayer(shooter);
          if (opp && opp.alive) {
            const desired =
              (Math.atan2(opp.y - proj.y, opp.x - proj.x) * 180) / Math.PI;
            const diff = shortestAngleDiffDeg(proj.angleDeg, desired);
            proj.angleDeg += clamp(diff, -9, 9);
          }
        } else {
          let target = this.enemies.find(
            (e) => e.active && e.id === proj.targetId,
          );
          if (!target) {
            target = this.findNearestEnemy(proj.x, proj.y) ?? undefined;
            proj.targetId = target ? target.id : null;
          }
          if (target) {
            const desired =
              (Math.atan2(target.y - proj.y, target.x - proj.x) * 180) / Math.PI;
            const diff = shortestAngleDiffDeg(proj.angleDeg, desired);
            proj.angleDeg += clamp(diff, -9, 9);
          }
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
        const shooter = this.resolveProjectileShooter(proj);

        if (isDogfight) {
          const opp = this.getOpponentPlayer(shooter);
          if (opp && opp.alive) {
            const oppHitKey = -(opp.playerIndex ?? 2);
            const hitSet = proj.piercing ? this.piercingHitIds.get(proj.id) : undefined;
            const alreadyHit = hitSet?.has(oppHitKey) ?? false;
            const segmentHit =
              !alreadyHit &&
              opp.flashTicks <= 0 &&
              distPointToSegmentSq(
                opp.x,
                opp.y,
                proj.prevX,
                proj.prevY,
                proj.x,
                proj.y,
              ) <=
                (10 + proj.radius) * (10 + proj.radius);

            if (segmentHit) {
              if (proj.aoeRadius > 0) {
                this.detonateDogfightAoe(proj, opp);
                consumed = true;
              } else if (proj.kind === 'flakshell') {
                this.applyDamageToTargetPlayer(opp, proj.dmg, true);
                this.detonateFlakShell(proj, spawnedDuringStep);
                consumed = true;
              } else {
                this.applyDamageToTargetPlayer(opp, proj.dmg, true);
                this.spawnParticle('bullet_hit', proj.x, proj.y);
                if (proj.piercing) {
                  let set = this.piercingHitIds.get(proj.id);
                  if (!set) {
                    set = new Set<number>();
                    this.piercingHitIds.set(proj.id, set);
                  }
                  set.add(oppHitKey);
                } else {
                  consumed = true;
                }
              }
            } else if (proj.kind === 'flakshell') {
              const distToOpp = Math.hypot(proj.x - opp.x, proj.y - opp.y);
              if (distToOpp < FLAK_PROXIMITY_PX || proj.ttl <= 0) {
                this.detonateFlakShell(proj, spawnedDuringStep);
                consumed = true;
              }
            }
          } else if (proj.kind === 'flakshell' && proj.ttl <= 0) {
            this.detonateFlakShell(proj, spawnedDuringStep);
            consumed = true;
          }

          if (!consumed) {
            const bombWaterHit = proj.kind === 'bomb' && proj.y >= seaLevel;
            if (proj.aoeRadius > 0 && (proj.ttl <= 0 || bombWaterHit)) {
              if (opp && opp.alive) {
                this.detonateDogfightAoe(proj, opp);
              }
              if (bombWaterHit) {
                this.spawnParticle('splashM', proj.x, seaLevel);
              }
              consumed = true;
            }
          }
        } else {
          // PvE (Solo or 2P Co-op)
          for (const enemy of this.enemies) {
            if (!enemy.active) continue;
            if (proj.piercing && this.piercingHitIds.get(proj.id)?.has(enemy.id)) {
              continue;
            }
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
                this.detonatePlayerAoe(proj, shooter);
                consumed = true;
                break;
              } else if (proj.kind === 'flakshell') {
                this.damageEnemy(enemy, proj.dmg, 'spread', false, shooter);
                this.detonateFlakShell(proj, spawnedDuringStep);
                consumed = true;
                break;
              } else {
                const source: KillSource = proj.fromGungine
                  ? 'gungine'
                  : proj.kind === 'spreadbullet' || proj.kind === 'flakshard'
                    ? 'spread'
                    : proj.kind === 'missile'
                      ? 'missile'
                      : 'bullet';
                this.damageEnemy(enemy, proj.dmg, source, false, shooter);
                this.spawnParticle('bullet_hit', proj.x, proj.y);
                if (proj.piercing) {
                  let set = this.piercingHitIds.get(proj.id);
                  if (!set) {
                    set = new Set<number>();
                    this.piercingHitIds.set(proj.id, set);
                  }
                  set.add(enemy.id);
                } else {
                  consumed = true;
                  break;
                }
              }
            }
          }

          // Flak airburst on enemy proximity (< 48px) or TTL expiry
          if (!consumed && proj.kind === 'flakshell') {
            const nearEnemy = this.enemies.some(
              (e) => e.active && isWithinFlakProximity(proj.x, proj.y, e),
            );
            if (nearEnemy || proj.ttl <= 0) {
              this.detonateFlakShell(proj, spawnedDuringStep);
              consumed = true;
            }
          }

          // Bomb or plasmaball detonation on expiry / bomb water hit
          if (!consumed) {
            const bombWaterHit = proj.kind === 'bomb' && proj.y >= seaLevel;
            if (proj.aoeRadius > 0 && (proj.ttl <= 0 || bombWaterHit)) {
              this.detonatePlayerAoe(proj, shooter);
              if (bombWaterHit) {
                this.spawnParticle('splashM', proj.x, seaLevel);
              }
              consumed = true;
            }
          }
        }
      } else if (this.phase === 'playing') {
        const candidates = this.player2
          ? [this.player, this.player2]
          : [this.player];
        for (const pl of candidates) {
          if (!pl.alive) continue;
          if (
            pl.flashTicks <= 0 &&
            distPointToSegmentSq(
              pl.x,
              pl.y,
              proj.prevX,
              proj.prevY,
              proj.x,
              proj.y,
            ) <=
              (8 + proj.radius) * (8 + proj.radius)
          ) {
            this.applyDamageToTargetPlayer(pl, proj.dmg, true);
            this.spawnParticle('ebullet_fade', proj.x, proj.y);
            consumed = true;
            break;
          }
        }
      }

      if (!consumed && proj.ttl > 0) {
        nextList.push(proj);
      } else {
        this.piercingHitIds.delete(proj.id);
      }
    }

    for (const shard of spawnedDuringStep) {
      this.pushProjectileWithCap(nextList, shard);
    }
    this.projectiles = nextList;
  }

  private detonateFlakShell(
    proj: ProjectileEntity,
    outList: ProjectileEntity[],
  ): void {
    const ownerTag =
      proj.ownerPlayer !== undefined ? { ownerPlayer: proj.ownerPlayer } : {};
    for (let i = 0; i < FLAK_SHARD_COUNT; i++) {
      const a = proj.angleDeg + i * (360 / FLAK_SHARD_COUNT);
      const ar = (a * Math.PI) / 180;
      const shard: ProjectileEntity = {
        id: this.nextEntityId++,
        owner: 'player',
        kind: 'flakshard',
        x: proj.x,
        y: proj.y,
        prevX: proj.x,
        prevY: proj.y,
        vx: Math.cos(ar) * FLAK_SHARD_SPEED,
        vy: Math.sin(ar) * FLAK_SHARD_SPEED,
        angleDeg: a,
        ttl: FLAK_SHARD_TTL,
        maxTtl: FLAK_SHARD_TTL,
        dmg: FLAK_SHARD_DMG,
        radius: 5,
        targetId: null,
        piercing: false,
        aoeRadius: 0,
        fromGungine: false,
        ...ownerTag,
      };
      outList.push(shard);
    }
    this.emitShockwave(proj.x, proj.y, 72, 0.8, 16);
    this.emitAudio('sndspread', proj.x, proj.y);
    this.spawnParticle('explode_small', proj.x, proj.y);
    this.screenShake = Math.max(this.screenShake, 2.5);
  }

  private detonateDogfightAoe(proj: ProjectileEntity, opp: PlayerState): void {
    if (opp.alive && opp.flashTicks <= 0) {
      const dist = Math.hypot(proj.x - opp.x, proj.y - opp.y);
      if (dist <= proj.aoeRadius + 10) {
        this.applyDamageToTargetPlayer(opp, proj.dmg, true);
      }
    }
    if (proj.kind === 'plasmaball') {
      this.emitShockwave(proj.x, proj.y, 96, 0.85, 16);
      this.emitAudio('sndcannonexplo', proj.x, proj.y);
      this.spawnParticle('plasma_hit', proj.x, proj.y);
      this.screenShake = Math.max(this.screenShake, 4);
    } else {
      this.emitAudio('sndexplom', proj.x, proj.y);
      this.spawnParticle('explode_small', proj.x, proj.y);
      this.screenShake = Math.max(this.screenShake, 2.5);
    }
  }

  private detonatePlayerAoe(
    proj: ProjectileEntity,
    shooter: PlayerState,
  ): void {
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
        this.damageEnemy(enemy, proj.dmg, source, multiKill, shooter);
      }
    }

    if (proj.kind === 'plasmaball') {
      this.emitShockwave(proj.x, proj.y, 96, 0.85, 16);
      this.emitAudio('sndcannonexplo', proj.x, proj.y);
      this.spawnParticle('plasma_hit', proj.x, proj.y);
      this.screenShake = Math.max(this.screenShake, 4);
    } else {
      this.emitAudio('sndexplom', proj.x, proj.y);
      this.spawnParticle('explode_small', proj.x, proj.y);
      this.screenShake = Math.max(this.screenShake, 2.5);
    }
  }

  private checkPlayerEnemyCollisionsFor(p: PlayerState, playerSlot: 1 | 2): void {
    const body = p.bodySpec;
    const speed = Math.hypot(p.vx, p.vy);
    const isMeleeBody = body.id === 2 || body.impactrecvdmgmult === 0;
    const effectiveRecvMult =
      body.impactrecvdmgmult === 0
        ? 0
        : Math.max(body.impactrecvdmgmult, body.impactdmgmult || 0);
    const effectiveDealMult =
      (body.impactdealdmgmult || 0.25) + (body.impactdmgmult || 0);

    for (const enemy of this.enemies) {
      if (!enemy.active) continue;
      if (!isPointInEnemyHitbox(p.x, p.y, 10, enemy)) continue;

      if (enemy.kind === 'Missile') {
        const spec = getEnemySpec(this.getEnemyMap(), 'Missile');
        enemy.active = false;
        this.spawnParticle('explode_small', enemy.x, enemy.y);
        if (!isMeleeBody) {
          this.applyDamageToTargetPlayer(
            p,
            Math.max(1, (spec.damageonhit || 4) * effectiveRecvMult * 4),
            true,
          );
          this.hitstopTicks = Math.max(this.hitstopTicks, body.impactsleeptime);
          this.screenShake = Math.max(this.screenShake, body.impactcamshake);
        }
        continue;
      }

      if (isMeleeBody) {
        const graceKey = playerSlot === 1 ? enemy.id : playerSlot * 1_000_000 + enemy.id;
        if ((this.enemyRamGrace.get(graceKey) ?? 0) > 0) continue;
        this.enemyRamGrace.set(graceKey, 8);
        const ramDamage = Math.max(24, Math.round(speed * 5) + 16);
        this.damageEnemy(enemy, ramDamage, 'melee', false, p);
      } else {
        if (p.flashTicks > 0) continue;
        const selfDmg = Math.max(1, 16 * effectiveRecvMult);
        this.applyDamageToTargetPlayer(p, selfDmg, true);
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
          (1 + effectiveDealMult) *
          critBonus;
        this.damageEnemy(enemy, dealDmg, 'melee', false, p);
      }
    }
  }

  private damageEnemy(
    enemy: EnemyEntity,
    amount: number,
    source: KillSource,
    aoeOrMultiKill: boolean,
    killer: PlayerState = this.player,
  ): void {
    if (!enemy.active || amount <= 0) return;
    enemy.health -= amount;
    enemy.flashTicks = 4;

    if (enemy.health <= 0) {
      this.killEnemy(enemy, source, aoeOrMultiKill, killer);
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
    killer: PlayerState = this.player,
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

    // Act II Vampire body lifesteal (+2.5 HP on kill even while firing)
    if (killer.alive && killer.bodySpec.flags.includes('body-vampire')) {
      const prevHp = killer.health;
      killer.health = Math.min(killer.maxHealth, killer.health + VAMPIRE_LIFESTEAL_HP);
      if (killer.health > prevHp) {
        this.emitAudio('sndheal', killer.x, killer.y);
        this.spawnParticle('repair', killer.x, killer.y);
      }
    }

    if (enemy.kind === 'Blimp') {
      this.emitAudio('sndboatdie', enemy.x, enemy.y);
      this.emitAudio('sndexplom', enemy.x, enemy.y);
      this.spawnParticle('explode_big', enemy.x, enemy.y);
      this.hitstopTicks = Math.max(this.hitstopTicks, 4);
      this.screenShake = Math.max(this.screenShake, 8);
      this.profile.sfmtUnlocked = true;
    } else if (enemy.kind === 'Dreadnought' || enemy.kind === 'SkyCarrier') {
      this.emitAudio('sndboatdie', enemy.x, enemy.y);
      this.emitAudio('sndexplom', enemy.x, enemy.y);
      this.spawnParticle('explode_big', enemy.x, enemy.y);
      this.hitstopTicks = Math.max(this.hitstopTicks, 5);
      this.screenShake = Math.max(this.screenShake, 10);
      this.emitShockwave(enemy.x, enemy.y, 180, 1.0, 24);
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

  private applyDamageToTargetPlayer(
    p: PlayerState,
    amount: number,
    emitHitCue: boolean,
  ): void {
    if (!p.alive || amount <= 0) return;

    // Act II Aegis shield absorbs 1 incoming combat/collision hit every 5s (300 ticks)
    if (
      emitHitCue &&
      p.bodySpec.flags.includes('body-aegis-shield') &&
      p.shieldReady
    ) {
      p.shieldReady = false;
      p.shieldCooldown = AEGIS_SHIELD_COOLDOWN_TICKS;
      p.flashTicks = Math.max(p.flashTicks, 8);
      this.emitShockwave(p.x, p.y, 64, 0.85, 16);
      this.emitAudio('sndhealed', p.x, p.y);
      return;
    }

    p.health = Math.max(0, p.health - amount);
    if (emitHitCue) {
      p.flashTicks = Math.max(p.flashTicks, 6);
      if (p === this.player) {
        this.lastPlayerHitTick = this.tick;
      }
      this.screenShake = Math.max(this.screenShake, 3);
      this.emitAudio('sndplayerhit', p.x, p.y);
      this.spawnParticle('player_hit', p.x, p.y);
    }

    if (p.health <= 0) {
      this.killTargetPlayer(p);
    }
  }

  private killTargetPlayer(p: PlayerState): void {
    if (!p.alive) return;
    p.alive = false;
    p.healing = false;
    p.boosting = false;
    p.firing = false;

    this.emitAudio('sndplayerdie', p.x, p.y);
    this.spawnParticle('explode_big', p.x, p.y);
    this.screenShake = Math.max(this.screenShake, 8);

    const mpMode = this.getEffectiveMultiplayerMode();
    if (!this.modRegistry.isVanillaLocked() && mpMode === 'dogfight1v1') {
      return;
    }

    if (p.bodySpec.flags.includes('nuke-on-death') || p.isUrauser) {
      p.nukeTriggered = true;
      p.nukeTicks = 60;
      p.nukeRadius = 120;
      this.nukeFlashTicks = 30;
      this.screenShake = Math.max(this.screenShake, 12);
      this.emitAudio('sndnuke', p.x, p.y);
      this.emitShockwave(p.x, p.y, NUKE_MAX_RADIUS, 1.0, 28);
      this.applyNukeBlastDamageFor(p);
    }

    if (mpMode === 'coop2p' && this.player2) {
      if (p === this.player && this.player2.alive) {
        this.p1RespawnTicks = COOP_RESPAWN_TICKS;
        return;
      }
      if (p === this.player2 && this.player.alive) {
        this.p2RespawnTicks = COOP_RESPAWN_TICKS;
        return;
      }
    }

    this.enterDyingPhase();
  }

  private enterDyingPhase(): void {
    this.phase = 'dying';
    this.deathTicks = DEATH_TICKS_DURATION;
    this.finalizeSortieStats();
  }

  private updateDyingSequence(): void {
    const players = this.player2 ? [this.player, this.player2] : [this.player];
    for (const p of players) {
      if (p.nukeTriggered && p.nukeTicks > 0) {
        p.nukeTicks--;
        p.nukeRadius = Math.min(NUKE_MAX_RADIUS, p.nukeRadius + 20);
        this.applyNukeBlastDamageFor(p);
      }
    }

    this.deathTicks--;
    if (this.deathTicks <= 0) {
      this.phase = 'gameover';
      this.finalizeSortieStats();
    }
  }

  private applyNukeBlastDamageFor(p: PlayerState): void {
    for (const enemy of this.enemies) {
      if (!enemy.active) continue;
      if (isAoeHittingEnemy(p.x, p.y, p.nukeRadius, enemy)) {
        this.damageEnemy(enemy, 9999, 'nuke', true, p);
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
    if (!this.modRegistry.isVanillaLocked() && this.dailySeedId) {
      const dailyMap = { ...(this.profile.dailyHighScores ?? {}) };
      if (this.score > (dailyMap[this.dailySeedId] ?? 0)) {
        dailyMap[this.dailySeedId] = this.score;
        this.profile.dailyHighScores = dailyMap;
      }
    }
  }

  private finalizeSortieStats(): void {
    this.updateHighScores();
    if (!this.sortieFinalized) {
      this.sortieFinalized = true;
      this.profile.stats.sorties++;
    }
    const scoreDelta = this.score - this.finalizedScoreAdded;
    if (scoreDelta > 0) {
      this.profile.stats.totalScore += scoreDelta;
      this.finalizedScoreAdded = this.score;
    }
  }

  private updateShockwaves(): void {
    if (this.shockwaves.length === 0) return;
    const next: ShockwaveEvent[] = [];
    for (const sw of this.shockwaves) {
      sw.age++;
      if (sw.age < sw.maxAge) {
        const progress = sw.age / sw.maxAge;
        sw.radius = 6 + (sw.maxRadius - 6) * (1 - (1 - progress) * (1 - progress));
        next.push(sw);
      }
    }
    this.shockwaves = next;
  }

  private emitShockwave(
    x: number,
    y: number,
    maxRadius: number,
    intensity: number,
    maxAge = 18,
  ): void {
    if (this.modRegistry.isVanillaLocked()) return;
    const fx = this.modRegistry.getEffectiveShaderFx?.() ?? this.modFlags.shaderFx;
    if (!fx.shockwaves) return;
    if (this.shockwaves.length >= MAX_ACTIVE_SHOCKWAVES) {
      this.shockwaves.shift();
    }
    this.shockwaves.push({
      id: this.nextEntityId++,
      x,
      y,
      radius: 6,
      maxRadius,
      intensity,
      age: 0,
      maxAge,
    });
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

      const genericSpec = this.data.fx.generic[pt.kind];
      if (genericSpec && genericSpec.scaley < 0) {
        pt.scaleY = Math.max(0, pt.scaleY + genericSpec.scaley);
        if (pt.scaleY <= 1e-6) {
          pt.scaleY = 0;
        }
      }

      pt.frame += pt.frameSpeed;
      pt.ttl--;

      if (!pt.allowBelowSea && pt.y > seaLevel) {
        continue;
      }
      if (pt.scaleY <= 0) {
        continue;
      }
      if (pt.ttl > 0 && (pt.loop || pt.frame < pt.frameCount)) {
        next.push(pt);
      }
    }
    this.particles = next;
  }

  private pushProjectileWithCap(
    list: ProjectileEntity[],
    proj: ProjectileEntity,
  ): void {
    while (list.length >= MAX_PROJECTILES) {
      let evictIdx = 0;
      if (proj.owner === 'player') {
        const enemyIdx = list.findIndex((p) => p.owner === 'enemy');
        if (enemyIdx !== -1) {
          evictIdx = enemyIdx;
        }
      }
      const removed =
        evictIdx === 0 ? list.shift() : list.splice(evictIdx, 1)[0];
      if (removed) {
        this.piercingHitIds.delete(removed.id);
      }
    }
    list.push(proj);
  }

  private spawnProjectile(
    init: Omit<ProjectileEntity, 'id' | 'prevX' | 'prevY' | 'maxTtl'>,
  ): void {
    this.pushProjectileWithCap(this.projectiles, {
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
      const hasNegativeScaleY = genericSpec.scaley < 0;
      const defaultTtl = hasNegativeScaleY
        ? Math.max(1, Math.ceil(1 / Math.abs(genericSpec.scaley)) + 1)
        : 16;
      const ttl =
        (genericSpec.ttl > 0 ? genericSpec.ttl : defaultTtl) +
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
        scaleY: genericSpec.scaley > 0 ? genericSpec.scaley : 1,
        frame: 0,
        frameSpeed:
          (Number.isFinite(genericSpec.imagespeed)
            ? genericSpec.imagespeed
            : 0.4) +
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
    const modded = !this.modRegistry.isVanillaLocked();
    let ghostPose: GhostPose | null | undefined;
    if (modded) {
      ghostPose =
        this.modFlags.replayGhost &&
        this.ghostRunner &&
        (this.phase === 'launching' || this.phase === 'playing' || this.phase === 'dying')
          ? this.ghostRunner.sampleAtTick(this.tick)
          : null;
    }

    const baseSnapshot: SimSnapshot = {
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
      projectiles: this.projectiles.map((pr) => ({
        ...pr,
        ...(pr.arcPoints ? { arcPoints: pr.arcPoints.map((pt) => ({ ...pt })) } : {}),
      })),
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

    if (modded) {
      baseSnapshot.shockwaves = this.shockwaves.map((sw) => ({ ...sw }));
      baseSnapshot.ghostPose = ghostPose ?? null;
      baseSnapshot.player2 = this.player2
        ? { ...this.player2, loadout: { ...this.player2.loadout } }
        : null;
      baseSnapshot.dogfight = this.dogfight ? { ...this.dogfight } : null;
      baseSnapshot.activeMods = cloneModFlags(this.modFlags);
      baseSnapshot.dailySeedId = this.dailySeedId;
    }

    return baseSnapshot;
  }

  getReplay(): ReplayRecording {
    const modded = !this.modRegistry.isVanillaLocked();
    const recording: ReplayRecording = {
      seed: this.seed,
      mode: this.mode,
      loadout: { ...this.player.loadout },
      profileId: this.modRegistry.vanillaProfile.profileId,
      frames: this.replayFrames.map((f) => ({ ...f })),
      finalScore: this.score,
      finalTicks: this.tick,
    };
    if (modded) {
      recording.version = 2;
      recording.modFlags = cloneModFlags(this.modFlags);
      recording.dailyDateId = this.dailySeedId;
      recording.planeName = this.player.planeName;
    }
    return recording;
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
    const allParts: PartIndex[] = this.areCustomPartsEnabled()
      ? [0, 1, 2, 3, 4, 5, 6, 7, 8]
      : [0, 1, 2, 3, 4, 5];
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
  const effectiveRegistry = modRegistry ?? new ModRegistry(true);
  const sim = new Simulation(data, effectiveRegistry);
  if (!modRegistry && recording.modFlags?.moddedEnabled) {
    sim.setModFlags(recording.modFlags);
  }
  sim.launch(recording.loadout, recording.mode, recording.seed);
  for (const frame of recording.frames) {
    sim.step(decodeInputMask(frame.mask));
  }
  return sim.getSnapshot();
}
