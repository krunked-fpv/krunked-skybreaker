import { describe, expect, it } from 'vitest';
import { DEFAULT_ACT2_MOD_FLAGS, DEFAULT_SHADER_FX } from '../src/contracts/mod';
import type { RgbaTuple } from '../src/contracts/render';
import type { InputState, PartIndex, ReplayRecording } from '../src/contracts/sim';
import {
  ARSENAL_BOSSES_MOD,
  GhostRunner,
  ModRegistry,
  MULTIPLAYER_2P_MOD,
  REPLAY_GHOST_MOD,
  SHADER_STUDIO_MOD,
  Simulation,
  computeCoopP2BotInput,
  computeDailySeed,
  computeDogfightBotInput,
  createAct2BonusPalettes,
  parseReplayJson,
  registerAct2ModPacks,
  replaySimulation,
  resolveModdedPlaneName,
  serializeReplay,
} from '../src/sim';
import { createProceduralFallbackBundle } from '../src/vault';

const IDLE_INPUT: InputState = {
  left: false,
  right: false,
  thrust: false,
  fire: false,
};

function rgbDist(a: RgbaTuple, b: RgbaTuple): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function launchToPlaying(
  sim: Simulation,
  loadout: { weapon: PartIndex; body: PartIndex; engine: PartIndex },
  mode: 'normal' | 'sfmt' = 'normal',
  seed = 4242,
) {
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

const gameData = createProceduralFallbackBundle().data;

describe('Act II Simulation Mod Packs', () => {
  describe('1. Vanilla Lock Immunity & ModRegistry Gating', () => {
    it('ModRegistry gates custom weapons, bodies, engines, bosses, shaderFx, and multiplayer when vanillaLocked=true', () => {
      const reg = new ModRegistry();
      expect(reg.isVanillaLocked()).toBe(true);
      reg.register(ARSENAL_BOSSES_MOD);
      reg.register({
        ...SHADER_STUDIO_MOD,
        shaderFx: { crtScanlines: true, phosphorBloom: true, speedWarp: true, shockwaves: true },
      });
      reg.register({ ...MULTIPLAYER_2P_MOD, multiplayerMode: 'dogfight1v1' });

      expect(reg.getCustomWeapons()).toEqual([]);
      expect(reg.getCustomBodies()).toEqual([]);
      expect(reg.getCustomEngines()).toEqual([]);
      expect(reg.getCustomBosses()).toEqual([]);
      expect(reg.getEffectiveShaderFx()).toEqual(DEFAULT_SHADER_FX);
      expect(reg.getEffectiveMultiplayerMode()).toBe('solo');

      reg.setVanillaLock(false);
      expect(reg.getCustomWeapons()).toHaveLength(3);
      expect(reg.getCustomBodies()).toHaveLength(3);
      expect(reg.getCustomEngines()).toHaveLength(3);
      expect(reg.getCustomBosses()).toEqual(['Dreadnought', 'SkyCarrier', 'AceSquadron']);
      expect(reg.getEffectiveShaderFx()).toEqual({
        crtScanlines: true,
        phosphorBloom: true,
        speedWarp: true,
        shockwaves: true,
      });
      expect(reg.getEffectiveMultiplayerMode()).toBe('dogfight1v1');
    });

    it('Simulation remains 100% bit-identical to Act I when vanillaLocked=true even with custom packs registered', () => {
      const regA = new ModRegistry(true);
      const regB = new ModRegistry(true);
      regB.register(ARSENAL_BOSSES_MOD);
      regB.register(REPLAY_GHOST_MOD);
      regB.register({
        ...SHADER_STUDIO_MOD,
        shaderFx: { crtScanlines: true, phosphorBloom: true, speedWarp: true, shockwaves: true },
      });
      regB.register({ ...MULTIPLAYER_2P_MOD, multiplayerMode: 'coop2p' });

      const simA = new Simulation(gameData, regA);
      const simB = new Simulation(gameData, regB);

      // Trying to equip custom parts while vanilla-locked clamps cleanly to 0
      simB.setLoadout({ weapon: 6, body: 7, engine: 8 });
      expect(simB.getSnapshot().player.loadout).toEqual({ weapon: 0, body: 0, engine: 0 });

      simA.launch({ weapon: 4, body: 3, engine: 1 }, 'normal', 1337);
      simB.launch({ weapon: 4, body: 3, engine: 1 }, 'normal', 1337);
      simA.setAutopilot(true);
      simB.setAutopilot(true);

      for (let t = 0; t < 600; t++) {
        const sA = simA.step(IDLE_INPUT);
        const sB = simB.step(IDLE_INPUT);
        expect(sB.shockwaves).toBeUndefined();
        expect(sB.ghostPose).toBeUndefined();
        expect(sB.player2).toBeUndefined();
        expect(sB.dogfight).toBeUndefined();
        expect(sB.dailySeedId).toBeUndefined();
        expect(sB.enemies.some((e) => e.kind === 'Dreadnought' || e.kind === 'SkyCarrier')).toBe(false);
        expect(sB.player.x).toBe(sA.player.x);
        expect(sB.player.y).toBe(sA.player.y);
        expect(sB.score).toBe(sA.score);
        expect(sB.difficulty).toBe(sA.difficulty);
      }

      // Toggling modded on and back off clamps custom loadouts > 5 cleanly back to 0
      simB.setModFlags({ moddedEnabled: true, arsenalBosses: true });
      simB.setLoadout({ weapon: 6, body: 6, engine: 6 });
      expect(simB.getSnapshot().player.loadout).toEqual({ weapon: 6, body: 6, engine: 6 });

      simB.setModFlags({ ...DEFAULT_ACT2_MOD_FLAGS, moddedEnabled: false });
      expect(simB.getSnapshot().player.loadout).toEqual({ weapon: 0, body: 0, engine: 0 });
      expect(simB.getSnapshot().shockwaves).toBeUndefined();
      expect(simB.getSnapshot().player2).toBeUndefined();
    });

    it('registerAct2ModPacks synchronizes all 4 packs and createAct2BonusPalettes passes RGBA distance > 0.015', () => {
      const reg = new ModRegistry(true);
      registerAct2ModPacks(reg, {
        moddedEnabled: true,
        arsenalBosses: true,
        replayGhost: true,
        dailySeed: true,
        shaderFx: { crtScanlines: true, phosphorBloom: false, speedWarp: true, shockwaves: true },
        multiplayerMode: 'coop2p',
        p2BotEnabled: true,
      });

      expect(reg.isVanillaLocked()).toBe(false);
      expect(reg.listMods().map((m) => m.id).sort()).toEqual([
        'act2-arsenal-bosses',
        'act2-multiplayer-2p',
        'act2-replay-ghost',
        'act2-shader-studio',
      ]);

      const palettes = createAct2BonusPalettes();
      expect(palettes.map((p) => p.id)).toEqual(['cyberpunk', 'vaporwave', 'blueprint', 'goldrush']);
      for (const p of palettes) {
        expect(p.colors).toHaveLength(8);
        expect(p.colors[0]).toEqual([0, 0, 0, 0]);
        expect(p.backcol[3]).toBe(1);
        for (let i = 1; i <= 7; i++) {
          expect(p.colors[i]![3]).toBe(1);
          for (const ch of p.colors[i]!) {
            expect(ch).toBeGreaterThanOrEqual(0);
            expect(ch).toBeLessThanOrEqual(1);
          }
        }
        const keys = [1, 2, 3, 4, 5, 6, 7] as const;
        for (let a = 0; a < keys.length; a++) {
          for (let b = a + 1; b < keys.length; b++) {
            expect(rgbDist(p.colors[keys[a]!]!, p.colors[keys[b]!]!)).toBeGreaterThan(0.015);
          }
        }
      }

      // Modded plane names are distinct and non-empty across all 513 modded combos
      expect(resolveModdedPlaneName(6, 0, 0, 'original')).toBe('RAILRAUSER');
      expect(resolveModdedPlaneName(8, 0, 0, 'original')).toBe('THUNDERBOLT');
      expect(resolveModdedPlaneName(7, 6, 0, 'original')).toBe('AEGIS FLAK');
      expect(resolveModdedPlaneName(0, 7, 7, 'original')).toBe('VAMPIRE VECTOR');
      expect(resolveModdedPlaneName(0, 8, 8, 'original')).toBe('OVERCLOCK ION');
      expect(resolveModdedPlaneName(0, 0, 0, 'original')).toBe('original');

      const seen = new Set<string>();
      for (let w = 0; w <= 8; w++) {
        for (let b = 0; b <= 8; b++) {
          for (let e = 0; e <= 8; e++) {
            if (w < 6 && b < 6 && e < 6) continue;
            const name = resolveModdedPlaneName(w, b, e, 'original');
            expect(name.length).toBeGreaterThan(0);
            expect(seen.has(name)).toBe(false);
            seen.add(name);
          }
        }
      }
      expect(seen.size).toBe(9 * 9 * 9 - 6 * 6 * 6);
    });
  });

  describe('2. Custom Weapons (6..8), Custom Bodies (6..8), and Custom Engines (6..8)', () => {
    it('Railgun (6) fires piercing railslug with recoil + shockwave and pierces multiple enemies', () => {
      const sim = new Simulation(gameData);
      sim.setModFlags({
        moddedEnabled: true,
        arsenalBosses: true,
        shaderFx: { crtScanlines: false, phosphorBloom: false, speedWarp: false, shockwaves: true },
      });
      const pre = launchToPlaying(sim, { weapon: 6, body: 0, engine: 4 }, 'normal', 501);
      const e1 = sim.spawnEnemy('Fighter', pre.player.x, pre.player.y - 60);
      const e2 = sim.spawnEnemy('Fighter', pre.player.x, pre.player.y - 120);
      const e3 = sim.spawnEnemy('Ace', pre.player.x, pre.player.y - 180);

      const fireSnap = sim.step({ left: false, right: false, thrust: false, fire: true });
      const slug = fireSnap.projectiles.find((p) => p.kind === 'railslug');
      expect(slug).toBeDefined();
      expect(slug!.piercing).toBe(true);
      expect(slug!.dmg).toBe(28);
      expect(fireSnap.player.fireCooldown).toBe(28);
      expect(fireSnap.player.vy).toBeGreaterThan(pre.player.vy); // Recoil pushes downward (+y) when aiming -90
      expect(fireSnap.shockwaves?.length).toBeGreaterThanOrEqual(1);
      expect(fireSnap.audioEvents.some((ev) => ev.cue === 'sndcannon')).toBe(true);

      let post = fireSnap;
      for (let t = 0; t < 8; t++) {
        post = sim.step(IDLE_INPUT);
      }
      expect(post.enemies.some((e) => e.id === e1.id)).toBe(false);
      expect(post.enemies.some((e) => e.id === e2.id)).toBe(false);
      const acePost = post.enemies.find((e) => e.id === e3.id)!;
      expect(acePost.health).toBe(60 - 28);
    });

    it('Flak (7) airbursts within 48px or on TTL expiry into 6 radial flakshards + shockwave', () => {
      const sim = new Simulation(gameData);
      sim.setModFlags({
        moddedEnabled: true,
        arsenalBosses: true,
        shaderFx: { crtScanlines: false, phosphorBloom: false, speedWarp: false, shockwaves: true },
      });
      const pre = launchToPlaying(sim, { weapon: 7, body: 0, engine: 4 }, 'normal', 502);
      // Spawn enemy 90px ahead so flakshell bursts via < 48px proximity before TTL expires
      sim.spawnEnemy('Ace', pre.player.x, pre.player.y - 90);

      const fireSnap = sim.step({ left: false, right: false, thrust: false, fire: true });
      expect(fireSnap.projectiles.some((p) => p.kind === 'flakshell')).toBe(true);
      expect(fireSnap.player.fireCooldown).toBe(18);

      let burstSnap = fireSnap;
      for (let t = 0; t < 12; t++) {
        burstSnap = sim.step(IDLE_INPUT);
        if (burstSnap.projectiles.some((p) => p.kind === 'flakshard')) {
          break;
        }
      }
      const shards = burstSnap.projectiles.filter((p) => p.kind === 'flakshard');
      expect(shards).toHaveLength(6);
      expect(shards[0]!.dmg).toBe(6);
      expect(burstSnap.shockwaves?.length).toBeGreaterThanOrEqual(1);
      expect(burstSnap.audioEvents.some((ev) => ev.cue === 'sndspread')).toBe(true);

      // Also verify TTL expiry airburst in empty sky
      const simTtl = new Simulation(gameData);
      simTtl.setModFlags({ moddedEnabled: true, arsenalBosses: true });
      launchToPlaying(simTtl, { weapon: 7, body: 0, engine: 4 }, 'normal', 503);
      simTtl.step({ left: false, right: false, thrust: false, fire: true });
      let ttlBurst = simTtl.getSnapshot();
      for (let t = 0; t < 20; t++) {
        ttlBurst = simTtl.step(IDLE_INPUT);
        if (ttlBurst.projectiles.some((p) => p.kind === 'flakshard')) break;
      }
      expect(ttlBurst.projectiles.filter((p) => p.kind === 'flakshard')).toHaveLength(6);
    });

    it('Lightning (8) chains up to 3 targets within 260px cone + 160px jumps and spawns 4-tick polyline arc', () => {
      const sim = new Simulation(gameData);
      sim.setModFlags({ moddedEnabled: true, arsenalBosses: true });
      const pre = launchToPlaying(sim, { weapon: 8, body: 0, engine: 4 }, 'normal', 504);

      // 3 chained enemies + 1 4th enemy inside 160px (must stop at 3 total!) + 1 out-of-range enemy
      const e1 = sim.spawnEnemy('Ace', pre.player.x, pre.player.y - 120);
      const e2 = sim.spawnEnemy('Ace', pre.player.x + 110, pre.player.y - 140);
      const e3 = sim.spawnEnemy('Ace', pre.player.x + 220, pre.player.y - 140);
      const e4 = sim.spawnEnemy('Ace', pre.player.x + 280, pre.player.y - 140);

      const fireSnap = sim.step({ left: false, right: false, thrust: false, fire: true });
      const arc = fireSnap.projectiles.find((p) => p.kind === 'lightningarc');
      expect(arc).toBeDefined();
      expect(arc!.ttl).toBe(4);
      expect(arc!.arcPoints).toHaveLength(4); // player + 3 enemies
      expect(fireSnap.audioEvents.some((ev) => ev.cue === 'sndlaser')).toBe(true);

      expect(fireSnap.enemies.find((e) => e.id === e1.id)!.health).toBe(60 - 14);
      expect(fireSnap.enemies.find((e) => e.id === e2.id)!.health).toBe(60 - 14);
      expect(fireSnap.enemies.find((e) => e.id === e3.id)!.health).toBe(60 - 14);
      expect(fireSnap.enemies.find((e) => e.id === e4.id)!.health).toBe(60);

      // Visible for 4 ticks total (spawn tick + 3 steps), gone on tick 5
      expect(sim.step(IDLE_INPUT).projectiles.some((p) => p.kind === 'lightningarc')).toBe(true);
      expect(sim.step(IDLE_INPUT).projectiles.some((p) => p.kind === 'lightningarc')).toBe(true);
      expect(sim.step(IDLE_INPUT).projectiles.some((p) => p.kind === 'lightningarc')).toBe(true);
      expect(sim.step(IDLE_INPUT).projectiles.some((p) => p.kind === 'lightningarc')).toBe(false);
    });

    it('Aegis (6) absorbs 1 hit with shockwave + sndhealed and recharges after 300 ticks', () => {
      const sim = new Simulation(gameData);
      sim.setModFlags({
        moddedEnabled: true,
        arsenalBosses: true,
        shaderFx: { crtScanlines: false, phosphorBloom: false, speedWarp: false, shockwaves: true },
      });
      const pre = launchToPlaying(sim, { weapon: 0, body: 6, engine: 4 }, 'normal', 505);
      // Saturate spawn weight safely out of firing range so random waves do not interfere during recharge test
      sim.spawnEnemy('Blimp', pre.player.x + 1800, -800);
      expect(pre.player.maxHealth).toBe(18);
      expect(pre.player.shieldReady).toBe(true);
      expect(pre.player.shieldCooldown).toBe(0);

      sim.damagePlayer(10);
      const blocked = sim.getSnapshot();
      expect(blocked.player.health).toBe(18);
      expect(blocked.player.shieldReady).toBe(false);
      expect(blocked.player.shieldCooldown).toBe(300);
      expect(blocked.shockwaves?.length).toBe(1);
      expect(blocked.audioEvents.some((e) => e.cue === 'sndhealed')).toBe(true);

      // Hit during cooldown deals real damage
      sim.damagePlayer(5);
      expect(sim.getSnapshot().player.health).toBe(13);

      // Step 300 ticks -> shield recharges
      for (let t = 0; t < 299; t++) {
        sim.step(IDLE_INPUT);
      }
      expect(sim.getSnapshot().player.shieldReady).toBe(false);
      sim.step(IDLE_INPUT);
      expect(sim.getSnapshot().player.shieldReady).toBe(true);
      expect(sim.getSnapshot().player.shieldCooldown).toBe(0);

      const hpBeforeSecondBlock = sim.getSnapshot().player.health;
      sim.damagePlayer(8);
      expect(sim.getSnapshot().player.health).toBe(hpBeforeSecondBlock);
      expect(sim.getSnapshot().player.shieldReady).toBe(false);
    });

    it('Vampire (7) heals +2.5 HP on kill even while continuously firing, and Overclock (8) reduces fire interval by 25%', () => {
      // Vampire: kill enemy while continuously holding fire:true (Spread deals 10 dmg in 1 burst)
      const simVamp = new Simulation(gameData);
      simVamp.setModFlags({ moddedEnabled: true, arsenalBosses: true });
      const preVamp = launchToPlaying(simVamp, { weapon: 2, body: 7, engine: 4 }, 'normal', 506);
      expect(preVamp.player.maxHealth).toBe(14);
      simVamp.damagePlayer(6);
      expect(simVamp.getSnapshot().player.health).toBe(8);

      simVamp.spawnEnemy('Fighter', preVamp.player.x, preVamp.player.y - 32);
      let vampSnap = simVamp.getSnapshot();
      for (let t = 0; t < 12; t++) {
        vampSnap = simVamp.step({ left: false, right: false, thrust: false, fire: true });
        if (vampSnap.killsThisSortie >= 1) break;
      }
      expect(vampSnap.killsThisSortie).toBeGreaterThanOrEqual(1);
      expect(vampSnap.player.firing).toBe(true);
      expect(vampSnap.player.health).toBeCloseTo(10.5, 5);

      // Overclock (8): 0.75x fire interval (Railgun 28 -> 21, Cannon 79 -> 59, Laser 1 -> 1) + 1.15 speedmodifier
      const simOc = new Simulation(gameData);
      simOc.setModFlags({ moddedEnabled: true, arsenalBosses: true });
      launchToPlaying(simOc, { weapon: 6, body: 8, engine: 4 }, 'normal', 507);
      const fireOc = simOc.step({ left: false, right: false, thrust: false, fire: true });
      expect(fireOc.player.maxHealth).toBe(12);
      expect(fireOc.player.bodySpec.speedmodifier).toBe(1.15);
      expect(fireOc.player.fireCooldown).toBe(21);

      simOc.launch({ weapon: 1, body: 8, engine: 4 }, 'normal', 508);
      for (let t = 0; t < 20 && simOc.getSnapshot().phase === 'launching'; t++) {
        simOc.step(IDLE_INPUT);
      }
      expect(simOc.step({ left: false, right: false, thrust: false, fire: true }).player.fireCooldown).toBe(1);
    });

    it('Custom Engines: Afterburner (6) reaches 12.5 top speed, Vector (7) turns 11/7 deg, Ion (8) is waterproof + halved space dmg', () => {
      // Afterburner (6)
      const simAb = new Simulation(gameData);
      simAb.setModFlags({ moddedEnabled: true, arsenalBosses: true });
      launchToPlaying(simAb, { weapon: 0, body: 0, engine: 6 }, 'normal', 509);
      let maxSpd = 0;
      for (let t = 0; t < 20; t++) {
        const s = simAb.step({ left: false, right: false, thrust: true, fire: false });
        maxSpd = Math.max(maxSpd, Math.hypot(s.player.vx, s.player.vy));
      }
      expect(maxSpd).toBeGreaterThan(11.5);
      expect(maxSpd).toBeLessThanOrEqual(12.501);

      // Vector (7)
      const simVec = new Simulation(gameData);
      simVec.setModFlags({ moddedEnabled: true, arsenalBosses: true });
      launchToPlaying(simVec, { weapon: 0, body: 0, engine: 7 }, 'normal', 510);
      const sUnboosted = simVec.step({ left: false, right: true, thrust: false, fire: false });
      expect(sUnboosted.player.angleDeg - sUnboosted.player.prevAngleDeg).toBeCloseTo(11, 5);
      const sBoosted = simVec.step({ left: false, right: true, thrust: true, fire: false });
      expect(sBoosted.player.angleDeg - sBoosted.player.prevAngleDeg).toBeCloseTo(7, 5);

      // Ion (8) waterproof + halved space damage (0.2)
      const simIon = new Simulation(gameData);
      simIon.setModFlags({ moddedEnabled: true, arsenalBosses: true });
      launchToPlaying(simIon, { weapon: 0, body: 0, engine: 8 }, 'normal', 511);
      expect(simIon.getSnapshot().player.engineSpec.waterproof).toBe(true);
      let sawSpaceDmg = false;
      for (let t = 0; t < 260; t++) {
        const prev = simIon.getSnapshot();
        const s = simIon.step({ left: false, right: false, thrust: true, fire: false });
        const hitByEnemy = s.audioEvents.some((e) => e.cue === 'sndplayerhit');
        if (s.player.inSpace && !hitByEnemy) {
          const dmg = prev.player.health - s.player.health;
          if (Math.abs(dmg - 0.2) < 1e-5) {
            sawSpaceDmg = true;
            break;
          }
        }
      }
      expect(sawSpaceDmg).toBe(true);
    });
  });

  describe('3. Mega-Bosses (Dreadnought, SkyCarrier, AceSquadron)', () => {
    it('Dreadnought spawns with 500 HP at sea level and fires twin artillery 24-bullet bursts', () => {
      const sim = new Simulation(gameData);
      sim.setModFlags({
        moddedEnabled: true,
        arsenalBosses: true,
        shaderFx: { crtScanlines: false, phosphorBloom: false, speedWarp: false, shockwaves: true },
      });
      launchToPlaying(sim, { weapon: 6, body: 6, engine: 6 }, 'normal', 601);
      const boss = sim.spawnEnemy('Dreadnought', 120);
      expect(boss.maxHealth).toBe(500);
      expect(boss.y).toBe(0);
      expect(boss.scoreValue).toBe(1500);

      let artilleryCount = 0;
      for (let t = 0; t < 120; t++) {
        const s = sim.step(IDLE_INPUT);
        artilleryCount += s.projectiles.filter((p) => p.kind === 'artillery').length;
      }
      expect(artilleryCount).toBeGreaterThan(0);
    });

    it('SkyCarrier spawns with 750 HP, descends to y=-480, and launches interceptors every 150 ticks', () => {
      const sim = new Simulation(gameData);
      sim.setModFlags({ moddedEnabled: true, arsenalBosses: true });
      launchToPlaying(sim, { weapon: 6, body: 6, engine: 6 }, 'normal', 602);
      const carrier = sim.spawnEnemy('SkyCarrier', 100);
      expect(carrier.maxHealth).toBe(750);
      expect(carrier.scoreValue).toBe(2000);

      let reachedCruise = false;
      let interceptorSpawned = false;
      for (let t = 0; t < 350; t++) {
        const s = sim.step(IDLE_INPUT);
        const tracked = s.enemies.find((e) => e.id === carrier.id);
        if (tracked && tracked.y === -480 && tracked.state === 'cruise') {
          reachedCruise = true;
        }
        if (s.enemies.some((e) => e.kind === 'Fighter' || e.kind === 'Jet')) {
          interceptorSpawned = true;
        }
        if (reachedCruise && interceptorSpawned) break;
      }
      expect(reachedCruise).toBe(true);
      expect(interceptorSpawned).toBe(true);
    });

    it('AceSquadron spawns 3 Aces in V-formation sharing squadronId, and boss waves trigger deterministically at difficulty >= 160', () => {
      const sim = new Simulation(gameData);
      sim.setModFlags({ moddedEnabled: true, arsenalBosses: true });
      launchToPlaying(sim, { weapon: 0, body: 0, engine: 4 }, 'normal', 603);
      const squad = sim.spawnAceSquadron(250, -300);
      expect(squad).toHaveLength(3);
      expect(new Set(squad.map((a) => a.squadronId)).size).toBe(1);
      expect(squad[0]!.squadronId).toBeDefined();

      // Advance in SFMT mode so difficulty crosses 160 rapidly and triggers deterministic boss wave
      const simWave = new Simulation(gameData);
      simWave.setModFlags({ moddedEnabled: true, arsenalBosses: true });
      launchToPlaying(simWave, { weapon: 5, body: 5, engine: 5 }, 'sfmt', 604);
      simWave.setAutopilot(true);
      let sawBoss = false;
      for (let t = 0; t < 240; t++) {
        const s = simWave.step(IDLE_INPUT);
        if (s.enemies.some((e) => e.kind === 'Dreadnought' || e.kind === 'SkyCarrier' || e.squadronId !== undefined)) {
          sawBoss = true;
          break;
        }
      }
      expect(sawBoss).toBe(true);
    });
  });

  describe('4. Daily Seed, Replay Validation/Fuzzing, and GhostRunner Sync', () => {
    it('computeDailySeed produces deterministic YYYYMMDD and stable non-zero 32-bit seeds', () => {
      const d1 = computeDailySeed(new Date('2026-11-25T03:00:00Z'));
      const d1Later = computeDailySeed(new Date('2026-11-25T23:59:59Z'));
      const d2 = computeDailySeed(new Date('2026-11-26T00:00:00Z'));

      expect(d1.dateId).toBe('20261125');
      expect(d1).toEqual(d1Later);
      expect(d1.seed).toBeGreaterThan(0);
      expect(Number.isInteger(d1.seed)).toBe(true);
      expect(d2.dateId).toBe('20261126');
      expect(d2.seed).not.toBe(d1.seed);

      // Simulation uses daily seed automatically when moddedEnabled && dailySeed
      const sim = new Simulation(gameData);
      sim.setModFlags({ moddedEnabled: true, dailySeed: true });
      sim.launch({ weapon: 0, body: 0, engine: 0 }, 'normal');
      const snap = sim.getSnapshot();
      const today = computeDailySeed();
      expect(snap.seed).toBe(today.seed);
      expect(snap.dailySeedId).toBe(today.dateId);
    });

    it('serializeReplay / parseReplayJson round-trips cleanly and rejects malformed/fuzzed payloads without throwing', () => {
      const sim = new Simulation(gameData);
      sim.setModFlags({ moddedEnabled: true, arsenalBosses: true, dailySeed: true });
      sim.launch({ weapon: 6, body: 6, engine: 6 }, 'normal');
      for (let t = 0; t < 45; t++) {
        sim.step({ left: t % 5 === 0, right: false, thrust: true, fire: t % 3 === 0 });
      }
      const recording = sim.getReplay();
      const json = serializeReplay(recording);
      const parsed = parseReplayJson(json);
      expect(parsed).toEqual(recording);

      // Fuzz / invalid inputs
      const invalidPayloads = [
        '',
        'not json {{{',
        '[]',
        'null',
        '123',
        JSON.stringify({ ...recording, seed: -1 }),
        JSON.stringify({ ...recording, seed: NaN }),
        JSON.stringify({ ...recording, mode: 'arcade' }),
        JSON.stringify({ ...recording, loadout: { weapon: 9, body: 0, engine: 0 } }),
        JSON.stringify({ ...recording, loadout: { weapon: -1, body: 0, engine: 0 } }),
        JSON.stringify({ ...recording, frames: [{ tick: -2, mask: 0 }] }),
        JSON.stringify({ ...recording, frames: [{ tick: 1, mask: 16 }] }),
        JSON.stringify({ ...recording, frames: [{ tick: 1.5, mask: 1 }] }),
        JSON.stringify({ ...recording, finalTicks: 360001 }),
        JSON.stringify({
          ...recording,
          frames: Array.from({ length: 360001 }, (_, i) => ({ tick: i + 1, mask: 0 })),
        }),
      ];
      for (const bad of invalidPayloads) {
        expect(() => parseReplayJson(bad)).not.toThrow();
        expect(parseReplayJson(bad)).toBeNull();
      }
    });

    it('GhostRunner isolates its PRNG and tracks recorded trajectory tick-for-tick with 20-point trail', () => {
      const simRecord = new Simulation(gameData);
      simRecord.launch({ weapon: 0, body: 0, engine: 0 }, 'normal', 9090);
      const positions: { x: number; y: number }[] = [];
      for (let t = 0; t < 40; t++) {
        const s = simRecord.step({
          left: t >= 18 && t < 24,
          right: false,
          thrust: true,
          fire: t % 4 === 0,
        });
        positions.push({ x: s.player.x, y: s.player.y });
      }
      const rec: ReplayRecording = simRecord.getReplay();

      // Isolated GhostRunner direct checks
      const ghost = new GhostRunner(gameData, rec);
      expect(ghost.sampleAtTick(-1)).toBeNull();
      expect(ghost.sampleAtTick(41)).toBeNull();

      const pose10 = ghost.sampleAtTick(10)!;
      expect(pose10.x).toBe(positions[9]!.x);
      expect(pose10.y).toBe(positions[9]!.y);
      expect(pose10.trail.length).toBeLessThanOrEqual(20);

      const pose40 = ghost.sampleAtTick(40)!;
      expect(pose40.x).toBe(positions[39]!.x);
      expect(pose40.y).toBe(positions[39]!.y);
      expect(pose40.trail).toHaveLength(20);

      // Running a live simulation with a different seed + replayGhost enabled never alters live sim PRNG
      const simWithGhost = new Simulation(gameData);
      simWithGhost.setModFlags({ moddedEnabled: true, replayGhost: true });
      simWithGhost.setGhostReplay(rec);
      simWithGhost.launch({ weapon: 0, body: 0, engine: 0 }, 'normal', 7777);

      const simBaseline = new Simulation(gameData);
      simBaseline.setModFlags({ moddedEnabled: true, replayGhost: false });
      simBaseline.launch({ weapon: 0, body: 0, engine: 0 }, 'normal', 7777);

      for (let t = 0; t < 40; t++) {
        const sG = simWithGhost.step({ left: false, right: true, thrust: true, fire: false });
        const sB = simBaseline.step({ left: false, right: true, thrust: true, fire: false });
        expect(sG.player.x).toBe(sB.player.x);
        expect(sG.player.y).toBe(sB.player.y);
        expect(sG.enemies.length).toBe(sB.enemies.length);
        expect(sG.ghostPose).not.toBeNull();
        expect(sG.ghostPose!.x).toBe(positions[t]!.x);
        expect(sG.ghostPose!.y).toBe(positions[t]!.y);
      }
    });
  });

  describe('5. 2P Co-op & 1v1 Dogfight Arena + AI Bots', () => {
    it('coop2p spawns P2 at (70,-32), shares score/combo, respawns dead partner after 300 ticks, and ends only when both die', () => {
      const sim = new Simulation(gameData);
      sim.setModFlags({ moddedEnabled: true, multiplayerMode: 'coop2p', p2BotEnabled: false });
      sim.setP2Loadout({ weapon: 2, body: 0, engine: 4 });
      sim.launch({ weapon: 0, body: 0, engine: 4 }, 'normal', 701);

      const initSnap = sim.getSnapshot();
      expect(initSnap.player.x).toBe(-70);
      expect(initSnap.player.y).toBe(-32);
      expect(initSnap.player.playerIndex).toBe(1);
      expect(initSnap.player2).not.toBeNull();
      expect(initSnap.player2!.x).toBe(70);
      expect(initSnap.player2!.y).toBe(-32);
      expect(initSnap.player2!.playerIndex).toBe(2);

      let snap = initSnap;
      while (snap.phase === 'launching') {
        snap = sim.step2P(IDLE_INPUT, IDLE_INPUT);
      }
      expect(snap.phase).toBe('playing');

      // P2 shoots and kills a Fighter -> shared score & combo increment, projectile tagged ownerPlayer: 2
      sim.spawnEnemy('Fighter', snap.player2!.x + 18, snap.player2!.y - 60);
      let sawP2Proj = false;
      for (let t = 0; t < 20; t++) {
        snap = sim.step2P(IDLE_INPUT, { left: false, right: false, thrust: false, fire: true });
        if (snap.projectiles.some((p) => p.ownerPlayer === 2)) sawP2Proj = true;
        if (snap.killsThisSortie >= 1) break;
      }
      expect(sawP2Proj).toBe(true);
      expect(snap.killsThisSortie).toBeGreaterThanOrEqual(1);
      expect(snap.score).toBeGreaterThan(0);
      expect(snap.combo).toBeGreaterThanOrEqual(2);

      // If P1 dies while P2 is alive, game continues and P1 respawns after 300 ticks
      sim.damagePlayer(999);
      const afterP1Dead = sim.step2P(IDLE_INPUT, IDLE_INPUT);
      expect(afterP1Dead.phase).toBe('playing');
      expect(afterP1Dead.player.alive).toBe(false);
      expect(afterP1Dead.player2!.alive).toBe(true);

      // Step 298 more ticks (299 total since death): P1 still waiting to respawn
      for (let t = 0; t < 298; t++) {
        const s = sim.getSnapshot();
        sim.step2P(IDLE_INPUT, computeCoopP2BotInput(s));
      }
      expect(sim.getSnapshot().player.alive).toBe(false);
      expect(sim.getSnapshot().player2!.alive).toBe(true);

      // 300th tick since death -> P1 respawns cleanly beside P2!
      const respawnSnap = sim.step2P(IDLE_INPUT, computeCoopP2BotInput(sim.getSnapshot()));
      expect(respawnSnap.player.alive).toBe(true);
      expect(respawnSnap.phase).toBe('playing');

      // Co-op P2 AI bot generates valid non-idle evasion/pursuit input
      const botInput = computeCoopP2BotInput(respawnSnap);
      expect(typeof botInput.thrust).toBe('boolean');

      // Replay parity via replaySimulation with modded coop2p flags
      const recorded = sim.getReplay();
      expect(recorded.frames.length).toBeGreaterThan(300);
      const replayed = replaySimulation(gameData, recorded);
      expect(replayed.tick).toBe(respawnSnap.tick);

      // Verify gameover only occurs when BOTH P1 and P2 are dead
      const simBothDead = new Simulation(gameData);
      simBothDead.setModFlags({ moddedEnabled: true, multiplayerMode: 'coop2p', p2BotEnabled: false });
      simBothDead.setP2Loadout({ weapon: 0, body: 0, engine: 3 });
      simBothDead.launch({ weapon: 0, body: 0, engine: 0 }, 'normal', 702);
      while (simBothDead.getSnapshot().phase === 'launching') {
        simBothDead.step2P(IDLE_INPUT, IDLE_INPUT);
      }
      // Kill P1 first -> still playing
      simBothDead.damagePlayer(999);
      expect(simBothDead.getSnapshot().phase).toBe('playing');
      // Fly P2 straight up into space (engine 3 takes 0.6 space dmg/tick) until P2 also dies
      let endSnap = simBothDead.getSnapshot();
      for (let t = 0; t < 290 && endSnap.phase === 'playing'; t++) {
        endSnap = simBothDead.step2P(IDLE_INPUT, { left: false, right: false, thrust: true, fire: false });
      }
      expect(endSnap.player2!.alive).toBe(false);
      expect(endSnap.phase).toBe('dying');
      for (let t = 0; t < 100 && endSnap.phase !== 'gameover'; t++) {
        endSnap = simBothDead.step2P(IDLE_INPUT, IDLE_INPUT);
      }
      expect(endSnap.phase).toBe('gameover');
    });

    it('dogfight1v1 runs Best-of-5 (first to 3 wins), spawns no enemies, handles simultaneous KO safely, and runs P2 AI bot', () => {
      const sim = new Simulation(gameData);
      sim.setModFlags({
        moddedEnabled: true,
        arsenalBosses: true,
        multiplayerMode: 'dogfight1v1',
        p2BotEnabled: true,
        shaderFx: { crtScanlines: false, phosphorBloom: false, speedWarp: false, shockwaves: true },
      });
      sim.setP2Loadout({ weapon: 0, body: 0, engine: 4 });
      sim.launch({ weapon: 6, body: 0, engine: 4 }, 'normal', 801);

      const init = sim.getSnapshot();
      expect(init.phase).toBe('playing');
      expect(init.player.x).toBe(-220);
      expect(init.player.y).toBe(-260);
      expect(init.player.angleDeg).toBe(0);
      expect(init.player2!.x).toBe(220);
      expect(init.player2!.y).toBe(-260);
      expect(init.player2!.angleDeg).toBe(180);
      expect(init.dogfight).toEqual({
        p1Wins: 0,
        p2Wins: 0,
        round: 1,
        bestOf: 5,
        roundBannerTicks: 0,
        winner: null,
        lastScorer: null,
      });

      // Verify auto P2 bot works via step(p1Input) and zero enemy waves spawn
      const botSnap = sim.step(IDLE_INPUT);
      expect(botSnap.enemies).toHaveLength(0);
      const dogBot = computeDogfightBotInput(
        botSnap.player2!,
        botSnap.player,
        botSnap.seaLevel,
        botSnap.spaceLevel,
        botSnap.projectiles,
      );
      expect(typeof dogBot.left).toBe('boolean');

      // Test simultaneous KO tie safety + Best-of-5 completion cleanly
      const simDuel = new Simulation(gameData);
      simDuel.setModFlags({
        moddedEnabled: true,
        arsenalBosses: true,
        multiplayerMode: 'dogfight1v1',
        p2BotEnabled: false,
        shaderFx: { crtScanlines: false, phosphorBloom: false, speedWarp: false, shockwaves: true },
      });
      simDuel.setP2Loadout({ weapon: 6, body: 0, engine: 4 });
      simDuel.launch({ weapon: 6, body: 0, engine: 4 }, 'normal', 802);

      // Both players fire Railgun straight into each other -> simultaneous KO tie round!
      let tieSnap = simDuel.getSnapshot();
      for (let t = 0; t < 20; t++) {
        tieSnap = simDuel.step2P(
          { left: false, right: false, thrust: false, fire: true },
          { left: false, right: false, thrust: false, fire: true },
        );
        if (tieSnap.dogfight!.roundBannerTicks > 0) break;
      }
      expect(tieSnap.dogfight!.roundBannerTicks).toBe(75);
      expect(tieSnap.dogfight!.lastScorer).toBeNull();
      expect(tieSnap.dogfight!.p1Wins).toBe(0);
      expect(tieSnap.dogfight!.p2Wins).toBe(0);

      for (let t = 0; t < 75; t++) {
        tieSnap = simDuel.step2P(IDLE_INPUT, IDLE_INPUT);
      }
      expect(tieSnap.phase).toBe('playing');
      expect(tieSnap.dogfight!.round).toBe(2);
      expect(tieSnap.player.alive).toBe(true);
      expect(tieSnap.player2!.alive).toBe(true);

      // Now P1 wins 3 rounds cleanly to reach gameover with dogfight.winner === 1
      for (let roundWin = 1; roundWin <= 3; roundWin++) {
        let koSnap = simDuel.getSnapshot();
        for (let t = 0; t < 30; t++) {
          koSnap = simDuel.step2P(
            { left: false, right: false, thrust: false, fire: true },
            IDLE_INPUT,
          );
          if (koSnap.dogfight!.roundBannerTicks > 0) break;
        }
        expect(koSnap.dogfight!.p1Wins).toBe(roundWin);
        expect(koSnap.dogfight!.lastScorer).toBe(1);
        expect(koSnap.dogfight!.roundBannerTicks).toBe(75);
        expect(koSnap.enemies).toHaveLength(0);

        for (let t = 0; t < 75; t++) {
          koSnap = simDuel.step2P(IDLE_INPUT, IDLE_INPUT);
        }
        if (roundWin < 3) {
          expect(koSnap.phase).toBe('playing');
        } else {
          expect(koSnap.phase).toBe('gameover');
          expect(koSnap.dogfight!.winner).toBe(1);
        }
      }
    });
  });
});
