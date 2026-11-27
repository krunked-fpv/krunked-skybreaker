import type { ControllerMenuCommand } from '../contracts/input';
import { VIRTUAL_HEIGHT, VIRTUAL_WIDTH } from '../contracts/render';
import type { SimPhase } from '../contracts/sim';
import { HANGAR_LAYOUT } from '../render/hangar-hud-pass';

export interface ClientRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface VirtualPoint {
  x: number;
  y: number;
}

export interface CanvasTapContext {
  phase: SimPhase;
  paused: boolean;
  modDeckOpen: boolean;
  paletteStudioOpen: boolean;
  activeHangarRowIndex: number;
}

const PAUSE_CARD_X = 158;
const PAUSE_CARD_Y = 122;
const PAUSE_CARD_W = 284;
const PAUSE_OPT_X = PAUSE_CARD_X + 22; // 180
const PAUSE_OPT_W = PAUSE_CARD_W - 44; // 240 -> x in [180, 420]
const PAUSE_OPT_START_Y = PAUSE_CARD_Y + 64; // 186
const PAUSE_OPT_STEP_Y = 24;
const PAUSE_OPT_HEIGHT = 20;
const PAUSE_OPT_COUNT = 3;
const PAUSE_ASSIST_Y = PAUSE_CARD_Y + 136; // 258
const PAUSE_ASSIST_HEIGHT = 20;

const HANGAR_ASSIST_MIN_X = 20;
const HANGAR_ASSIST_MAX_X = 176;
const HANGAR_ASSIST_MIN_Y = 0;
const HANGAR_ASSIST_MAX_Y = 22;

const GAMEOVER_PROJ_X = 36;
const GAMEOVER_PROJ_Y = 22;
const GAMEOVER_PROJ_W = 528;
const GAMEOVER_PROMPT_TOP_Y = 324;
const GAMEOVER_PROMPT_BOTTOM_Y = 388;
const GAMEOVER_ASSIST_START_X = 245;
const GAMEOVER_HANGAR_SPLIT_X = Math.round(
  GAMEOVER_PROJ_X + GAMEOVER_PROJ_W * (2 / 3),
); // 388 (right third of bottom prompt bar)

/**
 * Maps a DOM client coordinate `(clientX, clientY)` onto the aspect-correct
 * `600x400` virtual framebuffer space rendered by `OUTPASS_VERT`.
 *
 * Returns `null` if the rect is degenerate or the tap landed inside the
 * horizontal pillarbox or vertical letterbox bars.
 */
export function clientToVirtualPoint(
  clientX: number,
  clientY: number,
  rect: ClientRectLike,
  virtualWidth = VIRTUAL_WIDTH,
  virtualHeight = VIRTUAL_HEIGHT,
): VirtualPoint | null {
  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    virtualWidth <= 0 ||
    virtualHeight <= 0
  ) {
    return null;
  }

  const targetAspect = virtualWidth / virtualHeight;
  const rectAspect = rect.width / rect.height;

  let renderedWidth: number;
  let renderedHeight: number;
  let offsetX: number;
  let offsetY: number;

  if (rectAspect > targetAspect) {
    // Wider than 3:2 -> pillarboxed horizontally
    renderedHeight = rect.height;
    renderedWidth = rect.height * targetAspect;
    offsetX = (rect.width - renderedWidth) * 0.5;
    offsetY = 0;
  } else {
    // Taller than 3:2 -> letterboxed vertically
    renderedWidth = rect.width;
    renderedHeight = rect.width / targetAspect;
    offsetX = 0;
    offsetY = (rect.height - renderedHeight) * 0.5;
  }

  const normX = (clientX - rect.left - offsetX) / renderedWidth;
  const normY = (clientY - rect.top - offsetY) / renderedHeight;

  if (normX < 0 || normX > 1 || normY < 0 || normY > 1) {
    return null;
  }

  return {
    x: normX * virtualWidth,
    y: normY * virtualHeight,
  };
}

