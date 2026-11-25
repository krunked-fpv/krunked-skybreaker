import { describe, expect, it, vi } from 'vitest';
import type { RgbaTuple } from '../src/contracts/render';
import type { Loadout, PilotProfile, SimSnapshot } from '../src/contracts/sim';
import type {
  BodySpec,
  EngineSpec,
  VaultAssetBundle,
  WeaponSpec,
} from '../src/contracts/vault';
import {
  BATCH_FRAG,
  BATCH_REFLECT_FRAG,
  BATCH_REFLECT_VERT,
  BATCH_VERT,
  COMBO_FONT_FRAG,
  FONT_FRAG,
  FONT_VERT,
  OUTPASS_FRAG,
  OUTPASS_VERT,
  PALETTES,
  PAUSE_LINES_FRAG,
  PAUSE_LINES_VERT,
  POST_WATER_FRAG,
  POST_WATER_VERT,
  SOLID_FRAG,
  SOLID_VERT,
  WebGL2Renderer,
  buildBitmapTextVertices,
  computePostShaderUniforms,
  createBuiltinPixelFont,
  getPaletteById,
  hexToRgba,
  isPaletteUnlocked,
  measureBitmapText,
} from '../src/render';
import { HANGAR_ROWS, HangarController, TelemetryHud } from '../src/ui';

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
    tick: 10,
    phase: 'playing',
    mode: 'normal',
    paused: false,
    hitstopTicks: 0,
    screenShake: 0,
    nukeFlashTicks: 0,
    launchTicks: 0,
    deathTicks: 0,
    score: 500,
    combo: 3,
    comboTimer: 120,
    comboMaxTimer: 180,
    comboWarning: false,
    difficulty: 80,
    killsThisSortie: 4,
    killsByKind: { Fighter: 4 },
    player: {
      x: 150,
      y: -180,
      prevX: 145,
      prevY: -178,
      vx: 5,
      vy: -2,
      angleDeg: -25,
      prevAngleDeg: -25,
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
    cameraTargetX: 150,
    cameraTargetY: -180,
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
      {
        id: 2,
        component: [1, 0, 0],
        objective: 2,
        condition: 0,
        val: [1000, 0],
        title: 'ACE SCORE',
        description: 'SCORE 1000 POINTS',
      },
      {
        id: 3,
        component: [2, 0, 0],
        objective: 4,
        condition: 0,
        val: [5, 0],
        title: 'CHAIN REACTION',
        description: 'REACH COMBO X5',
      },
    ],
    missionProgress: {
      1: { missionId: 1, completed: false, current: 4, target: 10 },
      2: { missionId: 2, completed: false, current: 500, target: 1000 },
      3: { missionId: 3, completed: false, current: 3, target: 5 },
    },
    profile,
    seaLevel: 0,
    spaceLevel: -1300,
    autopilotEnabled: false,
    seed: 42,
    ...overrides,
  };
}

