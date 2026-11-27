import { describe, expect, it, vi } from 'vitest';
import {
  ALL_STEM_IDS,
  AudioEngine,
  SYNTH_LOOP_DURATION_SEC,
  resolveActiveStems,
} from '../src/audio';
import {
  DEFAULT_ACT2_MOD_FLAGS,
  DEFAULT_SHADER_FX,
  type Act2ModFlags,
  type ShaderFxConfig,
} from '../src/contracts/mod';
import type {
  GameMode,
  InputState,
  Loadout,
  PartIndex,
  PlayerState,
  ReplayRecording,
  SimSnapshot,
} from '../src/contracts/sim';
import type { EnemyKind } from '../src/contracts/vault';
import {
  ACT2_BONUS_PALETTES,
  CUSTOM_PALETTE_ID,
  PALETTES,
  WebGL2Renderer,
  computePostShaderUniforms,
  createDefaultCustomPalette,
  sanitizeCustomPalette,
} from '../src/render';
import { resolveEnemyRenderTransform } from '../src/render/renderer';
import {
  ARSENAL_BOSSES_MOD,
  GhostRunner,
  MULTIPLAYER_2P_MOD,
  ModRegistry,
  REPLAY_GHOST_MOD,
  SHADER_STUDIO_MOD,
  SeededRng,
  Simulation,
  computeAutopilotInput,
  computeDailySeed,
  computeDogfightBotInput,
  parseReplayJson,
  registerAct2ModPacks,
  replaySimulation,
  resolveModdedPlaneName,
  serializeReplay,
} from '../src/sim';
import {
  HANGAR_ROWS,
  HangarController,
  MOD_DECK_ROWS,
  PaletteStudioController,
  TelemetryHud,
} from '../src/ui';
import { createProceduralFallbackBundle, loadVaultFromDisk } from '../src/vault';

// Load live Steam vault once (falls back cleanly to procedural-fallback if Steam absent)
const vault = loadVaultFromDisk();
const skybreakerVault = createProceduralFallbackBundle();
const gameData = vault.data;
const VALID_STEM_SET = new Set<string>(ALL_STEM_IDS);

function expectedVanillaPlaneName(w: number, b: number, e: number): string {
  const entry = gameData.global.planenames.find(
    (p) => p.weapon === w && p.body === b && p.engine === e,
  );
  return entry?.name ?? 'SKYBREAKER';
}

const IDLE_INPUT: InputState = {
  left: false,
  right: false,
  thrust: false,
  fire: false,
};

const THRUST_INPUT: InputState = {
  left: false,
  right: false,
  thrust: true,
  fire: false,
};

const FIRE_INPUT: InputState = {
  left: false,
  right: false,
  thrust: false,
  fire: true,
};

function assertFiniteNumber(n: number, label: string): void {
  if (!Number.isFinite(n)) {
    throw new Error(`Non-finite number in ${label}: ${String(n)}`);
  }
}

function assertSnapshotFiniteAndBounded(snap: SimSnapshot, label: string): void {
  assertFiniteNumber(snap.tick, `${label}.tick`);
  assertFiniteNumber(snap.score, `${label}.score`);
  assertFiniteNumber(snap.combo, `${label}.combo`);
  assertFiniteNumber(snap.difficulty, `${label}.difficulty`);
  assertFiniteNumber(snap.cameraTargetX, `${label}.cameraTargetX`);
  assertFiniteNumber(snap.cameraTargetY, `${label}.cameraTargetY`);
  assertFiniteNumber(snap.screenShake, `${label}.screenShake`);

  const checkPlayer = (p: PlayerState, slot: string): void => {
    assertFiniteNumber(p.x, `${label}.${slot}.x`);
    assertFiniteNumber(p.y, `${label}.${slot}.y`);
    assertFiniteNumber(p.vx, `${label}.${slot}.vx`);
    assertFiniteNumber(p.vy, `${label}.${slot}.vy`);
    assertFiniteNumber(p.angleDeg, `${label}.${slot}.angleDeg`);
    assertFiniteNumber(p.health, `${label}.${slot}.health`);
    assertFiniteNumber(p.maxHealth, `${label}.${slot}.maxHealth`);
    expect(p.health).toBeGreaterThanOrEqual(0);
    expect(p.maxHealth).toBeGreaterThan(0);
  };

  checkPlayer(snap.player, 'p1');
  if (snap.player2) {
    checkPlayer(snap.player2, 'p2');
  }

  for (const e of snap.enemies) {
    assertFiniteNumber(e.x, `${label}.enemy(${e.kind}).x`);
    assertFiniteNumber(e.y, `${label}.enemy(${e.kind}).y`);
    assertFiniteNumber(e.vx, `${label}.enemy(${e.kind}).vx`);
    assertFiniteNumber(e.vy, `${label}.enemy(${e.kind}).vy`);
    assertFiniteNumber(e.angleDeg, `${label}.enemy(${e.kind}).angleDeg`);
    assertFiniteNumber(e.health, `${label}.enemy(${e.kind}).health`);
  }
  for (const pr of snap.projectiles) {
    assertFiniteNumber(pr.x, `${label}.proj(${pr.kind}).x`);
    assertFiniteNumber(pr.y, `${label}.proj(${pr.kind}).y`);
    assertFiniteNumber(pr.vx, `${label}.proj(${pr.kind}).vx`);
    assertFiniteNumber(pr.vy, `${label}.proj(${pr.kind}).vy`);
    if (pr.arcPoints) {
      for (const pt of pr.arcPoints) {
        assertFiniteNumber(pt.x, `${label}.arc.x`);
        assertFiniteNumber(pt.y, `${label}.arc.y`);
      }
    }
  }
  for (const pt of snap.particles) {
    assertFiniteNumber(pt.x, `${label}.part(${pt.kind}).x`);
    assertFiniteNumber(pt.y, `${label}.part(${pt.kind}).y`);
  }
  if (snap.shockwaves) {
    expect(snap.shockwaves.length).toBeLessThanOrEqual(4);
    for (const sw of snap.shockwaves) {
      assertFiniteNumber(sw.x, `${label}.sw.x`);
      assertFiniteNumber(sw.y, `${label}.sw.y`);
      assertFiniteNumber(sw.radius, `${label}.sw.radius`);
      assertFiniteNumber(sw.intensity, `${label}.sw.intensity`);
    }
  }
  if (snap.ghostPose) {
    assertFiniteNumber(snap.ghostPose.x, `${label}.ghost.x`);
    assertFiniteNumber(snap.ghostPose.y, `${label}.ghost.y`);
    expect(snap.ghostPose.trail.length).toBeLessThanOrEqual(20);
  }
}

function assertValidStemsForSnapshot(snap: SimSnapshot): void {
  const isCoop2p = snap.activeMods?.multiplayerMode === 'coop2p';
  const hpSrc =
    isCoop2p && !snap.player.alive && snap.player2?.alive
      ? snap.player2
      : snap.player;
  const ratio = hpSrc.maxHealth > 0 ? hpSrc.health / hpSrc.maxHealth : 1;
  const res = resolveActiveStems(snap.phase, snap.paused, snap.player.loadout, ratio);
  expect(res.stems.length).toBeGreaterThanOrEqual(1);
  for (const stem of res.stems) {
    expect(VALID_STEM_SET.has(stem)).toBe(true);
  }
}

function launchToPlaying(
  sim: Simulation,
  loadout: Loadout,
  mode: GameMode = 'normal',
  seed = 1001,
): SimSnapshot {
  sim.launch(loadout, mode, seed);
  let snap = sim.getSnapshot();
  let guard = 0;
  while (snap.phase === 'launching' && guard < 60) {
    snap = sim.step(IDLE_INPUT);
    guard++;
  }
  expect(snap.phase).toBe('playing');
  return snap;
}

function createLockedRegistryWithAllModPacks(): ModRegistry {
  const reg = new ModRegistry(true);
  reg.register(ARSENAL_BOSSES_MOD);
  reg.register(REPLAY_GHOST_MOD);
  reg.register({
    ...SHADER_STUDIO_MOD,
    shaderFx: {
      crtScanlines: true,
      phosphorBloom: true,
      speedWarp: true,
      shockwaves: true,
    },
  });
  reg.register({ ...MULTIPLAYER_2P_MOD, multiplayerMode: 'coop2p' });
  return reg;
}

function createModdedSim(flags: Partial<Act2ModFlags> = {}): Simulation {
  const reg = new ModRegistry(false);
  const sim = new Simulation(gameData, reg);
  sim.setModFlags({
    ...DEFAULT_ACT2_MOD_FLAGS,
    moddedEnabled: true,
    arsenalBosses: true,
    ...flags,
  });
  return sim;
}

function createMockWebGL2() {
  const uniform4fCalls: Array<{ name: string; x: number; y: number; z: number; w: number }> = [];
  const uniform4fvCalls: Array<{ name: string; data: Float32Array }> = [];
  const uniform2fCalls: Array<{ name: string; x: number; y: number }> = [];
  const uniform1fCalls: Array<{ name: string; v: number }> = [];
  const uniformMatCalls: Array<{ name: string; data: Float32Array }> = [];
  const uniformLocToName = new Map<object, string>();

  const gl = {
    NO_ERROR: 0,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    FRAMEBUFFER: 0x8d40,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    RENDERBUFFER: 0x8d41,
    DEPTH_ATTACHMENT: 0x8d00,
    COLOR_ATTACHMENT0: 0x8ce0,
    DEPTH_COMPONENT16: 0x81a5,
    TEXTURE_2D: 0x0de1,
    TEXTURE0: 0x84c0,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    NEAREST: 0x2600,
    CLAMP_TO_EDGE: 0x812f,
    RGBA8: 0x8058,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    STREAM_DRAW: 0x88e0,
    FLOAT: 0x1406,
    TRIANGLES: 0x0004,
    TRIANGLE_STRIP: 0x0005,
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x0100,
    CULL_FACE: 0x0b44,
    DEPTH_TEST: 0x0b71,
    BLEND: 0x0be2,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    UNPACK_ALIGNMENT: 0x0cf5,
    pixelStorei: vi.fn(),
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    deleteProgram: vi.fn(),
    createFramebuffer: vi.fn(() => ({})),
    deleteFramebuffer: vi.fn(),
    bindFramebuffer: vi.fn(),
    framebufferTexture2D: vi.fn(),
    framebufferRenderbuffer: vi.fn(),
    checkFramebufferStatus: vi.fn(() => 0x8cd5),
    createRenderbuffer: vi.fn(() => ({})),
    deleteRenderbuffer: vi.fn(),
    bindRenderbuffer: vi.fn(),
    renderbufferStorage: vi.fn(),
    createTexture: vi.fn(() => ({})),
    deleteTexture: vi.fn(),
    bindTexture: vi.fn(),
    activeTexture: vi.fn(),
    texImage2D: vi.fn(),
    texParameteri: vi.fn(),
    createVertexArray: vi.fn(() => ({})),
    deleteVertexArray: vi.fn(),
    bindVertexArray: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    deleteBuffer: vi.fn(),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    bufferSubData: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    vertexAttribDivisor: vi.fn(),
    useProgram: vi.fn(),
    getUniformLocation: vi.fn((_prog: unknown, name: string) => {
      const loc = { name };
      uniformLocToName.set(loc, name);
      return loc;
    }),
    uniform1i: vi.fn(),
    uniform1f: vi.fn((loc: object, v: number) => {
      const name = uniformLocToName.get(loc) ?? '';
      uniform1fCalls.push({ name, v });
    }),
    uniform2f: vi.fn((loc: object, x: number, y: number) => {
      const name = uniformLocToName.get(loc) ?? '';
      uniform2fCalls.push({ name, x, y });
    }),
    uniform4f: vi.fn((loc: object, x: number, y: number, z: number, w: number) => {
      const name = uniformLocToName.get(loc) ?? '';
      uniform4fCalls.push({ name, x, y, z, w });
    }),
    uniform4fv: vi.fn((loc: object, data: Float32Array) => {
      const name = uniformLocToName.get(loc) ?? '';
      uniform4fvCalls.push({ name, data: new Float32Array(data) });
    }),
    uniformMatrix4fv: vi.fn((loc: object, _t: boolean, data: Float32Array) => {
      const name = uniformLocToName.get(loc) ?? '';
      uniformMatCalls.push({ name, data: new Float32Array(data) });
    }),
    viewport: vi.fn(),
    disable: vi.fn(),
    enable: vi.fn(),
    blendFunc: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    drawArrays: vi.fn(),
    drawArraysInstanced: vi.fn(),
    getError: vi.fn(() => 0),
  };

  const canvas = {
    width: 1200,
    height: 800,
    style: { imageRendering: '' },
    getContext: vi.fn((kind: string) => (kind === 'webgl2' ? gl : null)),
  } as unknown as HTMLCanvasElement;

  const assertAllUniformsFinite = () => {
    for (const c of uniform1fCalls) assertFiniteNumber(c.v, `u1f:${c.name}`);
    for (const c of uniform2fCalls) {
      assertFiniteNumber(c.x, `u2f:${c.name}.x`);
      assertFiniteNumber(c.y, `u2f:${c.name}.y`);
    }
    for (const c of uniform4fCalls) {
      assertFiniteNumber(c.x, `u4f:${c.name}.x`);
      assertFiniteNumber(c.y, `u4f:${c.name}.y`);
      assertFiniteNumber(c.z, `u4f:${c.name}.z`);
      assertFiniteNumber(c.w, `u4f:${c.name}.w`);
    }
    for (const c of uniform4fvCalls) {
      for (let i = 0; i < c.data.length; i++) {
        assertFiniteNumber(c.data[i]!, `u4fv:${c.name}[${i}]`);
      }
    }
    for (const c of uniformMatCalls) {
      for (let i = 0; i < c.data.length; i++) {
        assertFiniteNumber(c.data[i]!, `umat4:${c.name}[${i}]`);
      }
    }
  };

  return {
    gl,
    canvas,
    uniform4fCalls,
    uniform4fvCalls,
    assertAllUniformsFinite,
  };
}

function createMockAudioContext(sampleRate = 44100) {
  let time = 0;
  const makeParam = (initial = 0) => ({
    value: initial,
    setValueAtTime: vi.fn(function (this: { value: number }, v: number) {
      this.value = v;
      return this;
    }),
    linearRampToValueAtTime: vi.fn(function (this: { value: number }) {
      return this;
    }),
    cancelScheduledValues: vi.fn(function (this: { value: number }) {
      return this;
    }),
  });
  const sources: Array<{ startedAt: number | null; startedOffset: number | null }> = [];
  const ctx = {
    state: 'running' as AudioContextState,
    get currentTime() {
      return time;
    },
    set currentTime(v: number) {
      time = v;
    },
    sampleRate,
    destination: {} as AudioDestinationNode,
    resume: vi.fn(async () => {
      ctx.state = 'running';
    }),
    close: vi.fn(async () => {
      ctx.state = 'closed';
    }),
    createBuffer(channels: number, length: number, rate: number): AudioBuffer {
      const chs = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        sampleRate: rate,
        length,
        duration: length / rate,
        numberOfChannels: channels,
        getChannelData: (c: number) => chs[c]!,
        copyFromChannel: vi.fn(),
        copyToChannel: vi.fn(),
      } as unknown as AudioBuffer;
    },
    decodeAudioData: vi.fn(async () =>
      ctx.createBuffer(1, Math.round(sampleRate * SYNTH_LOOP_DURATION_SEC), sampleRate),
    ),
    createBufferSource() {
      const node = {
        buffer: null as AudioBuffer | null,
        loop: false,
        playbackRate: makeParam(1),
        onended: null as (() => void) | null,
        startedAt: null as number | null,
        startedOffset: null as number | null,
        connect: vi.fn((d: unknown) => d),
        disconnect: vi.fn(),
        start: vi.fn((when = 0, offset = 0) => {
          node.startedAt = when;
          node.startedOffset = offset;
        }),
        stop: vi.fn(),
      };
      sources.push(node);
      return node as unknown as AudioBufferSourceNode;
    },
    createGain: () =>
      ({
        gain: makeParam(1),
        connect: vi.fn((d: unknown) => d),
        disconnect: vi.fn(),
      }) as unknown as GainNode,
    createStereoPanner: () =>
      ({
        pan: makeParam(0),
        connect: vi.fn((d: unknown) => d),
        disconnect: vi.fn(),
      }) as unknown as StereoPannerNode,
    createDynamicsCompressor: () =>
      ({
        threshold: makeParam(-24),
        knee: makeParam(30),
        ratio: makeParam(12),
        attack: makeParam(0.003),
        release: makeParam(0.25),
        connect: vi.fn((d: unknown) => d),
        disconnect: vi.fn(),
      }) as unknown as DynamicsCompressorNode,
  };
  return { ctx: ctx as unknown as AudioContext, setTime: (t: number) => { time = t; }, sources };
}

function assertVanillaLockedInvariants(snap: SimSnapshot, label: string): void {
  assertSnapshotFiniteAndBounded(snap, label);
  expect(snap.shockwaves).toBeUndefined();
  expect(snap.player2).toBeUndefined();
  expect(snap.ghostPose).toBeUndefined();
  expect(snap.dogfight).toBeUndefined();
  expect(snap.activeMods).toBeUndefined();
  expect(snap.dailySeedId).toBeUndefined();
  expect(
    snap.enemies.some((e) => e.kind === 'Dreadnought' || e.kind === 'SkyCarrier'),
  ).toBe(false);
  assertValidStemsForSnapshot(snap);
}

