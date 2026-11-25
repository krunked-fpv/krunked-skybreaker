import type { AudioCueId } from '../contracts/audio';
import type {
  PaletteDefinition,
  PaletteStudioState,
  RgbaTuple,
} from '../contracts/render';
import {
  ACT2_BONUS_PALETTES,
  CUSTOM_PALETTE_ID,
  createDefaultCustomPalette,
  sanitizeCustomPalette,
} from '../render/palettes';

export const PALETTE_SLOT_LABELS = [
  'SKY/SEA',
  'PLAYER',
  'ENEMY',
  'REFLECT',
  'BG PROP',
  'BULLET',
  'CLOUD',
  'GLOW/HP',
] as const;

export interface PaletteStudioKeyResult {
  handled: boolean;
  changed: boolean;
  closed: boolean;
  saved: boolean;
  cue: AudioCueId;
  state: PaletteStudioState;
  palette: PaletteDefinition;
}

function clonePalette(pal: PaletteDefinition): PaletteDefinition {
  return {
    id: pal.id,
    name: pal.name,
    unlockMissionsRequired: pal.unlockMissionsRequired,
    backcol: [...pal.backcol] as RgbaTuple,
    colors: pal.colors.map((c) => [...c] as RgbaTuple) as PaletteDefinition['colors'],
  };
}

function roundChannel(value: number): number {
  const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
  return Math.round(clamped * 1000) / 1000;
}

/**
 * Interactive 8-slot RGB Palette Studio controller for live custom palette authoring.
 */
export class PaletteStudioController {
  private state: PaletteStudioState;

  constructor(initialPalette?: PaletteDefinition) {
    const sanitized = initialPalette
      ? sanitizeCustomPalette({ ...initialPalette, id: CUSTOM_PALETTE_ID })
      : null;
    this.state = {
      open: false,
      selectedSlot: 0,
      selectedChannel: 0,
      palette: sanitized ?? createDefaultCustomPalette(),
      savedCount: 0,
    };
  }

  public isOpen(): boolean {
    return this.state.open;
  }

  public setOpen(open: boolean): void {
    this.state.open = open;
  }

  public toggle(open?: boolean): boolean {
    this.state.open = open !== undefined ? open : !this.state.open;
    return this.state.open;
  }

  public getState(): PaletteStudioState {
    return {
      open: this.state.open,
      selectedSlot: this.state.selectedSlot,
      selectedChannel: this.state.selectedChannel,
      palette: clonePalette(this.state.palette),
      savedCount: this.state.savedCount,
    };
  }

  public getPalette(): PaletteDefinition {
    return clonePalette(this.state.palette);
  }

  public setPalette(palette: PaletteDefinition): PaletteDefinition | null {
    const sanitized = sanitizeCustomPalette({
      ...palette,
      id: CUSTOM_PALETTE_ID,
    });
    if (!sanitized) return null;
    this.state.palette = sanitized;
    return this.getPalette();
  }

  public moveSlot(delta: number): number {
    const total = PALETTE_SLOT_LABELS.length;
    this.state.selectedSlot =
      (((this.state.selectedSlot + Math.trunc(delta)) % total) + total) % total;
    return this.state.selectedSlot;
  }

  public selectSlot(slot: number): number {
    const total = PALETTE_SLOT_LABELS.length;
    this.state.selectedSlot = (((Math.trunc(slot)) % total) + total) % total;
    return this.state.selectedSlot;
  }

  public cycleChannel(delta: 1 | -1 = 1): 0 | 1 | 2 {
    const next = (((this.state.selectedChannel + delta) % 3) + 3) % 3;
    this.state.selectedChannel = next as 0 | 1 | 2;
    return this.state.selectedChannel;
  }

  public getSlotColor(slot = this.state.selectedSlot): RgbaTuple {
    const idx = Math.max(0, Math.min(7, Math.trunc(slot)));
    if (idx === 0) {
      return [...this.state.palette.backcol] as RgbaTuple;
    }
    return [...this.state.palette.colors[idx]!] as RgbaTuple;
  }

  public setSlotColor(
    slot: number,
    rgb: readonly [number, number, number],
  ): PaletteDefinition {
    const idx = Math.max(0, Math.min(7, Math.trunc(slot)));
    const next: RgbaTuple = [
      roundChannel(rgb[0]),
      roundChannel(rgb[1]),
      roundChannel(rgb[2]),
      1,
    ];
    if (idx === 0) {
      this.state.palette.backcol = next;
    } else {
      this.state.palette.colors[idx] = next;
    }
    return this.getPalette();
  }

