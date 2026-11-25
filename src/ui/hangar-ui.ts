import type { AudioCueId } from '../contracts/audio';
import {
  DEFAULT_ACT2_MOD_FLAGS,
  type Act2ModFlags,
  type MultiplayerMode,
  type ShaderFxConfig,
} from '../contracts/mod';
import type {
  HangarRow,
  HangarUiState,
  ModDeckRow,
  PaletteDefinition,
} from '../contracts/render';
import type {
  GameMode,
  ISimulation,
  Loadout,
  PartIndex,
  SimSnapshot,
} from '../contracts/sim';
import type { VaultSource } from '../contracts/vault';
import {
  ACT2_BONUS_PALETTES,
  DEFAULT_PALETTE_ID,
  PALETTES,
  getPaletteIndexById,
  isPaletteUnlocked,
  sanitizeCustomPalette,
} from '../render/palettes';
import {
  PaletteStudioController,
  type PaletteStudioKeyResult,
} from './palette-studio';

export const HANGAR_ROWS: readonly HangarRow[] = [
  'weapon',
  'body',
  'engine',
  'palette',
  'mode',
  'launch',
];

export const MOD_DECK_ROWS: readonly ModDeckRow[] = [
  'modprofile',
  'modarsenal',
  'modghost',
  'moddaily',
  'modshader_crt',
  'modshader_bloom',
  'modshader_warp',
  'modshader_shock',
  'modmulti',
  'modp2bot',
  'palettestudio',
  'modback',
];

const VANILLA_PART_COUNT = 6;
const MODDED_PART_COUNT = 9;
const MULTIPLAYER_ORDER: readonly MultiplayerMode[] = [
  'solo',
  'coop2p',
  'dogfight1v1',
];

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
    multiplayerMode: flags.multiplayerMode ?? 'solo',
    p2BotEnabled: Boolean(flags.p2BotEnabled),
  };
}

export interface HangarControllerOptions {
  palettes?: readonly PaletteDefinition[];
  initialPaletteId?: string;
  vaultSource?: VaultSource;
  totalMissionsCount?: number;
}

export interface HangarCycleResult {
  changed: boolean;
  locked: boolean;
  cue: AudioCueId;
  row: HangarRow;
  loadout?: Loadout;
  mode?: GameMode;
  paletteId?: string;
  paletteIndex?: number;
}

export interface HangarActionResult {
  action: 'move' | 'cycle' | 'launch' | 'none';
  changed: boolean;
  locked: boolean;
  cue: AudioCueId;
  row: HangarRow;
  loadout?: Loadout;
  mode?: GameMode;
  paletteId?: string;
  paletteIndex?: number;
}

export interface ModDeckCallbacks {
  onFlagsChange?: (nextFlags: Act2ModFlags) => void;
  onOpenPaletteStudio?: () => void;
  onCloseModDeck?: () => void;
  onShaderFxChange?: (fx: ShaderFxConfig) => void;
  onPaletteChange?: (palette: PaletteDefinition) => void;
}

export interface ModDeckKeyResult {
  handled: boolean;
  changed: boolean;
  closed: boolean;
  openedPaletteStudio: boolean;
  cue: AudioCueId;
  row: ModDeckRow;
  modFlags: Act2ModFlags;
}

export interface HangarAct2Extras {
  modFlags?: Act2ModFlags;
  dailySeedId?: string;
  dailyBestScore?: number;
  pbGhostScore?: number;
  p2Loadout?: Loadout;
  p2PlaneName?: string;
}

export class HangarController {
  private readonly palettes: readonly PaletteDefinition[];
  private customPalettes: PaletteDefinition[] = [];
  private activeRowIndex = 0;
  private paletteIndex: number;
  private selectedPaletteId: string;
  private vaultSource: VaultSource;
  private totalMissionsCount: number;

  private modDeckOpen = false;
  private activeModRowIndex = 0;
  private readonly paletteStudio = new PaletteStudioController();
  private modFlagsCache: Act2ModFlags = cloneModFlags(DEFAULT_ACT2_MOD_FLAGS);

