import type { ControllerFamily } from '../contracts/input';
import type { InputState } from '../contracts/sim';

export interface ControllerFamilyMatch {
  family: ControllerFamily;
  label: string;
}

export interface NormalizedGamepadButtons {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  a: boolean;
  b: boolean;
  x: boolean;
  y: boolean;
  lb: boolean;
  rb: boolean;
  lt: boolean;
  rt: boolean;
  start: boolean;
  select: boolean;
}

export interface GamepadExtractOptions {
  /** Radial left-stick deadzone in [0, 0.95]. Default: 0.22 */
  stickDeadzone?: number;
  /** Analog trigger activation threshold in [0, 0.95]. Default: 0.22 */
  triggerThreshold?: number;
}

export interface ExtractedGamepadInputs {
  flight: InputState;
  nav: NormalizedGamepadButtons;
  nonStandardFallback: boolean;
  hasActivity: boolean;
}

export const DEFAULT_STICK_DEADZONE = 0.22;
export const DEFAULT_TRIGGER_THRESHOLD = 0.22;
const FLIGHT_STICK_THRUST_THRESHOLD = 0.5;
const DIGITAL_BUTTON_THRESHOLD = 0.5;
const TRIGGER_REST_MAX = -0.6;
const HAT_AXIS_THRESHOLD = 0.5;
const HAT_POV_TOLERANCE = 0.09;

const TESLA_UA_PATTERN =
  /(?:\bTesla\/|QtCarBrowser|TeslaCar|TeslaBrowser|\bTesla\b.*(?:Chromium|Chrome|Linux))/i;

function hasHexVendorId(padId: string, vendorHex: string): boolean {
  const escaped = vendorHex.toLowerCase();
  const pattern = new RegExp(`(?:^|[^0-9a-f])${escaped}(?:$|[^0-9a-f])`, 'i');
  return pattern.test(padId);
}

/**
 * Detects Tesla in-vehicle browsers (Tesla MCU Chromium, QtCarBrowser, Tesla/YYYY.WW).
 */
export function detectTeslaBrowser(userAgent?: string): boolean {
  const ua =
    userAgent !== undefined
      ? userAgent
      : typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
        ? navigator.userAgent
        : '';
  if (!ua) return false;
  return TESLA_UA_PATTERN.test(ua);
}

/**
 * Classifies a Web Gamepad API `pad.id` string into a known controller family
 * and concise display label, with Tesla browser awareness.
 */
export function detectControllerFamily(
  padId: string,
  isTeslaBrowser = false,
): ControllerFamilyMatch {
  const id = (padId ?? '').trim();
  const lower = id.toLowerCase();

  // 1. Explicit Tesla / Jowua hardware
  if (lower.includes('tesla') || lower.includes('jowua')) {
    return { family: 'tesla', label: 'TESLA PAD' };
  }

  // 2. Steam Deck / Valve hardware (check before Xbox XInput fallback)
  if (
    lower.includes('steam deck') ||
    lower.includes('steamdeck') ||
    lower.includes('valve') ||
    hasHexVendorId(lower, '28de')
  ) {
    return {
      family: 'steamdeck',
      label: isTeslaBrowser ? 'STEAM DECK (TESLA)' : 'STEAM DECK',
    };
  }

  // 3. Nintendo / 8BitDo (check before Xbox/PlayStation generic wireless labels)
  if (
    lower.includes('nintendo') ||
    lower.includes('pro controller') ||
    lower.includes('joy-con') ||
    lower.includes('joycon') ||
    lower.includes('8bitdo') ||
    hasHexVendorId(lower, '057e') ||
    hasHexVendorId(lower, '2dc8')
  ) {
    return {
      family: 'nintendo',
      label: isTeslaBrowser ? 'NINTENDO (TESLA)' : 'NINTENDO',
    };
  }

  // 4. Xbox / XInput / Microsoft (check before PlayStation's "wireless controller")
  if (
    lower.includes('xbox') ||
    lower.includes('x-box') ||
    lower.includes('xinput') ||
    lower.includes('microsoft') ||
    hasHexVendorId(lower, '045e')
  ) {
    return {
      family: 'xbox',
      label: isTeslaBrowser ? 'XBOX (TESLA)' : 'XBOX',
    };
  }

  // 5. PlayStation DualSense / DualShock / Sony
  if (
    lower.includes('dualsense') ||
    lower.includes('dualshock') ||
    lower.includes('playstation') ||
    lower.includes('sony') ||
    lower.includes('wireless controller') ||
    /\bps[45]\b/i.test(lower) ||
    hasHexVendorId(lower, '054c')
  ) {
    return {
      family: 'playstation',
      label: isTeslaBrowser ? 'PLAYSTATION (TESLA)' : 'PLAYSTATION',
    };
  }

  // 6. Generic HID pad connected inside Tesla in-car browser
  if (isTeslaBrowser) {
    return { family: 'tesla', label: 'TESLA PAD' };
  }

  return { family: 'generic', label: 'GAMEPAD' };
}

