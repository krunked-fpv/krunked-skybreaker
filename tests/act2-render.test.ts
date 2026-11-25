import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ACT2_MOD_FLAGS,
  DEFAULT_SHADER_FX,
  type Act2ModFlags,
} from '../src/contracts/mod';
import type { PaletteDefinition, RgbaTuple } from '../src/contracts/render';
import type { Loadout, PilotProfile, SimSnapshot } from '../src/contracts/sim';
import type {
  BodySpec,
  EngineSpec,
  VaultAssetBundle,
  WeaponSpec,
} from '../src/contracts/vault';
import {
  ACT2_BONUS_PALETTES,
  CUSTOM_PALETTE_ID,
  OUTPASS_FRAG,
  PALETTES,
  POST_WATER_FRAG,
  WebGL2Renderer,
  createDefaultCustomPalette,
  rgbaToHex,
  sanitizeCustomPalette,
} from '../src/render';
import { resolveEnemyRenderTransform } from '../src/render/renderer';
import {
  HANGAR_ROWS,
  HangarController,
  MOD_DECK_ROWS,
  PALETTE_SLOT_LABELS,
  PaletteStudioController,
  formatTelemetryLines,
} from '../src/ui';

function rgbDist(a: RgbaTuple, b: RgbaTuple): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function makeWeapon(id: number, name = `WEAPON_${id}`): WeaponSpec {
  return {
    id,
    name,
    descr: `Weapon ${name}`,
    sprite: 'wings_original',
    projectile: 'bullet',
    interval: 3,
    maxbullets: 0,
    recoil: 0,
    spread: 3,
    numbullets: 1,
    flags: '',
  };
}

function makeBody(id: number, name = `BODY_${id}`): BodySpec {
  return {
    id,
    name,
    descr: `Body ${name}`,
    sprite: 'body_original',
    speedmodifier: 1,
    healingspd: 0.16,
    impactrecvdmgmult: 1,
    impactdealdmgmult: 1,
    impactdmgmult: 1,
    impactdealcritical: 0,
    impactdealcriticaldmg: 0,
    impactsleeptime: 10,
    impactcamshake: 2,
    impactspeedmult: 1,
    maxhealth: 100,
    meleedmg: 10,
    flags: '',
  };
}

function makeEngine(id: number, name = `ENGINE_${id}`): EngineSpec {
  return {
    id,
    name,
    descr: `Engine ${name}`,
    sprite: 'engine_original',
    booststartsprite: 'fx_booststart',
    boostloopsprite: 'fx_boostloop',
    boostendparticle: 'fx_boostend',
    boostidlesprite: '',
    acceleration: 0.7,
    gravity: 0.2,
    friction: 0.02,
    speed: 8,
    turnspeed: 10,
    turnspeedboost: 4,
    boostadd: 0,
    waterdmg: 0.4,
    waterdmglowhp: 0.05,
    waterlowhpperc: 0.3333,
    wateracceleration: 0.1,
    waterforce: 0.4,
    spacedmg: 0.3,
    spacedmglowhp: 0.05,
    spacelowhpperc: 0.3333,
    spaceacceleration: 0.1,
    spaceforce: 0.4,
    environmentfriction: 0.9,
    environmentmin: 0.01,
    motionadddirection: 0.1,
    motionaddimageangle: 0.1,
    minimumspeed: 1,
    maximumspeed: 8,
    waterproof: false,
    flags: '',
  };
}

function makeSnapshot(overrides: Partial<SimSnapshot> = {}): SimSnapshot {
  const loadout: Loadout = overrides.player?.loadout ?? {
    weapon: 0,
    body: 0,
    engine: 0,
  };
  const profile: PilotProfile = overrides.profile ?? {
    version: 1,
    unlockedWeapons: [0],
    unlockedBodies: [0],
    unlockedEngines: [0],
    completedMissions: [],
    activeMissionIds: [1, 2, 3],
    highScoreNormal: 1200,
    highScoreSfmt: 3400,
    selectedPaletteId: 'original',
    sfmtUnlocked: false,
    lastLoadout: loadout,
    lastMode: 'normal',
    lastSeed: 42,
    totalKills: {},
    stats: { sorties: 1, totalScore: 1200, bestCombo: 5 },
  };

  return {
    tick: 30,
    phase: 'playing',
    mode: 'normal',
    paused: false,
    hitstopTicks: 0,
    screenShake: 0,
    nukeFlashTicks: 0,
    launchTicks: 0,
    deathTicks: 0,
    score: 1250,
    combo: 4,
    comboTimer: 120,
    comboMaxTimer: 180,
    comboWarning: false,
    difficulty: 120,
    killsThisSortie: 7,
    killsByKind: { Fighter: 7 },
    player: {
      x: 100,
      y: -160,
      prevX: 95,
      prevY: -158,
      vx: 6,
      vy: -2,
      angleDeg: -20,
      prevAngleDeg: -20,
      health: 100,
      maxHealth: 100,
      alive: true,
      boosting: true,
      wasBoosting: true,
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
      isUrauser: false,
      loadout,
      planeName: 'THE ORIGINAL',
      engineSpec: makeEngine(loadout.engine),
      bodySpec: makeBody(loadout.body),
      weaponSpec: makeWeapon(loadout.weapon),
      boostAnimFrame: 2,
      ...overrides.player,
    },
    enemies: [],
    projectiles: [],
    particles: [],
    parallax: [],
    cameraTargetX: 100,
    cameraTargetY: -160,
    audioEvents: [],
    completedMissionsThisSortie: [],
    activeMissions: [
      {
        id: 1,
        component: [0, 0, 0],
        objective: 0,
        condition: 0,
        val: [10, 1],
        title: 'FIRST FLIGHT',
        description: 'DESTROY 10 FIGHTERS',
      },
    ],
    missionProgress: {
      1: { missionId: 1, completed: false, current: 4, target: 10 },
    },
    profile,
    seaLevel: 0,
    spaceLevel: -1300,
    autopilotEnabled: false,
    seed: 42,
    ...overrides,
  };
}

