import type {
  AudioAssetManifest,
  BitmapFontGlyph,
  BitmapFontSpec,
  DecodedTexture,
  GameDataBundle,
  SpriteAtlasSpec,
  SpriteEntry,
  VaultAssetBundle,
} from '../contracts/vault';
import {
  normalizeEnemiesData,
  normalizeFxData,
  normalizeGlobalData,
  normalizeParallaxData,
  normalizePlayerData,
  normalizeProjectilesData,
  normalizeRoomData,
  normalizeSpawnCoordinator,
  normalizeSpriteAtlas,
} from './normalizer';
import {
  VANILLA_BGM_STEMS,
  VANILLA_ENEMIES_RAW,
  VANILLA_ENEMIES_SFMT_RAW,
  VANILLA_FX_RAW,
  VANILLA_GLOBAL_RAW,
  VANILLA_MENU_SPRITES_RAW,
  VANILLA_NUKE_SPRITES_RAW,
  VANILLA_PARALLAX_RAW,
  VANILLA_PLAYER_RAW,
  VANILLA_PROJECTILES_RAW,
  VANILLA_ROOM_RAW,
  VANILLA_SFX_CUES,
  VANILLA_SPAWN_COORDINATOR_RAW,
  VANILLA_SPAWN_COORDINATOR_SFMT_RAW,
  VANILLA_SPRITES_RAW,
} from './vanilla-defaults';

// 5x7 clean-room bitmap font glyphs (each row is 5 bits, MSB on left).
const GLYPHS_5X7: Record<number, readonly number[]> = {
  32: [0, 0, 0, 0, 0, 0, 0], // ' '
  33: [4, 4, 4, 4, 4, 0, 4], // '!'
  34: [10, 10, 10, 0, 0, 0, 0], // '"'
  35: [10, 10, 31, 10, 31, 10, 10], // '#'
  36: [4, 15, 20, 14, 5, 30, 4], // '$'
  37: [24, 25, 2, 4, 8, 19, 3], // '%'
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
  48: [14, 17, 19, 21, 25, 17, 14], // '0'
  49: [4, 12, 4, 4, 4, 4, 14], // '1'
  50: [14, 17, 1, 6, 8, 16, 31], // '2'
  51: [30, 1, 1, 14, 1, 1, 30], // '3'
  52: [2, 6, 10, 18, 31, 2, 2], // '4'
  53: [31, 16, 30, 1, 1, 17, 14], // '5'
  54: [6, 8, 16, 30, 17, 17, 14], // '6'
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

function setPixel(
  rgba: Uint8Array,
  texW: number,
  texH: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  if (xi < 0 || yi < 0 || xi >= texW || yi >= texH) {
    return;
  }
  const idx = (yi * texW + xi) * 4;
  rgba[idx] = r;
  rgba[idx + 1] = g;
  rgba[idx + 2] = b;
  rgba[idx + 3] = a;
}

/**
 * Strictly frame-clipped pixel-art rasterizer encoding 8-level luminance indices
 * (`1..7` -> `32..224`) so sprites can never bleed across atlas gutters.
 */
class SpritePainter {
  constructor(
    private readonly rgba: Uint8Array,
    private readonly texW: number,
    private readonly texH: number,
    private readonly fx: number,
    private readonly fy: number,
    readonly w: number,
    readonly h: number,
  ) {}

  px(lx: number, ly: number, paletteIdx: number): void {
    const xi = Math.floor(lx);
    const yi = Math.floor(ly);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) {
      return;
    }
    const ax = this.fx + xi;
    const ay = this.fy + yi;
    if (ax < 0 || ay < 0 || ax >= this.texW || ay >= this.texH) {
      return;
    }
    const idx = (ay * this.texW + ax) * 4;
    if (paletteIdx <= 0) {
      this.rgba[idx] = 0;
      this.rgba[idx + 1] = 0;
      this.rgba[idx + 2] = 0;
      this.rgba[idx + 3] = 0;
      return;
    }
    const lum = Math.min(224, Math.max(32, paletteIdx * 32));
    this.rgba[idx] = lum;
    this.rgba[idx + 1] = lum;
    this.rgba[idx + 2] = lum;
    this.rgba[idx + 3] = 255;
  }

  clear(lx: number, ly: number): void {
    this.px(lx, ly, 0);
  }

  rect(x: number, y: number, rw: number, rh: number, pal: number): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.floor(x + rw));
    const y1 = Math.min(this.h, Math.floor(y + rh));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        this.px(px, py, pal);
      }
    }
  }

  hline(x0: number, x1: number, y: number, pal: number): void {
    const start = Math.floor(Math.min(x0, x1));
    const end = Math.floor(Math.max(x0, x1));
    const yi = Math.floor(y);
    for (let x = start; x <= end; x++) {
      this.px(x, yi, pal);
    }
  }

  vline(x: number, y0: number, y1: number, pal: number): void {
    const start = Math.floor(Math.min(y0, y1));
    const end = Math.floor(Math.max(y0, y1));
    const xi = Math.floor(x);
    for (let y = start; y <= end; y++) {
      this.px(xi, y, pal);
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, pal: number, thickness = 1): void {
    let ix0 = Math.round(x0);
    let iy0 = Math.round(y0);
    const ix1 = Math.round(x1);
    const iy1 = Math.round(y1);
    const dx = Math.abs(ix1 - ix0);
    const dy = Math.abs(iy1 - iy0);
    const sx = ix0 < ix1 ? 1 : -1;
    const sy = iy0 < iy1 ? 1 : -1;
    let err = dx - dy;
    const half = Math.floor(thickness / 2);

    while (true) {
      if (thickness <= 1) {
        this.px(ix0, iy0, pal);
      } else {
        this.rect(ix0 - half, iy0 - half, thickness, thickness, pal);
      }
      if (ix0 === ix1 && iy0 === iy1) break;
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        ix0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        iy0 += sy;
      }
    }
  }

  circle(cx: number, cy: number, radius: number, pal: number): void {
    if (radius <= 0) return;
    const r2 = radius * radius;
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(this.w - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(this.h - 1, Math.ceil(cy + radius));
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const dx = px + 0.5 - cx;
        const dy = py + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) {
          this.px(px, py, pal);
        }
      }
    }
  }

  ring(cx: number, cy: number, rOuter: number, rInner: number, pal: number): void {
    if (rOuter <= 0) return;
    const ro2 = rOuter * rOuter;
    const ri2 = Math.max(0, rInner) * Math.max(0, rInner);
    const minX = Math.max(0, Math.floor(cx - rOuter));
    const maxX = Math.min(this.w - 1, Math.ceil(cx + rOuter));
    const minY = Math.max(0, Math.floor(cy - rOuter));
    const maxY = Math.min(this.h - 1, Math.ceil(cy + rOuter));
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const dx = px + 0.5 - cx;
        const dy = py + 0.5 - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 <= ro2 && d2 >= ri2) {
          this.px(px, py, pal);
        }
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, pal: number): void {
    if (rx <= 0 || ry <= 0) return;
    const invRx2 = 1 / (rx * rx);
    const invRy2 = 1 / (ry * ry);
    const minX = Math.max(0, Math.floor(cx - rx));
    const maxX = Math.min(this.w - 1, Math.ceil(cx + rx));
    const minY = Math.max(0, Math.floor(cy - ry));
    const maxY = Math.min(this.h - 1, Math.ceil(cy + ry));
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const dx = px + 0.5 - cx;
        const dy = py + 0.5 - cy;
        if (dx * dx * invRx2 + dy * dy * invRy2 <= 1) {
          this.px(px, py, pal);
        }
      }
    }
  }

  tri(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
    pal: number,
  ): void {
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(this.w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(this.h - 1, Math.ceil(Math.max(ay, by, cy)));
    const edge = (x0: number, y0: number, x1: number, y1: number, px: number, py: number) =>
      (px - x0) * (y1 - y0) - (py - y0) * (x1 - x0);
    const area = edge(ax, ay, bx, by, cx, cy);
    if (area === 0) return;

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const w0 = edge(bx, by, cx, cy, px + 0.5, py + 0.5);
        const w1 = edge(cx, cy, ax, ay, px + 0.5, py + 0.5);
        const w2 = edge(ax, ay, bx, by, px + 0.5, py + 0.5);
        if (
          (area > 0 && w0 >= 0 && w1 >= 0 && w2 >= 0) ||
          (area < 0 && w0 <= 0 && w1 <= 0 && w2 <= 0)
        ) {
          this.px(px, py, pal);
        }
      }
    }
  }

  quad(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
    dx: number,
    dy: number,
    pal: number,
  ): void {
    this.tri(ax, ay, bx, by, cx, cy, pal);
    this.tri(ax, ay, cx, cy, dx, dy, pal);
  }

  /**
   * Draws an ASCII pixel-art matrix.
   * `'.'` skips, `'0'` clears to transparent, `'1'..'7'` writes palette index 1..7.
   */
  grid(rows: readonly string[], ox = 0, oy = 0, colorMap?: Record<string, number>): void {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!;
      for (let c = 0; c < row.length; c++) {
        const ch = row[c]!;
        if (ch === '.' || ch === ' ') continue;
        if (ch === '0') {
          this.clear(ox + c, oy + r);
          continue;
        }
        const pal = colorMap?.[ch] ?? (ch >= '1' && ch <= '7' ? Number(ch) : 0);
        if (pal > 0) {
          this.px(ox + c, oy + r, pal);
        }
      }
    }
  }

  /**
   * Draws vertically mirrored ASCII pixel-art around the sprite's horizontal axis.
   * For even heights (e.g. 24), provide `h / 2` top rows; for odd heights (e.g. 7),
   * provide `(h - 1) / 2` top rows plus `centerRow`.
   */
  gridSymY(
    topRows: readonly string[],
    centerRow?: string,
    ox = 0,
    oy = 0,
    colorMap?: Record<string, number>,
  ): void {
    const totalH = topRows.length * 2 + (centerRow !== undefined ? 1 : 0);
    for (let r = 0; r < topRows.length; r++) {
      const row = topRows[r]!;
      const mirrorR = totalH - 1 - r;
      for (let c = 0; c < row.length; c++) {
        const ch = row[c]!;
        if (ch === '.' || ch === ' ') continue;
        if (ch === '0') {
          this.clear(ox + c, oy + r);
          this.clear(ox + c, oy + mirrorR);
          continue;
        }
        const pal = colorMap?.[ch] ?? (ch >= '1' && ch <= '7' ? Number(ch) : 0);
        if (pal > 0) {
          this.px(ox + c, oy + r, pal);
          this.px(ox + c, oy + mirrorR, pal);
        }
      }
    }
    if (centerRow !== undefined) {
      const midR = topRows.length;
      for (let c = 0; c < centerRow.length; c++) {
        const ch = centerRow[c]!;
        if (ch === '.' || ch === ' ') continue;
        if (ch === '0') {
          this.clear(ox + c, oy + midR);
          continue;
        }
        const pal = colorMap?.[ch] ?? (ch >= '1' && ch <= '7' ? Number(ch) : 0);
        if (pal > 0) {
          this.px(ox + c, oy + midR, pal);
        }
      }
    }
  }
}

