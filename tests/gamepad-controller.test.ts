import { describe, expect, it, vi } from 'vitest';
import type { AudioCueId } from '../src/contracts/audio';
import type { PlayerState, SimPhase, SimSnapshot } from '../src/contracts/sim';
import {
  detectControllerFamily,
  detectTeslaBrowser,
  extractGamepadInputs,
} from '../src/input/controller-profiles';
import { GamepadManager } from '../src/input/gamepad-manager';
import { GamepadHaptics, hasGamepadRumble } from '../src/input/haptics';
import { MenuRepeatTracker } from '../src/input/menu-repeat';

interface MockGamepadButtonInit {
  pressed?: boolean;
  touched?: boolean;
  value?: number;
}

interface MockGamepadInit {
  index?: number;
  id?: string;
  mapping?: GamepadMappingType;
  connected?: boolean;
  axes?: number[];
  buttonCount?: number;
  buttons?: Record<number, boolean | MockGamepadButtonInit>;
  vibrationActuator?: {
    type?: string;
    playEffect?: (
      type: string,
      params: {
        startDelay?: number;
        duration: number;
        weakMagnitude: number;
        strongMagnitude: number;
      },
    ) => Promise<unknown> | unknown;
  } | null;
  hapticActuators?: Array<{
    pulse?: (value: number, duration: number) => Promise<unknown> | unknown;
  }> | null;
}

function createMockGamepad(init: MockGamepadInit = {}): Gamepad {
  const buttonCount = init.buttonCount ?? 17;
  const buttons: GamepadButton[] = Array.from({ length: buttonCount }, (_, idx) => {
    const spec = init.buttons?.[idx];
    if (typeof spec === 'boolean') {
      return {
        pressed: spec,
        touched: spec,
        value: spec ? 1 : 0,
      };
    }
    if (spec) {
      const pressed = Boolean(spec.pressed);
      const value = spec.value ?? (pressed ? 1 : 0);
      return {
        pressed,
        touched: spec.touched ?? (pressed || value > 0),
        value,
      };
    }
    return { pressed: false, touched: false, value: 0 };
  });

  const pad = {
    id: init.id ?? 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b12)',
    index: init.index ?? 0,
    connected: init.connected ?? true,
    timestamp: 1000,
    mapping: init.mapping ?? 'standard',
    axes: init.axes ?? [0, 0, 0, 0],
    buttons,
    vibrationActuator: init.vibrationActuator ?? null,
    hapticActuators: init.hapticActuators ?? undefined,
  };

  return pad as unknown as Gamepad;
}

function createMockSnapshot(overrides: {
  tick?: number;
  phase?: SimPhase;
  paused?: boolean;
  hitstopTicks?: number;
  nukeFlashTicks?: number;
  killsThisSortie?: number;
  killsByKind?: Record<string, number>;
  audioCues?: AudioCueId[];
  player?: Partial<PlayerState>;
} = {}): SimSnapshot {
  const player = {
    health: 100,
    maxHealth: 100,
    alive: true,
    firing: false,
    boosting: false,
    nukeTriggered: false,
    ...overrides.player,
  } as PlayerState;

  return {
    tick: overrides.tick ?? 1,
    phase: overrides.phase ?? 'playing',
    mode: 'normal',
    paused: overrides.paused ?? false,
    hitstopTicks: overrides.hitstopTicks ?? 0,
    screenShake: 0,
    nukeFlashTicks: overrides.nukeFlashTicks ?? 0,
    launchTicks: 0,
    deathTicks: 0,
    score: 0,
    combo: 1,
    comboTimer: 0,
    comboMaxTimer: 180,
    comboWarning: false,
    difficulty: 60,
    killsThisSortie: overrides.killsThisSortie ?? 0,
    killsByKind: overrides.killsByKind ?? {},
    player,
    enemies: [],
    projectiles: [],
    particles: [],
    parallax: [],
    cameraTargetX: 0,
    cameraTargetY: 0,
    audioEvents: (overrides.audioCues ?? []).map((cue) => ({ cue })),
    completedMissionsThisSortie: [],
    activeMissions: [],
    missionProgress: {},
    profile: {} as SimSnapshot['profile'],
    seaLevel: 0,
    spaceLevel: -1200,
    autopilotEnabled: false,
    seed: 1,
  };
}

