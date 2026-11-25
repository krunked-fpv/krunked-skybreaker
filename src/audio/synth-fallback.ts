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

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
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

/**
 * Original KRUNKED SKYBREAKER 4-bar 140 BPM bass stems in E minor / Phrygian.
 * Uses 32-step (full 4-bar) patterns and a fast 1-pole lowpass filter envelope
 * for warm, punchy arcade-synthwave low end.
 */
function fillBassStem(
  data: Float32Array,
  sampleRate: number,
  variant: 1 | 2 | 3 | 4 | 5,
): void {
  const beatSec = 60 / SYNTH_BPM;
  const stepSec = beatSec / 2; // 8th-note grid (32 steps across 4 bars)

  // Original 32-step E-minor / Phrygian arcade basslines (MIDI notes)
  const patterns: Record<1 | 2 | 3 | 4 | 5, readonly number[]> = {
    // 1: Driving octave synthwave gallop (Em -> C -> D -> B7)
    1: [
      40, 52, 40, 40, 43, 40, 47, 43,
      36, 48, 36, 36, 38, 50, 38, 43,
      40, 52, 40, 47, 45, 43, 40, 38,
      36, 48, 38, 50, 35, 47, 39, 47,
    ],
    // 2: Heavy armored sub-fifths stomp
    2: [
      40, 40, 40, 47, 40, 40, 43, 45,
      36, 36, 36, 43, 38, 38, 45, 38,
      40, 40, 47, 40, 43, 43, 47, 43,
      36, 36, 38, 38, 35, 35, 39, 47,
    ],
    // 3: Snarling FM acid-pluck interceptor bass
    3: [
      40, 52, 43, 52, 40, 50, 47, 43,
      36, 48, 40, 48, 38, 50, 45, 43,
      40, 52, 41, 53, 40, 52, 47, 45,
      36, 48, 38, 50, 47, 43, 41, 39,
    ],
    // 4: Detuned industrial supersaw growl
    4: [
      40, 40, 40, 40, 43, 43, 47, 47,
      36, 36, 36, 36, 38, 38, 38, 45,
      40, 40, 40, 40, 45, 45, 43, 43,
      36, 36, 38, 38, 35, 35, 47, 39,
    ],
    // 5: Syncopated tactical arpeggio sub-bass
    5: [
      40, 47, 43, 47, 45, 47, 43, 40,
      36, 43, 40, 43, 38, 45, 42, 38,
      40, 47, 52, 47, 43, 47, 45, 43,
      36, 43, 38, 45, 35, 42, 47, 39,
    ],
  };

  const notes = patterns[variant];
  const invSr = 1 / sampleRate;
  let phase = 0;
  let detunePhase = 0;
  let subPhase = 0;
  let lp = 0;

  for (let i = 0; i < data.length; i++) {
    const t = i * invSr;
    const stepIdx = Math.floor(t / stepSec);
    const localStepT = t - stepIdx * stepSec;
    const midi = notes[stepIdx % notes.length] ?? 40;
    const freq = midiToFreq(midi);

    phase += freq * invSr;
    detunePhase += freq * 1.005 * invSr;
    subPhase += freq * 0.5 * invSr;

    const attack = localStepT < 0.004 ? localStepT / 0.004 : 1;
    const env = attack * Math.exp(-localStepT * (variant === 3 ? 10.5 : 5.8));
    const gate = localStepT < stepSec * 0.88 ? 1 : 0.18;

    let raw = 0;
    let cutoff = 0.14;
    if (variant === 1) {
      raw = (sawWave(phase) * 0.58 + squareWave(phase, 0.45) * 0.28) * gate;
      cutoff = 0.08 + 0.34 * env;
    } else if (variant === 2) {
      raw = (squareWave(phase, 0.5) * 0.55 + sawWave(detunePhase) * 0.35) * gate;
      cutoff = 0.06 + 0.24 * env;
    } else if (variant === 3) {
      const fm = Math.sin(TWO_PI * phase * 2) * env * 1.9;
      raw = (Math.sin(TWO_PI * phase + fm) * 0.72 + sawWave(phase) * 0.32) * gate;
      cutoff = 0.12 + 0.44 * env;
    } else if (variant === 4) {
      raw = (sawWave(phase) * 0.48 + sawWave(detunePhase) * 0.46) * (0.72 + 0.28 * env);
      cutoff = 0.07 + 0.22 * (0.5 + 0.5 * Math.sin(TWO_PI * (t / (beatSec * 2))));
    } else {
      raw = (triangleWave(phase) * 0.5 + squareWave(phase, 0.25) * 0.45) * gate;
      cutoff = 0.1 + 0.3 * env;
    }

    lp += clamp01(cutoff) * (raw - lp);
    const sub = Math.sin(TWO_PI * subPhase) * 0.46 * (0.45 + 0.55 * env) * gate;
    data[i] = (lp * 0.78 + sub) * 0.72;
  }
}

