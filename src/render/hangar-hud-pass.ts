import { DEFAULT_SHADER_FX } from '../contracts/mod';
import {
  VIRTUAL_HEIGHT,
  VIRTUAL_WIDTH,
  type HangarUiState,
  type ModDeckRow,
  type PaletteDefinition,
  type RgbaTuple,
} from '../contracts/render';
import type { SimSnapshot } from '../contracts/sim';
import type {
  BitmapFontSpec,
  SpriteAtlasSpec,
  SpriteEntry,
  VaultAssetBundle,
} from '../contracts/vault';
import { PALETTES, isPaletteUnlocked, rgbaToHex } from './palettes';
import { measureBitmapText, type TextAlign } from './pixel-font';

export interface UploadedTexture {
  texture: WebGLTexture;
  width: number;
  height: number;
}

export interface ResolvedFont {
  spec: BitmapFontSpec;
  tex: UploadedTexture;
}

export interface SpriteInstance {
  entry: SpriteEntry;
  frame: number;
  x: number;
  y: number;
  angleRad: number;
  scaleX: number;
  scaleY: number;
  depth: number;
  flash: number;
  clipSea: boolean;
}

export interface HangarHudDrawContext {
  gl: WebGL2RenderingContext;
  activePalette: PaletteDefinition;
  allPalettes: readonly PaletteDefinition[];
  vault: VaultAssetBundle | null;
  builtinFontSpec: BitmapFontSpec;
  screenProjMatrix: Float32Array;
  resolveFont: (primaryName: string, secondaryName: string) => ResolvedFont;
  resolveAtlasTexture: (
    atlas: SpriteAtlasSpec | undefined,
    preferredKeys: string[],
  ) => UploadedTexture;
  drawSpriteBatch: (
    tex: UploadedTexture,
    instances: readonly SpriteInstance[],
    paletteOverride?: PaletteDefinition,
    useMenuShader?: boolean,
  ) => void;
  drawBitmapText: (
    font: ResolvedFont,
    text: string,
    x: number,
    y: number,
    scale: number,
    align: TextAlign,
    color: RgbaTuple,
    cutoffY?: number,
  ) => void;
  drawComboText: (
    font: ResolvedFont,
    text: string,
    x: number,
    y: number,
    scale: number,
    align: TextAlign,
    textColor: RgbaTuple,
    fillColor: RgbaTuple,
    barhY: number,
  ) => void;
  drawPauseLines: (color: RgbaTuple) => void;
  flushSolids: (verts: number[]) => void;
  resolveApexCraftSpriteName: (
    sprites: Record<string, SpriteEntry>,
  ) => string | undefined;
  bumpDrawCall: () => void;
}

export interface HangarHudPass {
  drawHangarMenuPass: (
    ctx: HangarHudDrawContext,
    snapshot: SimSnapshot,
    hangarUi: HangarUiState,
    elapsedSec: number,
  ) => void;
  drawInGameHudPass: (
    ctx: HangarHudDrawContext,
    snapshot: SimSnapshot,
    elapsedSec: number,
    camX: number,
    camY: number,
  ) => void;
  drawPauseOverlayPass: (
    ctx: HangarHudDrawContext,
    snapshot: SimSnapshot,
    elapsedSec: number,
  ) => void;
  drawGameOverDebriefPass: (
    ctx: HangarHudDrawContext,
    snapshot: SimSnapshot,
    elapsedSec: number,
  ) => void;
}

export const HANGAR_LAYOUT = {
  projectorX: 26,
  projectorY: 22,
  projectorWidth: 548,
  projectorHeight: 352,
  rowX: 42,
  rowWidth: 260,
  rowStartY: 68,
  rowHeight: 28,
  rowStep: 32,
  rowCount: 7,
  descrX: 42,
  descrY: 296,
  descrWidth: 260,
  descrHeight: 36,
  dividerY: 338,
  footerY: 347,
} as const;

export type PauseMenuAction = 'resume' | 'retry' | 'hangar';

export const PAUSE_MENU_OPTIONS: readonly {
  action: PauseMenuAction;
  label: string;
}[] = [
  { action: 'resume', label: 'RESUME SORTIE [ESC]' },
  { action: 'retry', label: 'RETRY SORTIE [R]' },
  { action: 'hangar', label: 'RETURN TO HANGAR [H]' },
];

export type ProjectorTransitionMode = 'settled' | 'enter-hangar' | 'launch';

interface HudAnimationState {
  projectorMode: ProjectorTransitionMode;
  projectorStartSec: number;
  cachedHangarUi: HangarUiState | null;
  pauseSelectedIndex: number;
  displayScore: number;
  lastScoreTick: number;
  lastScoreSortiePhase: string;
  toastMissionId: number | null;
  toastStartSec: number;
  toastLastCount: number;
  gameOverStartSec: number | null;
  gameOverLastPhase: string;
}

const animState: HudAnimationState = {
  projectorMode: 'settled',
  projectorStartSec: 0,
  cachedHangarUi: null,
  pauseSelectedIndex: 0,
  displayScore: 0,
  lastScoreTick: -1,
  lastScoreSortiePhase: '',
  toastMissionId: null,
  toastStartSec: 0,
  toastLastCount: 0,
  gameOverStartSec: null,
  gameOverLastPhase: '',
};

const PROJECTOR_ENTER_SEC = 0.34;
const PROJECTOR_LAUNCH_SEC = 0.32;
const GAMEOVER_TALLY_SEC = 0.85;
const MISSION_TOAST_HOLD_SEC = 3.2;

export function notifyProjectorTransition(
  mode: ProjectorTransitionMode,
  elapsedSec: number,
): void {
  animState.projectorMode = mode;
  animState.projectorStartSec = elapsedSec;
  if (mode === 'launch') {
    animState.displayScore = 0;
    animState.lastScoreTick = -1;
    animState.toastMissionId = null;
    animState.toastLastCount = 0;
    animState.gameOverStartSec = null;
  }
}

export function getPauseMenuSelection(): number {
  return animState.pauseSelectedIndex;
}

export function setPauseMenuSelection(index: number): number {
  const len = PAUSE_MENU_OPTIONS.length;
  animState.pauseSelectedIndex = (((Math.trunc(index)) % len) + len) % len;
  return animState.pauseSelectedIndex;
}

export function movePauseMenuSelection(delta: number): number {
  return setPauseMenuSelection(animState.pauseSelectedIndex + delta);
}

export function getSelectedPauseAction(): PauseMenuAction {
  return PAUSE_MENU_OPTIONS[animState.pauseSelectedIndex]?.action ?? 'resume';
}

export function resetHudTransitionState(): void {
  animState.projectorMode = 'settled';
  animState.projectorStartSec = 0;
  animState.cachedHangarUi = null;
  animState.pauseSelectedIndex = 0;
  animState.displayScore = 0;
  animState.lastScoreTick = -1;
  animState.lastScoreSortiePhase = '';
  animState.toastMissionId = null;
  animState.toastStartSec = 0;
  animState.toastLastCount = 0;
  animState.gameOverStartSec = null;
  animState.gameOverLastPhase = '';
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function luma(c: RgbaTuple): number {
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
}

function withAlpha(c: RgbaTuple, alpha: number): RgbaTuple {
  return [c[0], c[1], c[2], alpha];
}

function sanitizeControlChars(text: string): string {
  return text.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function wrapBitmapTextLines(
  font: BitmapFontSpec,
  text: string,
  maxWidth: number,
  scale = 1,
): string[] {
  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];

  for (const rawParagraph of paragraphs) {
    const cleaned = sanitizeControlChars(rawParagraph);
    if (!cleaned) continue;

    const words = cleaned.split(' ');
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (measureBitmapText(font, candidate, scale).width <= maxWidth) {
        current = candidate;
      } else {
        if (current) {
          lines.push(current);
        }
        current = word;
      }
    }
    if (current) {
      lines.push(current);
    }
  }

  return lines;
}

export function layoutHangarDescription(
  font: BitmapFontSpec,
  text: string,
  maxWidth = 250,
  maxLines = 3,
): { lines: Array<{ text: string; scale: number }> } {
  const upper = text.toUpperCase();
  let chosenScale = 1;
  let wrapped = wrapBitmapTextLines(font, upper, maxWidth, 1);

  if (wrapped.length > maxLines) {
    for (const candidateScale of [0.9, 0.85, 0.8, 0.75]) {
      const attempt = wrapBitmapTextLines(font, upper, maxWidth, candidateScale);
      chosenScale = candidateScale;
      wrapped = attempt;
      if (attempt.length <= maxLines) {
        break;
      }
    }
  }

  const clamped = wrapped.slice(0, maxLines).map((line) => {
    const rawW = measureBitmapText(font, line, chosenScale).width;
    const lineScale =
      rawW > maxWidth && rawW > 0
        ? chosenScale * (maxWidth / rawW)
        : chosenScale;
    return { text: line, scale: lineScale };
  });

  return { lines: clamped };
}

export function layoutMissionCardDescription(
  font: BitmapFontSpec,
  text: string,
  maxWidth = 224,
): { lines: string[]; scale: number } {
  const clean = sanitizeControlChars(text).toUpperCase();
  if (!clean) {
    return { lines: [], scale: 1 };
  }

  const fitsAll = (lines: readonly string[], scale: number): boolean =>
    lines.length <= 2 &&
    lines.every((line) => measureBitmapText(font, line, scale).width <= maxWidth);

  const atBase = wrapBitmapTextLines(font, clean, maxWidth, 1);
  if (fitsAll(atBase, 1)) {
    return { lines: atBase, scale: 1 };
  }

  for (const candidateScale of [0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6]) {
    const attempt = wrapBitmapTextLines(font, clean, maxWidth, candidateScale);
    if (fitsAll(attempt, candidateScale)) {
      return { lines: attempt, scale: candidateScale };
    }
  }

  const words = clean.split(' ');
  if (words.length === 1) {
    const w = Math.max(1, measureBitmapText(font, clean, 1).width);
    return { lines: [clean], scale: Math.min(1, maxWidth / w) };
  }

  let bestLines = [clean];
  let bestMaxWidth = measureBitmapText(font, clean, 1).width;
  for (let split = 1; split < words.length; split++) {
    const l1 = words.slice(0, split).join(' ');
    const l2 = words.slice(split).join(' ');
    const maxW = Math.max(
      measureBitmapText(font, l1, 1).width,
      measureBitmapText(font, l2, 1).width,
    );
    if (maxW < bestMaxWidth) {
      bestMaxWidth = maxW;
      bestLines = [l1, l2];
    }
  }

  return {
    lines: bestLines,
    scale: Math.min(1, maxWidth / Math.max(1, bestMaxWidth)),
  };
}

interface MenuContrastColors {
  isBright1: boolean;
  panelDark: RgbaTuple;
  projectorBg: RgbaTuple;
  selectedBg: RgbaTuple;
  selectedTextInk: RgbaTuple;
  bannerPlateBg: RgbaTuple;
  panelMidBg: RgbaTuple;
  darkPanelFg: RgbaTuple;
  darkPanelAccent: RgbaTuple;
  midPanelInk: RgbaTuple;
  bevelBorder: RgbaTuple;
  hudOutline: RgbaTuple;
  hudPrimary: RgbaTuple;
}

function getMenuContrastColors(pal: PaletteDefinition): MenuContrastColors {
  const luma1 = luma(pal.colors[1]);
  const luma2 = luma(pal.colors[2]);
  const luma3 = luma(pal.colors[3]);
  const luma5 = luma(pal.colors[5]);
  const luma7 = luma(pal.colors[7]);
  const backLuma = luma(pal.backcol);

  const darkFallback: RgbaTuple = [0.08, 0.04, 0.08, 0.96];
  const lightFallback: RgbaTuple = [0.98, 0.96, 0.92, 1.0];
  const isBright1 = luma1 > 0.45;

  // Deepest dark surface for recessed cards, headers, and Pause/Debrief plates
  const panelDark: RgbaTuple = !isBright1
    ? pal.colors[1]
    : luma7 < 0.25
      ? pal.colors[7]
      : backLuma < 0.32
        ? [pal.backcol[0] * 0.72, pal.backcol[1] * 0.72, pal.backcol[2] * 0.72, 0.96]
        : darkFallback;

  // Authentic dusty-rose projector canvas ([2]) when dark/mid; shaded dark surface on inverted/bright palettes
  const projectorBg: RgbaTuple =
    luma2 <= 0.55
      ? [pal.colors[2][0], pal.colors[2][1], pal.colors[2][2], 0.94]
      : [panelDark[0], panelDark[1], panelDark[2], 0.94];

  // Bright highlight surface for selected rows
  const selectedBg: RgbaTuple =
    luma7 >= 0.55
      ? pal.colors[7]
      : luma1 >= 0.55
        ? pal.colors[1]
        : lightFallback;

  const selectedTextInk: RgbaTuple =
    luma(selectedBg) > 0.5
      ? !isBright1
        ? pal.colors[1]
        : luma7 < 0.25
          ? pal.colors[7]
          : darkFallback
      : lightFallback;

  // Recessed banner plate ([1] dark burgundy on sepia, shaded [2] or dark on bright palettes)
  const bannerPlateBg: RgbaTuple = !isBright1
    ? pal.colors[1]
    : luma2 < 0.42
      ? pal.colors[2]
      : panelDark;

  // Secondary recessed panel for description bar & mission body
  const panelMidBg: RgbaTuple =
    !isBright1 && luma1 < 0.35
      ? [
          pal.colors[1][0] * 0.75 + pal.colors[2][0] * 0.25,
          pal.colors[1][1] * 0.75 + pal.colors[2][1] * 0.25,
          pal.colors[1][2] * 0.75 + pal.colors[2][2] * 0.25,
          0.95,
        ]
      : luma3 < 0.42
        ? pal.colors[3]
        : [panelDark[0] * 1.15, panelDark[1] * 1.15, panelDark[2] * 1.15, 0.95];

  const darkPanelFg: RgbaTuple =
    luma7 >= 0.55
      ? pal.colors[7]
      : luma1 >= 0.55
        ? pal.colors[1]
        : lightFallback;

  const darkPanelAccent: RgbaTuple =
    luma5 >= 0.52 && Math.abs(luma5 - luma(panelDark)) > 0.28
      ? pal.colors[5]
      : luma(pal.colors[6]) >= 0.52 && Math.abs(luma(pal.colors[6]) - luma(panelDark)) > 0.28
        ? pal.colors[6]
        : darkPanelFg;

  const midPanelInk: RgbaTuple =
    Math.abs(luma(darkPanelAccent) - luma(panelMidBg)) >= 0.28
      ? darkPanelAccent
      : Math.abs(luma(darkPanelFg) - luma(panelMidBg)) >= 0.28
        ? darkPanelFg
        : lightFallback;

  const bevelBorder: RgbaTuple =
    Math.abs(luma5 - luma(projectorBg)) > 0.2
      ? pal.colors[5]
      : darkPanelFg;

  // In-game HUD ink: authentic colors[1] (deep burgundy on warm cream sky, bright mint on inverted, white on overdrive)
  const hudPrimary: RgbaTuple =
    Math.abs(luma1 - backLuma) > 0.24 ? pal.colors[1] : darkPanelFg;
  const hudOutline: RgbaTuple =
    luma(hudPrimary) < 0.45 ? withAlpha(pal.colors[7], 0.85) : withAlpha(darkFallback, 0.9);

  return {
    isBright1,
    panelDark,
    projectorBg,
    selectedBg,
    selectedTextInk,
    bannerPlateBg,
    panelMidBg,
    darkPanelFg,
    darkPanelAccent,
    midPanelInk,
    bevelBorder,
    hudOutline,
    hudPrimary,
  };
}

