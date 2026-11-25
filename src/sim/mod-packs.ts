import {
  DEFAULT_SHADER_FX,
  type Act2ModFlags,
  type IModRegistry,
  type ModPackage,
} from '../contracts/mod';
import type { PaletteDefinition, RgbaTuple } from '../contracts/render';
import type { BodySpec, EngineSpec, WeaponSpec } from '../contracts/vault';

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      deepFreeze(item);
    }
  } else {
    for (const key of Object.keys(obj)) {
      deepFreeze((obj as Record<string, unknown>)[key]);
    }
  }
  return Object.freeze(obj);
}

function hexToRgba(hex: string, alpha = 1): RgbaTuple {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r / 255, g / 255, b / 255, alpha];
}

const TRANSPARENT: RgbaTuple = [0, 0, 0, 0];

const DEFAULT_ORIGINAL_WEAPON: WeaponSpec = {
  id: 0,
  name: 'original',
  descr: 'balanced rotary autocannon',
  sprite: 'wings_original',
  projectile: 'bullet',
  interval: 3,
  maxbullets: 1337,
  recoil: 0,
  spread: 1,
  numbullets: 1,
  flags: '',
};

const DEFAULT_ORIGINAL_BODY: BodySpec = {
  id: 0,
  name: 'original',
  descr: 'balanced interceptor airframe',
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
  meleedmg: 10000,
  flags: '',
};