describe('Render Palette Contracts', () => {
  it('provides at least 10 valid 8-color palettes + backcol with distinct water remap keys', () => {
    expect(PALETTES.length).toBeGreaterThanOrEqual(10);

    const requiredIds = [
      'original',
      'lanigiro',
      'classic',
      'gameboy',
      'virtual',
      'oceanic',
      'kozilek',
      'sunset',
      'amber',
      'sfmt',
    ];
    for (const id of requiredIds) {
      expect(PALETTES.some((p) => p.id === id)).toBe(true);
    }

    for (const pal of PALETTES) {
      expect(pal.colors).toHaveLength(8);
      expect(pal.colors[0]).toEqual([0, 0, 0, 0]);
      for (const ch of pal.backcol) {
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(1);
      }
      expect(pal.backcol[3]).toBe(1);

      for (let i = 1; i <= 7; i++) {
        const tuple = pal.colors[i]!;
        expect(tuple).toHaveLength(4);
        for (const ch of tuple) {
          expect(ch).toBeGreaterThanOrEqual(0);
          expect(ch).toBeLessThanOrEqual(1);
        }
        expect(tuple[3]).toBe(1);
      }

      // Ensure post.shader length(...) < 0.01 checks never cross-collide on water remap
      expect(rgbDist(pal.colors[6], pal.colors[7])).toBeGreaterThan(0.012);
      expect(rgbDist(pal.colors[5], pal.colors[6])).toBeGreaterThan(0.012);
      expect(rgbDist(pal.colors[1], pal.colors[7])).toBeGreaterThan(0.012);
    }
  });

  it('matches Original palette canonical semantics (#4b0e1c player, #f7f0d4 cloud/health, #dec796 sky)', () => {
    const orig = getPaletteById('original');
    expect(orig.id).toBe('original');
    expect(orig.colors[1]).toEqual(hexToRgba('#4b0e1c'));
    expect(orig.colors[2]).toEqual(hexToRgba('#82383e'));
    expect(orig.colors[3]).toEqual(hexToRgba('#b89378'));
    expect(orig.colors[4]).toEqual(hexToRgba('#c7aa88'));
    expect(orig.colors[5]).toEqual(hexToRgba('#e7ddb0'));
    expect(orig.colors[6]).toEqual(hexToRgba('#e5ddac'));
    expect(orig.colors[7]).toEqual(hexToRgba('#f7f0d4'));
    expect(orig.backcol).toEqual(hexToRgba('#dec796'));

    expect(getPaletteById('non-existent-id').id).toBe('original');
  });
});