// ============================================================================
// Handcrafted 100% Original SKYBREAKER Aircraft Part Pixel Grids (24x24, +X)
// Slim fighter-jet proportions: distinct tail/engine zone (x=0..8), crisp open
// tail waist (x=5..10), slim 4px fuselage (y=10..13) to sharp nose (x=22..23),
// and dramatic full-span wings (y=0..23) anchored forward (x=11..18).
// ============================================================================

// Player Engines (rear x=0..8, 12 top rows mirrored vertically to 24 rows)
const ENGINE_STANDARD_TOP: readonly string[] = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '..11....................',
  '...111..................',
  '....111.................',
  '....1111................',
  '.51111111...............',
  '751111111...............',
];

const ENGINE_SUPERBOOST_TOP: readonly string[] = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '..1111..................',
  '5111111.................',
  '7511111.................',
  '..11111.................',
  '....111.................',
  '...111111...............',
  '..1111111...............',
];

const ENGINE_GUNGINE_TOP: readonly string[] = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '....111.................',
  '...11511................',
  '51111111................',
  '...11111................',
  '511111111...............',
  '.11111111...............',
];

const ENGINE_UNDERWATER_TOP: readonly string[] = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '..111...................',
  '..15111.................',
  '....1111................',
  '....11111...............',
  '...115711...............',
  '..1111111...............',
];

const ENGINE_HOVER_TOP: readonly string[] = [
  '........................',
  '........................',
  '........................',
  '........................',
  '...111..................',
  '.115711.................',
  '.11..11.................',
  '11....11................',
  '115.....................',
  '11......................',
  '115..1111...............',
  '117.11111...............',
];

// Player Bodies (slim fuselage x=6..23, 12 top rows mirrored vertically to 24 rows)
const BODY_STANDARD_TOP: readonly string[] = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '......11111111111111....',
  '......11111115771111111.',
];

const BODY_ARMOR_TOP: readonly string[] = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........11111...........',
  '.......115111111........',
  '......111111111111151...',
  '......1115771111111111..',
  '......11157711111111111.',
];

const BODY_MELEE_TOP: readonly string[] = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '..................115...',
  '..................1115..',
  '.................111157.',
  '......111111111111111577',
  '......111111571111111777',
];

const BODY_NUKE_TOP: readonly string[] = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........11551...........',
  '.......1157751..........',
  '......115777511.........',
  '......11157751111111....',
  '......1111551111111111..',
];

const BODY_BOMB_TOP: readonly string[] = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '......1.11115...........',
  '......1111157...........',
  '........1111............',
  '......111111155111111...',
  '......11111115711111111.',
];

// Player Wings / Weapons (full span y=0..9 + 14..23, anchored forward at x=11..18 for clean waist!)
const WINGS_STANDARD_TOP: readonly string[] = [
  '........115.............',
  '.........1111...........',
  '..........1111..........',
  '...........1111.........',
  '...........11111........',
  '............11111.......',
  '............111111......',
  '............111111115...',
  '.............111111.....',
  '..............11111.....',
  '........................',
  '........................',
];

const WINGS_LASER_TOP: readonly string[] = [
  '................11157...',
  '...............111115...',
  '..............11111.....',
  '.............11111......',
  '............11111.......',
  '............1111........',
  '............111111157...',
  '.............111111.....',
  '.............11111......',
  '..............1111......',
  '........................',
  '........................',
];

const WINGS_SPREAD_TOP: readonly string[] = [
  '...........1115.........',
  '...........1111157......',
  '............1111........',
  '............11111.......',
  '............11111157....',
  '.............11111......',
  '.............111111.....',
  '.............111111157..',
  '.............11111......',
  '..............1111......',
  '........................',
  '........................',
];

const WINGS_MISSILES_TOP: readonly string[] = [
  '.........111............',
  '..........1111..........',
  '...........1111.........',
  '...........11111........',
  '...........1111111157...',
  '...........1111111115...',
  '............111111157...',
  '.............111111.....',
  '.............11111......',
  '..............1111......',
  '........................',
  '........................',
];

const WINGS_CANNON_TOP: readonly string[] = [
  '........1111............',
  '.........11111..........',
  '..........11111.........',
  '...........11111........',
  '...........111111.......',
  '............111111......',
  '............11111111115.',
  '.............11111157117',
  '.............111111111..',
  '..............11111.....',
  '........................',
  '........................',
];

// Enemy Small Aircraft (20x20, 10 top rows mirrored vertically to 20 rows)
const ENEMY_FIGHTER_BODY_TOP: readonly string[] = [
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '..122...............',
  '...22222............',
  '.....2222222........',
  '......22222772221...',
  '......22222572222211',
];

const ENEMY_FIGHTER_WINGS_TOP: readonly string[] = [
  '....................',
  '.....225............',
  '......2221..........',
  '.......2222.........',
  '.......22222........',
  '........2222211.....',
  '........222222......',
  '.........2222.......',
  '....................',
  '....................',
];

const ENEMY_JET_BODY_TOP: readonly string[] = [
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '..122...............',
  '...22222222.........',
  '.512222227722222....',
  '75122222257222222211',
];

const ENEMY_JET_WINGS_TOP: readonly string[] = [
  '....................',
  '....................',
  '...15...............',
  '....221.............',
  '.....2221...........',
  '......22221....25...',
  '.......222222..221..',
  '........222222222...',
  '....................',
  '....................',
];

const ENEMY_JET_BODY_CRASH: readonly string[] = [
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '..12................',
  '...222.722..........',
  '.5.22257.2222.......',
  '7..2222..22272221...',
  '...22222.7522222211.',
  '....222222.2222.....',
  '...222..22..........',
  '..12................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
];

const ENEMY_JET_WINGS_CRASH: readonly string[] = [
  '....................',
  '....................',
  '....................',
  '....22..............',
  '.....227............',
  '......2225..........',
  '.......22222...22...',
  '........22222222....',
  '....................',
  '....................',
  '....................',
  '....................',
  '........222222222...',
  '.......222222..22...',
  '......22222.........',
  '.....2222...........',
  '....222.............',
  '...22...............',
  '....................',
  '....................',
];

// Enemy Finned Missile (24x10, 5 top rows mirrored vertically to 10 rows)
const ENEMY_MISSILE_TOP: readonly string[] = [
  '.122....................',
  '..222...................',
  '...2222.................',
  '.5122222212222222277....',
  '7512222221222222227777..',
];

// Player Homing Micro-Rocket (10x7, 3 top rows + centerRow)
const PROJ_HOMING_TOP: readonly string[] = [
  '.15.......',
  '..55555...',
  '75555557..',
];
const PROJ_HOMING_MID = '7555555777';

// Player Drop Bomb (10x4, 2 top rows mirrored)
const PROJ_BOMB_TOP: readonly string[] = [
  '51..1111..',
  '.111111157',
];

// ============================================================================
// Procedural Sprite Compositors
// ============================================================================

function resolveSpritePaletteIndex(spriteName: string): number {
  const n = spriteName.toLowerCase();
  if (
    n === 'urauser' ||
    n.startsWith('engine_') ||
    n.startsWith('body_') ||
    n.startsWith('wings_')
  ) {
    return 1;
  }
  if (
    n.startsWith('fighter_') ||
    n.startsWith('jet_') ||
    n.startsWith('ace_') ||
    n.startsWith('laserace_') ||
    n.startsWith('acemarine') ||
    n.startsWith('submarine') ||
    n.startsWith('big_boat') ||
    n.startsWith('small_boat') ||
    n.startsWith('blimp') ||
    n === 'missile' ||
    n === 'projectile_ebullet' ||
    n === 'projectile_elaser' ||
    n === 'projectile_artillery_bullet'
  ) {
    return 2;
  }
  if (n.startsWith('bg_')) {
    return 4;
  }
  if (
    n.startsWith('projectile_') ||
    n.startsWith('laser_') ||
    n.startsWith('fx_boost') ||
    n.startsWith('fx_superboost') ||
    n.startsWith('fx_aceboost') ||
    n === 'fx_jetboost' ||
    n.includes('flash') ||
    n.includes('fade')
  ) {
    return 5;
  }
  if (n === 'parallax_clouds') {
    return 6;
  }
  return 7;
}

