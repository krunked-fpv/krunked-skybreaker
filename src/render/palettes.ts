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
  name: 'ORIGINAL',
  unlockMissionsRequired: 0,
  backcol: hexToRgba('#dec796'),
  colors: [
    TRANSPARENT,
    hexToRgba('#4b0e1c'), // 1: Player silhouette
    hexToRgba('#82383e'), // 2: Enemy aircraft/boats/ebullet core
    hexToRgba('#b89378'), // 3: Water reflection of [1, 2]
    hexToRgba('#c7aa88'), // 4: Distant background props
    hexToRgba('#e7ddb0'), // 5: Player bullet core
    hexToRgba('#e5ddac'), // 6: Midground parallax clouds & reflection of [5, 7]
    hexToRgba('#f7f0d4'), // 7: Foreground clouds, explosions, ocean_line, health exterior
  ],
};

export const DEFAULT_PALETTE_ID = 'original';

export const PALETTES: readonly PaletteDefinition[] = [
  ORIGINAL_PALETTE,
  {
    id: 'lanigiro',
    name: 'LANIGIRO',
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
    id: 'kozilek',
    name: 'KOZILEK',
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
    id: 'sfmt',
    name: 'SFMT',
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

export function getPaletteById(id: string): PaletteDefinition {
  const found = PALETTES.find((p) => p.id === id);
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
  if (palette.id === 'sfmt' && sfmtUnlocked) {
    return true;
  }
  return completedMissionsCount >= palette.unlockMissionsRequired;
}