describe('GLSL ES 3.00 Shader & Post Uniform Contracts', () => {
  it('declares #version 300 es on every shader stage', () => {
    const shaders = [
      BATCH_VERT,
      BATCH_REFLECT_VERT,
      BATCH_FRAG,
      BATCH_REFLECT_FRAG,
      POST_WATER_VERT,
      POST_WATER_FRAG,
      FONT_VERT,
      FONT_FRAG,
      COMBO_FONT_FRAG,
      PAUSE_LINES_VERT,
      PAUSE_LINES_FRAG,
      SOLID_VERT,
      SOLID_FRAG,
      OUTPASS_VERT,
      OUTPASS_FRAG,
    ];
    for (const src of shaders) {
      expect(src.trimStart().startsWith('#version 300 es')).toBe(true);
    }
  });

  it('preserves batch, post water/health quantization, combo barh, pauselines, and 600:400 outpass invariants', () => {
    expect(BATCH_FRAG).toContain('int(diffuse.r * 8.0)');
    expect(BATCH_FRAG).toContain('uniform vec4 uniform_colors[8]');
    expect(BATCH_FRAG).toContain('diffuse.rgb == vec3(0.0)');
    expect(BATCH_FRAG).toContain('vWorldPos.y > 0.0');

    expect(BATCH_REFLECT_VERT).toContain('pos.y = -pos.y;');
    expect(BATCH_REFLECT_FRAG).toContain('vWorldPos.y < 0.0');

    expect(POST_WATER_FRAG).toContain('vec2(-300.0, 200.0)');
    expect(POST_WATER_FRAG).toContain('floor((playerPosition.xy - pixelPosition) * 0.5) * 2.0');
    expect(POST_WATER_FRAG).toContain('/ 350.0');
    expect(POST_WATER_FRAG).toContain('0.99');
    expect(POST_WATER_FRAG).toContain('1000.0');
    expect(POST_WATER_FRAG).toContain('uniform_colors[3]');
    expect(POST_WATER_FRAG).toContain('uniform_colors[6]');
    expect(POST_WATER_FRAG).toContain('uniform_colors[7]');
    expect(POST_WATER_FRAG).toContain('uniform_backcol');
    expect(POST_WATER_FRAG).toContain('seaExpr');

    expect(COMBO_FONT_FRAG).toContain('uniform vec4 barh');
    expect(COMBO_FONT_FRAG).toContain('fillColor');
    expect(COMBO_FONT_FRAG).toContain('textColor');

    expect(PAUSE_LINES_FRAG).toContain('gl_FragCoord');

    expect(OUTPASS_VERT).toContain('400.0 / 600.0');
    expect(OUTPASS_VERT).toContain('viewport.y');
  });

  it('computePostShaderUniforms handles 100% HP, 50% HP, critical < 33% HP, and cameraYViewSpace', () => {
    const pal = getPaletteById('original');

    // 100% HP
    const fullSnap = makeSnapshot();
    const uFull = computePostShaderUniforms(fullSnap, 120, -200, 1.0, pal, 1200, 800);
    expect(uFull.healthRadius[0]).toBe(100);
    expect(uFull.healthRadius[1]).toBe(100);
    expect(uFull.healthRadius[0] / uFull.healthRadius[1]).toBeGreaterThan(0.99);
    expect(uFull.healthRadius[2]).toBe(0);
    expect(uFull.cameraPosition[0]).toBeCloseTo(-200 / 400, 6);
    expect(uFull.cameraWorldPosition).toEqual([120, -200, 0, 0]);
    expect(uFull.playerPosition[0]).toBe(150);
    expect(uFull.playerPosition[1]).toBe(-180);
    expect(uFull.uniform_backcol).toEqual(pal.backcol);
    expect(uFull.uniform_colors).toEqual(pal.colors);

    // 50% HP
    const halfSnap = makeSnapshot({
      player: { ...fullSnap.player, health: 50, maxHealth: 100 },
    });
    const uHalf = computePostShaderUniforms(halfSnap, 0, -100, 0.5, pal, 600, 400);
    expect(uHalf.healthRadius[0]).toBe(50);
    expect(uHalf.healthRadius[1]).toBe(100);
    expect(uHalf.healthRadius[2]).toBe(0);
    expect(uHalf.cameraPosition[0]).toBeCloseTo(-100 / 400, 6);

    // Critical < 33% HP blinks healthRadius[2] between 1 and 0
    const critSnap = makeSnapshot({
      player: { ...fullSnap.player, health: 20, maxHealth: 100 },
    });
    const uCritA = computePostShaderUniforms(critSnap, 0, 0, 0.0, pal, 600, 400);
    const uCritB = computePostShaderUniforms(critSnap, 0, 0, 0.1, pal, 600, 400);
    expect(uCritA.healthRadius[0]).toBe(20);
    expect(uCritA.healthRadius[2]).toBe(1);
    expect(uCritB.healthRadius[2]).toBe(0);
  });
});

