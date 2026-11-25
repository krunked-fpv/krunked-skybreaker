import { describe, expect, it, vi } from 'vitest';
import {
  ALL_AUDIO_CUE_IDS,
  ALL_STEM_IDS,
  AudioEngine,
  SYNTH_LOOP_DURATION_SEC,
  computePhaseOffset,
  createSynthFallbackBank,
  resolveActiveStems,
  resolveSpatialSfx,
} from '../src/audio';
import type { AudioCueId } from '../src/contracts/audio';
import type { Loadout, PartIndex, SimSnapshot } from '../src/contracts/sim';
import type { VaultAssetBundle } from '../src/contracts/vault';

interface MockAudioParam {
  value: number;
  calls: Array<{ type: string; args: unknown[] }>;
  setValueAtTime: (value: number, startTime: number) => MockAudioParam;
  linearRampToValueAtTime: (value: number, endTime: number) => MockAudioParam;
  cancelScheduledValues: (cancelTime: number) => MockAudioParam;
}

function createMockParam(initial = 0): MockAudioParam {
  const param: MockAudioParam = {
    value: initial,
    calls: [],
    setValueAtTime(value: number, startTime: number) {
      param.calls.push({ type: 'setValueAtTime', args: [value, startTime] });
      param.value = value;
      return param;
    },
    linearRampToValueAtTime(value: number, endTime: number) {
      param.calls.push({
        type: 'linearRampToValueAtTime',
        args: [value, endTime],
      });
      return param;
    },
    cancelScheduledValues(cancelTime: number) {
      param.calls.push({ type: 'cancelScheduledValues', args: [cancelTime] });
      return param;
    },
  };
  return param;
}

interface MockBufferSource {
  buffer: AudioBuffer | null;
  loop: boolean;
  playbackRate: MockAudioParam;
  onended: (() => void) | null;
  startedAt: number | null;
  startedOffset: number | null;
  stoppedAt: number | null;
  disconnected: boolean;
  connections: unknown[];
  connect: (dest: unknown) => unknown;
  disconnect: () => void;
  start: (when?: number, offset?: number) => void;
  stop: (when?: number) => void;
}

interface MockGainNode {
  gain: MockAudioParam;
  connections: unknown[];
  disconnected: boolean;
  connect: (dest: unknown) => unknown;
  disconnect: () => void;
}

interface MockPannerNode {
  pan: MockAudioParam;
  connections: unknown[];
  disconnected: boolean;
  connect: (dest: unknown) => unknown;
  disconnect: () => void;
}

function createMockAudioBuffer(
  numberOfChannels: number,
  length: number,
  sampleRate: number,
): AudioBuffer {
  const channels = Array.from(
    { length: numberOfChannels },
    () => new Float32Array(length),
  );
  return {
    sampleRate,
    length,
    duration: length / sampleRate,
    numberOfChannels,
    getChannelData(channel: number) {
      const ch = channels[channel];
      if (!ch) throw new Error(`Missing channel ${channel}`);
      return ch;
    },
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  } as unknown as AudioBuffer;
}

