import type { AudioCueId } from '../contracts/audio';
import { ALL_AUDIO_CUE_IDS, ALL_STEM_IDS } from './stem-matrix';

export const SYNTH_BPM = 140;
export const SYNTH_BARS = 4;
export const SYNTH_BEATS_PER_BAR = 4;
export const SYNTH_LOOP_DURATION_SEC =
  (SYNTH_BARS * SYNTH_BEATS_PER_BAR * 60) / SYNTH_BPM;

const DEFAULT_SAMPLE_RATE = 44100;
const TWO_PI = Math.PI * 2;

function getContextSampleRate(ctx: BaseAudioContext): number {
  return Number.isFinite(ctx.sampleRate) && ctx.sampleRate > 0
    ? ctx.sampleRate
    : DEFAULT_SAMPLE_RATE;
}

export function getStemLoopSampleCount(sampleRate: number): number {
  return Math.max(1, Math.round(sampleRate * SYNTH_LOOP_DURATION_SEC));
}

function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function sawWave(phase01: number): number {
  return 2 * (phase01 - Math.floor(phase01)) - 1;
}

function squareWave(phase01: number, duty = 0.5): number {
  const frac = phase01 - Math.floor(phase01);
  return frac < duty ? 1 : -1;
}

function triangleWave(phase01: number): number {
  const frac = phase01 - Math.floor(phase01);
  return 1 - 4 * Math.abs(frac - 0.5);
}

function applyLoopBoundaryFade(data: Float32Array, sampleRate: number): void {
  const fadeSamples = Math.min(
    Math.floor(data.length / 4),
    Math.max(8, Math.round(sampleRate * 0.003)),
  );
  for (let i = 0; i < fadeSamples; i++) {
    const gain = i / fadeSamples;
    data[i] = (data[i] ?? 0) * gain;
    const tailIdx = data.length - 1 - i;
    data[tailIdx] = (data[tailIdx] ?? 0) * gain;
  }
}

function softLimitBuffer(data: Float32Array, maxAmp = 0.85): void {
  for (let i = 0; i < data.length; i++) {
    const x = data[i] ?? 0;
    data[i] = Math.tanh(x) * maxAmp;
  }
}

function fillBassStem(
  data: Float32Array,
  sampleRate: number,
  variant: 1 | 2 | 3 | 4 | 5,
): void {
  const beatSec = 60 / SYNTH_BPM;
  const stepSec = beatSec / 2; // 8th-note grid (32 steps across 4 bars)

  // D harmonic minor bass patterns (MIDI notes)
  const patterns: Record<1 | 2 | 3 | 4 | 5, readonly number[]> = {
    1: [38, 38, 50, 38, 41, 41, 43, 45, 46, 46, 45, 43, 41, 40, 38, 45],
    2: [38, 38, 38, 38, 41, 41, 43, 43, 46, 46, 45, 45, 38, 38, 45, 45],
    3: [38, 50, 38, 41, 38, 50, 43, 45, 46, 58, 45, 57, 43, 55, 41, 45],
    4: [38, 38, 38, 45, 38, 38, 46, 45, 38, 38, 41, 43, 45, 45, 49, 45],
    5: [38, 45, 41, 45, 43, 45, 46, 45, 41, 45, 43, 45, 38, 45, 49, 45],
  };
  const notes = patterns[variant];
  let phase = 0;
  let subPhase = 0;

  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    const stepIdx = Math.floor(t / stepSec);
    const localStepT = t - stepIdx * stepSec;
    const midi = notes[stepIdx % notes.length] ?? 38;
    const freq = midiToFreq(midi);

    phase += freq / sampleRate;
    subPhase += (freq * 0.5) / sampleRate;

    const env = Math.exp(-localStepT * (variant === 3 ? 11 : 6.5));
    const gate = localStepT < stepSec * 0.9 ? 1 : 0.15;

    let sample = 0;
    if (variant === 1) {
      sample = (sawWave(phase) * 0.55 + squareWave(subPhase, 0.5) * 0.45) * env * gate;
    } else if (variant === 2) {
      sample = (squareWave(phase, 0.5) * 0.65 + Math.sin(TWO_PI * subPhase) * 0.5) * gate;
    } else if (variant === 3) {
      const fm = Math.sin(TWO_PI * phase * 2) * env * 1.4;
      sample = Math.sin(TWO_PI * phase + fm) * 0.7 * env + sawWave(subPhase) * 0.3;
    } else if (variant === 4) {
      const detune = sawWave(phase * 1.006);
      sample = (sawWave(phase) * 0.5 + detune * 0.45 + Math.sin(TWO_PI * subPhase) * 0.4) * 0.7;
    } else {
      sample = (triangleWave(phase) * 0.6 + squareWave(phase, 0.25) * 0.4) * env * gate;
    }

    data[i] = sample * 0.65;
  }
}

