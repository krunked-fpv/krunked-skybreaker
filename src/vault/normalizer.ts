import type {
  BodySpec,
  EnemyKind,
  EnemySpec,
  EngineSpec,
  ExplosionSpec,
  FxDataSpec,
  FxParticleSpec,
  GlobalDataSpec,
  MissionSpec,
  ParallaxDataSpec,
  ParallaxStageSpec,
  PlaneNameEntry,
  PlayerDataSpec,
  PlayerSettingsSpec,
  ProjectileSpec,
  RoomSettingsSpec,
  SpawnCoordinatorSpec,
  SpawnDifficultyStep,
  SpawnListTier,
  SpriteAtlasSpec,
  SpriteEntry,
  SpriteFrame,
  WeaponSpec,
} from '../contracts/vault';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

/**
 * Builds a lowercase-keyed lookup map for case-insensitive JSONCPP property access.
 */
export function buildLowerKeyMap(obj: unknown): Map<string, unknown> {
  const rec = asRecord(obj);
  const map = new Map<string, unknown>();
  for (const [k, v] of Object.entries(rec)) {
    map.set(k.toLowerCase(), v);
  }
  return map;
}

/**
 * Case-insensitive property lookup helper for JSONCPP objects
 * (handles `fireInterval`/`fireinterval`, `reactionseaHeightB`/`reactionseaheightB`,
 * `environmentalYforce`/`environmentalyforce`, etc.).
 */
export function getKeyCI<T>(obj: unknown, key: string, fallback: T): T {
  const rec = asRecord(obj);
  if (key in rec && rec[key] !== undefined) {
    return rec[key] as T;
  }
  const target = key.toLowerCase();
  for (const [k, v] of Object.entries(rec)) {
    if (k.toLowerCase() === target && v !== undefined) {
      return v as T;
    }
  }
  return fallback;
}

function readNumber(map: Map<string, unknown>, key: string, fallback: number): number {
  const val = map.get(key.toLowerCase());
  if (typeof val === 'number' && Number.isFinite(val)) {
    return val === 0 ? 0 : val;
  }
  return fallback;
}

function readString(map: Map<string, unknown>, key: string, fallback: string): string {
  const val = map.get(key.toLowerCase());
  return typeof val === 'string' ? val : fallback;
}

function readOptionalString(map: Map<string, unknown>, key: string): string | undefined {
  const val = map.get(key.toLowerCase());
  return typeof val === 'string' ? val : undefined;
}

function readBoolean(map: Map<string, unknown>, key: string, fallback: boolean): boolean {
  const val = map.get(key.toLowerCase());
  return typeof val === 'boolean' ? val : fallback;
}

function normalizeEngineEntry(raw: unknown, base: EngineSpec): EngineSpec {
  const m = buildLowerKeyMap(raw);
  return {
    id: readNumber(m, 'id', base.id),
    name: readString(m, 'name', base.name),
    descr: readString(m, 'descr', base.descr),
    sprite: readString(m, 'sprite', base.sprite),
    booststartsprite: readString(m, 'booststartsprite', base.booststartsprite),
    boostloopsprite: readString(m, 'boostloopsprite', base.boostloopsprite),
    boostendparticle: readString(m, 'boostendparticle', base.boostendparticle),
    boostidlesprite: readString(m, 'boostidlesprite', base.boostidlesprite),
    acceleration: readNumber(m, 'acceleration', base.acceleration),
    gravity: readNumber(m, 'gravity', base.gravity),
    friction: readNumber(m, 'friction', base.friction),
    speed: readNumber(m, 'speed', base.speed),
    turnspeed: readNumber(m, 'turnspeed', base.turnspeed),
    turnspeedboost: readNumber(m, 'turnspeedboost', base.turnspeedboost),
    boostadd: readNumber(m, 'boostadd', base.boostadd),
    waterdmg: readNumber(m, 'waterdmg', base.waterdmg),
    waterdmglowhp: readNumber(m, 'waterdmglowhp', base.waterdmglowhp),
    waterlowhpperc: readNumber(m, 'waterlowhpperc', base.waterlowhpperc),
    wateracceleration: readNumber(m, 'wateracceleration', base.wateracceleration),
    waterforce: readNumber(m, 'waterforce', base.waterforce),
    spacedmg: readNumber(m, 'spacedmg', base.spacedmg),
    spacedmglowhp: readNumber(m, 'spacedmglowhp', base.spacedmglowhp),
    spacelowhpperc: readNumber(m, 'spacelowhpperc', base.spacelowhpperc),
    spaceacceleration: readNumber(m, 'spaceacceleration', base.spaceacceleration),
    spaceforce: readNumber(m, 'spaceforce', base.spaceforce),
    environmentfriction: readNumber(m, 'environmentfriction', base.environmentfriction),
    environmentmin: readNumber(m, 'environmentmin', base.environmentmin),
    motionadddirection: readNumber(m, 'motionadddirection', base.motionadddirection),
    motionaddimageangle: readNumber(m, 'motionaddimageangle', base.motionaddimageangle),
    minimumspeed: readNumber(m, 'minimumspeed', base.minimumspeed),
    maximumspeed: readNumber(m, 'maximumspeed', base.maximumspeed),
    waterproof: readBoolean(m, 'waterproof', base.waterproof),
    flags: readString(m, 'flags', base.flags),
  };
}

