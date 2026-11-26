import type {
  ControllerMenuCommand,
  TouchControlsSnapshot,
  TouchOverlayContext,
  TouchStickVector,
} from '../contracts/input';
import type { PaletteDefinition, RgbaTuple } from '../contracts/render';
import type { InputState, SimPhase } from '../contracts/sim';

export const DEFAULT_STICK_MAX_RADIUS = 44;
export const DEFAULT_FLIGHT_DEADZONE = 0.24;
export const DEFAULT_THRUST_THRESHOLD = 0.38;
export const DEFAULT_MENU_DEADZONE = 0.36;

const MENU_DAS_MS = 320;
const MENU_ARR_MS = 110;
const STYLE_ATTR = 'data-skybreaker-touch-controls-style';
const SVG_NS = 'http://www.w3.org/2000/svg';

export interface StickFlightOptions {
  deadzone?: number;
  thrustThreshold?: number;
}

interface MenuActionDef {
  id: string;
  label: string;
  primary?: boolean;
  command: ControllerMenuCommand;
}

type MenuDirection = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function luma(c: RgbaTuple): number {
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
}

function rgbaCss(c: RgbaTuple, alpha: number): string {
  const r = Math.round(clamp(c[0], 0, 1) * 255);
  const g = Math.round(clamp(c[1], 0, 1) * 255);
  const b = Math.round(clamp(c[2], 0, 1) * 255);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1).toFixed(3)})`;
}

function neutralStick(): TouchStickVector {
  return { x: 0, y: 0, active: false, magnitude: 0 };
}

/**
 * Pure radial stick deflection helper.
 * Clamps `(dx, dy)` smoothly to `maxRadius` and returns normalized coordinates in `[-1, 1]`.
 */
export function computeStickDeflection(
  dx: number,
  dy: number,
  maxRadius = DEFAULT_STICK_MAX_RADIUS,
): TouchStickVector {
  if (
    !Number.isFinite(dx) ||
    !Number.isFinite(dy) ||
    !Number.isFinite(maxRadius) ||
    maxRadius <= 0
  ) {
    return { x: 0, y: 0, active: true, magnitude: 0 };
  }

  const dist = Math.hypot(dx, dy);
  if (dist <= 1e-6) {
    return { x: 0, y: 0, active: true, magnitude: 0 };
  }

  const clampedDist = Math.min(dist, maxRadius);
  const magnitude = clamp(clampedDist / maxRadius, 0, 1);
  const x = clamp((dx / dist) * magnitude, -1, 1);
  const y = clamp((dy / dist) * magnitude, -1, 1);

  return { x, y, active: true, magnitude };
}

/**
 * Pure translation from dual translucent stick vectors + dedicated BOOST hold
 * into the simulation's digital `InputState`.
 *
 * - Horizontal deflection beyond `deadzone` drives `left` / `right`.
 * - Upward deflection (`y < -thrustThreshold`) OR `boostPressed` drives `thrust`.
 * - Holding left stick inside the neutral deadzone (or pulling downward) with
 *   boost & right stick released leaves `thrust = false, fire = false` so the
 *   player's neutral auto-healing triggers cleanly.
 * - Any touch/drag on the right combat stick sets `fire = true`.
 */
export function stickVectorToFlightInput(
  leftStick: TouchStickVector,
  rightStick: TouchStickVector,
  boostPressed: boolean,
  options?: StickFlightOptions,
): InputState {
  const deadzone = options?.deadzone ?? DEFAULT_FLIGHT_DEADZONE;
  const thrustThreshold = options?.thrustThreshold ?? DEFAULT_THRUST_THRESHOLD;

  const left = leftStick.active && leftStick.x < -deadzone;
  const right = leftStick.active && leftStick.x > deadzone;
  const stickThrust = leftStick.active && leftStick.y < -thrustThreshold;
  const thrust = stickThrust || boostPressed;
  const fire = rightStick.active;

  return { left, right, thrust, fire };
}

export function stickVectorToMenuDirection(
  stick: TouchStickVector,
  deadzone = DEFAULT_MENU_DEADZONE,
): MenuDirection | null {
  if (!stick.active || stick.magnitude < deadzone) {
    return null;
  }
  if (Math.abs(stick.x) >= Math.abs(stick.y)) {
    return stick.x < 0 ? 'ArrowLeft' : 'ArrowRight';
  }
  return stick.y < 0 ? 'ArrowUp' : 'ArrowDown';
}

function getMenuActionsForContext(ctx: {
  phase: SimPhase;
  paused: boolean;
  modDeckOpen: boolean;
  paletteStudioOpen: boolean;
}): readonly MenuActionDef[] {
  if (ctx.phase === 'hangar') {
    if (ctx.paletteStudioOpen) {
      return [
        {
          id: 'save',
          label: 'SAVE',
          primary: true,
          command: { kind: 'key', code: 'Enter' },
        },
        {
          id: 'rgb',
          label: 'RGB',
          command: { kind: 'key', code: 'KeyE' },
        },
        {
          id: 'back',
          label: 'BACK',
          command: { kind: 'key', code: 'Escape' },
        },
      ];
    }
    if (ctx.modDeckOpen) {
      return [
        {
          id: 'toggle',
          label: 'TOGGLE',
          primary: true,
          command: { kind: 'key', code: 'Enter' },
        },
        {
          id: 'back',
          label: 'BACK',
          command: { kind: 'key', code: 'Escape' },
        },
      ];
    }
    return [
      {
        id: 'launch',
        label: 'LAUNCH',
        primary: true,
        command: { kind: 'launch' },
      },
      {
        id: 'cycle',
        label: 'CYCLE',
        command: { kind: 'key', code: 'Enter' },
      },
      {
        id: 'mods',
        label: 'MODS',
        command: { kind: 'toggle-mod-deck' },
      },
    ];
  }

  if (ctx.phase === 'gameover') {
    return [
      {
        id: 'relaunch',
        label: 'RELAUNCH',
        primary: true,
        command: { kind: 'relaunch' },
      },
      {
        id: 'hangar',
        label: 'HANGAR',
        command: { kind: 'return-hangar' },
      },
    ];
  }

  // Pause overlay
  return [
    {
      id: 'resume',
      label: 'RESUME',
      primary: true,
      command: { kind: 'pause-toggle' },
    },
    {
      id: 'retry',
      label: 'RETRY',
      command: { kind: 'key', code: 'KeyR' },
    },
    {
      id: 'hangar',
      label: 'HANGAR',
      command: { kind: 'return-hangar' },
    },
  ];
}

function buildOverlayCss(): string {
  return `
