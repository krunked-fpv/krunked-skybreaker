import {
  DEFAULT_SHADER_FX,
  type ShaderFxConfig,
} from '../contracts/mod';
import {
  VIRTUAL_HEIGHT,
  VIRTUAL_WIDTH,
  type FrameMetrics,
  type HangarUiState,
  type IRenderer,
  type ModDeckRow,
  type PaletteDefinition,
  type PostShaderUniforms,
  type RgbaTuple,
} from '../contracts/render';
import type {
  EnemyEntity,
  ParticleEntity,
  PlayerState,
  ProjectileEntity,
  SimSnapshot,
} from '../contracts/sim';
import type {
  BitmapFontSpec,
  SpriteAtlasSpec,
  SpriteEntry,
  SpriteFrame,
  VaultAssetBundle,
} from '../contracts/vault';
import {
  ACT2_BONUS_PALETTES,
  DEFAULT_PALETTE_ID,
  PALETTES,
  createDefaultCustomPalette,
  getPaletteById,
  isPaletteUnlocked,
  rgbaToHex,
  sanitizeCustomPalette,
} from './palettes';
import {
  BUILTIN_FONT_HEIGHT,
  BUILTIN_FONT_WIDTH,
  buildBitmapTextVertices,
  createBuiltinPixelFont,
  measureBitmapText,
  type TextAlign,
} from './pixel-font';
import {
  BATCH_FRAG,
  BATCH_MENU_FRAG,
  BATCH_MENU_VERT,
  BATCH_REFLECT_FRAG,
  BATCH_REFLECT_VERT,
  BATCH_VERT,
  COMBO_FONT_FRAG,
  FONT_FRAG,
  FONT_VERT,
  OUTPASS_FRAG,
  OUTPASS_VERT,
  PAUSE_LINES_FRAG,
  PAUSE_LINES_VERT,
  POST_WATER_FRAG,
  POST_WATER_VERT,
  SOLID_FRAG,
  SOLID_VERT,
  computePostShaderUniforms,
  createOrthoMatrix,
} from './shaders';

const DEG_TO_RAD = Math.PI / 180;
const INSTANCE_FLOATS = 13; // x,y,angle, ax,ay,w,h, cx,cy,sx,sy, depth,flash
const MAX_BATCH_INSTANCES = 4096;
const SOLID_VERTEX_FLOATS = 6; // x,y, r,g,b,a

export interface UploadedTexture {
  texture: WebGLTexture;
  width: number;
  height: number;
}

export interface ResolvedFont {
  spec: BitmapFontSpec;
  tex: UploadedTexture;
}

interface FboTarget {
  framebuffer: WebGLFramebuffer;
  colorTexture: WebGLTexture;
  depthRenderbuffer: WebGLRenderbuffer;
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

let defaultHangarHudPass: HangarHudPass | null = null;

export function registerDefaultHangarHudPass(pass: HangarHudPass | null): void {
  defaultHangarHudPass = pass;
}

type EnemyVisualExtras = EnemyEntity & {
  gunRecoilTicks?: number;
  gunAnimFrame?: number;
  boosting?: boolean;
};

type ParallaxVisualExtras = SimSnapshot['parallax'][number] & {
  angleDeg?: number;
};

interface CompiledProgram {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngleDeg(a: number, b: number, t: number): number {
  let diff = ((b - a + 180) % 360 + 360) % 360 - 180;
  if (diff < -180) diff += 360;
  return a + diff * t;
}

function getSpriteFrame(entry: SpriteEntry, frameIdx: number): SpriteFrame {
  const subs = entry.subs as unknown[];
  if (!subs || subs.length === 0) {
    return { x: 0, y: 0 };
  }
  if (typeof subs[0] === 'number') {
    const pairCount = Math.max(1, Math.floor(subs.length / 2));
    const idx = ((Math.floor(frameIdx) % pairCount) + pairCount) % pairCount;
    return {
      x: Number(subs[idx * 2] ?? 0),
      y: Number(subs[idx * 2 + 1] ?? 0),
    };
  }
  const idx = ((Math.floor(frameIdx) % subs.length) + subs.length) % subs.length;
  const sub = subs[idx] as SpriteFrame | undefined;
  return sub ?? { x: 0, y: 0 };
}

function rgbaToCss(c: RgbaTuple): string {
  const r = Math.round(clamp(c[0], 0, 1) * 255);
  const g = Math.round(clamp(c[1], 0, 1) * 255);
  const b = Math.round(clamp(c[2], 0, 1) * 255);
  const a = clamp(c[3], 0, 1);
  return `rgba(${r},${g},${b},${a})`;
}

const UPRIGHT_HULL_KINDS = new Set<EnemyEntity['kind']>([
  'Boat',
  'BigBoat',
  'Submarine',
  'AceMarine',
  'Blimp',
  'Dreadnought',
  'SkyCarrier',
]);

/**
 * Resolves sprite rotation and horizontal flip for enemy entities.
 * Naval hulls and blimps remain upright (`angleRad = 0`) and mirror via `scaleX`
 * so left-moving hulls never rotate 180 deg upside-down below the sea clip line.
 */
export function resolveEnemyRenderTransform(
  enemy: Pick<EnemyEntity, 'kind' | 'vx' | 'angleDeg'>,
): { angleRad: number; scaleX: number; scaleY: number } {
  if (UPRIGHT_HULL_KINDS.has(enemy.kind)) {
    const scaleX =
      enemy.vx < 0
        ? -1
        : enemy.vx > 0
          ? 1
          : Math.cos(enemy.angleDeg * DEG_TO_RAD) < 0
            ? -1
            : 1;
    return { angleRad: 0, scaleX, scaleY: 1 };
  }
  return {
    angleRad: enemy.angleDeg * DEG_TO_RAD,
    scaleX: 1,
    scaleY: 1,
  };
}

function sanitizeControlChars(text: string): string {
  return text.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Splits text on newlines and wraps each paragraph at word boundaries to fit `maxWidth`.
 * Strips control characters so bitmap fonts never render `?` fallback glyphs.
 */
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

/**
 * Lays out Hangar part description text into up to `maxLines` crisp lines inside `maxWidth`.
 */
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

/**
 * Fits a Mission card description inside `maxWidth` across 1 or 2 lines above the progress bar
 * without truncating characters.
 */
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

  // Last-resort balanced 2-line split scaled cleanly to fit maxWidth
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

export class WebGL2Renderer implements IRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private fallback2d: CanvasRenderingContext2D | null = null;
  private fallbackOffscreen: HTMLCanvasElement | null = null;
  private fallbackOffscreenCtx: CanvasRenderingContext2D | null = null;

  private vault: VaultAssetBundle | null = null;
  private customPalettes: PaletteDefinition[] = [];
  private activePalette: PaletteDefinition = getPaletteById(DEFAULT_PALETTE_ID);
  private shaderFx: ShaderFxConfig = { ...DEFAULT_SHADER_FX };
  private shaderFxExplicit = false;
  private effectiveFx: ShaderFxConfig = { ...DEFAULT_SHADER_FX };
  private renderShockwaves: [number, number, number, number][] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  private renderSpeedNorm = 0;
  private renderElapsedSec = 0;

  private camX = 0;
  private camY = -120;
  private cameraInitialized = false;
  private lastPhase = '';

  private webglErrors = 0;
  private frameDrawCalls = 0;
  private lastFrameDrawCalls = 0;
  private lastFrameTimestampMs = 0;
  private frameDeltasMs: number[] = [];

  private lastPostUniforms: PostShaderUniforms = {
    viewport: [VIRTUAL_WIDTH, VIRTUAL_HEIGHT],
    cameraPosition: [0, 0, 0, 0],
    healthRadius: [100, 100, 0, 0],
    playerPosition: [0, -120, 0, 0],
    cameraWorldPosition: [0, -120, 0, 0],
    delta: [1 / 60, 0, 0, 0],
    uniform_backcol: [...this.activePalette.backcol],
    uniform_colors: this.activePalette.colors.map((c) => [...c]),
  };

  // WebGL2 objects
  private defaultFbo: FboTarget | null = null;
  private comboFbo: FboTarget | null = null;

  private batchProg: CompiledProgram | null = null;
  private batchReflectProg: CompiledProgram | null = null;
  private postWaterProg: CompiledProgram | null = null;
  private fontProg: CompiledProgram | null = null;
  private comboFontProg: CompiledProgram | null = null;
  private pauseLinesProg: CompiledProgram | null = null;
  private solidProg: CompiledProgram | null = null;
  private outpassProg: CompiledProgram | null = null;
  private menuBatchProg: CompiledProgram | null = null;
  private hangarHudPass: HangarHudPass | null = null;

  private fullscreenVao: WebGLVertexArrayObject | null = null;
  private fullscreenVbo: WebGLBuffer | null = null;

  private spriteVao: WebGLVertexArrayObject | null = null;
  private spriteCornerVbo: WebGLBuffer | null = null;
  private spriteInstanceVbo: WebGLBuffer | null = null;
  private spriteInstanceScratch = new Float32Array(
    MAX_BATCH_INSTANCES * INSTANCE_FLOATS,
  );

  private dynamicVao: WebGLVertexArrayObject | null = null;
  private dynamicVbo: WebGLBuffer | null = null;

  private solidVao: WebGLVertexArrayObject | null = null;
  private solidVbo: WebGLBuffer | null = null;
  private solidVerts: number[] = [];

  private textures = new Map<string, UploadedTexture>();
  private fallbackTexture: UploadedTexture | null = null;
  private builtinFontSpec: BitmapFontSpec;
  private builtinFontTexture: UploadedTexture | null = null;
  private builtinFontRgba: Uint8Array;

  private readonly screenProjMatrix = createOrthoMatrix(
    0,
    VIRTUAL_WIDTH,
    VIRTUAL_HEIGHT,
    0,
  );

  constructor() {
    const builtin = createBuiltinPixelFont();
    this.builtinFontSpec = builtin.spec;
    this.builtinFontRgba = builtin.rgba;
  }

  public init(canvas: HTMLCanvasElement, vault: VaultAssetBundle): void {
    this.dispose();
    this.canvas = canvas;
    this.vault = vault;
    this.webglErrors = 0;
    this.cameraInitialized = false;
    this.frameDeltasMs = [];
    this.lastFrameTimestampMs = 0;

    canvas.style.imageRendering = 'pixelated';
    if (canvas.width <= 0 || canvas.height <= 0) {
      canvas.width = VIRTUAL_WIDTH;
      canvas.height = VIRTUAL_HEIGHT;
    }

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: true,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });

    if (!gl) {
      this.init2dFallback(canvas);
      return;
    }

    this.gl = gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    this.batchProg = this.compileProgram(gl, BATCH_VERT, BATCH_FRAG);
    this.batchReflectProg = this.compileProgram(
      gl,
      BATCH_REFLECT_VERT,
      BATCH_REFLECT_FRAG,
    );
    this.postWaterProg = this.compileProgram(
      gl,
      POST_WATER_VERT,
      POST_WATER_FRAG,
    );
    this.fontProg = this.compileProgram(gl, FONT_VERT, FONT_FRAG);
    this.comboFontProg = this.compileProgram(gl, FONT_VERT, COMBO_FONT_FRAG);
    this.pauseLinesProg = this.compileProgram(
      gl,
      PAUSE_LINES_VERT,
      PAUSE_LINES_FRAG,
    );
    this.solidProg = this.compileProgram(gl, SOLID_VERT, SOLID_FRAG);
    this.outpassProg = this.compileProgram(gl, OUTPASS_VERT, OUTPASS_FRAG);
    // Compiled strictly after outpassProg (index 8) to preserve program indices 0..7
    this.menuBatchProg = this.compileProgram(
      gl,
      BATCH_MENU_VERT,
      BATCH_MENU_FRAG,
    );

    this.defaultFbo = this.createFbo(gl, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
    this.comboFbo = this.createFbo(gl, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);

    this.createGeometryBuffers(gl);
    this.uploadVaultTextures(gl, vault);
    this.drainGlErrors(gl);
  }

  public reloadVault(vault: VaultAssetBundle): void {
    this.vault = vault;
    const gl = this.gl;
    if (!gl) {
      return;
    }

    const uniqueTextures = new Set<WebGLTexture>();
    for (const uploaded of this.textures.values()) {
      uniqueTextures.add(uploaded.texture);
    }
    for (const tex of uniqueTextures) {
      gl.deleteTexture(tex);
    }
    this.textures.clear();

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.uploadVaultTextures(gl, vault);
    this.drainGlErrors(gl);
  }

  public registerPalettes(palettes: readonly PaletteDefinition[]): void {
    this.customPalettes = [...palettes];
  }

  public registerCustomPalette(palette: PaletteDefinition): void {
    const sanitized = sanitizeCustomPalette(palette);
    if (!sanitized) return;
    const idx = this.customPalettes.findIndex((p) => p.id === sanitized.id);
    if (idx >= 0) {
      this.customPalettes[idx] = sanitized;
    } else {
      this.customPalettes.push(sanitized);
    }
    if (this.activePalette.id === sanitized.id) {
      this.activePalette = sanitized;
    }
  }

  public setShaderFx(fx: ShaderFxConfig): void {
    this.shaderFx = {
      crtScanlines: Boolean(fx.crtScanlines),
      phosphorBloom: Boolean(fx.phosphorBloom),
      speedWarp: Boolean(fx.speedWarp),
      shockwaves: Boolean(fx.shockwaves),
    };
    this.shaderFxExplicit = true;
  }

  public setHangarHudPass(pass: HangarHudPass | null): void {
    this.hangarHudPass = pass;
  }

  public listPalettes(): readonly PaletteDefinition[] {
    const merged: PaletteDefinition[] = [
      ...PALETTES,
      ...ACT2_BONUS_PALETTES,
      createDefaultCustomPalette(),
    ];
    for (const p of this.customPalettes) {
      const existingIdx = merged.findIndex((existing) => existing.id === p.id);
      if (existingIdx >= 0) {
        merged[existingIdx] = p;
      } else {
        merged.push(p);
      }
    }
    return merged;
  }

  public setPalette(paletteId: string): void {
    const all = this.listPalettes();
    const found = all.find((p) => p.id === paletteId);
    this.activePalette = found ?? getPaletteById(paletteId);
  }

  public getPalette(): PaletteDefinition {
    return this.activePalette;
  }

