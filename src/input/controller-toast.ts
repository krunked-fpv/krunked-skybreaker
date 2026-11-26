import type { PaletteDefinition, RgbaTuple } from '../contracts/render';

export const DEFAULT_TOAST_DURATION_MS = 2600;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function luma(c: RgbaTuple): number {
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
}

function rgbaCss(c: RgbaTuple, alpha: number): string {
  const r = Math.round(clamp01(c[0]) * 255);
  const g = Math.round(clamp01(c[1]) * 255);
  const b = Math.round(clamp01(c[2]) * 255);
  return `rgba(${r}, ${g}, ${b}, ${clamp01(alpha).toFixed(3)})`;
}

function pickPaletteToastTheme(palette: PaletteDefinition): {
  bg: string;
  border: string;
  ink: string;
} {
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

  const bg: RgbaTuple = minL < 0.35 ? darkest : [0.06, 0.06, 0.09, 1];
  const ink: RgbaTuple = maxL > 0.55 ? brightest : [0.97, 0.95, 0.89, 1];

  return {
    bg: rgbaCss(bg, 0.82),
    border: rgbaCss(ink, 0.45),
    ink: rgbaCss(ink, 0.96),
  };
}

/**
 * Lightweight ephemeral bottom-center pill shown briefly when a physical
 * controller connects or disconnects. Hidden (`display: none`) by default.
 */
export class ControllerToast {
  private root: HTMLElement | null = null;
  private visible = false;
  private lastMessage = '';
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(container?: HTMLElement | null) {
    if (typeof document !== 'undefined') {
      const el = document.createElement('div');
      el.setAttribute('data-testid', 'controller-toast');
      el.setAttribute('data-visible', 'false');
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');

      el.style.position = 'fixed';
      el.style.left = '50%';
      el.style.bottom = 'calc(18px + env(safe-area-inset-bottom, 0px))';
      el.style.transform = 'translateX(-50%)';
      el.style.zIndex = '9500';
      el.style.display = 'none';
      el.style.pointerEvents = 'none';
      el.style.padding = '7px 14px';
      el.style.borderRadius = '999px';
      el.style.background = 'rgba(14, 10, 14, 0.82)';
      el.style.border = '1px solid rgba(245, 238, 212, 0.44)';
      el.style.color = 'rgba(248, 244, 230, 0.96)';
      el.style.backdropFilter = 'blur(4px)';
      el.style.setProperty('-webkit-backdrop-filter', 'blur(4px)');
      el.style.fontFamily =
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      el.style.fontSize = '12px';
      el.style.fontWeight = '700';
      el.style.letterSpacing = '0.08em';
      el.style.textTransform = 'uppercase';
      el.style.whiteSpace = 'nowrap';
      el.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.35)';
      el.style.userSelect = 'none';
      el.style.setProperty('-webkit-user-select', 'none');

      const parent = container ?? document.body;
      if (parent) {
        parent.appendChild(el);
      }
      this.root = el;
    }
  }

  public show(
    message: string,
    palette?: PaletteDefinition,
    durationMs = DEFAULT_TOAST_DURATION_MS,
  ): void {
    this.clearTimer();
    this.lastMessage = message;
    this.visible = true;

    if (this.root) {
      if (palette) {
        const theme = pickPaletteToastTheme(palette);
        this.root.style.background = theme.bg;
        this.root.style.borderColor = theme.border;
        this.root.style.color = theme.ink;
      }
      this.root.textContent = message;
      this.root.setAttribute('data-visible', 'true');
      this.root.style.display = 'inline-flex';
      this.root.style.alignItems = 'center';
    }

    const safeDuration = Math.max(0, durationMs);
    if (safeDuration > 0) {
      this.hideTimer = setTimeout(() => {
        this.hide();
      }, safeDuration);
    }
  }

  public hide(): void {
    this.clearTimer();
    this.visible = false;
    if (this.root) {
      this.root.setAttribute('data-visible', 'false');
      this.root.style.display = 'none';
    }
  }

  public isVisible(): boolean {
    return this.visible;
  }

  public getLastMessage(): string {
    return this.lastMessage;
  }

  public getElement(): HTMLElement | null {
    return this.root;
  }

  public dispose(): void {
    this.clearTimer();
    this.visible = false;
    if (this.root && this.root.parentElement) {
      this.root.parentElement.removeChild(this.root);
    }
    this.root = null;
  }

  private clearTimer(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }
}