describe('HangarController & TelemetryHud Contracts', () => {
  it('cycles weapons, bodies, engines, palettes, and mode while respecting unlock locks', () => {
    const controller = new HangarController();
    expect(HANGAR_ROWS).toEqual([
      'weapon',
      'body',
      'engine',
      'palette',
      'mode',
      'launch',
    ]);

    const setLoadout = vi.fn();
    const setMode = vi.fn();
    const launch = vi.fn();
    const sim = { setLoadout, setMode, launch };

    // Locked snapshot: only slot 0 unlocked for parts, SFMT locked, 0 missions
    const lockedSnap = makeSnapshot({
      phase: 'hangar',
      profile: {
        ...makeSnapshot().profile,
        unlockedWeapons: [0],
        unlockedBodies: [0],
        unlockedEngines: [0],
        completedMissions: [],
        sfmtUnlocked: false,
      },
    });

    controller.setActiveRow('weapon');
    const wDenied = controller.cycleCurrent(1, lockedSnap, sim);
    expect(wDenied.changed).toBe(false);
    expect(wDenied.locked).toBe(true);
    expect(wDenied.cue).toBe('snddeny');
    expect(setLoadout).not.toHaveBeenCalled();

    controller.setActiveRow('mode');
    const modeDenied = controller.cycleCurrent(1, lockedSnap, sim);
    expect(modeDenied.changed).toBe(false);
    expect(modeDenied.locked).toBe(true);
    expect(modeDenied.cue).toBe('snddeny');
    expect(setMode).not.toHaveBeenCalled();

    // Locked palette (e.g. gameboy index 3 requires 5 missions)
    const palDenied = controller.selectPaletteByIndex(3, lockedSnap);
    expect(palDenied.changed).toBe(false);
    expect(palDenied.locked).toBe(true);
    expect(palDenied.cue).toBe('snddeny');

    // Unlocked snapshot: weapons [0, 2, 4], bodies [0, 1], engines [0, 3], 20 missions, SFMT unlocked
    const unlockedSnap = makeSnapshot({
      phase: 'hangar',
      profile: {
        ...makeSnapshot().profile,
        unlockedWeapons: [0, 2, 4],
        unlockedBodies: [0, 1],
        unlockedEngines: [0, 3],
        completedMissions: Array.from({ length: 20 }, (_, i) => i + 1),
        sfmtUnlocked: true,
      },
    });

    controller.setActiveRow('weapon');
    const wSwap = controller.cycleCurrent(1, unlockedSnap, sim);
    expect(wSwap.changed).toBe(true);
    expect(wSwap.cue).toBe('sndswap');
    expect(wSwap.loadout?.weapon).toBe(2); // skips locked 1!
    expect(setLoadout).toHaveBeenCalledWith({ weapon: 2, body: 0, engine: 0 });

    controller.moveRow(1); // -> body
    expect(controller.getActiveRow()).toBe('body');
    const bSwap = controller.cycleCurrent(1, unlockedSnap, sim);
    expect(bSwap.loadout?.body).toBe(1);

    controller.moveRow(1); // -> engine
    expect(controller.getActiveRow()).toBe('engine');
    const eSwap = controller.cycleCurrent(-1, unlockedSnap, sim);
    expect(eSwap.loadout?.engine).toBe(3);

    controller.moveRow(1); // -> palette
    expect(controller.getActiveRow()).toBe('palette');
    const pSwap = controller.cycleCurrent(1, unlockedSnap, sim);
    expect(pSwap.changed).toBe(true);
    expect(pSwap.cue).toBe('sndswap');
    expect(isPaletteUnlocked(controller.getSelectedPalette(), 20, true)).toBe(true);

    controller.moveRow(1); // -> mode
    expect(controller.getActiveRow()).toBe('mode');
    const mSwap = controller.cycleCurrent(1, unlockedSnap, sim);
    expect(mSwap.changed).toBe(true);
    expect(mSwap.mode).toBe('sfmt');
    expect(mSwap.cue).toBe('sndsfmt');
    expect(setMode).toHaveBeenCalledWith('sfmt');

    // Launch row
    controller.moveRow(1);
    expect(controller.getActiveRow()).toBe('launch');
    const launched = controller.handleKey('Space', unlockedSnap, sim);
    expect(launched.action).toBe('launch');
    expect(launched.cue).toBe('sndlaunch');
    expect(launch).toHaveBeenCalledTimes(1);

    const uiState = controller.buildUiState(unlockedSnap, 'steam-local');
    expect(uiState.activeRow).toBe('launch');
    expect(uiState.vaultSource).toBe('steam-local');
    expect(uiState.completedMissionsCount).toBe(20);
    expect(uiState.totalMissionsCount).toBe(90);
    expect(uiState.activeMissions).toHaveLength(3);
  });

  it('TelemetryHud is hidden by default, toggles cleanly, and formats telemetry lines', () => {
    const hud = new TelemetryHud();
    expect(hud.isVisible()).toBe(false);
    expect(hud.toggle()).toBe(true);
    expect(hud.isVisible()).toBe(true);
    expect(hud.toggle(false)).toBe(false);

    const snap = makeSnapshot();
    hud.update({
      snapshot: snap,
      vaultSource: 'procedural-fallback',
      frameMetrics: {
        fps: 60,
        avgFrameDeltaMs: 16.6,
        p95FrameDeltaMs: 17.2,
        drawCalls: 7,
        webglErrors: 0,
        virtualWidth: 600,
        virtualHeight: 400,
        canvasWidth: 1200,
        canvasHeight: 800,
        activePaletteId: 'original',
      },
      audioMetrics: {
        unlocked: true,
        source: 'synth-fallback',
        musicState: 'combat',
        activeStems: ['luftrauser_bass1', 'luftrauser_drums1', 'luftrauser_lead1'],
        epochTime: 1,
        contextTime: 2,
        interStemDriftMs: 0.12,
        alarmActive: false,
        sfxPoolActive: 1,
        muted: false,
      },
    });

    const lines = hud.getLastLines().join('\n');
    expect(lines).toContain('VAULT: procedural-fallback');
    expect(lines).toContain('PALETTE: original');
    expect(lines).toContain('0.120ms');
    expect(lines).toContain('THE ORIGINAL');
    hud.dispose();
  });

  it('builds valid builtin pixel font bitmap and quad geometry', () => {
    const font = createBuiltinPixelFont();
    expect(font.rgba.byteLength).toBe(128 * 64 * 4);
    const metrics = measureBitmapText(font.spec, 'COMBO x10', 2);
    expect(metrics.width).toBe(9 * 6 * 2);
    expect(metrics.height).toBe(9 * 2);
    const verts = buildBitmapTextVertices(font.spec, 'COMBO', 10, 10, 2, 'left');
    expect(verts.length).toBe(5 * 24);
  });
});

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
            fighter_body: { name: 'fighter_body', size: [20, 20], hull: [0, 0, 20, 20], center: [10, 10], subs: [{ x: 0, y: 0 }] },
            fighter_wings: { name: 'fighter_wings', size: [20, 20], hull: [0, 0, 20, 20], center: [10, 10], subs: [{ x: 0, y: 0 }] },
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

