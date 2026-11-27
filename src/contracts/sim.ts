import type {
  BodySpec,
  EnemyKind,
  EngineSpec,
  GameDataBundle,
  MissionSpec,
  WeaponSpec,
} from './vault';
import type { AudioCueId } from './audio';
import type { Act2ModFlags } from './mod';

export type PartIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type GameMode = 'normal' | 'sfmt';
export type SimPhase = 'hangar' | 'launching' | 'playing' | 'dying' | 'gameover';

export interface Loadout {
  weapon: PartIndex;
  body: PartIndex;
  engine: PartIndex;
}

export interface InputState {
  left: boolean;
  right: boolean;
  thrust: boolean;
  fire: boolean;
}

export interface PlayerState {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  angleDeg: number;
  prevAngleDeg: number;
  health: number;
  maxHealth: number;
  alive: boolean;
  boosting: boolean;
  wasBoosting: boolean;
  firing: boolean;
  healing: boolean;
  healingTicks: number;
  underwater: boolean;
  inSpace: boolean;
  fireCooldown: number;
  gungineCooldown: number;
  bombCooldown: number;
  flashTicks: number;
  burnTicks: number;
  envWaterFactor: number;
  envSpaceFactor: number;
  nukeTriggered: boolean;
  nukeRadius: number;
  nukeTicks: number;
  isUrauser: boolean;
  loadout: Loadout;
  planeName: string;
  engineSpec: EngineSpec;
  bodySpec: BodySpec;
  weaponSpec: WeaponSpec;
  boostAnimFrame: number;
  /** Act II Aegis shield availability */
  shieldReady?: boolean;
  /** Act II Aegis shield recharge ticks remaining */
  shieldCooldown?: number;
  /** Player slot identifier (1 = P1, 2 = P2 in Co-op/Dogfight) */
  playerIndex?: 1 | 2;
}

export interface EnemyEntity {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  angleDeg: number;
  gunAngleDeg: number;
  health: number;
  maxHealth: number;
  active: boolean;
  state: 'cruise' | 'chase' | 'surfacing' | 'submerging' | 'sinking' | 'falling' | 'firing';
  aiTimer: number;
  fireTimer: number;
  salvoRemaining: number;
  salvoCooldown: number;
  surfaceTimer: number;
  fallFrames: number;
  lifetime: number;
  activationTimer: number;
  flashTicks: number;
  hitRadius: number;
  width: number;
  height: number;
  scoreValue: number;
  difficultyWeight: number;
  spriteMain: string;
  spriteSecondary?: string;
  spriteGun?: string;
  laserActive: boolean;
  laserLength: number;
  /** Countdown ticks while LaserAce charges its beam before firing (renders laser_charge telegraph) */
  laserChargeTicks?: number;
  /** Countdown ticks after a naval/blimp turret fires (10 -> 0) for 6-frame recoil animation */
  gunRecoilTicks?: number;
  /** 0..5 sprite sub-frame index for small_boat_gun / big_boat_gun recoil animation */
  gunAnimFrame?: number;
  /** Optional visual boost indicator for Ace/LaserAce thruster animation */
  boosting?: boolean;
  /** Optional Act II boss squadron / carrier spawn timer */
  squadronId?: number;
  carrierLaunchTimer?: number;
}

export type ProjectileKind =
  | 'bullet'
  | 'laser'
  | 'spreadbullet'
  | 'missile'
  | 'plasmaball'
  | 'bomb'
  | 'ebullet'
  | 'elaser'
  | 'artillery'
  | 'railslug'
  | 'flakshell'
  | 'flakshard'
  | 'lightningarc';

export interface ProjectileEntity {
  id: number;
  owner: 'player' | 'enemy';
  kind: ProjectileKind;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  angleDeg: number;
  ttl: number;
  maxTtl: number;
  dmg: number;
  radius: number;
  targetId: number | null;
  piercing: boolean;
  aoeRadius: number;
  fromGungine: boolean;
  beamLength?: number;
  /** Act II Chain Lightning polyline nodes */
  arcPoints?: readonly { x: number; y: number }[];
  /** Act II multiplayer projectile owner (1 = P1, 2 = P2) */
  ownerPlayer?: 1 | 2;
}

export interface ParticleEntity {
  id: number;
  kind: string;
  spriteName: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angleDeg: number;
  scaleX: number;
  scaleY: number;
  frame: number;
  frameSpeed: number;
  frameCount: number;
  ttl: number;
  maxTtl: number;
  depth: number;
  loop: boolean;
  allowBelowSea: boolean;
  friction: number;
  gravity: number;
  isExplosion: boolean;
}

export interface ParallaxEntity {
  id: number;
  kind: string;
  spriteName: string;
  x: number;
  y: number;
  vx: number;
  reversed: boolean;
  depth: number;
  frame: number;
  /** Optional pitch angle (degrees) for distant swooping aircraft silhouettes */
  angleDeg?: number;
}

export interface ShockwaveEvent {
  id: number;
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  intensity: number;
  age: number;
  maxAge: number;
}