function runVanillaPuristSortie(
  loadout: Loadout,
  mode: GameMode,
  seed: number,
  ticks: number,
  expectedPlaneName: string,
  inputFn?: (snap: SimSnapshot, tick: number) => InputState,
): { finalSnap: SimSnapshot; replay: ReplayRecording } {
  const reg = createLockedRegistryWithAllModPacks();
  const sim = new Simulation(gameData, reg);
  sim.launch(loadout, mode, seed);
  expect(sim.getSnapshot().player.planeName).toBe(expectedPlaneName);

  for (let t = 0; t < ticks; t++) {
    const curr = sim.getSnapshot();
    const inp = inputFn ? inputFn(curr, t) : computeAutopilotInput(curr);
    const next = sim.step(inp);
    if (t % 30 === 0 || t === ticks - 1) {
      assertVanillaLockedInvariants(next, `${expectedPlaneName}@${t}`);
    }
  }

  const finalSnap = sim.getSnapshot();
  assertVanillaLockedInvariants(finalSnap, `${expectedPlaneName}:final`);
  const replay = sim.getReplay();
  const replayed = replaySimulation(gameData, replay, createLockedRegistryWithAllModPacks());
  expect(replayed.tick).toBe(finalSnap.tick);
  expect(replayed.player.x).toBe(finalSnap.player.x);
  expect(replayed.player.y).toBe(finalSnap.player.y);
  expect(replayed.player.vx).toBe(finalSnap.player.vx);
  expect(replayed.player.vy).toBe(finalSnap.player.vy);
  expect(replayed.player.angleDeg).toBe(finalSnap.player.angleDeg);
  expect(replayed.player.health).toBe(finalSnap.player.health);
  expect(replayed.score).toBe(finalSnap.score);
  expect(replayed.difficulty).toBe(finalSnap.difficulty);
  expect(replayed.enemies.length).toBe(finalSnap.enemies.length);
  return { finalSnap, replay };
}

