import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STEAM_DATA_DIR,
  VANILLA_GLOBAL_RAW,
  VANILLA_PLAYER_RAW,
  VaultLoader,
  checkCleanRoomGitHygiene,
  createProceduralFallbackBundle,
  createProceduralFontTexture,
  createProceduralMenuTexture,
  createProceduralNukeTexture,
  decodeTgaRgba,
  getKeyCI,
  isPcpBlob,
  loadVaultFromDisk,
  parseAngelCodeFnt,
  parseJsonCpp,
} from '../src/vault';
import {
  createSteamBridgeMiddleware,
  resolveSafeSteamFilePath,
  resolveSteamDataDir,
  steamBridgePlugin,
} from '../tools/steam-bridge/vite-plugin';

describe('parseJsonCpp', () => {
  it('strips // and /* */ comments, trailing commas, and normalizes floats while preserving strings', () => {
    const raw = `
      {
        // line comment with trailing comma:
        "url": "https://example.com//keep/*this*/",
        "escaped": "quote \\"//still inside\\" end", /* block comment */
        "vspeed": 0.,
        "ratio": .5,
        /*
         * multi-line comment
         */
        "items": [1, 2, 3,],
      }
    `;
    const parsed = parseJsonCpp<{
      url: string;
      escaped: string;
      vspeed: number;
      ratio: number;
      items: number[];
    }>(raw);

    expect(parsed.url).toBe('https://example.com//keep/*this*/');
    expect(parsed.escaped).toBe('quote "//still inside" end');
    expect(parsed.vspeed).toBe(0);
    expect(parsed.ratio).toBe(0.5);
    expect(parsed.items).toEqual([1, 2, 3]);
  });

  it('parses all Steam res/*.json and gfx/*.json files cleanly', () => {
    const steamDir =
      process.env.SKYBREAKER_STEAM_DIR?.trim() ||
      process.env.LUFTRAUSERS_STEAM_DIR?.trim() ||
      DEFAULT_STEAM_DATA_DIR;
    if (!fs.existsSync(steamDir)) {
      return;
    }

    for (const sub of ['res', 'gfx']) {
      const dir = path.join(steamDir, sub);
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        const text = fs.readFileSync(path.join(dir, file), 'utf8');
        expect(() => parseJsonCpp(text)).not.toThrow();
      }
    }
  });
});

describe('decodeTgaRgba & isPcpBlob', () => {
  it('detects PCP\\0 magic cleanly without crashing', () => {
    const pcp = new Uint8Array([0x50, 0x43, 0x50, 0x00, 0x3f, 0x00]);
    expect(isPcpBlob(pcp)).toBe(true);
    expect(isPcpBlob(new Uint8Array([0, 0, 2, 0]))).toBe(false);
    expect(() => decodeTgaRgba(pcp)).toThrow(/PCP/);
  });

  it('decodes uncompressed 32-bit BGRA TGA honoring top-left vs bottom-left origin', () => {
    // 2x1 top-left TGA: pixel 0 = BGRA(10, 20, 30, 255), pixel 1 = BGRA(40, 50, 60, 128)
    const tgaTop = new Uint8Array(18 + 8);
    tgaTop[2] = 2;
    tgaTop[12] = 2;
    tgaTop[14] = 1;
    tgaTop[16] = 32;
    tgaTop[17] = 0x20;
    tgaTop.set([10, 20, 30, 255, 40, 50, 60, 128], 18);

    const decodedTop = decodeTgaRgba(tgaTop);
    expect(decodedTop.width).toBe(2);
    expect(decodedTop.height).toBe(1);
    expect(Array.from(decodedTop.rgba)).toEqual([30, 20, 10, 255, 60, 50, 40, 128]);

    // 1x2 bottom-left TGA: row 0 in file is bottom row
    const tgaBottom = new Uint8Array(18 + 8);
    tgaBottom[2] = 2;
    tgaBottom[12] = 1;
    tgaBottom[14] = 2;
    tgaBottom[16] = 32;
    tgaBottom[17] = 0x00;
    tgaBottom.set([0, 0, 200, 255, 0, 200, 0, 255], 18);

    const decodedBottom = decodeTgaRgba(tgaBottom);
    expect(Array.from(decodedBottom.rgba)).toEqual([0, 200, 0, 255, 200, 0, 0, 255]);
  });
});

describe('parseAngelCodeFnt & getKeyCI', () => {
  it('parses info, common, page, and char metrics accurately', () => {
    const sample = [
      'info face="Volter (Goldfish)" size=-16 bold=0',
      'common lineHeight=18 base=13 scaleW=128 scaleH=64 pages=1',
      'page id=0 file="fntm_0.png"',
      'chars count=2',
      'char id=32 x=102 y=42 width=3 height=1 xoffset=-1 yoffset=17 xadvance=3 page=0 chnl=15',
      'char id=65 x=10 y=20 width=6 height=10 xoffset=0 yoffset=3 xadvance=7 page=0 chnl=15',
    ].join('\n');

    const font = parseAngelCodeFnt('fntm', sample);
    expect(font.name).toBe('fntm');
    expect(font.face).toBe('Volter (Goldfish)');
    expect(font.size).toBe(16);
    expect(font.lineHeight).toBe(18);
    expect(font.base).toBe(13);
    expect(font.scaleW).toBe(128);
    expect(font.scaleH).toBe(64);
    expect(font.pageFile).toBe('fntm_0.png');
    expect(font.glyphs[32]?.xoffset).toBe(-1);
    expect(font.glyphs[65]).toEqual({
      id: 65,
      x: 10,
      y: 20,
      width: 6,
      height: 10,
      xoffset: 0,
      yoffset: 3,
      xadvance: 7,
    });
  });

  it('performs case-insensitive key lookups', () => {
    const obj = { fireInterval: 20, reactionseaHeightB: 200, environmentalYforce: 1.0 };
    expect(getKeyCI(obj, 'fireinterval', 0)).toBe(20);
    expect(getKeyCI(obj, 'reactionseaheightb', 0)).toBe(200);
    expect(getKeyCI(obj, 'environmentalyforce', 0)).toBe(1.0);
  });
});