function normalizeBodyEntry(raw: unknown, base: BodySpec): BodySpec {
  const m = buildLowerKeyMap(raw);
  return {
    id: readNumber(m, 'id', base.id),
    name: readString(m, 'name', base.name),
    descr: readString(m, 'descr', base.descr),
    sprite: readString(m, 'sprite', base.sprite),
    speedmodifier: readNumber(m, 'speedmodifier', base.speedmodifier),
    healingspd: readNumber(m, 'healingspd', base.healingspd),
    impactrecvdmgmult: readNumber(m, 'impactrecvdmgmult', base.impactrecvdmgmult),
    impactdealdmgmult: readNumber(m, 'impactdealdmgmult', base.impactdealdmgmult),
    impactdmgmult: readNumber(m, 'impactdmgmult', base.impactdmgmult),
    impactdealcritical: readNumber(m, 'impactdealcritical', base.impactdealcritical),
    impactdealcriticaldmg: readNumber(m, 'impactdealcriticaldmg', base.impactdealcriticaldmg),
    impactsleeptime: readNumber(m, 'impactsleeptime', base.impactsleeptime),
    impactcamshake: readNumber(m, 'impactcamshake', base.impactcamshake),
    impactspeedmult: readNumber(m, 'impactspeedmult', base.impactspeedmult),
    maxhealth: readNumber(m, 'maxhealth', base.maxhealth),
    meleedmg: readNumber(m, 'meleedmg', base.meleedmg),
    flags: readString(m, 'flags', base.flags),
  };
}

function normalizeWeaponEntry(raw: unknown, base: WeaponSpec): WeaponSpec {
  const m = buildLowerKeyMap(raw);
  return {
    id: readNumber(m, 'id', base.id),
    name: readString(m, 'name', base.name),
    descr: readString(m, 'descr', base.descr),
    sprite: readString(m, 'sprite', base.sprite),
    projectile: readString(m, 'projectile', base.projectile),
    interval: readNumber(m, 'interval', base.interval),
    maxbullets: readNumber(m, 'maxbullets', base.maxbullets),
    recoil: readNumber(m, 'recoil', base.recoil),
    spread: readNumber(m, 'spread', base.spread),
    numbullets: readNumber(m, 'numbullets', base.numbullets),
    flags: readString(m, 'flags', base.flags),
  };
}

const DEFAULT_ENGINE_BASE: EngineSpec = {
  id: 0,
  name: 'original',
  descr: 'well-balanced engine',
  sprite: 'engine_original',
  booststartsprite: 'fx_booststart',
  boostloopsprite: 'fx_boostloop',
  boostendparticle: 'boostend',
  boostidlesprite: '',
  acceleration: 1.5,
  gravity: 0.2,
  friction: 0.04,
  speed: 8,
  turnspeed: 10,
  turnspeedboost: 4,
  boostadd: 0,
  waterdmg: 0.4,
  waterdmglowhp: 0.05,
  waterlowhpperc: 0.333333,
  wateracceleration: 0.1,
  waterforce: 0.3,
  spacedmg: 0.4,
  spacedmglowhp: 0.05,
  spacelowhpperc: 0.333333,
  spaceacceleration: 0.1,
  spaceforce: 0.3,
  environmentfriction: 0.8,
  environmentmin: 0.1,
  motionadddirection: 0.03,
  motionaddimageangle: 0.01,
  minimumspeed: 0,
  maximumspeed: 8,
  waterproof: false,
  flags: '',
};