  public resize(width: number, height: number): void {
    if (!this.canvas) return;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  public getFrameMetrics(): FrameMetrics {
    const samples = this.frameDeltasMs;
    let avg = 16.67;
    let p95 = 16.67;
    if (samples.length > 0) {
      let sum = 0;
      for (const s of samples) sum += s;
      avg = sum / samples.length;
      const sorted = [...samples].sort((a, b) => a - b);
      const p95Idx = Math.min(
        sorted.length - 1,
        Math.floor(sorted.length * 0.95),
      );
      p95 = sorted[p95Idx] ?? avg;
    }
    const fps = avg > 0.001 ? 1000 / avg : 60;

    return {
      fps,
      avgFrameDeltaMs: avg,
      p95FrameDeltaMs: p95,
      drawCalls: this.lastFrameDrawCalls,
      webglErrors: this.webglErrors,
      virtualWidth: VIRTUAL_WIDTH,
      virtualHeight: VIRTUAL_HEIGHT,
      canvasWidth: this.canvas?.width ?? VIRTUAL_WIDTH,
      canvasHeight: this.canvas?.height ?? VIRTUAL_HEIGHT,
      activePaletteId: this.activePalette.id,
    };
  }

  public getLastPostUniforms(): PostShaderUniforms {
    return this.lastPostUniforms;
  }

  public render(
    snapshot: SimSnapshot,
    prevSnapshot: SimSnapshot,
    alpha: number,
    hangarUi: HangarUiState | null,
    elapsedSec: number,
  ): void {
    this.recordFrameTiming();
    this.frameDrawCalls = 0;

    const clampedAlpha = clamp(alpha, 0, 1);
    const snapChangedPhase =
      snapshot.tick <= 1 ||
      snapshot.phase !== prevSnapshot.phase ||
      snapshot.phase !== this.lastPhase;
    this.lastPhase = snapshot.phase;

    let playerX = snapshot.player.x;
    let playerY = snapshot.player.y;
    let playerAngleDeg = snapshot.player.angleDeg;

    if (!snapChangedPhase && snapshot.phase !== 'hangar') {
      playerX = lerp(prevSnapshot.player.x, snapshot.player.x, clampedAlpha);
      playerY = lerp(prevSnapshot.player.y, snapshot.player.y, clampedAlpha);
      playerAngleDeg = lerpAngleDeg(
        prevSnapshot.player.angleDeg,
        snapshot.player.angleDeg,
        clampedAlpha,
      );
    }

    let interpPlayer2: PlayerState | null | undefined = snapshot.player2;
    if (snapshot.player2) {
      const prevP2 = prevSnapshot.player2;
      if (!snapChangedPhase && snapshot.phase !== 'hangar' && prevP2) {
        interpPlayer2 = {
          ...snapshot.player2,
          x: lerp(prevP2.x, snapshot.player2.x, clampedAlpha),
          y: lerp(prevP2.y, snapshot.player2.y, clampedAlpha),
          angleDeg: lerpAngleDeg(
            prevP2.angleDeg,
            snapshot.player2.angleDeg,
            clampedAlpha,
          ),
        };
      }
    }

    const is2PCameraMode =
      Boolean(interpPlayer2 && interpPlayer2.alive && snapshot.player.alive) &&
      (snapshot.activeMods === undefined ||
        (snapshot.activeMods.moddedEnabled &&
          (snapshot.activeMods.multiplayerMode === 'coop2p' ||
            snapshot.activeMods.multiplayerMode === 'dogfight1v1')));

    if (snapshot.phase === 'hangar') {
      this.camX = elapsedSec * 18;
      this.camY = -120;
      this.cameraInitialized = true;
    } else if (snapshot.phase === 'launching') {
      const targetCamX = playerX + clamp(snapshot.player.vx * 8, -80, 80);
      const targetCamY = clamp(
        playerY - 30,
        snapshot.spaceLevel + 60,
        -60,
      );
      if (!this.cameraInitialized || prevSnapshot.phase === 'hangar') {
        this.camX = targetCamX;
        this.camY = Math.min(-80, targetCamY);
        this.cameraInitialized = true;
      } else {
        this.camX = lerp(this.camX, targetCamX, 0.16);
        this.camY = lerp(this.camY, targetCamY, 0.15);
      }
    } else if (snapshot.phase === 'dying' || snapshot.phase === 'gameover') {
      const targetCamX = playerX + clamp(snapshot.player.vx * 4, -50, 50);
      const targetCamY = clamp(
        playerY,
        snapshot.spaceLevel + 80,
        -35,
      );
      if (!this.cameraInitialized) {
        this.camX = targetCamX;
        this.camY = targetCamY;
        this.cameraInitialized = true;
      } else {
        this.camX = lerp(this.camX, targetCamX, 0.045);
        this.camY = lerp(this.camY, targetCamY, 0.045);
      }
    } else if (is2PCameraMode && interpPlayer2) {
      const midX = (playerX + interpPlayer2.x) * 0.5;
      const midY = (playerY + interpPlayer2.y) * 0.5;
      const clampedMidX = clamp(midX, playerX - 210, playerX + 210);
      const clampedMidY = clamp(midY, playerY - 135, playerY + 135);
      const targetCamX = clamp(
        clampedMidX + snapshot.player.vx * 6,
        playerX - 220,
        playerX + 220,
      );
      const targetCamY = clamp(
        clamp(clampedMidY, snapshot.spaceLevel + 60, 85),
        playerY - 140,
        playerY + 140,
      );
      if (!this.cameraInitialized || prevSnapshot.phase === 'hangar') {
        this.camX = targetCamX;
        this.camY = targetCamY;
        this.cameraInitialized = true;
      } else {
        this.camX = lerp(this.camX, targetCamX, 0.14);
        this.camY = lerp(this.camY, targetCamY, 0.14);
      }
    } else {
      const targetCamX = playerX + clamp(snapshot.player.vx * 13, -110, 110);
      const maxCamY = playerY > 0 ? 95 : 55;
      const targetCamY = clamp(
        playerY + clamp(snapshot.player.vy * 9, -70, 70),
        snapshot.spaceLevel + 60,
        maxCamY,
      );
      if (
        !this.cameraInitialized ||
        (snapChangedPhase && prevSnapshot.phase !== 'launching')
      ) {
        this.camX = targetCamX;
        this.camY = targetCamY;
        this.cameraInitialized = true;
      } else {
        this.camX = lerp(this.camX, targetCamX, 0.15);
        this.camY = lerp(this.camY, targetCamY, 0.13);
      }
    }

    const shakeAmp =
      snapshot.phase === 'hangar'
        ? 0
        : Math.min(24, snapshot.screenShake * 3.5);
    const shakeX =
      shakeAmp * Math.sin(elapsedSec * 73.1 + snapshot.tick * 1.7);
    const shakeY =
      shakeAmp * Math.cos(elapsedSec * 91.7 + snapshot.tick * 2.3);
    const renderCamX = Math.round(this.camX + shakeX);
    const renderCamY = Math.round(this.camY + shakeY);

    const interpSnapshot: SimSnapshot =
      snapshot.phase === 'hangar'
        ? snapshot
        : {
            ...snapshot,
            player: {
              ...snapshot.player,
              x: playerX,
              y: playerY,
              angleDeg: playerAngleDeg,
            },
            player2: interpPlayer2,
          };

    // Resolve Act II Shader FX (strictly 0 in Vanilla 1:1 mode)
    if (!snapshot.activeMods?.moddedEnabled) {
      this.effectiveFx = { ...DEFAULT_SHADER_FX };
    } else if (this.shaderFxExplicit) {
      this.effectiveFx = { ...this.shaderFx };
    } else {
      this.effectiveFx = { ...snapshot.activeMods.shaderFx };
    }

    this.renderElapsedSec = elapsedSec;
    const pSpd = Math.hypot(snapshot.player.vx, snapshot.player.vy);
    const pMaxSpd = Math.max(4, snapshot.player.engineSpec.maximumspeed || 10);
    this.renderSpeedNorm =
      snapshot.phase === 'hangar' ? 0 : clamp(pSpd / pMaxSpd, 0, 1);

    this.renderShockwaves = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    if (
      this.effectiveFx.shockwaves &&
      snapshot.phase !== 'hangar' &&
      snapshot.shockwaves &&
      snapshot.shockwaves.length > 0
    ) {
      const activeSw = snapshot.shockwaves
        .filter((sw) => sw.intensity > 0.001)
        .slice(0, 4);
      for (let i = 0; i < activeSw.length; i++) {
        const sw = activeSw[i]!;
        const uvX = 0.5 + (sw.x - renderCamX) / VIRTUAL_WIDTH;
        const uvY = 0.5 + (renderCamY - sw.y) / VIRTUAL_HEIGHT;
        const radiusNorm = Math.max(0, sw.radius) / VIRTUAL_HEIGHT;
        const intensity = clamp(sw.intensity, 0, 2);
        this.renderShockwaves[i] = [uvX, uvY, radiusNorm, intensity];
      }
    }

    const viewportW = this.canvas?.width ?? VIRTUAL_WIDTH;
    const viewportH = this.canvas?.height ?? VIRTUAL_HEIGHT;
    this.lastPostUniforms = computePostShaderUniforms(
      interpSnapshot,
      renderCamX,
      renderCamY,
      elapsedSec,
      this.activePalette,
      viewportW,
      viewportH,
    );

    if (this.gl && this.defaultFbo && this.comboFbo) {
      this.renderWebGL2(
        interpSnapshot,
        prevSnapshot,
        clampedAlpha,
        hangarUi,
        elapsedSec,
        renderCamX,
        renderCamY,
      );
      this.drainGlErrors(this.gl);
    } else if (this.fallback2d) {
      this.render2dFallback(
        interpSnapshot,
        hangarUi,
        elapsedSec,
        renderCamX,
        renderCamY,
      );
    }

    this.lastFrameDrawCalls = this.frameDrawCalls;
  }

  public dispose(): void {
    const gl = this.gl;
    if (gl) {
      const programs = [
        this.batchProg,
        this.batchReflectProg,
        this.postWaterProg,
        this.fontProg,
        this.comboFontProg,
        this.pauseLinesProg,
        this.solidProg,
        this.outpassProg,
        this.menuBatchProg,
      ];
      for (const p of programs) {
        if (p) gl.deleteProgram(p.program);
      }

      for (const fbo of [this.defaultFbo, this.comboFbo]) {
        if (fbo) {
          gl.deleteFramebuffer(fbo.framebuffer);
          gl.deleteTexture(fbo.colorTexture);
          gl.deleteRenderbuffer(fbo.depthRenderbuffer);
        }
      }

      const uniqueTextures = new Set<WebGLTexture>();
      for (const t of this.textures.values()) {
        uniqueTextures.add(t.texture);
      }
      for (const tex of uniqueTextures) {
        gl.deleteTexture(tex);
      }
      if (this.fallbackTexture) gl.deleteTexture(this.fallbackTexture.texture);
      if (this.builtinFontTexture) {
        gl.deleteTexture(this.builtinFontTexture.texture);
      }

      if (this.fullscreenVao) gl.deleteVertexArray(this.fullscreenVao);
      if (this.fullscreenVbo) gl.deleteBuffer(this.fullscreenVbo);
      if (this.spriteVao) gl.deleteVertexArray(this.spriteVao);
      if (this.spriteCornerVbo) gl.deleteBuffer(this.spriteCornerVbo);
      if (this.spriteInstanceVbo) gl.deleteBuffer(this.spriteInstanceVbo);
      if (this.dynamicVao) gl.deleteVertexArray(this.dynamicVao);
      if (this.dynamicVbo) gl.deleteBuffer(this.dynamicVbo);
      if (this.solidVao) gl.deleteVertexArray(this.solidVao);
      if (this.solidVbo) gl.deleteBuffer(this.solidVbo);
    }

    this.textures.clear();
    this.fallbackTexture = null;
    this.builtinFontTexture = null;
    this.defaultFbo = null;
    this.comboFbo = null;
    this.gl = null;
    this.fallback2d = null;
    this.fallbackOffscreen = null;
    this.fallbackOffscreenCtx = null;
  }

  private recordFrameTiming(): void {
    const now =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this.lastFrameTimestampMs > 0) {
      const dt = Math.max(0.1, Math.min(250, now - this.lastFrameTimestampMs));
      this.frameDeltasMs.push(dt);
      if (this.frameDeltasMs.length > 60) {
        this.frameDeltasMs.shift();
      }
    }
    this.lastFrameTimestampMs = now;
  }

