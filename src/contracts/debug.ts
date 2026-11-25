import type { AudioSyncMetrics } from './audio';
import type { Act2ModFlags } from './mod';
import type { FrameMetrics, PaletteDefinition, PostShaderUniforms } from './render';
import type {
  DogfightState,
  GameMode,
  InputState,
  Loadout,
  PilotProfile,
  SimPhase,
} from './sim';
import type { AssetPackMode, EnemyKind, VaultSource } from './vault';

export interface SkybreakerDebugState {
  vaultSource: VaultSource;
  assetMode?: AssetPackMode;
  steamAvailable?: boolean;
  phase: SimPhase;
  mode: GameMode;
  paused: boolean;
  tick: number;
  score: number;
  combo: number;
  comboTimer: number;
  difficulty: number;
  planeName: string;
  loadout: Loadout;
  paletteId: string;
  player: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    angleDeg: number;
    health: number;
    maxHealth: number;
    alive: boolean;
    boosting: boolean;
    firing: boolean;
    healing: boolean;
    underwater: boolean;
    inSpace: boolean;
    shieldReady?: boolean;
  };
  enemyCount: number;
  enemyCountsByKind: Record<string, number>;
  projectileCount: number;
  particleCount: number;
  hitstopTicks: number;
  screenShake: number;
  autopilotEnabled: boolean;
  completedMissionsCount: number;
  activeMissionIds: number[];
  sfmtUnlocked: boolean;
  webglErrors: number;
  consoleErrorCount: number;
  postUniforms: PostShaderUniforms;
  /** Act II Telemetry */
  modFlags?: Act2ModFlags;
  modDeckOpen?: boolean;
  paletteStudioOpen?: boolean;
  ghostActive?: boolean;
  dailySeedId?: string | null;
  player2Alive?: boolean;
  dogfight?: DogfightState | null;
  shockwaveCount?: number;
}

export type RauserDebugState = SkybreakerDebugState;

export interface SkybreakerDebugApi {
  getState(): SkybreakerDebugState;
  setLoadout(w: number, b: number, e: number): void;
  setPalette(id: string): void;
  setMode(mode: GameMode): void;
  launch(seed?: number): void;
  returnToHangar(): void;
  toggleAutopilot(enabled: boolean): void;
  setInput(partial: Partial<InputState>): void;
  stepFrames(n: number, input?: Partial<InputState>): void;
  damagePlayer(amount: number): void;
  spawnEnemy(kind: EnemyKind, x?: number, y?: number): void;
  getAudioSyncMetrics(): AudioSyncMetrics;
  getFrameMetrics(): FrameMetrics;
  getProfile(): PilotProfile;
  resetProfile(): void;
  unlockAllForTesting(): void;
  toggleDebugHud(visible?: boolean): void;
  /** Asset pack toggle (Skybreaker procedural vs optional local Steam vault) */
  setAssetMode?(mode: AssetPackMode): Promise<void>;
  getAssetMode?(): AssetPackMode;
  isSteamAvailable?(): boolean;
  /** Act II Debug & Automation Seam */
  setModFlags?(flags: Partial<Act2ModFlags>): void;
  getModFlags?(): Act2ModFlags;
  toggleModDeck?(open?: boolean): void;
  togglePaletteStudio?(open?: boolean): void;
  setCustomPalette?(palette: PaletteDefinition): void;
  exportReplay?(): string;
  importGhostReplay?(json: string): boolean;
  getDailySeed?(): { dateId: string; seed: number };
  setP2Loadout?(w: number, b: number, e: number): void;
  setP2Input?(partial: Partial<InputState>): void;
}

export type RauserDebugApi = SkybreakerDebugApi;

declare global {
  interface Window {
    __SKYBREAKER_DEBUG__?: SkybreakerDebugApi;
    __RAUSER_DEBUG__?: RauserDebugApi;
  }
}