const DEFAULT_WEAPON_BASE: WeaponSpec = {
  id: 0,
  name: 'original',
  descr: 'versatile machinegun',
  sprite: 'wings_original',
  projectile: 'bullet',
  interval: 3,
  maxbullets: 1337,
  recoil: 0,
  spread: 1,
  numbullets: 1,
  flags: '',
};

/**
 * Normalizes `player.json`, inheriting all omitted fields from `"original"` (`id: 0`)
 * for engines `1..5`, bodyparts `1..5`, and weapons `1..5`, and populating sorted `*ById` arrays.
 */
export function normalizePlayerData(raw: unknown): PlayerDataSpec {
  const root = buildLowerKeyMap(raw);
  const rawSettings = buildLowerKeyMap(root.get('settings'));
  const settings: PlayerSettingsSpec = {
    body: readString(rawSettings, 'body', 'original'),
    engine: readString(rawSettings, 'engine', 'original'),
    weapon: readString(rawSettings, 'weapon', 'original'),
    canshoot: readBoolean(rawSettings, 'canshoot', true),
    meleedmg: readNumber(rawSettings, 'meleedmg', 10000),
    waterrotationforcedegrees: readNumber(rawSettings, 'waterrotationforcedegrees', 3),
  };

  const defaultBodyBase: BodySpec = {
    id: 0,
    name: 'original',
    descr: 'good all-round body',
    sprite: 'body_original',
    speedmodifier: 1.0,
    healingspd: 0.16,
    impactrecvdmgmult: 0.125,
    impactdealdmgmult: 0.25,
    impactdmgmult: 0,
    impactdealcritical: 10,
    impactdealcriticaldmg: 0.5,
    impactsleeptime: 10,
    impactcamshake: 2,
    impactspeedmult: 0.9,
    maxhealth: 16,
    meleedmg: settings.meleedmg,
    flags: '',
  };

  const rawEngines = asRecord(root.get('engines'));
  const rawBodies = asRecord(root.get('bodyparts'));
  const rawWeapons = asRecord(root.get('weapons'));

  const originalEngine = normalizeEngineEntry(
    getKeyCI(rawEngines, 'original', {}),
    DEFAULT_ENGINE_BASE,
  );
  const engines: Record<string, EngineSpec> = {};
  for (const [key, entry] of Object.entries(rawEngines)) {
    engines[key] =
      key.toLowerCase() === 'original'
        ? originalEngine
        : normalizeEngineEntry(entry, originalEngine);
  }

  const originalBody = normalizeBodyEntry(getKeyCI(rawBodies, 'original', {}), defaultBodyBase);
  const bodyparts: Record<string, BodySpec> = {};
  for (const [key, entry] of Object.entries(rawBodies)) {
    bodyparts[key] =
      key.toLowerCase() === 'original' ? originalBody : normalizeBodyEntry(entry, originalBody);
  }

  const originalWeapon = normalizeWeaponEntry(
    getKeyCI(rawWeapons, 'original', {}),
    DEFAULT_WEAPON_BASE,
  );
  const weapons: Record<string, WeaponSpec> = {};
  for (const [key, entry] of Object.entries(rawWeapons)) {
    weapons[key] =
      key.toLowerCase() === 'original'
        ? originalWeapon
        : normalizeWeaponEntry(entry, originalWeapon);
  }

  const enginesById = Object.values(engines).sort((a, b) => a.id - b.id);
  const bodiesById = Object.values(bodyparts).sort((a, b) => a.id - b.id);
  const weaponsById = Object.values(weapons).sort((a, b) => a.id - b.id);

  return {
    settings,
    engines,
    bodyparts,
    weapons,
    enginesById,
    bodiesById,
    weaponsById,
  };
}

/**
 * Normalizes `enemies.json` or `enemies_sfmt.json` into lowercase-canonical `EnemySpec` records.
 */