describe('loadVaultFromDisk (live read-only Steam bridge)', () => {
  it('loads Steam local bundle, decodes sheet1grey.png TGA, and normalizes all vanilla schemas', () => {
    const steamDir = process.env.LUFTRAUSERS_STEAM_DIR?.trim() || DEFAULT_STEAM_DATA_DIR;
    const bundle = loadVaultFromDisk();
    if (!fs.existsSync(steamDir)) {
      expect(bundle.data.vaultSource).toBe('procedural-fallback');
      expect(bundle.data.steamDir).toBeNull();
      return;
    }
    expect(bundle.data.vaultSource).toBe('steam-local');

    // sheet1grey.png decoded TGA
    const spritesTex = bundle.textures.sprites!;
    expect(spritesTex).toBeDefined();
    expect(spritesTex.source).toBe('steam-tga');
    expect(spritesTex.width).toBe(2048);
    expect(spritesTex.height).toBe(1024);
    expect(spritesTex.rgba.length).toBe(2048 * 1024 * 4);
    let nonZeroPixels = 0;
    for (let i = 3; i < spritesTex.rgba.length; i += 4) {
      if (spritesTex.rgba[i]! > 0) nonZeroPixels++;
    }
    expect(nonZeroPixels).toBeGreaterThan(10000);

    // PCP blobs bridged cleanly to procedural textures
    expect(bundle.textures.menusprites?.source).toBe('procedural');
    expect(bundle.textures.nukesprites?.source).toBe('procedural');
    expect(bundle.textures.fntb?.source).toBe('procedural');

    // Player parts & original inheritance
    const { player } = bundle.data;
    expect(player.enginesById).toHaveLength(6);
    expect(player.bodiesById).toHaveLength(6);
    expect(player.weaponsById).toHaveLength(6);
    expect(player.enginesById.map((e) => e.id)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(player.bodiesById.map((b) => b.id)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(player.weaponsById.map((w) => w.id)).toEqual([0, 1, 2, 3, 4, 5]);

    // Superboost inherits gravity/acceleration/waterdmg from original
    const superboost = player.engines.superboost!;
    expect(superboost.maximumspeed).toBe(11);
    expect(superboost.turnspeedboost).toBe(1);
    expect(superboost.boostadd).toBe(2);
    expect(superboost.acceleration).toBe(1.5);
    expect(superboost.gravity).toBe(0.2);

    // Armor inherits healingspd & impact stats from original
    const armor = player.bodyparts.armor!;
    expect(armor.maxhealth).toBe(28);
    expect(armor.speedmodifier).toBe(0.8);
    expect(armor.healingspd).toBe(0.16);

    // Laser inherits maxbullets/recoil from original
    const laser = player.weapons.laser!;
    expect(laser.interval).toBe(1);
    expect(laser.projectile).toBe('laser');
    expect(laser.maxbullets).toBe(1337);

    // ??? (id 5) inherits original defaults with body overrides
    const unkEngine = player.engines['???']!;
    expect(unkEngine.id).toBe(5);
    expect(unkEngine.sprite).toBe('engine_original');
    expect(unkEngine.maximumspeed).toBe(8);

    const unkBody = player.bodyparts['???']!;
    expect(unkBody.id).toBe(5);
    expect(unkBody.maxhealth).toBe(120);
    expect(unkBody.healingspd).toBe(0.01);
    expect(unkBody.sprite).toBe('body_original');

    const unkWeapon = player.weapons['???']!;
    expect(unkWeapon.id).toBe(5);
    expect(unkWeapon.projectile).toBe('bullet');
    expect(unkWeapon.interval).toBe(3);

    // 126 planenames (125 + URAUSER)
    expect(bundle.data.global.planenames).toHaveLength(126);
    expect(bundle.data.global.planenames[0]?.name).toBe('original');
    expect(bundle.data.global.planenames[125]).toEqual({
      name: 'URAUSER',
      weapon: 5,
      body: 5,
      engine: 5,
    });

    // 90 missions with deterministic title & description
    expect(bundle.data.global.missions).toHaveLength(90);
    for (const mission of bundle.data.global.missions) {
      expect(mission.title.length).toBeGreaterThan(0);
      expect(mission.description.length).toBeGreaterThan(0);
    }

    // 12 enemy types (Normal + SFMT)
    expect(Object.keys(bundle.data.enemies)).toHaveLength(12);
    expect(Object.keys(bundle.data.enemiesSfmt)).toHaveLength(12);
    expect(bundle.data.enemies.fighter?.fireinterval).toBe(20);
    expect(bundle.data.enemies.fighter?.reactionseaheightb).toBe(200);
    expect(bundle.data.enemies.fighter?.environmentalyforce).toBe(1.0);
    expect(bundle.data.enemiesSfmt.jet?.fireinterval).toBe(5);
    expect(bundle.data.enemiesSfmt.bigboat?.bulletspersalvo).toBe(36);

    // 6 projectiles
    expect(Object.keys(bundle.data.projectiles)).toHaveLength(6);

    // 5 AngelCode fonts
    expect(Object.keys(bundle.data.fonts).sort()).toEqual([
      'fntb',
      'fntm',
      'fntmb',
      'fnts',
      'fntxl',
    ]);
    expect(Object.keys(bundle.data.fonts.fntb!.glyphs).length).toBeGreaterThanOrEqual(95);
    expect(Object.keys(bundle.data.fonts.fnts!.glyphs).length).toBeGreaterThanOrEqual(95);

    // Audio manifest URLs
    expect(bundle.audioManifest.source).toBe('steam-local');
    expect(bundle.audioManifest.bgm.luftrauser_bass1).toBe(
      '/steam-vault/file/bgm/luftrauser_bass1.ogg',
    );
    expect(bundle.audioManifest.sfx.sndbullet).toBe('/steam-vault/file/sfx/sndbullet.wav');
  });
});

describe('createProceduralFallbackBundle & procedural parity', () => {
  it('builds complete procedural-fallback bundle with 126 planenames, 90 missions, and RGBA8 atlases', () => {
    const fallback = createProceduralFallbackBundle();
    expect(fallback.data.vaultSource).toBe('procedural-fallback');
    expect(fallback.data.steamDir).toBeNull();
    expect(fallback.data.global.planenames).toHaveLength(126);
    expect(fallback.data.global.missions).toHaveLength(90);

    for (const texName of ['sprites', 'menusprites', 'nukesprites'] as const) {
      const tex = fallback.textures[texName]!;
      expect(tex.width).toBe(2048);
      expect(tex.height).toBe(1024);
      expect(tex.rgba.length).toBe(2048 * 1024 * 4);
      expect(tex.source).toBe('procedural');
    }

    // Verify 8-level luminance encoding in procedural sprites atlas (player=32, explosion/clouds=224)
    const spritesTex = fallback.textures.sprites!;
    const levels = new Set<number>();
    for (let i = 0; i < spritesTex.rgba.length; i += 4) {
      if (spritesTex.rgba[i + 3]! > 0) {
        levels.add(spritesTex.rgba[i]!);
      }
    }
    expect(levels.has(32)).toBe(true);
    expect(levels.has(64)).toBe(true);
    expect(levels.has(128)).toBe(true);
    expect(levels.has(160)).toBe(true);
    expect(levels.has(192)).toBe(true);
    expect(levels.has(224)).toBe(true);

    // Font textures + helper exports
    for (const fname of ['fntb', 'fntm', 'fntmb', 'fnts', 'fntxl'] as const) {
      expect(fallback.textures[fname]?.source).toBe('procedural');
      expect(fallback.textures[fname]?.rgba.some((v) => v > 0)).toBe(true);
    }
    expect(createProceduralMenuTexture().width).toBe(2048);
    expect(createProceduralNukeTexture().width).toBe(2048);
    expect(createProceduralFontTexture(fallback.data.fonts.fntb!).source).toBe('procedural');

    // Exact numeric gameplay balance parity against Steam JSONs (while preserving original Skybreaker IP copy)
    const steam = loadVaultFromDisk();
    if (steam.data.vaultSource === 'steam-local') {
      const stripCopy = <T extends { name: string; descr: string }>(arr: T[]) =>
        arr.map(({ name: _n, descr: _d, ...rest }) => rest);

      expect(stripCopy(fallback.data.player.enginesById)).toEqual(
        stripCopy(steam.data.player.enginesById),
      );
      expect(stripCopy(fallback.data.player.bodiesById)).toEqual(
        stripCopy(steam.data.player.bodiesById),
      );
      expect(stripCopy(fallback.data.player.weaponsById)).toEqual(
        stripCopy(steam.data.player.weaponsById),
      );
      expect(fallback.data.projectiles).toEqual(steam.data.projectiles);
      expect(fallback.data.enemies).toEqual(steam.data.enemies);
      expect(fallback.data.enemiesSfmt).toEqual(steam.data.enemiesSfmt);
      expect(fallback.data.spawnCoordinator).toEqual(steam.data.spawnCoordinator);
      expect(fallback.data.spawnCoordinatorSfmt).toEqual(steam.data.spawnCoordinatorSfmt);
      expect(
        fallback.data.global.missions.map(({ id, component, objective, condition, val }) => ({
          id,
          component,
          objective,
          condition,
          val,
        })),
      ).toEqual(
        steam.data.global.missions.map(({ id, component, objective, condition, val }) => ({
          id,
          component,
          objective,
          condition,
          val,
        })),
      );
      expect(fallback.data.fx).toEqual(steam.data.fx);
      expect(fallback.data.parallax).toEqual(steam.data.parallax);
      expect(fallback.data.room).toEqual(steam.data.room);
      const gameplaySpriteKeys = (keys: string[]) =>
        keys.filter((k) => !k.endsWith('_logo')).sort();
      expect(gameplaySpriteKeys(Object.keys(fallback.data.atlases.sprites.sprites))).toEqual(
        gameplaySpriteKeys(Object.keys(steam.data.atlases.sprites.sprites)),
      );
    }

    // Verify upgraded procedural pixel art renders distinct silhouettes for every player part
    const spriteHash = (spriteName: string, frameIndex = 0): string => {
      const entry = fallback.data.atlases.sprites.sprites[spriteName]!;
      expect(entry).toBeDefined();
      const sub = entry.subs[frameIndex]!;
      const [sw, sh] = entry.size;
      const out: number[] = [];
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const idx = ((sub.y + y) * spritesTex.width + (sub.x + x)) * 4;
          out.push(spritesTex.rgba[idx + 3]! > 0 ? spritesTex.rgba[idx]! : 0);
        }
      }
      return out.join(',');
    };

    const engineHashes = new Set([
      spriteHash('engine_original'),
      spriteHash('engine_superboost'),
      spriteHash('engine_gungine'),
      spriteHash('engine_underwater'),
      spriteHash('engine_hover'),
    ]);
    expect(engineHashes.size).toBe(5);

    const bodyHashes = new Set([
      spriteHash('body_original'),
      spriteHash('body_armor'),
      spriteHash('body_melee'),
      spriteHash('body_nuke'),
      spriteHash('body_bomb'),
    ]);
    expect(bodyHashes.size).toBe(5);

    const wingHashes = new Set([
      spriteHash('wings_original'),
      spriteHash('wings_laser'),
      spriteHash('wings_spread'),
      spriteHash('wings_missiles'),
      spriteHash('wings_cannon'),
    ]);
    expect(wingHashes.size).toBe(5);

    // Composite 24x24 Hangar preview distinctness (engine -> body -> wings draw order):
    // cycling WEAPON, BODY, or ENGINE must visibly transform the rendered aircraft on EVERY step!
    const compositeCraft = (engineSprite: string, bodySprite: string, wingSprite: string): number[] => {
      const buf = new Array<number>(24 * 24).fill(0);
      for (const spriteName of [engineSprite, bodySprite, wingSprite]) {
        const entry = fallback.data.atlases.sprites.sprites[spriteName]!;
        const sub = entry.subs[0]!;
        const [sw, sh] = entry.size;
        expect(sw).toBe(24);
        expect(sh).toBe(24);
        for (let y = 0; y < 24; y++) {
          for (let x = 0; x < 24; x++) {
            const idx = ((sub.y + y) * spritesTex.width + (sub.x + x)) * 4;
            if (spritesTex.rgba[idx + 3]! > 0) {
              buf[y * 24 + x] = spritesTex.rgba[idx]!;
            }
          }
        }
      }
      return buf;
    };

    const pixelDiffCount = (a: readonly number[], b: readonly number[]): number => {
      let diff = 0;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) diff++;
      }
      return diff;
    };

    const weaponComposites = [
      'wings_original',
      'wings_laser',
      'wings_spread',
      'wings_missiles',
      'wings_cannon',
    ].map((w) => compositeCraft('engine_original', 'body_original', w));
    const bodyComposites = [
      'body_original',
      'body_armor',
      'body_melee',
      'body_nuke',
      'body_bomb',
    ].map((b) => compositeCraft('engine_original', b, 'wings_original'));
    const engineComposites = [
      'engine_original',
      'engine_superboost',
      'engine_gungine',
      'engine_underwater',
      'engine_hover',
    ].map((e) => compositeCraft(e, 'body_original', 'wings_original'));

    for (const [slotLabel, composites] of [
      ['weapon', weaponComposites],
      ['body', bodyComposites],
      ['engine', engineComposites],
    ] as const) {
      for (let i = 0; i < composites.length; i++) {
        for (let j = i + 1; j < composites.length; j++) {
          expect(
            pixelDiffCount(composites[i]!, composites[j]!),
            `Composite Hangar preview ${slotLabel} ${i} vs ${j} must visibly differ`,
          ).toBeGreaterThanOrEqual(12);
        }
      }
    }

    // Complete gameplay data inventory verification in Skybreaker fallback
    expect(fallback.data.player.weaponsById.map((w) => w.name)).toEqual([
      'standard',
      'laser',
      'spread',
      'missiles',
      'cannon',
      'omega',
    ]);
    expect(fallback.data.player.bodiesById.map((b) => b.name)).toEqual([
      'standard',
      'armor',
      'melee',
      'nuke',
      'bomb',
      'omega',
    ]);
    expect(fallback.data.player.enginesById.map((e) => e.name)).toEqual([
      'standard',
      'superboost',
      'gungine',
      'underwater',
      'hover',
      'omega',
    ]);
    expect(Object.keys(fallback.data.enemies)).toHaveLength(12);
    expect(Object.keys(fallback.data.enemiesSfmt)).toHaveLength(12);
    expect(Object.keys(fallback.data.projectiles)).toHaveLength(6);
    expect(Object.keys(fallback.data.fx.generic)).toHaveLength(32);
    expect(Object.keys(fallback.data.fx.explosions)).toHaveLength(5);
    expect(fallback.data.parallax.stages).toHaveLength(6);

    // Synchronized Skybreaker mission titles & condition descriptions match restored part names
    const missionDescriptions = fallback.data.global.missions.map((m) => m.description);
    const missionTitles = fallback.data.global.missions.map((m) => m.title);
    expect(missionTitles).toContain('LASER WEAPON #1');
    expect(missionTitles).toContain('ARMOR BODY #1');
    expect(missionTitles).toContain('SUPERBOOST ENGINE #1');
    expect(missionTitles).toContain('GUNGINE ENGINE #1');
    expect(missionTitles).toContain('NUKE BODY #1');
    expect(missionDescriptions.some((d) => d.includes('WITH GUNGINE'))).toBe(true);
    expect(missionDescriptions.some((d) => d.includes('WITH NUKE BLAST'))).toBe(true);
    expect(missionDescriptions.some((d) => d.includes('IN OVERDRIVE MODE'))).toBe(true);
    expect(missionDescriptions.some((d) => d.includes('RECOILJET') || d.includes('COREBLAST'))).toBe(
      false,
    );

    // Multi-frame FX animate across frames
    expect(spriteHash('fx_explodebig', 0)).not.toBe(spriteHash('fx_explodebig', 6));
    expect(spriteHash('fx_splashB', 0)).not.toBe(spriteHash('fx_splashB', 8));
    expect(spriteHash('engine_underwater', 0)).not.toBe(spriteHash('engine_underwater', 3));

    // Enemy silhouettes, world props & Apex Omega render rich multi-tone pixels
    for (const key of [
      'urauser',
      'fighter_body',
      'fighter_wings',
      'jet_body',
      'jet_wings',
      'ace_body',
      'ace_wings',
      'laserace_body',
      'laserace_wings',
      'small_boat',
      'big_boat',
      'submarine',
      'acemarine',
      'blimp',
      'missile',
      'clouds',
      'parallax_clouds',
      'ocean_line',
      'space_clouds',
      'laser_charge',
    ]) {
      const hash = spriteHash(key, 0);
      const uniqueLums = new Set(hash.split(',').filter((v) => v !== '0'));
      expect(uniqueLums.size, `${key} should render visible multi-tone pixels`).toBeGreaterThanOrEqual(
        2,
      );
    }
  });
});