describe('controller-profiles: Tesla detection & controller family classification', () => {
  it('detects Tesla in-car browsers and rejects standard desktop/mobile browsers', () => {
    expect(
      detectTeslaBrowser(
        'Mozilla/5.0 (X11; GNU/Linux) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Tesla/2025.2.6-abcd1234',
      ),
    ).toBe(true);
    expect(
      detectTeslaBrowser(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 QtCarBrowser Safari/537.36',
      ),
    ).toBe(true);
    expect(
      detectTeslaBrowser(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
      ),
    ).toBe(false);
    expect(
      detectTeslaBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      ),
    ).toBe(false);
    expect(detectTeslaBrowser('')).toBe(false);
  });

  it('classifies Xbox Series, One, 360, XInput, and Microsoft vendor IDs', () => {
    expect(
      detectControllerFamily(
        'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b12)',
      ),
    ).toEqual({ family: 'xbox', label: 'XBOX' });
    expect(detectControllerFamily('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toEqual({
      family: 'xbox',
      label: 'XBOX',
    });
    expect(detectControllerFamily('Microsoft Corp. Gamepad (045e-02ea)')).toEqual({
      family: 'xbox',
      label: 'XBOX',
    });
    expect(
      detectControllerFamily(
        'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b12)',
        true,
      ),
    ).toEqual({ family: 'xbox', label: 'XBOX (TESLA)' });
  });

  it('classifies PlayStation DualSense, DualShock 4, Sony VID 054c, and Wireless Controller', () => {
    expect(
      detectControllerFamily(
        'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',
      ),
    ).toEqual({ family: 'playstation', label: 'PLAYSTATION' });
    expect(
      detectControllerFamily(
        'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
      ),
    ).toEqual({ family: 'playstation', label: 'PLAYSTATION' });
    expect(detectControllerFamily('Sony DUALSHOCK 4 Controller')).toEqual({
      family: 'playstation',
      label: 'PLAYSTATION',
    });
    expect(detectControllerFamily('Wireless Controller', true)).toEqual({
      family: 'playstation',
      label: 'PLAYSTATION (TESLA)',
    });
  });

  it('classifies Nintendo Switch Pro, Joy-Con, VID 057e, and 8BitDo controllers', () => {
    expect(
      detectControllerFamily('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)'),
    ).toEqual({ family: 'nintendo', label: 'NINTENDO' });
    expect(detectControllerFamily('Nintendo Joy-Con (L+R)')).toEqual({
      family: 'nintendo',
      label: 'NINTENDO',
    });
    expect(detectControllerFamily('8BitDo Pro 2 Wired Controller')).toEqual({
      family: 'nintendo',
      label: 'NINTENDO',
    });
  });

  it('classifies Tesla / Jowua pads and generic pads connected in Tesla browser', () => {
    expect(detectControllerFamily('Jowua Wireless Controller')).toEqual({
      family: 'tesla',
      label: 'TESLA PAD',
    });
    expect(detectControllerFamily('Tesla Bluetooth Gamepad')).toEqual({
      family: 'tesla',
      label: 'TESLA PAD',
    });
    expect(detectControllerFamily('USB Gamepad (Vendor: 0810 Product: 0001)', true)).toEqual({
      family: 'tesla',
      label: 'TESLA PAD',
    });
  });

  it('classifies Steam Deck and Generic HID controllers', () => {
    expect(
      detectControllerFamily('Valve Software Steam Deck Controller (Vendor: 28de Product: 1205)'),
    ).toEqual({ family: 'steamdeck', label: 'STEAM DECK' });
    expect(detectControllerFamily('USB Gamepad (Vendor: 0810 Product: 0001)', false)).toEqual({
      family: 'generic',
      label: 'GAMEPAD',
    });
  });
});

describe('controller-profiles: standard gamepad flight & nav extraction', () => {
  it('applies radial deadzone cleanly and activates steering beyond deadzone', () => {
    const insideRadial = createMockGamepad({ axes: [0.15, 0.15, 0, 0] });
    const insideSample = extractGamepadInputs(insideRadial, [0, 0, 0, 0]);
    expect(insideSample.flight).toEqual({
      left: false,
      right: false,
      thrust: false,
      fire: false,
    });
    expect(insideSample.hasActivity).toBe(false);

    const slightDrift = createMockGamepad({ axes: [-0.21, 0.05, 0, 0] });
    expect(extractGamepadInputs(slightDrift).flight.left).toBe(false);

    const steerLeft = createMockGamepad({ axes: [-0.35, 0, 0, 0] });
    expect(extractGamepadInputs(steerLeft).flight).toEqual({
      left: true,
      right: false,
      thrust: false,
      fire: false,
    });

    const steerRight = createMockGamepad({ axes: [0.4, -0.4, 0, 0] });
    // Y = -0.4 is above -0.5 flight thrust threshold so steering slightly up keeps healing safe
    expect(extractGamepadInputs(steerRight).flight).toEqual({
      left: false,
      right: true,
      thrust: false,
      fire: false,
    });

    const stickThrust = createMockGamepad({ axes: [0, -0.65, 0, 0] });
    expect(extractGamepadInputs(stickThrust).flight.thrust).toBe(true);
  });

  it('maps D-pad, face buttons, shoulders, and analog triggers with threshold', () => {
    // D-pad steering & thrust
    expect(extractGamepadInputs(createMockGamepad({ buttons: { 14: true } })).flight.left).toBe(
      true,
    );
    expect(extractGamepadInputs(createMockGamepad({ buttons: { 15: true } })).flight.right).toBe(
      true,
    );
    expect(extractGamepadInputs(createMockGamepad({ buttons: { 12: true } })).flight.thrust).toBe(
      true,
    );

    // Thrust via A (btn 0) and analog RT (btn 7)
    expect(extractGamepadInputs(createMockGamepad({ buttons: { 0: true } })).flight.thrust).toBe(
      true,
    );
    expect(
      extractGamepadInputs(createMockGamepad({ buttons: { 7: { pressed: false, value: 0.15 } } }))
        .flight.thrust,
    ).toBe(false);
    expect(
      extractGamepadInputs(createMockGamepad({ buttons: { 7: { pressed: false, value: 0.3 } } }))
        .flight.thrust,
    ).toBe(true);

    // Fire via X (2), B (1), RB (5), LB (4), Y (3), and analog LT (6)
    for (const btnIdx of [1, 2, 3, 4, 5]) {
      expect(
        extractGamepadInputs(createMockGamepad({ buttons: { [btnIdx]: true } })).flight.fire,
      ).toBe(true);
    }
    expect(
      extractGamepadInputs(createMockGamepad({ buttons: { 6: { pressed: false, value: 0.18 } } }))
        .flight.fire,
    ).toBe(false);
    expect(
      extractGamepadInputs(createMockGamepad({ buttons: { 6: { pressed: false, value: 0.45 } } }))
        .flight.fire,
    ).toBe(true);
  });
});