  constructor(options: HangarControllerOptions = {}) {
    this.palettes =
      options.palettes && options.palettes.length > 0
        ? options.palettes
        : PALETTES;
    const initId = options.initialPaletteId ?? DEFAULT_PALETTE_ID;
    const idx = this.palettes.findIndex((p) => p.id === initId);
    if (idx >= 0) {
      this.paletteIndex = idx;
      this.selectedPaletteId = this.palettes[idx]!.id;
    } else {
      const bonusIdx = ACT2_BONUS_PALETTES.findIndex((p) => p.id === initId);
      if (bonusIdx >= 0) {
        this.paletteIndex = this.palettes.length + bonusIdx;
        this.selectedPaletteId = ACT2_BONUS_PALETTES[bonusIdx]!.id;
      } else {
        this.paletteIndex = getPaletteIndexById(DEFAULT_PALETTE_ID);
        this.selectedPaletteId = this.palettes[this.paletteIndex]?.id ?? DEFAULT_PALETTE_ID;
      }
    }
    this.vaultSource = options.vaultSource ?? 'procedural-fallback';
    this.totalMissionsCount = options.totalMissionsCount ?? 90;
  }

  public getActiveRow(): HangarRow {
    return HANGAR_ROWS[this.activeRowIndex] ?? 'weapon';
  }

  public setActiveRow(row: HangarRow): void {
    const idx = HANGAR_ROWS.indexOf(row);
    if (idx >= 0) {
      this.activeRowIndex = idx;
    }
  }

  public moveRow(delta: -1 | 1): HangarRow {
    const len = HANGAR_ROWS.length;
    this.activeRowIndex = (((this.activeRowIndex + delta) % len) + len) % len;
    return this.getActiveRow();
  }

  public isModDeckOpen(): boolean {
    return this.modDeckOpen;
  }

  public toggleModDeck(open?: boolean): boolean {
    this.modDeckOpen = open !== undefined ? open : !this.modDeckOpen;
    if (!this.modDeckOpen && this.paletteStudio.isOpen()) {
      this.paletteStudio.setOpen(false);
    }
    return this.modDeckOpen;
  }

  public getActiveModRow(): ModDeckRow {
    return MOD_DECK_ROWS[this.activeModRowIndex] ?? 'modprofile';
  }

  public setActiveModRow(row: ModDeckRow): void {
    const idx = MOD_DECK_ROWS.indexOf(row);
    if (idx >= 0) {
      this.activeModRowIndex = idx;
    }
  }

  public moveModRow(delta: number): ModDeckRow {
    if (!Number.isFinite(delta)) {
      return this.getActiveModRow();
    }
    const len = MOD_DECK_ROWS.length;
    this.activeModRowIndex =
      (((this.activeModRowIndex + Math.trunc(delta)) % len) + len) % len;
    return this.getActiveModRow();
  }

  public getPaletteStudio(): PaletteStudioController {
    return this.paletteStudio;
  }

  public togglePaletteStudio(open?: boolean): boolean {
    const next = this.paletteStudio.toggle(open);
    if (next) {
      this.registerCustomPalette(this.paletteStudio.getPalette());
    }
    return next;
  }

  public handlePaletteStudioKey(code: string): PaletteStudioKeyResult {
    const res = this.paletteStudio.handleKey(code);
    if (res.changed || res.saved) {
      this.registerCustomPalette(res.palette);
    }
    return res;
  }

  public registerCustomPalette(palette: PaletteDefinition): void {
    const sanitized = sanitizeCustomPalette(palette);
    if (!sanitized) return;
    const existingIdx = this.customPalettes.findIndex(
      (p) => p.id === sanitized.id,
    );
    if (existingIdx >= 0) {
      this.customPalettes[existingIdx] = sanitized;
    } else {
      this.customPalettes.push(sanitized);
    }
  }

  public getCustomPalettes(): readonly PaletteDefinition[] {
    return this.customPalettes;
  }