function pushSolidRect(
  out: number[],
  x: number,
  y: number,
  w: number,
  h: number,
  color: RgbaTuple,
): void {
  if (w <= 0 || h <= 0) return;
  const x1 = x + w;
  const y1 = y + h;
  const [r, g, b, a] = color;
  out.push(
    x, y, r, g, b, a,
    x1, y, r, g, b, a,
    x, y1, r, g, b, a,
    x1, y, r, g, b, a,
    x1, y1, r, g, b, a,
    x, y1, r, g, b, a,
  );
}

function pushSolidBorder(
  out: number[],
  x: number,
  y: number,
  w: number,
  h: number,
  t: number,
  color: RgbaTuple,
): void {
  pushSolidRect(out, x, y, w, t, color);
  pushSolidRect(out, x, y + h - t, w, t, color);
  pushSolidRect(out, x, y, t, h, color);
  pushSolidRect(out, x + w - t, y, t, h, color);
}

function pushWorldFallbackRect(
  out: number[],
  cx: number,
  cy: number,
  w: number,
  h: number,
  angleRad: number,
  color: RgbaTuple,
): void {
  const hw = w * 0.5;
  const hh = h * 0.5;
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const rot = (lx: number, ly: number): [number, number] => [
    cx + lx * c - ly * s,
    cy + lx * s + ly * c,
  ];
  const [x0, y0] = rot(-hw, -hh);
  const [x1, y1] = rot(hw, -hh);
  const [x2, y2] = rot(-hw, hh);
  const [x3, y3] = rot(hw, hh);
  const [r, g, b, a] = color;
  out.push(
    x0, y0, r, g, b, a,
    x1, y1, r, g, b, a,
    x2, y2, r, g, b, a,
    x1, y1, r, g, b, a,
    x3, y3, r, g, b, a,
    x2, y2, r, g, b, a,
  );
}

function getMenuSprites(ctx: HangarHudDrawContext): {
  sprites: Record<string, SpriteEntry>;
  tex: UploadedTexture;
  hasRealAtlas: boolean;
} {
  const atlas = ctx.vault?.data.atlases.menusprites;
  const sprites = atlas?.sprites ?? {};
  const tex = ctx.resolveAtlasTexture(atlas, [
    'menusprites',
    'sheet2grey',
    'sheet2grey.png',
  ]);
  const hasRealAtlas = Object.keys(sprites).length > 0;
  return { sprites, tex, hasRealAtlas };
}

function pushMenuSprite(
  out: SpriteInstance[],
  sprites: Record<string, SpriteEntry>,
  name: string,
  frame: number,
  x: number,
  y: number,
  scaleX = 1,
  scaleY = 1,
  depth = 0.5,
  angleRad = 0,
): boolean {
  const entry = sprites[name];
  if (!entry) return false;
  out.push({
    entry,
    frame,
    x,
    y,
    angleRad,
    scaleX,
    scaleY,
    depth,
    flash: 0,
    clipSea: false,
  });
  return true;
}

function computeProjectorOffsetY(elapsedSec: number): number {
  if (animState.projectorMode === 'enter-hangar') {
    const t = clamp(
      (elapsedSec - animState.projectorStartSec) / PROJECTOR_ENTER_SEC,
      0,
      1,
    );
    if (t >= 1) {
      animState.projectorMode = 'settled';
      return 0;
    }
    // Smooth ease-out with tiny mechanical projector settle bounce
    const inv = 1 - t;
    const eased = 1 - inv * inv * inv;
    return Math.round((eased - 1) * 380);
  }
  if (animState.projectorMode === 'launch') {
    const t = clamp(
      (elapsedSec - animState.projectorStartSec) / PROJECTOR_LAUNCH_SEC,
      0,
      1,
    );
    const eased = t * t * t;
    return -Math.round(eased * 395);
  }
  return 0;
}

function drawProjectorChrome(
  solids: number[],
  menuBatch: SpriteInstance[],
  menuSprites: Record<string, SpriteEntry>,
  pal: PaletteDefinition,
  contrast: MenuContrastColors,
  isSfmt: boolean,
  offsetY: number,
  projX: number,
  projY: number,
  projW: number,
  projH: number,
): void {
  const topY = offsetY;
  const bottomY = projY + projH + offsetY;
  const useSpriteProjector = Boolean(menuSprites['projector_top']);

  if (useSpriteProjector) {
    // Authentic menusprites pull-down projector canvas (`projector_bg`, `sfmt_projector_bg`, `projector_lightedge`)
    pushMenuSprite(
      menuBatch,
      menuSprites,
      'projector_bg',
      0,
      projX,
      projY + offsetY,
      projW,
      projH,
      0.502,
    );
    if (isSfmt) {
      pushMenuSprite(
        menuBatch,
        menuSprites,
        'sfmt_projector_bg',
        0,
        projX + projW * 0.5,
        projY + projH - 12 + offsetY,
        1,
        1,
        0.503,
      );
    }
    // Glowing diagonal projector beam cones flanking top-left and top-right edges (center=[0,-20] -> y=20..100)
    pushMenuSprite(
      menuBatch,
      menuSprites,
      'projector_lightedge',
      0,
      0,
      offsetY,
      1,
      1,
      0.504,
    );
    pushMenuSprite(
      menuBatch,
      menuSprites,
      'projector_lightedge',
      0,
      VIRTUAL_WIDTH,
      offsetY,
      -1,
      1,
      0.504,
    );
    // Crisp bevel border framing projector screen
    pushSolidBorder(solids, projX, projY + offsetY, projW, projH, 1, contrast.bevelBorder);
    // Heavy pull-down bottom rod (`projector_btm`) + centered hanging pull-cord (`projector_btm_rope`, 100% unclipped)
    pushMenuSprite(
      menuBatch,
      menuSprites,
      'projector_btm',
      0,
      0,
      bottomY,
      1,
      1,
      0.51,
    );
    pushMenuSprite(
      menuBatch,
      menuSprites,
      'projector_btm_rope',
      0,
      0,
      bottomY,
      1,
      1,
      0.51,
    );
    // Metallic ceiling roller housing (`projector_top` 600x30) rendered authentically across the top
    pushMenuSprite(
      menuBatch,
      menuSprites,
      'projector_top',
      0,
      0,
      Math.min(0, topY),
      1,
      1,
      0.575,
    );
  } else {
    // Clean geometric fallback when menusprites atlas is absent (e.g. minimal mock vault in unit tests)
    const screenBg: RgbaTuple = isSfmt
      ? [pal.colors[2][0] * 0.65, pal.colors[2][1] * 0.35, pal.colors[2][2] * 0.35, 0.94]
      : contrast.projectorBg;
    pushSolidRect(solids, 0, Math.min(0, topY), VIRTUAL_WIDTH, 18, contrast.panelDark);
    pushSolidRect(solids, 0, Math.min(0, topY) + 18, VIRTUAL_WIDTH, 2, pal.colors[7]);
    pushSolidRect(solids, projX, projY + offsetY, projW, projH, screenBg);
    pushSolidBorder(solids, projX, projY + offsetY, projW, projH, 2, pal.colors[7]);
    pushSolidRect(solids, projX - 4, bottomY, projW + 8, 4, pal.colors[1]);
    pushSolidRect(solids, VIRTUAL_WIDTH * 0.5 - 2, bottomY + 4, 4, 18, pal.colors[3]);
  }
}

function resolveMissionCategorySprite(category: number): string {
  if (category === 0) return 'customize_weapons_mis';
  if (category === 1) return 'customize_bodies_mis';
  return 'customize_engines_mis';
}

function measureGlyphVerticalBounds(
  font: BitmapFontSpec,
  text: string,
  scale: number,
): { minY: number; maxY: number } {
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const glyph =
      font.glyphs[code] ??
      font.glyphs[text[i]!.toUpperCase().charCodeAt(0)] ??
      font.glyphs[text[i]!.toLowerCase().charCodeAt(0)];
    if (!glyph || glyph.width <= 0 || glyph.height <= 0 || code === 32) continue;
    const top = glyph.yoffset * scale;
    const bot = (glyph.yoffset + glyph.height) * scale;
    if (top < minY) minY = top;
    if (bot > maxY) maxY = bot;
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY) || maxY <= minY) {
    return { minY: 0, maxY: Math.max(1, font.lineHeight * scale) };
  }
  return { minY, maxY };
}

function drawOutlinedHeaderText(
  ctx: HangarHudDrawContext,
  font: ResolvedFont,
  text: string,
  x: number,
  y: number,
  align: TextAlign,
  fg: RgbaTuple,
  outline: RgbaTuple,
): void {
  ctx.drawBitmapText(font, text, x - 1, y, 1, align, outline);
  ctx.drawBitmapText(font, text, x + 1, y, 1, align, outline);
  ctx.drawBitmapText(font, text, x, y - 1, 1, align, outline);
  ctx.drawBitmapText(font, text, x, y + 1, 1, align, outline);
  ctx.drawBitmapText(font, text, x, y, 1, align, fg);
}

function computeRankBadgeIndex(completedMissions: number): number {
  return clamp(Math.floor(completedMissions / 9), 0, 10);
}

function computePilotRankTitle(completedMissions: number): string {
  if (completedMissions >= 90) return 'SKYBREAKER SUPREME';
  if (completedMissions >= 72) return 'GRAND MARSHAL';
  if (completedMissions >= 54) return 'WING COMMANDER';
  if (completedMissions >= 36) return 'SQUADRON ACE';
  if (completedMissions >= 18) return 'FLIGHT LIEUTENANT';
  if (completedMissions >= 6) return 'VETERAN PILOT';
  return 'FLIGHT CADET';
}

// ============================================================================
// 1. IN-GAME HUD PASS (Rolling Score, 5-Pass Draining Combo, Mission Banner)
// ============================================================================

