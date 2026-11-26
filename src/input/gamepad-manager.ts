import type {
  ConnectedGamepadInfo,
  ControllerConnectionEvent,
  ControllerMenuCommand,
  GamepadPollResult,
} from '../contracts/input';
import type { InputState, SimPhase } from '../contracts/sim';
import {
  DEFAULT_STICK_DEADZONE,
  DEFAULT_TRIGGER_THRESHOLD,
  detectControllerFamily,
  detectTeslaBrowser,
  extractGamepadInputs,
  type NormalizedGamepadButtons,
} from './controller-profiles';
import { hasGamepadRumble } from './haptics';
import {
  DEFAULT_MENU_REPEAT_DELAY_MS,
  DEFAULT_MENU_REPEAT_INTERVAL_MS,
  MenuRepeatTracker,
  type MenuDirection,
} from './menu-repeat';

export interface GamepadPollContext {
  phase: SimPhase;
  paused: boolean;
  modDeckOpen: boolean;
  paletteStudioOpen: boolean;
  nowMs: number;
}

export interface GamepadManagerOptions {
  /** Custom gamepad provider for deterministic testing (defaults to navigator.getGamepads). */
  getGamepads?: () => readonly (Gamepad | null)[];
  /** Override Tesla browser detection (defaults to detectTeslaBrowser(userAgent)). */
  isTeslaBrowser?: boolean;
  /** Optional user-agent string used when isTeslaBrowser is not explicitly provided. */
  userAgent?: string;
  /** Radial left-stick deadzone. Default: 0.22 */
  stickDeadzone?: number;
  /** Analog trigger threshold. Default: 0.22 */
  triggerThreshold?: number;
  /** DAS initial delay for menu repeat in ms. Default: 320 */
  repeatInitialDelayMs?: number;
  /** ARR repeat interval for menu repeat in ms. Default: 110 */
  repeatIntervalMs?: number;
}

interface SlotEntry {
  slot: 0 | 1;
  index: number;
  id: string;
  info: ConnectedGamepadInfo;
  restAxes: number[];
  rawPad: Gamepad;
}

const EMPTY_INPUT: InputState = {
  left: false,
  right: false,
  thrust: false,
  fire: false,
};

const EMPTY_NAV: NormalizedGamepadButtons = {
  up: false,
  down: false,
  left: false,
  right: false,
  a: false,
  b: false,
  x: false,
  y: false,
  lb: false,
  rb: false,
  lt: false,
  rt: false,
  start: false,
  select: false,
};

const DIRECTION_TO_ARROW_CODE: Record<MenuDirection, string> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
};

function defaultGetGamepads(): readonly (Gamepad | null)[] {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.getGamepads !== 'function'
  ) {
    return [];
  }
  try {
    const list = navigator.getGamepads();
    if (!list) return [];
    const out: (Gamepad | null)[] = [];
    for (let i = 0; i < list.length; i++) {
      out.push(list[i] ?? null);
    }
    return out;
  } catch {
    return [];
  }
}

function captureRestAxes(pad: Gamepad): number[] {
  const out: number[] = [];
  for (let i = 0; i < pad.axes.length; i++) {
    const val = pad.axes[i];
    out.push(typeof val === 'number' && Number.isFinite(val) ? val : 0);
  }
  return out;
}

function maybeRefineNonStandardRestAxes(pad: Gamepad, restAxes: number[]): void {
  if (pad.mapping === 'standard') return;

  // Ensure restAxes covers current axis length
  while (restAxes.length < pad.axes.length) {
    const val = pad.axes[restAxes.length];
    restAxes.push(typeof val === 'number' && Number.isFinite(val) ? val : 0);
  }

  // Some Linux/Chromium HID drivers initially report [0, 0, 0, 0, 0, 0] before the
  // first HID report delivers resting -1.0 values for analog triggers on axes[2..5].
  const anyButtonActive = pad.buttons.some(
    (b) => Boolean(b?.pressed) || (typeof b?.value === 'number' && b.value > 0.2),
  );
  const stickIdle =
    Math.abs(pad.axes[0] ?? 0) < 0.12 && Math.abs(pad.axes[1] ?? 0) < 0.12;
  if (anyButtonActive || !stickIdle) return;

  for (const idx of [2, 3, 4, 5] as const) {
    const rest = restAxes[idx];
    const current = pad.axes[idx];
    if (
      rest !== undefined &&
      Math.abs(rest) < 0.15 &&
      typeof current === 'number' &&
      Number.isFinite(current) &&
      current <= -0.85
    ) {
      restAxes[idx] = current;
    }
  }
}

function isGamepadEventLike(event: Event): event is GamepadEvent {
  return 'gamepad' in event && (event as GamepadEvent).gamepad != null;
}