  public setModFlags(flags: Act2ModFlags): void {
    this.modFlagsCache = cloneModFlags(flags);
    if (!this.modFlagsCache.moddedEnabled) {
      const vanillaIdx = this.palettes.findIndex(
        (p) => p.id === this.selectedPaletteId,
      );
      if (vanillaIdx < 0) {
        this.selectedPaletteId = this.palettes[0]!.id;
        this.paletteIndex = 0;
      } else {
        this.paletteIndex = vanillaIdx;
      }
    }
  }

  public getModFlags(): Act2ModFlags {
    return cloneModFlags(this.modFlagsCache);
  }

  public handleModDeckKey(
    code: string,
    modFlags: Act2ModFlags,
    callbacks?: ModDeckCallbacks,
  ): ModDeckKeyResult {
    const next = cloneModFlags(modFlags);
    const row = this.getActiveModRow();

    const makeResult = (
      handled: boolean,
      changed: boolean,
      closed: boolean,
      openedPaletteStudio: boolean,
      cue: AudioCueId,
      outRow: ModDeckRow = row,
    ): ModDeckKeyResult => {
      if (changed) {
        this.modFlagsCache = cloneModFlags(next);
        callbacks?.onFlagsChange?.(cloneModFlags(next));
      }
      return {
        handled,
        changed,
        closed,
        openedPaletteStudio,
        cue,
        row: outRow,
        modFlags: cloneModFlags(next),
      };
    };

    switch (code) {
      case 'ArrowUp':
      case 'KeyW':
      case 'w':
      case 'W': {
        const nextRow = this.moveModRow(-1);
        return makeResult(true, false, false, false, 'sndmove', nextRow);
      }
      case 'ArrowDown':
      case 'KeyS':
      case 's':
      case 'S': {
        const nextRow = this.moveModRow(1);
        return makeResult(true, false, false, false, 'sndmove', nextRow);
      }
      case 'Tab':
      case 'Escape':
      case 'Backspace': {
        this.modDeckOpen = false;
        callbacks?.onCloseModDeck?.();
        return makeResult(true, false, true, false, 'sndhangar');
      }
      case 'ArrowLeft':
      case 'KeyA':
      case 'a':
      case 'A':
      case 'ArrowRight':
      case 'KeyD':
      case 'd':
      case 'D':
      case 'Enter':
      case 'Space':
      case ' ': {
        const dir =
          code === 'ArrowLeft' || code === 'KeyA' || code === 'a' || code === 'A'
            ? -1
            : 1;
        switch (row) {
          case 'modprofile': {
            next.moddedEnabled = !next.moddedEnabled;
            return makeResult(
              true,
              true,
              false,
              false,
              next.moddedEnabled ? 'sndsfmt' : 'sndswap',
            );
          }
          case 'modarsenal': {
            next.arsenalBosses = !next.arsenalBosses;
            if (next.arsenalBosses) next.moddedEnabled = true;
            return makeResult(true, true, false, false, 'sndswap');
          }
          case 'modghost': {
            next.replayGhost = !next.replayGhost;
            if (next.replayGhost) next.moddedEnabled = true;
            return makeResult(true, true, false, false, 'sndswap');
          }
          case 'moddaily': {
            next.dailySeed = !next.dailySeed;
            if (next.dailySeed) next.moddedEnabled = true;
            return makeResult(true, true, false, false, 'sndswap');
          }
          case 'modshader_crt': {
            next.shaderFx.crtScanlines = !next.shaderFx.crtScanlines;
            if (next.shaderFx.crtScanlines) next.moddedEnabled = true;
            callbacks?.onShaderFxChange?.({ ...next.shaderFx });
            return makeResult(true, true, false, false, 'sndswap');
          }
          case 'modshader_bloom': {
            next.shaderFx.phosphorBloom = !next.shaderFx.phosphorBloom;
            if (next.shaderFx.phosphorBloom) next.moddedEnabled = true;
            callbacks?.onShaderFxChange?.({ ...next.shaderFx });
            return makeResult(true, true, false, false, 'sndswap');
          }
          case 'modshader_warp': {
            next.shaderFx.speedWarp = !next.shaderFx.speedWarp;
            if (next.shaderFx.speedWarp) next.moddedEnabled = true;
            callbacks?.onShaderFxChange?.({ ...next.shaderFx });
            return makeResult(true, true, false, false, 'sndswap');
          }
          case 'modshader_shock': {
            next.shaderFx.shockwaves = !next.shaderFx.shockwaves;
            if (next.shaderFx.shockwaves) next.moddedEnabled = true;
            callbacks?.onShaderFxChange?.({ ...next.shaderFx });
            return makeResult(true, true, false, false, 'sndswap');
          }
          case 'modmulti': {
            const curIdx = MULTIPLAYER_ORDER.indexOf(next.multiplayerMode);
            const baseIdx = curIdx >= 0 ? curIdx : 0;
            const nextIdx =
              (((baseIdx + dir) % MULTIPLAYER_ORDER.length) +
                MULTIPLAYER_ORDER.length) %
              MULTIPLAYER_ORDER.length;
            next.multiplayerMode = MULTIPLAYER_ORDER[nextIdx] ?? 'solo';
            if (next.multiplayerMode !== 'solo') {
              next.moddedEnabled = true;
            }
            return makeResult(true, true, false, false, 'sndswap');
          }
          case 'modp2bot': {
            next.p2BotEnabled = !next.p2BotEnabled;
            return makeResult(true, true, false, false, 'sndswap');
          }
          case 'palettestudio': {
            if (dir < 0) {
              return makeResult(true, false, false, false, 'sndmove');
            }
            this.togglePaletteStudio(true);
            callbacks?.onOpenPaletteStudio?.();
            return makeResult(true, false, false, true, 'sndsfmt');
          }
          case 'modback': {
            this.modDeckOpen = false;
            callbacks?.onCloseModDeck?.();
            return makeResult(true, false, true, false, 'sndhangar');
          }
        }
      }
      default:
        return makeResult(false, false, false, false, 'sndmove');
    }
  }

