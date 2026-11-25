import type { PaletteDefinition, RgbaTuple } from '../contracts/render';

export function hexToRgba(hex: string, alpha = 1): RgbaTuple {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  if (clean.length !== 6) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r / 255, g / 255, b / 255, alpha];
}

function invertRgb(tuple: RgbaTuple): RgbaTuple {
  return [1 - tuple[0], 1 - tuple[1], 1 - tuple[2], tuple[3]];
}

const TRANSPARENT: RgbaTuple = [0, 0, 0, 0];

const ORIGINAL_PALETTE: PaletteDefinition = {
  id: 'original',
  name: 'SKYBREAKER',
  unlockMissionsRequired: 0,
  backcol: hexToRgba('#e5ddac'),
  colors: [
    TRANSPARENT,
    hexToRgba('#61001d'), // 1: Deep burgundy-espresso player craft, missiles, bombs, dark blast core
    hexToRgba('#8d494d'), // 2: Terracotta-umber enemy craft, ships, blimps, turrets, UI dark panels
    hexToRgba('#b9937c'), // 3: Warm sepia water reflection of [1, 2], smoke, OVERDRIVE backcol
    hexToRgba('#dec796'), // 4: Sandy-gold distant horizon background props
    hexToRgba('#e5ddac'), // 5: Warm golden-parchment Normal backcol & player fire rims
    hexToRgba('#efe9cd'), // 6: Pale cream parallax clouds, contrails, water reflection of [5, 7], settled HP circle
    hexToRgba('#ffffff'), // 7: Crisp white clouds, ocean_line, space bank, splashes, blasts, hit flash
  ],
};