function createMockVaultBundle(): VaultAssetBundle {
  const spritesRgba = new Uint8Array(64 * 64 * 4);
  for (let i = 0; i < spritesRgba.length; i += 4) {
    spritesRgba[i] = 32;
    spritesRgba[i + 1] = 32;
    spritesRgba[i + 2] = 32;
    spritesRgba[i + 3] = 255;
  }

  return {
    data: {
      vaultSource: 'procedural-fallback',
      steamDir: null,
      player: {
        settings: {
          body: 'original',
          engine: 'original',
          weapon: 'original',
          canshoot: true,
          meleedmg: 10,
          waterrotationforcedegrees: 3,
        },
        engines: {},
        bodyparts: {},
        weapons: {},
        enginesById: [makeEngine(0)],
        bodiesById: [makeBody(0)],
        weaponsById: [makeWeapon(0)],
      },
      projectiles: {},
      enemies: {},
      enemiesSfmt: {},
      spawnCoordinator: {
        initialDifficulty: 60,
        maxPercentageBoats: 0.5,
        maxNumAcePerDifficultyPerc: 0.002,
        maxNumBlimpsPerDifficultyPerc: 0.001,
        aceToLaserAceChance: 0.016,
        minNumSubmarineKillsForAceMarine: 1,
        submarineToAceMarineChance: 0.33,
        increaseDifficulty: [],
        spawnlist: [],
      },
      spawnCoordinatorSfmt: {
        initialDifficulty: 60,
        maxPercentageBoats: 0.5,
        maxNumAcePerDifficultyPerc: 0.002,
        maxNumBlimpsPerDifficultyPerc: 0.001,
        aceToLaserAceChance: 0.016,
        minNumSubmarineKillsForAceMarine: 1,
        submarineToAceMarineChance: 0.33,
        increaseDifficulty: [],
        spawnlist: [],
      },
      global: {
        customizetypes: { engine: {}, body: {}, weapon: {} },
        missions: [],
        planenames: [{ name: 'THE ORIGINAL', weapon: 0, body: 0, engine: 0 }],
      },
      fx: { generic: {}, explosions: {} },
      parallax: { timer0: 600, timer0subtrmult: 20, stages: [] },
      room: { sealevel: 0, spacelevel: -1300 },
      atlases: {
        sprites: {
          name: 'sprites',
          texturePath: 'sprites',
          width: 64,
          height: 64,
          sprites: {
            body_original: { name: 'body_original', size: [24, 24], hull: [0, 0, 24, 24], center: [12, 12], subs: [{ x: 0, y: 0 }] },
            engine_original: { name: 'engine_original', size: [24, 24], hull: [0, 0, 24, 24], center: [12, 12], subs: [{ x: 0, y: 0 }] },
            wings_original: { name: 'wings_original', size: [24, 24], hull: [0, 0, 24, 24], center: [12, 12], subs: [{ x: 0, y: 0 }] },
            ocean_line: { name: 'ocean_line', size: [64, 2], hull: [0, 0, 64, 2], center: [32, 1], subs: [{ x: 0, y: 0 }] },
            clouds: { name: 'clouds', size: [32, 16], hull: [0, 0, 32, 16], center: [16, 8], subs: [{ x: 0, y: 0 }] },
            big_boat: { name: 'big_boat', size: [300, 50], hull: [0, 0, 300, 50], center: [144, 51], subs: [{ x: 2, y: 0 }] },
            big_boat_gun: { name: 'big_boat_gun', size: [35, 9], hull: [0, 0, 35, 9], center: [3, 5], subs: [{ x: 3, y: 0 }] },
            blimp: { name: 'blimp', size: [550, 219], hull: [0, 0, 550, 219], center: [275, 109], subs: [{ x: 6, y: 0 }] },
            blimp_anim: { name: 'blimp_anim', size: [9, 49], hull: [0, 0, 9, 49], center: [-230, 33], subs: [{ x: 7, y: 0 }] },
            projectile_plasmaball: { name: 'projectile_plasmaball', size: [12, 12], hull: [0, 0, 12, 12], center: [6, 6], subs: [{ x: 8, y: 0 }] },
            projectile_spreadbullet: { name: 'projectile_spreadbullet', size: [8, 8], hull: [0, 0, 8, 8], center: [4, 4], subs: [{ x: 9, y: 0 }] },
          },
        },
        menusprites: { name: 'menusprites', texturePath: 'menusprites', width: 64, height: 64, sprites: {} },
        nukesprites: { name: 'nukesprites', texturePath: 'nukesprites', width: 64, height: 64, sprites: {} },
      },
      fonts: {},
    },
    textures: {
      sprites: { name: 'sprites', width: 64, height: 64, rgba: spritesRgba, source: 'procedural' },
    },
    audioManifest: { source: 'procedural-fallback', bgm: {}, sfx: {} },
  };
}