  public getPaletteIndex(): number {
    return this.paletteIndex;
  }

  public getSelectedPalette(): PaletteDefinition {
    const all = this.getMergedPalettes(this.modFlagsCache.moddedEnabled);
    const byId = all.find((p) => p.id === this.selectedPaletteId);
    if (byId) return byId;
    return this.palettes[0]!;
  }

  public setPaletteById(id: string): boolean {
    const all = this.getMergedPalettes(true);
    const idx = all.findIndex((p) => p.id === id);
    if (idx < 0) return false;
    this.selectedPaletteId = all[idx]!.id;
    this.paletteIndex = idx;
    return true;
  }

  public setVaultSource(source: VaultSource): void {
    this.vaultSource = source;
  }

  public setTotalMissionsCount(count: number): void {
    this.totalMissionsCount = Math.max(1, Math.floor(count));
  }

  public syncPaletteFromProfile(
    paletteId: string,
    completedMissionsCount: number,
    sfmtUnlocked: boolean,
  ): void {
    const all = this.getMergedPalettes(this.modFlagsCache.moddedEnabled);
    const idx = all.findIndex((p) => p.id === paletteId);
    if (idx < 0) return;
    const target = all[idx];
    if (
      target &&
      isPaletteUnlocked(target, completedMissionsCount, sfmtUnlocked)
    ) {
      this.selectedPaletteId = target.id;
      this.paletteIndex = idx;
    }
  }

  public cycleCurrent(
    dir: -1 | 1,
    snapshot: SimSnapshot,
    sim?: Pick<ISimulation, 'setLoadout' | 'setMode'>,
  ): HangarCycleResult {
    const row = this.getActiveRow();

    if (row === 'weapon' || row === 'body' || row === 'engine') {
      return this.cyclePart(row, dir, snapshot, sim);
    }

    if (row === 'palette') {
      return this.cyclePalette(dir, snapshot);
    }

    if (row === 'mode') {
      const nextMode: GameMode = snapshot.mode === 'normal' ? 'sfmt' : 'normal';
      return this.selectMode(nextMode, snapshot, sim);
    }

    return {
      changed: false,
      locked: false,
      cue: 'sndmove',
      row,
    };
  }