.sb-touch-root {
  --sb-ring-bg: rgba(97, 0, 29, 0.15);
  --sb-ring-bg-active: rgba(97, 0, 29, 0.24);
  --sb-ring-border: rgba(97, 0, 29, 0.46);
  --sb-ring-inner: rgba(255, 255, 255, 0.26);
  --sb-puck-bg: rgba(97, 0, 29, 0.34);
  --sb-puck-active: rgba(97, 0, 29, 0.62);
  --sb-puck-border: rgba(255, 255, 255, 0.6);
  --sb-accent: rgba(255, 255, 255, 0.92);
  --sb-accent-soft: rgba(255, 255, 255, 0.32);
  --sb-glow: rgba(255, 255, 255, 0.45);
  --sb-ink: rgba(255, 255, 255, 0.94);
  --sb-ink-shadow: rgba(20, 4, 10, 0.65);
  --sb-stick-size: clamp(108px, 22vmin, 148px);
  --sb-pad-x: calc(18px + max(env(safe-area-inset-left, 0px), env(safe-area-inset-right, 0px)));
  --sb-pad-bottom: calc(18px + env(safe-area-inset-bottom, 0px));
  --sb-pad-top: calc(14px + env(safe-area-inset-top, 0px));
  position: fixed;
  inset: 0;
  z-index: 9000;
  pointer-events: none;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.sb-touch-zone-left {
  position: absolute;
  left: 0;
  bottom: 0;
  width: min(46vw, 290px);
  height: min(50vh, 270px);
  pointer-events: auto;
  touch-action: none;
}

.sb-touch-zone-right {
  position: absolute;
  right: 0;
  bottom: 0;
  width: min(46vw, 290px);
  height: min(50vh, 270px);
  pointer-events: none;
  touch-action: none;
}

.sb-touch-root[data-mode="menu"] .sb-touch-flight-only {
  display: none !important;
}

.sb-touch-root[data-mode="menu"] .sb-touch-zone-left {
  pointer-events: none;
}

.sb-touch-root[data-mode="menu"] .sb-stick-left {
  pointer-events: auto;
}

.sb-touch-root[data-mode="flight"] .sb-touch-menu-only {
  display: none !important;
}

.sb-stick-shell {
  position: absolute;
  width: var(--sb-stick-size);
  height: var(--sb-stick-size);
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, var(--sb-ring-inner), var(--sb-ring-bg) 68%);
  border: 2px solid var(--sb-ring-border);
  box-shadow:
    inset 0 0 0 1px var(--sb-ring-inner),
    0 6px 20px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  touch-action: none;
  transition: transform 140ms cubic-bezier(0.2, 0.9, 0.3, 1.1), border-color 120ms ease, box-shadow 120ms ease;
}

.sb-stick-shell[data-active="true"] {
  background: radial-gradient(circle at 35% 30%, var(--sb-ring-inner), var(--sb-ring-bg-active) 68%);
  border-color: var(--sb-accent);
  box-shadow:
    inset 0 0 14px var(--sb-accent-soft),
    0 0 18px var(--sb-glow);
  transition: border-color 80ms ease, box-shadow 80ms ease;
}

.sb-stick-left {
  left: var(--sb-pad-x);
  bottom: var(--sb-pad-bottom);
  pointer-events: none;
}

.sb-stick-right {
  right: var(--sb-pad-x);
  bottom: var(--sb-pad-bottom);
  pointer-events: auto;
}

.sb-stick-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: visible;
}

.sb-stick-chevron {
  fill: none;
  stroke: var(--sb-ink);
  stroke-opacity: 0.45;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.sb-stick-tick {
  stroke: var(--sb-ink);
  stroke-opacity: 0.25;
  stroke-width: 1.4;
}

.sb-stick-thrust-arc {
  fill: none;
  stroke: var(--sb-accent);
  stroke-width: 4;
  stroke-linecap: round;
  opacity: 0.16;
  transition: opacity 80ms ease, filter 80ms ease;
}

.sb-stick-shell[data-thrust="true"] .sb-stick-thrust-arc {
  opacity: 0.95;
  filter: drop-shadow(0 0 5px var(--sb-glow));
}

.sb-touch-root[data-mode="menu"] .sb-stick-thrust-arc,
.sb-touch-root[data-mode="menu"] .sb-stick-thrust-tag {
  opacity: 0 !important;
}

.sb-stick-fire-ring {
  fill: none;
  stroke: var(--sb-accent);
  stroke-width: 3;
  stroke-dasharray: 8 6;
  opacity: 0.28;
  transition: opacity 80ms ease;
}

.sb-stick-shell[data-active="true"] .sb-stick-fire-ring {
  opacity: 0.95;
}

.sb-stick-tag {
  position: absolute;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.12em;
  color: var(--sb-ink);
  text-shadow: 0 1px 3px var(--sb-ink-shadow), 0 0 6px var(--sb-ink-shadow);
  opacity: 0.85;
  pointer-events: none;
}

.sb-stick-thrust-tag {
  top: 7px;
  left: 50%;
  transform: translateX(-50%);
}

.sb-stick-fire-tag {
  bottom: 9px;
  left: 50%;
  transform: translateX(-50%);
}

.sb-stick-puck {
  width: 44%;
  height: 44%;
  border-radius: 50%;
  background: radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.35), var(--sb-puck-bg) 72%);
  border: 2px solid var(--sb-puck-border);
  box-shadow:
    inset 0 2px 4px rgba(255, 255, 255, 0.3),
    0 3px 10px rgba(0, 0, 0, 0.28);
  pointer-events: none;
  will-change: transform;
  transition: transform 120ms cubic-bezier(0.2, 0.9, 0.3, 1.15), background 100ms ease, box-shadow 100ms ease;
}