function fillDrumStem(
  data: Float32Array,
  sampleRate: number,
  variant: 1 | 2 | 3 | 4 | 5 | 'alarm',
): void {
  const beatSec = 60 / SYNTH_BPM;
  const stepSec = beatSec / 4; // 16th-note grid (64 steps across 4 bars)
  const rng = createPrng(
    variant === 'alarm' ? 9909 : 3100 + variant * 137,
  );

  // 16-step masks per bar (k = kick, s = snare, h = hat, a = alarm ping)
  const kickMasks: Record<1 | 2 | 3 | 4 | 5 | 'alarm', readonly number[]> = {
    1: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0],
    2: [1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1],
    3: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1],
    4: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    5: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0],
    alarm: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1],
  };

  const snareMasks: Record<1 | 2 | 3 | 4 | 5 | 'alarm', readonly number[]> = {
    1: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    2: [0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 0],
    3: [0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1],
    4: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1],
    5: [0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0],
    alarm: [0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1],
  };

  const kickMask = kickMasks[variant];
  const snareMask = snareMasks[variant];

  let prevStep = -1;
  let kickT = 10;
  let snareT = 10;
  let hatT = 10;
  let kickPhase = 0;

  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    const step = Math.floor(t / stepSec);
    if (step !== prevStep) {
      prevStep = step;
      const barStep = step % 16;
      if ((kickMask[barStep] ?? 0) > 0) {
        kickT = 0;
        kickPhase = 0;
      }
      if ((snareMask[barStep] ?? 0) > 0) {
        snareT = 0;
      }
      if (variant === 2 || variant === 'alarm' || step % 2 === 0) {
        hatT = 0;
      }
    }

    const dt = 1 / sampleRate;
    kickT += dt;
    snareT += dt;
    hatT += dt;

    let sample = 0;

    // Kick synthesis (exponential pitch drop)
    if (kickT < 0.16) {
      const baseHz = variant === 4 ? 46 : 55;
      const sweepHz = baseHz + 120 * Math.exp(-kickT * 42);
      kickPhase += sweepHz * dt;
      const kickEnv = Math.exp(-kickT * (variant === 4 ? 16 : 22));
      sample += Math.sin(TWO_PI * kickPhase) * kickEnv * 0.9;
    }

    // Snare synthesis (body tone + noise burst)
    if (snareT < 0.14) {
      const noise = rng() * 2 - 1;
      const tone = Math.sin(TWO_PI * 185 * snareT) * Math.exp(-snareT * 38);
      const snareEnv = Math.exp(-snareT * 26);
      sample += (noise * 0.55 + tone * 0.45) * snareEnv * 0.65;
    }

    // Hi-hat synthesis
    if (hatT < 0.045) {
      const noise = rng() * 2 - 1;
      const hatEnv = Math.exp(-hatT * (variant === 5 ? 48 : 85));
      sample += noise * hatEnv * 0.22;
    }

    // Alarm klaxon pulse on 8th notes when alarm stem is active
    if (variant === 'alarm') {
      const eighthPhase = (t / (beatSec / 2)) % 1;
      const pulseEnv = eighthPhase < 0.45 ? 1 - eighthPhase / 0.45 : 0;
      const toneA = squareWave(t * 880, 0.3);
      const toneB = squareWave(t * 932.33, 0.3);
      sample += (toneA * 0.5 + toneB * 0.5) * pulseEnv * 0.35;
    }

    data[i] = sample;
  }
}