function finiteOrZero(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isDigitalButtonPressed(pad: Gamepad, index: number): boolean {
  const button = pad.buttons[index];
  if (!button) return false;
  if (button.pressed) return true;
  return (
    typeof button.value === 'number' &&
    Number.isFinite(button.value) &&
    button.value > DIGITAL_BUTTON_THRESHOLD
  );
}

function isAnalogTriggerPressed(
  pad: Gamepad,
  index: number,
  threshold: number,
): boolean {
  const button = pad.buttons[index];
  if (!button) return false;
  if (button.pressed) return true;
  return (
    typeof button.value === 'number' &&
    Number.isFinite(button.value) &&
    button.value > threshold
  );
}

/**
 * Decodes W3C/Chromium HID 8-way POV hat-switch float values on `axes[9]` in [-1, 1].
 * Neutral/centered states (0.0, ~1.2857, ~3.2857, out-of-range) return all false.
 */
function decodeHatSwitchFloat(value: number | undefined): {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
} {
  const empty = { up: false, down: false, left: false, right: false };
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return empty;
  }
  // Centered POV hat in Chromium reports > 1.05 (e.g. 1.2857 or 3.2857) or 0.0
  if (value < -1.05 || value > 1.05) {
    return empty;
  }

  const near = (target: number): boolean => Math.abs(value - target) <= HAT_POV_TOLERANCE;

  if (near(-1)) return { up: true, down: false, left: false, right: false }; // N
  if (near(-5 / 7)) return { up: true, down: false, left: false, right: true }; // NE
  if (near(-3 / 7)) return { up: false, down: false, left: false, right: true }; // E
  if (near(-1 / 7)) return { up: false, down: true, left: false, right: true }; // SE
  if (near(1 / 7)) return { up: false, down: true, left: false, right: false }; // S
  if (near(3 / 7)) return { up: false, down: true, left: true, right: false }; // SW
  if (near(5 / 7)) return { up: false, down: false, left: true, right: false }; // W
  if (near(1)) return { up: true, down: false, left: true, right: false }; // NW

  return empty;
}

/**
 * Extracts non-standard Linux/Tesla/DirectInput analog triggers from axes[2..5]
 * using calibrated resting baselines (typically -1.0 at rest, +1.0 fully pulled).
 */