  private renderWebGL2(
    snapshot: SimSnapshot,
    prevSnapshot: SimSnapshot,
    alpha: number,
    hangarUi: HangarUiState | null,
    elapsedSec: number,
    camX: number,
    camY: number,
  ): void {
    const gl = this.gl!;
    const defaultFbo = this.defaultFbo!;
    const comboFbo = this.comboFbo!;

    const worldProj = createOrthoMatrix(
      camX - VIRTUAL_WIDTH * 0.5,
      camX + VIRTUAL_WIDTH * 0.5,
      camY + VIRTUAL_HEIGHT * 0.5,
      camY - VIRTUAL_HEIGHT * 0.5,
    );

    // 1. Collect world sprites for colorpass + reflectpass
    const skyBgSprites: SpriteInstance[] = [];
    const oceanLineSprites: SpriteInstance[] = [];
    const foregroundSprites: SpriteInstance[] = [];
    const underwaterSprites: SpriteInstance[] = [];
    const reflectSprites: SpriteInstance[] = [];
    const worldSolidQuads: number[] = [];

    this.collectWorldScene(
      snapshot,
      prevSnapshot,
      alpha,
      elapsedSec,
      camX,
      camY,
      skyBgSprites,
      oceanLineSprites,
      foregroundSprites,
      underwaterSprites,
      reflectSprites,
      worldSolidQuads,
    );

    // True depth ordering (largest depth = farthest background drawn first; smallest = closest foreground last)
    const sortBackToFront = (a: SpriteInstance, b: SpriteInstance): number =>
      b.depth - a.depth;
    if (skyBgSprites.length > 1) skyBgSprites.sort(sortBackToFront);
    if (foregroundSprites.length > 1) foregroundSprites.sort(sortBackToFront);
    if (underwaterSprites.length > 1) underwaterSprites.sort(sortBackToFront);
    if (reflectSprites.length > 1) reflectSprites.sort(sortBackToFront);

    const spritesAtlas = this.vault?.data.atlases.sprites;
    const spritesTex = this.resolveAtlasTexture(spritesAtlas, [
      'sprites',
      'sheet1grey',
      'sheet1grey.png',
    ]);

    // --- colorpass + reflectpass into defaultFbo (600x400) ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, defaultFbo.framebuffer);
    gl.viewport(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (this.batchProg) {
      // Sky background (space_clouds_blank, space_clouds, parallax_clouds, bg_* props, clouds)
      if (skyBgSprites.length > 0) {
        this.drawSpriteBatch(
          gl,
          this.batchProg,
          spritesTex,
          worldProj,
          skyBgSprites,
          true,
        );
      }
      // Above-sea foreground (launch sub, surfaced subs/ships, enemies, smoke behind player, player, projectiles, flashes, explosions)
      if (foregroundSprites.length > 0) {
        this.drawSpriteBatch(
          gl,
          this.batchProg,
          spritesTex,
          worldProj,
          foregroundSprites,
          true,
        );
      }
    }

    if (worldSolidQuads.length > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.flushSolidArray(gl, worldSolidQuads, worldProj);
      gl.disable(gl.BLEND);
    }

    // Complete depth-sorted water reflection pass below y = 0
    if (this.batchReflectProg && reflectSprites.length > 0) {
      this.drawSpriteBatch(
        gl,
        this.batchReflectProg,
        spritesTex,
        worldProj,
        reflectSprites,
        false,
      );
    }

    // Submerged entities (diving subs ey > 1, underwater player) & underwater particles over water reflections
    if (this.batchProg && underwaterSprites.length > 0) {
      this.drawSpriteBatch(
        gl,
        this.batchProg,
        spritesTex,
        worldProj,
        underwaterSprites,
        false,
      );
    }

    // Ocean horizon line rendered UNCLIPPED at y = seaLevel (glDepth 0.5050: crisp waterline over hull/reflection seam)
    if (this.batchProg && oceanLineSprites.length > 0) {
      this.drawSpriteBatch(
        gl,
        this.batchProg,
        spritesTex,
        worldProj,
        oceanLineSprites,
        false,
      );
    }

    // Nuke sprite sequence (16-frame mushroom cloud + ocean reflection)
    if (snapshot.player.nukeTriggered && snapshot.phase !== 'hangar') {
      this.drawNukeSequence(gl, snapshot, worldProj);
    }

    // --- combopass (post.shader water + quantized health circle) into comboFbo ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, comboFbo.framebuffer);
    gl.viewport(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (this.postWaterProg) {
      this.drawPostWaterPass(gl, this.postWaterProg, defaultFbo.colorTexture);
    }

    // --- hudpass / pausePass / menuPass into comboFbo ---
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const overlayPass = this.hangarHudPass ?? defaultHangarHudPass;
    if (overlayPass) {
      const ctx = this.buildHangarHudContext(gl);
      if (snapshot.phase === 'hangar' && hangarUi) {
        overlayPass.drawHangarMenuPass(ctx, snapshot, hangarUi, elapsedSec);
      } else {
        overlayPass.drawInGameHudPass(ctx, snapshot, elapsedSec, camX, camY);
        if (snapshot.paused) {
          overlayPass.drawPauseOverlayPass(ctx, snapshot, elapsedSec);
        }
        if (snapshot.phase === 'gameover') {
          overlayPass.drawGameOverDebriefPass(ctx, snapshot, elapsedSec);
        }
      }
    } else if (snapshot.phase === 'hangar' && hangarUi) {
      this.drawMenuPass(gl, snapshot, hangarUi, elapsedSec);
    } else {
      this.drawHudPass(gl, snapshot, elapsedSec, camX, camY);
      if (snapshot.paused) {
        this.drawPausePass(gl);
      }
      if (snapshot.phase === 'gameover') {
        this.drawGameOverCard(gl, snapshot, elapsedSec);
      }
    }

    gl.disable(gl.BLEND);

    // --- outpass: aspect-correct 600:400 NEAREST upscale to default framebuffer ---
    const canvasW = this.canvas?.width ?? VIRTUAL_WIDTH;
    const canvasH = this.canvas?.height ?? VIRTUAL_HEIGHT;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasW, canvasH);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (this.outpassProg) {
      this.drawOutpass(gl, this.outpassProg, comboFbo.colorTexture, canvasW, canvasH);
    }
  }

  private buildHangarHudContext(gl: WebGL2RenderingContext): HangarHudDrawContext {
    return {
      gl,
      activePalette: this.activePalette,
      allPalettes: this.listPalettes(),
      vault: this.vault,
      builtinFontSpec: this.builtinFontSpec,
      screenProjMatrix: this.screenProjMatrix,
      resolveFont: (primaryName, secondaryName) =>
        this.resolveFont(primaryName, secondaryName),
      resolveAtlasTexture: (atlas, preferredKeys) =>
        this.resolveAtlasTexture(atlas, preferredKeys),
      drawSpriteBatch: (tex, instances, paletteOverride, useMenuShader) => {
        const prog =
          useMenuShader && this.menuBatchProg
            ? this.menuBatchProg
            : this.batchProg;
        if (!prog || instances.length === 0) return;
        this.drawSpriteBatch(
          gl,
          prog,
          tex,
          this.screenProjMatrix,
          instances,
          false,
          paletteOverride,
        );
      },
      drawBitmapText: (font, text, x, y, scale, align, color, cutoffY) => {
        this.drawBitmapText(gl, font, text, x, y, scale, align, color, cutoffY);
      },
      drawComboText: (
        font,
        text,
        x,
        y,
        scale,
        align,
        textColor,
        fillColor,
        barhY,
      ) => {
        this.drawComboText(
          gl,
          font,
          text,
          x,
          y,
          scale,
          align,
          textColor,
          fillColor,
          barhY,
        );
      },
      drawPauseLines: (color) => {
        this.drawPauseLinesPass(gl, color);
      },
      flushSolids: (verts) => {
        this.flushSolidArray(gl, verts, this.screenProjMatrix);
      },
      resolveApexCraftSpriteName: (sprites) =>
        this.resolveApexCraftSpriteName(sprites),
      bumpDrawCall: () => {
        this.frameDrawCalls++;
      },
    };
  }

  private drawPauseLinesPass(
    gl: WebGL2RenderingContext,
    color: RgbaTuple,
  ): void {
    if (!this.pauseLinesProg) return;
    gl.useProgram(this.pauseLinesProg.program);
    gl.bindVertexArray(this.fullscreenVao);
    this.setUniform4f(
      gl,
      this.pauseLinesProg,
      'uLineColor',
      color[0],
      color[1],
      color[2],
      color[3],
    );
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.frameDrawCalls++;
    gl.bindVertexArray(null);
  }

  private collectWorldScene(
    snapshot: SimSnapshot,
    prevSnapshot: SimSnapshot,
    alpha: number,
    elapsedSec: number,
    camX: number,
    camY: number,
    skyBgOut: SpriteInstance[],
    oceanLineOut: SpriteInstance[],
    foregroundOut: SpriteInstance[],
    underwaterOut: SpriteInstance[],
    reflectOut: SpriteInstance[],
    solidWorldOut: number[],
  ): void {
    const sprites = this.vault?.data.atlases.sprites.sprites ?? {};
    const tickTime = snapshot.tick + alpha;

    // 1. Space clouds ceiling at y = spaceLevel + solid space_clouds_blank upper bank above it
    // Matches reference layering: rear parallax bank (f2 idx6 pale haze in Normal, f1 in SFMT) +
    // foreground bright crest (f0 idx7 pure white, +300px offset) + solid white space_clouds_blank cap.
    const spaceClouds = sprites['space_clouds'];
    const spaceCloudsBlank = sprites['space_clouds_blank'];
    if (
      (spaceClouds || spaceCloudsBlank) &&
      camY - VIRTUAL_HEIGHT * 0.5 <= snapshot.spaceLevel + 180
    ) {
      const step = Math.max(
        200,
        spaceClouds?.size[0] ?? spaceCloudsBlank?.size[0] ?? 600,
      );
      const camTop = camY - VIRTUAL_HEIGHT * 0.5;
      const spaceFrameCount = Math.max(1, spaceClouds?.subs.length ?? 1);

      // Rear space cloud haze (0.5x X parallax, f2 = idx 6 pale haze; never draws crimson f1 in Normal!)
      if (spaceClouds && spaceFrameCount >= 2) {
        const rearFrame =
          snapshot.mode === 'sfmt' ? 1 : Math.min(2, spaceFrameCount - 1);
        const rearParallaxX = camX * 0.5;
        const rearMinTile = Math.floor(
          (camX - rearParallaxX - VIRTUAL_WIDTH) / step,
        );
        const rearMaxTile = Math.ceil(
          (camX - rearParallaxX + VIRTUAL_WIDTH) / step,
        );
        const rearY = snapshot.spaceLevel - 30 - camTop * 0.025;
        for (let tile = rearMinTile; tile <= rearMaxTile; tile++) {
          skyBgOut.push({
            entry: spaceClouds,
            frame: rearFrame,
            x: rearParallaxX + tile * step,
            y: rearY,
            angleRad: 0,
            scaleX: 1,
            scaleY: 1,
            depth: 0.92,
            flash: 0,
            clipSea: true,
          });
        }
      }

      // Solid white upper space cap + crisp bright white foreground cloud bank (f0, +300px offset)
      const minTile = Math.floor((camX - VIRTUAL_WIDTH - 300) / step);
      const maxTile = Math.ceil((camX + VIRTUAL_WIDTH + 300) / step);
      const capY = snapshot.spaceLevel - 20;

      for (let tile = minTile; tile <= maxTile; tile++) {
        const tx = tile * step;
        if (spaceCloudsBlank) {
          skyBgOut.push({
            entry: spaceCloudsBlank,
            frame: 0,
            x: tx,
            y: capY,
            angleRad: 0,
            scaleX: step / Math.max(1, spaceCloudsBlank.size[0]),
            scaleY: 400,
            depth: 0.9,
            flash: 0,
            clipSea: true,
          });
        }
        if (spaceClouds) {
          skyBgOut.push({
            entry: spaceClouds,
            frame: 0,
            x: tx + 300,
            y: capY,
            angleRad: 0,
            scaleX: 1,
            scaleY: 1,
            depth: 0.88,
            flash: 0,
            clipSea: true,
          });
        }
      }
    }

    // 2. Lush multi-altitude midground parallax clouds (index 6)
    const paraClouds = sprites['parallax_clouds'];
    if (paraClouds) {
      const parallaxX = camX * 0.62;
      const cellW = 190;
      const minBand = Math.floor((camX - parallaxX - 460) / cellW);
      const maxBand = Math.ceil((camX - parallaxX + 460) / cellW);
      const yRows = [-125, -295, -495, -715, -945, -1155];
      const paraFrameCount = Math.max(1, paraClouds.subs.length);
      for (let r = 0; r < yRows.length; r++) {
        const bandY = yRows[r] ?? -300;
        if (Math.abs(bandY - camY) > 360) continue;
        for (let b = minBand; b <= maxBand; b++) {
          const hash = ((b * 73856093) ^ (r * 19349663) ^ 0x5bd1e995) & 0x7fffffff;
          if ((hash % 11) === 0) continue; // subtle open pockets
          const drift = elapsedSec * (3.2 + (r % 3) * 1.1);
          const cx = parallaxX + b * cellW + (hash % 115) - 35 - drift;
          const cy = bandY + ((hash >> 5) % 84) - 42;
          skyBgOut.push({
            entry: paraClouds,
            frame: hash % paraFrameCount,
            x: cx,
            y: cy,
            angleRad: 0,
            scaleX: (hash & 1) === 0 ? 1 : -1,
            scaleY: 1,
            depth: 0.85,
            flash: 0,
            clipSea: true,
          });
          // Natural cluster companion puff on ~45% of cells
          if ((hash & 7) < 3) {
            skyBgOut.push({
              entry: paraClouds,
              frame: (hash + 2) % paraFrameCount,
              x: cx + 44 + ((hash >> 9) % 36),
              y: cy + ((hash >> 12) % 30) - 15,
              angleRad: 0,
              scaleX: (hash & 2) === 0 ? 1 : -1,
              scaleY: 1,
              depth: 0.848,
              flash: 0,
              clipSea: true,
            });
          }
        }
      }
    }

    // 3. Distant parallax background props (bg_boat, bg_sub, bg_blimp, bg_jet + bg_jet_trail, bg_plane, bg_ace)
    const bgJetTrailEntry = sprites['bg_jet_trail'];
    for (const rawP of snapshot.parallax) {
      const p = rawP as ParallaxVisualExtras;
      const entry = sprites[p.spriteName];
      const py = p.y;
      const pAngleRad = (p.angleDeg ?? 0) * DEG_TO_RAD;
      const pScaleX = p.reversed ? -1 : 1;
      const pDepth = clamp(0.79 + (p.depth || 8) * 0.003, 0.78, 0.84);

      if (p.spriteName === 'bg_jet' && bgJetTrailEntry) {
        skyBgOut.push({
          entry: bgJetTrailEntry,
          frame: 0,
          x: p.x,
          y: py,
          angleRad: pAngleRad,
          scaleX: pScaleX,
          scaleY: 1,
          depth: pDepth + 0.005,
          flash: 0,
          clipSea: true,
        });
      }

      if (entry) {
        skyBgOut.push({
          entry,
          frame: p.frame,
          x: p.x,
          y: py,
          angleRad: pAngleRad,
          scaleX: pScaleX,
          scaleY: 1,
          depth: pDepth,
          flash: 0,
          clipSea: true,
        });
      } else {
        this.pushWorldFallbackRect(
          solidWorldOut,
          p.x,
          py,
          28,
          10,
          pAngleRad,
          this.activePalette.colors[4],
        );
      }
    }

    // 4. Lush billowing foreground cumulus clouds (352x192, index 7, reflected as index 6)
    const fgClouds = sprites['clouds'];
    if (fgClouds) {
      const parallaxX = camX * 0.32;
      const cellW = 395;
      const minBand = Math.floor((camX - parallaxX - 620) / cellW);
      const maxBand = Math.ceil((camX - parallaxX + 620) / cellW);
      const yRows = [-175, -415, -670, -930, -1140];
      const fgFrameCount = Math.max(1, fgClouds.subs.length);
      for (let r = 0; r < yRows.length; r++) {
        const bandY = yRows[r] ?? -185;
        if (Math.abs(bandY - camY) > 420) continue;
        for (let b = minBand; b <= maxBand; b++) {
          const hash = ((b * 83492791) ^ (r * 297121507) ^ 0x1b873593) & 0x7fffffff;
          // Leave warm sepia sky breathing naturally between billowing cumulus clusters
          if ((hash % 6) === 0) continue;
          const drift = elapsedSec * (6.5 + r * 1.6);
          const cx = parallaxX + b * cellW + (hash % 140) - 55 - drift;
          const cy = bandY + ((hash >> 6) % 90) - 45;
          const sx = (hash & 1) === 0 ? 1 : -1;
          const inst: SpriteInstance = {
            entry: fgClouds,
            frame: hash % fgFrameCount,
            x: cx,
            y: cy,
            angleRad: 0,
            scaleX: sx,
            scaleY: 1,
            depth: 0.75 + (r % 2) * 0.002,
            flash: 0,
            clipSea: true,
          };
          skyBgOut.push(inst);
          if (cy > -380) {
            reflectOut.push(inst);
          }
        }
      }
    }

    // 5. Ocean horizon line at y = seaLevel (0), drawn UNCLIPPED across full width with gentle wave crest scroll
    const oceanLine = sprites['ocean_line'];
    if (oceanLine) {
      const w = Math.max(200, oceanLine.size[0]);
      const waveShift = (((elapsedSec * 12) % w) + w) % w;
      const startX =
        Math.floor((camX - VIRTUAL_WIDTH - waveShift) / w) * w + waveShift;
      for (let tx = startX; tx <= camX + VIRTUAL_WIDTH + w; tx += w) {
        oceanLineOut.push({
          entry: oceanLine,
          frame: Math.floor(tickTime * 0.15),
          x: tx + w * 0.5,
          y: snapshot.seaLevel,
          angleRad: 0,
          scaleX: 1,
          scaleY: 1,
          depth: 0.7,
          flash: 0,
          clipSea: false,
        });
      }
    } else {
      this.pushWorldFallbackRect(
        solidWorldOut,
        camX,
        snapshot.seaLevel,
        VIRTUAL_WIDTH + 64,
        2,
        0,
        this.activePalette.colors[7],
      );
    }

    if (snapshot.phase === 'hangar') {
      this.collectLaunchSubmarine(
        camX,
        snapshot.seaLevel,
        snapshot.seaLevel,
        0.55,
        true,
        sprites,
        foregroundOut,
        reflectOut,
        solidWorldOut,
      );
      return;
    }

    if (
      (snapshot.phase === 'launching' || snapshot.phase === 'playing') &&
      snapshot.launchSubY !== undefined
    ) {
      this.collectLaunchSubmarine(
        0,
        snapshot.launchSubY,
        snapshot.seaLevel,
        0.52,
        snapshot.launchSubY <= snapshot.seaLevel + 8,
        sprites,
        foregroundOut,
        reflectOut,
        solidWorldOut,
      );
    }

    // 6. PB Ghost Silhouette & dotted index-4 trail (Act II)
    if (snapshot.ghostPose?.alive) {
      this.collectGhostPose(snapshot.ghostPose, solidWorldOut);
    }

    // 7. Enemies
    const prevEnemyMap = new Map<number, EnemyEntity>();
    for (const pe of prevSnapshot.enemies) {
      prevEnemyMap.set(pe.id, pe);
    }

    for (const enemy of snapshot.enemies) {
      this.collectEnemySprites(
        enemy,
        prevEnemyMap.get(enemy.id),
        alpha,
        snapshot.tick,
        sprites,
        foregroundOut,
        underwaterOut,
        reflectOut,
        solidWorldOut,
      );
    }

    // 8. Player 1 & Player 2
    if (snapshot.player.alive) {
      this.collectCraftSprites(
        snapshot.player,
        snapshot.tick,
        false,
        snapshot.activeMods?.multiplayerMode ?? 'solo',
        sprites,
        foregroundOut,
        underwaterOut,
        reflectOut,
        solidWorldOut,
      );
    }
    if (snapshot.player2?.alive) {
      this.collectCraftSprites(
        snapshot.player2,
        snapshot.tick,
        true,
        snapshot.activeMods?.multiplayerMode ?? 'coop2p',
        sprites,
        foregroundOut,
        underwaterOut,
        reflectOut,
        solidWorldOut,
      );
    }

    // 9. Projectiles
    const prevProjMap = new Map<number, ProjectileEntity>();
    for (const pp of prevSnapshot.projectiles) {
      prevProjMap.set(pp.id, pp);
    }

    for (const proj of snapshot.projectiles) {
      this.collectProjectileSprites(
        proj,
        prevProjMap.get(proj.id),
        alpha,
        snapshot.tick,
        sprites,
        foregroundOut,
        underwaterOut,
        reflectOut,
        solidWorldOut,
      );
    }

    // 10. Particles, muzzle flashes, wakes, wrecks & explosions
    for (const part of snapshot.particles) {
      this.collectParticleSprites(
        part,
        sprites,
        foregroundOut,
        underwaterOut,
        reflectOut,
        solidWorldOut,
      );
    }
  }

  private collectLaunchSubmarine(
    subX: number,
    subY: number,
    seaLevel: number,
    depth: number,
    shouldReflect: boolean,
    sprites: Record<string, SpriteEntry>,
    mainOut: SpriteInstance[],
    reflectOut: SpriteInstance[],
    solidWorldOut: number[],
  ): void {
    const subEntry = sprites['submarine'];
    if (subEntry) {
      const inst: SpriteInstance = {
        entry: subEntry,
        frame: 0,
        x: subX,
        y: subY,
        angleRad: 0,
        scaleX: 1,
        scaleY: 1,
        depth,
        flash: 0,
        clipSea: true,
      };
      mainOut.push(inst);
      if (shouldReflect) {
        reflectOut.push(inst);
      }
      return;
    }

    // Clean dark silhouette fallback (160x22 hull + 36x14 conning tower) above seaLevel
    const hullTop = subY - 22;
    const hullBottom = Math.min(seaLevel, subY);
    if (hullBottom > hullTop) {
      const hullH = hullBottom - hullTop;
      this.pushWorldFallbackRect(
        solidWorldOut,
        subX,
        hullTop + hullH * 0.5,
        160,
        hullH,
        0,
        this.activePalette.colors[1],
      );
    }

    const towerTop = subY - 36;
    const towerBottom = Math.min(seaLevel, subY - 22);
    if (towerBottom > towerTop) {
      const towerH = towerBottom - towerTop;
      this.pushWorldFallbackRect(
        solidWorldOut,
        subX,
        towerTop + towerH * 0.5,
        36,
        towerH,
        0,
        this.activePalette.colors[1],
      );
    }
  }

  private collectGhostPose(
    ghost: NonNullable<SimSnapshot['ghostPose']>,
    solidWorldOut: number[],
  ): void {
    const c4 = this.activePalette.colors[4];
    const c6 = this.activePalette.colors[6];
    const trailCol: RgbaTuple = [c4[0], c4[1], c4[2], 0.72];
    const bodyCol: RgbaTuple = [c4[0], c4[1], c4[2], 0.82];
    const trimCol: RgbaTuple = [c6[0], c6[1], c6[2], 0.65];

    // Dotted index-4 trail markers
    const step = ghost.trail.length > 36 ? 2 : 1;
    for (let i = 0; i < ghost.trail.length; i += step) {
      const pt = ghost.trail[i];
      if (!pt) continue;
      this.pushWorldFallbackRect(solidWorldOut, pt.x, pt.y, 3, 3, 0, trailCol);
    }

    // Ghost craft silhouette
    const rad = ghost.angleDeg * DEG_TO_RAD;
    this.pushWorldFallbackRect(solidWorldOut, ghost.x, ghost.y, 20, 7, rad, bodyCol);
    this.pushWorldFallbackRect(solidWorldOut, ghost.x, ghost.y, 9, 20, rad, trimCol);
    if (ghost.boosting) {
      const tailX = ghost.x - Math.cos(rad) * 14;
      const tailY = ghost.y - Math.sin(rad) * 14;
      this.pushWorldFallbackRect(solidWorldOut, tailX, tailY, 8, 4, rad, trimCol);
    }
  }

  private computeEnemyGunRecoilFrame(enemy: EnemyVisualExtras): number {
    if (typeof enemy.gunAnimFrame === 'number') {
      return clamp(Math.floor(enemy.gunAnimFrame), 0, 5);
    }
    if (typeof enemy.gunRecoilTicks === 'number' && enemy.gunRecoilTicks > 0) {
      return clamp(Math.ceil((enemy.gunRecoilTicks / 10) * 5), 1, 5);
    }
    if (enemy.salvoRemaining > 0 && enemy.salvoCooldown <= 5) {
      return clamp(6 - Math.max(1, enemy.salvoCooldown), 1, 5);
    }
    return 0;
  }

  private collectEnemySprites(
    enemyRaw: EnemyEntity,
    prevEnemy: EnemyEntity | undefined,
    alpha: number,
    tick: number,
    sprites: Record<string, SpriteEntry>,
    mainOut: SpriteInstance[],
    underwaterOut: SpriteInstance[],
    reflectOut: SpriteInstance[],
    solidWorldOut: number[],
  ): void {
    const enemy = enemyRaw as EnemyVisualExtras;
    const canInterp =
      prevEnemy &&
      Math.hypot(enemy.x - prevEnemy.x, enemy.y - prevEnemy.y) < 120;
    const ex = canInterp ? lerp(prevEnemy.x, enemy.x, alpha) : enemy.x;
    const ey = canInterp ? lerp(prevEnemy.y, enemy.y, alpha) : enemy.y;
    const hullTransform = resolveEnemyRenderTransform(enemy);
    const angleRad = hullTransform.angleRad;
    const isColossal =
      enemy.kind === 'Blimp' ||
      enemy.kind === 'SkyCarrier' ||
      enemy.kind === 'BigBoat' ||
      enemy.kind === 'Dreadnought';
    const flash =
      enemy.flashTicks > 0 &&
      (isColossal ? tick % 6 < 2 : enemy.flashTicks % 2 === 1)
        ? 1
        : 0;

    const isSub = enemy.kind === 'Submarine' || enemy.kind === 'AceMarine';
    // Surfaced submarines (ey <= 1) render in foregroundSprites (depth 0.48) so splashes & flashes draw IN FRONT
    // identically above & below water; only diving subs (ey > 1) use the underwater pass.
    const isDivingSub = isSub && ey > 1;
    const targetList = isDivingSub ? underwaterOut : mainOut;
    const clipSea = !isDivingSub;
    const gunFrame = this.computeEnemyGunRecoilFrame(enemy);

    const pushOrFallback = (
      spriteName: string | undefined,
      px: number,
      py: number,
      rotRad: number,
      frame: number,
      fallbackW: number,
      fallbackH: number,
      color: RgbaTuple,
      scaleX = 1,
      scaleY = 1,
      depth = 0.45,
    ): void => {
      const entry = spriteName ? sprites[spriteName] : undefined;
      if (entry) {
        const inst: SpriteInstance = {
          entry,
          frame,
          x: px,
          y: py,
          angleRad: rotRad,
          scaleX,
          scaleY,
          depth,
          flash,
          clipSea,
        };
        targetList.push(inst);
        if (!isSub && py < 48) {
          reflectOut.push(inst);
        } else if (isSub && py < 36) {
          reflectOut.push(inst);
        }
      } else {
        this.pushWorldFallbackRect(
          solidWorldOut,
          px,
          py,
          fallbackW,
          fallbackH,
          rotRad,
          flash > 0 ? this.activePalette.colors[7] : color,
        );
      }
    };

    if (enemy.kind === 'Blimp' || enemy.kind === 'SkyCarrier') {
      const isCarrier = enemy.kind === 'SkyCarrier';
      const scaleMult = 1.0;
      // Note: live spawning Blimps descend from space with state==='falling'; keep blimp + blimp_anim active!
      const isSinking = enemy.state === 'sinking';
      const bodyName = isSinking
        ? 'blimp_die'
        : enemy.spriteMain || 'blimp';
      pushOrFallback(
        bodyName,
        ex,
        ey,
        hullTransform.angleRad,
        0,
        isCarrier ? 580 : 260,
        isCarrier ? 220 : 96,
        this.activePalette.colors[2],
        hullTransform.scaleX * scaleMult,
        hullTransform.scaleY * scaleMult,
        0.48,
      );
      const prop = sprites['blimp_anim'];
      if (prop && !isSinking) {
        const inst: SpriteInstance = {
          entry: prop,
          frame: tick >> 1,
          x: ex,
          y: ey,
          angleRad: hullTransform.angleRad,
          scaleX: hullTransform.scaleX * scaleMult,
          scaleY: hullTransform.scaleY * scaleMult,
          depth: 0.47,
          flash,
          clipSea: true,
        };
        mainOut.push(inst);
        reflectOut.push(inst);
      }
      if (isCarrier) {
        if (!isSinking) {
          const gunName = enemy.spriteGun || 'big_boat_gun';
          pushOrFallback(
            gunName,
            ex - 90 * hullTransform.scaleX,
            ey + 74,
            enemy.gunAngleDeg * DEG_TO_RAD,
            gunFrame,
            26,
            7,
            this.activePalette.colors[2],
            1,
            1,
            0.46,
          );
          pushOrFallback(
            gunName,
            ex + 90 * hullTransform.scaleX,
            ey + 74,
            enemy.gunAngleDeg * DEG_TO_RAD,
            gunFrame,
            26,
            7,
            this.activePalette.colors[2],
            1,
            1,
            0.46,
          );
        }
      } else if (!isSinking) {
        pushOrFallback(
          enemy.spriteGun || 'big_boat_gun',
          ex,
          ey + 68,
          enemy.gunAngleDeg * DEG_TO_RAD,
          gunFrame,
          24,
          6,
          this.activePalette.colors[2],
          1,
          1,
          0.46,
        );
      }
      return;
    }

    if (
      enemy.kind === 'Boat' ||
      enemy.kind === 'BigBoat' ||
      enemy.kind === 'Dreadnought'
    ) {
      const isDread = enemy.kind === 'Dreadnought';
      const isBig = enemy.kind === 'BigBoat' || isDread;
      const scaleMult = isDread ? 1.3 : 1.0;
      const defaultName = isBig ? 'big_boat' : 'small_boat';
      const sinkName = isBig ? 'big_boat_sink' : 'small_boat_sink';
      const bodyName =
        enemy.state === 'sinking'
          ? sinkName
          : enemy.spriteMain || defaultName;
      pushOrFallback(
        bodyName,
        ex,
        ey,
        hullTransform.angleRad,
        0,
        isDread ? 390 : isBig ? 220 : 56,
        isDread ? 66 : isBig ? 42 : 16,
        this.activePalette.colors[2],
        hullTransform.scaleX * scaleMult,
        hullTransform.scaleY * scaleMult,
        0.48,
      );

      if (enemy.state !== 'sinking') {
        const gunName =
          enemy.spriteGun || (isBig ? 'big_boat_gun' : 'small_boat_gun');
        if (isBig) {
          const turretSpread = isDread ? 72 : 55;
          const turretY = isDread ? ey - 32 : ey - 23;
          pushOrFallback(
            gunName,
            ex - turretSpread * hullTransform.scaleX,
            turretY,
            enemy.gunAngleDeg * DEG_TO_RAD,
            gunFrame,
            24,
            6,
            this.activePalette.colors[2],
            isDread ? 1.2 : 1,
            isDread ? 1.2 : 1,
            0.46,
          );
          pushOrFallback(
            gunName,
            ex + turretSpread * hullTransform.scaleX,
            turretY,
            enemy.gunAngleDeg * DEG_TO_RAD,
            gunFrame,
            24,
            6,
            this.activePalette.colors[2],
            isDread ? 1.2 : 1,
            isDread ? 1.2 : 1,
            0.46,
          );
        } else {
          pushOrFallback(
            gunName,
            ex + 3 * hullTransform.scaleX,
            ey - 14,
            enemy.gunAngleDeg * DEG_TO_RAD,
            gunFrame,
            14,
            4,
            this.activePalette.colors[2],
            1,
            1,
            0.46,
          );
        }
      }
      return;
    }

    if (enemy.kind === 'Submarine' || enemy.kind === 'AceMarine') {
      const isAce = enemy.kind === 'AceMarine';
      const baseName = isAce ? 'acemarine' : 'submarine';
      const sinkName = isAce ? 'acemarine_sink' : 'submarine_sink';
      const bodyName =
        enemy.state === 'sinking'
          ? sinkName
          : enemy.spriteMain || baseName;
      pushOrFallback(
        bodyName,
        ex,
        ey,
        hullTransform.angleRad,
        0,
        isAce ? 210 : 170,
        32,
        this.activePalette.colors[2],
        hullTransform.scaleX,
        hullTransform.scaleY,
        0.48,
      );
      if (isAce && enemy.state !== 'sinking') {
        pushOrFallback(
          enemy.spriteGun || 'big_boat_gun',
          ex,
          ey - 20,
          enemy.gunAngleDeg * DEG_TO_RAD,
          gunFrame,
          24,
          6,
          this.activePalette.colors[2],
          1,
          1,
          0.46,
        );
      }
      return;
    }

    if (enemy.kind === 'Missile') {
      pushOrFallback(
        enemy.spriteMain || 'missile',
        ex,
        ey,
        angleRad,
        0,
        20,
        8,
        this.activePalette.colors[2],
        1,
        1,
        0.43,
      );
      return;
    }

    // Airplanes: Fighter, Jet, Ace, LaserAce
    const crash = enemy.state === 'falling' && enemy.kind === 'Jet';
    const bodyName = crash ? 'jet_body_crash' : enemy.spriteMain;
    const wingsName = crash ? 'jet_wings_crash' : enemy.spriteSecondary;

    // Jet / Ace thruster flame behind aircraft body
    if (enemy.kind === 'Jet' && enemy.state !== 'falling') {
      const jetBoost = sprites['fx_jetboost'];
      if (jetBoost) {
        const inst: SpriteInstance = {
          entry: jetBoost,
          frame: tick >> 1,
          x: ex,
          y: ey,
          angleRad,
          scaleX: 1,
          scaleY: 1,
          depth: 0.45,
          flash: 0,
          clipSea: true,
        };
        mainOut.push(inst);
        reflectOut.push(inst);
      }
    } else if (
      (enemy.kind === 'Ace' || enemy.kind === 'LaserAce') &&
      (enemy.boosting ?? true)
    ) {
      const aceBoostStart = sprites['fx_aceboost_start'];
      const aceBoostLoop = sprites['fx_aceboost_loop'];
      const useStart = Boolean(aceBoostStart) && enemy.aiTimer < 8;
      const aceBoost = useStart ? aceBoostStart : aceBoostLoop;
      if (aceBoost) {
        const inst: SpriteInstance = {
          entry: aceBoost,
          frame: useStart ? enemy.aiTimer >> 1 : tick >> 1,
          x: ex,
          y: ey,
          angleRad,
          scaleX: 1,
          scaleY: 1,
          depth: 0.45,
          flash: 0,
          clipSea: true,
        };
        mainOut.push(inst);
        reflectOut.push(inst);
      }
    }

    pushOrFallback(
      bodyName,
      ex,
      ey,
      angleRad,
      0,
      enemy.width || 22,
      enemy.height || 14,
      this.activePalette.colors[2],
      1,
      1,
      0.44,
    );
    if (wingsName) {
      pushOrFallback(
        wingsName,
        ex,
        ey,
        angleRad,
        0,
        enemy.width || 22,
        enemy.height || 22,
        this.activePalette.colors[2],
        1,
        1,
        0.43,
      );
    }

    // LaserAce 6-frame laser_charge telegraph before beam fires
    if (
      enemy.kind === 'LaserAce' &&
      !enemy.laserActive &&
      (enemy.laserChargeTicks ?? 0) > 0
    ) {
      const chargeAngleRad = enemy.gunAngleDeg * DEG_TO_RAD;
      const chargeEntry = sprites['laser_charge'];
      if (chargeEntry) {
        const inst: SpriteInstance = {
          entry: chargeEntry,
          frame: Math.max(
            0,
            Math.floor((24 - (enemy.laserChargeTicks ?? 0)) / 4),
          ),
          x: ex,
          y: ey,
          angleRad: chargeAngleRad,
          scaleX: 1,
          scaleY: 1,
          depth: 0.38,
          flash: 0,
          clipSea: true,
        };
        mainOut.push(inst);
        if (ey < 16) {
          reflectOut.push(inst);
        }
      } else {
        this.pushWorldFallbackRect(
          solidWorldOut,
          ex + Math.cos(chargeAngleRad) * 14,
          ey + Math.sin(chargeAngleRad) * 14,
          12,
          12,
          chargeAngleRad,
          this.activePalette.colors[7],
        );
      }
    }

    // LaserAce active laser beam (6-frame animated projectile_Elaser)
    if (enemy.kind === 'LaserAce' && enemy.laserActive) {
      const len = Math.max(40, enemy.laserLength || 520);
      const laserAngleRad = enemy.gunAngleDeg * DEG_TO_RAD;
      const midX = ex + Math.cos(laserAngleRad) * (len * 0.5);
      const midY = ey + Math.sin(laserAngleRad) * (len * 0.5);
      const elaser = sprites['projectile_Elaser'];
      if (elaser) {
        const inst: SpriteInstance = {
          entry: elaser,
          frame: tick >> 1,
          x: midX,
          y: midY,
          angleRad: laserAngleRad,
          scaleX: len / Math.max(1, elaser.size[0]),
          scaleY: 1,
          depth: 0.38,
          flash: 0,
          clipSea: true,
        };
        mainOut.push(inst);
        reflectOut.push(inst);
      } else {
        this.pushWorldFallbackRect(
          solidWorldOut,
          midX,
          midY,
          len,
          5,
          laserAngleRad,
          this.activePalette.colors[2],
        );
      }
    }
  }

  private collectCraftSprites(
    p: PlayerState,
    tick: number,
    isPlayer2: boolean,
    multiplayerMode: string,
    sprites: Record<string, SpriteEntry>,
    mainOut: SpriteInstance[],
    underwaterOut: SpriteInstance[],
    reflectOut: SpriteInstance[],
    solidWorldOut: number[],
  ): void {
    const rad = p.angleDeg * DEG_TO_RAD;
    const flash =
      p.flashTicks > 0 &&
      (p.flashTicks <= 6 ||
        p.flashTicks > 20 ||
        Math.floor(p.flashTicks / 3) % 2 === 1)
        ? 1
        : 0;
    const isSubmerged = p.y > -12;
    const target = isSubmerged ? underwaterOut : mainOut;
    const clipSea = !isSubmerged;

    const pushPart = (
      spriteName: string | undefined,
      fallbackW: number,
      fallbackH: number,
      frame = 0,
      depth = 0.3,
    ): void => {
      const entry = spriteName ? sprites[spriteName] : undefined;
      if (entry) {
        const inst: SpriteInstance = {
          entry,
          frame,
          x: p.x,
          y: p.y,
          angleRad: rad,
          scaleX: 1,
          scaleY: 1,
          depth,
          flash,
          clipSea,
        };
        target.push(inst);
        if (p.y < 10) {
          reflectOut.push(inst);
        }
      } else {
        const fallbackColor = isPlayer2
          ? this.activePalette.colors[multiplayerMode === 'dogfight1v1' ? 2 : 5]
          : this.activePalette.colors[1];
        this.pushWorldFallbackRect(
          solidWorldOut,
          p.x,
          p.y,
          fallbackW,
          fallbackH,
          rad,
          flash > 0 ? this.activePalette.colors[7] : fallbackColor,
        );
      }
    };

    // Boost / Hover flame behind engine (exact booststart -> boostloop transitions)
    if (p.boosting) {
      const startSpriteName = p.engineSpec.booststartsprite;
      const startEntry = startSpriteName ? sprites[startSpriteName] : undefined;
      const startFrameCount = startEntry
        ? Math.max(1, startEntry.subs.length)
        : 4;
      const boostStep = Math.floor(p.boostAnimFrame * 0.5);
      const useStart = Boolean(startEntry) && boostStep < startFrameCount;
      const boostSprite = useStart
        ? startSpriteName
        : p.engineSpec.boostloopsprite || 'fx_boostloop';
      const boostFrame = useStart
        ? boostStep
        : Math.max(0, boostStep - startFrameCount);
      const boostEntry = sprites[boostSprite];
      if (boostEntry) {
        const inst: SpriteInstance = {
          entry: boostEntry,
          frame: boostFrame,
          x: p.x,
          y: p.y,
          angleRad: rad,
          scaleX: 1,
          scaleY: 1,
          depth: 0.34,
          flash: 0,
          clipSea,
        };
        target.push(inst);
        if (p.y < 16) reflectOut.push(inst);
      } else {
        const tailX = p.x - Math.cos(rad) * 16;
        const tailY = p.y - Math.sin(rad) * 16;
        this.pushWorldFallbackRect(
          solidWorldOut,
          tailX,
          tailY,
          14,
          6,
          rad,
          this.activePalette.colors[7],
        );
      }
    } else if (p.engineSpec.boostidlesprite) {
      const idleEntry = sprites[p.engineSpec.boostidlesprite];
      if (idleEntry) {
        const inst: SpriteInstance = {
          entry: idleEntry,
          frame: tick >> 1,
          x: p.x,
          y: p.y,
          angleRad: rad,
          scaleX: 1,
          scaleY: 1,
          depth: 0.34,
          flash: 0,
          clipSea,
        };
        target.push(inst);
        if (p.y < 16) reflectOut.push(inst);
      }
    }

    const isApexCraft =
      p.loadout.weapon === 5 &&
      p.loadout.body === 5 &&
      p.loadout.engine === 5;
    if (isApexCraft) {
      pushPart(this.resolveApexCraftSpriteName(sprites), 80, 60, tick >> 1, 0.25);
    } else {
      const engineFallbacks = [
        'engine_original',
        'engine_superboost',
        'engine_gungine',
        'engine_underwater',
        'engine_hover',
        'engine_original',
        'engine_original',
        'engine_original',
        'engine_original',
      ];
      const bodyFallbacks = [
        'body_original',
        'body_armor',
        'body_melee',
        'body_nuke',
        'body_bomb',
        'body_original',
        'body_original',
        'body_original',
        'body_original',
      ];
      const wingFallbacks = [
        'wings_original',
        'wings_laser',
        'wings_spread',
        'wings_missiles',
        'wings_cannon',
        'wings_original',
        'wings_original',
        'wings_original',
        'wings_original',
      ];

      const engineSpriteName =
        p.engineSpec.sprite || engineFallbacks[p.loadout.engine];
      const engineEntry = engineSpriteName
        ? sprites[engineSpriteName]
        : undefined;
      // Animate multi-frame engines (6-frame spinning underwater propeller!)
      const engineFrame =
        engineEntry && engineEntry.subs.length > 1
          ? Math.floor(tick * (p.boosting ? 0.65 : 0.25))
          : 0;

      pushPart(engineSpriteName, 22, 12, engineFrame, 0.32);
      pushPart(
        p.bodySpec.sprite || bodyFallbacks[p.loadout.body],
        24,
        12,
        0,
        0.3,
      );
      pushPart(
        p.weaponSpec.sprite || wingFallbacks[p.loadout.weapon],
        18,
        24,
        0,
        0.28,
      );
    }

    // Distinct P2 diamond halo accent so P2 is distinguishable from P1 even with identical sprite color
    if (isPlayer2) {
      const cAccent =
        this.activePalette.colors[multiplayerMode === 'dogfight1v1' ? 2 : 5];
      this.pushWorldHexRing(
        solidWorldOut,
        p.x,
        p.y,
        16,
        1.5,
        [cAccent[0], cAccent[1], cAccent[2], 0.85],
        4,
      );
    }

    // Act II Aegis Shield crisp pixelated hex halo
    if (p.shieldReady) {
      const c7 = this.activePalette.colors[7];
      const c5 = this.activePalette.colors[5];
      const pulseCol = tick % 12 < 6 ? c7 : c5;
      this.pushWorldHexRing(
        solidWorldOut,
        p.x,
        p.y,
        22,
        2,
        [pulseCol[0], pulseCol[1], pulseCol[2], 0.9],
        6,
      );
    }
  }

  private collectProjectileSprites(
    proj: ProjectileEntity,
    prevProj: ProjectileEntity | undefined,
    alpha: number,
    tick: number,
    sprites: Record<string, SpriteEntry>,
    mainOut: SpriteInstance[],
    underwaterOut: SpriteInstance[],
    reflectOut: SpriteInstance[],
    solidWorldOut: number[],
  ): void {
    const canInterp =
      prevProj &&
      Math.hypot(proj.x - prevProj.x, proj.y - prevProj.y) < 160;
    const px = canInterp ? lerp(prevProj.x, proj.x, alpha) : proj.x;
    const py = canInterp ? lerp(prevProj.y, proj.y, alpha) : proj.y;
    const rad = proj.angleDeg * DEG_TO_RAD;
    const isUnderwater = py > 0;
    const target = isUnderwater ? underwaterOut : mainOut;
    const clipSea = !isUnderwater;

    if (proj.kind === 'lightningarc') {
      const points =
        proj.arcPoints && proj.arcPoints.length >= 2
          ? proj.arcPoints
          : [
              { x: px, y: py },
              {
                x: px + Math.cos(rad) * Math.max(40, proj.beamLength ?? 120),
                y: py + Math.sin(rad) * Math.max(40, proj.beamLength ?? 120),
              },
            ];
      const cGlow = this.activePalette.colors[6];
      const cMid = this.activePalette.colors[5];
      const cCore = this.activePalette.colors[7];
      const outerCol: RgbaTuple = [cGlow[0], cGlow[1], cGlow[2], 0.65];

      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!;
        const b = points[i + 1]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const segLen = Math.hypot(dx, dy);
        if (segLen < 0.01) continue;
        const nx = -dy / segLen;
        const ny = dx / segLen;

        // 3 sub-segments with deterministic jagged crackle
        const subPts: Array<{ x: number; y: number }> = [a];
        for (let s = 1; s <= 2; s++) {
          const frac = s / 3;
          const jitter =
            Math.sin(tick * 1.9 + proj.id * 7.3 + i * 3.1 + s * 5.7) * 5.5;
          subPts.push({
            x: a.x + dx * frac + nx * jitter,
            y: a.y + dy * frac + ny * jitter,
          });
        }
        subPts.push(b);

        for (let s = 0; s < subPts.length - 1; s++) {
          const p0 = subPts[s]!;
          const p1 = subPts[s + 1]!;
          this.pushWorldLineSegment(solidWorldOut, p0.x, p0.y, p1.x, p1.y, 5, outerCol);
          this.pushWorldLineSegment(solidWorldOut, p0.x, p0.y, p1.x, p1.y, 3, cMid);
          this.pushWorldLineSegment(solidWorldOut, p0.x, p0.y, p1.x, p1.y, 1.5, cCore);
          if (p0.y < 0 && p1.y < 0) {
            this.pushWorldLineSegment(
              solidWorldOut,
              p0.x,
              -p0.y,
              p1.x,
              -p1.y,
              2,
              [cGlow[0], cGlow[1], cGlow[2], 0.5],
            );
          }
        }
      }
      return;
    }

    if (proj.kind === 'railslug') {
      const len =
        proj.beamLength && proj.beamLength > 0
          ? proj.beamLength
          : Math.max(56, Math.hypot(proj.vx, proj.vy) * 2.5);
      const midX =
        proj.beamLength && proj.beamLength > 0
          ? px + Math.cos(rad) * (len * 0.5)
          : px;
      const midY =
        proj.beamLength && proj.beamLength > 0
          ? py + Math.sin(rad) * (len * 0.5)
          : py;
      const outerCol =
        proj.owner === 'player'
          ? this.activePalette.colors[5]
          : this.activePalette.colors[2];
      const coreCol = this.activePalette.colors[7];
      this.pushWorldFallbackRect(solidWorldOut, midX, midY, len, 10, rad, outerCol);
      this.pushWorldFallbackRect(solidWorldOut, midX, midY, len, 4, rad, coreCol);
      if (!isUnderwater && midY < 0) {
        this.pushWorldFallbackRect(
          solidWorldOut,
          midX,
          -midY,
          len,
          6,
          -rad,
          this.activePalette.colors[6],
        );
      }
      return;
    }

    if (proj.kind === 'flakshell') {
      const entry = sprites['projectile_plasmaball'];
      if (entry) {
        const inst: SpriteInstance = {
          entry,
          frame: tick,
          x: px,
          y: py,
          angleRad: rad,
          scaleX: 1.3,
          scaleY: 1.3,
          depth: 0.36,
          flash: 0,
          clipSea,
        };
        target.push(inst);
        if (!isUnderwater) reflectOut.push(inst);
      } else {
        this.pushWorldFallbackRect(
          solidWorldOut,
          px,
          py,
          10,
          10,
          rad,
          this.activePalette.colors[5],
        );
        this.pushWorldFallbackRect(
          solidWorldOut,
          px,
          py,
          5,
          5,
          rad + 0.785,
          this.activePalette.colors[7],
        );
      }
      return;
    }

    if (proj.kind === 'flakshard') {
      const entry = sprites['projectile_spreadbullet'];
      if (entry) {
        const inst: SpriteInstance = {
          entry,
          frame: tick,
          x: px,
          y: py,
          angleRad: rad,
          scaleX: 0.9,
          scaleY: 0.9,
          depth: 0.37,
          flash: 0,
          clipSea,
        };
        target.push(inst);
        if (!isUnderwater) reflectOut.push(inst);
      } else {
        this.pushWorldFallbackRect(
          solidWorldOut,
          px,
          py,
          8,
          4,
          rad,
          this.activePalette.colors[7],
        );
      }
      return;
    }

    if (proj.kind === 'laser' || proj.kind === 'elaser') {
      const len = Math.max(24, proj.beamLength ?? 520);
      const midX = px + Math.cos(rad) * (len * 0.5);
      const midY = py + Math.sin(rad) * (len * 0.5);
      const spriteName =
        proj.kind === 'laser' ? 'projectile_laser' : 'projectile_Elaser';
      const entry = sprites[spriteName];
      if (entry) {
        const inst: SpriteInstance = {
          entry,
          frame: proj.kind === 'elaser' ? tick >> 1 : tick,
          x: midX,
          y: midY,
          angleRad: rad,
          scaleX: len / Math.max(1, entry.size[0]),
          scaleY: 1,
          depth: 0.25,
          flash: 0,
          clipSea,
        };
        target.push(inst);
        reflectOut.push(inst);
      } else {
        this.pushWorldFallbackRect(
          solidWorldOut,
          midX,
          midY,
          len,
          proj.kind === 'laser' ? 4 : 6,
          rad,
          proj.owner === 'player'
            ? this.activePalette.colors[5]
            : this.activePalette.colors[2],
        );
      }
      return;
    }

    const spriteMap: Record<ProjectileEntity['kind'], string> = {
      bullet: 'projectile_bullet',
      spreadbullet: 'projectile_spreadbullet',
      missile: 'projectile_homing_missile',
      plasmaball: 'projectile_plasmaball',
      bomb: 'projectile_bomb',
      ebullet: 'projectile_ebullet',
      artillery: 'projectile_artillery_bullet',
      laser: 'projectile_laser',
      elaser: 'projectile_Elaser',
      railslug: 'projectile_laser',
      flakshell: 'projectile_plasmaball',
      flakshard: 'projectile_spreadbullet',
      lightningarc: 'projectile_laser',
    };

    const entry = sprites[spriteMap[proj.kind]];
    if (entry) {
      const ageTicks = Math.max(0, proj.maxTtl - proj.ttl);
      // Reference parity: projectile_bullet renders f0 (28x28 muzzle orb) ONLY on spawn tick, then locks to f1 (22x22)
      const projFrame =
        proj.kind === 'bullet'
          ? ageTicks <= 1
            ? 0
            : 1
          : proj.kind === 'ebullet'
            ? (tick >> 1) + proj.id
            : tick;
      // Enemy projectiles sort strictly in front of player fire & explosions so incoming threats stay 100% readable
      const projDepth = proj.owner === 'enemy' ? 0.13 : 0.24;
      const inst: SpriteInstance = {
        entry,
        frame: projFrame,
        x: px,
        y: py,
        angleRad: rad,
        scaleX: 1,
        scaleY: 1,
        depth: projDepth,
        flash: 0,
        clipSea,
      };
      target.push(inst);
      if (!isUnderwater) reflectOut.push(inst);
    } else {
      const col =
        proj.owner === 'player'
          ? this.activePalette.colors[5]
          : this.activePalette.colors[2];
      const sz = Math.max(4, proj.radius * 2);
      this.pushWorldFallbackRect(solidWorldOut, px, py, sz, sz * 0.6, rad, col);
    }
  }