function fillLeadStem(
  data: Float32Array,
  sampleRate: number,
  variant: 1 | 2 | 3 | 4 | 5,
): void {
  const beatSec = 60 / SYNTH_BPM;
  const stepSec = beatSec / 2; // 8th-note melody grid

  const melodies: Record<1 | 2 | 3 | 4 | 5, readonly number[]> = {
    1: [62, 65, 69, 70, 69, 67, 65, 64, 62, 65, 69, 74, 73, 74, 69, 64],
    2: [74, 69, 65, 74, 73, 69, 64, 73, 70, 65, 62, 70, 69, 64, 61, 69],
    3: [62, 62, 69, 69, 70, 69, 65, 64, 67, 67, 74, 74, 73, 69, 65, 64],
    4: [62, 74, 65, 77, 69, 81, 67, 79, 65, 77, 64, 76, 62, 74, 61, 73],
    5: [50, 50, 53, 57, 58, 57, 55, 53, 50, 50, 53, 57, 56, 57, 52, 49],
  };

  const notes = melodies[variant];
  let phase = 0;
  let fifthPhase = 0;

  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    const stepIdx = Math.floor(t / stepSec);
    const localT = t - stepIdx * stepSec;
    const midi = notes[stepIdx % notes.length] ?? 62;
    const vibrato = 1 + 0.004 * Math.sin(TWO_PI * 6 * t);
    const freq = midiToFreq(midi) * vibrato;

    phase += freq / sampleRate;
    fifthPhase += (freq * 1.498) / sampleRate;

    const attack = Math.min(1, localT / 0.008);
    const decay = Math.exp(-localT * (variant === 2 ? 7 : 4.2));
    const env = attack * decay;

    let sample = 0;
    if (variant === 1) {
      sample = (squareWave(phase, 0.25) * 0.65 + sawWave(phase * 0.5) * 0.35) * env;
    } else if (variant === 2) {
      const fm = Math.sin(TWO_PI * phase * 3) * 1.6 * decay;
      sample = Math.sin(TWO_PI * phase + fm) * env;
    } else if (variant === 3) {
      sample = (squareWave(phase, 0.5) * 0.5 + squareWave(fifthPhase, 0.5) * 0.35) * env;
    } else if (variant === 4) {
      sample = (sawWave(phase) * 0.6 + triangleWave(phase * 2) * 0.4) * env;
    } else {
      sample = (sawWave(phase) * 0.7 + squareWave(phase * 0.5, 0.5) * 0.4) * env;
    }

    data[i] = sample * 0.55;
  }
}

function fillHangarStem(data: Float32Array, sampleRate: number): void {
  const beatSec = 60 / SYNTH_BPM;
  let p1 = 0;
  let p2 = 0;
  let p3 = 0;

  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    // Warm D-minor atmospheric pad + slow radar pulse every 2 beats
    const f1 = midiToFreq(38);
    const f2 = midiToFreq(45);
    const f3 = midiToFreq(53);
    p1 += f1 / sampleRate;
    p2 += f2 / sampleRate;
    p3 += f3 / sampleRate;

    const padLfo = 0.65 + 0.35 * Math.sin(TWO_PI * (t / SYNTH_LOOP_DURATION_SEC) * 2);
    const pad =
      (Math.sin(TWO_PI * p1) * 0.5 +
        triangleWave(p2) * 0.28 +
        Math.sin(TWO_PI * p3) * 0.22) *
      padLfo;

    const pulsePos = (t / (beatSec * 2)) % 1;
    const ping = Math.sin(TWO_PI * 587.33 * t) * Math.exp(-pulsePos * 14) * 0.16;
    data[i] = pad * 0.45 + ping;
  }
}

function fillPauseStem(data: Float32Array, sampleRate: number): void {
  const beatSec = 60 / SYNTH_BPM;
  let p1 = 0;
  let p2 = 0;

  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    p1 += midiToFreq(50) / sampleRate;
    p2 += midiToFreq(57) / sampleRate;
    const beatPhase = (t / beatSec) % 1;
    const pulse = 0.3 + 0.7 * Math.exp(-beatPhase * 5);
    data[i] = (Math.sin(TWO_PI * p1) * 0.6 + triangleWave(p2) * 0.4) * pulse * 0.35;
  }
}

function fillUnknownStem(data: Float32Array, sampleRate: number): void {
  const stepSec = 60 / SYNTH_BPM / 4;
  const rng = createPrng(55555);
  let phase = 0;
  let lastStep = -1;
  let stepFreq = 146.83;

  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    const step = Math.floor(t / stepSec);
    if (step !== lastStep) {
      lastStep = step;
      const semitones = Math.floor(rng() * 14) - 6;
      stepFreq = midiToFreq(50 + semitones);
    }
    phase += stepFreq / sampleRate;
    const mod = Math.sin(TWO_PI * 3.5 * t) * 2.1;
    const glitch = Math.sin(TWO_PI * phase + mod) * 0.5 + squareWave(phase * 0.5, 0.2) * 0.3;
    data[i] = glitch * 0.45;
  }
}