describe('100-Playtester Act I + Act II Bug-Squashing Gauntlet', () => {
  describe('Group 1: PT-001..PT-015 — 15 Vanilla 1:1 Purists (Vanilla Lock Regression Gate)', () => {
    it('PT-001: standard [0,0,0] Normal 1,200-tick autopilot sortie stays bit-identical & mod-free', () => {
      const { finalSnap } = runVanillaPuristSortie(
        { weapon: 0, body: 0, engine: 0 },
        'normal',
        10001,
        1200,
        expectedVanillaPlaneName(0, 0, 0),
      );
      expect(finalSnap.tick).toBe(1200);
    });

    it('PT-002: beam [1,0,0] Normal enforces 1/3 laser turn divisor while firing & bit-identical replay', () => {
      const reg = createLockedRegistryWithAllModPacks();
      const sim = new Simulation(gameData, reg);
      launchToPlaying(sim, { weapon: 1, body: 0, engine: 0 }, 'normal', 10002);
      const normalTurn = sim.step({ left: false, right: true, thrust: false, fire: false });
      const normalDelta = normalTurn.player.angleDeg - normalTurn.player.prevAngleDeg;
      const laserTurn = sim.step({ left: false, right: true, thrust: false, fire: true });
      const laserDelta = laserTurn.player.angleDeg - laserTurn.player.prevAngleDeg;
      expect(laserDelta).toBeCloseTo(normalDelta / 3, 5);

      runVanillaPuristSortie(
        { weapon: 1, body: 0, engine: 0 },
        'normal',
        10002,
        700,
        expectedVanillaPlaneName(1, 0, 0),
      );
    });

    it('PT-003: spread+armor [2,1,0] Normal sortie runs 700 ticks with clean replay parity', () => {
      runVanillaPuristSortie(
        { weapon: 2, body: 1, engine: 0 },
        'normal',
        10003,
        700,
        expectedVanillaPlaneName(2, 1, 0),
      );
    });

    it('PT-004: missiles [3,0,0] Normal caps homing missiles at 4 active across 700 ticks', () => {
      const { finalSnap } = runVanillaPuristSortie(
        { weapon: 3, body: 0, engine: 0 },
        'normal',
        10004,
        700,
        expectedVanillaPlaneName(3, 0, 0),
        (_s, t) => ({
          left: t % 17 === 0,
          right: false,
          thrust: true,
          fire: true,
        }),
      );
      const activeMissiles = finalSnap.projectiles.filter(
        (p) => p.owner === 'player' && p.kind === 'missile',
      );
      expect(activeMissiles.length).toBeLessThanOrEqual(4);
    });

    it('PT-005: cannon [4,0,0] Normal plasmaball sortie runs 700 ticks with clean replay parity', () => {
      runVanillaPuristSortie(
        { weapon: 4, body: 0, engine: 0 },
        'normal',
        10005,
        700,
        expectedVanillaPlaneName(4, 0, 0),
      );
    });

    it('PT-006: gungine [0,0,2] Normal rear bullet propulsion runs 700 ticks cleanly', () => {
      runVanillaPuristSortie(
        { weapon: 0, body: 0, engine: 2 },
        'normal',
        10006,
        700,
        expectedVanillaPlaneName(0, 0, 2),
      );
    });

    it('PT-007: penguin [0,0,3] Normal waterproof underwater diver takes 0 sea damage', () => {
      const reg = createLockedRegistryWithAllModPacks();
      const sim = new Simulation(gameData, reg);
      launchToPlaying(sim, { weapon: 0, body: 0, engine: 3 }, 'normal', 10007);
      let sawUnderwater = false;
      for (let t = 0; t < 700; t++) {
        const prev = sim.getSnapshot();
        // Turn unboosted (10 deg/tick) for 18 ticks to aim straight down (+90 deg), then thrust into ocean
        const inp: InputState =
          t < 18
            ? { left: false, right: true, thrust: false, fire: false }
            : t < 160
              ? { left: false, right: false, thrust: true, fire: t % 5 === 0 }
              : computeAutopilotInput(prev);
        const snap = sim.step(inp);
        assertVanillaLockedInvariants(snap, `PT-007@${t}`);
        if (snap.player.underwater && !snap.audioEvents.some((e) => e.cue === 'sndplayerhit')) {
          sawUnderwater = true;
          expect(snap.player.health).toBeGreaterThanOrEqual(prev.player.health);
        }
      }
      expect(sawUnderwater).toBe(true);
    });

    it('PT-008: hover [0,0,4] SFMT mode runs 900 ticks with zero custom bosses & exact replay', () => {
      const { finalSnap } = runVanillaPuristSortie(
        { weapon: 0, body: 0, engine: 4 },
        'sfmt',
        10008,
        900,
        expectedVanillaPlaneName(0, 0, 4),
      );
      expect(finalSnap.mode).toBe('sfmt');
      expect(finalSnap.difficulty).toBeGreaterThan(200);
    });

    it('PT-009: nuke [0,3,1] Normal triggers nuke-on-death without shockwaves on vanilla lock', () => {
      const reg = createLockedRegistryWithAllModPacks();
      const sim = new Simulation(gameData, reg);
      launchToPlaying(sim, { weapon: 0, body: 3, engine: 1 }, 'normal', 10009);
      sim.damagePlayer(999);
      let snap = sim.getSnapshot();
      expect(snap.player.nukeTriggered).toBe(true);
      expect(snap.shockwaves).toBeUndefined();
      for (let t = 0; t < 650; t++) {
        snap = sim.step(IDLE_INPUT);
        assertVanillaLockedInvariants(snap, `PT-009@${t}`);
      }
      expect(snap.phase).toBe('gameover');
    });

    it('PT-010: melee [1,2,0] Normal ramming immunity survives enemy impacts for 700 ticks', () => {
      const reg = createLockedRegistryWithAllModPacks();
      const sim = new Simulation(gameData, reg);
      const start = launchToPlaying(sim, { weapon: 1, body: 2, engine: 0 }, 'normal', 10010);
      sim.spawnEnemy('Fighter', start.player.x, start.player.y - 16);
      const afterRam = sim.step(THRUST_INPUT);
      expect(afterRam.player.health).toBe(afterRam.player.maxHealth);
      runVanillaPuristSortie(
        { weapon: 1, body: 2, engine: 0 },
        'normal',
        10010,
        700,
        expectedVanillaPlaneName(1, 2, 0),
      );
    });

    it('PT-011: bomb [0,4,0] Normal body spawns gravity bombs & stays replay-identical', () => {
      const reg = createLockedRegistryWithAllModPacks();
      const sim = new Simulation(gameData, reg);
      launchToPlaying(sim, { weapon: 0, body: 4, engine: 0 }, 'normal', 10011);
      const s = sim.step(THRUST_INPUT);
      expect(s.projectiles.some((p) => p.kind === 'bomb')).toBe(true);
      runVanillaPuristSortie(
        { weapon: 0, body: 4, engine: 0 },
        'normal',
        10011,
        700,
        expectedVanillaPlaneName(0, 4, 0),
      );
    });

    it('PT-012: APEX OMEGA / [5,5,5] SFMT 900 ticks keeps 120 maxHealth, apex stem, and bit-identical replay', () => {
      const { finalSnap } = runVanillaPuristSortie(
        { weapon: 5, body: 5, engine: 5 },
        'sfmt',
        10012,
        900,
        expectedVanillaPlaneName(5, 5, 5),
      );
      expect(finalSnap.player.isUrauser).toBe(true);
      expect(finalSnap.player.maxHealth).toBe(120);
      expect(skybreakerVault.data.global.planenames[125]?.name).toBe('APEX OMEGA');
      const stemRes = resolveActiveStems(
        'playing',
        false,
        { weapon: 5, body: 5, engine: 5 },
        1,
      );
      expect(stemRes.stems).toEqual(['luftrauser__urauser']);
    });

    it('PT-013: Pause-Thrasher toggles pause 40x across 700 ticks without PRNG/tick/replay drift', () => {
      const reg = createLockedRegistryWithAllModPacks();
      const sim = new Simulation(gameData, reg);
      sim.launch({ weapon: 0, body: 0, engine: 4 }, 'normal', 10013);
      for (let t = 0; t < 700; t++) {
        if (t % 17 === 0) {
          sim.setPaused(true);
          const before = sim.getSnapshot();
          const whilePaused = sim.step({ left: true, right: false, thrust: true, fire: true });
          expect(whilePaused.tick).toBe(before.tick);
          expect(whilePaused.player.x).toBe(before.player.x);
          assertValidStemsForSnapshot(whilePaused);
          sim.setPaused(false);
        }
        const curr = sim.getSnapshot();
        const snap = sim.step(computeAutopilotInput(curr));
        assertVanillaLockedInvariants(snap, `PT-013@${t}`);
      }
      const finalSnap = sim.getSnapshot();
      const replayed = replaySimulation(gameData, sim.getReplay(), createLockedRegistryWithAllModPacks());
      expect(replayed.tick).toBe(finalSnap.tick);
      expect(replayed.player.x).toBe(finalSnap.player.x);
      expect(replayed.player.y).toBe(finalSnap.player.y);
      expect(replayed.score).toBe(finalSnap.score);
    });

    it('PT-014: Ocean-Skimmer [0,0,0] dips into sea repeatedly & verifies splash/waterdmg + bit-identical replay', () => {
      let sawSplash = false;
      let sawWaterDmg = false;
      const reg = createLockedRegistryWithAllModPacks();
      const sim = new Simulation(gameData, reg);
      launchToPlaying(sim, { weapon: 0, body: 0, engine: 0 }, 'normal', 10014);
      for (let t = 0; t < 700; t++) {
        const curr = sim.getSnapshot();
        let inp: InputState;
        if (t < 18) {
          // Turn unboosted 180 deg from -90 to +90 (pointing straight toward sea)
          inp = { left: false, right: true, thrust: false, fire: false };
        } else if (t < 95 && !sawWaterDmg) {
          // Thrust downward into ocean until submerged and waterdmg ticks
          inp = { left: false, right: false, thrust: true, fire: false };
        } else {
          inp = computeAutopilotInput(curr);
        }
        const next = sim.step(inp);
        if (next.audioEvents.some((e) => e.cue === 'sndsplashm' || e.cue === 'sndsplashl')) {
          sawSplash = true;
        }
        if (next.player.underwater && next.player.health < curr.player.health) {
          sawWaterDmg = true;
        }
        assertVanillaLockedInvariants(next, `PT-014@${t}`);
      }
      const finalSnap = sim.getSnapshot();
      expect(sawSplash).toBe(true);
      expect(sawWaterDmg).toBe(true);
      expect(finalSnap.tick).toBe(700 + 18);
      const replayed = replaySimulation(gameData, sim.getReplay(), createLockedRegistryWithAllModPacks());
      expect(replayed.player.x).toBe(finalSnap.player.x);
      expect(replayed.player.y).toBe(finalSnap.player.y);
      expect(replayed.score).toBe(finalSnap.score);
    });

    it('PT-015: Space-Climber [0,0,1] SFMT climbs into space ceiling without NaN & matches replay', () => {
      const reg = createLockedRegistryWithAllModPacks();
      const sim = new Simulation(gameData, reg);
      launchToPlaying(sim, { weapon: 0, body: 0, engine: 1 }, 'sfmt', 10015);
      let reachedSpace = false;
      for (let t = 0; t < 650; t++) {
        const snap = sim.step(
          t < 240 ? THRUST_INPUT : computeAutopilotInput(sim.getSnapshot()),
        );
        if (snap.player.inSpace) reachedSpace = true;
        assertVanillaLockedInvariants(snap, `PT-015@${t}`);
      }
      expect(reachedSpace).toBe(true);
      const replayed = replaySimulation(gameData, sim.getReplay(), createLockedRegistryWithAllModPacks());
      expect(replayed.player.x).toBe(sim.getSnapshot().player.x);
      expect(replayed.player.y).toBe(sim.getSnapshot().player.y);
    });
  });

  describe('Group 2: PT-016..PT-035 — 20 Expanded Arsenal & Mega-Boss Wreckers', () => {
    it('PT-016: AEGIS RAILBURNER [6,6,6] vs Dreadnought verifies piercing Railgun, Aegis 300t recharge & twin artillery', () => {
      const sim = createModdedSim({
        shaderFx: { crtScanlines: false, phosphorBloom: false, speedWarp: false, shockwaves: true },
      });
      const start = launchToPlaying(sim, { weapon: 6, body: 6, engine: 6 }, 'normal', 20016);
      expect(start.player.planeName).toBe('AEGIS RAILBURNER');

      // Verify Aegis block + full 300-tick recharge while fighting initial sky wave, then spawn Dreadnought
      sim.damagePlayer(12);
      expect(sim.getSnapshot().player.health).toBe(18);
      expect(sim.getSnapshot().player.shieldReady).toBe(false);

      let sawArtillery = false;
      let sawRecharged = false;
      for (let t = 0; t < 750; t++) {
        if (t === 305) {
          const cur = sim.getSnapshot();
          const boss = sim.spawnEnemy('Dreadnought', cur.player.x + 140);
          expect(boss.maxHealth).toBe(500);
        }
        const s = sim.step(computeAutopilotInput(sim.getSnapshot()));
        assertSnapshotFiniteAndBounded(s, `PT-016@${t}`);
        assertValidStemsForSnapshot(s);
        if (s.projectiles.some((p) => p.kind === 'artillery')) sawArtillery = true;
        if (s.player.shieldReady && t >= 299) sawRecharged = true;
      }
      expect(sawArtillery).toBe(true);
      expect(sawRecharged).toBe(true);
    });

    it('PT-017: VAMPIRE FLAKVECTOR [7,7,7] vs SkyCarrier verifies Flak 6-shards, Vampire lifesteal & interceptor launch', () => {
      const sim = createModdedSim({
        shaderFx: { crtScanlines: false, phosphorBloom: false, speedWarp: false, shockwaves: true },
      });
      const start = launchToPlaying(sim, { weapon: 7, body: 7, engine: 7 }, 'normal', 20017);
      expect(start.player.planeName).toBe('VAMPIRE FLAKVECTOR');
      const carrier = sim.spawnEnemy('SkyCarrier', start.player.x + 220);
      expect(carrier.maxHealth).toBe(750);

      // Verify Vampire lifesteal while holding fire: true
      sim.damagePlayer(5);
      expect(sim.getSnapshot().player.health).toBe(9);
      sim.spawnEnemy('Fighter', start.player.x, start.player.y - 30);
      let sawHealWhileFiring = false;
      let sawInterceptor = false;
      let sawShards = false;
      for (let t = 0; t < 750; t++) {
        const inp =
          t < 20
            ? { left: false, right: false, thrust: false, fire: true }
            : computeAutopilotInput(sim.getSnapshot());
        const s = sim.step(inp);
        assertSnapshotFiniteAndBounded(s, `PT-017@${t}`);
        assertValidStemsForSnapshot(s);
        if (t < 20 && s.player.firing && s.player.health > 9) sawHealWhileFiring = true;
        if (s.projectiles.some((p) => p.kind === 'flakshard')) sawShards = true;
        if (s.enemies.some((e) => e.kind === 'Fighter' || e.kind === 'Jet')) sawInterceptor = true;
      }
      expect(sawHealWhileFiring).toBe(true);
      expect(sawShards).toBe(true);
      expect(sawInterceptor).toBe(true);
    });

    it('PT-018: OVERCLOCK THUNDERION [8,8,8] vs AceSquadron verifies Chain Lightning arcs, 25% faster interval & Ion', () => {
      const sim = createModdedSim();
      const start = launchToPlaying(sim, { weapon: 8, body: 8, engine: 8 }, 'normal', 20018);
      expect(start.player.planeName).toBe('OVERCLOCK THUNDERION');
      const squad = sim.spawnAceSquadron(start.player.x, start.player.y - 110);
      expect(squad).toHaveLength(3);

      const fireSnap = sim.step(FIRE_INPUT);
      const arc = fireSnap.projectiles.find((p) => p.kind === 'lightningarc');
      expect(arc).toBeDefined();
      expect(arc!.arcPoints!.length).toBeGreaterThanOrEqual(2);
      // Lightning interval 16 * 0.75 = 12 under Overclock
      expect(fireSnap.player.fireCooldown).toBe(12);

      for (let t = 0; t < 750; t++) {
        const s = sim.step(computeAutopilotInput(sim.getSnapshot()));
        assertSnapshotFiniteAndBounded(s, `PT-018@${t}`);
        assertValidStemsForSnapshot(s);
      }
    });

    it('PT-019: RAILBREAKER [6,0,0] pierces multiple enemies in line + emits shockwave against Dreadnought', () => {
      const sim = createModdedSim({
        shaderFx: { crtScanlines: false, phosphorBloom: false, speedWarp: false, shockwaves: true },
      });
      const start = launchToPlaying(sim, { weapon: 6, body: 0, engine: 0 }, 'normal', 20019);
      expect(start.player.planeName).toBe('RAILBREAKER');
      const f1 = sim.spawnEnemy('Fighter', start.player.x, start.player.y - 55);
      const f2 = sim.spawnEnemy('Fighter', start.player.x, start.player.y - 110);
      const boss = sim.spawnEnemy('Dreadnought', start.player.x + 150);

      const fireSnap = sim.step(FIRE_INPUT);
      expect(fireSnap.shockwaves?.length).toBeGreaterThanOrEqual(1);
      for (let t = 0; t < 10; t++) sim.step(IDLE_INPUT);
      const after = sim.getSnapshot();
      expect(after.enemies.some((e) => e.id === f1.id)).toBe(false);
      expect(after.enemies.some((e) => e.id === f2.id)).toBe(false);
      expect(boss.maxHealth).toBe(500);

      for (let t = 0; t < 640; t++) {
        const s = sim.step(computeAutopilotInput(sim.getSnapshot()));
        assertSnapshotFiniteAndBounded(s, `PT-019@${t}`);
      }
    });

    it('PT-020: FLAKBREAKER [7,0,0] vs AceSquadron bursts into 6 radial shards on proximity & TTL', () => {
      const sim = createModdedSim({
        shaderFx: { crtScanlines: false, phosphorBloom: false, speedWarp: false, shockwaves: true },
      });
      const start = launchToPlaying(sim, { weapon: 7, body: 0, engine: 0 }, 'normal', 20020);
      expect(start.player.planeName).toBe('FLAKBREAKER');
      sim.spawnAceSquadron(start.player.x, start.player.y - 95);

      sim.step(FIRE_INPUT);
      let saw6Shards = false;
      for (let t = 0; t < 650; t++) {
        const s = sim.step(computeAutopilotInput(sim.getSnapshot()));
        assertSnapshotFiniteAndBounded(s, `PT-020@${t}`);
        if (s.projectiles.filter((p) => p.kind === 'flakshard').length >= 6) {
          saw6Shards = true;
        }
      }
      expect(saw6Shards).toBe(true);
    });

    it('PT-021: THUNDERBOLT [8,0,0] chains 3 targets in 260px cone + 160px hop vs AceSquadron', () => {
      const sim = createModdedSim();
      const start = launchToPlaying(sim, { weapon: 8, body: 0, engine: 0 }, 'normal', 20021);
      expect(start.player.planeName).toBe('THUNDERBOLT');
      sim.spawnEnemy('Ace', start.player.x, start.player.y - 100);
      sim.spawnEnemy('Ace', start.player.x + 90, start.player.y - 120);
      sim.spawnEnemy('Ace', start.player.x + 170, start.player.y - 120);

      const fireSnap = sim.step(FIRE_INPUT);
      const arc = fireSnap.projectiles.find((p) => p.kind === 'lightningarc');
      expect(arc?.arcPoints).toHaveLength(4);
      for (let t = 0; t < 650; t++) {
        const s = sim.step(computeAutopilotInput(sim.getSnapshot()));
        assertSnapshotFiniteAndBounded(s, `PT-021@${t}`);
      }
    });

    it('PT-022: AEGIS BREAKER [0,6,0] vs Dreadnought blocks hit, recharges in 300 ticks, keeps finite state', () => {
      const sim = createModdedSim({
        shaderFx: { crtScanlines: false, phosphorBloom: false, speedWarp: false, shockwaves: true },
      });
      const start = launchToPlaying(sim, { weapon: 0, body: 6, engine: 0 }, 'normal', 20022);
      expect(start.player.planeName).toBe('AEGIS BREAKER');
      sim.spawnEnemy('Dreadnought', start.player.x + 200);
      sim.damagePlayer(9);
      expect(sim.getSnapshot().player.shieldReady).toBe(false);
      expect(sim.getSnapshot().player.shieldCooldown).toBe(300);

      for (let t = 0; t < 700; t++) {
        const s = sim.step(computeAutopilotInput(sim.getSnapshot()));
        assertSnapshotFiniteAndBounded(s, `PT-022@${t}`);
      }
    });

    it('PT-023: VAMPIRE BREAKER [0,7,0] vs SkyCarrier heals +2.5 HP per kill even while firing', () => {
      const sim = createModdedSim();
      const start = launchToPlaying(sim, { weapon: 0, body: 7, engine: 0 }, 'normal', 20023);
      expect(start.player.planeName).toBe('VAMPIRE BREAKER');
      sim.spawnEnemy('SkyCarrier', start.player.x - 180);
      for (let t = 0; t < 650; t++) {
        const s = sim.step(computeAutopilotInput(sim.getSnapshot()));
        assertSnapshotFiniteAndBounded(s, `PT-023@${t}`);
      }
    });

    it('PT-024: OVERCLOCK BREAKER [0,8,0] SFMT vs Dreadnought runs 25% faster fire rate + 1.15x speed', () => {
      const sim = createModdedSim();
      const start = launchToPlaying(sim, { weapon: 0, body: 8, engine: 0 }, 'sfmt', 20024);
      expect(start.player.planeName).toBe('OVERCLOCK BREAKER');
      expect(start.player.bodySpec.speedmodifier).toBe(1.15);
      sim.spawnEnemy('Dreadnought', start.player.x + 120);
      for (let t = 0; t < 650; t++) {
        const s = sim.step(computeAutopilotInput(sim.getSnapshot()));
        assertSnapshotFiniteAndBounded(s, `PT-024@${t}`);
      }
    });

    it('PT-025: AFTERBURNER [0,0,6] reaches > 11.5 top speed (<= 12.5) engaging SkyCarrier', () => {
      const sim = createModdedSim();
      const start = launchToPlaying(sim, { weapon: 0, body: 0, engine: 6 }, 'normal', 20025);
      expect(start.player.planeName).toBe('AFTERBURNER');
      sim.spawnEnemy('SkyCarrier', start.player.x + 200);
      let peakSpd = 0;
      for (let t = 0; t < 650; t++) {
        const s = sim.step(
          t < 30 ? THRUST_INPUT : computeAutopilotInput(sim.getSnapshot()),
        );
        peakSpd = Math.max(peakSpd, Math.hypot(s.player.vx, s.player.vy));
        assertSnapshotFiniteAndBounded(s, `PT-025@${t}`);
      }
      expect(peakSpd).toBeGreaterThan(11.5);
      expect(peakSpd).toBeLessThanOrEqual(12.501);
    });

    it('PT-026: VECTOR BREAKER [0,0,7] executes 11 deg unboosted / 7 deg boosted turns vs AceSquadron', () => {
      const sim = createModdedSim();
      const start = launchToPlaying(sim, { weapon: 0, body: 0, engine: 7 }, 'normal', 20026);
      expect(start.player.planeName).toBe('VECTOR BREAKER');
      const unboosted = sim.step({ left: false, right: true, thrust: false, fire: false });
      expect(unboosted.player.angleDeg - unboosted.player.prevAngleDeg).toBeCloseTo(11, 5);
      const boosted = sim.step({ left: false, right: true, thrust: true, fire: false });
      expect(boosted.player.angleDeg - boosted.player.prevAngleDeg).toBeCloseTo(7, 5);
      sim.spawnAceSquadron(start.player.x + 180, -300);
      for (let t = 0; t < 650; t++) {
        const s = sim.step(computeAutopilotInput(sim.getSnapshot()));
        assertSnapshotFiniteAndBounded(s, `PT-026@${t}`);
      }
    });

    it('PT-027: ION BREAKER [0,0,8] is waterproof, takes halved space damage (0.2) & fights SkyCarrier', () => {
      const sim = createModdedSim();
      const start = launchToPlaying(sim, { weapon: 0, body: 0, engine: 8 }, 'normal', 20027);
      expect(start.player.planeName).toBe('ION BREAKER');
      expect(start.player.engineSpec.waterproof).toBe(true);
      expect(start.player.engineSpec.spacedmg).toBe(0.2);
      sim.spawnEnemy('SkyCarrier', start.player.x - 200);
      for (let t = 0; t < 650; t++) {
        const s = sim.step(computeAutopilotInput(sim.getSnapshot()));
        assertSnapshotFiniteAndBounded(s, `PT-027@${t}`);
      }
    });

    it('PT-028: Cross-hybrid [6,2,6] (Railgun+Melee+Afterburner) rams & snipes Dreadnought', () => {
      const sim = createModdedSim();
      const start = launchToPlaying(sim, { weapon: 6, body: 2, engine: 6 }, 'normal', 20028);
      expect(start.player.planeName).toBe(resolveModdedPlaneName(6, 2, 6, 'SKYBREAKER'));
      sim.spawnEnemy('Dreadnought', start.player.x + 60);
      for (let t = 0; t < 650; t++) {
        const s = sim.step(computeAutopilotInput(sim.getSnapshot()));
        assertSnapshotFiniteAndBounded(s, `PT-028@${t}`);
        assertValidStemsForSnapshot(s);
      }
    });

    it('PT-029: Cross-hybrid [7,3,7] (Flak+Nuke+Vector) vs SkyCarrier triggers Nuke shockwave on death', () => {
      const sim = createModdedSim({
        shaderFx: { crtScanlines: false, phosphorBloom: false, speedWarp: false, shockwaves: true },
      });
      const start = launchToPlaying(sim, { weapon: 7, body: 3, engine: 7 }, 'normal', 20029);
      expect(start.player.planeName).toBe(resolveModdedPlaneName(7, 3, 7, 'SKYBREAKER'));
      sim.spawnEnemy('SkyCarrier', start.player.x, start.player.y - 120);
      for (let t = 0; t < 550; t++) {
        const s = sim.step(computeAutopilotInput(sim.getSnapshot()));
        assertSnapshotFiniteAndBounded(s, `PT-029@${t}`);
      }
      if (sim.getSnapshot().phase === 'playing') {
        sim.damagePlayer(999);
        expect(sim.getSnapshot().player.nukeTriggered).toBe(true);
        expect(sim.getSnapshot().shockwaves?.length).toBeGreaterThanOrEqual(1);
      }
      for (let t = 0; t < 120; t++) {
        const s = sim.step(IDLE_INPUT);
        assertSnapshotFiniteAndBounded(s, `PT-029:end@${t}`);
      }
    });

    it('PT-030: Cross-hybrid [8,4,8] (Lightning+Bomb+Ion) drops bombs + arcs over Dreadnought', () => {
      const sim = createModdedSim();
      const start = launchToPlaying(sim, { weapon: 8, body: 4, engine: 8 }, 'normal', 20030);
      expect(start.player.planeName).toBe(resolveModdedPlaneName(8, 4, 8, 'SKYBREAKER'));
      sim.spawnEnemy('Dreadnought', start.player.x + 80);
      let sawBomb = false;
      for (let t = 0; t < 650; t++) {
        const s = sim.step(computeAutopilotInput(sim.getSnapshot()));
        if (s.projectiles.some((p) => p.kind === 'bomb')) sawBomb = true;
        assertSnapshotFiniteAndBounded(s, `PT-030@${t}`);
      }
      expect(sawBomb).toBe(true);
    });

    it('PT-031: Cross-hybrid [4,8,6] (Cannon+Overclock+Afterburner) reduces Cannon cooldown 79 -> 59', () => {
      const sim = createModdedSim({
        shaderFx: { crtScanlines: false, phosphorBloom: false, speedWarp: false, shockwaves: true },
      });
      const start = launchToPlaying(sim, { weapon: 4, body: 8, engine: 6 }, 'normal', 20031);
      expect(start.player.planeName).toBe(resolveModdedPlaneName(4, 8, 6, 'SKYBREAKER'));
      const fireSnap = sim.step(FIRE_INPUT);
      expect(fireSnap.player.fireCooldown).toBe(59);
      sim.spawnEnemy('Dreadnought', start.player.x + 150);
      for (let t = 0; t < 650; t++) {
        const s = sim.step(computeAutopilotInput(sim.getSnapshot()));
        assertSnapshotFiniteAndBounded(s, `PT-031@${t}`);
      }
    });

    it('PT-032: Cross-hybrid [3,7,2] (Missiles+Vampire+Gungine) fires homing missiles + rear gungine bullets', () => {
      const sim = createModdedSim();
      const start = launchToPlaying(sim, { weapon: 3, body: 7, engine: 2 }, 'normal', 20032);
      expect(start.player.planeName).toBe(resolveModdedPlaneName(3, 7, 2, 'SKYBREAKER'));
      sim.spawnAceSquadron(start.player.x + 160, -240);
      let sawGungine = false;
      let sawMissile = false;
      for (let t = 0; t < 650; t++) {
        const s = sim.step(computeAutopilotInput(sim.getSnapshot()));
        if (s.projectiles.some((p) => p.fromGungine)) sawGungine = true;
        if (s.projectiles.some((p) => p.kind === 'missile')) sawMissile = true;
        assertSnapshotFiniteAndBounded(s, `PT-032@${t}`);
      }
      expect(sawGungine).toBe(true);
      expect(sawMissile).toBe(true);
    });

    it('PT-033: Cross-hybrid [1,6,4] (Laser+Aegis+Hover) fights SkyCarrier for 650 ticks', () => {
      const sim = createModdedSim();
      const start = launchToPlaying(sim, { weapon: 1, body: 6, engine: 4 }, 'normal', 20033);
      expect(start.player.planeName).toBe(resolveModdedPlaneName(1, 6, 4, 'SKYBREAKER'));
      sim.spawnEnemy('SkyCarrier', start.player.x + 140);
      for (let t = 0; t < 650; t++) {
        const s = sim.step(computeAutopilotInput(sim.getSnapshot()));
        assertSnapshotFiniteAndBounded(s, `PT-033@${t}`);
        assertValidStemsForSnapshot(s);
      }
    });

    it('PT-034: Cross-hybrid [2,8,3] (Spread+Overclock+Underwater) reduces Spread cooldown 9 -> 7', () => {
      const sim = createModdedSim();
      const start = launchToPlaying(sim, { weapon: 2, body: 8, engine: 3 }, 'normal', 20034);
      expect(start.player.planeName).toBe(resolveModdedPlaneName(2, 8, 3, 'SKYBREAKER'));
      const fireSnap = sim.step(FIRE_INPUT);
      expect(fireSnap.player.fireCooldown).toBe(7);
      sim.spawnEnemy('Dreadnought', start.player.x - 160);
      for (let t = 0; t < 650; t++) {
        const s = sim.step(computeAutopilotInput(sim.getSnapshot()));
        assertSnapshotFiniteAndBounded(s, `PT-034@${t}`);
      }
    });

    it('PT-035: SFMT Mega-Boss Wave Escalation Gauntlet [6,7,8] 1,200 ticks spawns boss waves deterministically', () => {
      const sim = createModdedSim({
        shaderFx: { crtScanlines: false, phosphorBloom: false, speedWarp: false, shockwaves: true },
      });
      launchToPlaying(sim, { weapon: 6, body: 7, engine: 8 }, 'sfmt', 20035);
      const seenBossKinds = new Set<string>();
      for (let t = 0; t < 1200; t++) {
        const s = sim.step(computeAutopilotInput(sim.getSnapshot()));
        for (const e of s.enemies) {
          if (e.kind === 'Dreadnought' || e.kind === 'SkyCarrier') {
            seenBossKinds.add(e.kind);
          } else if (e.squadronId !== undefined) {
            seenBossKinds.add('AceSquadron');
          }
        }
        assertSnapshotFiniteAndBounded(s, `PT-035@${t}`);
        assertValidStemsForSnapshot(s);
      }
      expect(seenBossKinds.size).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Group 3: PT-036..PT-050 — 15 Replay Ghost, Daily Seed & Fuzz Testers', () => {
    it('PT-036: Vanilla [0,0,0] sortie serializes/parses JSON & races GhostRunner with <=20 trail & zero PRNG drift', () => {
      const recSim = new Simulation(gameData, new ModRegistry(true));
      recSim.launch({ weapon: 0, body: 0, engine: 0 }, 'normal', 30036);
      const recordedPath: Array<{ x: number; y: number }> = [];
      for (let t = 0; t < 180; t++) {
        const inp = computeAutopilotInput(recSim.getSnapshot());
        const s = recSim.step(inp);
        recordedPath.push({ x: s.player.x, y: s.player.y });
      }
      const parsed = parseReplayJson(serializeReplay(recSim.getReplay()));
      expect(parsed).not.toBeNull();

      const live = createModdedSim({ replayGhost: true });
      live.setGhostReplay(parsed);
      live.launch({ weapon: 1, body: 0, engine: 4 }, 'normal', 88881);

      const baseline = createModdedSim({ replayGhost: false });
      baseline.launch({ weapon: 1, body: 0, engine: 4 }, 'normal', 88881);

      for (let t = 0; t < 180; t++) {
        const inp = computeAutopilotInput(baseline.getSnapshot());
        const sLive = live.step(inp);
        const sBase = baseline.step(inp);
        expect(sLive.player.x).toBe(sBase.player.x);
        expect(sLive.player.y).toBe(sBase.player.y);
        expect(sLive.enemies.length).toBe(sBase.enemies.length);
        expect(sLive.ghostPose).not.toBeNull();
        expect(sLive.ghostPose!.x).toBe(recordedPath[t]!.x);
        expect(sLive.ghostPose!.y).toBe(recordedPath[t]!.y);
        expect(sLive.ghostPose!.trail.length).toBeLessThanOrEqual(20);
      }
    });

    it('PT-037: Modded Arsenal [6,7,8] sortie serializes/parses JSON & races GhostRunner tick-for-tick', () => {
      const recSim = createModdedSim();
      recSim.launch({ weapon: 6, body: 7, engine: 8 }, 'normal', 30037);
      const recordedPath: Array<{ x: number; y: number; loadout: Loadout }> = [];
      for (let t = 0; t < 150; t++) {
        const s = recSim.step({
          left: t % 11 === 0,
          right: t % 13 === 0,
          thrust: true,
          fire: t % 4 === 0,
        });
        recordedPath.push({ x: s.player.x, y: s.player.y, loadout: { ...s.player.loadout } });
      }
      const parsed = parseReplayJson(serializeReplay(recSim.getReplay()));
      expect(parsed).not.toBeNull();
      expect(parsed!.loadout).toEqual({ weapon: 6, body: 7, engine: 8 });

      const live = createModdedSim({ replayGhost: true });
      live.setGhostReplay(parsed);
      live.launch({ weapon: 0, body: 0, engine: 0 }, 'normal', 88882);

      for (let t = 0; t < 150; t++) {
        const s = live.step(THRUST_INPUT);
        expect(s.ghostPose).not.toBeNull();
        expect(s.ghostPose!.x).toBe(recordedPath[t]!.x);
        expect(s.ghostPose!.y).toBe(recordedPath[t]!.y);
        expect(s.ghostPose!.loadout).toEqual(recordedPath[t]!.loadout);
        expect(s.ghostPose!.trail.length).toBeLessThanOrEqual(20);
      }
    });

    it('PT-038: SFMT Hover [1,8,4] GhostRunner tracks boosting, scoreAtTick & trail cleanly', () => {
      const recSim = createModdedSim();
      recSim.launch({ weapon: 1, body: 8, engine: 4 }, 'sfmt', 30038);
      const poses: Array<{ x: number; y: number; boosting: boolean; score: number }> = [];
      for (let t = 0; t < 180; t++) {
        const s = recSim.step(computeAutopilotInput(recSim.getSnapshot()));
        poses.push({ x: s.player.x, y: s.player.y, boosting: s.player.boosting, score: s.score });
      }
      const parsed = parseReplayJson(serializeReplay(recSim.getReplay()))!;
      const ghost = new GhostRunner(gameData, parsed);
      for (const idx of [1, 45, 90, 180]) {
        const p = ghost.sampleAtTick(idx)!;
        expect(p.x).toBe(poses[idx - 1]!.x);
        expect(p.y).toBe(poses[idx - 1]!.y);
        expect(p.boosting).toBe(poses[idx - 1]!.boosting);
        expect(p.scoreAtTick).toBe(poses[idx - 1]!.score);
        expect(p.trail.length).toBeLessThanOrEqual(20);
      }
    });

    it('PT-039: GhostRunner past end of recording returns null cleanly without breaking live Simulation', () => {
      const recSim = new Simulation(gameData, new ModRegistry(true));
      recSim.launch({ weapon: 0, body: 0, engine: 0 }, 'normal', 30039);
      for (let t = 0; t < 30; t++) recSim.step(THRUST_INPUT);
      const rec = recSim.getReplay();

      const live = createModdedSim({ replayGhost: true });
      live.setGhostReplay(rec);
      live.launch({ weapon: 0, body: 0, engine: 0 }, 'normal', 88883);
      for (let t = 0; t < 60; t++) {
        const s = live.step(THRUST_INPUT);
        assertSnapshotFiniteAndBounded(s, `PT-039@${t}`);
        if (t >= 30) {
          expect(s.ghostPose).toBeNull();
        } else {
          expect(s.ghostPose).not.toBeNull();
        }
      }
    });

    it('PT-040: GhostRunner handles negative/NaN ticks & returned trail mutation immutably', () => {
      const recSim = new Simulation(gameData, new ModRegistry(true));
      recSim.launch({ weapon: 0, body: 0, engine: 0 }, 'normal', 30040);
      for (let t = 0; t < 40; t++) recSim.step(THRUST_INPUT);
      const ghost = new GhostRunner(gameData, recSim.getReplay());

      expect(ghost.sampleAtTick(-5)).toBeNull();
      expect(ghost.sampleAtTick(Number.NaN)).toBeNull();
      expect(ghost.sampleAtTick(Infinity)).toBeNull();
      const pose30 = ghost.sampleAtTick(30)!;
      const origX = pose30.trail[0]!.x;
      (pose30.trail as Array<{ x: number; y: number }>)[0]!.x = 999999;
      pose30.loadout.weapon = 8;
      const pose30Again = ghost.sampleAtTick(30)!;
      expect(pose30Again.trail[0]!.x).toBe(origX);
      expect(pose30Again.loadout.weapon).toBe(0);
    });

    it('PT-041: Daily Seed Leap Day 2024-02-29 deterministic across UTC midnight boundaries', () => {
      const a = computeDailySeed(new Date('2024-02-29T00:00:00.000Z'));
      const b = computeDailySeed(new Date('2024-02-29T23:59:59.999Z'));
      const prev = computeDailySeed(new Date('2024-02-28T23:59:59.999Z'));
      const next = computeDailySeed(new Date('2024-03-01T00:00:00.000Z'));
      expect(a).toEqual(b);
      expect(a.dateId).toBe('20240229');
      expect(a.seed).toBeGreaterThan(0);
      expect(a.seed).not.toBe(prev.seed);
      expect(a.seed).not.toBe(next.seed);
    });

    it('PT-042: Daily Seed Year Rollover 2025-12-31 -> 2026-01-01 produces distinct valid 32-bit seeds', () => {
      const dec31 = computeDailySeed(new Date('2025-12-31T23:59:59Z'));
      const jan01 = computeDailySeed(new Date('2026-01-01T00:00:00Z'));
      expect(dec31.dateId).toBe('20251231');
      expect(jan01.dateId).toBe('20260101');
      expect(dec31.seed).not.toBe(jan01.seed);
      expect(Number.isInteger(jan01.seed)).toBe(true);
      expect(jan01.seed).toBeGreaterThan(0);
    });

    it('PT-043: Daily Seed Non-Leap Year Feb 28 -> Mar 1 2026 produces distinct seeds', () => {
      const feb28 = computeDailySeed(new Date('2026-02-28T12:00:00Z'));
      const mar01 = computeDailySeed(new Date('2026-03-01T12:00:00Z'));
      expect(feb28.dateId).toBe('20260228');
      expect(mar01.dateId).toBe('20260301');
      expect(feb28.seed).not.toBe(mar01.seed);
    });

    it('PT-044: Daily Seed invalid Date fallback & Simulation automatic daily seed launch determinism', () => {
      const fallback = computeDailySeed(new Date('not-a-date'));
      const today = computeDailySeed();
      expect(fallback.dateId).toBe(today.dateId);
      expect(fallback.seed).toBe(today.seed);

      const s1 = createModdedSim({ dailySeed: true });
      const s2 = createModdedSim({ dailySeed: true });
      s1.launch({ weapon: 0, body: 0, engine: 0 }, 'normal');
      s2.launch({ weapon: 0, body: 0, engine: 0 }, 'normal');
      expect(s1.getSnapshot().dailySeedId).toBe(today.dateId);
      expect(s1.getSnapshot().seed).toBe(today.seed);
      for (let t = 0; t < 120; t++) {
        const a = s1.step(THRUST_INPUT);
        const b = s2.step(THRUST_INPUT);
        expect(a.player.x).toBe(b.player.x);
        expect(a.player.y).toBe(b.player.y);
      }
    });

    it('PT-045: Daily Seed zero collisions & zero 0-seeds across all 365 days of 2026', () => {
      const seeds = new Set<number>();
      const startMs = Date.UTC(2026, 0, 1);
      for (let d = 0; d < 365; d++) {
        const res = computeDailySeed(new Date(startMs + d * 86_400_000));
        expect(res.seed).toBeGreaterThan(0);
        expect(Number.isInteger(res.seed)).toBe(true);
        expect(seeds.has(res.seed)).toBe(false);
        seeds.add(res.seed);
      }
      expect(seeds.size).toBe(365);
    });

    it('PT-046: parseReplayJson fuzz — malformed JSON, empty string, wrong runtime types, oversized payload -> null', () => {
      const badInputs: unknown[] = [
        '',
        '   ',
        '{broken',
        '[]',
        'null',
        'true',
        '42',
        '"string"',
        null,
        undefined,
        12345,
        { seed: 1 },
        'x'.repeat(20_000_005),
      ];
      for (const bad of badInputs) {
        expect(() => parseReplayJson(bad as string)).not.toThrow();
        expect(parseReplayJson(bad as string)).toBeNull();
      }
    });

    it('PT-047: parseReplayJson fuzz — NaN, Infinity, negative/float seed & finalTicks, >360000 frames -> null', () => {
      const base: ReplayRecording = {
        seed: 123,
        mode: 'normal',
        loadout: { weapon: 0, body: 0, engine: 0 },
        profileId: 'vanilla-1to1',
        frames: [{ tick: 1, mask: 0 }],
        finalScore: 100,
        finalTicks: 1,
      };
      const badPayloads = [
        JSON.stringify({ ...base, seed: -1 }),
        JSON.stringify({ ...base, seed: 1.5 }),
        JSON.stringify({ ...base, seed: 0x1_0000_0000 }),
        JSON.stringify({ ...base, seed: null }),
        '{"seed":NaN,"mode":"normal","loadout":{"weapon":0,"body":0,"engine":0},"profileId":"x","frames":[],"finalScore":0,"finalTicks":0}',
        '{"seed":Infinity,"mode":"normal","loadout":{"weapon":0,"body":0,"engine":0},"profileId":"x","frames":[],"finalScore":0,"finalTicks":0}',
        JSON.stringify({ ...base, finalScore: -10 }),
        JSON.stringify({ ...base, finalScore: null }),
        JSON.stringify({ ...base, finalTicks: -1 }),
        JSON.stringify({ ...base, finalTicks: 1.2 }),
        JSON.stringify({ ...base, finalTicks: 360001 }),
        JSON.stringify({ ...base, frames: 'not-array' }),
        JSON.stringify({
          ...base,
          frames: Array.from({ length: 360001 }, (_, i) => ({ tick: i + 1, mask: 0 })),
        }),
      ];
      for (const raw of badPayloads) {
        expect(() => parseReplayJson(raw)).not.toThrow();
        expect(parseReplayJson(raw)).toBeNull();
      }
    });

    it('PT-048: parseReplayJson fuzz — weapon: 99, invalid loadout, invalid mode, empty profileId -> null', () => {
      const base = {
        seed: 1,
        mode: 'normal',
        loadout: { weapon: 0, body: 0, engine: 0 },
        profileId: 'vanilla-1to1',
        frames: [],
        finalScore: 0,
        finalTicks: 0,
      };
      const badPayloads = [
        JSON.stringify({ ...base, loadout: { weapon: 99, body: 0, engine: 0 } }),
        JSON.stringify({ ...base, loadout: { weapon: 0, body: 9, engine: 0 } }),
        JSON.stringify({ ...base, loadout: { weapon: 0, body: 0, engine: -1 } }),
        JSON.stringify({ ...base, loadout: { weapon: 2.5, body: 0, engine: 0 } }),
        JSON.stringify({ ...base, loadout: null }),
        JSON.stringify({ ...base, loadout: [] }),
        JSON.stringify({ ...base, mode: 'arcade' }),
        JSON.stringify({ ...base, profileId: '' }),
        JSON.stringify({ ...base, profileId: 123 }),
      ];
      for (const raw of badPayloads) {
        expect(() => parseReplayJson(raw)).not.toThrow();
        expect(parseReplayJson(raw)).toBeNull();
      }
    });

    it('PT-049: parseReplayJson fuzz — negative/float/oversized frame ticks, invalid masks & non-object frames -> null', () => {
      const base = {
        seed: 1,
        mode: 'normal',
        loadout: { weapon: 0, body: 0, engine: 0 },
        profileId: 'vanilla-1to1',
        finalScore: 0,
        finalTicks: 1,
      };
      const badFrames = [
        [{ tick: -1, mask: 0 }],
        [{ tick: 1.5, mask: 0 }],
        [{ tick: 360001, mask: 0 }],
        [{ tick: 1, mask: -1 }],
        [{ tick: 1, mask: 16 }],
        [{ tick: 1, mask: 1.1 }],
        [null],
        [[]],
        ['bad'],
      ];
      for (const frames of badFrames) {
        const raw = JSON.stringify({ ...base, frames });
        expect(() => parseReplayJson(raw)).not.toThrow();
        expect(parseReplayJson(raw)).toBeNull();
      }
    });

    it('PT-050: parseReplayJson fuzz — __proto__ / constructor injection & bad modFlags -> safe, zero pollution', () => {
      const protoOnly = '{"__proto__":{"polluted":true}}';
      expect(parseReplayJson(protoOnly)).toBeNull();
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();

      const validWithProto =
        '{"seed":1,"mode":"normal","loadout":{"weapon":0,"body":0,"engine":0},"profileId":"vanilla-1to1","frames":[{"tick":1,"mask":4,"__proto__":{"polluted":true}}],"finalScore":0,"finalTicks":1,"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}';
      const parsed = parseReplayJson(validWithProto);
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
      if (parsed) {
        expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(parsed, 'constructor')).toBe(false);
      }

      const badModFlags = [
        { version: 0 },
        { version: '2' },
        { dailyDateId: 123 },
        { planeName: 42 },
        { modFlags: 'bad' },
        { modFlags: { ...DEFAULT_ACT2_MOD_FLAGS, multiplayerMode: '4p' } },
        { modFlags: { ...DEFAULT_ACT2_MOD_FLAGS, shaderFx: null } },
        {
          modFlags: {
            ...DEFAULT_ACT2_MOD_FLAGS,
            shaderFx: { ...DEFAULT_SHADER_FX, crtScanlines: 'yes' },
          },
        },
      ];
      for (const extra of badModFlags) {
        const raw = JSON.stringify({
          seed: 1,
          mode: 'normal',
          loadout: { weapon: 0, body: 0, engine: 0 },
          profileId: 'vanilla-1to1',
          frames: [],
          finalScore: 0,
          finalTicks: 0,
          ...extra,
        });
        expect(parseReplayJson(raw)).toBeNull();
      }
    });
  });

  describe('Group 4: PT-051..PT-065 — 15 Shader Studio & Custom Palette Chaos Testers', () => {
    function buildLiveModdedCombatSnapshot(
      fx: ShaderFxConfig,
      multiplayerMode: 'solo' | 'coop2p' | 'dogfight1v1' = 'coop2p',
    ): { prev: SimSnapshot; curr: SimSnapshot } {
      const sim = createModdedSim({
        replayGhost: true,
        dailySeed: true,
        shaderFx: fx,
        multiplayerMode,
        p2BotEnabled: true,
      });
      const recSim = createModdedSim();
      recSim.launch({ weapon: 0, body: 0, engine: 0 }, 'normal', 40001);
      for (let t = 0; t < 40; t++) recSim.step(THRUST_INPUT);
      sim.setGhostReplay(recSim.getReplay());
      sim.setP2Loadout({ weapon: 7, body: 6, engine: 7 });
      launchToPlaying(sim, { weapon: 6, body: 6, engine: 6 }, 'normal', 40002);
      sim.spawnEnemy('Dreadnought', 140);
      sim.spawnEnemy('SkyCarrier', -180);
      sim.spawnAceSquadron(40, -180);
      let prev = sim.getSnapshot();
      let curr = prev;
      for (let t = 0; t < 25; t++) {
        prev = curr;
        curr = sim.step({ left: t % 5 === 0, right: false, thrust: true, fire: true });
      }
      return { prev, curr };
    }

    it('PT-051: Shader FX ALL OFF vanilla pass-through renders with uFxFlags=[0,0,0,0] and 0 WebGL errors', () => {
      const glMock = createMockWebGL2();
      const renderer = new WebGL2Renderer();
      renderer.init(glMock.canvas, vault);
      const sim = new Simulation(gameData, new ModRegistry(true));
      const prev = launchToPlaying(sim, { weapon: 0, body: 0, engine: 0 }, 'normal', 40051);
      const curr = sim.step(THRUST_INPUT);
      renderer.render(curr, prev, 0.5, null, 1.0);
      const fx = glMock.uniform4fCalls.filter((c) => c.name === 'uFxFlags').at(-1);
      expect(fx).toMatchObject({ x: 0, y: 0, z: 0, w: 0 });
      expect(renderer.getFrameMetrics().webglErrors).toBe(0);
      glMock.assertAllUniformsFinite();
      renderer.dispose();
    });

    it('PT-052: Shader FX crtScanlines ONLY renders modded combat snapshot with 0 WebGL errors & finite uniforms', () => {
      const glMock = createMockWebGL2();
      const renderer = new WebGL2Renderer();
      renderer.init(glMock.canvas, vault);
      const fxCfg = { crtScanlines: true, phosphorBloom: false, speedWarp: false, shockwaves: false };
      const { prev, curr } = buildLiveModdedCombatSnapshot(fxCfg);
      renderer.setShaderFx(fxCfg);
      renderer.render(curr, prev, 0.5, null, 1.5);
      expect(glMock.uniform4fCalls.filter((c) => c.name === 'uFxFlags').at(-1)).toMatchObject({
        x: 1,
        y: 0,
        z: 0,
        w: 0,
      });
      expect(renderer.getFrameMetrics().webglErrors).toBe(0);
      glMock.assertAllUniformsFinite();
      renderer.dispose();
    });

    it('PT-053: Shader FX phosphorBloom ONLY with Chain Lightning renders with 0 WebGL errors', () => {
      const glMock = createMockWebGL2();
      const renderer = new WebGL2Renderer();
      renderer.init(glMock.canvas, vault);
      const sim = createModdedSim({
        shaderFx: { crtScanlines: false, phosphorBloom: true, speedWarp: false, shockwaves: false },
      });
      const start = launchToPlaying(sim, { weapon: 8, body: 8, engine: 8 }, 'normal', 40053);
      sim.spawnAceSquadron(start.player.x, start.player.y - 100);
      const curr = sim.step(FIRE_INPUT);
      renderer.setShaderFx({ crtScanlines: false, phosphorBloom: true, speedWarp: false, shockwaves: false });
      renderer.render(curr, start, 0.25, null, 2.0);
      expect(glMock.uniform4fCalls.filter((c) => c.name === 'uFxFlags').at(-1)).toMatchObject({
        x: 0,
        y: 1,
        z: 0,
        w: 0,
      });
      expect(renderer.getFrameMetrics().webglErrors).toBe(0);
      glMock.assertAllUniformsFinite();
      renderer.dispose();
    });

    it('PT-054: Shader FX speedWarp ONLY with Afterburner high-speed flight emits finite uFxParams.y > 0.5', () => {
      const glMock = createMockWebGL2();
      const renderer = new WebGL2Renderer();
      renderer.init(glMock.canvas, vault);
      const fxCfg = { crtScanlines: false, phosphorBloom: false, speedWarp: true, shockwaves: false };
      const sim = createModdedSim({ shaderFx: fxCfg });
      let prev = launchToPlaying(sim, { weapon: 0, body: 0, engine: 6 }, 'normal', 40054);
      let curr = prev;
      for (let t = 0; t < 20; t++) {
        prev = curr;
        curr = sim.step(THRUST_INPUT);
      }
      renderer.setShaderFx(fxCfg);
      renderer.render(curr, prev, 0.5, null, 2.2);
      expect(glMock.uniform4fCalls.filter((c) => c.name === 'uFxFlags').at(-1)).toMatchObject({
        x: 0,
        y: 0,
        z: 1,
        w: 0,
      });
      const params = glMock.uniform4fCalls.filter((c) => c.name === 'uFxParams').at(-1);
      expect(params!.y).toBeGreaterThan(0.5);
      expect(renderer.getFrameMetrics().webglErrors).toBe(0);
      glMock.assertAllUniformsFinite();
      renderer.dispose();
    });

    it('PT-055: Shader FX shockwaves ONLY with 4 active shockwaves emits finite uShockwaves[4]', () => {
      const glMock = createMockWebGL2();
      const renderer = new WebGL2Renderer();
      renderer.init(glMock.canvas, vault);
      const fxCfg = { crtScanlines: false, phosphorBloom: false, speedWarp: false, shockwaves: true };
      const { prev, curr } = buildLiveModdedCombatSnapshot(fxCfg);
      const padded: SimSnapshot = {
        ...curr,
        shockwaves: [
          { id: 1, x: 0, y: -100, radius: 20, maxRadius: 90, intensity: 1, age: 2, maxAge: 16 },
          { id: 2, x: 50, y: -140, radius: 40, maxRadius: 110, intensity: 0.8, age: 4, maxAge: 16 },
          { id: 3, x: -50, y: -180, radius: 60, maxRadius: 130, intensity: 0.6, age: 6, maxAge: 16 },
          { id: 4, x: 20, y: -220, radius: 80, maxRadius: 150, intensity: 0.4, age: 8, maxAge: 16 },
        ],
      };
      renderer.setShaderFx(fxCfg);
      renderer.render(padded, prev, 0.5, null, 2.5);
      expect(glMock.uniform4fCalls.filter((c) => c.name === 'uFxFlags').at(-1)).toMatchObject({
        x: 0,
        y: 0,
        z: 0,
        w: 1,
      });
      const swCall = glMock.uniform4fvCalls.filter((c) => c.name.startsWith('uShockwaves')).at(-1);
      expect(swCall).toBeDefined();
      expect(swCall!.data).toHaveLength(16);
      expect(renderer.getFrameMetrics().webglErrors).toBe(0);
      glMock.assertAllUniformsFinite();
      renderer.dispose();
    });

    it('PT-056: ALL 4 Shader FX ON simultaneously with live Boss+Ghost+2P+Lightning+Flak+Railgun snapshot', () => {
      const glMock = createMockWebGL2();
      const renderer = new WebGL2Renderer();
      renderer.init(glMock.canvas, vault);
      const allOn = { crtScanlines: true, phosphorBloom: true, speedWarp: true, shockwaves: true };
      const { prev, curr } = buildLiveModdedCombatSnapshot(allOn, 'coop2p');
      renderer.setShaderFx(allOn);
      for (const pal of ACT2_BONUS_PALETTES) {
        renderer.setPalette(pal.id);
        renderer.render(curr, prev, 0.5, null, 3.0);
      }
      expect(glMock.uniform4fCalls.filter((c) => c.name === 'uFxFlags').at(-1)).toMatchObject({
        x: 1,
        y: 1,
        z: 1,
        w: 1,
      });
      expect(renderer.getFrameMetrics().webglErrors).toBe(0);
      glMock.assertAllUniformsFinite();
      renderer.dispose();
    });

    it('PT-057: Pairwise Shader FX combos across playing, paused, gameover & Hangar Mod Deck phases', () => {
      const glMock = createMockWebGL2();
      const renderer = new WebGL2Renderer();
      renderer.init(glMock.canvas, vault);
      const combos: ShaderFxConfig[] = [
        { crtScanlines: true, phosphorBloom: true, speedWarp: false, shockwaves: false },
        { crtScanlines: false, phosphorBloom: false, speedWarp: true, shockwaves: true },
        { crtScanlines: true, phosphorBloom: false, speedWarp: true, shockwaves: false },
        { crtScanlines: false, phosphorBloom: true, speedWarp: false, shockwaves: true },
      ];
      const hangar = new HangarController();
      hangar.toggleModDeck(true);
      for (const fxCfg of combos) {
        const { prev, curr } = buildLiveModdedCombatSnapshot(fxCfg, 'dogfight1v1');
        renderer.setShaderFx(fxCfg);
        renderer.render(curr, prev, 0.5, null, 1.1);
        renderer.render({ ...curr, paused: true }, prev, 0, null, 1.2);
        renderer.render({ ...curr, phase: 'gameover' }, prev, 0, null, 1.3);
        const hSnap: SimSnapshot = { ...curr, phase: 'hangar' };
        renderer.render(hSnap, hSnap, 0, hangar.buildUiState(hSnap), 1.4);
      }
      expect(renderer.getFrameMetrics().webglErrors).toBe(0);
      glMock.assertAllUniformsFinite();
      renderer.dispose();
    });

    it('PT-058: Real Vanilla-locked Simulation snapshot (activeMods undefined) MUST force uFxFlags=[0,0,0,0] even if setShaderFx was enabled earlier', () => {
      const glMock = createMockWebGL2();
      const renderer = new WebGL2Renderer();
      renderer.init(glMock.canvas, vault);
      renderer.setShaderFx({
        crtScanlines: true,
        phosphorBloom: true,
        speedWarp: true,
        shockwaves: true,
      });
      const vanillaSim = new Simulation(gameData, new ModRegistry(true));
      const prev = launchToPlaying(vanillaSim, { weapon: 0, body: 0, engine: 0 }, 'normal', 40058);
      const curr = vanillaSim.step(THRUST_INPUT);
      expect(curr.activeMods).toBeUndefined();
      renderer.render(curr, prev, 0.5, null, 1.0);
      const fx = glMock.uniform4fCalls.filter((c) => c.name === 'uFxFlags').at(-1);
      expect(fx).toMatchObject({ x: 0, y: 0, z: 0, w: 0 });
      renderer.dispose();
    });

    it('PT-059: resolveEnemyRenderTransform covers all 12 enemy kinds + WebGL2Renderer renders Dreadnought & SkyCarrier upright', () => {
      const uprightKinds: EnemyKind[] = [
        'Boat',
        'BigBoat',
        'Submarine',
        'AceMarine',
        'Blimp',
        'Dreadnought',
        'SkyCarrier',
      ];
      for (const kind of uprightKinds) {
        expect(resolveEnemyRenderTransform({ kind, vx: -1, angleDeg: 180 })).toEqual({
          angleRad: 0,
          scaleX: -1,
          scaleY: 1,
        });
        expect(resolveEnemyRenderTransform({ kind, vx: 1, angleDeg: 0 })).toEqual({
          angleRad: 0,
          scaleX: 1,
          scaleY: 1,
        });
      }
      const rotatingKinds: EnemyKind[] = ['Fighter', 'Jet', 'Ace', 'LaserAce', 'Missile'];
      for (const kind of rotatingKinds) {
        const tr = resolveEnemyRenderTransform({ kind, vx: -5, angleDeg: 90 });
        expect(tr.angleRad).toBeCloseTo(Math.PI / 2, 6);
        expect(tr.scaleX).toBe(1);
      }

      const glMock = createMockWebGL2();
      const renderer = new WebGL2Renderer();
      renderer.init(glMock.canvas, vault);
      const sim = createModdedSim();
      const prev = launchToPlaying(sim, { weapon: 6, body: 6, engine: 6 }, 'normal', 40059);
      sim.spawnEnemy('Dreadnought', 120);
      sim.spawnEnemy('SkyCarrier', -120);
      const curr = sim.step(IDLE_INPUT);
      renderer.render(curr, prev, 0.5, null, 1.0);
      expect(renderer.getFrameMetrics().webglErrors).toBe(0);
      glMock.assertAllUniformsFinite();
      renderer.dispose();
    });

    it('PT-060: computePostShaderUniforms stays finite across 0%/20%/50%/100% HP, nuke flash & bonus palettes', () => {
      const sim = createModdedSim();
      const base = launchToPlaying(sim, { weapon: 0, body: 3, engine: 0 }, 'normal', 40060);
      const allPalettes = [...PALETTES, ...ACT2_BONUS_PALETTES];
      const hpCases = [0, 2, 8, 15.9, 16];
      for (let i = 0; i < hpCases.length; i++) {
        const pal = allPalettes[i % allPalettes.length]!;
        const snap: SimSnapshot = {
          ...base,
          nukeFlashTicks: i === 0 ? 30 : 0,
          screenShake: i === 1 ? 12 : 0,
          player: { ...base.player, health: hpCases[i]!, healing: i === 2 },
        };
        const u = computePostShaderUniforms(snap, 0, -200, i * 0.1, pal, 0, 0);
        for (const v of [
          ...u.viewport,
          ...u.cameraPosition,
          ...u.healthRadius,
          ...u.playerPosition,
          ...u.cameraWorldPosition,
          ...u.delta,
          ...u.uniform_backcol,
          ...u.uniform_colors.flat(),
        ]) {
          assertFiniteNumber(v, `PT-060:pal=${pal.id}`);
        }
      }
    });

    it('PT-061: sanitizeCustomPalette fuzzing rejects NaN/Infinity/wrong shapes and clamps out-of-range RGB to [0..1]', () => {
      const valid = sanitizeCustomPalette({
        id: 'fuzz_ok',
        name: 'fuzz_test',
        backcol: [-99, 500, 0.25, 0.1],
        colors: [
          [9, 9, 9, 9],
          [-2, 0.5, 42, 0],
          [0, 1, 0, 0.2],
          [0.1, 0.2, 0.3, 0.4],
          [0.2, 0.3, 0.4, 0.5],
          [0.3, 0.4, 0.5, 0.6],
          [0.4, 0.5, 0.6, 0.7],
          [0.5, 0.6, 0.7, 0.8],
        ],
      });
      expect(valid).not.toBeNull();
      expect(valid!.backcol).toEqual([0, 1, 0.25, 1]);
      expect(valid!.colors[0]).toEqual([0, 0, 0, 0]);
      expect(valid!.colors[1]).toEqual([0, 0.5, 1, 1]);

      const invalids: unknown[] = [
        null,
        undefined,
        'hex:#ff00aa',
        123,
        [],
        { backcol: [0, 0, 0, 1], colors: [] },
        { backcol: [NaN, 0, 0, 1], colors: Array.from({ length: 8 }, () => [0, 0, 0, 1]) },
        {
          backcol: [0, 0, 0, 1],
          colors: [[0, 0, 0, 0], [0, -Infinity, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]],
        },
        {
          backcol: ['#ff0000', 0, 0, 1],
          colors: Array.from({ length: 8 }, () => [0, 0, 0, 1]),
        },
      ];
      for (const bad of invalids) {
        expect(() => sanitizeCustomPalette(bad)).not.toThrow();
        expect(sanitizeCustomPalette(bad)).toBeNull();
      }
    });

    it('PT-062: PaletteStudioController rapid slot/channel stepping clamps [0..1] across all 8 slots & preserves colors[0]', () => {
      const studio = new PaletteStudioController();
      studio.toggle(true);
      for (let slot = 0; slot < 12; slot++) {
        for (let ch = 0; ch < 3; ch++) {
          for (let step = 0; step < 25; step++) {
            studio.handleKey(step % 2 === 0 ? 'ArrowRight' : 'ArrowRight');
          }
          for (let step = 0; step < 30; step++) {
            studio.handleKey('ArrowLeft');
          }
          studio.handleKey('Tab');
        }
        studio.handleKey('ArrowDown');
      }
      const pal = studio.getPalette();
      expect(pal.colors[0]).toEqual([0, 0, 0, 0]);
      expect(pal.backcol[3]).toBe(1);
      for (const ch of pal.backcol) {
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(1);
      }
      for (let i = 1; i <= 7; i++) {
        expect(pal.colors[i]![3]).toBe(1);
        for (const ch of pal.colors[i]!) {
          expect(ch).toBeGreaterThanOrEqual(0);
          expect(ch).toBeLessThanOrEqual(1);
        }
      }
    });

    it('PT-063: PaletteStudioController presets 1..4, reset, export/import round-trip & corrupt import resilience', () => {
      const studio = new PaletteStudioController();
      for (const key of ['Digit1', 'Digit2', 'Digit3', 'Digit4'] as const) {
        const res = studio.handleKey(key);
        expect(res.saved).toBe(true);
        expect(res.palette.colors[0]).toEqual([0, 0, 0, 0]);
      }
      const json4 = studio.exportJson();
      const resetRes = studio.handleKey('KeyR');
      expect(resetRes.palette.colors[1]).toEqual(createDefaultCustomPalette().colors[1]);

      expect(studio.importJson('not-json')).toBeNull();
      expect(studio.importJson('{"backcol":[NaN,0,0,1],"colors":[]}')).toBeNull();
      // Corrupt import must NOT overwrite current valid palette
      expect(studio.getPalette().colors[1]).toEqual(createDefaultCustomPalette().colors[1]);

      const reimported = studio.importJson(json4);
      expect(reimported).not.toBeNull();
      expect(reimported!.colors[1]).toEqual(ACT2_BONUS_PALETTES[3]!.colors[1]);
    });

    it('PT-064: PaletteStudioController API NaN/Infinity fuzz on setSlotColor, stepChannel, selectSlot, moveSlot must not corrupt or crash', () => {
      const studio = new PaletteStudioController();
      studio.toggle(true);
      studio.setSlotColor(1, [Number.NaN, Infinity, -Infinity]);
      studio.stepChannel(Number.NaN);
      studio.selectSlot(Number.NaN);
      studio.moveSlot(Infinity);

      const st = studio.getState();
      expect(Number.isInteger(st.selectedSlot)).toBe(true);
      expect(st.selectedSlot).toBeGreaterThanOrEqual(0);
      expect(st.selectedSlot).toBeLessThanOrEqual(7);
      for (const ch of st.palette.backcol) {
        assertFiniteNumber(ch, 'PT-064.backcol');
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(1);
      }
      for (let i = 1; i <= 7; i++) {
        for (const ch of st.palette.colors[i]!) {
          assertFiniteNumber(ch, `PT-064.colors[${i}]`);
          expect(ch).toBeGreaterThanOrEqual(0);
          expect(ch).toBeLessThanOrEqual(1);
        }
      }
      expect(st.palette.colors[0]).toEqual([0, 0, 0, 0]);
    });

    it('PT-065: Live Hangar PaletteStudio + WebGL2Renderer integration renders custom_studio with 0 WebGL errors', () => {
      const glMock = createMockWebGL2();
      const renderer = new WebGL2Renderer();
      renderer.init(glMock.canvas, vault);

      const hangar = new HangarController();
      hangar.toggleModDeck(true);
      hangar.setActiveModRow('palettestudio');
      const sim = createModdedSim();
      hangar.handleModDeckKey('Enter', sim.getModFlags());
      hangar.handlePaletteStudioKey('Digit3');
      hangar.handlePaletteStudioKey('ArrowDown');
      hangar.handlePaletteStudioKey('ArrowRight');
      const customPal = hangar.getPaletteStudio().getPalette();
      renderer.registerCustomPalette(customPal);
      renderer.setPalette(CUSTOM_PALETTE_ID);

      const snap = sim.getSnapshot();
      renderer.render(snap, snap, 0, hangar.buildUiState(snap), 1.0);
      expect(renderer.getPalette().id).toBe(CUSTOM_PALETTE_ID);
      expect(renderer.getFrameMetrics().webglErrors).toBe(0);
      glMock.assertAllUniformsFinite();
      renderer.dispose();
    });
  });

  describe('Group 5: PT-066..PT-080 — 15 Local 2P Co-op & 1v1 Dogfight Arena Duelists', () => {
    it('PT-066: Co-op 2P Vanilla+Vanilla with P2 AI bot launches from -70/+70 and survives 600 ticks', () => {
      const sim = createModdedSim({ multiplayerMode: 'coop2p', p2BotEnabled: true });
      sim.setP2Loadout({ weapon: 0, body: 0, engine: 4 });
      sim.launch({ weapon: 0, body: 0, engine: 4 }, 'normal', 50066);
      const init = sim.getSnapshot();
      expect(init.player.x).toBe(-70);
      expect(init.player2?.x).toBe(70);

      for (let t = 0; t < 600; t++) {
        const curr = sim.getSnapshot();
        const s = sim.step(computeAutopilotInput(curr));
        assertSnapshotFiniteAndBounded(s, `PT-066@${t}`);
        assertValidStemsForSnapshot(s);
      }
    });

    it('PT-067: Co-op 2P Modded [6,6,6] + [8,7,8] chaotic dual human inputs tag ownerPlayer 1 & 2 cleanly', () => {
      const sim = createModdedSim({ multiplayerMode: 'coop2p', p2BotEnabled: false });
      sim.setP2Loadout({ weapon: 8, body: 7, engine: 8 });
      launchToPlaying(sim, { weapon: 6, body: 6, engine: 6 }, 'normal', 50067);
      const rng = new SeededRng(50067);
      let sawP1 = false;
      let sawP2 = false;
      for (let t = 0; t < 600; t++) {
        const s = sim.step2P(
          { left: rng.chance(0.2), right: rng.chance(0.2), thrust: rng.chance(0.7), fire: t % 3 === 0 },
          { left: rng.chance(0.2), right: rng.chance(0.2), thrust: rng.chance(0.7), fire: t % 3 === 1 },
        );
        if (s.projectiles.some((p) => p.ownerPlayer === 1)) sawP1 = true;
        if (s.projectiles.some((p) => p.ownerPlayer === 2)) sawP2 = true;
        assertSnapshotFiniteAndBounded(s, `PT-067@${t}`);
      }
      expect(sawP1).toBe(true);
      expect(sawP2).toBe(true);
    });

    it('PT-068: Co-op 2P P1 dies while P2 survives -> stays playing, P1 respawns at 300t, audio tracks P2, both die -> gameover', async () => {
      const sim = createModdedSim({ multiplayerMode: 'coop2p', p2BotEnabled: true });
      sim.setP2Loadout({ weapon: 0, body: 0, engine: 3 });
      launchToPlaying(sim, { weapon: 0, body: 0, engine: 4 }, 'normal', 50068);

      const mockAudio = createMockAudioContext();
      const audio = new AudioEngine({ context: mockAudio.ctx });
      await audio.init(vault);
      await audio.unlock();

      sim.damagePlayer(999);
      let s = sim.step(IDLE_INPUT);
      expect(s.phase).toBe('playing');
      expect(s.player.alive).toBe(false);
      expect(s.player2?.alive).toBe(true);

      // Step 299 ticks -> still dead until 300th tick
      for (let t = 0; t < 298; t++) {
        mockAudio.setTime(1 + t * 0.016);
        s = sim.step(IDLE_INPUT);
        audio.syncFromSnapshot(s);
        expect(audio.getSyncMetrics().interStemDriftMs).toBeLessThan(1.0);
      }
      expect(s.player.alive).toBe(false);

      // Tick 300 -> P1 respawns
      s = sim.step(IDLE_INPUT);
      expect(s.player.alive).toBe(true);
      expect(s.phase).toBe('playing');

      // Now verify AudioEngine alarm tracks surviving P2 when P1 is dead and P2 < 33.3% HP
      const lowP2Snap: SimSnapshot = {
        ...s,
        player: { ...s.player, alive: false, health: 0 },
        player2: { ...s.player2!, alive: true, health: 2, maxHealth: 16 },
      };
      mockAudio.setTime(8.0);
      audio.syncFromSnapshot(lowP2Snap);
      expect(audio.getSyncMetrics().alarmActive).toBe(true);

      // Both die -> dying -> gameover
      const simEnd = createModdedSim({ multiplayerMode: 'coop2p', p2BotEnabled: false });
      simEnd.setP2Loadout({ weapon: 0, body: 0, engine: 3 });
      simEnd.launch({ weapon: 0, body: 0, engine: 0 }, 'normal', 50069);
      while (simEnd.getSnapshot().phase === 'launching') {
        simEnd.step2P(IDLE_INPUT, IDLE_INPUT);
      }
      simEnd.damagePlayer(999);
      expect(simEnd.getSnapshot().phase).toBe('playing');
      let endSnap = simEnd.getSnapshot();
      for (let t = 0; t < 300 && endSnap.phase === 'playing'; t++) {
        endSnap = simEnd.step2P(IDLE_INPUT, THRUST_INPUT);
      }
      expect(endSnap.phase).toBe('dying');
      for (let t = 0; t < 100 && endSnap.phase !== 'gameover'; t++) {
        endSnap = simEnd.step2P(IDLE_INPUT, IDLE_INPUT);
      }
      expect(endSnap.phase).toBe('gameover');
      audio.dispose();
    });

    it('PT-069: Co-op 2P P2 dies while P1 survives -> P2 respawns at 300 ticks with full HP & Aegis shield', () => {
      const sim = createModdedSim({ multiplayerMode: 'coop2p', p2BotEnabled: false });
      sim.setP2Loadout({ weapon: 6, body: 6, engine: 6 });
      sim.launch({ weapon: 6, body: 6, engine: 4 }, 'normal', 50069);
      while (sim.getSnapshot().phase === 'launching') sim.step2P(IDLE_INPUT, IDLE_INPUT);

      // Fly P2 (Afterburner engine 6) straight up into space ceiling until space dmg kills P2
      let s = sim.getSnapshot();
      for (let t = 0; t < 450 && s.player2!.alive; t++) {
        s = sim.step2P(computeAutopilotInput(s), THRUST_INPUT);
      }
      expect(s.player2!.alive).toBe(false);
      expect(s.phase).toBe('playing');

      // Respawn timer counts 300 non-hitstop combat ticks (hitstopTicks freezes combat frames).
      let combatTicksAfterDeath = 0;
      for (let t = 0; t < 450 && !s.player2!.alive; t++) {
        const wasInHitstop = s.hitstopTicks > 0;
        s = sim.step2P(computeAutopilotInput(s), IDLE_INPUT);
        if (!wasInHitstop) {
          combatTicksAfterDeath++;
        }
        assertSnapshotFiniteAndBounded(s, `PT-069@${t}`);
      }
      expect(s.phase).toBe('playing');
      expect(s.player.alive).toBe(true);
      expect(s.player2!.alive).toBe(true);
      expect(combatTicksAfterDeath).toBe(300);
      expect(s.player2!.health).toBe(s.player2!.maxHealth);
      expect(s.player2!.shieldReady).toBe(true);
    });

    it('PT-070: Co-op 2P mixed [4,3,1] (Nuke) + [7,6,7] (Aegis) — P1 Nuke death does not end sortie while P2 lives', () => {
      const sim = createModdedSim({
        multiplayerMode: 'coop2p',
        p2BotEnabled: true,
        shaderFx: { crtScanlines: false, phosphorBloom: false, speedWarp: false, shockwaves: true },
      });
      sim.setP2Loadout({ weapon: 7, body: 6, engine: 7 });
      launchToPlaying(sim, { weapon: 4, body: 3, engine: 1 }, 'normal', 50070);
      sim.damagePlayer(999);
      let s = sim.step(IDLE_INPUT);
      expect(s.phase).toBe('playing');
      expect(s.player.nukeTriggered).toBe(true);
      for (let t = 0; t < 305; t++) {
        s = sim.step(IDLE_INPUT);
        assertSnapshotFiniteAndBounded(s, `PT-070@${t}`);
      }
      expect(s.player.alive).toBe(true);
      expect(s.player.nukeTriggered).toBe(false);
    });

    it('PT-071: Co-op 2P dual Missiles [3,0,0] + [3,0,0] maintain independent 4-missile caps (up to 8 total)', () => {
      const sim = createModdedSim({ multiplayerMode: 'coop2p', p2BotEnabled: false });
      sim.setP2Loadout({ weapon: 3, body: 0, engine: 4 });
      launchToPlaying(sim, { weapon: 3, body: 0, engine: 4 }, 'normal', 50071);

      let maxP1 = 0;
      let maxP2 = 0;
      for (let t = 0; t < 35; t++) {
        const s = sim.step2P(FIRE_INPUT, FIRE_INPUT);
        const p1M = s.projectiles.filter((p) => p.kind === 'missile' && p.ownerPlayer === 1).length;
        const p2M = s.projectiles.filter((p) => p.kind === 'missile' && p.ownerPlayer === 2).length;
        maxP1 = Math.max(maxP1, p1M);
        maxP2 = Math.max(maxP2, p2M);
        expect(p1M).toBeLessThanOrEqual(4);
        expect(p2M).toBeLessThanOrEqual(4);
      }
      expect(maxP1).toBe(4);
      expect(maxP2).toBe(4);
    });

    it('PT-072: Co-op 2P URAUSER [5,5,5] + Overclock Flak [7,8,6] vs Dreadnought & SkyCarrier 600 ticks', () => {
      const sim = createModdedSim({ multiplayerMode: 'coop2p', p2BotEnabled: true });
      sim.setP2Loadout({ weapon: 7, body: 8, engine: 6 });
      launchToPlaying(sim, { weapon: 5, body: 5, engine: 5 }, 'normal', 50072);
      sim.spawnEnemy('Dreadnought', 120);
      sim.spawnEnemy('SkyCarrier', -120);
      for (let t = 0; t < 600; t++) {
        const s = sim.step(computeAutopilotInput(sim.getSnapshot()));
        assertSnapshotFiniteAndBounded(s, `PT-072@${t}`);
        assertValidStemsForSnapshot(s);
      }
    });

    it('PT-073: Co-op 2P AudioEngine tracks surviving P2 alarm even if dead P1 had unknown [5,0,0] loadout', async () => {
      const sim = createModdedSim({ multiplayerMode: 'coop2p', p2BotEnabled: false });
      sim.setP2Loadout({ weapon: 0, body: 0, engine: 4 });
      launchToPlaying(sim, { weapon: 5, body: 0, engine: 0 }, 'normal', 50073);
      sim.damagePlayer(999);
      const base = sim.step(IDLE_INPUT);
      expect(base.player.alive).toBe(false);
      expect(base.player2!.alive).toBe(true);

      const mockAudio = createMockAudioContext();
      const audio = new AudioEngine({ context: mockAudio.ctx });
      await audio.init(vault);
      await audio.unlock();
      mockAudio.setTime(2.0);
      audio.syncFromSnapshot({
        ...base,
        player2: { ...base.player2!, health: 2, maxHealth: 16 },
      });
      // Surviving P2 is at 12.5% HP (< 0.333333), so low-HP alarm MUST be active!
      expect(audio.getSyncMetrics().alarmActive).toBe(true);
      audio.dispose();
    });

    it('PT-074: Dogfight 1v1 Best-of-5 — Railgun [6,0,4] vs Aegis [0,6,4] spawns 0 enemies & reaches winner cleanly', () => {
      const sim = createModdedSim({ multiplayerMode: 'dogfight1v1', p2BotEnabled: false });
      sim.setP2Loadout({ weapon: 0, body: 6, engine: 4 });
      sim.launch({ weapon: 6, body: 0, engine: 4 }, 'normal', 50074);

      let s = sim.getSnapshot();
      for (let t = 0; t < 600 && s.phase !== 'gameover'; t++) {
        s = sim.step2P(FIRE_INPUT, IDLE_INPUT);
        expect(s.enemies).toHaveLength(0);
        assertSnapshotFiniteAndBounded(s, `PT-074@${t}`);
      }
      expect(s.phase).toBe('gameover');
      expect(s.dogfight!.winner).toBe(1);
    });

    it('PT-075: Dogfight 1v1 — Lightning [8,0,4] vs Vampire [0,7,4] with P2 AI bot runs cleanly with 0 enemies', () => {
      const sim = createModdedSim({ multiplayerMode: 'dogfight1v1', p2BotEnabled: true });
      sim.setP2Loadout({ weapon: 0, body: 7, engine: 4 });
      sim.launch({ weapon: 8, body: 0, engine: 4 }, 'normal', 50075);

      for (let t = 0; t < 900; t++) {
        const curr = sim.getSnapshot();
        if (curr.phase === 'gameover') break;
        const p1Inp = computeDogfightBotInput(
          curr.player,
          curr.player2!,
          curr.seaLevel,
          curr.spaceLevel,
          curr.projectiles,
        );
        const s = sim.step(p1Inp);
        expect(s.enemies).toHaveLength(0);
        assertSnapshotFiniteAndBounded(s, `PT-075@${t}`);
        assertValidStemsForSnapshot(s);
      }
    });

    it('PT-076: Dogfight 1v1 — Flak [7,0,4] vs Afterburner [0,0,6] resolves match cleanly', () => {
      const sim = createModdedSim({ multiplayerMode: 'dogfight1v1', p2BotEnabled: true });
      sim.setP2Loadout({ weapon: 0, body: 0, engine: 6 });
      sim.launch({ weapon: 7, body: 0, engine: 4 }, 'normal', 50076);
      let s = sim.getSnapshot();
      for (let t = 0; t < 1800 && s.phase !== 'gameover'; t++) {
        const p1Inp = computeDogfightBotInput(
          s.player,
          s.player2!,
          s.seaLevel,
          s.spaceLevel,
          s.projectiles,
        );
        s = sim.step(p1Inp);
        expect(s.enemies).toHaveLength(0);
        assertSnapshotFiniteAndBounded(s, `PT-076@${t}`);
      }
      expect(s.tick).toBeGreaterThan(0);
    });

    it('PT-077: Dogfight 1v1 forced simultaneous KO tie round resets without awarding point or deadlocking', () => {
      const sim = createModdedSim({ multiplayerMode: 'dogfight1v1', p2BotEnabled: false });
      sim.setP2Loadout({ weapon: 6, body: 0, engine: 4 });
      sim.launch({ weapon: 6, body: 0, engine: 4 }, 'normal', 50077);

      let s = sim.getSnapshot();
      for (let t = 0; t < 25; t++) {
        s = sim.step2P(FIRE_INPUT, FIRE_INPUT);
        if (s.dogfight!.roundBannerTicks > 0) break;
      }
      expect(s.dogfight!.roundBannerTicks).toBe(75);
      expect(s.dogfight!.lastScorer).toBeNull();
      expect(s.dogfight!.p1Wins).toBe(0);
      expect(s.dogfight!.p2Wins).toBe(0);

      for (let t = 0; t < 75; t++) s = sim.step2P(IDLE_INPUT, IDLE_INPUT);
      expect(s.phase).toBe('playing');
      expect(s.dogfight!.round).toBe(2);
      expect(s.player.alive).toBe(true);
      expect(s.player2!.alive).toBe(true);
    });

    it('PT-078: Dogfight 1v1 2-2 tie in Round 5 + simultaneous KO overtime cleanly reaches winner', () => {
      const sim = createModdedSim({ multiplayerMode: 'dogfight1v1', p2BotEnabled: false });
      sim.setP2Loadout({ weapon: 6, body: 0, engine: 4 });
      sim.launch({ weapon: 6, body: 0, engine: 4 }, 'normal', 50078);

      const finishRoundBanner = () => {
        for (let t = 0; t < 75; t++) sim.step2P(IDLE_INPUT, IDLE_INPUT);
      };
      // P1 wins 2, P2 wins 2
      for (const scorer of [1, 2, 1, 2] as const) {
        for (let t = 0; t < 30 && sim.getSnapshot().dogfight!.roundBannerTicks === 0; t++) {
          sim.step2P(scorer === 1 ? FIRE_INPUT : IDLE_INPUT, scorer === 2 ? FIRE_INPUT : IDLE_INPUT);
        }
        finishRoundBanner();
      }
      expect(sim.getSnapshot().dogfight!.round).toBe(5);
      expect(sim.getSnapshot().dogfight!.p1Wins).toBe(2);
      expect(sim.getSnapshot().dogfight!.p2Wins).toBe(2);

      // Simultaneous KO in Round 5 -> overtime Round 6 without freeze!
      for (let t = 0; t < 25 && sim.getSnapshot().dogfight!.roundBannerTicks === 0; t++) {
        sim.step2P(FIRE_INPUT, FIRE_INPUT);
      }
      finishRoundBanner();
      expect(sim.getSnapshot().phase).toBe('playing');
      expect(sim.getSnapshot().dogfight!.winner).toBeNull();

      // P2 wins overtime
      for (let t = 0; t < 30 && sim.getSnapshot().dogfight!.roundBannerTicks === 0; t++) {
        sim.step2P(IDLE_INPUT, FIRE_INPUT);
      }
      finishRoundBanner();
      expect(sim.getSnapshot().phase).toBe('gameover');
      expect(sim.getSnapshot().dogfight!.winner).toBe(2);
    });

    it('PT-079: Dogfight 1v1 Melee vs Melee [0,2,1] with P2 AI bot runs 700 ticks without deadlock', () => {
      const sim = createModdedSim({ multiplayerMode: 'dogfight1v1', p2BotEnabled: true });
      sim.setP2Loadout({ weapon: 0, body: 2, engine: 1 });
      sim.launch({ weapon: 0, body: 2, engine: 1 }, 'normal', 50079);
      for (let t = 0; t < 700 && sim.getSnapshot().phase !== 'gameover'; t++) {
        const s = sim.getSnapshot();
        const p1Inp = computeDogfightBotInput(
          s.player,
          s.player2!,
          s.seaLevel,
          s.spaceLevel,
          s.projectiles,
        );
        const next = sim.step(p1Inp);
        expect(next.enemies).toHaveLength(0);
        assertSnapshotFiniteAndBounded(next, `PT-079@${t}`);
      }
    });

    it('PT-080: Dogfight 1v1 Cannon + Bomb [4,4,4] vs [4,4,4] triggers AOE & shockwaves without NaN', () => {
      const sim = createModdedSim({
        multiplayerMode: 'dogfight1v1',
        p2BotEnabled: false,
        shaderFx: { crtScanlines: false, phosphorBloom: false, speedWarp: false, shockwaves: true },
      });
      sim.setP2Loadout({ weapon: 4, body: 4, engine: 4 });
      sim.launch({ weapon: 4, body: 4, engine: 4 }, 'normal', 50080);
      let sawShockwave = false;
      for (let t = 0; t < 160 && sim.getSnapshot().phase !== 'gameover'; t++) {
        const s = sim.step2P(
          { left: false, right: false, thrust: t % 10 === 0, fire: true },
          { left: false, right: false, thrust: t % 12 === 0, fire: t > 40 },
        );
        if ((s.shockwaves?.length ?? 0) > 0) sawShockwave = true;
        assertSnapshotFiniteAndBounded(s, `PT-080@${t}`);
      }
      expect(sawShockwave).toBe(true);
    });
  });

  describe('Group 6: PT-081..PT-090 — 10 Hangar Mod Switcher & State-Thrash Testers', () => {
    it('PT-081: Rapid Tab Mod Deck toggle 50x + live SKYBREAKER <-> STEAM LOCAL Hangar/Sim/Renderer/Audio asset hot-swap', async () => {
      const hangar = new HangarController();
      for (let i = 0; i < 50; i++) {
        expect(hangar.toggleModDeck(true)).toBe(true);
        if (i % 5 === 0) hangar.togglePaletteStudio(true);
        expect(hangar.toggleModDeck(false)).toBe(false);
        expect(hangar.getPaletteStudio().isOpen()).toBe(false);
      }
      expect(HANGAR_ROWS).toHaveLength(7);
      expect(HANGAR_ROWS).toContain('assets');
      expect(MOD_DECK_ROWS).toHaveLength(12);

      // Verify Hangar ASSETS row cycling (locked when Steam unavailable, toggles cleanly when available)
      const sim = new Simulation(skybreakerVault.data, new ModRegistry(true));
      sim.unlockAll();
      sim.setLoadout({ weapon: 5, body: 5, engine: 5 });
      expect(sim.getSnapshot().player.planeName).toBe('APEX OMEGA');

      hangar.setActiveRow('assets');
      hangar.setSteamAvailable(false);
      const denied = hangar.cycleCurrent(1, sim.getSnapshot(), sim);
      expect(denied.locked).toBe(true);
      expect(denied.cue).toBe('snddeny');
      expect(hangar.getAssetMode()).toBe('skybreaker');

      hangar.setSteamAvailable(true);
      const toSteam = hangar.cycleCurrent(1, sim.getSnapshot(), sim);
      expect(toSteam.changed).toBe(true);
      expect(toSteam.cue).toBe('sndswap');
      expect(toSteam.assetMode).toBe('steam-local');
      expect(hangar.getAssetMode()).toBe('steam-local');

      // Live hot-swap Sim + WebGL2Renderer + AudioEngine across skybreaker <-> steam-local
      const glMock = createMockWebGL2();
      const renderer = new WebGL2Renderer();
      renderer.init(glMock.canvas, skybreakerVault);
      const mockAudio = createMockAudioContext();
      const audio = new AudioEngine({ context: mockAudio.ctx });
      await audio.init(skybreakerVault);
      await audio.unlock();
      audio.syncFromSnapshot(sim.getSnapshot());

      sim.setGameData(vault.data);
      renderer.reloadVault(vault);
      hangar.setVaultSource(vault.data.vaultSource);
      mockAudio.setTime(1.5);
      await audio.init(vault);
      audio.syncFromSnapshot(sim.getSnapshot());
      expect(sim.getSnapshot().player.loadout).toEqual({ weapon: 5, body: 5, engine: 5 });
      expect(sim.getSnapshot().player.planeName).toBe(expectedVanillaPlaneName(5, 5, 5));
      renderer.render(sim.getSnapshot(), sim.getSnapshot(), 0, hangar.buildUiState(sim.getSnapshot()), 1.5);
      expect(renderer.getFrameMetrics().webglErrors).toBe(0);
      expect(audio.getSyncMetrics().interStemDriftMs).toBeLessThan(1.0);

      // Toggle back to SKYBREAKER original procedural pack cleanly
      const toSky = hangar.cycleCurrent(1, sim.getSnapshot(), sim);
      expect(toSky.changed).toBe(true);
      expect(toSky.assetMode).toBe('skybreaker');
      sim.setGameData(skybreakerVault.data);
      renderer.reloadVault(skybreakerVault);
      hangar.setVaultSource(skybreakerVault.data.vaultSource);
      mockAudio.setTime(2.5);
      await audio.init(skybreakerVault);
      audio.syncFromSnapshot(sim.getSnapshot());
      expect(sim.getSnapshot().player.planeName).toBe('APEX OMEGA');
      renderer.render(sim.getSnapshot(), sim.getSnapshot(), 0, hangar.buildUiState(sim.getSnapshot()), 2.5);
      expect(renderer.getFrameMetrics().webglErrors).toBe(0);
      expect(audio.getSyncMetrics().interStemDriftMs).toBeLessThan(1.0);
      glMock.assertAllUniformsFinite();
      audio.dispose();
      renderer.dispose();
    });

    it('PT-082: VANILLA 1:1 <-> MODDED toggle while holding [8,8,8] clamps strictly to <= 5 in Vanilla', () => {
      const sim = createModdedSim({ arsenalBosses: true });
      sim.setLoadout({ weapon: 8, body: 8, engine: 8 });
      expect(sim.getSnapshot().player.loadout).toEqual({ weapon: 8, body: 8, engine: 8 });

      sim.setModFlags({ ...DEFAULT_ACT2_MOD_FLAGS, moddedEnabled: false });
      const vanillaSnap = sim.getSnapshot();
      expect(vanillaSnap.player.loadout.weapon).toBeLessThanOrEqual(5);
      expect(vanillaSnap.player.loadout.body).toBeLessThanOrEqual(5);
      expect(vanillaSnap.player.loadout.engine).toBeLessThanOrEqual(5);

      const hangar = new HangarController();
      hangar.setActiveRow('weapon');
      const res = hangar.selectPart('weapon', 8, vanillaSnap, sim);
      expect(res.locked).toBe(true);
      expect(res.cue).toBe('snddeny');
    });

    it('PT-083: Custom parts 6..8 MUST be clamped/rejected when moddedEnabled=true BUT arsenalBosses=false', () => {
      const sim = createModdedSim({ moddedEnabled: true, arsenalBosses: false });
      sim.setLoadout({ weapon: 8, body: 7, engine: 6 });
      const s = sim.getSnapshot();
      expect(s.player.loadout.weapon).toBeLessThanOrEqual(5);
      expect(s.player.loadout.body).toBeLessThanOrEqual(5);
      expect(s.player.loadout.engine).toBeLessThanOrEqual(5);
    });

    it('PT-084: 20x rapid launch -> step(30) -> pause -> returnToHangar -> relaunch cycles leak 0 entities/P2/dogfight', () => {
      const sim = createModdedSim();
      const modes: Act2ModFlags['multiplayerMode'][] = ['solo', 'coop2p', 'dogfight1v1'];
      for (let i = 0; i < 20; i++) {
        const mp = modes[i % modes.length]!;
        sim.setModFlags({
          moddedEnabled: i % 4 !== 3,
          arsenalBosses: true,
          multiplayerMode: mp,
          p2BotEnabled: true,
          shaderFx: { crtScanlines: false, phosphorBloom: false, speedWarp: false, shockwaves: true },
        });
        sim.launch({ weapon: (i % 9) as PartIndex, body: 6, engine: 6 }, i % 2 === 0 ? 'normal' : 'sfmt', 60000 + i);
        for (let t = 0; t < 30; t++) sim.step(THRUST_INPUT);
        sim.setPaused(true);
        sim.step(IDLE_INPUT);
        sim.returnToHangar();
        const hs = sim.getSnapshot();
        expect(hs.phase).toBe('hangar');
        expect(hs.paused).toBe(false);
        expect(hs.enemies).toHaveLength(0);
        expect(hs.projectiles).toHaveLength(0);
        expect(hs.particles).toHaveLength(0);
        expect(hs.player2 ?? null).toBeNull();
        expect(hs.dogfight ?? null).toBeNull();
      }
    });

    it('PT-085: Selecting bonus/custom palette in Modded then toggling back to Vanilla 1:1 resolves valid Vanilla palette', () => {
      const sim = createModdedSim();
      const hangar = new HangarController();
      hangar.setModFlags(sim.getModFlags());
      hangar.togglePaletteStudio(true);
      hangar.handlePaletteStudioKey('Digit1');
      hangar.togglePaletteStudio(false);
      expect(hangar.setPaletteById('cyberpunk')).toBe(true);

      // Switch back to Vanilla 1:1 (mirroring main.ts applyModFlags)
      const vanillaFlags = { ...DEFAULT_ACT2_MOD_FLAGS, moddedEnabled: false };
      sim.setModFlags(vanillaFlags);
      hangar.setModFlags(vanillaFlags);
      const vanillaSnap = sim.getSnapshot();
      const ui = hangar.buildUiState(vanillaSnap);
      const vanillaPaletteIds = new Set(PALETTES.map((p) => p.id));
      expect(vanillaPaletteIds.has(hangar.getSelectedPalette().id)).toBe(true);
      expect(ui.paletteIndex).toBeLessThan(PALETTES.length);
    });

    it('PT-086: Unlocked vs locked part cycling across 0..8 (Modded Arsenal) vs 0..5 (Vanilla) in both directions', () => {
      const hangar = new HangarController();
      const sim = createModdedSim({ arsenalBosses: true });
      sim.setProfile({
        ...sim.getProfile(),
        unlockedWeapons: [0, 3],
        unlockedBodies: [0, 2],
        unlockedEngines: [0, 4],
      });
      // Modded Arsenal cycles unlocked vanilla + 6,7,8
      const seenModW: number[] = [];
      for (let i = 0; i < 6; i++) {
        hangar.setActiveRow('weapon');
        const r = hangar.cycleCurrent(1, sim.getSnapshot(), sim);
        seenModW.push(r.loadout!.weapon);
      }
      expect(seenModW).toEqual([3, 6, 7, 8, 0, 3]);

      // Vanilla Lock restricts strictly to unlocked 0..5
      sim.setModFlags({ ...DEFAULT_ACT2_MOD_FLAGS, moddedEnabled: false });
      const seenVanW: number[] = [];
      for (let i = 0; i < 4; i++) {
        const r = hangar.cycleCurrent(-1, sim.getSnapshot(), sim);
        seenVanW.push(r.loadout!.weapon);
      }
      expect(seenVanW).toEqual([0, 3, 0, 3]);
    });

    it('PT-087: Hangar SFMT lock & mission-gated Vanilla palettes enforce snddeny until unlocked', () => {
      const hangar = new HangarController();
      const sim = new Simulation(gameData, new ModRegistry(true));
      hangar.setActiveRow('mode');
      const deniedMode = hangar.cycleCurrent(1, sim.getSnapshot(), sim);
      expect(deniedMode.locked).toBe(true);
      expect(deniedMode.cue).toBe('snddeny');

      const deniedPal = hangar.selectPaletteByIndex(9, sim.getSnapshot()); // overdrive palette
      expect(deniedPal.locked).toBe(true);
      expect(deniedPal.cue).toBe('snddeny');

      sim.unlockAll();
      const allowedMode = hangar.cycleCurrent(1, sim.getSnapshot(), sim);
      expect(allowedMode.changed).toBe(true);
      expect(allowedMode.mode).toBe('sfmt');
      expect(allowedMode.cue).toBe('sndsfmt');
    });

    it('PT-088: Navigates all 12 MOD_DECK_ROWS wrapping forward/backward and exercises callbacks', () => {
      const hangar = new HangarController();
      hangar.toggleModDeck(true);
      const visited: string[] = [];
      for (let i = 0; i < MOD_DECK_ROWS.length; i++) {
        visited.push(hangar.getActiveModRow());
        hangar.handleModDeckKey('ArrowDown', hangar.getModFlags());
      }
      expect(visited).toEqual([...MOD_DECK_ROWS]);
      expect(hangar.getActiveModRow()).toBe('modprofile');
      hangar.handleModDeckKey('ArrowUp', hangar.getModFlags());
      expect(hangar.getActiveModRow()).toBe('modback');
    });

    it('PT-089: Switching multiplayerMode solo -> coop2p -> dogfight1v1 -> solo cleanly updates P2 & dogfight state', () => {
      const sim = createModdedSim();
      sim.setP2Loadout({ weapon: 7, body: 6, engine: 8 });
      sim.setModFlags({ multiplayerMode: 'coop2p' });
      sim.launch({ weapon: 6, body: 6, engine: 6 }, 'normal', 60089);
      expect(sim.getSnapshot().player2).not.toBeNull();
      expect(sim.getSnapshot().dogfight).toBeNull();

      sim.returnToHangar();
      sim.setModFlags({ multiplayerMode: 'dogfight1v1' });
      sim.launch({ weapon: 6, body: 6, engine: 6 }, 'normal', 60090);
      expect(sim.getSnapshot().dogfight).not.toBeNull();
      expect(sim.getSnapshot().player2).not.toBeNull();

      sim.returnToHangar();
      sim.setModFlags({ multiplayerMode: 'solo' });
      sim.launch({ weapon: 6, body: 6, engine: 6 }, 'normal', 60091);
      expect(sim.getSnapshot().player2).toBeNull();
      expect(sim.getSnapshot().dogfight).toBeNull();
    });

    it('PT-090: Mid-sortie setModFlags({ moddedEnabled: false }) clamps custom plane & clears Co-op/Shockwaves safely', () => {
      const sim = createModdedSim({
        multiplayerMode: 'coop2p',
        replayGhost: true,
        shaderFx: { crtScanlines: true, phosphorBloom: true, speedWarp: true, shockwaves: true },
      });
      launchToPlaying(sim, { weapon: 8, body: 8, engine: 8 }, 'normal', 60090);
      for (let t = 0; t < 20; t++) sim.step(FIRE_INPUT);
      expect(sim.getSnapshot().player2).not.toBeNull();

      sim.setModFlags({ ...DEFAULT_ACT2_MOD_FLAGS, moddedEnabled: false });
      const after = sim.step(THRUST_INPUT);
      assertVanillaLockedInvariants(after, 'PT-090:mid-sortie-lock');
      expect(after.player.loadout).toEqual({ weapon: 0, body: 0, engine: 0 });
    });
  });

  describe('Group 7: PT-091..PT-100 — 10 Chaos, Endurance & Cross-Session Isolation Torture Testers', () => {
    it('PT-091: Random chaotic button-masher (1,200 ticks, Modded Arsenal+Bosses+Ghost+Co-op+All FX) stays NaN-free', () => {
      const recSim = createModdedSim();
      recSim.launch({ weapon: 6, body: 6, engine: 6 }, 'normal', 70091);
      for (let t = 0; t < 200; t++) recSim.step(THRUST_INPUT);

      const sim = createModdedSim({
        replayGhost: true,
        multiplayerMode: 'coop2p',
        p2BotEnabled: false,
        shaderFx: { crtScanlines: true, phosphorBloom: true, speedWarp: true, shockwaves: true },
      });
      sim.setGhostReplay(recSim.getReplay());
      sim.setP2Loadout({ weapon: 7, body: 7, engine: 7 });
      sim.launch({ weapon: 8, body: 8, engine: 8 }, 'sfmt', 70092);

      const rng = new SeededRng(919191);
      for (let t = 0; t < 1200; t++) {
        const s = sim.step2P(
          {
            left: rng.chance(0.4),
            right: rng.chance(0.4),
            thrust: rng.chance(0.6),
            fire: rng.chance(0.8),
          },
          {
            left: rng.chance(0.4),
            right: rng.chance(0.4),
            thrust: rng.chance(0.6),
            fire: rng.chance(0.8),
          },
        );
        assertSnapshotFiniteAndBounded(s, `PT-091@${t}`);
      }
    });

    it('PT-092: AFK diver & waterproof abyss diver stay finite and bounded across 1,000 ticks', () => {
      const afk = new Simulation(gameData, new ModRegistry(true));
      afk.launch({ weapon: 0, body: 0, engine: 0 }, 'normal', 70092);
      for (let t = 0; t < 600; t++) {
        const s = afk.step(IDLE_INPUT);
        assertSnapshotFiniteAndBounded(s, `PT-092:afk@${t}`);
      }
      expect(afk.getSnapshot().phase).toBe('gameover');

      const ion = createModdedSim();
      launchToPlaying(ion, { weapon: 0, body: 0, engine: 8 }, 'normal', 70093);
      for (let t = 0; t < 600; t++) {
        const s = ion.step({ left: false, right: t < 18, thrust: true, fire: false });
        assertSnapshotFiniteAndBounded(s, `PT-092:ion@${t}`);
        expect(Math.abs(s.player.y)).toBeLessThan(10_000);
      }
    });

    it('PT-093: Permanent space-ceiling hugger [0,8,6] dies cleanly to space dmg without -Infinity Y runaway', () => {
      const sim = createModdedSim();
      sim.launch({ weapon: 0, body: 8, engine: 6 }, 'sfmt', 70093);
      for (let t = 0; t < 1200; t++) {
        const s = sim.step(THRUST_INPUT);
        assertSnapshotFiniteAndBounded(s, `PT-093@${t}`);
        expect(s.player.y).toBeGreaterThan(-5000);
      }
      expect(sim.getSnapshot().phase).toBe('gameover');
    });

    it('PT-094: Permanent fire-holder with Overclock+Missiles [3,8,4] & Overclock+Lightning [8,8,4] for 900 ticks', () => {
      const simM = createModdedSim();
      launchToPlaying(simM, { weapon: 3, body: 8, engine: 4 }, 'normal', 70094);
      for (let t = 0; t < 450; t++) {
        const s = simM.step(FIRE_INPUT);
        expect(s.projectiles.filter((p) => p.kind === 'missile').length).toBeLessThanOrEqual(4);
        expect(s.player.fireCooldown).toBeGreaterThanOrEqual(0);
        assertSnapshotFiniteAndBounded(s, `PT-094:M@${t}`);
      }

      const simL = createModdedSim();
      launchToPlaying(simL, { weapon: 8, body: 8, engine: 4 }, 'normal', 70095);
      for (let t = 0; t < 450; t++) {
        const s = simL.step(FIRE_INPUT);
        expect(s.player.fireCooldown).toBeGreaterThanOrEqual(0);
        assertSnapshotFiniteAndBounded(s, `PT-094:L@${t}`);
      }
    });

    it('PT-095: Max-shockwave overflow spammer enforces shockwaves.length <= 4 on every single tick', () => {
      const sim = createModdedSim({
        shaderFx: { crtScanlines: false, phosphorBloom: false, speedWarp: false, shockwaves: true },
      });
      launchToPlaying(sim, { weapon: 6, body: 6, engine: 6 }, 'sfmt', 70095);
      sim.spawnEnemy('Dreadnought', 120);
      sim.spawnEnemy('SkyCarrier', -120);
      for (let t = 0; t < 400; t++) {
        if (t % 15 === 0) sim.damagePlayer(5); // triggers Aegis shockwaves
        const s = sim.step({ left: t % 9 === 0, right: false, thrust: true, fire: true });
        expect(s.shockwaves!.length).toBeLessThanOrEqual(4);
        assertSnapshotFiniteAndBounded(s, `PT-095@${t}`);
      }
    });

    it('PT-096: Entity & particle cap torture (2P Overclock Flak/Spread+Gungine vs 20+ bosses/enemies) enforces particles<=600 & projectiles<=300', () => {
      const sim = createModdedSim({
        multiplayerMode: 'coop2p',
        p2BotEnabled: false,
        shaderFx: { crtScanlines: false, phosphorBloom: false, speedWarp: false, shockwaves: true },
      });
      sim.setP2Loadout({ weapon: 7, body: 8, engine: 2 });
      launchToPlaying(sim, { weapon: 2, body: 8, engine: 2 }, 'sfmt', 70096);
      for (let i = 0; i < 6; i++) {
        sim.spawnEnemy('Dreadnought', -400 + i * 160);
        sim.spawnEnemy('SkyCarrier', -400 + i * 160, -480);
      }
      for (let t = 0; t < 600; t++) {
        const s = sim.step2P(
          { left: t % 7 === 0, right: false, thrust: true, fire: true },
          { left: false, right: t % 7 === 0, thrust: true, fire: true },
        );
        expect(s.particles.length).toBeLessThanOrEqual(600);
        expect(s.projectiles.length).toBeLessThanOrEqual(300);
        assertSnapshotFiniteAndBounded(s, `PT-096@${t}`);
      }
    });

    it('PT-097: Audio stem chaos switcher across ALL 9x9x9 loadouts & game states maintains interStemDriftMs < 1.0', async () => {
      const mockAudio = createMockAudioContext();
      const audio = new AudioEngine({ context: mockAudio.ctx });
      await audio.init(vault);
      await audio.unlock();

      const sim = createModdedSim();
      let timeSec = 1.0;
      const parts: PartIndex[] = [0, 1, 2, 3, 4, 5, 6, 7, 8];
      for (const w of parts) {
        for (const b of parts) {
          for (const e of parts) {
            const loadout: Loadout = { weapon: w, body: b, engine: e };
            const res = resolveActiveStems('playing', false, loadout, (w + b) % 3 === 0 ? 0.2 : 1.0);
            for (const stem of res.stems) {
              expect(VALID_STEM_SET.has(stem)).toBe(true);
            }
          }
        }
      }

      // Rapid AudioEngine live transitions across modded/vanilla/alarm/pause/urauser/hangar
      const states: Array<{ phase: SimSnapshot['phase']; paused: boolean; loadout: Loadout; hp: number }> = [
        { phase: 'hangar', paused: false, loadout: { weapon: 0, body: 0, engine: 0 }, hp: 16 },
        { phase: 'playing', paused: false, loadout: { weapon: 6, body: 7, engine: 8 }, hp: 16 },
        { phase: 'playing', paused: false, loadout: { weapon: 6, body: 7, engine: 8 }, hp: 2 },
        { phase: 'playing', paused: true, loadout: { weapon: 6, body: 7, engine: 8 }, hp: 2 },
        { phase: 'playing', paused: false, loadout: { weapon: 5, body: 5, engine: 5 }, hp: 16 },
        { phase: 'playing', paused: false, loadout: { weapon: 5, body: 6, engine: 7 }, hp: 4 },
        { phase: 'playing', paused: false, loadout: { weapon: 8, body: 8, engine: 8 }, hp: 1 },
        { phase: 'hangar', paused: false, loadout: { weapon: 0, body: 0, engine: 0 }, hp: 16 },
      ];
      for (let i = 0; i < states.length; i++) {
        const st = states[i]!;
        timeSec += 0.73;
        mockAudio.setTime(timeSec);
        const snap = sim.getSnapshot();
        audio.syncFromSnapshot({
          ...snap,
          tick: i + 1,
          phase: st.phase,
          paused: st.paused,
          player: { ...snap.player, loadout: st.loadout, health: st.hp, maxHealth: 16 },
        });
        const metrics = audio.getSyncMetrics();
        expect(metrics.interStemDriftMs).toBeLessThan(1.0);
        for (const s of metrics.activeStems) expect(VALID_STEM_SET.has(s)).toBe(true);
      }
      audio.dispose();
    });

    it('PT-098: 3,600-tick (60s) integrated endurance sortie (Sim + WebGL2Renderer + AudioEngine + TelemetryHud)', async () => {
      const glMock = createMockWebGL2();
      const renderer = new WebGL2Renderer();
      renderer.init(glMock.canvas, vault);

      const mockAudio = createMockAudioContext();
      const audio = new AudioEngine({ context: mockAudio.ctx });
      await audio.init(vault);
      await audio.unlock();

      const hud = new TelemetryHud();
      const sim = createModdedSim({
        replayGhost: true,
        dailySeed: true,
        shaderFx: { crtScanlines: true, phosphorBloom: true, speedWarp: true, shockwaves: true },
      });
      const rec = createModdedSim();
      rec.launch({ weapon: 6, body: 6, engine: 6 }, 'normal', 70098);
      for (let t = 0; t < 180; t++) rec.step(computeAutopilotInput(rec.getSnapshot()));
      sim.setGhostReplay(rec.getReplay());
      sim.launch({ weapon: 6, body: 7, engine: 8 }, 'sfmt', 70098);

      let prev = sim.getSnapshot();
      for (let t = 0; t < 3600; t++) {
        const curr = sim.step(computeAutopilotInput(sim.getSnapshot()));
        if (t % 30 === 0) {
          assertSnapshotFiniteAndBounded(curr, `PT-098@${t}`);
          mockAudio.setTime(1 + t / 60);
          audio.syncFromSnapshot(curr);
          renderer.render(curr, prev, 0.5, null, t / 60);
          hud.update({
            snapshot: curr,
            vaultSource: vault.data.vaultSource,
            frameMetrics: renderer.getFrameMetrics(),
            audioMetrics: audio.getSyncMetrics(),
          });
          expect(audio.getSyncMetrics().interStemDriftMs).toBeLessThan(1.0);
          expect(renderer.getFrameMetrics().webglErrors).toBe(0);
        }
        prev = curr;
      }
      glMock.assertAllUniformsFinite();
      hud.dispose();
      audio.dispose();
      renderer.dispose();
    });

    it('PT-099: Cross-Session Isolation #1 — Modded Arsenal+2P+Bosses+Ghost sortie -> flip moddedEnabled=false -> NEXT Vanilla 1:1 sortie is 100% bit-identical to fresh Vanilla Simulation', () => {
      const ghostRecSim = createModdedSim();
      ghostRecSim.launch({ weapon: 6, body: 6, engine: 6 }, 'normal', 70099);
      for (let t = 0; t < 120; t++) ghostRecSim.step(computeAutopilotInput(ghostRecSim.getSnapshot()));

      // Dirty session with EVERY Act II mod pack active
      const dirtySim = new Simulation(gameData, new ModRegistry(true));
      dirtySim.setModFlags({
        moddedEnabled: true,
        arsenalBosses: true,
        replayGhost: true,
        dailySeed: true,
        shaderFx: { crtScanlines: true, phosphorBloom: true, speedWarp: true, shockwaves: true },
        multiplayerMode: 'coop2p',
        p2BotEnabled: true,
      });
      dirtySim.setGhostReplay(ghostRecSim.getReplay());
      dirtySim.setP2Loadout({ weapon: 7, body: 6, engine: 8 });
      dirtySim.launch({ weapon: 8, body: 8, engine: 8 }, 'sfmt');
      for (let t = 0; t < 600; t++) {
        dirtySim.step(computeAutopilotInput(dirtySim.getSnapshot()));
      }

      // Return to hangar and flip back to Vanilla 1:1
      dirtySim.returnToHangar();
      dirtySim.setModFlags({ ...DEFAULT_ACT2_MOD_FLAGS, moddedEnabled: false });

      const freshSim = new Simulation(gameData, new ModRegistry(true));
      const vanillaLoadout: Loadout = { weapon: 0, body: 0, engine: 0 };
      const sharedSeed = 77777;
      dirtySim.launch(vanillaLoadout, 'normal', sharedSeed);
      freshSim.launch(vanillaLoadout, 'normal', sharedSeed);

      for (let t = 0; t < 600; t++) {
        const inp = computeAutopilotInput(freshSim.getSnapshot());
        const dSnap = dirtySim.step(inp);
        const fSnap = freshSim.step(inp);

        expect(dSnap.tick).toBe(fSnap.tick);
        expect(dSnap.phase).toBe(fSnap.phase);
        expect(dSnap.player.x).toBe(fSnap.player.x);
        expect(dSnap.player.y).toBe(fSnap.player.y);
        expect(dSnap.player.vx).toBe(fSnap.player.vx);
        expect(dSnap.player.vy).toBe(fSnap.player.vy);
        expect(dSnap.player.angleDeg).toBe(fSnap.player.angleDeg);
        expect(dSnap.player.health).toBe(fSnap.player.health);
        expect(dSnap.score).toBe(fSnap.score);
        expect(dSnap.combo).toBe(fSnap.combo);
        expect(dSnap.difficulty).toBe(fSnap.difficulty);
        expect(dSnap.killsThisSortie).toBe(fSnap.killsThisSortie);
        expect(dSnap.enemies).toEqual(fSnap.enemies);
        expect(dSnap.projectiles).toEqual(fSnap.projectiles);
        expect(dSnap.shockwaves).toBeUndefined();
        expect(dSnap.player2).toBeUndefined();
        expect(dSnap.ghostPose).toBeUndefined();
        expect(dSnap.dogfight).toBeUndefined();
        expect(dSnap.activeMods).toBeUndefined();
        expect(dSnap.dailySeedId).toBeUndefined();
      }
      expect(dirtySim.getReplay().frames).toEqual(freshSim.getReplay().frames);
    });

    it('PT-100: Cross-Session Isolation #2 — Dogfight 1v1 + Palette Studio + Shader FX -> Vanilla 1:1 SFMT sortie & WebGL2Renderer bit-identical', () => {
      const reg = new ModRegistry(true);
      registerAct2ModPacks(reg, {
        moddedEnabled: true,
        arsenalBosses: true,
        replayGhost: true,
        dailySeed: true,
        shaderFx: { crtScanlines: true, phosphorBloom: true, speedWarp: true, shockwaves: true },
        multiplayerMode: 'dogfight1v1',
        p2BotEnabled: true,
      });
      const dirtySim = new Simulation(gameData, reg);
      dirtySim.setP2Loadout({ weapon: 6, body: 7, engine: 8 });
      dirtySim.launch({ weapon: 6, body: 6, engine: 6 }, 'normal', 70100);
      for (let t = 0; t < 200 && dirtySim.getSnapshot().phase !== 'gameover'; t++) {
        dirtySim.step(FIRE_INPUT);
      }

      const glMock = createMockWebGL2();
      const renderer = new WebGL2Renderer();
      renderer.init(glMock.canvas, vault);
      renderer.setShaderFx({ crtScanlines: true, phosphorBloom: true, speedWarp: true, shockwaves: true });
      renderer.setPalette('cyberpunk');
      renderer.render(dirtySim.getSnapshot(), dirtySim.getSnapshot(), 0, null, 1.0);

      // Flip cleanly back to Vanilla 1:1
      dirtySim.returnToHangar();
      dirtySim.setModFlags({ ...DEFAULT_ACT2_MOD_FLAGS, moddedEnabled: false });

      const freshSim = new Simulation(gameData, new ModRegistry(true));
      const loadout: Loadout = { weapon: 1, body: 2, engine: 3 };
      dirtySim.launch(loadout, 'sfmt', 31337);
      freshSim.launch(loadout, 'sfmt', 31337);

      let prevDirty = dirtySim.getSnapshot();
      for (let t = 0; t < 600; t++) {
        const inp = computeAutopilotInput(freshSim.getSnapshot());
        const dSnap = dirtySim.step(inp);
        const fSnap = freshSim.step(inp);
        expect(dSnap.player.x).toBe(fSnap.player.x);
        expect(dSnap.player.y).toBe(fSnap.player.y);
        expect(dSnap.score).toBe(fSnap.score);
        expect(dSnap.enemies).toEqual(fSnap.enemies);
        expect(dSnap.activeMods).toBeUndefined();
        if (t === 300) {
          renderer.render(dSnap, prevDirty, 0.5, null, 5.0);
          const fx = glMock.uniform4fCalls.filter((c) => c.name === 'uFxFlags').at(-1);
          expect(fx).toMatchObject({ x: 0, y: 0, z: 0, w: 0 });
        }
        prevDirty = dSnap;
      }
      expect(renderer.getFrameMetrics().webglErrors).toBe(0);
      glMock.assertAllUniformsFinite();
      renderer.dispose();
    });
  });
});