function createMockAudioContext(
  initialState: AudioContextState = 'suspended',
  sampleRate = 44100,
) {
  const sources: MockBufferSource[] = [];
  const gains: MockGainNode[] = [];
  const panners: MockPannerNode[] = [];
  let compressorCreated = false;

  const ctx = {
    state: initialState as AudioContextState,
    currentTime: 0,
    sampleRate,
    destination: { kind: 'destination' } as unknown as AudioDestinationNode,
    resume: vi.fn(async () => {
      ctx.state = 'running';
    }),
    close: vi.fn(async () => {
      ctx.state = 'closed';
    }),
    createBuffer(channels: number, length: number, rate: number): AudioBuffer {
      return createMockAudioBuffer(channels, length, rate);
    },
    decodeAudioData: vi.fn(async (_raw: ArrayBuffer) =>
      createMockAudioBuffer(1, Math.round(sampleRate * SYNTH_LOOP_DURATION_SEC), sampleRate),
    ),
    createBufferSource(): AudioBufferSourceNode {
      const node: MockBufferSource = {
        buffer: null,
        loop: false,
        playbackRate: createMockParam(1),
        onended: null,
        startedAt: null,
        startedOffset: null,
        stoppedAt: null,
        disconnected: false,
        connections: [],
        connect(dest: unknown) {
          node.connections.push(dest);
          return dest;
        },
        disconnect() {
          node.disconnected = true;
        },
        start(when = 0, offset = 0) {
          node.startedAt = when;
          node.startedOffset = offset;
        },
        stop(when = 0) {
          node.stoppedAt = when;
        },
      };
      sources.push(node);
      return node as unknown as AudioBufferSourceNode;
    },
    createGain(): GainNode {
      const node: MockGainNode = {
        gain: createMockParam(1),
        connections: [],
        disconnected: false,
        connect(dest: unknown) {
          node.connections.push(dest);
          return dest;
        },
        disconnect() {
          node.disconnected = true;
        },
      };
      gains.push(node);
      return node as unknown as GainNode;
    },
    createStereoPanner(): StereoPannerNode {
      const node: MockPannerNode = {
        pan: createMockParam(0),
        connections: [],
        disconnected: false,
        connect(dest: unknown) {
          node.connections.push(dest);
          return dest;
        },
        disconnect() {
          node.disconnected = true;
        },
      };
      panners.push(node);
      return node as unknown as StereoPannerNode;
    },
    createDynamicsCompressor(): DynamicsCompressorNode {
      compressorCreated = true;
      const node = {
        threshold: createMockParam(-24),
        knee: createMockParam(30),
        ratio: createMockParam(12),
        attack: createMockParam(0.003),
        release: createMockParam(0.25),
        connect: vi.fn((dest: unknown) => dest),
        disconnect: vi.fn(),
      };
      return node as unknown as DynamicsCompressorNode;
    },
    _inspect: {
      sources,
      gains,
      panners,
      hasCompressor: () => compressorCreated,
    },
  };

  return ctx;
}

function makeFallbackVault(
  source: 'procedural-fallback' | 'steam-local' = 'procedural-fallback',
  bgm: Record<string, string | null> = {},
  sfx: Record<string, string | null> = {},
): VaultAssetBundle {
  return {
    data: {} as VaultAssetBundle['data'],
    textures: {},
    audioManifest: {
      source,
      bgm,
      sfx,
    },
  };
}

function makeSnapshot(overrides: {
  tick?: number;
  phase?: SimSnapshot['phase'];
  paused?: boolean;
  loadout?: Loadout;
  health?: number;
  maxHealth?: number;
  cameraTargetX?: number;
  playerX?: number;
  audioEvents?: SimSnapshot['audioEvents'];
} = {}): SimSnapshot {
  const loadout: Loadout = overrides.loadout ?? {
    weapon: 0,
    body: 0,
    engine: 0,
  };
  return {
    tick: overrides.tick ?? 1,
    phase: overrides.phase ?? 'playing',
    mode: 'normal',
    paused: overrides.paused ?? false,
    hitstopTicks: 0,
    screenShake: 0,
    nukeFlashTicks: 0,
    launchTicks: 0,
    deathTicks: 0,
    score: 0,
    combo: 1,
    comboTimer: 0,
    comboMaxTimer: 180,
    comboWarning: false,
    difficulty: 60,
    killsThisSortie: 0,
    killsByKind: {},
    player: {
      x: overrides.playerX ?? 0,
      y: -150,
      prevX: 0,
      prevY: -150,
      vx: 0,
      vy: 0,
      angleDeg: 0,
      prevAngleDeg: 0,
      health: overrides.health ?? 10,
      maxHealth: overrides.maxHealth ?? 10,
      alive: true,
      boosting: false,
      wasBoosting: false,
      firing: false,
      healing: false,
      healingTicks: 0,
      underwater: false,
      inSpace: false,
      fireCooldown: 0,
      gungineCooldown: 0,
      bombCooldown: 0,
      flashTicks: 0,
      burnTicks: 0,
      envWaterFactor: 0,
      envSpaceFactor: 0,
      nukeTriggered: false,
      nukeRadius: 0,
      nukeTicks: 0,
      isUrauser:
        loadout.weapon === 5 && loadout.body === 5 && loadout.engine === 5,
      loadout,
      planeName: 'ORIGINAL',
      engineSpec: {} as SimSnapshot['player']['engineSpec'],
      bodySpec: {} as SimSnapshot['player']['bodySpec'],
      weaponSpec: {} as SimSnapshot['player']['weaponSpec'],
      boostAnimFrame: 0,
    },
    enemies: [],
    projectiles: [],
    particles: [],
    parallax: [],
    cameraTargetX: overrides.cameraTargetX ?? 0,
    cameraTargetY: -150,
    audioEvents: overrides.audioEvents ?? [],
    completedMissionsThisSortie: [],
    activeMissions: [],
    missionProgress: {},
    profile: {} as SimSnapshot['profile'],
    seaLevel: 0,
    spaceLevel: -1300,
    autopilotEnabled: false,
    seed: 1,
  };
}