function fillUrauserStem(data: Float32Array, sampleRate: number): void {
  const len = data.length;
  const bass = new Float32Array(len);
  const drums = new Float32Array(len);
  const lead = new Float32Array(len);

  fillBassStem(bass, sampleRate, 3);
  fillDrumStem(drums, sampleRate, 2);
  fillLeadStem(lead, sampleRate, 4);

  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const octave = sawWave(t * midiToFreq(62)) * 0.18;
    data[i] = (bass[i] ?? 0) * 0.6 + (drums[i] ?? 0) * 0.7 + (lead[i] ?? 0) * 0.65 + octave;
  }
}

/**
 * Synthesizes a single phase-locked looping 4-bar 140 BPM music stem `AudioBuffer`
 * directly via `BaseAudioContext.createBuffer` (zero external files).
 */
export function synthesizeMusicStem(
  ctx: BaseAudioContext,
  stemId: string,
): AudioBuffer {
  const sampleRate = getContextSampleRate(ctx);
  const length = getStemLoopSampleCount(sampleRate);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  if (stemId.startsWith('luftrauser_bass')) {
    const variant = Number(stemId.slice('luftrauser_bass'.length));
    const clamped = (variant >= 1 && variant <= 5 ? variant : 1) as 1 | 2 | 3 | 4 | 5;
    fillBassStem(data, sampleRate, clamped);
  } else if (stemId === 'luftrauser_drums_alarm') {
    fillDrumStem(data, sampleRate, 'alarm');
  } else if (stemId.startsWith('luftrauser_drums')) {
    const variant = Number(stemId.slice('luftrauser_drums'.length));
    const clamped = (variant >= 1 && variant <= 5 ? variant : 1) as 1 | 2 | 3 | 4 | 5;
    fillDrumStem(data, sampleRate, clamped);
  } else if (stemId.startsWith('luftrauser_lead')) {
    const variant = Number(stemId.slice('luftrauser_lead'.length));
    const clamped = (variant >= 1 && variant <= 5 ? variant : 1) as 1 | 2 | 3 | 4 | 5;
    fillLeadStem(data, sampleRate, clamped);
  } else if (stemId === 'luftrauser__hangar') {
    fillHangarStem(data, sampleRate);
  } else if (stemId === 'luftrauser__pause') {
    fillPauseStem(data, sampleRate);
  } else if (stemId === 'luftrauser__unknown') {
    fillUnknownStem(data, sampleRate);
  } else if (stemId === 'luftrauser__urauser') {
    fillUrauserStem(data, sampleRate);
  } else {
    fillPauseStem(data, sampleRate);
  }

  softLimitBuffer(data, 0.85);
  applyLoopBoundaryFade(data, sampleRate);
  return buffer;
}

type SfxSynthesizer = (data: Float32Array, sampleRate: number) => void;

interface SfxRecipe {
  durationSec: number;
  synth: SfxSynthesizer;
}

function makeSweepRecipe(
  durationSec: number,
  startHz: number,
  endHz: number,
  wave: 'square' | 'saw' | 'sine' | 'tri',
  noiseMix: number,
  decayRate: number,
  seed: number,
  gain = 0.7,
): SfxRecipe {
  return {
    durationSec,
    synth: (data, sampleRate) => {
      const rng = createPrng(seed);
      let phase = 0;
      const dur = data.length / sampleRate;
      for (let i = 0; i < data.length; i++) {
        const t = i / sampleRate;
        const u = dur > 0 ? t / dur : 0;
        const hz = startHz + (endHz - startHz) * u;
        phase += hz / sampleRate;
        const osc =
          wave === 'square'
            ? squareWave(phase)
            : wave === 'saw'
              ? sawWave(phase)
              : wave === 'tri'
                ? triangleWave(phase)
                : Math.sin(TWO_PI * phase);
        const noise = rng() * 2 - 1;
        const env = Math.exp(-u * decayRate) * Math.min(1, t / 0.002);
        const tailFade = u > 0.85 ? (1 - u) / 0.15 : 1;
        data[i] = (osc * (1 - noiseMix) + noise * noiseMix) * env * tailFade * gain;
      }
    },
  };
}

