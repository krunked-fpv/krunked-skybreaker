import {
  DEFAULT_ACT2_MOD_FLAGS,
  DEFAULT_SHADER_FX,
  type Act2ModFlags,
} from '../contracts/mod';
import type { PaletteDefinition } from '../contracts/render';
import type {
  PartIndex,
  PilotProfile,
  ReplayRecording,
} from '../contracts/sim';
import type { AssetPackMode, MissionSpec } from '../contracts/vault';
import { DEFAULT_PALETTE_ID, sanitizeCustomPalette } from '../render/palettes';
import { createDefaultProfile, parseReplayJson, serializeReplay } from '../sim';

export const PROFILE_STORAGE_KEY = 'krunked_skybreaker_profile_v1';
export const LEGACY_PROFILE_STORAGE_KEY = 'krunked_luftrausers_profile_v1';
export const ACT2_MODS_STORAGE_KEY = 'krunked_skybreaker_act2_mods_v1';
export const LEGACY_ACT2_MODS_STORAGE_KEY = 'krunked_luftrausers_act2_mods_v1';
export const ACT2_CUSTOM_PALETTE_KEY = 'krunked_skybreaker_act2_custom_palette_v1';
export const LEGACY_ACT2_CUSTOM_PALETTE_KEY =
  'krunked_luftrausers_act2_custom_palette_v1';
export const ACT2_PB_GHOST_KEY = 'krunked_skybreaker_act2_pb_ghost_v1';
export const LEGACY_ACT2_PB_GHOST_KEY = 'krunked_luftrausers_act2_pb_ghost_v1';
export const ASSET_MODE_STORAGE_KEY = 'krunked_skybreaker_asset_mode_v1';
export const PROGRESSION_LOCK_STORAGE_KEY =
  'krunked_skybreaker_progression_lock_v1';
export const ASSIST_MODE_STORAGE_KEY = 'krunked_skybreaker_assist_mode_v1';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const ALL_CORE_PARTS: readonly PartIndex[] = [0, 1, 2, 3, 4, 5];

const CAMPAIGN_PART_UNLOCK_THRESHOLDS: readonly [number, PartIndex][] = [
  [1, 1],
  [3, 2],
  [6, 3],
  [10, 4],
  [15, 5],
];

const LEGACY_PALETTE_ID_ALIASES: Record<string, string> = {
  lanigiro: 'inverted',
  kozilek: 'synthdusk',
  sfmt: 'overdrive',
};

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Ignore restricted/private-mode storage access
  }
  return null;
}

export function clampPartIndex(value: number, maxPart = 8): PartIndex {
  const n = Math.floor(Number.isFinite(value) ? value : 0);
  if (n <= 0) return 0;
  if (n >= maxPart) return maxPart as PartIndex;
  return n as PartIndex;
}

export function cloneStoredModFlags(flags: Act2ModFlags): Act2ModFlags {
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
      flags.multiplayerMode === 'coop2p' ||
      flags.multiplayerMode === 'dogfight1v1'
        ? flags.multiplayerMode
        : 'solo',
    p2BotEnabled:
      flags.p2BotEnabled !== undefined ? Boolean(flags.p2BotEnabled) : true,
  };
}

export function normalizeStoredPaletteId(rawId: unknown): string {
  if (typeof rawId !== 'string') {
    return DEFAULT_PALETTE_ID;
  }
  const trimmed = rawId.trim();
  if (!trimmed) {
    return DEFAULT_PALETTE_ID;
  }
  const alias = LEGACY_PALETTE_ID_ALIASES[trimmed.toLowerCase()];
  return alias ?? trimmed;
}

/**
 * Reads `primaryKey`; if missing, falls back to `legacyKey` and migrates the
 * stored payload forward into `primaryKey` without deleting the legacy copy.
 */