export const DEFAULT_PALETTE_ID = 'original';
export const CUSTOM_PALETTE_ID = 'custom_studio';

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function rgbaToHex(rgba: RgbaTuple): string {
  const toByte = (ch: number): string => {
    const clamped = Number.isFinite(ch) ? clamp01(ch) : 0;
    return Math.round(clamped * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${toByte(rgba[0])}${toByte(rgba[1])}${toByte(rgba[2])}`;
}

export function createDefaultCustomPalette(): PaletteDefinition {
  return {
    id: CUSTOM_PALETTE_ID,
    name: 'CUSTOM STUDIO',
    unlockMissionsRequired: 0,
    backcol: [...ORIGINAL_PALETTE.backcol] as RgbaTuple,
    colors: [
      [0, 0, 0, 0],
      [...ORIGINAL_PALETTE.colors[1]] as RgbaTuple,
      [...ORIGINAL_PALETTE.colors[2]] as RgbaTuple,
      [...ORIGINAL_PALETTE.colors[3]] as RgbaTuple,
      [...ORIGINAL_PALETTE.colors[4]] as RgbaTuple,
      [...ORIGINAL_PALETTE.colors[5]] as RgbaTuple,
      [...ORIGINAL_PALETTE.colors[6]] as RgbaTuple,
      [...ORIGINAL_PALETTE.colors[7]] as RgbaTuple,
    ],
  };
}

function sanitizeRgbaTuple(raw: unknown, alphaOverride: number): RgbaTuple | null {
  if (!Array.isArray(raw) || raw.length !== 4) {
    return null;
  }
  const r = raw[0];
  const g = raw[1];
  const b = raw[2];
  const a = raw[3];
  if (
    typeof r !== 'number' ||
    typeof g !== 'number' ||
    typeof b !== 'number' ||
    typeof a !== 'number' ||
    !Number.isFinite(r) ||
    !Number.isFinite(g) ||
    !Number.isFinite(b) ||
    !Number.isFinite(a)
  ) {
    return null;
  }
  return [clamp01(r), clamp01(g), clamp01(b), alphaOverride];
}

export function sanitizeCustomPalette(raw: unknown): PaletteDefinition | null {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null;
    }
    const obj = raw as Record<string, unknown>;
    const backcol = sanitizeRgbaTuple(obj.backcol, 1);
    if (!backcol) {
      return null;
    }
    if (!Array.isArray(obj.colors) || obj.colors.length !== 8) {
      return null;
    }
    const c0 = sanitizeRgbaTuple(obj.colors[0], 0);
    if (!c0) {
      return null;
    }
    const sanitizedColors: PaletteDefinition['colors'] = [
      [0, 0, 0, 0],
      [0, 0, 0, 1],
      [0, 0, 0, 1],
      [0, 0, 0, 1],
      [0, 0, 0, 1],
      [0, 0, 0, 1],
      [0, 0, 0, 1],
      [0, 0, 0, 1],
    ];
    for (let i = 1; i <= 7; i++) {
      const tuple = sanitizeRgbaTuple(obj.colors[i], 1);
      if (!tuple) {
        return null;
      }
      sanitizedColors[i] = tuple;
    }

    const id =
      typeof obj.id === 'string' && obj.id.trim().length > 0
        ? obj.id.trim().slice(0, 32)
        : CUSTOM_PALETTE_ID;
    const name =
      typeof obj.name === 'string' && obj.name.trim().length > 0
        ? obj.name.trim().slice(0, 24).toUpperCase()
        : 'CUSTOM STUDIO';
    const unlockMissionsRequired =
      typeof obj.unlockMissionsRequired === 'number' &&
      Number.isFinite(obj.unlockMissionsRequired)
        ? Math.max(0, Math.floor(obj.unlockMissionsRequired))
        : 0;

    return {
      id,
      name,
      unlockMissionsRequired,
      backcol,
      colors: sanitizedColors,
    };
  } catch {
    return null;
  }
}

export const PALETTES: readonly PaletteDefinition[] = [
  ORIGINAL_PALETTE,
  {
    id: 'inverted',
    name: 'INVERTED',
    unlockMissionsRequired: 2,
    backcol: invertRgb(ORIGINAL_PALETTE.backcol),
    colors: [
      TRANSPARENT,
      invertRgb(ORIGINAL_PALETTE.colors[1]),
      invertRgb(ORIGINAL_PALETTE.colors[2]),
      invertRgb(ORIGINAL_PALETTE.colors[3]),
      invertRgb(ORIGINAL_PALETTE.colors[4]),
      invertRgb(ORIGINAL_PALETTE.colors[5]),
      invertRgb(ORIGINAL_PALETTE.colors[6]),
      invertRgb(ORIGINAL_PALETTE.colors[7]),
    ],
  },
  {
    id: 'classic',
    name: 'CLASSIC',
    unlockMissionsRequired: 0,
    backcol: hexToRgba('#a0a0a0'),
    colors: [
      TRANSPARENT,
      hexToRgba('#202020'),
      hexToRgba('#404040'),
      hexToRgba('#606060'),
      hexToRgba('#808080'),
      hexToRgba('#a0a0a0'),
      hexToRgba('#c0c0c0'),
      hexToRgba('#e0e0e0'),
    ],
  },
  {
    id: 'gameboy',
    name: 'GB POCKET',
    unlockMissionsRequired: 5,
    backcol: hexToRgba('#9bbc0f'),
    colors: [
      TRANSPARENT,
      hexToRgba('#0f380f'),
      hexToRgba('#244e1c'),
      hexToRgba('#427024'),
      hexToRgba('#6f961c'),
      hexToRgba('#9bbc0f'),
      hexToRgba('#c2dc72'),
      hexToRgba('#e0f8d0'),
    ],
  },
  {
    id: 'virtual',
    name: 'RED ALERT',
    unlockMissionsRequired: 10,
    backcol: hexToRgba('#ff1010'),
    colors: [
      TRANSPARENT,
      hexToRgba('#000000'),
      hexToRgba('#ffaa82'),
      hexToRgba('#ff7735'),
      hexToRgba('#9b0b0b'),
      hexToRgba('#ff1010'),
      hexToRgba('#00b72b'),
      hexToRgba('#00ff40'),
    ],
  },
  {
    id: 'oceanic',
    name: 'DEEP SEA',
    unlockMissionsRequired: 15,
    backcol: hexToRgba('#bbe9fb'),
    colors: [
      TRANSPARENT,
      hexToRgba('#ff5abb'),
      hexToRgba('#c3aec4'),
      hexToRgba('#ff82cb'),
      hexToRgba('#5188d1'),
      hexToRgba('#bbe9fb'),
      hexToRgba('#fffcdf'),
      hexToRgba('#45466d'),
    ],
  },
  {
    id: 'synthdusk',
    name: 'SYNTH DUSK',
    unlockMissionsRequired: 25,
    backcol: hexToRgba('#0f0a1f'),
    colors: [
      TRANSPARENT,
      hexToRgba('#d544d2'),
      hexToRgba('#ccbbfe'),
      hexToRgba('#e9d9f6'),
      hexToRgba('#f24fa4'),
      hexToRgba('#0f0a1f'),
      hexToRgba('#300b24'),
      hexToRgba('#901969'),
    ],
  },
  {
    id: 'sunset',
    name: 'DUSK',
    unlockMissionsRequired: 35,
    backcol: hexToRgba('#f5a9a9'),
    colors: [
      TRANSPARENT,
      hexToRgba('#733e75'),
      hexToRgba('#6f51b5'),
      hexToRgba('#fa7ddd'),
      hexToRgba('#c9aed7'),
      hexToRgba('#f5a9a9'),
      hexToRgba('#ff4a9e'),
      hexToRgba('#ffff00'),
    ],
  },
  {
    id: 'amber',
    name: 'CRT AMBER',
    unlockMissionsRequired: 45,
    backcol: hexToRgba('#1a0f00'),
    colors: [
      TRANSPARENT,
      hexToRgba('#ffb000'),
      hexToRgba('#cc7a00'),
      hexToRgba('#663d00'),
      hexToRgba('#442800'),
      hexToRgba('#ffd873'),
      hexToRgba('#995c00'),
      hexToRgba('#fff2cc'),
    ],
  },
  {
    id: 'overdrive',
    name: 'OVERDRIVE',
    unlockMissionsRequired: 60,
    backcol: hexToRgba('#de637e'),
    colors: [
      TRANSPARENT,
      hexToRgba('#61052d'),
      hexToRgba('#a20224'),
      hexToRgba('#e13359'),
      hexToRgba('#e2748c'),
      hexToRgba('#de637e'),
      hexToRgba('#faaebe'),
      hexToRgba('#fedce8'),
    ],
  },
  {
    id: 'noir',
    name: 'SIN NOIR',
    unlockMissionsRequired: 75,
    backcol: hexToRgba('#e1d7e1'),
    colors: [
      TRANSPARENT,
      hexToRgba('#aa64e6'),
      hexToRgba('#a096a0'),
      hexToRgba('#c3b9c3'),
      hexToRgba('#d2c8d2'),
      hexToRgba('#e1d7e1'),
      hexToRgba('#f0e6f0'),
      hexToRgba('#fff5ff'),
    ],
  },
  {
    id: 'toxic',
    name: 'FALLOUT',
    unlockMissionsRequired: 85,
    backcol: hexToRgba('#b466ed'),
    colors: [
      TRANSPARENT,
      hexToRgba('#6002a4'),
      hexToRgba('#b30045'),
      hexToRgba('#62b600'),
      hexToRgba('#bdb800'),
      hexToRgba('#b466ed'),
      hexToRgba('#b6fa68'),
      hexToRgba('#fffa3b'),
    ],
  },
];

export const ACT2_BONUS_PALETTES: readonly PaletteDefinition[] = [
  {
    id: 'cyberpunk',
    name: 'CYBERPUNK',
    unlockMissionsRequired: 0,
    backcol: hexToRgba('#120824'),
    colors: [
      TRANSPARENT,
      hexToRgba('#00f5d4'),
      hexToRgba('#ff2a85'),
      hexToRgba('#4a1c6b'),
      hexToRgba('#261147'),
      hexToRgba('#ffe66d'),
      hexToRgba('#7b2cbf'),
      hexToRgba('#ffffff'),
    ],
  },
  {
    id: 'vaporwave',
    name: 'VAPORWAVE',
    unlockMissionsRequired: 0,
    backcol: hexToRgba('#2b1055'),
    colors: [
      TRANSPARENT,
      hexToRgba('#ff71ce'),
      hexToRgba('#01cdfe'),
      hexToRgba('#75257a'),
      hexToRgba('#4b1b6d'),
      hexToRgba('#fffb96'),
      hexToRgba('#b967ff'),
      hexToRgba('#05ffa1'),
    ],
  },
  {
    id: 'blueprint',
    name: 'BLUEPRINT',
    unlockMissionsRequired: 0,
    backcol: hexToRgba('#0d3b66'),
    colors: [
      TRANSPARENT,
      hexToRgba('#cfe8ff'),
      hexToRgba('#ffd166'),
      hexToRgba('#1d5c96'),
      hexToRgba('#144a7d'),
      hexToRgba('#a8dadc'),
      hexToRgba('#457b9d'),
      hexToRgba('#ffffff'),
    ],
  },
  {
    id: 'goldrush',
    name: 'GOLD RUSH',
    unlockMissionsRequired: 0,
    backcol: hexToRgba('#1c140d'),
    colors: [
      TRANSPARENT,
      hexToRgba('#ffb703'),
      hexToRgba('#fb5607'),
      hexToRgba('#6b4423'),
      hexToRgba('#3d2817'),
      hexToRgba('#ffe169'),
      hexToRgba('#9e6b3b'),
      hexToRgba('#fff8dc'),
    ],
  },
];

export function getPaletteById(id: string): PaletteDefinition {
  const found =
    PALETTES.find((p) => p.id === id) ??
    ACT2_BONUS_PALETTES.find((p) => p.id === id);
  return found ?? ORIGINAL_PALETTE;
}

export function getPaletteIndexById(id: string): number {
  const idx = PALETTES.findIndex((p) => p.id === id);
  return idx >= 0 ? idx : 0;
}

export function isPaletteUnlocked(
  palette: PaletteDefinition,
  completedMissionsCount: number,
  sfmtUnlocked = false,
  allUnlocked = false,
): boolean {
  if (allUnlocked) {
    return true;
  }
  if (palette.id === 'overdrive' && sfmtUnlocked) {
    return true;
  }
  return completedMissionsCount >= palette.unlockMissionsRequired;
}