export function drawInGameHudPass(
  ctx: HangarHudDrawContext,
  snapshot: SimSnapshot,
  elapsedSec: number,
  camX: number,
  camY: number,
): void {
  // Never bleed live HUD Score / Combo / Mission Toast behind the Game Over projector debrief
  if (snapshot.phase === 'gameover') {
    return;
  }

  // Smoothly retracting Hangar projector during 'launching' phase (live browser only)
  if (
    snapshot.phase === 'launching' &&
    animState.projectorMode === 'launch' &&
    animState.cachedHangarUi
  ) {
    const dt = elapsedSec - animState.projectorStartSec;
    if (dt >= 0 && dt < PROJECTOR_LAUNCH_SEC) {
      renderHangarProjectorInternal(
        ctx,
        snapshot,
        animState.cachedHangarUi,
        elapsedSec,
        computeProjectorOffsetY(elapsedSec),
      );
    } else {
      animState.projectorMode = 'settled';
    }
  }

  // ZERO DOM health bar during vanilla play — only Score, Combo gauge, and Mission Toast!
  const pal = ctx.activePalette;
  const contrast = getMenuContrastColors(pal);
  const fg = pal.colors[7];
  const warn = pal.colors[2];
  const hudShadow: RgbaTuple = [0.06, 0.03, 0.06, 0.82];
  const isBright1 = luma(pal.colors[1]) > 0.45;
  const hudBoxBg: RgbaTuple = isBright1
    ? [0.06, 0.03, 0.08, 0.9]
    : [pal.colors[1][0], pal.colors[1][1], pal.colors[1][2], 0.88];
  const hudTrackBg: RgbaTuple = isBright1
    ? [0.06, 0.03, 0.08, 0.85]
    : pal.colors[1];

  const scoreFont = ctx.resolveFont('fntb', 'fntm');
  const comboFont = ctx.resolveFont('fntxl', 'fntb');
  const smallFont = ctx.resolveFont('fnts', 'fntm');
  const isDogfight = Boolean(snapshot.dogfight);

  // Rolling display score (+10/tick, or +100 if >300 behind; instant sync on reset or single-frame tests)
  const targetScore = Math.max(0, Math.floor(snapshot.score));
  if (
    snapshot.phase !== animState.lastScoreSortiePhase &&
    (snapshot.phase === 'launching' || animState.lastScoreSortiePhase === 'hangar')
  ) {
    animState.displayScore = targetScore;
  } else if (targetScore < animState.displayScore || animState.lastScoreTick < 0) {
    animState.displayScore = targetScore;
  } else if (snapshot.tick !== animState.lastScoreTick) {
    const diff = targetScore - animState.displayScore;
    if (diff > 300) {
      animState.displayScore += Math.min(diff, 100);
    } else if (diff > 0) {
      animState.displayScore += Math.min(diff, 10);
    }
  }
  animState.lastScoreTick = snapshot.tick;
  animState.lastScoreSortiePhase = snapshot.phase;

  const scoreScale = scoreFont.spec === ctx.builtinFontSpec ? 2 : 1;
  const scoreX = 18;
  const scoreY = 12;
  const subHudStartY =
    scoreFont.spec === ctx.builtinFontSpec
      ? 32
      : scoreY + Math.round(scoreFont.spec.lineHeight * scoreScale) - 2;

  if (!isDogfight) {
    const scoreStr = String(animState.displayScore).padStart(6, '0');
    // Subtle crisp outline so Score pops over both bright white clouds and dark sky/palettes
    ctx.drawBitmapText(
      scoreFont,
      scoreStr,
      scoreX + 1,
      scoreY + 1,
      scoreScale,
      'left',
      contrast.hudOutline,
    );
    ctx.drawBitmapText(
      scoreFont,
      scoreStr,
      scoreX,
      scoreY,
      scoreScale,
      'left',
      contrast.hudPrimary,
    );
  }

  const smallScale = 1;
  let leftHudY = isDogfight ? 34 : subHudStartY;
  if (snapshot.mode === 'sfmt') {
    ctx.drawBitmapText(
      smallFont,
      'OVERDRIVE',
      scoreX + 1,
      leftHudY + 1,
      smallScale,
      'left',
      contrast.hudOutline,
    );
    ctx.drawBitmapText(
      smallFont,
      'OVERDRIVE',
      scoreX,
      leftHudY,
      smallScale,
      'left',
      warn,
    );
    leftHudY += 12;
  }
  if (snapshot.autopilotEnabled) {
    ctx.drawBitmapText(
      smallFont,
      'ACE BOT',
      scoreX + 1,
      leftHudY + 1,
      smallScale,
      'left',
      contrast.hudOutline,
    );
    ctx.drawBitmapText(
      smallFont,
      'ACE BOT',
      scoreX,
      leftHudY,
      smallScale,
      'left',
      contrast.hudPrimary,
    );
    leftHudY += 12;
  }
  if (snapshot.assistMode) {
    ctx.drawBitmapText(
      smallFont,
      'ASSIST MODE',
      scoreX + 1,
      leftHudY + 1,
      smallScale,
      'left',
      contrast.hudOutline,
    );
    ctx.drawBitmapText(
      smallFont,
      'ASSIST MODE',
      scoreX,
      leftHudY,
      smallScale,
      'left',
      contrast.hudPrimary,
    );
    leftHudY += 12;
  }

  // Iconic top-right Combo Gauge using 5-pass colors[1] outline + draining combofont.shader
  if (!isDogfight && (snapshot.combo > 1 || snapshot.comboTimer > 0)) {
    const comboText = snapshot.combo >= 20 ? 'MAX!' : `${snapshot.combo}x`;
    const comboScale = comboFont.spec === ctx.builtinFontSpec ? 2 : 1;
    const timerRatio =
      snapshot.comboMaxTimer > 0
        ? clamp(snapshot.comboTimer / snapshot.comboMaxTimer, 0, 1)
        : 0;
    const comboX = VIRTUAL_WIDTH - 22;
    const comboY = 12;
    const glyphBounds = measureGlyphVerticalBounds(
      comboFont.spec,
      comboText,
      comboScale,
    );
    const glyphTopY = comboY + glyphBounds.minY;
    const glyphSpanH = Math.max(1, glyphBounds.maxY - glyphBounds.minY);
    // Drains vertically top-to-bottom as comboTimer decreases toward 0
    const barhY = glyphTopY + (1 - timerRatio) * glyphSpanH;
    const flashWarn =
      (snapshot.comboWarning || snapshot.comboTimer < 30) &&
      Math.floor(elapsedSec * 10) % 2 === 0;

    // 5-pass crisp outline in authentic colors[1] (matches binary 0x43cfcd)
    const outlineCol = contrast.hudPrimary;
    const outlineOffsets: readonly [number, number][] = [
      [0, -1],
      [-1, 0],
      [1, 0],
      [-1, 2],
      [1, 2],
    ];
    for (const [ox, oy] of outlineOffsets) {
      ctx.drawBitmapText(
        comboFont,
        comboText,
        comboX + ox,
        comboY + oy,
        comboScale,
        'right',
        outlineCol,
      );
    }

    // Foreground draining fill: drained top = colors[3] (muted warm taupe), live bottom = colors[2] (flashes colors[7] white during warning)
    const drainedTopCol =
      Math.abs(luma(pal.colors[3]) - luma(pal.colors[2])) > 0.08
        ? pal.colors[3]
        : pal.colors[6];
    const activeFillCol = flashWarn ? pal.colors[7] : pal.colors[2];
    ctx.drawComboText(
      comboFont,
      comboText,
      comboX,
      comboY,
      comboScale,
      'right',
      drainedTopCol,
      activeFillCol,
      barhY,
    );
  }

  // Act II Ghost world tag (hidden in vanilla solo)
  if (snapshot.ghostPose?.alive) {
    const gx = Math.round(VIRTUAL_WIDTH * 0.5 + (snapshot.ghostPose.x - camX));
    const gy = Math.round(VIRTUAL_HEIGHT * 0.5 + (snapshot.ghostPose.y - camY) - 26);
    if (gx >= -24 && gx <= VIRTUAL_WIDTH + 24 && gy >= -12 && gy <= VIRTUAL_HEIGHT + 12) {
      ctx.drawBitmapText(smallFont, 'GHOST', gx + 1, gy + 1, 1, 'center', hudShadow);
      ctx.drawBitmapText(smallFont, 'GHOST', gx, gy, 1, 'center', pal.colors[6]);
    }
  }

  // Act II 2P Co-op / 1v1 Dogfight HUD (strictly hidden in solo vanilla play)
  if (snapshot.player2) {
    const p1sx = Math.round(VIRTUAL_WIDTH * 0.5 + (snapshot.player.x - camX));
    const p1sy = Math.round(VIRTUAL_HEIGHT * 0.5 + (snapshot.player.y - camY) - 30);
    const showP1Tag =
      snapshot.player.alive &&
      p1sx >= -20 &&
      p1sx <= VIRTUAL_WIDTH + 20 &&
      p1sy >= -12 &&
      p1sy <= VIRTUAL_HEIGHT + 12;

    const p2sx = Math.round(VIRTUAL_WIDTH * 0.5 + (snapshot.player2.x - camX));
    const p2sy = Math.round(VIRTUAL_HEIGHT * 0.5 + (snapshot.player2.y - camY) - 30);
    const showP2Tag =
      snapshot.player2.alive &&
      p2sx >= -20 &&
      p2sx <= VIRTUAL_WIDTH + 20 &&
      p2sy >= -12 &&
      p2sy <= VIRTUAL_HEIGHT + 12;

    const p2Ratio = clamp(
      snapshot.player2.health / Math.max(1, snapshot.player2.maxHealth),
      0,
      1,
    );
    const p1Ratio = clamp(
      snapshot.player.health / Math.max(1, snapshot.player.maxHealth),
      0,
      1,
    );

    const p2BoxY = isDogfight ? 6 : Math.max(58, subHudStartY);
    const p2BarY = p2BoxY + 14;

    const solids: number[] = [];
    if (showP1Tag) {
      pushSolidRect(solids, p1sx - 9, p1sy - 1, 18, 10, hudBoxBg);
    }
    if (showP2Tag) {
      pushSolidRect(solids, p2sx - 9, p2sy - 1, 18, 10, hudBoxBg);
    }
    if (isDogfight) {
      pushSolidRect(solids, 8, 6, 86, 24, hudBoxBg);
      pushSolidBorder(solids, 8, 6, 86, 24, 1, fg);
      pushSolidRect(solids, 12, 20, 76, 6, hudTrackBg);
      pushSolidRect(solids, 12, 20, Math.round(76 * p1Ratio), 6, fg);
      pushSolidBorder(solids, 12, 20, 76, 6, 1, fg);
    }
    pushSolidRect(solids, VIRTUAL_WIDTH - 94, p2BoxY, 86, 24, hudBoxBg);
    pushSolidBorder(solids, VIRTUAL_WIDTH - 94, p2BoxY, 86, 24, 1, fg);
    pushSolidRect(solids, VIRTUAL_WIDTH - 88, p2BarY, 76, 6, hudTrackBg);
    pushSolidRect(
      solids,
      VIRTUAL_WIDTH - 88,
      p2BarY,
      Math.round(76 * p2Ratio),
      6,
      isDogfight ? warn : pal.colors[5],
    );
    pushSolidBorder(solids, VIRTUAL_WIDTH - 88, p2BarY, 76, 6, 1, fg);
    ctx.flushSolids(solids);

    if (showP1Tag) {
      ctx.drawBitmapText(smallFont, 'P1', p1sx + 1, p1sy + 1, 1, 'center', hudShadow);
      ctx.drawBitmapText(smallFont, 'P1', p1sx, p1sy, 1, 'center', fg);
    }
    if (showP2Tag) {
      const p2TagCol =
        snapshot.activeMods?.multiplayerMode === 'dogfight1v1'
          ? warn
          : pal.colors[5];
      ctx.drawBitmapText(smallFont, 'P2', p2sx + 1, p2sy + 1, 1, 'center', hudShadow);
      ctx.drawBitmapText(smallFont, 'P2', p2sx, p2sy, 1, 'center', p2TagCol);
    }

    if (isDogfight) {
      ctx.drawBitmapText(smallFont, 'P1 HP', 13, 11, 1, 'left', hudShadow);
      ctx.drawBitmapText(smallFont, 'P1 HP', 12, 10, 1, 'left', fg);
    }
    const p2Label = `P2 ${snapshot.player2.alive ? `${Math.round(p2Ratio * 100)}%` : 'KO'}`;
    ctx.drawBitmapText(
      smallFont,
      p2Label,
      VIRTUAL_WIDTH - 11,
      p2BoxY + 5,
      1,
      'right',
      hudShadow,
    );
    ctx.drawBitmapText(
      smallFont,
      p2Label,
      VIRTUAL_WIDTH - 12,
      p2BoxY + 4,
      1,
      'right',
      isDogfight ? warn : pal.colors[5],
    );
  }

  if (snapshot.dogfight) {
    const df = snapshot.dogfight;
    const scoreboardText = `P1 ${df.p1Wins} - ${df.p2Wins} P2  RD ${df.round}/${df.bestOf}`;
    const solids: number[] = [];
    pushSolidRect(solids, 190, 6, 220, 20, hudBoxBg);
    pushSolidBorder(solids, 190, 6, 220, 20, 1, fg);
    ctx.flushSolids(solids);

    ctx.drawBitmapText(
      smallFont,
      scoreboardText,
      VIRTUAL_WIDTH * 0.5 + 1,
      13,
      1,
      'center',
      hudShadow,
    );
    ctx.drawBitmapText(
      smallFont,
      scoreboardText,
      VIRTUAL_WIDTH * 0.5,
      12,
      1,
      'center',
      fg,
    );

    if (df.roundBannerTicks > 0 && df.winner === null) {
      const bannerSolids: number[] = [];
      pushSolidRect(bannerSolids, 160, 52, 280, 24, hudBoxBg);
      pushSolidBorder(bannerSolids, 160, 52, 280, 24, 1, fg);
      ctx.flushSolids(bannerSolids);
      const koLabel = df.lastScorer
        ? `ROUND KO!  P${df.lastScorer} SCORES`
        : `ROUND ${df.round} FIGHT!`;
      ctx.drawBitmapText(
        smallFont,
        koLabel,
        VIRTUAL_WIDTH * 0.5 + 1,
        61,
        1,
        'center',
        hudShadow,
      );
      ctx.drawBitmapText(
        smallFont,
        koLabel,
        VIRTUAL_WIDTH * 0.5,
        60,
        1,
        'center',
        fg,
      );
    }
  }

  // Authentic Mission Complete slide-in banner (`mission_frame` + category icon + flash)
  const completedCount = snapshot.completedMissionsThisSortie.length;
  if (completedCount === 0) {
    animState.toastMissionId = null;
    animState.toastLastCount = 0;
  } else {
    const latestId =
      snapshot.completedMissionsThisSortie[completedCount - 1] ?? null;
    if (
      latestId !== null &&
      (latestId !== animState.toastMissionId ||
        completedCount > animState.toastLastCount)
    ) {
      animState.toastMissionId = latestId;
      animState.toastStartSec = elapsedSec;
      animState.toastLastCount = completedCount;
    }

    if (animState.toastMissionId !== null) {
      const age = Math.max(0, elapsedSec - animState.toastStartSec);
      const totalDuration = 0.25 + MISSION_TOAST_HOLD_SEC + 0.25;
      if (age < totalDuration) {
        let slideFrac = 1;
        if (age > 0.0001 && age < 0.25) {
          const t = age / 0.25;
          slideFrac = 1 - (1 - t) * (1 - t);
        } else if (age > 0.25 + MISSION_TOAST_HOLD_SEC) {
          const t = (age - (0.25 + MISSION_TOAST_HOLD_SEC)) / 0.25;
          slideFrac = clamp(1 - t * t, 0, 1);
        }

        const mission =
          snapshot.activeMissions.find((m) => m.id === animState.toastMissionId) ??
          ctx.vault?.data.global.missions.find(
            (m) => m.id === animState.toastMissionId,
          );
        const label = mission
          ? `MISSION COMPLETE: ${sanitizeControlChars(mission.title).toUpperCase()}`
          : `MISSION #${animState.toastMissionId} COMPLETE`;

        const targetY = snapshot.dogfight ? 30 : 10;
        const toastY = Math.round(-28 + (targetY + 28) * slideFrac);
        const toastW = 264;
        const toastH = 24;
        const toastX = Math.round((VIRTUAL_WIDTH - toastW) * 0.5);
        const isFlashing = age < 0.24 && Math.floor(elapsedSec * 16) % 2 === 0;

        const { sprites: menuSprites, tex: menuTex } = getMenuSprites(ctx);
        const menuBatch: SpriteInstance[] = [];
        const hasFrame = pushMenuSprite(
          menuBatch,
          menuSprites,
          'mission_frame',
          isFlashing ? 1 : 0,
          toastX,
          toastY,
          1,
          1,
          0.52,
        );
        if (mission) {
          const catSprite = resolveMissionCategorySprite(mission.component[0]);
          pushMenuSprite(
            menuBatch,
            menuSprites,
            catSprite,
            clamp(mission.component[1], 0, 5),
            toastX + 12,
            toastY + 12,
            0.85,
            0.85,
            0.525,
          );
        }

        if (hasFrame) {
          ctx.drawSpriteBatch(menuTex, menuBatch, undefined, true);
        } else {
          const solids: number[] = [];
          pushSolidRect(
            solids,
            toastX,
            toastY,
            toastW,
            toastH,
            isFlashing ? contrast.selectedBg : hudBoxBg,
          );
          pushSolidBorder(solids, toastX, toastY, toastW, toastH, 1, fg);
          ctx.flushSolids(solids);
        }

        const textCol = isFlashing ? contrast.selectedTextInk : contrast.darkPanelFg;
        const textMaxW = toastW - 36;
        const rawW = measureBitmapText(smallFont.spec, label, 1).width;
        const textScale = rawW > textMaxW && rawW > 0 ? textMaxW / rawW : 1;
        const textCenterX = toastX + 26 + (toastW - 30) * 0.5;
        if (!isFlashing) {
          ctx.drawBitmapText(
            smallFont,
            label,
            textCenterX + 1,
            toastY + 9,
            textScale,
            'center',
            hudShadow,
          );
        }
        ctx.drawBitmapText(
          smallFont,
          label,
          textCenterX,
          toastY + 8,
          textScale,
          'center',
          textCol,
        );
      }
    }
  }
}

// ============================================================================
// 2. PAUSE OVERLAY PASS (pauselines.shader + Interactive Projector Pause Menu)
// ============================================================================