/**
 * Original KRUNKED SKYBREAKER 4-bar 140 BPM percussion stems with punchy click+sub
 * kick, crispy high-passed snare & hats, bar-4 fill energy, and distinct aviation alarm.
 */
function fillDrumStem(
  data: Float32Array,
  sampleRate: number,
  variant: 1 | 2 | 3 | 4 | 5 | 'alarm',
): void {
  const beatSec = 60 / SYNTH_BPM;
  const stepSec = beatSec / 4; // 16th-note grid (64 steps across 4 bars)
  const rng = createPrng(
    variant === 'alarm' ? 9917 : 4200 + variant * 173,
  );

  // 16-step groove masks per bar
  const kickMasks: Record<1 | 2 | 3 | 4 | 5 | 'alarm', readonly number[]> = {
    1: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0],
    2: [1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1],
    3: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0],
    4: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0],
    5: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1],
    alarm: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1],
  };

  const snareMasks: Record<1 | 2 | 3 | 4 | 5 | 'alarm', readonly number[]> = {
    1: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    2: [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0],
    3: [0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 1],
    4: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0],
    5: [0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0],
    alarm: [0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1],
  };

  const kickMask = kickMasks[variant];
  const snareMask = snareMasks[variant];

  const dt = 1 / sampleRate;
  let prevStep = -1;
  let kickT = 10;
  let snareT = 10;
  let hatT = 10;
  let hatOpen = false;
  let tomT = 10;
  let tomFreq = 160;
  let kickPhase = 0;
  let tomPhase = 0;
  let prevNoise = 0;

  for (let i = 0; i < data.length; i++) {
    const t = i * dt;
    const step = Math.floor(t / stepSec);
    if (step !== prevStep) {
      prevStep = step;
      const barStep = step % 16;
      const isFinalBarFill = step >= 56 && variant !== 'alarm';

      if ((kickMask[barStep] ?? 0) > 0) {
        kickT = 0;
        kickPhase = 0;
      }
      if ((snareMask[barStep] ?? 0) > 0 || (isFinalBarFill && (step === 60 || step === 62 || step === 63))) {
        snareT = 0;
      }
      if (isFinalBarFill && (step === 58 || step === 59 || step === 61)) {
        tomT = 0;
        tomPhase = 0;
        tomFreq = step === 58 ? 190 : step === 59 ? 155 : 125;
      }
      if (variant === 2 || variant === 'alarm' || step % 2 === 0 || (variant === 5 && barStep % 4 === 3)) {
        hatT = 0;
        hatOpen = barStep === 6 || barStep === 14;
      }
    }

    kickT += dt;
    snareT += dt;
    hatT += dt;
    tomT += dt;

    const white = rng() * 2 - 1;
    const hpNoise = white - prevNoise * 0.78;
    prevNoise = white;

    let sample = 0;

    // Punchy arcade kick: transient beater click + exponential sub-bass drop
    if (kickT < 0.17) {
      const baseHz = variant === 4 ? 45 : 52;
      const sweepHz = baseHz + 150 * Math.exp(-kickT * 48);
      kickPhase += sweepHz * dt;
      const kickBody = Math.sin(TWO_PI * kickPhase) * Math.exp(-kickT * (variant === 4 ? 15 : 21));
      const click = Math.sin(TWO_PI * 1650 * kickT) * Math.exp(-kickT * 190) * 0.25;
      sample += (kickBody * 0.92 + click);
    }

    // Snappy synthwave snare: crisp 200Hz shell crack + high-passed sizzle
    if (snareT < 0.16) {
      const toneSweep = 195 + 85 * Math.exp(-snareT * 55);
      const tone = Math.sin(TWO_PI * toneSweep * snareT) * Math.exp(-snareT * 34);
      const snareNoise = hpNoise * Math.exp(-snareT * 21);
      sample += (snareNoise * 0.52 + tone * 0.52) * 0.72;
    }

    // Bar-4 fill synth tom
    if (tomT < 0.14) {
      const sweep = tomFreq * (0.65 + 0.55 * Math.exp(-tomT * 26));
      tomPhase += sweep * dt;
      sample += Math.sin(TWO_PI * tomPhase) * Math.exp(-tomT * 20) * 0.55;
    }

    // Crisp metallic hi-hat
    if (hatT < (hatOpen ? 0.095 : 0.04)) {
      const hatDecay = hatOpen ? 24 : variant === 5 ? 55 : 92;
      const hatEnv = Math.exp(-hatT * hatDecay);
      sample += hpNoise * hatEnv * (hatOpen ? 0.22 : 0.18);
    }

    // Aviation cockpit low-HP warning cadence on alarm stem
    if (variant === 'alarm') {
      const eighthPhase = (t / (beatSec / 2)) % 1;
      const pulseEnv = eighthPhase < 0.42 ? Math.sin((eighthPhase / 0.42) * Math.PI) : 0;
      const hi = Math.floor(t / (beatSec / 2)) % 2 === 0;
      const freqA = hi ? 987.77 : 783.99; // B5 / G5 urgent cockpit alert
      const freqB = hi ? 1046.5 : 830.61;
      const klaxon =
        (squareWave(t * freqA, 0.28) * 0.55 + triangleWave(t * freqB) * 0.45) *
        pulseEnv *
        0.34;
      sample += klaxon;
    }

    data[i] = sample;
  }
}