describe('Clean-room Skybreaker IP safety', () => {
  it('contains zero trademark/verbatim Vlambeer strings and 125 + 1 unique Skybreaker callsigns', () => {
    const forbidden = [
      'luftrauser',
      'rauser',
      'urauser',
      'kozilek',
      'vlambeer',
      'devolver',
      'equiped',
      'pinochio',
      'bob raus',
      'unhealthy boeing',
    ];

    const playerDump = JSON.stringify(VANILLA_PLAYER_RAW).toLowerCase();
    for (const term of forbidden) {
      expect(playerDump).not.toContain(term);
    }

    const planenames = VANILLA_GLOBAL_RAW.planenames;
    expect(planenames).toHaveLength(126);

    const namesLower = new Set<string>();
    const combos = new Set<string>();
    for (const entry of planenames) {
      const trimmed = entry.name.trim();
      expect(trimmed.length).toBeGreaterThan(0);
      const lower = trimmed.toLowerCase();
      for (const term of forbidden) {
        expect(lower).not.toContain(term);
      }
      namesLower.add(lower);
      combos.add(`${entry.weapon},${entry.body},${entry.engine}`);
    }

    expect(namesLower.size).toBe(126);
    expect(combos.size).toBe(126);
    expect(planenames[125]).toEqual({
      name: 'APEX OMEGA',
      weapon: 5,
      body: 5,
      engine: 5,
    });

    // Every normalized procedural fallback mission and player part description is clean
    const fallback = createProceduralFallbackBundle();
    const userFacingDump = JSON.stringify({
      engines: fallback.data.player.enginesById.map((e) => ({ name: e.name, descr: e.descr })),
      bodies: fallback.data.player.bodiesById.map((b) => ({ name: b.name, descr: b.descr })),
      weapons: fallback.data.player.weaponsById.map((w) => ({ name: w.name, descr: w.descr })),
      missions: fallback.data.global.missions.map((m) => ({
        title: m.title,
        description: m.description,
      })),
      planenames: fallback.data.global.planenames,
    }).toLowerCase();
    for (const term of forbidden) {
      expect(userFacingDump).not.toContain(term);
    }
  });
});

