export type VaultSource = 'steam-local' | 'procedural-fallback';

export type EnemyKind =
  | 'Fighter'
  | 'Jet'
  | 'Ace'
  | 'LaserAce'
  | 'Boat'
  | 'BigBoat'
  | 'Submarine'
  | 'AceMarine'
  | 'Missile'
  | 'Blimp'
  | 'Dreadnought'
  | 'SkyCarrier';

export interface EngineSpec {
  id: number;
  name: string;
  descr: string;
  sprite: string;
  booststartsprite: string;
  boostloopsprite: string;
  boostendparticle: string;
  boostidlesprite: string;
  acceleration: number;
  gravity: number;
  friction: number;
  speed: number;
  turnspeed: number;
  turnspeedboost: number;
  boostadd: number;
  waterdmg: number;
  waterdmglowhp: number;
  waterlowhpperc: number;
  wateracceleration: number;
  waterforce: number;
  spacedmg: number;
  spacedmglowhp: number;
  spacelowhpperc: number;
  spaceacceleration: number;
  spaceforce: number;
  environmentfriction: number;
  environmentmin: number;
  motionadddirection: number;
  motionaddimageangle: number;
  minimumspeed: number;
  maximumspeed: number;
  waterproof: boolean;
  flags: string;
}

export interface BodySpec {
  id: number;
  name: string;
  descr: string;
  sprite: string;
  speedmodifier: number;
  healingspd: number;
  impactrecvdmgmult: number;
  impactdealdmgmult: number;
  impactdmgmult: number;
  impactdealcritical: number;
  impactdealcriticaldmg: number;
  impactsleeptime: number;
  impactcamshake: number;
  impactspeedmult: number;
  maxhealth: number;
  meleedmg: number;
  flags: string;
}

export interface WeaponSpec {
  id: number;
  name: string;
  descr: string;
  sprite: string;
  projectile: string;
  interval: number;
  maxbullets: number;
  recoil: number;
  spread: number;
  numbullets: number;
  flags: string;
}

export interface PlayerSettingsSpec {
  body: string;
  engine: string;
  weapon: string;
  canshoot: boolean;
  meleedmg: number;
  waterrotationforcedegrees: number;
}

export interface PlayerDataSpec {
  settings: PlayerSettingsSpec;
  engines: Record<string, EngineSpec>;
  bodyparts: Record<string, BodySpec>;
  weapons: Record<string, WeaponSpec>;
  enginesById: EngineSpec[];
  bodiesById: BodySpec[];
  weaponsById: WeaponSpec[];
}

export interface ProjectileSpec {
  id: string;
  ttl: number;
  dmg: number;
  speed: number;
  degreesoffset: number;
  sfxfire: string;
  flags: string;
}

export interface EnemySpec {
  key: string;
  name: string;
  bodysprite?: string;
  wingssprite?: string;
  sprite?: string;
  spritegun?: string;
  difficultyweight: number;
  health: number;
  initvelocity: number;
  velocityvariance: number;
  gravity: number;
  friction: number;
  constantforce: number;
  environmentaldmg: number;
  environmentalyforce: number;
  reaction: number;
  reactionvariance: number;
  turnvariance: number;
  turnspeedvariance: number;
  minspeed: number;
  maxspeed: number;
  initmaxspeed: number;
  minspeedvariance: number;
  maxspeedvariance: number;
  speed: number;
  maxvspeed: number;
  vspeedthrottler: number;
  constantplayerchaseforce: number;
  turndistance: number;
  turndistancerand: number;
  fireinterval: number;
  fireintervalrand: number;
  minfiredist: number;
  bulletspeed: number;
  boostdstplayer: number;
  boostdstspeed: number;
  airethinktimer: number;
  airethinktimerrand: number;
  reactionseaheighta: number;
  reactionseaheightb: number;
  reactionspaceheightoffseta: number;
  reactionspaceheightoffsetb: number;
  reactionchangea: number;
  reactionchangeb: number;
  initbulletspersalvo: number;
  bulletspersalvo: number;
  bulletfireinterval: number;
  firesalvotimer: number;
  firesalvotimerrand: number;
  salvofirelimiterperboatmultiplier: number;
  gunrotationspeed: number;
  surfacetimer: number;
  sinkingtimer: number;
  sinkingspeed: number;
  firstacelaunchinterval: number;
  acelaunchinterval: number;
  projectilefireinterval: number;
  lifetime: number;
  activationtimer: number;
  damageonhit: number;
  spawnceilingoffset: number;
  spawnfallspeed: number;
  fallnumframes: number;
}

export interface SpawnDifficultyStep {
  add: number;
  max: number;
}