export function readStorageWithLegacyFallback(
  storage: StorageLike | null | undefined,
  primaryKey: string,
  legacyKey: string,
): string | null {
  if (!storage) return null;
  try {
    const primary = storage.getItem(primaryKey);
    if (primary !== null) {
      return primary;
    }
    const legacy = storage.getItem(legacyKey);
    if (legacy !== null) {
      try {
        storage.setItem(primaryKey, legacy);
      } catch {
        // Ignore storage quota errors while migrating
      }
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}

function uniqueSortedCoreParts(raw: readonly number[]): PartIndex[] {
  const set = new Set<PartIndex>();
  for (const v of raw) {
    set.add(clampPartIndex(v, 5));
  }
  if (!set.has(0)) {
    set.add(0);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * Unlocks all 6 core weapons/bodies/engines and Overdrive (SFMT) for browser
 * free-play while keeping mission completion progress (`0/90` -> `90/90`) real.
 */
export function applyBrowserFullRosterUnlocks(
  profile: PilotProfile,
): PilotProfile {
  return {
    ...profile,
    unlockedWeapons: [...ALL_CORE_PARTS],
    unlockedBodies: [...ALL_CORE_PARTS],
    unlockedEngines: [...ALL_CORE_PARTS],
    sfmtUnlocked: true,
    completedMissions: [...profile.completedMissions],
    activeMissionIds: [...profile.activeMissionIds],
    lastLoadout: { ...profile.lastLoadout },
    totalKills: { ...profile.totalKills },
    stats: { ...profile.stats },
    ...(profile.dailyHighScores
      ? { dailyHighScores: { ...profile.dailyHighScores } }
      : {}),
  };
}

/**
 * Recomputes earned campaign unlocks strictly from `completedMissions` and
 * Blimp kills when a player toggles into Campaign Locks mode (`KeyU`).
 */
export function computeCampaignUnlockedProfile(
  profile: PilotProfile,
  missions: readonly MissionSpec[],
  moddedArsenalEnabled = false,
): PilotProfile {
  const missionById = new Map<number, MissionSpec>();
  for (const m of missions) {
    missionById.set(m.id, m);
  }
  const completedSet = new Set<number>(profile.completedMissions);
  const countsByCat = [0, 0, 0];
  for (const id of completedSet) {
    const m = missionById.get(id);
    if (!m) continue;
    const cat = m.component[0];
    if (cat === 0 || cat === 1 || cat === 2) {
      countsByCat[cat] = (countsByCat[cat] ?? 0) + 1;
    }
  }

  const buildEarned = (completedInCat: number): PartIndex[] => {
    const list: PartIndex[] = [0];
    for (const [req, part] of CAMPAIGN_PART_UNLOCK_THRESHOLDS) {
      if (completedInCat >= req && !list.includes(part)) {
        list.push(part);
      }
    }
    return list;
  };

  const unlockedWeapons = buildEarned(countsByCat[0] ?? 0);
  const unlockedBodies = buildEarned(countsByCat[1] ?? 0);
  const unlockedEngines = buildEarned(countsByCat[2] ?? 0);

  const hasAllStandard =
    [0, 1, 2, 3, 4].every((p) => unlockedWeapons.includes(p as PartIndex)) &&
    [0, 1, 2, 3, 4].every((p) => unlockedBodies.includes(p as PartIndex)) &&
    [0, 1, 2, 3, 4].every((p) => unlockedEngines.includes(p as PartIndex));

  const sfmtUnlocked =
    completedSet.size >= 15 ||
    (profile.totalKills['Blimp'] ?? 0) > 0 ||
    hasAllStandard;

  const clampSlot = (
    part: PartIndex,
    earned: readonly PartIndex[],
  ): PartIndex => {
    if (moddedArsenalEnabled && part >= 6 && part <= 8) {
      return part;
    }
    return earned.includes(part) ? part : 0;
  };

  return {
    ...profile,
    unlockedWeapons,
    unlockedBodies,
    unlockedEngines,
    sfmtUnlocked,
    completedMissions: [...profile.completedMissions],
    activeMissionIds: [...profile.activeMissionIds],
    lastLoadout: {
      weapon: clampSlot(profile.lastLoadout.weapon, unlockedWeapons),
      body: clampSlot(profile.lastLoadout.body, unlockedBodies),
      engine: clampSlot(profile.lastLoadout.engine, unlockedEngines),
    },
    lastMode: sfmtUnlocked ? profile.lastMode : 'normal',
    totalKills: { ...profile.totalKills },
    stats: { ...profile.stats },
    ...(profile.dailyHighScores
      ? { dailyHighScores: { ...profile.dailyHighScores } }
      : {}),
  };
}

export function loadProgressionLockMode(
  storage: StorageLike | null = getDefaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(PROGRESSION_LOCK_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveProgressionLockMode(
  locked: boolean,
  storage: StorageLike | null = getDefaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(PROGRESSION_LOCK_STORAGE_KEY, locked ? 'true' : 'false');
  } catch {
    // ignore
  }
}

export interface LoadStoredProfileOptions {
  progressionLocked?: boolean;
}

export function loadStoredProfile(
  storage: StorageLike | null = getDefaultStorage(),
  options: LoadStoredProfileOptions = {},
): PilotProfile {
  const progressionLocked =
    options.progressionLocked !== undefined
      ? Boolean(options.progressionLocked)
      : loadProgressionLockMode(storage);
  const fallback = createDefaultProfile();
  let profile: PilotProfile = fallback;

  try {
    const raw = readStorageWithLegacyFallback(
      storage,
      PROFILE_STORAGE_KEY,
      LEGACY_PROFILE_STORAGE_KEY,
    );
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PilotProfile>;
      if (
        parsed &&
        typeof parsed === 'object' &&
        parsed.version === fallback.version
      ) {
        profile = {
          ...fallback,
          ...parsed,
          unlockedWeapons:
            Array.isArray(parsed.unlockedWeapons) &&
            parsed.unlockedWeapons.length > 0
              ? uniqueSortedCoreParts(parsed.unlockedWeapons)
              : fallback.unlockedWeapons,
          unlockedBodies:
            Array.isArray(parsed.unlockedBodies) &&
            parsed.unlockedBodies.length > 0
              ? uniqueSortedCoreParts(parsed.unlockedBodies)
              : fallback.unlockedBodies,
          unlockedEngines:
            Array.isArray(parsed.unlockedEngines) &&
            parsed.unlockedEngines.length > 0
              ? uniqueSortedCoreParts(parsed.unlockedEngines)
              : fallback.unlockedEngines,
          completedMissions: Array.isArray(parsed.completedMissions)
            ? parsed.completedMissions.filter(
                (n): n is number => typeof n === 'number',
              )
            : fallback.completedMissions,
          activeMissionIds: Array.isArray(parsed.activeMissionIds)
            ? parsed.activeMissionIds.filter(
                (n): n is number => typeof n === 'number',
              )
            : fallback.activeMissionIds,
          lastLoadout: parsed.lastLoadout
            ? {
                weapon: clampPartIndex(parsed.lastLoadout.weapon, 8),
                body: clampPartIndex(parsed.lastLoadout.body, 8),
                engine: clampPartIndex(parsed.lastLoadout.engine, 8),
              }
            : fallback.lastLoadout,
          lastMode: parsed.lastMode === 'sfmt' ? 'sfmt' : 'normal',
          selectedPaletteId: normalizeStoredPaletteId(parsed.selectedPaletteId),
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
      }
    }
  } catch {
    profile = fallback;
  }

  return progressionLocked ? profile : applyBrowserFullRosterUnlocks(profile);
}

export function saveStoredProfile(
  profile: PilotProfile,
  storage: StorageLike | null = getDefaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Ignore storage quota or privacy-mode restrictions cleanly
  }
}

export function loadStoredModFlags(
  storage: StorageLike | null = getDefaultStorage(),
): Act2ModFlags {
  try {
    const raw = readStorageWithLegacyFallback(
      storage,
      ACT2_MODS_STORAGE_KEY,
      LEGACY_ACT2_MODS_STORAGE_KEY,
    );
    if (!raw) return cloneStoredModFlags(DEFAULT_ACT2_MOD_FLAGS);
    const parsed = JSON.parse(raw) as Partial<Act2ModFlags>;
    if (!parsed || typeof parsed !== 'object') {
      return cloneStoredModFlags(DEFAULT_ACT2_MOD_FLAGS);
    }
    return cloneStoredModFlags({
      ...DEFAULT_ACT2_MOD_FLAGS,
      ...parsed,
      shaderFx: {
        ...DEFAULT_SHADER_FX,
        ...(parsed.shaderFx ?? {}),
      },
    });
  } catch {
    return cloneStoredModFlags(DEFAULT_ACT2_MOD_FLAGS);
  }
}

export function saveStoredModFlags(
  flags: Act2ModFlags,
  storage: StorageLike | null = getDefaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(ACT2_MODS_STORAGE_KEY, JSON.stringify(flags));
  } catch {
    // ignore
  }
}

export function loadStoredCustomPalette(
  storage: StorageLike | null = getDefaultStorage(),
): PaletteDefinition | null {
  try {
    const raw = readStorageWithLegacyFallback(
      storage,
      ACT2_CUSTOM_PALETTE_KEY,
      LEGACY_ACT2_CUSTOM_PALETTE_KEY,
    );
    if (!raw) return null;
    return sanitizeCustomPalette(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveStoredCustomPalette(
  palette: PaletteDefinition,
  storage: StorageLike | null = getDefaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(ACT2_CUSTOM_PALETTE_KEY, JSON.stringify(palette));
  } catch {
    // ignore
  }
}

export function loadStoredPbGhost(
  storage: StorageLike | null = getDefaultStorage(),
): ReplayRecording | null {
  try {
    const raw = readStorageWithLegacyFallback(
      storage,
      ACT2_PB_GHOST_KEY,
      LEGACY_ACT2_PB_GHOST_KEY,
    );
    if (!raw) return null;
    return parseReplayJson(raw);
  } catch {
    return null;
  }
}

export function saveStoredPbGhost(
  recording: ReplayRecording,
  storage: StorageLike | null = getDefaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(ACT2_PB_GHOST_KEY, serializeReplay(recording));
  } catch {
    // ignore
  }
}

export function loadExplicitStoredAssetMode(
  storage: StorageLike | null = getDefaultStorage(),
): AssetPackMode | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(ASSET_MODE_STORAGE_KEY);
    if (raw === 'steam-local' || raw === 'skybreaker') {
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}

export function loadStoredAssetMode(
  storage: StorageLike | null = getDefaultStorage(),
): AssetPackMode {
  return loadExplicitStoredAssetMode(storage) ?? 'skybreaker';
}

export function saveStoredAssetMode(
  mode: AssetPackMode,
  storage: StorageLike | null = getDefaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(ASSET_MODE_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

export function loadStoredAssistMode(
  storage: StorageLike | null = getDefaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(ASSIST_MODE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveStoredAssistMode(
  enabled: boolean,
  storage: StorageLike | null = getDefaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(ASSIST_MODE_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore
  }
}

export function clearStoredProfileKeys(
  storage: StorageLike | null = getDefaultStorage(),
): void {
  if (!storage) return;
  const keys = [
    PROFILE_STORAGE_KEY,
    LEGACY_PROFILE_STORAGE_KEY,
    ACT2_MODS_STORAGE_KEY,
    LEGACY_ACT2_MODS_STORAGE_KEY,
    ACT2_CUSTOM_PALETTE_KEY,
    LEGACY_ACT2_CUSTOM_PALETTE_KEY,
    ACT2_PB_GHOST_KEY,
    LEGACY_ACT2_PB_GHOST_KEY,
    PROGRESSION_LOCK_STORAGE_KEY,
    ASSIST_MODE_STORAGE_KEY,
  ];
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      // ignore
    }
  }
}