export function normalizeEnemiesData(raw: unknown): Record<string, EnemySpec> {
  const root = asRecord(raw);
  const out: Record<string, EnemySpec> = {};

  for (const [key, value] of Object.entries(root)) {
    const m = buildLowerKeyMap(value);
    const bodysprite = readOptionalString(m, 'bodysprite');
    const wingssprite = readOptionalString(m, 'wingssprite');
    const sprite = readOptionalString(m, 'sprite');
    const spritegun = readOptionalString(m, 'spritegun');

    out[key] = {
      key,
      name: readString(m, 'name', key),
      ...(bodysprite !== undefined ? { bodysprite } : {}),
      ...(wingssprite !== undefined ? { wingssprite } : {}),
      ...(sprite !== undefined ? { sprite } : {}),
      ...(spritegun !== undefined ? { spritegun } : {}),
      difficultyweight: readNumber(m, 'difficultyweight', 0),
      health: readNumber(m, 'health', 0),
      initvelocity: readNumber(m, 'initvelocity', 0),
      velocityvariance: readNumber(m, 'velocityvariance', 0),
      gravity: readNumber(m, 'gravity', 0),
      friction: readNumber(m, 'friction', 0),
      constantforce: readNumber(m, 'constantforce', 0),
      environmentaldmg: readNumber(m, 'environmentaldmg', 0),
      environmentalyforce: readNumber(m, 'environmentalyforce', 0),
      reaction: readNumber(m, 'reaction', 0),
      reactionvariance: readNumber(m, 'reactionvariance', 0),
      turnvariance: readNumber(m, 'turnvariance', 0),
      turnspeedvariance: readNumber(m, 'turnspeedvariance', 0),
      minspeed: readNumber(m, 'minspeed', 0),
      maxspeed: readNumber(m, 'maxspeed', 0),
      initmaxspeed: readNumber(m, 'initmaxspeed', 0),
      minspeedvariance: readNumber(m, 'minspeedvariance', 0),
      maxspeedvariance: readNumber(m, 'maxspeedvariance', 0),
      speed: readNumber(m, 'speed', 0),
      maxvspeed: readNumber(m, 'maxvspeed', 0),
      vspeedthrottler: readNumber(m, 'vspeedthrottler', 0),
      constantplayerchaseforce: readNumber(m, 'constantplayerchaseforce', 0),
      turndistance: readNumber(m, 'turndistance', 0),
      turndistancerand: readNumber(m, 'turndistancerand', 0),
      fireinterval: readNumber(m, 'fireinterval', 0),
      fireintervalrand: readNumber(m, 'fireintervalrand', 0),
      minfiredist: readNumber(m, 'minfiredist', 0),
      bulletspeed: readNumber(m, 'bulletspeed', 0),
      boostdstplayer: readNumber(m, 'boostdstplayer', 0),
      boostdstspeed: readNumber(m, 'boostdstspeed', 0),
      airethinktimer: readNumber(m, 'airethinktimer', 0),
      airethinktimerrand: readNumber(m, 'airethinktimerrand', 0),
      reactionseaheighta: readNumber(m, 'reactionseaheighta', 0),
      reactionseaheightb: readNumber(m, 'reactionseaheightb', 0),
      reactionspaceheightoffseta: readNumber(m, 'reactionspaceheightoffseta', 0),
      reactionspaceheightoffsetb: readNumber(m, 'reactionspaceheightoffsetb', 0),
      reactionchangea: readNumber(m, 'reactionchangea', 0),
      reactionchangeb: readNumber(m, 'reactionchangeb', 0),
      initbulletspersalvo: readNumber(m, 'initbulletspersalvo', 0),
      bulletspersalvo: readNumber(m, 'bulletspersalvo', 0),
      bulletfireinterval: readNumber(m, 'bulletfireinterval', 0),
      firesalvotimer: readNumber(m, 'firesalvotimer', 0),
      firesalvotimerrand: readNumber(m, 'firesalvotimerrand', 0),
      salvofirelimiterperboatmultiplier: readNumber(m, 'salvofirelimiterperboatmultiplier', 0),
      gunrotationspeed: readNumber(m, 'gunrotationspeed', 0),
      surfacetimer: readNumber(m, 'surfacetimer', 0),
      sinkingtimer: readNumber(m, 'sinkingtimer', 0),
      sinkingspeed: readNumber(m, 'sinkingspeed', 0),
      firstacelaunchinterval: readNumber(m, 'firstacelaunchinterval', 0),
      acelaunchinterval: readNumber(m, 'acelaunchinterval', 0),
      projectilefireinterval: readNumber(m, 'projectilefireinterval', 0),
      lifetime: readNumber(m, 'lifetime', 0),
      activationtimer: readNumber(m, 'activationtimer', 0),
      damageonhit: readNumber(m, 'damageonhit', 0),
      spawnceilingoffset: readNumber(m, 'spawnceilingoffset', 0),
      spawnfallspeed: readNumber(m, 'spawnfallspeed', 0),
      fallnumframes: readNumber(m, 'fallnumframes', 0),
    };
  }

  return out;
}