function drawApexOmega(p: SpritePainter): void {
  const w = p.w;
  const h = p.h;
  const cy = h * 0.5;

  // Triple rear afterburner nacelles
  for (const offsetY of [-42, 0, 42]) {
    const ny = cy + offsetY;
    p.rect(w * 0.06, ny - 13, w * 0.14, 26, 1);
    p.rect(w * 0.04, ny - 8, w * 0.05, 16, 5);
    p.rect(w * 0.03, ny - 4, w * 0.03, 8, 7);
  }

  // Sweeping outer delta wings + secondary canard wings
  p.tri(w * 0.66, cy - 18, w * 0.18, h * 0.05, w * 0.34, cy - 12, 1);
  p.tri(w * 0.66, cy + 18, w * 0.18, h * 0.95, w * 0.34, cy + 12, 1);
  // Secondary mid-sweep armored wingplates
  p.tri(w * 0.54, cy - 14, w * 0.14, h * 0.18, w * 0.28, cy - 10, 1);
  p.tri(w * 0.54, cy + 14, w * 0.14, h * 0.82, w * 0.28, cy + 10, 1);
  // Forward interceptor canards
  p.tri(w * 0.86, cy - 10, w * 0.66, cy - 52, w * 0.69, cy - 10, 1);
  p.tri(w * 0.86, cy + 10, w * 0.66, cy + 52, w * 0.69, cy + 10, 1);

  // Wingtip heavy rail-lance emitters
  p.rect(w * 0.18, h * 0.05, w * 0.22, 10, 1);
  p.rect(w * 0.38, h * 0.06, w * 0.06, 6, 5);
  p.rect(w * 0.43, h * 0.07, w * 0.03, 4, 7);
  p.rect(w * 0.18, h * 0.95 - 10, w * 0.22, 10, 1);
  p.rect(w * 0.38, h * 0.94 - 6, w * 0.06, 6, 5);
  p.rect(w * 0.43, h * 0.93 - 4, w * 0.03, 4, 7);

  // Core dreadnought fuselage spine
  p.ellipse(w * 0.48, cy, w * 0.36, h * 0.12, 1);
  p.tri(w * 0.97, cy, w * 0.68, cy - 28, w * 0.68, cy + 28, 1);

  // Wing energy chevrons & hull trim
  p.line(w * 0.24, h * 0.11, w * 0.56, cy - 18, 5, 4);
  p.line(w * 0.24, h * 0.89, w * 0.56, cy + 18, 5, 4);
  p.line(w * 0.30, h * 0.15, w * 0.50, cy - 22, 7, 2);
  p.line(w * 0.30, h * 0.85, w * 0.50, cy + 22, 7, 2);

  // Armored canopy & reactor core strip
  p.ellipse(w * 0.66, cy, 30, 11, 5);
  p.ellipse(w * 0.69, cy, 18, 6, 7);
  p.circle(w * 0.42, cy, 16, 5);
  p.circle(w * 0.42, cy, 9, 7);
}

function drawAceBody(p: SpritePainter, isLaser: boolean): void {
  const cy = Math.floor(p.h / 2); // 22 for 45x45
  // Twin rear afterburner pods
  p.rect(4, cy - 9, 10, 5, 1);
  p.rect(4, cy + 5, 10, 5, 1);
  p.rect(2, cy - 8, 3, 3, 5);
  p.rect(2, cy + 6, 3, 3, 5);
  p.px(2, cy - 7, 7);
  p.px(2, cy + 7, 7);

  // Sculpted fuselage spine
  p.quad(8, cy - 5, 29, cy - 6, 40, cy - 1, 8, cy + 5, 2);
  p.quad(8, cy + 5, 29, cy + 6, 40, cy + 1, 8, cy - 5, 2);
  p.hline(9, 34, cy - 5, 1);
  p.hline(9, 34, cy + 5, 1);

  if (isLaser) {
    // Split rail-prong emitter nose cradling a blazing prism core
    p.rect(28, cy - 6, 15, 3, 1);
    p.rect(28, cy + 4, 15, 3, 1);
    p.hline(34, 43, cy - 5, 5);
    p.hline(34, 43, cy + 5, 5);
    p.rect(31, cy - 2, 7, 5, 5);
    p.rect(33, cy - 1, 5, 3, 7);
    // Reactor spine conduit
    p.hline(14, 30, cy, 5);
    p.hline(19, 27, cy, 7);
  } else {
    // Predator nosecone + twin heavy nose autocannons
    p.tri(44, cy, 31, cy - 4, 31, cy + 4, 2);
    p.hline(34, 42, cy - 4, 1);
    p.hline(34, 42, cy + 4, 1);
    p.px(42, cy - 4, 5);
    p.px(42, cy + 4, 5);
    // Glowing Ace canopy visor
    p.rect(21, cy - 2, 8, 5, 5);
    p.rect(23, cy - 1, 5, 3, 7);
  }

  // Twin tail stabilizer fins
  p.tri(15, cy - 5, 5, cy - 12, 9, cy - 5, 1);
  p.tri(15, cy + 5, 5, cy + 12, 9, cy + 5, 1);
}

function drawAceWings(p: SpritePainter, isLaser: boolean): void {
  const cy = Math.floor(p.h / 2); // 22 for 45x45
  if (isLaser) {
    // Forward-swept scissor wings with capacitor energy rails
    p.quad(16, cy - 6, 25, cy - 6, 33, 2, 23, 2, 2);
    p.quad(16, cy + 6, 25, cy + 6, 33, 42, 23, 42, 2);
    // Outer capacitor pods
    p.rect(24, 1, 13, 3, 1);
    p.rect(24, 41, 13, 3, 1);
    p.hline(31, 37, 2, 7);
    p.hline(31, 37, 42, 7);
    // Glowing leading-edge strips
    p.line(24, cy - 7, 32, 3, 5, 1);
    p.line(24, cy + 7, 32, 41, 5, 1);
    p.line(21, cy - 7, 28, 4, 7, 1);
    p.line(21, cy + 7, 28, 40, 7, 1);
  } else {
    // Swept-back elite predator wings + twin wing pods + forward canards
    p.quad(17, cy - 6, 28, cy - 6, 15, 2, 9, 2, 2);
    p.quad(17, cy + 6, 28, cy + 6, 15, 42, 9, 42, 2);
    // Forward canards
    p.tri(35, cy - 6, 27, cy - 13, 29, cy - 6, 2);
    p.tri(35, cy + 6, 27, cy + 13, 29, cy + 6, 2);
    // Underwing gun pods
    p.rect(17, cy - 14, 14, 3, 1);
    p.rect(17, cy + 12, 14, 3, 1);
    p.px(31, cy - 13, 5);
    p.px(31, cy + 13, 5);
    // Elite Ace wing chevron stripes
    p.line(12, 5, 23, cy - 8, 5, 2);
    p.line(12, 39, 23, cy + 8, 5, 2);
    p.line(14, 4, 21, cy - 10, 7, 1);
    p.line(14, 40, 21, cy + 10, 7, 1);
  }
}

function drawSmallBoat(p: SpritePainter, sinking: boolean): void {
  const w = p.w;
  const h = p.h;
  // Corvette angled hull (facing +X right)
  p.quad(5, h - 1, w - 3, h - 1, w - 1, h - 7, 3, h - 6, 2);
  // Waterline armor belt
  p.hline(4, w - 3, h - 2, 1);
  p.hline(4, w - 2, h - 7, 1);
  // Foredeck turret mount
  p.rect(w - 19, h - 10, 8, 3, 1);
  // Terraced bridge superstructure
  p.rect(19, h - 12, 17, 5, 2);
  p.rect(23, h - 14, 9, 3, 2);
  // Radar mast & aerial
  p.vline(27, 0, h - 14, 1);
  p.hline(25, 29, 2, 1);
  // Glowing bridge viewport & portholes
  p.hline(25, 30, h - 12, 7);
  p.px(14, h - 5, 5);
  p.px(22, h - 5, 5);
  p.px(34, h - 5, 5);
  p.px(44, h - 5, 5);

  if (sinking) {
    // Battle-cracked keel & deck fire
    p.tri(27, h - 12, 33, h - 1, 39, h - 12, 0);
    p.px(28, h - 9, 7);
    p.px(31, h - 7, 5);
    p.px(35, h - 10, 7);
  }
}

function drawBigBoat(p: SpritePainter, sinking: boolean): void {
  const w = p.w;
  const h = p.h;
  // Long armored cruiser hull with flared cutting bow
  p.quad(10, h - 1, w - 12, h - 1, w - 2, h - 20, 6, h - 18, 2);
  // Dark waterline armor belt & deck line
  p.rect(8, h - 6, w - 18, 4, 1);
  p.hline(6, w - 3, h - 19, 1);
  p.hline(12, w - 8, h - 13, 1);

  // Fore & aft armored main turret barbettes
  p.rect(48, h - 26, 32, 7, 2);
  p.rect(52, h - 29, 22, 4, 1);
  p.rect(214, h - 26, 32, 7, 2);
  p.rect(218, h - 29, 22, 4, 1);

  // Central terraced armored citadel
  p.rect(94, h - 30, 108, 11, 2);
  p.rect(108, h - 38, 76, 9, 2);
  p.rect(126, h - 43, 36, 6, 1);

  // Twin angled armored smokestacks
  p.quad(116, h - 38, 126, h - 38, 123, h - 47, 113, h - 47, 1);
  p.quad(164, h - 38, 174, h - 38, 171, h - 47, 161, h - 47, 1);

  // Tall radar lattice mast & rangefinder crossbars
  p.vline(144, 0, h - 43, 1);
  p.vline(148, 2, h - 43, 1);
  p.hline(135, 157, 4, 1);
  p.hline(138, 154, 9, 1);
  p.px(146, 1, 7);

  // Illuminated bridge windows & hull porthole sequence
  p.rect(130, h - 41, 28, 2, 7);
  p.rect(114, h - 34, 62, 2, 5);
  for (let x = 26; x < w - 28; x += 14) {
    p.rect(x, h - 11, 3, 2, 5);
  }

  if (sinking) {
    // Snapped midsection & raging deck fires
    p.tri(136, h - 44, 152, h - 1, 176, h - 44, 0);
    p.tri(76, h - 26, 86, h - 10, 96, h - 26, 0);
    for (const [fx, fy] of [
      [82, h - 20],
      [138, h - 30],
      [164, h - 28],
      [216, h - 22],
    ] as const) {
      p.circle(fx, fy, 5, 5);
      p.circle(fx, fy - 2, 3, 7);
    }
  }
}