describe('Vite Steam Bridge Middleware & VaultLoader', () => {
  function invokeMiddleware(
    mw: ReturnType<typeof createSteamBridgeMiddleware>,
    method: string,
    url: string,
  ): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const req = new EventEmitter() as IncomingMessage;
      req.method = method;
      req.url = url;

      const chunks: Buffer[] = [];
      const headers: Record<string, string> = {};
      const stream = new PassThrough();
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));

      const res = stream as unknown as ServerResponse;
      res.statusCode = 200;
      res.setHeader = (name: string, value: string | number | readonly string[]) => {
        headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
        return res;
      };
      const origEnd = stream.end.bind(stream);
      res.end = ((chunk?: unknown) => {
        if (chunk !== undefined && chunk !== null) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        origEnd();
        resolve({ status: res.statusCode, headers, body: Buffer.concat(chunks) });
        return res;
      }) as ServerResponse['end'];

      mw(req, res, (err?: unknown) => {
        if (err) reject(err);
        else resolve({ status: 404, headers, body: Buffer.alloc(0) });
      });
    });
  }

  it('rejects path traversal with 403, enforces read-only methods, and serves manifest & files', async () => {
    const steamDir = process.env.LUFTRAUSERS_STEAM_DIR?.trim() || DEFAULT_STEAM_DATA_DIR;
    const hasSteam = fs.existsSync(steamDir);
    expect(resolveSafeSteamFilePath(steamDir, '../secret.txt')).toBeNull();
    expect(resolveSafeSteamFilePath(steamDir, 'res/%2e%2e/secret.txt')).toBeNull();
    expect(resolveSafeSteamFilePath(steamDir, 'C:\\Windows\\win.ini')).toBeNull();
    expect(resolveSafeSteamFilePath(steamDir, 'res/room.json')).not.toBeNull();

    const plugin = steamBridgePlugin({ steamDir });
    expect(plugin.name).toBe('krunked-steam-bridge');

    const mw = createSteamBridgeMiddleware({ steamDir });

    const traversal = await invokeMiddleware(mw, 'GET', '/steam-vault/file/..%2f..%2fwin.ini');
    expect(traversal.status).toBe(403);

    const postRes = await invokeMiddleware(mw, 'POST', '/steam-vault/manifest.json');
    expect(postRes.status).toBe(405);

    const manifestRes = await invokeMiddleware(mw, 'GET', '/steam-vault/manifest.json');
    expect(manifestRes.status).toBe(200);
    expect(manifestRes.headers['cache-control']).toBe('no-store');
    const manifest = JSON.parse(manifestRes.body.toString('utf8')) as {
      available: boolean;
      res: string[];
      bgm: string[];
      sfx: string[];
    };
    if (hasSteam) {
      expect(manifest.available).toBe(true);
      expect(manifest.res).toContain('player.json');
      expect(manifest.bgm).toHaveLength(20);
      expect(manifest.sfx).toHaveLength(52);

      const roomRes = await invokeMiddleware(mw, 'GET', '/steam-vault/file/res/room.json');
      expect(roomRes.status).toBe(200);
      expect(roomRes.headers['cache-control']).toBe('no-store');
      expect(roomRes.body.toString('utf8')).toContain('sealevel');
    } else {
      expect(manifest.available).toBe(false);
      expect(manifest.res).toEqual([]);
    }
  });

  it('VaultLoader loads from Steam bridge middleware and falls back cleanly when unavailable', async () => {
    const steamDir = process.env.LUFTRAUSERS_STEAM_DIR?.trim() || DEFAULT_STEAM_DATA_DIR;
    const hasSteam = fs.existsSync(steamDir);
    const mw = createSteamBridgeMiddleware();

    const fetchViaMiddleware: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      const req = new EventEmitter() as IncomingMessage;
      req.method = 'GET';
      req.url = url;
      const chunks: Buffer[] = [];
      const stream = new PassThrough();
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      const result = await new Promise<{ status: number; body: Buffer }>((resolve) => {
        const res = stream as unknown as ServerResponse;
        res.statusCode = 200;
        res.setHeader = () => res;
        const origEnd = stream.end.bind(stream);
        res.end = ((chunk?: unknown) => {
          if (chunk !== undefined && chunk !== null) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
          }
          origEnd();
          resolve({ status: res.statusCode, body: Buffer.concat(chunks) });
          return res;
        }) as ServerResponse['end'];
        mw(req, res, () => resolve({ status: 404, body: Buffer.alloc(0) }));
      });
      return new Response(new Uint8Array(result.body), { status: result.status });
    };

    const liveLoader = new VaultLoader({ fetchImpl: fetchViaMiddleware });
    const liveBundle = await liveLoader.load();
    if (hasSteam) {
      expect(liveBundle.data.vaultSource).toBe('steam-local');
      expect(liveBundle.textures.sprites?.source).toBe('steam-tga');
    } else {
      expect(liveBundle.data.vaultSource).toBe('procedural-fallback');
      expect(liveBundle.textures.sprites?.source).toBe('procedural');
    }

    const offlineLoader = new VaultLoader({
      fetchImpl: async () => new Response('Not Found', { status: 404 }),
    });
    const offlineBundle = await offlineLoader.load();
    expect(offlineBundle.data.vaultSource).toBe('procedural-fallback');

    // Dual Asset Pack Toggle: 'skybreaker' NEVER fetches Steam even when bridge is live
    let skybreakerFetchCalls = 0;
    const trackingFetch: typeof fetch = async (input, init) => {
      skybreakerFetchCalls++;
      return fetchViaMiddleware(input, init);
    };
    const dualLoader = new VaultLoader({ fetchImpl: trackingFetch });
    const skybreakerBundle = await dualLoader.load('skybreaker');
    expect(skybreakerBundle.data.vaultSource).toBe('procedural-fallback');
    expect(skybreakerBundle.textures.sprites?.source).toBe('procedural');
    expect(skybreakerBundle.data.global.planenames[125]?.name).toBe('APEX OMEGA');
    expect(skybreakerFetchCalls).toBe(0);

    // isSteamAvailable() probes manifest cleanly
    expect(await dualLoader.isSteamAvailable()).toBe(hasSteam);
    expect(await offlineLoader.isSteamAvailable()).toBe(false);

    // 'steam-local' loads Steam when available and falls back cleanly when unavailable
    const steamPreferred = await dualLoader.load('steam-local');
    if (hasSteam) {
      expect(steamPreferred.data.vaultSource).toBe('steam-local');
      expect(steamPreferred.textures.sprites?.source).toBe('steam-tga');
    } else {
      expect(steamPreferred.data.vaultSource).toBe('procedural-fallback');
    }
    const offlineSteamPreferred = await offlineLoader.load('steam-local');
    expect(offlineSteamPreferred.data.vaultSource).toBe('procedural-fallback');

    // Mocked Steam available check & *.github.io guard
    const mockAvailLoader = new VaultLoader({
      fetchImpl: async (input) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/steam-vault/manifest.json')) {
          return new Response(JSON.stringify({ available: true, steamDir: 'C:\\Mock\\data' }), {
            status: 200,
          });
        }
        return new Response('Not Found', { status: 404 });
      },
    });
    expect(await mockAvailLoader.isSteamAvailable()).toBe(true);
    // Still returns procedural-fallback immediately when 'skybreaker' is requested
    expect((await mockAvailLoader.load('skybreaker')).data.vaultSource).toBe('procedural-fallback');

    const prevLocation = (globalThis as { location?: { hostname?: string } }).location;
    try {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        writable: true,
        value: { hostname: 'krunked.github.io' },
      });
      const hostedLoader = new VaultLoader();
      expect(await hostedLoader.isSteamAvailable()).toBe(false);
      expect((await hostedLoader.load('steam-local')).data.vaultSource).toBe(
        'procedural-fallback',
      );
    } finally {
      if (prevLocation === undefined) {
        delete (globalThis as { location?: unknown }).location;
      } else {
        Object.defineProperty(globalThis, 'location', {
          configurable: true,
          writable: true,
          value: prevLocation,
        });
      }
    }

    const prevSky = process.env.SKYBREAKER_STEAM_DIR;
    const prevLegacy = process.env.LUFTRAUSERS_STEAM_DIR;
    try {
      process.env.SKYBREAKER_STEAM_DIR = 'C:\\CustomSkybreaker\\data';
      process.env.LUFTRAUSERS_STEAM_DIR = 'C:\\LegacySteam\\data';
      expect(resolveSteamDataDir()).toBe('C:\\CustomSkybreaker\\data');

      delete process.env.SKYBREAKER_STEAM_DIR;
      expect(resolveSteamDataDir()).toBe('C:\\LegacySteam\\data');

      delete process.env.LUFTRAUSERS_STEAM_DIR;
      expect(resolveSteamDataDir({ steamDir: 'C:\\OptionSteam\\data' })).toBe(
        'C:\\OptionSteam\\data',
      );
      expect(resolveSteamDataDir()).toBe(DEFAULT_STEAM_DATA_DIR);
    } finally {
      if (prevSky === undefined) delete process.env.SKYBREAKER_STEAM_DIR;
      else process.env.SKYBREAKER_STEAM_DIR = prevSky;
      if (prevLegacy === undefined) delete process.env.LUFTRAUSERS_STEAM_DIR;
      else process.env.LUFTRAUSERS_STEAM_DIR = prevLegacy;
    }
  });
});

