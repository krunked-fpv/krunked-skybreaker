export {
  ALL_AUDIO_CUE_IDS,
  ALL_STEM_IDS,
  LOW_HP_ALARM_THRESHOLD,
  SPATIAL_ATTENUATION_SPAN,
  SPATIAL_ATTENUATION_START,
  SPATIAL_MIN_GAIN,
  SPATIAL_OFFSCREEN_THRESHOLD,
  SPATIAL_PAN_CLAMP,
  SPATIAL_PAN_DIVISOR,
  computePhaseOffset,
  resolveActiveStems,
  resolveSpatialSfx,
  type SpatialSfxResolution,
  type StemId,
  type StemResolution,
} from './stem-matrix';

export {
  SYNTH_BARS,
  SYNTH_BEATS_PER_BAR,
  SYNTH_BPM,
  SYNTH_LOOP_DURATION_SEC,
  createSynthFallbackBank,
  getStemLoopSampleCount,
  synthesizeMusicStem,
  synthesizeSfxCue,
  type SynthFallbackBank,
} from './synth-fallback';

export { AudioEngine, type AudioEngineOptions } from './audio-engine';

export type {
  AudioCueId,
  AudioSyncMetrics,
  IAudioEngine,
  MusicState,
} from '../contracts/audio';