function extractNonStandardTriggerAxes(
  pad: Gamepad,
  restAxes: readonly number[],
  triggerThreshold: number,
): { lt: boolean; rt: boolean; hasCalibratedTriggerAxes: boolean } {
  const candidateIndices = [2, 3, 4, 5] as const;
  const triggerAxes: number[] = [];

  for (const idx of candidateIndices) {
    const rest = restAxes[idx];
    if (
      typeof rest === 'number' &&
      Number.isFinite(rest) &&
      rest <= TRIGGER_REST_MAX &&
      idx < pad.axes.length
    ) {
      triggerAxes.push(idx);
    }
  }

  if (triggerAxes.length === 0) {
    return { lt: false, rt: false, hasCalibratedTriggerAxes: false };
  }

  const isAxisPulled = (axisIdx: number): boolean => {
    const rest = restAxes[axisIdx] ?? -1;
    const current = finiteOrZero(pad.axes[axisIdx]);
    const span = Math.max(0.5, 1 - rest);
    const pull = (current - rest) / span;
    return pull > triggerThreshold;
  };

  if (triggerAxes.length >= 2) {
    // Pair convention across Linux xpad (2=LT, 5=RT), PS raw HID (3=L2, 4=R2), generic HID (4=LT, 5=RT)
    const ltIdx = triggerAxes[0]!;
    const rtIdx = triggerAxes[1]!;
    return {
      lt: isAxisPulled(ltIdx),
      rt: isAxisPulled(rtIdx),
      hasCalibratedTriggerAxes: true,
    };
  }

  const singleIdx = triggerAxes[0]!;
  const pulled = isAxisPulled(singleIdx);
  if (singleIdx >= 4) {
    return { lt: false, rt: pulled, hasCalibratedTriggerAxes: true };
  }
  return { lt: pulled, rt: false, hasCalibratedTriggerAxes: true };
}

/**
 * Extracts normalized flight inputs and digital menu navigation buttons from any
 * standard or non-standard/raw HID Web Gamepad.
 */