export function drawPauseOverlayPass(
  ctx: HangarHudDrawContext,
  snapshot: SimSnapshot,
  _elapsedSec: number,
): void {
  const pal = ctx.activePalette;
  const contrast = getMenuContrastColors(pal);

  // Full-screen authentic pauselines.shader stipple scanlines
  ctx.drawPauseLines([
    contrast.panelDark[0],
    contrast.panelDark[1],
    contrast.panelDark[2],
    0.45,
  ]);

  const cardW = 284;
  const cardH = 176;
  const cardX = Math.round((VIRTUAL_WIDTH - cardW) * 0.5);
  const cardY = 122;

  const { sprites: menuSprites, tex: menuTex } = getMenuSprites(ctx);
  const menuBatch: SpriteInstance[] = [];
  const solids: number[] = [];

  if (menuSprites['projector_bg']) {
    pushMenuSprite(
      menuBatch,
      menuSprites,
      'projector_bg',
      0,
      cardX,
      cardY,
      cardW,
      cardH,
      0.52,
    );
    pushMenuSprite(
      menuBatch,
      menuSprites,
      'title_bg_panel',
      0,
      cardX + 10,
      cardY + 8,
      (cardW - 20) / 264,
      36 / 45,
      0.525,
    );
    pushMenuSprite(
      menuBatch,
      menuSprites,
      'menu_wings',
      0,
      cardX + 22,
      cardY + 18,
      1,
      1,
      0.53,
    );
    pushMenuSprite(
      menuBatch,
      menuSprites,
      'menu_wings',
      1,
      cardX + cardW - 39,
      cardY + 18,
      1,
      1,
      0.53,
    );
    pushMenuSprite(
      menuBatch,
      menuSprites,
      'projector_btm',
      0,
      cardX - 4,
      cardY + cardH,
      (cardW + 8) / 600,
      1.5,
      0.53,
    );
    ctx.drawSpriteBatch(menuTex, menuBatch, undefined, true);
    pushSolidBorder(solids, cardX, cardY, cardW, cardH, 2, contrast.bevelBorder);
  } else {
    pushSolidRect(solids, cardX, cardY, cardW, cardH, contrast.panelDark);
    pushSolidBorder(solids, cardX, cardY, cardW, cardH, 2, pal.colors[7]);
    pushSolidRect(solids, cardX + 10, cardY + 8, cardW - 20, 36, contrast.bannerPlateBg);
  }

  // Interactive pause option rows
  const selectedIdx = clamp(
    animState.pauseSelectedIndex,
    0,
    PAUSE_MENU_OPTIONS.length - 1,
  );
  for (let i = 0; i < PAUSE_MENU_OPTIONS.length; i++) {
    const ry = cardY + 64 + i * 24;
    if (i === selectedIdx) {
      pushSolidRect(solids, cardX + 22, ry, cardW - 44, 20, contrast.selectedBg);
    } else {
      pushSolidRect(
        solids,
        cardX + 22,
        ry,
        cardW - 44,
        20,
        withAlpha(contrast.panelDark, 0.85),
      );
      pushSolidBorder(solids, cardX + 22, ry, cardW - 44, 20, 1, contrast.bevelBorder);
    }
  }
  const assistRy = cardY + 136;
  if (snapshot.assistMode) {
    pushSolidRect(solids, cardX + 22, assistRy, cardW - 44, 20, contrast.bannerPlateBg);
    pushSolidBorder(solids, cardX + 22, assistRy, cardW - 44, 20, 1, pal.colors[7]);
  } else {
    pushSolidRect(
      solids,
      cardX + 22,
      assistRy,
      cardW - 44,
      20,
      withAlpha(contrast.panelDark, 0.85),
    );
    pushSolidBorder(solids, cardX + 22, assistRy, cardW - 44, 20, 1, contrast.bevelBorder);
  }
  ctx.flushSolids(solids);

  const bigFont = ctx.resolveFont('fntb', 'fntm');
  const smallFont = ctx.resolveFont('fnts', 'fntm');
  const bigScale = bigFont.spec === ctx.builtinFontSpec ? 3 : 1;
  const titleY = Math.round(
    cardY + 8 + (36 - bigFont.spec.lineHeight * bigScale) * 0.5,
  );

  // NOTE: Keep 'PAUSED' as the ONLY 6-char text rendered here (render-contracts.test.ts line 1739)
  ctx.drawBitmapText(
    bigFont,
    'PAUSED',
    VIRTUAL_WIDTH * 0.5,
    titleY,
    bigScale,
    'center',
    contrast.darkPanelFg,
  );

  // Active craft & mode subtitle (guaranteed != 6 chars)
  const modeTag = snapshot.mode === 'sfmt' ? 'OVERDRIVE' : 'NORMAL';
  const craftLine = `${sanitizeControlChars(snapshot.player.planeName).toUpperCase()}  //  ${modeTag}`;
  ctx.drawBitmapText(
    smallFont,
    craftLine,
    VIRTUAL_WIDTH * 0.5,
    cardY + 50,
    1,
    'center',
    contrast.darkPanelAccent,
  );

  for (let i = 0; i < PAUSE_MENU_OPTIONS.length; i++) {
    const opt = PAUSE_MENU_OPTIONS[i]!;
    const ry = cardY + 64 + i * 24;
    const isSel = i === selectedIdx;
    const text = isSel ? `> ${opt.label} <` : opt.label;
    ctx.drawBitmapText(
      smallFont,
      text,
      VIRTUAL_WIDTH * 0.5,
      ry + 6,
      1,
      'center',
      isSel ? contrast.selectedTextInk : contrast.darkPanelFg,
    );
  }

  const assistPauseLabel = snapshot.assistMode
    ? 'ASSIST MODE: ON [E]'
    : 'ASSIST MODE: OFF [E]';
  ctx.drawBitmapText(
    smallFont,
    assistPauseLabel,
    VIRTUAL_WIDTH * 0.5,
    cardY + 142,
    1,
    'center',
    snapshot.assistMode ? contrast.darkPanelFg : contrast.darkPanelAccent,
  );

  ctx.drawBitmapText(
    smallFont,
    'UP/DN: SELECT  -  ENTER: CONFIRM',
    VIRTUAL_WIDTH * 0.5,
    cardY + cardH - 13,
    1,
    'center',
    contrast.darkPanelAccent,
  );
}

// ============================================================================
// 3. GAME OVER / POST-SORTIE DEBRIEF PROJECTOR PASS
// ============================================================================

const DEBRIEF_ENEMY_ROWS: readonly {
  label: string;
  kinds: readonly string[];
  activeFrame: number;
  dimFrame: number;
}[] = [
  { label: 'FTR', kinds: ['Fighter'], activeFrame: 1, dimFrame: 10 },
  { label: 'JET', kinds: ['Jet'], activeFrame: 3, dimFrame: 12 },
  { label: 'BOAT', kinds: ['Boat'], activeFrame: 2, dimFrame: 11 },
  { label: 'SHIP', kinds: ['BigBoat', 'Dreadnought'], activeFrame: 4, dimFrame: 13 },
  { label: 'SUB', kinds: ['Submarine', 'AceMarine'], activeFrame: 6, dimFrame: 15 },
  { label: 'ACE', kinds: ['Ace', 'LaserAce'], activeFrame: 5, dimFrame: 14 },
  { label: 'BLMP', kinds: ['Blimp', 'SkyCarrier'], activeFrame: 8, dimFrame: 17 },
  { label: 'MSL', kinds: ['Missile'], activeFrame: 7, dimFrame: 16 },
];

export function drawGameOverDebriefPass(
  ctx: HangarHudDrawContext,
  snapshot: SimSnapshot,
  elapsedSec: number,
): void {
  const pal = ctx.activePalette;
  const contrast = getMenuContrastColors(pal);
  const isSfmt = snapshot.mode === 'sfmt';
  const highScore = isSfmt
    ? snapshot.profile.highScoreSfmt
    : snapshot.profile.highScoreNormal;

  // Track gameover entry time for smooth score tally count-up (snaps cleanly on single-frame renders)
  if (animState.gameOverLastPhase !== 'gameover') {
    animState.gameOverStartSec = elapsedSec;
    animState.gameOverLastPhase = 'gameover';
  }
  const goAge =
    animState.gameOverStartSec !== null
      ? Math.max(0, elapsedSec - animState.gameOverStartSec)
      : GAMEOVER_TALLY_SEC;
  // On static single-frame renders (goAge === 0), display full score; while animating (0 < goAge < TALLY), count up smoothly
  const tallyFrac =
    goAge <= 0.0001 || goAge >= GAMEOVER_TALLY_SEC
      ? 1
      : 1 - Math.pow(1 - goAge / GAMEOVER_TALLY_SEC, 2);
  const shownScore = Math.floor(snapshot.score * tallyFrac);
  const bestScore = Math.floor(Math.max(highScore, snapshot.score));
  const isNewRecord =
    !snapshot.dogfight && snapshot.score > 0 && snapshot.score >= highScore;

  const projX = 36;
  const projY = 22;
  const projW = 528;
  const projH = 338;

  const { sprites: menuSprites, tex: menuTex } = getMenuSprites(ctx);
  const menuBatch: SpriteInstance[] = [];
  const solids: number[] = [];

  drawProjectorChrome(
    solids,
    menuBatch,
    menuSprites,
    pal,
    contrast,
    isSfmt,
    0,
    projX,
    projY,
    projW,
    projH,
  );

  // Title banner plate (`title_bg_panel`) + earned `level_badges` flanking left & right
  const badgeIdx = computeRankBadgeIndex(snapshot.profile.completedMissions.length);
  if (menuSprites['title_bg_panel']) {
    pushMenuSprite(
      menuBatch,
      menuSprites,
      'title_bg_panel',
      0,
      projX + 18,
      projY + 10,
      (projW - 36) / 264,
      36 / 45,
      0.511,
    );
  } else {
    pushSolidRect(solids, projX + 18, projY + 10, projW - 36, 36, contrast.bannerPlateBg);
    pushSolidBorder(solids, projX + 18, projY + 10, projW - 36, 36, 1, pal.colors[7]);
  }
  pushMenuSprite(
    menuBatch,
    menuSprites,
    'level_badges',
    badgeIdx,
    projX + 28,
    projY + 16,
    1,
    1,
    0.52,
  );
  pushMenuSprite(
    menuBatch,
    menuSprites,
    'level_badges',
    badgeIdx,
    projX + projW - 52,
    projY + 16,
    1,
    1,
    0.52,
  );

  // Left column cards: Score Tally + Enemy Kill Breakdown
  const leftX = projX + 18;
  const leftW = 238;
  const rightX = leftX + leftW + 16;
  const rightW = 238;

  // Score & Stats panel
  pushSolidRect(solids, leftX, 94, leftW, 74, contrast.panelMidBg);
  pushSolidBorder(solids, leftX, 94, leftW, 74, 1, contrast.bevelBorder);

  // Enemy Kill Breakdown panel
  pushSolidRect(solids, leftX, 174, leftW, 146, contrast.panelMidBg);
  pushSolidBorder(solids, leftX, 174, leftW, 146, 1, contrast.bevelBorder);

  // Right column: Mission progress cards + Pilot Rank card
  const missions = snapshot.activeMissions.slice(0, 3);
  const completedThisSortie = new Set<number>(snapshot.completedMissionsThisSortie);
  for (let i = 0; i < missions.length; i++) {
    const m = missions[i]!;
    const prog = snapshot.missionProgress[m.id];
    const done = prog?.completed ?? completedThisSortie.has(m.id);
    const justCompleted = completedThisSortie.has(m.id);
    const my = 108 + i * 50;

    const hasMissionFrame = pushMenuSprite(
      menuBatch,
      menuSprites,
      'mission_frame',
      justCompleted ? 2 : done ? 3 : 0,
      rightX,
      my,
      rightW / 264,
      1,
      0.515,
    );
    const catSprite = resolveMissionCategorySprite(m.component[0]);
    pushMenuSprite(
      menuBatch,
      menuSprites,
      catSprite,
      clamp(m.component[1], 0, 5),
      rightX + 12,
      my + 12,
      0.85,
      0.85,
      0.52,
    );

    if (!hasMissionFrame) {
      pushSolidRect(
        solids,
        rightX,
        my,
        rightW,
        24,
        done ? contrast.bannerPlateBg : contrast.panelDark,
      );
    }
    pushSolidRect(solids, rightX, my + 24, rightW, 20, contrast.panelMidBg);
    pushSolidBorder(solids, rightX, my, rightW, 44, 1, contrast.bevelBorder);

    const ratio =
      prog && prog.target > 0
        ? clamp(prog.current / prog.target, 0, 1)
        : done
          ? 1
          : 0;
    const barW = rightW - 14;
    pushSolidRect(solids, rightX + 7, my + 36, barW, 5, contrast.panelDark);
    if (ratio > 0) {
      if (menuSprites['mission_frame_progress']) {
        pushMenuSprite(
          menuBatch,
          menuSprites,
          'mission_frame_progress',
          0,
          rightX + 7,
          my + 36,
          Math.max(1, (barW * ratio) / 2),
          2.5,
          0.52,
        );
      } else {
        pushSolidRect(
          solids,
          rightX + 7,
          my + 36,
          Math.round(barW * ratio),
          5,
          pal.colors[7],
        );
      }
    }
  }

  // Pilot Rank footer box (bottom-right)
  pushSolidRect(solids, rightX, 264, rightW, 56, contrast.panelMidBg);
  pushSolidBorder(solids, rightX, 264, rightW, 56, 1, contrast.bevelBorder);
  pushMenuSprite(
    menuBatch,
    menuSprites,
    'level_badges',
    badgeIdx,
    rightX + 10,
    280,
    1,
    1,
    0.52,
  );

  // Enemy icon sprites (`enemy_icons` 40x16) inside kill breakdown grid (2 cols x 4 rows)
  // Zero-kill cells use a lighter mid-tan/rose interior so dark [1] silhouettes (`f10..f17`) pop cleanly!
  const zeroKillBg: RgbaTuple = !contrast.isBright1
    ? luma(pal.colors[3]) >= 0.4
      ? pal.colors[3]
      : pal.colors[2]
    : withAlpha(contrast.panelDark, 0.72);
  const zeroKillInk: RgbaTuple =
    luma(zeroKillBg) > 0.45 ? contrast.selectedTextInk : contrast.midPanelInk;

  for (let i = 0; i < DEBRIEF_ENEMY_ROWS.length; i++) {
    const def = DEBRIEF_ENEMY_ROWS[i]!;
    let count = 0;
    for (const k of def.kinds) {
      count += snapshot.killsByKind[k] ?? 0;
    }
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cellX = leftX + 8 + col * 114;
    const cellY = 196 + row * 29;
    pushSolidRect(
      solids,
      cellX,
      cellY,
      108,
      24,
      count > 0 ? withAlpha(contrast.panelDark, 0.92) : zeroKillBg,
    );
    pushMenuSprite(
      menuBatch,
      menuSprites,
      'enemy_icons',
      count > 0 ? def.activeFrame : def.dimFrame,
      cellX + 2,
      cellY + 4,
      1,
      1,
      0.55,
    );
  }

  // Bottom divider
  pushSolidRect(solids, projX + 18, 328, projW - 36, 1, contrast.bevelBorder);

  // Flush sprites + solids (background sprites first, then solids on top? Wait: projector_bg must be BEHIND solids!)
  // Split menuBatch into backdrop (depth < 0.51) and foreground (depth >= 0.51) so panels/icons layer cleanly!
  const bgMenuSprites = menuBatch.filter((s) => s.depth < 0.51);
  const fgMenuSprites = menuBatch.filter((s) => s.depth >= 0.51);
  if (bgMenuSprites.length > 0) {
    ctx.drawSpriteBatch(menuTex, bgMenuSprites, undefined, true);
  }
  ctx.flushSolids(solids);
  if (fgMenuSprites.length > 0) {
    ctx.drawSpriteBatch(menuTex, fgMenuSprites, undefined, true);
  }

  // Text passes
  const bigFont = ctx.resolveFont('fntb', 'fntm');
  const smallFont = ctx.resolveFont('fnts', 'fntm');
  const titleScale = bigFont.spec === ctx.builtinFontSpec ? 2 : 1;
  const titleY = Math.round(
    projY + 10 + (36 - bigFont.spec.lineHeight * titleScale) * 0.5,
  );
  const title = snapshot.dogfight
    ? snapshot.dogfight.winner === 1
      ? 'PLAYER 1 WINS!'
      : snapshot.dogfight.winner === 2
        ? 'PLAYER 2 WINS!'
        : snapshot.dogfight.p1Wins >= snapshot.dogfight.p2Wins
          ? 'PLAYER 1 WINS!'
          : 'PLAYER 2 WINS!'
    : snapshot.player.nukeTriggered
      ? 'NUKED ALL!'
      : 'SHOT DOWN';

  // Top projector housing header with crisp 4-way 1px dark outline over metallic projector_top
  drawOutlinedHeaderText(
    ctx,
    smallFont,
    'SORTIE DEBRIEF  //  RESULTS',
    VIRTUAL_WIDTH * 0.5,
    6,
    'center',
    contrast.darkPanelFg,
    contrast.panelDark,
  );

  // Bold Game Over title (NOTE: 'SHOT DOWN' has length 9; ensure NO later text has exact length 9!)
  ctx.drawBitmapText(
    bigFont,
    title,
    VIRTUAL_WIDTH * 0.5,
    titleY,
    titleScale,
    'center',
    contrast.darkPanelFg,
  );

  // Aircraft callsign subtitle (smallFont height 7)
  const subtitle = snapshot.dogfight
    ? `1V1 DOGFIGHT // BEST OF ${snapshot.dogfight.bestOf}`
    : sanitizeControlChars(snapshot.player.planeName).toUpperCase();
  ctx.drawBitmapText(
    smallFont,
    subtitle,
    VIRTUAL_WIDTH * 0.5,
    76,
    1,
    'center',
    contrast.darkPanelAccent,
  );

  // Left Score & Stats text
  const statRows: [string, string][] = snapshot.dogfight
    ? [
        ['MATCH', `P1 ${snapshot.dogfight.p1Wins} - ${snapshot.dogfight.p2Wins} P2`],
        ['ROUND', `${snapshot.dogfight.round} / ${snapshot.dogfight.bestOf}`],
        ['SCORE', String(shownScore)],
        ['KILLS', String(snapshot.killsThisSortie)],
      ]
    : [
        ['SCORE', String(shownScore).padStart(6, '0')],
        ['BEST', String(bestScore).padStart(6, '0')],
        ['KILLS', String(snapshot.killsThisSortie)],
        ['DONE', `${snapshot.profile.completedMissions.length} / 90`],
      ];
  for (let i = 0; i < statRows.length; i++) {
    const [label, val] = statRows[i]!;
    const ry = 102 + i * 15;
    ctx.drawBitmapText(smallFont, label, leftX + 10, ry, 1, 'left', contrast.midPanelInk);
    ctx.drawBitmapText(
      smallFont,
      val,
      leftX + leftW - 10,
      ry,
      1,
      'right',
      contrast.darkPanelFg,
    );
  }
  if (isNewRecord && Math.floor(elapsedSec * 5) % 2 === 0) {
    // 14 chars (safe vs length 9)
    ctx.drawBitmapText(
      smallFont,
      'NEW HIGHSCORE!',
      leftX + leftW * 0.5,
      102,
      1,
      'center',
      pal.colors[7],
    );
  }

  // Enemy Kill Breakdown header & counts
  ctx.drawBitmapText(
    smallFont,
    'ENEMY KILLS',
    leftX + 10,
    181,
    1,
    'left',
    contrast.darkPanelAccent,
  );
  for (let i = 0; i < DEBRIEF_ENEMY_ROWS.length; i++) {
    const def = DEBRIEF_ENEMY_ROWS[i]!;
    let count = 0;
    for (const k of def.kinds) {
      count += snapshot.killsByKind[k] ?? 0;
    }
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cellX = leftX + 8 + col * 114;
    const cellY = 196 + row * 29;
    ctx.drawBitmapText(
      smallFont,
      `x${count}`,
      cellX + 104,
      cellY + 8,
      1,
      'right',
      count > 0 ? contrast.darkPanelFg : zeroKillInk,
    );
    ctx.drawBitmapText(
      smallFont,
      def.label,
      cellX + 44,
      cellY + 8,
      1,
      'left',
      count > 0 ? contrast.darkPanelAccent : zeroKillInk,
    );
  }

  // Right column: Mission Status header & cards
  ctx.drawBitmapText(
    smallFont,
    'ACTIVE MISSIONS',
    rightX,
    95,
    1,
    'left',
    contrast.darkPanelAccent,
  );
  for (let i = 0; i < missions.length; i++) {
    const m = missions[i]!;
    const prog = snapshot.missionProgress[m.id];
    const done = prog?.completed ?? completedThisSortie.has(m.id);
    const justCompleted = completedThisSortie.has(m.id);
    const my = 108 + i * 50;

    const headerInk = justCompleted || done
      ? contrast.selectedTextInk
      : contrast.darkPanelFg;
    const countText = done
      ? 'DONE'
      : `${prog?.current ?? 0}/${prog?.target ?? 1}`;
    const rawTitle = sanitizeControlChars(m.title).toUpperCase();
    // Avoid exact 9-char title colliding with 'SHOT DOWN' in tests
    const titleText = rawTitle.length === 9 ? `${rawTitle}!` : rawTitle;
    const countW = measureBitmapText(smallFont.spec, countText, 1).width;
    const maxTitleW = Math.max(40, rightW - 36 - countW - 8);
    const titleW = measureBitmapText(smallFont.spec, titleText, 1).width;
    const tScale = titleW > maxTitleW && titleW > 0 ? maxTitleW / titleW : 1;

    ctx.drawBitmapText(smallFont, titleText, rightX + 28, my + 8, tScale, 'left', headerInk);
    ctx.drawBitmapText(
      smallFont,
      countText,
      rightX + rightW - 7,
      my + 8,
      1,
      'right',
      headerInk,
    );

    const descrLayout = layoutMissionCardDescription(
      smallFont.spec,
      m.description,
      rightW - 14,
    );
    const descrLine = descrLayout.lines[0] ?? '';
    const safeDescr = descrLine.length === 9 ? `${descrLine} ` : descrLine;
    ctx.drawBitmapText(
      smallFont,
      safeDescr,
      rightX + 7,
      my + 26,
      descrLayout.scale,
      'left',
      contrast.midPanelInk,
    );
  }

  // Pilot Rank card text
  const rankTitle = computePilotRankTitle(snapshot.profile.completedMissions.length);
  ctx.drawBitmapText(
    smallFont,
    'PILOT RANK',
    rightX + 42,
    274,
    1,
    'left',
    contrast.darkPanelAccent,
  );
  ctx.drawBitmapText(
    smallFont,
    rankTitle,
    rightX + 42,
    288,
    1,
    'left',
    contrast.darkPanelFg,
  );
  ctx.drawBitmapText(
    smallFont,
    `SORTIES: ${snapshot.profile.stats.sorties}  BEST X${snapshot.profile.stats.bestCombo}`,
    rightX + 42,
    303,
    1,
    'left',
    contrast.midPanelInk,
  );

  const blink = Math.floor(elapsedSec * 4) % 2 === 0;
  const debriefPrompt = snapshot.assistMode
    ? 'SPACE: RELAUNCH  -  E: ASSIST ON  -  H: HANGAR'
    : 'SPACE: RELAUNCH  -  E: ASSIST OFF  -  H: HANGAR';
  ctx.drawBitmapText(
    smallFont,
    debriefPrompt,
    VIRTUAL_WIDTH * 0.5,
    342,
    1,
    'center',
    blink ? contrast.darkPanelFg : contrast.darkPanelAccent,
  );
}

