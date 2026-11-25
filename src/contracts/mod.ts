import type { InputState, PlayerState } from './sim';
import type { BodySpec, EngineSpec, WeaponSpec } from './vault';
import type { PaletteDefinition } from './render';

export interface Vanilla1to1Profile {
  readonly profileId: 'vanilla-1to1';
  readonly fixedTimestepHz: 60;
  readonly virtualWidth: 600;
  readonly virtualHeight: 400;
  readonly maxSubSteps: 5;
  readonly laserTurnDivisor: 3;
  readonly maxCombo: 20;
  readonly healthInvisibleThreshold: 0.99;
  readonly healthRadiusDivisor: 350;
  readonly healthQuantizeBlockPx: 2;
}

export const VANILLA_1TO1_PROFILE: Readonly<Vanilla1to1Profile> = Object.freeze({
  profileId: 'vanilla-1to1',
  fixedTimestepHz: 60,
  virtualWidth: 600,
  virtualHeight: 400,
  maxSubSteps: 5,
  laserTurnDivisor: 3,
  maxCombo: 20,
  healthInvisibleThreshold: 0.99,
  healthRadiusDivisor: 350,
  healthQuantizeBlockPx: 2,
});

export interface FlightMutator {
  id: string;
  name: string;
  apply?(player: PlayerState, input: InputState, dt: number): void;
}

export interface ModPackage {
  id: string;
  name: string;
  version: string;
  flightMutators?: FlightMutator[];
  customEngines?: EngineSpec[];
  customBodies?: BodySpec[];
  customWeapons?: WeaponSpec[];
  customPalettes?: PaletteDefinition[];
}

export interface IModRegistry {
  readonly vanillaProfile: Readonly<Vanilla1to1Profile>;
  isVanillaLocked(): boolean;
  setVanillaLock(locked: boolean): void;
  register(mod: ModPackage): void;
  unregister(modId: string): void;
  listMods(): readonly ModPackage[];
  getActiveFlightMutators(): readonly FlightMutator[];
  getCustomPalettes(): readonly PaletteDefinition[];
}