describe('resolveActiveStems', () => {
  it('maps all 125 0..4 loadout combinations to exact bass/drums/lead stems', () => {
    let comboCount = 0;
    const parts: PartIndex[] = [0, 1, 2, 3, 4];

    for (const weapon of parts) {
      for (const body of parts) {
        for (const engine of parts) {
          comboCount++;
          const res = resolveActiveStems(
            'playing',
            false,
            { weapon, body, engine },
            1.0,
          );
          expect(res.musicState).toBe('combat');
          expect(res.alarmActive).toBe(false);
          expect(res.stems).toEqual([
            `luftrauser_bass${body + 1}`,
            `luftrauser_drums${engine + 1}`,
            `luftrauser_lead${weapon + 1}`,
          ]);
        }
      }
    }
    expect(comboCount).toBe(125);
  });

  it('activates luftrauser_drums_alarm strictly below 0.333333 HP', () => {
    const loadout: Loadout = { weapon: 2, body: 1, engine: 4 };

    const atThreshold = resolveActiveStems('playing', false, loadout, 0.333333);
    expect(atThreshold.alarmActive).toBe(false);
    expect(atThreshold.stems).toEqual([
      'luftrauser_bass2',
      'luftrauser_drums5',
      'luftrauser_lead3',
    ]);

    const oneThird = resolveActiveStems('playing', false, loadout, 1 / 3);
    expect(oneThird.alarmActive).toBe(false);
    expect(oneThird.stems).not.toContain('luftrauser_drums_alarm');

    const belowThreshold = resolveActiveStems('playing', false, loadout, 0.333332);
    expect(belowThreshold.alarmActive).toBe(true);
    expect(belowThreshold.stems).toEqual([
      'luftrauser_bass2',
      'luftrauser_drums5',
      'luftrauser_lead3',
      'luftrauser_drums_alarm',
    ]);
  });

  it('maps [5,5,5] to urauser, partial 5 to unknown, hangar, and pause with correct precedence', () => {
    // [5,5,5] -> urauser (+ alarm only strictly below 0.333333)
    const urauserNormal = resolveActiveStems(
      'playing',
      false,
      { weapon: 5, body: 5, engine: 5 },
      0.5,
    );
    expect(urauserNormal).toEqual({
      musicState: 'urauser',
      stems: ['luftrauser__urauser'],
      alarmActive: false,
    });

    const urauserAlarm = resolveActiveStems(
      'playing',
      false,
      { weapon: 5, body: 5, engine: 5 },
      0.2,
    );
    expect(urauserAlarm).toEqual({
      musicState: 'urauser',
      stems: ['luftrauser__urauser', 'luftrauser_drums_alarm'],
      alarmActive: true,
    });

    // Partial 5 combos -> unknown
    const partialCombos: Loadout[] = [
      { weapon: 5, body: 0, engine: 0 },
      { weapon: 0, body: 5, engine: 0 },
      { weapon: 0, body: 0, engine: 5 },
      { weapon: 5, body: 5, engine: 2 },
      { weapon: 5, body: 3, engine: 5 },
      { weapon: 1, body: 5, engine: 5 },
    ];
    for (const loadout of partialCombos) {
      const unknownRes = resolveActiveStems('playing', false, loadout, 0.1);
      expect(unknownRes).toEqual({
        musicState: 'unknown',
        stems: ['luftrauser__unknown'],
        alarmActive: false,
      });
    }

    // Hangar overrides loadout & low HP
    expect(
      resolveActiveStems('hangar', false, { weapon: 5, body: 5, engine: 5 }, 0.1),
    ).toEqual({
      musicState: 'hangar',
      stems: ['luftrauser__hangar'],
      alarmActive: false,
    });

    // Pause overrides everything (hangar, combat, urauser, low HP)
    expect(
      resolveActiveStems('playing', true, { weapon: 5, body: 5, engine: 5 }, 0.1),
    ).toEqual({
      musicState: 'pause',
      stems: ['luftrauser__pause'],
      alarmActive: false,
    });
    expect(
      resolveActiveStems('hangar', true, { weapon: 0, body: 0, engine: 0 }, 1),
    ).toEqual({
      musicState: 'pause',
      stems: ['luftrauser__pause'],
      alarmActive: false,
    });
  });
});