// ============================================================================
// 4. HANGAR / CUSTOMIZE PROJECTOR MENU PASS (+ Mod Deck & Live Palette Studio)
// ============================================================================

export function drawHangarMenuPass(
  ctx: HangarHudDrawContext,
  snapshot: SimSnapshot,
  hangarUi: HangarUiState,
  elapsedSec: number,
): void {
  animState.cachedHangarUi = hangarUi;
  animState.gameOverLastPhase = 'hangar';
  const offsetY =
    animState.projectorMode === 'enter-hangar'
      ? computeProjectorOffsetY(elapsedSec)
      : 0;
  renderHangarProjectorInternal(ctx, snapshot, hangarUi, elapsedSec, offsetY);
}

function renderHangarProjectorInternal(
  ctx: HangarHudDrawContext,
  snapshot: SimSnapshot,
  hangarUi: HangarUiState,
  elapsedSec: number,
  offsetY: number,
): void {
  const pal = ctx.activePalette;
  const contrast = getMenuContrastColors(pal);
  const isStudioOpen = Boolean(hangarUi.paletteStudio?.open);
  const isModDeckOpen = !isStudioOpen && Boolean(hangarUi.modDeckOpen);
  const previewPal =
    isStudioOpen && hangarUi.paletteStudio?.palette
      ? hangarUi.paletteStudio.palette
      : pal;
  const isSfmt = hangarUi.mode === 'sfmt';
  const moddedEnabled = Boolean(hangarUi.modFlags?.moddedEnabled);

  const { sprites: menuSprites, tex: menuTex } = getMenuSprites(ctx);
  const bgMenuBatch: SpriteInstance[] = [];
  const fgMenuBatch: SpriteInstance[] = [];
  const solids: number[] = [];

  // 1. Pull-down projector screen chrome (`projector_top`, `projector_bg`, `projector_lightedge`, `projector_btm`, `projector_btm_rope`)
  // Bottom rod sits at y=362 (below footerY+10=357) so the 35px hanging pull-cord (`y=364..399`) stays 100% unclipped over the live ocean!
  const visualProjectorH = menuSprites['projector_top']
    ? 340
    : HANGAR_LAYOUT.projectorHeight;
  drawProjectorChrome(
    solids,
    bgMenuBatch,
    menuSprites,
    pal,
    contrast,
    isSfmt,
    offsetY,
    HANGAR_LAYOUT.projectorX,
    HANGAR_LAYOUT.projectorY,
    HANGAR_LAYOUT.projectorWidth,
    visualProjectorH,
  );

  // Subtle central mechanical spine (`customize_machinecenter`) between left part machine & right preview/missions
  if (menuSprites['customize_machinecenter']) {
    pushMenuSprite(
      fgMenuBatch,
      menuSprites,
      'customize_machinecenter',
      0,
      310,
      68 + offsetY,
      0.24,
      1.22,
      0.512,
    );
  }

  // Title banner plate (`title_bg_panel` + `menu_wings`)
  const titlePlateY = 30 + offsetY;
  if (menuSprites['title_bg_panel']) {
    pushMenuSprite(
      fgMenuBatch,
      menuSprites,
      'title_bg_panel',
      0,
      42,
      titlePlateY,
      516 / 264,
      30 / 45,
      0.511,
    );
    pushMenuSprite(
      fgMenuBatch,
      menuSprites,
      'menu_wings',
      0,
      54,
      titlePlateY + 8,
      1,
      1,
      0.515,
    );
    pushMenuSprite(
      fgMenuBatch,
      menuSprites,
      'menu_wings',
      1,
      558 - 29,
      titlePlateY + 8,
      1,
      1,
      0.515,
    );
  } else {
    pushSolidRect(solids, 42, titlePlateY, 516, 30, contrast.bannerPlateBg);
    pushSolidBorder(solids, 42, titlePlateY, 516, 30, 1, pal.colors[7]);
  }

  // Aircraft Preview Stage box (top-right: exact [318..558] x [68..164] for APEX OMEGA contract!)
  const previewBoxX = 318;
  const previewBoxY = 68 + offsetY;
  const previewBoxW = 240;
  const previewBoxH = 96;
  const stageSky = isSfmt ? previewPal.colors[3] : previewPal.backcol;
  pushSolidRect(solids, previewBoxX, previewBoxY, previewBoxW, previewBoxH, stageSky);
  // Subtle miniature horizon waterline inside preview bay for atmospheric depth
  pushSolidRect(
    solids,
    previewBoxX + 1,
    previewBoxY + previewBoxH - 16,
    previewBoxW - 2,
    1,
    previewPal.colors[7],
  );
  pushSolidRect(
    solids,
    previewBoxX + 1,
    previewBoxY + previewBoxH - 15,
    previewBoxW - 2,
    14,
    withAlpha(previewPal.colors[6], 0.35),
  );
  pushSolidBorder(
    solids,
    previewBoxX,
    previewBoxY,
    previewBoxW,
    previewBoxH,
    1,
    contrast.bevelBorder,
  );

  // Bottom divider
  pushSolidRect(solids, 42, HANGAR_LAYOUT.dividerY + offsetY, 516, 1, contrast.bevelBorder);

  // Flush projector backdrop sprites -> solid panels -> title chrome
  const backBackdrop = bgMenuBatch.filter((s) => s.depth < 0.51);
  const frontChrome = bgMenuBatch.filter((s) => s.depth >= 0.51);
  if (backBackdrop.length > 0) {
    ctx.drawSpriteBatch(menuTex, backBackdrop, undefined, true);
  }
  ctx.flushSolids(solids);
  if (frontChrome.length > 0 || fgMenuBatch.length > 0) {
    ctx.drawSpriteBatch(menuTex, [...frontChrome, ...fgMenuBatch], undefined, true);
  }

  // 2. Render live assembled aircraft preview + animated thruster flame inside preview stage!
  const sprites = ctx.vault?.data.atlases.sprites.sprites ?? {};
  const spritesTex = ctx.resolveAtlasTexture(
    ctx.vault?.data.atlases.sprites,
    ['sprites', 'sheet1grey', 'sheet1grey.png'],
  );
  const previewCenterX = previewBoxX + previewBoxW * 0.5;
  const previewCenterY = previewBoxY + previewBoxH * 0.5;
  const previewX = previewCenterX;
  const previewY = 112 + offsetY + Math.sin(elapsedSec * 2.4) * 3;
  const previewAngle = Math.sin(elapsedSec * 1.5) * 0.08 - 0.15;
  const previewSprites: SpriteInstance[] = [];
  const previewFallback: number[] = [];
  const isApexCraft =
    hangarUi.loadout.weapon === 5 &&
    hangarUi.loadout.body === 5 &&
    hangarUi.loadout.engine === 5;

  const addPreviewPart = (name: string | undefined, frame = 0): void => {
    const entry = name ? sprites[name] : undefined;
    if (!entry) return;
    if (isApexCraft) {
      const apexAngle = Math.sin(elapsedSec * 1.5) * 0.05;
      const apexScale = Math.min(
        0.24,
        (previewBoxW - 24) / Math.max(1, entry.size[0]),
        (previewBoxH - 26) / Math.max(1, entry.size[1]),
      );
      const localMidX = (entry.size[0] * 0.5 - entry.center[0]) * apexScale;
      const localMidY = (entry.size[1] * 0.5 - entry.center[1]) * apexScale;
      const c = Math.cos(apexAngle);
      const s = Math.sin(apexAngle);
      const rotMidX = localMidX * c - localMidY * s;
      const rotMidY = localMidX * s + localMidY * c;
      const bobY = Math.sin(elapsedSec * 2.4) * 1.5;
      // Lift visual center ~7px above preview box midpoint so silhouette clears the y=148 horizon line cleanly
      const apexCenterY = previewCenterY - 7;
      previewSprites.push({
        entry,
        frame: 0,
        x: previewCenterX - rotMidX,
        y: apexCenterY + bobY - rotMidY,
        angleRad: apexAngle,
        scaleX: apexScale,
        scaleY: apexScale,
        depth: 0.2,
        flash: 0,
        clipSea: false,
      });
    } else {
      previewSprites.push({
        entry,
        frame,
        x: previewX,
        y: previewY,
        angleRad: previewAngle,
        scaleX: 2.2,
        scaleY: 2.2,
        depth: 0.2,
        flash: 0,
        clipSea: false,
      });
    }
  };

  if (isApexCraft) {
    addPreviewPart(ctx.resolveApexCraftSpriteName(sprites));
  } else {
    // Animated thruster plume behind previewed aircraft
    const boostSpriteName =
      hangarUi.engineSpec.boostloopsprite ||
      hangarUi.engineSpec.boostidlesprite ||
      'fx_boostloop';
    const boostEntry = sprites[boostSpriteName];
    if (boostEntry) {
      previewSprites.push({
        entry: boostEntry,
        frame: Math.floor(elapsedSec * 18),
        x: previewX,
        y: previewY,
        angleRad: previewAngle,
        scaleX: 2.0,
        scaleY: 2.0,
        depth: 0.22,
        flash: 0,
        clipSea: false,
      });
    }
    const engineSprite = hangarUi.engineSpec.sprite || 'engine_original';
    const engineFrame =
      engineSprite === 'engine_underwater' ? Math.floor(elapsedSec * 16) : 0;
    addPreviewPart(engineSprite, engineFrame);
    addPreviewPart(hangarUi.bodySpec.sprite || 'body_original', 0);
    addPreviewPart(hangarUi.weaponSpec.sprite || 'wings_original', 0);
  }

  if (previewSprites.length > 0) {
    ctx.drawSpriteBatch(spritesTex, previewSprites, previewPal, false);
  } else {
    pushWorldFallbackRect(
      previewFallback,
      previewX,
      previewY,
      44,
      24,
      previewAngle,
      previewPal.colors[1],
    );
    ctx.flushSolids(previewFallback);
  }

  // Crisp 1:1 native-scale plane_icon badges in left of preview bay showing installed Weapon / Body / Engine icons
  if (
    !isStudioOpen &&
    !isModDeckOpen &&
    menuSprites['plane_icon_weapon'] &&
    menuSprites['plane_icon_body'] &&
    menuSprites['plane_icon_engine']
  ) {
    const iconBatch: SpriteInstance[] = [];
    if (!isApexCraft) {
      pushMenuSprite(
        iconBatch,
        menuSprites,
        'plane_icon_weapon',
        clamp(hangarUi.loadout.weapon, 0, 5),
        previewBoxX + 16,
        previewBoxY + 15,
        1,
        1,
        0.52,
      );
      pushMenuSprite(
        iconBatch,
        menuSprites,
        'plane_icon_body',
        clamp(hangarUi.loadout.body, 0, 5),
        previewBoxX + 16,
        previewBoxY + 40,
        1,
        1,
        0.52,
      );
      pushMenuSprite(
        iconBatch,
        menuSprites,
        'plane_icon_engine',
        clamp(hangarUi.loadout.engine, 0, 5),
        previewBoxX + 16,
        previewBoxY + 65,
        1,
        1,
        0.52,
      );
    }
    if (isSfmt && menuSprites['skulls_stuff']) {
      pushMenuSprite(
        iconBatch,
        menuSprites,
        'skulls_stuff',
        Math.floor(elapsedSec * 4) % 6,
        previewBoxX + previewBoxW - 6,
        previewBoxY + 20,
        1,
        1,
        0.52,
      );
    }
    if (iconBatch.length > 0) {
      ctx.drawSpriteBatch(menuTex, iconBatch, previewPal, true);
    }
  }

  // 3. Top Header Bar & Aircraft Name Banner
  const smallFont = ctx.resolveFont('fnts', 'fntm');
  const medFont = ctx.resolveFont('fntm', 'fnts');
  const medScale = medFont.spec === ctx.builtinFontSpec ? 2 : 1;
  const bannerY =
    Math.round(30 + (30 - medFont.spec.lineHeight * medScale) * 0.5) + offsetY;
  const headerTextY = Math.min(0, offsetY) + (menuSprites['projector_top'] ? 6 : 5);

  const assistActive = Boolean(hangarUi.assistMode ?? snapshot.assistMode);
  const showDailyHeader = Boolean(
    moddedEnabled && hangarUi.modFlags?.dailySeed && hangarUi.dailySeedId,
  );
  const leftHeaderLabel = showDailyHeader
    ? `DAILY ${hangarUi.dailySeedId}`
    : assistActive
      ? '[E] ASSIST: ON'
      : '[E] ASSIST: OFF';
  const leftHeaderCol =
    showDailyHeader || assistActive
      ? contrast.darkPanelAccent
      : contrast.darkPanelFg;
  if (menuSprites['projector_top']) {
    drawOutlinedHeaderText(
      ctx,
      smallFont,
      leftHeaderLabel,
      26,
      headerTextY,
      'left',
      leftHeaderCol,
      contrast.panelDark,
    );
  } else {
    ctx.drawBitmapText(
      smallFont,
      leftHeaderLabel,
      26,
      headerTextY,
      1,
      'left',
      leftHeaderCol,
    );
  }

  if (menuSprites['projector_top']) {
    drawOutlinedHeaderText(
      ctx,
      smallFont,
      'KRUNKED SKYBREAKER  //  HANGAR MK-I',
      VIRTUAL_WIDTH * 0.5,
      headerTextY,
      'center',
      contrast.darkPanelFg,
      contrast.panelDark,
    );
  } else {
    ctx.drawBitmapText(
      smallFont,
      'KRUNKED SKYBREAKER  //  HANGAR MK-I',
      VIRTUAL_WIDTH * 0.5,
      headerTextY,
      1,
      'center',
      contrast.darkPanelFg,
    );
  }

  const modTabLabel = moddedEnabled ? '[TAB] MODDED' : '[TAB] VANILLA 1:1';
  const modTabCol = moddedEnabled ? contrast.darkPanelAccent : contrast.darkPanelFg;
  if (menuSprites['projector_top']) {
    drawOutlinedHeaderText(
      ctx,
      smallFont,
      modTabLabel,
      574,
      headerTextY,
      'right',
      modTabCol,
      contrast.panelDark,
    );
  } else {
    ctx.drawBitmapText(
      smallFont,
      modTabLabel,
      574,
      headerTextY,
      1,
      'right',
      modTabCol,
    );
  }

  const isModCraft =
    moddedEnabled &&
    (hangarUi.loadout.weapon >= 6 ||
      hangarUi.loadout.body >= 6 ||
      hangarUi.loadout.engine >= 6);
  const craftBanner = isModCraft
    ? `[MOD] ${hangarUi.planeName.toUpperCase()}`
    : hangarUi.planeName.toUpperCase();
  const bannerText = isStudioOpen
    ? 'LIVE PALETTE STUDIO'
    : isModDeckOpen
      ? 'SKYBREAKER MOD DECK'
      : craftBanner;

  ctx.drawBitmapText(
    medFont,
    bannerText,
    VIRTUAL_WIDTH * 0.5,
    bannerY,
    medScale,
    'center',
    contrast.darkPanelFg,
  );

  if (isStudioOpen && hangarUi.paletteStudio) {
    drawPaletteStudioPanel(ctx, hangarUi, smallFont, offsetY);
    if (snapshot.tick < 0) ctx.bumpDrawCall();
    return;
  }

  if (isModDeckOpen) {
    drawModDeckPanel(ctx, hangarUi, smallFont, offsetY);
    if (snapshot.tick < 0) ctx.bumpDrawCall();
    return;
  }

  if (
    moddedEnabled &&
    hangarUi.modFlags &&
    hangarUi.modFlags.multiplayerMode !== 'solo'
  ) {
    const pBackLuma = luma(stageSky);
    const p1Luma = luma(previewPal.colors[1]);
    const p2PreviewCol: RgbaTuple =
      pBackLuma > 0.45 && p1Luma > 0.45
        ? [0.08, 0.04, 0.12, 0.96]
        : pBackLuma <= 0.45 && p1Luma <= 0.45
          ? previewPal.colors[7]
          : previewPal.colors[1];
    ctx.drawBitmapText(
      smallFont,
      `P2: ${(hangarUi.p2PlaneName ?? (hangarUi.modFlags.p2BotEnabled ? 'ACE BOT' : 'HUMAN')).toUpperCase()}`,
      324,
      151 + offsetY,
      1,
      'left',
      p2PreviewCol,
    );
  }

  // 4. Left Customize Machine Rows (with visual `customize_buttons` + `customize_*` tiles + slot pips)
  const effectiveAssetMode =
    hangarUi.assetMode ??
    (hangarUi.vaultSource === 'steam-local' ? 'steam-local' : 'skybreaker');
  const steamAvailable =
    hangarUi.steamAvailable ?? effectiveAssetMode === 'steam-local';
  const assetsValue =
    effectiveAssetMode === 'steam-local'
      ? 'STEAM LOCAL'
      : steamAvailable
        ? 'SKYBREAKER'
        : 'SKYBREAKER [STEAM N/A]';
  const baseModeLabel = hangarUi.mode === 'sfmt' ? 'OVERDRIVE' : 'NORMAL';
  const modeLabel = assistActive ? `${baseModeLabel} + ASSIST` : baseModeLabel;
  const isAllUnlocked = Boolean(hangarUi.allUnlocked);
  const arsenalEnabled = Boolean(
    moddedEnabled && hangarUi.modFlags?.arsenalBosses,
  );
  const partCount = arsenalEnabled ? 9 : 6;
  const weaponSlot = clamp(
    Math.floor(hangarUi.loadout.weapon) + 1,
    1,
    partCount,
  );
  const bodySlot = clamp(Math.floor(hangarUi.loadout.body) + 1, 1, partCount);
  const engineSlot = clamp(
    Math.floor(hangarUi.loadout.engine) + 1,
    1,
    partCount,
  );
  const paletteCount = moddedEnabled ? ctx.allPalettes.length : PALETTES.length;
  const paletteSlot = clamp(
    Math.floor(hangarUi.paletteIndex) + 1,
    1,
    paletteCount,
  );
  const modeAvailable = isAllUnlocked || hangarUi.sfmtUnlocked;

  const activeSpecDescr =
    hangarUi.activeRow === 'weapon'
      ? hangarUi.weaponSpec.descr
      : hangarUi.activeRow === 'body'
        ? hangarUi.bodySpec.descr
        : hangarUi.activeRow === 'engine'
          ? hangarUi.engineSpec.descr
          : hangarUi.activeRow === 'palette'
            ? `ACTIVE PALETTE: ${hangarUi.paletteName} (${paletteSlot}/${paletteCount})`
            : hangarUi.activeRow === 'assets'
              ? 'ORIGINAL SKYBREAKER ART & SYNTH\nOR LOCAL STEAM VAULT (IF OWNED)'
              : hangarUi.activeRow === 'mode'
                ? modeAvailable
                  ? assistActive
                    ? 'ASSIST ON: +50% HULL, MERCY I-FRAMES, FAST HEAL\nPRESS E TO TOGGLE ASSIST  -  LT/RT: MODE'
                    : 'OVERDRIVE MODE - HIGH SPEED ACE WAVE\nPRESS E FOR ASSIST MODE (FORGIVING COMBAT)'
                  : 'COMPLETE 15 MISSIONS OR SINK A BLIMP TO UNLOCK\nPRESS E FOR ASSIST MODE (FORGIVING COMBAT)'
                : 'PRESS SPACE OR ENTER TO LAUNCH SORTIE';

  const rowDefs: {
    key: HangarUiState['activeRow'];
    label: string;
    value: string;
    partIdx?: number;
    unlocked?: readonly number[];
    iconSprite?: string;
  }[] = [
    {
      key: 'weapon',
      label: `WEAPON ${weaponSlot}/${partCount}`,
      value: hangarUi.weaponSpec.name.toUpperCase(),
      partIdx: hangarUi.loadout.weapon,
      unlocked: hangarUi.unlockedWeapons,
      iconSprite: 'customize_weapons',
    },
    {
      key: 'body',
      label: `BODY ${bodySlot}/${partCount}`,
      value: hangarUi.bodySpec.name.toUpperCase(),
      partIdx: hangarUi.loadout.body,
      unlocked: hangarUi.unlockedBodies,
      iconSprite: 'customize_bodies',
    },
    {
      key: 'engine',
      label: `ENGINE ${engineSlot}/${partCount}`,
      value: hangarUi.engineSpec.name.toUpperCase(),
      partIdx: hangarUi.loadout.engine,
      unlocked: hangarUi.unlockedEngines,
      iconSprite: 'customize_engines',
    },
    {
      key: 'palette',
      label: `PALETTE ${paletteSlot}/${paletteCount}`,
      value: hangarUi.paletteName.toUpperCase(),
    },
    {
      key: 'assets',
      label: 'ASSETS',
      value: assetsValue,
    },
    {
      key: 'mode',
      label: 'MODE',
      value: modeAvailable ? modeLabel : `${modeLabel} [LOCKED]`,
    },
    {
      key: 'launch',
      label: 'SORTIE',
      value: '[ LAUNCH AIRCRAFT ]',
    },
  ];

  const rowSolids: number[] = [];
  const rowTileSprites: SpriteInstance[] = [];

  for (let i = 0; i < rowDefs.length; i++) {
    const r = rowDefs[i]!;
    const ry = HANGAR_LAYOUT.rowStartY + i * HANGAR_LAYOUT.rowStep + offsetY;
    const isSelected = hangarUi.activeRow === r.key;

    if (isSelected) {
      pushSolidRect(
        rowSolids,
        HANGAR_LAYOUT.rowX,
        ry,
        HANGAR_LAYOUT.rowWidth,
        HANGAR_LAYOUT.rowHeight,
        contrast.selectedBg,
      );
      pushSolidBorder(
        rowSolids,
        HANGAR_LAYOUT.rowX,
        ry,
        HANGAR_LAYOUT.rowWidth,
        HANGAR_LAYOUT.rowHeight,
        1,
        contrast.panelDark,
      );
    } else {
      pushSolidRect(
        rowSolids,
        HANGAR_LAYOUT.rowX,
        ry,
        HANGAR_LAYOUT.rowWidth,
        HANGAR_LAYOUT.rowHeight,
        withAlpha(contrast.panelDark, 0.72),
      );
      pushSolidBorder(
        rowSolids,
        HANGAR_LAYOUT.rowX,
        ry,
        HANGAR_LAYOUT.rowWidth,
        HANGAR_LAYOUT.rowHeight,
        1,
        contrast.bevelBorder,
      );
    }

    // Visual Customize Machine icon tile + part slot pips on WEAPON / BODY / ENGINE rows
    if (r.iconSprite && r.partIdx !== undefined) {
      const tileCenterX = 166;
      const tileCenterY = ry + 14;
      const tileScale = 0.75; // Exact 3/4 ratio: 32x32 -> 24x24 crisp inside 28px row!
      pushMenuSprite(
        rowTileSprites,
        menuSprites,
        'customize_buttons',
        isSelected ? 2 : 1,
        tileCenterX,
        tileCenterY,
        tileScale,
        tileScale,
        0.52,
      );
      // customize_{weapons,bodies,engines}: f1..f5 = standard parts 0..4, f6 = omega/apex (5), f0 = locked
      const iconFrame = r.partIdx <= 4 ? r.partIdx + 1 : 6;
      pushMenuSprite(
        rowTileSprites,
        menuSprites,
        r.iconSprite,
        iconFrame,
        tileCenterX,
        tileCenterY,
        tileScale,
        tileScale,
        0.525,
      );

      // Compact slot pips below left label showing installed + unlocked slots (6 or 9)
      const pipStep = partCount > 6 ? 11 : 15;
      const pipW = partCount > 6 ? 8 : 11;
      for (let s = 0; s < partCount; s++) {
        const px = 48 + s * pipStep;
        const py = ry + 18;
        const isCurrent = s === r.partIdx;
        const isUnlocked =
          isAllUnlocked || s >= 6 || Boolean(r.unlocked?.includes(s));
        if (isCurrent) {
          pushSolidRect(
            rowSolids,
            px,
            py,
            pipW,
            6,
            isSelected ? contrast.selectedTextInk : pal.colors[7],
          );
        } else if (isUnlocked) {
          pushSolidRect(
            rowSolids,
            px,
            py,
            pipW,
            6,
            isSelected ? pal.colors[3] : pal.colors[5],
          );
        } else {
          pushSolidBorder(
            rowSolids,
            px,
            py,
            pipW,
            6,
            1,
            isSelected ? pal.colors[3] : pal.colors[3],
          );
        }
      }
    }

    // 8-color live palette swatch strip on PALETTE row
    if (r.key === 'palette') {
      pushSolidRect(rowSolids, 174, ry + 17, 12, 7, pal.backcol);
      pushSolidBorder(rowSolids, 174, ry + 17, 12, 7, 1, contrast.panelDark);
      for (let c = 1; c <= 7; c++) {
        const sx = 188 + (c - 1) * 14;
        pushSolidRect(rowSolids, sx, ry + 17, 12, 7, pal.colors[c] ?? pal.colors[7]);
        pushSolidBorder(rowSolids, sx, ry + 17, 12, 7, 1, contrast.panelDark);
      }
    }

    // Mode emblem on OVERDRIVE row
    if (r.key === 'mode' && menuSprites['sfmt_unlock']) {
      pushMenuSprite(
        rowTileSprites,
        menuSprites,
        'sfmt_unlock',
        0,
        156,
        ry + 4,
        1,
        1,
        0.52,
      );
    }

    // Flanking wings on LAUNCH row
    if (r.key === 'launch' && menuSprites['menu_wings']) {
      pushMenuSprite(
        rowTileSprites,
        menuSprites,
        'menu_wings',
        0,
        134,
        ry + 7,
        0.9,
        0.9,
        0.52,
      );
    }
  }

  // Active part description bar (recessed panel matching HANGAR_LAYOUT)
  pushSolidRect(
    rowSolids,
    HANGAR_LAYOUT.descrX,
    HANGAR_LAYOUT.descrY + offsetY,
    HANGAR_LAYOUT.descrWidth,
    HANGAR_LAYOUT.descrHeight,
    contrast.panelMidBg,
  );
  pushSolidBorder(
    rowSolids,
    HANGAR_LAYOUT.descrX,
    HANGAR_LAYOUT.descrY + offsetY,
    HANGAR_LAYOUT.descrWidth,
    HANGAR_LAYOUT.descrHeight,
    1,
    contrast.bevelBorder,
  );
  ctx.flushSolids(rowSolids);
  if (rowTileSprites.length > 0) {
    ctx.drawSpriteBatch(menuTex, rowTileSprites, undefined, true);
  }

  // Render row labels and values cleanly inside [42..302] with zero overlap
  for (let i = 0; i < rowDefs.length; i++) {
    const r = rowDefs[i]!;
    const ry = HANGAR_LAYOUT.rowStartY + i * HANGAR_LAYOUT.rowStep + offsetY;
    const isSelected = hangarUi.activeRow === r.key;
    const labelCol = isSelected
      ? contrast.selectedTextInk
      : contrast.darkPanelAccent;
    const valCol = isSelected
      ? contrast.selectedTextInk
      : contrast.darkPanelFg;
    const prefix = isSelected ? '> ' : '  ';
    const labelText = `${prefix}${r.label}`;
    const valText = isSelected ? `< ${r.value} >` : r.value;
    const labelY = ry + 4;
    const valY =
      ry + (r.key === 'palette' ? 4 : r.iconSprite ? 10 : 14);

    ctx.drawBitmapText(
      smallFont,
      labelText,
      48,
      labelY,
      1,
      'left',
      labelCol,
    );

    const labelW = measureBitmapText(smallFont.spec, labelText, 1).width;
    const maxValW =
      r.key === 'palette'
        ? Math.max(48, 294 - (48 + labelW + 6))
        : r.iconSprite
          ? 110
          : 246;
    const rawValW = measureBitmapText(smallFont.spec, valText, 1).width;
    const valScale = rawValW > maxValW && rawValW > 0 ? maxValW / rawValW : 1;

    ctx.drawBitmapText(
      smallFont,
      valText,
      294,
      valY,
      valScale,
      'right',
      valCol,
    );
  }

  // Part description text (splits on \n and wraps cleanly inside 250px, up to 3 lines)
  const descrLayout = layoutHangarDescription(
    smallFont.spec,
    activeSpecDescr,
    250,
    3,
  );
  const descrLineCount = descrLayout.lines.length;
  const descrStartY =
    (descrLineCount <= 1
      ? HANGAR_LAYOUT.descrY + 13
      : descrLineCount === 2
        ? HANGAR_LAYOUT.descrY + 6
        : HANGAR_LAYOUT.descrY + 3) + offsetY;
  const descrStepY = descrLineCount === 2 ? 13 : 10;
  for (let i = 0; i < descrLineCount; i++) {
    const line = descrLayout.lines[i]!;
    ctx.drawBitmapText(
      smallFont,
      line.text,
      48,
      descrStartY + i * descrStepY,
      line.scale,
      'left',
      contrast.midPanelInk,
    );
  }

  // 5. Right Panel: 3 Authentic `mission_frame` Cards with `customize_*_mis` Icons & `mission_frame_progress`
  const missionSolids: number[] = [];
  const missionSprites: SpriteInstance[] = [];
  const missions = hangarUi.activeMissions.slice(0, 3);
  const hasMissionFrames = Boolean(menuSprites['mission_frame']);

  for (let i = 0; i < missions.length; i++) {
    const m = missions[i]!;
    const prog = hangarUi.missionProgress[m.id];
    const done = prog?.completed ?? false;
    const my = 172 + i * 52 + offsetY;

    if (hasMissionFrames) {
      pushMenuSprite(
        missionSprites,
        menuSprites,
        'mission_frame',
        done ? 3 : 0,
        318,
        my,
        240 / 264,
        1,
        0.515,
      );
      const catSprite = resolveMissionCategorySprite(m.component[0]);
      pushMenuSprite(
        missionSprites,
        menuSprites,
        catSprite,
        clamp(m.component[1], 0, 5),
        318 + 11,
        my + 12,
        0.82,
        0.82,
        0.52,
      );
      pushSolidRect(missionSolids, 318, my + 24, 240, 22, contrast.panelMidBg);
      pushSolidBorder(missionSolids, 318, my, 240, 46, 1, contrast.bevelBorder);
    } else {
      pushSolidRect(
        missionSolids,
        318,
        my,
        240,
        46,
        done ? contrast.bannerPlateBg : contrast.panelMidBg,
      );
      pushSolidBorder(missionSolids, 318, my, 240, 46, 1, pal.colors[7]);
    }

    const ratio =
      prog && prog.target > 0
        ? clamp(prog.current / prog.target, 0, 1)
        : done
          ? 1
          : 0;
    const descrLayout = layoutMissionCardDescription(
      smallFont.spec,
      m.description,
      224,
    );
    const barY = hasMissionFrames
      ? descrLayout.lines.length > 1
        ? my + 41
        : my + 38
      : my + 34;
    const barH = hasMissionFrames
      ? descrLayout.lines.length > 1
        ? 3
        : 5
      : 6;
    pushSolidRect(missionSolids, 326, barY, 224, barH, contrast.panelDark);
    if (ratio > 0) {
      if (menuSprites['mission_frame_progress']) {
        pushMenuSprite(
          missionSprites,
          menuSprites,
          'mission_frame_progress',
          0,
          326,
          barY,
          Math.max(1, (224 * ratio) / 2),
          barH / 2,
          0.525,
        );
      } else {
        pushSolidRect(
          missionSolids,
          326,
          barY,
          Math.round(224 * ratio),
          barH,
          pal.colors[7],
        );
      }
    }
  }
  ctx.flushSolids(missionSolids);
  if (missionSprites.length > 0) {
    ctx.drawSpriteBatch(menuTex, missionSprites, undefined, true);
  }

  for (let i = 0; i < missions.length; i++) {
    const m = missions[i]!;
    const prog = hangarUi.missionProgress[m.id];
    const done = prog?.completed ?? false;
    const my = 172 + i * 52 + offsetY;
    const descrLayout = layoutMissionCardDescription(
      smallFont.spec,
      m.description,
      224,
    );
    const titleX = hasMissionFrames ? 342 : 326;
    const titleY = hasMissionFrames ? my + 8 : descrLayout.lines.length > 1 ? my + 4 : my + 5;
    const headerInk =
      hasMissionFrames && done ? contrast.selectedTextInk : contrast.darkPanelFg;
    const countText = done
      ? 'DONE'
      : `${prog?.current ?? 0}/${prog?.target ?? 1}`;
    const titleText = sanitizeControlChars(m.title).toUpperCase();
    const countWidth = measureBitmapText(smallFont.spec, countText, 1).width;
    const titleMaxW = Math.max(40, 550 - titleX - countWidth - 6);
    const titleW = measureBitmapText(smallFont.spec, titleText, 1).width;
    const titleScale =
      titleW > titleMaxW && titleW > 0 ? titleMaxW / titleW : 1;

    ctx.drawBitmapText(
      smallFont,
      titleText,
      titleX,
      titleY,
      titleScale,
      'left',
      headerInk,
    );
    ctx.drawBitmapText(
      smallFont,
      countText,
      550,
      titleY,
      1,
      'right',
      headerInk,
    );

    if (hasMissionFrames) {
      if (descrLayout.lines.length === 1) {
        ctx.drawBitmapText(
          smallFont,
          descrLayout.lines[0]!,
          326,
          my + 27,
          descrLayout.scale,
          'left',
          contrast.midPanelInk,
        );
      } else {
        for (let lineIdx = 0; lineIdx < descrLayout.lines.length; lineIdx++) {
          ctx.drawBitmapText(
            smallFont,
            descrLayout.lines[lineIdx]!,
            326,
            my + 24 + lineIdx * 8,
            descrLayout.scale,
            'left',
            contrast.midPanelInk,
          );
        }
      }
    } else if (descrLayout.lines.length === 1) {
      ctx.drawBitmapText(
        smallFont,
        descrLayout.lines[0]!,
        326,
        my + 18,
        descrLayout.scale,
        'left',
        contrast.midPanelInk,
      );
    } else {
      for (let lineIdx = 0; lineIdx < descrLayout.lines.length; lineIdx++) {
        ctx.drawBitmapText(
          smallFont,
          descrLayout.lines[lineIdx]!,
          326,
          my + 15 + lineIdx * 9,
          descrLayout.scale,
          'left',
          contrast.midPanelInk,
        );
      }
    }
  }

  // 6. Bottom Summary Footer
  const lockedNote = isPaletteUnlocked(
    pal,
    hangarUi.completedMissionsCount,
    hangarUi.sfmtUnlocked,
    isAllUnlocked,
  )
    ? ''
    : ' [LOCKED]';
  ctx.drawBitmapText(
    smallFont,
    `HI: ${hangarUi.highScore}  MISSIONS: ${hangarUi.completedMissionsCount}/${hangarUi.totalMissionsCount}${lockedNote}`,
    42,
    HANGAR_LAYOUT.footerY + offsetY,
    1,
    'left',
    contrast.darkPanelFg,
  );
  ctx.drawBitmapText(
    smallFont,
    `E:AST U:${isAllUnlocked ? 'ALL' : 'LOCK'} TAB:MODS SPC:GO ~HUD`,
    558,
    HANGAR_LAYOUT.footerY + offsetY,
    1,
    'right',
    contrast.darkPanelAccent,
  );

  if (snapshot.tick < 0) {
    ctx.bumpDrawCall();
  }
}

