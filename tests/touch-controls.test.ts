import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clientToVirtualPoint,
  resolveCanvasTapCommand,
} from '../src/input/canvas-tap';
import { ControllerToast } from '../src/input/controller-toast';
import {
  DEFAULT_FLIGHT_DEADZONE,
  DEFAULT_STICK_MAX_RADIUS,
  DEFAULT_THRUST_THRESHOLD,
  TouchControlsOverlay,
  computeStickDeflection,
  stickVectorToFlightInput,
  stickVectorToMenuDirection,
} from '../src/input/touch-controls';
import {
  TouchEnvironmentDetector,
  detectInitialMobileTouch,
  detectTeslaUserAgent,
  type MediaQueryMatchLike,
} from '../src/input/touch-detector';
import { PALETTES } from '../src/render/palettes';

class FakeEventTarget implements EventTarget {
  private listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  public addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
  ): void {
    if (!callback) return;
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(callback);
  }

  public removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
  ): void {
    if (!callback) return;
    this.listeners.get(type)?.delete(callback);
  }

  public dispatchEvent(event: Event): boolean {
    const set = this.listeners.get(event.type);
    if (!set) return true;
    for (const listener of [...set]) {
      if (typeof listener === 'function') {
        listener(event);
      } else {
        listener.handleEvent(event);
      }
    }
    return true;
  }

  public emit(type: string, payload: Record<string, unknown> = {}): void {
    const event = Object.assign({ type }, payload) as unknown as Event;
    this.dispatchEvent(event);
  }
}

