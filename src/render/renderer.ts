import {
  VIRTUAL_HEIGHT,
  VIRTUAL_WIDTH,
  type FrameMetrics,
  type HangarUiState,
  type IRenderer,
  type PaletteDefinition,
  type PostShaderUniforms,
  type RgbaTuple,
} from '../contracts/render';
import type {
  EnemyEntity,
  ParticleEntity,
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
  DEFAULT_PALETTE_ID,
  PALETTES,
  getPaletteById,
  isPaletteUnlocked,
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

interface UploadedTexture {
  texture: WebGLTexture;
  width: number;
  height: number;
}

interface FboTarget {
  framebuffer: WebGLFramebuffer;
  colorTexture: WebGLTexture;
  depthRenderbuffer: WebGLRenderbuffer;
}

interface SpriteInstance {
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

export class WebGL2Renderer implements IRenderer {
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private fallback2d: CanvasRenderingContext2D | null = null;
  private fallbackOffscreen: HTMLCanvasElement | null = null;
  private fallbackOffscreenCtx: CanvasRenderingContext2D | null = null;

  private vault: VaultAssetBundle | null = null;
  private customPalettes: PaletteDefinition[] = [];
  private activePalette: PaletteDefinition = getPaletteById(DEFAULT_PALETTE_ID);

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

    this.defaultFbo = this.createFbo(gl, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
    this.comboFbo = this.createFbo(gl, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);

    this.createGeometryBuffers(gl);
    this.uploadVaultTextures(gl, vault);
    this.drainGlErrors(gl);
  }

  public registerPalettes(palettes: readonly PaletteDefinition[]): void {
    this.customPalettes = [...palettes];
  }

  public listPalettes(): readonly PaletteDefinition[] {
    if (this.customPalettes.length === 0) {
      return PALETTES;
    }
    const merged = [...PALETTES];
    for (const p of this.customPalettes) {
      if (!merged.some((existing) => existing.id === p.id)) {
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

    if (snapshot.phase === 'hangar') {
      this.camX = elapsedSec * 18;
      this.camY = -120;
      this.cameraInitialized = true;
    } else {
      const targetCamX = playerX + snapshot.player.vx * 14;
      const targetCamY = clamp(
        playerY + snapshot.player.vy * 10,
        snapshot.spaceLevel + 160,
        120,
      );
      if (!this.cameraInitialized || snapChangedPhase) {
        this.camX = targetCamX;
        this.camY = targetCamY;
        this.cameraInitialized = true;
      } else {
        this.camX = lerp(this.camX, targetCamX, 0.14);
        this.camY = lerp(this.camY, targetCamY, 0.14);
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
          };

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

      for (const t of this.textures.values()) {
        gl.deleteTexture(t.texture);
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
    const mainSprites: SpriteInstance[] = [];
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
      mainSprites,
      underwaterSprites,
      reflectSprites,
      worldSolidQuads,
    );

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
      this.drawSpriteBatch(
        gl,
        this.batchProg,
        spritesTex,
        worldProj,
        mainSprites,
        true,
      );
      if (underwaterSprites.length > 0) {
        this.drawSpriteBatch(
          gl,
          this.batchProg,
          spritesTex,
          worldProj,
          underwaterSprites,
          false,
        );
      }
    }

    if (worldSolidQuads.length > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.flushSolidArray(gl, worldSolidQuads, worldProj);
      gl.disable(gl.BLEND);
    }

    // Nuke sprite sequence (when nuke triggered)
    if (snapshot.player.nukeTriggered && snapshot.phase !== 'hangar') {
      this.drawNukeSequence(gl, snapshot, worldProj);
    }

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

    if (snapshot.phase === 'hangar' && hangarUi) {
      this.drawMenuPass(gl, snapshot, hangarUi, elapsedSec);
    } else {
      this.drawHudPass(gl, snapshot, elapsedSec);
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

  private collectWorldScene(
    snapshot: SimSnapshot,
    prevSnapshot: SimSnapshot,
    alpha: number,
    elapsedSec: number,
    camX: number,
    camY: number,
    mainOut: SpriteInstance[],
    underwaterOut: SpriteInstance[],
    reflectOut: SpriteInstance[],
    solidWorldOut: number[],
  ): void {
    const sprites = this.vault?.data.atlases.sprites.sprites ?? {};
    const tickTime = snapshot.tick + alpha;

    // 1. Space clouds ceiling at y = spaceLevel
    const spaceClouds = sprites['space_clouds'];
    if (spaceClouds && camY - 260 <= snapshot.spaceLevel + 120) {
      const step = Math.max(200, spaceClouds.size[0]);
      const startX = Math.floor((camX - 600) / step) * step;
      for (let tx = startX; tx <= camX + 600; tx += step) {
        mainOut.push({
          entry: spaceClouds,
          frame: Math.floor(tickTime * 0.08),
          x: tx,
          y: snapshot.spaceLevel,
          angleRad: 0,
          scaleX: 1,
          scaleY: 1,
          depth: 0.9,
          flash: 0,
          clipSea: true,
        });
      }
    }

    // 2. Midground parallax clouds (index 6)
    const paraClouds = sprites['parallax_clouds'];
    if (paraClouds) {
      const parallaxX = camX * 0.65;
      const cellW = 260;
      const minBand = Math.floor((camX - parallaxX - 420) / cellW);
      const maxBand = Math.ceil((camX - parallaxX + 420) / cellW);
      const yRows = [-220, -480, -760, -1040];
      for (let r = 0; r < yRows.length; r++) {
        const bandY = yRows[r] ?? -300;
        if (Math.abs(bandY - camY) > 360) continue;
        for (let b = minBand; b <= maxBand; b++) {
          const hash = ((b * 73856093) ^ (r * 19349663)) & 0x7fffffff;
          const cx =
            parallaxX + b * cellW + (hash % 90) - elapsedSec * (4 + (r % 3));
          const cy = bandY + ((hash >> 4) % 50) - 25;
          mainOut.push({
            entry: paraClouds,
            frame: hash % Math.max(1, paraClouds.subs.length),
            x: cx,
            y: cy,
            angleRad: 0,
            scaleX: (hash & 1) === 0 ? 1 : -1,
            scaleY: 1,
            depth: 0.85,
            flash: 0,
            clipSea: true,
          });
        }
      }
    }

    // 3. Distant parallax background props (bg_boat, bg_jet, bg_sub, bg_blimp)
    for (const p of snapshot.parallax) {
      const entry = sprites[p.spriteName];
      const py = p.kind.includes('boat') || p.kind.includes('sub')
        ? Math.min(p.y, -1)
        : p.y;
      if (entry) {
        mainOut.push({
          entry,
          frame: p.frame,
          x: p.x,
          y: py,
          angleRad: 0,
          scaleX: p.reversed ? -1 : 1,
          scaleY: 1,
          depth: 0.8,
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
          0,
          this.activePalette.colors[4],
        );
      }
    }

    // 4. Foreground clouds (index 7, reflected as index 6)
    const fgClouds = sprites['clouds'];
    if (fgClouds) {
      const parallaxX = camX * 0.35;
      const cellW = 420;
      const minBand = Math.floor((camX - parallaxX - 500) / cellW);
      const maxBand = Math.ceil((camX - parallaxX + 500) / cellW);
      const yRows = [-160, -420, -720, -1000];
      for (let r = 0; r < yRows.length; r++) {
        const bandY = yRows[r] ?? -180;
        if (Math.abs(bandY - camY) > 380) continue;
        for (let b = minBand; b <= maxBand; b++) {
          const hash = ((b * 83492791) ^ (r * 297121507)) & 0x7fffffff;
          const cx =
            parallaxX + b * cellW + (hash % 120) - elapsedSec * (8 + r * 2);
          const cy = bandY + ((hash >> 5) % 60) - 30;
          const sx = (hash & 1) === 0 ? 1 : -1;
          const inst: SpriteInstance = {
            entry: fgClouds,
            frame: hash % Math.max(1, fgClouds.subs.length),
            x: cx,
            y: cy,
            angleRad: 0,
            scaleX: sx,
            scaleY: 1,
            depth: 0.75,
            flash: 0,
            clipSea: true,
          };
          mainOut.push(inst);
          if (cy > -260) {
            reflectOut.push(inst);
          }
        }
      }
    }

    // 5. Ocean horizon line at y = seaLevel (0)
    const oceanLine = sprites['ocean_line'];
    if (oceanLine) {
      const w = Math.max(200, oceanLine.size[0]);
      const startX = Math.floor((camX - 450) / w) * w;
      for (let tx = startX; tx <= camX + 600; tx += w) {
        mainOut.push({
          entry: oceanLine,
          frame: Math.floor(tickTime * 0.15),
          x: tx + w * 0.5,
          y: snapshot.seaLevel - 0.5,
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
      return;
    }

    // 6. Enemies
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
        mainOut,
        underwaterOut,
        reflectOut,
        solidWorldOut,
      );
    }

    // 7. Player
    if (snapshot.player.alive) {
      this.collectPlayerSprites(
        snapshot,
        sprites,
        mainOut,
        underwaterOut,
        reflectOut,
        solidWorldOut,
      );
    }

    // 8. Projectiles
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
        mainOut,
        underwaterOut,
        reflectOut,
        solidWorldOut,
      );
    }

    // 9. Particles & explosions
    for (const part of snapshot.particles) {
      this.collectParticleSprites(
        part,
        sprites,
        mainOut,
        underwaterOut,
        reflectOut,
        solidWorldOut,
      );
    }
  }

  private collectEnemySprites(
    enemy: EnemyEntity,
    prevEnemy: EnemyEntity | undefined,
    alpha: number,
    tick: number,
    sprites: Record<string, SpriteEntry>,
    mainOut: SpriteInstance[],
    underwaterOut: SpriteInstance[],
    reflectOut: SpriteInstance[],
    solidWorldOut: number[],
  ): void {
    const canInterp =
      prevEnemy &&
      Math.hypot(enemy.x - prevEnemy.x, enemy.y - prevEnemy.y) < 120;
    const ex = canInterp ? lerp(prevEnemy.x, enemy.x, alpha) : enemy.x;
    const ey = canInterp ? lerp(prevEnemy.y, enemy.y, alpha) : enemy.y;
    const hullTransform = resolveEnemyRenderTransform(enemy);
    const angleRad = hullTransform.angleRad;
    const flash = enemy.flashTicks > 0 ? 1 : 0;

    const isSub = enemy.kind === 'Submarine' || enemy.kind === 'AceMarine';
    const targetList = isSub && ey > -18 ? underwaterOut : mainOut;
    const clipSea = !(isSub && ey > -18);

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
          depth: 0.45,
          flash,
          clipSea,
        };
        targetList.push(inst);
        if (py < 4 && !isSub) {
          reflectOut.push(inst);
        } else if (isSub && py <= 0) {
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

    if (enemy.kind === 'Blimp') {
      const bodyName =
        enemy.state === 'sinking' || enemy.state === 'falling'
          ? 'blimp_die'
          : enemy.spriteMain || 'blimp';
      pushOrFallback(
        bodyName,
        ex,
        ey,
        hullTransform.angleRad,
        0,
        260,
        96,
        this.activePalette.colors[2],
        hullTransform.scaleX,
        hullTransform.scaleY,
      );
      const prop = sprites['blimp_anim'];
      if (prop && enemy.state !== 'sinking' && enemy.state !== 'falling') {
        const inst: SpriteInstance = {
          entry: prop,
          frame: tick >> 1,
          x: ex,
          y: ey,
          angleRad: hullTransform.angleRad,
          scaleX: hullTransform.scaleX,
          scaleY: hullTransform.scaleY,
          depth: 0.42,
          flash,
          clipSea: true,
        };
        mainOut.push(inst);
        reflectOut.push(inst);
      }
      pushOrFallback(
        enemy.spriteGun || 'big_boat_gun',
        ex,
        ey + 68,
        enemy.gunAngleDeg * DEG_TO_RAD,
        0,
        24,
        6,
        this.activePalette.colors[2],
      );
      return;
    }

    if (enemy.kind === 'Boat' || enemy.kind === 'BigBoat') {
      const isBig = enemy.kind === 'BigBoat';
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
        isBig ? 220 : 56,
        isBig ? 42 : 16,
        this.activePalette.colors[2],
        hullTransform.scaleX,
        hullTransform.scaleY,
      );

      if (enemy.state !== 'sinking') {
        const gunName =
          enemy.spriteGun || (isBig ? 'big_boat_gun' : 'small_boat_gun');
        if (isBig) {
          pushOrFallback(
            gunName,
            ex - 55 * hullTransform.scaleX,
            ey - 28,
            enemy.gunAngleDeg * DEG_TO_RAD,
            0,
            24,
            6,
            this.activePalette.colors[2],
          );
          pushOrFallback(
            gunName,
            ex + 55 * hullTransform.scaleX,
            ey - 28,
            enemy.gunAngleDeg * DEG_TO_RAD,
            0,
            24,
            6,
            this.activePalette.colors[2],
          );
        } else {
          pushOrFallback(
            gunName,
            ex,
            ey - 10,
            enemy.gunAngleDeg * DEG_TO_RAD,
            0,
            14,
            4,
            this.activePalette.colors[2],
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
      );
      if (isAce && enemy.state !== 'sinking') {
        pushOrFallback(
          enemy.spriteGun || 'big_boat_gun',
          ex,
          ey - 20,
          enemy.gunAngleDeg * DEG_TO_RAD,
          0,
          24,
          6,
          this.activePalette.colors[2],
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
      );
      return;
    }

    // Airplanes: Fighter, Jet, Ace, LaserAce
    const crash = enemy.state === 'falling' && enemy.kind === 'Jet';
    const bodyName = crash ? 'jet_body_crash' : enemy.spriteMain;
    const wingsName = crash ? 'jet_wings_crash' : enemy.spriteSecondary;

    pushOrFallback(
      bodyName,
      ex,
      ey,
      angleRad,
      0,
      enemy.width || 22,
      enemy.height || 14,
      this.activePalette.colors[2],
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
      );
    }

    // Jet / Ace thruster accent
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
          depth: 0.48,
          flash: 0,
          clipSea: true,
        };
        mainOut.push(inst);
        reflectOut.push(inst);
      }
    } else if (enemy.kind === 'Ace' || enemy.kind === 'LaserAce') {
      const aceBoost = sprites['fx_aceboost_loop'];
      if (aceBoost) {
        const inst: SpriteInstance = {
          entry: aceBoost,
          frame: tick >> 1,
          x: ex,
          y: ey,
          angleRad,
          scaleX: 1,
          scaleY: 1,
          depth: 0.48,
          flash: 0,
          clipSea: true,
        };
        mainOut.push(inst);
        reflectOut.push(inst);
      }
    }

    // LaserAce active laser beam
    if (enemy.kind === 'LaserAce' && enemy.laserActive) {
      const len = Math.max(40, enemy.laserLength || 520);
      const laserAngleRad = enemy.gunAngleDeg * DEG_TO_RAD;
      const midX = ex + Math.cos(laserAngleRad) * (len * 0.5);
      const midY = ey + Math.sin(laserAngleRad) * (len * 0.5);
      const elaser = sprites['projectile_Elaser'];
      if (elaser) {
        const inst: SpriteInstance = {
          entry: elaser,
          frame: tick,
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

  private collectPlayerSprites(
    snapshot: SimSnapshot,
    sprites: Record<string, SpriteEntry>,
    mainOut: SpriteInstance[],
    underwaterOut: SpriteInstance[],
    reflectOut: SpriteInstance[],
    solidWorldOut: number[],
  ): void {
    const p = snapshot.player;
    const rad = p.angleDeg * DEG_TO_RAD;
    const flash = p.flashTicks > 0 ? 1 : 0;
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
        this.pushWorldFallbackRect(
          solidWorldOut,
          p.x,
          p.y,
          fallbackW,
          fallbackH,
          rad,
          flash > 0 ? this.activePalette.colors[7] : this.activePalette.colors[1],
        );
      }
    };

    // Boost / Hover flame behind engine
    if (p.boosting) {
      const boostSprite =
        p.boostAnimFrame < 4 && p.engineSpec.booststartsprite
          ? p.engineSpec.booststartsprite
          : p.engineSpec.boostloopsprite || 'fx_boostloop';
      const boostEntry = sprites[boostSprite];
      if (boostEntry) {
        const inst: SpriteInstance = {
          entry: boostEntry,
          frame: p.boostAnimFrame,
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
        if (p.y < 10) reflectOut.push(inst);
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
          frame: snapshot.tick >> 1,
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
      }
    }

    if (p.isUrauser) {
      pushPart('urauser', 80, 60, snapshot.tick >> 1, 0.25);
    } else {
      const engineFallbacks = [
        'engine_original',
        'engine_superboost',
        'engine_gungine',
        'engine_underwater',
        'engine_hover',
        'engine_original',
      ];
      const bodyFallbacks = [
        'body_original',
        'body_armor',
        'body_melee',
        'body_nuke',
        'body_bomb',
        'body_original',
      ];
      const wingFallbacks = [
        'wings_original',
        'wings_laser',
        'wings_spread',
        'wings_missiles',
        'wings_cannon',
        'wings_original',
      ];

      pushPart(
        p.engineSpec.sprite || engineFallbacks[p.loadout.engine],
        22,
        12,
        0,
        0.32,
      );
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
          frame: tick,
          x: midX,
          y: midY,
          angleRad: rad,
          scaleX: len / Math.max(1, entry.size[0]),
          scaleY: 1,
          depth: 0.36,
          flash: 0,
          clipSea,
        };
        target.push(inst);
        if (!isUnderwater) reflectOut.push(inst);
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
    };

    const entry = sprites[spriteMap[proj.kind]];
    if (entry) {
      const inst: SpriteInstance = {
        entry,
        frame: tick,
        x: px,
        y: py,
        angleRad: rad,
        scaleX: 1,
        scaleY: 1,
        depth: 0.37,
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

  private collectParticleSprites(
    part: ParticleEntity,
    sprites: Record<string, SpriteEntry>,
    mainOut: SpriteInstance[],
    underwaterOut: SpriteInstance[],
    reflectOut: SpriteInstance[],
    solidWorldOut: number[],
  ): void {
    const entry = sprites[part.spriteName];
    const target = part.allowBelowSea ? underwaterOut : mainOut;
    const clipSea = !part.allowBelowSea;

    if (entry) {
      const inst: SpriteInstance = {
        entry,
        frame: Math.floor(part.frame),
        x: part.x,
        y: part.y,
        angleRad: part.angleDeg * DEG_TO_RAD,
        scaleX: part.scaleX || 1,
        scaleY: part.scaleY || 1,
        depth: clamp(0.5 + part.depth * 0.001, 0.05, 0.95),
        flash: 0,
        clipSea,
      };
      target.push(inst);
      if (part.y < 8 && (part.isExplosion || part.kind.includes('splash'))) {
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
      const frame = Math.min(
        Math.max(0, nukeEntry.subs.length - 1),
        Math.floor(snapshot.player.nukeTicks * 0.5),
      );
      const scale = Math.max(0.5, snapshot.player.nukeRadius / 180);
      this.drawSpriteBatch(
        gl,
        this.batchProg,
        nukeTex,
        worldProj,
        [
          {
            entry: nukeEntry,
            frame,
            x: snapshot.player.x,
            y: snapshot.player.y,
            angleRad: 0,
            scaleX: scale,
            scaleY: scale,
            depth: 0.1,
            flash: 0,
            clipSea: false,
          },
        ],
        false,
      );
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
  ): void {
    if (instances.length === 0) return;

    gl.useProgram(prog.program);
    gl.bindVertexArray(this.spriteVao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.texture);
    this.setUniform1i(gl, prog, 'diffuseTex', 0);
    this.setUniformMatrix4fv(gl, prog, 'uViewProjMatrix', viewProj);
    this.setUniform2f(gl, prog, 'uSpritesheetSize', tex.width, tex.height);
    this.setUniform1f(gl, prog, 'uClipSea', clipSea ? 1.0 : 0.0);
    this.setColorsUniform(gl, prog, 'uniform_colors', this.activePalette.colors);

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

  private drawHudPass(
    gl: WebGL2RenderingContext,
    snapshot: SimSnapshot,
    elapsedSec: number,
  ): void {
    // ZERO DOM health bar during vanilla play — only Score, Combo gauge, and Mission Toast!
    const pal = this.activePalette;
    const fg = pal.colors[7];
    const shadow = pal.colors[1];
    const dim = pal.colors[3];
    const warn = pal.colors[2];

    const scoreFont = this.resolveFont('fntb', 'fntm');
    const smallFont = this.resolveFont('fnts', 'fntm');

    const scoreStr = String(Math.floor(snapshot.score)).padStart(6, '0');
    const scoreScale = scoreFont.spec === this.builtinFontSpec ? 2 : 1;
    this.drawBitmapText(
      gl,
      scoreFont,
      scoreStr,
      12,
      10,
      scoreScale,
      'left',
      shadow,
    );
    this.drawBitmapText(gl, scoreFont, scoreStr, 11, 9, scoreScale, 'left', fg);

    const smallScale = 1;
    const subHudStartY =
      scoreFont.spec === this.builtinFontSpec
        ? 28
        : 9 + Math.round(scoreFont.spec.lineHeight * scoreScale) - 2;
    if (snapshot.mode === 'sfmt') {
      this.drawBitmapText(
        gl,
        smallFont,
        'SFMT',
        12,
        subHudStartY,
        smallScale,
        'left',
        warn,
      );
    }
    if (snapshot.autopilotEnabled) {
      this.drawBitmapText(
        gl,
        smallFont,
        'ACE BOT',
        12,
        snapshot.mode === 'sfmt' ? subHudStartY + 12 : subHudStartY,
        smallScale,
        'left',
        pal.colors[2],
      );
    }

    // Combo text using combofont.shader vertical barh decay
    if (snapshot.combo > 1 || snapshot.comboTimer > 0) {
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
        shadow,
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

      this.solidVerts.length = 0;
      this.pushSolidRect(150, 8, 300, 22, shadow);
      this.pushSolidBorder(150, 8, 300, 22, 1, fg);
      this.flushSolidArray(gl, this.solidVerts, this.screenProjMatrix);

      this.drawBitmapText(
        gl,
        smallFont,
        label,
        VIRTUAL_WIDTH * 0.5,
        15,
        1,
        'center',
        fg,
      );
    }
  }

  private drawPausePass(gl: WebGL2RenderingContext): void {
    const pal = this.activePalette;
    if (this.pauseLinesProg) {
      gl.useProgram(this.pauseLinesProg.program);
      gl.bindVertexArray(this.fullscreenVao);
      this.setUniform4f(
        gl,
        this.pauseLinesProg,
        'uLineColor',
        pal.colors[1][0],
        pal.colors[1][1],
        pal.colors[1][2],
        0.45,
      );
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      this.frameDrawCalls++;
      gl.bindVertexArray(null);
    }

    this.solidVerts.length = 0;
    this.pushSolidRect(170, 158, 260, 74, pal.colors[1]);
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
      pal.colors[7],
    );
    this.drawBitmapText(
      gl,
      smallFont,
      'ESC RESUME  -  R RETRY  -  H HANGAR',
      VIRTUAL_WIDTH * 0.5,
      208,
      1,
      'center',
      pal.colors[5],
    );
  }

  private drawGameOverCard(
    gl: WebGL2RenderingContext,
    snapshot: SimSnapshot,
    elapsedSec: number,
  ): void {
    const pal = this.activePalette;
    const isSfmt = snapshot.mode === 'sfmt';
    const highScore = isSfmt
      ? snapshot.profile.highScoreSfmt
      : snapshot.profile.highScoreNormal;

    this.solidVerts.length = 0;
    this.pushSolidRect(120, 96, 360, 206, [
      pal.colors[1][0],
      pal.colors[1][1],
      pal.colors[1][2],
      0.92,
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
    const title = snapshot.player.nukeTriggered ? 'NUKED ALL!' : 'SHOT DOWN';
    this.drawBitmapText(
      gl,
      bigFont,
      title,
      VIRTUAL_WIDTH * 0.5,
      titleY,
      titleScale,
      'center',
      pal.colors[7],
    );

    this.drawBitmapText(
      gl,
      smallFont,
      snapshot.player.planeName.toUpperCase(),
      VIRTUAL_WIDTH * 0.5,
      146,
      1,
      'center',
      pal.colors[5],
    );

    const rows: [string, string][] = [
      ['SCORE', String(Math.floor(snapshot.score))],
      ['BEST', String(Math.floor(Math.max(highScore, snapshot.score)))],
      ['KILLS', String(snapshot.killsThisSortie)],
      ['MISSIONS', `${snapshot.profile.completedMissions.length} / 90`],
    ];
    for (let i = 0; i < rows.length; i++) {
      const [label, val] = rows[i]!;
      const ry = 172 + i * 20;
      this.drawBitmapText(gl, smallFont, label, 154, ry, 1, 'left', pal.colors[3]);
      this.drawBitmapText(gl, smallFont, val, 446, ry, 1, 'right', pal.colors[7]);
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
      blink ? pal.colors[7] : pal.colors[5],
    );
  }

  private drawMenuPass(
    gl: WebGL2RenderingContext,
    snapshot: SimSnapshot,
    hangarUi: HangarUiState,
    elapsedSec: number,
  ): void {
    const pal = this.activePalette;
    const isSfmt = hangarUi.mode === 'sfmt';

    // 1. Projector screen backdrop and frame inside 600x400 FBO
    const screenBg: RgbaTuple = isSfmt
      ? [pal.colors[2][0] * 0.35, pal.colors[2][1] * 0.15, pal.colors[2][2] * 0.18, 0.94]
      : [pal.colors[1][0], pal.colors[1][1], pal.colors[1][2], 0.92];

    this.solidVerts.length = 0;
    // Projector top housing bar
    this.pushSolidRect(0, 0, VIRTUAL_WIDTH, 18, pal.colors[1]);
    this.pushSolidRect(0, 18, VIRTUAL_WIDTH, 2, pal.colors[7]);
    // Pulldown projector canvas
    this.pushSolidRect(26, 22, 548, 352, screenBg);
    this.pushSolidBorder(26, 22, 548, 352, 2, pal.colors[7]);
    // Bottom pull-rod & rope
    this.pushSolidRect(22, 374, 556, 4, pal.colors[7]);
    this.pushSolidRect(298, 378, 4, 18, pal.colors[3]);
    // Title banner plate
    this.pushSolidRect(42, 30, 516, 30, pal.colors[2]);
    this.pushSolidBorder(42, 30, 516, 30, 1, pal.colors[7]);
    // Aircraft preview stage box (top-right)
    this.pushSolidRect(318, 68, 240, 96, pal.backcol);
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
    const previewX = 438;
    const previewY = 112 + Math.sin(elapsedSec * 2.4) * 3;
    const previewAngle = Math.sin(elapsedSec * 1.5) * 0.08 - 0.15;
    const previewSprites: SpriteInstance[] = [];
    const previewFallback: number[] = [];
    const isUrauser =
      hangarUi.loadout.weapon === 5 &&
      hangarUi.loadout.body === 5 &&
      hangarUi.loadout.engine === 5;

    const addPreviewPart = (name: string | undefined): void => {
      const entry = name ? sprites[name] : undefined;
      if (entry) {
        previewSprites.push({
          entry,
          frame: 0,
          x: previewX,
          y: previewY,
          angleRad: previewAngle,
          scaleX: isUrauser ? 0.55 : 2.2,
          scaleY: isUrauser ? 0.55 : 2.2,
          depth: 0.2,
          flash: 0,
          clipSea: false,
        });
      }
    };

    if (isUrauser) {
      addPreviewPart('urauser');
    } else {
      addPreviewPart(hangarUi.engineSpec.sprite || 'engine_original');
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
      );
    } else {
      this.pushWorldFallbackRect(
        previewFallback,
        previewX,
        previewY,
        44,
        24,
        previewAngle,
        pal.colors[1],
      );
      this.flushSolidArray(gl, previewFallback, this.screenProjMatrix);
    }

    // 3. Left customization rows
    const smallFont = this.resolveFont('fnts', 'fntm');
    const medFont = this.resolveFont('fntm', 'fnts');
    const medScale = medFont.spec === this.builtinFontSpec ? 2 : 1;
    const bannerY = Math.round(
      30 + (30 - medFont.spec.lineHeight * medScale) * 0.5,
    );

    // Header
    this.drawBitmapText(
      gl,
      smallFont,
      'LUFTRAUSERS HANGAR  //  PROJECTOR MK-I',
      VIRTUAL_WIDTH * 0.5,
      5,
      1,
      'center',
      pal.colors[7],
    );

    // Dynamic plane name banner
    this.drawBitmapText(
      gl,
      medFont,
      hangarUi.planeName.toUpperCase(),
      VIRTUAL_WIDTH * 0.5,
      bannerY,
      medScale,
      'center',
      pal.colors[7],
    );

    const activeSpecDescr =
      hangarUi.activeRow === 'weapon'
        ? hangarUi.weaponSpec.descr
        : hangarUi.activeRow === 'body'
          ? hangarUi.bodySpec.descr
          : hangarUi.activeRow === 'engine'
            ? hangarUi.engineSpec.descr
            : hangarUi.activeRow === 'palette'
              ? `ACTIVE PALETTE: ${hangarUi.paletteName}`
              : hangarUi.activeRow === 'mode'
                ? hangarUi.sfmtUnlocked
                  ? 'SUPER FAST MODE TURBO'
                  : 'COMPLETE ALL MISSIONS TO UNLOCK SFMT'
                : 'PRESS SPACE OR ENTER TO LAUNCH SORTIE';

    const rowDefs: {
      key: HangarUiState['activeRow'];
      label: string;
      value: string;
    }[] = [
      {
        key: 'weapon',
        label: 'WEAPON',
        value: hangarUi.weaponSpec.name.toUpperCase(),
      },
      {
        key: 'body',
        label: 'BODY',
        value: hangarUi.bodySpec.name.toUpperCase(),
      },
      {
        key: 'engine',
        label: 'ENGINE',
        value: hangarUi.engineSpec.name.toUpperCase(),
      },
      {
        key: 'palette',
        label: 'PALETTE',
        value: hangarUi.paletteName.toUpperCase(),
      },
      {
        key: 'mode',
        label: 'MODE',
        value: hangarUi.sfmtUnlocked
          ? hangarUi.mode.toUpperCase()
          : `${hangarUi.mode.toUpperCase()} [SFMT LOCKED]`,
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
      const ry = 70 + i * 38;
      const isSelected = hangarUi.activeRow === r.key;
      const boxCol = isSelected ? pal.colors[7] : pal.colors[3];
      if (isSelected) {
        this.pushSolidRect(42, ry, 260, 32, boxCol);
      } else {
        this.pushSolidBorder(42, ry, 260, 32, 1, pal.colors[3]);
      }

      // 8-color palette preview strip on palette row
      if (r.key === 'palette') {
        for (let c = 1; c <= 7; c++) {
          this.pushSolidRect(
            188 + (c - 1) * 14,
            ry + 18,
            12,
            8,
            pal.colors[c] ?? pal.colors[7],
          );
        }
        this.pushSolidRect(174, ry + 18, 12, 8, pal.backcol);
      }
    }

    // Active part description bar
    this.pushSolidRect(42, 300, 260, 32, pal.colors[3]);
    this.flushSolidArray(gl, this.solidVerts, this.screenProjMatrix);

    for (let i = 0; i < rowDefs.length; i++) {
      const r = rowDefs[i]!;
      const ry = 70 + i * 38;
      const isSelected = hangarUi.activeRow === r.key;
      const labelCol = isSelected ? pal.colors[1] : pal.colors[5];
      const valCol = isSelected ? pal.colors[1] : pal.colors[7];
      const prefix = isSelected ? '> ' : '  ';
      this.drawBitmapText(
        gl,
        smallFont,
        `${prefix}${r.label}`,
        48,
        ry + 5,
        1,
        'left',
        labelCol,
      );
      this.drawBitmapText(
        gl,
        smallFont,
        isSelected ? `< ${r.value} >` : r.value,
        294,
        ry + (r.key === 'palette' ? 5 : 14),
        1,
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
      descrLineCount <= 1 ? 311 : descrLineCount === 2 ? 305 : 302;
    const descrStepY = descrLineCount === 2 ? 12 : 10;
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
        pal.colors[1],
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
      this.pushSolidRect(318, my, 240, 46, done ? pal.colors[2] : pal.colors[3]);
      this.pushSolidBorder(318, my, 240, 46, 1, pal.colors[7]);

      const ratio =
        prog && prog.target > 0
          ? clamp(prog.current / prog.target, 0, 1)
          : done
            ? 1
            : 0;
      this.pushSolidRect(326, my + 34, 224, 6, pal.colors[1]);
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
        pal.colors[7],
      );
      this.drawBitmapText(
        gl,
        smallFont,
        countText,
        550,
        titleY,
        1,
        'right',
        pal.colors[7],
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
          pal.colors[1],
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
            pal.colors[1],
          );
        }
      }
    }

    // 5. Bottom summary bar
    const lockedNote = isPaletteUnlocked(
      pal,
      hangarUi.completedMissionsCount,
      hangarUi.sfmtUnlocked,
    )
      ? ''
      : ' [LOCKED]';
    this.drawBitmapText(
      gl,
      smallFont,
      `HI: ${hangarUi.highScore}   MISSIONS: ${hangarUi.completedMissionsCount}/${hangarUi.totalMissionsCount}${lockedNote}`,
      42,
      347,
      1,
      'left',
      pal.colors[7],
    );
    this.drawBitmapText(
      gl,
      smallFont,
      `UP/DN:ROW  LT/RT:CYCLE  SPACE:LAUNCH  ~HUD`,
      558,
      347,
      1,
      'right',
      pal.colors[5],
    );
    // Keep snapshot referenced cleanly
    if (snapshot.tick < 0) {
      this.frameDrawCalls++;
    }
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

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.frameDrawCalls++;
    gl.bindVertexArray(null);
  }

  private drawBitmapText(
    gl: WebGL2RenderingContext,
    font: { spec: BitmapFontSpec; tex: UploadedTexture },
    text: string,
    x: number,
    y: number,
    scale: number,
    align: TextAlign,
    color: RgbaTuple,
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
    this.setUniform4f(gl, this.fontProg, 'cutoff', 0, VIRTUAL_HEIGHT + 100, 0, 0);

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
    const fallbackBytes = new Uint8Array(16 * 16 * 4);
    for (let i = 0; i < fallbackBytes.length; i += 4) {
      fallbackBytes[i] = 32;
      fallbackBytes[i + 1] = 32;
      fallbackBytes[i + 2] = 32;
      fallbackBytes[i + 3] = 255;
    }
    this.fallbackTexture = this.uploadRgbaTexture(gl, 16, 16, fallbackBytes);

    // Built-in crisp 5x7 pixel font texture
    this.builtinFontTexture = this.uploadRgbaTexture(
      gl,
      BUILTIN_FONT_WIDTH,
      BUILTIN_FONT_HEIGHT,
      this.builtinFontRgba,
    );
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
    ctx.fillStyle = rgbaToCss(pal.backcol);
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
      ctx.fillStyle = rgbaToCss(pal.colors[1]);
      ctx.fillRect(30, 24, 540, 352);
      ctx.strokeStyle = rgbaToCss(pal.colors[7]);
      ctx.strokeRect(30, 24, 540, 352);
      ctx.fillStyle = rgbaToCss(pal.colors[7]);
      ctx.font = 'bold 16px monospace';
      ctx.fillText(hangarUi.planeName, 48, 52);
      ctx.font = '12px monospace';
      ctx.fillText(
        `W:${hangarUi.weaponSpec.name} B:${hangarUi.bodySpec.name} E:${hangarUi.engineSpec.name}`,
        48,
        84,
      );
      ctx.fillText(
        `PALETTE: ${hangarUi.paletteName}  MODE: ${hangarUi.mode.toUpperCase()}`,
        48,
        106,
      );
      this.frameDrawCalls++;
    } else {
      const px = VIRTUAL_WIDTH * 0.5 + (snapshot.player.x - camX);
      const py = VIRTUAL_HEIGHT * 0.5 + (snapshot.player.y - camY);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(snapshot.player.angleDeg * DEG_TO_RAD);
      ctx.fillStyle = rgbaToCss(pal.colors[1]);
      ctx.fillRect(-10, -5, 20, 10);
      ctx.restore();

      for (const e of snapshot.enemies) {
        const ex = VIRTUAL_WIDTH * 0.5 + (e.x - camX);
        const ey = VIRTUAL_HEIGHT * 0.5 + (e.y - camY);
        ctx.fillStyle = rgbaToCss(pal.colors[2]);
        ctx.fillRect(ex - 8, ey - 6, 16, 12);
      }
      ctx.fillStyle = rgbaToCss(pal.colors[7]);
      ctx.font = 'bold 14px monospace';
      ctx.fillText(String(Math.floor(snapshot.score)).padStart(6, '0'), 12, 22);
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