function makeArpRecipe(
  notesHz: readonly number[],
  noteDurSec: number,
  wave: 'square' | 'saw' | 'sine' | 'tri',
  gain = 0.6,
): SfxRecipe {
  return {
    durationSec: notesHz.length * noteDurSec,
    synth: (data, sampleRate) => {
      let phase = 0;
      for (let i = 0; i < data.length; i++) {
        const t = i / sampleRate;
        const noteIdx = Math.min(notesHz.length - 1, Math.floor(t / noteDurSec));
        const localT = t - noteIdx * noteDurSec;
        const hz = notesHz[noteIdx] ?? 440;
        if (hz <= 0) {
          data[i] = 0;
          continue;
        }
        phase += hz / sampleRate;
        const osc =
          wave === 'square'
            ? squareWave(phase, 0.35)
            : wave === 'saw'
              ? sawWave(phase)
              : wave === 'tri'
                ? triangleWave(phase)
                : Math.sin(TWO_PI * phase);
        const env = Math.exp(-localT * 14) * Math.min(1, localT / 0.002);
        data[i] = osc * env * gain;
      }
    },
  };
}

const SFX_RECIPES: Record<AudioCueId, SfxRecipe> = {
  sndacespawn: makeSweepRecipe(0.38, 220, 920, 'saw', 0.25, 3.0, 101, 0.72),
  sndacespawndist: makeSweepRecipe(0.32, 200, 740, 'sine', 0.18, 3.6, 102, 0.48),
  sndadd1: makeArpRecipe([523.25, 659.25], 0.055, 'square', 0.5),
  sndadd2: makeArpRecipe([659.25, 783.99], 0.055, 'square', 0.52),
  sndadd3: makeArpRecipe([783.99, 1046.5], 0.06, 'square', 0.55),
  sndboatdie: makeSweepRecipe(0.45, 160, 38, 'saw', 0.65, 4.2, 106, 0.8),
  sndboost: makeSweepRecipe(0.24, 95, 220, 'saw', 0.7, 3.2, 107, 0.65),
  sndbullet: makeSweepRecipe(0.06, 680, 140, 'square', 0.3, 6.0, 108, 0.55),
  sndcannon: makeSweepRecipe(0.22, 280, 48, 'saw', 0.45, 5.2, 109, 0.8),
  sndcannonexplo: makeSweepRecipe(0.38, 170, 32, 'saw', 0.72, 4.5, 110, 0.85),
  sndcannonfail: makeSweepRecipe(0.08, 240, 110, 'tri', 0.2, 7.0, 111, 0.45),
  sndcannonreload: makeArpRecipe([330, 440, 660], 0.045, 'tri', 0.5),
  sndcombodrop: makeArpRecipe([392, 261.63], 0.11, 'saw', 0.55),
  sndcombowarn: makeArpRecipe([880, 0, 880], 0.055, 'square', 0.48),
  snddeny: makeArpRecipe([164.81, 146.83], 0.08, 'square', 0.5),
  sndebullet: makeSweepRecipe(0.075, 540, 190, 'saw', 0.15, 5.5, 116, 0.5),
  sndebulletdist: makeSweepRecipe(0.075, 440, 170, 'sine', 0.12, 6.0, 117, 0.34),
  sndebullet2: makeSweepRecipe(0.085, 760, 260, 'square', 0.2, 5.5, 118, 0.5),
  sndebullet2dist: makeSweepRecipe(0.085, 620, 230, 'sine', 0.15, 6.0, 119, 0.34),
  sndexplom: makeSweepRecipe(0.32, 190, 40, 'saw', 0.75, 5.0, 120, 0.78),
  sndgungine: makeSweepRecipe(0.09, 420, 95, 'saw', 0.5, 5.2, 121, 0.6),
  sndhangar: makeSweepRecipe(0.18, 140, 65, 'tri', 0.35, 5.0, 122, 0.55),
  sndheal: makeArpRecipe([659.25, 830.61], 0.045, 'sine', 0.42),
  sndhealed: makeArpRecipe([587.33, 739.99, 880, 1174.66], 0.055, 'tri', 0.55),
  sndhit1: makeSweepRecipe(0.07, 320, 90, 'square', 0.45, 7.0, 125, 0.55),
  sndhit2: makeSweepRecipe(0.07, 380, 105, 'square', 0.45, 7.0, 126, 0.55),
  sndhit3: makeSweepRecipe(0.07, 450, 120, 'square', 0.45, 7.0, 127, 0.55),
  sndhit4: makeSweepRecipe(0.07, 520, 140, 'square', 0.45, 7.0, 128, 0.55),
  sndjetdie: makeSweepRecipe(0.36, 620, 55, 'saw', 0.65, 4.4, 129, 0.75),
  sndlaser: makeSweepRecipe(0.09, 980, 860, 'saw', 0.12, 2.5, 130, 0.48),
  sndlaunch: makeSweepRecipe(0.45, 80, 340, 'saw', 0.6, 2.8, 131, 0.78),
  sndmaxcombo: makeArpRecipe([587.33, 739.99, 880, 1174.66, 1479.98], 0.06, 'square', 0.6),
  sndmessage: makeArpRecipe([783.99, 1046.5], 0.04, 'sine', 0.45),
  sndmisempty: makeSweepRecipe(0.045, 360, 180, 'tri', 0.25, 8.0, 134, 0.45),
  sndmissile: makeSweepRecipe(0.24, 240, 620, 'saw', 0.62, 3.8, 135, 0.62),
  sndmisspawn: makeSweepRecipe(0.16, 420, 780, 'square', 0.4, 4.8, 136, 0.52),
  sndmisspawndist: makeSweepRecipe(0.15, 360, 620, 'sine', 0.3, 5.2, 137, 0.35),
  sndmove: makeSweepRecipe(0.035, 520, 660, 'square', 0.05, 7.5, 138, 0.42),
  sndnuke: makeSweepRecipe(0.85, 180, 24, 'saw', 0.8, 2.9, 139, 0.9),
  sndplanedie: makeSweepRecipe(0.32, 340, 48, 'saw', 0.7, 4.6, 140, 0.75),
  sndplayerdie: makeSweepRecipe(0.62, 260, 28, 'saw', 0.75, 3.4, 141, 0.85),
  sndplayerhit: makeSweepRecipe(0.16, 280, 58, 'square', 0.55, 5.5, 142, 0.72),
  sndpopup: makeArpRecipe([523.25, 659.25, 783.99], 0.06, 'tri', 0.55),
  sndprojector: makeSweepRecipe(0.04, 800, 320, 'tri', 0.4, 8.0, 144, 0.38),
  sndprojectorstart: makeSweepRecipe(0.26, 90, 260, 'tri', 0.5, 3.2, 145, 0.5),
  sndsfmt: makeSweepRecipe(0.42, 110, 55, 'saw', 0.4, 3.0, 146, 0.78),
  sndsplashl: makeSweepRecipe(0.34, 420, 110, 'sine', 0.9, 4.5, 147, 0.68),
  sndsplashm: makeSweepRecipe(0.18, 520, 160, 'sine', 0.85, 5.5, 148, 0.55),
  sndspread: makeSweepRecipe(0.14, 360, 75, 'saw', 0.65, 5.5, 149, 0.68),
  sndswap: makeArpRecipe([440, 587.33], 0.035, 'square', 0.45),
  snduboost: makeSweepRecipe(0.22, 130, 180, 'sine', 0.45, 3.5, 151, 0.58),
  sndunboost: makeSweepRecipe(0.14, 240, 85, 'tri', 0.35, 5.5, 152, 0.48),
};