/**
 * Normalizes `projectiles.json`.
 */
export function normalizeProjectilesData(raw: unknown): Record<string, ProjectileSpec> {
  const root = asRecord(raw);
  const out: Record<string, ProjectileSpec> = {};

  for (const [key, value] of Object.entries(root)) {
    const m = buildLowerKeyMap(value);
    out[key] = {
      id: key,
      ttl: readNumber(m, 'ttl', 60),
      dmg: readNumber(m, 'dmg', 1),
      speed: readNumber(m, 'speed', 0),
      degreesoffset: readNumber(m, 'degreesoffset', 0),
      sfxfire: readString(m, 'sfxfire', '').trim(),
      flags: readString(m, 'flags', '').trim(),
    };
  }

  return out;
}

/**
 * Normalizes `spawncoordinator.json` or `spawncoordinator_sfmt.json`.
 */
export function normalizeSpawnCoordinator(raw: unknown): SpawnCoordinatorSpec {
  const m = buildLowerKeyMap(raw);
  const rawSteps = Array.isArray(m.get('increasedifficulty'))
    ? (m.get('increasedifficulty') as unknown[])
    : [];
  const rawSpawnList = Array.isArray(m.get('spawnlist'))
    ? (m.get('spawnlist') as unknown[])
    : [];

  const increaseDifficulty: SpawnDifficultyStep[] = rawSteps.map((step) => {
    const sm = buildLowerKeyMap(step);
    return {
      add: readNumber(sm, 'add', 1),
      max: readNumber(sm, 'max', 99999999),
    };
  });

  const spawnlist: SpawnListTier[] = rawSpawnList.map((tier) => {
    const tm = buildLowerKeyMap(tier);
    const chooseRaw = tm.get('choose');
    const choose = Array.isArray(chooseRaw)
      ? chooseRaw.filter((x): x is EnemyKind => typeof x === 'string')
      : [];
    return {
      difficulty: readNumber(tm, 'difficulty', -1),
      choose,
    };
  });

  return {
    initialDifficulty: readNumber(m, 'initialdifficulty', 60),
    maxPercentageBoats: readNumber(m, 'maxpercentageboats', 0.5),
    maxNumAcePerDifficultyPerc: readNumber(m, 'maxnumaceperdifficultyperc', 0.002),
    maxNumBlimpsPerDifficultyPerc: readNumber(m, 'maxnumblimpsperdifficultyperc', 0.001),
    aceToLaserAceChance: readNumber(m, 'acetolaseracechance', 0.016667),
    minNumSubmarineKillsForAceMarine: readNumber(m, 'minnumsubmarinekillsforacemarine', 1),
    submarineToAceMarineChance: readNumber(m, 'submarinetoacemarinechance', 0.3333333333),
    increaseDifficulty,
    spawnlist,
  };
}

const PART_CATEGORY_LABELS = ['WEAPON', 'BODY', 'ENGINE'] as const;
const PART_NAMES_BY_CATEGORY: readonly (readonly string[])[] = [
  ['ORIGINAL', 'LASER', 'SPREAD', 'MISSILES', 'CANNON', '???'],
  ['ORIGINAL', 'ARMOR', 'MELEE', 'NUKE', 'BOMB', '???'],
  ['ORIGINAL', 'SUPERBOOST', 'GUNGINE', 'UNDERWATER', 'HOVER', '???'],
];

const ENEMY_PLURAL_LABELS: Record<number, string> = {
  0: 'ENEMIES',
  1: 'FIGHTERS',
  2: 'BOATS',
  3: 'JETS',
  4: 'BIG BOATS',
  5: 'ACES',
  6: 'LASER ACES',
  7: 'SUBMARINES',
  8: 'ACE MARINES',
  9: 'BLIMPS',
};

const ENEMY_SINGULAR_LABELS: Record<number, string> = {
  0: 'ENEMY',
  1: 'FIGHTER',
  2: 'BOAT',
  3: 'JET',
  4: 'BIG BOAT',
  5: 'ACE',
  6: 'LASER ACE',
  7: 'SUBMARINE',
  8: 'ACE MARINE',
  9: 'BLIMP',
};

