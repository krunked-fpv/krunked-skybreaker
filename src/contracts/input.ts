import type { PaletteDefinition } from './render';
import type { InputState, SimPhase } from './sim';

export type ControllerFamily =
  | 'xbox'
  | 'playstation'
  | 'nintendo'
  | 'tesla'
  | 'steamdeck'
  | 'generic';

export type ActiveInputSource = 'keyboard' | 'gamepad' | 'touch';

export interface ConnectedGamepadInfo {
  slot: 0 | 1;
  index: number;
  id: string;
  mapping: string;
  family: ControllerFamily;
  label: string;
  hasRumble: boolean;
  nonStandardFallback: boolean;
}

export interface ControllerConnectionEvent {
  type: 'connected' | 'disconnected';
  info: ConnectedGamepadInfo;
}

export type ControllerMenuCommand =
  | { kind: 'key'; code: string }
  | { kind: 'pause-toggle' }
  | { kind: 'launch' }
  | { kind: 'return-hangar' }
  | { kind: 'relaunch' }
  | { kind: 'toggle-mod-deck' }
  | {
      kind: 'hangar-row-tap';
      rowIndex: number;
      action: 'select' | 'prev' | 'next' | 'activate';
    }
  | { kind: 'pause-option-tap'; optionIndex: number };

export interface GamepadPollResult {
  p1: InputState;
  p2: InputState;
  commands: ControllerMenuCommand[];
  hadActivity: boolean;
  p1DisconnectedInFlight: boolean;
  connectionEvents: ControllerConnectionEvent[];
  gamepads: readonly ConnectedGamepadInfo[];
}

export interface TouchStickVector {
  /** Normalized horizontal deflection in [-1, 1] */
  x: number;
  /** Normalized vertical deflection in [-1, 1] */
  y: number;
  /** Whether a pointer/touch is currently driving this stick */
  active: boolean;
  /** Clamped radial magnitude in [0, 1] */
  magnitude: number;
}

export interface TouchControlsSnapshot {
  visible: boolean;
  mode: 'flight' | 'menu';
  phase: SimPhase;
  paused: boolean;
  flightInput: InputState;
  leftStick: TouchStickVector;
  rightStick: TouchStickVector;
  boostPressed: boolean;
}

export interface ControllerStatusSnapshot {
  activeSource: ActiveInputSource;
  touchSensed: boolean;
  touchOverlayVisible: boolean;
  isTeslaBrowser: boolean;
  gamepads: readonly ConnectedGamepadInfo[];
}

export interface TouchOverlayContext {
  phase: SimPhase;
  paused: boolean;
  modDeckOpen: boolean;
  paletteStudioOpen: boolean;
  palette: PaletteDefinition;
}
