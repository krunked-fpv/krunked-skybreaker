import type { AudioCueId } from '../contracts/audio';
import type {
  HangarRow,
  HangarUiState,
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
  DEFAULT_PALETTE_ID,
  PALETTES,
  getPaletteIndexById,
  isPaletteUnlocked,
} from '../render/palettes';

export const HANGAR_ROWS: readonly HangarRow[] = [
  'weapon',
  'body',
  'engine',
  'palette',
  'mode',
  'launch',
];

const PART_COUNT = 6;

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

export class HangarController {
  private readonly palettes: readonly PaletteDefinition[];
  private activeRowIndex = 0;
  private paletteIndex: number;
  private vaultSource: VaultSource;
  private totalMissionsCount: number;

  constructor(options: HangarControllerOptions = {}) {
    this.palettes =
      options.palettes && options.palettes.length > 0
        ? options.palettes
        : PALETTES;
    const initId = options.initialPaletteId ?? DEFAULT_PALETTE_ID;
    const idx = this.palettes.findIndex((p) => p.id === initId);
    this.paletteIndex = idx >= 0 ? idx : getPaletteIndexById(DEFAULT_PALETTE_ID);
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

  public getPaletteIndex(): number {
    return this.paletteIndex;
  }

  public getSelectedPalette(): PaletteDefinition {
    return this.palettes[this.paletteIndex] ?? this.palettes[0]!;
  }

  public setPaletteById(id: string): boolean {
    const idx = this.palettes.findIndex((p) => p.id === id);
    if (idx < 0) return false;
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
    const idx = this.palettes.findIndex((p) => p.id === paletteId);
    if (idx < 0) return;
    const target = this.palettes[idx];
    if (
      target &&
      isPaletteUnlocked(target, completedMissionsCount, sfmtUnlocked)
    ) {
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
    const unlocked = this.getUnlockedList(slot, snapshot);
    if (!unlocked.includes(index)) {
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
    const pal = this.palettes[targetIndex];
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
    const changed = targetIndex !== this.paletteIndex;
    this.paletteIndex = targetIndex;
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
  ): HangarUiState {
    const palette = this.getSelectedPalette();
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
    };
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
    const unlocked = this.getUnlockedList(slot, snapshot);
    const current = snapshot.player.loadout[slot];

    for (let step = 1; step < PART_COUNT; step++) {
      const candidate = ((((current + dir * step) % PART_COUNT) + PART_COUNT) %
        PART_COUNT) as PartIndex;
      if (unlocked.includes(candidate)) {
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
    const len = this.palettes.length;
    const completed = snapshot.profile.completedMissions.length;
    const sfmt = snapshot.profile.sfmtUnlocked;

    for (let step = 1; step < len; step++) {
      const idx = (((this.paletteIndex + dir * step) % len) + len) % len;
      const candidate = this.palettes[idx];
      if (candidate && isPaletteUnlocked(candidate, completed, sfmt)) {
        this.paletteIndex = idx;
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
