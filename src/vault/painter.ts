/**
 * Clean-room pixel-art rasterization primitives and shared SKYBREAKER
 * aircraft silhouette matrices (used by both gameplay and menu atlases).
 */

export function setPixel(
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
 * (`1..7` -> `32..224`) so sprites never bleed across atlas gutters.
 */
export class SpritePainter {
  constructor(
    private readonly rgba: Uint8Array,
    private readonly texW: number,
    private readonly texH: number,
    private readonly fx: number,
    private readonly fy: number,
    readonly w: number,
    readonly h: number,
    private readonly protectBorderZero = false,
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
    if (this.protectBorderZero && (ax === 0 || ay === 0)) {
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

  getPal(lx: number, ly: number): number {
    const xi = Math.floor(lx);
    const yi = Math.floor(ly);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return 0;
    const ax = this.fx + xi;
    const ay = this.fy + yi;
    if (ax < 0 || ay < 0 || ax >= this.texW || ay >= this.texH) return 0;
    const idx = (ay * this.texW + ax) * 4;
    if (this.rgba[idx + 3]! === 0) return 0;
    return Math.min(7, Math.floor((this.rgba[idx]! / 255) * 8));
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

  bevelBox(
    x: number,
    y: number,
    bw: number,
    bh: number,
    fillPal: number,
    borderPal: number,
    hiPal: number,
    shadePal: number,
  ): void {
    this.rect(x, y, bw, bh, fillPal);
    this.hline(x, x + bw - 1, y, borderPal);
    this.hline(x, x + bw - 1, y + bh - 1, borderPal);
    this.vline(x, y, y + bh - 1, borderPal);
    this.vline(x + bw - 1, y, y + bh - 1, borderPal);
    if (bw > 4 && bh > 4) {
      this.hline(x + 1, x + bw - 2, y + 1, hiPal);
      this.vline(x + 1, y + 1, y + bh - 2, hiPal);
      this.hline(x + 1, x + bw - 2, y + bh - 2, shadePal);
      this.vline(x + bw - 2, y + 1, y + bh - 2, shadePal);
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
// Handcrafted Clean-Room SKYBREAKER Aircraft Part Pixel Grids (24x24, +X)
// Iconic crisp silhouette proportions:
//   - Engines: rear x=1..9, y=5..18
//   - Bodies:  fuselage x=8..23, y=5..18
//   - Wings:   full vertical span y=0..23 anchored x=9..21
// Pure graphic-novel silhouette in palette index 1 with minimal high-craft detail.
// ============================================================================

export const ENGINE_STANDARD_TOP: readonly string[] = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '....11..................',
  '....111.................',
  '.....111................',
  '....111111..............',
  '...1111111..............',
  '...1111111..............',
];

export const ENGINE_SUPERBOOST_TOP: readonly string[] = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '..1111..................',
  '.1111111................',
  '..111111................',
  '...111111...............',
  '....111111..............',
  '....111111..............',
  '.....11111..............',
];

export const ENGINE_GUNGINE_TOP: readonly string[] = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '......11................',
  '.....1111...............',
  '.111111111..............',
  '.111111111..............',
  '....111111..............',
  '.111111111..............',
];

export const ENGINE_UNDERWATER_TOP: readonly string[] = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '.....111................',
  '....11111...............',
  '....111111..............',
  '...1111111..............',
  '..11111111..............',
];

export const ENGINE_HOVER_TOP: readonly string[] = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '...1111.................',
  '..111111................',
  '.111..111...............',
  '.11....11...............',
  '.11...1111..............',
  '.11..11111..............',
  '.11..11111..............',
];

export const BODY_STANDARD_TOP: readonly string[] = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........111111111111....',
  '........11111111111111..',
  '........1111111111111111',
];

export const BODY_ARMOR_TOP: readonly string[] = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '.........1111111........',
  '........1111111111......',
  '........111111111111....',
  '........11111111111111..',
  '........111111111111111.',
  '........111111111111111.',
  '........111111111111111.',
];