function createTrackingMockWebGL2() {
  const uniform4fCalls: Array<{ name: string; x: number; y: number; z: number; w: number }> = [];
  const uniform4fvCalls: Array<{ name: string; data: Float32Array }> = [];
  const instanceBatches: Float32Array[] = [];
  const solidBuffers: Float32Array[] = [];
  const fontTextsLens: number[] = [];

  const createdPrograms: Array<{ id: number }> = [];
  const uniformLocToName = new Map<object, string>();
  let currentProgram: unknown = null;

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
    createProgram: vi.fn(() => {
      const p = { id: createdPrograms.length + 1 };
      createdPrograms.push(p);
      return p;
    }),
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
    bufferData: vi.fn((_target: number, data: ArrayBufferView | number) => {
      if (!(data instanceof Float32Array) || data.length === 0) return;
      // fontProg = index 3, solidProg = index 6
      if (currentProgram === createdPrograms[3]) {
        fontTextsLens.push(data.length / 24);
      } else if (currentProgram === createdPrograms[6]) {
        solidBuffers.push(new Float32Array(data));
      }
    }),
    bufferSubData: vi.fn((_target: number, _offset: number, data: ArrayBufferView) => {
      if (data instanceof Float32Array) {
        instanceBatches.push(new Float32Array(data));
      }
    }),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    vertexAttribDivisor: vi.fn(),
    useProgram: vi.fn((p: unknown) => {
      currentProgram = p;
    }),
    getUniformLocation: vi.fn((_prog: unknown, name: string) => {
      const loc = { name };
      uniformLocToName.set(loc, name);
      return loc;
    }),
    uniform1i: vi.fn(),
    uniform1f: vi.fn(),
    uniform2f: vi.fn(),
    uniform4f: vi.fn((loc: object, x: number, y: number, z: number, w: number) => {
      const name = uniformLocToName.get(loc) ?? '';
      uniform4fCalls.push({ name, x, y, z, w });
    }),
    uniform4fv: vi.fn((loc: object, data: Float32Array) => {
      const name = uniformLocToName.get(loc) ?? '';
      uniform4fvCalls.push({ name, data: new Float32Array(data) });
    }),
    uniformMatrix4fv: vi.fn(),
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

  return {
    gl,
    uniform4fCalls,
    uniform4fvCalls,
    instanceBatches,
    solidBuffers,
    fontTextsLens,
  };
}

describe('Act II Shaders & Palettes', () => {
  it('OUTPASS_FRAG declares #version 300 es, uFxFlags, uFxParams, uShockwaves and preserves vanilla pass-through', () => {
    expect(OUTPASS_FRAG.trimStart().startsWith('#version 300 es')).toBe(true);
    expect(OUTPASS_FRAG).toContain('uniform vec4 uFxFlags;');
    expect(OUTPASS_FRAG).toContain('uniform vec4 uFxParams;');
    expect(OUTPASS_FRAG).toContain('uniform vec4 uShockwaves[4];');
    expect(OUTPASS_FRAG).toContain('uFxFlags.x < 0.5 && uFxFlags.y < 0.5 && uFxFlags.z < 0.5 && uFxFlags.w < 0.5');
    expect(OUTPASS_FRAG).toContain('texture(colorTexture, vTexCoords)');
    expect(OUTPASS_FRAG).toContain('sin(vTexCoords.y * 400.0 * 3.14159)');

    // POST_WATER_FRAG remains 100% vanilla 1:1 untouched
    expect(POST_WATER_FRAG).toContain('uniform_backcol');
    expect(POST_WATER_FRAG).toContain('/ 350.0');
    expect(POST_WATER_FRAG).toContain('0.99');
    expect(POST_WATER_FRAG).toContain('1000.0');
  });

  it('keeps Act I PALETTES intact and provides 4 valid ACT2_BONUS_PALETTES', () => {
    expect(PALETTES).toHaveLength(12);
    expect(ACT2_BONUS_PALETTES.map((p) => p.id)).toEqual([
      'cyberpunk',
      'vaporwave',
      'blueprint',
      'goldrush',
    ]);

    for (const pal of ACT2_BONUS_PALETTES) {
      expect(pal.colors).toHaveLength(8);
      expect(pal.colors[0]).toEqual([0, 0, 0, 0]);
      expect(pal.backcol[3]).toBe(1);
      for (let i = 1; i <= 7; i++) {
        expect(pal.colors[i]![3]).toBe(1);
      }
      expect(rgbDist(pal.colors[6], pal.colors[7])).toBeGreaterThan(0.012);
      expect(rgbDist(pal.colors[5], pal.colors[6])).toBeGreaterThan(0.012);
      expect(rgbDist(pal.colors[1], pal.colors[7])).toBeGreaterThan(0.012);
    }

    expect(rgbaToHex([1, 0, 0.5, 1])).toBe('#ff0080');
  });
});

