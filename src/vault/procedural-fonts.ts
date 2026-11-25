/**
 * Clean-room procedural bitmap font synthesizer.
 *
 * Provides two bespoke clean-room pixel typefaces:
 * 1. `BOLD_DISPLAY_6X8` — chunky geometric arcade display lettering (thick 2px
 *    stems & chamfered corners, clean open '0', crisp 'N') for `fntb`, `fntm`,
 *    `fntmb`, and `fntxl` (bold Pic0-style visual weight for HUD scores, combo
 *    drain gauge, and Hangar titles).
 * 2. `PIXEL_COMPACT_5X7` — razor-sharp compact pixel sans for `fnts` (small UI
 *    labels, mission descriptions, and telemetry readouts).
 */

import type { BitmapFontGlyph, BitmapFontSpec, DecodedTexture } from '../contracts/vault';
import { setPixel } from './painter';

// Compact 5x7 crisp pixel sans (MSB = leftmost column of 5 bits)
const PIXEL_COMPACT_5X7: Record<number, readonly number[]> = {
  32: [0, 0, 0, 0, 0, 0, 0], // ' '
  33: [4, 4, 4, 4, 4, 0, 4], // '!'
  34: [10, 10, 10, 0, 0, 0, 0], // '"'
  35: [10, 10, 31, 10, 31, 10, 10], // '#'
  36: [4, 15, 20, 14, 5, 30, 4], // '$'
  37: [25, 26, 2, 4, 8, 11, 19], // '%'
  38: [12, 18, 20, 8, 21, 18, 13], // '&'
  39: [4, 4, 8, 0, 0, 0, 0], // '''
  40: [2, 4, 8, 8, 8, 4, 2], // '('
  41: [8, 4, 2, 2, 2, 4, 8], // ')'
  42: [0, 4, 21, 14, 21, 4, 0], // '*'
  43: [0, 4, 4, 31, 4, 4, 0], // '+'
  44: [0, 0, 0, 0, 0, 4, 8], // ','
  45: [0, 0, 0, 31, 0, 0, 0], // '-'
  46: [0, 0, 0, 0, 0, 6, 6], // '.'
  47: [1, 2, 2, 4, 8, 8, 16], // '/'
  48: [14, 17, 17, 17, 17, 17, 14], // '0' (clean open zero)
  49: [4, 12, 4, 4, 4, 4, 14], // '1'
  50: [14, 17, 1, 6, 8, 16, 31], // '2'
  51: [30, 1, 1, 14, 1, 1, 30], // '3'
  52: [2, 6, 10, 18, 31, 2, 2], // '4'
  53: [31, 16, 30, 1, 1, 17, 14], // '5'
  54: [14, 16, 30, 17, 17, 17, 14], // '6'
  55: [31, 1, 2, 4, 8, 8, 8], // '7'
  56: [14, 17, 17, 14, 17, 17, 14], // '8'
  57: [14, 17, 17, 15, 1, 2, 12], // '9'
  58: [0, 6, 6, 0, 6, 6, 0], // ':'
  59: [0, 6, 6, 0, 6, 4, 8], // ';'
  60: [2, 4, 8, 16, 8, 4, 2], // '<'
  61: [0, 0, 31, 0, 31, 0, 0], // '='
  62: [8, 4, 2, 1, 2, 4, 8], // '>'
  63: [14, 17, 1, 2, 4, 0, 4], // '?'
  64: [14, 17, 23, 21, 23, 16, 14], // '@'
  65: [14, 17, 17, 31, 17, 17, 17], // 'A'
  66: [30, 17, 17, 30, 17, 17, 30], // 'B'
  67: [14, 17, 16, 16, 16, 17, 14], // 'C'
  68: [30, 17, 17, 17, 17, 17, 30], // 'D'
  69: [31, 16, 16, 30, 16, 16, 31], // 'E'
  70: [31, 16, 16, 30, 16, 16, 16], // 'F'
  71: [14, 17, 16, 23, 17, 17, 15], // 'G'
  72: [17, 17, 17, 31, 17, 17, 17], // 'H'
  73: [14, 4, 4, 4, 4, 4, 14], // 'I'
  74: [7, 2, 2, 2, 2, 18, 12], // 'J'
  75: [17, 18, 20, 24, 20, 18, 17], // 'K'
  76: [16, 16, 16, 16, 16, 16, 31], // 'L'
  77: [17, 27, 21, 21, 17, 17, 17], // 'M'
  78: [17, 25, 21, 19, 17, 17, 17], // 'N'
  79: [14, 17, 17, 17, 17, 17, 14], // 'O'
  80: [30, 17, 17, 30, 16, 16, 16], // 'P'
  81: [14, 17, 17, 17, 21, 18, 13], // 'Q'
  82: [30, 17, 17, 30, 20, 18, 17], // 'R'
  83: [15, 16, 16, 14, 1, 1, 30], // 'S'
  84: [31, 4, 4, 4, 4, 4, 4], // 'T'
  85: [17, 17, 17, 17, 17, 17, 14], // 'U'
  86: [17, 17, 17, 17, 17, 10, 4], // 'V'
  87: [17, 17, 17, 21, 21, 27, 17], // 'W'
  88: [17, 17, 10, 4, 10, 17, 17], // 'X'
  89: [17, 17, 10, 4, 4, 4, 4], // 'Y'
  90: [31, 1, 2, 4, 8, 16, 31], // 'Z'
  91: [14, 8, 8, 8, 8, 8, 14], // '['
  92: [16, 8, 8, 4, 2, 2, 1], // '\'
  93: [14, 2, 2, 2, 2, 2, 14], // ']'
  94: [4, 10, 17, 0, 0, 0, 0], // '^'
  95: [0, 0, 0, 0, 0, 0, 31], // '_'
  96: [8, 4, 2, 0, 0, 0, 0], // '`'
  97: [0, 0, 14, 1, 15, 17, 15], // 'a'
  98: [16, 16, 30, 17, 17, 17, 30], // 'b'
  99: [0, 0, 14, 17, 16, 17, 14], // 'c'
  100: [1, 1, 15, 17, 17, 17, 15], // 'd'
  101: [0, 0, 14, 17, 31, 16, 14], // 'e'
  102: [6, 8, 8, 30, 8, 8, 8], // 'f'
  103: [0, 0, 15, 17, 15, 1, 14], // 'g'
  104: [16, 16, 30, 17, 17, 17, 17], // 'h'
  105: [4, 0, 12, 4, 4, 4, 14], // 'i'
  106: [2, 0, 6, 2, 2, 18, 12], // 'j'
  107: [16, 16, 18, 20, 24, 20, 18], // 'k'
  108: [12, 4, 4, 4, 4, 4, 14], // 'l'
  109: [0, 0, 26, 21, 21, 17, 17], // 'm'
  110: [0, 0, 30, 17, 17, 17, 17], // 'n'
  111: [0, 0, 14, 17, 17, 17, 14], // 'o'
  112: [0, 0, 30, 17, 30, 16, 16], // 'p'
  113: [0, 0, 15, 17, 15, 1, 1], // 'q'
  114: [0, 0, 22, 25, 16, 16, 16], // 'r'
  115: [0, 0, 15, 16, 14, 1, 30], // 's'
  116: [8, 8, 30, 8, 8, 9, 6], // 't'
  117: [0, 0, 17, 17, 17, 17, 15], // 'u'
  118: [0, 0, 17, 17, 17, 10, 4], // 'v'
  119: [0, 0, 17, 17, 21, 21, 10], // 'w'
  120: [0, 0, 17, 10, 4, 10, 17], // 'x'
  121: [0, 0, 17, 17, 15, 1, 14], // 'y'
  122: [0, 0, 31, 2, 4, 8, 31], // 'z'
  123: [6, 8, 8, 16, 8, 8, 6], // '{'
  124: [4, 4, 4, 4, 4, 4, 4], // '|'
  125: [12, 2, 2, 1, 2, 2, 12], // '}'
  126: [0, 0, 8, 21, 2, 0, 0], // '~'
};