/**
 * Resolves a direct canvas tap at `(virtualX, virtualY)` into a high-level menu
 * command for Hangar rows, Pause options, or Game Over debrief prompts.
 */
export function resolveCanvasTapCommand(
  virtualX: number,
  virtualY: number,
  context: CanvasTapContext,
): ControllerMenuCommand | null {
  if (!Number.isFinite(virtualX) || !Number.isFinite(virtualY)) {
    return null;
  }

  // 1. Hangar main menu (not Mod Deck / Palette Studio overlays)
  if (
    context.phase === 'hangar' &&
    !context.modDeckOpen &&
    !context.paletteStudioOpen
  ) {
    if (
      virtualX >= HANGAR_ASSIST_MIN_X &&
      virtualX <= HANGAR_ASSIST_MAX_X &&
      virtualY >= HANGAR_ASSIST_MIN_Y &&
      virtualY <= HANGAR_ASSIST_MAX_Y
    ) {
      return { kind: 'toggle-assist' };
    }
    const { rowX, rowWidth, rowStartY, rowHeight, rowStep, rowCount } =
      HANGAR_LAYOUT;
    if (virtualX >= rowX && virtualX <= rowX + rowWidth) {
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
        const y0 = rowStartY + rowIndex * rowStep;
        const y1 = y0 + rowHeight;
        if (virtualY >= y0 && virtualY <= y1) {
          if (rowIndex === rowCount - 1) {
            return { kind: 'launch' };
          }
          if (rowIndex !== context.activeHangarRowIndex) {
            return { kind: 'hangar-row-tap', rowIndex, action: 'select' };
          }
          const relX = (virtualX - rowX) / rowWidth;
          return {
            kind: 'hangar-row-tap',
            rowIndex,
            action: relX < 1 / 3 ? 'prev' : 'next',
          };
        }
      }
    }
    return null;
  }

  // 2. Pause menu overlay (3 option buttons inside pause card)
  if (
    context.paused &&
    context.phase !== 'hangar' &&
    context.phase !== 'gameover'
  ) {
    if (virtualX >= PAUSE_OPT_X && virtualX <= PAUSE_OPT_X + PAUSE_OPT_W) {
      for (let optionIndex = 0; optionIndex < PAUSE_OPT_COUNT; optionIndex++) {
        const y0 = PAUSE_OPT_START_Y + optionIndex * PAUSE_OPT_STEP_Y;
        const y1 = y0 + PAUSE_OPT_HEIGHT;
        if (virtualY >= y0 && virtualY <= y1) {
          return { kind: 'pause-option-tap', optionIndex };
        }
      }
      if (
        virtualY >= PAUSE_ASSIST_Y &&
        virtualY <= PAUSE_ASSIST_Y + PAUSE_ASSIST_HEIGHT
      ) {
        return { kind: 'toggle-assist' };
      }
    }
    return null;
  }

  // 3. Game Over debrief projector
  if (context.phase === 'gameover') {
    if (
      virtualY >= GAMEOVER_PROMPT_TOP_Y &&
      virtualY <= GAMEOVER_PROMPT_BOTTOM_Y &&
      virtualX >= 0 &&
      virtualX <= VIRTUAL_WIDTH
    ) {
      if (virtualX >= GAMEOVER_HANGAR_SPLIT_X) {
        return { kind: 'return-hangar' };
      }
      if (virtualX >= GAMEOVER_ASSIST_START_X) {
        return { kind: 'toggle-assist' };
      }
      return { kind: 'relaunch' };
    }

    if (
      virtualX >= GAMEOVER_PROJ_X &&
      virtualX <= GAMEOVER_PROJ_X + GAMEOVER_PROJ_W &&
      virtualY >= GAMEOVER_PROJ_Y &&
      virtualY < GAMEOVER_PROMPT_TOP_Y
    ) {
      return { kind: 'relaunch' };
    }

    return null;
  }

  return null;
}