function drawSubmarine(p: SpritePainter, isCarrier: boolean, sinking: boolean): void {
  const w = p.w;
  const h = p.h;
  // Streamlined teardrop pressure hull
  p.ellipse(w * 0.5, h - 8, w * 0.47, 11, 2);
  p.rect(w * 0.08, h - 14, w * 0.82, 13, 2);
  // Stern hydroplane fin & propeller boss
  p.tri(6, h - 9, 18, h - 19, 24, h - 11, 1);
  p.rect(2, h - 11, 6, 5, 1);
  // Dark flood-port vents & ballast trim
  p.hline(14, w - 14, h - 4, 1);
  for (let x = 26; x < w - 24; x += 12) {
    p.rect(x, h - 9, 5, 2, 1);
  }

  if (isCarrier) {
    // Submersible carrier: angled catapult flight deck + offset armored island
    p.quad(w * 0.52, h - 18, w - 14, h - 23, w - 10, h - 14, w * 0.48, h - 13, 2);
    p.line(w * 0.52, h - 18, w - 14, h - 23, 1, 2);
    // Catapult runway guide lights
    for (let i = 0; i < 6; i++) {
      const lx = Math.round(w * 0.56 + i * 14);
      const ly = Math.round(h - 17 - i * 0.8);
      p.rect(lx, ly, 4, 2, i % 2 === 0 ? 7 : 5);
    }
    // Offset carrier island superstructure
    p.rect(w * 0.25, h - 31, 42, 17, 2);
    p.rect(w * 0.28, h - 33, 30, 3, 1);
    p.rect(w * 0.30, h - 28, 22, 3, 7);
    // Twin radar masts
    p.vline(w * 0.31, 0, h - 32, 1);
    p.hline(w * 0.29, w * 0.33, 2, 1);
    p.vline(w * 0.38, 1, h - 32, 1);
    p.hline(w * 0.36, w * 0.40, 3, 1);
  } else {
    // Attack submarine: sculpted central conning tower + periscope + missile hatches
    const sailX = Math.floor(w * 0.4);
    p.quad(sailX, h - 14, sailX + 36, h - 14, sailX + 30, h - 28, sailX + 5, h - 28, 2);
    p.hline(sailX + 4, sailX + 31, h - 28, 1);
    p.rect(sailX + 18, h - 24, 9, 3, 7);
    // Periscope & snorkel
    p.vline(sailX + 12, 1, h - 28, 1);
    p.hline(sailX + 12, sailX + 16, 1, 1);
    p.vline(sailX + 22, 4, h - 28, 1);
    // Foredeck VLS missile silos
    for (let i = 0; i < 3; i++) {
      const mx = sailX + 44 + i * 14;
      p.rect(mx, h - 18, 8, 4, 1);
      p.hline(mx + 2, mx + 5, h - 18, 5);
    }
  }

  if (sinking) {
    // Hull breach & escaping steam
    p.circle(w * 0.62, h - 14, 12, 0);
    p.circle(w * 0.56, h - 16, 4, 7);
    p.circle(w * 0.66, h - 12, 3, 5);
  }
}

function drawBlimp(p: SpritePainter, dying: boolean): void {
  const w = p.w;
  const h = p.h;
  const cx = w * 0.52;
  const cy = h * 0.44;
  const rx = w * 0.44;
  const ry = h * 0.34;

  // Massive dorsal, ventral, and lateral cruciform tailfins
  p.quad(18, 10, 128, 14, 146, cy - 30, 32, cy - 20, 2);
  p.quad(18, h - 26, 128, h - 30, 146, cy + 30, 32, cy + 20, 2);
  p.line(18, 10, 128, 14, 1, 3);
  p.line(18, h - 26, 128, h - 30, 1, 3);

  // Main rigid armored dirigible envelope
  p.ellipse(cx, cy, rx, ry, 2);

  // Longitudinal girder ribs & armored nose cap
  for (const offsetY of [-42, -16, 16, 42]) {
    const halfSpan = Math.sqrt(Math.max(0, 1 - (offsetY / ry) ** 2)) * rx;
    p.hline(cx - halfSpan + 10, cx + halfSpan - 10, cy + offsetY, 1);
  }
  // Vertical bulkhead rings
  for (const fracX of [0.26, 0.42, 0.58, 0.74, 0.86]) {
    const bx = w * fracX;
    const dx = (bx - cx) / rx;
    const halfH = Math.sqrt(Math.max(0, 1 - dx * dx)) * ry;
    p.vline(bx, cy - halfH + 3, cy + halfH - 3, 1);
  }

  // Lateral rear stabilizer fin
  p.quad(12, cy - 8, 114, cy - 11, 114, cy + 11, 12, cy + 8, 1);
  p.hline(16, 108, cy, 5);

  // Armored prow cone & mooring spike
  p.tri(w - 4, cy, w - 34, cy - 16, w - 34, cy + 16, 1);
  p.hline(w - 22, w - 2, cy, 7);

  // Hull insignia chevron band (skybreaker enemy dreadnought stripe)
  p.quad(w * 0.64, cy - 24, w * 0.69, cy - 24, w * 0.73, cy, w * 0.68, cy, 5);
  p.quad(w * 0.68, cy, w * 0.73, cy, w * 0.69, cy + 24, w * 0.64, cy + 24, 5);

  // Underslung armored battle gondola + rigging struts
  const gx = Math.floor(w * 0.34);
  const gw = Math.floor(w * 0.34);
  const gy = Math.floor(h * 0.76);
  const gh = Math.floor(h * 0.19);
  p.line(gx + 16, cy + ry - 8, gx + 10, gy, 1, 3);
  p.line(gx + gw - 16, cy + ry - 8, gx + gw - 10, gy, 1, 3);
  p.line(gx + gw * 0.5, cy + ry - 2, gx + gw * 0.5, gy, 1, 3);
  p.quad(gx, gy, gx + gw, gy, gx + gw - 14, gy + gh, gx + 14, gy + gh, 1);
  p.rect(gx + 8, gy + 4, gw - 16, gh - 10, 2);

  // Glowing gondola command deck windows
  for (let wx = gx + 18; wx < gx + gw - 24; wx += 18) {
    p.rect(wx, gy + 9, 10, 5, 7);
  }

  if (dying) {
    // Catastrophic envelope ruptures & blazing structural fires
    p.circle(w * 0.38, cy - 12, 34, 0);
    p.circle(w * 0.68, cy + 10, 28, 0);
    p.circle(w * 0.52, cy - 28, 22, 0);
    for (const [fx, fy, r] of [
      [w * 0.38, cy - 12, 16],
      [w * 0.68, cy + 10, 14],
      [w * 0.52, cy - 26, 11],
      [gx + 40, gy + 8, 10],
    ] as const) {
      p.circle(fx, fy, r, 5);
      p.circle(fx, fy, r * 0.55, 7);
    }
  }
}

function drawBlimpPropeller(p: SpritePainter, frameIdx: number): void {
  const cx = Math.floor(p.w / 2);
  const cy = Math.floor(p.h / 2);
  const phase = frameIdx % 6;
  const bladeH = [22, 17, 10, 5, 10, 17][phase]!;
  p.rect(cx - 2, cy - 4, 5, 8, 1);
  p.rect(cx - 1, cy - bladeH, 3, bladeH * 2, 2);
  p.vline(cx, cy - bladeH, cy + bladeH, phase % 2 === 0 ? 7 : 5);
}

function drawGunBarrel(p: SpritePainter, frameIdx: number): void {
  const w = p.w;
  const h = p.h;
  const recoil = frameIdx === 1 ? 3 : frameIdx === 2 ? 2 : frameIdx === 3 ? 1 : 0;
  const mid = Math.floor(h / 2);
  if (h <= 4) {
    // Small boat gun
    p.rect(0, mid - 1, Math.max(4, w - 2 - recoil), 3, 1);
    p.hline(1, Math.max(4, w - 1 - recoil), mid, 2);
    if (frameIdx === 1) {
      p.rect(w - 3, 0, 3, h, 7);
    }
  } else {
    // Big boat heavy turret barrel
    p.rect(0, 1, 10, h - 2, 1);
    p.rect(6, mid - 2, Math.max(8, w - 9 - recoil), 5, 2);
    p.hline(6, Math.max(8, w - 4 - recoil), mid - 2, 1);
    p.hline(6, Math.max(8, w - 4 - recoil), mid + 2, 1);
    // Muzzle brake
    p.rect(Math.max(10, w - 6 - recoil), mid - 3, 3, 7, 1);
    if (frameIdx === 1) {
      p.circle(w - 2, mid, 3, 7);
    }
  }
}

function drawCloudFormation(p: SpritePainter, frameIdx: number, isParallax: boolean): void {
  const w = p.w;
  const h = p.h;
  const basePal = isParallax ? 6 : 7;
  const shadePal = 6;
  const trimPal = 7;

  // Deterministic sculpted cumulus formations with organic rounded base puffs (zero hard bars!)
  const domeCount = isParallax ? 4 : 6;
  const baseY = h * 0.7;

  // 1. Soft overlapping lower cumulus base lobes (provides gentle curved shadow underside)
  const baseLobes = domeCount + 1;
  for (let i = 0; i < baseLobes; i++) {
    const u = baseLobes > 1 ? i / (baseLobes - 1) : 0.5;
    const arch = Math.sin(u * Math.PI);
    const wave = Math.cos(i * 2.1 + frameIdx * 1.15);
    const lx = w * (0.12 + u * 0.76);
    const rx = w * (0.12 + 0.06 * arch);
    const ry = h * (0.09 + 0.07 * arch + 0.02 * Math.abs(wave));
    const ly = baseY + h * (0.015 * wave);
    p.ellipse(lx, ly, rx, ry, shadePal);
  }

  // 2. Sculpted towering sunlit cumulus billows overlapping seamlessly above the base lobes
  for (let i = 0; i < domeCount; i++) {
    const u = domeCount > 1 ? i / (domeCount - 1) : 0.5;
    const wave = Math.sin((i + 1) * 1.9 + frameIdx * 1.37);
    const dx = w * (0.14 + u * 0.72 + wave * 0.03);
    const arch = Math.sin(u * Math.PI);
    const rx = w * (0.14 + 0.08 * arch + 0.02 * Math.cos(i * 2.3 + frameIdx));
    const ry = h * (0.16 + 0.24 * arch + 0.05 * Math.abs(wave));
    const dy = baseY - ry * 0.58;
    p.ellipse(dx, dy, rx, ry, basePal);
    if (isParallax) {
      // Bright sunlit top rim on midground parallax clouds
      p.ellipse(dx, dy - ry * 0.28, rx * 0.68, ry * 0.34, trimPal);
    }
  }
}

