import type { AudioCueId } from '../contracts/audio';
import type { SimSnapshot } from '../contracts/sim';

export interface DualRumbleEffectParams {
  startDelay?: number;
  duration: number;
  weakMagnitude: number;
  strongMagnitude: number;
}

export interface GamepadVibrationActuatorLike {
  type?: string;
  playEffect?: (
    type: string,
    params: DualRumbleEffectParams,
  ) => Promise<unknown> | unknown;
  reset?: () => Promise<unknown> | unknown;
}

export interface LegacyGamepadHapticActuatorLike {
  pulse?: (value: number, duration: number) => Promise<unknown> | unknown;
}

export type HapticGamepad = Gamepad & {
  vibrationActuator?: GamepadVibrationActuatorLike | null;
  hapticActuators?: readonly LegacyGamepadHapticActuatorLike[] | null;
};

export type HapticEventKind =
  | 'launch'
  | 'fire'
  | 'hit'
  | 'explosion'
  | 'boss-kill'
  | 'nuke'
  | 'death';

export interface HapticPulseOptions {
  durationMs: number;
  weakMagnitude: number;
  strongMagnitude: number;
  startDelayMs?: number;
  priority?: number;
  kind?: HapticEventKind;
}

export interface GamepadHapticsOptions {
  enabled?: boolean;
  /** Minimum ms between equal/lower-priority pulses. Default: 65 */
  minIntervalMs?: number;
}

const BOSS_ENEMY_KINDS: ReadonlySet<string> = new Set([
  'Blimp',
  'BigBoat',
  'Dreadnought',
  'SkyCarrier',
  'Ace',
  'LaserAce',
]);

const HEAVY_FIRE_CUES: ReadonlySet<AudioCueId> = new Set([
  'sndcannon',
  'sndmissile',
  'sndspread',
  'sndlaser',
  'sndgungine',
]);

const EXPLOSION_CUES: ReadonlySet<AudioCueId> = new Set([
  'sndexplom',
  'sndboatdie',
  'sndjetdie',
  'sndplanedie',
  'sndcannonexplo',
]);

const KIND_COOLDOWN_MS: Record<HapticEventKind, number> = {
  fire: 110,
  explosion: 120,
  hit: 140,
  'boss-kill': 250,
  launch: 350,
  nuke: 400,
  death: 400,
};

const HAPTIC_PRESETS: Record<HapticEventKind, HapticPulseOptions> = {
  fire: {
    kind: 'fire',
    priority: 1,
    durationMs: 40,
    weakMagnitude: 0.24,
    strongMagnitude: 0.1,
  },
  explosion: {
    kind: 'explosion',
    priority: 2,
    durationMs: 95,
    weakMagnitude: 0.42,
    strongMagnitude: 0.32,
  },
  launch: {
    kind: 'launch',
    priority: 3,
    durationMs: 140,
    weakMagnitude: 0.45,
    strongMagnitude: 0.35,
  },
  hit: {
    kind: 'hit',
    priority: 4,
    durationMs: 130,
    weakMagnitude: 0.6,
    strongMagnitude: 0.65,
  },
  'boss-kill': {
    kind: 'boss-kill',
    priority: 4,
    durationMs: 240,
    weakMagnitude: 0.75,
    strongMagnitude: 0.8,
  },
  death: {
    kind: 'death',
    priority: 5,
    durationMs: 320,
    weakMagnitude: 0.7,
    strongMagnitude: 0.9,
  },
  nuke: {
    kind: 'nuke',
    priority: 5,
    durationMs: 360,
    weakMagnitude: 0.9,
    strongMagnitude: 1.0,
  },
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function clampDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs)) return 0;
  return Math.min(2000, Math.max(0, Math.round(durationMs)));
}

function hasAnyCue(snapshot: SimSnapshot, cues: ReadonlySet<AudioCueId>): boolean {
  for (let i = 0; i < snapshot.audioEvents.length; i++) {
    const evt = snapshot.audioEvents[i];
    if (evt && cues.has(evt.cue)) {
      return true;
    }
  }
  return false;
}

