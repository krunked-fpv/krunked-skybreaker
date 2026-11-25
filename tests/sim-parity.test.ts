import { describe, expect, it } from 'vitest';
import { DEFAULT_ACT2_MOD_FLAGS } from '../src/contracts/mod';
import type { InputState, PartIndex } from '../src/contracts/sim';
import { createProceduralFallbackBundle } from '../src/vault';
import type {
  BitmapFontSpec,
  BodySpec,
  EnemySpec,
  EngineSpec,
  GameDataBundle,
  MissionSpec,
  PlaneNameEntry,
  SpriteAtlasSpec,
  WeaponSpec,
} from '../src/contracts/vault';
import {
  computeAutopilotInput,
  createDefaultProfile,
  ModRegistry,
  replaySimulation,
  SeededRng,
  Simulation,
} from '../src/sim';

const IDLE_INPUT: InputState = {
  left: false,
  right: false,
  thrust: false,
  fire: false,
};

function launchToPlaying(
  sim: Simulation,
  loadout: { weapon: PartIndex; body: PartIndex; engine: PartIndex },
  mode: 'normal' | 'sfmt' = 'normal',
  seed = 100,
) {
  sim.launch(loadout, mode, seed);
  let snap = sim.getSnapshot();
  let guard = 0;
  while (snap.phase === 'launching' && guard < 60) {
    snap = sim.step(IDLE_INPUT);
    guard++;
  }
  return snap;
}