function drawSpaceClouds(p: SpritePainter, frameIdx: number): void {
  const w = p.w;
  const h = p.h;
  // Upper solid ceiling bank
  p.rect(0, 0, w, h * 0.48, 7);
  // Scalloped hanging cloud billows
  const lobes = 12;
  for (let i = 0; i <= lobes; i++) {
    const cx = (i / lobes) * w;
    const phase = i * 1.3 + frameIdx * 2.1;
    const rx = w / (lobes * 1.15) + Math.sin(phase) * 8;
    const ry = h * (0.22 + 0.16 * Math.abs(Math.cos(phase)));
    p.ellipse(cx, h * 0.48, rx, ry, 7);
    p.ellipse(cx, h * 0.56 + ry * 0.25, rx * 0.75, ry * 0.35, 6);
  }
}

function drawExplosion(p: SpritePainter, frameIdx: number, totalFrames: number): void {
  const w = p.w;
  const h = p.h;
  const cx = w * 0.5;
  const cy = h * 0.5;
  const maxR = Math.min(w, h) * 0.46;
  const t = totalFrames > 1 ? frameIdx / (totalFrames - 1) : 0.4;

  if (t < 0.22) {
    // Phase 1: Blinding jagged impact starburst
    const coreR = maxR * (0.35 + t * 2.1);
    p.circle(cx, cy, coreR, 7);
    const rays = 8;
    for (let i = 0; i < rays; i++) {
      const ang = (i / rays) * Math.PI * 2 + frameIdx * 0.4;
      const len = maxR * (0.65 + (i % 2) * 0.3);
      p.line(cx, cy, cx + Math.cos(ang) * len, cy + Math.sin(ang) * len, 7, Math.max(1, Math.round(w / 18)));
    }
    return;
  }

  if (t < 0.65) {
    // Phase 2: Expanding turbulent multi-lobe blast + shockwave ring
    const u = (t - 0.22) / 0.43;
    const ringR = maxR * (0.55 + u * 0.44);
    const ringThick = Math.max(1.5, maxR * 0.12 * (1 - u * 0.5));
    p.ring(cx, cy, ringR, ringR - ringThick, 6);

    const lobes = w >= 40 ? 7 : 5;
    for (let i = 0; i < lobes; i++) {
      const ang = (i / lobes) * Math.PI * 2 + frameIdx * 0.55;
      const dist = maxR * (0.18 + u * 0.28);
      const lr = maxR * (0.38 - u * 0.08) * (0.8 + 0.25 * Math.sin(i * 2.1));
      p.circle(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, lr, 7);
    }
    // Hot inner highlight
    p.circle(cx, cy, maxR * (0.35 * (1 - u * 0.6)), 5);
    return;
  }

  // Phase 3: Hollowing smoke ring breaking into dissipating puffs
  const u = (t - 0.65) / 0.35;
  const puffs = w >= 40 ? 9 : 6;
  for (let i = 0; i < puffs; i++) {
    const ang = (i / puffs) * Math.PI * 2 + frameIdx * 0.35;
    const dist = maxR * (0.48 + u * 0.34);
    const pr = Math.max(1.2, maxR * (0.28 * (1 - u * 0.72)));
    p.circle(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, pr, i % 2 === 0 ? 7 : 6);
  }
}

function drawSmokePuff(p: SpritePainter, frameIdx: number, totalFrames: number): void {
  const w = p.w;
  const h = p.h;
  const cx = w * 0.5;
  const cy = h * 0.5;
  const maxR = Math.min(w, h) * 0.42;
  const t = totalFrames > 1 ? frameIdx / (totalFrames - 1) : 0.4;
  const pal = t > 0.6 ? 6 : 7;

  if (t < 0.7) {
    const r = Math.max(1.5, maxR * (0.4 + 0.6 * Math.sin(t * Math.PI * 0.9)));
    p.circle(cx, cy, r, pal);
    p.circle(cx - r * 0.45, cy - r * 0.25, r * 0.65, 7);
    p.circle(cx + r * 0.4, cy + r * 0.2, r * 0.55, 6);
  } else {
    // Dissipating wisps
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + frameIdx;
      const d = maxR * 0.55;
      p.circle(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, Math.max(1, maxR * 0.22), 6);
    }
  }
}

function drawWaterSplash(p: SpritePainter, frameIdx: number, totalFrames: number): void {
  const w = p.w;
  const h = p.h;
  const cx = w * 0.5;
  const t = totalFrames > 1 ? frameIdx / (totalFrames - 1) : 0.4;
  const arcRise = Math.sin(Math.min(1, t * 1.15) * Math.PI);
  const plumeH = Math.max(3, h * (0.22 + 0.74 * arcRise));
  const baseW = w * (0.26 + 0.44 * t);

  // Foam collar at waterline
  p.ellipse(cx, h - 2, Math.min(w * 0.48, baseW * 0.6), Math.max(2, h * 0.08), 7);

  if (t < 0.85) {
    // Central rising water column
    const colW = Math.max(2, w * (0.22 * (1 - t * 0.55)));
    p.tri(cx, h - plumeH, cx - colW, h - 1, cx + colW, h - 1, 7);

    // Symmetrical fanning spray jets
    const spraySpan = w * (0.16 + 0.3 * t);
    const sprayH = plumeH * 0.82;
    p.line(cx - 1, h - 2, cx - spraySpan, h - sprayH, 7, Math.max(1, Math.round(w / 18)));
    p.line(cx + 1, h - 2, cx + spraySpan, h - sprayH, 7, Math.max(1, Math.round(w / 18)));
    p.line(cx, h - 2, cx - spraySpan * 0.55, h - plumeH * 0.94, 6, 1);
    p.line(cx, h - 2, cx + spraySpan * 0.55, h - plumeH * 0.94, 6, 1);
  }

  // Airborne water droplets arcing outward & falling
  const drops = w >= 40 ? 8 : 5;
  for (let i = 0; i < drops; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const rank = Math.floor(i / 2) + 1;
    const dx = cx + side * (w * (0.1 + 0.11 * rank) * (0.4 + 0.65 * t));
    const dy = h - plumeH * (0.95 - 0.14 * rank) + t * t * h * 0.28;
    p.circle(dx, dy, Math.max(1, Math.round(w / 24)), i % 3 === 0 ? 6 : 7);
  }
}

function drawBoostFlame(
  p: SpritePainter,
  frameIdx: number,
  totalFrames: number,
  phaseKind: 'start' | 'loop' | 'end' | 'hover',
): void {
  const w = p.w;
  const h = p.h;
  const cy = h * 0.5;
  const t = totalFrames > 1 ? frameIdx / (totalFrames - 1) : 0.5;

  if (phaseKind === 'hover') {
    const r = Math.min(w, h) * (0.28 + 0.16 * (frameIdx % 3) * 0.5);
    p.ring(w * 0.55, cy, r, Math.max(1, r - 2), 5);
    p.circle(w * 0.65, cy, Math.max(1.5, r * 0.4), 7);
    return;
  }

  // Boost sprites project rearward (-X) from engine nozzle at right side (+X)
  const scale =
    phaseKind === 'start'
      ? 0.45 + 0.55 * t
      : phaseKind === 'loop'
        ? 0.8 + 0.2 * ((frameIdx % 2 === 0) ? 1 : 0)
        : 0.85 * (1 - t * 0.72);
  const tipX = Math.max(0, w * (1 - scale));
  const halfH = Math.max(2, h * 0.36 * scale);

  if (phaseKind === 'end' && t > 0.6) {
    // Breaking embers
    p.circle(w * 0.45, cy, 2, 5);
    p.circle(w * 0.72, cy - 2, 1.5, 7);
    p.circle(w * 0.68, cy + 2, 1.5, 5);
    return;
  }

  // Outer flame cone
  p.tri(tipX, cy, w - 1, cy - halfH, w - 1, cy + halfH, 5);
  // Side plasma flicker tongues for superboost
  if (w >= 28) {
    p.tri(tipX + 4, cy - halfH * 0.6, w - 1, cy - halfH * 1.15, w - 1, cy - 2, 5);
    p.tri(tipX + 4, cy + halfH * 0.6, w - 1, cy + halfH * 1.15, w - 1, cy + 2, 5);
  }
  // White-hot Mach diamond inner core
  p.tri(w - (w - tipX) * 0.62, cy, w - 1, cy - halfH * 0.5, w - 1, cy + halfH * 0.5, 7);
}

function drawMuzzleFlash(p: SpritePainter, frameIdx: number, totalFrames: number): void {
  const w = p.w;
  const h = p.h;
  const cy = h * 0.5;
  const t = totalFrames > 1 ? frameIdx / (totalFrames - 1) : 0;
  const decay = 1 - t * 0.62;
  const len = Math.max(4, w * 0.92 * decay);
  const spread = Math.max(2, h * 0.44 * decay);

  // Forward starburst flash cone originating from x=0
  p.tri(0, cy, len, cy - spread * 0.45, len, cy + spread * 0.45, 5);
  p.tri(0, cy, len * 0.75, cy - spread, len * 0.45, cy, 5);
  p.tri(0, cy, len * 0.75, cy + spread, len * 0.45, cy, 5);
  // Incandescent core flash
  p.tri(0, cy, len * 0.68, cy - spread * 0.28, len * 0.68, cy + spread * 0.28, 7);
}

function drawLaserCharge(p: SpritePainter, frameIdx: number, totalFrames: number): void {
  const w = p.w;
  const h = p.h;
  const cx = w * 0.42;
  const cy = h * 0.5;
  const t = totalFrames > 1 ? frameIdx / (totalFrames - 1) : 0.5;

  // Converging energy sparks pulling inward toward core
  const sparkDist = (w * 0.46) * (1 - t * 0.72);
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2 + frameIdx * 0.45;
    const sx = cx + Math.cos(ang) * sparkDist;
    const sy = cy + Math.sin(ang) * sparkDist;
    p.line(sx, sy, cx + Math.cos(ang) * (sparkDist * 0.45), cy + Math.sin(ang) * (sparkDist * 0.45), 5, 1);
    p.px(sx, sy, 7);
  }
  // Growing core + crisp cross flare
  const coreR = Math.max(2, w * (0.1 + 0.2 * t));
  p.circle(cx, cy, coreR, 5);
  p.circle(cx, cy, coreR * 0.6, 7);
  const flare = w * (0.18 + 0.28 * t);
  p.hline(cx - flare, cx + flare, cy, 7);
  p.vline(cx, cy - flare, cy + flare, 7);
}