  private resolveParticleDepth(part: ParticleEntity): number {
    const kind = part.kind;
    if (kind.startsWith('wreck_')) return 0.41;
    if (
      kind === 'smoke' ||
      kind === 'smoke_long' ||
      kind === 'poof' ||
      kind === 'jet_trail' ||
      kind === 'missiletrail' ||
      kind === 'watertrail' ||
      kind === 'boattrail' ||
      kind === 'bigboattrail' ||
      kind === 'planepart' ||
      kind === 'drip' ||
      kind === 'boosthover_fade'
    ) {
      // Strictly behind player (0.28..0.34) so smoke never buries the aircraft silhouette!
      return 0.4;
    }
    if (kind === 'laser_fade') return 0.26;
    if (
      kind.includes('Flash') ||
      kind.includes('flash') ||
      kind === 'bigboostcircle' ||
      kind === 'boostend' ||
      kind === 'superboostend' ||
      kind === 'ace_boostend'
    ) {
      return 0.22;
    }
    if (
      kind.includes('splash') ||
      kind === 'ebullet_fade' ||
      kind === 'spreadfade' ||
      kind === 'plasma_hit'
    ) {
      return 0.18;
    }
    if (part.isExplosion || kind.startsWith('explode_') || kind === 'PartFX') {
      return 0.14;
    }
    if (kind === 'bullet_hit' || kind === 'player_hit' || kind === 'repair') {
      return 0.12;
    }
    return clamp(0.24 + part.depth * 0.015, 0.12, 0.42);
  }

