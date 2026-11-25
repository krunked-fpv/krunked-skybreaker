import {
  VANILLA_1TO1_PROFILE,
  type FlightMutator,
  type IModRegistry,
  type ModPackage,
  type Vanilla1to1Profile,
} from '../contracts/mod';
import type { PaletteDefinition } from '../contracts/render';

/**
 * Mod extension seam for Act II mutators and custom content.
 * Locked to VANILLA_1TO1_PROFILE by default so 1:1 vanilla physics cannot drift.
 */
export class ModRegistry implements IModRegistry {
  readonly vanillaProfile: Readonly<Vanilla1to1Profile> = VANILLA_1TO1_PROFILE;
  private vanillaLocked: boolean;
  private readonly mods = new Map<string, ModPackage>();

  constructor(vanillaLocked = true) {
    this.vanillaLocked = vanillaLocked;
  }

  isVanillaLocked(): boolean {
    return this.vanillaLocked;
  }

  setVanillaLock(locked: boolean): void {
    this.vanillaLocked = locked;
  }

  register(mod: ModPackage): void {
    this.mods.set(mod.id, mod);
  }

  unregister(modId: string): void {
    this.mods.delete(modId);
  }

  listMods(): readonly ModPackage[] {
    return Array.from(this.mods.values());
  }

  getActiveFlightMutators(): readonly FlightMutator[] {
    if (this.vanillaLocked) {
      return [];
    }
    const mutators: FlightMutator[] = [];
    for (const mod of this.mods.values()) {
      if (mod.flightMutators) {
        for (const m of mod.flightMutators) {
          mutators.push(m);
        }
      }
    }
    return mutators;
  }

  getCustomPalettes(): readonly PaletteDefinition[] {
    const palettes: PaletteDefinition[] = [];
    for (const mod of this.mods.values()) {
      if (mod.customPalettes) {
        for (const p of mod.customPalettes) {
          palettes.push(p);
        }
      }
    }
    return palettes;
  }
}