function hasCue(snapshot: SimSnapshot, cue: AudioCueId): boolean {
  for (let i = 0; i < snapshot.audioEvents.length; i++) {
    if (snapshot.audioEvents[i]?.cue === cue) {
      return true;
    }
  }
  return false;
}

function hasBossKillDelta(prev: SimSnapshot | null, curr: SimSnapshot): boolean {
  if (!prev) return false;
  for (const kind of BOSS_ENEMY_KINDS) {
    const nextCount = curr.killsByKind[kind] ?? 0;
    const prevCount = prev.killsByKind[kind] ?? 0;
    if (nextCount > prevCount) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if the given Gamepad exposes modern `vibrationActuator.playEffect`
 * or legacy `hapticActuators[0].pulse`.
 */
export function hasGamepadRumble(pad: Gamepad | null | undefined): boolean {
  if (!pad) return false;
  const hPad = pad as HapticGamepad;
  if (
    hPad.vibrationActuator &&
    typeof hPad.vibrationActuator.playEffect === 'function'
  ) {
    return true;
  }
  const legacy = hPad.hapticActuators;
  if (legacy && legacy.length > 0 && typeof legacy[0]?.pulse === 'function') {
    return true;
  }
  return false;
}

function invokePadRumble(pad: Gamepad | null | undefined, pulse: HapticPulseOptions): boolean {
  if (!pad || pad.connected === false) return false;
  const hPad = pad as HapticGamepad;
  const duration = clampDuration(pulse.durationMs);
  if (duration <= 0) return false;

  const weakMagnitude = clamp01(pulse.weakMagnitude);
  const strongMagnitude = clamp01(pulse.strongMagnitude);
  const startDelay = clampDuration(pulse.startDelayMs ?? 0);

  const actuator = hPad.vibrationActuator;
  if (actuator && typeof actuator.playEffect === 'function') {
    try {
      const result = actuator.playEffect('dual-rumble', {
        startDelay,
        duration,
        weakMagnitude,
        strongMagnitude,
      });
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        void (result as Promise<unknown>).catch(() => {
          // Safely ignore rejected promises in unfocused/unsupported browser states
        });
      }
      return true;
    } catch {
      // Fall through to legacy actuator if present
    }
  }

  const legacy = hPad.hapticActuators;
  const firstLegacy = legacy && legacy.length > 0 ? legacy[0] : undefined;
  if (firstLegacy && typeof firstLegacy.pulse === 'function') {
    try {
      const intensity = clamp01(Math.max(strongMagnitude, weakMagnitude * 0.75));
      const result = firstLegacy.pulse(intensity, duration);
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        void (result as Promise<unknown>).catch(() => {
          // Safely ignore rejected legacy haptic promises
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Cooldown-throttled haptic feedback controller supporting both Chromium dual-rumble
 * (`vibrationActuator.playEffect`) and legacy `hapticActuators[0].pulse`.
 */
export class GamepadHaptics {
  private enabled: boolean;
  private readonly minIntervalMs: number;
  private lastPulseMs = -Infinity;
  private lastPulseEndMs = -Infinity;
  private lastPulsePriority = 0;
  private readonly lastKindMs = new Map<HapticEventKind, number>();

  constructor(options?: GamepadHapticsOptions) {
    this.enabled = options?.enabled ?? true;
    this.minIntervalMs = Math.max(0, options?.minIntervalMs ?? 65);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  reset(): void {
    this.lastPulseMs = -Infinity;
    this.lastPulseEndMs = -Infinity;
    this.lastPulsePriority = 0;
    this.lastKindMs.clear();
  }

  /**
   * Fires a rumble pulse on one gamepad or an array of gamepads, honoring enable state,
   * priority override, and cooldown throttling. Never throws on unsupported pads.
   */
  triggerPulse(
    target: Gamepad | readonly (Gamepad | null)[] | null | undefined,
    pulse: HapticPulseOptions,
    nowMs?: number,
  ): boolean {
    if (!this.enabled || !target) return false;

    const priority = pulse.priority ?? 2;

    if (nowMs !== undefined && Number.isFinite(nowMs)) {
      if (pulse.kind !== undefined) {
        const lastForKind = this.lastKindMs.get(pulse.kind) ?? -Infinity;
        if (nowMs - lastForKind < KIND_COOLDOWN_MS[pulse.kind]) {
          return false;
        }
      }

      if (nowMs < this.lastPulseEndMs && priority < this.lastPulsePriority) {
        return false;
      }

      if (
        nowMs - this.lastPulseMs < this.minIntervalMs &&
        priority <= this.lastPulsePriority
      ) {
        return false;
      }
    }

    const pads: readonly (Gamepad | null)[] = Array.isArray(target)
      ? target
      : [target as Gamepad];

    let triggered = false;
    for (let i = 0; i < pads.length; i++) {
      if (invokePadRumble(pads[i], pulse)) {
        triggered = true;
      }
    }

    if (triggered && nowMs !== undefined && Number.isFinite(nowMs)) {
      this.lastPulseMs = nowMs;
      this.lastPulseEndMs = nowMs + clampDuration(pulse.durationMs);
      this.lastPulsePriority = priority;
      if (pulse.kind !== undefined) {
        this.lastKindMs.set(pulse.kind, nowMs);
      }
    }

    return triggered;
  }

  /**
   * Inspects simulation state transitions and audio cues between `prev` and `curr`
   * to emit tactile feedback pulses on launch, heavy firing, hits, explosions,
   * boss kills, nuke detonation, and player death.
   */
  syncFromSnapshot(
    prev: SimSnapshot | null,
    curr: SimSnapshot,
    pads: readonly (Gamepad | null)[],
    nowMs: number,
  ): boolean {
    if (!this.enabled || curr.paused || pads.length === 0) {
      return false;
    }
    if (prev && prev === curr) {
      return false;
    }

    // Highest priority first
    const nukeDetonated =
      hasCue(curr, 'sndnuke') ||
      (curr.player.nukeTriggered && !(prev?.player.nukeTriggered ?? false)) ||
      (curr.nukeFlashTicks > 0 && (prev?.nukeFlashTicks ?? 0) === 0);
    if (nukeDetonated) {
      return this.triggerPulse(pads, HAPTIC_PRESETS.nuke, nowMs);
    }

    const playerDied =
      hasCue(curr, 'sndplayerdie') ||
      (prev !== null && prev.player.alive && !curr.player.alive) ||
      (prev !== null && prev.phase !== 'dying' && curr.phase === 'dying');
    if (playerDied) {
      return this.triggerPulse(pads, HAPTIC_PRESETS.death, nowMs);
    }

    if (hasBossKillDelta(prev, curr)) {
      return this.triggerPulse(pads, HAPTIC_PRESETS['boss-kill'], nowMs);
    }

    const playerHit =
      hasCue(curr, 'sndplayerhit') ||
      (prev !== null && curr.player.alive && curr.player.health < prev.player.health) ||
      (curr.hitstopTicks > (prev?.hitstopTicks ?? 0) && curr.hitstopTicks >= 2);
    if (playerHit) {
      return this.triggerPulse(pads, HAPTIC_PRESETS.hit, nowMs);
    }

    const launched =
      hasCue(curr, 'sndlaunch') ||
      (prev !== null && prev.phase === 'hangar' && curr.phase === 'launching');
    if (launched) {
      return this.triggerPulse(pads, HAPTIC_PRESETS.launch, nowMs);
    }

    const exploded =
      hasAnyCue(curr, EXPLOSION_CUES) ||
      (prev !== null && curr.killsThisSortie > prev.killsThisSortie);
    if (exploded) {
      return this.triggerPulse(pads, HAPTIC_PRESETS.explosion, nowMs);
    }

    const heavyFire =
      hasAnyCue(curr, HEAVY_FIRE_CUES) ||
      (curr.phase === 'playing' &&
        curr.player.firing &&
        !(prev?.player.firing ?? false));
    if (heavyFire) {
      return this.triggerPulse(pads, HAPTIC_PRESETS.fire, nowMs);
    }

    return false;
  }
}
