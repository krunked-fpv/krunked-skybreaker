import type { AudioSyncMetrics } from './audio';
import type { FrameMetrics, PostShaderUniforms } from './render';
import type {
  GameMode,
  InputState,
  Loadout,
  PilotProfile,
  SimPhase,
} from './sim';
import type { EnemyKind, VaultSource } from './vault';

export interface RauserDebugState {
  vaultSource: VaultSource;
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
}

export interface RauserDebugApi {
  getState(): RauserDebugState;
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
}

declare global {
  interface Window {
    __RAUSER_DEBUG__?: RauserDebugApi;
  }
}