describe('Act II Enemy Upright Transforms', () => {
  it('returns upright angleRad: 0, scaleX: -1 for left-moving Dreadnought and SkyCarrier', () => {
    expect(
      resolveEnemyRenderTransform({ kind: 'Dreadnought', vx: -1.2, angleDeg: 180 }),
    ).toEqual({ angleRad: 0, scaleX: -1, scaleY: 1 });

    expect(
      resolveEnemyRenderTransform({ kind: 'SkyCarrier', vx: -0.6, angleDeg: 180 }),
    ).toEqual({ angleRad: 0, scaleX: -1, scaleY: 1 });

    expect(
      resolveEnemyRenderTransform({ kind: 'Dreadnought', vx: 1.2, angleDeg: 0 }),
    ).toEqual({ angleRad: 0, scaleX: 1, scaleY: 1 });

    expect(
      resolveEnemyRenderTransform({ kind: 'SkyCarrier', vx: 0.6, angleDeg: 0 }),
    ).toEqual({ angleRad: 0, scaleX: 1, scaleY: 1 });
  });
});

describe('PaletteStudioController & sanitizeCustomPalette', () => {
  it('edits R/G/B slots, loads presets, resets, and exports/imports JSON cleanly', () => {
    expect(PALETTE_SLOT_LABELS).toEqual([
      'SKY/SEA',
      'PLAYER',
      'ENEMY',
      'REFLECT',
      'BG PROP',
      'BULLET',
      'CLOUD',
      'GLOW/HP',
    ]);

    const studio = new PaletteStudioController();
    expect(studio.isOpen()).toBe(false);
    expect(studio.toggle(true)).toBe(true);

    // Move to slot 1 (PLAYER) and adjust R and G channels
    studio.handleKey('ArrowDown');
    expect(studio.getState().selectedSlot).toBe(1);

    const beforeR = studio.getSlotColor(1)[0];
    studio.handleKey('ArrowRight');
    expect(studio.getSlotColor(1)[0]).toBeCloseTo(Math.min(1, beforeR + 0.05), 3);

    // Switch channel to G (Tab / KeyE) and step down
    studio.handleKey('Tab');
    expect(studio.getState().selectedChannel).toBe(1);
    const beforeG = studio.getSlotColor(1)[1];
    studio.handleKey('ArrowLeft');
    expect(studio.getSlotColor(1)[1]).toBeCloseTo(Math.max(0, beforeG - 0.05), 3);

    // Load preset 1 (cyberpunk), then export & re-import
    const presetRes = studio.handleKey('Digit1');
    expect(presetRes.saved).toBe(true);
    expect(presetRes.palette.id).toBe(CUSTOM_PALETTE_ID);
    expect(presetRes.palette.colors[1]).toEqual(ACT2_BONUS_PALETTES[0]!.colors[1]);

    const json = studio.exportJson();
    studio.handleKey('KeyR');
    expect(studio.getPalette().colors[1]).toEqual(
      createDefaultCustomPalette().colors[1],
    );

    const imported = studio.importJson(json);
    expect(imported).not.toBeNull();
    expect(imported!.colors[1]).toEqual(ACT2_BONUS_PALETTES[0]!.colors[1]);
  });

  it('sanitizeCustomPalette clamps [0..1], enforces alpha invariants, and rejects malformed/NaN payloads safely', () => {
    const valid = sanitizeCustomPalette({
      id: 'my_pal',
      name: 'neon',
      backcol: [1.5, -0.2, 0.5, 0.2],
      colors: [
        [1, 1, 1, 1],
        [-1, 0.25, 2, 0],
        [0, 0.5, 0.5, 0.3],
        [0.1, 0.2, 0.3, 0.4],
        [0.2, 0.3, 0.4, 0.5],
        [0.3, 0.4, 0.5, 0.6],
        [0.4, 0.5, 0.6, 0.7],
        [0.5, 0.6, 0.7, 0.8],
      ],
    });
    expect(valid).not.toBeNull();
    expect(valid!.colors[0]).toEqual([0, 0, 0, 0]);
    expect(valid!.backcol).toEqual([1, 0, 0.5, 1]);
    expect(valid!.colors[1]).toEqual([0, 0.25, 1, 1]);

    // Reject malformed inputs without throwing
    expect(sanitizeCustomPalette(null)).toBeNull();
    expect(sanitizeCustomPalette('bad')).toBeNull();
    expect(sanitizeCustomPalette([])).toBeNull();
    expect(sanitizeCustomPalette({ backcol: [0, 0, 0, 1], colors: [] })).toBeNull();
    expect(
      sanitizeCustomPalette({
        backcol: [NaN, 0, 0, 1],
        colors: Array.from({ length: 8 }, () => [0, 0, 0, 1]),
      }),
    ).toBeNull();
    expect(
      sanitizeCustomPalette({
        backcol: [0, 0, 0, 1],
        colors: [
          [0, 0, 0, 0],
          [0, Infinity, 0, 1],
          [0, 0, 0, 1],
          [0, 0, 0, 1],
          [0, 0, 0, 1],
          [0, 0, 0, 1],
          [0, 0, 0, 1],
          [0, 0, 0, 1],
        ],
      }),
    ).toBeNull();
  });
});