describe('TouchEnvironmentDetector & mobile/Tesla sensing', () => {
  it('detects Tesla browser user agents cleanly', () => {
    expect(
      detectTeslaUserAgent(
        'Mozilla/5.0 (X11; GNU/Linux) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Tesla/2026.8.1',
      ),
    ).toBe(true);
    expect(
      detectTeslaUserAgent('Mozilla/5.0 QtCarBrowser AppleWebKit/537.36'),
    ).toBe(true);
    expect(
      detectTeslaUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36',
      ),
    ).toBe(false);
  });

  it('keeps touch controls strictly HIDDEN on standard desktop boot', () => {
    const res = detectInitialMobileTouch({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
      maxTouchPoints: 0,
      coarsePointer: false,
      hoverNone: false,
    });
    expect(res).toEqual({
      touchSensed: false,
      touchOverlayVisible: false,
      isTeslaBrowser: false,
    });
  });

  it('keeps touch controls HIDDEN on Windows touchscreen laptops on boot', () => {
    const detector = new TouchEnvironmentDetector({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
      maxTouchPoints: 10,
      coarsePointer: false,
      hoverNone: false,
    });
    expect(detector.touchSensed).toBe(false);
    expect(detector.touchOverlayVisible).toBe(false);
    expect(detector.isTeslaBrowser).toBe(false);
  });

  it('reveals touch controls immediately on boot for genuine mobile & tablet devices', () => {
    const phone = detectInitialMobileTouch({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      maxTouchPoints: 5,
      coarsePointer: true,
      hoverNone: true,
    });
    expect(phone.touchSensed).toBe(true);
    expect(phone.touchOverlayVisible).toBe(true);
    expect(phone.isTeslaBrowser).toBe(false);

    // Tablet UA + maxTouchPoints even when matchMedia is unavailable
    const tablet = detectInitialMobileTouch({
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 Safari/537.36',
      maxTouchPoints: 10,
      coarsePointer: false,
      hoverNone: false,
    });
    expect(tablet.touchSensed).toBe(true);
    expect(tablet.touchOverlayVisible).toBe(true);

    // iPadOS reporting desktop Macintosh UA but coarse pointer + hover: none
    const ipadDesktopUa = detectInitialMobileTouch({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
      maxTouchPoints: 5,
      coarsePointer: true,
      hoverNone: true,
    });
    expect(ipadDesktopUa.touchSensed).toBe(true);
    expect(ipadDesktopUa.touchOverlayVisible).toBe(true);
  });

  it('starts hidden on Tesla browser, reveals on first real touch, auto-hides on gamepad/keyboard, and re-shows on next touch', () => {
    const detector = new TouchEnvironmentDetector({
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36 Tesla/2026.14',
      maxTouchPoints: 10,
      coarsePointer: true,
      hoverNone: true,
    });

    expect(detector.isTeslaBrowser).toBe(true);
    expect(detector.touchSensed).toBe(false);
    expect(detector.touchOverlayVisible).toBe(false);

    const target = new FakeEventTarget();
    const history: boolean[] = [];
    const unsubscribe = detector.onChange((s) =>
      history.push(s.touchOverlayVisible),
    );
    detector.attach(target);

    // Mouse pointerdown must NOT reveal touch overlay
    target.emit('pointerdown', { pointerType: 'mouse' });
    expect(detector.touchOverlayVisible).toBe(false);
    expect(history).toEqual([]);

    // Real touch pointerdown immediately senses touch & reveals sticks
    target.emit('pointerdown', { pointerType: 'touch' });
    expect(detector.touchSensed).toBe(true);
    expect(detector.touchOverlayVisible).toBe(true);
    expect(history).toEqual([true]);

    // Physical gamepad input auto-hides overlay
    detector.notifyNonTouchInput('gamepad');
    expect(detector.touchOverlayVisible).toBe(false);
    expect(detector.touchSensed).toBe(true);
    expect(history).toEqual([true, false]);

    // Next real touchstart immediately re-reveals sticks
    target.emit('touchstart');
    expect(detector.touchOverlayVisible).toBe(true);
    expect(history).toEqual([true, false, true]);

    // Physical keyboard input auto-hides overlay
    detector.notifyNonTouchInput('keyboard');
    expect(detector.touchOverlayVisible).toBe(false);
    expect(history).toEqual([true, false, true, false]);

    // Detach stops further notifications
    detector.detach();
    target.emit('touchstart');
    expect(detector.touchOverlayVisible).toBe(false);

    unsubscribe();
  });

  it('supports setForceVisible QA override cleanly', () => {
    const detector = new TouchEnvironmentDetector({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      maxTouchPoints: 0,
      coarsePointer: false,
      hoverNone: false,
    });
    expect(detector.touchOverlayVisible).toBe(false);

    detector.setForceVisible(true);
    expect(detector.forceVisible).toBe(true);
    expect(detector.touchOverlayVisible).toBe(true);

    // Keyboard input does not defeat explicit forceVisible=true
    detector.notifyNonTouchInput('keyboard');
    expect(detector.touchOverlayVisible).toBe(true);

    // Explicit forceVisible=false hides even when touch arrives
    detector.setForceVisible(false);
    detector.notifyTouchInput();
    expect(detector.touchOverlayVisible).toBe(false);

    // Clearing override returns to automatic state (touch was sensed & active)
    detector.setForceVisible(null);
    expect(detector.forceVisible).toBe(null);
    expect(detector.touchOverlayVisible).toBe(true);
  });

  it('responds to live matchMedia coarse-pointer changes on non-Tesla devices', () => {
    const handlers: Array<(ev: { matches: boolean }) => void> = [];
    const mql: MediaQueryMatchLike = {
      matches: false,
      addEventListener: (_type, fn) => {
        handlers.push(fn);
      },
      removeEventListener: (_type, fn) => {
        const idx = handlers.indexOf(fn);
        if (idx >= 0) handlers.splice(idx, 1);
      },
    };
    const detector = new TouchEnvironmentDetector({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      maxTouchPoints: 5,
      matchMedia: () => mql,
    });
    const target = new FakeEventTarget();
    detector.attach(target, () => mql);
    expect(detector.touchOverlayVisible).toBe(false);
    expect(handlers.length).toBe(1);

    handlers[0]?.({ matches: true });
    expect(detector.touchSensed).toBe(true);
    expect(detector.touchOverlayVisible).toBe(true);

    detector.detach();
    expect(handlers.length).toBe(0);
  });
});