describe('resolveSpatialSfx', () => {
  it('returns unpanned full-gain cue when coordinates are omitted', () => {
    expect(resolveSpatialSfx('sndebullet', undefined, undefined)).toEqual({
      resolvedCue: 'sndebullet',
      pan: 0,
      gain: 1,
    });
    expect(resolveSpatialSfx('sndacespawn', 100, undefined)).toEqual({
      resolvedCue: 'sndacespawn',
      pan: 0,
      gain: 1,
    });
  });

  it('switches to *dist variants beyond ±300px, clamps pan to [-0.85, +0.85], and attenuates gain smoothly', () => {
    // On-screen edge (300px) keeps close variant and full gain, pans right
    const atEdge = resolveSpatialSfx('sndebullet', 400, 100);
    expect(atEdge.resolvedCue).toBe('sndebullet');
    expect(atEdge.gain).toBe(1);
    expect(atEdge.pan).toBeCloseTo(300 / 380, 6);

    // Off-screen (+301px) switches to *dist and attenuates
    const offscreenRight = resolveSpatialSfx('sndebullet', 401, 100);
    expect(offscreenRight.resolvedCue).toBe('sndebulletdist');
    expect(offscreenRight.gain).toBeCloseTo(1 - (301 - 200) / 900, 6);
    expect(offscreenRight.pan).toBeCloseTo(301 / 380, 6);

    // All 4 *dist variants
    expect(resolveSpatialSfx('sndacespawn', -500, 0).resolvedCue).toBe(
      'sndacespawndist',
    );
    expect(resolveSpatialSfx('sndebullet2', 500, 0).resolvedCue).toBe(
      'sndebullet2dist',
    );
    expect(resolveSpatialSfx('sndmisspawn', -500, 0).resolvedCue).toBe(
      'sndmisspawndist',
    );
    // Cue without *dist variant preserves cue name while still attenuating/panning
    const bulletFar = resolveSpatialSfx('sndbullet', 600, 0);
    expect(bulletFar.resolvedCue).toBe('sndbullet');
    expect(bulletFar.pan).toBe(0.85);
    expect(bulletFar.gain).toBeCloseTo(1 - (600 - 200) / 900, 6);

    // Pan clamp both sides & gain floor at 0.2
    const extremeLeft = resolveSpatialSfx('sndebullet', -2000, 0);
    expect(extremeLeft.pan).toBe(-0.85);
    expect(extremeLeft.gain).toBe(0.2);

    const extremeRight = resolveSpatialSfx('sndebullet', 2500, 0);
    expect(extremeRight.pan).toBe(0.85);
    expect(extremeRight.gain).toBe(0.2);
  });
});

describe('computePhaseOffset', () => {
  it('maintains < 0.01ms phase alignment across arbitrary contextTime values', () => {
    const epoch = 12.345678;
    const duration = SYNTH_LOOP_DURATION_SEC; // 48/7 s

    expect(computePhaseOffset(epoch - 0.02, epoch, duration)).toBe(0);
    expect(computePhaseOffset(epoch, epoch, duration)).toBe(0);
    expect(computePhaseOffset(epoch, epoch, 0)).toBe(0);

    const sampleTimes = [
      epoch + 0.001,
      epoch + 1.25,
      epoch + duration,
      epoch + duration * 3 + 2.419,
      epoch + duration * 100 + 5.123456,
      epoch + duration * 2500 + 0.777777,
    ];

    for (const t of sampleTimes) {
      const offset = computePhaseOffset(t, epoch, duration);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(duration);

      // Reconstruct phase modulo duration and verify < 0.01ms error
      const loops = Math.floor((t - epoch) / duration);
      const exactRemainder = t - epoch - loops * duration;
      const rawDiff = Math.abs(offset - exactRemainder);
      const wrappedDiffMs = Math.min(rawDiff, duration - rawDiff) * 1000;
      expect(wrappedDiffMs).toBeLessThan(0.01);
    }
  });
});

