export interface MediaQueryMatchLike {
  matches: boolean;
  addEventListener?: (type: 'change', listener: (ev: { matches: boolean }) => void) => void;
  removeEventListener?: (type: 'change', listener: (ev: { matches: boolean }) => void) => void;
  addListener?: (listener: (ev: { matches: boolean }) => void) => void;
  removeListener?: (listener: (ev: { matches: boolean }) => void) => void;
}

export interface TouchEnvironmentProbe {
  userAgent?: string;
  maxTouchPoints?: number;
  coarsePointer?: boolean;
  hoverNone?: boolean;
  matchMedia?: (query: string) => MediaQueryMatchLike | null;
}

export interface InitialTouchDetection {
  touchSensed: boolean;
  touchOverlayVisible: boolean;
  isTeslaBrowser: boolean;
}

export interface TouchDetectorState {
  touchSensed: boolean;
  touchOverlayVisible: boolean;
  isTeslaBrowser: boolean;
  forceVisible: boolean | null;
}

export type TouchDetectorListener = (state: TouchDetectorState) => void;

const COARSE_NO_HOVER_QUERY = '(pointer: coarse) and (hover: none)';
const MOBILE_TABLET_UA_RE = /Android|iPhone|iPad|iPod|Mobile|Tablet/i;
const TESLA_UA_RE = /Tesla\/|QtCarBrowser/i;

/**
 * Pure helper detecting Tesla in-car browsers (`Tesla/` Chromium or legacy `QtCarBrowser`).
 */
export function detectTeslaUserAgent(ua?: string): boolean {
  const resolvedUa =
    ua ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  return TESLA_UA_RE.test(resolvedUa);
}

/**
 * Pure initial touch-environment detector.
 *
 * Policy:
 * - Standard desktop (mouse + keyboard, fine pointer): hidden on boot.
 * - Windows touchscreen laptops (`maxTouchPoints > 0` with `pointer: fine`): hidden on boot
 *   until a real touch event occurs.
 * - Tesla touchscreens (`Tesla/` or `QtCarBrowser` UA): hidden on boot so USB/BT gamepad
 *   players get an unobstructed cockpit, revealing immediately upon first real touch.
 * - Genuine mobile/tablet devices (`(pointer: coarse) and (hover: none)` OR mobile/tablet UA
 *   with `maxTouchPoints > 0`): visible immediately on boot.
 */
export function detectInitialMobileTouch(
  env?: TouchEnvironmentProbe,
): InitialTouchDetection {
  const ua =
    env?.userAgent ??
    (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const maxTouchPoints =
    env?.maxTouchPoints ??
    (typeof navigator !== 'undefined' ? (navigator.maxTouchPoints ?? 0) : 0);
  const isTeslaBrowser = detectTeslaUserAgent(ua);

  let coarseAndNoHover = false;
  if (env?.coarsePointer !== undefined || env?.hoverNone !== undefined) {
    coarseAndNoHover = Boolean(env.coarsePointer) && Boolean(env.hoverNone);
  } else if (env?.matchMedia) {
    coarseAndNoHover = Boolean(env.matchMedia(COARSE_NO_HOVER_QUERY)?.matches);
  } else if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function'
  ) {
    coarseAndNoHover = window.matchMedia(COARSE_NO_HOVER_QUERY).matches;
  }

  const isMobileOrTabletUa = MOBILE_TABLET_UA_RE.test(ua);
  const initialTouch =
    !isTeslaBrowser &&
    (coarseAndNoHover || (isMobileOrTabletUa && maxTouchPoints > 0));

  return {
    touchSensed: initialTouch,
    touchOverlayVisible: initialTouch,
    isTeslaBrowser,
  };
}

/**
 * Tracks live touch-sensing state and overlay visibility across desktop, Windows 2-in-1s,
 * mobile phones/tablets, and Tesla center screens.
 */
export class TouchEnvironmentDetector {
  private _touchSensed: boolean;
  private _touchOverlayVisible: boolean;
  private _isTeslaBrowser: boolean;
  private _forceVisible: boolean | null = null;
  private _lastNonTouchSource: 'keyboard' | 'gamepad' | null = null;

  private listeners = new Set<TouchDetectorListener>();
  private attachedTarget: EventTarget | null = null;
  private onTouchStartBound: EventListener | null = null;
  private onPointerDownBound: EventListener | null = null;
  private mediaQueryList: MediaQueryMatchLike | null = null;
  private onMediaChangeBound: ((ev: { matches: boolean }) => void) | null = null;

  constructor(initialEnv?: TouchEnvironmentProbe) {
    const detected = detectInitialMobileTouch(initialEnv);
    this._touchSensed = detected.touchSensed;
    this._touchOverlayVisible = detected.touchOverlayVisible;
    this._isTeslaBrowser = detected.isTeslaBrowser;
  }

  public get touchSensed(): boolean {
    return this._touchSensed;
  }