  private collectParticleSprites(
    part: ParticleEntity,
    sprites: Record<string, SpriteEntry>,
    mainOut: SpriteInstance[],
    underwaterOut: SpriteInstance[],
    reflectOut: SpriteInstance[],
    solidWorldOut: number[],
  ): void {
    const entry = sprites[part.spriteName];
    const isWreck = part.kind.startsWith('wreck_');
    const target = part.allowBelowSea && part.y > 0 && !isWreck ? underwaterOut : mainOut;
    const clipSea = isWreck ? !part.allowBelowSea : !(part.allowBelowSea && part.y > 0);

    if (entry) {
      const rad = part.angleDeg * DEG_TO_RAD;
      let px = part.x;
      let py = part.y;
      let sx = part.scaleX || 1;
      const sy = part.scaleY || 1;

      // Backward-compat laser_fade beam stretch when scaleX wasn't pre-stretched by sim
      if (part.spriteName === 'laser_fade' && Math.abs(sx) <= 1.5) {
        const len = 520;
        px = part.x + Math.cos(rad) * (len * 0.5);
        py = part.y + Math.sin(rad) * (len * 0.5);
        sx = len / Math.max(1, entry.size[0]);
      }

      const inst: SpriteInstance = {
        entry,
        frame: Math.floor(part.frame),
        x: px,
        y: py,
        angleRad: rad,
        scaleX: sx,
        scaleY: sy,
        depth: this.resolveParticleDepth(part),
        flash: 0,
        clipSea,
      };
      target.push(inst);

      // Reflect all above-sea particles (flashes, smoke, splashes, explosions, wrecks, laser fades, sparks)
      const reflectCutoffY = entry.center ? entry.center[1] + 24 : 32;
      if (py < reflectCutoffY) {
        reflectOut.push(inst);
      }
    } else {
      const col = part.isExplosion
        ? this.activePalette.colors[7]
        : this.activePalette.colors[6];
      const lifeRatio =
        part.maxTtl > 0 ? clamp(part.ttl / part.maxTtl, 0.2, 1) : 1;
      const size = (part.isExplosion ? 24 : 8) * lifeRatio * Math.abs(part.scaleX || 1);
      this.pushWorldFallbackRect(
        solidWorldOut,
        part.x,
        part.y,
        size,
        size,
        part.angleDeg * DEG_TO_RAD,
        col,
      );
    }
  }

  private drawNukeSequence(
    gl: WebGL2RenderingContext,
    snapshot: SimSnapshot,
    worldProj: Float32Array,
  ): void {
    const nukeAtlas = this.vault?.data.atlases.nukesprites;
    const nukeEntry = nukeAtlas?.sprites['nuke'];
    const nukeTex = this.resolveAtlasTexture(nukeAtlas, [
      'nukesprites',
      'nuke',
      'nuke.png',
    ]);

    if (nukeEntry && nukeTex !== this.fallbackTexture && this.batchProg) {
      const frameCount = Math.max(1, nukeEntry.subs.length);
      // nukeTicks counts DOWN from 60 -> 0; play 16-frame screaming skull FORWARD (0 -> 15)!
      const elapsedNukeTicks = Math.max(0, 60 - snapshot.player.nukeTicks);
      const frame = clamp(
        Math.floor((elapsedNukeTicks / 52) * frameCount),
        0,
        frameCount - 1,
      );
      const scale = 0.9 + (frame / Math.max(1, frameCount - 1)) * 0.35;
      // nukesprites.json omits `center` (normalizer defaults to [0,0]); center skull on blast origin!
      const hasExplicitCenter =
        Boolean(nukeEntry.center) &&
        (nukeEntry.center[0] !== 0 || nukeEntry.center[1] !== 0);
      const centeredNukeEntry: SpriteEntry = hasExplicitCenter
        ? nukeEntry
        : {
            ...nukeEntry,
            center: [nukeEntry.size[0] * 0.5, nukeEntry.size[1] * 0.5],
          };
      const nukeInst: SpriteInstance = {
        entry: centeredNukeEntry,
        frame,
        x: snapshot.player.x,
        y: snapshot.player.y,
        angleRad: 0,
        scaleX: scale,
        scaleY: scale,
        depth: 0.05,
        flash: 0,
        clipSea: false,
      };
      this.drawSpriteBatch(
        gl,
        this.batchProg,
        nukeTex,
        worldProj,
        [nukeInst],
        false,
      );
      if (this.batchReflectProg && snapshot.player.y < 180) {
        this.drawSpriteBatch(
          gl,
          this.batchReflectProg,
          nukeTex,
          worldProj,
          [nukeInst],
          false,
        );
      }
      return;
    }

    // Procedural shockwave ring fallback
    const r = Math.max(24, snapshot.player.nukeRadius);
    const verts: number[] = [];
    this.pushWorldFallbackRect(
      verts,
      snapshot.player.x,
      snapshot.player.y,
      r * 1.6,
      r * 1.6,
      0,
      this.activePalette.colors[7],
    );
    this.flushSolidArray(gl, verts, worldProj);
  }

  private drawSpriteBatch(
    gl: WebGL2RenderingContext,
    prog: CompiledProgram,
    tex: UploadedTexture,
    viewProj: Float32Array,
    instances: readonly SpriteInstance[],
    clipSea: boolean,
    paletteOverride?: PaletteDefinition,
  ): void {
    if (instances.length === 0) return;

    const pal = paletteOverride ?? this.activePalette;
    gl.useProgram(prog.program);
    gl.bindVertexArray(this.spriteVao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.texture);
    this.setUniform1i(gl, prog, 'diffuseTex', 0);
    this.setUniformMatrix4fv(gl, prog, 'uViewProjMatrix', viewProj);
    this.setUniform2f(gl, prog, 'uSpritesheetSize', tex.width, tex.height);
    this.setUniform1f(gl, prog, 'uClipSea', clipSea ? 1.0 : 0.0);
    this.setColorsUniform(gl, prog, 'uniform_colors', pal.colors);

    let offset = 0;
    while (offset < instances.length) {
      const count = Math.min(MAX_BATCH_INSTANCES, instances.length - offset);
      const scratch = this.spriteInstanceScratch;
      for (let i = 0; i < count; i++) {
        const inst = instances[offset + i]!;
        const sub = getSpriteFrame(inst.entry, inst.frame);
        const w = inst.entry.size[0];
        const h = inst.entry.size[1];
        const cx = inst.entry.center ? inst.entry.center[0] : w * 0.5;
        const cy = inst.entry.center ? inst.entry.center[1] : h * 0.5;

        const base = i * INSTANCE_FLOATS;
        scratch[base + 0] = inst.x;
        scratch[base + 1] = inst.y;
        scratch[base + 2] = inst.angleRad;
        scratch[base + 3] = sub.x;
        scratch[base + 4] = sub.y;
        scratch[base + 5] = w;
        scratch[base + 6] = h;
        scratch[base + 7] = cx;
        scratch[base + 8] = cy;
        scratch[base + 9] = inst.scaleX;
        scratch[base + 10] = inst.scaleY;
        scratch[base + 11] = inst.depth;
        scratch[base + 12] = inst.flash;
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteInstanceVbo);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        scratch.subarray(0, count * INSTANCE_FLOATS),
      );
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      this.frameDrawCalls++;
      offset += count;
    }

    gl.bindVertexArray(null);
  }