function createTestGameDataBundle(): GameDataBundle {
  const originalEngine: EngineSpec = {
    id: 0,
    name: 'original',
    descr: 'well-balanced engine',
    sprite: 'engine_original',
    booststartsprite: 'fx_booststart',
    boostloopsprite: 'fx_boostloop',
    boostendparticle: 'boostend',
    boostidlesprite: '',
    acceleration: 1.5,
    gravity: 0.2,
    friction: 0.04,
    speed: 8,
    turnspeed: 10,
    turnspeedboost: 4,
    boostadd: 0,
    waterdmg: 0.4,
    waterdmglowhp: 0.05,
    waterlowhpperc: 0.333333,
    wateracceleration: 0.1,
    waterforce: 0.3,
    spacedmg: 0.4,
    spacedmglowhp: 0.05,
    spacelowhpperc: 0.333333,
    spaceacceleration: 0.1,
    spaceforce: 0.3,
    environmentfriction: 0.8,
    environmentmin: 0.1,
    motionadddirection: 0.03,
    motionaddimageangle: 0.01,
    minimumspeed: 0,
    maximumspeed: 8,
    waterproof: false,
    flags: '',
  };

  const enginesById: EngineSpec[] = [
    originalEngine,
    {
      ...originalEngine,
      id: 1,
      name: 'superboost',
      sprite: 'engine_superboost',
      booststartsprite: 'fx_superbooststart',
      boostloopsprite: 'fx_superboostloop',
      boostendparticle: 'superboostend',
      speed: 11,
      turnspeedboost: 1,
      minimumspeed: 2,
      maximumspeed: 11,
      boostadd: 2,
    },
    {
      ...originalEngine,
      id: 2,
      name: 'gungine',
      sprite: 'engine_gungine',
      acceleration: 5.5,
      flags: 'gun-engine',
    },
    {
      ...originalEngine,
      id: 3,
      name: 'underwater',
      sprite: 'engine_underwater',
      acceleration: 1.2,
      waterproof: true,
      wateracceleration: 0.05,
      spacedmg: 0.6,
      spacedmglowhp: 0.6,
    },
    {
      ...originalEngine,
      id: 4,
      name: 'hover',
      sprite: 'engine_hover',
      booststartsprite: 'fx_boosthover',
      boostloopsprite: 'fx_boosthover',
      boostidlesprite: 'fx_boosthover_idle',
      boostendparticle: '',
      acceleration: 1.0,
      gravity: 0.02,
      friction: 0.01,
    },
    {
      ...originalEngine,
      id: 5,
      name: '???',
    },
  ];

  const originalBody: BodySpec = {
    id: 0,
    name: 'original',
    descr: 'good all-round body',
    sprite: 'body_original',
    speedmodifier: 1.0,
    healingspd: 0.16,
    impactrecvdmgmult: 0.125,
    impactdealdmgmult: 0.25,
    impactdmgmult: 0.125,
    impactdealcritical: 10,
    impactdealcriticaldmg: 0.5,
    impactsleeptime: 10,
    impactcamshake: 2,
    impactspeedmult: 0.9,
    maxhealth: 16,
    meleedmg: 10000,
    flags: '',
  };

  const bodiesById: BodySpec[] = [
    originalBody,
    {
      ...originalBody,
      id: 1,
      name: 'armor',
      sprite: 'body_armor',
      speedmodifier: 0.8,
      maxhealth: 28,
    },
    {
      ...originalBody,
      id: 2,
      name: 'melee',
      sprite: 'body_melee',
      maxhealth: 11,
      impactdmgmult: 0.0,
      impactrecvdmgmult: 0.0,
      impactsleeptime: 0,
      impactcamshake: 0,
      meleedmg: 0,
    },
    {
      ...originalBody,
      id: 3,
      name: 'nuke',
      sprite: 'body_nuke',
      impactdmgmult: 0.25,
      flags: 'nuke-on-death',
    },
    {
      ...originalBody,
      id: 4,
      name: 'bomb',
      sprite: 'body_bomb',
      healingspd: 0.12,
      flags: 'body-drop-bomb',
    },
    {
      ...originalBody,
      id: 5,
      name: '???',
      maxhealth: 120,
      healingspd: 0.01,
    },
  ];

  const originalWeapon: WeaponSpec = {
    id: 0,
    name: 'original',
    descr: 'versatile machinegun',
    sprite: 'wings_original',
    projectile: 'bullet',
    interval: 3,
    maxbullets: 1337,
    recoil: 0.0,
    spread: 1.0,
    numbullets: 1,
    flags: '',
  };

  const weaponsById: WeaponSpec[] = [
    originalWeapon,
    {
      ...originalWeapon,
      id: 1,
      name: 'laser',
      sprite: 'wings_laser',
      projectile: 'laser',
      interval: 1,
    },
    {
      ...originalWeapon,
      id: 2,
      name: 'spread',
      sprite: 'wings_spread',
      projectile: 'spreadbullet',
      interval: 9,
      recoil: 1.5,
      spread: 6.0,
      numbullets: 5,
    },
    {
      ...originalWeapon,
      id: 3,
      name: 'missiles',
      sprite: 'wings_missiles',
      projectile: 'missile',
      interval: 5,
      maxbullets: 4,
    },
    {
      ...originalWeapon,
      id: 4,
      name: 'cannon',
      sprite: 'wings_cannon',
      projectile: 'plasmaball',
      interval: 79,
    },
    {
      ...originalWeapon,
      id: 5,
      name: '???',
    },
  ];

  const engines: Record<string, EngineSpec> = {};
  for (const e of enginesById) engines[e.name] = e;
  const bodyparts: Record<string, BodySpec> = {};
  for (const b of bodiesById) bodyparts[b.name] = b;
  const weapons: Record<string, WeaponSpec> = {};
  for (const w of weaponsById) weapons[w.name] = w;

  const baseEnemy: EnemySpec = {
    key: 'fighter',
    name: 'Fighter',
    bodysprite: 'fighter_body',
    wingssprite: 'fighter_wings',
    difficultyweight: 15,
    health: 6,
    initvelocity: 8,
    velocityvariance: 0,
    gravity: 0.05,
    friction: 0.1,
    constantforce: 0.6,
    environmentaldmg: 0.5,
    environmentalyforce: 1.0,
    reaction: 0.3,
    reactionvariance: 0.1,
    turnvariance: 3.0,
    turnspeedvariance: 0,
    minspeed: 2,
    maxspeed: 6,
    initmaxspeed: 6,
    minspeedvariance: 4,
    maxspeedvariance: 2,
    speed: 6,
    maxvspeed: 6,
    vspeedthrottler: 0.1,
    constantplayerchaseforce: 0.4,
    turndistance: 600,
    turndistancerand: 600,
    fireinterval: 20,
    fireintervalrand: 90,
    minfiredist: 40,
    bulletspeed: 14,
    boostdstplayer: 320,
    boostdstspeed: 3,
    airethinktimer: 60,
    airethinktimerrand: 90,
    reactionseaheighta: 100,
    reactionseaheightb: 200,
    reactionspaceheightoffseta: 100,
    reactionspaceheightoffsetb: 200,
    reactionchangea: 1.2,
    reactionchangeb: 1.0,
    initbulletspersalvo: 1,
    bulletspersalvo: 1,
    bulletfireinterval: 3,
    firesalvotimer: 90,
    firesalvotimerrand: 120,
    salvofirelimiterperboatmultiplier: 4,
    gunrotationspeed: 2,
    surfacetimer: 80,
    sinkingtimer: 80,
    sinkingspeed: 0.5,
    firstacelaunchinterval: 30,
    acelaunchinterval: 20,
    projectilefireinterval: 60,
    lifetime: 600,
    activationtimer: 5,
    damageonhit: 4,
    spawnceilingoffset: -200,
    spawnfallspeed: 1,
    fallnumframes: 300,
  };

  const enemies: Record<string, EnemySpec> = {
    fighter: { ...baseEnemy },
    jet: {
      ...baseEnemy,
      key: 'jet',
      name: 'Jet',
      bodysprite: 'jet_body',
      wingssprite: 'jet_wings',
      difficultyweight: 25,
      health: 6,
      speed: 20,
      fireinterval: 999999999999,
      bulletspeed: 5,
    },
    ace: {
      ...baseEnemy,
      key: 'ace',
      name: 'Ace',
      bodysprite: 'ace_body',
      wingssprite: 'ace_wings',
      difficultyweight: 80,
      health: 60,
      gravity: 0.4,
      initvelocity: 6,
      maxspeed: 4,
      boostdstplayer: 300,
      boostdstspeed: 5,
      initbulletspersalvo: 16,
      bulletspersalvo: 12,
      bulletspeed: 20,
      bulletfireinterval: 3,
    },
    laserace: {
      ...baseEnemy,
      key: 'laserace',
      name: 'Ace',
      bodysprite: 'laserace_body',
      wingssprite: 'laserace_wings',
      difficultyweight: 80,
      health: 60,
      gravity: 0.4,
      initvelocity: 8,
      maxspeed: 4,
      boostdstplayer: 400,
      boostdstspeed: 6,
      initbulletspersalvo: 60,
      bulletspersalvo: 60,
      bulletspeed: 20,
      bulletfireinterval: 3,
    },
    boat: {
      ...baseEnemy,
      key: 'boat',
      name: 'Boat',
      sprite: 'small_boat',
      spritegun: 'small_boat_gun',
      difficultyweight: 40,
      health: 25,
      initvelocity: 1,
      velocityvariance: 1,
      bulletspersalvo: 3,
      firesalvotimer: 90,
      firesalvotimerrand: 120,
      salvofirelimiterperboatmultiplier: 4,
      bulletfireinterval: 10,
      bulletspeed: 10,
      gunrotationspeed: 2,
    },
    bigboat: {
      ...baseEnemy,
      key: 'bigboat',
      name: 'BigBoat',
      sprite: 'big_boat',
      spritegun: 'big_boat_gun',
      difficultyweight: 160,
      health: 210,
      initvelocity: 0.5,
      velocityvariance: 1,
      bulletspersalvo: 18,
      firesalvotimer: 30,
      firesalvotimerrand: 30,
      salvofirelimiterperboatmultiplier: 4,
      bulletfireinterval: 3,
      bulletspeed: 10,
      gunrotationspeed: 6,
    },
    submarine: {
      ...baseEnemy,
      key: 'submarine',
      name: 'Submarine',
      sprite: 'submarine',
      difficultyweight: 250,
      health: 80,
      initvelocity: -0.5,
      surfacetimer: 80,
      bulletspersalvo: 3,
      firesalvotimer: 30,
      projectilefireinterval: 60,
    },
    acemarine: {
      ...baseEnemy,
      key: 'acemarine',
      name: 'AceMarine',
      sprite: 'acemarine',
      spritegun: 'big_boat_gun',
      difficultyweight: 1500,
      health: 140,
      initvelocity: -0.2,
      surfacetimer: 200,
      sinkingtimer: 80,
      sinkingspeed: 0.5,
      bulletspersalvo: 3,
      firesalvotimer: 100,
      firstacelaunchinterval: 30,
      acelaunchinterval: 20,
      projectilefireinterval: 5,
    },
    missile: {
      ...baseEnemy,
      key: 'missile',
      name: 'Missile',
      sprite: 'missile',
      difficultyweight: 5,
      health: 20,
      initvelocity: -2,
      gravity: 0.1,
      lifetime: 600,
      activationtimer: 5,
      damageonhit: 4,
    },
    blimp: {
      ...baseEnemy,
      key: 'blimp',
      name: 'Blimp',
      sprite: 'blimp',
      spritegun: 'big_boat_gun',
      difficultyweight: 1000,
      health: 600,
      initvelocity: 0.5,
      velocityvariance: 1,
      bulletspersalvo: 32,
      firesalvotimer: 50,
      firesalvotimerrand: 30,
      bulletfireinterval: 1,
      bulletspeed: 10,
      gunrotationspeed: 1,
      spawnceilingoffset: -200,
      spawnfallspeed: 1,
      fallnumframes: 300,
    },
  };

  const enemiesSfmt: Record<string, EnemySpec> = {
    ...enemies,
    jet: { ...enemies.jet!, fireinterval: 5, bulletspeed: 5 },
    ace: { ...enemies.ace!, health: 50, bulletspeed: 24, boostdstplayer: 400, boostdstspeed: 6 },
    boat: { ...enemies.boat!, health: 20, bulletspersalvo: 4, bulletfireinterval: 5, bulletspeed: 12 },
    bigboat: { ...enemies.bigboat!, health: 160, bulletspersalvo: 36, firesalvotimer: 5, bulletfireinterval: 1 },
    submarine: { ...enemies.submarine!, health: 60, bulletspersalvo: 6, projectilefireinterval: 30 },
    acemarine: { ...enemies.acemarine!, bulletspersalvo: 6, projectilefireinterval: 3 },
  };

  // Build 125 standard planenames (0..4 x 0..4 x 0..4) + URAUSER ([5,5,5])
  const planenames: PlaneNameEntry[] = [];
  for (let e = 0; e <= 4; e++) {
    for (let b = 0; b <= 4; b++) {
      for (let w = 0; w <= 4; w++) {
        let name = `rauser-${w}-${b}-${e}`;
        if (w === 0 && b === 0 && e === 0) name = 'original';
        else if (w === 1 && b === 0 && e === 0) name = 'beamrauser';
        else if (w === 2 && b === 0 && e === 0) name = 'spreadrauser';
        planenames.push({ name, weapon: w, body: b, engine: e });
      }
    }
  }
  planenames.push({ name: 'URAUSER', weapon: 5, body: 5, engine: 5 });

  // Build 90 missions (3 categories * 6 parts * 5 missions)
  const missions: MissionSpec[] = [];
  let missionId = 0;
  for (let cat = 0; cat < 3; cat++) {
    for (let part = 0; part < 6; part++) {
      for (let idx = 0; idx < 5; idx++) {
        // First weapon/body/engine mission targets simple kills/score for fast testing
        const isFirstOriginalWeapon = cat === 0 && part === 0 && idx === 0;
        const isFirstBody = cat === 1 && part === 0 && idx === 0;
        const isFirstEngine = cat === 2 && part === 0 && idx === 0;
        const objective = isFirstEngine ? 2 : 0;
        const condition = isFirstOriginalWeapon ? 12 : 0;
        const val: [number, number] = isFirstOriginalWeapon
          ? [5, 1]
          : isFirstEngine
            ? [1000, 0]
            : isFirstBody
              ? [10, 0]
              : [5 + idx * 5, 0];
        missions.push({
          id: missionId++,
          component: [cat, part, idx],
          objective,
          condition,
          val,
          title: `M-${cat}-${part}-${idx}`,
          description: `Test mission ${cat}-${part}-${idx}`,
        });
      }
    }
  }

  const emptyAtlas: SpriteAtlasSpec = {
    name: 'sprites',
    texturePath: '',
    width: 64,
    height: 64,
    sprites: {},
  };
  const emptyFonts: Record<string, BitmapFontSpec> = {};

  return {
    vaultSource: 'procedural-fallback',
    steamDir: null,
    player: {
      settings: {
        body: 'original',
        engine: 'original',
        weapon: 'original',
        canshoot: true,
        meleedmg: 10000,
        waterrotationforcedegrees: 3,
      },
      engines,
      bodyparts,
      weapons,
      enginesById,
      bodiesById,
      weaponsById,
    },
    projectiles: {
      bullet: { id: 'bullet', ttl: 60, dmg: 4, speed: 24, degreesoffset: 3, sfxfire: '', flags: '' },
      laser: { id: 'laser', ttl: 1, dmg: 1, speed: 0, degreesoffset: 0, sfxfire: '', flags: '' },
      spreadbullet: { id: 'spreadbullet', ttl: 40, dmg: 2, speed: 20, degreesoffset: 0, sfxfire: '', flags: '' },
      missile: { id: 'missile', ttl: 40, dmg: 6, speed: 4, degreesoffset: 0, sfxfire: '', flags: 'do-physics?' },
      plasmaball: { id: 'plasmaball', ttl: 60, dmg: 20, speed: 10, degreesoffset: 0, sfxfire: '', flags: 'explode-on-destroy' },
      ebullet: { id: 'ebullet', ttl: 180, dmg: 6, speed: 0, degreesoffset: 0, sfxfire: '', flags: '' },
    },
    enemies,
    enemiesSfmt,
    spawnCoordinator: {
      initialDifficulty: 60,
      maxPercentageBoats: 0.5,
      maxNumAcePerDifficultyPerc: 0.002,
      maxNumBlimpsPerDifficultyPerc: 0.001,
      aceToLaserAceChance: 0.016667,
      minNumSubmarineKillsForAceMarine: 1,
      submarineToAceMarineChance: 0.3333333333,
      increaseDifficulty: [
        { add: 1, max: 99999999 },
        { add: 1, max: 200 },
        { add: 1, max: 350 },
      ],
      spawnlist: [
        { difficulty: -1, choose: ['Fighter'] },
        { difficulty: 60, choose: ['Fighter', 'Fighter', 'Fighter', 'Boat'] },
        { difficulty: 160, choose: ['Fighter', 'Boat', 'Jet'] },
        { difficulty: 220, choose: ['Fighter', 'Boat', 'Jet', 'BigBoat'] },
        { difficulty: 340, choose: ['Fighter', 'Boat', 'Jet', 'Ace', 'BigBoat'] },
        { difficulty: 480, choose: ['Fighter', 'Boat', 'Jet', 'Ace', 'Submarine', 'BigBoat'] },
        { difficulty: 600, choose: ['Blimp', 'Fighter', 'Boat', 'Jet', 'Ace', 'Submarine', 'BigBoat'] },
      ],
    },
    spawnCoordinatorSfmt: {
      initialDifficulty: 60,
      maxPercentageBoats: 0.5,
      maxNumAcePerDifficultyPerc: 0.002,
      maxNumBlimpsPerDifficultyPerc: 0.001,
      aceToLaserAceChance: 0.016667,
      minNumSubmarineKillsForAceMarine: 1,
      submarineToAceMarineChance: 0.3333333333,
      increaseDifficulty: [
        { add: 1, max: 99999999 },
        { add: 1, max: 200 },
        { add: 1, max: 350 },
        { add: 50, max: 700 },
      ],
      spawnlist: [
        { difficulty: -1, choose: ['Fighter'] },
        { difficulty: 60, choose: ['Fighter', 'Fighter', 'Fighter', 'Boat'] },
        { difficulty: 160, choose: ['Fighter', 'Boat', 'Jet'] },
        { difficulty: 220, choose: ['Fighter', 'Boat', 'Jet', 'BigBoat'] },
        { difficulty: 340, choose: ['Fighter', 'Boat', 'Jet', 'Ace', 'BigBoat'] },
        { difficulty: 480, choose: ['Fighter', 'Boat', 'Jet', 'Ace', 'Submarine', 'BigBoat'] },
        { difficulty: 600, choose: ['Blimp', 'Fighter', 'Boat', 'Jet', 'Ace', 'Submarine', 'BigBoat'] },
      ],
    },
    global: {
      customizetypes: {
        engine: { original: 0, superboost: 1, gungine: 2, underwater: 3, hover: 4, '???': 5 },
        body: { original: 0, armor: 1, melee: 2, nuke: 3, bomb: 4, '???': 5 },
        weapon: { original: 0, laser: 1, spread: 2, missiles: 3, cannon: 4, '???': 5 },
      },
      missions,
      planenames,
    },
    fx: {
      generic: {
        repair: {
          key: 'repair',
          spritename: 'fx_repair',
          depth: -5,
          imagespeed: 0.5,
          imagespeedrand: 0,
          friction: 0,
          vspeed: 0.3,
          vspeedrand: 0,
          imageanglerand: 0,
          initvelocity: 0,
          initvelocityrand: 4,
          loop: true,
          allowbelowsea: true,
          ttl: 3,
          ttlrand: 8,
          scaley: 1,
        },
        boostend: {
          key: 'boostend',
          spritename: 'fx_boostend',
          depth: -5,
          imagespeed: 0.4,
          imagespeedrand: 0,
          friction: 0,
          vspeed: 0,
          vspeedrand: 0,
          imageanglerand: 0,
          initvelocity: 0,
          initvelocityrand: 0,
          loop: false,
          allowbelowsea: true,
          ttl: 12,
          ttlrand: 0,
          scaley: 1,
        },
        jet_trail: {
          key: 'jet_trail',
          spritename: 'fx_jet_trail',
          depth: -3,
          imagespeed: 0,
          imagespeedrand: 0,
          friction: 0,
          vspeed: 0,
          vspeedrand: 0,
          imageanglerand: 0,
          initvelocity: 0,
          initvelocityrand: 0,
          loop: false,
          allowbelowsea: true,
          ttl: 0,
          ttlrand: 0,
          scaley: -0.02,
        },
      },
      explosions: {
        explode_small: {
          key: 'explode_small',
          spritename: 'fx_explodesmall',
          depth: -5,
          imageanglerand: 0,
          initsubspritename: 'smoke',
          numinitsubsprites: 1,
          initsubspritesrandpos: 0,
          shake: 1,
          randspawn: 0,
          randspawnspritename: '',
          splashchance: 0,
          splashspritename: 'splashS',
          floatwater: false,
          playerdmg: 0,
          playerburn: 0,
          fadespawnchance: 0,
          fadespawnspritename: '',
          collisions: false,
        },
      },
    },
    parallax: {
      timer0: 600,
      timer0subtrmult: 20,
      stages: [
        { stage: 1, minimumDifficulty: 0, spawn: ['bgBoat'] },
        { stage: 2, minimumDifficulty: 150, spawn: ['bgJet'] },
        { stage: 3, minimumDifficulty: 300, timerID: 0, timer: 30, spawn: ['bgSub'] },
        { stage: 4, minimumDifficulty: 500, spawn: ['bgBoatr', 'bgJet'] },
        { stage: 5, minimumDifficulty: 750, spawn: ['bgBlimp'] },
      ],
    },
    room: {
      sealevel: 0,
      spacelevel: -1300,
    },
    atlases: {
      sprites: emptyAtlas,
      menusprites: emptyAtlas,
      nukesprites: emptyAtlas,
    },
    fonts: emptyFonts,
  };
}