describe('synth-fallback', () => {
  it('synthesizes phase-locked 4-bar 140 BPM stems with identical duration and all 52 SFX cues', () => {
    const mockCtx = createMockAudioContext('running', 44100);
    const bank = createSynthFallbackBank(
      mockCtx as unknown as BaseAudioContext,
    );

    expect(bank.stems.size).toBe(ALL_STEM_IDS.length);
    expect(bank.sfx.size).toBe(ALL_AUDIO_CUE_IDS.length);

    let referenceLength: number | null = null;
    let referenceDuration: number | null = null;

    for (const stemId of ALL_STEM_IDS) {
      const buf = bank.stems.get(stemId);
      expect(buf).toBeDefined();
      if (!buf) continue;
      if (referenceLength === null) {
        referenceLength = buf.length;
        referenceDuration = buf.duration;
      }
      expect(buf.length).toBe(referenceLength);
      expect(buf.duration).toBe(referenceDuration);
      expect(buf.duration).toBeCloseTo(SYNTH_LOOP_DURATION_SEC, 5);

      const samples = buf.getChannelData(0);
      let peak = 0;
      let allFinite = true;
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i] ?? 0;
        if (!Number.isFinite(s)) {
          allFinite = false;
          break;
        }
        const abs = Math.abs(s);
        if (abs > peak) peak = abs;
      }
      expect(allFinite).toBe(true);
      expect(peak).toBeGreaterThan(0.05);
      expect(peak).toBeLessThanOrEqual(1.0);
    }

    for (const cueId of ALL_AUDIO_CUE_IDS) {
      const buf = bank.sfx.get(cueId as AudioCueId);
      expect(buf).toBeDefined();
      if (!buf) continue;
      expect(buf.length).toBeGreaterThan(0);
      const samples = buf.getChannelData(0);
      let peak = 0;
      let allFinite = true;
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i] ?? 0;
        if (!Number.isFinite(s)) {
          allFinite = false;
          break;
        }
        const abs = Math.abs(s);
        if (abs > peak) peak = abs;
      }
      expect(allFinite).toBe(true);
      expect(peak).toBeGreaterThan(0.01);
      expect(peak).toBeLessThanOrEqual(1.0);
    }
  });
});