describe('HangarController Act II Mod Deck & 9-Part Cycling', () => {
  it('exposes 7 HANGAR_ROWS including assets, toggles Mod Deck, handles keys, and clamps parts strictly by modded arsenal flag', () => {
    expect(HANGAR_ROWS).toEqual([
      'weapon',
      'body',
      'engine',
      'palette',
      'assets',
      'mode',
      'launch',
    ]);
    expect(MOD_DECK_ROWS).toEqual([
      'modprofile',
      'modarsenal',
      'modghost',
      'moddaily',
      'modshader_crt',
      'modshader_bloom',
      'modshader_warp',
      'modshader_shock',
      'modmulti',
      'modp2bot',
      'palettestudio',
      'modback',
    ]);

    const hangar = new HangarController();
    expect(hangar.isModDeckOpen()).toBe(false);
    expect(hangar.toggleModDeck()).toBe(true);
    expect(hangar.getActiveModRow()).toBe('modprofile');

    let flags: Act2ModFlags = {
      ...DEFAULT_ACT2_MOD_FLAGS,
      shaderFx: { ...DEFAULT_SHADER_FX },
    };
    const rProfile = hangar.handleModDeckKey('Enter', flags);
    expect(rProfile.modFlags.moddedEnabled).toBe(true);
    expect(rProfile.cue).toBe('sndsfmt');
    flags = rProfile.modFlags;

    expect(hangar.moveModRow(1)).toBe('modarsenal');
    const rArsenal = hangar.handleModDeckKey('Space', flags);
    expect(rArsenal.modFlags.arsenalBosses).toBe(true);
    expect(rArsenal.cue).toBe('sndswap');
    flags = rArsenal.modFlags;

    hangar.setActiveModRow('modmulti');
    const rMulti1 = hangar.handleModDeckKey('ArrowRight', flags);
    expect(rMulti1.modFlags.multiplayerMode).toBe('coop2p');
    const rMulti2 = hangar.handleModDeckKey('ArrowRight', rMulti1.modFlags);
    expect(rMulti2.modFlags.multiplayerMode).toBe('dogfight1v1');

    hangar.setActiveModRow('palettestudio');
    const rStudio = hangar.handleModDeckKey('Enter', rMulti2.modFlags);
    expect(rStudio.openedPaletteStudio).toBe(true);
    expect(hangar.getPaletteStudio().isOpen()).toBe(true);

    // Edit custom palette via HangarController & register into palette cycler
    const studioRes = hangar.handlePaletteStudioKey('Digit2');
    expect(studioRes.changed).toBe(true);
    hangar.handlePaletteStudioKey('Escape');
    expect(hangar.getPaletteStudio().isOpen()).toBe(false);

    hangar.setActiveModRow('modback');
    const rBack = hangar.handleModDeckKey('Enter', rMulti2.modFlags);
    expect(rBack.closed).toBe(true);
    expect(rBack.cue).toBe('sndhangar');
    expect(hangar.isModDeckOpen()).toBe(false);

    // 9-part cycling ONLY when moddedEnabled && arsenalBosses
    let currentLoadout: Loadout = { weapon: 5, body: 5, engine: 5 };
    const simStub = {
      setLoadout: (l: Loadout) => {
        currentLoadout = { ...l };
      },
      setMode: vi.fn(),
    };

    const vanillaAllUnlockedSnap = makeSnapshot({
      phase: 'hangar',
      profile: {
        ...makeSnapshot().profile,
        unlockedWeapons: [0, 1, 2, 3, 4, 5, 6, 7, 8],
        unlockedBodies: [0, 1, 2, 3, 4, 5, 6, 7, 8],
        unlockedEngines: [0, 1, 2, 3, 4, 5, 6, 7, 8],
      },
      player: { ...makeSnapshot().player, loadout: { ...currentLoadout } },
      activeMods: { ...DEFAULT_ACT2_MOD_FLAGS, moddedEnabled: false, arsenalBosses: true },
    });

    hangar.setActiveRow('weapon');
    const vanillaCycle = hangar.cycleCurrent(1, vanillaAllUnlockedSnap, simStub);
    expect(vanillaCycle.loadout?.weapon).toBe(0); // clamped strictly to 0..5 in Vanilla 1:1

    const moddedArsenalSnap = makeSnapshot({
      phase: 'hangar',
      profile: {
        ...makeSnapshot().profile,
        unlockedWeapons: [0, 1, 2, 3, 4, 5],
      },
      player: { ...makeSnapshot().player, loadout: { weapon: 5, body: 0, engine: 0 } },
      activeMods: { ...DEFAULT_ACT2_MOD_FLAGS, moddedEnabled: true, arsenalBosses: true },
    });
    const modCycle6 = hangar.cycleCurrent(1, moddedArsenalSnap, simStub);
    expect(modCycle6.loadout?.weapon).toBe(6);

    moddedArsenalSnap.player.loadout = { weapon: 8, body: 0, engine: 0 };
    const modCycleWrap = hangar.cycleCurrent(1, moddedArsenalSnap, simStub);
    expect(modCycleWrap.loadout?.weapon).toBe(0);

    // Modded snapshot exposes Act II bonus & custom palettes in cycler
    hangar.registerCustomPalette(createDefaultCustomPalette());
    expect(hangar.setPaletteById('cyberpunk')).toBe(true);
    expect(hangar.getSelectedPalette().id).toBe('cyberpunk');

    const uiState = hangar.buildUiState(moddedArsenalSnap, 'procedural-fallback', {
      dailySeedId: '20261125',
      dailyBestScore: 4200,
      pbGhostScore: 9900,
      p2PlaneName: 'WINGMAN',
    });
    expect(uiState.modFlags?.arsenalBosses).toBe(true);
    expect(uiState.dailySeedId).toBe('20261125');
    expect(uiState.dailyBestScore).toBe(4200);
    expect(uiState.pbGhostScore).toBe(9900);
    expect(uiState.p2PlaneName).toBe('WINGMAN');
  });
});

