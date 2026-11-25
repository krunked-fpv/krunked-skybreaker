import { AudioEngine } from './audio';
import {
  DEFAULT_ACT2_MOD_FLAGS,
  DEFAULT_SHADER_FX,
  VANILLA_1TO1_PROFILE,
  type Act2ModFlags,
  type EnemyKind,
  type GameMode,
  type InputState,
  type Loadout,
  type PaletteDefinition,
  type PartIndex,
  type PilotProfile,
  type RauserDebugApi,
  type RauserDebugState,
  type ReplayRecording,
  type SimSnapshot,
} from './contracts';
import {
  ACT2_BONUS_PALETTES,
  DEFAULT_PALETTE_ID,
  WebGL2Renderer,
  sanitizeCustomPalette,
} from './render';
import {
  ModRegistry,
  Simulation,
  computeCoopP2BotInput,
  computeDailySeed,
  computeDogfightBotInput,
  createDefaultProfile,
  parseReplayJson,
  serializeReplay,
} from './sim';
import { HangarController, TelemetryHud } from './ui';
import { VaultLoader } from './vault';

const PROFILE_STORAGE_KEY = 'krunked_luftrausers_profile_v1';
const ACT2_MODS_STORAGE_KEY = 'krunked_luftrausers_act2_mods_v1';
const ACT2_CUSTOM_PALETTE_KEY = 'krunked_luftrausers_act2_custom_palette_v1';
const ACT2_PB_GHOST_KEY = 'krunked_luftrausers_act2_pb_ghost_v1';

const FIXED_DT = 1 / VANILLA_1TO1_PROFILE.fixedTimestepHz;
const MAX_SUB_STEPS = VANILLA_1TO1_PROFILE.maxSubSteps;

function clampPartIndex(value: number, maxPart: number = 8): PartIndex {
  const n = Math.floor(Number.isFinite(value) ? value : 0);
  if (n <= 0) return 0;
  if (n >= maxPart) return maxPart as PartIndex;
  return n as PartIndex;
}

