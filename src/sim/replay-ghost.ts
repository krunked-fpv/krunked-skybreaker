import { DEFAULT_ACT2_MOD_FLAGS, type Act2ModFlags, type MultiplayerMode } from '../contracts/mod';
import type {
  GameMode,
  GhostPose,
  Loadout,
  PartIndex,
  ReplayFrame,
  ReplayRecording,
} from '../contracts/sim';
import type { GameDataBundle } from '../contracts/vault';
import { ModRegistry } from './mod-registry';
import { Simulation, decodeInputMask } from './simulation';

const MAX_REPLAY_FRAMES = 360000;
const MAX_REPLAY_JSON_BYTES = 20_000_000;
const GHOST_TRAIL_LENGTH = 20;
const VALID_MODES: readonly GameMode[] = ['normal', 'sfmt'];
const VALID_MULTIPLAYER_MODES: readonly MultiplayerMode[] = ['solo', 'coop2p', 'dogfight1v1'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPartIndex(value: unknown): value is PartIndex {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 8;
}

function validateModFlags(raw: unknown): Act2ModFlags | null {
  if (!isPlainObject(raw)) return null;
  const {
    moddedEnabled,
    arsenalBosses,
    replayGhost,
    dailySeed,
    shaderFx,
    multiplayerMode,
    p2BotEnabled,
  } = raw;

  if (
    typeof moddedEnabled !== 'boolean' ||
    typeof arsenalBosses !== 'boolean' ||
    typeof replayGhost !== 'boolean' ||
    typeof dailySeed !== 'boolean' ||
    typeof p2BotEnabled !== 'boolean'
  ) {
    return null;
  }
  if (
    typeof multiplayerMode !== 'string' ||
    !VALID_MULTIPLAYER_MODES.includes(multiplayerMode as MultiplayerMode)
  ) {
    return null;
  }
  if (!isPlainObject(shaderFx)) {
    return null;
  }
  if (
    typeof shaderFx.crtScanlines !== 'boolean' ||
    typeof shaderFx.phosphorBloom !== 'boolean' ||
    typeof shaderFx.speedWarp !== 'boolean' ||
    typeof shaderFx.shockwaves !== 'boolean'
  ) {
    return null;
  }

  return {
    moddedEnabled,
    arsenalBosses,
    replayGhost,
    dailySeed,
    shaderFx: {
      crtScanlines: shaderFx.crtScanlines,
      phosphorBloom: shaderFx.phosphorBloom,
      speedWarp: shaderFx.speedWarp,
      shockwaves: shaderFx.shockwaves,
    },
    multiplayerMode: multiplayerMode as MultiplayerMode,
    p2BotEnabled,
  };
}

/**
 * Computes a deterministic UTC `YYYYMMDD` date identifier and stable 32-bit non-zero seed.
 */
export function computeDailySeed(date?: Date): { dateId: string; seed: number } {
  const d =
    date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = String(d.getUTCFullYear()).padStart(4, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const dateId = `${year}${month}${day}`;

  // FNV-1a 32-bit hash + Murmur3 finalizer avalanche for wide seed dispersion
  const key = `SKYBREAKER_DAILY:${dateId}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;

  const seed = (hash >>> 0) || 0x9e3779b9;
  return { dateId, seed };
}

/**
 * Serializes a ReplayRecording to canonical JSON.
 */
export function serializeReplay(recording: ReplayRecording): string {
  const canonical: ReplayRecording = {
    seed: recording.seed >>> 0,
    mode: recording.mode,
    loadout: {
      weapon: recording.loadout.weapon,
      body: recording.loadout.body,
      engine: recording.loadout.engine,
    },
    profileId: recording.profileId,
    frames: recording.frames.map((f) => ({ tick: f.tick, mask: f.mask })),
    finalScore: recording.finalScore,
    finalTicks: recording.finalTicks,
    ...(recording.version !== undefined ? { version: recording.version } : {}),
    ...(recording.modFlags !== undefined
      ? {
          modFlags: {
            ...recording.modFlags,
            shaderFx: { ...recording.modFlags.shaderFx },
          },
        }
      : {}),
    ...(recording.dailyDateId !== undefined
      ? { dailyDateId: recording.dailyDateId }
      : {}),
    ...(recording.planeName !== undefined ? { planeName: recording.planeName } : {}),
  };
  return JSON.stringify(canonical);
}

/**
 * Strictly parses and validates a serialized ReplayRecording JSON string.
 * Rejects malformed JSON, non-finite numbers, negative ticks, out-of-range masks/parts,
 * and oversized recordings (> 360000 frames), returning `null` without throwing.
 */
export function parseReplayJson(raw: string): ReplayRecording | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_REPLAY_JSON_BYTES) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed)) {
    return null;
  }

  const {
    seed,
    mode,
    loadout,
    profileId,
    frames,
    finalScore,
    finalTicks,
    version,
    modFlags,
    dailyDateId,
    planeName,
  } = parsed;

  if (
    typeof seed !== 'number' ||
    !Number.isFinite(seed) ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff
  ) {
    return null;
  }

  if (typeof mode !== 'string' || !VALID_MODES.includes(mode as GameMode)) {
    return null;
  }

  if (typeof profileId !== 'string' || profileId.length === 0) {
    return null;
  }

  if (!isPlainObject(loadout)) {
    return null;
  }
  if (!isPartIndex(loadout.weapon) || !isPartIndex(loadout.body) || !isPartIndex(loadout.engine)) {
    return null;
  }
  const cleanLoadout: Loadout = {
    weapon: loadout.weapon,
    body: loadout.body,
    engine: loadout.engine,
  };

  if (typeof finalScore !== 'number' || !Number.isFinite(finalScore) || finalScore < 0) {
    return null;
  }

  if (
    typeof finalTicks !== 'number' ||
    !Number.isFinite(finalTicks) ||
    !Number.isInteger(finalTicks) ||
    finalTicks < 0 ||
    finalTicks > MAX_REPLAY_FRAMES
  ) {
    return null;
  }

  if (!Array.isArray(frames) || frames.length > MAX_REPLAY_FRAMES) {
    return null;
  }

  const cleanFrames: ReplayFrame[] = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (!isPlainObject(f)) {
      return null;
    }
    const tick = f.tick;
    const mask = f.mask;
    if (
      typeof tick !== 'number' ||
      !Number.isFinite(tick) ||
      !Number.isInteger(tick) ||
      tick < 0 ||
      tick > MAX_REPLAY_FRAMES
    ) {
      return null;
    }
    if (
      typeof mask !== 'number' ||
      !Number.isFinite(mask) ||
      !Number.isInteger(mask) ||
      mask < 0 ||
      mask > 15
    ) {
      return null;
    }
    cleanFrames.push({ tick, mask });
  }

  let cleanVersion: number | undefined;
  if (version !== undefined) {
    if (typeof version !== 'number' || !Number.isFinite(version) || !Number.isInteger(version) || version < 1) {
      return null;
    }
    cleanVersion = version;
  }

  let cleanModFlags: Act2ModFlags | undefined;
  if (modFlags !== undefined) {
    const validated = validateModFlags(modFlags);
    if (!validated) {
      return null;
    }
    cleanModFlags = validated;
  }

  let cleanDailyDateId: string | null | undefined;
  if (dailyDateId !== undefined) {
    if (dailyDateId !== null && typeof dailyDateId !== 'string') {
      return null;
    }
    cleanDailyDateId = dailyDateId;
  }

  let cleanPlaneName: string | undefined;
  if (planeName !== undefined) {
    if (typeof planeName !== 'string') {
      return null;
    }
    cleanPlaneName = planeName;
  }

  return {
    seed,
    mode: mode as GameMode,
    loadout: cleanLoadout,
    profileId,
    frames: cleanFrames,
    finalScore,
    finalTicks,
    ...(cleanVersion !== undefined ? { version: cleanVersion } : {}),
    ...(cleanModFlags !== undefined ? { modFlags: cleanModFlags } : {}),
    ...(cleanDailyDateId !== undefined ? { dailyDateId: cleanDailyDateId } : {}),
    ...(cleanPlaneName !== undefined ? { planeName: cleanPlaneName } : {}),
  };
}

/**
 * Isolated deterministic Ghost replay runner.
 * Steps a private Simulation instance with its own SeededRng so live sim PRNG is never touched,
 * lazily caching poses up to each sampled tick with a 20-point trailing breadcrumb trail.
 */
export class GhostRunner {
  private readonly sim: Simulation;
  private readonly frameMaskByTick = new Map<number, number>();
  private readonly maxTick: number;
  private readonly poses: GhostPose[] = [];
  private readonly trailPoints: { x: number; y: number }[] = [];

  constructor(data: GameDataBundle, recording: ReplayRecording) {
    const hasCustomSlots =
      recording.loadout.weapon >= 6 ||
      recording.loadout.body >= 6 ||
      recording.loadout.engine >= 6;
    const needsModded = Boolean(recording.modFlags?.moddedEnabled || hasCustomSlots);

    const isolatedRegistry = new ModRegistry(!needsModded);
    this.sim = new Simulation(data, isolatedRegistry);

    if (needsModded) {
      const effectiveFlags: Act2ModFlags = {
        ...DEFAULT_ACT2_MOD_FLAGS,
        ...(recording.modFlags ?? {}),
        moddedEnabled: true,
        arsenalBosses: Boolean(recording.modFlags?.arsenalBosses || hasCustomSlots),
        replayGhost: false,
        dailySeed: false,
      };
      this.sim.setModFlags(effectiveFlags);
    }

    let highestFrameTick = 0;
    for (const f of recording.frames) {
      if (f.tick >= 0 && f.tick <= MAX_REPLAY_FRAMES) {
        this.frameMaskByTick.set(f.tick, f.mask);
        if (f.tick > highestFrameTick) {
          highestFrameTick = f.tick;
        }
      }
    }

    this.maxTick = Math.min(
      MAX_REPLAY_FRAMES,
      Math.max(recording.frames.length, recording.finalTicks || 0, highestFrameTick),
    );

    this.sim.launch(recording.loadout, recording.mode, recording.seed);
    const initSnap = this.sim.getSnapshot();
    this.recordPoseFromSnapshot(initSnap);
  }

  private recordPoseFromSnapshot(snap: ReturnType<Simulation['getSnapshot']>): void {
    this.trailPoints.push({ x: snap.player.x, y: snap.player.y });
    if (this.trailPoints.length > GHOST_TRAIL_LENGTH) {
      this.trailPoints.shift();
    }
    this.poses.push({
      x: snap.player.x,
      y: snap.player.y,
      angleDeg: snap.player.angleDeg,
      boosting: snap.player.boosting,
      alive: snap.player.alive,
      loadout: { ...snap.player.loadout },
      trail: this.trailPoints.map((pt) => ({ ...pt })),
      scoreAtTick: snap.score,
    });
  }

  sampleAtTick(tick: number): GhostPose | null {
    if (!Number.isFinite(tick) || tick < 0) {
      return null;
    }
    const targetTick = Math.floor(tick);
    if (targetTick > this.maxTick) {
      return null;
    }

    while (this.poses.length <= targetTick) {
      const nextTick = this.poses.length;
      const mask = this.frameMaskByTick.get(nextTick) ?? 0;
      const snap = this.sim.step(decodeInputMask(mask));
      this.recordPoseFromSnapshot(snap);
    }

    const pose = this.poses[targetTick];
    if (!pose) {
      return null;
    }
    return {
      ...pose,
      loadout: { ...pose.loadout },
      trail: pose.trail.map((pt) => ({ ...pt })),
    };
  }
}