describe('WebGL2Renderer Act II Visuals & Shader FX Pipeline', () => {
  it('renders Ghost, Dreadnought, SkyCarrier, LightningArc, RailSlug, Flak, P2 Co-op, Dogfight, Mod Deck, and Palette Studio with 0 errors', () => {
    const mockGl = createTrackingMockWebGL2();
    const mockCanvas = {
      width: 1200,
      height: 800,
      style: { imageRendering: '' },
      getContext: vi.fn((kind: string) => (kind === 'webgl2' ? mockGl.gl : null)),
    } as unknown as HTMLCanvasElement;

    const renderer = new WebGL2Renderer();
    const vault = createMockVaultBundle();
    renderer.init(mockCanvas, vault);

    const customPal: PaletteDefinition = {
      ...createDefaultCustomPalette(),
      name: 'LIVE STUDIO',
    };
    renderer.registerCustomPalette(customPal);
    renderer.setPalette(CUSTOM_PALETTE_ID);
    expect(renderer.getPalette().id).toBe(CUSTOM_PALETTE_ID);

    // 1. Vanilla 1:1 mode forces uFxFlags to zero even if shockwaves exist
    const vanillaSnap = makeSnapshot({
      activeMods: { ...DEFAULT_ACT2_MOD_FLAGS, moddedEnabled: false },
      shockwaves: [
        { id: 1, x: 100, y: -160, radius: 40, maxRadius: 120, intensity: 1, age: 5, maxAge: 20 },
      ],
    });
    renderer.render(vanillaSnap, vanillaSnap, 0, null, 1.0);
    const fxVanilla = mockGl.uniform4fCalls.filter((c) => c.name === 'uFxFlags').at(-1);
    expect(fxVanilla).toMatchObject({ x: 0, y: 0, z: 0, w: 0 });

    // 2. Modded world scene with all Act II entities & Shader FX enabled
    renderer.setShaderFx({
      crtScanlines: true,
      phosphorBloom: true,
      speedWarp: true,
      shockwaves: true,
    });

    const p2State = {
      ...makeSnapshot().player,
      x: 240,
      y: -190,
      prevX: 235,
      prevY: -188,
      angleDeg: -160,
      health: 75,
      maxHealth: 100,
      playerIndex: 2 as const,
      shieldReady: true,
    };

    const moddedSnap = makeSnapshot({
      activeMods: {
        moddedEnabled: true,
        arsenalBosses: true,
        replayGhost: true,
        dailySeed: true,
        shaderFx: {
          crtScanlines: true,
          phosphorBloom: true,
          speedWarp: true,
          shockwaves: true,
        },
        multiplayerMode: 'dogfight1v1',
        p2BotEnabled: false,
      },
      dailySeedId: '20261125',
      player: {
        ...makeSnapshot().player,
        shieldReady: true,
      },
      player2: p2State,
      ghostPose: {
        x: 130,
        y: -175,
        angleDeg: -30,
        boosting: true,
        alive: true,
        loadout: { weapon: 0, body: 0, engine: 0 },
        trail: [
          { x: 110, y: -165 },
          { x: 120, y: -170 },
          { x: 130, y: -175 },
        ],
        scoreAtTick: 880,
      },
      dogfight: {
        p1Wins: 2,
        p2Wins: 1,
        round: 4,
        bestOf: 5,
        roundBannerTicks: 40,
        winner: null,
        lastScorer: 1,
      },
      shockwaves: [
        { id: 1, x: 120, y: -160, radius: 80, maxRadius: 200, intensity: 0.9, age: 4, maxAge: 20 },
      ],
      enemies: [
        {
          id: 10,
          kind: 'Dreadnought',
          x: 200,
          y: 0,
          prevX: 200,
          prevY: 0,
          vx: -1.1,
          vy: 0,
          angleDeg: 180,
          gunAngleDeg: -135,
          health: 400,
          maxHealth: 400,
          active: true,
          state: 'cruise',
          aiTimer: 0,
          fireTimer: 10,
          salvoRemaining: 0,
          salvoCooldown: 0,
          surfaceTimer: 0,
          fallFrames: 0,
          lifetime: 50,
          activationTimer: 0,
          flashTicks: 0,
          hitRadius: 84,
          width: 390,
          height: 66,
          scoreValue: 1500,
          difficultyWeight: 8,
          spriteMain: 'big_boat',
          spriteGun: 'big_boat_gun',
          laserActive: false,
          laserLength: 0,
        },
        {
          id: 11,
          kind: 'SkyCarrier',
          x: 220,
          y: -280,
          prevX: 220,
          prevY: -280,
          vx: -0.7,
          vy: 0,
          angleDeg: 180,
          gunAngleDeg: 90,
          health: 500,
          maxHealth: 500,
          active: true,
          state: 'cruise',
          aiTimer: 0,
          fireTimer: 10,
          salvoRemaining: 0,
          salvoCooldown: 0,
          surfaceTimer: 0,
          fallFrames: 0,
          lifetime: 50,
          activationTimer: 0,
          flashTicks: 0,
          hitRadius: 112,
          width: 580,
          height: 220,
          scoreValue: 2000,
          difficultyWeight: 10,
          spriteMain: 'blimp',
          spriteGun: 'big_boat_gun',
          laserActive: false,
          laserLength: 0,
        },
      ],
      projectiles: [
        {
          id: 1,
          owner: 'player',
          kind: 'railslug',
          x: 110,
          y: -160,
          prevX: 110,
          prevY: -160,
          vx: 30,
          vy: 0,
          angleDeg: 0,
          ttl: 8,
          maxTtl: 8,
          dmg: 80,
          radius: 4,
          targetId: null,
          piercing: true,
          aoeRadius: 0,
          fromGungine: false,
          beamLength: 360,
        },
        {
          id: 2,
          owner: 'player',
          kind: 'flakshell',
          x: 160,
          y: -160,
          prevX: 150,
          prevY: -160,
          vx: 10,
          vy: 0,
          angleDeg: 0,
          ttl: 20,
          maxTtl: 20,
          dmg: 25,
          radius: 5,
          targetId: null,
          piercing: false,
          aoeRadius: 40,
          fromGungine: false,
        },
        {
          id: 3,
          owner: 'player',
          kind: 'flakshard',
          x: 180,
          y: -150,
          prevX: 175,
          prevY: -150,
          vx: 12,
          vy: 2,
          angleDeg: 10,
          ttl: 12,
          maxTtl: 12,
          dmg: 8,
          radius: 3,
          targetId: null,
          piercing: false,
          aoeRadius: 0,
          fromGungine: false,
        },
        {
          id: 4,
          owner: 'player',
          kind: 'lightningarc',
          x: 120,
          y: -160,
          prevX: 120,
          prevY: -160,
          vx: 0,
          vy: 0,
          angleDeg: 0,
          ttl: 6,
          maxTtl: 6,
          dmg: 30,
          radius: 4,
          targetId: 11,
          piercing: false,
          aoeRadius: 0,
          fromGungine: false,
          arcPoints: [
            { x: 120, y: -160 },
            { x: 170, y: -210 },
            { x: 220, y: -280 },
          ],
        },
      ],
    });

    mockGl.uniform4fCalls.length = 0;
    mockGl.uniform4fvCalls.length = 0;
    mockGl.instanceBatches.length = 0;
    renderer.render(moddedSnap, moddedSnap, 0.5, null, 2.5);

    const fxActive = mockGl.uniform4fCalls.filter((c) => c.name === 'uFxFlags').at(-1);
    expect(fxActive).toMatchObject({ x: 1, y: 1, z: 1, w: 1 });
    const fxParams = mockGl.uniform4fCalls.filter((c) => c.name === 'uFxParams').at(-1);
    expect(fxParams!.x).toBeCloseTo(2.5, 4);
    expect(fxParams!.y).toBeGreaterThan(0);

    const swCall = mockGl.uniform4fvCalls.filter((c) => c.name.startsWith('uShockwaves')).at(-1);
    expect(swCall).toBeDefined();
    expect(swCall!.data[3]).toBeCloseTo(0.9, 4); // intensity > 0

    // Verify Dreadnought (1.3x) & SkyCarrier (1.0x) upright flipped instances
    const allInstances: Array<{ angleRad: number; subX: number; scaleX: number; scaleY: number }> = [];
    for (const batch of mockGl.instanceBatches) {
      for (let i = 0; i < batch.length; i += 13) {
        allInstances.push({
          angleRad: batch[i + 2]!,
          subX: batch[i + 3]!,
          scaleX: batch[i + 9]!,
          scaleY: batch[i + 10]!,
        });
      }
    }
    const dread = allInstances.find((i) => i.subX === 2);
    expect(dread).toBeDefined();
    expect(dread!.angleRad).toBe(0);
    expect(dread!.scaleX).toBeCloseTo(-1.3, 4);
    expect(dread!.scaleY).toBeCloseTo(1.3, 4);

    const carrier = allInstances.find((i) => i.subX === 6);
    expect(carrier).toBeDefined();
    expect(carrier!.angleRad).toBe(0);
    expect(carrier!.scaleX).toBeCloseTo(-1.0, 4);
    expect(carrier!.scaleY).toBeCloseTo(1.0, 4);

    // 3. Dogfight match winner Game Over card
    const dogfightOver = makeSnapshot({
      phase: 'gameover',
      dogfight: {
        p1Wins: 3,
        p2Wins: 1,
        round: 4,
        bestOf: 5,
        roundBannerTicks: 0,
        winner: 1,
        lastScorer: 1,
      },
      player: { ...makeSnapshot().player, alive: true },
      player2: { ...p2State, alive: false, health: 0 },
    });
    mockGl.fontTextsLens.length = 0;
    renderer.render(dogfightOver, dogfightOver, 0, null, 3.0);
    expect(mockGl.fontTextsLens).toContain('PLAYER 1 WINS!'.length);

    // 4. Hangar Mod Deck & Palette Studio views
    const hangar = new HangarController();
    hangar.toggleModDeck(true);
    const hangarSnap = makeSnapshot({
      phase: 'hangar',
      activeMods: moddedSnap.activeMods,
    });
    mockGl.fontTextsLens.length = 0;
    renderer.render(hangarSnap, hangarSnap, 0, hangar.buildUiState(hangarSnap), 1.0);
    expect(mockGl.fontTextsLens).toContain('SKYBREAKER MOD DECK'.length);

    hangar.togglePaletteStudio(true);
    mockGl.fontTextsLens.length = 0;
    renderer.render(hangarSnap, hangarSnap, 0, hangar.buildUiState(hangarSnap), 1.2);
    expect(mockGl.fontTextsLens).toContain('LIVE PALETTE STUDIO'.length);

    expect(renderer.getFrameMetrics().webglErrors).toBe(0);
    renderer.dispose();
  });

  it('TelemetryHud appends compact Act II status line ONLY when moddedEnabled is true', () => {
    const baseMetrics = {
      fps: 60,
      avgFrameDeltaMs: 16.6,
      p95FrameDeltaMs: 17.0,
      drawCalls: 5,
      webglErrors: 0,
      virtualWidth: 600,
      virtualHeight: 400,
      canvasWidth: 600,
      canvasHeight: 400,
      activePaletteId: 'original',
    };

    const vanillaLines = formatTelemetryLines({
      snapshot: makeSnapshot(),
      frameMetrics: baseMetrics,
      vaultSource: 'procedural-fallback',
    });
    expect(vanillaLines.some((l) => l.startsWith('MODS:'))).toBe(false);

    const moddedLines = formatTelemetryLines({
      snapshot: makeSnapshot({
        activeMods: {
          moddedEnabled: true,
          arsenalBosses: true,
          replayGhost: true,
          dailySeed: true,
          shaderFx: { ...DEFAULT_SHADER_FX, crtScanlines: true },
          multiplayerMode: 'coop2p',
          p2BotEnabled: true,
        },
        dailySeedId: '20261125',
        ghostPose: {
          x: 0,
          y: -100,
          angleDeg: 0,
          boosting: false,
          alive: true,
          loadout: { weapon: 0, body: 0, engine: 0 },
          trail: [],
          scoreAtTick: 450,
        },
        shockwaves: [
          { id: 1, x: 0, y: 0, radius: 20, maxRadius: 80, intensity: 1, age: 1, maxAge: 10 },
        ],
      }),
      frameMetrics: baseMetrics,
      vaultSource: 'procedural-fallback',
    });
    const modLine = moddedLines.find((l) => l.startsWith('MODS:'));
    expect(modLine).toBeDefined();
    expect(modLine).toContain('GHOST=ON(450)');
    expect(modLine).toContain('P2=COOP2P[BOT]');
    expect(modLine).toContain('SW=1');
  });
});