describe('controller-profiles: non-standard Linux/Tesla/DirectInput HID fallback', () => {
  it('calibrates resting -1.0 trigger axes with zero phantom inputs and clean pull activation', () => {
    const restAxes = [0, 0, -1, 0, 0, -1, 0, 0];

    // Idle at rest: LT (axes[2]) and RT (axes[5]) sit at -1.0 -> zero phantom fire/thrust
    const idlePad = createMockGamepad({
      id: 'Microsoft X-Box One pad (Linux HID)',
      mapping: '',
      buttonCount: 11,
      axes: [0, 0, -1, 0, 0, -1, 0, 0],
    });
    const idle = extractGamepadInputs(idlePad, restAxes);
    expect(idle.nonStandardFallback).toBe(true);
    expect(idle.flight).toEqual({ left: false, right: false, thrust: false, fire: false });
    expect(idle.hasActivity).toBe(false);

    // Slight resting noise (-0.9) still does not falsely fire
    const noisePad = createMockGamepad({
      mapping: '',
      buttonCount: 11,
      axes: [0, 0, -0.9, 0, 0, -0.92, 0, 0],
    });
    expect(extractGamepadInputs(noisePad, restAxes).flight).toEqual({
      left: false,
      right: false,
      thrust: false,
      fire: false,
    });

    // Pull LT (axes[2]: -1 -> +0.25) -> fire only
    const ltPulled = createMockGamepad({
      mapping: '',
      buttonCount: 11,
      axes: [0, 0, 0.25, 0, 0, -1, 0, 0],
    });
    const ltRes = extractGamepadInputs(ltPulled, restAxes);
    expect(ltRes.flight.fire).toBe(true);
    expect(ltRes.flight.thrust).toBe(false);
    expect(ltRes.nav.lt).toBe(true);

    // Pull RT (axes[5]: -1 -> +0.3) -> thrust only
    const rtPulled = createMockGamepad({
      mapping: '',
      buttonCount: 11,
      axes: [0, 0, -1, 0, 0, 0.3, 0, 0],
    });
    const rtRes = extractGamepadInputs(rtPulled, restAxes);
    expect(rtRes.flight.thrust).toBe(true);
    expect(rtRes.flight.fire).toBe(false);
    expect(rtRes.nav.rt).toBe(true);

    // Linux xpad 11-button layout maps btn 6 -> select and btn 7 -> start without phantom triggers
    const xpadStartSelect = createMockGamepad({
      mapping: '',
      buttonCount: 11,
      axes: [0, 0, -1, 0, 0, -1, 0, 0],
      buttons: { 6: true, 7: true },
    });
    const xpadRes = extractGamepadInputs(xpadStartSelect, restAxes);
    expect(xpadRes.nav.select).toBe(true);
    expect(xpadRes.nav.start).toBe(true);
    expect(xpadRes.flight.fire).toBe(false);
    expect(xpadRes.flight.thrust).toBe(false);
  });

  it('supports PlayStation raw HID trigger axes (axes[3]/axes[4] resting at -1.0)', () => {
    const psRest = [0, 0, 0, -1, -1, 0, 0, 0, 0, 3.285714];
    const idlePs = createMockGamepad({
      id: 'Sony Interactive Entertainment Wireless Controller',
      mapping: '',
      buttonCount: 14,
      axes: [...psRest],
    });
    expect(extractGamepadInputs(idlePs, psRest).flight).toEqual({
      left: false,
      right: false,
      thrust: false,
      fire: false,
    });

    const pullBoth = createMockGamepad({
      id: 'Sony Interactive Entertainment Wireless Controller',
      mapping: '',
      buttonCount: 14,
      axes: [0, 0, 0, 0.5, 0.5, 0, 0, 0, 0, 3.285714],
    });
    const res = extractGamepadInputs(pullBoth, psRest);
    expect(res.flight.fire).toBe(true);
    expect(res.flight.thrust).toBe(true);
  });

  it('decodes 8-way POV hat-switch floats on axes[9] and discrete axes[6]/axes[7] D-pad', () => {
    const restWithPov = [0, 0, 0, 0, 0, 0, 0, 0, 0, 3.285714];

    const checkPov = (hatVal: number) =>
      extractGamepadInputs(
        createMockGamepad({
          mapping: '',
          buttonCount: 12,
          axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, hatVal],
        }),
        restWithPov,
      ).nav;

    // Neutral states
    expect(checkPov(3.285714)).toMatchObject({ up: false, down: false, left: false, right: false });
    expect(checkPov(1.285714)).toMatchObject({ up: false, down: false, left: false, right: false });
    expect(checkPov(0.0)).toMatchObject({ up: false, down: false, left: false, right: false });

    // All 8 compass directions
    expect(checkPov(-1.0)).toMatchObject({ up: true, down: false, left: false, right: false });
    expect(checkPov(-5 / 7)).toMatchObject({ up: true, down: false, left: false, right: true });
    expect(checkPov(-3 / 7)).toMatchObject({ up: false, down: false, left: false, right: true });
    expect(checkPov(-1 / 7)).toMatchObject({ up: false, down: true, left: false, right: true });
    expect(checkPov(1 / 7)).toMatchObject({ up: false, down: true, left: false, right: false });
    expect(checkPov(3 / 7)).toMatchObject({ up: false, down: true, left: true, right: false });
    expect(checkPov(5 / 7)).toMatchObject({ up: false, down: false, left: true, right: false });
    expect(checkPov(1.0)).toMatchObject({ up: true, down: false, left: true, right: false });

    // Discrete Linux evdev D-pad axes[6] (X) & axes[7] (Y)
    const dpadLeftUp = extractGamepadInputs(
      createMockGamepad({
        mapping: '',
        buttonCount: 11,
        axes: [0, 0, -1, 0, 0, -1, -1, -1],
      }),
      [0, 0, -1, 0, 0, -1, 0, 0],
    );
    expect(dpadLeftUp.flight.left).toBe(true);
    expect(dpadLeftUp.flight.thrust).toBe(true);
    expect(dpadLeftUp.nav.left).toBe(true);
    expect(dpadLeftUp.nav.up).toBe(true);

    const dpadRightDown = extractGamepadInputs(
      createMockGamepad({
        mapping: '',
        buttonCount: 11,
        axes: [0, 0, -1, 0, 0, -1, 1, 1],
      }),
      [0, 0, -1, 0, 0, -1, 0, 0],
    );
    expect(dpadRightDown.flight.right).toBe(true);
    expect(dpadRightDown.nav.right).toBe(true);
    expect(dpadRightDown.nav.down).toBe(true);
  });
});