export function extractGamepadInputs(
  pad: Gamepad,
  restAxes: readonly number[] = [],
  options?: GamepadExtractOptions,
): ExtractedGamepadInputs {
  const stickDeadzone = Math.min(
    0.95,
    Math.max(0.05, options?.stickDeadzone ?? DEFAULT_STICK_DEADZONE),
  );
  const triggerThreshold = Math.min(
    0.95,
    Math.max(0.05, options?.triggerThreshold ?? DEFAULT_TRIGGER_THRESHOLD),
  );
  const nonStandardFallback = pad.mapping !== 'standard';

  // Left stick with radial deadzone + crisp cardinal extraction
  const rawX = finiteOrZero(pad.axes[0]);
  const rawY = finiteOrZero(pad.axes[1]);
  const stickMag = Math.hypot(rawX, rawY);
  const stickOutsideDeadzone = stickMag > stickDeadzone;

  const stickLeft = stickOutsideDeadzone && rawX < -stickDeadzone;
  const stickRight = stickOutsideDeadzone && rawX > stickDeadzone;
  const stickThrust =
    stickOutsideDeadzone && rawY < -Math.max(FLIGHT_STICK_THRUST_THRESHOLD, stickDeadzone);

  // Menu navigation cardinal filtering prevents slight diagonal slop from double-triggering axes
  const absX = Math.abs(rawX);
  const absY = Math.abs(rawY);
  const stickNavLeft =
    stickLeft && (absX >= absY * 0.45 || absX >= FLIGHT_STICK_THRUST_THRESHOLD);
  const stickNavRight =
    stickRight && (absX >= absY * 0.45 || absX >= FLIGHT_STICK_THRUST_THRESHOLD);
  const stickNavUp =
    stickOutsideDeadzone &&
    rawY < -stickDeadzone &&
    (absY >= absX * 0.45 || absY >= FLIGHT_STICK_THRUST_THRESHOLD);
  const stickNavDown =
    stickOutsideDeadzone &&
    rawY > stickDeadzone &&
    (absY >= absX * 0.45 || absY >= FLIGHT_STICK_THRUST_THRESHOLD);

  // Standard face & shoulder buttons
  const a = isDigitalButtonPressed(pad, 0);
  const b = isDigitalButtonPressed(pad, 1);
  const x = isDigitalButtonPressed(pad, 2);
  const y = isDigitalButtonPressed(pad, 3);
  const lb = isDigitalButtonPressed(pad, 4);
  const rb = isDigitalButtonPressed(pad, 5);

  let dpadUp = isDigitalButtonPressed(pad, 12);
  let dpadDown = isDigitalButtonPressed(pad, 13);
  let dpadLeft = isDigitalButtonPressed(pad, 14);
  let dpadRight = isDigitalButtonPressed(pad, 15);

  let lt = isAnalogTriggerPressed(pad, 6, triggerThreshold);
  let rt = isAnalogTriggerPressed(pad, 7, triggerThreshold);
  let select = isDigitalButtonPressed(pad, 8);
  let start = isDigitalButtonPressed(pad, 9);

  if (nonStandardFallback) {
    // 1. Calibrated resting-baseline analog trigger axes (Linux xpad / Tesla / PS raw HID)
    const axisTriggers = extractNonStandardTriggerAxes(pad, restAxes, triggerThreshold);

    // Classic Linux xpad (<= 11 buttons) places Back/Select on btn 6 and Start on btn 7
    const isLinuxXpadButtonLayout =
      axisTriggers.hasCalibratedTriggerAxes && pad.buttons.length <= 11;

    if (isLinuxXpadButtonLayout) {
      lt = axisTriggers.lt;
      rt = axisTriggers.rt;
      select = isDigitalButtonPressed(pad, 6) || isDigitalButtonPressed(pad, 8);
      start = isDigitalButtonPressed(pad, 7) || isDigitalButtonPressed(pad, 9);
    } else {
      lt = lt || axisTriggers.lt;
      rt = rt || axisTriggers.rt;
    }

    // 2. Discrete Linux evdev D-pad axes (axes[6] = X, axes[7] = Y)
    if (pad.axes.length >= 8) {
      const restHatX = restAxes[6];
      const restHatY = restAxes[7];
      if (restHatX === undefined || Math.abs(restHatX) < 0.5) {
        const hatX = finiteOrZero(pad.axes[6]);
        if (hatX < -HAT_AXIS_THRESHOLD) dpadLeft = true;
        if (hatX > HAT_AXIS_THRESHOLD) dpadRight = true;
      }
      if (restHatY === undefined || Math.abs(restHatY) < 0.5) {
        const hatY = finiteOrZero(pad.axes[7]);
        if (hatY < -HAT_AXIS_THRESHOLD) dpadUp = true;
        if (hatY > HAT_AXIS_THRESHOLD) dpadDown = true;
      }
    }

    // 3. DirectInput / Chrome HID 8-way float POV hat switch (axes[9])
    if (pad.axes.length >= 10) {
      const restPov = restAxes[9];
      const povRestIsNormal =
        restPov === undefined ||
        !Number.isFinite(restPov) ||
        restPov > 1.05 ||
        restPov < -1.05 ||
        Math.abs(restPov) < 0.05;
      if (povRestIsNormal) {
        const pov = decodeHatSwitchFloat(pad.axes[9]);
        dpadUp = dpadUp || pov.up;
        dpadDown = dpadDown || pov.down;
        dpadLeft = dpadLeft || pov.left;
        dpadRight = dpadRight || pov.right;
      }
    }
  }

  const nav: NormalizedGamepadButtons = {
    up: dpadUp || stickNavUp,
    down: dpadDown || stickNavDown,
    left: dpadLeft || stickNavLeft,
    right: dpadRight || stickNavRight,
    a,
    b,
    x,
    y,
    lb,
    rb,
    lt,
    rt,
    start,
    select,
  };

  const flight: InputState = {
    left: dpadLeft || stickLeft,
    right: dpadRight || stickRight,
    thrust: dpadUp || stickThrust || a || rt,
    fire: x || b || rb || lb || lt || y,
  };

  const hasActivity =
    flight.left ||
    flight.right ||
    flight.thrust ||
    flight.fire ||
    nav.up ||
    nav.down ||
    nav.left ||
    nav.right ||
    nav.start ||
    nav.select;

  return {
    flight,
    nav,
    nonStandardFallback,
    hasActivity,
  };
}