/**
 * Original KRUNKED SKYBREAKER 4-bar 140 BPM lead synth stems in E minor.
 * Each weapon slot (1..5) drives a distinct melodic riff and synth timbre.
 */
function fillLeadStem(
  data: Float32Array,
  sampleRate: number,
  variant: 1 | 2 | 3 | 4 | 5,
): void {
  const beatSec = 60 / SYNTH_BPM;
  const stepSec = beatSec / 2; // 8th-note melody grid (32 steps across 4 bars)

  // Original 32-step Skybreaker heroic dogfighter melodies (MIDI notes, 0 = brief rest)
  const melodies: Record<1 | 2 | 3 | 4 | 5, readonly number[]> = {
    // 1: Heroic pulse-square interceptor theme
    1: [
      64, 67, 71, 74, 71, 69, 67, 64,
      60, 64, 67, 71, 69, 67, 66, 62,
      64, 67, 71, 76, 74, 71, 69, 67,
      72, 71, 69, 67, 66, 69, 71, 63,
    ],
    // 2: High-voltage FM rail/laser arpeggio
    2: [
      76, 71, 67, 76, 74, 71, 66, 74,
      72, 67, 64, 72, 74, 69, 66, 74,
      76, 71, 67, 79, 78, 74, 71, 76,
      72, 71, 69, 67, 66, 71, 75, 71,
    ],
    // 3: Punchy power-fifth scatter brass stabs
    3: [
      64, 64, 71, 0, 72, 71, 67, 64,
      60, 60, 67, 0, 69, 67, 66, 62,
      64, 64, 71, 74, 76, 74, 71, 67,
      72, 72, 74, 74, 71, 69, 66, 63,
    ],
    // 4: Soaring high-altitude seeker synthwave arp
    4: [
      64, 76, 67, 79, 71, 83, 67, 79,
      60, 72, 64, 76, 62, 74, 66, 78,
      64, 76, 67, 79, 72, 84, 71, 83,
      69, 81, 67, 79, 66, 78, 71, 83,
    ],
    // 5: Heavy cannon low-mid chugger lead
    5: [
      52, 52, 55, 59, 60, 59, 57, 55,
      48, 48, 52, 55, 57, 55, 54, 50,
      52, 55, 59, 64, 62, 59, 57, 55,
      60, 59, 57, 55, 54, 57, 59, 51,
    ],
  };

  const notes = melodies[variant];
  const invSr = 1 / sampleRate;
  let phase = 0;
  let detunePhase = 0;
  let fifthPhase = 0;
  let lp = 0;

  for (let i = 0; i < data.length; i++) {
    const t = i * invSr;
    const stepIdx = Math.floor(t / stepSec);
    const localT = t - stepIdx * stepSec;
    const midi = notes[stepIdx % notes.length] ?? 64;
    if (midi <= 0) {
      lp *= 0.992;
      data[i] = lp * 0.5;
      continue;
    }

    const vibrato = 1 + 0.0045 * Math.sin(TWO_PI * 5.8 * t);
    const freq = midiToFreq(midi) * vibrato;

    phase += freq * invSr;
    detunePhase += freq * 1.006 * invSr;
    fifthPhase += freq * 1.4983 * invSr;

    const attack = localT < 0.007 ? localT / 0.007 : 1;
    const decay = Math.exp(-localT * (variant === 2 ? 6.4 : 3.8));
    const env = attack * decay;

    let raw = 0;
    let cutoff = 0.28;
    if (variant === 1) {
      raw = (squareWave(phase, 0.25) * 0.56 + sawWave(detunePhase) * 0.44) * env;
      cutoff = 0.16 + 0.45 * env;
    } else if (variant === 2) {
      const fm = Math.sin(TWO_PI * phase * 3) * 1.85 * decay;
      raw = (Math.sin(TWO_PI * phase + fm) * 0.78 + triangleWave(phase * 2) * 0.22) * env;
      cutoff = 0.24 + 0.45 * env;
    } else if (variant === 3) {
      raw = (squareWave(phase, 0.45) * 0.52 + sawWave(fifthPhase) * 0.38) * env;
      cutoff = 0.18 + 0.38 * env;
    } else if (variant === 4) {
      raw = (sawWave(phase) * 0.5 + sawWave(detunePhase) * 0.32 + triangleWave(phase * 2) * 0.28) * env;
      cutoff = 0.2 + 0.42 * env;
    } else {
      raw = (sawWave(phase) * 0.62 + squareWave(phase * 0.5, 0.5) * 0.42) * env;
      cutoff = 0.14 + 0.36 * env;
    }

    lp += clamp01(cutoff) * (raw - lp);
    data[i] = lp * 0.62;
  }
}

