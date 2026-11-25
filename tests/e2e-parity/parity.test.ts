import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALL_AUDIO_CUE_IDS,
  ALL_STEM_IDS,
  LOW_HP_ALARM_THRESHOLD,
  SYNTH_LOOP_DURATION_SEC,
  computePhaseOffset,
  resolveActiveStems,
  resolveSpatialSfx,
} from '../../src/audio';
import type { RgbaTuple } from '../../src/contracts/render';
import type { InputState, Loadout, PartIndex, SimSnapshot } from '../../src/contracts/sim';
import type { EnemyKind, EnemySpec, GameDataBundle } from '../../src/contracts/vault';
import {
  PALETTES,
  POST_WATER_FRAG,
  computePostShaderUniforms,
  getPaletteById,
} from '../../src/render';
import { resolveEnemyRenderTransform } from '../../src/render/renderer';
import {
  Simulation,
  createDefaultProfile,
  replaySimulation,
} from '../../src/sim';
import {
  DEFAULT_STEAM_DATA_DIR,
  checkCleanRoomGitHygiene,
  createProceduralFallbackBundle,
  loadVaultFromDisk,
} from '../../src/vault';

const IDLE_INPUT: InputState = {
  left: false,
  right: false,
  thrust: false,
  fire: false,
};

type JsonObject = Record<string, unknown>;

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';
}

/**
 * Independent JSONCPP parser used solely by the adversarial parity audit
 * so raw Steam files are cross-checked independently of `src/vault/jsoncpp.ts`.
 */
function parseSteamJsonIndependently<T>(raw: string): T {
  const input = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const chars: string[] = [];
  let inString = false;
  let escaped = false;
  let prev = '';

  for (let i = 0; i < input.length; i++) {
    const ch = input[i] ?? '';
    const next = i + 1 < input.length ? (input[i + 1] ?? '') : '';

    if (inString) {
      chars.push(ch);
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      prev = ch;
      continue;
    }

    if (ch === '"') {
      inString = true;
      chars.push(ch);
      prev = ch;
      continue;
    }

    if (ch === '/' && next === '/') {
      i += 2;
      while (i < input.length && input[i] !== '\n') i++;
      if (i < input.length && input[i] === '\n') {
        chars.push('\n');
        prev = '\n';
      }
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < input.length) {
        if (input[i] === '*' && input[i + 1] === '/') {
          i++;
          break;
        }
        if (input[i] === '\n') chars.push('\n');
        i++;
      }
      prev = ' ';
      continue;
    }

    if (ch === '.' && isDigit(prev) && !isDigit(next)) {
      chars.push('.0');
      prev = '0';
      continue;
    }
    if (ch === '.' && !isDigit(prev) && isDigit(next)) {
      chars.push('0.');
      prev = '.';
      continue;
    }

    chars.push(ch);
    prev = ch;
  }

  const pass1 = chars.join('');
  const out: string[] = [];
  inString = false;
  escaped = false;

  for (let i = 0; i < pass1.length; i++) {
    const ch = pass1[i] ?? '';
    if (inString) {
      out.push(ch);
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out.push(ch);
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < pass1.length && isWhitespace(pass1[j] ?? '')) j++;
      const look = j < pass1.length ? (pass1[j] ?? '') : '';
      if (look === '}' || look === ']') continue;
    }
    out.push(ch);
  }

  return JSON.parse(out.join('')) as T;
}

function asObj(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function toLowerMap(obj: unknown): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const [k, v] of Object.entries(asObj(obj))) {
    map.set(k.toLowerCase(), v);
  }
  return map;
}