function drawProceduralSpriteFrame(
  rgba: Uint8Array,
  texW: number,
  texH: number,
  entry: SpriteEntry,
  fx: number,
  fy: number,
  frameIdx: number,
): void {
  const [w, h] = entry.size;
  if (w <= 0 || h <= 0) {
    return;
  }
  const p = new SpritePainter(rgba, texW, texH, fx, fy, w, h);
  const name = entry.name.toLowerCase();
  const pal = resolveSpritePaletteIndex(entry.name);
  const totalFrames = Math.max(1, entry.subs.length);
  const cx = w * 0.5;
  const cy = h * 0.5;

  // --- Player Engines (24x24) ---
  if (name === 'engine_original') {
    p.gridSymY(ENGINE_STANDARD_TOP);
    return;
  }
  if (name === 'engine_superboost') {
    p.gridSymY(ENGINE_SUPERBOOST_TOP);
    return;
  }
  if (name === 'engine_gungine') {
    p.gridSymY(ENGINE_GUNGINE_TOP);
    return;
  }
  if (name === 'engine_underwater') {
    p.gridSymY(ENGINE_UNDERWATER_TOP);
    // 6-frame animated rear marine propeller
    const propHalf = [5, 4, 2, 1, 2, 4][frameIdx % 6]!;
    p.vline(1, 11 - propHalf, 12 + propHalf, 1);
    p.px(0, 11 - propHalf, 5);
    p.px(0, 12 + propHalf, 5);
    if (frameIdx % 2 === 0) {
      p.px(1, 11, 7);
      p.px(1, 12, 7);
    }
    return;
  }
  if (name === 'engine_hover') {
    p.gridSymY(ENGINE_HOVER_TOP);
    return;
  }

  // --- Player Bodies (24x24) ---
  if (name === 'body_original') {
    p.gridSymY(BODY_STANDARD_TOP);
    return;
  }
  if (name === 'body_armor') {
    p.gridSymY(BODY_ARMOR_TOP);
    return;
  }
  if (name === 'body_melee') {
    p.gridSymY(BODY_MELEE_TOP);
    return;
  }
  if (name === 'body_nuke') {
    p.gridSymY(BODY_NUKE_TOP);
    return;
  }
  if (name === 'body_bomb') {
    p.gridSymY(BODY_BOMB_TOP);
    return;
  }

  // --- Player Wings / Weapons (24x24) ---
  if (name === 'wings_original') {
    p.gridSymY(WINGS_STANDARD_TOP);
    return;
  }
  if (name === 'wings_laser') {
    p.gridSymY(WINGS_LASER_TOP);
    return;
  }
  if (name === 'wings_spread') {
    p.gridSymY(WINGS_SPREAD_TOP);
    return;
  }
  if (name === 'wings_missiles') {
    p.gridSymY(WINGS_MISSILES_TOP);
    return;
  }
  if (name === 'wings_cannon') {
    p.gridSymY(WINGS_CANNON_TOP);
    return;
  }

  // --- Apex Omega Super-Craft ---
  if (name === 'urauser') {
    drawApexOmega(p);
    return;
  }

  // --- Enemy Aircraft ---
  if (name === 'fighter_body') {
    p.gridSymY(ENEMY_FIGHTER_BODY_TOP);
    return;
  }
  if (name === 'fighter_wings') {
    p.gridSymY(ENEMY_FIGHTER_WINGS_TOP);
    return;
  }
  if (name === 'jet_body') {
    p.gridSymY(ENEMY_JET_BODY_TOP);
    return;
  }
  if (name === 'jet_wings') {
    p.gridSymY(ENEMY_JET_WINGS_TOP);
    return;
  }
  if (name === 'jet_body_crash') {
    p.grid(ENEMY_JET_BODY_CRASH);
    return;
  }
  if (name === 'jet_wings_crash') {
    p.grid(ENEMY_JET_WINGS_CRASH);
    return;
  }
  if (name === 'ace_body') {
    drawAceBody(p, false);
    return;
  }
  if (name === 'ace_wings') {
    drawAceWings(p, false);
    return;
  }
  if (name === 'laserace_body') {
    drawAceBody(p, true);
    return;
  }
  if (name === 'laserace_wings') {
    drawAceWings(p, true);
    return;
  }

  // --- Enemy Ships, Submarines & Sky-Dreadnought Dirigible ---
  if (name === 'small_boat' || name === 'small_boat_sink') {
    drawSmallBoat(p, name === 'small_boat_sink');
    return;
  }
  if (name === 'big_boat' || name === 'big_boat_sink') {
    drawBigBoat(p, name === 'big_boat_sink');
    return;
  }
  if (name === 'submarine' || name === 'submarine_sink') {
    drawSubmarine(p, false, name === 'submarine_sink');
    return;
  }
  if (name === 'acemarine' || name === 'acemarine_sink') {
    drawSubmarine(p, true, name === 'acemarine_sink');
    return;
  }
  if (name === 'blimp' || name === 'blimp_die') {
    drawBlimp(p, name === 'blimp_die');
    return;
  }
  if (name === 'blimp_anim') {
    drawBlimpPropeller(p, frameIdx);
    return;
  }
  if (name === 'small_boat_gun' || name === 'big_boat_gun') {
    drawGunBarrel(p, frameIdx);
    return;
  }
  if (name === 'missile') {
    p.gridSymY(ENEMY_MISSILE_TOP);
    return;
  }

  // --- Background Distant Silhouette Props (palette index 4) ---
  if (name === 'bg_boat') {
    p.quad(6, h - 1, w - 6, h - 1, w - 2, h - 6, 4, h - 6, 4);
    p.rect(w * 0.34, h - 10, w * 0.28, 5, 4);
    p.vline(w * 0.46, 1, h - 10, 4);
    return;
  }
  if (name === 'bg_sub') {
    p.ellipse(cx, h - 4, w * 0.44, 4, 4);
    p.rect(w * 0.42, 2, 12, h - 6, 4);
    p.vline(w * 0.47, 0, 3, 4);
    return;
  }
  if (name === 'bg_blimp') {
    p.ellipse(cx, h * 0.44, w * 0.42, h * 0.32, 4);
    p.tri(6, 6, 26, h * 0.35, 10, h * 0.5, 4);
    p.tri(6, h - 10, 26, h * 0.55, 10, h * 0.45, 4);
    p.rect(cx - 16, h * 0.74, 32, 8, 4);
    return;
  }
  if (name === 'bg_plane' || name === 'bg_jet' || name === 'bg_ace') {
    p.hline(0, w - 1, Math.floor(cy), 4);
    p.vline(Math.floor(w * 0.45), 0, h - 1, 4);
    p.px(Math.floor(w * 0.65), Math.floor(cy) - 1, 4);
    p.px(Math.floor(w * 0.65), Math.floor(cy) + 1, 4);
    return;
  }
  if (name === 'bg_jet_trail') {
    p.rect(0, 0, w, h, 4);
    return;
  }

  // --- Environment & Clouds ---
  if (name === 'ocean_line') {
    p.hline(0, w - 1, 0, 7);
    for (let x = 0; x < w; x++) {
      // Rhythmic wave-crest shimmer on lower row
      p.px(x, 1, ((x >> 3) + (x % 17 < 9 ? 1 : 0)) % 2 === 0 ? 7 : 6);
    }
    return;
  }
  if (name === 'space_clouds_blank') {
    p.rect(0, 0, w, h, 7);
    return;
  }
  if (name === 'space_clouds') {
    drawSpaceClouds(p, frameIdx);
    return;
  }
  if (name === 'clouds') {
    drawCloudFormation(p, frameIdx, false);
    return;
  }
  if (name === 'parallax_clouds') {
    drawCloudFormation(p, frameIdx, true);
    return;
  }

  // --- Projectiles ---
  if (name === 'projectile_bullet') {
    // Crisp high-velocity player tracer bolt
    const streak = frameIdx % 2 === 0 ? 11 : 9;
    p.rect(cx - streak, cy - 2, streak + 7, 4, 5);
    p.rect(cx - 2, cy - 1, 9, 2, 7);
    p.px(cx + 7, cy, 7);
    return;
  }
  if (name === 'projectile_spreadbullet') {
    // Sharp flak chevron pellet
    p.tri(w - 1, cy, 3, 1, 5, cy, 5);
    p.tri(w - 1, cy, 5, cy, 3, h - 2, 5);
    p.rect(5, cy - 1, 5, 2, 7);
    return;
  }
  if (name === 'projectile_laser') {
    p.rect(0, 0, w, h, 5);
    p.rect(0, 1, w, Math.max(1, h - 2), 7);
    return;
  }
  if (name === 'projectile_elaser') {
    const coreH = Math.max(2, h - 2 - (frameIdx % 2) * 2);
    const pad = Math.floor((h - coreH) / 2);
    p.rect(0, 0, w, h, 2);
    p.rect(0, pad, w, coreH, frameIdx % 2 === 0 ? 7 : 5);
    return;
  }
  if (name === 'laser_fade') {
    const fh = Math.max(1, Math.round(h * (1 - frameIdx / Math.max(1, totalFrames))));
    p.rect(0, Math.floor((h - fh) / 2), w, fh, frameIdx < 2 ? 7 : 5);
    return;
  }
  if (name === 'projectile_homing_missile') {
    p.gridSymY(PROJ_HOMING_TOP, PROJ_HOMING_MID);
    return;
  }
  if (name === 'projectile_plasmabullet' || name === 'projectile_plasmaball') {
    // Crackling plasma mortar orb with spiky rotating corona
    const r = Math.min(w, h) * 0.36;
    p.circle(cx, cy, r, 5);
    p.circle(cx, cy, r * 0.62, 7);
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + frameIdx * 0.55;
      p.line(cx, cy, cx + Math.cos(ang) * (r * 1.3), cy + Math.sin(ang) * (r * 1.3), 7, 1);
    }
    return;
  }
  if (name === 'projectile_bomb') {
    p.gridSymY(PROJ_BOMB_TOP);
    return;
  }
  if (name === 'projectile_artillery_bullet') {
    p.ellipse(cx, cy, w * 0.44, h * 0.36, 2);
    p.tri(w - 1, cy, cx + 1, 1, cx + 1, h - 2, 7);
    p.hline(3, cx, cy, 5);
    return;
  }
  if (name === 'projectile_ebullet') {
    // High-contrast enemy energy orb (bold dark ring + white-hot center + cardinal pips)
    const r = frameIdx % 2 === 0 ? 6.5 : 5.5;
    p.circle(cx, cy, r, 2);
    p.circle(cx, cy, r - 2, 7);
    p.px(cx, cy - r - 1, 2);
    p.px(cx, cy + r + 1, 2);
    p.px(cx - r - 1, cy, 2);
    p.px(cx + r + 1, cy, 2);
    return;
  }
  if (name === 'laser_charge') {
    drawLaserCharge(p, frameIdx, totalFrames);
    return;
  }

  // --- Boost & Thruster FX ---
  if (name === 'fx_booststart' || name === 'fx_superbooststart' || name === 'fx_aceboost_start') {
    drawBoostFlame(p, frameIdx, totalFrames, 'start');
    return;
  }
  if (name === 'fx_boostloop' || name === 'fx_superboostloop' || name === 'fx_aceboost_loop' || name === 'fx_jetboost') {
    drawBoostFlame(p, frameIdx, totalFrames, 'loop');
    return;
  }
  if (name === 'fx_boostend' || name === 'fx_superboostend' || name === 'fx_aceboost_end') {
    drawBoostFlame(p, frameIdx, totalFrames, 'end');
    return;
  }
  if (name === 'fx_boosthover' || name === 'fx_boosthover_idle' || name === 'fx_boosthover_fade') {
    drawBoostFlame(p, frameIdx, totalFrames, 'hover');
    return;
  }
  if (name === 'fx_bigboostcircle') {
    // Expanding sonic-boom shock ring
    const t = totalFrames > 1 ? frameIdx / (totalFrames - 1) : 0.4;
    const rx = Math.max(2, w * (0.2 + 0.28 * t));
    const ry = Math.max(4, h * (0.24 + 0.24 * t));
    p.ellipse(cx, cy, rx, ry, frameIdx < 2 ? 7 : 5);
    p.ellipse(cx, cy, Math.max(0, rx - 3), Math.max(0, ry - 4), 0);
    return;
  }

  // --- Muzzle Flashes ---
  if (
    name === 'fx_fire_flash' ||
    name === 'fx_spread_fire_flash' ||
    name === 'fx_missile_fire_flash' ||
    name === 'fx_plashma_flash' ||
    name === 'fx_ebigflash'
  ) {
    drawMuzzleFlash(p, frameIdx, totalFrames);
    return;
  }

  // --- Explosions, Smoke & Impact Sparks ---
  if (name.startsWith('fx_explode')) {
    drawExplosion(p, frameIdx, totalFrames);
    return;
  }
  if (name.startsWith('fx_smoke') || name === 'fx_poof' || name === 'fx_missile_trail') {
    drawSmokePuff(p, frameIdx, totalFrames);
    return;
  }
  if (
    name.startsWith('fx_splash') ||
    name === 'fx_watertrail' ||
    name.startsWith('fx_boat_trail') ||
    name.startsWith('fx_big_boat_trail') ||
    name === 'fx_subsplash' ||
    name === 'fx_boostsplash' ||
    name === 'fx_laser_splash'
  ) {
    drawWaterSplash(p, frameIdx, totalFrames);
    return;
  }
  if (name === 'fx_bullet_hit' || name === 'fx_player_hit') {
    // Crisp directional X-spark impact burst
    const t = totalFrames > 1 ? frameIdx / (totalFrames - 1) : 0;
    const arm = Math.min(w, h) * (0.22 + 0.24 * (1 - t * 0.4));
    p.line(cx - arm, cy - arm, cx + arm, cy + arm, 7, 1);
    p.line(cx - arm, cy + arm, cx + arm, cy - arm, 7, 1);
    if (frameIdx === 0) {
      p.circle(cx, cy, Math.max(2, arm * 0.45), 7);
    }
    return;
  }
  if (name === 'fx_ebullet_fade' || name === 'fx_spread_fade' || name === 'fx_plasma_fade') {
    const t = totalFrames > 1 ? frameIdx / (totalFrames - 1) : 0.4;
    const r = Math.max(1.5, Math.min(w, h) * (0.38 * (1 - t * 0.55)));
    p.ring(cx, cy, r, Math.max(0, r - 2), t < 0.5 ? 7 : 5);
    return;
  }
  if (name === 'fx_drip') {
    p.rect(0, frameIdx % 2, w, Math.max(1, h - 1), 7);
    return;
  }
  if (name === 'fx_repair') {
    // Twinkling repair '+' sparkle
    p.hline(0, w - 1, Math.floor(cy), 7);
    p.vline(Math.floor(cx), 0, h - 1, 7);
    return;
  }
  if (name === 'skybreaker_logo' || name === 'luftrausers_logo') {
    drawSkybreakerCrest(p);
    return;
  }

  // Small 1..4px FX
  if (w <= 4 || h <= 4) {
    p.rect(0, 0, w, h, pal);
    return;
  }

  // Fallback crisp emblem
  p.ellipse(cx, cy, Math.max(1, w * 0.36), Math.max(1, h * 0.36), pal);
}