function createMockWebGL2Context() {
  const texParams: Array<{ pname: number; param: number }> = [];
  const fboSizes: Array<{ w: number; h: number }> = [];
  let drawCalls = 0;

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
    texImage2D: vi.fn((_t: number, _l: number, _ifmt: number, w: number, h: number, _b: number, _f: number, _ty: number, pixels: unknown) => {
      if (pixels === null) fboSizes.push({ w, h });
    }),
    texParameteri: vi.fn((_t: number, pname: number, param: number) => {
      texParams.push({ pname, param });
    }),
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
    getUniformLocation: vi.fn(() => ({})),
    uniform1i: vi.fn(),
    uniform1f: vi.fn(),
    uniform2f: vi.fn(),
    uniform4f: vi.fn(),
    uniform4fv: vi.fn(),
    uniformMatrix4fv: vi.fn(),
    viewport: vi.fn(),
    disable: vi.fn(),
    enable: vi.fn(),
    blendFunc: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    drawArrays: vi.fn(() => {
      drawCalls++;
    }),
    drawArraysInstanced: vi.fn(() => {
      drawCalls++;
    }),
    getError: vi.fn(() => 0),
  };

  return { gl, texParams, fboSizes, getDrawCalls: () => drawCalls };
}

describe('WebGL2Renderer Pipeline Contracts', () => {
  it('allocates 600x400 NEAREST FBOs, renders all passes with 0 WebGL errors, and switches palettes', () => {
    const mockGl = createMockWebGL2Context();
    const mockCanvas = {
      width: 1200,
      height: 800,
      style: { imageRendering: '' },
      getContext: vi.fn((kind: string) => (kind === 'webgl2' ? mockGl.gl : null)),
    } as unknown as HTMLCanvasElement;

    const renderer = new WebGL2Renderer();
    const vault = createMockVaultBundle();
    renderer.init(mockCanvas, vault);

    expect(mockCanvas.style.imageRendering).toBe('pixelated');
    expect(mockGl.fboSizes).toEqual([
      { w: 600, h: 400 },
      { w: 600, h: 400 },
    ]);
    // Every texture min/mag filter uses NEAREST (0x2600)
    const filterCalls = mockGl.texParams.filter(
      (p) => p.pname === 0x2801 || p.pname === 0x2800,
    );
    expect(filterCalls.length).toBeGreaterThanOrEqual(4);
    expect(filterCalls.every((p) => p.param === 0x2600)).toBe(true);

    const controller = new HangarController();
    const hangarSnap = makeSnapshot({ phase: 'hangar' });
    const hangarUi = controller.buildUiState(hangarSnap);
    renderer.render(hangarSnap, hangarSnap, 0, hangarUi, 0.5);

    const playSnap = makeSnapshot({
      phase: 'playing',
      paused: true,
      completedMissionsThisSortie: [1],
      player: { ...makeSnapshot().player, health: 40, maxHealth: 100 },
      enemies: [
        {
          id: 1,
          kind: 'Fighter',
          x: 240,
          y: -140,
          prevX: 236,
          prevY: -138,
          vx: -3,
          vy: 0,
          angleDeg: 180,
          gunAngleDeg: 180,
          health: 10,
          maxHealth: 10,
          active: true,
          state: 'chase',
          aiTimer: 0,
          fireTimer: 10,
          salvoRemaining: 0,
          salvoCooldown: 0,
          surfaceTimer: 0,
          fallFrames: 0,
          lifetime: 100,
          activationTimer: 0,
          flashTicks: 0,
          hitRadius: 10,
          width: 20,
          height: 20,
          scoreValue: 20,
          difficultyWeight: 1,
          spriteMain: 'fighter_body',
          spriteSecondary: 'fighter_wings',
          laserActive: false,
          laserLength: 0,
        },
      ],
    });
    renderer.setPalette('sfmt');
    renderer.render(playSnap, playSnap, 0.5, null, 1.25);

    const metrics = renderer.getFrameMetrics();
    expect(metrics.virtualWidth).toBe(600);
    expect(metrics.virtualHeight).toBe(400);
    expect(metrics.canvasWidth).toBe(1200);
    expect(metrics.canvasHeight).toBe(800);
    expect(metrics.webglErrors).toBe(0);
    expect(metrics.drawCalls).toBeGreaterThan(0);
    expect(metrics.activePaletteId).toBe('sfmt');
    expect(renderer.getLastPostUniforms().healthRadius[0]).toBe(40);

    renderer.resize(900, 600);
    expect(renderer.getFrameMetrics().canvasWidth).toBe(900);
    expect(renderer.getFrameMetrics().canvasHeight).toBe(600);

    renderer.dispose();
  });

  it('gracefully uses Canvas 2D emergency fallback if WebGL2 context creation returns null', () => {
    const fillRect = vi.fn();
    const fillText = vi.fn();
    const strokeRect = vi.fn();
    const mock2d = {
      imageSmoothingEnabled: true,
      fillStyle: '',
      strokeStyle: '',
      font: '',
      fillRect,
      fillText,
      strokeRect,
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
    };

    const mockCanvas = {
      width: 600,
      height: 400,
      style: { imageRendering: '' },
      getContext: vi.fn((kind: string) => (kind === '2d' ? mock2d : null)),
    } as unknown as HTMLCanvasElement;

    const renderer = new WebGL2Renderer();
    renderer.init(mockCanvas, createMockVaultBundle());
    const snap = makeSnapshot({ phase: 'playing', player: { ...makeSnapshot().player, health: 60 } });
    renderer.render(snap, snap, 0, null, 0.5);

    expect(fillRect).toHaveBeenCalled();
    expect(renderer.getFrameMetrics().webglErrors).toBe(0);
    renderer.dispose();
  });
});