function rgbDistance(a: RgbaTuple, b: RgbaTuple): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function launchToPlaying(
  sim: Simulation,
  loadout: Loadout,
  mode: 'normal' | 'sfmt' = 'normal',
  seed = 1000,
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

function assertSnapshotFinite(snap: SimSnapshot): void {
  const { player } = snap;
  expect(Number.isFinite(player.x)).toBe(true);
  expect(Number.isFinite(player.y)).toBe(true);
  expect(Number.isFinite(player.vx)).toBe(true);
  expect(Number.isFinite(player.vy)).toBe(true);
  expect(Number.isFinite(player.angleDeg)).toBe(true);
  expect(Number.isFinite(player.health)).toBe(true);
  expect(Number.isFinite(player.maxHealth)).toBe(true);
  expect(Number.isFinite(snap.score)).toBe(true);
  expect(Number.isFinite(snap.difficulty)).toBe(true);
  expect(Number.isFinite(snap.cameraTargetX)).toBe(true);
  expect(Number.isFinite(snap.cameraTargetY)).toBe(true);

  for (const e of snap.enemies) {
    expect(Number.isFinite(e.x)).toBe(true);
    expect(Number.isFinite(e.y)).toBe(true);
    expect(Number.isFinite(e.vx)).toBe(true);
    expect(Number.isFinite(e.vy)).toBe(true);
    expect(Number.isFinite(e.health)).toBe(true);
  }
  for (const p of snap.projectiles) {
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
    expect(Number.isFinite(p.vx)).toBe(true);
    expect(Number.isFinite(p.vy)).toBe(true);
  }
  for (const pt of snap.particles) {
    expect(Number.isFinite(pt.x)).toBe(true);
    expect(Number.isFinite(pt.y)).toBe(true);
    expect(Number.isFinite(pt.scaleY)).toBe(true);
  }
}

const steamVault = loadVaultFromDisk();
const fallbackVault = createProceduralFallbackBundle();
const steamData: GameDataBundle = steamVault.data;
const steamDir =
  process.env.SKYBREAKER_STEAM_DIR?.trim() ||
  process.env.LUFTRAUSERS_STEAM_DIR?.trim() ||
  DEFAULT_STEAM_DATA_DIR;

function stripPartText<T extends { name: string; descr: string }>(
  spec: T,
): Omit<T, 'name' | 'descr'> {
  const { name: _name, descr: _descr, ...rest } = spec;
  return rest;
}

function readRawSteamRes<T>(filename: string): T {
  const fullPath = path.join(steamDir, 'res', filename);
  return parseSteamJsonIndependently<T>(fs.readFileSync(fullPath, 'utf8'));
}

describe('Gate 3A: Live Steam Vault Cross-Reference & Zero-Drift Fallback Parity', () => {
  it('loads live Steam data on this Windows host (steam-local) with zero drift vs procedural fallback', () => {
    expect(steamVault.data.vaultSource).toBe('steam-local');
    expect(steamVault.data.steamDir).toBeTruthy();
    expect(steamVault.textures.sprites?.source).toBe('steam-tga');
    expect(steamVault.textures.sprites?.width).toBe(2048);
    expect(steamVault.textures.sprites?.height).toBe(1024);

    expect(fallbackVault.data.vaultSource).toBe('procedural-fallback');
    expect(fallbackVault.data.steamDir).toBeNull();

    // Zero numeric/tuning stat drift across every gameplay schema (while Skybreaker names/copy remain 100% original)
    expect(fallbackVault.data.player.settings.canshoot).toBe(steamData.player.settings.canshoot);
    expect(fallbackVault.data.player.settings.meleedmg).toBe(steamData.player.settings.meleedmg);
    expect(fallbackVault.data.player.settings.waterrotationforcedegrees).toBe(
      steamData.player.settings.waterrotationforcedegrees,
    );
    expect(fallbackVault.data.player.enginesById.map(stripPartText)).toEqual(
      steamData.player.enginesById.map(stripPartText),
    );
    expect(fallbackVault.data.player.bodiesById.map(stripPartText)).toEqual(
      steamData.player.bodiesById.map(stripPartText),
    );
    expect(fallbackVault.data.player.weaponsById.map(stripPartText)).toEqual(
      steamData.player.weaponsById.map(stripPartText),
    );
    // Clear recognizable core part names in Skybreaker default mode (zero trademark leaks)
    expect(fallbackVault.data.player.weaponsById.map((w) => w.name)).toEqual([
      'standard',
      'laser',
      'spread',
      'missiles',
      'cannon',
      'omega',
    ]);
    expect(fallbackVault.data.player.bodiesById.map((b) => b.name)).toEqual([
      'standard',
      'armor',
      'melee',
      'nuke',
      'bomb',
      'omega',
    ]);
    expect(fallbackVault.data.player.enginesById.map((e) => e.name)).toEqual([
      'standard',
      'superboost',
      'gungine',
      'underwater',
      'hover',
      'omega',
    ]);
    expect(fallbackVault.data.projectiles).toEqual(steamData.projectiles);
    expect(fallbackVault.data.enemies).toEqual(steamData.enemies);
    expect(fallbackVault.data.enemiesSfmt).toEqual(steamData.enemiesSfmt);
    expect(fallbackVault.data.spawnCoordinator).toEqual(steamData.spawnCoordinator);
    expect(fallbackVault.data.spawnCoordinatorSfmt).toEqual(steamData.spawnCoordinatorSfmt);
    expect(
      fallbackVault.data.global.planenames.map(({ weapon, body, engine }) => ({
        weapon,
        body,
        engine,
      })),
    ).toEqual(
      steamData.global.planenames.map(({ weapon, body, engine }) => ({
        weapon,
        body,
        engine,
      })),
    );
    expect(fallbackVault.data.global.planenames[125]).toEqual({
      name: 'APEX OMEGA',
      weapon: 5,
      body: 5,
      engine: 5,
    });
    expect(
      fallbackVault.data.global.missions.map(({ id, component, objective, condition, val }) => ({
        id,
        component,
        objective,
        condition,
        val,
      })),
    ).toEqual(
      steamData.global.missions.map(({ id, component, objective, condition, val }) => ({
        id,
        component,
        objective,
        condition,
        val,
      })),
    );
    expect(fallbackVault.data.fx).toEqual(steamData.fx);
    expect(fallbackVault.data.parallax).toEqual(steamData.parallax);
    expect(fallbackVault.data.room).toEqual(steamData.room);

    // Atlas sprite keys & audio inventories align 1:1 (except rebranded logo/emblem sprite keys)
    const REBRANDED_ATLAS_KEYS: Record<string, string> = {
      luftrausers_logo: 'skybreaker_logo',
      devolver_logo: 'brand_emblem',
      vlambeer_logo: 'studio_logo',
    };
    const normalizeAtlasKeys = (keys: string[]): string[] =>
      keys.map((k) => REBRANDED_ATLAS_KEYS[k] ?? k).sort();

    expect(fallbackVault.data.atlases.sprites.sprites['skybreaker_logo']).toBeDefined();
    expect(fallbackVault.data.atlases.sprites.sprites['luftrausers_logo']).toBeUndefined();
    expect(fallbackVault.data.atlases.menusprites.sprites['skybreaker_logo']).toBeDefined();
    expect(fallbackVault.data.atlases.menusprites.sprites['brand_emblem']).toBeDefined();
    expect(fallbackVault.data.atlases.menusprites.sprites['studio_logo']).toBeDefined();
    expect(fallbackVault.data.atlases.menusprites.sprites['luftrausers_logo']).toBeUndefined();
    expect(fallbackVault.data.atlases.menusprites.sprites['devolver_logo']).toBeUndefined();
    expect(fallbackVault.data.atlases.menusprites.sprites['vlambeer_logo']).toBeUndefined();

    expect(Object.keys(fallbackVault.data.atlases.sprites.sprites).sort()).toEqual(
      normalizeAtlasKeys(Object.keys(steamData.atlases.sprites.sprites)),
    );
    expect(Object.keys(fallbackVault.data.atlases.menusprites.sprites).sort()).toEqual(
      normalizeAtlasKeys(Object.keys(steamData.atlases.menusprites.sprites)),
    );
    expect(Object.keys(fallbackVault.data.atlases.nukesprites.sprites).sort()).toEqual(
      Object.keys(steamData.atlases.nukesprites.sprites).sort(),
    );
    expect(Object.keys(steamVault.audioManifest.bgm).sort()).toEqual(
      Object.keys(fallbackVault.audioManifest.bgm).sort(),
    );
    expect(Object.keys(steamVault.audioManifest.sfx).sort()).toEqual(
      Object.keys(fallbackVault.audioManifest.sfx).sort(),
    );
  });

  it('independently cross-references raw Steam player.json (6E, 6B, 6W + inheritance & URAUSER ??? overrides)', () => {
    const rawPlayer = readRawSteamRes<JsonObject>('player.json');
    const rawSettings = toLowerMap(rawPlayer.settings);
    const rawEngines = asObj(rawPlayer.engines);
    const rawBodies = asObj(rawPlayer.bodyparts);
    const rawWeapons = asObj(rawPlayer.weapons);

    expect(steamData.player.settings).toEqual({
      body: rawSettings.get('body'),
      engine: rawSettings.get('engine'),
      weapon: rawSettings.get('weapon'),
      canshoot: rawSettings.get('canshoot'),
      meleedmg: rawSettings.get('meleedmg'),
      waterrotationforcedegrees: rawSettings.get('waterrotationforcedegrees'),
    });

    expect(Object.keys(rawEngines)).toHaveLength(6);
    expect(Object.keys(rawBodies)).toHaveLength(6);
    expect(Object.keys(rawWeapons)).toHaveLength(6);
    expect(steamData.player.enginesById).toHaveLength(6);
    expect(steamData.player.bodiesById).toHaveLength(6);
    expect(steamData.player.weaponsById).toHaveLength(6);

    // Verify every Engine field against raw Steam override or original inheritance
    const origEngineRaw = toLowerMap(rawEngines.original);
    for (const [key, rawEntry] of Object.entries(rawEngines)) {
      const m = toLowerMap(rawEntry);
      const spec = steamData.player.engines[key];
      expect(spec).toBeDefined();
      const expected = (field: string, fallback: unknown): unknown =>
        m.has(field) ? m.get(field) : origEngineRaw.has(field) ? origEngineRaw.get(field) : fallback;

      expect(spec!.id).toBe(expected('id', 0));
      expect(spec!.name).toBe(expected('name', key));
      expect(spec!.descr).toBe(expected('descr', ''));
      expect(spec!.sprite).toBe(expected('sprite', ''));
      expect(spec!.booststartsprite).toBe(expected('booststartsprite', ''));
      expect(spec!.boostloopsprite).toBe(expected('boostloopsprite', ''));
      expect(spec!.boostendparticle).toBe(expected('boostendparticle', ''));
      expect(spec!.boostidlesprite).toBe(expected('boostidlesprite', ''));
      expect(spec!.acceleration).toBe(expected('acceleration', 0));
      expect(spec!.gravity).toBe(expected('gravity', 0));
      expect(spec!.friction).toBe(expected('friction', 0));
      expect(spec!.speed).toBe(expected('speed', 0));
      expect(spec!.turnspeed).toBe(expected('turnspeed', 0));
      expect(spec!.turnspeedboost).toBe(expected('turnspeedboost', 0));
      expect(spec!.boostadd).toBe(expected('boostadd', 0));
      expect(spec!.waterdmg).toBe(expected('waterdmg', 0));
      expect(spec!.waterdmglowhp).toBe(expected('waterdmglowhp', 0));
      expect(spec!.waterlowhpperc).toBe(expected('waterlowhpperc', 0));
      expect(spec!.wateracceleration).toBe(expected('wateracceleration', 0));
      expect(spec!.waterforce).toBe(expected('waterforce', 0));
      expect(spec!.spacedmg).toBe(expected('spacedmg', 0));
      expect(spec!.spacedmglowhp).toBe(expected('spacedmglowhp', 0));
      expect(spec!.spacelowhpperc).toBe(expected('spacelowhpperc', 0));
      expect(spec!.spaceacceleration).toBe(expected('spaceacceleration', 0));
      expect(spec!.spaceforce).toBe(expected('spaceforce', 0));
      expect(spec!.environmentfriction).toBe(expected('environmentfriction', 0));
      expect(spec!.environmentmin).toBe(expected('environmentmin', 0));
      expect(spec!.motionadddirection).toBe(expected('motionadddirection', 0));
      expect(spec!.motionaddimageangle).toBe(expected('motionaddimageangle', 0));
      expect(spec!.minimumspeed).toBe(expected('minimumspeed', 0));
      expect(spec!.maximumspeed).toBe(expected('maximumspeed', 0));
      expect(spec!.waterproof).toBe(expected('waterproof', false));
      expect(spec!.flags).toBe(expected('flags', ''));
    }

    // Verify every Body field against raw Steam override or original inheritance
    const origBodyRaw = toLowerMap(rawBodies.original);
    for (const [key, rawEntry] of Object.entries(rawBodies)) {
      const m = toLowerMap(rawEntry);
      const spec = steamData.player.bodyparts[key];
      expect(spec).toBeDefined();
      const expected = (field: string, fallback: unknown): unknown =>
        m.has(field) ? m.get(field) : origBodyRaw.has(field) ? origBodyRaw.get(field) : fallback;

      expect(spec!.id).toBe(expected('id', 0));
      expect(spec!.name).toBe(expected('name', key));
      expect(spec!.descr).toBe(expected('descr', ''));
      expect(spec!.sprite).toBe(expected('sprite', ''));
      expect(spec!.speedmodifier).toBe(expected('speedmodifier', 1));
      expect(spec!.healingspd).toBe(expected('healingspd', 0.16));
      expect(spec!.impactrecvdmgmult).toBe(expected('impactrecvdmgmult', 0.125));
      expect(spec!.impactdealdmgmult).toBe(expected('impactdealdmgmult', 0.25));
      expect(spec!.impactdmgmult).toBe(expected('impactdmgmult', 0));
      expect(spec!.impactdealcritical).toBe(expected('impactdealcritical', 10));
      expect(spec!.impactdealcriticaldmg).toBe(expected('impactdealcriticaldmg', 0.5));
      expect(spec!.impactsleeptime).toBe(expected('impactsleeptime', 10));
      expect(spec!.impactcamshake).toBe(expected('impactcamshake', 2));
      expect(spec!.impactspeedmult).toBe(expected('impactspeedmult', 0.9));
      expect(spec!.maxhealth).toBe(expected('maxhealth', 16));
      expect(spec!.meleedmg).toBe(expected('meleedmg', rawSettings.get('meleedmg')));
      expect(spec!.flags).toBe(expected('flags', ''));
    }
    expect(steamData.player.bodiesById[5]?.maxhealth).toBe(120);
    expect(steamData.player.bodiesById[5]?.healingspd).toBe(0.01);

    // Verify every Weapon field against raw Steam override or original inheritance
    const origWeaponRaw = toLowerMap(rawWeapons.original);
    for (const [key, rawEntry] of Object.entries(rawWeapons)) {
      const m = toLowerMap(rawEntry);
      const spec = steamData.player.weapons[key];
      expect(spec).toBeDefined();
      const expected = (field: string, fallback: unknown): unknown =>
        m.has(field) ? m.get(field) : origWeaponRaw.has(field) ? origWeaponRaw.get(field) : fallback;

      expect(spec!.id).toBe(expected('id', 0));
      expect(spec!.name).toBe(expected('name', key));
      expect(spec!.descr).toBe(expected('descr', ''));
      expect(spec!.sprite).toBe(expected('sprite', ''));
      expect(spec!.projectile).toBe(expected('projectile', 'bullet'));
      expect(spec!.interval).toBe(expected('interval', 3));
      expect(spec!.maxbullets).toBe(expected('maxbullets', 1337));
      expect(spec!.recoil).toBe(expected('recoil', 0));
      expect(spec!.spread).toBe(expected('spread', 1));
      expect(spec!.numbullets).toBe(expected('numbullets', 1));
      expect(spec!.flags).toBe(expected('flags', ''));
    }
  });

  it('independently cross-references global.json (126 planenames, 90 missions), enemies (Normal+SFMT), projectiles, spawn coordinators, room, and audio disk inventory', () => {
    // 1. global.json: 125 standard planenames + 126th URAUSER + 90 missions
    const rawGlobal = readRawSteamRes<JsonObject>('global.json');
    const rawPlaneNames = rawGlobal.planenames as Array<{
      name: string;
      weapon: number;
      body: number;
      engine: number;
    }>;
    const rawMissions = rawGlobal.missions as Array<{
      component: [number, number, number];
      objective: number;
      condition: number;
      val: [number, number];
    }>;

    expect(rawPlaneNames).toHaveLength(126);
    expect(steamData.global.planenames).toEqual(rawPlaneNames);
    expect(steamData.global.planenames[125]).toEqual({
      name: 'URAUSER',
      weapon: 5,
      body: 5,
      engine: 5,
    });

    const unique125 = new Set(
      steamData.global.planenames
        .slice(0, 125)
        .map((p) => `${p.weapon}-${p.body}-${p.engine}`),
    );
    expect(unique125.size).toBe(125);

    expect(rawMissions).toHaveLength(90);
    expect(steamData.global.missions).toHaveLength(90);
    for (let i = 0; i < 90; i++) {
      const norm = steamData.global.missions[i]!;
      const raw = rawMissions[i]!;
      expect(norm.id).toBe(i);
      expect(norm.component).toEqual(raw.component);
      expect(norm.objective).toBe(raw.objective);
      expect(norm.condition).toBe(raw.condition);
      expect(norm.val).toEqual(raw.val);
      expect(norm.title.length).toBeGreaterThan(0);
      expect(norm.description.length).toBeGreaterThan(0);
    }

    // 2. enemies.json (12) + enemies_sfmt.json (12) — case-insensitive exact field parity
    const verifyEnemies = (
      rawFile: string,
      normalizedMap: Record<string, EnemySpec>,
    ): void => {
      const rawEnemies = readRawSteamRes<JsonObject>(rawFile);
      expect(Object.keys(rawEnemies)).toHaveLength(12);
      expect(Object.keys(normalizedMap)).toHaveLength(12);

      for (const [key, rawVal] of Object.entries(rawEnemies)) {
        const spec = normalizedMap[key];
        expect(spec).toBeDefined();
        const lm = toLowerMap(rawVal);
        for (const [lowerField, rawFieldVal] of lm.entries()) {
          const actual = (spec as unknown as Record<string, unknown>)[lowerField];
          expect(actual).toBe(rawFieldVal);
        }
      }
    };
    verifyEnemies('enemies.json', steamData.enemies);
    verifyEnemies('enemies_sfmt.json', steamData.enemiesSfmt);

    // 3. projectiles.json (6)
    const rawProj = readRawSteamRes<JsonObject>('projectiles.json');
    expect(Object.keys(rawProj)).toHaveLength(6);
    expect(Object.keys(steamData.projectiles)).toHaveLength(6);
    for (const [key, rawVal] of Object.entries(rawProj)) {
      const lm = toLowerMap(rawVal);
      const spec = steamData.projectiles[key]!;
      expect(spec.id).toBe(key);
      expect(spec.ttl).toBe(lm.get('ttl'));
      expect(spec.dmg).toBe(lm.get('dmg'));
      expect(spec.speed).toBe(lm.get('speed'));
      expect(spec.degreesoffset).toBe(lm.get('degreesoffset'));
      expect(spec.sfxfire).toBe(String(lm.get('sfxfire') ?? '').trim());
      expect(spec.flags).toBe(String(lm.get('flags') ?? '').trim());
    }

    // 4. spawncoordinator.json + spawncoordinator_sfmt.json
    const verifySpawn = (
      rawFile: string,
      norm: GameDataBundle['spawnCoordinator'],
    ): void => {
      const raw = toLowerMap(readRawSteamRes<JsonObject>(rawFile));
      expect(norm.initialDifficulty).toBe(raw.get('initialdifficulty'));
      expect(norm.maxPercentageBoats).toBe(raw.get('maxpercentageboats'));
      expect(norm.maxNumAcePerDifficultyPerc).toBe(raw.get('maxnumaceperdifficultyperc'));
      expect(norm.maxNumBlimpsPerDifficultyPerc).toBe(raw.get('maxnumblimpsperdifficultyperc'));
      expect(norm.aceToLaserAceChance).toBe(raw.get('acetolaseracechance'));
      expect(norm.minNumSubmarineKillsForAceMarine).toBe(
        raw.get('minnumsubmarinekillsforacemarine'),
      );
      expect(norm.submarineToAceMarineChance).toBe(raw.get('submarinetoacemarinechance'));
      expect(norm.increaseDifficulty).toEqual(raw.get('increasedifficulty'));
      expect(norm.spawnlist).toEqual(raw.get('spawnlist'));
    };
    verifySpawn('spawncoordinator.json', steamData.spawnCoordinator);
    verifySpawn('spawncoordinator_sfmt.json', steamData.spawnCoordinatorSfmt);

    // 5. room.json
    const rawRoom = asObj(readRawSteamRes<JsonObject>('room.json').settings);
    expect(steamData.room).toEqual({
      sealevel: rawRoom.sealevel,
      spacelevel: rawRoom.spacelevel,
    });
    expect(steamData.room.sealevel).toBe(0);
    expect(steamData.room.spacelevel).toBe(-1300);

    // 6. Audio disk inventory (20 BGM OGGs, 52 SFX WAVs) & Clean-room git hygiene
    const diskBgm = fs
      .readdirSync(path.join(steamDir, 'bgm'))
      .filter((f) => f.endsWith('.ogg'))
      .map((f) => f.slice(0, -4))
      .sort();
    const diskSfx = fs
      .readdirSync(path.join(steamDir, 'sfx'))
      .filter((f) => f.endsWith('.wav'))
      .map((f) => f.slice(0, -4))
      .sort();
    expect(diskBgm).toHaveLength(20);
    expect(diskSfx).toHaveLength(52);
    expect(diskBgm).toEqual([...ALL_STEM_IDS].sort());
    expect(diskSfx).toEqual([...ALL_AUDIO_CUE_IDS].sort());

    const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean);
    expect(checkCleanRoomGitHygiene(tracked)).toEqual([]);
  });
});