describe('Translucent stick deflection & flight input math', () => {
  it('computes normalized clamped deflection vectors accurately', () => {
    expect(computeStickDeflection(0, 0, DEFAULT_STICK_MAX_RADIUS)).toEqual({
      x: 0,
      y: 0,
      active: true,
      magnitude: 0,
    });

    const halfRight = computeStickDeflection(22, 0, 44);
    expect(halfRight.x).toBeCloseTo(0.5, 5);
    expect(halfRight.y).toBeCloseTo(0, 5);
    expect(halfRight.magnitude).toBeCloseTo(0.5, 5);
    expect(halfRight.active).toBe(true);

    // Clamping far outside radius preserves direction with unit magnitude
    const clampedDiag = computeStickDeflection(-300, -400, 44);
    expect(clampedDiag.magnitude).toBeCloseTo(1, 5);
    expect(clampedDiag.x).toBeCloseTo(-0.6, 5);
    expect(clampedDiag.y).toBeCloseTo(-0.8, 5);
  });

  it('maps deadzone, steering, upward thrust, downward neutral healing, and simultaneous multi-touch combat', () => {
    // Inside deadzone -> neutral healing zone (all false)
    const neutral = stickVectorToFlightInput(
      {
        x: DEFAULT_FLIGHT_DEADZONE * 0.8,
        y: -DEFAULT_THRUST_THRESHOLD * 0.5,
        active: true,
        magnitude: 0.25,
      },
      false,
      false,
    );
    expect(neutral).toEqual({
      left: false,
      right: false,
      thrust: false,
      fire: false,
    });

    // Pulling straight down does NOT trigger thrust (stays healing-safe)
    const downPull = stickVectorToFlightInput(
      { x: 0, y: 0.95, active: true, magnitude: 0.95 },
      false,
      false,
    );
    expect(downPull).toEqual({
      left: false,
      right: false,
      thrust: false,
      fire: false,
    });

    // Hard left + upward thrust
    const upLeft = stickVectorToFlightInput(
      { x: -0.7, y: -0.6, active: true, magnitude: 0.92 },
      false,
      false,
    );
    expect(upLeft).toEqual({
      left: true,
      right: false,
      thrust: true,
      fire: false,
    });

    // Simultaneous multi-touch: right turn + dedicated BOOST button + static pressable FIRE button
    const multiTouch = stickVectorToFlightInput(
      { x: 0.8, y: 0.1, active: true, magnitude: 0.81 },
      true,
      true,
    );
    expect(multiTouch).toEqual({
      left: false,
      right: true,
      thrust: true,
      fire: true,
    });

    // Menu 4-way directional extraction respects deadzone and dominant axis
    expect(
      stickVectorToMenuDirection({ x: 0.1, y: 0.1, active: true, magnitude: 0.14 }),
    ).toBeNull();
    expect(
      stickVectorToMenuDirection({ x: -0.7, y: 0.2, active: true, magnitude: 0.73 }),
    ).toBe('ArrowLeft');
    expect(
      stickVectorToMenuDirection({ x: 0.1, y: -0.8, active: true, magnitude: 0.81 }),
    ).toBe('ArrowUp');
    expect(
      stickVectorToMenuDirection({ x: 0.2, y: 0.85, active: true, magnitude: 0.87 }),
    ).toBe('ArrowDown');
  });

  it('operates cleanly in headless Node/Vitest without DOM', () => {
    const overlay = new TouchControlsOverlay();
    expect(overlay.isVisible()).toBe(false);
    expect(overlay.getElement()).toBeNull();
    expect(overlay.getFlightInput()).toEqual({
      left: false,
      right: false,
      thrust: false,
      fire: false,
    });
    expect(overlay.getSnapshot().firePressed).toBe(false);

    overlay.updateContext({
      phase: 'playing',
      paused: false,
      modDeckOpen: false,
      paletteStudioOpen: false,
      palette: PALETTES[0]!,
    });
    overlay.setVisible(true);
    expect(overlay.isVisible()).toBe(true);
    expect(overlay.getSnapshot().mode).toBe('flight');
    expect(overlay.getSnapshot().firePressed).toBe(false);
    expect(overlay.drainCommands(1000)).toEqual([]);

    overlay.updateContext({
      phase: 'hangar',
      paused: false,
      modDeckOpen: false,
      paletteStudioOpen: false,
      palette: PALETTES[0]!,
    });
    expect(overlay.getSnapshot().mode).toBe('menu');

    overlay.dispose();
  });

  it('renders FIRE as a static pressable button (no right stick/puck) and handles press, slide, multi-pointer, cancel, blur, and mode switch cleanly', () => {
    class FakeElement extends FakeEventTarget {
      public readonly tagName: string;
      public className = '';
      public type = '';
      public textContent = '';
      public parentElement: FakeElement | null = null;
      public children: FakeElement[] = [];
      public attributes = new Map<string, string>();
      public style: {
        display: string;
        transform: string;
        vars: Record<string, string>;
        setProperty: (k: string, v: string) => void;
      } = {
        display: '',
        transform: '',
        vars: {},
        setProperty(k: string, v: string) {
          this.vars[k] = v;
        },
      };
      public setPointerCapture = vi.fn();

      constructor(tag: string) {
        super();
        this.tagName = tag.toUpperCase();
      }
      setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
      }
      getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
      }
      appendChild(child: FakeElement): FakeElement {
        child.parentElement = this;
        this.children.push(child);
        return child;
      }
      removeChild(child: FakeElement): FakeElement {
        const idx = this.children.indexOf(child);
        if (idx >= 0) this.children.splice(idx, 1);
        child.parentElement = null;
        return child;
      }
      querySelector(): FakeElement | null {
        return null;
      }
      getBoundingClientRect() {
        return { left: 420, top: 240, width: 120, height: 120, right: 540, bottom: 360 };
      }
    }

    const findByTestId = (root: FakeElement, id: string): FakeElement | null => {
      if (root.getAttribute('data-testid') === id) return root;
      for (const ch of root.children) {
        const hit = findByTestId(ch, id);
        if (hit) return hit;
      }
      return null;
    };

    const fakeHead = new FakeElement('head');
    const fakeBody = new FakeElement('body');
    const fakeDocument = Object.assign(new FakeEventTarget(), {
      head: fakeHead,
      body: fakeBody,
      hidden: false,
      createElement: (tag: string) => new FakeElement(tag),
      createElementNS: (_ns: string, tag: string) => new FakeElement(tag),
    });
    const fakeWindow = Object.assign(new FakeEventTarget(), {
      PointerEvent: function PointerEvent() {},
    });

    const origDocument = globalThis.document;
    const origWindow = globalThis.window;
    Object.defineProperty(globalThis, 'document', { value: fakeDocument, configurable: true });
    Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true });

    try {
      const overlay = new TouchControlsOverlay(fakeBody as unknown as HTMLElement);
      overlay.setVisible(true);
      overlay.updateContext({
        phase: 'playing',
        paused: false,
        modDeckOpen: false,
        paletteStudioOpen: false,
        palette: PALETTES[0]!,
      });

      const root = overlay.getElement() as unknown as FakeElement;
      expect(root).not.toBeNull();

      // Static pressable button present; draggable right stick & puck must NOT exist
      const fireBtn = findByTestId(root, 'touch-btn-fire');
      expect(fireBtn).not.toBeNull();
      expect(fireBtn!.tagName).toBe('BUTTON');
      expect(fireBtn!.getAttribute('aria-label')).toBe('Fire');
      expect(fireBtn!.getAttribute('data-pressed')).toBe('false');
      expect(findByTestId(root, 'touch-stick-right')).toBeNull();
      expect(findByTestId(root, 'touch-puck-right')).toBeNull();

      const mkEv = (pointerId: number, clientX = 480, clientY = 300) => ({
        pointerId,
        clientX,
        clientY,
        preventDefault: vi.fn(),
      });

      // Press down -> fire active, data-pressed=true
      fireBtn!.emit('pointerdown', mkEv(7, 480, 300));
      expect(overlay.getSnapshot().firePressed).toBe(true);
      expect(overlay.getFlightInput().fire).toBe(true);
      expect(fireBtn!.getAttribute('data-pressed')).toBe('true');

      // Sliding across button does NOT release fire and applies zero joystick transform
      fireBtn!.emit('pointermove', mkEv(7, 540, 260));
      expect(overlay.getSnapshot().firePressed).toBe(true);
      expect(overlay.getFlightInput().fire).toBe(true);
      expect(fireBtn!.style.transform).toBe('');

      // Unrelated pointer release does NOT release held fire
      fireBtn!.emit('pointerup', mkEv(99));
      expect(overlay.getSnapshot().firePressed).toBe(true);

      // Owning pointer release clears fire cleanly
      fireBtn!.emit('pointerup', mkEv(7));
      expect(overlay.getSnapshot().firePressed).toBe(false);
      expect(overlay.getFlightInput().fire).toBe(false);
      expect(fireBtn!.getAttribute('data-pressed')).toBe('false');

      // pointercancel & lostpointercapture both release cleanly
      fireBtn!.emit('pointerdown', mkEv(8));
      expect(overlay.getSnapshot().firePressed).toBe(true);
      fireBtn!.emit('pointercancel', mkEv(8));
      expect(overlay.getSnapshot().firePressed).toBe(false);

      fireBtn!.emit('pointerdown', mkEv(9));
      expect(overlay.getSnapshot().firePressed).toBe(true);
      fireBtn!.emit('lostpointercapture', mkEv(9));
      expect(overlay.getSnapshot().firePressed).toBe(false);

      // Window blur releases held fire cleanly
      fireBtn!.emit('pointerdown', mkEv(10));
      expect(overlay.getSnapshot().firePressed).toBe(true);
      fakeWindow.emit('blur');
      expect(overlay.getSnapshot().firePressed).toBe(false);
      expect(fireBtn!.getAttribute('data-pressed')).toBe('false');

      // Mode switch (flight -> hangar menu) releases held fire cleanly
      fireBtn!.emit('pointerdown', mkEv(11));
      expect(overlay.getSnapshot().firePressed).toBe(true);
      overlay.updateContext({
        phase: 'hangar',
        paused: false,
        modDeckOpen: false,
        paletteStudioOpen: false,
        palette: PALETTES[0]!,
      });
      expect(overlay.getSnapshot().firePressed).toBe(false);
      expect(overlay.getFlightInput().fire).toBe(false);

      overlay.dispose();
    } finally {
      Object.defineProperty(globalThis, 'document', { value: origDocument, configurable: true });
      Object.defineProperty(globalThis, 'window', { value: origWindow, configurable: true });
    }
  });
});