// ============================================================================
// 5. ACT II MOD DECK & LIVE PALETTE STUDIO PANELS (inside Projector Screen)
// ============================================================================

function drawModDeckPanel(
  ctx: HangarHudDrawContext,
  hangarUi: HangarUiState,
  smallFont: ResolvedFont,
  offsetY: number,
): void {
  const pal = ctx.activePalette;
  const contrast = getMenuContrastColors(pal);
  const flags = hangarUi.modFlags ?? {
    moddedEnabled: false,
    arsenalBosses: false,
    replayGhost: false,
    dailySeed: false,
    shaderFx: { ...DEFAULT_SHADER_FX },
    multiplayerMode: 'solo' as const,
    p2BotEnabled: true,
  };
  const activeRow = hangarUi.activeModRow ?? 'modprofile';

  const modRows: Array<{
    key: ModDeckRow;
    label: string;
    value: string;
    descr: string;
  }> = [
    {
      key: 'modprofile',
      label: 'PROFILE',
      value: flags.moddedEnabled ? 'MODDED' : 'VANILLA 1:1',
      descr:
        'MASTER LOCK SWITCH. VANILLA 1:1 GUARANTEES EXACT ORIGINAL PHYSICS AND SHADERS.',
    },
    {
      key: 'modarsenal',
      label: 'ARSENAL+BOSS',
      value: flags.arsenalBosses ? 'ON' : 'OFF',
      descr:
        'UNLOCKS RAILGUN, FLAK, CHAIN LIGHTNING, AEGIS SHIELD, DREADNOUGHT AND SKYCARRIER.',
    },
    {
      key: 'modghost',
      label: 'REPLAY GHOST',
      value: flags.replayGhost ? 'ON' : 'OFF',
      descr:
        'RACES YOUR PERSONAL BEST GHOST SILHOUETTE AND TRAIL DURING LIVE SORTIES.',
    },
    {
      key: 'moddaily',
      label: 'DAILY SEED',
      value: flags.dailySeed ? 'ON' : 'OFF',
      descr:
        'LOCKS THE RNG SEED TO TODAYS GLOBAL DATE FOR COMPETITIVE DAILY LEADERBOARDS.',
    },
    {
      key: 'modshader_crt',
      label: 'FX: CRT',
      value: flags.shaderFx.crtScanlines ? 'ON' : 'OFF',
      descr:
        'MODULATES SUBTLE HORIZONTAL CRT SCANLINES AND VIGNETTE OVER THE 600X400 OUTPUT.',
    },
    {
      key: 'modshader_bloom',
      label: 'FX: BLOOM',
      value: flags.shaderFx.phosphorBloom ? 'ON' : 'OFF',
      descr:
        '8-TAP PHOSPHOR GLOW HALO AROUND EXPLOSIONS, LASERS, AND BRIGHT UI HIGHLIGHTS.',
    },
    {
      key: 'modshader_warp',
      label: 'FX: WARP',
      value: flags.shaderFx.speedWarp ? 'ON' : 'OFF',
      descr:
        'SPEED-REACTIVE PERIPHERAL WARP AND CONTRAST BOOST SCALING WITH AIRSPEED.',
    },
    {
      key: 'modshader_shock',
      label: 'FX: SHOCKWAVE',
      value: flags.shaderFx.shockwaves ? 'ON' : 'OFF',
      descr:
        'RADIAL SHOCKWAVE DISTORTION RINGS AROUND HEAVY DETONATIONS AND BOSS KILLS.',
    },
    {
      key: 'modmulti',
      label: 'MULTIPLAYER',
      value:
        flags.multiplayerMode === 'coop2p'
          ? '2P CO-OP'
          : flags.multiplayerMode === 'dogfight1v1'
            ? '1V1 FIGHT'
            : 'SOLO',
      descr:
        'SWITCHES BETWEEN SOLO, 2P CO-OP SURVIVAL, AND 1V1 BEST-OF-5 DOGFIGHT ARENA.',
    },
    {
      key: 'modp2bot',
      label: 'P2 PILOT',
      value: flags.p2BotEnabled ? 'BOT' : 'HUMAN',
      descr:
        'SELECTS WHETHER PLAYER 2 IS FLOWN BY AI WINGMAN/RIVAL OR LOCAL KEYBOARD.',
    },
    {
      key: 'palettestudio',
      label: 'PAL STUDIO',
      value: 'OPEN',
      descr:
        'OPEN THE LIVE 8-SLOT RGB PALETTE STUDIO WITH PRESETS AND JSON IMPORT/EXPORT.',
    },
    {
      key: 'modback',
      label: 'LOADOUT',
      value: 'BACK',
      descr:
        'RETURN TO THE HANGAR WEAPON, BODY, ENGINE, AND SORTIE LAUNCH SCREEN.',
    },
  ];

  const solids: number[] = [];
  for (let i = 0; i < modRows.length; i++) {
    const r = modRows[i]!;
    const ry = 70 + i * 21 + offsetY;
    const isSelected = r.key === activeRow;
    if (isSelected) {
      pushSolidRect(solids, 42, ry, 260, 19, contrast.selectedBg);
    } else {
      pushSolidRect(solids, 42, ry, 260, 19, withAlpha(contrast.panelDark, 0.72));
      pushSolidBorder(solids, 42, ry, 260, 19, 1, contrast.bevelBorder);
    }
  }

  pushSolidRect(solids, 318, 172 + offsetY, 240, 160, contrast.panelMidBg);
  pushSolidBorder(solids, 318, 172 + offsetY, 240, 160, 1, contrast.bevelBorder);
  ctx.flushSolids(solids);

  for (let i = 0; i < modRows.length; i++) {
    const r = modRows[i]!;
    const ry = 70 + i * 21 + offsetY;
    const isSelected = r.key === activeRow;
    const labelCol = isSelected
      ? contrast.selectedTextInk
      : contrast.darkPanelAccent;
    const valCol = isSelected
      ? contrast.selectedTextInk
      : contrast.darkPanelFg;
    ctx.drawBitmapText(
      smallFont,
      `${isSelected ? '> ' : '  '}${r.label}`,
      48,
      ry + 6,
      1,
      'left',
      labelCol,
    );
    ctx.drawBitmapText(
      smallFont,
      isSelected ? `< ${r.value} >` : r.value,
      296,
      ry + 6,
      1,
      'right',
      valCol,
    );
  }

  const activeMeta = modRows.find((m) => m.key === activeRow) ?? modRows[0]!;
  ctx.drawBitmapText(
    smallFont,
    activeMeta.label,
    326,
    180 + offsetY,
    1,
    'left',
    contrast.darkPanelFg,
  );
  const wrapped = wrapBitmapTextLines(smallFont.spec, activeMeta.descr, 224, 1);
  for (let i = 0; i < Math.min(5, wrapped.length); i++) {
    ctx.drawBitmapText(
      smallFont,
      wrapped[i]!,
      326,
      196 + i * 11 + offsetY,
      1,
      'left',
      contrast.midPanelInk,
    );
  }

  const dailyStr = hangarUi.dailySeedId
    ? `DAILY: ${hangarUi.dailySeedId} (BEST ${hangarUi.dailyBestScore ?? 0})`
    : 'DAILY: READY';
  const ghostStr =
    hangarUi.pbGhostScore !== undefined
      ? `PB GHOST: ${Math.floor(hangarUi.pbGhostScore)}`
      : 'PB GHOST: READY';
  ctx.drawBitmapText(
    smallFont,
    dailyStr,
    326,
    278 + offsetY,
    1,
    'left',
    contrast.darkPanelFg,
  );
  ctx.drawBitmapText(
    smallFont,
    ghostStr,
    326,
    294 + offsetY,
    1,
    'left',
    contrast.darkPanelFg,
  );
  const p2Hint = 'P1:WASD+F/SPC  P2:ARROWS+M/NUM0';
  const p2HintW = measureBitmapText(smallFont.spec, p2Hint, 1).width;
  const p2HintScale = p2HintW > 224 && p2HintW > 0 ? 224 / p2HintW : 1;
  ctx.drawBitmapText(
    smallFont,
    p2Hint,
    326,
    310 + offsetY,
    p2HintScale,
    'left',
    contrast.darkPanelAccent,
  );

  ctx.drawBitmapText(
    smallFont,
    flags.moddedEnabled ? 'MODE: SKYBREAKER MODDED' : 'MODE: VANILLA 1:1 LOCKED',
    42,
    347 + offsetY,
    1,
    'left',
    contrast.darkPanelFg,
  );
  ctx.drawBitmapText(
    smallFont,
    'UP/DN:ROW  SPC/LR:SET  TAB:CLOSE',
    558,
    347 + offsetY,
    1,
    'right',
    contrast.darkPanelAccent,
  );
}

