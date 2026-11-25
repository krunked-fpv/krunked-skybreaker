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
import {
  layoutHangarDescription,
  layoutMissionCardDescription,
  resolveEnemyRenderTransform,
  wrapBitmapTextLines,
} from '../src/render/renderer';
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
          scaleX: batch[i + 9]!,
          scaleY: batch[i + 10]!,
        });
      }
    }

    // Left-moving Boat (subX=0), BigBoat (subX=2), Submarine (subX=4), AceMarine (subX=5)
    for (const expectedSubX of [0, 2, 4, 5]) {
      const hullInst = instances.find((inst) => inst.subX === expectedSubX);
      expect(hullInst).toBeDefined();
      expect(hullInst!.angleRad).toBe(0);
      expect(hullInst!.scaleX).toBe(-1);
      expect(hullInst!.scaleY).toBe(1);
    }

    // BigBoat guns (subX=3 at y=-28) are mirrored in main + reflect batches
    const bigBoatGuns = instances.filter(
      (inst) => inst.subX === 3 && inst.y === -28,
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

      // 1. Hangar banner ('BEAMRAUSER')
      fontQuads.length = 0;
      const controller = new HangarController();
      const hangarSnap = makeSnapshot({
        phase: 'hangar',
        player: { ...makeSnapshot().player, planeName: 'BEAMRAUSER' },
      });
      const hangarUi = { ...controller.buildUiState(hangarSnap), planeName: 'BEAMRAUSER' };
      renderer.render(hangarSnap, hangarSnap, 0, hangarUi, 0.5);

      const bannerDraw = fontQuads.find((q) => q.verts.length === 'BEAMRAUSER'.length * 24);
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
        player: { ...makeSnapshot().player, alive: false, planeName: 'BEAMRAUSER' },
      });
      renderer.render(overSnap, overSnap, 0, null, 0.5);
      const shotDownDraw = fontQuads
        .filter((q) => !q.isCombo && q.verts.length === 'SHOT DOWN'.length * 24)
        .at(-1);
      expect(shotDownDraw).toBeDefined();
      expect(shotDownDraw!.verts[9]! - shotDownDraw!.verts[1]!).toBe(expectedBigH);

      const subtitleDraw = fontQuads
        .filter((q) => !q.isCombo && q.verts.length === 'BEAMRAUSER'.length * 24)
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
});