  private drawPostWaterPass(
    gl: WebGL2RenderingContext,
    prog: CompiledProgram,
    colorTexture: WebGLTexture,
  ): void {
    const u = this.lastPostUniforms;
    gl.useProgram(prog.program);
    gl.bindVertexArray(this.fullscreenVao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTexture);
    this.setUniform1i(gl, prog, 'colorTexture', 0);
    this.setUniform2f(gl, prog, 'viewport', VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
    this.setUniform4f(
      gl,
      prog,
      'cameraPosition',
      u.cameraPosition[0],
      u.cameraPosition[1],
      u.cameraPosition[2],
      u.cameraPosition[3],
    );
    this.setUniform4f(
      gl,
      prog,
      'healthRadius',
      u.healthRadius[0],
      u.healthRadius[1],
      u.healthRadius[2],
      u.healthRadius[3],
    );
    this.setUniform4f(
      gl,
      prog,
      'playerPosition',
      u.playerPosition[0],
      u.playerPosition[1],
      u.playerPosition[2],
      u.playerPosition[3],
    );
    this.setUniform4f(
      gl,
      prog,
      'cameraWorldPosition',
      u.cameraWorldPosition[0],
      u.cameraWorldPosition[1],
      u.cameraWorldPosition[2],
      u.cameraWorldPosition[3],
    );
    this.setUniform4f(
      gl,
      prog,
      'delta',
      u.delta[0],
      u.delta[1],
      u.delta[2],
      u.delta[3],
    );
    this.setUniform4f(
      gl,
      prog,
      'uniform_backcol',
      u.uniform_backcol[0],
      u.uniform_backcol[1],
      u.uniform_backcol[2],
      u.uniform_backcol[3],
    );
    this.setColorsUniform(gl, prog, 'uniform_colors', u.uniform_colors);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.frameDrawCalls++;
    gl.bindVertexArray(null);
  }

  private getMenuContrastColors(pal: PaletteDefinition): {
    isBright1: boolean;
    panelDark: RgbaTuple;
    selectedTextInk: RgbaTuple;
    bannerPlateBg: RgbaTuple;
    panelMidBg: RgbaTuple;
    darkPanelFg: RgbaTuple;
    darkPanelAccent: RgbaTuple;
    midPanelInk: RgbaTuple;
  } {
    const luma1 =
      0.299 * pal.colors[1][0] +
      0.587 * pal.colors[1][1] +
      0.114 * pal.colors[1][2];
    const luma2 =
      0.299 * pal.colors[2][0] +
      0.587 * pal.colors[2][1] +
      0.114 * pal.colors[2][2];
    const luma3 =
      0.299 * pal.colors[3][0] +
      0.587 * pal.colors[3][1] +
      0.114 * pal.colors[3][2];
    const luma7 =
      0.299 * pal.colors[7][0] +
      0.587 * pal.colors[7][1] +
      0.114 * pal.colors[7][2];
    const backLuma =
      0.299 * pal.backcol[0] +
      0.587 * pal.backcol[1] +
      0.114 * pal.backcol[2];
    const darkInk: RgbaTuple = [0.08, 0.04, 0.12, 0.96];
    const isBright1 = luma1 > 0.45;

    const panelDark: RgbaTuple = isBright1
      ? backLuma > 0.45
        ? darkInk
        : [
            pal.backcol[0] * 0.55,
            pal.backcol[1] * 0.55,
            pal.backcol[2] * 0.55,
            0.96,
          ]
      : pal.colors[1];
    const selectedTextInk: RgbaTuple =
      isBright1 && luma7 > 0.45 ? darkInk : pal.colors[1];
    const bannerPlateBg: RgbaTuple =
      isBright1 && luma2 > 0.45
        ? [
            pal.colors[2][0] * 0.42,
            pal.colors[2][1] * 0.42,
            pal.colors[2][2] * 0.42,
            0.96,
          ]
        : pal.colors[2];
    const panelMidBg: RgbaTuple =
      isBright1 && luma3 > 0.45
        ? [
            pal.colors[3][0] * 0.35,
            pal.colors[3][1] * 0.35,
            pal.colors[3][2] * 0.35,
            0.96,
          ]
        : pal.colors[3];
    const darkPanelFg: RgbaTuple =
      isBright1 && luma7 <= 0.45 ? pal.colors[1] : pal.colors[7];
    const darkPanelAccent: RgbaTuple =
      isBright1 && luma7 <= 0.45 ? pal.colors[1] : pal.colors[5];
    const midPanelInk: RgbaTuple =
      isBright1 && luma3 > 0.45 ? darkPanelFg : pal.colors[1];

    return {
      isBright1,
      panelDark,
      selectedTextInk,
      bannerPlateBg,
      panelMidBg,
      darkPanelFg,
      darkPanelAccent,
      midPanelInk,
    };
  }

  private drawHudPass(
    gl: WebGL2RenderingContext,
    snapshot: SimSnapshot,
    elapsedSec: number,
    camX: number,
    camY: number,
  ): void {
    // ZERO DOM health bar during vanilla play — only Score, Combo gauge, and Mission Toast!
    const pal = this.activePalette;
    const fg = pal.colors[7];
    const dim = pal.colors[3];
    const warn = pal.colors[2];
    const hudShadow: RgbaTuple = [0.06, 0.03, 0.08, 0.85];
    const luma1 =
      0.299 * pal.colors[1][0] +
      0.587 * pal.colors[1][1] +
      0.114 * pal.colors[1][2];
    const hudBoxBg: RgbaTuple =
      luma1 > 0.45
        ? [0.06, 0.03, 0.08, 0.9]
        : [pal.colors[1][0], pal.colors[1][1], pal.colors[1][2], 0.86];
    const hudTrackBg: RgbaTuple =
      luma1 > 0.45 ? [0.06, 0.03, 0.08, 0.85] : pal.colors[1];

    const scoreFont = this.resolveFont('fntb', 'fntm');
    const smallFont = this.resolveFont('fnts', 'fntm');
    const isDogfight = Boolean(snapshot.dogfight);

    const scoreScale = scoreFont.spec === this.builtinFontSpec ? 2 : 1;
    const subHudStartY =
      scoreFont.spec === this.builtinFontSpec
        ? 28
        : 9 + Math.round(scoreFont.spec.lineHeight * scoreScale) - 2;

    if (!isDogfight) {
      const scoreStr = String(Math.floor(snapshot.score)).padStart(6, '0');
      this.drawBitmapText(
        gl,
        scoreFont,
        scoreStr,
        12,
        10,
        scoreScale,
        'left',
        hudShadow,
      );
      this.drawBitmapText(gl, scoreFont, scoreStr, 11, 9, scoreScale, 'left', fg);
    }

    const smallScale = 1;
    let leftHudY = isDogfight ? 34 : subHudStartY;
    if (snapshot.mode === 'sfmt') {
      this.drawBitmapText(
        gl,
        smallFont,
        'OVERDRIVE',
        13,
        leftHudY + 1,
        smallScale,
        'left',
        hudShadow,
      );
      this.drawBitmapText(
        gl,
        smallFont,
        'OVERDRIVE',
        12,
        leftHudY,
        smallScale,
        'left',
        warn,
      );
      leftHudY += 12;
    }
    if (snapshot.autopilotEnabled) {
      this.drawBitmapText(
        gl,
        smallFont,
        'ACE BOT',
        13,
        leftHudY + 1,
        smallScale,
        'left',
        hudShadow,
      );
      this.drawBitmapText(
        gl,
        smallFont,
        'ACE BOT',
        12,
        leftHudY,
        smallScale,
        'left',
        pal.colors[2],
      );
      leftHudY += 12;
    }

    // Combo text using combofont.shader vertical barh decay (skipped in 1v1 Dogfight)
    if (!isDogfight && (snapshot.combo > 1 || snapshot.comboTimer > 0)) {
      const comboText = `COMBO x${snapshot.combo}`;
      const comboScale = scoreFont.spec === this.builtinFontSpec ? 2 : 1;
      const timerRatio =
        snapshot.comboMaxTimer > 0
          ? clamp(snapshot.comboTimer / snapshot.comboMaxTimer, 0, 1)
          : 0;
      const metrics = measureBitmapText(scoreFont.spec, comboText, comboScale);
      const comboY = 9;
      const barhY = comboY + (1 - timerRatio) * metrics.height;
      const flashWarn =
        snapshot.comboWarning && Math.floor(elapsedSec * 12) % 2 === 0;

      // Drop shadow
      this.drawBitmapText(
        gl,
        scoreFont,
        comboText,
        VIRTUAL_WIDTH - 10,
        comboY + 1,
        comboScale,
        'right',
        hudShadow,
      );
      // Draining barh combo shader
      this.drawComboText(
        gl,
        scoreFont,
        comboText,
        VIRTUAL_WIDTH - 11,
        comboY,
        comboScale,
        'right',
        dim,
        flashWarn ? warn : fg,
        barhY,
      );
    }

    // Act II Ghost world tag
    if (snapshot.ghostPose?.alive) {
      const gx = Math.round(VIRTUAL_WIDTH * 0.5 + (snapshot.ghostPose.x - camX));
      const gy = Math.round(VIRTUAL_HEIGHT * 0.5 + (snapshot.ghostPose.y - camY) - 26);
      if (gx >= -24 && gx <= VIRTUAL_WIDTH + 24 && gy >= -12 && gy <= VIRTUAL_HEIGHT + 12) {
        this.drawBitmapText(gl, smallFont, 'GHOST', gx + 1, gy + 1, 1, 'center', hudShadow);
        this.drawBitmapText(gl, smallFont, 'GHOST', gx, gy, 1, 'center', pal.colors[6]);
      }
    }

    // Act II 2P Co-op / 1v1 Dogfight HUD: P1 & P2 craft tags, P1/P2 HP bars, Dogfight Scoreboard & Round KO banner
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

      const p2BoxY = isDogfight ? 6 : Math.max(44, subHudStartY);
      const p2BarY = p2BoxY + 14;

      this.solidVerts.length = 0;
      if (showP1Tag) {
        this.pushSolidRect(p1sx - 9, p1sy - 1, 18, 10, hudBoxBg);
      }
      if (showP2Tag) {
        this.pushSolidRect(p2sx - 9, p2sy - 1, 18, 10, hudBoxBg);
      }
      if (isDogfight) {
        this.pushSolidRect(8, 6, 86, 24, hudBoxBg);
        this.pushSolidBorder(8, 6, 86, 24, 1, fg);
        this.pushSolidRect(12, 20, 76, 6, hudTrackBg);
        this.pushSolidRect(12, 20, Math.round(76 * p1Ratio), 6, fg);
        this.pushSolidBorder(12, 20, 76, 6, 1, fg);
      }
      this.pushSolidRect(VIRTUAL_WIDTH - 94, p2BoxY, 86, 24, hudBoxBg);
      this.pushSolidBorder(VIRTUAL_WIDTH - 94, p2BoxY, 86, 24, 1, fg);
      this.pushSolidRect(VIRTUAL_WIDTH - 88, p2BarY, 76, 6, hudTrackBg);
      this.pushSolidRect(
        VIRTUAL_WIDTH - 88,
        p2BarY,
        Math.round(76 * p2Ratio),
        6,
        isDogfight ? warn : pal.colors[5],
      );
      this.pushSolidBorder(VIRTUAL_WIDTH - 88, p2BarY, 76, 6, 1, fg);
      this.flushSolidArray(gl, this.solidVerts, this.screenProjMatrix);

      if (showP1Tag) {
        this.drawBitmapText(gl, smallFont, 'P1', p1sx + 1, p1sy + 1, 1, 'center', hudShadow);
        this.drawBitmapText(gl, smallFont, 'P1', p1sx, p1sy, 1, 'center', fg);
      }
      if (showP2Tag) {
        const p2TagCol =
          snapshot.activeMods?.multiplayerMode === 'dogfight1v1'
            ? warn
            : pal.colors[5];
        this.drawBitmapText(gl, smallFont, 'P2', p2sx + 1, p2sy + 1, 1, 'center', hudShadow);
        this.drawBitmapText(gl, smallFont, 'P2', p2sx, p2sy, 1, 'center', p2TagCol);
      }

      if (isDogfight) {
        this.drawBitmapText(gl, smallFont, 'P1 HP', 13, 11, 1, 'left', hudShadow);
        this.drawBitmapText(gl, smallFont, 'P1 HP', 12, 10, 1, 'left', fg);
      }
      const p2Label = `P2 ${snapshot.player2.alive ? `${Math.round(p2Ratio * 100)}%` : 'KO'}`;
      this.drawBitmapText(
        gl,
        smallFont,
        p2Label,
        VIRTUAL_WIDTH - 11,
        p2BoxY + 5,
        1,
        'right',
        hudShadow,
      );
      this.drawBitmapText(
        gl,
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
      this.solidVerts.length = 0;
      this.pushSolidRect(190, 6, 220, 20, hudBoxBg);
      this.pushSolidBorder(190, 6, 220, 20, 1, fg);
      this.flushSolidArray(gl, this.solidVerts, this.screenProjMatrix);

      this.drawBitmapText(
        gl,
        smallFont,
        scoreboardText,
        VIRTUAL_WIDTH * 0.5 + 1,
        13,
        1,
        'center',
        hudShadow,
      );
      this.drawBitmapText(
        gl,
        smallFont,
        scoreboardText,
        VIRTUAL_WIDTH * 0.5,
        12,
        1,
        'center',
        fg,
      );

      if (df.roundBannerTicks > 0 && df.winner === null) {
        this.solidVerts.length = 0;
        this.pushSolidRect(160, 52, 280, 24, hudBoxBg);
        this.pushSolidBorder(160, 52, 280, 24, 1, fg);
        this.flushSolidArray(gl, this.solidVerts, this.screenProjMatrix);
        const koLabel = df.lastScorer
          ? `ROUND KO!  P${df.lastScorer} SCORES`
          : `ROUND ${df.round} FIGHT!`;
        this.drawBitmapText(
          gl,
          smallFont,
          koLabel,
          VIRTUAL_WIDTH * 0.5 + 1,
          61,
          1,
          'center',
          hudShadow,
        );
        this.drawBitmapText(
          gl,
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

    // Mission completion toast popup
    if (snapshot.completedMissionsThisSortie.length > 0) {
      const lastId =
        snapshot.completedMissionsThisSortie[
          snapshot.completedMissionsThisSortie.length - 1
        ];
      const mission =
        snapshot.activeMissions.find((m) => m.id === lastId) ??
        this.vault?.data.global.missions.find((m) => m.id === lastId);
      const label = mission
        ? `MISSION COMPLETE: ${mission.title.toUpperCase()}`
        : `MISSION #${lastId} COMPLETE`;

      const toastY = snapshot.dogfight ? 30 : 8;
      this.solidVerts.length = 0;
      this.pushSolidRect(150, toastY, 300, 22, hudBoxBg);
      this.pushSolidBorder(150, toastY, 300, 22, 1, fg);
      this.flushSolidArray(gl, this.solidVerts, this.screenProjMatrix);

      this.drawBitmapText(
        gl,
        smallFont,
        label,
        VIRTUAL_WIDTH * 0.5 + 1,
        toastY + 8,
        1,
        'center',
        hudShadow,
      );
      this.drawBitmapText(
        gl,
        smallFont,
        label,
        VIRTUAL_WIDTH * 0.5,
        toastY + 7,
        1,
        'center',
        fg,
      );
    }
  }

  private drawPausePass(gl: WebGL2RenderingContext): void {
    const pal = this.activePalette;
    const contrast = this.getMenuContrastColors(pal);
    this.drawPauseLinesPass(gl, [
      contrast.panelDark[0],
      contrast.panelDark[1],
      contrast.panelDark[2],
      0.45,
    ]);

    this.solidVerts.length = 0;
    this.pushSolidRect(170, 158, 260, 74, contrast.panelDark);
    this.pushSolidBorder(170, 158, 260, 74, 2, pal.colors[7]);
    this.flushSolidArray(gl, this.solidVerts, this.screenProjMatrix);

    const bigFont = this.resolveFont('fntb', 'fntm');
    const smallFont = this.resolveFont('fnts', 'fntm');
    const bigScale = bigFont.spec === this.builtinFontSpec ? 3 : 1;
    this.drawBitmapText(
      gl,
      bigFont,
      'PAUSED',
      VIRTUAL_WIDTH * 0.5,
      172,
      bigScale,
      'center',
      contrast.darkPanelFg,
    );
    this.drawBitmapText(
      gl,
      smallFont,
      'ESC RESUME  -  R RETRY  -  H HANGAR',
      VIRTUAL_WIDTH * 0.5,
      208,
      1,
      'center',
      contrast.darkPanelAccent,
    );
  }

  private drawGameOverCard(
    gl: WebGL2RenderingContext,
    snapshot: SimSnapshot,
    elapsedSec: number,
  ): void {
    const pal = this.activePalette;
    const contrast = this.getMenuContrastColors(pal);
    const isSfmt = snapshot.mode === 'sfmt';
    const highScore = isSfmt
      ? snapshot.profile.highScoreSfmt
      : snapshot.profile.highScoreNormal;

    this.solidVerts.length = 0;
    this.pushSolidRect(120, 96, 360, 206, [
      contrast.panelDark[0],
      contrast.panelDark[1],
      contrast.panelDark[2],
      0.94,
    ]);
    this.pushSolidBorder(120, 96, 360, 206, 2, pal.colors[7]);
    this.pushSolidRect(132, 134, 336, 2, pal.colors[3]);
    this.flushSolidArray(gl, this.solidVerts, this.screenProjMatrix);

    const bigFont = this.resolveFont('fntb', 'fntm');
    const smallFont = this.resolveFont('fnts', 'fntm');
    const titleScale = bigFont.spec === this.builtinFontSpec ? 2 : 1;
    const titleY = Math.round(
      98 + (36 - bigFont.spec.lineHeight * titleScale) * 0.5,
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
    this.drawBitmapText(
      gl,
      bigFont,
      title,
      VIRTUAL_WIDTH * 0.5,
      titleY,
      titleScale,
      'center',
      contrast.darkPanelFg,
    );

    this.drawBitmapText(
      gl,
      smallFont,
      snapshot.dogfight
        ? `1V1 DOGFIGHT // BEST OF ${snapshot.dogfight.bestOf}`
        : snapshot.player.planeName.toUpperCase(),
      VIRTUAL_WIDTH * 0.5,
      146,
      1,
      'center',
      contrast.darkPanelAccent,
    );

    const rows: [string, string][] = snapshot.dogfight
      ? [
          ['MATCH', `P1 ${snapshot.dogfight.p1Wins} - ${snapshot.dogfight.p2Wins} P2`],
          ['ROUND', `${snapshot.dogfight.round} / ${snapshot.dogfight.bestOf}`],
          ['SCORE', String(Math.floor(snapshot.score))],
          ['KILLS', String(snapshot.killsThisSortie)],
        ]
      : [
          ['SCORE', String(Math.floor(snapshot.score))],
          ['BEST', String(Math.floor(Math.max(highScore, snapshot.score)))],
          ['KILLS', String(snapshot.killsThisSortie)],
          ['MISSIONS', `${snapshot.profile.completedMissions.length} / 90`],
        ];
    for (let i = 0; i < rows.length; i++) {
      const [label, val] = rows[i]!;
      const ry = 172 + i * 20;
      this.drawBitmapText(
        gl,
        smallFont,
        label,
        154,
        ry,
        1,
        'left',
        contrast.isBright1 ? contrast.darkPanelAccent : pal.colors[3],
      );
      this.drawBitmapText(
        gl,
        smallFont,
        val,
        446,
        ry,
        1,
        'right',
        contrast.darkPanelFg,
      );
    }

    const blink = Math.floor(elapsedSec * 4) % 2 === 0;
    this.drawBitmapText(
      gl,
      smallFont,
      'SPACE: RELAUNCH   -   H / ESC: HANGAR',
      VIRTUAL_WIDTH * 0.5,
      274,
      1,
      'center',
      blink ? contrast.darkPanelFg : contrast.darkPanelAccent,
    );
  }

  private drawMenuPass(
    gl: WebGL2RenderingContext,
    snapshot: SimSnapshot,
    hangarUi: HangarUiState,
    elapsedSec: number,
  ): void {
    const pal = this.activePalette;
    const contrast = this.getMenuContrastColors(pal);
    const isStudioOpen = Boolean(hangarUi.paletteStudio?.open);
    const isModDeckOpen = !isStudioOpen && Boolean(hangarUi.modDeckOpen);
    const previewPal =
      isStudioOpen && hangarUi.paletteStudio?.palette
        ? hangarUi.paletteStudio.palette
        : pal;
    const isSfmt = hangarUi.mode === 'sfmt';
    const moddedEnabled = Boolean(hangarUi.modFlags?.moddedEnabled);

    // 1. Projector screen backdrop and frame inside 600x400 FBO
    const screenBg: RgbaTuple = isSfmt
      ? [pal.colors[2][0] * 0.35, pal.colors[2][1] * 0.15, pal.colors[2][2] * 0.18, 0.94]
      : contrast.isBright1
        ? contrast.panelDark
        : [pal.colors[1][0], pal.colors[1][1], pal.colors[1][2], 0.92];

    this.solidVerts.length = 0;
    // Projector top housing bar
    this.pushSolidRect(0, 0, VIRTUAL_WIDTH, 18, contrast.panelDark);
    this.pushSolidRect(0, 18, VIRTUAL_WIDTH, 2, pal.colors[7]);
    // Pulldown projector canvas
    this.pushSolidRect(26, 22, 548, 352, screenBg);
    this.pushSolidBorder(26, 22, 548, 352, 2, pal.colors[7]);
    // Bottom pull-rod & rope
    this.pushSolidRect(22, 374, 556, 4, pal.colors[7]);
    this.pushSolidRect(298, 378, 4, 18, pal.colors[3]);
    // Title banner plate
    this.pushSolidRect(42, 30, 516, 30, contrast.bannerPlateBg);
    this.pushSolidBorder(42, 30, 516, 30, 1, pal.colors[7]);
    // Aircraft preview stage box (top-right)
    this.pushSolidRect(318, 68, 240, 96, previewPal.backcol);
    this.pushSolidBorder(318, 68, 240, 96, 1, pal.colors[7]);
    // Bottom divider
    this.pushSolidRect(42, 338, 516, 1, pal.colors[3]);
    this.flushSolidArray(gl, this.solidVerts, this.screenProjMatrix);

    // 2. Render live assembled aircraft preview inside preview stage using sprite batch!
    const sprites = this.vault?.data.atlases.sprites.sprites ?? {};
    const spritesTex = this.resolveAtlasTexture(
      this.vault?.data.atlases.sprites,
      ['sprites', 'sheet1grey', 'sheet1grey.png'],
    );
    const previewBoxX = 318;
    const previewBoxY = 68;
    const previewBoxW = 240;
    const previewBoxH = 96;
    const previewCenterX = previewBoxX + previewBoxW * 0.5;
    const previewCenterY = previewBoxY + previewBoxH * 0.5;
    const previewX = previewCenterX;
    const previewY = 112 + Math.sin(elapsedSec * 2.4) * 3;
    const previewAngle = Math.sin(elapsedSec * 1.5) * 0.08 - 0.15;
    const previewSprites: SpriteInstance[] = [];
    const previewFallback: number[] = [];
    const isApexCraft =
      hangarUi.loadout.weapon === 5 &&
      hangarUi.loadout.body === 5 &&
      hangarUi.loadout.engine === 5;

    const addPreviewPart = (name: string | undefined, frame = 0): void => {
      const entry = name ? sprites[name] : undefined;
      if (entry) {
        if (isApexCraft) {
          const apexAngle = Math.sin(elapsedSec * 1.5) * 0.06;
          const apexScale = Math.min(
            0.26,
            (previewBoxW - 24) / Math.max(1, entry.size[0]),
            (previewBoxH - 18) / Math.max(1, entry.size[1]),
          );
          const localMidX = (entry.size[0] * 0.5 - entry.center[0]) * apexScale;
          const localMidY = (entry.size[1] * 0.5 - entry.center[1]) * apexScale;
          const c = Math.cos(apexAngle);
          const s = Math.sin(apexAngle);
          const rotMidX = localMidX * c - localMidY * s;
          const rotMidY = localMidX * s + localMidY * c;
          const bobY = Math.sin(elapsedSec * 2.4) * 2;
          previewSprites.push({
            entry,
            frame,
            x: previewCenterX - rotMidX,
            y: previewCenterY + bobY - rotMidY,
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
      }
    };

    if (isApexCraft) {
      addPreviewPart(this.resolveApexCraftSpriteName(sprites));
    } else {
      const previewEngineName = hangarUi.engineSpec.sprite || 'engine_original';
      const previewEngineEntry = sprites[previewEngineName];
      const previewEngineFrame =
        previewEngineEntry && previewEngineEntry.subs.length > 1
          ? Math.floor(elapsedSec * 18)
          : 0;
      addPreviewPart(previewEngineName, previewEngineFrame);
      addPreviewPart(hangarUi.bodySpec.sprite || 'body_original');
      addPreviewPart(hangarUi.weaponSpec.sprite || 'wings_original');
    }

    if (previewSprites.length > 0 && this.batchProg) {
      this.drawSpriteBatch(
        gl,
        this.batchProg,
        spritesTex,
        this.screenProjMatrix,
        previewSprites,
        false,
        previewPal,
      );
    } else {
      this.pushWorldFallbackRect(
        previewFallback,
        previewX,
        previewY,
        44,
        24,
        previewAngle,
        previewPal.colors[1],
      );
      this.flushSolidArray(gl, previewFallback, this.screenProjMatrix);
    }

    // 3. Header & Banner
    const smallFont = this.resolveFont('fnts', 'fntm');
    const medFont = this.resolveFont('fntm', 'fnts');
    const medScale = medFont.spec === this.builtinFontSpec ? 2 : 1;
    const bannerY = Math.round(
      30 + (30 - medFont.spec.lineHeight * medScale) * 0.5,
    );

    if (moddedEnabled && hangarUi.modFlags?.dailySeed && hangarUi.dailySeedId) {
      this.drawBitmapText(
        gl,
        smallFont,
        `DAILY ${hangarUi.dailySeedId}`,
        26,
        5,
        1,
        'left',
        contrast.darkPanelAccent,
      );
    }

    this.drawBitmapText(
      gl,
      smallFont,
      'KRUNKED SKYBREAKER  //  HANGAR MK-I',
      VIRTUAL_WIDTH * 0.5,
      5,
      1,
      'center',
      contrast.darkPanelFg,
    );

    this.drawBitmapText(
      gl,
      smallFont,
      moddedEnabled ? '[TAB] MODDED' : '[TAB] VANILLA 1:1',
      574,
      5,
      1,
      'right',
      moddedEnabled ? contrast.darkPanelAccent : contrast.darkPanelFg,
    );

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

    this.drawBitmapText(
      gl,
      medFont,
      bannerText,
      VIRTUAL_WIDTH * 0.5,
      bannerY,
      medScale,
      'center',
      contrast.darkPanelFg,
    );

    if (isStudioOpen && hangarUi.paletteStudio) {
      this.drawPaletteStudioPanel(gl, hangarUi, smallFont);
      if (snapshot.tick < 0) this.frameDrawCalls++;
      return;
    }

    if (isModDeckOpen) {
      this.drawModDeckPanel(gl, hangarUi, smallFont);
      if (snapshot.tick < 0) this.frameDrawCalls++;
      return;
    }

    if (
      moddedEnabled &&
      hangarUi.modFlags &&
      hangarUi.modFlags.multiplayerMode !== 'solo'
    ) {
      const pBackLuma =
        0.299 * previewPal.backcol[0] +
        0.587 * previewPal.backcol[1] +
        0.114 * previewPal.backcol[2];
      const p1Luma =
        0.299 * previewPal.colors[1][0] +
        0.587 * previewPal.colors[1][1] +
        0.114 * previewPal.colors[1][2];
      const p2PreviewCol: RgbaTuple =
        pBackLuma > 0.45 && p1Luma > 0.45
          ? [0.08, 0.04, 0.12, 0.96]
          : pBackLuma <= 0.45 && p1Luma <= 0.45
            ? previewPal.colors[7]
            : previewPal.colors[1];
      this.drawBitmapText(
        gl,
        smallFont,
        `P2: ${(hangarUi.p2PlaneName ?? (hangarUi.modFlags.p2BotEnabled ? 'ACE BOT' : 'HUMAN')).toUpperCase()}`,
        324,
        151,
        1,
        'left',
        p2PreviewCol,
      );
    }

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
    const modeLabel = hangarUi.mode === 'sfmt' ? 'OVERDRIVE' : 'NORMAL';
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
    const paletteCount = moddedEnabled
      ? this.listPalettes().length
      : PALETTES.length;
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
                    ? 'OVERDRIVE MODE - HIGH SPEED ACE WAVE'
                    : 'COMPLETE 15 MISSIONS OR SINK A BLIMP TO UNLOCK'
                  : 'PRESS SPACE OR ENTER TO LAUNCH SORTIE';

    const rowDefs: {
      key: HangarUiState['activeRow'];
      label: string;
      value: string;
    }[] = [
      {
        key: 'weapon',
        label: `WEAPON ${weaponSlot}/${partCount}`,
        value: hangarUi.weaponSpec.name.toUpperCase(),
      },
      {
        key: 'body',
        label: `BODY ${bodySlot}/${partCount}`,
        value: hangarUi.bodySpec.name.toUpperCase(),
      },
      {
        key: 'engine',
        label: `ENGINE ${engineSlot}/${partCount}`,
        value: hangarUi.engineSpec.name.toUpperCase(),
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

    this.solidVerts.length = 0;
    for (let i = 0; i < rowDefs.length; i++) {
      const r = rowDefs[i]!;
      const ry = HANGAR_LAYOUT.rowStartY + i * HANGAR_LAYOUT.rowStep;
      const isSelected = hangarUi.activeRow === r.key;
      const boxCol = isSelected ? pal.colors[7] : pal.colors[3];
      if (isSelected) {
        this.pushSolidRect(
          HANGAR_LAYOUT.rowX,
          ry,
          HANGAR_LAYOUT.rowWidth,
          HANGAR_LAYOUT.rowHeight,
          boxCol,
        );
      } else {
        this.pushSolidBorder(
          HANGAR_LAYOUT.rowX,
          ry,
          HANGAR_LAYOUT.rowWidth,
          HANGAR_LAYOUT.rowHeight,
          1,
          pal.colors[3],
        );
      }

      // 8-color palette preview strip on palette row
      if (r.key === 'palette') {
        for (let c = 1; c <= 7; c++) {
          this.pushSolidRect(
            188 + (c - 1) * 14,
            ry + 17,
            12,
            7,
            pal.colors[c] ?? pal.colors[7],
          );
        }
        this.pushSolidRect(174, ry + 17, 12, 7, pal.backcol);
      }
    }

    // Active part description bar
    this.pushSolidRect(
      HANGAR_LAYOUT.descrX,
      HANGAR_LAYOUT.descrY,
      HANGAR_LAYOUT.descrWidth,
      HANGAR_LAYOUT.descrHeight,
      contrast.panelMidBg,
    );
    this.flushSolidArray(gl, this.solidVerts, this.screenProjMatrix);

    for (let i = 0; i < rowDefs.length; i++) {
      const r = rowDefs[i]!;
      const ry = HANGAR_LAYOUT.rowStartY + i * HANGAR_LAYOUT.rowStep;
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
      const valY = ry + (r.key === 'palette' ? 4 : 14);

      this.drawBitmapText(
        gl,
        smallFont,
        labelText,
        48,
        labelY,
        1,
        'left',
        labelCol,
      );

      // Keep value strictly inside 260px row box without colliding with left label
      const labelW = measureBitmapText(smallFont.spec, labelText, 1).width;
      const maxValW =
        r.key === 'palette'
          ? Math.max(48, 294 - (48 + labelW + 6))
          : 246;
      const rawValW = measureBitmapText(smallFont.spec, valText, 1).width;
      const valScale =
        rawValW > maxValW && rawValW > 0 ? maxValW / rawValW : 1;

      this.drawBitmapText(
        gl,
        smallFont,
        valText,
        294,
        valY,
        valScale,
        'right',
        valCol,
      );
    }

    // Part description text (splits on \n and word-wraps inside 250px, up to 3 lines)
    const descrLayout = layoutHangarDescription(
      smallFont.spec,
      activeSpecDescr,
      250,
      3,
    );
    const descrLineCount = descrLayout.lines.length;
    const descrStartY =
      descrLineCount <= 1
        ? HANGAR_LAYOUT.descrY + 13
        : descrLineCount === 2
          ? HANGAR_LAYOUT.descrY + 6
          : HANGAR_LAYOUT.descrY + 3;
    const descrStepY = descrLineCount === 2 ? 13 : 10;
    for (let i = 0; i < descrLineCount; i++) {
      const line = descrLayout.lines[i]!;
      this.drawBitmapText(
        gl,
        smallFont,
        line.text,
        48,
        descrStartY + i * descrStepY,
        line.scale,
        'left',
        contrast.midPanelInk,
      );
    }

    // 4. Right panel: 3 Active Mission Cards
    this.solidVerts.length = 0;
    const missions = hangarUi.activeMissions.slice(0, 3);
    for (let i = 0; i < missions.length; i++) {
      const m = missions[i]!;
      const prog = hangarUi.missionProgress[m.id];
      const done = prog?.completed ?? false;
      const my = 172 + i * 52;
      this.pushSolidRect(
        318,
        my,
        240,
        46,
        done ? contrast.bannerPlateBg : contrast.panelMidBg,
      );
      this.pushSolidBorder(318, my, 240, 46, 1, pal.colors[7]);

      const ratio =
        prog && prog.target > 0
          ? clamp(prog.current / prog.target, 0, 1)
          : done
            ? 1
            : 0;
      this.pushSolidRect(326, my + 34, 224, 6, contrast.panelDark);
      this.pushSolidRect(
        326,
        my + 34,
        Math.round(224 * ratio),
        6,
        pal.colors[7],
      );
    }
    this.flushSolidArray(gl, this.solidVerts, this.screenProjMatrix);

    for (let i = 0; i < missions.length; i++) {
      const m = missions[i]!;
      const prog = hangarUi.missionProgress[m.id];
      const done = prog?.completed ?? false;
      const my = 172 + i * 52;
      const descrLayout = layoutMissionCardDescription(
        smallFont.spec,
        m.description,
        224,
      );
      const isTwoLineDescr = descrLayout.lines.length > 1;
      const titleY = isTwoLineDescr ? my + 4 : my + 5;
      const countText = done
        ? 'DONE'
        : `${prog?.current ?? 0}/${prog?.target ?? 1}`;
      const titleText = sanitizeControlChars(m.title).toUpperCase();
      const countWidth = measureBitmapText(smallFont.spec, countText, 1).width;
      const titleMaxW = Math.max(40, 224 - countWidth - 8);
      const titleW = measureBitmapText(smallFont.spec, titleText, 1).width;
      const titleScale =
        titleW > titleMaxW && titleW > 0 ? titleMaxW / titleW : 1;

      this.drawBitmapText(
        gl,
        smallFont,
        titleText,
        326,
        titleY,
        titleScale,
        'left',
        contrast.darkPanelFg,
      );
      this.drawBitmapText(
        gl,
        smallFont,
        countText,
        550,
        titleY,
        1,
        'right',
        contrast.darkPanelFg,
      );
      if (descrLayout.lines.length === 1) {
        this.drawBitmapText(
          gl,
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
          this.drawBitmapText(
            gl,
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

    // 5. Bottom summary bar
    const lockedNote = isPaletteUnlocked(
      pal,
      hangarUi.completedMissionsCount,
      hangarUi.sfmtUnlocked,
      isAllUnlocked,
    )
      ? ''
      : ' [LOCKED]';
    this.drawBitmapText(
      gl,
      smallFont,
      `HI: ${hangarUi.highScore}  MISSIONS: ${hangarUi.completedMissionsCount}/${hangarUi.totalMissionsCount}${lockedNote}`,
      42,
      347,
      1,
      'left',
      contrast.darkPanelFg,
    );
    this.drawBitmapText(
      gl,
      smallFont,
      `LT/RT:CYC U:${isAllUnlocked ? 'ALL' : 'LOCK'} TAB:MODS SPC:GO ~HUD`,
      558,
      347,
      1,
      'right',
      contrast.darkPanelAccent,
    );
    // Keep snapshot referenced cleanly
    if (snapshot.tick < 0) {
      this.frameDrawCalls++;
    }
  }

  private drawModDeckPanel(
    gl: WebGL2RenderingContext,
    hangarUi: HangarUiState,
    smallFont: { spec: BitmapFontSpec; tex: UploadedTexture },
  ): void {
    const pal = this.activePalette;
    const contrast = this.getMenuContrastColors(pal);
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
        descr: 'MASTER LOCK SWITCH. VANILLA 1:1 GUARANTEES EXACT ORIGINAL PHYSICS AND SHADERS.',
      },
      {
        key: 'modarsenal',
        label: 'ARSENAL+BOSS',
        value: flags.arsenalBosses ? 'ON' : 'OFF',
        descr: 'UNLOCKS RAILGUN, FLAK, CHAIN LIGHTNING, AEGIS SHIELD, DREADNOUGHT AND SKYCARRIER.',
      },
      {
        key: 'modghost',
        label: 'REPLAY GHOST',
        value: flags.replayGhost ? 'ON' : 'OFF',
        descr: 'RACES YOUR PERSONAL BEST GHOST SILHOUETTE AND TRAIL DURING LIVE SORTIES.',
      },
      {
        key: 'moddaily',
        label: 'DAILY SEED',
        value: flags.dailySeed ? 'ON' : 'OFF',
        descr: 'LOCKS THE RNG SEED TO TODAYS GLOBAL DATE FOR COMPETITIVE DAILY LEADERBOARDS.',
      },
      {
        key: 'modshader_crt',
        label: 'FX: CRT',
        value: flags.shaderFx.crtScanlines ? 'ON' : 'OFF',
        descr: 'MODULATES SUBTLE HORIZONTAL CRT SCANLINES AND VIGNETTE OVER THE 600X400 OUTPUT.',
      },
      {
        key: 'modshader_bloom',
        label: 'FX: BLOOM',
        value: flags.shaderFx.phosphorBloom ? 'ON' : 'OFF',
        descr: '8-TAP PHOSPHOR GLOW HALO AROUND EXPLOSIONS, LASERS, AND BRIGHT UI HIGHLIGHTS.',
      },
      {
        key: 'modshader_warp',
        label: 'FX: WARP',
        value: flags.shaderFx.speedWarp ? 'ON' : 'OFF',
        descr: 'SPEED-REACTIVE PERIPHERAL WARP AND CONTRAST BOOST SCALING WITH AIRSPEED.',
      },
      {
        key: 'modshader_shock',
        label: 'FX: SHOCKWAVE',
        value: flags.shaderFx.shockwaves ? 'ON' : 'OFF',
        descr: 'RADIAL SHOCKWAVE DISTORTION RINGS AROUND HEAVY DETONATIONS AND BOSS KILLS.',
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
        descr: 'SWITCHES BETWEEN SOLO, 2P CO-OP SURVIVAL, AND 1V1 BEST-OF-5 DOGFIGHT ARENA.',
      },
      {
        key: 'modp2bot',
        label: 'P2 PILOT',
        value: flags.p2BotEnabled ? 'BOT' : 'HUMAN',
        descr: 'SELECTS WHETHER PLAYER 2 IS FLOWN BY AI WINGMAN/RIVAL OR LOCAL KEYBOARD.',
      },
      {
        key: 'palettestudio',
        label: 'PAL STUDIO',
        value: 'OPEN',
        descr: 'OPEN THE LIVE 8-SLOT RGB PALETTE STUDIO WITH PRESETS AND JSON IMPORT/EXPORT.',
      },
      {
        key: 'modback',
        label: 'LOADOUT',
        value: 'BACK',
        descr: 'RETURN TO THE HANGAR WEAPON, BODY, ENGINE, AND SORTIE LAUNCH SCREEN.',
      },
    ];

    this.solidVerts.length = 0;
    for (let i = 0; i < modRows.length; i++) {
      const r = modRows[i]!;
      const ry = 70 + i * 21;
      const isSelected = r.key === activeRow;
      if (isSelected) {
        this.pushSolidRect(42, ry, 260, 19, pal.colors[7]);
      } else {
        this.pushSolidBorder(42, ry, 260, 19, 1, pal.colors[3]);
      }
    }

    // Right inspector panel
    this.pushSolidRect(318, 172, 240, 160, contrast.panelMidBg);
    this.pushSolidBorder(318, 172, 240, 160, 1, pal.colors[7]);
    this.flushSolidArray(gl, this.solidVerts, this.screenProjMatrix);

    for (let i = 0; i < modRows.length; i++) {
      const r = modRows[i]!;
      const ry = 70 + i * 21;
      const isSelected = r.key === activeRow;
      const labelCol = isSelected
        ? contrast.selectedTextInk
        : contrast.darkPanelAccent;
      const valCol = isSelected
        ? contrast.selectedTextInk
        : contrast.darkPanelFg;
      this.drawBitmapText(
        gl,
        smallFont,
        `${isSelected ? '> ' : '  '}${r.label}`,
        48,
        ry + 6,
        1,
        'left',
        labelCol,
      );
      this.drawBitmapText(
        gl,
        smallFont,
        isSelected ? `< ${r.value} >` : r.value,
        296,
        ry + 6,
        1,
        'right',
        valCol,
      );
    }

    const activeMeta =
      modRows.find((m) => m.key === activeRow) ?? modRows[0]!;
    this.drawBitmapText(
      gl,
      smallFont,
      activeMeta.label,
      326,
      180,
      1,
      'left',
      contrast.darkPanelFg,
    );
    const wrapped = wrapBitmapTextLines(smallFont.spec, activeMeta.descr, 224, 1);
    for (let i = 0; i < Math.min(5, wrapped.length); i++) {
      this.drawBitmapText(
        gl,
        smallFont,
        wrapped[i]!,
        326,
        196 + i * 11,
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
    this.drawBitmapText(gl, smallFont, dailyStr, 326, 278, 1, 'left', contrast.darkPanelFg);
    this.drawBitmapText(gl, smallFont, ghostStr, 326, 294, 1, 'left', contrast.darkPanelFg);
    const p2Hint = 'P1:WASD+F/SPC  P2:ARROWS+M/NUM0';
    const p2HintW = measureBitmapText(smallFont.spec, p2Hint, 1).width;
    const p2HintScale = p2HintW > 224 && p2HintW > 0 ? 224 / p2HintW : 1;
    this.drawBitmapText(
      gl,
      smallFont,
      p2Hint,
      326,
      310,
      p2HintScale,
      'left',
      contrast.darkPanelAccent,
    );

    this.drawBitmapText(
      gl,
      smallFont,
      flags.moddedEnabled ? 'MODE: SKYBREAKER MODDED' : 'MODE: VANILLA 1:1 LOCKED',
      42,
      347,
      1,
      'left',
      contrast.darkPanelFg,
    );
    this.drawBitmapText(
      gl,
      smallFont,
      'UP/DN:ROW  SPC/LR:SET  TAB:CLOSE',
      558,
      347,
      1,
      'right',
      contrast.darkPanelAccent,
    );
  }

  private drawPaletteStudioPanel(
    gl: WebGL2RenderingContext,
    hangarUi: HangarUiState,
    smallFont: { spec: BitmapFontSpec; tex: UploadedTexture },
  ): void {
    const pal = this.activePalette;
    const contrast = this.getMenuContrastColors(pal);
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

    this.solidVerts.length = 0;
    // Left header strip
    this.pushSolidRect(42, 68, 260, 18, contrast.panelMidBg);
    this.pushSolidBorder(42, 68, 260, 18, 1, pal.colors[7]);

    // 8 palette slot rows
    for (let i = 0; i < 8; i++) {
      const ry = 90 + i * 24;
      const isSelected = i === studio.selectedSlot;
      if (isSelected) {
        this.pushSolidRect(42, ry, 260, 21, pal.colors[7]);
      } else {
        this.pushSolidBorder(42, ry, 260, 21, 1, pal.colors[3]);
      }
      const col = getSlotTuple(i);
      this.pushSolidRect(48, ry + 3, 22, 15, col);
      this.pushSolidBorder(
        48,
        ry + 3,
        22,
        15,
        1,
        isSelected ? contrast.selectedTextInk : pal.colors[7],
      );
    }

    // RGB channel bars at bottom-left
    this.pushSolidRect(42, 284, 260, 48, contrast.panelMidBg);
    this.pushSolidBorder(42, 284, 260, 48, 1, pal.colors[7]);
    const activeTuple = getSlotTuple(studio.selectedSlot);
    const barColors: [RgbaTuple, RgbaTuple, RgbaTuple] = [
      [1, 0.28, 0.28, 1],
      [0.28, 1, 0.38, 1],
      [0.32, 0.62, 1, 1],
    ];
    for (let ch = 0; ch < 3; ch++) {
      const by = 290 + ch * 14;
      const v = clamp(activeTuple[ch] ?? 0, 0, 1);
      this.pushSolidRect(74, by + 1, 174, 8, contrast.panelDark);
      this.pushSolidRect(74, by + 1, Math.round(174 * v), 8, barColors[ch]!);
      if (ch === studio.selectedChannel) {
        this.pushSolidBorder(73, by, 176, 10, 1, pal.colors[7]);
      }
    }

    // Bottom-right miniature diorama preview showing edited palette live
    this.pushSolidRect(318, 172, 240, 112, sPal.backcol);
    this.pushSolidRect(318, 240, 240, 44, sPal.backcol);
    this.pushSolidRect(318, 238, 240, 2, sPal.colors[7]); // ocean_line
    this.pushSolidRect(336, 184, 48, 12, sPal.colors[6]); // midground cloud
    this.pushSolidRect(458, 180, 56, 14, sPal.colors[7]); // foreground cloud
    this.pushSolidRect(348, 224, 34, 14, sPal.colors[4]); // bg prop
    this.pushSolidRect(472, 210, 22, 12, sPal.colors[2]); // enemy
    this.pushSolidRect(430, 214, 10, 4, sPal.colors[5]); // bullet
    this.pushSolidRect(376, 212, 24, 10, sPal.colors[1]); // player
    this.pushSolidRect(376, 250, 24, 10, sPal.colors[3]); // reflection
    this.pushSolidRect(430, 252, 10, 4, sPal.colors[6]); // bullet reflection
    this.pushSolidBorder(318, 172, 240, 112, 1, pal.colors[7]);

    this.pushSolidRect(318, 288, 240, 44, contrast.panelMidBg);
    this.pushSolidBorder(318, 288, 240, 44, 1, pal.colors[7]);
    this.flushSolidArray(gl, this.solidVerts, this.screenProjMatrix);

    const slotsLabel = 'SLOTS';
    const slotsW = measureBitmapText(smallFont.spec, slotsLabel, 1).width;
    const palLabelMaxW = Math.max(80, 296 - (48 + slotsW + 8));
    const palLabelText = sPal.name.toUpperCase().slice(0, 18);
    const palLabelW = measureBitmapText(smallFont.spec, palLabelText, 1).width;
    const palLabelScale =
      palLabelW > palLabelMaxW && palLabelW > 0 ? palLabelMaxW / palLabelW : 1;

    this.drawBitmapText(
      gl,
      smallFont,
      slotsLabel,
      48,
      73,
      1,
      'left',
      contrast.darkPanelFg,
    );
    this.drawBitmapText(
      gl,
      smallFont,
      palLabelText,
      296,
      73,
      palLabelScale,
      'right',
      contrast.midPanelInk,
    );

    for (let i = 0; i < 8; i++) {
      const ry = 90 + i * 24;
      const isSelected = i === studio.selectedSlot;
      const col = getSlotTuple(i);
      const textCol = isSelected
        ? contrast.selectedTextInk
        : contrast.darkPanelFg;
      this.drawBitmapText(
        gl,
        smallFont,
        `${i}: ${slotLabels[i] ?? ''}`,
        76,
        ry + 7,
        1,
        'left',
        textCol,
      );
      this.drawBitmapText(
        gl,
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
      const by = 290 + ch * 14;
      const isCh = ch === studio.selectedChannel;
      const v = clamp(activeTuple[ch] ?? 0, 0, 1);
      this.drawBitmapText(
        gl,
        smallFont,
        isCh ? `[${chNames[ch]}]` : ` ${chNames[ch]} `,
        46,
        by + 2,
        1,
        'left',
        isCh ? contrast.darkPanelFg : contrast.midPanelInk,
      );
      this.drawBitmapText(
        gl,
        smallFont,
        v.toFixed(2),
        296,
        by + 2,
        1,
        'right',
        isCh ? contrast.darkPanelFg : contrast.midPanelInk,
      );
    }

    this.drawBitmapText(
      gl,
      smallFont,
      '1-4:PRESET  R:RESET',
      326,
      296,
      1,
      'left',
      contrast.darkPanelFg,
    );
    this.drawBitmapText(
      gl,
      smallFont,
      'Q/E:RGB  LT/RT:+-0.05',
      326,
      312,
      1,
      'left',
      contrast.midPanelInk,
    );

    this.drawBitmapText(
      gl,
      smallFont,
      `STUDIO SAVED: ${studio.savedCount}`,
      42,
      347,
      1,
      'left',
      contrast.darkPanelFg,
    );
    this.drawBitmapText(
      gl,
      smallFont,
      'UP/DN:SLOT  ENTER:SAVE  ESC:BACK',
      558,
      347,
      1,
      'right',
      contrast.darkPanelAccent,
    );
  }

  private drawOutpass(
    gl: WebGL2RenderingContext,
    prog: CompiledProgram,
    comboTexture: WebGLTexture,
    canvasW: number,
    canvasH: number,
  ): void {
    gl.useProgram(prog.program);
    gl.bindVertexArray(this.fullscreenVao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, comboTexture);
    this.setUniform1i(gl, prog, 'colorTexture', 0);
    this.setUniform2f(gl, prog, 'viewport', canvasW, canvasH);
    this.setColorsUniform(gl, prog, 'uniform_colors', this.activePalette.colors);

    const fx = this.effectiveFx;
    this.setUniform4f(
      gl,
      prog,
      'uFxFlags',
      fx.crtScanlines ? 1 : 0,
      fx.phosphorBloom ? 1 : 0,
      fx.speedWarp ? 1 : 0,
      fx.shockwaves ? 1 : 0,
    );
    this.setUniform4f(
      gl,
      prog,
      'uFxParams',
      this.renderElapsedSec,
      this.renderSpeedNorm,
      0,
      0,
    );
    const swLoc =
      this.getUniformLocation(gl, prog, 'uShockwaves[0]') ??
      this.getUniformLocation(gl, prog, 'uShockwaves');
    if (swLoc !== null) {
      const flat = new Float32Array(16);
      for (let i = 0; i < 4; i++) {
        const sw = this.renderShockwaves[i] ?? [0, 0, 0, 0];
        flat[i * 4 + 0] = sw[0];
        flat[i * 4 + 1] = sw[1];
        flat[i * 4 + 2] = sw[2];
        flat[i * 4 + 3] = sw[3];
      }
      gl.uniform4fv(swLoc, flat);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.frameDrawCalls++;
    gl.bindVertexArray(null);
  }

  private drawBitmapText(
    gl: WebGL2RenderingContext,
    font: ResolvedFont,
    text: string,
    x: number,
    y: number,
    scale: number,
    align: TextAlign,
    color: RgbaTuple,
    cutoffY = VIRTUAL_HEIGHT + 100,
  ): void {
    if (!this.fontProg || text.length === 0) return;
    const verts = buildBitmapTextVertices(font.spec, text, x, y, scale, align);
    if (verts.length === 0) return;

    gl.useProgram(this.fontProg.program);
    gl.bindVertexArray(this.dynamicVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicVbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, font.tex.texture);
    this.setUniform1i(gl, this.fontProg, 'diffuseTex', 0);
    this.setUniformMatrix4fv(
      gl,
      this.fontProg,
      'viewProjMatrix',
      this.screenProjMatrix,
    );
    this.setUniform4f(
      gl,
      this.fontProg,
      'textColor',
      color[0],
      color[1],
      color[2],
      color[3],
    );
    this.setUniform4f(gl, this.fontProg, 'cutoff', 0, cutoffY, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, verts.length / 4);
    this.frameDrawCalls++;
    gl.bindVertexArray(null);
  }

  private drawComboText(
    gl: WebGL2RenderingContext,
    font: { spec: BitmapFontSpec; tex: UploadedTexture },
    text: string,
    x: number,
    y: number,
    scale: number,
    align: TextAlign,
    textColor: RgbaTuple,
    fillColor: RgbaTuple,
    barhY: number,
  ): void {
    if (!this.comboFontProg || text.length === 0) return;
    const verts = buildBitmapTextVertices(font.spec, text, x, y, scale, align);
    if (verts.length === 0) return;

    gl.useProgram(this.comboFontProg.program);
    gl.bindVertexArray(this.dynamicVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicVbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STREAM_DRAW);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, font.tex.texture);
    this.setUniform1i(gl, this.comboFontProg, 'diffuseTex', 0);
    this.setUniformMatrix4fv(
      gl,
      this.comboFontProg,
      'viewProjMatrix',
      this.screenProjMatrix,
    );
    this.setUniform4f(
      gl,
      this.comboFontProg,
      'textColor',
      textColor[0],
      textColor[1],
      textColor[2],
      textColor[3],
    );
    this.setUniform4f(
      gl,
      this.comboFontProg,
      'fillColor',
      fillColor[0],
      fillColor[1],
      fillColor[2],
      fillColor[3],
    );
    this.setUniform4f(gl, this.comboFontProg, 'barh', barhY, 0, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, verts.length / 4);
    this.frameDrawCalls++;
    gl.bindVertexArray(null);
  }

  private pushSolidRect(
    x: number,
    y: number,
    w: number,
    h: number,
    color: RgbaTuple,
    out: number[] = this.solidVerts,
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

  private pushSolidBorder(
    x: number,
    y: number,
    w: number,
    h: number,
    t: number,
    color: RgbaTuple,
  ): void {
    this.pushSolidRect(x, y, w, t, color);
    this.pushSolidRect(x, y + h - t, w, t, color);
    this.pushSolidRect(x, y, t, h, color);
    this.pushSolidRect(x + w - t, y, t, h, color);
  }

  private pushWorldLineSegment(
    out: number[],
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    thickness: number,
    color: RgbaTuple,
  ): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 0.001 || thickness <= 0) return;
    const nx = (-dy / len) * (thickness * 0.5);
    const ny = (dx / len) * (thickness * 0.5);
    const [r, g, b, a] = color;
    out.push(
      x0 + nx, y0 + ny, r, g, b, a,
      x1 + nx, y1 + ny, r, g, b, a,
      x0 - nx, y0 - ny, r, g, b, a,
      x1 + nx, y1 + ny, r, g, b, a,
      x1 - nx, y1 - ny, r, g, b, a,
      x0 - nx, y0 - ny, r, g, b, a,
    );
  }

  private pushWorldHexRing(
    out: number[],
    cx: number,
    cy: number,
    radius: number,
    thickness: number,
    color: RgbaTuple,
    segments = 6,
  ): void {
    const step = (Math.PI * 2) / Math.max(3, segments);
    for (let i = 0; i < segments; i++) {
      const a0 = i * step;
      const a1 = (i + 1) * step;
      this.pushWorldLineSegment(
        out,
        cx + Math.cos(a0) * radius,
        cy + Math.sin(a0) * radius,
        cx + Math.cos(a1) * radius,
        cy + Math.sin(a1) * radius,
        thickness,
        color,
      );
    }
  }

  private pushWorldFallbackRect(
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

  private flushSolidArray(
    gl: WebGL2RenderingContext,
    verts: number[],
    viewProj: Float32Array,
  ): void {
    if (!this.solidProg || verts.length === 0) return;
    const arr = new Float32Array(verts);
    gl.useProgram(this.solidProg.program);
    gl.bindVertexArray(this.solidVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.solidVbo);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STREAM_DRAW);
    this.setUniformMatrix4fv(gl, this.solidProg, 'viewProjMatrix', viewProj);
    gl.drawArrays(gl.TRIANGLES, 0, arr.length / SOLID_VERTEX_FLOATS);
    this.frameDrawCalls++;
    gl.bindVertexArray(null);
  }

  private resolveAtlasTexture(
    atlas: SpriteAtlasSpec | undefined,
    preferredKeys: string[],
  ): UploadedTexture {
    const candidates: string[] = [];
    if (atlas) {
      candidates.push(atlas.name, atlas.texturePath);
      const base = atlas.texturePath.split(/[/\\]/).pop() ?? atlas.texturePath;
      candidates.push(base, base.replace(/\.png$/i, ''));
    }
    candidates.push(...preferredKeys);

    for (const key of candidates) {
      if (!key) continue;
      const found = this.textures.get(key);
      if (found) return found;
    }
    return this.fallbackTexture!;
  }

  private resolveFont(
    primaryName: string,
    secondaryName: string,
  ): { spec: BitmapFontSpec; tex: UploadedTexture } {
    const fonts = this.vault?.data.fonts ?? {};
    for (const name of [primaryName, secondaryName]) {
      const spec = fonts[name];
      if (!spec) continue;
      const pageBase = spec.pageFile.split(/[/\\]/).pop() ?? spec.pageFile;
      const tex =
        this.textures.get(spec.pageFile) ??
        this.textures.get(pageBase) ??
        this.textures.get(pageBase.replace(/\.png$/i, '')) ??
        this.textures.get(name);
      if (tex && Object.keys(spec.glyphs).length > 0) {
        return { spec, tex };
      }
    }
    return {
      spec: this.builtinFontSpec,
      tex: this.builtinFontTexture ?? this.fallbackTexture!,
    };
  }

  private compileProgram(
    gl: WebGL2RenderingContext,
    vertSrc: string,
    fragSrc: string,
  ): CompiledProgram | null {
    const vs = this.compileShader(gl, gl.VERTEX_SHADER, vertSrc);
    const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return null;
    }

    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      this.webglErrors++;
      return null;
    }

    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      this.webglErrors++;
      gl.deleteProgram(program);
      return null;
    }

    return { program, uniforms: new Map() };
  }

  private compileShader(
    gl: WebGL2RenderingContext,
    type: number,
    src: string,
  ): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) {
      this.webglErrors++;
      return null;
    }
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      this.webglErrors++;
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private createFbo(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
  ): FboTarget | null {
    const framebuffer = gl.createFramebuffer();
    const colorTexture = gl.createTexture();
    const depthRenderbuffer = gl.createRenderbuffer();
    if (!framebuffer || !colorTexture || !depthRenderbuffer) {
      this.webglErrors++;
      return null;
    }

    gl.bindTexture(gl.TEXTURE_2D, colorTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindRenderbuffer(gl.RENDERBUFFER, depthRenderbuffer);
    gl.renderbufferStorage(
      gl.RENDERBUFFER,
      gl.DEPTH_COMPONENT16,
      width,
      height,
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      colorTexture,
      0,
    );
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.RENDERBUFFER,
      depthRenderbuffer,
    );

    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      this.webglErrors++;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);

    return { framebuffer, colorTexture, depthRenderbuffer };
  }

  private createGeometryBuffers(gl: WebGL2RenderingContext): void {
    // Fullscreen quad [-1..1]
    this.fullscreenVao = gl.createVertexArray();
    this.fullscreenVbo = gl.createBuffer();
    gl.bindVertexArray(this.fullscreenVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenVbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Instanced sprite batch VAO
    this.spriteVao = gl.createVertexArray();
    this.spriteCornerVbo = gl.createBuffer();
    this.spriteInstanceVbo = gl.createBuffer();

    gl.bindVertexArray(this.spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteCornerVbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteInstanceVbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this.spriteInstanceScratch.byteLength,
      gl.STREAM_DRAW,
    );
    const stride = INSTANCE_FLOATS * 4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 3 * 4);
    gl.vertexAttribDivisor(2, 1);

    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 7 * 4);
    gl.vertexAttribDivisor(3, 1);

    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 2, gl.FLOAT, false, stride, 11 * 4);
    gl.vertexAttribDivisor(4, 1);

    // Dynamic text quad VAO (px, py, u, v)
    this.dynamicVao = gl.createVertexArray();
    this.dynamicVbo = gl.createBuffer();
    gl.bindVertexArray(this.dynamicVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynamicVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

    // Solid color quad VAO (px, py, r, g, b, a)
    this.solidVao = gl.createVertexArray();
    this.solidVbo = gl.createBuffer();
    gl.bindVertexArray(this.solidVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.solidVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);

    gl.bindVertexArray(null);
  }

  private resolveApexCraftSpriteName(
    sprites: Record<string, SpriteEntry>,
  ): string | undefined {
    if (sprites['apex_omega']) {
      return 'apex_omega';
    }
    const secretEntry = Object.values(sprites).find(
      (entry) => entry.size[0] === 416 && entry.size[1] === 300,
    );
    return secretEntry?.name;
  }

  private uploadVaultTextures(
    gl: WebGL2RenderingContext,
    vault: VaultAssetBundle,
  ): void {
    for (const [key, texData] of Object.entries(vault.textures)) {
      const uploaded = this.uploadRgbaTexture(
        gl,
        texData.width,
        texData.height,
        texData.rgba,
      );
      if (uploaded) {
        this.textures.set(key, uploaded);
        const base = key.split(/[/\\]/).pop() ?? key;
        this.textures.set(base, uploaded);
        this.textures.set(base.replace(/\.png$/i, ''), uploaded);
      }
    }

    // Fallback solid greyscale texture (index 1)
    if (!this.fallbackTexture) {
      const fallbackBytes = new Uint8Array(16 * 16 * 4);
      for (let i = 0; i < fallbackBytes.length; i += 4) {
        fallbackBytes[i] = 32;
        fallbackBytes[i + 1] = 32;
        fallbackBytes[i + 2] = 32;
        fallbackBytes[i + 3] = 255;
      }
      this.fallbackTexture = this.uploadRgbaTexture(gl, 16, 16, fallbackBytes);
    }

    // Built-in crisp 5x7 pixel font texture
    if (!this.builtinFontTexture) {
      this.builtinFontTexture = this.uploadRgbaTexture(
        gl,
        BUILTIN_FONT_WIDTH,
        BUILTIN_FONT_HEIGHT,
        this.builtinFontRgba,
      );
    }
  }

  private uploadRgbaTexture(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    rgba: Uint8Array,
  ): UploadedTexture | null {
    const texture = gl.createTexture();
    if (!texture) {
      this.webglErrors++;
      return null;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      Math.max(1, width),
      Math.max(1, height),
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      rgba,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { texture, width, height };
  }

  private getUniformLocation(
    gl: WebGL2RenderingContext,
    prog: CompiledProgram,
    name: string,
  ): WebGLUniformLocation | null {
    if (prog.uniforms.has(name)) {
      return prog.uniforms.get(name) ?? null;
    }
    const loc = gl.getUniformLocation(prog.program, name);
    prog.uniforms.set(name, loc);
    return loc;
  }

  private setUniform1i(
    gl: WebGL2RenderingContext,
    prog: CompiledProgram,
    name: string,
    v: number,
  ): void {
    const loc = this.getUniformLocation(gl, prog, name);
    if (loc !== null) gl.uniform1i(loc, v);
  }

  private setUniform1f(
    gl: WebGL2RenderingContext,
    prog: CompiledProgram,
    name: string,
    v: number,
  ): void {
    const loc = this.getUniformLocation(gl, prog, name);
    if (loc !== null) gl.uniform1f(loc, v);
  }

  private setUniform2f(
    gl: WebGL2RenderingContext,
    prog: CompiledProgram,
    name: string,
    x: number,
    y: number,
  ): void {
    const loc = this.getUniformLocation(gl, prog, name);
    if (loc !== null) gl.uniform2f(loc, x, y);
  }

  private setUniform4f(
    gl: WebGL2RenderingContext,
    prog: CompiledProgram,
    name: string,
    x: number,
    y: number,
    z: number,
    w: number,
  ): void {
    const loc = this.getUniformLocation(gl, prog, name);
    if (loc !== null) gl.uniform4f(loc, x, y, z, w);
  }

  private setUniformMatrix4fv(
    gl: WebGL2RenderingContext,
    prog: CompiledProgram,
    name: string,
    mat: Float32Array,
  ): void {
    const loc = this.getUniformLocation(gl, prog, name);
    if (loc !== null) gl.uniformMatrix4fv(loc, false, mat);
  }

  private setColorsUniform(
    gl: WebGL2RenderingContext,
    prog: CompiledProgram,
    name: string,
    colors: readonly RgbaTuple[],
  ): void {
    const loc = this.getUniformLocation(gl, prog, name);
    if (loc === null) return;
    const flat = new Float32Array(32);
    for (let i = 0; i < 8; i++) {
      const c = colors[i] ?? [0, 0, 0, 0];
      flat[i * 4 + 0] = c[0];
      flat[i * 4 + 1] = c[1];
      flat[i * 4 + 2] = c[2];
      flat[i * 4 + 3] = c[3];
    }
    gl.uniform4fv(loc, flat);
  }

  private drainGlErrors(gl: WebGL2RenderingContext): void {
    for (let i = 0; i < 8; i++) {
      const err = gl.getError();
      if (err === gl.NO_ERROR) break;
      this.webglErrors++;
    }
  }

  // Emergency Canvas 2D fallback ONLY when WebGL2 context creation fails
  private init2dFallback(canvas: HTMLCanvasElement): void {
    this.fallback2d = canvas.getContext('2d');
    if (typeof document !== 'undefined') {
      const off = document.createElement('canvas');
      off.width = VIRTUAL_WIDTH;
      off.height = VIRTUAL_HEIGHT;
      this.fallbackOffscreen = off;
      this.fallbackOffscreenCtx = off.getContext('2d');
    }
  }

  private render2dFallback(
    snapshot: SimSnapshot,
    hangarUi: HangarUiState | null,
    elapsedSec: number,
    camX: number,
    camY: number,
  ): void {
    const targetCtx = this.fallback2d;
    const ctx = this.fallbackOffscreenCtx ?? targetCtx;
    if (!ctx || !targetCtx || !this.canvas) return;

    const pal = this.activePalette;
    const activeBackcol =
      snapshot.mode === 'sfmt' ? pal.colors[3] : pal.backcol;
    ctx.fillStyle = rgbaToCss(activeBackcol);
    ctx.fillRect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);

    const seaScreenY = VIRTUAL_HEIGHT * 0.5 + (snapshot.seaLevel - camY);

    // Health circle exterior in sky above sea level
    const hpRatio =
      snapshot.player.health / Math.max(1, snapshot.player.maxHealth);
    if (snapshot.phase !== 'hangar' && hpRatio <= 0.99) {
      const radiusPx = hpRatio * 350;
      const px = VIRTUAL_WIDTH * 0.5 + (snapshot.player.x - camX);
      const py = VIRTUAL_HEIGHT * 0.5 + (snapshot.player.y - camY);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, VIRTUAL_WIDTH, clamp(seaScreenY, 0, VIRTUAL_HEIGHT));
      ctx.clip();
      ctx.fillStyle = rgbaToCss(pal.colors[7]);
      ctx.beginPath();
      ctx.rect(0, 0, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
      ctx.arc(px, py, Math.max(0, radiusPx), 0, Math.PI * 2, true);
      ctx.fill();
      ctx.restore();
    }

    // Sea surface
    if (seaScreenY < VIRTUAL_HEIGHT) {
      const sy = clamp(seaScreenY, 0, VIRTUAL_HEIGHT);
      ctx.fillStyle = rgbaToCss(pal.colors[3]);
      ctx.fillRect(0, sy, VIRTUAL_WIDTH, 1);
      ctx.fillStyle = rgbaToCss(pal.colors[7]);
      ctx.fillRect(0, sy - 1, VIRTUAL_WIDTH, 1);
    }

    if (snapshot.phase === 'hangar' && hangarUi) {
      const contrast = this.getMenuContrastColors(pal);
      const isModCraft =
        Boolean(hangarUi.modFlags?.moddedEnabled) &&
        (hangarUi.loadout.weapon >= 6 ||
          hangarUi.loadout.body >= 6 ||
          hangarUi.loadout.engine >= 6);
      const planeLabel = isModCraft
        ? `[MOD] ${hangarUi.planeName.toUpperCase()}`
        : hangarUi.planeName;
      ctx.fillStyle = rgbaToCss(contrast.panelDark);
      ctx.fillRect(30, 24, 540, 352);
      ctx.strokeStyle = rgbaToCss(pal.colors[7]);
      ctx.strokeRect(30, 24, 540, 352);
      ctx.fillStyle = rgbaToCss(contrast.darkPanelFg);
      ctx.font = 'bold 16px monospace';
      ctx.fillText(planeLabel, 48, 52);
      const fallbackPartCount =
        hangarUi.modFlags?.moddedEnabled && hangarUi.modFlags?.arsenalBosses
          ? 9
          : 6;
      const fallbackPalCount = hangarUi.modFlags?.moddedEnabled
        ? this.listPalettes().length
        : PALETTES.length;
      ctx.font = '12px monospace';
      ctx.fillText(
        `W(${hangarUi.loadout.weapon + 1}/${fallbackPartCount}):${hangarUi.weaponSpec.name} B(${hangarUi.loadout.body + 1}/${fallbackPartCount}):${hangarUi.bodySpec.name} E(${hangarUi.loadout.engine + 1}/${fallbackPartCount}):${hangarUi.engineSpec.name}`,
        48,
        84,
      );
      const fallbackAssets =
        hangarUi.assetMode === 'steam-local' ||
        hangarUi.vaultSource === 'steam-local'
          ? 'STEAM LOCAL'
          : hangarUi.steamAvailable
            ? 'SKYBREAKER'
            : 'SKYBREAKER [STEAM N/A]';
      ctx.fillText(
        `PAL(${hangarUi.paletteIndex + 1}/${fallbackPalCount}): ${hangarUi.paletteName}  ASSETS: ${fallbackAssets}  MODE: ${hangarUi.mode === 'sfmt' ? 'OVERDRIVE' : 'NORMAL'}`,
        48,
        106,
      );
      if (hangarUi.modDeckOpen) {
        ctx.fillText('SKYBREAKER MOD DECK', 48, 132);
      }
      if (hangarUi.paletteStudio?.open) {
        ctx.fillText('LIVE PALETTE STUDIO', 48, 154);
      }
      this.frameDrawCalls++;
    } else {
      if (snapshot.ghostPose?.alive) {
        const gx = VIRTUAL_WIDTH * 0.5 + (snapshot.ghostPose.x - camX);
        const gy = VIRTUAL_HEIGHT * 0.5 + (snapshot.ghostPose.y - camY);
        ctx.fillStyle = rgbaToCss(pal.colors[4]);
        ctx.fillRect(gx - 8, gy - 4, 16, 8);
      }

      const px = VIRTUAL_WIDTH * 0.5 + (snapshot.player.x - camX);
      const py = VIRTUAL_HEIGHT * 0.5 + (snapshot.player.y - camY);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(snapshot.player.angleDeg * DEG_TO_RAD);
      ctx.fillStyle = rgbaToCss(pal.colors[1]);
      ctx.fillRect(-10, -5, 20, 10);
      ctx.restore();

      if (snapshot.player2?.alive) {
        const p2x = VIRTUAL_WIDTH * 0.5 + (snapshot.player2.x - camX);
        const p2y = VIRTUAL_HEIGHT * 0.5 + (snapshot.player2.y - camY);
        ctx.save();
        ctx.translate(p2x, p2y);
        ctx.rotate(snapshot.player2.angleDeg * DEG_TO_RAD);
        ctx.fillStyle = rgbaToCss(pal.colors[5]);
        ctx.fillRect(-10, -5, 20, 10);
        ctx.restore();
      }

      for (const e of snapshot.enemies) {
        const ex = VIRTUAL_WIDTH * 0.5 + (e.x - camX);
        const ey = VIRTUAL_HEIGHT * 0.5 + (e.y - camY);
        ctx.fillStyle = rgbaToCss(pal.colors[2]);
        ctx.fillRect(ex - 8, ey - 6, 16, 12);
      }
      ctx.fillStyle = rgbaToCss(pal.colors[7]);
      ctx.font = 'bold 14px monospace';
      if (snapshot.dogfight) {
        ctx.fillText(
          `P1 ${snapshot.dogfight.p1Wins} - ${snapshot.dogfight.p2Wins} P2`,
          240,
          22,
        );
      } else {
        ctx.fillText(String(Math.floor(snapshot.score)).padStart(6, '0'), 12, 22);
      }
      this.frameDrawCalls++;
    }

    if (this.fallbackOffscreen && ctx !== targetCtx) {
      targetCtx.imageSmoothingEnabled = false;
      targetCtx.fillStyle = '#000';
      targetCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      const scale = Math.min(
        this.canvas.width / VIRTUAL_WIDTH,
        this.canvas.height / VIRTUAL_HEIGHT,
      );
      const dw = Math.floor(VIRTUAL_WIDTH * scale);
      const dh = Math.floor(VIRTUAL_HEIGHT * scale);
      const dx = Math.floor((this.canvas.width - dw) * 0.5);
      const dy = Math.floor((this.canvas.height - dh) * 0.5);
      targetCtx.drawImage(this.fallbackOffscreen, dx, dy, dw, dh);
    }

    void elapsedSec;
  }
}