/**
 * Original KRUNKED SKYBREAKER Hangar ready-room groove:
 * warm Em9 submarine-carrier synth pad, gentle pulsing sub-arpeggio, and sonar ping.
 */
function fillHangarStem(data: Float32Array, sampleRate: number): void {
  const beatSec = 60 / SYNTH_BPM;
  const stepSec = beatSec / 2;
  const arpNotes = [40, 47, 52, 55, 59, 55, 52, 47, 36, 43, 48, 52, 38, 45, 50, 54];
  const invSr = 1 / sampleRate;

  let p1 = 0;
  let p2 = 0;
  let p3 = 0;
  let p4 = 0;
  let arpPhase = 0;
  let lp = 0;

  const f1 = midiToFreq(40); // E2
  const f2 = midiToFreq(47); // B2
  const f3 = midiToFreq(55); // G3
  const f4 = midiToFreq(66); // F#4 (9th shimmer)

  for (let i = 0; i < data.length; i++) {
    const t = i * invSr;
    p1 += f1 * invSr;
    p2 += f2 * invSr;
    p3 += f3 * invSr;
    p4 += f4 * invSr;

    const padLfo = 0.68 + 0.32 * Math.sin(TWO_PI * (t / SYNTH_LOOP_DURATION_SEC) * 2);
    const pad =
      (Math.sin(TWO_PI * p1) * 0.44 +
        triangleWave(p2) * 0.26 +
        Math.sin(TWO_PI * p3) * 0.18 +
        Math.sin(TWO_PI * p4) * 0.12) *
      padLfo;

    const stepIdx = Math.floor(t / stepSec);
    const localStepT = t - stepIdx * stepSec;
    const arpFreq = midiToFreq(arpNotes[stepIdx % arpNotes.length] ?? 40);
    arpPhase += arpFreq * invSr;
    const arpEnv = Math.exp(-localStepT * 9.5);
    const arpRaw = (sawWave(arpPhase) * 0.55 + squareWave(arpPhase, 0.35) * 0.45) * arpEnv;
    lp += (0.06 + 0.18 * arpEnv) * (arpRaw - lp);

    const pulsePos = (t / (beatSec * 2)) % 1;
    const sonar =
      (Math.sin(TWO_PI * 659.25 * t) * 0.7 + Math.sin(TWO_PI * 1318.5 * t) * 0.3) *
      Math.exp(-pulsePos * 12) *
      0.14;

    data[i] = pad * 0.44 + lp * 0.34 + sonar;
  }
}