function drawSkybreakerCrest(p: SpritePainter): void {
  const w = p.w;
  const h = p.h;
  const cx = w * 0.5;
  // Clean original winged chevron emblem & framed nameplate banner
  p.rect(w * 0.08, h * 0.38, w * 0.84, h * 0.34, 7);
  p.rect(w * 0.11, h * 0.42, w * 0.78, h * 0.26, 1);
  // Swept twin emblem wings rising above banner
  p.tri(cx, h * 0.14, cx - w * 0.26, h * 0.38, cx - w * 0.05, h * 0.38, 7);
  p.tri(cx, h * 0.14, cx + w * 0.26, h * 0.38, cx + w * 0.05, h * 0.38, 7);
  p.tri(cx, h * 0.22, cx - w * 0.14, h * 0.38, cx + w * 0.14, h * 0.38, 5);
}

/**
 * Generates a deterministic 2048x1024 RGBA8 gameplay atlas with 8-level luminance encoding
 * (`idx * 32`) covering every sprite referenced in `sprites.json`.
 */
export function createProceduralSpritesTexture(atlas: SpriteAtlasSpec): DecodedTexture {
  const width = atlas.width || 2048;
  const height = atlas.height || 1024;
  const rgba = new Uint8Array(width * height * 4);

  for (const entry of Object.values(atlas.sprites)) {
    entry.subs.forEach((frame, idx) => {
      drawProceduralSpriteFrame(rgba, width, height, entry, frame.x, frame.y, idx);
    });
  }

  return {
    name: 'sprites',
    width,
    height,
    rgba,
    source: 'procedural',
  };
}

/**
 * Generates a clean-room 2048x1024 RGBA8 menu texture (`sheet2grey.png` replacement)
 * conforming to `menusprites.json` coordinates and 8-level palette indices.
 */
export function createProceduralMenuTexture(atlas?: SpriteAtlasSpec): DecodedTexture {
  const resolvedAtlas =
    atlas ?? normalizeSpriteAtlas('menusprites', VANILLA_MENU_SPRITES_RAW, 2048, 1024);
  const width = resolvedAtlas.width || 2048;
  const height = resolvedAtlas.height || 1024;
  const rgba = new Uint8Array(width * height * 4);

  for (const entry of Object.values(resolvedAtlas.sprites)) {
    const [w, h] = entry.size;
    if (w <= 0 || h <= 0) {
      continue;
    }
    entry.subs.forEach((frame, idx) => {
      const p = new SpritePainter(rgba, width, height, frame.x, frame.y, w, h);
      if (entry.name === 'main_colors') {
        p.rect(0, 0, 1, 1, Math.min(7, idx + 1));
        return;
      }
      if (w <= 2 || h <= 2) {
        p.rect(0, 0, w, h, 7);
        return;
      }
      if (
        entry.name.includes('panel') ||
        entry.name.includes('frame') ||
        entry.name.includes('machine') ||
        entry.name.includes('scr_')
      ) {
        p.rect(0, 0, w, h, 1);
        p.rect(0, 0, w, 2, 7);
        p.rect(0, h - 2, w, 2, 7);
        p.rect(0, 0, 2, h, 7);
        p.rect(w - 2, 0, 2, h, 7);
        return;
      }
      if (entry.name === 'skybreaker_logo' || entry.name === 'luftrausers_logo') {
        drawSkybreakerCrest(p);
        return;
      }
      p.rect(1, 1, Math.max(1, w - 2), Math.max(1, h - 2), 6);
      p.circle(w * 0.5, h * 0.5, Math.max(1, Math.min(w, h) * 0.28), 7);
    });
  }

  return {
    name: 'menusprites',
    width,
    height,
    rgba,
    source: 'procedural',
  };
}

/**
 * Generates a clean-room 2048x1024 RGBA8 16-frame thermobaric mushroom cloud texture
 * matching `nukesprites.json` frame offsets.
 */