  public selectPart(
    slot: 'weapon' | 'body' | 'engine',
    index: PartIndex,
    snapshot: SimSnapshot,
    sim?: Pick<ISimulation, 'setLoadout'>,
  ): HangarCycleResult {
    const arsenalEnabled = this.isArsenalEnabled(snapshot);
    const unlocked = this.getUnlockedList(slot, snapshot);
    const allowed =
      index >= 6
        ? arsenalEnabled && index <= 8
        : unlocked.includes(index);

    if (!allowed) {
      return {
        changed: false,
        locked: true,
        cue: 'snddeny',
        row: slot,
        loadout: { ...snapshot.player.loadout },
      };
    }

    const current = snapshot.player.loadout[slot];
    if (current === index) {
      return {
        changed: false,
        locked: false,
        cue: 'sndmove',
        row: slot,
        loadout: { ...snapshot.player.loadout },
      };
    }

    const nextLoadout: Loadout = {
      ...snapshot.player.loadout,
      [slot]: index,
    };
    sim?.setLoadout(nextLoadout);
    return {
      changed: true,
      locked: false,
      cue: 'sndswap',
      row: slot,
      loadout: nextLoadout,
    };
  }

  public selectMode(
    mode: GameMode,
    snapshot: SimSnapshot,
    sim?: Pick<ISimulation, 'setMode'>,
  ): HangarCycleResult {
    if (mode === 'sfmt' && !snapshot.profile.sfmtUnlocked) {
      return {
        changed: false,
        locked: true,
        cue: 'snddeny',
        row: 'mode',
        mode: snapshot.mode,
      };
    }
    if (mode === snapshot.mode) {
      return {
        changed: false,
        locked: false,
        cue: 'sndmove',
        row: 'mode',
        mode,
      };
    }
    sim?.setMode(mode);
    return {
      changed: true,
      locked: false,
      cue: mode === 'sfmt' ? 'sndsfmt' : 'sndswap',
      row: 'mode',
      mode,
    };
  }

  public selectPaletteByIndex(
    targetIndex: number,
    snapshot: SimSnapshot,
  ): HangarCycleResult {
    const list = this.getMergedPalettes(Boolean(snapshot.activeMods?.moddedEnabled));
    const pal = list[targetIndex];
    if (!pal) {
      return {
        changed: false,
        locked: true,
        cue: 'snddeny',
        row: 'palette',
        paletteId: this.getSelectedPalette().id,
        paletteIndex: this.paletteIndex,
      };
    }
    if (
      !isPaletteUnlocked(
        pal,
        snapshot.profile.completedMissions.length,
        snapshot.profile.sfmtUnlocked,
      )
    ) {
      return {
        changed: false,
        locked: true,
        cue: 'snddeny',
        row: 'palette',
        paletteId: this.getSelectedPalette().id,
        paletteIndex: this.paletteIndex,
      };
    }
    const changed = targetIndex !== this.paletteIndex || pal.id !== this.selectedPaletteId;
    this.paletteIndex = targetIndex;
    this.selectedPaletteId = pal.id;
    return {
      changed,
      locked: false,
      cue: changed ? 'sndswap' : 'sndmove',
      row: 'palette',
      paletteId: pal.id,
      paletteIndex: targetIndex,
    };
  }

  public activateCurrent(
    snapshot: SimSnapshot,
    sim?: Pick<ISimulation, 'setLoadout' | 'setMode' | 'launch'>,
  ): HangarActionResult {
    const row = this.getActiveRow();
    if (row === 'launch') {
      sim?.launch(snapshot.player.loadout, snapshot.mode);
      return {
        action: 'launch',
        changed: true,
        locked: false,
        cue: 'sndlaunch',
        row,
        loadout: { ...snapshot.player.loadout },
        mode: snapshot.mode,
      };
    }
    const res = this.cycleCurrent(1, snapshot, sim);
    return {
      action: 'cycle',
      ...res,
    };
  }

