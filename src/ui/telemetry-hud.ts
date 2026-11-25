import type { AudioSyncMetrics } from '../contracts/audio';
import type { FrameMetrics } from '../contracts/render';
import type { SimSnapshot } from '../contracts/sim';
import type { VaultSource } from '../contracts/vault';

export interface TelemetryData {
  snapshot: SimSnapshot;
  frameMetrics: FrameMetrics;
  vaultSource: VaultSource;
  audioMetrics?: AudioSyncMetrics | null;
  consoleErrorCount?: number;
}

export function formatTelemetryLines(data: TelemetryData): string[] {
  const { snapshot, frameMetrics, vaultSource, audioMetrics, consoleErrorCount } =
    data;
  const p = snapshot.player;
  const speed = Math.hypot(p.vx, p.vy);
  const driftText = audioMetrics
    ? `${audioMetrics.interStemDriftMs.toFixed(3)}ms [${audioMetrics.source}/${audioMetrics.musicState}]`
    : 'n/a';

  return [
    `VAULT: ${vaultSource} | PALETTE: ${frameMetrics.activePaletteId}`,
    `FPS: ${frameMetrics.fps.toFixed(1)} | AVG: ${frameMetrics.avgFrameDeltaMs.toFixed(2)}ms | P95: ${frameMetrics.p95FrameDeltaMs.toFixed(2)}ms | DC: ${frameMetrics.drawCalls} | GLERR: ${frameMetrics.webglErrors}`,
    `SIM: t=${snapshot.tick} phase=${snapshot.phase} mode=${snapshot.mode}${snapshot.paused ? ' [PAUSED]' : ''} craft="${p.planeName}"`,
    `POS: (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) VEL: (${p.vx.toFixed(2)}, ${p.vy.toFixed(2)}) spd=${speed.toFixed(2)} ang=${p.angleDeg.toFixed(1)}deg`,
    `HP: ${p.health.toFixed(1)}/${p.maxHealth} (${((p.health / Math.max(1, p.maxHealth)) * 100).toFixed(0)}%) heal=${p.healing ? 'Y' : 'N'} uw=${p.underwater ? 'Y' : 'N'} sp=${p.inSpace ? 'Y' : 'N'}`,
    `COMBAT: enemies=${snapshot.enemies.length} diff=${snapshot.difficulty.toFixed(0)} score=${snapshot.score} combo=x${snapshot.combo}`,
    `AUDIO DRIFT: ${driftText} | CONSOLE_ERR: ${consoleErrorCount ?? 0}`,
  ];
}

export class TelemetryHud {
  private visible = false;
  private root: HTMLElement | null = null;
  private pre: HTMLElement | null = null;
  private keyListener: ((e: KeyboardEvent) => void) | null = null;
  private keyTarget: EventTarget | null = null;
  private lastLines: string[] = [];

  constructor(container?: HTMLElement | null) {
    if (typeof document !== 'undefined') {
      const el = document.createElement('div');
      el.setAttribute('data-testid', 'telemetry-hud');
      el.style.position = 'fixed';
      el.style.top = '8px';
      el.style.left = '8px';
      el.style.zIndex = '9999';
      el.style.pointerEvents = 'none';
      el.style.display = 'none';
      el.style.padding = '6px 8px';
      el.style.background = 'rgba(10, 10, 14, 0.84)';
      el.style.border = '1px solid rgba(247, 240, 212, 0.45)';
      el.style.color = '#f7f0d4';
      el.style.fontFamily =
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      el.style.fontSize = '11px';
      el.style.lineHeight = '1.35';
      el.style.whiteSpace = 'pre';

      const pre = document.createElement('pre');
      pre.style.margin = '0';
      pre.style.font = 'inherit';
      el.appendChild(pre);

      const parent = container ?? document.body;
      if (parent) {
        parent.appendChild(el);
      }

      this.root = el;
      this.pre = pre;
    }
  }

  public isVisible(): boolean {
    return this.visible;
  }

  public toggle(visible?: boolean): boolean {
    this.visible = visible !== undefined ? visible : !this.visible;
    if (this.root) {
      this.root.style.display = this.visible ? 'block' : 'none';
    }
    return this.visible;
  }

  public bindKeyboardToggle(target?: EventTarget): void {
    this.unbindKeyboardToggle();
    const resolvedTarget =
      target ?? (typeof window !== 'undefined' ? window : null);
    if (!resolvedTarget) return;

    const listener = (event: Event): void => {
      const kb = event as KeyboardEvent;
      if (kb.ctrlKey || kb.metaKey || kb.altKey) return;
      if (kb.code === 'Backquote' || kb.key === '`') {
        this.toggle();
      }
    };
    resolvedTarget.addEventListener('keydown', listener);
    this.keyTarget = resolvedTarget;
    this.keyListener = listener as (e: KeyboardEvent) => void;
  }

  public unbindKeyboardToggle(): void {
    if (this.keyTarget && this.keyListener) {
      this.keyTarget.removeEventListener(
        'keydown',
        this.keyListener as EventListener,
      );
    }
    this.keyTarget = null;
    this.keyListener = null;
  }

  public update(data: TelemetryData): void {
    this.lastLines = formatTelemetryLines(data);
    if (!this.visible || !this.pre) return;
    this.pre.textContent = this.lastLines.join('\n');
  }

  public getLastLines(): readonly string[] {
    return this.lastLines;
  }

  public getElement(): HTMLElement | null {
    return this.root;
  }

  public dispose(): void {
    this.unbindKeyboardToggle();
    if (this.root && this.root.parentElement) {
      this.root.parentElement.removeChild(this.root);
    }
    this.root = null;
    this.pre = null;
  }
}
