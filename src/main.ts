import { AudioEngine } from './audio';
import {
  VANILLA_1TO1_PROFILE,
  type EnemyKind,
  type GameMode,
  type InputState,
  type Loadout,
  type PartIndex,
  type PilotProfile,
  type RauserDebugApi,
  type RauserDebugState,
  type SimSnapshot,
} from './contracts';
import { DEFAULT_PALETTE_ID, WebGL2Renderer } from './render';
import {
  ModRegistry,
  Simulation,
  createDefaultProfile,
} from './sim';
import { HangarController, TelemetryHud } from './ui';
import { VaultLoader } from './vault';

const PROFILE_STORAGE_KEY = 'krunked_luftrausers_profile_v1';
const FIXED_DT = 1 / VANILLA_1TO1_PROFILE.fixedTimestepHz;
const MAX_SUB_STEPS = VANILLA_1TO1_PROFILE.maxSubSteps;

function clampPartIndex(value: number): PartIndex {
  const n = Math.floor(Number.isFinite(value) ? value : 0);
  if (n <= 0) return 0;
  if (n >= 5) return 5;
  return n as PartIndex;
}

function loadStoredProfile(): PilotProfile {
  const fallback = createDefaultProfile();
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PilotProfile>;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== fallback.version) {
      return fallback;
    }
    return {
      ...fallback,
      ...parsed,
      unlockedWeapons: Array.isArray(parsed.unlockedWeapons) && parsed.unlockedWeapons.length > 0
        ? parsed.unlockedWeapons.map(clampPartIndex)
        : fallback.unlockedWeapons,
      unlockedBodies: Array.isArray(parsed.unlockedBodies) && parsed.unlockedBodies.length > 0
        ? parsed.unlockedBodies.map(clampPartIndex)
        : fallback.unlockedBodies,
      unlockedEngines: Array.isArray(parsed.unlockedEngines) && parsed.unlockedEngines.length > 0
        ? parsed.unlockedEngines.map(clampPartIndex)
        : fallback.unlockedEngines,
      completedMissions: Array.isArray(parsed.completedMissions)
        ? parsed.completedMissions.filter((n): n is number => typeof n === 'number')
        : fallback.completedMissions,
      activeMissionIds: Array.isArray(parsed.activeMissionIds)
        ? parsed.activeMissionIds.filter((n): n is number => typeof n === 'number')
        : fallback.activeMissionIds,
      lastLoadout: parsed.lastLoadout
        ? {
            weapon: clampPartIndex(parsed.lastLoadout.weapon),
            body: clampPartIndex(parsed.lastLoadout.body),
            engine: clampPartIndex(parsed.lastLoadout.engine),
          }
        : fallback.lastLoadout,
      lastMode: parsed.lastMode === 'sfmt' ? 'sfmt' : 'normal',
      selectedPaletteId:
        typeof parsed.selectedPaletteId === 'string' && parsed.selectedPaletteId.length > 0
          ? parsed.selectedPaletteId
          : DEFAULT_PALETTE_ID,
      totalKills:
        parsed.totalKills && typeof parsed.totalKills === 'object'
          ? { ...parsed.totalKills }
          : {},
      stats: parsed.stats
        ? {
            sorties: Number(parsed.stats.sorties) || 0,
            totalScore: Number(parsed.stats.totalScore) || 0,
            bestCombo: Number(parsed.stats.bestCombo) || 1,
          }
        : fallback.stats,
    };
  } catch {
    return fallback;
  }
}

function saveStoredProfile(profile: PilotProfile): void {
  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Ignore storage quota or privacy-mode restrictions cleanly
  }
}

export function exportProfileJson(profile: PilotProfile): string {
  return JSON.stringify(profile, null, 2);
}