  public stepChannel(delta: number): PaletteDefinition {
    const slot = this.state.selectedSlot;
    const ch = this.state.selectedChannel;
    const tuple =
      slot === 0
        ? this.state.palette.backcol
        : this.state.palette.colors[slot]!;
    tuple[ch] = roundChannel(tuple[ch] + delta);
    tuple[3] = 1;
    return this.getPalette();
  }

  public loadPreset(presetIndex: number): PaletteDefinition | null {
    const preset = ACT2_BONUS_PALETTES[presetIndex];
    if (!preset) return null;
    this.state.palette = {
      id: CUSTOM_PALETTE_ID,
      name: `CUSTOM ${preset.name}`.slice(0, 24),
      unlockMissionsRequired: 0,
      backcol: [...preset.backcol] as RgbaTuple,
      colors: preset.colors.map((c) => [...c] as RgbaTuple) as PaletteDefinition['colors'],
    };
    this.state.savedCount++;
    return this.getPalette();
  }

  public resetToOriginal(): PaletteDefinition {
    this.state.palette = createDefaultCustomPalette();
    return this.getPalette();
  }

  public saveCurrent(): PaletteDefinition {
    this.state.savedCount++;
    return this.getPalette();
  }

  public exportJson(): string {
    return JSON.stringify(this.getPalette(), null, 2);
  }

  public importJson(rawJson: string): PaletteDefinition | null {
    try {
      const parsed: unknown = JSON.parse(rawJson);
      const sanitized = sanitizeCustomPalette(parsed);
      if (!sanitized) {
        return null;
      }
      this.state.palette = {
        ...sanitized,
        id: CUSTOM_PALETTE_ID,
      };
      this.state.savedCount++;
      return this.getPalette();
    } catch {
      return null;
    }
  }

  public handleKey(keyOrCode: string): PaletteStudioKeyResult {
    const makeResult = (
      handled: boolean,
      changed: boolean,
      closed: boolean,
      saved: boolean,
      cue: AudioCueId,
    ): PaletteStudioKeyResult => ({
      handled,
      changed,
      closed,
      saved,
      cue,
      state: this.getState(),
      palette: this.getPalette(),
    });

    switch (keyOrCode) {
      case 'ArrowUp':
      case 'KeyW':
      case 'w':
      case 'W':
        this.moveSlot(-1);
        return makeResult(true, false, false, false, 'sndmove');

      case 'ArrowDown':
      case 'KeyS':
      case 's':
      case 'S':
        this.moveSlot(1);
        return makeResult(true, false, false, false, 'sndmove');

      case 'ArrowLeft':
      case 'KeyA':
      case 'a':
      case 'A':
        this.stepChannel(-0.05);
        return makeResult(true, true, false, false, 'sndswap');

      case 'ArrowRight':
      case 'KeyD':
      case 'd':
      case 'D':
        this.stepChannel(0.05);
        return makeResult(true, true, false, false, 'sndswap');

      case 'KeyQ':
      case 'q':
      case 'Q':
        this.cycleChannel(-1);
        return makeResult(true, false, false, false, 'sndmove');

      case 'KeyE':
      case 'e':
      case 'E':
      case 'Tab':
        this.cycleChannel(1);
        return makeResult(true, false, false, false, 'sndmove');

      case 'Digit1':
      case '1':
        this.loadPreset(0);
        return makeResult(true, true, false, true, 'sndswap');

      case 'Digit2':
      case '2':
        this.loadPreset(1);
        return makeResult(true, true, false, true, 'sndswap');

      case 'Digit3':
      case '3':
        this.loadPreset(2);
        return makeResult(true, true, false, true, 'sndswap');

      case 'Digit4':
      case '4':
        this.loadPreset(3);
        return makeResult(true, true, false, true, 'sndswap');

      case 'KeyR':
      case 'r':
      case 'R':
        this.resetToOriginal();
        return makeResult(true, true, false, false, 'sndswap');

      case 'Enter':
      case 'Space':
      case ' ':
        this.saveCurrent();
        return makeResult(true, true, false, true, 'sndsfmt');

      case 'Escape':
      case 'Backspace':
        this.setOpen(false);
        return makeResult(true, false, true, false, 'sndhangar');

      default:
        return makeResult(false, false, false, false, 'sndmove');
    }
  }
}