describe('MenuRepeatTracker: deterministic DAS/ARR directional auto-repeat', () => {
  it('fires on rising edge, waits initialDelayMs, then repeats every repeatIntervalMs', () => {
    const tracker = new MenuRepeatTracker({ initialDelayMs: 320, repeatIntervalMs: 110 });
    const down = { up: false, down: true, left: false, right: false };
    const none = { up: false, down: false, left: false, right: false };

    expect(tracker.update(down, 1000)).toEqual(['down']);
    expect(tracker.update(down, 1100)).toEqual([]);
    expect(tracker.update(down, 1319)).toEqual([]);
    expect(tracker.update(down, 1320)).toEqual(['down']);
    expect(tracker.update(down, 1429)).toEqual([]);
    expect(tracker.update(down, 1430)).toEqual(['down']);
    expect(tracker.update(down, 1540)).toEqual(['down']);

    // Releasing resets DAS timer
    expect(tracker.update(none, 1560)).toEqual([]);
    expect(tracker.update(down, 1600)).toEqual(['down']);
    expect(tracker.update(down, 1919)).toEqual([]);
    expect(tracker.update(down, 1920)).toEqual(['down']);
  });

  it('cancels simultaneous opposing directions cleanly', () => {
    const tracker = new MenuRepeatTracker();
    expect(tracker.update({ up: true, down: true, left: true, right: true }, 0)).toEqual([]);
  });
});