export function importProfileJson(raw: string): PilotProfile | null {
  try {
    const parsed = JSON.parse(raw) as PilotProfile;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.version !== 'number') {
      return null;
    }
    saveStoredProfile(parsed);
    return loadStoredProfile();
  } catch {
    return null;
  }
}

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('rauser-canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    throw new Error('Missing #rauser-canvas element');
  }

  let consoleErrorCount = 0;
  window.addEventListener('error', () => {
    consoleErrorCount += 1;
  });
  window.addEventListener('unhandledrejection', () => {
    consoleErrorCount += 1;
  });

  const vaultLoader = new VaultLoader();
  const vault = await vaultLoader.load();

  const storedProfile = loadStoredProfile();
  const modRegistry = new ModRegistry();
  const sim = new Simulation(vault.data, modRegistry, storedProfile);

  const renderer = new WebGL2Renderer();
  renderer.init(canvas, vault);

  const hangar = new HangarController({
    initialPaletteId: storedProfile.selectedPaletteId || DEFAULT_PALETTE_ID,
    vaultSource: vault.data.vaultSource,
    totalMissionsCount: vault.data.global.missions.length,
  });
  hangar.syncPaletteFromProfile(
    storedProfile.selectedPaletteId,
    storedProfile.completedMissions.length,
    storedProfile.sfmtUnlocked,
  );
  renderer.setPalette(hangar.getSelectedPalette().id);

  const audio = new AudioEngine();
  await audio.init(vault);

  const telemetryHud = new TelemetryHud(document.body);
  telemetryHud.bindKeyboardToggle(window);

  const resizeCanvas = (): void => {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.floor(window.innerWidth * dpr));
    const height = Math.max(1, Math.floor(window.innerHeight * dpr));
    renderer.resize(width, height);
  };
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Input state
  const keysDown = new Set<string>();
  const debugInputOverride: Partial<InputState> = {};
  let prevGamepadMask = 0;

  let prevSnapshot: SimSnapshot = sim.getSnapshot();
  let currSnapshot: SimSnapshot = prevSnapshot;
  let lastSavedSignature = '';

  const persistCurrentProfile = (): void => {
    const prof = sim.getProfile();
    const activePaletteId = renderer.getPalette().id;
    if (prof.selectedPaletteId !== activePaletteId) {
      prof.selectedPaletteId = activePaletteId;
      sim.setProfile(prof);
    }
    const sig = JSON.stringify([
      prof.selectedPaletteId,
      prof.lastLoadout,
      prof.lastMode,
      prof.highScoreNormal,
      prof.highScoreSfmt,
      prof.completedMissions.length,
      prof.unlockedWeapons.length,
      prof.unlockedBodies.length,
      prof.unlockedEngines.length,
      prof.sfmtUnlocked,
      prof.stats.sorties,
    ]);
    if (sig !== lastSavedSignature) {
      lastSavedSignature = sig;
      saveStoredProfile(prof);
    }
  };

  persistCurrentProfile();

  const unlockAudio = (): void => {
    void audio.unlock();
  };

  const applyPaletteId = (paletteId: string): void => {
    hangar.setPaletteById(paletteId);
    renderer.setPalette(hangar.getSelectedPalette().id);
    const prof = sim.getProfile();
    prof.selectedPaletteId = renderer.getPalette().id;
    sim.setProfile(prof);
    persistCurrentProfile();
  };

  const handleHangarKeyAction = (code: string): boolean => {
    const snap = sim.getSnapshot();

    if (code === 'KeyX' || code === 'Enter') {
      sim.launch(snap.player.loadout, snap.mode);
      currSnapshot = sim.getSnapshot();
      prevSnapshot = currSnapshot;
      audio.playSfx('sndlaunch');
      audio.syncFromSnapshot(currSnapshot);
      persistCurrentProfile();
      return true;
    }

    if (code === 'KeyC') {
      const prevRow = hangar.getActiveRow();
      hangar.setActiveRow('palette');
      const res = hangar.cycleCurrent(1, snap, sim);
      hangar.setActiveRow(prevRow);
      audio.playSfx(res.cue);
      if (res.changed && res.paletteId) {
        applyPaletteId(res.paletteId);
      }
      return true;
    }

    if (code === 'KeyM') {
      const nextMode: GameMode = snap.mode === 'normal' ? 'sfmt' : 'normal';
      const res = hangar.selectMode(nextMode, snap, sim);
      audio.playSfx(res.cue);
      if (res.changed) {
        currSnapshot = sim.getSnapshot();
        persistCurrentProfile();
      }
      return true;
    }

    const res = hangar.handleKey(code, snap, sim);
    if (res.action === 'none') {
      return false;
    }
    audio.playSfx(res.cue);
    if (res.paletteId) {
      applyPaletteId(res.paletteId);
    }
    currSnapshot = sim.getSnapshot();
    if (res.action === 'launch') {
      prevSnapshot = currSnapshot;
      audio.syncFromSnapshot(currSnapshot);
    }
    if (res.changed) {
      persistCurrentProfile();
    }
    return true;
  };

  window.addEventListener('pointerdown', unlockAudio);

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    unlockAudio();

    if (
      e.code === 'ArrowUp' ||
      e.code === 'ArrowDown' ||
      e.code === 'ArrowLeft' ||
      e.code === 'ArrowRight' ||
      e.code === 'Space'
    ) {
      e.preventDefault();
    }

    const isFreshPress = !keysDown.has(e.code);
    keysDown.add(e.code);

    if (!isFreshPress) return;

    const snap = sim.getSnapshot();

    // QA / Telemetry-HUD-gated dev shortcuts (inactive during normal vanilla play)
    if (telemetryHud.isVisible()) {
      if (e.code === 'F9') {
        e.preventDefault();
        debugApi.unlockAllForTesting();
        return;
      }
      if (e.code === 'F8') {
        e.preventDefault();
        debugApi.toggleAutopilot(!snap.autopilotEnabled);
        return;
      }
      if (e.code === 'F7') {
        e.preventDefault();
        debugApi.damagePlayer(8);
        return;
      }
      if (e.code === 'F6') {
        e.preventDefault();
        debugApi.setLoadout(5, 5, 5);
        return;
      }
      if (e.code === 'F4') {
        e.preventDefault();
        debugApi.setLoadout(0, 3, 0);
        return;
      }
      if (e.code === 'F3') {
        e.preventDefault();
        debugApi.spawnEnemy('Boat', snap.player.x + 140, 0);
        debugApi.spawnEnemy('Fighter', snap.player.x + 100, snap.player.y - 40);
        return;
      }
    }

    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (snap.phase === 'playing' || snap.phase === 'launching') {
        sim.setPaused(!snap.paused);
        currSnapshot = sim.getSnapshot();
        audio.playSfx('sndmove');
        audio.syncFromSnapshot(currSnapshot);
        return;
      }
      if (snap.phase === 'gameover') {
        sim.returnToHangar();
        currSnapshot = sim.getSnapshot();
        prevSnapshot = currSnapshot;
        audio.playSfx('sndhangar');
        audio.syncFromSnapshot(currSnapshot);
        persistCurrentProfile();
        return;
      }
    }

    if (snap.paused && (e.code === 'KeyH' || e.code === 'Backspace' || e.code === 'KeyX')) {
      sim.setPaused(false);
      sim.returnToHangar();
      currSnapshot = sim.getSnapshot();
      prevSnapshot = currSnapshot;
      audio.playSfx('sndhangar');
      audio.syncFromSnapshot(currSnapshot);
      persistCurrentProfile();
      return;
    }

    if (snap.phase === 'hangar') {
      handleHangarKeyAction(e.code);
      return;
    }

    if (snap.phase === 'gameover') {
      if (e.code === 'Enter' || e.code === 'KeyX' || e.code === 'Space' || e.code === 'KeyZ') {
        sim.launch(snap.player.loadout, snap.mode);
        currSnapshot = sim.getSnapshot();
        prevSnapshot = currSnapshot;
        audio.playSfx('sndlaunch');
        audio.syncFromSnapshot(currSnapshot);
        persistCurrentProfile();
      } else if (e.code === 'KeyH' || e.code === 'Backspace') {
        sim.returnToHangar();
        currSnapshot = sim.getSnapshot();
        prevSnapshot = currSnapshot;
        audio.playSfx('sndhangar');
        audio.syncFromSnapshot(currSnapshot);
        persistCurrentProfile();
      }
    }
  });

  window.addEventListener('keyup', (e: KeyboardEvent) => {
    keysDown.delete(e.code);
  });

  window.addEventListener('blur', () => {
    keysDown.clear();
  });

  const pollGamepad = (): InputState => {
    const gpInput: InputState = { left: false, right: false, thrust: false, fire: false };
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return gpInput;
    }
    const pads = navigator.getGamepads();
    let pad: Gamepad | null = null;
    for (let i = 0; i < pads.length; i++) {
      if (pads[i]?.connected) {
        pad = pads[i] ?? null;
        break;
      }
    }
    if (!pad) {
      prevGamepadMask = 0;
      return gpInput;
    }

    const axX = pad.axes[0] ?? 0;
    const axY = pad.axes[1] ?? 0;
    const btn = (idx: number): boolean => Boolean(pad.buttons[idx]?.pressed);

    const up = btn(12) || axY < -0.5;
    const down = btn(13) || axY > 0.5;
    const left = btn(14) || axX < -0.35;
    const right = btn(15) || axX > 0.35;
    const aBtn = btn(0);
    const bBtn = btn(1);
    const xBtn = btn(2);
    const rbBtn = btn(5);
    const rtBtn = btn(7);
    const startBtn = btn(9);

    const mask =
      (up ? 1 : 0) |
      (down ? 2 : 0) |
      (left ? 4 : 0) |
      (right ? 8 : 0) |
      (aBtn ? 16 : 0) |
      (startBtn ? 32 : 0) |
      (bBtn ? 64 : 0);
    const rising = mask & ~prevGamepadMask;
    prevGamepadMask = mask;

    const snap = sim.getSnapshot();
    if (rising !== 0) {
      unlockAudio();
      if (snap.phase === 'hangar') {
        if (rising & 1) handleHangarKeyAction('ArrowUp');
        else if (rising & 2) handleHangarKeyAction('ArrowDown');
        else if (rising & 4) handleHangarKeyAction('ArrowLeft');
        else if (rising & 8) handleHangarKeyAction('ArrowRight');
        else if (rising & (16 | 32)) handleHangarKeyAction('Enter');
      } else if (snap.phase === 'gameover') {
        if (rising & (16 | 32)) {
          sim.launch(snap.player.loadout, snap.mode);
          currSnapshot = sim.getSnapshot();
          prevSnapshot = currSnapshot;
          audio.playSfx('sndlaunch');
          audio.syncFromSnapshot(currSnapshot);
        } else if (rising & 64) {
          sim.returnToHangar();
          currSnapshot = sim.getSnapshot();
          prevSnapshot = currSnapshot;
          audio.playSfx('sndhangar');
          audio.syncFromSnapshot(currSnapshot);
        }
      } else if (rising & 32) {
        sim.setPaused(!snap.paused);
        currSnapshot = sim.getSnapshot();
        audio.syncFromSnapshot(currSnapshot);
      }
    }

    gpInput.left = left;
    gpInput.right = right;
    gpInput.thrust = up || aBtn || rtBtn;
    gpInput.fire = xBtn || bBtn || rbBtn;
    return gpInput;
  };

  const sampleFlightInput = (): InputState => {
    const gp = pollGamepad();
    return {
      left:
        debugInputOverride.left ??
        (keysDown.has('ArrowLeft') || keysDown.has('KeyA') || gp.left),
      right:
        debugInputOverride.right ??
        (keysDown.has('ArrowRight') || keysDown.has('KeyD') || gp.right),
      thrust:
        debugInputOverride.thrust ??
        (keysDown.has('ArrowUp') || keysDown.has('KeyW') || gp.thrust),
      fire:
        debugInputOverride.fire ??
        (keysDown.has('KeyZ') ||
          keysDown.has('Space') ||
          keysDown.has('KeyJ') ||
          gp.fire),
    };
  };

  let accumulator = 0;
  let lastFrameTs = performance.now();
  let elapsedSec = 0;

  const renderFrame = (alpha: number): void => {
    const hangarUi =
      currSnapshot.phase === 'hangar'
        ? hangar.buildUiState(currSnapshot, vault.data.vaultSource)
        : null;
    renderer.render(currSnapshot, prevSnapshot, alpha, hangarUi, elapsedSec);
    telemetryHud.update({
      snapshot: currSnapshot,
      frameMetrics: renderer.getFrameMetrics(),
      vaultSource: vault.data.vaultSource,
      audioMetrics: audio.getSyncMetrics(),
      consoleErrorCount,
    });
  };

  const stepOneTick = (input: InputState): void => {
    prevSnapshot = currSnapshot;
    currSnapshot = sim.step(input);
    audio.syncFromSnapshot(currSnapshot);
    if (
      currSnapshot.completedMissionsThisSortie.length > 0 ||
      currSnapshot.phase !== prevSnapshot.phase
    ) {
      persistCurrentProfile();
    }
  };

  const rafLoop = (now: number): void => {
    const dt = Math.min(0.25, Math.max(0, (now - lastFrameTs) / 1000));
    lastFrameTs = now;
    elapsedSec += dt;
    accumulator += dt;

    let subSteps = 0;
    const input = sampleFlightInput();
    while (accumulator >= FIXED_DT && subSteps < MAX_SUB_STEPS) {
      stepOneTick(input);
      accumulator -= FIXED_DT;
      subSteps += 1;
    }
    if (subSteps === MAX_SUB_STEPS && accumulator >= FIXED_DT) {
      accumulator = 0;
    }

    const alpha = Math.max(0, Math.min(1, accumulator / FIXED_DT));
    renderFrame(alpha);
    requestAnimationFrame(rafLoop);
  };

  const buildDebugState = (): RauserDebugState => {
    const snap = sim.getSnapshot();
    const enemyCountsByKind: Record<string, number> = {};
    for (const enemy of snap.enemies) {
      if (!enemy.active) continue;
      enemyCountsByKind[enemy.kind] = (enemyCountsByKind[enemy.kind] ?? 0) + 1;
    }
    const fm = renderer.getFrameMetrics();
    return {
      vaultSource: vault.data.vaultSource,
      phase: snap.phase,
      mode: snap.mode,
      paused: snap.paused,
      tick: snap.tick,
      score: snap.score,
      combo: snap.combo,
      comboTimer: snap.comboTimer,
      difficulty: snap.difficulty,
      planeName: snap.player.planeName,
      loadout: { ...snap.player.loadout },
      paletteId: renderer.getPalette().id,
      player: {
        x: snap.player.x,
        y: snap.player.y,
        vx: snap.player.vx,
        vy: snap.player.vy,
        angleDeg: snap.player.angleDeg,
        health: snap.player.health,
        maxHealth: snap.player.maxHealth,
        alive: snap.player.alive,
        boosting: snap.player.boosting,
        firing: snap.player.firing,
        healing: snap.player.healing,
        underwater: snap.player.underwater,
        inSpace: snap.player.inSpace,
      },
      enemyCount: snap.enemies.length,
      enemyCountsByKind,
      projectileCount: snap.projectiles.length,
      particleCount: snap.particles.length,
      hitstopTicks: snap.hitstopTicks,
      screenShake: snap.screenShake,
      autopilotEnabled: snap.autopilotEnabled,
      completedMissionsCount: snap.profile.completedMissions.length,
      activeMissionIds: [...snap.profile.activeMissionIds],
      sfmtUnlocked: snap.profile.sfmtUnlocked,
      webglErrors: fm.webglErrors,
      consoleErrorCount,
      postUniforms: renderer.getLastPostUniforms(),
    };
  };

  const debugApi: RauserDebugApi = {
    getState: buildDebugState,
    setLoadout(w: number, b: number, e: number): void {
      const loadout: Loadout = {
        weapon: clampPartIndex(w),
        body: clampPartIndex(b),
        engine: clampPartIndex(e),
      };
      sim.setLoadout(loadout);
      currSnapshot = sim.getSnapshot();
      prevSnapshot = currSnapshot;
      audio.syncFromSnapshot(currSnapshot);
      persistCurrentProfile();
      renderFrame(1);
    },
    setPalette(id: string): void {
      applyPaletteId(id);
      renderFrame(1);
    },
    setMode(mode: GameMode): void {
      sim.setMode(mode);
      currSnapshot = sim.getSnapshot();
      persistCurrentProfile();
      renderFrame(1);
    },
    launch(seed?: number): void {
      const snap = sim.getSnapshot();
      sim.launch(snap.player.loadout, snap.mode, seed);
      currSnapshot = sim.getSnapshot();
      prevSnapshot = currSnapshot;
      audio.syncFromSnapshot(currSnapshot);
      persistCurrentProfile();
      renderFrame(1);
    },
    returnToHangar(): void {
      sim.returnToHangar();
      currSnapshot = sim.getSnapshot();
      prevSnapshot = currSnapshot;
      audio.syncFromSnapshot(currSnapshot);
      persistCurrentProfile();
      renderFrame(1);
    },
    toggleAutopilot(enabled: boolean): void {
      sim.setAutopilot(enabled);
      currSnapshot = sim.getSnapshot();
    },
    setInput(partial: Partial<InputState>): void {
      if (partial.left === undefined) delete debugInputOverride.left;
      else debugInputOverride.left = partial.left;
      if (partial.right === undefined) delete debugInputOverride.right;
      else debugInputOverride.right = partial.right;
      if (partial.thrust === undefined) delete debugInputOverride.thrust;
      else debugInputOverride.thrust = partial.thrust;
      if (partial.fire === undefined) delete debugInputOverride.fire;
      else debugInputOverride.fire = partial.fire;
    },
    stepFrames(n: number, input?: Partial<InputState>): void {
      const count = Math.max(0, Math.floor(n));
      const stepInput: InputState = {
        left: input?.left ?? debugInputOverride.left ?? false,
        right: input?.right ?? debugInputOverride.right ?? false,
        thrust: input?.thrust ?? debugInputOverride.thrust ?? false,
        fire: input?.fire ?? debugInputOverride.fire ?? false,
      };
      for (let i = 0; i < count; i++) {
        elapsedSec += FIXED_DT;
        stepOneTick(stepInput);
      }
      persistCurrentProfile();
      renderFrame(1);
    },
    damagePlayer(amount: number): void {
      sim.damagePlayer(amount);
      currSnapshot = sim.getSnapshot();
      audio.syncFromSnapshot(currSnapshot);
      renderFrame(1);
    },
    spawnEnemy(kind: EnemyKind, x?: number, y?: number): void {
      sim.spawnEnemy(kind, x, y);
      currSnapshot = sim.getSnapshot();
      renderFrame(1);
    },
    getAudioSyncMetrics() {
      return audio.getSyncMetrics();
    },
    getFrameMetrics() {
      return renderer.getFrameMetrics();
    },
    getProfile() {
      return sim.getProfile();
    },
    resetProfile(): void {
      try {
        window.localStorage.removeItem(PROFILE_STORAGE_KEY);
      } catch {
        // ignore
      }
      sim.resetProfile();
      applyPaletteId(DEFAULT_PALETTE_ID);
      currSnapshot = sim.getSnapshot();
      prevSnapshot = currSnapshot;
      lastSavedSignature = '';
      persistCurrentProfile();
      renderFrame(1);
    },
    unlockAllForTesting(): void {
      sim.unlockAll();
      currSnapshot = sim.getSnapshot();
      persistCurrentProfile();
      renderFrame(1);
    },
    toggleDebugHud(visible?: boolean): void {
      telemetryHud.toggle(visible);
      renderFrame(1);
    },
  };

  window.__RAUSER_DEBUG__ = debugApi;

  // Initial draw & start 60Hz loop
  audio.syncFromSnapshot(currSnapshot);
  renderFrame(1);
  requestAnimationFrame(rafLoop);
}

void bootstrap();