/**
 * Full Web Gamepad manager supporting Xbox, PlayStation, Nintendo, Tesla, Steam Deck,
 * and generic/non-standard HID pads with stable 2P slots, resting-axis calibration,
 * DAS/ARR menu routing, hot-plug events, and in-flight P1 disconnect detection.
 */
export class GamepadManager {
  private readonly getGamepadsFn: () => readonly (Gamepad | null)[];
  private readonly teslaBrowser: boolean;
  private readonly stickDeadzone: number;
  private readonly triggerThreshold: number;
  private readonly menuRepeat: MenuRepeatTracker;

  private readonly slots: [SlotEntry | null, SlotEntry | null] = [null, null];
  private readonly pendingEvents: ControllerConnectionEvent[] = [];
  private pendingP1Disconnect = false;

  private prevNav: NormalizedGamepadButtons = { ...EMPTY_NAV };
  private menuDriverIndex: number | null = null;

  private attachedTarget: EventTarget | null = null;
  private readonly onConnectedBound: EventListener;
  private readonly onDisconnectedBound: EventListener;

  constructor(options?: GamepadManagerOptions) {
    this.getGamepadsFn = options?.getGamepads ?? defaultGetGamepads;
    this.teslaBrowser =
      options?.isTeslaBrowser ?? detectTeslaBrowser(options?.userAgent);
    this.stickDeadzone = options?.stickDeadzone ?? DEFAULT_STICK_DEADZONE;
    this.triggerThreshold = options?.triggerThreshold ?? DEFAULT_TRIGGER_THRESHOLD;
    this.menuRepeat = new MenuRepeatTracker({
      initialDelayMs: options?.repeatInitialDelayMs ?? DEFAULT_MENU_REPEAT_DELAY_MS,
      repeatIntervalMs: options?.repeatIntervalMs ?? DEFAULT_MENU_REPEAT_INTERVAL_MS,
    });

    this.onConnectedBound = (event: Event) => {
      if (!isGamepadEventLike(event)) return;
      this.handlePadConnected(event.gamepad);
    };
    this.onDisconnectedBound = (event: Event) => {
      if (!isGamepadEventLike(event)) return;
      this.handlePadDisconnected(event.gamepad);
    };
  }

  isTeslaBrowser(): boolean {
    return this.teslaBrowser;
  }

  attach(target?: EventTarget | null): void {
    const resolved =
      target !== undefined ? target : typeof window !== 'undefined' ? window : null;
    if (this.attachedTarget === resolved) return;
    this.detach();
    if (!resolved) return;

    resolved.addEventListener('gamepadconnected', this.onConnectedBound);
    resolved.addEventListener('gamepaddisconnected', this.onDisconnectedBound);
    this.attachedTarget = resolved;
  }

  detach(): void {
    if (!this.attachedTarget) return;
    this.attachedTarget.removeEventListener('gamepadconnected', this.onConnectedBound);
    this.attachedTarget.removeEventListener(
      'gamepaddisconnected',
      this.onDisconnectedBound,
    );
    this.attachedTarget = null;
  }

  reset(): void {
    this.prevNav = { ...EMPTY_NAV };
    this.menuRepeat.reset();
    this.menuDriverIndex = null;
  }

  getConnectedGamepads(): readonly ConnectedGamepadInfo[] {
    const result: ConnectedGamepadInfo[] = [];
    for (let i = 0; i < this.slots.length; i++) {
      const entry = this.slots[i];
      if (entry) {
        result.push({ ...entry.info });
      }
    }
    return result;
  }

  getRawConnectedPads(): readonly Gamepad[] {
    const result: Gamepad[] = [];
    for (let i = 0; i < this.slots.length; i++) {
      const entry = this.slots[i];
      if (entry) {
        result.push(entry.rawPad);
      }
    }
    return result;
  }

  private buildGamepadInfo(slot: 0 | 1, pad: Gamepad): ConnectedGamepadInfo {
    const { family, label } = detectControllerFamily(pad.id, this.teslaBrowser);
    return {
      slot,
      index: pad.index,
      id: pad.id,
      mapping: pad.mapping ?? '',
      family,
      label,
      hasRumble: hasGamepadRumble(pad),
      nonStandardFallback: pad.mapping !== 'standard',
    };
  }

  private findSlotByIndex(padIndex: number): 0 | 1 | null {
    if (this.slots[0]?.index === padIndex) return 0;
    if (this.slots[1]?.index === padIndex) return 1;
    return null;
  }

  private findFreeSlot(): 0 | 1 | null {
    if (this.slots[0] === null) return 0;
    if (this.slots[1] === null) return 1;
    return null;
  }