describe('Gate 3B: 12-Archetype 3,600-Tick (60s) Ace Pilot Bot Sorties & Replay Bit-Identity', () => {
  const ARCHETYPES: ReadonlyArray<{
    label: string;
    loadout: Loadout;
    expectedName: string;
    seed: number;
  }> = [
    { label: 'original', loadout: { weapon: 0, body: 0, engine: 0 }, expectedName: 'original', seed: 10101 },
    { label: 'beamrauser', loadout: { weapon: 1, body: 0, engine: 0 }, expectedName: 'beamrauser', seed: 10202 },
    { label: 'kozilek', loadout: { weapon: 2, body: 1, engine: 0 }, expectedName: 'kozilek', seed: 10303 },
    { label: 'maverick', loadout: { weapon: 3, body: 0, engine: 0 }, expectedName: 'maverick', seed: 10404 },
    { label: 'hubble', loadout: { weapon: 4, body: 0, engine: 0 }, expectedName: 'hubble', seed: 10505 },
    { label: 'mosquito', loadout: { weapon: 0, body: 0, engine: 2 }, expectedName: 'mosquito', seed: 10606 },
    { label: 'penguin', loadout: { weapon: 0, body: 0, engine: 3 }, expectedName: 'penguin', seed: 10707 },
    { label: 'floatrauser', loadout: { weapon: 0, body: 0, engine: 4 }, expectedName: 'floatrauser', seed: 10808 },
    { label: 'kamikaze', loadout: { weapon: 0, body: 3, engine: 1 }, expectedName: 'kamikaze', seed: 10909 },
    { label: 'jouster', loadout: { weapon: 1, body: 2, engine: 0 }, expectedName: 'jouster', seed: 11010 },
    { label: 'luftbomber', loadout: { weapon: 0, body: 4, engine: 0 }, expectedName: 'luftbomber', seed: 11111 },
    { label: 'urauser', loadout: { weapon: 5, body: 5, engine: 5 }, expectedName: 'URAUSER', seed: 11212 },
  ];

  it.each(ARCHETYPES)(
    'flies 3,600-tick deterministic Ace Pilot Bot sortie for $label ($expectedName) with live Steam data',
    ({ loadout, expectedName, seed }) => {
      const sim = new Simulation(steamData);
      sim.launch(loadout, 'normal', seed);
      sim.setAutopilot(true);

      const initialSnap = sim.getSnapshot();
      expect(initialSnap.player.planeName).toBe(expectedName);
      if (expectedName === 'URAUSER') {
        expect(initialSnap.player.isUrauser).toBe(true);
        expect(initialSnap.player.maxHealth).toBe(120);
        expect(initialSnap.player.bodySpec.healingspd).toBe(0.01);
      }

      let peakEnemies = 0;
      let sawPlayerOrdnance = false;
      let sawCombatEvents = false;

      for (let t = 0; t < 3600; t++) {
        const snap = sim.step(IDLE_INPUT);
        // Spot-check finiteness every 10 ticks and on final tick for fast runtime + full coverage
        if (t % 10 === 0 || t === 3599) {
          assertSnapshotFinite(snap);
        }
        if (snap.enemies.length > peakEnemies) {
          peakEnemies = snap.enemies.length;
        }
        if (snap.projectiles.some((p) => p.owner === 'player')) {
          sawPlayerOrdnance = true;
        }
        if (snap.killsThisSortie > 0 || snap.audioEvents.some((e) => e.cue.startsWith('sndhit'))) {
          sawCombatEvents = true;
        }
      }

      const finalSnap = sim.getSnapshot();
      assertSnapshotFinite(finalSnap);
      expect(finalSnap.player.planeName).toBe(expectedName);
      expect(peakEnemies).toBeGreaterThanOrEqual(1);
      expect(sawPlayerOrdnance || sawCombatEvents).toBe(true);
      expect(finalSnap.killsThisSortie).toBeGreaterThanOrEqual(1);
      expect(finalSnap.score).toBeGreaterThan(0);

      // Bit-identical deterministic replay proof via replaySimulation()
      const recording = sim.getReplay();
      expect(recording.frames.length).toBeGreaterThan(0);
      expect(recording.frames.length).toBeLessThanOrEqual(3600);
      const replayed = replaySimulation(steamData, recording);

      expect(replayed.tick).toBe(finalSnap.tick);
      expect(replayed.phase).toBe(finalSnap.phase);
      expect(replayed.score).toBe(finalSnap.score);
      expect(replayed.combo).toBe(finalSnap.combo);
      expect(replayed.comboTimer).toBe(finalSnap.comboTimer);
      expect(replayed.difficulty).toBe(finalSnap.difficulty);
      expect(replayed.killsThisSortie).toBe(finalSnap.killsThisSortie);
      expect(replayed.player.x).toBe(finalSnap.player.x);
      expect(replayed.player.y).toBe(finalSnap.player.y);
      expect(replayed.player.vx).toBe(finalSnap.player.vx);
      expect(replayed.player.vy).toBe(finalSnap.player.vy);
      expect(replayed.player.angleDeg).toBe(finalSnap.player.angleDeg);
      expect(replayed.player.health).toBe(finalSnap.player.health);
      expect(replayed.enemies.length).toBe(finalSnap.enemies.length);
      expect(replayed.projectiles.length).toBe(finalSnap.projectiles.length);
    },
  );
});

