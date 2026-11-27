import type {
  GameMode,
  Loadout,
  MissionProgressState,
  SimSnapshot,
} from './sim';
import type { Act2ModFlags, ShaderFxConfig } from './mod';
import type {
  AssetPackMode,
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

export type HangarRow =
  | 'weapon'
  | 'body'
  | 'engine'
  | 'palette'
  | 'assets'
  | 'mode'
  | 'launch';

export type ModDeckRow =
  | 'modprofile'
  | 'modarsenal'
  | 'modghost'
  | 'moddaily'
  | 'modshader_crt'
  | 'modshader_bloom'
  | 'modshader_warp'
  | 'modshader_shock'
  | 'modmulti'
  | 'modp2bot'
  | 'palettestudio'
  | 'modback';

export interface PaletteStudioState {
  open: boolean;
  /** 0 = backcol, 1..7 = colors[1..7] */
  selectedSlot: number;
  /** 0 = R, 1 = G, 2 = B */
  selectedChannel: 0 | 1 | 2;
  palette: PaletteDefinition;
  savedCount: number;
}

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
  allUnlocked?: boolean;
  vaultSource: VaultSource;
  assetMode?: AssetPackMode;
  steamAvailable?: boolean;
  completedMissionsCount: number;
  totalMissionsCount: number;
  /** Act II Hangar Mod Switcher & Palette Studio view state */
  modDeckOpen?: boolean;
  activeModRow?: ModDeckRow;
  modFlags?: Act2ModFlags;
  dailySeedId?: string;
  dailyBestScore?: number;
  pbGhostScore?: number;
  paletteStudio?: PaletteStudioState | null;
  p2Loadout?: Loadout;
  p2PlaneName?: string;
  /** Accessible Assist Mode status displayed in Hangar */
  assistMode?: boolean;
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
  setShaderFx?(fx: ShaderFxConfig): void;
  registerCustomPalette?(palette: PaletteDefinition): void;
  reloadVault?(vault: VaultAssetBundle): void;
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