function formatConditionSuffix(condition: number): string {
  switch (condition) {
    case 1:
      return ' AT MAX COMBO';
    case 2:
      return ' WHILE HOVERING';
    case 3:
      return ' IN ONE CONTINUOUS BURST';
    case 4:
      return ' BY RAMMING';
    case 5:
      return ' WITH ONE SHOT';
    case 6:
      return ' WHILE STALLING';
    case 7:
      return ' AT LOW HEALTH';
    case 8:
      return ' WHILE BOOSTING';
    case 9:
      return ' WITH GUNGINE';
    case 11:
      return ' WITH NUKE BLAST';
    case 12:
      return ' IN A SINGLE SORTIE';
    case 13:
      return ' IN SFMT MODE';
    default:
      return '';
  }
}

function buildMissionText(
  component: [number, number, number],
  objective: number,
  condition: number,
  val: [number, number],
): { title: string; description: string } {
  const [cat, part, idx] = component;
  const catLabel = PART_CATEGORY_LABELS[cat] ?? 'PART';
  const partName = PART_NAMES_BY_CATEGORY[cat]?.[part] ?? `PART ${part}`;
  const title = `${partName} ${catLabel} #${idx + 1}`;

  const count = val[0];
  const enemyType = val[1];
  const enemyLabel =
    count === 1
      ? (ENEMY_SINGULAR_LABELS[enemyType] ?? 'ENEMY')
      : (ENEMY_PLURAL_LABELS[enemyType] ?? 'ENEMIES');
  const suffix = formatConditionSuffix(condition);

  let description: string;
  switch (objective) {
    case 0:
      description = `DESTROY ${count} ${enemyLabel}${suffix}`;
      break;
    case 1:
      description = `DESTROY ${count} ENEMY TYPES IN ONE SORTIE${suffix}`;
      break;
    case 2:
      description = `SCORE ${count} POINTS${suffix}`;
      break;
    case 3:
      description = `SURVIVE ${count} WAVES / STREAK${suffix}`;
      break;
    case 4:
      description = `REACH A X${count} COMBO${suffix}`;
      break;
    case 5:
      description = `DESTROY ${count} ${enemyLabel} WITH BOMBS${suffix}`;
      break;
    case 6:
      description = `DESTROY ${count} ${enemyLabel} WITHOUT TAKING DAMAGE${suffix}`;
      break;
    case 7:
      description = `DESTROY ${count} ${enemyLabel} WHILE UNDERWATER${suffix}`;
      break;
    default:
      description = `COMPLETE OBJECTIVE (${count} ${enemyLabel})${suffix}`;
      break;
  }

  return { title, description };
}

/**
 * Normalizes `global.json`, generating deterministic human-readable `title` and `description`
 * strings for all 90 missions from `[cat, part, idx]`, `objective`, `condition`, and `val`.
 */
export function normalizeGlobalData(raw: unknown): GlobalDataSpec {
  const m = buildLowerKeyMap(raw);
  const rawCustomize = buildLowerKeyMap(m.get('customizetypes'));

  const toNumMap = (value: unknown): Record<string, number> => {
    const rec = asRecord(value);
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        out[k] = v;
      }
    }
    return out;
  };

  const customizetypes = {
    engine: toNumMap(rawCustomize.get('engine')),
    body: toNumMap(rawCustomize.get('body')),
    weapon: toNumMap(rawCustomize.get('weapon')),
  };

  const rawMissions = Array.isArray(m.get('missions')) ? (m.get('missions') as unknown[]) : [];
  const missions: MissionSpec[] = rawMissions.map((entry, id) => {
    const em = buildLowerKeyMap(entry);
    const compRaw = Array.isArray(em.get('component')) ? (em.get('component') as unknown[]) : [];
    const valRaw = Array.isArray(em.get('val')) ? (em.get('val') as unknown[]) : [];

    const component: [number, number, number] = [
      typeof compRaw[0] === 'number' ? compRaw[0] : 0,
      typeof compRaw[1] === 'number' ? compRaw[1] : 0,
      typeof compRaw[2] === 'number' ? compRaw[2] : 0,
    ];
    const objective = readNumber(em, 'objective', 0);
    const condition = readNumber(em, 'condition', 0);
    const val: [number, number] = [
      typeof valRaw[0] === 'number' ? valRaw[0] : 1,
      typeof valRaw[1] === 'number' ? valRaw[1] : 0,
    ];

    const fallbackText = buildMissionText(component, objective, condition, val);
    const title = readString(em, 'title', fallbackText.title);
    const description = readString(em, 'description', fallbackText.description);

    return {
      id,
      component,
      objective,
      condition,
      val,
      title,
      description,
    };
  });

  const rawPlanes = Array.isArray(m.get('planenames')) ? (m.get('planenames') as unknown[]) : [];
  const planenames: PlaneNameEntry[] = rawPlanes.map((entry) => {
    const pm = buildLowerKeyMap(entry);
    return {
      name: readString(pm, 'name', 'original'),
      weapon: readNumber(pm, 'weapon', 0),
      body: readNumber(pm, 'body', 0),
      engine: readNumber(pm, 'engine', 0),
    };
  });

  return {
    customizetypes,
    missions,
    planenames,
  };
}