.sb-stick-shell[data-active="true"] .sb-stick-puck {
  background: radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.45), var(--sb-puck-active) 72%);
  box-shadow:
    inset 0 2px 5px rgba(255, 255, 255, 0.42),
    0 0 14px var(--sb-glow);
  transition: background 60ms ease, box-shadow 60ms ease;
}

.sb-btn-boost {
  position: absolute;
  right: calc(var(--sb-pad-x) + var(--sb-stick-size) - 6px);
  bottom: calc(var(--sb-pad-bottom) + var(--sb-stick-size) * 0.68);
  width: clamp(54px, 11.5vmin, 70px);
  height: clamp(54px, 11.5vmin, 70px);
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, var(--sb-ring-inner), var(--sb-ring-bg) 72%);
  border: 2px solid var(--sb-ring-border);
  color: var(--sb-ink);
  text-shadow: 0 1px 3px var(--sb-ink-shadow), 0 0 6px var(--sb-ink-shadow);
  font-family: inherit;
  font-size: clamp(9px, 1.9vmin, 11px);
  font-weight: 800;
  letter-spacing: 0.08em;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 0;
  cursor: pointer;
  pointer-events: auto;
  touch-action: none;
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.24);
  transition: transform 80ms ease, border-color 80ms ease, background 80ms ease, box-shadow 80ms ease;
}

.sb-btn-boost[data-pressed="true"] {
  transform: scale(0.93);
  background: radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.35), var(--sb-puck-active) 72%);
  border-color: var(--sb-accent);
  box-shadow: 0 0 16px var(--sb-glow);
}

.sb-btn-pause {
  position: absolute;
  top: var(--sb-pad-top);
  right: var(--sb-pad-x);
  height: 36px;
  padding: 0 13px;
  border-radius: 999px;
  background: var(--sb-ring-bg);
  border: 1.5px solid var(--sb-ring-border);
  color: var(--sb-ink);
  text-shadow: 0 1px 2px var(--sb-ink-shadow);
  font-family: inherit;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.1em;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  pointer-events: auto;
  touch-action: none;
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.22);
}

.sb-btn-pause:active {
  transform: scale(0.95);
  border-color: var(--sb-accent);
  background: var(--sb-puck-active);
}

.sb-menu-cluster {
  position: absolute;
  right: var(--sb-pad-x);
  bottom: var(--sb-pad-bottom);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  pointer-events: none;
}

.sb-menu-row {
  display: flex;
  align-items: center;
  gap: 10px;
  pointer-events: none;
}

.sb-menu-btn {
  width: clamp(60px, 13vmin, 76px);
  height: clamp(60px, 13vmin, 76px);
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, var(--sb-ring-inner), var(--sb-ring-bg) 72%);
  border: 2px solid var(--sb-ring-border);
  color: var(--sb-ink);
  text-shadow: 0 1px 3px var(--sb-ink-shadow), 0 0 6px var(--sb-ink-shadow);
  font-family: inherit;
  font-size: clamp(9px, 1.9vmin, 11px);
  font-weight: 800;
  letter-spacing: 0.08em;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 4px;
  cursor: pointer;
  pointer-events: auto;
  touch-action: none;
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.24);
  transition: transform 80ms ease, border-color 80ms ease, background 80ms ease, box-shadow 80ms ease;
}

.sb-menu-btn[data-primary="true"] {
  width: clamp(76px, 16vmin, 96px);
  height: clamp(76px, 16vmin, 96px);
  background: radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.28), var(--sb-puck-bg) 72%);
  border-color: var(--sb-accent);
  font-size: clamp(10px, 2.2vmin, 12px);
  box-shadow:
    inset 0 0 12px var(--sb-accent-soft),
    0 0 14px var(--sb-glow);
}

