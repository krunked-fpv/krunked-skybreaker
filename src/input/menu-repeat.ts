export type MenuDirection = 'up' | 'down' | 'left' | 'right';

export interface MenuDirectionState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export interface MenuRepeatOptions {
  /** Initial delay before directional auto-repeat begins (DAS), in ms. Default: 320 */
  initialDelayMs?: number;
  /** Interval between subsequent auto-repeat triggers (ARR), in ms. Default: 110 */
  repeatIntervalMs?: number;
}

interface DirectionTrack {
  held: boolean;
  nextRepeatMs: number;
}

const DIRECTIONS: readonly MenuDirection[] = ['up', 'down', 'left', 'right'];

export const DEFAULT_MENU_REPEAT_DELAY_MS = 320;
export const DEFAULT_MENU_REPEAT_INTERVAL_MS = 110;

/**
 * Deterministic DAS/ARR directional auto-repeat tracker driven by explicit timestamps.
 */
export class MenuRepeatTracker {
  private readonly initialDelayMs: number;
  private readonly repeatIntervalMs: number;
  private readonly tracks: Record<MenuDirection, DirectionTrack> = {
    up: { held: false, nextRepeatMs: 0 },
    down: { held: false, nextRepeatMs: 0 },
    left: { held: false, nextRepeatMs: 0 },
    right: { held: false, nextRepeatMs: 0 },
  };

  constructor(options?: MenuRepeatOptions) {
    this.initialDelayMs = Math.max(
      1,
      options?.initialDelayMs ?? DEFAULT_MENU_REPEAT_DELAY_MS,
    );
    this.repeatIntervalMs = Math.max(
      1,
      options?.repeatIntervalMs ?? DEFAULT_MENU_REPEAT_INTERVAL_MS,
    );
  }

  getConfig(): { initialDelayMs: number; repeatIntervalMs: number } {
    return {
      initialDelayMs: this.initialDelayMs,
      repeatIntervalMs: this.repeatIntervalMs,
    };
  }

  /**
   * Evaluates current held directional inputs at timestamp `nowMs` and returns
   * the directions that triggered on this tick (initial press or DAS/ARR repeat).
   */
  update(state: MenuDirectionState, nowMs: number): MenuDirection[] {
    const effective: MenuDirectionState = {
      up: state.up && !state.down,
      down: state.down && !state.up,
      left: state.left && !state.right,
      right: state.right && !state.left,
    };

    const emitted: MenuDirection[] = [];

    for (const dir of DIRECTIONS) {
      const track = this.tracks[dir];
      const active = effective[dir];

      if (!active) {
        track.held = false;
        track.nextRepeatMs = 0;
        continue;
      }

      if (!track.held) {
        track.held = true;
        track.nextRepeatMs = nowMs + this.initialDelayMs;
        emitted.push(dir);
      } else if (nowMs >= track.nextRepeatMs) {
        track.nextRepeatMs = nowMs + this.repeatIntervalMs;
        emitted.push(dir);
      }
    }

    return emitted;
  }

  /**
   * Clears all held directional states (e.g., on disconnect or menu exit).
   */
  reset(): void {
    for (const dir of DIRECTIONS) {
      const track = this.tracks[dir];
      track.held = false;
      track.nextRepeatMs = 0;
    }
  }
}
