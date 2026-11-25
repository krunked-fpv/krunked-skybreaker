import type { AudioCueId, MusicState } from '../contracts/audio';
import type { Loadout, PartIndex, SimPhase } from '../contracts/sim';

export const LOW_HP_ALARM_THRESHOLD = 0.333333;
export const SPATIAL_OFFSCREEN_THRESHOLD = 300;
export const SPATIAL_ATTENUATION_START = 200;
export const SPATIAL_ATTENUATION_SPAN = 900;
export const SPATIAL_MIN_GAIN = 0.2;
export const SPATIAL_PAN_DIVISOR = 380;
export const SPATIAL_PAN_CLAMP = 0.85;

export const ALL_STEM_IDS = [
  'luftrauser_bass1',
  'luftrauser_bass2',
  'luftrauser_bass3',
  'luftrauser_bass4',
  'luftrauser_bass5',
  'luftrauser_drums1',
  'luftrauser_drums2',
  'luftrauser_drums3',
  'luftrauser_drums4',
  'luftrauser_drums5',
  'luftrauser_lead1',
  'luftrauser_lead2',
  'luftrauser_lead3',
  'luftrauser_lead4',
  'luftrauser_lead5',
  'luftrauser_drums_alarm',
  'luftrauser__hangar',
  'luftrauser__pause',
  'luftrauser__unknown',
  'luftrauser__urauser',
] as const;

export type StemId = (typeof ALL_STEM_IDS)[number];

export const ALL_AUDIO_CUE_IDS: readonly AudioCueId[] = [
  'sndacespawn',
  'sndacespawndist',
  'sndadd1',
  'sndadd2',
  'sndadd3',
  'sndboatdie',
  'sndboost',
  'sndbullet',
  'sndcannon',
  'sndcannonexplo',
  'sndcannonfail',
  'sndcannonreload',
  'sndcombodrop',
  'sndcombowarn',
  'snddeny',
  'sndebullet',
  'sndebullet2',
  'sndebullet2dist',
  'sndebulletdist',
  'sndexplom',
  'sndgungine',
  'sndhangar',
  'sndheal',
  'sndhealed',
  'sndhit1',
  'sndhit2',
  'sndhit3',
  'sndhit4',
  'sndjetdie',
  'sndlaser',
  'sndlaunch',
  'sndmaxcombo',
  'sndmessage',
  'sndmisempty',
  'sndmissile',
  'sndmisspawn',
  'sndmisspawndist',
  'sndmove',
  'sndnuke',
  'sndplanedie',
  'sndplayerdie',
  'sndplayerhit',
  'sndpopup',
  'sndprojector',
  'sndprojectorstart',
  'sndsfmt',
  'sndsplashl',
  'sndsplashm',
  'sndspread',
  'sndswap',
  'snduboost',
  'sndunboost',
];

const DIST_SFX_VARIANTS: Partial<Record<AudioCueId, AudioCueId>> = {
  sndacespawn: 'sndacespawndist',
  sndebullet: 'sndebulletdist',
  sndebullet2: 'sndebullet2dist',
  sndmisspawn: 'sndmisspawndist',
};

export interface StemResolution {
  musicState: MusicState;
  stems: string[];
  alarmActive: boolean;
}

export interface SpatialSfxResolution {
  resolvedCue: AudioCueId;
  pan: number;
  gain: number;
}

function clampPartToStemIndex(part: PartIndex): number {
  if (!Number.isFinite(part)) return 1;
  const normalized = Math.max(0, Math.trunc(part));
  return (normalized % 5) + 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Resolves the active Web Audio music state and stem IDs from simulation phase,
 * pause state, equipped loadout `(weapon, body, engine)`, and player HP ratio.
 */
export function resolveActiveStems(
  phase: SimPhase,
  paused: boolean,
  loadout: Loadout,
  healthRatio: number,
): StemResolution {
  if (paused) {
    return {
      musicState: 'pause',
      stems: ['luftrauser__pause'],
      alarmActive: false,
    };
  }

  if (phase === 'hangar') {
    return {
      musicState: 'hangar',
      stems: ['luftrauser__hangar'],
      alarmActive: false,
    };
  }

  const alarmActive =
    Number.isFinite(healthRatio) && healthRatio < LOW_HP_ALARM_THRESHOLD;

  const isUrauser =
    loadout.weapon === 5 && loadout.body === 5 && loadout.engine === 5;
  if (isUrauser) {
    const stems = ['luftrauser__urauser'];
    if (alarmActive) {
      stems.push('luftrauser_drums_alarm');
    }
    return {
      musicState: 'urauser',
      stems,
      alarmActive,
    };
  }

  const hasUnknownPart =
    loadout.weapon === 5 || loadout.body === 5 || loadout.engine === 5;
  if (hasUnknownPart) {
    return {
      musicState: 'unknown',
      stems: ['luftrauser__unknown'],
      alarmActive: false,
    };
  }

  const bassIdx = clampPartToStemIndex(loadout.body);
  const drumsIdx = clampPartToStemIndex(loadout.engine);
  const leadIdx = clampPartToStemIndex(loadout.weapon);
  const stems = [
    `luftrauser_bass${bassIdx}`,
    `luftrauser_drums${drumsIdx}`,
    `luftrauser_lead${leadIdx}`,
  ];
  if (alarmActive) {
    stems.push('luftrauser_drums_alarm');
  }

  return {
    musicState: 'combat',
    stems,
    alarmActive,
  };
}

/**
 * Resolves spatial panning, distance gain attenuation, and off-screen `*dist`
 * variant substitution for an audio cue.
 */
export function resolveSpatialSfx(
  cue: AudioCueId,
  worldX: number | undefined,
  listenerX: number | undefined,
): SpatialSfxResolution {
  if (
    worldX === undefined ||
    listenerX === undefined ||
    !Number.isFinite(worldX) ||
    !Number.isFinite(listenerX)
  ) {
    return {
      resolvedCue: cue,
      pan: 0,
      gain: 1,
    };
  }

  const dx = worldX - listenerX;
  const absDx = Math.abs(dx);
  const rawPan = dx === 0 ? 0 : clamp(dx / SPATIAL_PAN_DIVISOR, -SPATIAL_PAN_CLAMP, SPATIAL_PAN_CLAMP);
  const pan = Object.is(rawPan, -0) ? 0 : rawPan;

  if (absDx > SPATIAL_OFFSCREEN_THRESHOLD) {
    const resolvedCue = DIST_SFX_VARIANTS[cue] ?? cue;
    const gain = clamp(
      1 - (absDx - SPATIAL_ATTENUATION_START) / SPATIAL_ATTENUATION_SPAN,
      SPATIAL_MIN_GAIN,
      1,
    );
    return {
      resolvedCue,
      pan,
      gain,
    };
  }

  return {
    resolvedCue: cue,
    pan,
    gain: 1,
  };
}

/**
 * Computes exact modulo playback offset within a looping stem buffer relative to
 * the shared master `epochTime` so stems swapped mid-song stay phase-locked (< 1ms drift).
 */
export function computePhaseOffset(
  contextTime: number,
  epochTime: number,
  bufferDuration: number,
): number {
  if (
    !Number.isFinite(contextTime) ||
    !Number.isFinite(epochTime) ||
    !Number.isFinite(bufferDuration) ||
    bufferDuration <= 0
  ) {
    return 0;
  }

  const elapsed = contextTime - epochTime;
  if (elapsed <= 0) {
    return 0;
  }

  const offset = elapsed % bufferDuration;
  return offset >= bufferDuration ? 0 : offset;
}