function fillPauseStem(data: Float32Array, sampleRate: number): void {
  const beatSec = 60 / SYNTH_BPM;
  const invSr = 1 / sampleRate;
  let p1 = 0;
  let p2 = 0;
  let p3 = 0;

  for (let i = 0; i < data.length; i++) {
    const t = i * invSr;
    p1 += midiToFreq(52) * invSr;
    p2 += midiToFreq(59) * invSr;
    p3 += midiToFreq(40) * invSr;
    const beatPhase = (t / beatSec) % 1;
    const pulse = 0.32 + 0.68 * Math.exp(-beatPhase * 4.5);
    data[i] =
      (Math.sin(TWO_PI * p1) * 0.45 +
        triangleWave(p2) * 0.3 +
        Math.sin(TWO_PI * p3) * 0.35) *
      pulse *
      0.38;
  }
}

function fillUnknownStem(data: Float32Array, sampleRate: number): void {
  const stepSec = 60 / SYNTH_BPM / 4;
  const rng = createPrng(55577);
  const invSr = 1 / sampleRate;
  let phase = 0;
  let lastStep = -1;
  let stepFreq = 164.81;

  for (let i = 0; i < data.length; i++) {
    const t = i * invSr;
    const step = Math.floor(t / stepSec);
    if (step !== lastStep) {
      lastStep = step;
      const semitones = Math.floor(rng() * 14) - 6;
      stepFreq = midiToFreq(52 + semitones);
    }
    phase += stepFreq * invSr;
    const mod = Math.sin(TWO_PI * 4.2 * t) * 2.3;
    const glitch =
      Math.sin(TWO_PI * phase + mod) * 0.52 +
      squareWave(phase * 0.5, 0.22) * 0.32;
    data[i] = glitch * 0.46;
  }
}

/**
 * Full-throttle overdrive mix for the Apex Omega [5,5,5] secret aircraft
 * (mapped to internal Steam-compatible lookup key `luftrauser__urauser`).
 */
function fillApexOmegaStem(data: Float32Array, sampleRate: number): void {
  const len = data.length;
  const bass = new Float32Array(len);
  const drums = new Float32Array(len);
  const lead = new Float32Array(len);

  fillBassStem(bass, sampleRate, 3);
  fillDrumStem(drums, sampleRate, 2);
  fillLeadStem(lead, sampleRate, 4);

  const invSr = 1 / sampleRate;
  const octaveFreq = midiToFreq(64); // E4 shimmer
  for (let i = 0; i < len; i++) {
    const t = i * invSr;
    const shimmer = sawWave(t * octaveFreq) * 0.16;
    data[i] =
      (bass[i] ?? 0) * 0.64 +
      (drums[i] ?? 0) * 0.72 +
      (lead[i] ?? 0) * 0.68 +
      shimmer;
  }
}

