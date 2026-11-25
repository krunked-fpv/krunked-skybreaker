/**
 * Pure angle and geometry utilities for deterministic 60Hz flight & ballistics.
 */

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Normalizes an angle in degrees to [-180, 180). */
export function normalizeAngleDeg(deg: number): number {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  if (d >= 180) d -= 360;
  return d;
}

/** Shortest signed angular delta in degrees from `fromDeg` to `toDeg` in [-180, 180). */
export function shortestAngleDiffDeg(fromDeg: number, toDeg: number): number {
  return normalizeAngleDeg(toDeg - fromDeg);
}

/** Squared distance from point P(px, py) to segment AB(ax, ay -> bx, by). */
export function distPointToSegmentSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-9) {
    const ex = px - ax;
    const ey = py - ay;
    return ex * ex + ey * ey;
  }
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  const rx = px - projX;
  const ry = py - projY;
  return rx * rx + ry * ry;
}

/** Squared distance from point P(px, py) to axis-aligned box centered at (cx, cy). */
export function distPointToBoxSq(
  px: number,
  py: number,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
): number {
  const dx = Math.max(0, Math.abs(px - cx) - halfW);
  const dy = Math.max(0, Math.abs(py - cy) - halfH);
  return dx * dx + dy * dy;
}
