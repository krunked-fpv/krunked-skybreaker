import { AudioEngine } from './audio';
import {
  DEFAULT_ACT2_MOD_FLAGS,
  DEFAULT_SHADER_FX,
  VANILLA_1TO1_PROFILE,
  type Act2ModFlags,
  type ActiveInputSource,
  type AssetPackMode,
  type ControllerMenuCommand,
  type ControllerStatusSnapshot,
  type EnemyKind,
  type GameMode,
  type InputState,
  type Loadout,
  type PaletteDefinition,
  type PilotProfile,
  type SimSnapshot,
  type SkybreakerDebugApi,
  type SkybreakerDebugState,
  type VaultAssetBundle,
} from './contracts';
import {
  ControllerToast,
  GamepadHaptics,
  GamepadManager,
  TouchControlsOverlay,
  TouchEnvironmentDetector,
  clientToVirtualPoint,
  resolveCanvasTapCommand,
} from './input';
import {
  ACT2_BONUS_PALETTES,
  DEFAULT_PALETTE_ID,
  WebGL2Renderer,
  isPaletteUnlocked,
  sanitizeCustomPalette,
} from './render';
import {
  HANGAR_HUD_PASS,
  getSelectedPauseAction,
  movePauseMenuSelection,
  notifyProjectorTransition,
  setPauseMenuSelection,
  type HangarHudPass,
} from './render/hangar-hud-pass';
import {
  ModRegistry,
  Simulation,
  computeCoopP2BotInput,
  computeDailySeed,
  computeDogfightBotInput,
  parseReplayJson,
  serializeReplay,
} from './sim';
import {
  HANGAR_ROWS,
  HangarController,
  TelemetryHud,
  applyBrowserFullRosterUnlocks,
  clampPartIndex,
  clearStoredProfileKeys,
  cloneStoredModFlags,
  computeCampaignUnlockedProfile,
  loadExplicitStoredAssetMode,
  loadProgressionLockMode,
  loadStoredCustomPalette,
  loadStoredModFlags,
  loadStoredPbGhost,
  loadStoredProfile,
  saveProgressionLockMode,
  saveStoredAssetMode,
  saveStoredCustomPalette,
  saveStoredModFlags,
  saveStoredPbGhost,
  saveStoredProfile,
} from './ui';
import { VaultLoader } from './vault';