  public handleKey(
    keyOrCode: string,
    snapshot: SimSnapshot,
    sim?: Pick<ISimulation, 'setLoadout' | 'setMode' | 'launch'>,
  ): HangarActionResult {
    switch (keyOrCode) {
      case 'ArrowUp':
      case 'KeyW':
      case 'w':
      case 'W': {
        const row = this.moveRow(-1);
        return {
          action: 'move',
          changed: true,
          locked: false,
          cue: 'sndmove',
          row,
        };
      }
      case 'ArrowDown':
      case 'KeyS':
      case 's':
      case 'S': {
        const row = this.moveRow(1);
        return {
          action: 'move',
          changed: true,
          locked: false,
          cue: 'sndmove',
          row,
        };
      }
      case 'ArrowLeft':
      case 'KeyA':
      case 'a':
      case 'A': {
        const res = this.cycleCurrent(-1, snapshot, sim);
        return { action: 'cycle', ...res };
      }
      case 'ArrowRight':
      case 'KeyD':
      case 'd':
      case 'D': {
        const res = this.cycleCurrent(1, snapshot, sim);
        return { action: 'cycle', ...res };
      }
      case 'Enter':
      case 'Space':
      case ' ': {
        return this.activateCurrent(snapshot, sim);
      }
      default:
        return {
          action: 'none',
          changed: false,
          locked: false,
          cue: 'sndmove',
          row: this.getActiveRow(),
        };
    }
  }

  public buildUiState(
    snapshot: SimSnapshot,
    vaultSourceOverride?: VaultSource,
    act2Extras?: HangarAct2Extras,
  ): HangarUiState {
    if (act2Extras?.modFlags) {
      this.setModFlags(act2Extras.modFlags);
    } else if (snapshot.activeMods) {
      this.setModFlags(snapshot.activeMods);
    } else {
      this.setModFlags(DEFAULT_ACT2_MOD_FLAGS);
    }
    const effectiveModFlags = cloneModFlags(this.modFlagsCache);

    const palette = this.getSelectedPalette();
    const dailySeedId = act2Extras?.dailySeedId ?? snapshot.dailySeedId ?? undefined;
    const dailyBestScore =
      act2Extras?.dailyBestScore ??
      (dailySeedId ? snapshot.profile.dailyHighScores?.[dailySeedId] : undefined);
    const pbGhostScore =
      act2Extras?.pbGhostScore ?? snapshot.ghostPose?.scoreAtTick ?? undefined;

    return {
      activeRow: this.getActiveRow(),
      loadout: { ...snapshot.player.loadout },
      mode: snapshot.mode,
      paletteIndex: this.paletteIndex,
      paletteName: palette.name,
      planeName: snapshot.player.planeName,
      weaponSpec: snapshot.player.weaponSpec,
      bodySpec: snapshot.player.bodySpec,
      engineSpec: snapshot.player.engineSpec,
      activeMissions: snapshot.activeMissions,
      missionProgress: snapshot.missionProgress,
      unlockedWeapons: snapshot.profile.unlockedWeapons,
      unlockedBodies: snapshot.profile.unlockedBodies,
      unlockedEngines: snapshot.profile.unlockedEngines,
      highScore:
        snapshot.mode === 'sfmt'
          ? snapshot.profile.highScoreSfmt
          : snapshot.profile.highScoreNormal,
      sfmtUnlocked: snapshot.profile.sfmtUnlocked,
      vaultSource: vaultSourceOverride ?? this.vaultSource,
      completedMissionsCount: snapshot.profile.completedMissions.length,
      totalMissionsCount: this.totalMissionsCount,
      modDeckOpen: this.modDeckOpen,
      activeModRow: this.getActiveModRow(),
      modFlags: effectiveModFlags,
      dailySeedId,
      dailyBestScore,
      pbGhostScore,
      paletteStudio: this.paletteStudio.getState(),
      p2Loadout: act2Extras?.p2Loadout ?? snapshot.player2?.loadout,
      p2PlaneName: act2Extras?.p2PlaneName ?? snapshot.player2?.planeName,
    };
  }

