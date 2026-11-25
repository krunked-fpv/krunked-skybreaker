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

function setPalettePixel(
  rgba: Uint8Array,
  texW: number,
  texH: number,
  x: number,
  y: number,
  paletteIdx: number,
): void {
  if (paletteIdx <= 0) {
    return;
  }
  const lum = Math.min(224, Math.max(32, paletteIdx * 32));
  setPixel(rgba, texW, texH, x, y, lum, lum, lum, 255);
}

function fillRectPalette(
  rgba: Uint8Array,
  texW: number,
  texH: number,
  x: number,
  y: number,
  w: number,
  h: number,
  paletteIdx: number,
): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(texW, Math.floor(x + w));
  const y1 = Math.min(texH, Math.floor(y + h));
  const lum = Math.min(224, Math.max(32, paletteIdx * 32));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const idx = (py * texW + px) * 4;
      rgba[idx] = lum;
      rgba[idx + 1] = lum;
      rgba[idx + 2] = lum;
      rgba[idx + 3] = 255;
    }
  }
}

function fillCirclePalette(
  rgba: Uint8Array,
  texW: number,
  texH: number,
  cx: number,
  cy: number,
  radius: number,
  paletteIdx: number,
): void {
  const r2 = radius * radius;
  const minX = Math.floor(cx - radius);
  const maxX = Math.ceil(cx + radius);
  const minY = Math.floor(cy - radius);
  const maxY = Math.ceil(cy + radius);
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= r2) {
        setPalettePixel(rgba, texW, texH, px, py, paletteIdx);
      }
    }
  }
}

function fillEllipsePalette(
  rgba: Uint8Array,
  texW: number,
  texH: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  paletteIdx: number,
): void {
  const invRx2 = rx > 0 ? 1 / (rx * rx) : 1;
  const invRy2 = ry > 0 ? 1 / (ry * ry) : 1;
  const minX = Math.floor(cx - rx);
  const maxX = Math.ceil(cx + rx);
  const minY = Math.floor(cy - ry);
  const maxY = Math.ceil(cy + ry);
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx * invRx2 + dy * dy * invRy2 <= 1) {
        setPalettePixel(rgba, texW, texH, px, py, paletteIdx);
      }
    }
  }
}