  private handlePadConnected(pad: Gamepad): void {
    if (!pad || pad.connected === false) return;

    const existingSlot = this.findSlotByIndex(pad.index);
    if (existingSlot !== null) {
      const existing = this.slots[existingSlot];
      if (existing && existing.id === pad.id) {
        existing.rawPad = pad;
        return;
      }
      if (existing) {
        this.slots[existingSlot] = null;
        this.pendingEvents.push({
          type: 'disconnected',
          info: { ...existing.info },
        });
        if (existingSlot === 0) {
          this.pendingP1Disconnect = true;
        }
      }
    }

    const freeSlot = this.findFreeSlot();
    if (freeSlot === null) return;

    const info = this.buildGamepadInfo(freeSlot, pad);
    this.slots[freeSlot] = {
      slot: freeSlot,
      index: pad.index,
      id: pad.id,
      info,
      restAxes: captureRestAxes(pad),
      rawPad: pad,
    };
    this.pendingEvents.push({ type: 'connected', info: { ...info } });
  }

  private handlePadDisconnected(pad: Gamepad): void {
    if (!pad) return;
    const slot = this.findSlotByIndex(pad.index);
    if (slot === null) return;

    const entry = this.slots[slot];
    this.slots[slot] = null;
    if (entry) {
      this.pendingEvents.push({
        type: 'disconnected',
        info: { ...entry.info },
      });
      if (slot === 0) {
        this.pendingP1Disconnect = true;
      }
    }
  }

  private syncSlotsFromSnapshot(): {
    connectionEvents: ControllerConnectionEvent[];
    slot0Disconnected: boolean;
  } {
    const connectionEvents = this.pendingEvents.splice(0);
    let slot0Disconnected = this.pendingP1Disconnect;
    this.pendingP1Disconnect = false;

    const rawPads = this.getGamepadsFn() ?? [];
    const liveByIndex = new Map<number, Gamepad>();
    for (let i = 0; i < rawPads.length; i++) {
      const pad = rawPads[i];
      if (pad && pad.connected) {
        liveByIndex.set(pad.index, pad);
      }
    }

    // 1. Validate existing slots (stable slot assignment — slot 1 stays in slot 1 if slot 0 drops)
    for (const slotIdx of [0, 1] as const) {
      const entry = this.slots[slotIdx];
      if (!entry) continue;

      const livePad = liveByIndex.get(entry.index);
      if (!livePad || livePad.id !== entry.id) {
        this.slots[slotIdx] = null;
        connectionEvents.push({
          type: 'disconnected',
          info: { ...entry.info },
        });
        if (slotIdx === 0) {
          slot0Disconnected = true;
        }
        continue;
      }

      entry.rawPad = livePad;
      maybeRefineNonStandardRestAxes(livePad, entry.restAxes);
      entry.info.hasRumble = hasGamepadRumble(livePad);
    }

    // 2. Assign newly discovered pads to lowest available slot
    const sortedLivePads = [...liveByIndex.values()].sort((a, b) => a.index - b.index);
    for (let i = 0; i < sortedLivePads.length; i++) {
      const pad = sortedLivePads[i];
      if (!pad) continue;
      if (this.findSlotByIndex(pad.index) !== null) continue;

      const freeSlot = this.findFreeSlot();
      if (freeSlot === null) break;

      const info = this.buildGamepadInfo(freeSlot, pad);
      this.slots[freeSlot] = {
        slot: freeSlot,
        index: pad.index,
        id: pad.id,
        info,
        restAxes: captureRestAxes(pad),
        rawPad: pad,
      };
      connectionEvents.push({
        type: 'connected',
        info: { ...info },
      });
    }

    return { connectionEvents, slot0Disconnected };
  }