describe('Gate 3B: Adversarial Gameplay & Physics Mechanic Proofs (Live Steam Data)', () => {
  it('enforces stall-whip turn differentials (original 10/4, superboost 10/1) & laser 1/3 turn divisor + visible piercing beam', () => {
    // Original: 10 deg coasting vs 4 deg boosting
    const simOrig = new Simulation(steamData);
    launchToPlaying(simOrig, { weapon: 0, body: 0, engine: 0 }, 'normal', 2001);
    let snap = simOrig.step({ left: false, right: true, thrust: false, fire: false });
    expect(snap.player.angleDeg - snap.player.prevAngleDeg).toBeCloseTo(10, 6);
    snap = simOrig.step({ left: true, right: false, thrust: true, fire: false });
    expect(snap.player.angleDeg - snap.player.prevAngleDeg).toBeCloseTo(-4, 6);

    // Superboost: 10 deg coasting vs 1 deg boosting + boostadd 2 + maxspeed 11
    const simSuper = new Simulation(steamData);
    launchToPlaying(simSuper, { weapon: 0, body: 0, engine: 1 }, 'normal', 2002);
    snap = simSuper.step({ left: false, right: true, thrust: false, fire: false });
    expect(snap.player.angleDeg - snap.player.prevAngleDeg).toBeCloseTo(10, 6);
    snap = simSuper.step({ left: false, right: true, thrust: true, fire: false });
    expect(snap.player.angleDeg - snap.player.prevAngleDeg).toBeCloseTo(1, 6);

    // Laser: 1/3 turn divisor while firing (both coasting & boosting) + beam visible in snapshot.projectiles + pierces 2 enemies
    const simLaser = new Simulation(steamData);
    const preLaser = launchToPlaying(simLaser, { weapon: 1, body: 0, engine: 0 }, 'normal', 2003);
    const f1 = simLaser.spawnEnemy('Fighter', preLaser.player.x, preLaser.player.y - 120);
    const f2 = simLaser.spawnEnemy('Fighter', preLaser.player.x, preLaser.player.y - 260);

    snap = simLaser.step({ left: false, right: false, thrust: false, fire: true });
    const beams = snap.projectiles.filter((p) => p.kind === 'laser');
    expect(beams).toHaveLength(1);
    expect(beams[0]!.piercing).toBe(true);
    expect(beams[0]!.beamLength).toBe(520);
    // Both aligned fighters took 1 laser dmg in a single piercing tick
    expect(snap.enemies.find((e) => e.id === f1.id)!.health).toBe(5);
    expect(snap.enemies.find((e) => e.id === f2.id)!.health).toBe(5);

    // Turn divisor check while firing laser
    snap = simLaser.step({ left: false, right: true, thrust: false, fire: true });
    expect(snap.player.angleDeg - snap.player.prevAngleDeg).toBeCloseTo(10 / 3, 6);
    snap = simLaser.step({ left: false, right: true, thrust: true, fire: true });
    expect(snap.player.angleDeg - snap.player.prevAngleDeg).toBeCloseTo(4 / 3, 6);

    // Cease-fire removes beam on next tick
    const cease = simLaser.step(IDLE_INPUT);
    expect(cease.projectiles.filter((p) => p.kind === 'laser')).toHaveLength(0);
  });

  it('proves gungine rear-bullet propulsion, spread 1.5 recoil + 5 pellets, missiles 4-cap + homing + sndmisempty, cannon 79-tick AOE + heal lockout', () => {
    // 1. Gungine rear bullets while boosting (and none while coasting)
    const simGun = new Simulation(steamData);
    const preGun = launchToPlaying(simGun, { weapon: 0, body: 0, engine: 2 }, 'normal', 2101);
    const coastSnap = simGun.step(IDLE_INPUT);
    expect(coastSnap.projectiles.filter((p) => p.fromGungine)).toHaveLength(0);

    // Place a BigBoat (300px wide hull) directly beneath the upward-facing plane so rear gungine bullets strike dead-on
    const rearTarget = simGun.spawnEnemy('BigBoat', preGun.player.x, 0);
    let sawGungineCue = false;
    let sawRearBullet = false;
    for (let t = 0; t < 24; t++) {
      const s = simGun.step({ left: false, right: false, thrust: true, fire: false });
      const rearBullets = s.projectiles.filter((p) => p.fromGungine);
      if (rearBullets.length > 0) {
        sawRearBullet = true;
        // Player faces -90 deg (up), so rear bullet travels at +90 deg (+vy)
        expect(rearBullets[0]!.vy).toBeGreaterThan(20);
        expect(rearBullets[0]!.dmg).toBe(4);
      }
      if (s.audioEvents.some((e) => e.cue === 'sndgungine')) sawGungineCue = true;
    }
    expect(sawRearBullet).toBe(true);
    expect(sawGungineCue).toBe(true);
    const postRearBoat = simGun.getSnapshot().enemies.find((e) => e.id === rearTarget.id)!;
    expect(postRearBoat.health).toBeLessThan(rearTarget.maxHealth);
    expect((rearTarget.maxHealth - postRearBoat.health) % 4).toBe(0);

    // 2. Spread: 1.5 recoil kickback + 5 fanned pellets at 6 deg steps
    const simSpread = new Simulation(steamData);
    const preSpread = launchToPlaying(simSpread, { weapon: 2, body: 0, engine: 0 }, 'normal', 2102);
    const spreadSnap = simSpread.step({ left: false, right: false, thrust: false, fire: true });
    const pellets = spreadSnap.projectiles.filter((p) => p.kind === 'spreadbullet');
    expect(pellets).toHaveLength(5);
    const angles = pellets.map((p) => p.angleDeg).sort((a, b) => a - b);
    expect(angles).toEqual([-102, -96, -90, -84, -78]);
    // Gravity (+0.2), friction (0.04), and recoil opposite -90 deg (+1.5 to vy)
    const expectedVy = (preSpread.player.vy + 0.2) * (1 - 0.04) + 1.5;
    expect(spreadSnap.player.vy).toBeCloseTo(expectedVy, 5);
    expect(spreadSnap.audioEvents.some((e) => e.cue === 'sndspread')).toBe(true);

    // 3. Missiles: strict 4-active cap, homing acceleration 4 -> 14, sndmisempty at cap
    const simMis = new Simulation(steamData);
    const preMis = launchToPlaying(simMis, { weapon: 3, body: 0, engine: 0 }, 'normal', 2103);
    simMis.spawnEnemy('BigBoat', preMis.player.x + 320, 0);
    let sawEmpty = false;
    let sawHomingAccel = false;
    let maxActiveMissiles = 0;
    for (let t = 0; t < 35; t++) {
      const s = simMis.step({ left: false, right: false, thrust: true, fire: true });
      const active = s.projectiles.filter((p) => p.owner === 'player' && p.kind === 'missile');
      expect(active.length).toBeLessThanOrEqual(4);
      maxActiveMissiles = Math.max(maxActiveMissiles, active.length);
      if (active.some((m) => Math.hypot(m.vx, m.vy) > 10 && m.targetId !== null)) {
        sawHomingAccel = true;
      }
      if (s.audioEvents.some((e) => e.cue === 'sndmisempty')) sawEmpty = true;
    }
    expect(maxActiveMissiles).toBe(4);
    expect(sawEmpty).toBe(true);
    expect(sawHomingAccel).toBe(true);

    // 4a. Cannon: 79-tick interval + plasmaball 80px AOE detonation
    const simCanAoe = new Simulation(steamData);
    const preCanAoe = launchToPlaying(simCanAoe, { weapon: 4, body: 0, engine: 4 }, 'normal', 2104);
    const targetY = preCanAoe.player.y - 75;
    const centerAce = simCanAoe.spawnEnemy('Ace', -18, targetY);
    const insideAoe = simCanAoe.spawnEnemy('Fighter', 65, targetY); // moves left into ~47px (< 80px AOE)
    const outsideAoe = simCanAoe.spawnEnemy('Fighter', 165, targetY); // stays ~145px (> 80 + 12px AOE)

    let s = simCanAoe.step({ left: false, right: false, thrust: false, fire: true });
    expect(s.player.fireCooldown).toBe(79);
    const plasma = s.projectiles.find((p) => p.kind === 'plasmaball');
    expect(plasma).toBeDefined();
    expect(plasma!.aoeRadius).toBe(80);
    expect(plasma!.dmg).toBe(20);

    let sawExplo = false;
    for (let t = 0; t < 12; t++) {
      s = simCanAoe.step(IDLE_INPUT);
      if (s.audioEvents.some((e) => e.cue === 'sndcannonexplo')) sawExplo = true;
    }
    expect(sawExplo).toBe(true);
    expect(s.enemies.find((e) => e.id === centerAce.id)!.health).toBeLessThan(60);
    expect(s.enemies.find((e) => e.id === insideAoe.id)).toBeUndefined();
    expect(s.enemies.find((e) => e.id === outsideAoe.id)).toBeDefined();

    // 4b. Cannon: fireCooldown > 0 strictly locks out healing for all 79 ticks before 12-tick heal delay + emits sndcannonreload
    const simCanLock = new Simulation(steamData);
    launchToPlaying(simCanLock, { weapon: 4, body: 0, engine: 4 }, 'normal', 2105);
    simCanLock.damagePlayer(8);
    const damagedHp = simCanLock.getSnapshot().player.health;

    s = simCanLock.step({ left: false, right: false, thrust: false, fire: true });
    expect(s.player.fireCooldown).toBe(79);
    expect(s.player.healing).toBe(false);

    let sawReload = false;
    for (let t = 0; t < 78; t++) {
      s = simCanLock.step(IDLE_INPUT);
      expect(s.player.fireCooldown).toBeGreaterThan(0);
      expect(s.player.healing).toBe(false);
      expect(s.player.healingTicks).toBe(0);
      expect(s.player.health).toBe(damagedHp);
    }
    // Tick 79 post-fire drops fireCooldown to 0 and emits sndcannonreload
    s = simCanLock.step(IDLE_INPUT);
    if (s.audioEvents.some((e) => e.cue === 'sndcannonreload')) sawReload = true;
    expect(s.player.fireCooldown).toBe(0);
    expect(sawReload).toBe(true);
    expect(s.player.healingTicks).toBe(1);

    // 11 more cease-fire ticks complete the 12-tick heal delay and start healing (+0.16)
    for (let t = 0; t < 11; t++) {
      s = simCanLock.step(IDLE_INPUT);
    }
    expect(s.player.healing).toBe(true);
    expect(s.player.health).toBeCloseTo(damagedHp + 0.16, 5);
  });

  it('enforces cease-fire healingspd across original (0.16), bomb (0.12), and URAUSER (0.01) while halting immediately on 1-tick fire', () => {
    const cases: Array<{ loadout: Loadout; expectedHealRate: number }> = [
      { loadout: { weapon: 0, body: 0, engine: 4 }, expectedHealRate: 0.16 },
      { loadout: { weapon: 0, body: 4, engine: 4 }, expectedHealRate: 0.12 },
      { loadout: { weapon: 5, body: 5, engine: 5 }, expectedHealRate: 0.01 },
    ];

    for (let idx = 0; idx < cases.length; idx++) {
      const { loadout, expectedHealRate } = cases[idx]!;
      const sim = new Simulation(steamData);
      launchToPlaying(sim, loadout, 'normal', 2200 + idx);
      sim.damagePlayer(6);
      const startHp = sim.getSnapshot().player.health;

      // 11 cease-fire ticks do not heal yet
      for (let t = 0; t < 11; t++) {
        const s = sim.step(IDLE_INPUT);
        expect(s.player.healing).toBe(false);
        expect(s.player.health).toBe(startHp);
      }
      // 12th cease-fire tick engages healing at exact healingspd
      const heal1 = sim.step(IDLE_INPUT);
      expect(heal1.player.healing).toBe(true);
      expect(heal1.player.health).toBeCloseTo(startHp + expectedHealRate, 6);

      // Firing for a single tick immediately halts healing
      const interrupt = sim.step({ left: false, right: false, thrust: false, fire: true });
      expect(interrupt.player.healing).toBe(false);
      expect(interrupt.player.healingTicks).toBe(0);
      expect(interrupt.player.health).toBeCloseTo(startHp + expectedHealRate, 6);
    }
  });

  it('proves water buoyancy/pitch/damage vs waterproof underwater immunity, and space ceiling pushback + 0.6 underwater space damage', () => {
    // 1. Original engine in ocean: buoyancy, upward pitch rotation (3 deg/tick), waterdmg 0.4 -> waterdmglowhp 0.05
    const simWater = new Simulation(steamData);
    launchToPlaying(simWater, { weapon: 0, body: 0, engine: 0 }, 'normal', 2301);
    for (let i = 0; i < 18; i++) {
      simWater.step({ left: false, right: true, thrust: false, fire: false }); // face +90 (down)
    }
    // Tilt slightly off vertical (+80 deg) so pitch restoration toward -90 deg is unambiguous
    simWater.step({ left: true, right: false, thrust: false, fire: false });
    let sawHighHpWaterDmg = false;
    let sawPitchRestore = false;
    let prevAngle: number | null = null;
    for (let t = 0; t < 80; t++) {
      const prevHp = simWater.getSnapshot().player.health;
      const s = simWater.step({ left: false, right: false, thrust: t < 38, fire: false });
      const hitByEnemy = s.audioEvents.some((e) => e.cue === 'sndplayerhit');
      if (s.player.underwater && !hitByEnemy) {
        if (Math.abs(prevHp - s.player.health - 0.4) < 1e-5) {
          sawHighHpWaterDmg = true;
        }
        if (prevAngle !== null && Math.abs(prevAngle - s.player.angleDeg - 3) < 1e-4) {
          sawPitchRestore = true;
        }
        prevAngle = s.player.angleDeg;
      }
    }
    expect(sawHighHpWaterDmg).toBe(true);
    expect(sawPitchRestore).toBe(true);

    // 2. Underwater engine (waterproof: true): 0 water damage even while deeply submerged
    const simSub = new Simulation(steamData);
    launchToPlaying(simSub, { weapon: 0, body: 0, engine: 3 }, 'normal', 2302);
    for (let i = 0; i < 18; i++) {
      simSub.step({ left: false, right: true, thrust: false, fire: false });
    }
    let underwaterTicks = 0;
    for (let t = 0; t < 85; t++) {
      const s = simSub.step({ left: false, right: false, thrust: t < 55, fire: false });
      if (s.player.underwater) {
        underwaterTicks++;
        expect(s.player.health).toBe(s.player.maxHealth);
      }
    }
    expect(underwaterTicks).toBeGreaterThan(10);

    // 3. Space ceiling (y < -1300): stall pushback & exact 0.6 space damage for underwater engine (both high HP and low HP)
    const simSpaceSub = new Simulation(steamData);
    launchToPlaying(simSpaceSub, { weapon: 0, body: 0, engine: 3 }, 'normal', 2303);
    let sawSubHighSpaceDmg = false;
    let sawSubLowSpaceDmg = false;
    let sawSpacePushback = false;
    for (let t = 0; t < 240; t++) {
      const prev = simSpaceSub.getSnapshot();
      const s = simSpaceSub.step({ left: false, right: false, thrust: true, fire: false });
      const hitByEnemy = s.audioEvents.some((e) => e.cue === 'sndplayerhit');
      if (s.player.inSpace && !hitByEnemy) {
        if (s.player.envSpaceFactor > 0 && s.player.vy > prev.player.vy) {
          sawSpacePushback = true;
        }
        const delta = prev.player.health - s.player.health;
        if (prev.player.health / prev.player.maxHealth >= 0.34 && Math.abs(delta - 0.6) < 1e-5) {
          sawSubHighSpaceDmg = true;
          // Drop HP below 33.33% to verify spacedmglowhp is ALSO 0.6 for underwater engine!
          simSpaceSub.damagePlayer(s.player.health - 4);
        } else if (
          prev.player.health / prev.player.maxHealth < 0.333333 &&
          Math.abs(delta - 0.6) < 1e-5
        ) {
          sawSubLowSpaceDmg = true;
          break;
        }
      }
    }
    expect(sawSubHighSpaceDmg).toBe(true);
    expect(sawSubLowSpaceDmg).toBe(true);
    expect(sawSpacePushback).toBe(true);
  });

  it('proves melee 0 self-dmg/hitstop, original 10-tick hitstop, nuke 0.25 impactdmgmult + post-death blast profile stats, and bomb ordnance drop', () => {
    // Melee body: 0 self-impact damage, impactsleeptime 0
    const simMelee = new Simulation(steamData);
    const preMelee = launchToPlaying(simMelee, { weapon: 0, body: 2, engine: 0 }, 'normal', 2401);
    simMelee.spawnEnemy('Fighter', preMelee.player.x, preMelee.player.y - 22);
    for (let t = 0; t < 8; t++) {
      const s = simMelee.step({ left: false, right: false, thrust: true, fire: false });
      expect(s.hitstopTicks).toBe(0);
    }
    const meleeSnap = simMelee.getSnapshot();
    expect(meleeSnap.player.health).toBe(11);
    expect(meleeSnap.killsByKind['Fighter']).toBe(1);

    // Original body: impactsleeptime === 10 on collision
    const simOrig = new Simulation(steamData);
    const preOrig = launchToPlaying(simOrig, { weapon: 0, body: 0, engine: 0 }, 'normal', 2402);
    const origAce = simOrig.spawnEnemy('Ace', preOrig.player.x, preOrig.player.y - 16);
    let maxOrigHitstop = 0;
    for (let t = 0; t < 4; t++) {
      const s = simOrig.step({ left: false, right: false, thrust: true, fire: false });
      maxOrigHitstop = Math.max(maxOrigHitstop, s.hitstopTicks);
    }
    const origSnap = simOrig.getSnapshot();
    const origSelfDmg = origSnap.player.maxHealth - origSnap.player.health;
    const origAceDmg = origAce.maxHealth - origSnap.enemies.find((e) => e.id === origAce.id)!.health;
    expect(maxOrigHitstop).toBe(10);
    expect(origSelfDmg).toBeGreaterThan(0);

    // Nuke body: impactdmgmult 0.25 deals & receives more ram dmg + post-death 420px radial blast updates profile stats
    const simNukeRam = new Simulation(steamData);
    const preNukeRam = launchToPlaying(simNukeRam, { weapon: 0, body: 3, engine: 0 }, 'normal', 2402);
    const nukeAce = simNukeRam.spawnEnemy('Ace', preNukeRam.player.x, preNukeRam.player.y - 16);
    for (let t = 0; t < 4; t++) {
      simNukeRam.step({ left: false, right: false, thrust: true, fire: false });
    }
    const nukeRamSnap = simNukeRam.getSnapshot();
    const nukeSelfDmg = nukeRamSnap.player.maxHealth - nukeRamSnap.player.health;
    const nukeAceDmg =
      nukeAce.maxHealth - nukeRamSnap.enemies.find((e) => e.id === nukeAce.id)!.health;
    expect(nukeSelfDmg).toBeGreaterThan(origSelfDmg);
    expect(nukeAceDmg).toBeGreaterThan(origAceDmg);

    // Post-death nuke kills counted into profile stats at gameover
    const simNukeDeath = new Simulation(steamData);
    const baseProfile = createDefaultProfile();
    baseProfile.stats.sorties = 3;
    baseProfile.stats.totalScore = 500;
    simNukeDeath.setProfile(baseProfile);
    const preDeath = launchToPlaying(simNukeDeath, { weapon: 0, body: 3, engine: 0 }, 'normal', 2403);
    simNukeDeath.spawnEnemy('Fighter', preDeath.player.x + 260, preDeath.player.y);
    simNukeDeath.spawnEnemy('Boat', preDeath.player.x - 240, 0);
    simNukeDeath.damagePlayer(999);
    expect(simNukeDeath.getSnapshot().player.nukeTriggered).toBe(true);
    let deathSnap = simNukeDeath.getSnapshot();
    while (deathSnap.phase === 'dying') {
      deathSnap = simNukeDeath.step(IDLE_INPUT);
    }
    expect(deathSnap.phase).toBe('gameover');
    expect(deathSnap.player.nukeRadius).toBe(420);
    expect(deathSnap.killsThisSortie).toBeGreaterThanOrEqual(2);
    expect(deathSnap.score).toBeGreaterThan(0);
    expect(deathSnap.profile.highScoreNormal).toBe(deathSnap.score);
    expect(deathSnap.profile.stats.sorties).toBe(4);
    expect(deathSnap.profile.stats.totalScore).toBe(500 + deathSnap.score);

    // Bomb body: ordnance drop every 24 ticks with gravity acceleration & 48px AOE detonation
    const simBomb = new Simulation(steamData);
    launchToPlaying(simBomb, { weapon: 0, body: 4, engine: 4 }, 'normal', 2404);
    const drop1 = simBomb.step({ left: false, right: false, thrust: true, fire: false });
    const bomb1 = drop1.projectiles.find((p) => p.kind === 'bomb');
    expect(bomb1).toBeDefined();
    expect(bomb1!.aoeRadius).toBe(48);
    expect(bomb1!.dmg).toBe(16);
    const dropNext = simBomb.step(IDLE_INPUT);
    const bomb1After = dropNext.projectiles.find((p) => p.id === bomb1!.id)!;
    expect(bomb1After.vy).toBeGreaterThan(bomb1!.vy); // gravity-assisted fall
  });

  it('proves x1..x20 MAX combo math, sndmaxcombo, decay warning < 60 ticks, and reset to x1', () => {
    const sim = new Simulation(steamData);
    const pre = launchToPlaying(sim, { weapon: 4, body: 0, engine: 4 }, 'normal', 2501);

    // Spawn 20 fighters clustered so single cannon plasmaball wipes all 20 -> combo 1 -> 20
    for (let i = 0; i < 20; i++) {
      sim.spawnEnemy('Fighter', -76, pre.player.y - 108 - (i % 4) * 5);
    }
    let sawMaxComboCue = false;
    for (let t = 0; t < 20; t++) {
      const s = sim.step({ left: false, right: false, thrust: false, fire: true });
      if (s.combo === 20 && s.audioEvents.some((e) => e.cue === 'sndmaxcombo')) {
        sawMaxComboCue = true;
      }
    }
    const maxSnap = sim.getSnapshot();
    expect(maxSnap.combo).toBe(20);
    expect(sawMaxComboCue).toBe(true);
    // Exact arithmetic series for 20 Fighter (20 pts) kills:
    // kills 1..19 give multipliers 2..20, kill 20 stays capped at 20 -> 20 * (sum(2..20) + 20) = 20 * 229 = 4580
    expect(maxSnap.score).toBe(20 * ((2 + 20) * 19 / 2 + 20));

    // Decay without killing: warning engages at comboTimer < 60 with sndcombowarn, drops to 1 at 0 with sndcombodrop
    let warnTickTimer = -1;
    let sawWarnCue = false;
    let sawDropCue = false;
    for (let t = 0; t < 260; t++) {
      const s = sim.step({
        left: false,
        right: t < 7,
        thrust: t >= 7,
        fire: false,
      });
      if (s.comboWarning && warnTickTimer === -1) {
        warnTickTimer = s.comboTimer;
      }
      if (s.audioEvents.some((e) => e.cue === 'sndcombowarn')) sawWarnCue = true;
      if (s.audioEvents.some((e) => e.cue === 'sndcombodrop')) {
        sawDropCue = true;
        break;
      }
    }
    expect(warnTickTimer).toBe(59);
    expect(sawWarnCue).toBe(true);
    expect(sawDropCue).toBe(true);
    expect(sim.getSnapshot().combo).toBe(1);
  });

  it('proves Normal vs SFMT enemy wave parity (SFMT Jet fires, SFMT BigBoat 36-salvo, SFMT +50 difficulty burst)', () => {
    // 1. Jet: Normal passive vs SFMT firing (spawn 3 Jets -> weight 75 >= 60 saturates director so zero Fighters interfere)
    const simNormJet = new Simulation(steamData);
    launchToPlaying(simNormJet, { weapon: 0, body: 0, engine: 4 }, 'normal', 2601);
    simNormJet.spawnEnemy('Jet', -220, -200);
    simNormJet.spawnEnemy('Jet', -260, -240);
    simNormJet.spawnEnemy('Jet', -300, -280);
    let normJetShots = 0;
    for (let t = 0; t < 45; t++) {
      const s = simNormJet.step(IDLE_INPUT);
      expect(s.enemies.every((e) => e.kind === 'Jet')).toBe(true);
      normJetShots += s.projectiles.filter((p) => p.owner === 'enemy').length;
    }
    expect(normJetShots).toBe(0);

    const simSfmtJet = new Simulation(steamData);
    launchToPlaying(simSfmtJet, { weapon: 0, body: 0, engine: 4 }, 'sfmt', 2601);
    simSfmtJet.spawnEnemy('Jet', -220, -200);
    simSfmtJet.spawnEnemy('Jet', -260, -240);
    simSfmtJet.spawnEnemy('Jet', -300, -280);
    let sfmtJetShots = 0;
    for (let t = 0; t < 45; t++) {
      const s = simSfmtJet.step(IDLE_INPUT);
      sfmtJetShots += s.projectiles.filter((p) => p.owner === 'enemy').length;
    }
    expect(sfmtJetShots).toBeGreaterThan(0);

    // 2. BigBoat: Normal 18-bullet salvo (210 HP) vs SFMT 36-bullet salvo (160 HP)
    const measureBigBoatSalvo = (mode: 'normal' | 'sfmt') => {
      const sim = new Simulation(steamData);
      launchToPlaying(sim, { weapon: 0, body: 5, engine: 4 }, mode, 2602);
      const boat = sim.spawnEnemy('BigBoat', 120, 0);
      let peakSalvo = 0;
      for (let t = 0; t < 120; t++) {
        const s = sim.step(IDLE_INPUT);
        const tracked = s.enemies.find((e) => e.id === boat.id);
        if (tracked && tracked.salvoRemaining > peakSalvo) {
          peakSalvo = tracked.salvoRemaining;
        }
      }
      return { maxHealth: boat.maxHealth, peakSalvo };
    };
    const normBoat = measureBigBoatSalvo('normal');
    const sfmtBoat = measureBigBoatSalvo('sfmt');
    expect(normBoat.maxHealth).toBe(210);
    expect(normBoat.peakSalvo).toBe(18);
    expect(sfmtBoat.maxHealth).toBe(160);
    expect(sfmtBoat.peakSalvo).toBe(36);

    // 3. Difficulty ramp after 60 ticks: Normal (+1+1+1 = +3 -> 63) vs SFMT (+1+1+1+50 = +53 -> 113)
    const simNormDiff = new Simulation(steamData);
    launchToPlaying(simNormDiff, { weapon: 0, body: 0, engine: 4 }, 'normal', 2603);
    for (let t = 0; t < 60; t++) simNormDiff.step(IDLE_INPUT);

    const simSfmtDiff = new Simulation(steamData);
    launchToPlaying(simSfmtDiff, { weapon: 0, body: 0, engine: 4 }, 'sfmt', 2603);
    for (let t = 0; t < 60; t++) simSfmtDiff.step(IDLE_INPUT);

    expect(simNormDiff.getSnapshot().difficulty).toBe(63);
    expect(simSfmtDiff.getSnapshot().difficulty).toBe(113);
    expect(simSfmtDiff.getSnapshot().difficulty - simNormDiff.getSnapshot().difficulty).toBe(50);
  });

  it('tracks live Steam 90-mission objectives and unlocks parts + SFMT progression', () => {
    const sim = new Simulation(steamData);
    sim.setProfile(createDefaultProfile());
    const pre = launchToPlaying(sim, { weapon: 0, body: 0, engine: 0 }, 'normal', 2701);

    // Default active missions for [0,0,0] from Steam global.json:
    // #0: [0,0,0] kill 5 Fighters in single sortie
    // #30: [1,0,0] destroy 30 enemies
    // #60: [2,0,0] score 1000 points
    expect(pre.activeMissions.map((m) => m.id)).toEqual([0, 30, 60]);

    // Let Ace Pilot Bot hunt a wave of Fighters to clear both Mission #0 (5 Fighters) and Mission #60 (1000 pts)
    for (let i = 0; i < 12; i++) {
      sim.spawnEnemy('Fighter', (i % 2 === 0 ? 1 : -1) * (140 + i * 24), -260 - (i % 3) * 40);
    }
    sim.setAutopilot(true);
    let sawPopup = false;
    for (let t = 0; t < 2400; t++) {
      const s = sim.step(IDLE_INPUT);
      if (s.audioEvents.some((e) => e.cue === 'sndpopup')) sawPopup = true;
      if (
        s.profile.completedMissions.includes(0) &&
        s.profile.completedMissions.includes(60)
      ) {
        break;
      }
    }

    const post = sim.getSnapshot();
    expect(sawPopup).toBe(true);
    expect(post.profile.completedMissions).toContain(0);
    expect(post.profile.completedMissions).toContain(60);
    // Completing 1 weapon mission unlocks Weapon 1 (laser); 1 engine mission unlocks Engine 1 (superboost)
    expect(post.profile.unlockedWeapons).toContain(1);
    expect(post.profile.unlockedEngines).toContain(1);
    // Active missions advance to next tier ([0,0,1] id=1 and [2,0,1] id=61)
    expect(post.activeMissions.map((m) => m.id)).toContain(1);
    expect(post.activeMissions.map((m) => m.id)).toContain(61);
  });
});