/**
 * Normalizes `fxparticle.json`.
 */
export function normalizeFxData(raw: unknown): FxDataSpec {
  const m = buildLowerKeyMap(raw);
  const rawGeneric = asRecord(m.get('generic'));
  const rawExplosions = asRecord(m.get('explosions'));

  const generic: Record<string, FxParticleSpec> = {};
  for (const [key, value] of Object.entries(rawGeneric)) {
    const gm = buildLowerKeyMap(value);
    generic[key] = {
      key,
      spritename: readString(gm, 'spritename', ''),
      depth: readNumber(gm, 'depth', -5),
      imagespeed: readNumber(gm, 'imagespeed', 0.4),
      imagespeedrand: readNumber(gm, 'imagespeedrand', 0),
      friction: readNumber(gm, 'friction', 0),
      vspeed: readNumber(gm, 'vspeed', 0),
      vspeedrand: readNumber(gm, 'vspeedrand', 0),
      imageanglerand: readNumber(gm, 'imageanglerand', 0),
      initvelocity: readNumber(gm, 'initvelocity', 0),
      initvelocityrand: readNumber(gm, 'initvelocityrand', 0),
      loop: readBoolean(gm, 'loop', false),
      allowbelowsea: readBoolean(gm, 'allowbelowsea', true),
      ttl: readNumber(gm, 'ttl', 0),
      ttlrand: readNumber(gm, 'ttlrand', 0),
      scaley: readNumber(gm, 'scaley', 0),
    };
  }

  const explosions: Record<string, ExplosionSpec> = {};
  for (const [key, value] of Object.entries(rawExplosions)) {
    const em = buildLowerKeyMap(value);
    explosions[key] = {
      key,
      spritename: readString(em, 'spritename', ''),
      depth: readNumber(em, 'depth', -7),
      imageanglerand: readNumber(em, 'imageanglerand', 0),
      initsubspritename: readString(em, 'initsubspritename', ''),
      numinitsubsprites: readNumber(em, 'numinitsubsprites', 0),
      initsubspritesrandpos: readNumber(em, 'initsubspritesrandpos', 0),
      shake: readNumber(em, 'shake', 0),
      randspawn: readNumber(em, 'randspawn', 0),
      randspawnspritename: readString(em, 'randspawnspritename', ''),
      splashchance: readNumber(em, 'splashchance', 0),
      splashspritename: readString(em, 'splashspritename', ''),
      floatwater: readBoolean(em, 'floatwater', false),
      playerdmg: readNumber(em, 'playerdmg', 0),
      playerburn: readNumber(em, 'playerburn', 0),
      fadespawnchance: readNumber(em, 'fadespawnchance', 0),
      fadespawnspritename: readString(em, 'fadespawnspritename', ''),
      collisions: readBoolean(em, 'collisions', false),
    };
  }

  return { generic, explosions };
}

/**
 * Normalizes `parallax.json`.
 */