.sb-menu-btn:active,
.sb-menu-btn[data-pressed="true"] {
  transform: scale(0.92);
  background: radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.35), var(--sb-puck-active) 72%);
  border-color: var(--sb-accent);
}
`.trim();
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, val] of Object.entries(attrs)) {
    el.setAttribute(key, val);
  }
  return el;
}

function buildLeftStickSvg(): SVGSVGElement {
  const svg = createSvgElement('svg', {
    class: 'sb-stick-svg',
    viewBox: '0 0 120 120',
    'aria-hidden': 'true',
  });

  // Upper THRUST arc indicator
  svg.appendChild(
    createSvgElement('path', {
      class: 'sb-stick-thrust-arc',
      d: 'M 28 24 A 48 48 0 0 1 92 24',
    }),
  );

  // Subtle reticle ticks
  for (const [x1, y1, x2, y2] of [
    ['60', '16', '60', '22'],
    ['60', '98', '60', '104'],
    ['16', '60', '22', '60'],
    ['98', '60', '104', '60'],
  ]) {
    svg.appendChild(
      createSvgElement('line', {
        class: 'sb-stick-tick',
        x1: x1!,
        y1: y1!,
        x2: x2!,
        y2: y2!,
      }),
    );
  }

  // 4-way directional chevrons
  for (const d of [
    'M 54 27 L 60 21 L 66 27', // Up
    'M 54 93 L 60 99 L 66 93', // Down
    'M 27 54 L 21 60 L 27 66', // Left
    'M 93 54 L 99 60 L 93 66', // Right
  ]) {
    svg.appendChild(
      createSvgElement('path', {
        class: 'sb-stick-chevron',
        d,
      }),
    );
  }

  return svg;
}

function buildRightStickSvg(): SVGSVGElement {
  const svg = createSvgElement('svg', {
    class: 'sb-stick-svg',
    viewBox: '0 0 120 120',
    'aria-hidden': 'true',
  });

  // Combat fire halo ring
  svg.appendChild(
    createSvgElement('circle', {
      class: 'sb-stick-fire-ring',
      cx: '60',
      cy: '60',
      r: '48',
    }),
  );

  // Diagonal tactical reticle ticks
  for (const [x1, y1, x2, y2] of [
    ['60', '18', '60', '28'],
    ['60', '92', '60', '102'],
    ['18', '60', '28', '60'],
    ['92', '60', '102', '60'],
  ]) {
    svg.appendChild(
      createSvgElement('line', {
        class: 'sb-stick-tick',
        x1: x1!,
        y1: y1!,
        x2: x2!,
        y2: y2!,
      }),
    );
  }

  return svg;
}

/**
 * Palette-reactive frosted translucent dual game sticks overlay for mobile,
 * tablet, and touchscreen/Tesla play.
 *
 * Strictly hidden (`display: none`, `data-visible="false"`) until `setVisible(true)`.
 */
export class TouchControlsOverlay {
  private visible = false;
  private phase: SimPhase = 'hangar';
  private paused = false;
  private modDeckOpen = false;
  private paletteStudioOpen = false;
  private mode: 'flight' | 'menu' = 'menu';

  private leftStick: TouchStickVector = neutralStick();
  private rightStick: TouchStickVector = neutralStick();
  private boostPressed = false;

  private leftPointerId: number | null = null;
  private rightPointerId: number | null = null;
  private boostPointerId: number | null = null;

  private leftOriginX = 0;
  private leftOriginY = 0;
  private leftMaxRadius = DEFAULT_STICK_MAX_RADIUS;
  private rightOriginX = 0;
  private rightOriginY = 0;
  private rightMaxRadius = DEFAULT_STICK_MAX_RADIUS;

  private pendingCommands: ControllerMenuCommand[] = [];
  private activeMenuDir: MenuDirection | null = null;
  private menuRepeatNextMs = 0;
  private menuActionsKey = '';

  private root: HTMLElement | null = null;
  private leftZone: HTMLElement | null = null;
  private leftShell: HTMLElement | null = null;
  private leftPuck: HTMLElement | null = null;
  private rightShell: HTMLElement | null = null;
  private rightPuck: HTMLElement | null = null;
  private boostBtn: HTMLButtonElement | null = null;
  private pauseBtn: HTMLButtonElement | null = null;
  private menuCluster: HTMLElement | null = null;

  private cleanupFns: Array<() => void> = [];

  constructor(container?: HTMLElement | null) {
    if (typeof document !== 'undefined') {
      this.mountDom(container ?? document.body);
    }
  }

  public setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (!visible) {
      this.resetInputs();
    }
    if (this.root) {
      this.root.setAttribute('data-visible', visible ? 'true' : 'false');
      this.root.style.display = visible ? 'block' : 'none';
    }
  }

  public isVisible(): boolean {
    return this.visible;
  }

  public syncPalette(palette: PaletteDefinition): void {
    if (!this.root) return;

    let darkest: RgbaTuple = palette.colors[1];
    let brightest: RgbaTuple = palette.colors[7];
    let minL = luma(darkest);
    let maxL = luma(brightest);

    for (let i = 1; i <= 7; i++) {
      const c = palette.colors[i]!;
      const l = luma(c);
      if (l < minL) {
        minL = l;
        darkest = c;
      }
      if (l > maxL) {
        maxL = l;
        brightest = c;
      }
    }

    const backIsLight = luma(palette.backcol) >= 0.45;
    const baseColor: RgbaTuple = backIsLight ? darkest : brightest;
    const accentColor: RgbaTuple = maxL >= 0.55 ? brightest : [0.98, 0.96, 0.92, 1];
    const shadowColor: RgbaTuple = minL <= 0.35 ? darkest : [0.06, 0.04, 0.08, 1];

    const s = this.root.style;
    s.setProperty('--sb-ring-bg', rgbaCss(baseColor, backIsLight ? 0.28 : 0.18));
    s.setProperty('--sb-ring-bg-active', rgbaCss(baseColor, backIsLight ? 0.38 : 0.28));
    s.setProperty('--sb-ring-border', rgbaCss(baseColor, backIsLight ? 0.56 : 0.48));
    s.setProperty('--sb-ring-inner', rgbaCss(accentColor, 0.24));
    s.setProperty('--sb-puck-bg', rgbaCss(baseColor, 0.42));
    s.setProperty('--sb-puck-active', rgbaCss(baseColor, 0.68));
    s.setProperty('--sb-puck-border', rgbaCss(accentColor, 0.65));
    s.setProperty('--sb-accent', rgbaCss(accentColor, 0.94));
    s.setProperty('--sb-accent-soft', rgbaCss(accentColor, 0.3));
    s.setProperty('--sb-glow', rgbaCss(accentColor, 0.48));
    s.setProperty('--sb-ink', rgbaCss(accentColor, 0.98));
    s.setProperty('--sb-ink-shadow', rgbaCss(shadowColor, 0.88));
  }

  public updateContext(ctx: TouchOverlayContext): void {
    const nextMode: 'flight' | 'menu' =
      (ctx.phase === 'playing' ||
        ctx.phase === 'launching' ||
        ctx.phase === 'dying') &&
      !ctx.paused
        ? 'flight'
        : 'menu';

    const modeChanged = nextMode !== this.mode;
    this.phase = ctx.phase;
    this.paused = ctx.paused;
    this.modDeckOpen = ctx.modDeckOpen;
    this.paletteStudioOpen = ctx.paletteStudioOpen;
    this.mode = nextMode;

    if (modeChanged) {
      this.resetInputs();
    }

    if (this.root) {
      this.root.setAttribute('data-mode', this.mode);
    }

    this.syncPalette(ctx.palette);
    if (this.mode === 'menu') {
      this.rebuildMenuActionsIfNeeded();
    }
  }

  public getFlightInput(): InputState {
    if (!this.visible || this.mode !== 'flight') {
      return { left: false, right: false, thrust: false, fire: false };
    }
    return stickVectorToFlightInput(
      this.leftStick,
      this.rightStick,
      this.boostPressed,
    );
  }

  public drainCommands(nowMs: number): ControllerMenuCommand[] {
    if (this.visible && this.mode === 'menu') {
      const dir = stickVectorToMenuDirection(this.leftStick);
      if (dir === null) {
        this.activeMenuDir = null;
        this.menuRepeatNextMs = 0;
      } else if (dir !== this.activeMenuDir) {
        this.activeMenuDir = dir;
        this.menuRepeatNextMs = nowMs + MENU_DAS_MS;
        this.pendingCommands.push({ kind: 'key', code: dir });
      } else if (nowMs >= this.menuRepeatNextMs) {
        this.menuRepeatNextMs = nowMs + MENU_ARR_MS;
        this.pendingCommands.push({ kind: 'key', code: dir });
      }
    } else {
      this.activeMenuDir = null;
      this.menuRepeatNextMs = 0;
    }

    if (this.pendingCommands.length === 0) {
      return [];
    }
    const out = this.pendingCommands;
    this.pendingCommands = [];
    return out;
  }

  public pollMenuCommands(nowMs: number): ControllerMenuCommand[] {
    return this.drainCommands(nowMs);
  }

  public getSnapshot(): TouchControlsSnapshot {
    return {
      visible: this.visible,
      mode: this.mode,
      phase: this.phase,
      paused: this.paused,
      flightInput: this.getFlightInput(),
      leftStick: { ...this.leftStick },
      rightStick: { ...this.rightStick },
      boostPressed: this.boostPressed,
    };
  }

  public getElement(): HTMLElement | null {
    return this.root;
  }

  public resetInputs(): void {
    this.leftPointerId = null;
    this.rightPointerId = null;
    this.boostPointerId = null;
    this.leftStick = neutralStick();
    this.rightStick = neutralStick();
    this.boostPressed = false;
    this.activeMenuDir = null;
    this.menuRepeatNextMs = 0;
    if (this.leftShell) {
      this.leftShell.style.transform = '';
    }
    this.renderStickVisuals();
  }

  public dispose(): void {
    this.resetInputs();
    this.pendingCommands = [];
    for (const fn of this.cleanupFns) {
      fn();
    }
    this.cleanupFns = [];

    if (this.root && this.root.parentElement) {
      this.root.parentElement.removeChild(this.root);
    }
    this.root = null;
    this.leftZone = null;
    this.leftShell = null;
    this.leftPuck = null;
    this.rightShell = null;
    this.rightPuck = null;
    this.boostBtn = null;
    this.pauseBtn = null;
    this.menuCluster = null;
  }

  private ensureStylesheet(): void {
    if (typeof document === 'undefined' || !document.head) return;
    if (document.head.querySelector(`style[${STYLE_ATTR}]`)) return;
    const styleEl = document.createElement('style');
    styleEl.setAttribute(STYLE_ATTR, 'true');
    styleEl.textContent = buildOverlayCss();
    document.head.appendChild(styleEl);
  }

  private mountDom(parent: HTMLElement | null): void {
    this.ensureStylesheet();

    const root = document.createElement('div');
    root.className = 'sb-touch-root';
    root.setAttribute('data-testid', 'touch-controls');
    root.setAttribute('data-visible', 'false');
    root.setAttribute('data-mode', this.mode);
    root.setAttribute('aria-label', 'Touch game controls');
    root.style.display = 'none';

    // --- Left Stick Zone (Flight steering/thrust + Menu 4-way navigation) ---
    const leftZone = document.createElement('div');
    leftZone.className = 'sb-touch-zone-left';

    const leftShell = document.createElement('div');
    leftShell.className = 'sb-stick-shell sb-stick-left';
    leftShell.setAttribute('data-testid', 'touch-stick-left');
    leftShell.setAttribute('data-active', 'false');
    leftShell.setAttribute('data-thrust', 'false');

    leftShell.appendChild(buildLeftStickSvg());

    const thrustTag = document.createElement('span');
    thrustTag.className = 'sb-stick-tag sb-stick-thrust-tag';
    thrustTag.textContent = 'THRUST';
    leftShell.appendChild(thrustTag);

    const leftPuck = document.createElement('div');
    leftPuck.className = 'sb-stick-puck';
    leftPuck.setAttribute('data-testid', 'touch-puck-left');
    leftShell.appendChild(leftPuck);

    leftZone.appendChild(leftShell);
    root.appendChild(leftZone);

    // --- Right Flight Zone (Combat Fire Stick + Ergonomic BOOST button) ---
    const rightZone = document.createElement('div');
    rightZone.className = 'sb-touch-zone-right sb-touch-flight-only';

    const boostBtn = document.createElement('button');
    boostBtn.type = 'button';
    boostBtn.className = 'sb-btn-boost';
    boostBtn.setAttribute('data-testid', 'touch-btn-boost');
    boostBtn.setAttribute('data-pressed', 'false');
    boostBtn.setAttribute('aria-label', 'Boost');
    boostBtn.textContent = 'BOOST';
    rightZone.appendChild(boostBtn);

    const rightShell = document.createElement('div');
    rightShell.className = 'sb-stick-shell sb-stick-right';
    rightShell.setAttribute('data-testid', 'touch-stick-right');
    rightShell.setAttribute('data-active', 'false');

    rightShell.appendChild(buildRightStickSvg());

    const fireTag = document.createElement('span');
    fireTag.className = 'sb-stick-tag sb-stick-fire-tag';
    fireTag.textContent = 'FIRE';
    rightShell.appendChild(fireTag);

    const rightPuck = document.createElement('div');
    rightPuck.className = 'sb-stick-puck';
    rightPuck.setAttribute('data-testid', 'touch-puck-right');
    rightShell.appendChild(rightPuck);

    rightZone.appendChild(rightShell);
    root.appendChild(rightZone);

    // --- Top-Right Flight Pause Pill ---
    const pauseBtn = document.createElement('button');
    pauseBtn.type = 'button';
    pauseBtn.className = 'sb-btn-pause sb-touch-flight-only';
    pauseBtn.setAttribute('data-testid', 'touch-btn-pause');
    pauseBtn.setAttribute('aria-label', 'Pause');
    pauseBtn.textContent = '|| PAUSE';
    root.appendChild(pauseBtn);

    // --- Contextual Menu Right Action Cluster ---
    const menuCluster = document.createElement('div');
    menuCluster.className = 'sb-menu-cluster sb-touch-menu-only';
    root.appendChild(menuCluster);

    this.root = root;
    this.leftZone = leftZone;
    this.leftShell = leftShell;
    this.leftPuck = leftPuck;
    this.rightShell = rightShell;
    this.rightPuck = rightPuck;
    this.boostBtn = boostBtn;
    this.pauseBtn = pauseBtn;
    this.menuCluster = menuCluster;

    this.bindEvents();
    this.rebuildMenuActionsIfNeeded();

    if (parent) {
      parent.appendChild(root);
    }
  }

  private bindEvents(): void {
    const addListener = <K extends string>(
      target: EventTarget | null,
      type: K,
      handler: EventListener,
      options?: AddEventListenerOptions,
    ): void => {
      if (!target) return;
      target.addEventListener(type, handler, options);
      this.cleanupFns.push(() => {
        target.removeEventListener(type, handler, options);
      });
    };

    const usePointerEvents =
      typeof window !== 'undefined' && 'PointerEvent' in window;

    // --- Left Stick Handling (Dynamic anchoring in flight, fixed in menu) ---
    const startLeft = (id: number, clientX: number, clientY: number): void => {
      if (this.leftPointerId !== null && this.leftPointerId !== id) return;
      if (!this.leftShell || !this.leftZone) return;

      this.leftPointerId = id;
      this.leftShell.setAttribute('data-active', 'true');
      this.leftShell.style.transform = '';
      const shellRect = this.leftShell.getBoundingClientRect();
      const shellRadius = Math.max(40, (shellRect.width || 120) * 0.5);
      this.leftMaxRadius = Math.max(24, shellRadius * 0.52);

      if (this.mode === 'flight') {
        const zoneRect = this.leftZone.getBoundingClientRect();
        const homeCenterX = shellRect.left + shellRect.width * 0.5;
        const homeCenterY = shellRect.top + shellRect.height * 0.5;
        const pad = shellRadius + 8;
        const clampedX = clamp(
          clientX,
          zoneRect.left + pad,
          Math.max(zoneRect.left + pad, zoneRect.right - pad),
        );
        const clampedY = clamp(
          clientY,
          zoneRect.top + pad,
          Math.max(zoneRect.top + pad, zoneRect.bottom - pad),
        );
        const shiftX = clampedX - homeCenterX;
        const shiftY = clampedY - homeCenterY;
        this.leftOriginX = clampedX;
        this.leftOriginY = clampedY;
        this.leftShell.style.transform = `translate3d(${shiftX.toFixed(1)}px, ${shiftY.toFixed(1)}px, 0)`;
      } else {
        this.leftOriginX = shellRect.left + shellRect.width * 0.5;
        this.leftOriginY = shellRect.top + shellRect.height * 0.5;
      }

      this.leftStick = computeStickDeflection(
        clientX - this.leftOriginX,
        clientY - this.leftOriginY,
        this.leftMaxRadius,
      );
      this.renderStickVisuals();
    };

    const moveLeft = (id: number, clientX: number, clientY: number): void => {
      if (this.leftPointerId !== id) return;
      this.leftStick = computeStickDeflection(
        clientX - this.leftOriginX,
        clientY - this.leftOriginY,
        this.leftMaxRadius,
      );
      this.renderStickVisuals();
    };

    const endLeft = (id: number): void => {
      if (this.leftPointerId !== id) return;
      this.leftPointerId = null;
      this.leftStick = neutralStick();
      if (this.leftShell) {
        this.leftShell.style.transform = '';
      }
      this.renderStickVisuals();
    };

    // --- Right Stick Handling (Fire combat stick) ---
    const startRight = (id: number, clientX: number, clientY: number): void => {
      if (this.rightPointerId !== null && this.rightPointerId !== id) return;
      if (!this.rightShell) return;

      this.rightPointerId = id;
      const rect = this.rightShell.getBoundingClientRect();
      const radius = Math.max(40, (rect.width || 120) * 0.5);
      this.rightOriginX = rect.left + rect.width * 0.5;
      this.rightOriginY = rect.top + rect.height * 0.5;
      this.rightMaxRadius = Math.max(24, radius * 0.52);
      this.rightStick = computeStickDeflection(
        clientX - this.rightOriginX,
        clientY - this.rightOriginY,
        this.rightMaxRadius,
      );
      this.renderStickVisuals();
    };

    const moveRight = (id: number, clientX: number, clientY: number): void => {
      if (this.rightPointerId !== id) return;
      this.rightStick = computeStickDeflection(
        clientX - this.rightOriginX,
        clientY - this.rightOriginY,
        this.rightMaxRadius,
      );
      this.renderStickVisuals();
    };

    const endRight = (id: number): void => {
      if (this.rightPointerId !== id) return;
      this.rightPointerId = null;
      this.rightStick = neutralStick();
      this.renderStickVisuals();
    };

    // --- Dedicated Boost Button ---
    const startBoost = (id: number): void => {
      if (this.boostPointerId !== null && this.boostPointerId !== id) return;
      this.boostPointerId = id;
      this.boostPressed = true;
      this.renderStickVisuals();
    };

    const endBoost = (id: number): void => {
      if (this.boostPointerId !== id) return;
      this.boostPointerId = null;
      this.boostPressed = false;
      this.renderStickVisuals();
    };

    if (usePointerEvents) {
      addListener(
        this.leftZone,
        'pointerdown',
        (ev) => {
          const e = ev as PointerEvent;
          e.preventDefault();
          try {
            this.leftZone?.setPointerCapture?.(e.pointerId);
          } catch {
            // Ignore synthetic pointer capture errors
          }
          startLeft(e.pointerId, e.clientX, e.clientY);
        },
        { passive: false },
      );
      addListener(
        this.leftZone,
        'pointermove',
        (ev) => {
          const e = ev as PointerEvent;
          if (this.leftPointerId !== e.pointerId) return;
          e.preventDefault();
          moveLeft(e.pointerId, e.clientX, e.clientY);
        },
        { passive: false },
      );
      for (const endType of [
        'pointerup',
        'pointercancel',
        'lostpointercapture',
      ] as const) {
        addListener(this.leftZone, endType, (ev) => {
          const e = ev as PointerEvent;
          endLeft(e.pointerId);
        });
      }

      addListener(
        this.rightShell,
        'pointerdown',
        (ev) => {
          const e = ev as PointerEvent;
          e.preventDefault();
          try {
            this.rightShell?.setPointerCapture?.(e.pointerId);
          } catch {
            // Ignore synthetic pointer capture errors
          }
          startRight(e.pointerId, e.clientX, e.clientY);
        },
        { passive: false },
      );
      addListener(
        this.rightShell,
        'pointermove',
        (ev) => {
          const e = ev as PointerEvent;
          if (this.rightPointerId !== e.pointerId) return;
          e.preventDefault();
          moveRight(e.pointerId, e.clientX, e.clientY);
        },
        { passive: false },
      );
      for (const endType of [
        'pointerup',
        'pointercancel',
        'lostpointercapture',
      ] as const) {
        addListener(this.rightShell, endType, (ev) => {
          const e = ev as PointerEvent;
          endRight(e.pointerId);
        });
      }

      addListener(
        this.boostBtn,
        'pointerdown',
        (ev) => {
          const e = ev as PointerEvent;
          e.preventDefault();
          try {
            this.boostBtn?.setPointerCapture?.(e.pointerId);
          } catch {
            // Ignore synthetic pointer capture errors
          }
          startBoost(e.pointerId);
        },
        { passive: false },
      );
      for (const endType of [
        'pointerup',
        'pointercancel',
        'lostpointercapture',
      ] as const) {
        addListener(this.boostBtn, endType, (ev) => {
          const e = ev as PointerEvent;
          endBoost(e.pointerId);
        });
      }

      addListener(
        this.pauseBtn,
        'pointerdown',
        (ev) => {
          ev.preventDefault();
          this.pendingCommands.push({ kind: 'pause-toggle' });
        },
        { passive: false },
      );
    } else {
      // Legacy TouchEvent fallback for older WebKit/embedded car browsers
      addListener(
        this.leftZone,
        'touchstart',
        (ev) => {
          const e = ev as TouchEvent;
          e.preventDefault();
          const t = e.changedTouches[0];
          if (t) startLeft(t.identifier, t.clientX, t.clientY);
        },
        { passive: false },
      );
      addListener(
        this.leftZone,
        'touchmove',
        (ev) => {
          const e = ev as TouchEvent;
          for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i]!;
            if (t.identifier === this.leftPointerId) {
              e.preventDefault();
              moveLeft(t.identifier, t.clientX, t.clientY);
            }
          }
        },
        { passive: false },
      );
      for (const endType of ['touchend', 'touchcancel'] as const) {
        addListener(this.leftZone, endType, (ev) => {
          const e = ev as TouchEvent;
          for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i]!;
            endLeft(t.identifier);
          }
        });
      }

      addListener(
        this.rightShell,
        'touchstart',
        (ev) => {
          const e = ev as TouchEvent;
          e.preventDefault();
          const t = e.changedTouches[0];
          if (t) startRight(t.identifier, t.clientX, t.clientY);
        },
        { passive: false },
      );
      addListener(
        this.rightShell,
        'touchmove',
        (ev) => {
          const e = ev as TouchEvent;
          for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i]!;
            if (t.identifier === this.rightPointerId) {
              e.preventDefault();
              moveRight(t.identifier, t.clientX, t.clientY);
            }
          }
        },
        { passive: false },
      );
      for (const endType of ['touchend', 'touchcancel'] as const) {
        addListener(this.rightShell, endType, (ev) => {
          const e = ev as TouchEvent;
          for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i]!;
            endRight(t.identifier);
          }
        });
      }

      addListener(
        this.boostBtn,
        'touchstart',
        (ev) => {
          const e = ev as TouchEvent;
          e.preventDefault();
          const t = e.changedTouches[0];
          if (t) startBoost(t.identifier);
        },
        { passive: false },
      );
      for (const endType of ['touchend', 'touchcancel'] as const) {
        addListener(this.boostBtn, endType, (ev) => {
          const e = ev as TouchEvent;
          for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i]!;
            endBoost(t.identifier);
          }
        });
      }

      addListener(
        this.pauseBtn,
        'touchstart',
        (ev) => {
          ev.preventDefault();
          this.pendingCommands.push({ kind: 'pause-toggle' });
        },
        { passive: false },
      );
    }

    // Global safety resets so no control can ever stick on app switch or focus loss
    if (typeof window !== 'undefined') {
      addListener(window, 'blur', () => {
        this.resetInputs();
      });
    }
    if (typeof document !== 'undefined') {
      addListener(document, 'visibilitychange', () => {
        if (document.hidden) {
          this.resetInputs();
        }
      });
    }
  }

  private rebuildMenuActionsIfNeeded(): void {
    if (!this.menuCluster) return;

    const key = `${this.phase}:${this.paused ? 1 : 0}:${this.modDeckOpen ? 1 : 0}:${this.paletteStudioOpen ? 1 : 0}`;
    if (key === this.menuActionsKey) return;
    this.menuActionsKey = key;

    this.menuCluster.textContent = '';

    const actions = getMenuActionsForContext({
      phase: this.phase,
      paused: this.paused,
      modDeckOpen: this.modDeckOpen,
      paletteStudioOpen: this.paletteStudioOpen,
    });

    const primary = actions.find((a) => a.primary);
    const secondary = actions.filter((a) => !a.primary);

    const makeBtn = (action: MenuActionDef): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sb-menu-btn';
      btn.setAttribute('data-testid', `touch-action-${action.id}`);
      btn.setAttribute('data-primary', action.primary ? 'true' : 'false');
      btn.setAttribute('aria-label', action.label);
      btn.textContent = action.label;

      const trigger = (ev: Event): void => {
        ev.preventDefault();
        btn.setAttribute('data-pressed', 'true');
        this.pendingCommands.push(action.command);
      };
      const release = (): void => {
        btn.setAttribute('data-pressed', 'false');
      };

      if (typeof window !== 'undefined' && 'PointerEvent' in window) {
        btn.addEventListener('pointerdown', trigger, { passive: false });
        btn.addEventListener('pointerup', release);
        btn.addEventListener('pointercancel', release);
        btn.addEventListener('pointerleave', release);
      } else {
        btn.addEventListener('touchstart', trigger, { passive: false });
        btn.addEventListener('touchend', release);
        btn.addEventListener('touchcancel', release);
      }

      return btn;
    };

    if (secondary.length > 0) {
      const secRow = document.createElement('div');
      secRow.className = 'sb-menu-row';
      for (const act of secondary) {
        secRow.appendChild(makeBtn(act));
      }
      this.menuCluster.appendChild(secRow);
    }

    if (primary) {
      const primRow = document.createElement('div');
      primRow.className = 'sb-menu-row';
      primRow.appendChild(makeBtn(primary));
      this.menuCluster.appendChild(primRow);
    }
  }

  private renderStickVisuals(): void {
    if (this.leftShell && this.leftPuck) {
      const lx = this.leftStick.x * this.leftMaxRadius;
      const ly = this.leftStick.y * this.leftMaxRadius;
      const thrustActive =
        this.mode === 'flight' &&
        this.leftStick.active &&
        this.leftStick.y < -DEFAULT_THRUST_THRESHOLD;

      this.leftShell.setAttribute(
        'data-active',
        this.leftStick.active ? 'true' : 'false',
      );
      this.leftShell.setAttribute('data-thrust', thrustActive ? 'true' : 'false');
      this.leftPuck.style.transform = this.leftStick.active
        ? `translate3d(${lx.toFixed(1)}px, ${ly.toFixed(1)}px, 0)`
        : 'translate3d(0px, 0px, 0)';
    }

    if (this.rightShell && this.rightPuck) {
      const rx = this.rightStick.x * this.rightMaxRadius;
      const ry = this.rightStick.y * this.rightMaxRadius;
      this.rightShell.setAttribute(
        'data-active',
        this.rightStick.active ? 'true' : 'false',
      );
      this.rightPuck.style.transform = this.rightStick.active
        ? `translate3d(${rx.toFixed(1)}px, ${ry.toFixed(1)}px, 0)`
        : 'translate3d(0px, 0px, 0)';
    }

    if (this.boostBtn) {
      this.boostBtn.setAttribute(
        'data-pressed',
        this.boostPressed ? 'true' : 'false',
      );
    }
  }
}