/**
 * Synthesizes a single phase-locked looping 4-bar 140 BPM KRUNKED SKYBREAKER
 * original music stem `AudioBuffer` directly via `BaseAudioContext.createBuffer`
 * (zero external files). Accepts internal Steam-compatible stem IDs so live
 * `SKYBREAKER` <-> `STEAM LOCAL` hot-swapping shares a single stem matrix.
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
    fillApexOmegaStem(data, sampleRate);
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
  subPunchHz = 0,
): SfxRecipe {
  return {
    durationSec,
    synth: (data, sampleRate) => {
      const rng = createPrng(seed);
      const invSr = 1 / sampleRate;
      const dur = data.length * invSr;
      let phase = 0;
      let subPhase = 0;
      let lpNoise = 0;
      for (let i = 0; i < data.length; i++) {
        const t = i * invSr;
        const u = dur > 0 ? t / dur : 0;
        // Exponentially curved pitch sweep feels punchier than linear
        const curve = 1 - Math.pow(1 - u, 1.6);
        const hz = startHz + (endHz - startHz) * curve;
        phase += hz * invSr;
        const osc =
          wave === 'square'
            ? squareWave(phase, 0.38)
            : wave === 'saw'
              ? sawWave(phase)
              : wave === 'tri'
                ? triangleWave(phase)
                : Math.sin(TWO_PI * phase);
        const rawNoise = rng() * 2 - 1;
        // Shape explosion/splash noise with a sweeping lowpass for crisp arcade texture
        lpNoise += (0.14 + 0.55 * (1 - u)) * (rawNoise - lpNoise);

        let sub = 0;
        if (subPunchHz > 0) {
          const subHz = subPunchHz * (0.45 + 0.55 * Math.exp(-u * 6));
          subPhase += subHz * invSr;
          sub = Math.sin(TWO_PI * subPhase) * Math.exp(-u * (decayRate * 0.8)) * 0.45;
        }

        const env = Math.exp(-u * decayRate) * Math.min(1, t / 0.0018);
        const tailFade = u > 0.85 ? (1 - u) / 0.15 : 1;
        data[i] =
          ((osc * (1 - noiseMix) + lpNoise * noiseMix) * env + sub) *
          tailFade *
          gain;
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
      const invSr = 1 / sampleRate;
      let phase = 0;
      let harmonicPhase = 0;
      for (let i = 0; i < data.length; i++) {
        const t = i * invSr;
        const noteIdx = Math.min(notesHz.length - 1, Math.floor(t / noteDurSec));
        const localT = t - noteIdx * noteDurSec;
        const hz = notesHz[noteIdx] ?? 440;
        if (hz <= 0) {
          data[i] = 0;
          continue;
        }
        phase += hz * invSr;
        harmonicPhase += hz * 2 * invSr;
        const osc =
          wave === 'square'
            ? squareWave(phase, 0.35) * 0.8 + Math.sin(TWO_PI * harmonicPhase) * 0.2
            : wave === 'saw'
              ? sawWave(phase)
              : wave === 'tri'
                ? triangleWave(phase) * 0.82 + Math.sin(TWO_PI * harmonicPhase) * 0.18
                : Math.sin(TWO_PI * phase);
        const env = Math.exp(-localT * 13) * Math.min(1, localT / 0.002);
        data[i] = osc * env * gain;
      }
    },
  };
}

const SFX_RECIPES: Record<AudioCueId, SfxRecipe> = {
  sndacespawn: makeSweepRecipe(0.4, 240, 980, 'saw', 0.22, 2.8, 101, 0.75, 110),
  sndacespawndist: makeSweepRecipe(0.32, 210, 760, 'sine', 0.18, 3.5, 102, 0.48),
  sndadd1: makeArpRecipe([587.33, 739.99], 0.052, 'square', 0.52),
  sndadd2: makeArpRecipe([739.99, 880], 0.052, 'square', 0.54),
  sndadd3: makeArpRecipe([880, 1174.66], 0.058, 'square', 0.58),
  sndboatdie: makeSweepRecipe(0.48, 170, 34, 'saw', 0.65, 3.8, 106, 0.84, 72),
  sndboost: makeSweepRecipe(0.24, 92, 235, 'saw', 0.66, 3.0, 107, 0.68, 68),
  sndbullet: makeSweepRecipe(0.058, 760, 145, 'square', 0.34, 6.2, 108, 0.58),
  sndcannon: makeSweepRecipe(0.24, 300, 44, 'saw', 0.44, 4.8, 109, 0.84, 86),
  sndcannonexplo: makeSweepRecipe(0.42, 185, 28, 'saw', 0.72, 4.1, 110, 0.88, 66),
  sndcannonfail: makeSweepRecipe(0.08, 250, 115, 'tri', 0.2, 7.0, 111, 0.46),
  sndcannonreload: makeArpRecipe([329.63, 493.88, 659.25], 0.042, 'tri', 0.52),
  sndcombodrop: makeArpRecipe([440, 293.66], 0.11, 'saw', 0.56),
  sndcombowarn: makeArpRecipe([987.77, 0, 987.77], 0.052, 'square', 0.5),
  snddeny: makeArpRecipe([185, 146.83], 0.078, 'square', 0.52),
  sndebullet: makeSweepRecipe(0.072, 560, 195, 'saw', 0.16, 5.4, 116, 0.5),
  sndebulletdist: makeSweepRecipe(0.072, 450, 175, 'sine', 0.12, 6.0, 117, 0.34),
  sndebullet2: makeSweepRecipe(0.082, 790, 265, 'square', 0.2, 5.4, 118, 0.5),
  sndebullet2dist: makeSweepRecipe(0.082, 630, 235, 'sine', 0.15, 6.0, 119, 0.34),
  sndexplom: makeSweepRecipe(0.35, 200, 36, 'saw', 0.74, 4.6, 120, 0.82, 74),
  sndgungine: makeSweepRecipe(0.088, 450, 98, 'saw', 0.52, 5.0, 121, 0.62),
  sndhangar: makeSweepRecipe(0.18, 148, 64, 'tri', 0.34, 4.8, 122, 0.56, 62),
  sndheal: makeArpRecipe([659.25, 880], 0.044, 'sine', 0.44),
  sndhealed: makeArpRecipe([659.25, 783.99, 987.77, 1318.51], 0.052, 'tri', 0.58),
  sndhit1: makeSweepRecipe(0.068, 340, 92, 'square', 0.45, 7.0, 125, 0.56),
  sndhit2: makeSweepRecipe(0.068, 405, 108, 'square', 0.45, 7.0, 126, 0.56),
  sndhit3: makeSweepRecipe(0.068, 475, 125, 'square', 0.45, 7.0, 127, 0.56),
  sndhit4: makeSweepRecipe(0.068, 545, 145, 'square', 0.45, 7.0, 128, 0.56),
  sndjetdie: makeSweepRecipe(0.38, 660, 52, 'saw', 0.66, 4.2, 129, 0.78, 70),
  sndlaser: makeSweepRecipe(0.095, 1040, 880, 'saw', 0.12, 2.4, 130, 0.52),
  sndlaunch: makeSweepRecipe(0.46, 78, 360, 'saw', 0.58, 2.6, 131, 0.82, 82),
  sndmaxcombo: makeArpRecipe([659.25, 783.99, 987.77, 1318.51, 1567.98], 0.058, 'square', 0.64),
  sndmessage: makeArpRecipe([783.99, 1046.5], 0.04, 'sine', 0.46),
  sndmisempty: makeSweepRecipe(0.045, 380, 185, 'tri', 0.25, 8.0, 134, 0.46),
  sndmissile: makeSweepRecipe(0.25, 250, 650, 'saw', 0.62, 3.6, 135, 0.65),
  sndmisspawn: makeSweepRecipe(0.16, 440, 810, 'square', 0.4, 4.6, 136, 0.54),
  sndmisspawndist: makeSweepRecipe(0.15, 370, 640, 'sine', 0.3, 5.0, 137, 0.36),
  sndmove: makeSweepRecipe(0.036, 560, 720, 'square', 0.05, 7.2, 138, 0.44),
  sndnuke: makeSweepRecipe(0.9, 195, 22, 'saw', 0.78, 2.6, 139, 0.92, 58),
  sndplanedie: makeSweepRecipe(0.34, 360, 46, 'saw', 0.7, 4.4, 140, 0.78, 70),
  sndplayerdie: makeSweepRecipe(0.66, 275, 26, 'saw', 0.74, 3.1, 141, 0.88, 62),
  sndplayerhit: makeSweepRecipe(0.16, 295, 56, 'square', 0.54, 5.2, 142, 0.75, 84),
  sndpopup: makeArpRecipe([587.33, 739.99, 880], 0.058, 'tri', 0.58),
  sndprojector: makeSweepRecipe(0.042, 840, 340, 'tri', 0.38, 7.8, 144, 0.4),
  sndprojectorstart: makeSweepRecipe(0.28, 92, 275, 'tri', 0.48, 3.0, 145, 0.54),
  sndsfmt: makeSweepRecipe(0.44, 124, 54, 'saw', 0.38, 2.8, 146, 0.82, 65),
  sndsplashl: makeSweepRecipe(0.36, 440, 105, 'sine', 0.9, 4.2, 147, 0.72),
  sndsplashm: makeSweepRecipe(0.19, 540, 155, 'sine', 0.85, 5.2, 148, 0.58),
  sndspread: makeSweepRecipe(0.15, 380, 72, 'saw', 0.64, 5.2, 149, 0.72, 85),
  sndswap: makeArpRecipe([493.88, 659.25], 0.036, 'square', 0.48),
  snduboost: makeSweepRecipe(0.22, 128, 188, 'sine', 0.44, 3.4, 151, 0.6, 60),
  sndunboost: makeSweepRecipe(0.14, 248, 82, 'tri', 0.34, 5.2, 152, 0.5),
};

/**
 * Synthesizes a clean-room original KRUNKED SKYBREAKER procedural SFX `AudioBuffer`
 * for any `AudioCueId`.
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