function drawPolygonTrianglePalette(
  rgba: Uint8Array,
  texW: number,
  texH: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  paletteIdx: number,
): void {
  const minX = Math.floor(Math.min(ax, bx, cx));
  const maxX = Math.ceil(Math.max(ax, bx, cx));
  const minY = Math.floor(Math.min(ay, by, cy));
  const maxY = Math.ceil(Math.max(ay, by, cy));
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
        setPalettePixel(rgba, texW, texH, px, py, paletteIdx);
      }
    }
  }
}

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
  const name = entry.name.toLowerCase();
  const pal = resolveSpritePaletteIndex(entry.name);
  const cx = fx + w * 0.5;
  const cy = fy + h * 0.5;

  // Player / enemy aircraft silhouettes (facing +X right)
  if (name.startsWith('body_') || name === 'fighter_body' || name === 'jet_body' || name === 'jet_body_crash' || name === 'ace_body' || name === 'laserace_body') {
    drawPolygonTrianglePalette(
      rgba,
      texW,
      texH,
      fx + w * 0.92,
      cy,
      fx + w * 0.15,
      fy + h * 0.28,
      fx + w * 0.15,
      fy + h * 0.72,
      pal,
    );
    fillRectPalette(rgba, texW, texH, fx + w * 0.08, cy - h * 0.12, w * 0.35, h * 0.24, pal);
    return;
  }

  if (name.startsWith('wings_') || name === 'fighter_wings' || name === 'jet_wings' || name === 'jet_wings_crash' || name === 'ace_wings' || name === 'laserace_wings') {
    drawPolygonTrianglePalette(
      rgba,
      texW,
      texH,
      fx + w * 0.65,
      cy,
      fx + w * 0.2,
      fy + h * 0.08,
      fx + w * 0.3,
      cy,
      pal,
    );
    drawPolygonTrianglePalette(
      rgba,
      texW,
      texH,
      fx + w * 0.65,
      cy,
      fx + w * 0.3,
      cy,
      fx + w * 0.2,
      fy + h * 0.92,
      pal,
    );
    return;
  }

  if (name.startsWith('engine_')) {
    fillRectPalette(rgba, texW, texH, fx + w * 0.1, cy - h * 0.18, w * 0.4, h * 0.36, pal);
    return;
  }

  if (name === 'urauser') {
    fillEllipsePalette(rgba, texW, texH, cx, cy, w * 0.42, h * 0.26, 1);
    drawPolygonTrianglePalette(
      rgba,
      texW,
      texH,
      fx + w * 0.96,
      cy,
      fx + w * 0.25,
      fy + h * 0.08,
      fx + w * 0.25,
      fy + h * 0.92,
      1,
    );
    return;
  }

  // Sea vessels & blimps
  if (name.includes('boat') && !name.includes('gun') && !name.includes('trail')) {
    fillRectPalette(rgba, texW, texH, fx + w * 0.08, fy + h * 0.35, w * 0.84, h * 0.6, pal);
    fillRectPalette(rgba, texW, texH, fx + w * 0.32, fy + h * 0.1, w * 0.32, h * 0.3, pal);
    return;
  }

  if (name.includes('submarine') || name.includes('acemarine') || name === 'bg_sub') {
    fillEllipsePalette(rgba, texW, texH, cx, fy + h * 0.65, w * 0.46, h * 0.3, pal);
    fillRectPalette(rgba, texW, texH, fx + w * 0.42, fy + h * 0.15, w * 0.18, h * 0.4, pal);
    return;
  }

  if (name === 'blimp' || name === 'blimp_die' || name === 'bg_blimp') {
    fillEllipsePalette(rgba, texW, texH, cx, cy - h * 0.08, w * 0.46, h * 0.36, pal);
    fillRectPalette(rgba, texW, texH, cx - w * 0.15, fy + h * 0.72, w * 0.3, h * 0.16, pal);
    return;
  }

  if (name.includes('gun')) {
    fillRectPalette(rgba, texW, texH, fx, fy + h * 0.25, w, Math.max(2, h * 0.5), pal);
    return;
  }

  // Clouds & environment lines
  if (name === 'ocean_line' || name === 'space_clouds_blank' || name === 'bg_jet_trail') {
    fillRectPalette(rgba, texW, texH, fx, fy, w, h, pal);
    return;
  }

  if (name === 'clouds' || name === 'parallax_clouds' || name === 'space_clouds') {
    const puffs = 5;
    for (let i = 0; i < puffs; i++) {
      const px = fx + w * (0.18 + (i / (puffs - 1)) * 0.64);
      const py = cy + Math.sin(i * 1.7 + frameIdx) * h * 0.14;
      fillEllipsePalette(rgba, texW, texH, px, py, w * 0.2, h * 0.32, pal);
    }
    return;
  }

  // Explosions & smoke & splashes (animate radius with frameIdx)
  if (name.startsWith('fx_explode') || name.startsWith('fx_smoke') || name === 'fx_poof') {
    const totalFrames = Math.max(1, entry.subs.length);
    const t = totalFrames > 1 ? frameIdx / (totalFrames - 1) : 0.5;
    const rad = Math.max(2, Math.min(w, h) * (0.25 + 0.25 * Math.sin(t * Math.PI)));
    fillCirclePalette(rgba, texW, texH, cx, cy, rad, pal);
    return;
  }

  if (name.startsWith('fx_splash') || name === 'fx_watertrail' || name.startsWith('fx_boat_trail') || name.startsWith('fx_big_boat_trail') || name === 'fx_subsplash') {
    const rad = Math.max(2, Math.min(w, h) * 0.35);
    drawPolygonTrianglePalette(rgba, texW, texH, cx, fy + 1, fx + 1, fy + h - 1, fx + w - 1, fy + h - 1, pal);
    fillCirclePalette(rgba, texW, texH, cx, fy + h * 0.65, rad * 0.6, pal);
    return;
  }

  // Projectiles & small FX
  if (w <= 4 || h <= 4) {
    fillRectPalette(rgba, texW, texH, fx, fy, w, h, pal);
    return;
  }

  if (name.startsWith('projectile_') || name === 'missile') {
    fillEllipsePalette(rgba, texW, texH, cx, cy, w * 0.42, h * 0.38, pal);
    return;
  }

  // Default crisp filled icon/glyph
  fillEllipsePalette(rgba, texW, texH, cx, cy, Math.max(1, w * 0.38), Math.max(1, h * 0.38), pal);
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
      const fx = frame.x;
      const fy = frame.y;
      if (entry.name === 'main_colors') {
        fillRectPalette(rgba, width, height, fx, fy, 1, 1, Math.min(7, idx + 1));
        return;
      }
      if (w <= 2 || h <= 2) {
        fillRectPalette(rgba, width, height, fx, fy, w, h, 7);
        return;
      }
      if (entry.name.includes('panel') || entry.name.includes('frame') || entry.name.includes('machine') || entry.name.includes('scr_')) {
        // Dark interior with bright border
        fillRectPalette(rgba, width, height, fx, fy, w, h, 1);
        fillRectPalette(rgba, width, height, fx, fy, w, 2, 7);
        fillRectPalette(rgba, width, height, fx, fy + h - 2, w, 2, 7);
        fillRectPalette(rgba, width, height, fx, fy, 2, h, 7);
        fillRectPalette(rgba, width, height, fx + w - 2, fy, 2, h, 7);
        return;
      }
      if (entry.name === 'luftrausers_logo') {
        fillRectPalette(rgba, width, height, fx + 40, fy + 120, w - 80, 120, 7);
        fillRectPalette(rgba, width, height, fx + 56, fy + 136, w - 112, 88, 1);
        drawPolygonTrianglePalette(
          rgba,
          width,
          height,
          fx + w * 0.5,
          fy + 60,
          fx + w * 0.35,
          fy + 160,
          fx + w * 0.65,
          fy + 160,
          7,
        );
        return;
      }
      fillRectPalette(rgba, width, height, fx + 1, fy + 1, Math.max(1, w - 2), Math.max(1, h - 2), 6);
      fillCirclePalette(rgba, width, height, fx + w * 0.5, fy + h * 0.5, Math.max(1, Math.min(w, h) * 0.28), 7);
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
 * Generates a clean-room 2048x1024 RGBA8 16-frame mushroom cloud texture (`nuke.png` replacement)
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
    const progress = (idx + 1) / total;
    const cx = frame.x + fw * 0.5;
    const baseY = frame.y + fh * 0.85;
    const stemH = fh * (0.25 + 0.55 * progress);
    const stemW = fw * (0.14 + 0.08 * progress);
    const capY = baseY - stemH;
    const capRx = fw * (0.18 + 0.28 * Math.sin(progress * Math.PI * 0.85));
    const capRy = fh * (0.12 + 0.16 * progress);

    fillRectPalette(rgba, width, height, cx - stemW * 0.5, capY, stemW, stemH, 6);
    fillEllipsePalette(rgba, width, height, cx, capY, capRx, capRy, 7);
    fillEllipsePalette(rgba, width, height, cx, baseY, stemW * 1.4, 16, 6);
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
      const srcRow =
        glyph.height <= 1
          ? minRow
          : minRow + Math.round((gy / (glyph.height - 1)) * (maxRow - minRow));
      const rowBits = bitmap[srcRow] ?? 0;
      for (let gx = 0; gx < glyph.width; gx++) {
        const srcCol =
          glyph.width <= 1
            ? minCol
            : minCol + Math.round((gx / (glyph.width - 1)) * (maxCol - minCol));
        if ((rowBits & (1 << (4 - srcCol))) !== 0) {
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

  for (let code = 32; code <= 126; code++) {
    const idx = code - 32;
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const gx = col * (cellW + 1);
    const gy = row * (cellH + 1);
    const isNarrow = code === 33 || code === 39 || code === 44 || code === 46 || code === 58 || code === 59 || code === 73 || code === 105 || code === 108;
    const w = code === 32 ? Math.max(2, Math.floor(cellW * 0.4)) : isNarrow ? Math.max(2, Math.floor(cellW * 0.45)) : cellW;
    glyphs[code] = {
      id: code,
      x: gx,
      y: gy,
      width: w,
      height: code === 32 ? 1 : cellH,
      xoffset: 0,
      yoffset: Math.max(0, Math.floor((lineHeight - cellH) * 0.5)),
      xadvance: w + Math.max(1, Math.round(size * 0.1)),
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
 * Creates a complete clean-room procedural asset bundle (`vaultSource: 'procedural-fallback'`)
 * with exact vanilla gameplay tables, 126 plane names, 90 missions, 2048x1024 RGBA8 atlases,
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
    fnts: createProceduralFontSpec('fnts', 'Volter (Goldfish)', 11, 10, 8, 128, 128),
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