export function normalizeParallaxData(raw: unknown): ParallaxDataSpec {
  const m = buildLowerKeyMap(raw);
  const rawStages = Array.isArray(m.get('stages')) ? (m.get('stages') as unknown[]) : [];
  const stages: ParallaxStageSpec[] = rawStages.map((entry) => {
    const sm = buildLowerKeyMap(entry);
    const spawnRaw = sm.get('spawn');
    const spawn = Array.isArray(spawnRaw)
      ? spawnRaw.filter((s): s is string => typeof s === 'string')
      : [];
    const timerIDVal = sm.get('timerid');
    const timerVal = sm.get('timer');
    return {
      stage: readNumber(sm, 'stage', 1),
      minimumDifficulty: readNumber(sm, 'minimumdifficulty', 0),
      ...(typeof timerIDVal === 'number' ? { timerID: timerIDVal } : {}),
      ...(typeof timerVal === 'number' ? { timer: timerVal } : {}),
      spawn,
    };
  });

  return {
    timer0: readNumber(m, 'timer0', 600),
    timer0subtrmult: readNumber(m, 'timer0subtrmult', 20),
    stages,
  };
}

/**
 * Normalizes `room.json`.
 */
export function normalizeRoomData(raw: unknown): RoomSettingsSpec {
  const m = buildLowerKeyMap(raw);
  const settingsRaw = m.get('settings');
  const sm = settingsRaw !== undefined ? buildLowerKeyMap(settingsRaw) : m;
  return {
    sealevel: readNumber(sm, 'sealevel', 0),
    spacelevel: readNumber(sm, 'spacelevel', -1300),
  };
}

/**
 * Normalizes `sprites.json`, `menusprites.json`, or `nukesprites.json` into a `SpriteAtlasSpec`.
 */
export function normalizeSpriteAtlas(
  name: string,
  raw: unknown,
  width: number,
  height: number,
): SpriteAtlasSpec {
  const m = buildLowerKeyMap(raw);
  const texturePath = readString(m, 'texture', '');
  const spritesRaw = m.get('sprites');
  const sprites: Record<string, SpriteEntry> = {};

  const parseTuple2 = (val: unknown, fallback: [number, number]): [number, number] => {
    if (Array.isArray(val) && val.length >= 2) {
      return [
        typeof val[0] === 'number' ? val[0] : fallback[0],
        typeof val[1] === 'number' ? val[1] : fallback[1],
      ];
    }
    return fallback;
  };

  const parseTuple4 = (
    val: unknown,
    fallback: [number, number, number, number],
  ): [number, number, number, number] => {
    if (Array.isArray(val) && val.length >= 4) {
      return [
        typeof val[0] === 'number' ? val[0] : fallback[0],
        typeof val[1] === 'number' ? val[1] : fallback[1],
        typeof val[2] === 'number' ? val[2] : fallback[2],
        typeof val[3] === 'number' ? val[3] : fallback[3],
      ];
    }
    return fallback;
  };

  const parseSubs = (val: unknown): SpriteFrame[] => {
    if (!Array.isArray(val)) {
      return [];
    }
    if (val.length > 0 && typeof val[0] === 'object' && val[0] !== null) {
      return val.map((item) => {
        const fm = buildLowerKeyMap(item);
        return { x: readNumber(fm, 'x', 0), y: readNumber(fm, 'y', 0) };
      });
    }
    const frames: SpriteFrame[] = [];
    for (let i = 0; i + 1 < val.length; i += 2) {
      const x = typeof val[i] === 'number' ? (val[i] as number) : 0;
      const y = typeof val[i + 1] === 'number' ? (val[i + 1] as number) : 0;
      frames.push({ x, y });
    }
    return frames;
  };

  const addEntry = (entryName: string, entryVal: unknown) => {
    const em = buildLowerKeyMap(entryVal);
    const resolvedName = readString(em, 'name', entryName);
    const size = parseTuple2(em.get('size'), [0, 0]);
    const hull = parseTuple4(em.get('hull'), [0, 0, size[0], size[1]]);
    const center = parseTuple2(em.get('center'), [0, 0]);
    const subs = parseSubs(em.get('subs'));
    sprites[resolvedName] = {
      name: resolvedName,
      size,
      hull,
      center,
      subs,
    };
  };

  if (Array.isArray(spritesRaw)) {
    for (const item of spritesRaw) {
      const em = buildLowerKeyMap(item);
      const entryName = readString(em, 'name', '');
      if (entryName) {
        addEntry(entryName, item);
      }
    }
  } else if (spritesRaw !== null && typeof spritesRaw === 'object') {
    for (const [k, v] of Object.entries(spritesRaw as UnknownRecord)) {
      addEntry(k, v);
    }
  }

  return {
    name,
    texturePath,
    width,
    height,
    sprites,
  };
}