/**
 * Synthesizes a clean-room procedural SFX `AudioBuffer` for any `AudioCueId`.
 */
export function synthesizeSfxCue(
  ctx: BaseAudioContext,
  cue: AudioCueId,
): AudioBuffer {
  const sampleRate = getContextSampleRate(ctx);
  const recipe = SFX_RECIPES[cue];
  const length = Math.max(1, Math.round(sampleRate * recipe.durationSec));
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  recipe.synth(data, sampleRate);
  softLimitBuffer(data, 0.9);
  return buffer;
}

export interface SynthFallbackBank {
  stems: Map<string, AudioBuffer>;
  sfx: Map<AudioCueId, AudioBuffer>;
}

/**
 * Pre-synthesizes all 20 looping music stems (exact shared 4-bar 140 BPM duration)
 * and all 52 procedural SFX cues using `BaseAudioContext.createBuffer`.
 */
export function createSynthFallbackBank(
  ctx: BaseAudioContext,
): SynthFallbackBank {
  const stems = new Map<string, AudioBuffer>();
  for (const stemId of ALL_STEM_IDS) {
    stems.set(stemId, synthesizeMusicStem(ctx, stemId));
  }

  const sfx = new Map<AudioCueId, AudioBuffer>();
  for (const cueId of ALL_AUDIO_CUE_IDS) {
    sfx.set(cueId, synthesizeSfxCue(ctx, cueId));
  }

  return { stems, sfx };
}
