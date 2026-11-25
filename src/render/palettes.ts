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
  backcol: hexToRgba('#d6c39c'),
  colors: [
    TRANSPARENT,
    hexToRgba('#162030'), // 1: Deep charcoal-navy player silhouette
    hexToRgba('#8c2630'), // 2: Bold crimson-rust enemy aircraft/boats/ebullet core
    hexToRgba('#8e897f'), // 3: Cool steel water reflection of [1, 2]
    hexToRgba('#a89d86'), // 4: Muted horizon background props
    hexToRgba('#ffe066'), // 5: Hot gold player fire core
    hexToRgba('#e3d9bc'), // 6: Pale cloud haze & reflection of [5, 7]
    hexToRgba('#f7f3e3'), // 7: Crisp ivory clouds, blasts, ocean_line, health exterior
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
    backcol: hexToRgba('#e6dec8'),
    colors: [
      TRANSPARENT,
      hexToRgba('#0c0c0c'),
      hexToRgba('#343434'),
      hexToRgba('#8d867a'),
      hexToRgba('#ada595'),
      hexToRgba('#f2efe6'),
      hexToRgba('#d4cdbe'),
      hexToRgba('#ffffff'),
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
      hexToRgba('#184218'),
      hexToRgba('#306230'),
      hexToRgba('#588822'),
      hexToRgba('#cadc9f'),
      hexToRgba('#8bac0f'),
      hexToRgba('#e0f8d0'),
    ],
  },
  {
    id: 'virtual',
    name: 'RED ALERT',
    unlockMissionsRequired: 10,
    backcol: hexToRgba('#140000'),
    colors: [
      TRANSPARENT,
      hexToRgba('#ff2424'),
      hexToRgba('#c41212'),
      hexToRgba('#620606'),
      hexToRgba('#3e0404'),
      hexToRgba('#ff9c9c'),
      hexToRgba('#8a0a0a'),
      hexToRgba('#ffe0e0'),
    ],
  },
  {
    id: 'oceanic',
    name: 'DEEP SEA',
    unlockMissionsRequired: 15,
    backcol: hexToRgba('#1b3b5a'),
    colors: [
      TRANSPARENT,
      hexToRgba('#07131f'),
      hexToRgba('#0f273d'),
      hexToRgba('#3c6e8f'),
      hexToRgba('#295170'),
      hexToRgba('#bfefff'),
      hexToRgba('#7fc8e8'),
      hexToRgba('#f0fbff'),
    ],
  },
  {
    id: 'synthdusk',
    name: 'SYNTH DUSK',
    unlockMissionsRequired: 25,
    backcol: hexToRgba('#23112d'),
    colors: [
      TRANSPARENT,
      hexToRgba('#ffcf4a'),
      hexToRgba('#e24d8c'),
      hexToRgba('#7d3866'),
      hexToRgba('#4b264e'),
      hexToRgba('#fff0a8'),
      hexToRgba('#b5659b'),
      hexToRgba('#ffffff'),
    ],
  },
  {
    id: 'sunset',
    name: 'DUSK',
    unlockMissionsRequired: 35,
    backcol: hexToRgba('#d96b38'),
    colors: [
      TRANSPARENT,
      hexToRgba('#1f0e16'),
      hexToRgba('#4a1924'),
      hexToRgba('#8f3b31'),
      hexToRgba('#b34f32'),
      hexToRgba('#ffe188'),
      hexToRgba('#f29f54'),
      hexToRgba('#fff5cf'),
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
    backcol: hexToRgba('#120608'),
    colors: [
      TRANSPARENT,
      hexToRgba('#ffffff'),
      hexToRgba('#ff2438'),
      hexToRgba('#6b1620'),
      hexToRgba('#361015'),
      hexToRgba('#ffd0d6'),
      hexToRgba('#a8202c'),
      hexToRgba('#fff4f5'),
    ],
  },
  {
    id: 'noir',
    name: 'SIN NOIR',
    unlockMissionsRequired: 75,
    backcol: hexToRgba('#1c1d21'),
    colors: [
      TRANSPARENT,
      hexToRgba('#f2f2f2'),
      hexToRgba('#d11f2f'),
      hexToRgba('#5e626d'),
      hexToRgba('#383a42'),
      hexToRgba('#ff6b78'),
      hexToRgba('#8f94a1'),
      hexToRgba('#ffffff'),
    ],
  },
  {
    id: 'toxic',
    name: 'FALLOUT',
    unlockMissionsRequired: 85,
    backcol: hexToRgba('#152414'),
    colors: [
      TRANSPARENT,
      hexToRgba('#78ff44'),
      hexToRgba('#d8ff2e'),
      hexToRgba('#2d6129'),
      hexToRgba('#1f421d'),
      hexToRgba('#c7ffb0'),
      hexToRgba('#4ea13f'),
      hexToRgba('#f0ffe8'),
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
): boolean {
  if (palette.id === 'overdrive' && sfmtUnlocked) {
    return true;
  }
  return completedMissionsCount >= palette.unlockMissionsRequired;
}