describe('GamepadManager: 2P slots, menus, hot-plug, Tesla calibration, and auto-pause', () => {
  it('supports independent dual-gamepad 2P flight inputs with stable slot assignment', () => {
    let pads: (Gamepad | null)[] = [
      createMockGamepad({
        index: 0,
        id: 'Xbox Wireless Controller (045e)',
        buttons: { 14: true, 0: true },
      }),
      createMockGamepad({
        index: 1,
        id: 'DualSense Wireless Controller (054c)',
        buttons: { 15: true, 2: true },
      }),
    ];

    const mgr = new GamepadManager({ getGamepads: () => pads });
    const poll1 = mgr.poll({
      phase: 'playing',
      paused: false,
      modDeckOpen: false,
      paletteStudioOpen: false,
      nowMs: 100,
    });

    expect(poll1.p1).toEqual({ left: true, right: false, thrust: true, fire: false });
    expect(poll1.p2).toEqual({ left: false, right: true, thrust: false, fire: true });
    expect(poll1.hadActivity).toBe(true);
    expect(poll1.connectionEvents).toHaveLength(2);
    expect(poll1.connectionEvents[0]?.info).toMatchObject({ slot: 0, family: 'xbox' });
    expect(poll1.connectionEvents[1]?.info).toMatchObject({ slot: 1, family: 'playstation' });
    expect(mgr.getRawConnectedPads()).toHaveLength(2);

    // Slot 0 disconnects in flight -> P1 disconnect triggers auto-pause, Slot 1 STAYS in slot 1!
    pads = [
      null,
      createMockGamepad({
        index: 1,
        id: 'DualSense Wireless Controller (054c)',
        buttons: { 15: true, 2: true },
      }),
    ];
    const poll2 = mgr.poll({
      phase: 'playing',
      paused: false,
      modDeckOpen: false,
      paletteStudioOpen: false,
      nowMs: 116,
    });

    expect(poll2.p1DisconnectedInFlight).toBe(true);
    expect(poll2.connectionEvents).toHaveLength(1);
    expect(poll2.connectionEvents[0]).toMatchObject({
      type: 'disconnected',
      info: { slot: 0, family: 'xbox' },
    });
    expect(poll2.p1).toEqual({ left: false, right: false, thrust: false, fire: false });
    expect(poll2.p2).toEqual({ left: false, right: true, thrust: false, fire: true });
    expect(poll2.gamepads).toHaveLength(1);
    expect(poll2.gamepads[0]?.slot).toBe(1);

    // Next poll does not re-trigger p1DisconnectedInFlight
    const poll3 = mgr.poll({
      phase: 'playing',
      paused: false,
      modDeckOpen: false,
      paletteStudioOpen: false,
      nowMs: 132,
    });
    expect(poll3.p1DisconnectedInFlight).toBe(false);

    // New pad connects at browser index 2 -> takes open Slot 0
    pads = [
      null,
      createMockGamepad({
        index: 1,
        id: 'DualSense Wireless Controller (054c)',
      }),
      createMockGamepad({
        index: 2,
        id: 'Pro Controller (057e)',
        buttons: { 0: true },
      }),
    ];
    const poll4 = mgr.poll({
      phase: 'playing',
      paused: true,
      modDeckOpen: false,
      paletteStudioOpen: false,
      nowMs: 200,
    });
    expect(poll4.connectionEvents).toHaveLength(1);
    expect(poll4.connectionEvents[0]).toMatchObject({
      type: 'connected',
      info: { slot: 0, index: 2, family: 'nintendo' },
    });
    expect(poll4.p1.thrust).toBe(true);
  });

  it('auto-calibrates non-standard Tesla/Linux trigger rest axes across polls', () => {
    let pads: (Gamepad | null)[] = [
      createMockGamepad({
        index: 0,
        id: 'Generic USB Pad',
        mapping: '',
        buttonCount: 11,
        axes: [0, 0, -1, 0, 0, -1, 0, 0],
      }),
    ];

    const mgr = new GamepadManager({
      getGamepads: () => pads,
      userAgent: 'Mozilla/5.0 (X11; Linux) Chrome/120.0.0.0 Tesla/2025.4.1',
    });

    expect(mgr.isTeslaBrowser()).toBe(true);

    const idlePoll = mgr.poll({
      phase: 'playing',
      paused: false,
      modDeckOpen: false,
      paletteStudioOpen: false,
      nowMs: 0,
    });
    expect(idlePoll.gamepads[0]).toMatchObject({
      family: 'tesla',
      label: 'TESLA PAD',
      nonStandardFallback: true,
    });
    expect(idlePoll.p1).toEqual({ left: false, right: false, thrust: false, fire: false });
    expect(idlePoll.hadActivity).toBe(false);

    // Pull RT axis from -1 -> +0.4
    pads = [
      createMockGamepad({
        index: 0,
        id: 'Generic USB Pad',
        mapping: '',
        buttonCount: 11,
        axes: [0, 0, -1, 0, 0, 0.4, 0, 0],
      }),
    ];
    const pullPoll = mgr.poll({
      phase: 'playing',
      paused: false,
      modDeckOpen: false,
      paletteStudioOpen: false,
      nowMs: 16,
    });
    expect(pullPoll.p1.thrust).toBe(true);
    expect(pullPoll.p1.fire).toBe(false);
    expect(pullPoll.hadActivity).toBe(true);
  });

  it('routes all Hangar, Mod Deck, Palette Studio, Flight, Pause, and Game Over commands + DAS/ARR repeat', () => {
    let currentPad = createMockGamepad();
    const mgr = new GamepadManager({
      getGamepads: () => [currentPad],
      repeatInitialDelayMs: 320,
      repeatIntervalMs: 110,
    });

    const hangarCtx = (nowMs: number, extra?: Partial<{ modDeckOpen: boolean; paletteStudioOpen: boolean }>) => ({
      phase: 'hangar' as SimPhase,
      paused: false,
      modDeckOpen: extra?.modDeckOpen ?? false,
      paletteStudioOpen: extra?.paletteStudioOpen ?? false,
      nowMs,
    });

    // Hangar main: D-pad Down with DAS/ARR repeat
    currentPad = createMockGamepad({ buttons: { 13: true } });
    expect(mgr.poll(hangarCtx(0)).commands).toEqual([{ kind: 'key', code: 'ArrowDown' }]);
    expect(mgr.poll(hangarCtx(200)).commands).toEqual([]);
    expect(mgr.poll(hangarCtx(320)).commands).toEqual([{ kind: 'key', code: 'ArrowDown' }]);
    expect(mgr.poll(hangarCtx(430)).commands).toEqual([{ kind: 'key', code: 'ArrowDown' }]);

    // Release
    currentPad = createMockGamepad();
    expect(mgr.poll(hangarCtx(450)).commands).toEqual([]);

    // Hangar main buttons: A, Start, Select, Y, X, LB, RB, B
    currentPad = createMockGamepad({ buttons: { 0: true } });
    expect(mgr.poll(hangarCtx(500)).commands).toEqual([{ kind: 'key', code: 'Enter' }]);
    // Holding A does not double-fire
    expect(mgr.poll(hangarCtx(516)).commands).toEqual([]);

    currentPad = createMockGamepad({ buttons: { 9: true } });
    expect(mgr.poll(hangarCtx(532)).commands).toEqual([{ kind: 'launch' }]);

    currentPad = createMockGamepad({ buttons: { 8: true } });
    expect(mgr.poll(hangarCtx(548)).commands).toEqual([{ kind: 'toggle-mod-deck' }]);

    currentPad = createMockGamepad({ buttons: { 3: true } });
    expect(mgr.poll(hangarCtx(564)).commands).toEqual([{ kind: 'key', code: 'KeyC' }]);

    currentPad = createMockGamepad({ buttons: { 2: true } });
    expect(mgr.poll(hangarCtx(580)).commands).toEqual([{ kind: 'key', code: 'KeyM' }]);

    currentPad = createMockGamepad({ buttons: { 4: true } });
    expect(mgr.poll(hangarCtx(596)).commands).toEqual([{ kind: 'key', code: 'ArrowLeft' }]);

    currentPad = createMockGamepad({ buttons: { 5: true } });
    expect(mgr.poll(hangarCtx(612)).commands).toEqual([{ kind: 'key', code: 'ArrowRight' }]);

    currentPad = createMockGamepad({ buttons: { 1: true } });
    expect(mgr.poll(hangarCtx(628)).commands).toEqual([{ kind: 'key', code: 'Escape' }]);

    // Mod Deck open
    currentPad = createMockGamepad();
    mgr.poll(hangarCtx(640, { modDeckOpen: true }));

    currentPad = createMockGamepad({ buttons: { 14: true, 0: true } });
    expect(mgr.poll(hangarCtx(660, { modDeckOpen: true })).commands).toEqual([
      { kind: 'key', code: 'ArrowLeft' },
      { kind: 'key', code: 'Enter' },
    ]);

    currentPad = createMockGamepad({ buttons: { 8: true } });
    expect(mgr.poll(hangarCtx(680, { modDeckOpen: true })).commands).toEqual([
      { kind: 'key', code: 'Escape' },
    ]);

    // Palette Studio open (takes priority even when modDeckOpen is also true)
    currentPad = createMockGamepad();
    mgr.poll(hangarCtx(700, { modDeckOpen: true, paletteStudioOpen: true }));

    currentPad = createMockGamepad({ buttons: { 4: true } });
    expect(
      mgr.poll(hangarCtx(720, { modDeckOpen: true, paletteStudioOpen: true })).commands,
    ).toEqual([{ kind: 'key', code: 'KeyQ' }]);

    currentPad = createMockGamepad({ buttons: { 5: true } });
    expect(
      mgr.poll(hangarCtx(740, { modDeckOpen: true, paletteStudioOpen: true })).commands,
    ).toEqual([{ kind: 'key', code: 'KeyE' }]);

    currentPad = createMockGamepad({ buttons: { 3: true } });
    expect(
      mgr.poll(hangarCtx(760, { modDeckOpen: true, paletteStudioOpen: true })).commands,
    ).toEqual([{ kind: 'key', code: 'KeyR' }]);

    currentPad = createMockGamepad({ buttons: { 0: true } });
    expect(
      mgr.poll(hangarCtx(780, { modDeckOpen: true, paletteStudioOpen: true })).commands,
    ).toEqual([{ kind: 'key', code: 'Enter' }]);

    currentPad = createMockGamepad({ buttons: { 1: true } });
    expect(
      mgr.poll(hangarCtx(800, { modDeckOpen: true, paletteStudioOpen: true })).commands,
    ).toEqual([{ kind: 'key', code: 'Escape' }]);

    // Flight: Start -> pause-toggle
    currentPad = createMockGamepad();
    mgr.poll({
      phase: 'playing',
      paused: false,
      modDeckOpen: false,
      paletteStudioOpen: false,
      nowMs: 900,
    });
    currentPad = createMockGamepad({ buttons: { 9: true } });
    expect(
      mgr.poll({
        phase: 'playing',
        paused: false,
        modDeckOpen: false,
        paletteStudioOpen: false,
        nowMs: 916,
      }).commands,
    ).toEqual([{ kind: 'pause-toggle' }]);

    // Paused menu: Up/Down with repeat, Left/Right ignored, A->Enter, Start->pause-toggle, Y->KeyR, B->return-hangar
    currentPad = createMockGamepad();
    const pausedCtx = (nowMs: number) => ({
      phase: 'playing' as SimPhase,
      paused: true,
      modDeckOpen: false,
      paletteStudioOpen: false,
      nowMs,
    });
    mgr.poll(pausedCtx(940));

    currentPad = createMockGamepad({ buttons: { 13: true, 14: true } });
    expect(mgr.poll(pausedCtx(1000)).commands).toEqual([{ kind: 'key', code: 'ArrowDown' }]);
    expect(mgr.poll(pausedCtx(1320)).commands).toEqual([{ kind: 'key', code: 'ArrowDown' }]);

    currentPad = createMockGamepad({ buttons: { 0: true } });
    expect(mgr.poll(pausedCtx(1340)).commands).toEqual([{ kind: 'key', code: 'Enter' }]);

    currentPad = createMockGamepad({ buttons: { 9: true } });
    expect(mgr.poll(pausedCtx(1360)).commands).toEqual([{ kind: 'pause-toggle' }]);

    currentPad = createMockGamepad({ buttons: { 3: true } });
    expect(mgr.poll(pausedCtx(1380)).commands).toEqual([{ kind: 'key', code: 'KeyR' }]);

    currentPad = createMockGamepad({ buttons: { 1: true } });
    expect(mgr.poll(pausedCtx(1400)).commands).toEqual([{ kind: 'return-hangar' }]);

    // Game Over: holding A from flight does not immediately relaunch; fresh press does
    currentPad = createMockGamepad({ buttons: { 0: true } });
    mgr.poll({
      phase: 'dying',
      paused: false,
      modDeckOpen: false,
      paletteStudioOpen: false,
      nowMs: 1500,
    });
    expect(
      mgr.poll({
        phase: 'gameover',
        paused: false,
        modDeckOpen: false,
        paletteStudioOpen: false,
        nowMs: 1520,
      }).commands,
    ).toEqual([]);

    // Release and press Start -> relaunch; press B -> return-hangar
    currentPad = createMockGamepad();
    mgr.poll({
      phase: 'gameover',
      paused: false,
      modDeckOpen: false,
      paletteStudioOpen: false,
      nowMs: 1540,
    });

    currentPad = createMockGamepad({ buttons: { 9: true } });
    expect(
      mgr.poll({
        phase: 'gameover',
        paused: false,
        modDeckOpen: false,
        paletteStudioOpen: false,
        nowMs: 1560,
      }).commands,
    ).toEqual([{ kind: 'relaunch' }]);

    currentPad = createMockGamepad({ buttons: { 1: true } });
    expect(
      mgr.poll({
        phase: 'gameover',
        paused: false,
        modDeckOpen: false,
        paletteStudioOpen: false,
        nowMs: 1580,
      }).commands,
    ).toEqual([{ kind: 'return-hangar' }]);
  });

  it('handles gamepadconnected/gamepaddisconnected listeners without duplicate events and guards p1DisconnectedInFlight', () => {
    const target = new EventTarget();
    const pad0 = createMockGamepad({ index: 0, id: 'Xbox Wireless Controller (045e)' });
    let pads: (Gamepad | null)[] = [];

    const mgr = new GamepadManager({ getGamepads: () => pads });
    mgr.attach(target);

    // Connect via DOM event + backing navigator array
    pads = [pad0];
    const connectEvent = new Event('gamepadconnected') as Event & { gamepad: Gamepad };
    connectEvent.gamepad = pad0;
    target.dispatchEvent(connectEvent);

    // Immediately reflected before poll
    expect(mgr.getConnectedGamepads()).toHaveLength(1);

    // Poll emits the connection event exactly once (not duplicated!)
    const poll1 = mgr.poll({
      phase: 'launching',
      paused: false,
      modDeckOpen: false,
      paletteStudioOpen: false,
      nowMs: 100,
    });
    expect(poll1.connectionEvents).toHaveLength(1);
    expect(poll1.connectionEvents[0]?.type).toBe('connected');

    // Disconnect via DOM event during launching -> p1DisconnectedInFlight = true
    pads = [];
    const disconnectEvent = new Event('gamepaddisconnected') as Event & { gamepad: Gamepad };
    disconnectEvent.gamepad = pad0;
    target.dispatchEvent(disconnectEvent);

    const poll2 = mgr.poll({
      phase: 'launching',
      paused: false,
      modDeckOpen: false,
      paletteStudioOpen: false,
      nowMs: 120,
    });
    expect(poll2.connectionEvents).toHaveLength(1);
    expect(poll2.connectionEvents[0]?.type).toBe('disconnected');
    expect(poll2.p1DisconnectedInFlight).toBe(true);

    // Reconnect and disconnect while paused -> p1DisconnectedInFlight = false
    pads = [pad0];
    mgr.poll({
      phase: 'playing',
      paused: true,
      modDeckOpen: false,
      paletteStudioOpen: false,
      nowMs: 200,
    });
    pads = [];
    const pollPausedDrop = mgr.poll({
      phase: 'playing',
      paused: true,
      modDeckOpen: false,
      paletteStudioOpen: false,
      nowMs: 220,
    });
    expect(pollPausedDrop.p1DisconnectedInFlight).toBe(false);

    mgr.detach();
  });
});