describe('Deterministic 60Hz Simulation Parity', () => {
  it('SeededRng produces deterministic sequences within bounds', () => {
    const a = new SeededRng(424242);
    const b = new SeededRng(424242);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
      expect(a.range(-5, 5)).toBe(b.range(-5, 5));
      const iv = a.int(3, 7);
      expect(iv).toBe(b.int(3, 7));
      expect(iv).toBeGreaterThanOrEqual(3);
      expect(iv).toBeLessThanOrEqual(7);
      expect(a.pick(['x', 'y', 'z'])).toBe(b.pick(['x', 'y', 'z']));
    }
  });

  it('ModRegistry defaults to vanillaLocked=true and gates flight mutators', () => {
    const reg = new ModRegistry();
    expect(reg.isVanillaLocked()).toBe(true);
    expect(reg.vanillaProfile.profileId).toBe('vanilla-1to1');
    reg.register({
      id: 'acro-mod',
      name: 'Acro',
      version: '1.0.0',
      flightMutators: [{ id: 'm1', name: 'Double Turn', apply: (p) => { p.angleDeg += 5; } }],
    });
    expect(reg.getActiveFlightMutators()).toHaveLength(0);
    reg.setVanillaLock(false);
    expect(reg.getActiveFlightMutators()).toHaveLength(1);
  });

  it('1. Exact determinism: two 1,200-tick runs with identical seed & replay match bit-for-bit', () => {
    const data = createTestGameDataBundle();
    const simA = new Simulation(data);
    const simB = new Simulation(data);

    simA.launch({ weapon: 0, body: 0, engine: 0 }, 'normal', 987654);
    simB.launch({ weapon: 0, body: 0, engine: 0 }, 'normal', 987654);

    for (let t = 0; t < 1200; t++) {
      const snapCurrA = simA.getSnapshot();
      const inputA = computeAutopilotInput(snapCurrA);
      const snapCurrB = simB.getSnapshot();
      const inputB = computeAutopilotInput(snapCurrB);
      simA.step(inputA);
      simB.step(inputB);
    }

    const snapA = simA.getSnapshot();
    const snapB = simB.getSnapshot();
    expect(snapA.tick).toBe(1200);
    expect(snapA.player.x).toBe(snapB.player.x);
    expect(snapA.player.y).toBe(snapB.player.y);
    expect(snapA.score).toBe(snapB.score);
    expect(snapA.enemies.length).toBe(snapB.enemies.length);
    expect(snapA.combo).toBe(snapB.combo);
    expect(snapA.difficulty).toBe(snapB.difficulty);

    const recording = simA.getReplay();
    expect(recording.frames).toHaveLength(1200);
    const replayed = replaySimulation(data, recording);
    expect(replayed.player.x).toBe(snapA.player.x);
    expect(replayed.player.y).toBe(snapA.player.y);
    expect(replayed.score).toBe(snapA.score);
    expect(replayed.enemies.length).toBe(snapA.enemies.length);
    expect(replayed.combo).toBe(snapA.combo);
  });

  it('2. Stall-whip turn differential (Original 10 vs 4, Superboost 10 vs 1) and Laser 1/3 firing divisor', () => {
    const data = createTestGameDataBundle();
    const sim = new Simulation(data);

    // Original engine: 10 deg/tick unboosted, 4 deg/tick boosted
    launchToPlaying(sim, { weapon: 0, body: 0, engine: 0 }, 'normal', 100);
    let snap = sim.step({ left: false, right: true, thrust: false, fire: false });
    expect(snap.player.angleDeg - snap.player.prevAngleDeg).toBeCloseTo(10, 6);

    snap = sim.step({ left: false, right: true, thrust: true, fire: false });
    expect(snap.player.angleDeg - snap.player.prevAngleDeg).toBeCloseTo(4, 6);

    // Superboost engine: 10 deg/tick unboosted, 1 deg/tick boosted
    launchToPlaying(sim, { weapon: 0, body: 0, engine: 1 }, 'normal', 100);
    snap = sim.step({ left: false, right: true, thrust: false, fire: false });
    expect(snap.player.angleDeg - snap.player.prevAngleDeg).toBeCloseTo(10, 6);

    snap = sim.step({ left: false, right: true, thrust: true, fire: false });
    expect(snap.player.angleDeg - snap.player.prevAngleDeg).toBeCloseTo(1, 6);

    // Laser weapon: 1/3 turn rate while firing
    launchToPlaying(sim, { weapon: 1, body: 0, engine: 0 }, 'normal', 100);
    snap = sim.step({ left: false, right: true, thrust: false, fire: true });
    expect(snap.player.angleDeg - snap.player.prevAngleDeg).toBeCloseTo(10 / 3, 6);

    snap = sim.step({ left: false, right: true, thrust: true, fire: true });
    expect(snap.player.angleDeg - snap.player.prevAngleDeg).toBeCloseTo(4 / 3, 6);
  });

  it('3. Healing lockout while firing vs regeneration during cease-fire', () => {
    const data = createTestGameDataBundle();
    const sim = new Simulation(data);
    launchToPlaying(sim, { weapon: 0, body: 0, engine: 0 }, 'normal', 200);
    sim.damagePlayer(8);
    const damagedHp = sim.getSnapshot().player.health;
    expect(damagedHp).toBe(8);

    // Firing for 30 ticks keeps healing locked out
    for (let i = 0; i < 30; i++) {
      const snap = sim.step({ left: false, right: false, thrust: true, fire: true });
      expect(snap.player.healing).toBe(false);
      expect(snap.player.health).toBe(damagedHp);
    }

    // Cease fire: after 12 ticks, regenerates by body.healingspd (0.16/tick) until full HP
    let sawHealCue = false;
    let sawHealedCue = false;
    for (let i = 0; i < 80; i++) {
      const snap = sim.step({ left: false, right: false, thrust: true, fire: false });
      for (const ev of snap.audioEvents) {
        if (ev.cue === 'sndheal') sawHealCue = true;
        if (ev.cue === 'sndhealed') sawHealedCue = true;
      }
      if (i === 11) {
        // 12th cease-fire tick engages healing (+0.16)
        expect(snap.player.healing).toBe(true);
        expect(snap.player.health).toBeCloseTo(8.16, 4);
      }
    }
    const finalSnap = sim.getSnapshot();
    expect(finalSnap.player.health).toBe(finalSnap.player.maxHealth);
    expect(sawHealCue).toBe(true);
    expect(sawHealedCue).toBe(true);
  });

  it('4. Water buoyancy, pitch restoration, and waterproof immunity vs Space ceiling stall & damage', () => {
    const data = createTestGameDataBundle();

    // Standard engine plunged into ocean: loses HP, pitches toward -90, floats back up
    const simOrig = new Simulation(data);
    launchToPlaying(simOrig, { weapon: 0, body: 0, engine: 0 }, 'normal', 300);
    // Turn straight down (+90) in 18 ticks (18 * 10 = 180 deg) then thrust into water
    for (let i = 0; i < 18; i++) {
      simOrig.step({ left: false, right: true, thrust: false, fire: false });
    }
    let enteredWater = false;
    let waterDamaged = false;
    let pitchedUpward = false;
    let prevAngleUnderwater: number | null = null;
    for (let i = 0; i < 90; i++) {
      const snap = simOrig.step({ left: false, right: false, thrust: i < 42, fire: false });
      if (snap.player.underwater) {
        enteredWater = true;
        if (snap.player.health < snap.player.maxHealth) waterDamaged = true;
        if (prevAngleUnderwater !== null && snap.player.angleDeg < prevAngleUnderwater) {
          pitchedUpward = true;
        }
        prevAngleUnderwater = snap.player.angleDeg;
      }
    }
    expect(enteredWater).toBe(true);
    expect(waterDamaged).toBe(true);
    expect(pitchedUpward).toBe(true);

    // Underwater engine (waterproof: true): zero water damage even when submerged
    const simSub = new Simulation(data);
    launchToPlaying(simSub, { weapon: 0, body: 0, engine: 3 }, 'normal', 300);
    for (let i = 0; i < 18; i++) {
      simSub.step({ left: false, right: true, thrust: false, fire: false });
    }
    let subWentUnderwater = false;
    for (let i = 0; i < 80; i++) {
      const snap = simSub.step({ left: false, right: false, thrust: i < 55, fire: false });
      if (snap.player.underwater) {
        subWentUnderwater = true;
        expect(snap.player.health).toBe(snap.player.maxHealth);
      }
    }
    expect(subWentUnderwater).toBe(true);

    // Space ceiling (y < -1300): pushes vy downward and deals space damage
    const simSpace = new Simulation(data);
    launchToPlaying(simSpace, { weapon: 0, body: 0, engine: 0 }, 'normal', 301);
    let enteredSpace = false;
    let spaceDamaged = false;
    for (let i = 0; i < 200; i++) {
      const snap = simSpace.step({ left: false, right: false, thrust: true, fire: false });
      if (snap.player.inSpace) {
        enteredSpace = true;
        if (snap.player.health < snap.player.maxHealth) {
          spaceDamaged = true;
          expect(snap.player.envSpaceFactor).toBeGreaterThan(0);
          break;
        }
      }
    }
    expect(enteredSpace).toBe(true);
    expect(spaceDamaged).toBe(true);
  });

  it('5a. Weapons: gungine rear bullets, spread recoil & 5 pellets, missiles 4-cap, cannon 79-tick AOE', () => {
    const data = createTestGameDataBundle();

    // Gungine rear bullets while boosting
    const simGun = new Simulation(data);
    launchToPlaying(simGun, { weapon: 0, body: 0, engine: 2 }, 'normal', 400);
    let snap = simGun.step({ left: false, right: false, thrust: true, fire: false });
    const gungineBullets = snap.projectiles.filter((p) => p.fromGungine);
    expect(gungineBullets.length).toBe(1);
    expect(gungineBullets[0]!.dmg).toBe(4);
    expect(Math.hypot(gungineBullets[0]!.vx, gungineBullets[0]!.vy)).toBeCloseTo(24, 4);
    expect(snap.audioEvents.some((e) => e.cue === 'sndgungine')).toBe(true);

    // Spread: 5 pellets + 1.5 recoil opposite facing (-90 deg -> vy increases by +1.5)
    const simSpread = new Simulation(data);
    const preSpread = launchToPlaying(simSpread, { weapon: 2, body: 0, engine: 0 }, 'normal', 401);
    snap = simSpread.step({ left: false, right: false, thrust: false, fire: true });
    expect(snap.projectiles.filter((p) => p.kind === 'spreadbullet')).toHaveLength(5);
    expect(snap.player.vy).toBeCloseTo((preSpread.player.vy + 0.2) * 0.96 + 1.5, 3);

    // Missiles: strict max 4 active cap + sndmisempty on 5th attempt
    const simMis = new Simulation(data);
    launchToPlaying(simMis, { weapon: 3, body: 0, engine: 0 }, 'normal', 402);
    simMis.spawnEnemy('BigBoat', 300, 0);
    let sawEmptyCue = false;
    for (let i = 0; i < 30; i++) {
      snap = simMis.step({ left: false, right: false, thrust: true, fire: true });
      const activeM = snap.projectiles.filter((p) => p.kind === 'missile');
      expect(activeM.length).toBeLessThanOrEqual(4);
      if (snap.audioEvents.some((e) => e.cue === 'sndmisempty')) sawEmptyCue = true;
    }
    expect(sawEmptyCue).toBe(true);

    // Cannon: 79-tick interval + AOE explosion damaging nearby enemies
    const simCan = new Simulation(data);
    const preCan = launchToPlaying(simCan, { weapon: 4, body: 0, engine: 0 }, 'normal', 403);
    const e1 = simCan.spawnEnemy('Ace', 0, preCan.player.y - 128);
    const e2 = simCan.spawnEnemy('Fighter', 40, preCan.player.y - 128);
    snap = simCan.step({ left: false, right: false, thrust: true, fire: true });
    expect(snap.projectiles.filter((p) => p.kind === 'plasmaball')).toHaveLength(1);
    expect(snap.player.fireCooldown).toBe(79);

    // Step 79 frames -> plasmaball hits Ace (60 HP) and splashes Fighter (6 HP)!
    let sawReload = false;
    let sawCannonExplo = false;
    for (let i = 0; i < 79; i++) {
      snap = simCan.step({ left: false, right: false, thrust: true, fire: true });
      if (snap.audioEvents.some((e) => e.cue === 'sndcannonreload')) sawReload = true;
      if (snap.audioEvents.some((e) => e.cue === 'sndcannonexplo')) sawCannonExplo = true;
    }
    expect(sawCannonExplo).toBe(true);
    expect(sawReload).toBe(true);
    // Cannon fired again on tick 80 (index 78 of loop = tick 80)
    expect(snap.player.fireCooldown).toBe(79);
    const ace = snap.enemies.find((e) => e.id === e1.id);
    const fighter = snap.enemies.find((e) => e.id === e2.id);
    expect(ace!.health).toBeLessThan(60);
    expect(fighter).toBeUndefined(); // Fighter (6 HP) killed by 20 dmg AOE!
  });

  it('5b. Bodies & Loadouts: melee zero self-dmg, nuke radial wipe, bomb drop, 126 aircraft & URAUSER', () => {
    const data = createTestGameDataBundle();

    // Melee body: ramming deals >= 24 damage with ZERO self-damage and ZERO hitstop
    const simMelee = new Simulation(data);
    const preMelee = launchToPlaying(simMelee, { weapon: 0, body: 2, engine: 0 }, 'normal', 500);
    simMelee.spawnEnemy('Fighter', 0, preMelee.player.y - 24);
    for (let i = 0; i < 10; i++) {
      simMelee.step({ left: false, right: false, thrust: true, fire: false });
    }
    const meleeSnap = simMelee.getSnapshot();
    expect(meleeSnap.player.health).toBe(11);
    expect(meleeSnap.hitstopTicks).toBe(0);
    expect(meleeSnap.killsByKind['Fighter']).toBe(1);

    // Nuke body: death triggers 420px radial wipe & awards kills
    const simNuke = new Simulation(data);
    const preNuke = launchToPlaying(simNuke, { weapon: 0, body: 3, engine: 0 }, 'normal', 501);
    simNuke.spawnEnemy('Fighter', 180, preNuke.player.y);
    simNuke.spawnEnemy('Boat', -200, 0);
    simNuke.damagePlayer(999);
    const deathSnap = simNuke.getSnapshot();
    expect(deathSnap.player.alive).toBe(false);
    expect(deathSnap.player.nukeTriggered).toBe(true);
    let nukeSfx = deathSnap.audioEvents.some((e) => e.cue === 'sndnuke');
    for (let i = 0; i < 25; i++) {
      const s = simNuke.step(IDLE_INPUT);
      if (s.audioEvents.some((e) => e.cue === 'sndnuke')) nukeSfx = true;
    }
    const afterNuke = simNuke.getSnapshot();
    expect(nukeSfx).toBe(true);
    expect(afterNuke.killsThisSortie).toBeGreaterThanOrEqual(2);
    expect(afterNuke.score).toBeGreaterThan(0);

    // Bomb body: drops bombs every 24 ticks when firing/boosting
    const simBomb = new Simulation(data);
    launchToPlaying(simBomb, { weapon: 0, body: 4, engine: 0 }, 'normal', 502);
    const snap1 = simBomb.step({ left: false, right: false, thrust: true, fire: false });
    expect(snap1.projectiles.some((p) => p.kind === 'bomb')).toBe(true);

    // 126 Aircraft Resolution: 125 standard + URAUSER [5,5,5] + partial 5 -> '???'
    const simNames = new Simulation(data);
    for (let w = 0 as PartIndex; w <= 4; w = (w + 1) as PartIndex) {
      for (let b = 0 as PartIndex; b <= 4; b = (b + 1) as PartIndex) {
        for (let e = 0 as PartIndex; e <= 4; e = (e + 1) as PartIndex) {
          simNames.setLoadout({ weapon: w, body: b, engine: e });
          const s = simNames.getSnapshot();
          expect(s.player.planeName).not.toBe('???');
          expect(s.player.isUrauser).toBe(false);
        }
      }
    }
    simNames.setLoadout({ weapon: 5, body: 0, engine: 0 });
    expect(simNames.getSnapshot().player.planeName).toBe('???');
    expect(simNames.getSnapshot().player.isUrauser).toBe(false);

    simNames.launch({ weapon: 5, body: 5, engine: 5 }, 'normal', 503);
    const ura = simNames.getSnapshot();
    expect(ura.player.planeName).toBe('URAUSER');
    expect(ura.player.isUrauser).toBe(true);
    expect(ura.player.maxHealth).toBe(120);
    expect(ura.player.bodySpec.healingspd).toBe(0.01);
  });

  it('6. Combo x1..x20 MAX & decay warning, SFMT vs Normal Jet behavior, and 90-mission part unlock', () => {
    const data = createTestGameDataBundle();
    const sim = new Simulation(data);
    // Use hover engine (4) so plane stays smoothly aloft during 180-tick combo decay window
    const preCombo = launchToPlaying(sim, { weapon: 4, body: 0, engine: 4 }, 'normal', 600);

    // Spawn 20 fighters timed to cross (-76 -> +4) right as the plasmaball reaches y = preCombo.player.y - 108
    for (let i = 0; i < 20; i++) {
      sim.spawnEnemy('Fighter', -76, preCombo.player.y - 108 - (i % 4) * 6);
    }
    let reachedMax = false;
    for (let t = 0; t < 20; t++) {
      const s = sim.step({ left: false, right: false, thrust: false, fire: true });
      if (s.combo === 20 && s.audioEvents.some((e) => e.cue === 'sndmaxcombo')) {
        reachedMax = true;
      }
    }
    expect(sim.getSnapshot().combo).toBe(20);
    expect(reachedMax).toBe(true);

    // Let combo decay -> warning (<60) -> drop back to 1 while cruising up-right safely
    let sawWarn = false;
    let sawDrop = false;
    for (let t = 0; t < 360; t++) {
      const s = sim.step({
        left: false,
        right: t < 7,
        thrust: t >= 7,
        fire: false,
      });
      if (s.comboWarning) sawWarn = true;
      if (s.audioEvents.some((e) => e.cue === 'sndcombodrop')) sawDrop = true;
      if (sawDrop) break;
    }
    expect(sawWarn).toBe(true);
    expect(sawDrop).toBe(true);
    expect(sim.getSnapshot().combo).toBe(1);

    // Normal Jet does NOT fire; SFMT Jet DOES fire
    const simNorm = new Simulation(data);
    launchToPlaying(simNorm, { weapon: 0, body: 0, engine: 0 }, 'normal', 601);
    simNorm.spawnEnemy('Jet', -200, -120);
    let normEnemyBullets = 0;
    for (let i = 0; i < 40; i++) {
      const s = simNorm.step(IDLE_INPUT);
      normEnemyBullets += s.projectiles.filter((p) => p.owner === 'enemy').length;
    }
    expect(normEnemyBullets).toBe(0);

    const simSfmt = new Simulation(data);
    launchToPlaying(simSfmt, { weapon: 0, body: 0, engine: 0 }, 'sfmt', 601);
    simSfmt.spawnEnemy('Jet', -200, -120);
    let sfmtEnemyBullets = 0;
    for (let i = 0; i < 40; i++) {
      const s = simSfmt.step(IDLE_INPUT);
      sfmtEnemyBullets += s.projectiles.filter((p) => p.owner === 'enemy').length;
    }
    expect(sfmtEnemyBullets).toBeGreaterThan(0);

    // 90-mission tracking & part unlock: [0,0,0] requires killing 5 Fighters in one sortie
    const simM = new Simulation(data);
    simM.setProfile(createDefaultProfile());
    launchToPlaying(simM, { weapon: 0, body: 0, engine: 0 }, 'normal', 602);
    expect(simM.getSnapshot().activeMissions).toHaveLength(3);
    for (let i = 0; i < 10; i++) {
      simM.spawnEnemy('Fighter', (i % 2 === 0 ? 1 : -1) * (140 + i * 24), -260);
    }
    for (let i = 0; i < 1200; i++) {
      const s = simM.getSnapshot();
      if (s.profile.completedMissions.length >= 1 && s.profile.unlockedWeapons.includes(1)) {
        break;
      }
      simM.step(computeAutopilotInput(s));
    }
    const mSnap = simM.getSnapshot();
    expect(mSnap.profile.completedMissions.length).toBeGreaterThanOrEqual(1);
    expect(mSnap.profile.unlockedWeapons).toContain(1);
  });

  it('7. Ace Pilot Bot flies a 3,600-tick (60s) sortie cleanly, scoring kills and building combos', () => {
    const data = createTestGameDataBundle();
    const sim = new Simulation(data);
    sim.launch({ weapon: 0, body: 0, engine: 0 }, 'normal', 77777);

    let maxComboSeen = 1;
    for (let t = 0; t < 3600; t++) {
      const curr = sim.getSnapshot();
      if (curr.phase !== 'playing' && curr.phase !== 'launching') break;
      const aiInput = computeAutopilotInput(curr);
      const next = sim.step(aiInput);
      expect(Number.isFinite(next.player.x)).toBe(true);
      expect(Number.isFinite(next.player.y)).toBe(true);
      expect(Number.isFinite(next.player.vx)).toBe(true);
      expect(Number.isFinite(next.player.vy)).toBe(true);
      expect(Number.isNaN(next.player.health)).toBe(false);
      if (next.combo > maxComboSeen) maxComboSeen = next.combo;
    }

    const finalSnap = sim.getSnapshot();
    expect(finalSnap.killsThisSortie).toBeGreaterThanOrEqual(5);
    expect(finalSnap.score).toBeGreaterThan(0);
    expect(maxComboSeen).toBeGreaterThanOrEqual(2);
  });

  it('8. Hitstop, Submarine missile launch, BigBoat SFMT/Normal stats, Blimp, and Parallax behave cleanly', () => {
    const data = createTestGameDataBundle();

    // Hitstop freeze frames on non-melee collision
    const simHitstop = new Simulation(data);
    const preHitstop = launchToPlaying(simHitstop, { weapon: 0, body: 0, engine: 0 }, 'normal', 800);
    simHitstop.spawnEnemy('Fighter', 0, preHitstop.player.y - 24);
    let sawHitstop = false;
    for (let i = 0; i < 10; i++) {
      const s = simHitstop.step({ left: false, right: false, thrust: true, fire: false });
      if (s.hitstopTicks > 0) sawHitstop = true;
    }
    expect(sawHitstop).toBe(true);

    // Submarine surfaces & launches Missile; Blimp spawns with 600 HP and unlocks SFMT on kill
    const simEnemies = new Simulation(data);
    launchToPlaying(simEnemies, { weapon: 5, body: 5, engine: 5 }, 'normal', 801);
    simEnemies.spawnEnemy('Submarine', 120, 10);
    let sawSubMissile = false;
    for (let i = 0; i < 90; i++) {
      const s = simEnemies.step(IDLE_INPUT);
      if (s.enemies.some((e) => e.kind === 'Missile')) sawSubMissile = true;
    }
    const subSnap = simEnemies.getSnapshot();
    expect(sawSubMissile).toBe(true);
    expect(subSnap.parallax.length).toBeGreaterThanOrEqual(1);

    // BigBoat SFMT has 160 HP vs Normal 210 HP; LaserAce fires beam; Blimp unlocks SFMT on death
    const simBigNorm = new Simulation(data);
    launchToPlaying(simBigNorm, { weapon: 0, body: 0, engine: 0 }, 'normal', 802);
    expect(simBigNorm.spawnEnemy('BigBoat', 200, 0).maxHealth).toBe(210);

    const simBigSfmt = new Simulation(data);
    launchToPlaying(simBigSfmt, { weapon: 0, body: 0, engine: 0 }, 'sfmt', 802);
    expect(simBigSfmt.spawnEnemy('BigBoat', 200, 0).maxHealth).toBe(160);

    const simBlimp = new Simulation(data);
    const preBlimp = launchToPlaying(simBlimp, { weapon: 0, body: 3, engine: 0 }, 'normal', 803);
    const blimp = simBlimp.spawnEnemy('Blimp', 50, preBlimp.player.y);
    expect(blimp.maxHealth).toBe(600);
    simBlimp.damagePlayer(999);
    for (let i = 0; i < 30; i++) simBlimp.step(IDLE_INPUT);
    expect(simBlimp.getSnapshot().profile.sfmtUnlocked).toBe(true);
  });

  it('9. Aerodynamic boost curve, boost-release FX/audio, LaserAce, AceMarine, pause/hangar/unlockAll & integrated autopilot replay', () => {
    const data = createTestGameDataBundle();

    // Boost curve hits maxSpeed in ~8-12 ticks and releasing thrust emits sndunboost + boostend
    const simAero = new Simulation(data);
    launchToPlaying(simAero, { weapon: 0, body: 0, engine: 0 }, 'normal', 900);
    for (let i = 0; i < 9; i++) {
      simAero.step({ left: false, right: true, thrust: false, fire: false });
    }
    let hitMaxTick = -1;
    let sawBoostCue = false;
    for (let t = 1; t <= 16; t++) {
      const s = simAero.step({ left: false, right: false, thrust: true, fire: false });
      if (s.audioEvents.some((e) => e.cue === 'sndboost')) sawBoostCue = true;
      const spd = Math.hypot(s.player.vx, s.player.vy);
      if (spd >= 7.99 && hitMaxTick === -1) hitMaxTick = t;
    }
    expect(sawBoostCue).toBe(true);
    expect(hitMaxTick).toBeGreaterThanOrEqual(4);
    expect(hitMaxTick).toBeLessThanOrEqual(14);

    const releaseSnap = simAero.step(IDLE_INPUT);
    expect(releaseSnap.audioEvents.some((e) => e.cue === 'sndunboost')).toBe(true);
    expect(releaseSnap.particles.some((p) => p.kind === 'boostend')).toBe(true);

    // Pause freezes ticks; returnToHangar resets to hangar; unlockAll & resetProfile work
    const tickBeforePause = releaseSnap.tick;
    simAero.setPaused(true);
    const pausedSnap = simAero.step({ left: true, right: false, thrust: true, fire: true });
    expect(pausedSnap.tick).toBe(tickBeforePause);
    simAero.setPaused(false);
    simAero.unlockAll();
    expect(simAero.getProfile().unlockedWeapons).toEqual([0, 1, 2, 3, 4, 5]);
    expect(simAero.getProfile().sfmtUnlocked).toBe(true);
    simAero.resetProfile();
    expect(simAero.getProfile().unlockedWeapons).toEqual([0]);
    expect(simAero.getProfile().sfmtUnlocked).toBe(false);
    simAero.returnToHangar();
    expect(simAero.getSnapshot().phase).toBe('hangar');

    // LaserAce beam & AceMarine Ace launch
    const simBoss = new Simulation(data);
    const preBoss = launchToPlaying(simBoss, { weapon: 0, body: 0, engine: 0 }, 'normal', 901);
    simBoss.spawnEnemy('LaserAce', 220, preBoss.player.y - 40);
    simBoss.spawnEnemy('AceMarine', 260, 10);
    let sawLaserAceBeam = false;
    let sawAceMarineAce = false;
    for (let i = 0; i < 120; i++) {
      const s = simBoss.step(IDLE_INPUT);
      if (s.enemies.some((e) => e.kind === 'LaserAce' && e.laserActive)) {
        sawLaserAceBeam = true;
      }
      if (s.enemies.some((e) => e.kind === 'Ace')) {
        sawAceMarineAce = true;
      }
    }
    expect(sawLaserAceBeam).toBe(true);
    expect(sawAceMarineAce).toBe(true);

    // Integrated setAutopilot(true) replay parity
    const simAuto = new Simulation(data);
    simAuto.launch({ weapon: 2, body: 1, engine: 1 }, 'normal', 902);
    simAuto.setAutopilot(true);
    for (let i = 0; i < 600; i++) {
      simAuto.step(IDLE_INPUT);
    }
    const autoSnap = simAuto.getSnapshot();
    const autoReplay = replaySimulation(data, simAuto.getReplay());
    expect(autoReplay.player.x).toBe(autoSnap.player.x);
    expect(autoReplay.player.y).toBe(autoSnap.player.y);
    expect(autoReplay.score).toBe(autoSnap.score);
  });

  it('10. P0 regression: Player & URAUSER laser beams survive into spawn-tick snapshot and expire on cease-fire', () => {
    const data = createTestGameDataBundle();

    // Standard Laser (weapon 1)
    const simLaser = new Simulation(data);
    launchToPlaying(simLaser, { weapon: 1, body: 0, engine: 0 }, 'normal', 1001);
    const fireSnap = simLaser.step({ left: false, right: false, thrust: false, fire: true });
    const lasersOnFire = fireSnap.projectiles.filter((p) => p.kind === 'laser');
    expect(lasersOnFire.length).toBeGreaterThanOrEqual(1);
    expect(lasersOnFire[0]!.ttl).toBe(1);
    expect(lasersOnFire[0]!.beamLength).toBe(520);

    // Next tick with fire: false -> beam expires cleanly
    const ceaseSnap = simLaser.step(IDLE_INPUT);
    expect(ceaseSnap.projectiles.filter((p) => p.kind === 'laser')).toHaveLength(0);

    // Continuous laser fire keeps exactly 1 active beam per tick
    const hold1 = simLaser.step({ left: false, right: false, thrust: false, fire: true });
    const hold2 = simLaser.step({ left: false, right: false, thrust: false, fire: true });
    expect(hold1.projectiles.filter((p) => p.kind === 'laser')).toHaveLength(1);
    expect(hold2.projectiles.filter((p) => p.kind === 'laser')).toHaveLength(1);

    // URAUSER [5, 5, 5] heavy beam
    const simUra = new Simulation(data);
    launchToPlaying(simUra, { weapon: 5, body: 5, engine: 5 }, 'normal', 1002);
    const uraFire = simUra.step({ left: false, right: false, thrust: false, fire: true });
    expect(uraFire.projectiles.filter((p) => p.kind === 'laser').length).toBeGreaterThanOrEqual(1);
    expect(uraFire.projectiles.filter((p) => p.kind === 'spreadbullet')).toHaveLength(5);
    const uraCease = simUra.step(IDLE_INPUT);
    expect(uraCease.projectiles.filter((p) => p.kind === 'laser')).toHaveLength(0);
  });

  it('11. P1 regression: Healing lockout respects fireCooldown > 0 for Cannon (79) and Spread (9)', () => {
    const data = createTestGameDataBundle();

    // Cannon (interval 79): firing 1 tick locks healing for entire cooldown
    const simCan = new Simulation(data);
    launchToPlaying(simCan, { weapon: 4, body: 0, engine: 4 }, 'normal', 1101);
    simCan.damagePlayer(8);
    const canDamagedHp = simCan.getSnapshot().player.health;

    let snap = simCan.step({ left: false, right: false, thrust: false, fire: true });
    expect(snap.player.fireCooldown).toBe(79);
    expect(snap.player.healing).toBe(false);

    // For 78 ticks (fireCooldown 78 -> 1), fireCooldown > 0 must block healing & healingTicks
    for (let i = 0; i < 78; i++) {
      snap = simCan.step(IDLE_INPUT);
      expect(snap.player.fireCooldown).toBeGreaterThan(0);
      expect(snap.player.healing).toBe(false);
      expect(snap.player.healingTicks).toBe(0);
      expect(snap.player.health).toBe(canDamagedHp);
    }

    // Tick 79 post-fire completes cooldown (fireCooldown -> 0) and begins 12-tick heal delay
    snap = simCan.step(IDLE_INPUT);
    expect(snap.player.fireCooldown).toBe(0);
    expect(snap.player.healing).toBe(false);
    expect(snap.player.healingTicks).toBe(1);

    for (let i = 0; i < 11; i++) {
      snap = simCan.step(IDLE_INPUT);
    }
    expect(snap.player.healing).toBe(true);
    expect(snap.player.health).toBeGreaterThan(canDamagedHp);

    // Spread (interval 9): firing 1 tick locks healing while fireCooldown > 0
    const simSpread = new Simulation(data);
    launchToPlaying(simSpread, { weapon: 2, body: 0, engine: 4 }, 'normal', 1102);
    simSpread.damagePlayer(8);
    const spreadDamagedHp = simSpread.getSnapshot().player.health;

    snap = simSpread.step({ left: false, right: false, thrust: false, fire: true });
    expect(snap.player.fireCooldown).toBe(9);
    for (let i = 0; i < 8; i++) {
      snap = simSpread.step(IDLE_INPUT);
      expect(snap.player.fireCooldown).toBeGreaterThan(0);
      expect(snap.player.healing).toBe(false);
      expect(snap.player.healingTicks).toBe(0);
      expect(snap.player.health).toBe(spreadDamagedHp);
    }
    for (let i = 0; i < 12; i++) {
      snap = simSpread.step(IDLE_INPUT);
    }
    expect(snap.player.healing).toBe(true);
    expect(snap.player.health).toBeGreaterThan(spreadDamagedHp);
  });

  it('12. P2 regression: nuke body impactdmgmult deals and receives higher ram damage than original while melee stays 0 self-damage', () => {
    const data = createTestGameDataBundle();

    const runRam = (body: PartIndex) => {
      const sim = new Simulation(data);
      const pre = launchToPlaying(sim, { weapon: 0, body, engine: 0 }, 'normal', 1200);
      const ace = sim.spawnEnemy('Ace', pre.player.x, pre.player.y - 16);
      // Step 2 ticks thrusting straight up into the Ace
      sim.step({ left: false, right: false, thrust: true, fire: false });
      const post = sim.step({ left: false, right: false, thrust: true, fire: false });
      const postAce = post.enemies.find((e) => e.id === ace.id)!;
      return {
        selfDmg: post.player.maxHealth - post.player.health,
        enemyDmg: ace.maxHealth - postAce.health,
        hitstop: post.hitstopTicks,
      };
    };

    const origRam = runRam(0);
    const nukeRam = runRam(3);
    const meleeRam = runRam(2);

    expect(meleeRam.selfDmg).toBe(0);
    expect(meleeRam.hitstop).toBe(0);
    expect(nukeRam.enemyDmg).toBeGreaterThan(origRam.enemyDmg);
    expect(nukeRam.selfDmg).toBeGreaterThan(origRam.selfDmg);
  });

  it('13. P2 regression: Ace/LaserAce boost maxSpd evaluates (maxspeed || 4) + 3 = 7 within boostdstplayer', () => {
    const data = createTestGameDataBundle();
    const sim = new Simulation(data);
    const pre = launchToPlaying(sim, { weapon: 0, body: 0, engine: 4 }, 'normal', 1300);

    // Spawn Ace within boostdstplayer (300px) so maxSpd branch hits (spec.maxspeed || 4) + 3 = 7
    const ace = sim.spawnEnemy('Ace', pre.player.x + 120, pre.player.y);
    let maxObservedSpeed = 0;
    for (let i = 0; i < 30; i++) {
      const s = sim.step(IDLE_INPUT);
      const tracked = s.enemies.find((e) => e.id === ace.id);
      if (!tracked) break;
      const dist = Math.hypot(tracked.x - s.player.x, tracked.y - s.player.y);
      if (dist <= 300) {
        maxObservedSpeed = Math.max(maxObservedSpeed, Math.hypot(tracked.vx, tracked.vy));
      }
    }
    expect(maxObservedSpeed).toBeGreaterThan(6.5);
    expect(maxObservedSpeed).toBeLessThanOrEqual(7.001);
  });

  it('14. P3 regression: submarine launch phase propels above y = -180 with vy <= -6 and stays aloft >= 35 ticks without thrust', () => {
    const data = createTestGameDataBundle();
    const sim = new Simulation(data);
    sim.launch({ weapon: 0, body: 0, engine: 0 }, 'normal', 1400);

    const initial = sim.getSnapshot();
    expect(initial.phase).toBe('launching');
    expect(initial.launchTicks).toBeGreaterThan(0);
    expect(initial.player.vy).toBe(-9.5);

    let snap = initial;
    let launchSteps = 0;
    while (snap.phase === 'launching' && launchSteps < 60) {
      snap = sim.step(IDLE_INPUT);
      launchSteps++;
    }
    expect(launchSteps).toBeGreaterThan(0);
    expect(snap.phase).toBe('playing');
    expect(snap.player.y).toBeLessThan(-180);
    expect(snap.player.vy).toBeLessThanOrEqual(-6);

    for (let t = 0; t < 40; t++) {
      snap = sim.step(IDLE_INPUT);
      expect(snap.player.y).toBeLessThan(0);
      expect(snap.player.underwater).toBe(false);
    }
  });

  it('15. P3 regression: post-death nuke kills count toward highScore and profile.stats.totalScore at gameover', () => {
    const data = createTestGameDataBundle();
    const sim = new Simulation(data);
    const profile = createDefaultProfile();
    profile.highScoreNormal = 10;
    profile.stats.sorties = 2;
    profile.stats.totalScore = 100;
    sim.setProfile(profile);

    const pre = launchToPlaying(sim, { weapon: 0, body: 3, engine: 0 }, 'normal', 1500);
    // Spawn Fighter beyond initial nuke radius (120) yet inside NUKE_MAX_RADIUS (420)
    sim.spawnEnemy('Fighter', pre.player.x + 300, pre.player.y);
    sim.damagePlayer(999);
    expect(sim.getSnapshot().phase).toBe('dying');
    expect(sim.getSnapshot().score).toBe(0);

    let snap = sim.getSnapshot();
    while (snap.phase === 'dying') {
      snap = sim.step(IDLE_INPUT);
    }
    expect(snap.phase).toBe('gameover');
    expect(snap.killsThisSortie).toBeGreaterThanOrEqual(1);
    expect(snap.score).toBeGreaterThan(10);
    expect(snap.profile.highScoreNormal).toBe(snap.score);
    expect(snap.profile.stats.sorties).toBe(3);
    expect(snap.profile.stats.totalScore).toBe(100 + snap.score);
  });

  it('16. P3 regression: Spec radius constants (Nuke 420, Plasma 80, Bomb 48) and jet_trail scaley -0.02 decay', () => {
    const data = createTestGameDataBundle();

    // NUKE_MAX_RADIUS = 420 (Boat at y=0, player at y≈-194 -> max x reach ≈ 405)
    const simNuke = new Simulation(data);
    const preNuke = launchToPlaying(simNuke, { weapon: 0, body: 3, engine: 0 }, 'normal', 1601);
    const inNuke = simNuke.spawnEnemy('Boat', preNuke.player.x + 340, 0);
    const outNuke = simNuke.spawnEnemy('Boat', preNuke.player.x + 470, 0);
    simNuke.damagePlayer(999);
    for (let i = 0; i < 30; i++) simNuke.step(IDLE_INPUT);
    const nukeSnap = simNuke.getSnapshot();
    expect(nukeSnap.player.nukeRadius).toBe(420);
    expect(nukeSnap.enemies.some((e) => e.id === inNuke.id)).toBe(false);
    expect(nukeSnap.enemies.some((e) => e.id === outNuke.id)).toBe(true);

    // PLASMA_AOE_RADIUS = 80 (Fighter hitRadius=12 -> 90 hits, 94 misses)
    const simPlasma = new Simulation(data);
    const prePlasma = launchToPlaying(simPlasma, { weapon: 4, body: 0, engine: 4 }, 'normal', 1602);
    const targetY = prePlasma.player.y - 60;
    const directAce = simPlasma.spawnEnemy('Ace', 0, targetY);
    const splashIn = simPlasma.spawnEnemy('Fighter', 90, targetY);
    const splashOut = simPlasma.spawnEnemy('Fighter', 94, targetY);
    simPlasma.step({ left: false, right: false, thrust: false, fire: true });
    for (let i = 0; i < 12; i++) {
      simPlasma.step(IDLE_INPUT);
    }
    const plasmaSnap = simPlasma.getSnapshot();
    expect(plasmaSnap.enemies.find((e) => e.id === directAce.id)!.health).toBeLessThan(60);
    expect(plasmaSnap.enemies.some((e) => e.id === splashIn.id)).toBe(false);
    expect(plasmaSnap.enemies.some((e) => e.id === splashOut.id)).toBe(true);

    // BOMB_AOE_RADIUS = 48
    const simBomb = new Simulation(data);
    launchToPlaying(simBomb, { weapon: 0, body: 4, engine: 4 }, 'normal', 1603);
    const bombStep = simBomb.step({ left: false, right: false, thrust: true, fire: false });
    const bombProj = bombStep.projectiles.find((p) => p.kind === 'bomb')!;
    expect(bombProj.aoeRadius).toBe(48);

    // jet_trail scaley = -0.02 decays scaleY from 1.0 down by -0.02/tick and expires at <= 0
    const simJet = new Simulation(data);
    launchToPlaying(simJet, { weapon: 0, body: 0, engine: 4 }, 'normal', 1604);
    simJet.spawnEnemy('Jet', -400, -300);
    let trailId: number | null = null;
    const observedScales: number[] = [];
    for (let i = 0; i < 65; i++) {
      const s = simJet.step(IDLE_INPUT);
      if (trailId === null) {
        const firstTrail = s.particles.find((pt) => pt.kind === 'jet_trail');
        if (firstTrail) {
          trailId = firstTrail.id;
          observedScales.push(firstTrail.scaleY);
        }
      } else {
        const tracked = s.particles.find((pt) => pt.id === trailId);
        if (tracked) {
          observedScales.push(tracked.scaleY);
        } else {
          break;
        }
      }
    }
    expect(trailId).not.toBeNull();
    expect(observedScales[0]).toBeCloseTo(0.98, 4);
    expect(observedScales[1]).toBeCloseTo(0.96, 4);
    expect(observedScales[observedScales.length - 1]).toBeGreaterThan(0);
    expect(observedScales[observedScales.length - 1]).toBeLessThanOrEqual(0.03);
    expect(observedScales.length).toBe(49);
  });

  it('17. Launch carrier submarine (launchSubY) surfaces at seaLevel, holds 24 ticks, submerges past +44, and resets cleanly', () => {
    const data = createProceduralFallbackBundle().data;
    const sim = new Simulation(data);
    sim.launch({ weapon: 0, body: 0, engine: 0 }, 'normal', 1701);

    const initSnap = sim.getSnapshot();
    expect(initSnap.launchSubY).toBe(data.room.sealevel);
    expect(initSnap.particles.some((pt) => pt.kind === 'splashSub' && pt.id >= 1_000_000)).toBe(true);
    expect(initSnap.particles.some((pt) => pt.kind === 'splashM' && pt.id >= 1_000_000)).toBe(true);

    // Hold for 24 ticks at seaLevel
    for (let t = 1; t <= 24; t++) {
      const s = sim.step(IDLE_INPUT);
      expect(s.launchSubY).toBe(data.room.sealevel);
    }

    // Tick 25 starts submerging at +0.55/tick and disappears once > seaLevel + 44
    const submergingSnap = sim.step(IDLE_INPUT);
    expect(submergingSnap.launchSubY).toBeCloseTo(0.55, 6);

    let sawPeriodicSubSplash = false;
    let clearedTick = -1;
    for (let t = 26; t <= 130; t++) {
      const s = sim.step(IDLE_INPUT);
      if (t % 14 === 0 && s.launchSubY !== undefined && s.launchSubY < data.room.sealevel + 18) {
        if (s.particles.some((pt) => pt.kind === 'splashSub')) {
          sawPeriodicSubSplash = true;
        }
      }
      if (s.launchSubY === undefined) {
        clearedTick = t;
        break;
      }
    }
    expect(sawPeriodicSubSplash).toBe(true);
    expect(clearedTick).toBeGreaterThan(24);
    expect(clearedTick).toBeLessThanOrEqual(115);

    // returnToHangar resets launchSubY even if still surfaced
    sim.launch({ weapon: 0, body: 0, engine: 0 }, 'normal', 1702);
    expect(sim.getSnapshot().launchSubY).toBe(data.room.sealevel);
    sim.returnToHangar();
    expect(sim.getSnapshot().launchSubY).toBeUndefined();

    // Dogfight 1v1 does not spawn carrier submarine
    const dogSim = new Simulation(data);
    dogSim.setModFlags({ moddedEnabled: true, multiplayerMode: 'dogfight1v1', p2BotEnabled: false });
    dogSim.launch({ weapon: 0, body: 0, engine: 0 }, 'normal', 1703);
    expect(dogSim.getSnapshot().launchSubY).toBeUndefined();
  });

  it('18. Directional muzzle flashes inherit player angleDeg and Steam FX play full frame counts & TTLs', () => {
    const fallbackData = createProceduralFallbackBundle().data;
    const testData = createTestGameDataBundle();

    // Spread & original muzzle flashes inherit player.angleDeg (-90 straight up, and rotated angles)
    for (const data of [fallbackData, testData]) {
      const simSpread = new Simulation(data);
      launchToPlaying(simSpread, { weapon: 2, body: 0, engine: 4 }, 'normal', 1801);
      const upSnap = simSpread.step({ left: false, right: false, thrust: false, fire: true });
      const spreadUp = upSnap.particles.find((pt) => pt.kind === 'spreadfireFlash');
      expect(spreadUp).toBeDefined();
      expect(spreadUp!.angleDeg).toBeCloseTo(-90, 5);
      expect(spreadUp!.frameCount).toBe(3);

      // Rotate right 135 deg (+45 deg facing down-right) and fire again after cooldown
      for (let i = 0; i < 13; i++) {
        simSpread.step({ left: false, right: true, thrust: false, fire: false });
      }
      const angledSnap = simSpread.step({ left: false, right: true, thrust: false, fire: true });
      const spreadAngled = angledSnap.particles.find((pt) => pt.kind === 'spreadfireFlash');
      expect(spreadAngled).toBeDefined();
      expect(spreadAngled!.angleDeg).toBeCloseTo(angledSnap.player.angleDeg, 5);
      expect(spreadAngled!.angleDeg).not.toBe(0);

      // Original fireFlash inherits -90 deg
      const simOrig = new Simulation(data);
      launchToPlaying(simOrig, { weapon: 0, body: 0, engine: 4 }, 'normal', 1802);
      const origSnap = simOrig.step({ left: false, right: false, thrust: false, fire: true });
      const fireFlash = origSnap.particles.find((pt) => pt.kind === 'fireFlash');
      expect(fireFlash).toBeDefined();
      expect(fireFlash!.angleDeg).toBeCloseTo(-90, 5);
      expect(fireFlash!.frameCount).toBe(3);
    }

    // splashB plays all 16 frames (ttl >= 40) instead of truncating at 10 frames / 16 ticks
    const simSplash = new Simulation(fallbackData);
    simSplash.launch({ weapon: 0, body: 0, engine: 0 }, 'normal', 1803);
    const launchSnap = simSplash.getSnapshot();
    const splashB = launchSnap.particles.find((pt) => pt.kind === 'splashB');
    expect(splashB).toBeDefined();
    expect(splashB!.frameCount).toBe(16);
    expect(splashB!.ttl).toBeGreaterThanOrEqual(40);
    for (let i = 0; i < 20; i++) {
      simSplash.step(IDLE_INPUT);
    }
    expect(simSplash.getSnapshot().particles.some((pt) => pt.id === splashB!.id)).toBe(true);
  });

  it('19. Damaged smoke_long, wing drip, underwater bubbles, boostsplash, bigboostcircle, spreadfade, laser_fade & debris FX', () => {
    const data = createProceduralFallbackBundle().data;

    // 1. Damaged player (< 75% HP) emits smoke_long behind tail; critical (< 35%) also emits smoke
    const simSmoke = new Simulation(data);
    launchToPlaying(simSmoke, { weapon: 0, body: 0, engine: 4 }, 'normal', 1901);
    simSmoke.damagePlayer(6); // 10 / 16 = 62.5% (< 75%)
    let sawSmokeLong = false;
    for (let i = 0; i < 10; i++) {
      const s = simSmoke.step(IDLE_INPUT);
      const sl = s.particles.find((pt) => pt.kind === 'smoke_long');
      if (sl) {
        sawSmokeLong = true;
        expect(sl.id).toBeGreaterThanOrEqual(1_000_000);
        expect(sl.frameCount).toBe(9);
      }
    }
    expect(sawSmokeLong).toBe(true);

    // 2. Ocean exit emits wing drip (gravity 0.14, allowBelowSea: false) and deep submergence emits poof bubbles
    const simWet = new Simulation(data);
    launchToPlaying(simWet, { weapon: 0, body: 0, engine: 3 }, 'normal', 1902);
    // Turn straight down (+90) in 18 ticks, dive deep underwater, then turn straight up (-90) and breach
    for (let i = 0; i < 18; i++) {
      simWet.step({ left: false, right: true, thrust: false, fire: false });
    }
    let sawBubble = false;
    for (let i = 0; i < 65; i++) {
      const s = simWet.step({ left: false, right: false, thrust: true, fire: false });
      const bubble = s.particles.find((pt) => pt.kind === 'poof' && pt.allowBelowSea && pt.vy < 0);
      if (bubble) sawBubble = true;
    }
    expect(sawBubble).toBe(true);
    for (let i = 0; i < 18; i++) {
      simWet.step({ left: false, right: true, thrust: false, fire: false });
    }
    let sawDrip = false;
    for (let i = 0; i < 80; i++) {
      const s = simWet.step({ left: false, right: false, thrust: true, fire: false });
      const drip = s.particles.find((pt) => pt.kind === 'drip');
      if (drip) {
        sawDrip = true;
        expect(drip.spriteName).toBe('fx_drip');
        expect(drip.gravity).toBeCloseTo(0.14, 5);
        expect(drip.allowBelowSea).toBe(false);
        expect(drip.frameCount).toBe(3);
      }
    }
    expect(sawDrip).toBe(true);

    // 3. Superboost rising edge bigboostcircle, superboostend angleDeg, boostsplash, laser_fade & spreadfade
    const simFx = new Simulation(data);
    launchToPlaying(simFx, { weapon: 1, body: 0, engine: 1 }, 'normal', 1903);
    // Launch ends with boosting: true, so coast 1 tick first to emit superboostend & reset wasBoosting
    const boostEndSnap = simFx.step({ left: false, right: false, thrust: false, fire: true });
    const boostEnd = boostEndSnap.particles.find((pt) => pt.kind === 'superboostend');
    expect(boostEnd).toBeDefined();
    expect(boostEnd!.angleDeg).toBeCloseTo(boostEndSnap.player.angleDeg, 5);
    expect(boostEnd!.frameCount).toBe(4);

    const boostSnap = simFx.step({ left: false, right: false, thrust: true, fire: false });
    expect(boostSnap.particles.some((pt) => pt.kind === 'bigboostcircle')).toBe(true);
    const laserFade = boostSnap.particles.find((pt) => pt.kind === 'laser_fade');
    expect(laserFade).toBeDefined();
    expect(laserFade!.spriteName).toBe('laser_fade');
    expect(laserFade!.frameCount).toBe(5);
    expect(laserFade!.frameSpeed).toBeCloseTo(0.5, 5);
    expect(laserFade!.angleDeg).toBeCloseTo(boostSnap.player.angleDeg, 5);

    // Low-altitude boost emits boostsplash at seaLevel
    const simSkim = new Simulation(data);
    launchToPlaying(simSkim, { weapon: 0, body: 0, engine: 0 }, 'normal', 1906);
    for (let i = 0; i < 18; i++) {
      simSkim.step({ left: false, right: true, thrust: false, fire: false });
    }
    let sawBoostSplash = false;
    for (let i = 0; i < 40; i++) {
      const s = simSkim.step({ left: false, right: false, thrust: true, fire: false });
      const bs = s.particles.find((pt) => pt.kind === 'boostsplash');
      if (bs) {
        sawBoostSplash = true;
        expect(bs.y).toBe(data.room.sealevel);
        expect(bs.frameCount).toBe(5);
        break;
      }
    }
    expect(sawBoostSplash).toBe(true);

    const simSpreadFade = new Simulation(data);
    launchToPlaying(simSpreadFade, { weapon: 2, body: 0, engine: 4 }, 'normal', 1904);
    simSpreadFade.step({ left: false, right: false, thrust: false, fire: true });
    let sawSpreadFade = false;
    for (let i = 0; i < 45; i++) {
      const s = simSpreadFade.step(IDLE_INPUT);
      if (s.particles.some((pt) => pt.kind === 'spreadfade')) {
        sawSpreadFade = true;
        break;
      }
    }
    expect(sawSpreadFade).toBe(true);

    // 4. Damaged Boat emits smoke_long and killEnemy emits planepart + poof debris
    const simDebris = new Simulation(data);
    const preDebris = launchToPlaying(simDebris, { weapon: 4, body: 0, engine: 4 }, 'normal', 1905);
    const boat = simDebris.spawnEnemy('Boat', preDebris.player.x + 240, 0);
    boat.health = boat.maxHealth * 0.4;
    let sawBoatSmoke = false;
    for (let i = 0; i < 10; i++) {
      const s = simDebris.step(IDLE_INPUT);
      if (s.particles.some((pt) => pt.kind === 'smoke_long')) {
        sawBoatSmoke = true;
        break;
      }
    }
    expect(sawBoatSmoke).toBe(true);

    simDebris.spawnEnemy('Fighter', preDebris.player.x, preDebris.player.y - 40);
    let sawPlanepart = false;
    let sawPoof = false;
    for (let i = 0; i < 12; i++) {
      const s = simDebris.step({ left: false, right: false, thrust: false, fire: true });
      if (s.particles.some((pt) => pt.kind === 'planepart')) sawPlanepart = true;
      if (s.particles.some((pt) => pt.kind === 'poof')) sawPoof = true;
    }
    expect(sawPlanepart).toBe(true);
    expect(sawPoof).toBe(true);

    simDebris.damagePlayer(999);
    const deathFxSnap = simDebris.getSnapshot();
    const bigExp = deathFxSnap.particles.find((pt) => pt.kind === 'explode_big');
    expect(bigExp).toBeDefined();
    expect(bigExp!.frameCount).toBe(13);
    expect(deathFxSnap.particles.some((pt) => pt.kind === 'planepart')).toBe(true);
  });

  it('20. LaserAce transitions through 24-tick laserChargeTicks telegraph before laserActive === true', () => {
    const data = createTestGameDataBundle();
    const sim = new Simulation(data);
    const pre = launchToPlaying(sim, { weapon: 0, body: 0, engine: 4 }, 'normal', 2001);
    const laserAce = sim.spawnEnemy('LaserAce', pre.player.x + 180, pre.player.y);

    const observedChargeTicks: number[] = [];
    let beamStartIndex = -1;
    let firstChargeIndex = -1;

    for (let i = 0; i < 100; i++) {
      const s = sim.step(IDLE_INPUT);
      const tracked = s.enemies.find((e) => e.id === laserAce.id);
      if (!tracked) break;
      if ((tracked.laserChargeTicks ?? 0) > 0) {
        if (firstChargeIndex === -1) firstChargeIndex = i;
        observedChargeTicks.push(tracked.laserChargeTicks!);
        expect(tracked.laserActive).toBe(false);
      }
      if (tracked.laserActive && beamStartIndex === -1) {
        beamStartIndex = i;
        expect(tracked.laserChargeTicks ?? 0).toBe(0);
        break;
      }
    }

    expect(firstChargeIndex).toBeGreaterThanOrEqual(0);
    expect(observedChargeTicks[0]).toBe(24);
    expect(observedChargeTicks.length).toBe(24);
    expect(observedChargeTicks[observedChargeTicks.length - 1]).toBe(1);
    expect(beamStartIndex).toBeGreaterThan(firstChargeIndex + 23);
  });

  it('21. Switching MODDED [5, 6, 8] -> VANILLA 1:1 resets cleanly to [0, 0, 0] while [5, 5, 5] Urauser stays [5, 5, 5]', () => {
    const data = createTestGameDataBundle();

    // [5, 6, 8] (AEGIS HEX ION) -> VANILLA 1:1 resets cleanly to [0, 0, 0] (original, NOT ???)
    const simHex = new Simulation(data);
    simHex.unlockAll();
    simHex.setModFlags({ moddedEnabled: true, arsenalBosses: true });
    simHex.setLoadout({ weapon: 5, body: 6, engine: 8 });
    expect(simHex.getSnapshot().player.loadout).toEqual({ weapon: 5, body: 6, engine: 8 });

    simHex.setModFlags({ ...DEFAULT_ACT2_MOD_FLAGS, moddedEnabled: false });
    const hexExitSnap = simHex.getSnapshot();
    expect(hexExitSnap.player.loadout).toEqual({ weapon: 0, body: 0, engine: 0 });
    expect(hexExitSnap.player.planeName).toBe('original');

    // Pure unlocked [5, 5, 5] URAUSER stays [5, 5, 5] when switching MODDED -> VANILLA 1:1
    const simUra = new Simulation(data);
    simUra.unlockAll();
    simUra.setModFlags({ moddedEnabled: true, arsenalBosses: true });
    simUra.setLoadout({ weapon: 5, body: 5, engine: 5 });
    expect(simUra.getSnapshot().player.planeName).toBe('URAUSER');

    simUra.setModFlags({ ...DEFAULT_ACT2_MOD_FLAGS, moddedEnabled: false });
    const uraExitSnap = simUra.getSnapshot();
    expect(uraExitSnap.player.loadout).toEqual({ weapon: 5, body: 5, engine: 5 });
    expect(uraExitSnap.player.planeName).toBe('URAUSER');
    expect(uraExitSnap.player.isUrauser).toBe(true);
  });
});
