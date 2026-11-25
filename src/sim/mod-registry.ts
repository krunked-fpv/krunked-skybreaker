import {
  DEFAULT_SHADER_FX,
  VANILLA_1TO1_PROFILE,
  type CustomBossKind,
  type FlightMutator,
  type IModRegistry,
  type ModPackage,
  type MultiplayerMode,
  type ShaderFxConfig,
  type Vanilla1to1Profile,
} from '../contracts/mod';
import type { PaletteDefinition } from '../contracts/render';
import type { BodySpec, EngineSpec, WeaponSpec } from '../contracts/vault';

/**
 * KRUNKED SKYBREAKER mod extension seam for Act II mutators and custom content.
 * Locked to VANILLA_1TO1_PROFILE (`profileId: 'vanilla-1to1'`) by default so
 * deterministic 60Hz baseline flight physics cannot drift.
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

  getCustomWeapons(): readonly WeaponSpec[] {
    if (this.vanillaLocked) {
      return [];
    }
    const byId = new Map<number, WeaponSpec>();
    for (const mod of this.mods.values()) {
      if (mod.customWeapons) {
        for (const weapon of mod.customWeapons) {
          byId.set(weapon.id, weapon);
        }
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.id - b.id);
  }

  getCustomBodies(): readonly BodySpec[] {
    if (this.vanillaLocked) {
      return [];
    }
    const byId = new Map<number, BodySpec>();
    for (const mod of this.mods.values()) {
      if (mod.customBodies) {
        for (const body of mod.customBodies) {
          byId.set(body.id, body);
        }
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.id - b.id);
  }

  getCustomEngines(): readonly EngineSpec[] {
    if (this.vanillaLocked) {
      return [];
    }
    const byId = new Map<number, EngineSpec>();
    for (const mod of this.mods.values()) {
      if (mod.customEngines) {
        for (const engine of mod.customEngines) {
          byId.set(engine.id, engine);
        }
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.id - b.id);
  }

  getCustomBosses(): readonly CustomBossKind[] {
    if (this.vanillaLocked) {
      return [];
    }
    const bosses = new Set<CustomBossKind>();
    for (const mod of this.mods.values()) {
      if (mod.customBosses) {
        for (const boss of mod.customBosses) {
          bosses.add(boss);
        }
      }
    }
    return Array.from(bosses);
  }

  getEffectiveShaderFx(): ShaderFxConfig {
    if (this.vanillaLocked) {
      return DEFAULT_SHADER_FX;
    }
    const effective: ShaderFxConfig = { ...DEFAULT_SHADER_FX };
    for (const mod of this.mods.values()) {
      if (!mod.shaderFx) continue;
      if (mod.shaderFx.crtScanlines !== undefined) {
        effective.crtScanlines = mod.shaderFx.crtScanlines;
      }
      if (mod.shaderFx.phosphorBloom !== undefined) {
        effective.phosphorBloom = mod.shaderFx.phosphorBloom;
      }
      if (mod.shaderFx.speedWarp !== undefined) {
        effective.speedWarp = mod.shaderFx.speedWarp;
      }
      if (mod.shaderFx.shockwaves !== undefined) {
        effective.shockwaves = mod.shaderFx.shockwaves;
      }
    }
    return effective;
  }

  getEffectiveMultiplayerMode(): MultiplayerMode {
    if (this.vanillaLocked) {
      return 'solo';
    }
    let mode: MultiplayerMode = 'solo';
    for (const mod of this.mods.values()) {
      if (mod.multiplayerMode) {
        mode = mod.multiplayerMode;
      }
    }
    return mode;
  }
}