describe('Gate 3B: Renderer / Shader & Audio Stem Parity Proofs', () => {
  it('verifies computePostShaderUniforms (100%/50%/20% HP), upright enemy hull transforms, pure uniform_backcol water remap, and all 12 palettes', () => {
    const sim = new Simulation(steamData);
    const playSnap = launchToPlaying(sim, { weapon: 0, body: 0, engine: 0 }, 'normal', 2801);
    const pal = getPaletteById('original');

    // 100% HP
    const u100 = computePostShaderUniforms(playSnap, 50, -180, 1.0, pal, 1200, 800);
    expect(u100.healthRadius[0] / u100.healthRadius[1]).toBe(1);
    expect(u100.healthRadius[2]).toBe(0);
    expect(u100.cameraPosition[0]).toBeCloseTo(-180 / 400, 6);

    // 50% HP
    const snap50: SimSnapshot = {
      ...playSnap,
      player: { ...playSnap.player, health: 8, maxHealth: 16 },
    };
    const u50 = computePostShaderUniforms(snap50, 50, -180, 1.0, pal, 600, 400);
    expect(u50.healthRadius[0]).toBe(8);
    expect(u50.healthRadius[1]).toBe(16);
    expect(u50.healthRadius[2]).toBe(0);

    // 20% HP (critical < 33.3333% pulses healthRadius[2] between 1 and 0)
    const snap20: SimSnapshot = {
      ...playSnap,
      player: { ...playSnap.player, health: 3.2, maxHealth: 16 },
    };
    const u20On = computePostShaderUniforms(snap20, 50, -180, 0.0, pal, 600, 400);
    const u20Off = computePostShaderUniforms(snap20, 50, -180, 0.1, pal, 600, 400);
    expect(u20On.healthRadius[0] / u20On.healthRadius[1]).toBeCloseTo(0.2, 6);
    expect(u20On.healthRadius[2]).toBe(1);
    expect(u20Off.healthRadius[2]).toBe(0);

    // Upright naval/blimp transforms vs rotating aircraft/missiles
    const uprightKinds: EnemyKind[] = ['Boat', 'BigBoat', 'Submarine', 'AceMarine', 'Blimp'];
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
      expect(resolveEnemyRenderTransform({ kind, vx: -5, angleDeg: 180 })).toEqual({
        angleRad: Math.PI,
        scaleX: 1,
        scaleY: 1,
      });
    }

    // Pure uniform_backcol water remap & quantized 2x2 health circle in POST_WATER_FRAG
    expect(POST_WATER_FRAG).not.toContain('seaBackCol');
    expect(POST_WATER_FRAG).toContain('floor((playerPosition.xy - pixelPosition) * 0.5) * 2.0');
    expect(POST_WATER_FRAG).toContain('length(playerToPixel) / 350.0');
    expect(POST_WATER_FRAG).toContain('finalColor = uniform_colors[3];');
    expect(POST_WATER_FRAG).toContain('finalColor = uniform_colors[6];');
    expect(POST_WATER_FRAG).toContain('finalColor = uniform_backcol;');
    expect(POST_WATER_FRAG).toContain('outColor = uniform_backcol;');

    // All 12 palettes: unique IDs, valid RGBA ranges, non-colliding water remap keys
    expect(PALETTES).toHaveLength(12);
    const ids = new Set(PALETTES.map((p) => p.id));
    expect(ids.size).toBe(12);
    for (const required of [
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
      'noir',
      'toxic',
    ]) {
      expect(ids.has(required)).toBe(true);
    }
    for (const p of PALETTES) {
      expect(p.colors).toHaveLength(8);
      expect(p.colors[0]).toEqual([0, 0, 0, 0]);
      expect(p.backcol[3]).toBe(1);
      for (let i = 1; i <= 7; i++) {
        expect(p.colors[i]![3]).toBe(1);
        for (const c of p.colors[i]!) {
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(1);
        }
      }
      // Every pair among water-matched source colors {1,2,4,5,6,7} exceeds shader colDelta (0.01)
      const keys = [1, 2, 4, 5, 6, 7] as const;
      for (let a = 0; a < keys.length; a++) {
        for (let b = a + 1; b < keys.length; b++) {
          const ka = keys[a]!;
          const kb = keys[b]!;
          expect(rgbDistance(p.colors[ka]!, p.colors[kb]!)).toBeGreaterThan(0.01);
        }
      }
    }
  });

  it('verifies audio stem parity across all 125 combos + alarm + urauser + <0.01ms phase offset + spatial *dist routing', () => {
    const parts: PartIndex[] = [0, 1, 2, 3, 4];
    let verifiedCombos = 0;

    for (const weapon of parts) {
      for (const body of parts) {
        for (const engine of parts) {
          verifiedCombos++;
          const res = resolveActiveStems('playing', false, { weapon, body, engine }, 1.0);
          expect(res).toEqual({
            musicState: 'combat',
            stems: [
              `luftrauser_bass${body + 1}`,
              `luftrauser_drums${engine + 1}`,
              `luftrauser_lead${weapon + 1}`,
            ],
            alarmActive: false,
          });
        }
      }
    }
    expect(verifiedCombos).toBe(125);

    // Low-HP alarm threshold strictly < 0.333333
    const atBoundary = resolveActiveStems(
      'playing',
      false,
      { weapon: 1, body: 2, engine: 3 },
      LOW_HP_ALARM_THRESHOLD,
    );
    expect(atBoundary.alarmActive).toBe(false);
    expect(atBoundary.stems).not.toContain('luftrauser_drums_alarm');

    const belowBoundary = resolveActiveStems(
      'playing',
      false,
      { weapon: 1, body: 2, engine: 3 },
      LOW_HP_ALARM_THRESHOLD - 0.0001,
    );
    expect(belowBoundary.alarmActive).toBe(true);
    expect(belowBoundary.stems).toEqual([
      'luftrauser_bass3',
      'luftrauser_drums4',
      'luftrauser_lead2',
      'luftrauser_drums_alarm',
    ]);

    // Special states: URAUSER [5,5,5], partial ???, hangar, pause
    expect(
      resolveActiveStems('playing', false, { weapon: 5, body: 5, engine: 5 }, 0.8),
    ).toEqual({
      musicState: 'urauser',
      stems: ['luftrauser__urauser'],
      alarmActive: false,
    });
    expect(
      resolveActiveStems('playing', false, { weapon: 5, body: 5, engine: 5 }, 0.2),
    ).toEqual({
      musicState: 'urauser',
      stems: ['luftrauser__urauser', 'luftrauser_drums_alarm'],
      alarmActive: true,
    });
    expect(
      resolveActiveStems('playing', false, { weapon: 5, body: 0, engine: 0 }, 0.5),
    ).toEqual({
      musicState: 'unknown',
      stems: ['luftrauser__unknown'],
      alarmActive: false,
    });
    expect(
      resolveActiveStems('hangar', false, { weapon: 0, body: 0, engine: 0 }, 1.0),
    ).toEqual({
      musicState: 'hangar',
      stems: ['luftrauser__hangar'],
      alarmActive: false,
    });
    expect(
      resolveActiveStems('playing', true, { weapon: 5, body: 5, engine: 5 }, 0.1),
    ).toEqual({
      musicState: 'pause',
      stems: ['luftrauser__pause'],
      alarmActive: false,
    });

    // Phase-lock offset precision (< 0.01ms drift across arbitrary durations & session times)
    const epoch = 4.25;
    for (const duration of [SYNTH_LOOP_DURATION_SEC, 13.714285714285714]) {
      for (const elapsed of [0.0005, 1.333, duration, duration * 17 + 2.918273, duration * 1000 + 0.123456]) {
        const ctxTime = epoch + elapsed;
        const offset = computePhaseOffset(ctxTime, epoch, duration);
        const expected = elapsed - Math.floor(elapsed / duration) * duration;
        const rawDiff = Math.abs(offset - expected);
        const wrappedDriftMs = Math.min(rawDiff, duration - rawDiff) * 1000;
        expect(wrappedDriftMs).toBeLessThan(0.01);
      }
    }

    // Spatial *dist routing, pan clamp [-0.85, +0.85], and distance attenuation
    const near = resolveSpatialSfx('sndebullet', 300, 0);
    expect(near.resolvedCue).toBe('sndebullet');
    expect(near.gain).toBe(1);
    expect(near.pan).toBeCloseTo(300 / 380, 6);

    const farRight = resolveSpatialSfx('sndebullet', 350, 0);
    expect(farRight.resolvedCue).toBe('sndebulletdist');
    expect(farRight.gain).toBeLessThan(1);
    expect(farRight.pan).toBe(0.85);

    expect(resolveSpatialSfx('sndacespawn', -400, 0).resolvedCue).toBe('sndacespawndist');
    expect(resolveSpatialSfx('sndebullet2', 400, 0).resolvedCue).toBe('sndebullet2dist');
    expect(resolveSpatialSfx('sndmisspawn', -400, 0).resolvedCue).toBe('sndmisspawndist');

    const extremeLeft = resolveSpatialSfx('sndacespawn', -5000, 0);
    expect(extremeLeft.pan).toBe(-0.85);
    expect(extremeLeft.gain).toBe(0.2);
  });
});