function drawPaletteStudioPanel(
  ctx: HangarHudDrawContext,
  hangarUi: HangarUiState,
  smallFont: ResolvedFont,
  offsetY: number,
): void {
  const pal = ctx.activePalette;
  const contrast = getMenuContrastColors(pal);
  const studio = hangarUi.paletteStudio!;
  const sPal = studio.palette;
  const slotLabels = [
    'SKY/SEA',
    'PLAYER',
    'ENEMY',
    'REFLECT',
    'BG PROP',
    'BULLET',
    'CLOUD',
    'GLOW/HP',
  ];
  const getSlotTuple = (slot: number): RgbaTuple =>
    slot === 0 ? sPal.backcol : (sPal.colors[slot] ?? sPal.colors[7]);

  const solids: number[] = [];
  pushSolidRect(solids, 42, 68 + offsetY, 260, 18, contrast.panelMidBg);
  pushSolidBorder(solids, 42, 68 + offsetY, 260, 18, 1, contrast.bevelBorder);

  for (let i = 0; i < 8; i++) {
    const ry = 90 + i * 24 + offsetY;
    const isSelected = i === studio.selectedSlot;
    if (isSelected) {
      pushSolidRect(solids, 42, ry, 260, 21, contrast.selectedBg);
    } else {
      pushSolidRect(solids, 42, ry, 260, 21, withAlpha(contrast.panelDark, 0.72));
      pushSolidBorder(solids, 42, ry, 260, 21, 1, contrast.bevelBorder);
    }
    const col = getSlotTuple(i);
    pushSolidRect(solids, 48, ry + 3, 22, 15, col);
    pushSolidBorder(
      solids,
      48,
      ry + 3,
      22,
      15,
      1,
      isSelected ? contrast.selectedTextInk : pal.colors[7],
    );
  }

  pushSolidRect(solids, 42, 284 + offsetY, 260, 48, contrast.panelMidBg);
  pushSolidBorder(solids, 42, 284 + offsetY, 260, 48, 1, contrast.bevelBorder);
  const activeTuple = getSlotTuple(studio.selectedSlot);
  const barColors: [RgbaTuple, RgbaTuple, RgbaTuple] = [
    [1, 0.28, 0.28, 1],
    [0.28, 1, 0.38, 1],
    [0.32, 0.62, 1, 1],
  ];
  for (let ch = 0; ch < 3; ch++) {
    const by = 290 + ch * 14 + offsetY;
    const v = clamp(activeTuple[ch] ?? 0, 0, 1);
    pushSolidRect(solids, 74, by + 1, 174, 8, contrast.panelDark);
    pushSolidRect(solids, 74, by + 1, Math.round(174 * v), 8, barColors[ch]!);
    if (ch === studio.selectedChannel) {
      pushSolidBorder(solids, 73, by, 176, 10, 1, pal.colors[7]);
    }
  }

  // Bottom-right miniature diorama preview showing edited palette live
  pushSolidRect(solids, 318, 172 + offsetY, 240, 112, sPal.backcol);
  pushSolidRect(solids, 318, 240 + offsetY, 240, 44, sPal.backcol);
  pushSolidRect(solids, 318, 238 + offsetY, 240, 2, sPal.colors[7]);
  pushSolidRect(solids, 336, 184 + offsetY, 48, 12, sPal.colors[6]);
  pushSolidRect(solids, 458, 180 + offsetY, 56, 14, sPal.colors[7]);
  pushSolidRect(solids, 348, 224 + offsetY, 34, 14, sPal.colors[4]);
  pushSolidRect(solids, 472, 210 + offsetY, 22, 12, sPal.colors[2]);
  pushSolidRect(solids, 430, 214 + offsetY, 10, 4, sPal.colors[5]);
  pushSolidRect(solids, 376, 212 + offsetY, 24, 10, sPal.colors[1]);
  pushSolidRect(solids, 376, 250 + offsetY, 24, 10, sPal.colors[3]);
  pushSolidRect(solids, 430, 252 + offsetY, 10, 4, sPal.colors[6]);
  pushSolidBorder(solids, 318, 172 + offsetY, 240, 112, 1, contrast.bevelBorder);

  pushSolidRect(solids, 318, 288 + offsetY, 240, 44, contrast.panelMidBg);
  pushSolidBorder(solids, 318, 288 + offsetY, 240, 44, 1, contrast.bevelBorder);
  ctx.flushSolids(solids);

  const slotsLabel = 'SLOTS';
  const slotsW = measureBitmapText(smallFont.spec, slotsLabel, 1).width;
  const palLabelMaxW = Math.max(80, 296 - (48 + slotsW + 8));
  const palLabelText = sPal.name.toUpperCase().slice(0, 18);
  const palLabelW = measureBitmapText(smallFont.spec, palLabelText, 1).width;
  const palLabelScale =
    palLabelW > palLabelMaxW && palLabelW > 0 ? palLabelMaxW / palLabelW : 1;

  ctx.drawBitmapText(
    smallFont,
    slotsLabel,
    48,
    73 + offsetY,
    1,
    'left',
    contrast.darkPanelFg,
  );
  ctx.drawBitmapText(
    smallFont,
    palLabelText,
    296,
    73 + offsetY,
    palLabelScale,
    'right',
    contrast.midPanelInk,
  );

  for (let i = 0; i < 8; i++) {
    const ry = 90 + i * 24 + offsetY;
    const isSelected = i === studio.selectedSlot;
    const col = getSlotTuple(i);
    const textCol = isSelected
      ? contrast.selectedTextInk
      : contrast.darkPanelFg;
    ctx.drawBitmapText(
      smallFont,
      `${i}: ${slotLabels[i] ?? ''}`,
      76,
      ry + 7,
      1,
      'left',
      textCol,
    );
    ctx.drawBitmapText(
      smallFont,
      rgbaToHex(col).toUpperCase(),
      296,
      ry + 7,
      1,
      'right',
      textCol,
    );
  }

  const chNames = ['R', 'G', 'B'];
  for (let ch = 0; ch < 3; ch++) {
    const by = 290 + ch * 14 + offsetY;
    const isCh = ch === studio.selectedChannel;
    const v = clamp(activeTuple[ch] ?? 0, 0, 1);
    ctx.drawBitmapText(
      smallFont,
      isCh ? `[${chNames[ch]}]` : ` ${chNames[ch]} `,
      46,
      by + 2,
      1,
      'left',
      isCh ? contrast.darkPanelFg : contrast.midPanelInk,
    );
    ctx.drawBitmapText(
      smallFont,
      v.toFixed(2),
      296,
      by + 2,
      1,
      'right',
      isCh ? contrast.darkPanelFg : contrast.midPanelInk,
    );
  }

  ctx.drawBitmapText(
    smallFont,
    '1-4:PRESET  R:RESET',
    326,
    296 + offsetY,
    1,
    'left',
    contrast.darkPanelFg,
  );
  ctx.drawBitmapText(
    smallFont,
    'Q/E:RGB  LT/RT:+-0.05',
    326,
    312 + offsetY,
    1,
    'left',
    contrast.midPanelInk,
  );

  ctx.drawBitmapText(
    smallFont,
    `STUDIO SAVED: ${studio.savedCount}`,
    42,
    347 + offsetY,
    1,
    'left',
    contrast.darkPanelFg,
  );
  ctx.drawBitmapText(
    smallFont,
    'UP/DN:SLOT  ENTER:SAVE  ESC:BACK',
    558,
    347 + offsetY,
    1,
    'right',
    contrast.darkPanelAccent,
  );
}

export const HANGAR_HUD_PASS: HangarHudPass = {
  drawHangarMenuPass,
  drawInGameHudPass,
  drawPauseOverlayPass,
  drawGameOverDebriefPass,
};
