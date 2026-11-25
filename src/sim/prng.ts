/**
 * Deterministic Mulberry32 32-bit PRNG for 60Hz simulation parity.
 * Zero Math.random() usage is permitted anywhere inside src/sim/.
 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Returns the current internal 32-bit state. */
  getState(): number {
    return this.state >>> 0;
  }

  /** Resets the generator to a specific 32-bit seed. */
  setSeed(seed: number): void {
    this.state = seed >>> 0;
  }

  /** Creates an independent copy at the exact current PRNG state. */
  clone(): SeededRng {
    return new SeededRng(this.state);
  }

  /** Returns a uniform float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns a uniform float in [min, max). */
  range(min: number, max: number): number {
    if (max <= min) return min;
    return min + this.next() * (max - min);
  }

  /** Returns a uniform integer in the inclusive interval [min, max]. */
  int(min: number, max: number): number {
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    if (hi <= lo) return lo;
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** Returns true with probability p in [0, 1]. */
  chance(p: number): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.next() < p;
  }

  /** Deterministically selects an element from a non-empty array. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new Error('SeededRng.pick() called with an empty array');
    }
    const idx = Math.floor(this.next() * arr.length);
    return arr[idx]!;
  }
}