export const BODY_MELEE_TOP: readonly string[] = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '..................111...',
  '................111111..',
  '........111111111111111.',
  '........1111111111111111',
  '........1111111111111111',
];

export const BODY_NUKE_TOP: readonly string[] = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '.............1111.......',
  '............111111......',
  '...........11111111.....',
  '..........111111111.....',
  '........111111111111....',
  '........1111111111111...',
  '........1111111111111...',
];

export const BODY_BOMB_TOP: readonly string[] = [
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '........................',
  '......11111.............',
  '.....1111111............',
  '........11..............',
  '........111111111111....',
  '........11111111111111..',
  '........1111111111111111',
];

export const WINGS_STANDARD_TOP: readonly string[] = [
  '............111.........',
  '...........11111........',
  '...........11111........',
  '...........111111.......',
  '...........111111.......',
  '...........111111.......',
  '...........11111111.....',
  '...........111111.......',
  '...........111111.......',
  '...........111111.......',
  '........................',
  '........................',
];

export const WINGS_LASER_TOP: readonly string[] = [
  '........................',
  '...............111111...',
  '..............1111111...',
  '..............11111.....',
  '.............11111......',
  '.............1111.......',
  '............11111111....',
  '............11111.......',
  '............1111........',
  '............1111........',
  '........................',
  '........................',
];

export const WINGS_SPREAD_TOP: readonly string[] = [
  '...........1111.........',
  '...........11111111.....',
  '...........11111........',
  '...........11111........',
  '...........111111111....',
  '...........111111.......',
  '...........111111.......',
  '...........111111111....',
  '...........111111.......',
  '...........111111.......',
  '........................',
  '........................',
];

export const WINGS_MISSILES_TOP: readonly string[] = [
  '.........111............',
  '..........1111..........',
  '..........11111.........',
  '...........11111........',
  '..........111111111.....',
  '..........1111111111....',
  '..........111111111.....',
  '...........111111.......',
  '............11111.......',
  '............11111.......',
  '........................',
  '........................',
];

export const WINGS_CANNON_TOP: readonly string[] = [
  '..........1111..........',
  '..........11111.........',
  '..........111111........',
  '..........111111........',
  '..........1111111.......',
  '..........1111111.......',
  '..........111111111111..',
  '..........111111111111..',
  '..........111111111.....',
  '..........1111111.......',
  '........................',
  '........................',
];

export const PLAYER_ENGINE_GRIDS: readonly (readonly string[])[] = [
  ENGINE_STANDARD_TOP,
  ENGINE_SUPERBOOST_TOP,
  ENGINE_GUNGINE_TOP,
  ENGINE_UNDERWATER_TOP,
  ENGINE_HOVER_TOP,
];

export const PLAYER_BODY_GRIDS: readonly (readonly string[])[] = [
  BODY_STANDARD_TOP,
  BODY_ARMOR_TOP,
  BODY_MELEE_TOP,
  BODY_NUKE_TOP,
  BODY_BOMB_TOP,
];

export const PLAYER_WING_GRIDS: readonly (readonly string[])[] = [
  WINGS_STANDARD_TOP,
  WINGS_LASER_TOP,
  WINGS_SPREAD_TOP,
  WINGS_MISSILES_TOP,
  WINGS_CANNON_TOP,
];

/**
 * Draws the animated 6-frame marine propeller blades for `engine_underwater`.
 */
export function drawUnderwaterPropeller(
  p: SpritePainter,
  frameIdx: number,
  pal = 1,
  ox = 0,
  oy = 0,
): void {
  const phase = frameIdx % 6;
  const propHalf = [6, 5, 3, 1, 3, 5][phase]!;
  p.vline(ox + 1, oy + 11 - propHalf, oy + 12 + propHalf, pal);
  if (propHalf >= 3) {
    p.vline(ox + 2, oy + 11 - Math.floor(propHalf * 0.5), oy + 12 + Math.floor(propHalf * 0.5), pal);
  }
}