export interface SpawnListTier {
  difficulty: number;
  choose: EnemyKind[];
}

export interface SpawnCoordinatorSpec {
  initialDifficulty: number;
  maxPercentageBoats: number;
  maxNumAcePerDifficultyPerc: number;
  maxNumBlimpsPerDifficultyPerc: number;
  aceToLaserAceChance: number;
  minNumSubmarineKillsForAceMarine: number;
  submarineToAceMarineChance: number;
  increaseDifficulty: SpawnDifficultyStep[];
  spawnlist: SpawnListTier[];
}

export interface MissionSpec {
  id: number;
  component: [number, number, number];
  objective: number;
  condition: number;
  val: [number, number];
  title: string;
  description: string;
}

export interface PlaneNameEntry {
  name: string;
  weapon: number;
  body: number;
  engine: number;
}

export interface GlobalDataSpec {
  customizetypes: {
    engine: Record<string, number>;
    body: Record<string, number>;
    weapon: Record<string, number>;
  };
  missions: MissionSpec[];
  planenames: PlaneNameEntry[];
}

export interface FxParticleSpec {
  key: string;
  spritename: string;
  depth: number;
  imagespeed: number;
  imagespeedrand: number;
  friction: number;
  vspeed: number;
  vspeedrand: number;
  imageanglerand: number;
  initvelocity: number;
  initvelocityrand: number;
  loop: boolean;
  allowbelowsea: boolean;
  ttl: number;
  ttlrand: number;
  scaley: number;
}

export interface ExplosionSpec {
  key: string;
  spritename: string;
  depth: number;
  imageanglerand: number;
  initsubspritename: string;
  numinitsubsprites: number;
  initsubspritesrandpos: number;
  shake: number;
  randspawn: number;
  randspawnspritename: string;
  splashchance: number;
  splashspritename: string;
  floatwater: boolean;
  playerdmg: number;
  playerburn: number;
  fadespawnchance: number;
  fadespawnspritename: string;
  collisions: boolean;
}

export interface FxDataSpec {
  generic: Record<string, FxParticleSpec>;
  explosions: Record<string, ExplosionSpec>;
}

export interface ParallaxStageSpec {
  stage: number;
  minimumDifficulty: number;
  timerID?: number;
  timer?: number;
  spawn: string[];
}

export interface ParallaxDataSpec {
  timer0: number;
  timer0subtrmult: number;
  stages: ParallaxStageSpec[];
}

export interface RoomSettingsSpec {
  sealevel: number;
  spacelevel: number;
}

export interface SpriteFrame {
  x: number;
  y: number;
}

export interface SpriteEntry {
  name: string;
  size: [number, number];
  hull: [number, number, number, number];
  center: [number, number];
  subs: SpriteFrame[];
}

export interface SpriteAtlasSpec {
  name: string;
  texturePath: string;
  width: number;
  height: number;
  sprites: Record<string, SpriteEntry>;
}

export interface BitmapFontGlyph {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  xoffset: number;
  yoffset: number;
  xadvance: number;
}

export interface BitmapFontSpec {
  name: string;
  face: string;
  size: number;
  lineHeight: number;
  base: number;
  scaleW: number;
  scaleH: number;
  pageFile: string;
  glyphs: Record<number, BitmapFontGlyph>;
}

export interface DecodedTexture {
  name: string;
  width: number;
  height: number;
  rgba: Uint8Array;
  source: 'steam-tga' | 'procedural';
}

export interface GameDataBundle {
  vaultSource: VaultSource;
  steamDir: string | null;
  player: PlayerDataSpec;
  projectiles: Record<string, ProjectileSpec>;
  enemies: Record<string, EnemySpec>;
  enemiesSfmt: Record<string, EnemySpec>;
  spawnCoordinator: SpawnCoordinatorSpec;
  spawnCoordinatorSfmt: SpawnCoordinatorSpec;
  global: GlobalDataSpec;
  fx: FxDataSpec;
  parallax: ParallaxDataSpec;
  room: RoomSettingsSpec;
  atlases: {
    sprites: SpriteAtlasSpec;
    menusprites: SpriteAtlasSpec;
    nukesprites: SpriteAtlasSpec;
  };
  fonts: Record<string, BitmapFontSpec>;
}

export interface AudioAssetManifest {
  source: VaultSource;
  bgm: Record<string, string | null>;
  sfx: Record<string, string | null>;
}

export interface VaultAssetBundle {
  data: GameDataBundle;
  textures: Record<string, DecodedTexture>;
  audioManifest: AudioAssetManifest;
}

export interface IVaultLoader {
  load(): Promise<VaultAssetBundle>;
}