describe('Direct canvas tap mapping & virtual hit testing', () => {
  it('maps 1:1 3:2 canvas coordinates cleanly', () => {
    const rect = { left: 100, top: 50, width: 600, height: 400 };
    expect(clientToVirtualPoint(100, 50, rect)).toEqual({ x: 0, y: 0 });
    expect(clientToVirtualPoint(400, 250, rect)).toEqual({ x: 300, y: 200 });
    expect(clientToVirtualPoint(700, 450, rect)).toEqual({ x: 600, y: 400 });
    expect(clientToVirtualPoint(99, 250, rect)).toBeNull();
  });

  it('accounts for horizontal pillarbox bars on 16:9 / Tesla wide screens', () => {
    // 1920x1080 -> target 3:2 rendered area is 1620x1080, horizontal margins 150px each side
    const rect = { left: 0, top: 0, width: 1920, height: 1080 };
    expect(clientToVirtualPoint(75, 540, rect)).toBeNull(); // left black bar
    expect(clientToVirtualPoint(1850, 540, rect)).toBeNull(); // right black bar

    const topLeft = clientToVirtualPoint(150, 0, rect);
    expect(topLeft?.x).toBeCloseTo(0, 5);
    expect(topLeft?.y).toBeCloseTo(0, 5);

    const center = clientToVirtualPoint(960, 540, rect);
    expect(center?.x).toBeCloseTo(300, 5);
    expect(center?.y).toBeCloseTo(200, 5);

    const bottomRight = clientToVirtualPoint(1770, 1080, rect);
    expect(bottomRight?.x).toBeCloseTo(600, 5);
    expect(bottomRight?.y).toBeCloseTo(400, 5);
  });

  it('accounts for vertical letterbox bars on portrait phones', () => {
    // 390x844 -> rendered 3:2 box is 390x260, vertical margins (844 - 260)/2 = 292px
    const rect = { left: 0, top: 0, width: 390, height: 844 };
    expect(clientToVirtualPoint(195, 100, rect)).toBeNull(); // top black bar
    expect(clientToVirtualPoint(195, 700, rect)).toBeNull(); // bottom black bar

    const center = clientToVirtualPoint(195, 422, rect);
    expect(center?.x).toBeCloseTo(300, 5);
    expect(center?.y).toBeCloseTo(200, 5);

    const topEdge = clientToVirtualPoint(0, 292, rect);
    expect(topEdge?.x).toBeCloseTo(0, 5);
    expect(topEdge?.y).toBeCloseTo(0, 5);
  });

  it('resolves Hangar row taps (select, prev, next, launch) and ignores modal overlays', () => {
    const baseCtx = {
      phase: 'hangar' as const,
      paused: false,
      modDeckOpen: false,
      paletteStudioOpen: false,
      activeHangarRowIndex: 1,
    };

    // Unselected row 0 (y in 68..96) -> select
    expect(resolveCanvasTapCommand(150, 80, baseCtx)).toEqual({
      kind: 'hangar-row-tap',
      rowIndex: 0,
      action: 'select',
    });

    // Selected row 1 (y in 100..128), left third (x=42..128) -> prev
    expect(resolveCanvasTapCommand(80, 114, baseCtx)).toEqual({
      kind: 'hangar-row-tap',
      rowIndex: 1,
      action: 'prev',
    });

    // Selected row 1, right two-thirds (x=130..302) -> next
    expect(resolveCanvasTapCommand(220, 114, baseCtx)).toEqual({
      kind: 'hangar-row-tap',
      rowIndex: 1,
      action: 'next',
    });

    // Launch row 6 (y = 68 + 6*32 = 260..288) -> launch
    expect(resolveCanvasTapCommand(160, 274, baseCtx)).toEqual({
      kind: 'launch',
    });

    // Outside row column -> null
    expect(resolveCanvasTapCommand(450, 114, baseCtx)).toBeNull();

    // Mod Deck or Palette Studio open -> ignored by main Hangar hit tester
    expect(
      resolveCanvasTapCommand(160, 274, { ...baseCtx, modDeckOpen: true }),
    ).toBeNull();
    expect(
      resolveCanvasTapCommand(160, 274, { ...baseCtx, paletteStudioOpen: true }),
    ).toBeNull();
  });

  it('resolves Pause menu option buttons accurately', () => {
    const pauseCtx = {
      phase: 'playing' as const,
      paused: true,
      modDeckOpen: false,
      paletteStudioOpen: false,
      activeHangarRowIndex: 0,
    };

    // Option 0: y=186..206, Option 1: y=210..230, Option 2: y=234..254
    expect(resolveCanvasTapCommand(300, 196, pauseCtx)).toEqual({
      kind: 'pause-option-tap',
      optionIndex: 0,
    });
    expect(resolveCanvasTapCommand(300, 220, pauseCtx)).toEqual({
      kind: 'pause-option-tap',
      optionIndex: 1,
    });
    expect(resolveCanvasTapCommand(300, 244, pauseCtx)).toEqual({
      kind: 'pause-option-tap',
      optionIndex: 2,
    });
    // Outside pause buttons
    expect(resolveCanvasTapCommand(100, 196, pauseCtx)).toBeNull();
    expect(resolveCanvasTapCommand(300, 140, pauseCtx)).toBeNull();
  });

  it('resolves Game Over debrief taps (relaunch vs return-hangar) and ignores active flight', () => {
    const goCtx = {
      phase: 'gameover' as const,
      paused: false,
      modDeckOpen: false,
      paletteStudioOpen: false,
      activeHangarRowIndex: 0,
    };

    // Center debrief card -> relaunch
    expect(resolveCanvasTapCommand(300, 180, goCtx)).toEqual({
      kind: 'relaunch',
    });

    // Left half of bottom prompt bar -> relaunch
    expect(resolveCanvasTapCommand(180, 345, goCtx)).toEqual({
      kind: 'relaunch',
    });

    // Right third of bottom prompt bar -> return-hangar
    expect(resolveCanvasTapCommand(480, 345, goCtx)).toEqual({
      kind: 'return-hangar',
    });

    // Active flight -> null
    expect(
      resolveCanvasTapCommand(300, 200, {
        ...goCtx,
        phase: 'playing',
      }),
    ).toBeNull();
  });

  it('resolves Assist Mode toggle taps in Hangar header, Pause card, and Game Over prompt bar', () => {
    expect(
      resolveCanvasTapCommand(90, 10, {
        phase: 'hangar',
        paused: false,
        modDeckOpen: false,
        paletteStudioOpen: false,
        activeHangarRowIndex: 0,
      }),
    ).toEqual({ kind: 'toggle-assist' });

    expect(
      resolveCanvasTapCommand(300, 268, {
        phase: 'playing',
        paused: true,
        modDeckOpen: false,
        paletteStudioOpen: false,
        activeHangarRowIndex: 0,
      }),
    ).toEqual({ kind: 'toggle-assist' });

    expect(
      resolveCanvasTapCommand(315, 345, {
        phase: 'gameover',
        paused: false,
        modDeckOpen: false,
        paletteStudioOpen: false,
        activeHangarRowIndex: 0,
      }),
    ).toEqual({ kind: 'toggle-assist' });
  });
});

describe('ControllerToast ephemeral status pill', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts hidden, displays message on show(), and auto-hides after duration', () => {
    vi.useFakeTimers();
    const toast = new ControllerToast();
    expect(toast.isVisible()).toBe(false);

    toast.show('XBOX CONTROLLER CONNECTED', PALETTES[0], 2600);
    expect(toast.isVisible()).toBe(true);
    expect(toast.getLastMessage()).toBe('XBOX CONTROLLER CONNECTED');

    vi.advanceTimersByTime(2599);
    expect(toast.isVisible()).toBe(true);

    vi.advanceTimersByTime(1);
    expect(toast.isVisible()).toBe(false);

    toast.dispose();
  });
});