  private isArsenalEnabled(snapshot: SimSnapshot): boolean {
    return Boolean(
      snapshot.activeMods?.moddedEnabled && snapshot.activeMods?.arsenalBosses,
    );
  }

  private getMergedPalettes(moddedEnabled: boolean): readonly PaletteDefinition[] {
    if (!moddedEnabled) {
      return this.palettes;
    }
    const merged: PaletteDefinition[] = [...this.palettes];
    const upsert = (pal: PaletteDefinition): void => {
      const idx = merged.findIndex((p) => p.id === pal.id);
      if (idx >= 0) {
        merged[idx] = pal;
      } else {
        merged.push(pal);
      }
    };
    for (const p of ACT2_BONUS_PALETTES) upsert(p);
    for (const p of this.customPalettes) upsert(p);
    return merged;
  }

  private getUnlockedList(
    slot: 'weapon' | 'body' | 'engine',
    snapshot: SimSnapshot,
  ): readonly number[] {
    if (slot === 'weapon') return snapshot.profile.unlockedWeapons;
    if (slot === 'body') return snapshot.profile.unlockedBodies;
    return snapshot.profile.unlockedEngines;
  }

  private cyclePart(
    slot: 'weapon' | 'body' | 'engine',
    dir: -1 | 1,
    snapshot: SimSnapshot,
    sim?: Pick<ISimulation, 'setLoadout'>,
  ): HangarCycleResult {
    const arsenalEnabled = this.isArsenalEnabled(snapshot);
    const partCount = arsenalEnabled ? MODDED_PART_COUNT : VANILLA_PART_COUNT;
    const unlocked = this.getUnlockedList(slot, snapshot);
    const rawCurrent = snapshot.player.loadout[slot];
    const current = rawCurrent >= partCount ? 0 : rawCurrent;

    for (let step = 1; step < partCount; step++) {
      const candidate = ((((current + dir * step) % partCount) + partCount) %
        partCount) as PartIndex;
      const isAvailable =
        candidate >= 6 ? arsenalEnabled : unlocked.includes(candidate);
      if (isAvailable) {
        const nextLoadout: Loadout = {
          ...snapshot.player.loadout,
          [slot]: candidate,
        };
        sim?.setLoadout(nextLoadout);
        return {
          changed: true,
          locked: false,
          cue: 'sndswap',
          row: slot,
          loadout: nextLoadout,
        };
      }
    }

    return {
      changed: false,
      locked: true,
      cue: 'snddeny',
      row: slot,
      loadout: { ...snapshot.player.loadout },
    };
  }

  private cyclePalette(
    dir: -1 | 1,
    snapshot: SimSnapshot,
  ): HangarCycleResult {
    const modded = Boolean(snapshot.activeMods?.moddedEnabled);
    const list = this.getMergedPalettes(modded);
    const len = list.length;
    const completed = snapshot.profile.completedMissions.length;
    const sfmt = snapshot.profile.sfmtUnlocked;

    const currentIdx = Math.max(
      0,
      list.findIndex((p) => p.id === this.selectedPaletteId),
    );

    for (let step = 1; step < len; step++) {
      const idx = (((currentIdx + dir * step) % len) + len) % len;
      const candidate = list[idx];
      if (candidate && isPaletteUnlocked(candidate, completed, sfmt)) {
        this.paletteIndex = idx;
        this.selectedPaletteId = candidate.id;
        return {
          changed: true,
          locked: false,
          cue: 'sndswap',
          row: 'palette',
          paletteId: candidate.id,
          paletteIndex: idx,
        };
      }
    }

    const current = this.getSelectedPalette();
    return {
      changed: false,
      locked: true,
      cue: 'snddeny',
      row: 'palette',
      paletteId: current.id,
      paletteIndex: this.paletteIndex,
    };
  }
}