// Bold geometric arcade display typeface (6 cols x 8 rows, MSB = leftmost column of 6 bits).
// Thick 2px vertical stems and chunky 2px horizontal crossbars give high-impact, solid
// silhouettes for HUD scores, combo multipliers, Hangar headers, and Game Over banners.
const BOLD_DISPLAY_6X8_ROWS: Record<number, readonly string[]> = {
  32: ['......', '......', '......', '......', '......', '......', '......', '......'],
  33: ['..##..', '..##..', '..##..', '..##..', '..##..', '......', '..##..', '..##..'], // !
  34: ['.##.##', '.##.##', '.##.##', '......', '......', '......', '......', '......'], // "
  35: ['.#..#.', '######', '.#..#.', '.#..#.', '######', '.#..#.', '......', '......'], // #
  36: ['..##..', '.#####', '##....', '.####.', '....##', '#####.', '..##..', '......'], // $
  37: ['##..##', '##.##.', '..##..', '.##...', '##.##.', '##..##', '......', '......'], // %
  38: ['.####.', '##..##', '.###..', '##.##.', '##..##', '.###.#', '......', '......'], // &
  39: ['..##..', '..##..', '.##...', '......', '......', '......', '......', '......'], // '
  40: ['..##..', '.##...', '##....', '##....', '##....', '##....', '.##...', '..##..'], // (
  41: ['..##..', '...##.', '....##', '....##', '....##', '....##', '...##.', '..##..'], // )
  42: ['......', '.#..#.', '..##..', '######', '..##..', '.#..#.', '......', '......'], // *
  43: ['......', '..##..', '..##..', '######', '######', '..##..', '..##..', '......'], // +
  44: ['......', '......', '......', '......', '......', '..##..', '..##..', '.##...'], // ,
  45: ['......', '......', '......', '######', '######', '......', '......', '......'], // -
  46: ['......', '......', '......', '......', '......', '......', '..##..', '..##..'], // .
  47: ['....##', '...##.', '...##.', '..##..', '.##...', '.##...', '##....', '......'], // /
  48: ['.####.', '######', '##..##', '##..##', '##..##', '##..##', '######', '.####.'], // 0
  49: ['..##..', '.###..', '####..', '..##..', '..##..', '..##..', '######', '######'], // 1
  50: ['.####.', '######', '....##', '..###.', '.###..', '##....', '######', '######'], // 2
  51: ['#####.', '######', '....##', '.####.', '.####.', '....##', '######', '#####.'], // 3
  52: ['##..##', '##..##', '##..##', '######', '######', '....##', '....##', '....##'], // 4
  53: ['######', '######', '##....', '#####.', '######', '....##', '######', '#####.'], // 5
  54: ['.####.', '######', '##....', '#####.', '######', '##..##', '######', '.####.'], // 6
  55: ['######', '######', '....##', '...##.', '..##..', '..##..', '..##..', '..##..'], // 7
  56: ['.####.', '######', '##..##', '.####.', '.####.', '##..##', '######', '.####.'], // 8
  57: ['.####.', '######', '##..##', '######', '.#####', '....##', '######', '.####.'], // 9
  58: ['......', '..##..', '..##..', '......', '......', '..##..', '..##..', '......'], // :
  59: ['......', '..##..', '..##..', '......', '......', '..##..', '..##..', '.##...'], // ;
  60: ['...##.', '..##..', '.##...', '##....', '.##...', '..##..', '...##.', '......'], // <
  61: ['......', '......', '######', '......', '......', '######', '......', '......'], // =
  62: ['.##...', '..##..', '...##.', '....##', '...##.', '..##..', '.##...', '......'], // >
  63: ['.####.', '######', '....##', '..###.', '..##..', '......', '..##..', '..##..'], // ?
  64: ['.####.', '##..##', '##.###', '##.###', '##....', '######', '.####.', '......'], // @
  65: ['.####.', '######', '##..##', '######', '######', '##..##', '##..##', '##..##'], // A
  66: ['#####.', '######', '##..##', '#####.', '#####.', '##..##', '######', '#####.'], // B
  67: ['.####.', '######', '##....', '##....', '##....', '##....', '######', '.####.'], // C
  68: ['####..', '#####.', '##..##', '##..##', '##..##', '##..##', '#####.', '####..'], // D
  69: ['######', '######', '##....', '#####.', '#####.', '##....', '######', '######'], // E
  70: ['######', '######', '##....', '#####.', '#####.', '##....', '##....', '##....'], // F
  71: ['.####.', '######', '##....', '##.###', '##.###', '##..##', '######', '.#####'], // G
  72: ['##..##', '##..##', '##..##', '######', '######', '##..##', '##..##', '##..##'], // H
  73: ['######', '######', '..##..', '..##..', '..##..', '..##..', '######', '######'], // I
  74: ['..####', '..####', '....##', '....##', '....##', '##..##', '######', '.####.'], // J
  75: ['##..##', '##.##.', '####..', '###...', '####..', '##.##.', '##..##', '##..##'], // K
  76: ['##....', '##....', '##....', '##....', '##....', '##....', '######', '######'], // L
  77: ['##...##', '###.###', '#######', '##.#.##', '##...##', '##...##', '##...##', '##...##'], // M (7-wide)
  78: ['##..##', '###.##', '######', '######', '##.###', '##..##', '##..##', '##..##'], // N
  79: ['.####.', '######', '##..##', '##..##', '##..##', '##..##', '######', '.####.'], // O
  80: ['#####.', '######', '##..##', '######', '#####.', '##....', '##....', '##....'], // P
  81: ['.####.', '######', '##..##', '##..##', '##..##', '##.###', '######', '.###.#'], // Q
  82: ['#####.', '######', '##..##', '######', '#####.', '##.##.', '##..##', '##..##'], // R
  83: ['.#####', '######', '##....', '.####.', '..####', '....##', '######', '#####.'], // S
  84: ['######', '######', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..'], // T
  85: ['##..##', '##..##', '##..##', '##..##', '##..##', '##..##', '######', '.####.'], // U
  86: ['##..##', '##..##', '##..##', '##..##', '##..##', '.####.', '..##..', '..##..'], // V
  87: ['##...##', '##...##', '##...##', '##...##', '##.#.##', '#######', '###.###', '##...##'], // W (7-wide)
  88: ['##..##', '##..##', '.####.', '..##..', '.####.', '##..##', '##..##', '##..##'], // X
  89: ['##..##', '##..##', '.####.', '..##..', '..##..', '..##..', '..##..', '..##..'], // Y
  90: ['######', '######', '...##.', '..##..', '.##...', '##....', '######', '######'], // Z
  91: ['.###..', '.###..', '.##...', '.##...', '.##...', '.##...', '.###..', '.###..'], // [
  92: ['##....', '.##...', '.##...', '..##..', '...##.', '...##.', '....##', '......'], // \
  93: ['..###.', '..###.', '...##.', '...##.', '...##.', '...##.', '..###.', '..###.'], // ]
  94: ['..##..', '.####.', '##..##', '......', '......', '......', '......', '......'], // ^
  95: ['......', '......', '......', '......', '......', '......', '######', '######'], // _
  96: ['.##...', '..##..', '......', '......', '......', '......', '......', '......'], // `
  123: ['..###.', '.##...', '.##...', '##....', '.##...', '.##...', '..###.', '......'], // {
  124: ['..##..', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..'], // |
  125: ['.###..', '...##.', '...##.', '....##', '...##.', '...##.', '.###..', '......'], // }
  126: ['......', '......', '.##.##', '##.##.', '......', '......', '......', '......'], // ~
};

interface DisplayGlyphEntry {
  cols: number;
  bits: readonly number[];
}

function encodeRowBits(rows: readonly string[]): DisplayGlyphEntry {
  const cols = rows[0]?.length ?? 6;
  const bits = rows.map((row) => {
    let mask = 0;
    for (let c = 0; c < cols; c++) {
      if (row[c] === '#') mask |= 1 << (cols - 1 - c);
    }
    return mask;
  });
  return { cols, bits };
}

const BOLD_DISPLAY_6X8: Record<number, DisplayGlyphEntry> = {};
for (const [codeStr, rows] of Object.entries(BOLD_DISPLAY_6X8_ROWS)) {
  BOLD_DISPLAY_6X8[Number(codeStr)] = encodeRowBits(rows);
}
// Map lowercase a..z to bold uppercase display letters (Pic0 display fonts are bold all-caps)
for (let code = 97; code <= 122; code++) {
  BOLD_DISPLAY_6X8[code] = BOLD_DISPLAY_6X8[code - 32]!;
}

interface GlyphGridSource {
  cols: number;
  rows: number;
  bits: readonly number[];
}

function isDisplayFont(font: BitmapFontSpec): boolean {
  const faceLower = font.face.toLowerCase();
  const nameLower = font.name.toLowerCase();
  if (nameLower === 'fnts' || faceLower.includes('volter') || faceLower.includes('pixelsans')) {
    return false;
  }
  return (
    faceLower.includes('pic0') ||
    nameLower === 'fntb' ||
    nameLower === 'fntm' ||
    nameLower === 'fntmb' ||
    nameLower === 'fntxl' ||
    font.size >= 14
  );
}

function resolveGlyphSource(font: BitmapFontSpec, id: number): GlyphGridSource {
  if (isDisplayFont(font)) {
    const entry = BOLD_DISPLAY_6X8[id] ?? BOLD_DISPLAY_6X8[63]!;
    return { cols: entry.cols, rows: 8, bits: entry.bits };
  }
  const bits = PIXEL_COMPACT_5X7[id] ?? PIXEL_COMPACT_5X7[63]!;
  return { cols: 5, rows: 7, bits };
}

function computeGridBounds(
  bits: readonly number[],
  cols: number,
  rows: number,
): { minCol: number; maxCol: number; minRow: number; maxRow: number } | null {
  let minCol = cols;
  let maxCol = -1;
  let minRow = rows;
  let maxRow = -1;
  for (let r = 0; r < rows; r++) {
    const rowBits = bits[r] ?? 0;
    if (rowBits === 0) continue;
    for (let c = 0; c < cols; c++) {
      if ((rowBits & (1 << (cols - 1 - c))) !== 0) {
        if (c < minCol) minCol = c;
        if (c > maxCol) maxCol = c;
        if (r < minRow) minRow = r;
        if (r > maxRow) maxRow = r;
      }
    }
  }
  if (maxCol < minCol || maxRow < minRow) {
    return null;
  }
  return { minCol, maxCol, minRow, maxRow };
}

/**
 * Resolves the inclusive source coordinate range `[start, end]` for a destination pixel.
 * Downsampled axes (`destSize < span`) use bin-OR coverage so thin 1px stems are never skipped;
 * upsampled or 1:1 axes preserve crisp endpoint-inclusive point sampling.
 */
function resolveAxisSampleRange(
  destIndex: number,
  destSize: number,
  minSrc: number,
  maxSrc: number,
): [number, number] {
  const span = maxSrc - minSrc + 1;
  if (destSize < span) {
    const startOffset = Math.floor((destIndex * span) / destSize);
    const endOffset = Math.max(
      startOffset,
      Math.ceil(((destIndex + 1) * span) / destSize) - 1,
    );
    return [minSrc + startOffset, minSrc + endOffset];
  }
  const src =
    destSize <= 1
      ? minSrc
      : minSrc + Math.round((destIndex / (destSize - 1)) * (maxSrc - minSrc));
  return [src, src];
}

/**
 * Generates a crisp RGBA8 procedural bitmap font texture matching every glyph box
 * in `font.glyphs` using bold geometric display glyphs for `fntb/fntm/fntmb/fntxl`
 * and crisp compact pixel glyphs for `fnts`.
 */
export function createProceduralFontTexture(font: BitmapFontSpec): DecodedTexture {
  const width = Math.max(1, font.scaleW);
  const height = Math.max(1, font.scaleH);
  const rgba = new Uint8Array(width * height * 4);

  for (const glyph of Object.values(font.glyphs)) {
    if (glyph.width <= 0 || glyph.height <= 0 || glyph.id <= 32) {
      continue;
    }
    // Use compact 5x7 when box is very narrow/small to preserve exact thin-box stems
    const src =
      glyph.width <= 5 && glyph.height <= 7
        ? { cols: 5, rows: 7, bits: PIXEL_COMPACT_5X7[glyph.id] ?? PIXEL_COMPACT_5X7[63]! }
        : resolveGlyphSource(font, glyph.id);
    const bounds = computeGridBounds(src.bits, src.cols, src.rows);
    if (!bounds) {
      continue;
    }

    for (let gy = 0; gy < glyph.height; gy++) {
      const [rStart, rEnd] = resolveAxisSampleRange(gy, glyph.height, bounds.minRow, bounds.maxRow);
      for (let gx = 0; gx < glyph.width; gx++) {
        const [cStart, cEnd] = resolveAxisSampleRange(gx, glyph.width, bounds.minCol, bounds.maxCol);
        let lit = false;
        for (let r = rStart; r <= rEnd && !lit; r++) {
          const rowBits = src.bits[r] ?? 0;
          for (let c = cStart; c <= cEnd; c++) {
            if ((rowBits & (1 << (src.cols - 1 - c))) !== 0) {
              lit = true;
              break;
            }
          }
        }
        if (lit) {
          setPixel(rgba, width, height, glyph.x + gx, glyph.y + gy, 255, 255, 255, 255);
        }
      }
    }
  }

  return {
    name: font.name,
    width,
    height,
    rgba,
    source: 'procedural',
  };
}

/**
 * Generates a proportional AngelCode `BitmapFontSpec` for procedural fallback mode.
 * Packs all printable ASCII glyphs (`32..126`) cleanly inside `scaleW x scaleH`
 * with zero clipping and crisp proportional spacing.
 */
export function createProceduralFontSpec(
  name: string,
  face: string,
  size: number,
  lineHeight: number,
  base: number,
  scaleW: number,
  scaleH: number,
): BitmapFontSpec {
  const glyphs: Record<number, BitmapFontGlyph> = {};
  const display =
    face.toLowerCase().includes('pic0') ||
    name === 'fntb' ||
    name === 'fntm' ||
    name === 'fntmb' ||
    name === 'fntxl';
  const srcCols = display ? 6 : 5;
  const srcRows = display ? 8 : 7;

  // Compact cell sizing honoring authentic Pic0 / Volter proportions while fitting 95 glyphs
  const cellW = display ? Math.max(6, Math.round(size * 0.44)) : Math.max(5, Math.round(size * 0.5));
  const cellH = display ? Math.max(8, Math.round(size * 0.66)) : Math.max(7, Math.round(size * 0.7));
  const scaleX = cellW / srcCols;
  const scaleY = cellH / srcRows;
  const baseOffsetY = Math.max(0, Math.floor((lineHeight - cellH) * 0.5));
  const advanceGap = Math.max(1, Math.round(size * (display ? 0.08 : 0.1)));

  let cursorX = 1;
  let cursorY = 1;
  let rowMaxH = 0;

  for (let code = 32; code <= 126; code++) {
    if (code === 32) {
      const spaceW = Math.max(2, Math.floor(cellW * 0.35));
      glyphs[code] = {
        id: code,
        x: 0,
        y: 0,
        width: spaceW,
        height: 1,
        xoffset: 0,
        yoffset: baseOffsetY + cellH,
        xadvance: Math.max(3, Math.round(cellW * 0.52)),
      };
      continue;
    }

    const dispEntry = display ? (BOLD_DISPLAY_6X8[code] ?? BOLD_DISPLAY_6X8[63]!) : null;
    const glyphCols = dispEntry ? dispEntry.cols : 5;
    const bits = dispEntry ? dispEntry.bits : (PIXEL_COMPACT_5X7[code] ?? PIXEL_COMPACT_5X7[63]!);
    const bounds = computeGridBounds(bits, glyphCols, srcRows);
    if (!bounds) {
      glyphs[code] = {
        id: code,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        xoffset: 0,
        yoffset: baseOffsetY,
        xadvance: advanceGap + 1,
      };
      continue;
    }

    const spanCols = bounds.maxCol - bounds.minCol + 1;
    const spanRows = bounds.maxRow - bounds.minRow + 1;
    const maxGlyphW = dispEntry && dispEntry.cols > 6 ? Math.round(cellW * (dispEntry.cols / 6)) : cellW;
    const w = Math.min(maxGlyphW, Math.max(1, Math.round(spanCols * scaleX)));
    const h = Math.min(cellH, Math.max(1, Math.round(spanRows * scaleY)));
    const yoffset = baseOffsetY + Math.round(bounds.minRow * scaleY);

    if (cursorX + w + 1 >= scaleW) {
      cursorX = 1;
      cursorY += rowMaxH + 2;
      rowMaxH = 0;
    }

    glyphs[code] = {
      id: code,
      x: cursorX,
      y: cursorY,
      width: w,
      height: h,
      xoffset: 0,
      yoffset,
      xadvance: w + advanceGap,
    };

    cursorX += w + 2;
    if (h > rowMaxH) rowMaxH = h;
  }

  return {
    name,
    face,
    size,
    lineHeight,
    base,
    scaleW,
    scaleH,
    pageFile: `${name}_0.png`,
    glyphs,
  };
}