export function createProceduralNukeTexture(atlas?: SpriteAtlasSpec): DecodedTexture {
  const resolvedAtlas =
    atlas ?? normalizeSpriteAtlas('nukesprites', VANILLA_NUKE_SPRITES_RAW, 2048, 1024);
  const width = resolvedAtlas.width || 2048;
  const height = resolvedAtlas.height || 1024;
  const rgba = new Uint8Array(width * height * 4);
  const entry = resolvedAtlas.sprites.nuke;
  if (!entry) {
    return { name: 'nukesprites', width, height, rgba, source: 'procedural' };
  }

  const [fw, fh] = entry.size;
  const total = Math.max(1, entry.subs.length);
  entry.subs.forEach((frame, idx) => {
    const p = new SpritePainter(rgba, width, height, frame.x, frame.y, fw, fh);
    const progress = (idx + 1) / total;
    const cx = fw * 0.5;
    const baseY = fh * 0.86;
    const stemH = fh * (0.24 + 0.56 * progress);
    const stemW = fw * (0.12 + 0.08 * progress);
    const capY = baseY - stemH;
    const capRx = fw * (0.18 + 0.29 * Math.sin(progress * Math.PI * 0.85));
    const capRy = fh * (0.12 + 0.16 * progress);

    // Expanding ground shockwave skirt
    p.ellipse(cx, baseY, stemW * (1.5 + progress), 14 + progress * 10, 6);
    p.ellipse(cx, baseY - 2, stemW * (1.1 + progress * 0.5), 8, 7);

    // Rising stem column with bright incandescent core
    p.rect(cx - stemW * 0.5, capY, stemW, stemH, 6);
    p.rect(cx - stemW * 0.22, capY + 6, stemW * 0.44, stemH - 6, 7);

    // Billowing toroidal crown cap
    p.ellipse(cx, capY, capRx, capRy, 7);
    p.ellipse(cx - capRx * 0.45, capY + capRy * 0.25, capRx * 0.5, capRy * 0.55, 6);
    p.ellipse(cx + capRx * 0.45, capY + capRy * 0.25, capRx * 0.5, capRy * 0.55, 6);
    p.ellipse(cx, capY - capRy * 0.15, capRx * 0.65, capRy * 0.52, 7);
    if (progress < 0.7) {
      p.ellipse(cx, capY + capRy * 0.05, capRx * 0.35, capRy * 0.28, 5);
    }
  });

  return {
    name: 'nukesprites',
    width,
    height,
    rgba,
    source: 'procedural',
  };
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
 * in `font.glyphs` (used both in procedural fallback mode and when Steam's `fnt*_0.png`
 * files are `PCP\0` blobs).
 */
export function createProceduralFontTexture(font: BitmapFontSpec): DecodedTexture {
  const width = Math.max(1, font.scaleW);
  const height = Math.max(1, font.scaleH);
  const rgba = new Uint8Array(width * height * 4);

  for (const glyph of Object.values(font.glyphs)) {
    if (glyph.width <= 0 || glyph.height <= 0 || glyph.id <= 32) {
      continue;
    }
    const bitmap = GLYPHS_5X7[glyph.id] ?? GLYPHS_5X7[63]!; // '?' fallback for extended glyphs
    let minCol = 5;
    let maxCol = -1;
    let minRow = 7;
    let maxRow = -1;
    for (let row = 0; row < 7; row++) {
      const rowBits = bitmap[row] ?? 0;
      if (rowBits === 0) continue;
      for (let col = 0; col < 5; col++) {
        if ((rowBits & (1 << (4 - col))) !== 0) {
          if (col < minCol) minCol = col;
          if (col > maxCol) maxCol = col;
          if (row < minRow) minRow = row;
          if (row > maxRow) maxRow = row;
        }
      }
    }
    if (maxCol < minCol || maxRow < minRow) {
      continue;
    }

    for (let gy = 0; gy < glyph.height; gy++) {
      const [rStart, rEnd] = resolveAxisSampleRange(gy, glyph.height, minRow, maxRow);
      for (let gx = 0; gx < glyph.width; gx++) {
        const [cStart, cEnd] = resolveAxisSampleRange(gx, glyph.width, minCol, maxCol);
        let lit = false;
        for (let r = rStart; r <= rEnd && !lit; r++) {
          const rowBits = bitmap[r] ?? 0;
          for (let c = cStart; c <= cEnd; c++) {
            if ((rowBits & (1 << (4 - c))) !== 0) {
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

function computeGlyphBounds(bitmap: readonly number[]): {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
} | null {
  let minCol = 5;
  let maxCol = -1;
  let minRow = 7;
  let maxRow = -1;
  for (let row = 0; row < 7; row++) {
    const rowBits = bitmap[row] ?? 0;
    if (rowBits === 0) continue;
    for (let col = 0; col < 5; col++) {
      if ((rowBits & (1 << (4 - col))) !== 0) {
        if (col < minCol) minCol = col;
        if (col > maxCol) maxCol = col;
        if (row < minRow) minRow = row;
        if (row > maxRow) maxRow = row;
      }
    }
  }
  if (maxCol < minCol || maxRow < minRow) {
    return null;
  }
  return { minCol, maxCol, minRow, maxRow };
}

function createProceduralFontSpec(
  name: string,
  face: string,
  size: number,
  lineHeight: number,
  base: number,
  scaleW: number,
  scaleH: number,
): BitmapFontSpec {
  const glyphs: Record<number, BitmapFontGlyph> = {};
  const cellW = Math.max(5, Math.round(size * 0.55));
  const cellH = Math.max(7, Math.round(size * 0.72));
  const cols = Math.max(1, Math.floor(scaleW / (cellW + 1)));
  const scaleX = cellW / 5;
  const scaleY = cellH / 7;
  const baseOffsetY = Math.max(0, Math.floor((lineHeight - cellH) * 0.5));
  const advanceGap = Math.max(1, Math.round(size * 0.1));

  for (let code = 32; code <= 126; code++) {
    const idx = code - 32;
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const gx = col * (cellW + 1);
    const gy = row * (cellH + 1);

    if (code === 32) {
      const spaceW = Math.max(2, Math.floor(cellW * 0.4));
      glyphs[code] = {
        id: code,
        x: gx,
        y: gy,
        width: spaceW,
        height: 1,
        xoffset: 0,
        yoffset: baseOffsetY + cellH,
        xadvance: Math.max(3, Math.round(cellW * 0.55)),
      };
      continue;
    }

    const bitmap = GLYPHS_5X7[code] ?? GLYPHS_5X7[63]!;
    const bounds = computeGlyphBounds(bitmap);
    if (!bounds) {
      glyphs[code] = {
        id: code,
        x: gx,
        y: gy,
        width: 1,
        height: 1,
        xoffset: 0,
        yoffset: baseOffsetY,
        xadvance: advanceGap + 1,
      };
      continue;
    }

    // Derive tight AngelCode-style glyph box & vertical offset directly from the 5x7 lit bounds
    // so short/narrow glyphs ('-', ',', '.', ':', '!', '(', ')', '~', lowercase) keep exact proportions.
    const spanCols = bounds.maxCol - bounds.minCol + 1;
    const spanRows = bounds.maxRow - bounds.minRow + 1;
    const w = Math.min(cellW, Math.max(1, Math.round(spanCols * scaleX)));
    const h = Math.min(cellH, Math.max(1, Math.round(spanRows * scaleY)));
    const yoffset = baseOffsetY + Math.round(bounds.minRow * scaleY);

    glyphs[code] = {
      id: code,
      x: gx,
      y: gy,
      width: w,
      height: h,
      xoffset: 0,
      yoffset,
      xadvance: w + advanceGap,
    };
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

/**
 * Creates a complete clean-room KRUNKED SKYBREAKER procedural asset bundle
 * (`vaultSource: 'procedural-fallback'`) with original aircraft callsigns,
 * handcrafted procedural pixel art, 90 missions, 2048x1024 RGBA8 atlases,
 * and procedural bitmap fonts.
 */
export function createProceduralFallbackBundle(): VaultAssetBundle {
  const spritesAtlas = normalizeSpriteAtlas('sprites', VANILLA_SPRITES_RAW, 2048, 1024);
  const menuAtlas = normalizeSpriteAtlas('menusprites', VANILLA_MENU_SPRITES_RAW, 2048, 1024);
  const nukeAtlas = normalizeSpriteAtlas('nukesprites', VANILLA_NUKE_SPRITES_RAW, 2048, 1024);

  const fonts: Record<string, BitmapFontSpec> = {
    fntb: createProceduralFontSpec('fntb', 'Pic0', 32, 34, 25, 256, 256),
    fntm: createProceduralFontSpec('fntm', 'Pic0', 16, 18, 13, 128, 128),
    fntmb: createProceduralFontSpec('fntmb', 'Pic0', 16, 18, 13, 128, 128),
    fnts: createProceduralFontSpec('fnts', 'PixelSans', 11, 10, 8, 128, 128),
    fntxl: createProceduralFontSpec('fntxl', 'Pic0', 48, 50, 37, 512, 256),
  };

  const data: GameDataBundle = {
    vaultSource: 'procedural-fallback',
    steamDir: null,
    player: normalizePlayerData(VANILLA_PLAYER_RAW),
    projectiles: normalizeProjectilesData(VANILLA_PROJECTILES_RAW),
    enemies: normalizeEnemiesData(VANILLA_ENEMIES_RAW),
    enemiesSfmt: normalizeEnemiesData(VANILLA_ENEMIES_SFMT_RAW),
    spawnCoordinator: normalizeSpawnCoordinator(VANILLA_SPAWN_COORDINATOR_RAW),
    spawnCoordinatorSfmt: normalizeSpawnCoordinator(VANILLA_SPAWN_COORDINATOR_SFMT_RAW),
    global: normalizeGlobalData(VANILLA_GLOBAL_RAW),
    fx: normalizeFxData(VANILLA_FX_RAW),
    parallax: normalizeParallaxData(VANILLA_PARALLAX_RAW),
    room: normalizeRoomData(VANILLA_ROOM_RAW),
    atlases: {
      sprites: spritesAtlas,
      menusprites: menuAtlas,
      nukesprites: nukeAtlas,
    },
    fonts,
  };

  const textures: Record<string, DecodedTexture> = {
    sprites: createProceduralSpritesTexture(spritesAtlas),
    menusprites: createProceduralMenuTexture(menuAtlas),
    nukesprites: createProceduralNukeTexture(nukeAtlas),
    fntb: createProceduralFontTexture(fonts.fntb!),
    fntm: createProceduralFontTexture(fonts.fntm!),
    fntmb: createProceduralFontTexture(fonts.fntmb!),
    fnts: createProceduralFontTexture(fonts.fnts!),
    fntxl: createProceduralFontTexture(fonts.fntxl!),
  };

  const bgm: Record<string, string | null> = {};
  for (const stem of VANILLA_BGM_STEMS) {
    bgm[stem] = null;
  }
  const sfx: Record<string, string | null> = {};
  for (const cue of VANILLA_SFX_CUES) {
    sfx[cue] = null;
  }

  const audioManifest: AudioAssetManifest = {
    source: 'procedural-fallback',
    bgm,
    sfx,
  };

  return {
    data,
    textures,
    audioManifest,
  };
}