  public get touchOverlayVisible(): boolean {
    return this._forceVisible !== null
      ? this._forceVisible
      : this._touchOverlayVisible;
  }

  public get isTeslaBrowser(): boolean {
    return this._isTeslaBrowser;
  }

  public get forceVisible(): boolean | null {
    return this._forceVisible;
  }

  public get lastNonTouchSource(): 'keyboard' | 'gamepad' | null {
    return this._lastNonTouchSource;
  }

  public getState(): TouchDetectorState {
    return {
      touchSensed: this._touchSensed,
      touchOverlayVisible: this.touchOverlayVisible,
      isTeslaBrowser: this._isTeslaBrowser,
      forceVisible: this._forceVisible,
    };
  }

  public setForceVisible(visible: boolean | null): void {
    const prevEffective = this.touchOverlayVisible;
    const prevForce = this._forceVisible;
    this._forceVisible = visible;
    if (
      prevForce !== this._forceVisible ||
      prevEffective !== this.touchOverlayVisible
    ) {
      this.emitChange();
    }
  }

  public notifyTouchInput(): void {
    const prevSensed = this._touchSensed;
    const prevEffective = this.touchOverlayVisible;
    const prevRawVisible = this._touchOverlayVisible;
    this._touchSensed = true;
    this._touchOverlayVisible = true;
    if (
      prevSensed !== this._touchSensed ||
      prevRawVisible !== this._touchOverlayVisible ||
      prevEffective !== this.touchOverlayVisible
    ) {
      this.emitChange();
    }
  }

  public notifyNonTouchInput(source: 'keyboard' | 'gamepad'): void {
    this._lastNonTouchSource = source;
    const prevEffective = this.touchOverlayVisible;
    const prevRawVisible = this._touchOverlayVisible;
    this._touchOverlayVisible = false;
    if (
      prevRawVisible !== this._touchOverlayVisible ||
      prevEffective !== this.touchOverlayVisible
    ) {
      this.emitChange();
    }
  }

  public attach(
    target?: EventTarget | null,
    matchMediaFn?: (query: string) => MediaQueryMatchLike | null,
  ): void {
    this.detach();
    const resolvedTarget =
      target ?? (typeof window !== 'undefined' ? window : null);
    if (!resolvedTarget) {
      return;
    }

    const onTouchStart: EventListener = () => {
      this.notifyTouchInput();
    };

    const onPointerDown: EventListener = (ev: Event) => {
      const pointerEvent = ev as { pointerType?: string };
      if (pointerEvent.pointerType === 'touch') {
        this.notifyTouchInput();
      }
    };

    resolvedTarget.addEventListener('touchstart', onTouchStart, {
      passive: true,
      capture: true,
    });
    resolvedTarget.addEventListener('pointerdown', onPointerDown, {
      passive: true,
      capture: true,
    });

    this.attachedTarget = resolvedTarget;
    this.onTouchStartBound = onTouchStart;
    this.onPointerDownBound = onPointerDown;

    const mm =
      matchMediaFn ??
      (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? (q: string) => window.matchMedia(q)
        : null);

    if (mm) {
      const mql = mm(COARSE_NO_HOVER_QUERY);
      if (mql) {
        const onMediaChange = (ev: { matches: boolean }): void => {
          if (!this._isTeslaBrowser && ev.matches) {
            this.notifyTouchInput();
          }
        };
        if (typeof mql.addEventListener === 'function') {
          mql.addEventListener('change', onMediaChange);
        } else if (typeof mql.addListener === 'function') {
          mql.addListener(onMediaChange);
        }
        this.mediaQueryList = mql;
        this.onMediaChangeBound = onMediaChange;
      }
    }
  }

  public detach(): void {
    if (this.attachedTarget) {
      if (this.onTouchStartBound) {
        this.attachedTarget.removeEventListener(
          'touchstart',
          this.onTouchStartBound,
          { capture: true },
        );
      }
      if (this.onPointerDownBound) {
        this.attachedTarget.removeEventListener(
          'pointerdown',
          this.onPointerDownBound,
          { capture: true },
        );
      }
    }
    this.attachedTarget = null;
    this.onTouchStartBound = null;
    this.onPointerDownBound = null;

    if (this.mediaQueryList && this.onMediaChangeBound) {
      if (typeof this.mediaQueryList.removeEventListener === 'function') {
        this.mediaQueryList.removeEventListener('change', this.onMediaChangeBound);
      } else if (typeof this.mediaQueryList.removeListener === 'function') {
        this.mediaQueryList.removeListener(this.onMediaChangeBound);
      }
    }
    this.mediaQueryList = null;
    this.onMediaChangeBound = null;
  }

  public onChange(cb: TouchDetectorListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emitChange(): void {
    const snap = this.getState();
    for (const listener of this.listeners) {
      listener(snap);
    }
  }
}