describe('AudioEngine', () => {
  it('handles autoplay lock, Hangar -> Combat -> Alarm -> Pause -> Urauser transitions with < 1ms drift', async () => {
    const mockCtx = createMockAudioContext('suspended', 44100);
    const engine = new AudioEngine({
      context: mockCtx as unknown as AudioContext,
    });

    await engine.init(makeFallbackVault('procedural-fallback'));
    expect(mockCtx._inspect.hasCompressor()).toBe(true);
    expect(engine.getSyncMetrics().unlocked).toBe(false);
    expect(engine.getSyncMetrics().source).toBe('synth-fallback');

    // Sync before unlock queues state without starting AudioBufferSourceNodes
    engine.syncFromSnapshot(makeSnapshot({ phase: 'hangar' }));
    expect(mockCtx._inspect.sources).toHaveLength(0);
    expect(engine.getSyncMetrics().musicState).toBe('hangar');
    expect(engine.getSyncMetrics().activeStems).toEqual(['luftrauser__hangar']);

    // Unlock starts queued hangar stem anchored to epochTime = currentTime + 0.02
    mockCtx.currentTime = 1.0;
    await engine.unlock();
    expect(mockCtx.resume).toHaveBeenCalledTimes(1);
    expect(engine.getSyncMetrics().unlocked).toBe(true);
    expect(engine.getSyncMetrics().epochTime).toBeCloseTo(1.02, 6);
    expect(mockCtx._inspect.sources).toHaveLength(1);
    expect(mockCtx._inspect.sources[0]?.loop).toBe(true);
    expect(mockCtx._inspect.sources[0]?.startedAt).toBeCloseTo(1.02, 6);
    expect(mockCtx._inspect.sources[0]?.startedOffset).toBe(0);

    // Transition Hangar -> Combat at t = 3.5s
    mockCtx.currentTime = 3.5;
    engine.syncFromSnapshot(
      makeSnapshot({
        tick: 10,
        phase: 'playing',
        loadout: { weapon: 2, body: 1, engine: 4 },
        health: 10,
        maxHealth: 10,
      }),
    );
    let metrics = engine.getSyncMetrics();
    expect(metrics.musicState).toBe('combat');
    expect(metrics.alarmActive).toBe(false);
    expect(metrics.activeStems).toEqual([
      'luftrauser_bass2',
      'luftrauser_drums5',
      'luftrauser_lead3',
    ]);
    expect(metrics.interStemDriftMs).toBeLessThan(1.0);
    expect(metrics.interStemDriftMs).toBeLessThan(0.01);

    // Hangar source (index 0) was ramped to 0 and scheduled to stop
    const hangarSource = mockCtx._inspect.sources[0];
    expect(hangarSource?.stoppedAt).toBeCloseTo(3.545, 5);
    expect(mockCtx._inspect.sources).toHaveLength(4);
    const expectedCombatOffset = computePhaseOffset(
      3.5,
      1.02,
      SYNTH_LOOP_DURATION_SEC,
    );
    for (let i = 1; i <= 3; i++) {
      expect(mockCtx._inspect.sources[i]?.startedAt).toBeCloseTo(3.5, 6);
      expect(mockCtx._inspect.sources[i]?.startedOffset).toBeCloseTo(
        expectedCombatOffset,
        6,
      );
    }

    // Transition Combat -> Low-HP Alarm at t = 8.75s (existing 3 stems MUST keep running!)
    mockCtx.currentTime = 8.75;
    engine.syncFromSnapshot(
      makeSnapshot({
        tick: 20,
        phase: 'playing',
        loadout: { weapon: 2, body: 1, engine: 4 },
        health: 2,
        maxHealth: 10,
      }),
    );
    metrics = engine.getSyncMetrics();
    expect(metrics.musicState).toBe('combat');
    expect(metrics.alarmActive).toBe(true);
    expect(metrics.activeStems).toEqual([
      'luftrauser_bass2',
      'luftrauser_drums5',
      'luftrauser_lead3',
      'luftrauser_drums_alarm',
    ]);
    expect(mockCtx._inspect.sources).toHaveLength(5); // only alarm added!
    expect(mockCtx._inspect.sources[4]?.startedOffset).toBeCloseTo(
      computePhaseOffset(8.75, 1.02, SYNTH_LOOP_DURATION_SEC),
      6,
    );
    expect(metrics.interStemDriftMs).toBeLessThan(1.0);

    // Transition Low-HP Alarm -> Pause at t = 12.2s
    mockCtx.currentTime = 12.2;
    engine.syncFromSnapshot(
      makeSnapshot({
        tick: 30,
        phase: 'playing',
        paused: true,
        loadout: { weapon: 2, body: 1, engine: 4 },
        health: 2,
        maxHealth: 10,
      }),
    );
    metrics = engine.getSyncMetrics();
    expect(metrics.musicState).toBe('pause');
    expect(metrics.alarmActive).toBe(false);
    expect(metrics.activeStems).toEqual(['luftrauser__pause']);
    expect(metrics.interStemDriftMs).toBeLessThan(1.0);

    // Transition Pause -> Urauser at t = 19.4s
    mockCtx.currentTime = 19.4;
    engine.syncFromSnapshot(
      makeSnapshot({
        tick: 40,
        phase: 'playing',
        paused: false,
        loadout: { weapon: 5, body: 5, engine: 5 },
        health: 120,
        maxHealth: 120,
      }),
    );
    metrics = engine.getSyncMetrics();
    expect(metrics.musicState).toBe('urauser');
    expect(metrics.alarmActive).toBe(false);
    expect(metrics.activeStems).toEqual(['luftrauser__urauser']);
    expect(metrics.interStemDriftMs).toBeLessThan(1.0);

    engine.dispose();
  });

  it('pools SFX voices (max 24), enforces 25ms per-cue cooldown, routes spatial *dist/pan, and mutes cleanly', async () => {
    const mockCtx = createMockAudioContext('running', 44100);
    const engine = new AudioEngine({
      context: mockCtx as unknown as AudioContext,
    });
    await engine.init(makeFallbackVault('procedural-fallback'));

    mockCtx.currentTime = 5.0;
    // Spatial offscreen cue routes to *dist and clamped pan
    engine.playSfx('sndebullet', 1500, 0, 1);
    expect(engine.getSyncMetrics().sfxPoolActive).toBe(1);
    const lastPanner =
      mockCtx._inspect.panners[mockCtx._inspect.panners.length - 1];
    expect(lastPanner?.pan.value).toBe(0.85);
    const lastSource =
      mockCtx._inspect.sources[mockCtx._inspect.sources.length - 1];
    expect(lastSource?.loop).toBe(false);

    // Same cue within 25ms is throttled by anti-spam cooldown
    mockCtx.currentTime = 5.01;
    engine.playSfx('sndebullet', 1500, 0, 1);
    expect(engine.getSyncMetrics().sfxPoolActive).toBe(1);

    // After >= 25ms, same cue plays again
    mockCtx.currentTime = 5.03;
    engine.playSfx('sndebullet', -500, 0, 1);
    expect(engine.getSyncMetrics().sfxPoolActive).toBe(2);

    // Flood with 35 distinct cues within 17.5ms (so none expire naturally) -> capped strictly at 24 active voices
    const distinctCues = ALL_AUDIO_CUE_IDS.filter(
      (c) => c !== 'sndebullet' && c !== 'sndebulletdist',
    );
    for (let i = 0; i < 35; i++) {
      mockCtx.currentTime += 0.0005;
      const cue = distinctCues[i]!;
      engine.playSfx(cue, 0, 0, 1);
    }
    expect(engine.getSyncMetrics().sfxPoolActive).toBe(24);

    // Mute sets masterGain to 0 and skips spawning new SFX
    engine.setMuted(true);
    expect(engine.getSyncMetrics().muted).toBe(true);
    expect(mockCtx._inspect.gains[0]?.gain.value).toBe(0);
    const countBeforeMutedSfx = mockCtx._inspect.sources.length;
    mockCtx.currentTime += 1.0; // expire old voices too
    expect(engine.getSyncMetrics().sfxPoolActive).toBe(0);
    engine.playSfx('sndnuke');
    expect(mockCtx._inspect.sources.length).toBe(countBeforeMutedSfx);

    // Unmute restores masterGain to 1
    engine.setMuted(false);
    expect(engine.getSyncMetrics().muted).toBe(false);
    expect(mockCtx._inspect.gains[0]?.gain.value).toBe(1);

    // syncFromSnapshot processes audioEvents once per array reference
    const sharedEvents = [{ cue: 'sndbullet' as const, x: 50, volume: 0.9 }];
    const snap = makeSnapshot({
      phase: 'playing',
      cameraTargetX: 0,
      audioEvents: sharedEvents,
    });
    engine.syncFromSnapshot(snap);
    expect(engine.getSyncMetrics().sfxPoolActive).toBe(1);
    mockCtx.currentTime += 0.05;
    engine.syncFromSnapshot(snap); // same snapshot/events ref -> does not duplicate gunshot
    expect(engine.getSyncMetrics().sfxPoolActive).toBe(1);

    engine.dispose();
    expect(engine.getSyncMetrics().sfxPoolActive).toBe(0);
  });

  it('loads Steam OGG/WAV buffers concurrently and falls back per-buffer to synth on fetch/decode failure', async () => {
    const mockCtx = createMockAudioContext('running', 44100);
    const fakeSteamBuffer = createMockAudioBuffer(1, 302400, 44100);
    mockCtx.decodeAudioData = vi.fn(async (buf: ArrayBuffer) => {
      const marker = new Uint8Array(buf)[0];
      if (marker === 99) {
        throw new Error('corrupt audio');
      }
      return fakeSteamBuffer;
    });

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('fail')) {
        return { ok: false, status: 404 } as Response;
      }
      const bytes = new Uint8Array(4);
      bytes[0] = url.includes('corrupt') ? 99 : 1;
      return {
        ok: true,
        arrayBuffer: async () => bytes.buffer,
      } as Response;
    });

    const engine = new AudioEngine({
      context: mockCtx as unknown as AudioContext,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await engine.init(
      makeFallbackVault(
        'steam-local',
        {
          luftrauser__hangar: '/steam-vault/bgm/luftrauser__hangar.ogg',
          luftrauser_bass1: '/steam-vault/bgm/luftrauser_bass1.ogg',
          luftrauser_drums1: '/steam-vault/bgm/fail-drums1.ogg',
          luftrauser_lead1: '/steam-vault/bgm/corrupt-lead1.ogg',
        },
        {
          sndbullet: '/steam-vault/sfx/sndbullet.wav',
          sndnuke: '/steam-vault/sfx/fail-nuke.wav',
        },
      ),
    );

    expect(mockFetch).toHaveBeenCalledTimes(6);
    expect(engine.getSyncMetrics().source).toBe('steam-ogg');

    // Combat uses decoded Steam bass1 + synth fallbacks for failed drums1 & corrupt lead1
    engine.syncFromSnapshot(
      makeSnapshot({
        phase: 'playing',
        loadout: { weapon: 0, body: 0, engine: 0 },
      }),
    );
    expect(engine.getSyncMetrics().activeStems).toEqual([
      'luftrauser_bass1',
      'luftrauser_drums1',
      'luftrauser_lead1',
    ]);
    expect(engine.getSyncMetrics().interStemDriftMs).toBeLessThan(1.0);

    // Failed SFX falls back smoothly to synth without throwing
    engine.playSfx('sndbullet');
    engine.playSfx('sndnuke');
    expect(engine.getSyncMetrics().sfxPoolActive).toBe(2);

    // Firing onended releases SFX voice cleanly
    const lastSfx =
      mockCtx._inspect.sources[mockCtx._inspect.sources.length - 1];
    lastSfx?.onended?.();
    expect(engine.getSyncMetrics().sfxPoolActive).toBe(1);

    engine.dispose();
  });

  it('handles failed resume(), missing optional Web Audio nodes, and headless mode gracefully', async () => {
    // 1. Headless mode (no AudioContext in globalThis)
    const headless = new AudioEngine();
    await headless.init(makeFallbackVault('procedural-fallback'));
    headless.syncFromSnapshot(makeSnapshot({ phase: 'playing' }));
    await headless.unlock();
    headless.playSfx('sndbullet');
    expect(headless.getSyncMetrics()).toMatchObject({
      unlocked: false,
      source: 'synth-fallback',
      musicState: 'combat',
      interStemDriftMs: 0,
      sfxPoolActive: 0,
    });
    headless.dispose();

    // 2. Rejected resume() followed by successful unlock() & minimal mock without panner/compressor
    const minimalCtx = createMockAudioContext('suspended', 44100);
    // Remove optional nodes to verify graceful fallback
    const minimalRaw = minimalCtx as unknown as Record<string, unknown>;
    delete minimalRaw['createStereoPanner'];
    delete minimalRaw['createDynamicsCompressor'];

    let shouldFailResume = true;
    minimalCtx.resume = vi.fn(async () => {
      if (shouldFailResume) {
        throw new Error('NotAllowedError');
      }
      minimalCtx.state = 'running';
    });

    const engine = new AudioEngine({
      context: minimalCtx as unknown as AudioContext,
    });
    await engine.init(makeFallbackVault('procedural-fallback'));
    engine.syncFromSnapshot(makeSnapshot({ phase: 'hangar' }));

    await engine.unlock();
    expect(engine.getSyncMetrics().unlocked).toBe(false);
    expect(minimalCtx._inspect.sources).toHaveLength(0);

    shouldFailResume = false;
    await engine.unlock();
    expect(engine.getSyncMetrics().unlocked).toBe(true);
    expect(minimalCtx._inspect.sources).toHaveLength(1);

    // Verify 40ms linearRampToValueAtTime fade-in on stem GainNode
    const stemGain = minimalCtx._inspect.gains[3];
    expect(
      stemGain?.gain.calls.some(
        (c) => c.type === 'linearRampToValueAtTime' && c.args[0] === 1,
      ),
    ).toBe(true);

    // SFX works cleanly even without StereoPannerNode
    engine.playSfx('sndbullet', 500, 0, 1);
    expect(engine.getSyncMetrics().sfxPoolActive).toBe(1);

    engine.dispose();
  });
});