describe('checkCleanRoomGitHygiene', () => {
  it('flags forbidden Steam media/binary files and passes clean repo files', () => {
    const dirty = checkCleanRoomGitHygiene([
      'src/vault/loader.ts',
      'bgm/luftrauser_bass1.ogg',
      'sfx/sndbullet.wav',
      'Luftrausers.exe',
      'SDL2.dll',
      'gfx/fonts/fntb.fnt',
      'gfx/shaders/post.shader',
      'gfx/textures/diffuse/sheet1grey.png',
      'gfx/textures/diffuse/sheet2grey.png',
      'gfx/textures/diffuse/nuke.png',
      'gfx/textures/diffuse/characters_texture.png',
      'gfx/textures/diffuse/cutscenes_blended.png',
    ]);
    expect(dirty).toHaveLength(11);
    expect(dirty).not.toContain('src/vault/loader.ts');

    const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean);
    expect(checkCleanRoomGitHygiene(tracked)).toEqual([]);
  });
});

describe('createProceduralFontTexture narrow glyph & control-char rasterization', () => {
  const isLit = (
    tex: ReturnType<typeof createProceduralFontTexture>,
    x: number,
    y: number,
  ): boolean => tex.rgba[(y * tex.width + x) * 4 + 3]! > 0;

  it("preserves both left and right stems for 'U' (85) in a narrow 4x7 glyph box", () => {
    const font: Parameters<typeof createProceduralFontTexture>[0] = {
      name: 'test_u',
      face: 'Test',
      size: 10,
      lineHeight: 10,
      base: 8,
      scaleW: 16,
      scaleH: 16,
      pageFile: 'test_u_0.png',
      glyphs: {
        85: { id: 85, x: 2, y: 3, width: 4, height: 7, xoffset: 0, yoffset: 0, xadvance: 5 },
      },
    };
    const tex = createProceduralFontTexture(font);

    let hasLeftCol = false;
    let hasRightCol = false;
    for (let gy = 0; gy < 7; gy++) {
      if (isLit(tex, 2 + 0, 3 + gy)) hasLeftCol = true;
      if (isLit(tex, 2 + 3, 3 + gy)) hasRightCol = true;
    }
    expect(hasLeftCol).toBe(true);
    expect(hasRightCol).toBe(true);
  });

  it("preserves upper and lower dots with a middle gap for ':' (58) in a 2x6 glyph box", () => {
    const font: Parameters<typeof createProceduralFontTexture>[0] = {
      name: 'test_colon',
      face: 'Test',
      size: 10,
      lineHeight: 10,
      base: 8,
      scaleW: 16,
      scaleH: 16,
      pageFile: 'test_colon_0.png',
      glyphs: {
        58: { id: 58, x: 1, y: 2, width: 2, height: 6, xoffset: 0, yoffset: 0, xadvance: 3 },
      },
    };
    const tex = createProceduralFontTexture(font);

    let upperLit = false;
    let middleLit = false;
    let lowerLit = false;
    for (let gy = 0; gy < 6; gy++) {
      const rowLit = isLit(tex, 1, 2 + gy) || isLit(tex, 2, 2 + gy);
      if (gy <= 1 && rowLit) upperLit = true;
      if (gy >= 2 && gy <= 3 && rowLit) middleLit = true;
      if (gy >= 4 && rowLit) lowerLit = true;
    }
    expect(upperLit).toBe(true);
    expect(middleLit).toBe(false);
    expect(lowerLit).toBe(true);
  });

  it("retains full vertical stem for '1' (49) in a narrow 2x7 glyph box", () => {
    const font: Parameters<typeof createProceduralFontTexture>[0] = {
      name: 'test_one',
      face: 'Test',
      size: 10,
      lineHeight: 10,
      base: 8,
      scaleW: 16,
      scaleH: 16,
      pageFile: 'test_one_0.png',
      glyphs: {
        49: { id: 49, x: 1, y: 2, width: 2, height: 7, xoffset: 0, yoffset: 0, xadvance: 3 },
      },
    };
    const tex = createProceduralFontTexture(font);

    for (let gy = 0; gy < 7; gy++) {
      const rowLit = isLit(tex, 1, 2 + gy) || isLit(tex, 2, 2 + gy);
      expect(rowLit).toBe(true);
    }
  });

  it('produces zero lit pixels for control code 10 (newline)', () => {
    const font: Parameters<typeof createProceduralFontTexture>[0] = {
      name: 'test_newline',
      face: 'Test',
      size: 10,
      lineHeight: 10,
      base: 8,
      scaleW: 16,
      scaleH: 16,
      pageFile: 'test_newline_0.png',
      glyphs: {
        10: { id: 10, x: 0, y: 0, width: 8, height: 8, xoffset: 0, yoffset: 0, xadvance: 0 },
      },
    };
    const tex = createProceduralFontTexture(font);
    const anyLit = tex.rgba.some((v) => v > 0);
    expect(anyLit).toBe(false);
  });

  it('derives proportional AngelCode-style bounds for punctuation (-, ., ,, !, (, ), ~) in procedural fonts', () => {
    const fallback = createProceduralFallbackBundle();
    for (const fontName of ['fnts', 'fntm', 'fntb'] as const) {
      const font = fallback.data.fonts[fontName]!;
      const capA = font.glyphs[65]!;
      const hyphen = font.glyphs[45]!;
      const period = font.glyphs[46]!;
      const comma = font.glyphs[44]!;
      const bang = font.glyphs[33]!;
      const lparen = font.glyphs[40]!;
      const rparen = font.glyphs[41]!;
      const tilde = font.glyphs[126]!;

      // Hyphen must be thin & vertically centered, NEVER a full-height solid block
      expect(hyphen.height).toBeLessThanOrEqual(Math.ceil(capA.height * 0.35));
      expect(hyphen.yoffset).toBeGreaterThan(capA.yoffset);
      expect(hyphen.yoffset + hyphen.height).toBeLessThan(capA.yoffset + capA.height);

      // Period & comma must sit cleanly near the baseline with compact dimensions
      expect(period.height).toBeLessThanOrEqual(Math.ceil(capA.height * 0.45));
      expect(period.yoffset).toBeGreaterThan(capA.yoffset + Math.floor(capA.height * 0.4));
      expect(comma.height).toBeLessThanOrEqual(Math.ceil(capA.height * 0.45));
      expect(comma.width).toBeLessThan(capA.width);

      // Narrow punctuation must stay slim rather than stretching across full cell width
      expect(bang.width).toBeLessThanOrEqual(Math.ceil(capA.width * 0.4));
      expect(lparen.width).toBeLessThan(capA.width);
      expect(rparen.width).toBeLessThan(capA.width);

      // Tilde must remain vertically compact in the middle band
      expect(tilde.height).toBeLessThanOrEqual(Math.ceil(capA.height * 0.6));
      expect(tilde.yoffset).toBeGreaterThan(capA.yoffset);
    }
  });
});