  poll(context: GamepadPollContext): GamepadPollResult {
    const { connectionEvents, slot0Disconnected } = this.syncSlotsFromSnapshot();

    const p1DisconnectedInFlight =
      slot0Disconnected &&
      (context.phase === 'playing' || context.phase === 'launching') &&
      !context.paused;

    const extractOptions = {
      stickDeadzone: this.stickDeadzone,
      triggerThreshold: this.triggerThreshold,
    };

    const slot0 = this.slots[0];
    const slot1 = this.slots[1];

    const p1Sample = slot0
      ? extractGamepadInputs(slot0.rawPad, slot0.restAxes, extractOptions)
      : null;
    const p2Sample = slot1
      ? extractGamepadInputs(slot1.rawPad, slot1.restAxes, extractOptions)
      : null;

    const p1: InputState = p1Sample ? p1Sample.flight : { ...EMPTY_INPUT };
    const p2: InputState = p2Sample ? p2Sample.flight : { ...EMPTY_INPUT };

    const commands: ControllerMenuCommand[] = [];

    // Slot 0 drives menus; fallback to Slot 1 only if Slot 0 is absent
    const menuEntry = slot0 ?? slot1;
    const menuSample = slot0 ? p1Sample : p2Sample;

    if (!menuEntry || !menuSample) {
      this.menuDriverIndex = null;
      this.prevNav = { ...EMPTY_NAV };
      this.menuRepeat.reset();
    } else {
      if (this.menuDriverIndex !== menuEntry.index) {
        this.menuDriverIndex = menuEntry.index;
        this.prevNav = { ...EMPTY_NAV };
        this.menuRepeat.reset();
      }

      const nav = menuSample.nav;
      const rising = {
        a: nav.a && !this.prevNav.a,
        b: nav.b && !this.prevNav.b,
        x: nav.x && !this.prevNav.x,
        y: nav.y && !this.prevNav.y,
        lb: nav.lb && !this.prevNav.lb,
        rb: nav.rb && !this.prevNav.rb,
        start: nav.start && !this.prevNav.start,
        select: nav.select && !this.prevNav.select,
      };
      this.prevNav = { ...nav };

      if (context.phase === 'hangar' && context.paletteStudioOpen) {
        const dirs = this.menuRepeat.update(nav, context.nowMs);
        for (const dir of dirs) {
          commands.push({ kind: 'key', code: DIRECTION_TO_ARROW_CODE[dir] });
        }
        if (rising.lb) commands.push({ kind: 'key', code: 'KeyQ' });
        if (rising.rb) commands.push({ kind: 'key', code: 'KeyE' });
        if (rising.y) commands.push({ kind: 'key', code: 'KeyR' });
        if (rising.a || rising.start) commands.push({ kind: 'key', code: 'Enter' });
        if (rising.b) commands.push({ kind: 'key', code: 'Escape' });
      } else if (context.phase === 'hangar' && context.modDeckOpen) {
        const dirs = this.menuRepeat.update(nav, context.nowMs);
        for (const dir of dirs) {
          commands.push({ kind: 'key', code: DIRECTION_TO_ARROW_CODE[dir] });
        }
        if (rising.a || rising.start) commands.push({ kind: 'key', code: 'Enter' });
        if (rising.b || rising.select) commands.push({ kind: 'key', code: 'Escape' });
      } else if (context.phase === 'hangar') {
        const dirs = this.menuRepeat.update(nav, context.nowMs);
        for (const dir of dirs) {
          commands.push({ kind: 'key', code: DIRECTION_TO_ARROW_CODE[dir] });
        }
        if (rising.select) commands.push({ kind: 'toggle-mod-deck' });
        if (rising.start) commands.push({ kind: 'launch' });
        if (rising.a) commands.push({ kind: 'key', code: 'Enter' });
        if (rising.y) commands.push({ kind: 'key', code: 'KeyC' });
        if (rising.x) commands.push({ kind: 'key', code: 'KeyM' });
        if (rising.lb) commands.push({ kind: 'key', code: 'ArrowLeft' });
        if (rising.rb) commands.push({ kind: 'key', code: 'ArrowRight' });
        if (rising.b) commands.push({ kind: 'key', code: 'Escape' });
      } else if (context.phase === 'gameover') {
        this.menuRepeat.reset();
        if (rising.a || rising.start) commands.push({ kind: 'relaunch' });
        if (rising.b) commands.push({ kind: 'return-hangar' });
      } else if (context.paused) {
        const dirs = this.menuRepeat.update(
          { up: nav.up, down: nav.down, left: false, right: false },
          context.nowMs,
        );
        for (const dir of dirs) {
          commands.push({ kind: 'key', code: DIRECTION_TO_ARROW_CODE[dir] });
        }
        if (rising.start) commands.push({ kind: 'pause-toggle' });
        if (rising.a) commands.push({ kind: 'key', code: 'Enter' });
        if (rising.y) commands.push({ kind: 'key', code: 'KeyR' });
        if (rising.b) commands.push({ kind: 'return-hangar' });
      } else {
        // Active unpaused flight (playing / launching / dying)
        this.menuRepeat.reset();
        if (rising.start) commands.push({ kind: 'pause-toggle' });
      }
    }

    const hadActivity =
      Boolean(p1Sample?.hasActivity) ||
      Boolean(p2Sample?.hasActivity) ||
      commands.length > 0;

    return {
      p1,
      p2,
      commands,
      hadActivity,
      p1DisconnectedInFlight,
      connectionEvents,
      gamepads: this.getConnectedGamepads(),
    };
  }
}