export interface GhostPose {
  x: number;
  y: number;
  angleDeg: number;
  boosting: boolean;
  alive: boolean;
  loadout: Loadout;
  trail: readonly { x: number; y: number }[];
  scoreAtTick: number;
}

export interface DogfightState {
  p1Wins: number;
  p2Wins: number;
  round: number;
  bestOf: number;
  roundBannerTicks: number;
  winner: 1 | 2 | null;
  lastScorer: 1 | 2 | null;
}

export interface SimAudioEvent {
  cue: AudioCueId;
  x?: number;
  y?: number;
  volume?: number;
  pitch?: number;
}

export interface MissionProgressState {
  missionId: number;
  completed: boolean;
  current: number;
  target: number;
}

export interface PilotProfile {
  version: number;
  unlockedWeapons: PartIndex[];
  unlockedBodies: PartIndex[];
  unlockedEngines: PartIndex[];
  completedMissions: number[];
  activeMissionIds: number[];
  highScoreNormal: number;
  highScoreSfmt: number;
  selectedPaletteId: string;
  sfmtUnlocked: boolean;
  lastLoadout: Loadout;
  lastMode: GameMode;
  lastSeed: number;
  totalKills: Record<string, number>;
  stats: {
    sorties: number;
    totalScore: number;
    bestCombo: number;
  };
  /** Act II optional persisted daily high scores keyed by YYYYMMDD */
  dailyHighScores?: Record<string, number>;
}

export interface ReplayFrame {
  tick: number;
  mask: number; // bit0=left, bit1=right, bit2=thrust, bit3=fire
}

export interface ReplayRecording {
  seed: number;
  mode: GameMode;
  loadout: Loadout;
  profileId: string;
  frames: ReplayFrame[];
  finalScore: number;
  finalTicks: number;
  version?: number;
  modFlags?: Act2ModFlags;
  dailyDateId?: string | null;
  planeName?: string;
  assistMode?: boolean;
}

export interface SimSnapshot {
  tick: number;
  phase: SimPhase;
  mode: GameMode;
  paused: boolean;
  hitstopTicks: number;
  screenShake: number;
  nukeFlashTicks: number;
  launchTicks: number;
  /** World Y coordinate of the allied launch carrier submarine while surfaced/submerging at x=0 */
  launchSubY?: number;
  deathTicks: number;
  score: number;
  combo: number;
  comboTimer: number;
  comboMaxTimer: number;
  comboWarning: boolean;
  difficulty: number;
  killsThisSortie: number;
  killsByKind: Record<string, number>;
  player: PlayerState;
  enemies: readonly EnemyEntity[];
  projectiles: readonly ProjectileEntity[];
  particles: readonly ParticleEntity[];
  parallax: readonly ParallaxEntity[];
  cameraTargetX: number;
  cameraTargetY: number;
  audioEvents: readonly SimAudioEvent[];
  completedMissionsThisSortie: readonly number[];
  activeMissions: readonly MissionSpec[];
  missionProgress: Record<number, MissionProgressState>;
  profile: PilotProfile;
  seaLevel: number;
  spaceLevel: number;
  autopilotEnabled: boolean;
  seed: number;
  /** Act II screen-space shockwaves (active only when modded shaderFx.shockwaves enabled) */
  shockwaves?: readonly ShockwaveEvent[];
  /** Act II synchronized PB ghost silhouette */
  ghostPose?: GhostPose | null;
  /** Act II Player 2 state in Co-op / 1v1 Dogfight */
  player2?: PlayerState | null;
  /** Act II 1v1 Dogfight Arena state */
  dogfight?: DogfightState | null;
  /** Active Act II mod flags snapshot */
  activeMods?: Act2ModFlags;
  /** Daily Seed identifier (YYYYMMDD) when Daily Seed sortie active */
  dailySeedId?: string | null;
  /** Accessible Assist Mode flag (reduced damage, extended i-frames, forgiving healing) */
  assistMode?: boolean;
}

export interface ISimulation {
  step(input: InputState): SimSnapshot;
  step2P?(p1Input: InputState, p2Input: InputState): SimSnapshot;
  launch(loadout: Loadout, mode: GameMode, seed?: number): void;
  returnToHangar(): void;
  setLoadout(loadout: Loadout): void;
  setMode(mode: GameMode): void;
  setAssistMode?(enabled: boolean): void;
  isAssistMode?(): boolean;
  setPaused(paused: boolean): void;
  setAutopilot(enabled: boolean): void;
  damagePlayer(amount: number): void;
  spawnEnemy(kind: EnemyKind, x?: number, y?: number): EnemyEntity;
  getSnapshot(): SimSnapshot;
  getReplay(): ReplayRecording;
  getProfile(): PilotProfile;
  setProfile(profile: PilotProfile): void;
  resetProfile(): void;
  unlockAll(): void;
  setModFlags?(flags: Partial<Act2ModFlags>): void;
  getModFlags?(): Act2ModFlags;
  setGhostReplay?(replay: ReplayRecording | null): void;
  getDailySeed?(date?: Date): { dateId: string; seed: number };
  setP2Loadout?(loadout: Loadout): void;
  getP2Loadout?(): Loadout;
  setGameData?(data: GameDataBundle): void;
}