describe('GamepadHaptics: dual-rumble, legacy fallback, cooldowns, and safe no-op', () => {
  it('invokes vibrationActuator.playEffect dual-rumble and enforces cooldown & priority override', () => {
    const playEffect = vi.fn().mockResolvedValue('complete');
    const pad = createMockGamepad({
      vibrationActuator: { type: 'dual-rumble', playEffect },
    });
    expect(hasGamepadRumble(pad)).toBe(true);

    const haptics = new GamepadHaptics();

    // Launch transition triggers launch pulse
    const prevHangar = createMockSnapshot({ tick: 1, phase: 'hangar' });
    const currLaunch = createMockSnapshot({ tick: 2, phase: 'launching', audioCues: ['sndlaunch'] });
    expect(haptics.syncFromSnapshot(prevHangar, currLaunch, [pad], 1000)).toBe(true);
    expect(playEffect).toHaveBeenCalledTimes(1);
    expect(playEffect).toHaveBeenLastCalledWith('dual-rumble', {
      startDelay: 0,
      duration: 140,
      weakMagnitude: 0.45,
      strongMagnitude: 0.35,
    });

    // Rapid heavy firing right after launch is throttled by active higher-priority launch pulse
    const prevPlay = createMockSnapshot({ tick: 3, phase: 'playing' });
    const fireSnap = createMockSnapshot({ tick: 4, phase: 'playing', audioCues: ['sndcannon'] });
    expect(haptics.syncFromSnapshot(prevPlay, fireSnap, [pad], 1040)).toBe(false);
    expect(playEffect).toHaveBeenCalledTimes(1);

    // After launch finishes, heavy fire triggers
    expect(haptics.syncFromSnapshot(prevPlay, fireSnap, [pad], 1200)).toBe(true);
    expect(playEffect).toHaveBeenCalledTimes(2);

    // Second fire within fire cooldown (110ms) is throttled
    const fireSnap2 = createMockSnapshot({ tick: 5, phase: 'playing', audioCues: ['sndcannon'] });
    expect(haptics.syncFromSnapshot(fireSnap, fireSnap2, [pad], 1250)).toBe(false);
    expect(playEffect).toHaveBeenCalledTimes(2);

    // Higher-priority player hit breaks through fire cooldown immediately!
    const hitSnap = createMockSnapshot({
      tick: 6,
      phase: 'playing',
      audioCues: ['sndplayerhit'],
      player: { health: 75 },
    });
    expect(haptics.syncFromSnapshot(fireSnap2, hitSnap, [pad], 1260)).toBe(true);
    expect(playEffect).toHaveBeenCalledTimes(3);

    // Boss kill after cooldown
    const bossKillSnap = createMockSnapshot({
      tick: 7,
      phase: 'playing',
      killsThisSortie: 1,
      killsByKind: { Blimp: 1 },
    });
    expect(haptics.syncFromSnapshot(hitSnap, bossKillSnap, [pad], 1500)).toBe(true);
    expect(playEffect).toHaveBeenCalledTimes(4);

    // Nuke detonation overrides everything
    const nukeSnap = createMockSnapshot({
      tick: 8,
      phase: 'playing',
      nukeFlashTicks: 20,
      audioCues: ['sndnuke'],
      player: { nukeTriggered: true },
    });
    expect(haptics.syncFromSnapshot(bossKillSnap, nukeSnap, [pad], 1550)).toBe(true);
    expect(playEffect).toHaveBeenCalledTimes(5);
    expect(playEffect).toHaveBeenLastCalledWith(
      'dual-rumble',
      expect.objectContaining({ strongMagnitude: 1, weakMagnitude: 0.9 }),
    );

    // Identical snapshot reference is a safe no-op
    expect(haptics.syncFromSnapshot(nukeSnap, nukeSnap, [pad], 2500)).toBe(false);
    expect(playEffect).toHaveBeenCalledTimes(5);

    // Disabled haptics suppresses pulses
    haptics.setEnabled(false);
    const deathSnap = createMockSnapshot({
      tick: 9,
      phase: 'dying',
      audioCues: ['sndplayerdie'],
      player: { alive: false, health: 0 },
    });
    expect(haptics.syncFromSnapshot(nukeSnap, deathSnap, [pad], 3000)).toBe(false);
    expect(playEffect).toHaveBeenCalledTimes(5);

    // Re-enabling works
    haptics.setEnabled(true);
    expect(haptics.syncFromSnapshot(nukeSnap, deathSnap, [pad], 3100)).toBe(true);
    expect(playEffect).toHaveBeenCalledTimes(6);
  });

  it('supports legacy hapticActuators[0].pulse and safely no-ops when unsupported or throwing', () => {
    const legacyPulse = vi.fn().mockResolvedValue(true);
    const legacyPad = createMockGamepad({
      vibrationActuator: null,
      hapticActuators: [{ pulse: legacyPulse }],
    });
    expect(hasGamepadRumble(legacyPad)).toBe(true);

    const haptics = new GamepadHaptics();
    expect(
      haptics.triggerPulse(
        [legacyPad],
        { durationMs: 120, weakMagnitude: 0.4, strongMagnitude: 0.8 },
        500,
      ),
    ).toBe(true);
    expect(legacyPulse).toHaveBeenCalledWith(0.8, 120);

    // Unsupported pad never throws
    const plainPad = createMockGamepad({ vibrationActuator: null, hapticActuators: null });
    expect(hasGamepadRumble(plainPad)).toBe(false);
    expect(() =>
      haptics.triggerPulse(
        [plainPad],
        { durationMs: 100, weakMagnitude: 0.5, strongMagnitude: 0.5 },
        700,
      ),
    ).not.toThrow();
    expect(
      haptics.triggerPulse(
        [plainPad],
        { durationMs: 100, weakMagnitude: 0.5, strongMagnitude: 0.5 },
        700,
      ),
    ).toBe(false);

    // Sync throw + rejected Promise are swallowed safely
    const throwingPad = createMockGamepad({
      vibrationActuator: {
        playEffect: () => {
          throw new Error('Actuator unavailable');
        },
      },
    });
    const rejectingPad = createMockGamepad({
      vibrationActuator: {
        playEffect: () => Promise.reject(new Error('Unfocused tab')),
      },
    });
    expect(() =>
      haptics.triggerPulse(
        [throwingPad, rejectingPad],
        { durationMs: 80, weakMagnitude: 0.5, strongMagnitude: 0.5 },
        1000,
      ),
    ).not.toThrow();
  });
});
