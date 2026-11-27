import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ACT2_MOD_FLAGS } from '../src/contracts/mod';
import type { RgbaTuple } from '../src/contracts/render';
import { HANGAR_HUD_PASS } from '../src/render/hangar-hud-pass';
import type { Loadout, PilotProfile, SimSnapshot } from '../src/contracts/sim';
import type {
  BodySpec,
  EngineSpec,
  VaultAssetBundle,
  WeaponSpec,
} from '../src/contracts/vault';
import {
  ACT2_BONUS_PALETTES,
  BATCH_FRAG,
  BATCH_MENU_FRAG,
  BATCH_MENU_VERT,
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
import {
  HANGAR_LAYOUT,
  layoutHangarDescription,
  layoutMissionCardDescription,
  resolveEnemyRenderTransform,
  wrapBitmapTextLines,
  type HangarHudPass,
} from '../src/render/renderer';
import {
  ACT2_CUSTOM_PALETTE_KEY,
  ACT2_MODS_STORAGE_KEY,
  ACT2_PB_GHOST_KEY,
  ASSIST_MODE_STORAGE_KEY,
  HANGAR_ROWS,
  HangarController,
  LEGACY_ACT2_CUSTOM_PALETTE_KEY,
  LEGACY_ACT2_MODS_STORAGE_KEY,
  LEGACY_ACT2_PB_GHOST_KEY,
  LEGACY_PROFILE_STORAGE_KEY,
  PROFILE_STORAGE_KEY,
  PROGRESSION_LOCK_STORAGE_KEY,
  TelemetryHud,
  clearStoredProfileKeys,
  computeCampaignUnlockedProfile,
  formatTelemetryLines,
  loadProgressionLockMode,
  loadStoredAssistMode,
  loadStoredCustomPalette,
  loadStoredModFlags,
  loadStoredPbGhost,
  loadStoredProfile,
  normalizeStoredPaletteId,
  saveProgressionLockMode,
  saveStoredAssistMode,
  type StorageLike,
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
  it('provides at least 10 valid 8-color Skybreaker palettes + backcol with distinct water remap keys and zero trademark leaks', () => {
    expect(PALETTES.length).toBeGreaterThanOrEqual(10);

    const requiredIds = [
      'original',
      'inverted',
      'classic',
      'gameboy',
      'virtual',
      'oceanic',
      'synthdusk',
      'sunset',
      'amber',
      'overdrive',
    ];
    for (const id of requiredIds) {
      expect(PALETTES.some((p) => p.id === id)).toBe(true);
    }

    const forbidden = /luftrauser|urauser|kozilek|lanigiro/i;
    for (const pal of [...PALETTES, ...ACT2_BONUS_PALETTES]) {
      expect(pal.id).not.toMatch(forbidden);
      expect(pal.name).not.toMatch(forbidden);
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

  it('uses iconic warm sepia/cream/burgundy default palette (#61001d player, #8d494d enemy, #e5ddac sky, #ffffff highlights) with all colors[1..7] pairwise distances > 0.015', () => {
    const orig = getPaletteById('original');
    expect(orig.id).toBe('original');
    expect(orig.name).toBe('SKYBREAKER');
    expect(orig.backcol).toEqual(hexToRgba('#e5ddac'));
    expect(orig.colors[1]).toEqual(hexToRgba('#61001d'));
    expect(orig.colors[2]).toEqual(hexToRgba('#8d494d'));
    expect(orig.colors[3]).toEqual(hexToRgba('#b9937c'));
    expect(orig.colors[4]).toEqual(hexToRgba('#dec796'));
    expect(orig.colors[5]).toEqual(hexToRgba('#e5ddac'));
    expect(orig.colors[6]).toEqual(hexToRgba('#efe9cd'));
    expect(orig.colors[7]).toEqual(hexToRgba('#ffffff'));

    for (const pal of PALETTES) {
      const slots: RgbaTuple[] = pal.colors.slice(1);
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          expect(rgbDist(slots[i]!, slots[j]!)).toBeGreaterThan(0.015);
        }
      }
    }

    const overdrive = getPaletteById('overdrive');
    expect(overdrive.name).toBe('OVERDRIVE');
    expect(isPaletteUnlocked(overdrive, 0, false)).toBe(false);
    expect(isPaletteUnlocked(overdrive, 0, true)).toBe(true);

    expect(getPaletteById('non-existent-id').id).toBe('original');
  });
});

describe('GLSL ES 3.00 Shader & Post Uniform Contracts', () => {
  it('declares #version 300 es on every shader stage including dual-channel menu batch', () => {
    const shaders = [
      BATCH_VERT,
      BATCH_REFLECT_VERT,
      BATCH_FRAG,
      BATCH_REFLECT_FRAG,
      BATCH_MENU_VERT,
      BATCH_MENU_FRAG,
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
    expect(BATCH_MENU_FRAG).toContain('texc.x >= 1.0');
    expect(BATCH_MENU_FRAG).toContain('s.b');
    expect(BATCH_MENU_FRAG).toContain('s.r');
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

    expect(OUTPASS_FRAG).toContain(
      'if (uFxFlags.x < 0.5 && uFxFlags.y < 0.5 && uFxFlags.z < 0.5 && uFxFlags.w < 0.5)',
    );
    expect(OUTPASS_FRAG).toContain('fragColor = vec4(cta.rgb, 1.0);');
    expect(OUTPASS_FRAG).toContain(
      'float hudSafe = 1.0 - smoothstep(0.82, 0.88, vTexCoords.y);',
    );
    expect(OUTPASS_FRAG).toContain('sw.w * hudSafe');
    expect(OUTPASS_FRAG).toContain('warpStrength * 0.045 * hudSafe');
    expect(OUTPASS_FRAG).toContain(
      '0.30 * speedNorm * smoothstep(0.25, 0.75, edgeDist) * hudSafe',
    );
    expect(OUTPASS_FRAG).toContain('(bloomAcc / 8.0) * 0.30');
    expect(POST_WATER_FRAG).toContain('clamp(delta.y / 14.0, 0.0, 0.55)');
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
  it('cycles weapons, bodies, engines, palettes, assets, and mode while respecting unlock locks', () => {
    const controller = new HangarController();
    expect(HANGAR_ROWS).toEqual([
      'weapon',
      'body',
      'engine',
      'palette',
      'assets',
      'mode',
      'launch',
    ]);
    expect(controller.getAssetMode()).toBe('skybreaker');
    expect(controller.isSteamAvailable()).toBe(false);

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

    controller.moveRow(1); // -> assets
    expect(controller.getActiveRow()).toBe('assets');
    const aDenied = controller.cycleCurrent(1, unlockedSnap, sim);
    expect(aDenied.changed).toBe(false);
    expect(aDenied.locked).toBe(true);
    expect(aDenied.cue).toBe('snddeny');
    expect(aDenied.assetMode).toBe('skybreaker');

    controller.setSteamAvailable(true);
    expect(controller.isSteamAvailable()).toBe(true);
    const aToSteam = controller.cycleCurrent(1, unlockedSnap, sim);
    expect(aToSteam.changed).toBe(true);
    expect(aToSteam.locked).toBe(false);
    expect(aToSteam.cue).toBe('sndswap');
    expect(aToSteam.assetMode).toBe('steam-local');
    expect(controller.getAssetMode()).toBe('steam-local');

    const aBackToSky = controller.handleKey('ArrowLeft', unlockedSnap, sim);
    expect(aBackToSky.changed).toBe(true);
    expect(aBackToSky.cue).toBe('sndswap');
    expect(aBackToSky.assetMode).toBe('skybreaker');
    expect(controller.getAssetMode()).toBe('skybreaker');

    controller.setAssetMode('steam-local');
    expect(controller.getAssetMode()).toBe('steam-local');

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
    expect(uiState.assetMode).toBe('steam-local');
    expect(uiState.steamAvailable).toBe(true);
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
        activeStems: ['skybreaker_bass1', 'skybreaker_drums1', 'skybreaker_lead1'],
        epochTime: 1,
        contextTime: 2,
        interStemDriftMs: 0.12,
        alarmActive: false,
        sfxPoolActive: 1,
        muted: false,
      },
    });

    const lines = hud.getLastLines().join('\n');
    expect(lines).toContain('ASSETS: skybreaker-original | PALETTE: original');
    expect(lines).toContain('0.120ms');
    expect(lines).toContain('THE ORIGINAL');

    hud.update({
      snapshot: snap,
      vaultSource: 'steam-local',
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
        activePaletteId: 'overdrive',
      },
    });
    expect(hud.getLastLines()[0]).toBe('ASSETS: steam-local | PALETTE: overdrive');
    hud.dispose();
  });

  it('TelemetryHud.bindKeyboardToggle toggles cleanly on Backquote, `, ~, and key=Backquote', () => {
    const listeners = new Map<string, Set<EventListener>>();
    const target: EventTarget = {
      addEventListener(type: string, cb: EventListenerOrEventListenerObject | null) {
        if (typeof cb !== 'function') return;
        let set = listeners.get(type);
        if (!set) {
          set = new Set();
          listeners.set(type, set);
        }
        set.add(cb);
      },
      removeEventListener(type: string, cb: EventListenerOrEventListenerObject | null) {
        if (typeof cb !== 'function') return;
        listeners.get(type)?.delete(cb);
      },
      dispatchEvent(ev: Event) {
        for (const cb of listeners.get(ev.type) ?? []) {
          cb(ev);
        }
        return true;
      },
    };

    const fireKey = (opts: {
      code: string;
      key: string;
      shiftKey?: boolean;
      ctrlKey?: boolean;
    }) => {
      target.dispatchEvent({
        type: 'keydown',
        code: opts.code,
        key: opts.key,
        shiftKey: opts.shiftKey ?? false,
        ctrlKey: opts.ctrlKey ?? false,
        metaKey: false,
        altKey: false,
      } as unknown as Event);
    };

    const hud = new TelemetryHud();
    hud.bindKeyboardToggle(target);
    expect(hud.isVisible()).toBe(false);

    fireKey({ code: 'Backquote', key: '`' });
    expect(hud.isVisible()).toBe(true);

    fireKey({ code: 'IntlBackslash', key: '`' });
    expect(hud.isVisible()).toBe(false);

    fireKey({ code: 'IntlBackslash', key: '~', shiftKey: true });
    expect(hud.isVisible()).toBe(true);

    fireKey({ code: '', key: 'Backquote' });
    expect(hud.isVisible()).toBe(false);

    // Modifier chords must not toggle
    fireKey({ code: 'Backquote', key: '`', ctrlKey: true });
    expect(hud.isVisible()).toBe(false);

    hud.dispose();
    fireKey({ code: 'Backquote', key: '`' });
    expect(hud.isVisible()).toBe(false);
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
    renderer.setPalette('overdrive');
    renderer.render(playSnap, playSnap, 0.5, null, 1.25);

    const metrics = renderer.getFrameMetrics();
    expect(metrics.virtualWidth).toBe(600);
    expect(metrics.virtualHeight).toBe(400);
    expect(metrics.canvasWidth).toBe(1200);
    expect(metrics.canvasHeight).toBe(800);
    expect(metrics.webglErrors).toBe(0);
    expect(metrics.drawCalls).toBeGreaterThan(0);
    expect(metrics.activePaletteId).toBe('overdrive');
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

describe('Renderer Visual & UI Regression Contracts', () => {
  it('keeps left-moving Boat, BigBoat, Submarine, AceMarine, and Blimp upright via scaleX=-1 and angleRad=0', () => {
    const navalAndBlimp: Array<
      'Boat' | 'BigBoat' | 'Submarine' | 'AceMarine' | 'Blimp'
    > = ['Boat', 'BigBoat', 'Submarine', 'AceMarine', 'Blimp'];

    for (const kind of navalAndBlimp) {
      expect(
        resolveEnemyRenderTransform({ kind, vx: -1.5, angleDeg: 180 }),
      ).toEqual({ angleRad: 0, scaleX: -1, scaleY: 1 });

      expect(
        resolveEnemyRenderTransform({ kind, vx: 1.5, angleDeg: 0 }),
      ).toEqual({ angleRad: 0, scaleX: 1, scaleY: 1 });

      expect(
        resolveEnemyRenderTransform({ kind, vx: 0, angleDeg: 180 }),
      ).toEqual({ angleRad: 0, scaleX: -1, scaleY: 1 });

      expect(
        resolveEnemyRenderTransform({ kind, vx: 0, angleDeg: 0 }),
      ).toEqual({ angleRad: 0, scaleX: 1, scaleY: 1 });
    }

    // Airplanes and missiles continue to rotate by angleDeg
    expect(
      resolveEnemyRenderTransform({ kind: 'Fighter', vx: -5, angleDeg: 180 }),
    ).toEqual({ angleRad: Math.PI, scaleX: 1, scaleY: 1 });
    expect(
      resolveEnemyRenderTransform({ kind: 'LaserAce', vx: 4, angleDeg: -45 }),
    ).toEqual({ angleRad: -Math.PI / 4, scaleX: 1, scaleY: 1 });
    expect(
      resolveEnemyRenderTransform({ kind: 'Missile', vx: 0, angleDeg: -90 }),
    ).toEqual({ angleRad: -Math.PI / 2, scaleX: 1, scaleY: 1 });
  });

  it('submits upright flipped hull instances, mirrored BigBoat guns, and gunAngleDeg-aligned LaserAce beams', () => {
    const mockGl = createMockWebGL2Context();
    const instanceBatches: Float32Array[] = [];
    const dynamicBuffers: Float32Array[] = [];
    let activeTarget = 0;

    mockGl.gl.bufferSubData = vi.fn(
      (_target: number, _offset: number, data: ArrayBufferView) => {
        if (data instanceof Float32Array) {
          instanceBatches.push(new Float32Array(data));
        }
      },
    );
    mockGl.gl.bufferData = vi.fn(
      (target: number, data: ArrayBufferView | number) => {
        activeTarget = target;
        if (data instanceof Float32Array && activeTarget === mockGl.gl.ARRAY_BUFFER) {
          dynamicBuffers.push(new Float32Array(data));
        }
      },
    );

    const mockCanvas = {
      width: 600,
      height: 400,
      style: { imageRendering: '' },
      getContext: vi.fn((kind: string) => (kind === 'webgl2' ? mockGl.gl : null)),
    } as unknown as HTMLCanvasElement;

    const vault = createMockVaultBundle();
    vault.data.atlases.sprites.sprites = {
      ...vault.data.atlases.sprites.sprites,
      small_boat: { name: 'small_boat', size: [60, 17], hull: [0, 0, 60, 17], center: [29, 17], subs: [{ x: 0, y: 0 }] },
      small_boat_gun: { name: 'small_boat_gun', size: [16, 3], hull: [0, 0, 16, 3], center: [0, 1], subs: [{ x: 1, y: 0 }] },
      big_boat: { name: 'big_boat', size: [300, 50], hull: [0, 0, 300, 50], center: [144, 51], subs: [{ x: 2, y: 0 }] },
      big_boat_gun: { name: 'big_boat_gun', size: [35, 9], hull: [0, 0, 35, 9], center: [3, 5], subs: [{ x: 3, y: 0 }] },
      submarine: { name: 'submarine', size: [198, 36], hull: [0, 0, 198, 36], center: [99, 36], subs: [{ x: 4, y: 0 }] },
      acemarine: { name: 'acemarine', size: [240, 36], hull: [0, 0, 240, 36], center: [120, 36], subs: [{ x: 5, y: 0 }] },
      blimp: { name: 'blimp', size: [550, 219], hull: [0, 0, 550, 219], center: [275, 109], subs: [{ x: 6, y: 0 }] },
      blimp_anim: { name: 'blimp_anim', size: [9, 49], hull: [0, 0, 9, 49], center: [-230, 33], subs: [{ x: 7, y: 0 }] },
      laserace_body: { name: 'laserace_body', size: [45, 45], hull: [0, 0, 45, 45], center: [22, 22], subs: [{ x: 8, y: 0 }] },
      laserace_wings: { name: 'laserace_wings', size: [45, 45], hull: [0, 0, 45, 45], center: [22, 22], subs: [{ x: 9, y: 0 }] },
      projectile_Elaser: { name: 'projectile_Elaser', size: [2, 8], hull: [0, 0, 2, 8], center: [1, 4], subs: [{ x: 10, y: 0 }] },
    };

    const renderer = new WebGL2Renderer();
    renderer.init(mockCanvas, vault);

    const baseEnemy = {
      prevX: 0,
      prevY: 0,
      vy: 0,
      health: 50,
      maxHealth: 50,
      active: true,
      state: 'cruise' as const,
      aiTimer: 0,
      fireTimer: 10,
      salvoRemaining: 0,
      salvoCooldown: 0,
      surfaceTimer: 0,
      fallFrames: 0,
      lifetime: 100,
      activationTimer: 0,
      flashTicks: 0,
      hitRadius: 20,
      width: 40,
      height: 20,
      scoreValue: 100,
      difficultyWeight: 1,
      laserActive: false,
      laserLength: 0,
    };

    const snap = makeSnapshot({
      phase: 'playing',
      enemies: [
        {
          ...baseEnemy,
          id: 1,
          kind: 'BigBoat',
          x: 100,
          y: 0,
          prevX: 100,
          prevY: 0,
          vx: -1,
          angleDeg: 180,
          gunAngleDeg: -135,
          spriteMain: 'big_boat',
          spriteGun: 'big_boat_gun',
        },
        {
          ...baseEnemy,
          id: 2,
          kind: 'Blimp',
          x: 200,
          y: -260,
          prevX: 200,
          prevY: -260,
          vx: -0.5,
          angleDeg: 180,
          gunAngleDeg: 90,
          spriteMain: 'blimp',
          spriteGun: 'big_boat_gun',
        },
        {
          ...baseEnemy,
          id: 3,
          kind: 'LaserAce',
          x: 300,
          y: -180,
          prevX: 300,
          prevY: -180,
          vx: 3,
          angleDeg: 0,
          gunAngleDeg: 90,
          spriteMain: 'laserace_body',
          spriteSecondary: 'laserace_wings',
          laserActive: true,
          laserLength: 420,
        },
        {
          ...baseEnemy,
          id: 4,
          kind: 'Boat',
          x: -80,
          y: 0,
          prevX: -80,
          prevY: 0,
          vx: -0.8,
          angleDeg: 180,
          gunAngleDeg: -120,
          spriteMain: 'small_boat',
          spriteGun: 'small_boat_gun',
        },
        {
          ...baseEnemy,
          id: 5,
          kind: 'Submarine',
          x: -160,
          y: 0,
          prevX: -160,
          prevY: 0,
          vx: -0.4,
          angleDeg: 180,
          gunAngleDeg: -90,
          spriteMain: 'submarine',
        },
        {
          ...baseEnemy,
          id: 6,
          kind: 'AceMarine',
          x: -240,
          y: 0,
          prevX: -240,
          prevY: 0,
          vx: -0.4,
          angleDeg: 180,
          gunAngleDeg: -45,
          spriteMain: 'acemarine',
          spriteGun: 'big_boat_gun',
        },
      ],
    });

    renderer.render(snap, snap, 0, null, 0.5);

    const instances: Array<{
      x: number;
      y: number;
      angleRad: number;
      subX: number;
      w: number;
      scaleX: number;
      scaleY: number;
    }> = [];
    for (const batch of instanceBatches) {
      for (let i = 0; i < batch.length; i += 13) {
        instances.push({
          x: batch[i]!,
          y: batch[i + 1]!,
          angleRad: batch[i + 2]!,
          subX: batch[i + 3]!,
          w: batch[i + 5]!,
          scaleX: batch[i + 9]!,
          scaleY: batch[i + 10]!,
        });
      }
    }

    // Left-moving Boat (subX=0, w=60), BigBoat (subX=2, w=300), Submarine (subX=4, w=198), AceMarine (subX=5, w=240)
    for (const [expectedSubX, expectedW] of [
      [0, 60],
      [2, 300],
      [4, 198],
      [5, 240],
    ] as const) {
      const hullInst = instances.find(
        (inst) => inst.subX === expectedSubX && inst.w === expectedW,
      );
      expect(hullInst).toBeDefined();
      expect(hullInst!.angleRad).toBe(0);
      expect(hullInst!.scaleX).toBe(-1);
      expect(hullInst!.scaleY).toBe(1);
    }

    // BigBoat guns (subX=3 at y=-23) are mirrored in main + reflect batches
    const bigBoatGuns = instances.filter(
      (inst) => inst.subX === 3 && inst.y === -23,
    );
    expect(bigBoatGuns.map((g) => g.x)).toEqual([155, 45, 155, 45]);

    // Blimp hull (subX=6) and blimp_anim propeller (subX=7): upright angleRad=0, scaleX=-1
    const blimpInst = instances.find((inst) => inst.subX === 6);
    const blimpPropInst = instances.find((inst) => inst.subX === 7);
    expect(blimpInst).toBeDefined();
    expect(blimpInst!.angleRad).toBe(0);
    expect(blimpInst!.scaleX).toBe(-1);
    expect(blimpPropInst).toBeDefined();
    expect(blimpPropInst!.angleRad).toBe(0);
    expect(blimpPropInst!.scaleX).toBe(-1);

    // LaserAce beam (subX=10) uses gunAngleDeg (90 deg = PI/2), NOT hull angleDeg (0)
    const elaserInst = instances.find((inst) => inst.subX === 10);
    expect(elaserInst).toBeDefined();
    expect(elaserInst!.angleRad).toBeCloseTo(Math.PI / 2, 5);
    expect(elaserInst!.x).toBeCloseTo(300, 4);
    expect(elaserInst!.y).toBeCloseTo(-180 + 210, 4);

    // Fallback rect path for LaserAce beam (when projectile_Elaser sprite is missing) also uses gunAngleDeg
    delete vault.data.atlases.sprites.sprites['projectile_Elaser'];
    dynamicBuffers.length = 0;
    renderer.render(snap, snap, 0, null, 0.6);
    const hasVerticalBeamQuad = dynamicBuffers.some((buf) => {
      if (buf.length < 36 || buf.length % 6 !== 0) return false;
      for (let i = 0; i <= buf.length - 36; i += 36) {
        const xs = [buf[i]!, buf[i + 6]!, buf[i + 12]!, buf[i + 24]!];
        const ys = [buf[i + 1]!, buf[i + 7]!, buf[i + 13]!, buf[i + 25]!];
        const spanX = Math.max(...xs) - Math.min(...xs);
        const spanY = Math.max(...ys) - Math.min(...ys);
        if (Math.abs(spanY - 420) < 1 && Math.abs(spanX - 5) < 1) {
          return true;
        }
      }
      return false;
    });
    expect(hasVerticalBeamQuad).toBe(true);

    renderer.dispose();
  });

  it('uses pure uniform_backcol in POST_WATER_FRAG without seaBackCol tinting', () => {
    expect(POST_WATER_FRAG).not.toContain('seaBackCol');
    expect(POST_WATER_FRAG).not.toContain('mix(uniform_backcol.rgb, uniform_colors[3].rgb, 0.08)');
    expect(POST_WATER_FRAG).toContain('finalColor = uniform_backcol;');
    expect(POST_WATER_FRAG).toContain('outColor = uniform_backcol;');
  });

  it('wraps Hangar multiline descr and Mission card descriptions without ? glyphs or mid-word clipping', () => {
    const font = createBuiltinPixelFont();

    // 1. Hangar description splits on \n and wraps inside 250px up to 3 lines
    const multiDescr = layoutHangarDescription(
      font.spec,
      'continuous beam\npierces enemies\nslow turn while firing',
      250,
      3,
    );
    expect(multiDescr.lines.map((l) => l.text)).toEqual([
      'CONTINUOUS BEAM',
      'PIERCES ENEMIES',
      'SLOW TURN WHILE FIRING',
    ]);
    for (const line of multiDescr.lines) {
      expect(measureBitmapText(font.spec, line.text, line.scale).width).toBeLessThanOrEqual(250);
    }

    // 2. Word-wrapping avoids breaking mid-word
    const wrapped = wrapBitmapTextLines(
      font.spec,
      'FIRES HIGH VELOCITY ARMOR PIERCING CANNON SHELLS ACROSS THE SKY',
      250,
      1,
    );
    expect(wrapped.length).toBeGreaterThan(1);
    expect(wrapped.join(' ')).toBe(
      'FIRES HIGH VELOCITY ARMOR PIERCING CANNON SHELLS ACROSS THE SKY',
    );
    for (const line of wrapped) {
      expect(measureBitmapText(font.spec, line, 1).width).toBeLessThanOrEqual(250);
    }

    // 3. Mission card description preserves 100% of every string (no .slice(0, 36))
    const m1 = layoutMissionCardDescription(
      font.spec,
      'DESTROY 5 FIGHTERS IN A SINGLE SORTIE',
      224,
    );
    expect(m1.lines.join(' ')).toBe('DESTROY 5 FIGHTERS IN A SINGLE SORTIE');
    for (const line of m1.lines) {
      expect(measureBitmapText(font.spec, line, m1.scale).width).toBeLessThanOrEqual(224);
    }

    const m2 = layoutMissionCardDescription(
      font.spec,
      'DESTROY 10 BIG BOATS WITHOUT TAKING DAMAGE IN A SINGLE SORTIE',
      224,
    );
    expect(m2.lines.length).toBe(2);
    expect(m2.lines.join(' ')).toBe(
      'DESTROY 10 BIG BOATS WITHOUT TAKING DAMAGE IN A SINGLE SORTIE',
    );
    for (const line of m2.lines) {
      expect(measureBitmapText(font.spec, line, m2.scale).width).toBeLessThanOrEqual(224);
    }

    // 4. Render Hangar with multiline descr and inspect vertex UVs for zero '?' glyphs
    const mockGl = createMockWebGL2Context();
    const textBuffers: Float32Array[] = [];
    let currentProgram: unknown = null;
    const origCreateProgram = mockGl.gl.createProgram;
    const createdPrograms: Array<{ id: number }> = [];
    mockGl.gl.createProgram = vi.fn(() => {
      const p = { id: createdPrograms.length + 1 };
      createdPrograms.push(p);
      return p;
    });
    void origCreateProgram;
    mockGl.gl.useProgram = vi.fn((p: unknown) => {
      currentProgram = p;
    });
    mockGl.gl.bufferData = vi.fn((_target: number, data: ArrayBufferView | number) => {
      // fontProg is the 4th compiled program in WebGL2Renderer.init()
      if (
        currentProgram === createdPrograms[3] &&
        data instanceof Float32Array &&
        data.length > 0
      ) {
        textBuffers.push(new Float32Array(data));
      }
    });
    const mockCanvas = {
      width: 600,
      height: 400,
      style: { imageRendering: '' },
      getContext: vi.fn((kind: string) => (kind === 'webgl2' ? mockGl.gl : null)),
    } as unknown as HTMLCanvasElement;

    const renderer = new WebGL2Renderer();
    const vault = createMockVaultBundle();
    renderer.init(mockCanvas, vault);

    const laserWeapon = makeWeapon(1, 'LASER');
    laserWeapon.descr = 'continuous beam\npierces enemies\nslow turn while firing';
    const hangarSnap = makeSnapshot({
      phase: 'hangar',
      activeMissions: [
        {
          id: 1,
          component: [0, 1, 0],
          objective: 0,
          condition: 12,
          val: [5, 1],
          title: 'LASER WEAPON #1',
          description: 'DESTROY 5 FIGHTERS IN A SINGLE SORTIE',
        },
      ],
      player: {
        ...makeSnapshot().player,
        loadout: { weapon: 1, body: 0, engine: 0 },
        weaponSpec: laserWeapon,
      },
    });

    const controller = new HangarController();
    const hangarUi = controller.buildUiState(hangarSnap);
    renderer.render(hangarSnap, hangarSnap, 0, hangarUi, 0.5);

    expect(
      textBuffers.some((b) => b.length === 'CONTINUOUS BEAM'.length * 24),
    ).toBe(true);
    expect(
      textBuffers.some((b) => b.length === 'PIERCES ENEMIES'.length * 24),
    ).toBe(true);
    expect(
      textBuffers.some((b) => b.length === 'SLOW TURN WHILE FIRING'.length * 24),
    ).toBe(true);
    expect(
      textBuffers.some(
        (b) => b.length === 'DESTROY 5 FIGHTERS IN A SINGLE SORTIE'.length * 24,
      ),
    ).toBe(true);

    const qGlyph = font.spec.glyphs[63]!;
    const qU0 = qGlyph.x / font.spec.scaleW;
    const qV0 = qGlyph.y / font.spec.scaleH;
    let foundQuestionMarkUv = false;
    for (const buf of textBuffers) {
      for (let i = 0; i < buf.length; i += 24) {
        if (
          Math.abs(buf[i + 2]! - qU0) < 1e-4 &&
          Math.abs(buf[i + 3]! - qV0) < 1e-4
        ) {
          foundQuestionMarkUv = true;
        }
      }
    }
    expect(foundQuestionMarkUv).toBe(false);
    renderer.dispose();
  });

  it('anchors TelemetryHud at bottom: 8px; left: 8px so top-left HUD and Hangar stay clear', () => {
    const created: Array<{
      attrs: Record<string, string>;
      style: Record<string, string>;
      children: unknown[];
      parentElement: unknown;
      textContent: string;
      setAttribute: (k: string, v: string) => void;
      appendChild: (c: unknown) => void;
      removeChild: (c: unknown) => void;
    }> = [];

    const makeEl = () => {
      const el = {
        attrs: {} as Record<string, string>,
        style: {} as Record<string, string>,
        children: [] as unknown[],
        parentElement: null as unknown,
        textContent: '',
        setAttribute(k: string, v: string) {
          el.attrs[k] = v;
        },
        appendChild(c: unknown) {
          el.children.push(c);
          if (c && typeof c === 'object' && 'parentElement' in c) {
            (c as { parentElement: unknown }).parentElement = el;
          }
        },
        removeChild(c: unknown) {
          el.children = el.children.filter((x) => x !== c);
        },
      };
      created.push(el);
      return el;
    };

    const container = makeEl();
    vi.stubGlobal('document', {
      createElement: () => makeEl(),
      body: container,
    });

    try {
      const hud = new TelemetryHud(container as unknown as HTMLElement);
      const root = hud.getElement() as unknown as ReturnType<typeof makeEl>;
      expect(root).not.toBeNull();
      expect(root.attrs['data-testid']).toBe('telemetry-hud');
      expect(root.style.position).toBe('fixed');
      expect(root.style.bottom).toBe('8px');
      expect(root.style.left).toBe('8px');
      expect(root.style.top).toBeUndefined();
      hud.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses exact integer NEAREST font scales across Hangar banner, HUD, Pause, and GameOver', () => {
    const makeTestFontSpec = (
      name: string,
      lineHeight: number,
      glyphW: number,
      glyphH: number,
      yoffset: number,
    ) => {
      const glyphs: Record<
        number,
        {
          id: number;
          x: number;
          y: number;
          width: number;
          height: number;
          xoffset: number;
          yoffset: number;
          xadvance: number;
        }
      > = {};
      for (let code = 32; code <= 126; code++) {
        glyphs[code] = {
          id: code,
          x: (code - 32) % 16 * (glyphW + 1),
          y: Math.floor((code - 32) / 16) * (glyphH + 1),
          width: glyphW,
          height: glyphH,
          xoffset: 0,
          yoffset,
          xadvance: glyphW + 1,
        };
      }
      return {
        name,
        face: name,
        size: lineHeight - 2,
        lineHeight,
        base: lineHeight - 4,
        scaleW: 256,
        scaleH: 256,
        pageFile: `${name}_0.png`,
        glyphs,
      };
    };

    const runWithFonts = (withVaultFonts: boolean) => {
      const mockGl = createMockWebGL2Context();
      const createdPrograms: Array<{ id: number }> = [];
      let currentProgram: unknown = null;
      const fontQuads: Array<{ verts: Float32Array; isCombo: boolean }> = [];

      mockGl.gl.createProgram = vi.fn(() => {
        const p = { id: createdPrograms.length + 1 };
        createdPrograms.push(p);
        return p;
      });
      mockGl.gl.useProgram = vi.fn((p: unknown) => {
        currentProgram = p;
      });
      mockGl.gl.bufferData = vi.fn((_target: number, data: ArrayBufferView | number) => {
        if (!(data instanceof Float32Array) || data.length === 0) return;
        // fontProg is 4th compiled program (index 3), comboFontProg is 5th (index 4)
        if (currentProgram === createdPrograms[3]) {
          fontQuads.push({ verts: new Float32Array(data), isCombo: false });
        } else if (currentProgram === createdPrograms[4]) {
          fontQuads.push({ verts: new Float32Array(data), isCombo: true });
        }
      });

      const mockCanvas = {
        width: 600,
        height: 400,
        style: { imageRendering: '' },
        getContext: vi.fn((kind: string) => (kind === 'webgl2' ? mockGl.gl : null)),
      } as unknown as HTMLCanvasElement;

      const vault = createMockVaultBundle();
      if (withVaultFonts) {
        const blankTex = new Uint8Array(256 * 256 * 4);
        vault.data.fonts = {
          fntb: makeTestFontSpec('fntb', 34, 17, 23, 5),
          fntm: makeTestFontSpec('fntm', 18, 9, 12, 3),
          fnts: makeTestFontSpec('fnts', 10, 6, 7, 1),
        };
        vault.textures.fntb_0 = {
          name: 'fntb_0',
          width: 256,
          height: 256,
          rgba: blankTex,
          source: 'procedural',
        };
        vault.textures.fntm_0 = {
          name: 'fntm_0',
          width: 256,
          height: 256,
          rgba: blankTex,
          source: 'procedural',
        };
        vault.textures.fnts_0 = {
          name: 'fnts_0',
          width: 256,
          height: 256,
          rgba: blankTex,
          source: 'procedural',
        };
      }

      const renderer = new WebGL2Renderer();
      renderer.init(mockCanvas, vault);

      // 1. Hangar banner ('BEAMBREAKER')
      fontQuads.length = 0;
      const controller = new HangarController();
      const hangarSnap = makeSnapshot({
        phase: 'hangar',
        player: { ...makeSnapshot().player, planeName: 'BEAMBREAKER' },
      });
      const hangarUi = { ...controller.buildUiState(hangarSnap), planeName: 'BEAMBREAKER' };
      renderer.render(hangarSnap, hangarSnap, 0, hangarUi, 0.5);

      const bannerDraw = fontQuads.find((q) => q.verts.length === 'BEAMBREAKER'.length * 24);
      expect(bannerDraw).toBeDefined();
      const bannerH = bannerDraw!.verts[9]! - bannerDraw!.verts[1]!;
      const bannerY0 = bannerDraw!.verts[1]!;
      const bannerY1 = bannerDraw!.verts[9]!;
      if (withVaultFonts) {
        expect(bannerH).toBe(12); // fntm glyphH=12 * scale=1 (never 0.85)
        expect(bannerY0).toBe(39); // y=36 + yoffset=3
      } else {
        expect(bannerH).toBe(14); // builtin glyphH=7 * scale=2 (never 1.5)
        expect(bannerY0).toBe(36); // y=36 + yoffset=0
      }
      expect(bannerY0).toBeGreaterThanOrEqual(32);
      expect(bannerY1).toBeLessThanOrEqual(58);
      for (let i = 0; i < bannerDraw!.verts.length; i += 4) {
        expect(Number.isInteger(bannerDraw!.verts[i]!)).toBe(true);
        expect(Number.isInteger(bannerDraw!.verts[i + 1]!)).toBe(true);
      }

      // 2. HUD (Score + Combo + SFMT + ACE BOT)
      fontQuads.length = 0;
      const hudSnap = makeSnapshot({
        phase: 'playing',
        mode: 'sfmt',
        autopilotEnabled: true,
        score: 12345,
        combo: 4,
        comboTimer: 90,
        comboMaxTimer: 180,
      });
      renderer.render(hudSnap, hudSnap, 0, null, 0.5);
      const comboDraw = fontQuads.find((q) => q.isCombo);
      expect(comboDraw).toBeDefined();
      const expectedBigH = withVaultFonts ? 23 : 14; // fntb*1=23, builtin*2=14
      expect(comboDraw!.verts[9]! - comboDraw!.verts[1]!).toBe(expectedBigH);

      // 3. Pause ('PAUSED') — drawHudPass renders 6-char score first, so take last 6-char quad
      fontQuads.length = 0;
      const pauseSnap = makeSnapshot({ phase: 'playing', paused: true });
      renderer.render(pauseSnap, pauseSnap, 0, null, 0.5);
      const pausedDraw = fontQuads
        .filter((q) => !q.isCombo && q.verts.length === 'PAUSED'.length * 24)
        .at(-1);
      expect(pausedDraw).toBeDefined();
      expect(pausedDraw!.verts[9]! - pausedDraw!.verts[1]!).toBe(withVaultFonts ? 23 : 21);

      // 4. GameOver ('SHOT DOWN' + planeName subtitle)
      fontQuads.length = 0;
      const overSnap = makeSnapshot({
        phase: 'gameover',
        player: { ...makeSnapshot().player, alive: false, planeName: 'BEAMBREAKER' },
      });
      renderer.render(overSnap, overSnap, 0, null, 0.5);
      const shotDownDraw = fontQuads
        .filter((q) => !q.isCombo && q.verts.length === 'SHOT DOWN'.length * 24)
        .at(-1);
      expect(shotDownDraw).toBeDefined();
      expect(shotDownDraw!.verts[9]! - shotDownDraw!.verts[1]!).toBe(expectedBigH);

      const subtitleDraw = fontQuads
        .filter((q) => !q.isCombo && q.verts.length === 'BEAMBREAKER'.length * 24)
        .at(-1);
      expect(subtitleDraw).toBeDefined();
      expect(subtitleDraw!.verts[9]! - subtitleDraw!.verts[1]!).toBe(7); // fnts/builtin*1 (never 1.2)

      renderer.dispose();
    };

    runWithFonts(true);
    runWithFonts(false);
  });

  it('submits allied submarine in Hangar/launchSubY, laser_charge telegraph, stroboscopic boss flash, and Boat gun mount', () => {
    const mockGl = createMockWebGL2Context();
    const instanceBatches: Float32Array[] = [];
    const solidBuffers: Float32Array[] = [];
    const createdPrograms: Array<{ id: number }> = [];
    let currentProgram: unknown = null;

    mockGl.gl.createProgram = vi.fn(() => {
      const p = { id: createdPrograms.length + 1 };
      createdPrograms.push(p);
      return p;
    });
    mockGl.gl.useProgram = vi.fn((p: unknown) => {
      currentProgram = p;
    });
    mockGl.gl.bufferSubData = vi.fn(
      (_target: number, _offset: number, data: ArrayBufferView) => {
        if (data instanceof Float32Array) {
          instanceBatches.push(new Float32Array(data));
        }
      },
    );
    mockGl.gl.bufferData = vi.fn((_target: number, data: ArrayBufferView | number) => {
      // solidProg is the 7th compiled program (index 6)
      if (
        currentProgram === createdPrograms[6] &&
        data instanceof Float32Array &&
        data.length > 0
      ) {
        solidBuffers.push(new Float32Array(data));
      }
    });

    const mockCanvas = {
      width: 600,
      height: 400,
      style: { imageRendering: '' },
      getContext: vi.fn((kind: string) => (kind === 'webgl2' ? mockGl.gl : null)),
    } as unknown as HTMLCanvasElement;

    const vault = createMockVaultBundle();
    vault.data.atlases.sprites.sprites = {
      ...vault.data.atlases.sprites.sprites,
      submarine: {
        name: 'submarine',
        size: [198, 36],
        hull: [0, 0, 198, 36],
        center: [99, 36],
        subs: [{ x: 20, y: 0 }],
      },
      small_boat: {
        name: 'small_boat',
        size: [60, 17],
        hull: [0, 0, 60, 17],
        center: [29, 17],
        subs: [{ x: 25, y: 0 }],
      },
      small_boat_gun: {
        name: 'small_boat_gun',
        size: [16, 3],
        hull: [0, 0, 16, 3],
        center: [0, 1],
        subs: [{ x: 30, y: 0 }],
      },
      blimp: {
        name: 'blimp',
        size: [550, 219],
        hull: [0, 0, 550, 219],
        center: [275, 109],
        subs: [{ x: 40, y: 0 }],
      },
      big_boat_gun: {
        name: 'big_boat_gun',
        size: [35, 9],
        hull: [0, 0, 35, 9],
        center: [3, 5],
        subs: [{ x: 45, y: 0 }],
      },
      laserace_body: {
        name: 'laserace_body',
        size: [45, 45],
        hull: [0, 0, 45, 45],
        center: [22, 22],
        subs: [{ x: 50, y: 0 }],
      },
      laser_charge: {
        name: 'laser_charge',
        size: [32, 32],
        hull: [0, 0, 32, 32],
        center: [0, 16],
        subs: [
          { x: 100, y: 0 },
          { x: 110, y: 0 },
          { x: 120, y: 0 },
          { x: 130, y: 0 },
          { x: 140, y: 0 },
          { x: 150, y: 0 },
        ],
      },
    };

    const unpackInstances = () => {
      const out: Array<{
        x: number;
        y: number;
        angleRad: number;
        subX: number;
        scaleX: number;
        depth: number;
        flash: number;
      }> = [];
      for (const batch of instanceBatches) {
        for (let i = 0; i < batch.length; i += 13) {
          out.push({
            x: batch[i]!,
            y: batch[i + 1]!,
            angleRad: batch[i + 2]!,
            subX: batch[i + 3]!,
            scaleX: batch[i + 9]!,
            depth: batch[i + 11]!,
            flash: batch[i + 12]!,
          });
        }
      }
      return out;
    };

    const renderer = new WebGL2Renderer();
    renderer.init(mockCanvas, vault);
    const controller = new HangarController();

    // 1. Hangar renders surfaced allied submarine at (camX, seaLevel) in main & reflect
    const hangarSnap = makeSnapshot({ phase: 'hangar' });
    instanceBatches.length = 0;
    renderer.render(hangarSnap, hangarSnap, 0, controller.buildUiState(hangarSnap), 1.0);
    const hangarSubs = unpackInstances().filter((i) => i.subX === 20);
    expect(hangarSubs).toHaveLength(2);
    for (const sub of hangarSubs) {
      expect(sub.x).toBeCloseTo(18, 4); // camX = elapsedSec * 18
      expect(sub.y).toBe(0);
      expect(sub.depth).toBeCloseTo(0.55, 5);
      expect(sub.scaleX).toBe(1);
    }

    // 2. Launching with launchSubY=0 renders allied submarine in main & reflect at (0, 0), depth 0.52
    const launchSnap = makeSnapshot({ phase: 'launching', launchSubY: 0 });
    instanceBatches.length = 0;
    renderer.render(launchSnap, launchSnap, 0, null, 0.2);
    const launchSubs = unpackInstances().filter((i) => i.subX === 20);
    expect(launchSubs).toHaveLength(2);
    expect(launchSubs[0]!.x).toBe(0);
    expect(launchSubs[0]!.y).toBe(0);
    expect(launchSubs[0]!.depth).toBeCloseTo(0.52, 5);
    expect(launchSubs[0]!.flash).toBe(0);

    // When launchSubY > seaLevel + 8, reflection is omitted
    const submergedLaunchSnap = makeSnapshot({ phase: 'playing', launchSubY: 16 });
    instanceBatches.length = 0;
    renderer.render(submergedLaunchSnap, submergedLaunchSnap, 0, null, 0.3);
    expect(unpackInstances().filter((i) => i.subX === 20)).toHaveLength(1);

    // 3. LaserAce laser_charge telegraph, Boat gun mount, and stroboscopic boss flash
    const baseEnemy = {
      prevX: 0,
      prevY: 0,
      vy: 0,
      health: 100,
      maxHealth: 100,
      active: true,
      state: 'cruise' as const,
      aiTimer: 0,
      fireTimer: 10,
      salvoRemaining: 0,
      salvoCooldown: 0,
      surfaceTimer: 0,
      fallFrames: 0,
      lifetime: 100,
      activationTimer: 0,
      hitRadius: 20,
      width: 40,
      height: 20,
      scoreValue: 100,
      difficultyWeight: 1,
      laserActive: false,
      laserLength: 0,
    };

    const combatSnapTick1 = makeSnapshot({
      tick: 1,
      phase: 'playing',
      enemies: [
        {
          ...baseEnemy,
          id: 1,
          kind: 'Blimp',
          x: 200,
          y: -240,
          prevX: 200,
          prevY: -240,
          vx: -1,
          angleDeg: 180,
          gunAngleDeg: 90,
          flashTicks: 4,
          spriteMain: 'blimp',
          spriteGun: 'big_boat_gun',
        },
        {
          ...baseEnemy,
          id: 2,
          kind: 'Fighter',
          x: 80,
          y: -150,
          prevX: 80,
          prevY: -150,
          vx: 3,
          angleDeg: 0,
          gunAngleDeg: 0,
          flashTicks: 3,
          spriteMain: 'fighter_body',
        },
        {
          ...baseEnemy,
          id: 3,
          kind: 'LaserAce',
          x: 140,
          y: -120,
          prevX: 140,
          prevY: -120,
          vx: 3,
          angleDeg: 0,
          gunAngleDeg: 45,
          flashTicks: 0,
          spriteMain: 'laserace_body',
          laserChargeTicks: 15,
        },
        {
          ...baseEnemy,
          id: 4,
          kind: 'Boat',
          x: -50,
          y: 0,
          prevX: -50,
          prevY: 0,
          vx: -1,
          angleDeg: 180,
          gunAngleDeg: -120,
          flashTicks: 0,
          spriteMain: 'small_boat',
          spriteGun: 'small_boat_gun',
        },
      ],
    });

    instanceBatches.length = 0;
    renderer.render(combatSnapTick1, combatSnapTick1, 0, null, 0.4);
    const instTick1 = unpackInstances();

    // tick=1 -> tick % 6 < 2 => Blimp flash=1; Fighter flashTicks=3 (odd) => flash=1
    const blimpTick1 = instTick1.find((i) => i.subX === 40);
    expect(blimpTick1?.flash).toBe(1);
    const fighterTick1 = instTick1.find((i) => i.x === 80 && i.y === -150);
    expect(fighterTick1?.flash).toBe(1);

    // LaserAce laserChargeTicks=15 -> frame Math.floor((24 - 15) / 4) = 2 -> subX = 120, depth 0.38
    const chargeInstances = instTick1.filter((i) => i.subX === 120);
    expect(chargeInstances).toHaveLength(2); // main + reflect (ey = -120 < 4)
    expect(chargeInstances[0]!.depth).toBeCloseTo(0.38, 5);
    expect(chargeInstances[0]!.angleRad).toBeCloseTo(Math.PI / 4, 5);

    // Boat small_boat_gun mounted at (ex + 3 * scaleX, ey - 14) = (-50 - 3, -14)
    const smallGun = instTick1.find((i) => i.subX === 30);
    expect(smallGun).toBeDefined();
    expect(smallGun!.x).toBe(-53);
    expect(smallGun!.y).toBe(-14);

    // tick=3, flashTicks=4 -> Blimp flash=0 (3 % 6 >= 2); Fighter flashTicks=4 (even) -> flash=0
    const combatSnapTick3 = {
      ...combatSnapTick1,
      tick: 3,
      enemies: combatSnapTick1.enemies.map((e) =>
        e.id === 2 ? { ...e, flashTicks: 4 } : e,
      ),
    };
    instanceBatches.length = 0;
    renderer.render(combatSnapTick3, combatSnapTick3, 0, null, 0.5);
    const instTick3 = unpackInstances();
    expect(instTick3.find((i) => i.subX === 40)?.flash).toBe(0);
    expect(instTick3.find((i) => i.x === 80 && i.y === -150)?.flash).toBe(0);

    // 4. Fallback rects when submarine and laser_charge sprites are missing
    delete vault.data.atlases.sprites.sprites['submarine'];
    delete vault.data.atlases.sprites.sprites['laser_charge'];
    solidBuffers.length = 0;
    const fallbackSnap = {
      ...combatSnapTick1,
      launchSubY: 0,
    };
    renderer.render(fallbackSnap, fallbackSnap, 0, null, 0.6);
    const hasSubHullAndTower = solidBuffers.some((buf) => {
      let sawHull = false;
      let sawTower = false;
      let sawCharge = false;
      for (let i = 0; i <= buf.length - 36; i += 36) {
        const xs = [buf[i]!, buf[i + 6]!, buf[i + 12]!, buf[i + 24]!];
        const ys = [buf[i + 1]!, buf[i + 7]!, buf[i + 13]!, buf[i + 25]!];
        const w = Math.max(...xs) - Math.min(...xs);
        const h = Math.max(...ys) - Math.min(...ys);
        if (Math.abs(w - 160) < 0.5 && Math.abs(h - 22) < 0.5) sawHull = true;
        if (Math.abs(w - 36) < 0.5 && Math.abs(h - 14) < 0.5) sawTower = true;
        if (w > 11 && w < 18 && h > 11 && h < 18) sawCharge = true;
      }
      return sawHull && sawTower && sawCharge;
    });
    expect(hasSubHullAndTower).toBe(true);

    // 5. Dogfight/Co-op P1 HP & P2 dark backing pills + elevated P1/P2 18x10 tag backing rects
    const p2 = {
      ...makeSnapshot().player,
      x: 180,
      y: -150,
      prevX: 180,
      prevY: -150,
      health: 75,
      maxHealth: 100,
      playerIndex: 2 as const,
    };
    const dogfightSnap = makeSnapshot({
      phase: 'playing',
      player: {
        ...makeSnapshot().player,
        x: 120,
        y: -160,
        prevX: 120,
        prevY: -160,
        health: 80,
        maxHealth: 100,
      },
      player2: p2,
      activeMods: {
        moddedEnabled: true,
        arsenalBosses: false,
        replayGhost: false,
        dailySeed: false,
        shaderFx: {
          crtScanlines: false,
          phosphorBloom: false,
          speedWarp: false,
          shockwaves: false,
        },
        multiplayerMode: 'dogfight1v1',
        p2BotEnabled: false,
      },
      dogfight: {
        p1Wins: 1,
        p2Wins: 0,
        round: 2,
        bestOf: 5,
        roundBannerTicks: 0,
        winner: null,
        lastScorer: 1,
      },
    });
    solidBuffers.length = 0;
    renderer.render(dogfightSnap, dogfightSnap, 0, null, 0.7);
    const sawDogfightPillsAndTags = solidBuffers.some((buf) => {
      let sawP1Pill = false;
      let sawP2Pill = false;
      let tagBackCount = 0;
      for (let i = 0; i <= buf.length - 36; i += 36) {
        const xs = [buf[i]!, buf[i + 6]!, buf[i + 12]!, buf[i + 24]!];
        const ys = [buf[i + 1]!, buf[i + 7]!, buf[i + 13]!, buf[i + 25]!];
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const w = Math.max(...xs) - minX;
        const h = Math.max(...ys) - minY;
        if (Math.abs(minX - 8) < 0.5 && Math.abs(minY - 6) < 0.5 && Math.abs(w - 86) < 0.5 && Math.abs(h - 24) < 0.5) {
          sawP1Pill = true;
        }
        if (Math.abs(minX - (600 - 94)) < 0.5 && Math.abs(minY - 6) < 0.5 && Math.abs(w - 86) < 0.5 && Math.abs(h - 24) < 0.5) {
          sawP2Pill = true;
        }
        if (Math.abs(w - 18) < 0.5 && Math.abs(h - 10) < 0.5) {
          tagBackCount++;
        }
      }
      return sawP1Pill && sawP2Pill && tagBackCount === 2;
    });
    expect(sawDogfightPillsAndTags).toBe(true);

    renderer.dispose();
  });

  it('reloadVault hot-swaps textures cleanly with 0 GL errors while preserving FBOs, palette, and shader FX', () => {
    const mockGl = createMockWebGL2Context();
    let texCounter = 0;
    const deletedTextures: unknown[] = [];
    mockGl.gl.createTexture = vi.fn(() => ({ id: ++texCounter }));
    mockGl.gl.deleteTexture = vi.fn((tex: unknown) => {
      deletedTextures.push(tex);
    });

    const mockCanvas = {
      width: 600,
      height: 400,
      style: { imageRendering: '' },
      getContext: vi.fn((kind: string) => (kind === 'webgl2' ? mockGl.gl : null)),
    } as unknown as HTMLCanvasElement;

    const vaultA = createMockVaultBundle();
    vaultA.textures['gfx/textures/diffuse/sheet1grey.png'] = {
      name: 'sheet1grey',
      width: 32,
      height: 32,
      rgba: new Uint8Array(32 * 32 * 4),
      source: 'procedural',
    };

    const renderer = new WebGL2Renderer();
    renderer.init(mockCanvas, vaultA);
    renderer.setPalette('synthdusk');
    renderer.setShaderFx({
      crtScanlines: true,
      phosphorBloom: false,
      speedWarp: true,
      shockwaves: false,
    });

    const fboCallsBefore = mockGl.gl.createFramebuffer.mock.calls.length;
    const progCallsBefore = mockGl.gl.createProgram.mock.calls.length;
    const snap = makeSnapshot({ phase: 'playing' });
    renderer.render(snap, snap, 0, null, 0.5);

    const vaultB = createMockVaultBundle();
    vaultB.data.vaultSource = 'steam-local';
    vaultB.textures = {
      sprites: {
        name: 'sprites',
        width: 128,
        height: 128,
        rgba: new Uint8Array(128 * 128 * 4),
        source: 'steam-tga',
      },
      menusprites: {
        name: 'menusprites',
        width: 64,
        height: 64,
        rgba: new Uint8Array(64 * 64 * 4),
        source: 'steam-tga',
      },
      fnts_0: {
        name: 'fnts_0',
        width: 64,
        height: 64,
        rgba: new Uint8Array(64 * 64 * 4),
        source: 'steam-tga',
      },
    };

    deletedTextures.length = 0;
    const texUploadsBefore = mockGl.gl.texImage2D.mock.calls.length;
    renderer.reloadVault(vaultB);

    // Deleted exactly the 2 unique vaultA textures (deduplicated across alias keys)
    expect(deletedTextures).toHaveLength(2);
    expect(new Set(deletedTextures).size).toBe(2);
    // Uploaded exactly the 3 new vaultB textures (preserved fallbackTexture & builtinFontTexture)
    expect(mockGl.gl.texImage2D.mock.calls.length - texUploadsBefore).toBe(3);
    // Preserved active FBOs, compiled shader programs, and active palette
    expect(mockGl.gl.createFramebuffer.mock.calls.length).toBe(fboCallsBefore);
    expect(mockGl.gl.createProgram.mock.calls.length).toBe(progCallsBefore);
    expect(renderer.getPalette().id).toBe('synthdusk');

    renderer.render(snap, snap, 0.25, null, 0.75);
    expect(renderer.getFrameMetrics().webglErrors).toBe(0);
    expect(renderer.getFrameMetrics().activePaletteId).toBe('synthdusk');

    renderer.dispose();

    // 2D fallback mode also handles reloadVault cleanly without throwing
    const mock2d = {
      imageSmoothingEnabled: true,
      fillStyle: '',
      strokeStyle: '',
      font: '',
      fillRect: vi.fn(),
      fillText: vi.fn(),
      strokeRect: vi.fn(),
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
    const canvas2d = {
      width: 600,
      height: 400,
      style: { imageRendering: '' },
      getContext: vi.fn((kind: string) => (kind === '2d' ? mock2d : null)),
    } as unknown as HTMLCanvasElement;
    const fallbackRenderer = new WebGL2Renderer();
    fallbackRenderer.init(canvas2d, vaultA);
    fallbackRenderer.reloadVault(vaultB);
    fallbackRenderer.render(snap, snap, 0, null, 1.0);
    expect(fallbackRenderer.getFrameMetrics().webglErrors).toBe(0);
    fallbackRenderer.dispose();
  });

  it('fits all 7 Hangar rows + description bar cleanly inside 600x400 with KRUNKED SKYBREAKER chrome and ASSETS toggle states', () => {
    // 1. Static geometry invariants for 7 Hangar rows inside 600x400 projector canvas
    expect(HANGAR_LAYOUT.rowCount).toBe(HANGAR_ROWS.length);
    expect(HANGAR_LAYOUT.rowCount).toBe(7);
    expect(HANGAR_LAYOUT.rowStartY).toBeGreaterThanOrEqual(64);
    expect(HANGAR_LAYOUT.rowStep).toBeGreaterThan(HANGAR_LAYOUT.rowHeight);

    const lastRowBottom =
      HANGAR_LAYOUT.rowStartY +
      (HANGAR_LAYOUT.rowCount - 1) * HANGAR_LAYOUT.rowStep +
      HANGAR_LAYOUT.rowHeight;
    expect(lastRowBottom).toBeLessThan(HANGAR_LAYOUT.descrY);
    expect(HANGAR_LAYOUT.descrY + HANGAR_LAYOUT.descrHeight).toBeLessThan(
      HANGAR_LAYOUT.dividerY,
    );
    expect(HANGAR_LAYOUT.footerY + 10).toBeLessThan(
      HANGAR_LAYOUT.projectorY + HANGAR_LAYOUT.projectorHeight,
    );
    expect(HANGAR_LAYOUT.projectorY + HANGAR_LAYOUT.projectorHeight).toBeLessThanOrEqual(
      400,
    );
    expect(HANGAR_LAYOUT.projectorX + HANGAR_LAYOUT.projectorWidth).toBeLessThanOrEqual(
      600,
    );

    // 2. Render Hangar on 'assets' row in all 3 availability/mode states & verify chrome + zero overlap
    const mockGl = createMockWebGL2Context();
    const createdPrograms: Array<{ id: number }> = [];
    let currentProgram: unknown = null;
    const fontTextLens: number[] = [];
    const solidQuads: Array<{ minX: number; maxX: number; minY: number; maxY: number }> = [];

    mockGl.gl.createProgram = vi.fn(() => {
      const p = { id: createdPrograms.length + 1 };
      createdPrograms.push(p);
      return p;
    });
    mockGl.gl.useProgram = vi.fn((p: unknown) => {
      currentProgram = p;
    });
    mockGl.gl.bufferData = vi.fn((_target: number, data: ArrayBufferView | number) => {
      if (!(data instanceof Float32Array) || data.length === 0) return;
      if (currentProgram === createdPrograms[3]) {
        fontTextLens.push(data.length / 24);
      } else if (currentProgram === createdPrograms[6]) {
        for (let i = 0; i <= data.length - 36; i += 36) {
          const xs = [data[i]!, data[i + 6]!, data[i + 12]!, data[i + 24]!];
          const ys = [data[i + 1]!, data[i + 7]!, data[i + 13]!, data[i + 25]!];
          solidQuads.push({
            minX: Math.min(...xs),
            maxX: Math.max(...xs),
            minY: Math.min(...ys),
            maxY: Math.max(...ys),
          });
        }
      }
    });

    const mockCanvas = {
      width: 600,
      height: 400,
      style: { imageRendering: '' },
      getContext: vi.fn((kind: string) => (kind === 'webgl2' ? mockGl.gl : null)),
    } as unknown as HTMLCanvasElement;

    const renderer = new WebGL2Renderer();
    renderer.init(mockCanvas, createMockVaultBundle());
    const controller = new HangarController();
    controller.setActiveRow('assets');
    const hangarSnap = makeSnapshot({ phase: 'hangar' });

    // State A: Steam unavailable -> SKYBREAKER [STEAM N/A]
    fontTextLens.length = 0;
    solidQuads.length = 0;
    renderer.render(hangarSnap, hangarSnap, 0, controller.buildUiState(hangarSnap), 0.5);
    expect(fontTextLens).toContain('KRUNKED SKYBREAKER  //  HANGAR MK-I'.length);
    expect(fontTextLens).toContain('< SKYBREAKER [STEAM N/A] >'.length);
    expect(fontTextLens).toContain('ORIGINAL SKYBREAKER ART & SYNTH'.length);
    expect(fontTextLens).toContain('OR LOCAL STEAM VAULT (IF OWNED)'.length);

    // Verify rendered left-column row + description boxes fit cleanly inside projector bounds
    const leftBoxes = solidQuads.filter(
      (q) =>
        Math.abs(q.minX - HANGAR_LAYOUT.rowX) < 0.5 &&
        Math.abs(q.maxX - (HANGAR_LAYOUT.rowX + HANGAR_LAYOUT.rowWidth)) < 0.5 &&
        q.minY >= HANGAR_LAYOUT.rowStartY - 0.5 &&
        q.maxY <= HANGAR_LAYOUT.dividerY,
    );
    expect(leftBoxes.length).toBeGreaterThanOrEqual(2);
    for (const box of leftBoxes) {
      expect(box.minY).toBeGreaterThanOrEqual(HANGAR_LAYOUT.projectorY);
      expect(box.maxY).toBeLessThan(HANGAR_LAYOUT.dividerY);
    }

    // State B: Steam available + skybreaker -> SKYBREAKER
    controller.setSteamAvailable(true);
    fontTextLens.length = 0;
    renderer.render(hangarSnap, hangarSnap, 0, controller.buildUiState(hangarSnap), 0.6);
    expect(fontTextLens).toContain('< SKYBREAKER >'.length);

    // State C: Steam available + steam-local -> STEAM LOCAL
    controller.cycleCurrent(1, hangarSnap);
    fontTextLens.length = 0;
    renderer.render(
      hangarSnap,
      hangarSnap,
      0,
      controller.buildUiState(hangarSnap, 'steam-local'),
      0.7,
    );
    expect(fontTextLens).toContain('< STEAM LOCAL >'.length);
    expect(renderer.getFrameMetrics().webglErrors).toBe(0);

    renderer.dispose();
  });

  it('scales and centers the 416x300 APEX OMEGA [5,5,5] Hangar preview strictly inside the preview stage box [318..558] x [68..164]', () => {
    const mockGl = createMockWebGL2Context();
    const instanceBatches: Float32Array[] = [];
    mockGl.gl.bufferSubData = vi.fn(
      (_target: number, _offset: number, data: ArrayBufferView) => {
        if (data instanceof Float32Array) {
          instanceBatches.push(new Float32Array(data));
        }
      },
    );

    const mockCanvas = {
      width: 600,
      height: 400,
      style: { imageRendering: '' },
      getContext: vi.fn((kind: string) => (kind === 'webgl2' ? mockGl.gl : null)),
    } as unknown as HTMLCanvasElement;

    const vault = createMockVaultBundle();
    vault.data.atlases.sprites.sprites['apex_omega'] = {
      name: 'apex_omega',
      size: [416, 300],
      hull: [50, 50, 366, 250],
      center: [208, 88],
      subs: [{ x: 123, y: 0 }],
    };

    const renderer = new WebGL2Renderer();
    renderer.init(mockCanvas, vault);
    const controller = new HangarController();
    const apexSnap = makeSnapshot({
      phase: 'hangar',
      player: {
        ...makeSnapshot().player,
        loadout: { weapon: 5, body: 5, engine: 5 },
        planeName: 'APEX OMEGA',
      },
    });
    const hangarUi = controller.buildUiState(apexSnap);

    for (const elapsedSec of [0, 0.7, 1.4, 2.3, 3.8]) {
      instanceBatches.length = 0;
      renderer.render(apexSnap, apexSnap, 0, hangarUi, elapsedSec);

      let apexInst: {
        x: number;
        y: number;
        angle: number;
        w: number;
        h: number;
        cx: number;
        cy: number;
        sx: number;
        sy: number;
      } | null = null;
      for (const batch of instanceBatches) {
        for (let i = 0; i < batch.length; i += 13) {
          if (batch[i + 3] === 123 && batch[i + 5] === 416 && batch[i + 6] === 300) {
            apexInst = {
              x: batch[i]!,
              y: batch[i + 1]!,
              angle: batch[i + 2]!,
              w: batch[i + 5]!,
              h: batch[i + 6]!,
              cx: batch[i + 7]!,
              cy: batch[i + 8]!,
              sx: batch[i + 9]!,
              sy: batch[i + 10]!,
            };
          }
        }
      }

      expect(apexInst).not.toBeNull();
      expect(apexInst!.sx).toBeLessThanOrEqual(0.3);
      expect(apexInst!.sy).toBeLessThanOrEqual(0.3);

      // Verify all 4 transformed quad corners stay strictly inside preview stage [318..558] x [68..164]
      const c = Math.cos(apexInst!.angle);
      const s = Math.sin(apexInst!.angle);
      for (const [u, v] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        const lx = (u * apexInst!.w - apexInst!.cx) * apexInst!.sx;
        const ly = (v * apexInst!.h - apexInst!.cy) * apexInst!.sy;
        const px = Math.floor(lx * c - ly * s + apexInst!.x + 0.5);
        const py = Math.floor(lx * s + ly * c + apexInst!.y + 0.5);
        expect(px).toBeGreaterThanOrEqual(318);
        expect(px).toBeLessThanOrEqual(558);
        expect(py).toBeGreaterThanOrEqual(68);
        expect(py).toBeLessThanOrEqual(164);
      }
    }

    expect(renderer.getFrameMetrics().webglErrors).toBe(0);
    renderer.dispose();
  });

  it('cycles all 6 core weapons/bodies/engines, all 12 core palettes, and OVERDRIVE when allUnlocked is enabled while preserving default progression locks', () => {
    // 1. Default HangarController keeps allUnlocked = false so progression lock tests stay strict
    const lockedController = new HangarController();
    expect(lockedController.isAllUnlocked()).toBe(false);

    const freshLockedSnap = makeSnapshot({
      phase: 'hangar',
      profile: {
        ...makeSnapshot().profile,
        unlockedWeapons: [0],
        unlockedBodies: [0],
        unlockedEngines: [0],
        completedMissions: [],
        sfmtUnlocked: false,
      },
      player: {
        ...makeSnapshot().player,
        loadout: { weapon: 0, body: 0, engine: 0 },
      },
    });
    expect(lockedController.cycleCurrent(1, freshLockedSnap).locked).toBe(true);
    expect(lockedController.selectPaletteByIndex(3, freshLockedSnap).locked).toBe(true);
    expect(lockedController.selectMode('sfmt', freshLockedSnap).locked).toBe(true);

    // 2. Enabling allUnlocked unlocks all 6 vanilla parts, all 12 vanilla palettes & OVERDRIVE
    //    while keeping completedMissionsCount strictly at real progress (0/90)
    const freePlay = new HangarController();
    freePlay.setAllUnlocked(true);
    expect(freePlay.isAllUnlocked()).toBe(true);

    const currentLoadout: Loadout = { weapon: 0, body: 0, engine: 0 };
    let currentMode: 'normal' | 'sfmt' = 'normal';
    const simStub = {
      setLoadout: (l: Loadout) => {
        currentLoadout.weapon = l.weapon;
        currentLoadout.body = l.body;
        currentLoadout.engine = l.engine;
      },
      setMode: (m: 'normal' | 'sfmt') => {
        currentMode = m;
      },
    };
    const makeCurrentSnap = (): SimSnapshot => ({
      ...freshLockedSnap,
      mode: currentMode,
      player: {
        ...freshLockedSnap.player,
        loadout: { ...currentLoadout },
      },
    });

    for (const slot of ['weapon', 'body', 'engine'] as const) {
      freePlay.setActiveRow(slot);
      const visited: number[] = [];
      for (let i = 0; i < 6; i++) {
        const res = freePlay.cycleCurrent(1, makeCurrentSnap(), simStub);
        expect(res.changed).toBe(true);
        expect(res.locked).toBe(false);
        expect(res.cue).toBe('sndswap');
        visited.push(res.loadout![slot]);
      }
      expect(visited).toEqual([1, 2, 3, 4, 5, 0]);
      // Direct selectPart also succeeds for slot 5 (APEX OMEGA component)
      const pick5 = freePlay.selectPart(slot, 5, makeCurrentSnap(), simStub);
      expect(pick5.changed).toBe(true);
      expect(pick5.locked).toBe(false);
      expect(currentLoadout[slot]).toBe(5);
    }

    // Cycle all 12 core palettes in Vanilla mode
    freePlay.setActiveRow('palette');
    const visitedPalIds: string[] = [freePlay.getSelectedPalette().id];
    for (let i = 0; i < PALETTES.length - 1; i++) {
      const res = freePlay.cycleCurrent(1, makeCurrentSnap(), simStub);
      expect(res.changed).toBe(true);
      expect(res.locked).toBe(false);
      expect(res.cue).toBe('sndswap');
      visitedPalIds.push(res.paletteId!);
    }
    expect(visitedPalIds).toEqual(PALETTES.map((p) => p.id));
    expect(visitedPalIds).toHaveLength(12);

    // Direct selectPaletteByIndex works for every core palette (including index 11 FALLOUT)
    for (let i = 0; i < PALETTES.length; i++) {
      const pick = freePlay.selectPaletteByIndex(i, makeCurrentSnap());
      expect(pick.locked).toBe(false);
      expect(pick.paletteId).toBe(PALETTES[i]!.id);
    }

    // Toggle NORMAL <-> OVERDRIVE (sfmt) cleanly with 0 completed missions
    freePlay.setActiveRow('mode');
    const toOverdrive = freePlay.cycleCurrent(1, makeCurrentSnap(), simStub);
    expect(toOverdrive.changed).toBe(true);
    expect(toOverdrive.locked).toBe(false);
    expect(toOverdrive.mode).toBe('sfmt');
    expect(toOverdrive.cue).toBe('sndsfmt');
    expect(currentMode).toBe('sfmt');

    const uiState = freePlay.buildUiState(makeCurrentSnap());
    expect(uiState.allUnlocked).toBe(true);
    expect(uiState.sfmtUnlocked).toBe(true);
    expect(uiState.completedMissionsCount).toBe(0);
    expect(uiState.unlockedWeapons).toEqual([0, 1, 2, 3, 4, 5]);
    expect(uiState.unlockedBodies).toEqual([0, 1, 2, 3, 4, 5]);
    expect(uiState.unlockedEngines).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('renders crisp Hangar slot counters (1/6, 1/12) with zero horizontal overlap and suppresses false [LOCKED] footer in Free-Play mode', () => {
    const mockGl = createMockWebGL2Context();
    const createdPrograms: Array<{ id: number }> = [];
    let currentProgram: unknown = null;
    const fontDraws: Array<{ charCount: number; minX: number; maxX: number; minY: number; maxY: number }> = [];

    mockGl.gl.createProgram = vi.fn(() => {
      const p = { id: createdPrograms.length + 1 };
      createdPrograms.push(p);
      return p;
    });
    mockGl.gl.useProgram = vi.fn((p: unknown) => {
      currentProgram = p;
    });
    mockGl.gl.bufferData = vi.fn((_target: number, data: ArrayBufferView | number) => {
      if (!(data instanceof Float32Array) || data.length === 0) return;
      if (currentProgram === createdPrograms[3]) {
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < data.length; i += 4) {
          const x = data[i]!;
          const y = data[i + 1]!;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        fontDraws.push({
          charCount: data.length / 24,
          minX,
          maxX,
          minY,
          maxY,
        });
      }
    });

    const mockCanvas = {
      width: 600,
      height: 400,
      style: { imageRendering: '' },
      getContext: vi.fn((kind: string) => (kind === 'webgl2' ? mockGl.gl : null)),
    } as unknown as HTMLCanvasElement;

    const renderer = new WebGL2Renderer();
    renderer.init(mockCanvas, createMockVaultBundle());

    const controller = new HangarController({ allUnlocked: true });
    const hangarSnap = makeSnapshot({
      phase: 'hangar',
      profile: {
        ...makeSnapshot().profile,
        completedMissions: [],
        sfmtUnlocked: false,
      },
      player: {
        ...makeSnapshot().player,
        loadout: { weapon: 2, body: 3, engine: 4 },
      },
    });
    // Select mission-gated FALLOUT palette (index 11) on a 0/90 profile in Free-Play
    const palPick = controller.selectPaletteByIndex(11, hangarSnap);
    expect(palPick.locked).toBe(false);
    renderer.setPalette(palPick.paletteId!);
    controller.setActiveRow('palette');

    fontDraws.length = 0;
    const ui = controller.buildUiState(hangarSnap);
    renderer.render(hangarSnap, hangarSnap, 0, ui, 0.5);

    const charCounts = fontDraws.map((d) => d.charCount);
    expect(charCounts).toContain('  WEAPON 3/6'.length);
    expect(charCounts).toContain('  BODY 4/6'.length);
    expect(charCounts).toContain('  ENGINE 5/6'.length);
    expect(charCounts).toContain('> PALETTE 12/12'.length);
    expect(charCounts).toContain('< FALLOUT >'.length);
    // Footer must NOT append ' [LOCKED]' when allUnlocked is true
    expect(charCounts).toContain('HI: 1200  MISSIONS: 0/90'.length);
    expect(charCounts).not.toContain('HI: 1200  MISSIONS: 0/90 [LOCKED]'.length);

    // Verify palette row label ('> PALETTE 12/12') and value ('< FALLOUT >') fit inside [42..302] without overlapping
    const palRowY = HANGAR_LAYOUT.rowStartY + 3 * HANGAR_LAYOUT.rowStep;
    const palRowDraws = fontDraws.filter(
      (d) =>
        d.minX >= HANGAR_LAYOUT.rowX &&
        d.maxX <= HANGAR_LAYOUT.rowX + HANGAR_LAYOUT.rowWidth &&
        d.minY >= palRowY &&
        d.maxY <= palRowY + HANGAR_LAYOUT.rowHeight,
    );
    expect(palRowDraws).toHaveLength(2);
    const [palLabel, palVal] = palRowDraws[0]!.minX < palRowDraws[1]!.minX
      ? [palRowDraws[0]!, palRowDraws[1]!]
      : [palRowDraws[1]!, palRowDraws[0]!];
    expect(palLabel.minX).toBeGreaterThanOrEqual(HANGAR_LAYOUT.rowX);
    expect(palVal.maxX).toBeLessThanOrEqual(HANGAR_LAYOUT.rowX + HANGAR_LAYOUT.rowWidth);
    expect(palLabel.maxX).toBeLessThan(palVal.minX);

    expect(renderer.getFrameMetrics().webglErrors).toBe(0);
    renderer.dispose();
  });

  it('migrates legacy krunked_luftrausers_* saves cleanly and enforces browser Free-Play default vs Campaign Locks mode', () => {
    const store = new Map<string, string>();
    const mockStorage: StorageLike = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    };

    // 1. Brand-new browser session (empty localStorage) boots into Free-Play (all core parts + SFMT unlocked, 0/90 missions)
    expect(loadProgressionLockMode(mockStorage)).toBe(false);
    const freshBrowserProfile = loadStoredProfile(mockStorage);
    expect(freshBrowserProfile.unlockedWeapons).toEqual([0, 1, 2, 3, 4, 5]);
    expect(freshBrowserProfile.unlockedBodies).toEqual([0, 1, 2, 3, 4, 5]);
    expect(freshBrowserProfile.unlockedEngines).toEqual([0, 1, 2, 3, 4, 5]);
    expect(freshBrowserProfile.sfmtUnlocked).toBe(true);
    expect(freshBrowserProfile.completedMissions).toEqual([]);

    // 2. Legacy krunked_luftrausers_* saves migrate seamlessly when krunked_skybreaker_* keys are absent
    store.clear();
    store.set(
      LEGACY_PROFILE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        unlockedWeapons: [0, 1],
        unlockedBodies: [0],
        unlockedEngines: [0],
        completedMissions: [1, 2],
        activeMissionIds: [3, 4, 5],
        highScoreNormal: 42500,
        highScoreSfmt: 88100,
        selectedPaletteId: 'kozilek',
        sfmtUnlocked: false,
        lastLoadout: { weapon: 1, body: 0, engine: 0 },
        lastMode: 'normal',
        lastSeed: 99,
        totalKills: { Fighter: 25 },
        stats: { sorties: 7, totalScore: 95000, bestCombo: 14 },
        dailyHighScores: { '20261125': 12000 },
      }),
    );
    store.set(
      LEGACY_ACT2_MODS_STORAGE_KEY,
      JSON.stringify({
        moddedEnabled: true,
        arsenalBosses: true,
        replayGhost: true,
        dailySeed: false,
        shaderFx: {
          crtScanlines: true,
          phosphorBloom: false,
          speedWarp: false,
          shockwaves: true,
        },
        multiplayerMode: 'coop2p',
        p2BotEnabled: true,
      }),
    );
    store.set(
      LEGACY_ACT2_CUSTOM_PALETTE_KEY,
      JSON.stringify({
        id: 'custom_studio',
        name: 'LEGACY NEON',
        unlockMissionsRequired: 0,
        backcol: [0.1, 0.1, 0.2, 1],
        colors: [
          [0, 0, 0, 0],
          [1, 0.2, 0.4, 1],
          [0.2, 1, 0.5, 1],
          [0.2, 0.3, 0.4, 1],
          [0.3, 0.4, 0.5, 1],
          [1, 0.9, 0.2, 1],
          [0.6, 0.7, 0.8, 1],
          [1, 1, 1, 1],
        ],
      }),
    );
    store.set(
      LEGACY_ACT2_PB_GHOST_KEY,
      JSON.stringify({
        version: 1,
        seed: 777,
        mode: 'normal',
        profileId: 'vanilla-1to1',
        loadout: { weapon: 1, body: 0, engine: 0 },
        finalScore: 15500,
        finalTicks: 120,
        frames: [{ tick: 0, mask: 4 }],
      }),
    );

    // Palette alias normalization
    expect(normalizeStoredPaletteId('lanigiro')).toBe('inverted');
    expect(normalizeStoredPaletteId('kozilek')).toBe('synthdusk');
    expect(normalizeStoredPaletteId('sfmt')).toBe('overdrive');
    expect(normalizeStoredPaletteId('oceanic')).toBe('oceanic');

    const migratedProfile = loadStoredProfile(mockStorage);
    expect(migratedProfile.highScoreNormal).toBe(42500);
    expect(migratedProfile.highScoreSfmt).toBe(88100);
    expect(migratedProfile.completedMissions).toEqual([1, 2]);
    expect(migratedProfile.selectedPaletteId).toBe('synthdusk');
    expect(migratedProfile.stats.sorties).toBe(7);
    expect(migratedProfile.dailyHighScores?.['20261125']).toBe(12000);
    // Migrated forward into new primary key
    expect(store.get(PROFILE_STORAGE_KEY)).not.toBeUndefined();
    // Free-play default unlocks core roster while keeping real missions
    expect(migratedProfile.unlockedWeapons).toEqual([0, 1, 2, 3, 4, 5]);
    expect(migratedProfile.sfmtUnlocked).toBe(true);

    const migratedMods = loadStoredModFlags(mockStorage);
    expect(migratedMods.moddedEnabled).toBe(true);
    expect(migratedMods.arsenalBosses).toBe(true);
    expect(migratedMods.multiplayerMode).toBe('coop2p');
    expect(store.get(ACT2_MODS_STORAGE_KEY)).not.toBeUndefined();

    const migratedCustomPal = loadStoredCustomPalette(mockStorage);
    expect(migratedCustomPal?.name).toBe('LEGACY NEON');
    expect(store.get(ACT2_CUSTOM_PALETTE_KEY)).not.toBeUndefined();

    const migratedGhost = loadStoredPbGhost(mockStorage);
    expect(migratedGhost?.finalScore).toBe(15500);
    expect(store.get(ACT2_PB_GHOST_KEY)).not.toBeUndefined();

    // 3. Opting into Campaign Locks mode preserves earned progression locks only
    saveProgressionLockMode(true, mockStorage);
    expect(store.get(PROGRESSION_LOCK_STORAGE_KEY)).toBe('true');
    expect(loadProgressionLockMode(mockStorage)).toBe(true);

    const lockedReload = loadStoredProfile(mockStorage);
    expect(lockedReload.unlockedWeapons).toEqual([0, 1]);
    expect(lockedReload.unlockedBodies).toEqual([0]);
    expect(lockedReload.sfmtUnlocked).toBe(false);

    // computeCampaignUnlockedProfile derives earned unlocks strictly from completedMissions & Blimp kills
    const earned = computeCampaignUnlockedProfile(
      {
        ...migratedProfile,
        lastLoadout: { weapon: 5, body: 4, engine: 3 },
        lastMode: 'sfmt',
        completedMissions: [1],
        totalKills: {},
      },
      [
        {
          id: 1,
          component: [0, 0, 0],
          objective: 0,
          condition: 0,
          val: [5, 1],
          title: 'W1',
          description: 'D1',
        },
      ],
      false,
    );
    expect(earned.unlockedWeapons).toEqual([0, 1]);
    expect(earned.unlockedBodies).toEqual([0]);
    expect(earned.unlockedEngines).toEqual([0]);
    expect(earned.sfmtUnlocked).toBe(false);
    expect(earned.lastLoadout).toEqual({ weapon: 0, body: 0, engine: 0 });
    expect(earned.lastMode).toBe('normal');
  });

  it('enforces world parity: unclipped ocean_line, 3-layer space_clouds + blank cap, depth sorting (smoke behind player), animated underwater prop & gun recoil, forward nuke, SFMT backcol, and HangarHudPass seam', () => {
    const pal = getPaletteById('original');

    // 1. SFMT / OVERDRIVE switches uniform_backcol to colors[3] and high-HP health circle hides when settled vs flashes on hit
    const basePlay = makeSnapshot({ phase: 'playing', mode: 'sfmt' });
    const uSfmt = computePostShaderUniforms(basePlay, 0, -100, 1.0, pal, 600, 400);
    expect(uSfmt.uniform_backcol).toEqual(pal.colors[3]);

    const highHpSettled = makeSnapshot({
      phase: 'playing',
      player: { ...makeSnapshot().player, health: 90, maxHealth: 100, flashTicks: 0 },
    });
    const uHighSettled = computePostShaderUniforms(highHpSettled, 0, -100, 1.0, pal, 600, 400);
    expect(uHighSettled.healthRadius[0]).toBe(100); // hidden >60% when settled

    const highHpHit = makeSnapshot({
      phase: 'playing',
      player: { ...makeSnapshot().player, health: 90, maxHealth: 100, flashTicks: 4 },
    });
    const uHighHit = computePostShaderUniforms(highHpHit, 0, -100, 1.0, pal, 600, 400);
    expect(uHighHit.healthRadius[0]).toBe(90);
    expect(uHighHit.healthRadius[3]).toBe(2); // bright white colors[7] hit flash

    // 2. Render full world scene and inspect draw calls, clipSea flags, depth sorting, animations, and reflections
    const mockGl = createMockWebGL2Context();
    const batches: Array<{
      program: unknown;
      clipSea: number;
      instances: Array<{
        x: number;
        y: number;
        subX: number;
        subY: number;
        w: number;
        h: number;
        cx: number;
        cy: number;
        scaleX: number;
        scaleY: number;
        depth: number;
      }>;
    }> = [];
    const createdPrograms: Array<{ id: number }> = [];
    let currentProgram: unknown = null;
    let currentClipSea = -1;
    let lastUniformName = '';
    const locMap = new WeakMap<object, string>();

    mockGl.gl.createProgram = vi.fn(() => {
      const p = { id: createdPrograms.length + 1 };
      createdPrograms.push(p);
      return p;
    });
    mockGl.gl.useProgram = vi.fn((p: unknown) => {
      currentProgram = p;
    });
    mockGl.gl.getUniformLocation = vi.fn((_prog?: unknown, name = '') => {
      const loc = { name };
      locMap.set(loc, name);
      lastUniformName = name;
      return loc;
    });
    mockGl.gl.uniform1f = vi.fn((loc?: unknown, v = 0) => {
      const name = loc && typeof loc === 'object' ? locMap.get(loc) : lastUniformName;
      if (name === 'uClipSea') currentClipSea = v;
    });
    mockGl.gl.bufferSubData = vi.fn(
      (_target: number, _offset: number, data: ArrayBufferView) => {
        if (!(data instanceof Float32Array)) return;
        const insts = [];
        for (let i = 0; i < data.length; i += 13) {
          insts.push({
            x: data[i]!,
            y: data[i + 1]!,
            subX: data[i + 3]!,
            subY: data[i + 4]!,
            w: data[i + 5]!,
            h: data[i + 6]!,
            cx: data[i + 7]!,
            cy: data[i + 8]!,
            scaleX: data[i + 9]!,
            scaleY: data[i + 10]!,
            depth: data[i + 11]!,
          });
        }
        batches.push({ program: currentProgram, clipSea: currentClipSea, instances: insts });
      },
    );

    const mockCanvas = {
      width: 600,
      height: 400,
      style: { imageRendering: '' },
      getContext: vi.fn((kind: string) => (kind === 'webgl2' ? mockGl.gl : null)),
    } as unknown as HTMLCanvasElement;

    const vault = createMockVaultBundle();
    vault.data.atlases.sprites.sprites = {
      ...vault.data.atlases.sprites.sprites,
      space_clouds: {
        name: 'space_clouds',
        size: [600, 100],
        hull: [0, 0, 600, 100],
        center: [0, 60],
        subs: [
          { x: 10, y: 1 }, // f0 white
          { x: 20, y: 1 }, // f1 crimson/SFMT
          { x: 30, y: 1 }, // f2 pale haze
        ],
      },
      space_clouds_blank: {
        name: 'space_clouds_blank',
        size: [600, 2],
        hull: [0, 0, 600, 2],
        center: [0, 2],
        subs: [{ x: 40, y: 1 }],
      },
      ocean_line: {
        name: 'ocean_line',
        size: [600, 2],
        hull: [0, 0, 600, 2],
        center: [300, 1],
        subs: [{ x: 50, y: 1 }],
      },
      engine_underwater: {
        name: 'engine_underwater',
        size: [24, 24],
        hull: [0, 0, 24, 24],
        center: [12, 12],
        subs: [
          { x: 60, y: 1 },
          { x: 61, y: 1 },
          { x: 62, y: 1 },
          { x: 63, y: 1 },
          { x: 64, y: 1 },
          { x: 65, y: 1 },
        ],
      },
      small_boat: { name: 'small_boat', size: [60, 17], hull: [0, 0, 60, 17], center: [29, 17], subs: [{ x: 70, y: 1 }] },
      small_boat_gun: {
        name: 'small_boat_gun',
        size: [16, 3],
        hull: [0, 0, 16, 3],
        center: [0, 1],
        subs: [
          { x: 80, y: 1 },
          { x: 81, y: 1 },
          { x: 82, y: 1 },
          { x: 83, y: 1 },
          { x: 84, y: 1 },
          { x: 85, y: 1 },
        ],
      },
      blimp: { name: 'blimp', size: [550, 219], hull: [0, 0, 550, 219], center: [275, 109], subs: [{ x: 90, y: 1 }] },
      blimp_anim: { name: 'blimp_anim', size: [9, 49], hull: [0, 0, 9, 49], center: [-230, 33], subs: [{ x: 91, y: 1 }] },
      blimp_die: { name: 'blimp_die', size: [550, 219], hull: [0, 0, 550, 219], center: [275, 109], subs: [{ x: 92, y: 1 }] },
      bg_jet: { name: 'bg_jet', size: [6, 5], hull: [0, 0, 6, 5], center: [3, 1], subs: [{ x: 95, y: 1 }] },
      bg_jet_trail: { name: 'bg_jet_trail', size: [200, 2], hull: [0, 0, 200, 0], center: [200, 0], subs: [{ x: 96, y: 1 }] },
      fx_smoke: { name: 'fx_smoke', size: [20, 20], hull: [0, 0, 20, 20], center: [10, 10], subs: [{ x: 100, y: 1 }] },
      fx_explodebig: { name: 'fx_explodebig', size: [96, 96], hull: [0, 0, 96, 96], center: [48, 48], subs: [{ x: 105, y: 1 }] },
      fx_fire_flash: { name: 'fx_fire_flash', size: [30, 16], hull: [0, 0, 30, 16], center: [-8, 8], subs: [{ x: 110, y: 1 }] },
      fx_subsplash: { name: 'fx_subsplash', size: [30, 8], hull: [0, 0, 30, 8], center: [15, 8], subs: [{ x: 115, y: 1 }] },
      submarine: { name: 'submarine', size: [198, 36], hull: [0, 0, 198, 36], center: [99, 36], subs: [{ x: 75, y: 1 }] },
      projectile_bullet: { name: 'projectile_bullet', size: [28, 28], hull: [0, 0, 28, 28], center: [14, 14], subs: [{ x: 120, y: 1 }, { x: 121, y: 1 }] },
      projectile_ebullet: { name: 'projectile_ebullet', size: [28, 28], hull: [0, 0, 28, 28], center: [14, 14], subs: [{ x: 125, y: 1 }, { x: 126, y: 1 }] },
    };
    vault.data.atlases.nukesprites.sprites['nuke'] = {
      name: 'nuke',
      size: [314, 356],
      hull: [0, 0, 314, 356],
      center: [0, 0], // matches normalizer default when nukesprites.json omits center
      subs: Array.from({ length: 16 }, (_, idx) => ({ x: 200 + idx, y: 2 })),
    };
    vault.textures['nukesprites'] = {
      name: 'nukesprites',
      width: 2048,
      height: 1024,
      rgba: new Uint8Array(16 * 16 * 4),
      source: 'procedural',
    };

    const renderer = new WebGL2Renderer();
    renderer.init(mockCanvas, vault);
    // Program indices 0..7 preserved; menuBatchProg compiled at index 8
    expect(createdPrograms).toHaveLength(9);

    // 2a. Space ceiling in Normal mode uses f2 (subX=30) + space_clouds_blank (subX=40) + f0 (subX=10), NEVER f1 (subX=20)
    const spaceSnap = makeSnapshot({
      phase: 'playing',
      mode: 'normal',
      tick: 12,
      player: { ...makeSnapshot().player, x: 0, y: -1290, prevX: 0, prevY: -1290, vy: -2 },
    });
    batches.length = 0;
    renderer.render(spaceSnap, spaceSnap, 0, null, 0.5);
    const spaceSubs = batches.flatMap((b) => b.instances.map((i) => i.subX));
    expect(spaceSubs).toContain(10);
    expect(spaceSubs).toContain(30);
    expect(spaceSubs).toContain(40);
    expect(spaceSubs).not.toContain(20);

    // 2b. Combat scene: unclipped ocean_line, smoke behind player, explosion in front, underwater propeller & gun recoil, descending Blimp, bg_jet_trail, forward nuke
    const uwEngine = makeEngine(3, 'UNDERWATER');
    uwEngine.sprite = 'engine_underwater';
    const combatSnap = makeSnapshot({
      phase: 'playing',
      tick: 10,
      player: {
        ...makeSnapshot().player,
        x: 0,
        y: -80,
        prevX: 0,
        prevY: -80,
        loadout: { weapon: 0, body: 0, engine: 3 },
        engineSpec: uwEngine,
        boosting: true,
        nukeTriggered: true,
        nukeTicks: 58, // 2 ticks after detonation -> early frame (NOT frame 15!)
        nukeRadius: 160,
      },
      parallax: [
        {
          id: 1,
          kind: 'bgJet',
          spriteName: 'bg_jet',
          x: 50,
          y: -220,
          vx: 2.6,
          reversed: false,
          depth: 10,
          frame: 0,
        },
      ],
      enemies: [
        {
          id: 1,
          kind: 'Boat',
          x: -40,
          y: 0,
          prevX: -40,
          prevY: 0,
          vx: 1,
          vy: 0,
          angleDeg: 0,
          gunAngleDeg: -45,
          health: 25,
          maxHealth: 25,
          active: true,
          state: 'cruise',
          aiTimer: 0,
          fireTimer: 0,
          salvoRemaining: 2,
          salvoCooldown: 2,
          surfaceTimer: 0,
          fallFrames: 0,
          lifetime: 100,
          activationTimer: 0,
          flashTicks: 0,
          hitRadius: 24,
          width: 60,
          height: 17,
          scoreValue: 50,
          difficultyWeight: 40,
          spriteMain: 'small_boat',
          spriteGun: 'small_boat_gun',
          laserActive: false,
          laserLength: 0,
          ...({ gunAnimFrame: 3 } as object),
        },
        {
          id: 2,
          kind: 'Blimp',
          x: 120,
          y: -180,
          prevX: 120,
          prevY: -180,
          vx: -0.5,
          vy: 1,
          angleDeg: 180,
          gunAngleDeg: 90,
          health: 600,
          maxHealth: 600,
          active: true,
          state: 'falling', // live descending from space -> MUST use blimp + blimp_anim, NOT blimp_die!
          aiTimer: 0,
          fireTimer: 0,
          salvoRemaining: 0,
          salvoCooldown: 20,
          surfaceTimer: 0,
          fallFrames: 120,
          lifetime: 0,
          activationTimer: 0,
          flashTicks: 0,
          hitRadius: 105,
          width: 550,
          height: 219,
          scoreValue: 1000,
          difficultyWeight: 1000,
          spriteMain: 'blimp',
          spriteGun: 'small_boat_gun',
          laserActive: false,
          laserLength: 0,
        },
        {
          id: 3,
          kind: 'Submarine',
          x: 160,
          y: 0, // surfaced -> MUST render in foregroundSprites behind fx_subsplash!
          prevX: 160,
          prevY: 0,
          vx: -0.4,
          vy: 0,
          angleDeg: 180,
          gunAngleDeg: -90,
          health: 80,
          maxHealth: 80,
          active: true,
          state: 'cruise',
          aiTimer: 0,
          fireTimer: 0,
          salvoRemaining: 0,
          salvoCooldown: 20,
          surfaceTimer: 60,
          fallFrames: 0,
          lifetime: 0,
          activationTimer: 0,
          flashTicks: 0,
          hitRadius: 44,
          width: 198,
          height: 36,
          scoreValue: 300,
          difficultyWeight: 250,
          spriteMain: 'submarine',
          laserActive: false,
          laserLength: 0,
        },
      ],
      projectiles: [
        {
          id: 30,
          owner: 'player',
          kind: 'bullet',
          x: 15,
          y: -80,
          prevX: 15,
          prevY: -80,
          vx: 24,
          vy: 0,
          angleDeg: 0,
          ttl: 60,
          maxTtl: 60, // spawn tick -> f0 (subX=120)
          dmg: 4,
          radius: 4,
          targetId: null,
          piercing: false,
          aoeRadius: 0,
          fromGungine: false,
        },
        {
          id: 31,
          owner: 'player',
          kind: 'bullet',
          x: 65,
          y: -80,
          prevX: 65,
          prevY: -80,
          vx: 24,
          vy: 0,
          angleDeg: 0,
          ttl: 50,
          maxTtl: 60, // in-flight -> locked to f1 (subX=121)
          dmg: 4,
          radius: 4,
          targetId: null,
          piercing: false,
          aoeRadius: 0,
          fromGungine: false,
        },
        {
          id: 32,
          owner: 'enemy',
          kind: 'ebullet',
          x: 40,
          y: -75,
          prevX: 40,
          prevY: -75,
          vx: -10,
          vy: 0,
          angleDeg: 180,
          ttl: 120,
          maxTtl: 180,
          dmg: 6,
          radius: 5,
          targetId: null,
          piercing: false,
          aoeRadius: 0,
          fromGungine: false,
        },
      ],
      particles: [
        {
          id: 10,
          kind: 'smoke',
          spriteName: 'fx_smoke',
          x: 0,
          y: -80,
          vx: 0,
          vy: 0,
          angleDeg: 0,
          scaleX: 1,
          scaleY: 1,
          frame: 0,
          frameSpeed: 0.2,
          frameCount: 8,
          ttl: 20,
          maxTtl: 20,
          depth: -4,
          loop: false,
          allowBelowSea: false,
          friction: 0,
          gravity: 0,
          isExplosion: false,
        },
        {
          id: 11,
          kind: 'explode_big',
          spriteName: 'fx_explodebig',
          x: 20,
          y: -70,
          vx: 0,
          vy: 0,
          angleDeg: 0,
          scaleX: 1,
          scaleY: 1,
          frame: 0,
          frameSpeed: 0.6,
          frameCount: 13,
          ttl: 20,
          maxTtl: 20,
          depth: -7,
          loop: false,
          allowBelowSea: false,
          friction: 0,
          gravity: 0,
          isExplosion: true,
        },
        {
          id: 12,
          kind: 'fireFlash',
          spriteName: 'fx_fire_flash',
          x: 0,
          y: -80,
          vx: 0,
          vy: 0,
          angleDeg: 0,
          scaleX: 1,
          scaleY: 1,
          frame: 0,
          frameSpeed: 0.6,
          frameCount: 3,
          ttl: 5,
          maxTtl: 5,
          depth: -5,
          loop: false,
          allowBelowSea: false,
          friction: 0,
          gravity: 0,
          isExplosion: false,
        },
        {
          id: 13,
          kind: 'splashSub',
          spriteName: 'fx_subsplash',
          x: 160,
          y: 0,
          vx: 0,
          vy: 0,
          angleDeg: 0,
          scaleX: 1,
          scaleY: 1,
          frame: 0,
          frameSpeed: 0.4,
          frameCount: 5,
          ttl: 12,
          maxTtl: 12,
          depth: -5,
          loop: false,
          allowBelowSea: false,
          friction: 0,
          gravity: 0,
          isExplosion: false,
        },
      ],
    });
    batches.length = 0;
    renderer.render(combatSnap, combatSnap, 0, null, 1.0);

    // ocean_line (subX=50) rendered with uClipSea === 0
    const oceanBatch = batches.find((b) => b.instances.some((i) => i.subX === 50));
    expect(oceanBatch).toBeDefined();
    expect(oceanBatch!.clipSea).toBe(0);

    // bg_jet_trail (subX=96) rendered behind bg_jet (subX=95)
    const skyInsts = batches[0]?.instances ?? [];
    expect(skyInsts.some((i) => i.subX === 96)).toBe(true);
    expect(skyInsts.some((i) => i.subX === 95)).toBe(true);

    // Foreground batch depth ordering: smoke (100) < player engine (60..65) < player bullet (120/121) < fireFlash (110) < explode_big (105) < ebullet (125/126)
    const fgBatch = batches.find((b) => b.instances.some((i) => i.subX === 100) && b.program === createdPrograms[0]);
    expect(fgBatch).toBeDefined();
    const smokeIdx = fgBatch!.instances.findIndex((i) => i.subX === 100);
    const engineIdx = fgBatch!.instances.findIndex((i) => i.subX >= 60 && i.subX <= 65);
    const bulletSpawnIdx = fgBatch!.instances.findIndex((i) => i.subX === 120);
    const bulletFlightIdx = fgBatch!.instances.findIndex((i) => i.subX === 121);
    const flashIdx = fgBatch!.instances.findIndex((i) => i.subX === 110);
    const explodeIdx = fgBatch!.instances.findIndex((i) => i.subX === 105);
    const ebulletIdx = fgBatch!.instances.findIndex((i) => i.subX === 125 || i.subX === 126);
    expect(smokeIdx).toBeGreaterThanOrEqual(0);
    expect(engineIdx).toBeGreaterThan(smokeIdx);
    expect(bulletSpawnIdx).toBeGreaterThan(engineIdx);
    expect(bulletFlightIdx).toBeGreaterThan(engineIdx);
    expect(flashIdx).toBeGreaterThan(bulletFlightIdx);
    expect(explodeIdx).toBeGreaterThan(flashIdx);
    expect(ebulletIdx).toBeGreaterThan(explodeIdx);

    // Underwater propeller animates across ticks (tick=10 vs tick=12)
    const uwEngineTick10 = fgBatch!.instances[engineIdx]!.subX;
    const combatSnapTick12 = { ...combatSnap, tick: 12 };
    batches.length = 0;
    renderer.render(combatSnapTick12, combatSnapTick12, 0, null, 1.03);
    const fgBatch12 = batches.find(
      (b) => b.instances.some((i) => i.subX === 100) && b.program === createdPrograms[0],
    );
    const uwEngineTick12 = fgBatch12!.instances.find((i) => i.subX >= 60 && i.subX <= 65)!.subX;
    expect(uwEngineTick12).not.toBe(uwEngineTick10);

    const boatGunInst = fgBatch!.instances.find((i) => i.subX >= 80 && i.subX <= 85);
    expect(boatGunInst?.subX).toBe(83); // gunAnimFrame = 3!

    // Live descending Blimp uses blimp (90) + blimp_anim (91), NOT blimp_die (92)
    expect(fgBatch!.instances.some((i) => i.subX === 90)).toBe(true);
    expect(fgBatch!.instances.some((i) => i.subX === 91)).toBe(true);
    expect(fgBatch!.instances.some((i) => i.subX === 92)).toBe(false);

    // Reflect pass (program index 1) includes smoke (100), fireFlash (110), explode_big (105), and blimp (90)
    const reflectBatch = batches.find((b) => b.program === createdPrograms[1]);
    expect(reflectBatch).toBeDefined();
    const reflectSubs = reflectBatch!.instances.map((i) => i.subX);
    expect(reflectSubs).toContain(100);
    expect(reflectSubs).toContain(110);
    expect(reflectSubs).toContain(105);
    expect(reflectSubs).toContain(90);

    // Nuke plays FORWARD and auto-centers [0,0] center to [157, 178] on blast origin
    const nukeInsts = batches.flatMap((b) => b.instances).filter((i) => i.subX >= 200 && i.subX <= 215);
    expect(nukeInsts.length).toBe(2); // main + reflect
    expect(nukeInsts[0]!.subX).toBe(200);
    expect(nukeInsts[0]!.cx).toBe(157);
    expect(nukeInsts[0]!.cy).toBe(178);
    expect(POST_WATER_FRAG).toContain('isPrimarySilhouette');

    // Surfaced Submarine (subX=75) renders in foregroundSprites BEHIND fx_subsplash (subX=115), never cutting off splashes!
    const subIdx = fgBatch!.instances.findIndex((i) => i.subX === 75);
    const subSplashIdx = fgBatch!.instances.findIndex((i) => i.subX === 115);
    expect(subIdx).toBeGreaterThanOrEqual(0);
    expect(subSplashIdx).toBeGreaterThan(subIdx);

    // 3. HangarHudPass delegation seam works cleanly with dual-channel menuBatchProg
    const menuSpy = vi.fn();
    const hudSpy = vi.fn();
    const pauseSpy = vi.fn();
    const gameOverSpy = vi.fn();
    const customPass: HangarHudPass = {
      drawHangarMenuPass: (ctx, snap, ui, t) => {
        menuSpy(snap.phase, ui.activeRow, t);
        const menuTex = ctx.resolveAtlasTexture(ctx.vault?.data.atlases.menusprites, ['menusprites']);
        ctx.drawSpriteBatch(
          menuTex,
          [
            {
              entry: vault.data.atlases.sprites.sprites['ocean_line']!,
              frame: 0,
              x: 300,
              y: 100,
              angleRad: 0,
              scaleX: 1,
              scaleY: 1,
              depth: 0.1,
              flash: 0,
              clipSea: false,
            },
          ],
          undefined,
          true,
        );
      },
      drawInGameHudPass: hudSpy,
      drawPauseOverlayPass: pauseSpy,
      drawGameOverDebriefPass: gameOverSpy,
    };
    renderer.setHangarHudPass(customPass);

    const controller = new HangarController();
    const hSnap = makeSnapshot({ phase: 'hangar' });
    batches.length = 0;
    renderer.render(hSnap, hSnap, 0, controller.buildUiState(hSnap), 2.0);
    expect(menuSpy).toHaveBeenCalledWith('hangar', 'weapon', 2.0);
    // Menu sprite batch dispatched through menuBatchProg (createdPrograms[8])
    expect(batches.some((b) => b.program === createdPrograms[8])).toBe(true);

    const overPausedSnap = makeSnapshot({ phase: 'gameover', paused: true });
    renderer.render(overPausedSnap, overPausedSnap, 0, null, 2.5);
    expect(hudSpy).toHaveBeenCalledTimes(1);
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(gameOverSpy).toHaveBeenCalledTimes(1);

    expect(renderer.getFrameMetrics().webglErrors).toBe(0);
    renderer.dispose();
  });

  it('persists Assist Mode cleanly and renders Hangar, HUD, Pause, Game Over, and Telemetry [ASSIST] without WebGL errors', () => {
    const store = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => {
        store.set(k, v);
      },
      removeItem: (k) => {
        store.delete(k);
      },
    };

    expect(loadStoredAssistMode(storage)).toBe(false);
    saveStoredAssistMode(true, storage);
    expect(store.get(ASSIST_MODE_STORAGE_KEY)).toBe('true');
    expect(loadStoredAssistMode(storage)).toBe(true);
    clearStoredProfileKeys(storage);
    expect(loadStoredAssistMode(storage)).toBe(false);

    const { gl } = createMockWebGL2Context();
    const canvas = {
      width: 600,
      height: 400,
      style: { imageRendering: '' },
      getContext: vi.fn((kind: string) => (kind === 'webgl2' ? gl : null)),
    } as unknown as HTMLCanvasElement;
    const vault = createMockVaultBundle();
    const renderer = new WebGL2Renderer();
    renderer.init(canvas, vault);

    const controller = new HangarController({ assistMode: true, allUnlocked: true });
    controller.setActiveRow('mode');
    expect(controller.isAssistMode()).toBe(true);

    const drawnTexts: Array<{ text: string; x: number; y: number }> = [];
    renderer.setHangarHudPass({
      ...HANGAR_HUD_PASS,
      drawHangarMenuPass: (ctx, snap, uiState, t) => {
        const wrappedCtx = {
          ...ctx,
          drawBitmapText: (
            font: Parameters<typeof ctx.drawBitmapText>[0],
            text: string,
            x: number,
            y: number,
            scale: number,
            align: Parameters<typeof ctx.drawBitmapText>[5],
            color: Parameters<typeof ctx.drawBitmapText>[6],
          ) => {
            drawnTexts.push({ text, x, y });
            ctx.drawBitmapText(font, text, x, y, scale, align, color);
          },
        };
        HANGAR_HUD_PASS.drawHangarMenuPass(wrappedCtx, snap, uiState, t);
      },
    });

    const dailyModFlags = {
      ...DEFAULT_ACT2_MOD_FLAGS,
      moddedEnabled: true,
      dailySeed: true,
    };
    controller.setModFlags(dailyModFlags);
    const hangarSnap = makeSnapshot({ phase: 'hangar', assistMode: true });
    const ui = controller.buildUiState(hangarSnap, undefined, {
      modFlags: dailyModFlags,
      dailySeedId: '20261127',
    });
    expect(ui.assistMode).toBe(true);
    renderer.render(hangarSnap, hangarSnap, 0, ui, 0.5);

    const assistHeaderDraw = drawnTexts.find(
      (d) => d.text === '[E] ASSIST: ON' && d.x === 26 && d.y <= 22,
    );
    const dailyDraw = drawnTexts.find((d) => d.text === 'DAILY 20261127');
    expect(assistHeaderDraw).toBeDefined();
    expect(dailyDraw).toBeDefined();
    expect(dailyDraw!.x !== assistHeaderDraw!.x || dailyDraw!.y !== assistHeaderDraw!.y).toBe(true);
    expect(drawnTexts.some((d) => d.text.includes('+35% HULL'))).toBe(true);
    expect(drawnTexts.some((d) => d.text.includes('+50% HULL'))).toBe(false);

    const playSnap = makeSnapshot({ phase: 'playing', assistMode: true });
    renderer.render(playSnap, playSnap, 0, null, 1.0);
    const lines = formatTelemetryLines({
      snapshot: playSnap,
      frameMetrics: renderer.getFrameMetrics(),
      vaultSource: 'procedural-fallback',
    });
    expect(lines.some((l) => l.includes('[ASSIST]'))).toBe(true);

    const pauseSnap = makeSnapshot({ phase: 'playing', paused: true, assistMode: true });
    renderer.render(pauseSnap, pauseSnap, 0, null, 1.5);

    const overSnap = makeSnapshot({ phase: 'gameover', assistMode: true });
    renderer.render(overSnap, overSnap, 0, null, 2.0);

    // Fallback WebGL2Renderer.drawMenuPass (without external HangarHudPass) must also keep
    // [E] ASSIST at (26, 5), keep DAILY out of the Assist tap box, and show +35% HULL copy.
    renderer.setHangarHudPass(null);
    const fallbackTexts: Array<{ text: string; x: number; y: number }> = [];
    const drawBitmapSpy = vi.spyOn(
      renderer as unknown as {
        drawBitmapText: (
          gl: unknown,
          font: unknown,
          text: string,
          x: number,
          y: number,
          scale: number,
          align: unknown,
          color: unknown,
        ) => void;
      },
      'drawBitmapText',
    );
    const origDrawBitmap = drawBitmapSpy.getMockImplementation();
    drawBitmapSpy.mockImplementation((glArg, font, text, x, y, scale, align, color) => {
      fallbackTexts.push({ text, x, y });
      origDrawBitmap?.(glArg, font, text, x, y, scale, align, color);
    });
    renderer.render(hangarSnap, hangarSnap, 0, ui, 2.5);
    drawBitmapSpy.mockRestore();

    const fbAssist = fallbackTexts.find(
      (d) => d.text === '[E] ASSIST: ON' && d.x === 26 && d.y <= 22,
    );
    const fbDaily = fallbackTexts.find((d) => d.text === 'DAILY 20261127');
    expect(fbAssist).toBeDefined();
    expect(fbDaily).toBeDefined();
    expect(fbDaily!.x !== fbAssist!.x || fbDaily!.y !== fbAssist!.y).toBe(true);
    expect(fallbackTexts.some((d) => d.text.includes('NORMAL + ASSIST'))).toBe(true);
    expect(fallbackTexts.some((d) => d.text.includes('+35% HULL'))).toBe(true);

    expect(renderer.getFrameMetrics().webglErrors).toBe(0);
    renderer.dispose();
  });
});