const FIXED_DT = 1 / VANILLA_1TO1_PROFILE.fixedTimestepHz;
const MAX_SUB_STEPS = VANILLA_1TO1_PROFILE.maxSubSteps;

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
  const canvas = (document.getElementById('skybreaker-canvas') ??
    document.getElementById('rauser-canvas')) as HTMLCanvasElement | null;
  if (!canvas) {
    throw new Error('Missing #skybreaker-canvas element');
  }

  let consoleErrorCount = 0;
  window.addEventListener('error', () => {
    consoleErrorCount += 1;
  });
  window.addEventListener('unhandledrejection', () => {
    consoleErrorCount += 1;
  });

  const vaultLoader = new VaultLoader();
  const steamAvailable = (await vaultLoader.isSteamAvailable?.()) ?? false;
  const explicitAssetMode = loadExplicitStoredAssetMode();
  const initialRequestedMode: AssetPackMode =
    explicitAssetMode !== null
      ? explicitAssetMode === 'steam-local' && steamAvailable
        ? 'steam-local'
        : 'skybreaker'
      : steamAvailable
        ? 'steam-local'
        : 'skybreaker';
  let vault: VaultAssetBundle = await vaultLoader.load(initialRequestedMode);
  let activeAssetMode: AssetPackMode =
    vault.data.vaultSource === 'steam-local' ? 'steam-local' : 'skybreaker';

  let progressionLocked = loadProgressionLockMode();
  const storedProfile = loadStoredProfile(undefined, { progressionLocked });
  let modFlags = loadStoredModFlags();
  let pbGhostReplay = loadStoredPbGhost();

  const modRegistry = new ModRegistry(!modFlags.moddedEnabled);
  const sim = new Simulation(vault.data, modRegistry, storedProfile);

  const renderer = new WebGL2Renderer();
  renderer.init(canvas, vault);
  const rendererWithHudPass = renderer as WebGL2Renderer & {
    setHangarHudPass?: (pass: HangarHudPass | null) => void;
  };
  rendererWithHudPass.setHangarHudPass?.(HANGAR_HUD_PASS);

  for (const bonus of ACT2_BONUS_PALETTES) {
    renderer.registerCustomPalette(bonus);
  }

  const hangar = new HangarController({
    initialPaletteId: storedProfile.selectedPaletteId || DEFAULT_PALETTE_ID,
    vaultSource: vault.data.vaultSource,
    totalMissionsCount: vault.data.global.missions.length,
    allUnlocked: !progressionLocked,
  });
  hangar.setSteamAvailable(steamAvailable);
  hangar.setAssetMode(activeAssetMode);

  const savedCustomPalette = loadStoredCustomPalette();
  if (savedCustomPalette) {
    hangar.getPaletteStudio().setPalette(savedCustomPalette);
  }
  const initialCustomPalette = hangar.getPaletteStudio().getPalette();
  hangar.registerCustomPalette(initialCustomPalette);
  renderer.registerCustomPalette(initialCustomPalette);

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
  // Initialize audio buffers asynchronously so keyboard handlers, Backquote HUD toggle,
  // and WebGL2 rendering come online immediately.
  void audio.init(vault);

  const telemetryHud = new TelemetryHud(document.body);
  telemetryHud.bindKeyboardToggle(window);

  const gamepadManager = new GamepadManager();
  gamepadManager.attach(window);
  const gamepadHaptics = new GamepadHaptics();
  const touchDetector = new TouchEnvironmentDetector();
  touchDetector.attach(window);
  const touchControls = new TouchControlsOverlay(document.body);
  const controllerToast = new ControllerToast(document.body);

  let activeInputSource: ActiveInputSource = touchDetector.touchOverlayVisible
    ? 'touch'
    : 'keyboard';

  touchControls.setVisible(touchDetector.touchOverlayVisible);
  touchDetector.onChange((state) => {
    touchControls.setVisible(state.touchOverlayVisible);
    if (state.touchOverlayVisible) {
      activeInputSource = 'touch';
    }
  });

  const getControllerStatus = (): ControllerStatusSnapshot => ({
    activeSource: activeInputSource,
    touchSensed: touchDetector.touchSensed,
    touchOverlayVisible: touchDetector.touchOverlayVisible,
    isTeslaBrowser:
      touchDetector.isTeslaBrowser || gamepadManager.isTeslaBrowser(),
    gamepads: gamepadManager.getConnectedGamepads(),
  });

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
    const merged = cloneStoredModFlags({
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

  const launchCurrentSortie = (
    explicitSeed?: number,
    animateProjector = true,
  ): void => {
    const snap = sim.getSnapshot();
    const fromHangar = snap.phase === 'hangar';
    if (pbGhostReplay && modFlags.moddedEnabled && modFlags.replayGhost) {
      sim.setGhostReplay(pbGhostReplay);
    }
    sim.launch(snap.player.loadout, snap.mode, explicitSeed);
    setPauseMenuSelection(0);
    if (fromHangar && animateProjector) {
      notifyProjectorTransition('launch', elapsedSec);
    } else {
      notifyProjectorTransition('settled', elapsedSec);
    }
    currSnapshot = sim.getSnapshot();
    prevSnapshot = currSnapshot;
    audio.playSfx('sndlaunch');
    audio.syncFromSnapshot(currSnapshot);
    persistCurrentProfile();
  };

  const returnToHangarUi = (animateProjector = true): void => {
    sim.setPaused(false);
    sim.returnToHangar();
    hangar.setActiveRow('weapon');
    setPauseMenuSelection(0);
    notifyProjectorTransition(
      animateProjector ? 'enter-hangar' : 'settled',
      elapsedSec,
    );
    currSnapshot = sim.getSnapshot();
    prevSnapshot = currSnapshot;
    audio.playSfx('sndhangar');
    audio.syncFromSnapshot(currSnapshot);
    persistCurrentProfile();
  };

  let assetSwitchSeq = 0;

  const switchAssetMode = async (
    nextMode: AssetPackMode,
    playCue = true,
  ): Promise<void> => {
    if (nextMode === 'steam-local' && !steamAvailable) {
      hangar.setAssetMode('skybreaker');
      if (playCue) {
        audio.playSfx('snddeny');
      }
      renderFrame(1);
      return;
    }

    const seq = ++assetSwitchSeq;
    const targetMode: AssetPackMode =
      nextMode === 'steam-local' && steamAvailable ? 'steam-local' : 'skybreaker';
    const nextVault = await vaultLoader.load(targetMode);
    if (seq !== assetSwitchSeq) {
      return;
    }

    vault = nextVault;
    const actualMode: AssetPackMode =
      nextVault.data.vaultSource === 'steam-local' ? 'steam-local' : 'skybreaker';
    activeAssetMode = actualMode;

    sim.setGameData(nextVault.data);
    renderer.reloadVault(nextVault);
    hangar.setAssetMode(actualMode);
    hangar.setVaultSource(nextVault.data.vaultSource);
    hangar.setTotalMissionsCount(nextVault.data.global.missions.length);
    saveStoredAssetMode(actualMode);

    currSnapshot = sim.getSnapshot();
    prevSnapshot = currSnapshot;

    void audio.init(nextVault);
    audio.syncFromSnapshot(currSnapshot);
    if (playCue) {
      audio.playSfx('sndswap');
    }
    renderFrame(1);
  };

  const setProgressionLockMode = (locked: boolean, playCue = true): void => {
    progressionLocked = Boolean(locked);
    saveProgressionLockMode(progressionLocked);
    hangar.setAllUnlocked(!progressionLocked);

    const currentProfile = sim.getProfile();
    const nextProfile = progressionLocked
      ? computeCampaignUnlockedProfile(
          currentProfile,
          vault.data.global.missions,
          Boolean(modFlags.moddedEnabled && modFlags.arsenalBosses),
        )
      : applyBrowserFullRosterUnlocks(currentProfile);

    sim.setProfile(nextProfile);
    if (progressionLocked) {
      const activePal = hangar.getSelectedPalette();
      if (
        !isPaletteUnlocked(
          activePal,
          nextProfile.completedMissions.length,
          nextProfile.sfmtUnlocked,
          false,
        )
      ) {
        applyPaletteId(DEFAULT_PALETTE_ID);
      }
    }
    currSnapshot = sim.getSnapshot();
    prevSnapshot = currSnapshot;
    audio.syncFromSnapshot(currSnapshot);
    if (playCue) {
      audio.playSfx(progressionLocked ? 'sndswap' : 'sndsfmt');
    }
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

    if (code === 'KeyV') {
      if (!steamAvailable) {
        audio.playSfx('snddeny');
        return true;
      }
      const nextMode: AssetPackMode =
        activeAssetMode === 'skybreaker' ? 'steam-local' : 'skybreaker';
      void switchAssetMode(nextMode, true);
      return true;
    }

    if (code === 'KeyU') {
      setProgressionLockMode(!progressionLocked, true);
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
    if (res.row === 'assets' && res.changed && res.assetMode) {
      void switchAssetMode(res.assetMode, true);
      return true;
    }
    audio.playSfx(res.cue);
    if (res.paletteId) {
      applyPaletteId(res.paletteId);
    }
    currSnapshot = sim.getSnapshot();
    if (res.action === 'launch') {
      setPauseMenuSelection(0);
      notifyProjectorTransition('launch', elapsedSec);
      prevSnapshot = currSnapshot;
      audio.syncFromSnapshot(currSnapshot);
    }
    if (res.changed) {
      persistCurrentProfile();
    }
    return true;
  };

  const executePauseAction = (action: 'resume' | 'retry' | 'hangar'): void => {
    if (action === 'resume') {
      sim.setPaused(false);
      currSnapshot = sim.getSnapshot();
      audio.playSfx('sndmove');
      audio.syncFromSnapshot(currSnapshot);
    } else if (action === 'retry') {
      sim.setPaused(false);
      launchCurrentSortie(undefined, false);
    } else {
      returnToHangarUi(true);
    }
  };

  const toggleFlightPause = (): void => {
    const snap = sim.getSnapshot();
    if (snap.phase !== 'playing' && snap.phase !== 'launching') {
      return;
    }
    const nextPaused = !snap.paused;
    sim.setPaused(nextPaused);
    if (nextPaused) {
      setPauseMenuSelection(0);
    }
    currSnapshot = sim.getSnapshot();
    audio.playSfx('sndmove');
    audio.syncFromSnapshot(currSnapshot);
  };

  const dispatchControllerCommand = (cmd: ControllerMenuCommand): void => {
    const snap = sim.getSnapshot();

    switch (cmd.kind) {
      case 'pause-toggle': {
        if (snap.phase === 'playing' || snap.phase === 'launching') {
          toggleFlightPause();
        }
        return;
      }

      case 'launch': {
        if (snap.phase === 'hangar') {
          if (hangar.getPaletteStudio().isOpen()) {
            hangar.getPaletteStudio().setOpen(false);
          }
          if (hangar.isModDeckOpen()) {
            hangar.toggleModDeck(false);
          }
          launchCurrentSortie();
        }
        return;
      }

      case 'relaunch': {
        if (snap.phase === 'gameover' || snap.paused) {
          sim.setPaused(false);
          launchCurrentSortie(undefined, false);
        }
        return;
      }

      case 'return-hangar': {
        if (snap.phase !== 'hangar') {
          returnToHangarUi(true);
        }
        return;
      }

      case 'toggle-mod-deck': {
        if (snap.phase === 'hangar') {
          if (hangar.getPaletteStudio().isOpen()) {
            handleHangarKeyAction('Escape');
          } else {
            handleHangarKeyAction('Tab');
          }
        }
        return;
      }

      case 'hangar-row-tap': {
        if (
          snap.phase !== 'hangar' ||
          hangar.isModDeckOpen() ||
          hangar.getPaletteStudio().isOpen()
        ) {
          return;
        }
        const targetRow = HANGAR_ROWS[cmd.rowIndex];
        if (!targetRow) return;
        hangar.setActiveRow(targetRow);
        if (cmd.action === 'prev') {
          handleHangarKeyAction('ArrowLeft');
        } else if (cmd.action === 'next') {
          handleHangarKeyAction('ArrowRight');
        } else if (cmd.action === 'activate') {
          handleHangarKeyAction('Enter');
        } else {
          audio.playSfx('sndmove');
        }
        return;
      }

      case 'pause-option-tap': {
        if (!snap.paused) return;
        setPauseMenuSelection(cmd.optionIndex);
        executePauseAction(getSelectedPauseAction());
        return;
      }

      case 'key': {
        if (snap.phase === 'hangar') {
          handleHangarKeyAction(cmd.code);
          return;
        }
        if (snap.paused) {
          if (cmd.code === 'ArrowUp' || cmd.code === 'KeyW') {
            movePauseMenuSelection(-1);
            audio.playSfx('sndmove');
          } else if (cmd.code === 'ArrowDown' || cmd.code === 'KeyS') {
            movePauseMenuSelection(1);
            audio.playSfx('sndmove');
          } else if (cmd.code === 'KeyR') {
            executePauseAction('retry');
          } else if (
            cmd.code === 'KeyH' ||
            cmd.code === 'Backspace' ||
            cmd.code === 'KeyX'
          ) {
            executePauseAction('hangar');
          } else if (cmd.code === 'Escape' || cmd.code === 'KeyP') {
            executePauseAction('resume');
          } else if (cmd.code === 'Enter' || cmd.code === 'Space') {
            executePauseAction(getSelectedPauseAction());
          }
          return;
        }
        if (snap.phase === 'gameover') {
          if (
            cmd.code === 'Enter' ||
            cmd.code === 'Space' ||
            cmd.code === 'KeyX' ||
            cmd.code === 'KeyZ' ||
            cmd.code === 'KeyR'
          ) {
            launchCurrentSortie(undefined, false);
          } else if (
            cmd.code === 'Escape' ||
            cmd.code === 'KeyH' ||
            cmd.code === 'Backspace'
          ) {
            returnToHangarUi(true);
          }
        }
        return;
      }
    }
  };

  window.addEventListener('pointerdown', unlockAudio);

  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) {
      return;
    }
    unlockAudio();
    const snap = sim.getSnapshot();
    if (snap.phase !== 'hangar' && snap.phase !== 'gameover' && !snap.paused) {
      return;
    }
    const virtualPt = clientToVirtualPoint(
      e.clientX,
      e.clientY,
      canvas.getBoundingClientRect(),
    );
    if (!virtualPt) return;

    const activeRowIdx = Math.max(0, HANGAR_ROWS.indexOf(hangar.getActiveRow()));
    const cmd = resolveCanvasTapCommand(virtualPt.x, virtualPt.y, {
      phase: snap.phase,
      paused: snap.paused,
      modDeckOpen: hangar.isModDeckOpen(),
      paletteStudioOpen: hangar.getPaletteStudio().isOpen(),
      activeHangarRowIndex: activeRowIdx,
    });
    if (cmd) {
      if (e.pointerType === 'touch') {
        activeInputSource = 'touch';
      }
      dispatchControllerCommand(cmd);
      renderFrame(1);
    }
  });

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    unlockAudio();

    if (e.code !== 'Backquote' && e.key !== '`' && e.key !== '~') {
      activeInputSource = 'keyboard';
      touchDetector.notifyNonTouchInput('keyboard');
    }

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
        const nextPaused = !snap.paused;
        sim.setPaused(nextPaused);
        if (nextPaused) {
          setPauseMenuSelection(0);
        }
        currSnapshot = sim.getSnapshot();
        audio.playSfx('sndmove');
        audio.syncFromSnapshot(currSnapshot);
        return;
      }
      if (snap.phase === 'gameover') {
        returnToHangarUi(true);
        return;
      }
    }

    if (snap.paused) {
      if (e.code === 'KeyR') {
        sim.setPaused(false);
        launchCurrentSortie(undefined, false);
        return;
      }
      if (e.code === 'KeyH' || e.code === 'Backspace' || e.code === 'KeyX') {
        returnToHangarUi(true);
        return;
      }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        movePauseMenuSelection(-1);
        audio.playSfx('sndmove');
        return;
      }
      if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        movePauseMenuSelection(1);
        audio.playSfx('sndmove');
        return;
      }
      if (e.code === 'Enter' || e.code === 'Space') {
        const action = getSelectedPauseAction();
        if (action === 'resume') {
          sim.setPaused(false);
          currSnapshot = sim.getSnapshot();
          audio.playSfx('sndmove');
          audio.syncFromSnapshot(currSnapshot);
        } else if (action === 'retry') {
          sim.setPaused(false);
          launchCurrentSortie(undefined, false);
        } else {
          returnToHangarUi(true);
        }
        return;
      }
    }

    if (snap.phase === 'gameover') {
      if (e.code === 'Enter' || e.code === 'KeyX' || e.code === 'Space' || e.code === 'KeyZ' || e.code === 'KeyR') {
        launchCurrentSortie(undefined, false);
      } else if (e.code === 'KeyH' || e.code === 'Backspace') {
        returnToHangarUi(true);
      }
    }
  });

  window.addEventListener('keyup', (e: KeyboardEvent) => {
    keysDown.delete(e.code);
  });

  window.addEventListener('blur', () => {
    keysDown.clear();
    touchControls.resetInputs();
  });

  const sampleFlightInputs = (nowMs: number): { p1: InputState; p2: InputState } => {
    const snap = sim.getSnapshot();
    const gp = gamepadManager.poll({
      phase: snap.phase,
      paused: snap.paused,
      modDeckOpen: hangar.isModDeckOpen(),
      paletteStudioOpen: hangar.getPaletteStudio().isOpen(),
      nowMs,
    });

    if (gp.connectionEvents.length > 0) {
      const activePal = renderer.getPalette();
      for (const ev of gp.connectionEvents) {
        const verb = ev.type === 'connected' ? 'CONNECTED' : 'DISCONNECTED';
        controllerToast.show(
          `${ev.info.label} ${verb} (P${ev.info.slot + 1})`,
          activePal,
        );
      }
    }

    if (gp.p1DisconnectedInFlight) {
      sim.setPaused(true);
      setPauseMenuSelection(0);
      currSnapshot = sim.getSnapshot();
      audio.playSfx('sndmove');
      audio.syncFromSnapshot(currSnapshot);
      controllerToast.show(
        'CONTROLLER DISCONNECTED - PAUSED',
        renderer.getPalette(),
      );
    }

    if (gp.hadActivity) {
      unlockAudio();
      activeInputSource = 'gamepad';
      touchDetector.notifyNonTouchInput('gamepad');
    }

    for (const cmd of gp.commands) {
      dispatchControllerCommand(cmd);
    }

    const touchCmds = touchControls.drainCommands(nowMs);
    if (touchCmds.length > 0) {
      unlockAudio();
      activeInputSource = 'touch';
      for (const cmd of touchCmds) {
        dispatchControllerCommand(cmd);
      }
    }

    const touchFlight = touchControls.getFlightInput();
    if (
      touchFlight.left ||
      touchFlight.right ||
      touchFlight.thrust ||
      touchFlight.fire
    ) {
      unlockAudio();
      activeInputSource = 'touch';
    }

    const isHuman2P =
      modFlags.moddedEnabled &&
      modFlags.multiplayerMode !== 'solo' &&
      !modFlags.p2BotEnabled;

    if (isHuman2P) {
      // Split-keyboard + dual-gamepad + touch: P1 = WASD + F/Space/LShift, P2 = Arrows + Numpad0/Slash/M/Enter
      const p1: InputState = {
        left:
          debugInputOverride.left ??
          (keysDown.has('KeyA') || gp.p1.left || touchFlight.left),
        right:
          debugInputOverride.right ??
          (keysDown.has('KeyD') || gp.p1.right || touchFlight.right),
        thrust:
          debugInputOverride.thrust ??
          (keysDown.has('KeyW') || gp.p1.thrust || touchFlight.thrust),
        fire:
          debugInputOverride.fire ??
          (keysDown.has('KeyF') ||
            keysDown.has('Space') ||
            keysDown.has('ShiftLeft') ||
            gp.p1.fire ||
            touchFlight.fire),
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
        (keysDown.has('ArrowLeft') ||
          keysDown.has('KeyA') ||
          gp.p1.left ||
          touchFlight.left),
      right:
        debugInputOverride.right ??
        (keysDown.has('ArrowRight') ||
          keysDown.has('KeyD') ||
          gp.p1.right ||
          touchFlight.right),
      thrust:
        debugInputOverride.thrust ??
        (keysDown.has('ArrowUp') ||
          keysDown.has('KeyW') ||
          gp.p1.thrust ||
          touchFlight.thrust),
      fire:
        debugInputOverride.fire ??
        (keysDown.has('KeyZ') ||
          keysDown.has('Space') ||
          keysDown.has('KeyJ') ||
          gp.p1.fire ||
          touchFlight.fire),
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
    touchControls.updateContext({
      phase: currSnapshot.phase,
      paused: currSnapshot.paused,
      modDeckOpen: hangar.isModDeckOpen(),
      paletteStudioOpen: hangar.getPaletteStudio().isOpen(),
      palette: renderer.getPalette(),
    });
    telemetryHud.update({
      snapshot: currSnapshot,
      frameMetrics: renderer.getFrameMetrics(),
      vaultSource: vault.data.vaultSource,
      audioMetrics: audio.getSyncMetrics(),
      consoleErrorCount,
      controllerStatus: getControllerStatus(),
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
    gamepadHaptics.syncFromSnapshot(
      prevSnapshot,
      currSnapshot,
      gamepadManager.getRawConnectedPads(),
      performance.now(),
    );
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
    const { p1, p2 } = sampleFlightInputs(now);
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

  const buildDebugState = (): SkybreakerDebugState => {
    const snap = sim.getSnapshot();
    const enemyCountsByKind: Record<string, number> = {};
    for (const enemy of snap.enemies) {
      if (!enemy.active) continue;
      enemyCountsByKind[enemy.kind] = (enemyCountsByKind[enemy.kind] ?? 0) + 1;
    }
    const fm = renderer.getFrameMetrics();
    return {
      vaultSource: vault.data.vaultSource,
      assetMode: activeAssetMode,
      steamAvailable,
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
      modFlags: cloneStoredModFlags(modFlags),
      modDeckOpen: hangar.isModDeckOpen(),
      paletteStudioOpen: hangar.getPaletteStudio().isOpen(),
      ghostActive: Boolean(snap.ghostPose),
      dailySeedId: snap.dailySeedId ?? null,
      player2Alive: Boolean(snap.player2?.alive),
      dogfight: snap.dogfight ?? null,
      shockwaveCount: snap.shockwaves?.length ?? 0,
      controller: getControllerStatus(),
    };
  };

  const debugApi: SkybreakerDebugApi = {
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
      launchCurrentSortie(seed, false);
      renderFrame(1);
    },
    returnToHangar(): void {
      returnToHangarUi(false);
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
      clearStoredProfileKeys();
      pbGhostReplay = null;
      progressionLocked = false;
      hangar.setAllUnlocked(true);
      sim.setGhostReplay(null);
      applyModFlags(DEFAULT_ACT2_MOD_FLAGS);
      sim.resetProfile();
      sim.setProfile(applyBrowserFullRosterUnlocks(sim.getProfile()));
      applyPaletteId(DEFAULT_PALETTE_ID);
      currSnapshot = sim.getSnapshot();
      prevSnapshot = currSnapshot;
      lastSavedSignature = '';
      persistCurrentProfile();
      renderFrame(1);
    },
    unlockAllForTesting(): void {
      progressionLocked = false;
      saveProgressionLockMode(false);
      hangar.setAllUnlocked(true);
      sim.unlockAll();
      currSnapshot = sim.getSnapshot();
      persistCurrentProfile();
      renderFrame(1);
    },
    toggleDebugHud(visible?: boolean): void {
      telemetryHud.toggle(visible);
      renderFrame(1);
    },
    async setAssetMode(mode: AssetPackMode): Promise<void> {
      await switchAssetMode(mode, true);
    },
    getAssetMode(): AssetPackMode {
      return activeAssetMode;
    },
    isSteamAvailable(): boolean {
      return steamAvailable;
    },
    setModFlags(flags: Partial<Act2ModFlags>): void {
      applyModFlags(flags);
      renderFrame(1);
    },
    getModFlags(): Act2ModFlags {
      return cloneStoredModFlags(modFlags);
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
    getControllerState(): ControllerStatusSnapshot {
      return getControllerStatus();
    },
    setTouchControlsVisible(visible: boolean | null): void {
      touchDetector.setForceVisible(visible);
      touchControls.setVisible(touchDetector.touchOverlayVisible);
      renderFrame(1);
    },
  };

  window.__SKYBREAKER_DEBUG__ = debugApi;
  window.__RAUSER_DEBUG__ = debugApi;

  // Initial draw & start 60Hz loop
  audio.syncFromSnapshot(currSnapshot);
  renderFrame(1);
  requestAnimationFrame(rafLoop);
}

void bootstrap();