const DEFAULT_ORIGINAL_ENGINE: EngineSpec = {
  id: 0,
  name: 'original',
  descr: 'balanced vector thruster',
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

/**
 * Generates the 4 KRUNKED SKYBREAKER Act II bonus palettes (`cyberpunk`, `vaporwave`, `blueprint`, `goldrush`),
 * each with valid 8-color RGBA tuples and pairwise Euclidean RGB distances > 0.015.
 */
export function createAct2BonusPalettes(): PaletteDefinition[] {
  return [
    {
      id: 'cyberpunk',
      name: 'CYBERPUNK',
      unlockMissionsRequired: 0,
      backcol: hexToRgba('#120b24'),
      colors: [
        [...TRANSPARENT],
        hexToRgba('#00f5d4'),
        hexToRgba('#ff2a85'),
        hexToRgba('#3a346e'),
        hexToRgba('#251b47'),
        hexToRgba('#ffe64d'),
        hexToRgba('#7d4cdb'),
        hexToRgba('#ffffff'),
      ],
    },
    {
      id: 'vaporwave',
      name: 'VAPORWAVE',
      unlockMissionsRequired: 0,
      backcol: hexToRgba('#2b1055'),
      colors: [
        [...TRANSPARENT],
        hexToRgba('#ff71ce'),
        hexToRgba('#01cdfe'),
        hexToRgba('#623b8c'),
        hexToRgba('#442370'),
        hexToRgba('#fffb96'),
        hexToRgba('#b967ff'),
        hexToRgba('#05ffa1'),
      ],
    },
    {
      id: 'blueprint',
      name: 'BLUEPRINT',
      unlockMissionsRequired: 0,
      backcol: hexToRgba('#0a3264'),
      colors: [
        [...TRANSPARENT],
        hexToRgba('#ffffff'),
        hexToRgba('#ffd166'),
        hexToRgba('#1d5a9c'),
        hexToRgba('#13447a'),
        hexToRgba('#7bf1ff'),
        hexToRgba('#4ea2d9'),
        hexToRgba('#e6f4ff'),
      ],
    },
    {
      id: 'goldrush',
      name: 'GOLDRUSH',
      unlockMissionsRequired: 0,
      backcol: hexToRgba('#1e160d'),
      colors: [
        [...TRANSPARENT],
        hexToRgba('#ffd700'),
        hexToRgba('#d94814'),
        hexToRgba('#614521'),
        hexToRgba('#3d2b15'),
        hexToRgba('#fff3a1'),
        hexToRgba('#a67c37'),
        hexToRgba('#fff9e0'),
      ],
    },
  ];
}

export const ACT2_CUSTOM_WEAPONS: readonly WeaponSpec[] = deepFreeze([
  {
    ...DEFAULT_ORIGINAL_WEAPON,
    id: 6,
    name: 'railgun',
    descr: 'hypersonic piercing slug\nshockwave recoil',
    projectile: 'railslug',
    interval: 28,
    recoil: 2.2,
    sprite: 'wings_laser',
  },
  {
    ...DEFAULT_ORIGINAL_WEAPON,
    id: 7,
    name: 'flak',
    descr: 'airburst shrapnel shell\nsplits into 6 shards',
    projectile: 'flakshell',
    interval: 18,
    recoil: 0.8,
    sprite: 'wings_spread',
  },
  {
    ...DEFAULT_ORIGINAL_WEAPON,
    id: 8,
    name: 'lightning',
    descr: 'chain lightning arc\njumps to 3 enemies',
    projectile: 'lightningarc',
    interval: 16,
    recoil: 0.0,
    sprite: 'wings_cannon',
  },
]);

export const ACT2_CUSTOM_BODIES: readonly BodySpec[] = deepFreeze([
  {
    ...DEFAULT_ORIGINAL_BODY,
    id: 6,
    name: 'aegis',
    descr: 'regenerating energy shield\nabsorbs 1 hit every 5s',
    maxhealth: 18,
    healingspd: 0.14,
    flags: 'body-aegis-shield',
    sprite: 'body_armor',
  },
  {
    ...DEFAULT_ORIGINAL_BODY,
    id: 7,
    name: 'vampire',
    descr: 'lifesteal +2.5 hp on kill\neven while firing',
    maxhealth: 14,
    healingspd: 0.08,
    flags: 'body-vampire',
    sprite: 'body_melee',
  },
  {
    ...DEFAULT_ORIGINAL_BODY,
    id: 8,
    name: 'overclock',
    descr: '25% faster fire rate\nhigher speed, low armor',
    maxhealth: 12,
    speedmodifier: 1.15,
    flags: 'body-overclock',
    sprite: 'body_bomb',
  },
]);

export const ACT2_CUSTOM_ENGINES: readonly EngineSpec[] = deepFreeze([
  {
    ...DEFAULT_ORIGINAL_ENGINE,
    id: 6,
    name: 'afterburner',
    descr: 'extreme top speed\nexplosive boost surge',
    maximumspeed: 12.5,
    speed: 12.5,
    boostadd: 2.5,
    acceleration: 2.2,
    turnspeedboost: 2.5,
    sprite: 'engine_superboost',
  },
  {
    ...DEFAULT_ORIGINAL_ENGINE,
    id: 7,
    name: 'vector',
    descr: 'agile boosted turns\nclassic stall whip',
    turnspeed: 11,
    turnspeedboost: 7,
    maximumspeed: 9.0,
    speed: 9.0,
    sprite: 'engine_original',
  },
  {
    ...DEFAULT_ORIGINAL_ENGINE,
    id: 8,
    name: 'ion',
    descr: 'waterproof low-grav glide\nhalved space damage',
    gravity: 0.06,
    friction: 0.02,
    waterproof: true,
    spacedmg: 0.2,
    spacedmglowhp: 0.025,
    sprite: 'engine_hover',
  },
]);

export const ARSENAL_BOSSES_MOD: Readonly<ModPackage> = deepFreeze({
  id: 'act2-arsenal-bosses',
  name: 'Arsenal Expansion & Mega-Bosses',
  version: '2.0.0',
  customWeapons: [...ACT2_CUSTOM_WEAPONS],
  customBodies: [...ACT2_CUSTOM_BODIES],
  customEngines: [...ACT2_CUSTOM_ENGINES],
  customBosses: ['Dreadnought', 'SkyCarrier', 'AceSquadron'],
});

export const REPLAY_GHOST_MOD: Readonly<ModPackage> = deepFreeze({
  id: 'act2-replay-ghost',
  name: 'Replay Ghost & Daily Seed',
  version: '2.0.0',
});

export const SHADER_STUDIO_MOD: Readonly<ModPackage> = deepFreeze({
  id: 'act2-shader-studio',
  name: 'Shader FX & Palette Studio',
  version: '2.0.0',
  customPalettes: createAct2BonusPalettes(),
  shaderFx: { ...DEFAULT_SHADER_FX },
});

export const MULTIPLAYER_2P_MOD: Readonly<ModPackage> = deepFreeze({
  id: 'act2-multiplayer-2p',
  name: '2P Co-op & 1v1 Dogfight',
  version: '2.0.0',
  multiplayerMode: 'coop2p',
});

const WEAPON_NAME_TOKENS: Record<number, string> = {
  0: '',
  1: 'BEAM',
  2: 'SPREAD',
  3: 'SEEKER',
  4: 'CANNON',
  5: 'HEX',
  6: 'RAIL',
  7: 'FLAK',
  8: 'VOLT',
};

const BODY_NAME_TOKENS: Record<number, string> = {
  0: '',
  1: 'IRON',
  2: 'RAM',
  3: 'NUKE',
  4: 'BOMB',
  5: 'VOID',
  6: 'AEGIS',
  7: 'VAMPIRE',
  8: 'OVERCLOCK',
};

const ENGINE_NAME_TOKENS: Record<number, string> = {
  0: '',
  1: 'TURBO',
  2: 'GUN',
  3: 'AQUA',
  4: 'HOVER',
  5: 'WARP',
  6: 'BURNER',
  7: 'VECTOR',
  8: 'ION',
};

const SPECIAL_MODDED_NAMES: Record<string, string> = {
  '6:0:0': 'RAILBREAKER',
  '7:0:0': 'FLAKBREAKER',
  '8:0:0': 'THUNDERBOLT',
  '0:6:0': 'AEGIS BREAKER',
  '0:7:0': 'VAMPIRE BREAKER',
  '0:8:0': 'OVERCLOCK BREAKER',
  '0:0:6': 'AFTERBURNER',
  '0:0:7': 'VECTOR BREAKER',
  '0:0:8': 'ION BREAKER',
  '7:6:0': 'AEGIS FLAK',
  '0:7:7': 'VAMPIRE VECTOR',
  '0:8:8': 'OVERCLOCK ION',
  '6:6:6': 'AEGIS RAILBURNER',
  '7:7:7': 'VAMPIRE FLAKVECTOR',
  '8:8:8': 'OVERCLOCK THUNDERION',
};

/**
 * Resolves a distinct Skybreaker modded plane name whenever any slot is >= 6.
 * Returns `baseName` unchanged for standard loadouts (`weapon < 6 && body < 6 && engine < 6`).
 */
export function resolveModdedPlaneName(
  weapon: number,
  body: number,
  engine: number,
  baseName: string,
): string {
  if (weapon < 6 && body < 6 && engine < 6) {
    return baseName;
  }
  const key = `${weapon}:${body}:${engine}`;
  const special = SPECIAL_MODDED_NAMES[key];
  if (special) {
    return special;
  }
  const parts = [
    BODY_NAME_TOKENS[body] ?? `B${body}`,
    WEAPON_NAME_TOKENS[weapon] ?? `W${weapon}`,
    ENGINE_NAME_TOKENS[engine] ?? `E${engine}`,
  ].filter((token) => token.length > 0);
  return parts.length > 0 ? parts.join(' ') : 'SKYBREAKER MK-X';
}

/**
 * Synchronizes Act II ModPackages in `registry` to match `flags`.
 * When `flags.moddedEnabled` is false, enforces vanilla lock and unregisters Act II packs.
 */
export function registerAct2ModPacks(
  registry: IModRegistry,
  flags: Act2ModFlags,
): void {
  if (!flags.moddedEnabled) {
    registry.setVanillaLock(true);
    registry.unregister(ARSENAL_BOSSES_MOD.id);
    registry.unregister(REPLAY_GHOST_MOD.id);
    registry.unregister(SHADER_STUDIO_MOD.id);
    registry.unregister(MULTIPLAYER_2P_MOD.id);
    return;
  }

  registry.setVanillaLock(false);

  if (flags.arsenalBosses) {
    registry.register(ARSENAL_BOSSES_MOD);
  } else {
    registry.unregister(ARSENAL_BOSSES_MOD.id);
  }

  if (flags.replayGhost || flags.dailySeed) {
    registry.register(REPLAY_GHOST_MOD);
  } else {
    registry.unregister(REPLAY_GHOST_MOD.id);
  }

  registry.register({
    ...SHADER_STUDIO_MOD,
    customPalettes: createAct2BonusPalettes(),
    shaderFx: { ...flags.shaderFx },
  });

  if (flags.multiplayerMode !== 'solo') {
    registry.register({
      ...MULTIPLAYER_2P_MOD,
      multiplayerMode: flags.multiplayerMode,
    });
  } else {
    registry.unregister(MULTIPLAYER_2P_MOD.id);
  }
}