function cloneModFlags(flags: Act2ModFlags): Act2ModFlags {
  return {
    moddedEnabled: Boolean(flags.moddedEnabled),
    arsenalBosses: Boolean(flags.arsenalBosses),
    replayGhost: Boolean(flags.replayGhost),
    dailySeed: Boolean(flags.dailySeed),
    shaderFx: {
      crtScanlines: Boolean(flags.shaderFx?.crtScanlines),
      phosphorBloom: Boolean(flags.shaderFx?.phosphorBloom),
      speedWarp: Boolean(flags.shaderFx?.speedWarp),
      shockwaves: Boolean(flags.shaderFx?.shockwaves),
    },
    multiplayerMode:
      flags.multiplayerMode === 'coop2p' || flags.multiplayerMode === 'dogfight1v1'
        ? flags.multiplayerMode
        : 'solo',
    p2BotEnabled: flags.p2BotEnabled !== undefined ? Boolean(flags.p2BotEnabled) : true,
  };
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
      unlockedWeapons:
        Array.isArray(parsed.unlockedWeapons) && parsed.unlockedWeapons.length > 0
          ? parsed.unlockedWeapons.map((v) => clampPartIndex(v, 5))
          : fallback.unlockedWeapons,
      unlockedBodies:
        Array.isArray(parsed.unlockedBodies) && parsed.unlockedBodies.length > 0
          ? parsed.unlockedBodies.map((v) => clampPartIndex(v, 5))
          : fallback.unlockedBodies,
      unlockedEngines:
        Array.isArray(parsed.unlockedEngines) && parsed.unlockedEngines.length > 0
          ? parsed.unlockedEngines.map((v) => clampPartIndex(v, 5))
          : fallback.unlockedEngines,
      completedMissions: Array.isArray(parsed.completedMissions)
        ? parsed.completedMissions.filter((n): n is number => typeof n === 'number')
        : fallback.completedMissions,
      activeMissionIds: Array.isArray(parsed.activeMissionIds)
        ? parsed.activeMissionIds.filter((n): n is number => typeof n === 'number')
        : fallback.activeMissionIds,
      lastLoadout: parsed.lastLoadout
        ? {
            weapon: clampPartIndex(parsed.lastLoadout.weapon, 8),
            body: clampPartIndex(parsed.lastLoadout.body, 8),
            engine: clampPartIndex(parsed.lastLoadout.engine, 8),
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
      dailyHighScores:
        parsed.dailyHighScores && typeof parsed.dailyHighScores === 'object'
          ? { ...parsed.dailyHighScores }
          : {},
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

function loadStoredModFlags(): Act2ModFlags {
  try {
    const raw = window.localStorage.getItem(ACT2_MODS_STORAGE_KEY);
    if (!raw) return cloneModFlags(DEFAULT_ACT2_MOD_FLAGS);
    const parsed = JSON.parse(raw) as Partial<Act2ModFlags>;
    if (!parsed || typeof parsed !== 'object') {
      return cloneModFlags(DEFAULT_ACT2_MOD_FLAGS);
    }
    return cloneModFlags({
      ...DEFAULT_ACT2_MOD_FLAGS,
      ...parsed,
      shaderFx: {
        ...DEFAULT_SHADER_FX,
        ...(parsed.shaderFx ?? {}),
      },
    });
  } catch {
    return cloneModFlags(DEFAULT_ACT2_MOD_FLAGS);
  }
}

function saveStoredModFlags(flags: Act2ModFlags): void {
  try {
    window.localStorage.setItem(ACT2_MODS_STORAGE_KEY, JSON.stringify(flags));
  } catch {
    // ignore
  }
}

function loadStoredCustomPalette(): PaletteDefinition | null {
  try {
    const raw = window.localStorage.getItem(ACT2_CUSTOM_PALETTE_KEY);
    if (!raw) return null;
    return sanitizeCustomPalette(JSON.parse(raw));
  } catch {
    return null;
  }
}

function saveStoredCustomPalette(palette: PaletteDefinition): void {
  try {
    window.localStorage.setItem(ACT2_CUSTOM_PALETTE_KEY, JSON.stringify(palette));
  } catch {
    // ignore
  }
}

function loadStoredPbGhost(): ReplayRecording | null {
  try {
    const raw = window.localStorage.getItem(ACT2_PB_GHOST_KEY);
    if (!raw) return null;
    return parseReplayJson(raw);
  } catch {
    return null;
  }
}

function saveStoredPbGhost(recording: ReplayRecording): void {
  try {
    window.localStorage.setItem(ACT2_PB_GHOST_KEY, serializeReplay(recording));
  } catch {
    // ignore
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
  let modFlags = loadStoredModFlags();
  let pbGhostReplay = loadStoredPbGhost();

  const modRegistry = new ModRegistry(!modFlags.moddedEnabled);
  const sim = new Simulation(vault.data, modRegistry, storedProfile);

  const renderer = new WebGL2Renderer();
  renderer.init(canvas, vault);

  for (const bonus of ACT2_BONUS_PALETTES) {
    renderer.registerCustomPalette(bonus);
  }

  const hangar = new HangarController({
    initialPaletteId: storedProfile.selectedPaletteId || DEFAULT_PALETTE_ID,
    vaultSource: vault.data.vaultSource,
    totalMissionsCount: vault.data.global.missions.length,
  });

  const savedCustomPalette = loadStoredCustomPalette();
  if (savedCustomPalette) {
    hangar.getPaletteStudio().setPalette(savedCustomPalette);
    hangar.registerCustomPalette(savedCustomPalette);
    renderer.registerCustomPalette(savedCustomPalette);
  }

  sim.setModFlags(modFlags);
  hangar.setModFlags(modFlags);
  renderer.setShaderFx(modFlags.moddedEnabled ? modFlags.shaderFx : DEFAULT_SHADER_FX);
  if (pbGhostReplay) {
    sim.setGhostReplay(pbGhostReplay);
  }

  hangar.syncPaletteFromProfile(
    storedProfile.selectedPaletteId,
    storedProfile.completedMissions.length,
    storedProfile.sfmtUnlocked,
  );
  renderer.setPalette(hangar.getSelectedPalette().id);

  const audio = new AudioEngine();
  // Start Steam audio decode asynchronously so keyboard handlers, Backquote HUD toggle,
  // and WebGL2 rendering come online immediately without waiting for all 72 audio files.
  void audio.init(vault);

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
  const debugP2InputOverride: Partial<InputState> = {};
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
      prof.dailyHighScores ?? {},
    ]);
    if (sig !== lastSavedSignature) {
      lastSavedSignature = sig;
      saveStoredProfile(prof);
    }
  };

  const applyModFlags = (partial: Partial<Act2ModFlags>): void => {
    const merged = cloneModFlags({
      ...modFlags,
      ...partial,
      shaderFx: {
        ...modFlags.shaderFx,
        ...(partial.shaderFx ?? {}),
      },
    });
    modFlags = merged;
    sim.setModFlags(merged);
    hangar.setModFlags(merged);
    renderer.setShaderFx(merged.moddedEnabled ? merged.shaderFx : DEFAULT_SHADER_FX);
    // When locking back to Vanilla 1:1, ensure any bonus/custom palette reverts to a pure vanilla palette
    const resolvedPal = hangar.getSelectedPalette();
    if (renderer.getPalette().id !== resolvedPal.id) {
      renderer.setPalette(resolvedPal.id);
    }
    saveStoredModFlags(merged);
    currSnapshot = sim.getSnapshot();
    prevSnapshot = currSnapshot;
    persistCurrentProfile();
  };

  const maybeUpdatePbGhost = (snap: SimSnapshot): void => {
    if (snap.phase !== 'gameover' || snap.score <= 0) return;
    if (modFlags.moddedEnabled && modFlags.multiplayerMode === 'dogfight1v1') return;
    const rec = sim.getReplay();
    if (!rec.frames || rec.frames.length === 0) return;
    const prevBest = pbGhostReplay?.finalScore ?? 0;
    if (rec.finalScore >= prevBest) {
      pbGhostReplay = rec;
      saveStoredPbGhost(rec);
      sim.setGhostReplay(rec);
    }
  };

  persistCurrentProfile();

  const unlockAudio = (): void => {
    void audio.unlock();
  };

  const applyPaletteId = (paletteId: string): void => {
    hangar.setPaletteById(paletteId);
    const selected = hangar.getSelectedPalette();
    renderer.registerCustomPalette(selected);
    renderer.setPalette(selected.id);
    const prof = sim.getProfile();
    prof.selectedPaletteId = renderer.getPalette().id;
    sim.setProfile(prof);
    persistCurrentProfile();
  };

  const applyCustomPalette = (palette: PaletteDefinition): void => {
    const sanitized = sanitizeCustomPalette(palette);
    if (!sanitized) return;
    hangar.getPaletteStudio().setPalette(sanitized);
    hangar.registerCustomPalette(sanitized);
    renderer.registerCustomPalette(sanitized);
    saveStoredCustomPalette(sanitized);
    applyPaletteId(sanitized.id);
  };

  const launchCurrentSortie = (explicitSeed?: number): void => {
    const snap = sim.getSnapshot();
    if (pbGhostReplay && modFlags.moddedEnabled && modFlags.replayGhost) {
      sim.setGhostReplay(pbGhostReplay);
    }
    sim.launch(snap.player.loadout, snap.mode, explicitSeed);
    currSnapshot = sim.getSnapshot();
    prevSnapshot = currSnapshot;
    audio.playSfx('sndlaunch');
    audio.syncFromSnapshot(currSnapshot);
    persistCurrentProfile();
  };

  const handleHangarKeyAction = (code: string): boolean => {
    const snap = sim.getSnapshot();

    // 1. Live Palette Studio takes priority when open
    if (hangar.getPaletteStudio().isOpen()) {
      const res = hangar.handlePaletteStudioKey(code);
      if (!res.handled) return false;
      audio.playSfx(res.cue);
      if (res.changed || res.saved) {
        applyCustomPalette(res.palette);
      }
      return true;
    }

    // 2. Act II Mod Deck overlay inside Hangar
    if (hangar.isModDeckOpen()) {
      const res = hangar.handleModDeckKey(code, modFlags, {
        onFlagsChange: (nextFlags) => {
          applyModFlags(nextFlags);
        },
        onShaderFxChange: (fx) => {
          renderer.setShaderFx(modFlags.moddedEnabled ? fx : DEFAULT_SHADER_FX);
        },
        onOpenPaletteStudio: () => {
          const studioPal = hangar.getPaletteStudio().getPalette();
          applyCustomPalette(studioPal);
        },
      });
      if (!res.handled) return false;
      audio.playSfx(res.cue);
      return true;
    }

    // 3. Toggle Mod Deck directly from Hangar with Tab
    if (code === 'Tab') {
      hangar.toggleModDeck(true);
      audio.playSfx('sndswap');
      return true;
    }

    if (code === 'KeyX' || code === 'Enter') {
      launchCurrentSortie();
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
      e.code === 'Space' ||
      e.code === 'Tab'
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
      if (e.code === 'F2' && modFlags.moddedEnabled && modFlags.arsenalBosses) {
        e.preventDefault();
        debugApi.spawnEnemy('Dreadnought', snap.player.x + 260, 0);
        debugApi.spawnEnemy('SkyCarrier', snap.player.x - 240, -420);
        return;
      }
    }

    if (snap.phase === 'hangar') {
      handleHangarKeyAction(e.code);
      return;
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
        hangar.setActiveRow('weapon');
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
      hangar.setActiveRow('weapon');
      currSnapshot = sim.getSnapshot();
      prevSnapshot = currSnapshot;
      audio.playSfx('sndhangar');
      audio.syncFromSnapshot(currSnapshot);
      persistCurrentProfile();
      return;
    }

    if (snap.phase === 'gameover') {
      if (e.code === 'Enter' || e.code === 'KeyX' || e.code === 'Space' || e.code === 'KeyZ') {
        launchCurrentSortie();
      } else if (e.code === 'KeyH' || e.code === 'Backspace') {
        sim.returnToHangar();
        hangar.setActiveRow('weapon');
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

  const readGamepadSlot = (slotIndex: number): {
    input: InputState;
    pad: Gamepad | null;
  } => {
    const input: InputState = { left: false, right: false, thrust: false, fire: false };
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return { input, pad: null };
    }
    const pads = navigator.getGamepads();
    const connected: Gamepad[] = [];
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p?.connected) connected.push(p);
    }
    const pad = connected[slotIndex] ?? null;
    if (!pad) return { input, pad: null };

    const axX = pad.axes[0] ?? 0;
    const axY = pad.axes[1] ?? 0;
    const btn = (idx: number): boolean => Boolean(pad.buttons[idx]?.pressed);
    input.left = btn(14) || axX < -0.35;
    input.right = btn(15) || axX > 0.35;
    input.thrust = btn(12) || axY < -0.5 || btn(0) || btn(7);
    input.fire = btn(2) || btn(1) || btn(5);
    return { input, pad };
  };

  const pollGamepad = (): { p1: InputState; p2: InputState } => {
    const slot0 = readGamepadSlot(0);
    const slot1 = readGamepadSlot(1);

    const pad = slot0.pad;
    if (!pad) {
      prevGamepadMask = 0;
      return { p1: slot0.input, p2: slot1.input };
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
    const startBtn = btn(9);
    const selectBtn = btn(8);

    const mask =
      (up ? 1 : 0) |
      (down ? 2 : 0) |
      (left ? 4 : 0) |
      (right ? 8 : 0) |
      (aBtn ? 16 : 0) |
      (startBtn ? 32 : 0) |
      (bBtn ? 64 : 0) |
      (selectBtn ? 128 : 0);
    const rising = mask & ~prevGamepadMask;
    prevGamepadMask = mask;

    const snap = sim.getSnapshot();
    if (rising !== 0) {
      unlockAudio();
      if (snap.phase === 'hangar') {
        if (rising & 128) handleHangarKeyAction('Tab');
        else if (rising & 1) handleHangarKeyAction('ArrowUp');
        else if (rising & 2) handleHangarKeyAction('ArrowDown');
        else if (rising & 4) handleHangarKeyAction('ArrowLeft');
        else if (rising & 8) handleHangarKeyAction('ArrowRight');
        else if (rising & (16 | 32)) handleHangarKeyAction('Enter');
        else if (rising & 64) handleHangarKeyAction('Escape');
      } else if (snap.phase === 'gameover') {
        if (rising & (16 | 32)) {
          launchCurrentSortie();
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

    return { p1: slot0.input, p2: slot1.input };
  };

  const sampleFlightInputs = (): { p1: InputState; p2: InputState } => {
    const gp = pollGamepad();
    const isHuman2P =
      modFlags.moddedEnabled &&
      modFlags.multiplayerMode !== 'solo' &&
      !modFlags.p2BotEnabled;

    if (isHuman2P) {
      // Split-keyboard + dual-gamepad: P1 = WASD + F/Space/LShift, P2 = Arrows + Numpad0/Slash/M/Enter
      const p1: InputState = {
        left: debugInputOverride.left ?? (keysDown.has('KeyA') || gp.p1.left),
        right: debugInputOverride.right ?? (keysDown.has('KeyD') || gp.p1.right),
        thrust: debugInputOverride.thrust ?? (keysDown.has('KeyW') || gp.p1.thrust),
        fire:
          debugInputOverride.fire ??
          (keysDown.has('KeyF') ||
            keysDown.has('Space') ||
            keysDown.has('ShiftLeft') ||
            gp.p1.fire),
      };
      const p2: InputState = {
        left: debugP2InputOverride.left ?? (keysDown.has('ArrowLeft') || gp.p2.left),
        right: debugP2InputOverride.right ?? (keysDown.has('ArrowRight') || gp.p2.right),
        thrust: debugP2InputOverride.thrust ?? (keysDown.has('ArrowUp') || gp.p2.thrust),
        fire:
          debugP2InputOverride.fire ??
          (keysDown.has('Numpad0') ||
            keysDown.has('Slash') ||
            keysDown.has('KeyM') ||
            keysDown.has('Enter') ||
            gp.p2.fire),
      };
      return { p1, p2 };
    }

    // 100% Vanilla control mapping preserved for Solo + Bot-partner 2P
    const p1: InputState = {
      left:
        debugInputOverride.left ??
        (keysDown.has('ArrowLeft') || keysDown.has('KeyA') || gp.p1.left),
      right:
        debugInputOverride.right ??
        (keysDown.has('ArrowRight') || keysDown.has('KeyD') || gp.p1.right),
      thrust:
        debugInputOverride.thrust ??
        (keysDown.has('ArrowUp') || keysDown.has('KeyW') || gp.p1.thrust),
      fire:
        debugInputOverride.fire ??
        (keysDown.has('KeyZ') ||
          keysDown.has('Space') ||
          keysDown.has('KeyJ') ||
          gp.p1.fire),
    };

    let p2: InputState = { left: false, right: false, thrust: false, fire: false };
    if (modFlags.moddedEnabled && modFlags.multiplayerMode !== 'solo') {
      if (
        debugP2InputOverride.left !== undefined ||
        debugP2InputOverride.right !== undefined ||
        debugP2InputOverride.thrust !== undefined ||
        debugP2InputOverride.fire !== undefined
      ) {
        p2 = {
          left: debugP2InputOverride.left ?? false,
          right: debugP2InputOverride.right ?? false,
          thrust: debugP2InputOverride.thrust ?? false,
          fire: debugP2InputOverride.fire ?? false,
        };
      } else if (modFlags.multiplayerMode === 'dogfight1v1' && currSnapshot.player2) {
        p2 = computeDogfightBotInput(
          currSnapshot.player2,
          currSnapshot.player,
          currSnapshot.seaLevel,
          currSnapshot.spaceLevel,
          currSnapshot.projectiles,
        );
      } else {
        p2 = computeCoopP2BotInput(currSnapshot);
      }
    }

    return { p1, p2 };
  };

  let accumulator = 0;
  let lastFrameTs = performance.now();
  let elapsedSec = 0;

  const renderFrame = (alpha: number): void => {
    const daily = computeDailySeed();
    const dailyBest = currSnapshot.profile.dailyHighScores?.[daily.dateId] ?? 0;
    const hangarUi =
      currSnapshot.phase === 'hangar'
        ? hangar.buildUiState(currSnapshot, vault.data.vaultSource, {
            modFlags,
            dailySeedId: daily.dateId,
            dailyBestScore: dailyBest,
            pbGhostScore: pbGhostReplay?.finalScore ?? 0,
            p2Loadout: sim.getP2Loadout(),
            p2PlaneName: currSnapshot.player2?.planeName,
          })
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

  const stepOneTick = (p1Input: InputState, p2Input?: InputState): void => {
    prevSnapshot = currSnapshot;
    if (modFlags.moddedEnabled && modFlags.multiplayerMode !== 'solo') {
      const resolvedP2 =
        p2Input ??
        (modFlags.multiplayerMode === 'dogfight1v1' && currSnapshot.player2
          ? computeDogfightBotInput(
              currSnapshot.player2,
              currSnapshot.player,
              currSnapshot.seaLevel,
              currSnapshot.spaceLevel,
              currSnapshot.projectiles,
            )
          : computeCoopP2BotInput(currSnapshot));
      currSnapshot = sim.step2P(p1Input, resolvedP2);
    } else {
      currSnapshot = sim.step(p1Input);
    }
    audio.syncFromSnapshot(currSnapshot);
    if (currSnapshot.phase === 'gameover' && prevSnapshot.phase !== 'gameover') {
      maybeUpdatePbGhost(currSnapshot);
    }
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
    const { p1, p2 } = sampleFlightInputs();
    while (accumulator >= FIXED_DT && subSteps < MAX_SUB_STEPS) {
      stepOneTick(p1, p2);
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
        shieldReady: snap.player.shieldReady,
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
      modFlags: cloneModFlags(modFlags),
      modDeckOpen: hangar.isModDeckOpen(),
      paletteStudioOpen: hangar.getPaletteStudio().isOpen(),
      ghostActive: Boolean(snap.ghostPose),
      dailySeedId: snap.dailySeedId ?? null,
      player2Alive: Boolean(snap.player2?.alive),
      dogfight: snap.dogfight ?? null,
      shockwaveCount: snap.shockwaves?.length ?? 0,
    };
  };

  const debugApi: RauserDebugApi = {
    getState: buildDebugState,
    setLoadout(w: number, b: number, e: number): void {
      const maxPart = modFlags.moddedEnabled && modFlags.arsenalBosses ? 8 : 5;
      const loadout: Loadout = {
        weapon: clampPartIndex(w, maxPart),
        body: clampPartIndex(b, maxPart),
        engine: clampPartIndex(e, maxPart),
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
      launchCurrentSortie(seed);
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
    setP2Input(partial: Partial<InputState>): void {
      if (partial.left === undefined) delete debugP2InputOverride.left;
      else debugP2InputOverride.left = partial.left;
      if (partial.right === undefined) delete debugP2InputOverride.right;
      else debugP2InputOverride.right = partial.right;
      if (partial.thrust === undefined) delete debugP2InputOverride.thrust;
      else debugP2InputOverride.thrust = partial.thrust;
      if (partial.fire === undefined) delete debugP2InputOverride.fire;
      else debugP2InputOverride.fire = partial.fire;
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
        window.localStorage.removeItem(ACT2_MODS_STORAGE_KEY);
        window.localStorage.removeItem(ACT2_CUSTOM_PALETTE_KEY);
        window.localStorage.removeItem(ACT2_PB_GHOST_KEY);
      } catch {
        // ignore
      }
      pbGhostReplay = null;
      sim.setGhostReplay(null);
      applyModFlags(DEFAULT_ACT2_MOD_FLAGS);
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
    setModFlags(flags: Partial<Act2ModFlags>): void {
      applyModFlags(flags);
      renderFrame(1);
    },
    getModFlags(): Act2ModFlags {
      return cloneModFlags(modFlags);
    },
    toggleModDeck(open?: boolean): void {
      hangar.toggleModDeck(open);
      renderFrame(1);
    },
    togglePaletteStudio(open?: boolean): void {
      const next = hangar.togglePaletteStudio(open);
      if (next) {
        applyCustomPalette(hangar.getPaletteStudio().getPalette());
      }
      renderFrame(1);
    },
    setCustomPalette(palette: PaletteDefinition): void {
      applyCustomPalette(palette);
      renderFrame(1);
    },
    exportReplay(): string {
      return serializeReplay(sim.getReplay());
    },
    importGhostReplay(json: string): boolean {
      const parsed = parseReplayJson(json);
      if (!parsed) return false;
      pbGhostReplay = parsed;
      saveStoredPbGhost(parsed);
      sim.setGhostReplay(parsed);
      renderFrame(1);
      return true;
    },
    getDailySeed(): { dateId: string; seed: number } {
      return computeDailySeed();
    },
    setP2Loadout(w: number, b: number, e: number): void {
      const maxPart = modFlags.moddedEnabled && modFlags.arsenalBosses ? 8 : 5;
      sim.setP2Loadout({
        weapon: clampPartIndex(w, maxPart),
        body: clampPartIndex(b, maxPart),
        engine: clampPartIndex(e, maxPart),
      });
      currSnapshot = sim.getSnapshot();
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
