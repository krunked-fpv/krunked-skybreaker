import type {
  GameMode,
  Loadout,
  MissionProgressState,
  SimSnapshot,
} from './sim';
import type {
  BodySpec,
  EngineSpec,
  MissionSpec,
  VaultAssetBundle,
  VaultSource,
  WeaponSpec,
} from './vault';

export const VIRTUAL_WIDTH = 600;
export const VIRTUAL_HEIGHT = 400;

export type RgbaTuple = [number, number, number, number];

export interface PaletteDefinition {
  id: string;
  name: string;
  unlockMissionsRequired: number;
  backcol: RgbaTuple;
  colors: [
    RgbaTuple,
    RgbaTuple,
    RgbaTuple,
    RgbaTuple,
    RgbaTuple,
    RgbaTuple,
    RgbaTuple,
    RgbaTuple,
  ];
}

export interface PostShaderUniforms {
  viewport: [number, number];
  cameraPosition: [number, number, number, number];
  healthRadius: [number, number, number, number];
  playerPosition: [number, number, number, number];
  cameraWorldPosition: [number, number, number, number];
  delta: [number, number, number, number];
  uniform_backcol: RgbaTuple;
  uniform_colors: RgbaTuple[];
}

export type HangarRow = 'weapon' | 'body' | 'engine' | 'palette' | 'mode' | 'launch';

export interface HangarUiState {
  activeRow: HangarRow;
  loadout: Loadout;
  mode: GameMode;
  paletteIndex: number;
  paletteName: string;
  planeName: string;
  weaponSpec: WeaponSpec;
  bodySpec: BodySpec;
  engineSpec: EngineSpec;
  activeMissions: readonly MissionSpec[];
  missionProgress: Record<number, MissionProgressState>;
  unlockedWeapons: readonly number[];
  unlockedBodies: readonly number[];
  unlockedEngines: readonly number[];
  highScore: number;
  sfmtUnlocked: boolean;
  vaultSource: VaultSource;
  completedMissionsCount: number;
  totalMissionsCount: number;
}

export interface FrameMetrics {
  fps: number;
  avgFrameDeltaMs: number;
  p95FrameDeltaMs: number;
  drawCalls: number;
  webglErrors: number;
  virtualWidth: number;
  virtualHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  activePaletteId: string;
}

export interface IRenderer {
  init(canvas: HTMLCanvasElement, vault: VaultAssetBundle): void;
  setPalette(paletteId: string): void;
  getPalette(): PaletteDefinition;
  listPalettes(): readonly PaletteDefinition[];
  render(
    snapshot: SimSnapshot,
    prevSnapshot: SimSnapshot,
    alpha: number,
    hangarUi: HangarUiState | null,
    elapsedSec: number,
  ): void;
  getFrameMetrics(): FrameMetrics;
  getLastPostUniforms(): PostShaderUniforms;
  resize(width: number, height: number): void;
  dispose(): void;
}
