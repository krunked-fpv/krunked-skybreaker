import type {
  AudioAssetManifest,
  BitmapFontSpec,
  DecodedTexture,
  GameDataBundle,
  IVaultLoader,
  VaultAssetBundle,
} from '../contracts/vault';
import { parseAngelCodeFnt } from './font-parser';
import { parseJsonCpp } from './jsoncpp';
import {
  normalizeEnemiesData,
  normalizeFxData,
  normalizeGlobalData,
  normalizeParallaxData,
  normalizePlayerData,
  normalizeProjectilesData,
  normalizeRoomData,
  normalizeSpawnCoordinator,
  normalizeSpriteAtlas,
} from './normalizer';
import {
  createProceduralFallbackBundle,
  createProceduralFontTexture,
  createProceduralMenuTexture,
  createProceduralNukeTexture,
  createProceduralSpritesTexture,
} from './procedural-fallback';
import { decodeTgaRgba, isPcpBlob } from './tga';
import { VANILLA_BGM_STEMS, VANILLA_SFX_CUES } from './vanilla-defaults';

export const DEFAULT_STEAM_DATA_DIR =
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Luftrausers\\data';

const FONT_NAMES = ['fntb', 'fntm', 'fntmb', 'fnts', 'fntxl'] as const;

interface SteamManifestPayload {
  available: boolean;
  steamDir: string | null;
  res: string[];
  gfx: string[];
  fonts: string[];
  bgm: string[];
  sfx: string[];
}

export interface VaultLoaderOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface RawSteamSources {
  steamDir: string | null;
  playerRaw: string;
  projectilesRaw: string;
  enemiesRaw: string;
  enemiesSfmtRaw: string;
  spawnRaw: string;
  spawnSfmtRaw: string;
  globalRaw: string;
  fxRaw: string;
  parallaxRaw: string;
  roomRaw: string;
  spritesRaw: string;
  menuSpritesRaw: string;
  nukeSpritesRaw: string;
  fontTexts: Record<string, string>;
  spritesBytes: Uint8Array;
  menuBytes: Uint8Array | null;
  nukeBytes: Uint8Array | null;
  fontImageBytes: Record<string, Uint8Array | null>;
  bgmFiles: string[];
  sfxFiles: string[];
  baseUrl: string;
}

function decodeTextureOrProcedural(
  name: string,
  bytes: Uint8Array | null,
  fallbackFn: () => DecodedTexture,
): DecodedTexture {
  if (bytes && bytes.length > 0 && !isPcpBlob(bytes)) {
    try {
      const decoded = decodeTgaRgba(bytes);
      return {
        name,
        width: decoded.width,
        height: decoded.height,
        rgba: decoded.rgba,
        source: 'steam-tga',
      };
    } catch {
      return fallbackFn();
    }
  }
  return fallbackFn();
}

function buildAudioManifestFromFiles(
  bgmFiles: readonly string[],
  sfxFiles: readonly string[],
  baseUrl: string,
): AudioAssetManifest {
  const bgm: Record<string, string | null> = {};
  for (const stem of VANILLA_BGM_STEMS) {
    bgm[stem] = null;
  }
  for (const file of bgmFiles) {
    if (!file.toLowerCase().endsWith('.ogg')) continue;
    const stem = file.replace(/\.ogg$/i, '');
    bgm[stem] = `${baseUrl}/steam-vault/file/bgm/${file}`;
  }

  const sfx: Record<string, string | null> = {};
  for (const cue of VANILLA_SFX_CUES) {
    sfx[cue] = null;
  }
  for (const file of sfxFiles) {
    if (!file.toLowerCase().endsWith('.wav')) continue;
    const cue = file.replace(/\.wav$/i, '');
    sfx[cue] = `${baseUrl}/steam-vault/file/sfx/${file}`;
  }

  return {
    source: 'steam-local',
    bgm,
    sfx,
  };
}

function assembleSteamVaultBundle(src: RawSteamSources): VaultAssetBundle {
  const spritesTex = decodeTextureOrProcedural('sprites', src.spritesBytes, () =>
    createProceduralSpritesTexture(
      normalizeSpriteAtlas('sprites', parseJsonCpp(src.spritesRaw), 2048, 1024),
    ),
  );

  const spritesAtlas = normalizeSpriteAtlas(
    'sprites',
    parseJsonCpp(src.spritesRaw),
    spritesTex.width,
    spritesTex.height,
  );
  const menuAtlas = normalizeSpriteAtlas(
    'menusprites',
    parseJsonCpp(src.menuSpritesRaw),
    2048,
    1024,
  );
  const nukeAtlas = normalizeSpriteAtlas(
    'nukesprites',
    parseJsonCpp(src.nukeSpritesRaw),
    2048,
    1024,
  );

  const menuspritesTex = decodeTextureOrProcedural('menusprites', src.menuBytes, () =>
    createProceduralMenuTexture(menuAtlas),
  );
  const nukespritesTex = decodeTextureOrProcedural('nukesprites', src.nukeBytes, () =>
    createProceduralNukeTexture(nukeAtlas),
  );

  const fonts: Record<string, BitmapFontSpec> = {};
  const textures: Record<string, DecodedTexture> = {
    sprites: spritesTex,
    menusprites: menuspritesTex,
    nukesprites: nukespritesTex,
  };

  for (const fontName of FONT_NAMES) {
    const fntText = src.fontTexts[fontName];
    if (!fntText) {
      throw new Error(`Missing Steam font metric file: ${fontName}.fnt`);
    }
    const fontSpec = parseAngelCodeFnt(fontName, fntText);
    fonts[fontName] = fontSpec;
    textures[fontName] = decodeTextureOrProcedural(
      fontName,
      src.fontImageBytes[fontName] ?? null,
      () => createProceduralFontTexture(fontSpec),
    );
  }

  const data: GameDataBundle = {
    vaultSource: 'steam-local',
    steamDir: src.steamDir,
    player: normalizePlayerData(parseJsonCpp(src.playerRaw)),
    projectiles: normalizeProjectilesData(parseJsonCpp(src.projectilesRaw)),
    enemies: normalizeEnemiesData(parseJsonCpp(src.enemiesRaw)),
    enemiesSfmt: normalizeEnemiesData(parseJsonCpp(src.enemiesSfmtRaw)),
    spawnCoordinator: normalizeSpawnCoordinator(parseJsonCpp(src.spawnRaw)),
    spawnCoordinatorSfmt: normalizeSpawnCoordinator(parseJsonCpp(src.spawnSfmtRaw)),
    global: normalizeGlobalData(parseJsonCpp(src.globalRaw)),
    fx: normalizeFxData(parseJsonCpp(src.fxRaw)),
    parallax: normalizeParallaxData(parseJsonCpp(src.parallaxRaw)),
    room: normalizeRoomData(parseJsonCpp(src.roomRaw)),
    atlases: {
      sprites: spritesAtlas,
      menusprites: menuAtlas,
      nukesprites: nukeAtlas,
    },
    fonts,
  };

  const audioManifest = buildAudioManifestFromFiles(src.bgmFiles, src.sfxFiles, src.baseUrl);

  return {
    data,
    textures,
    audioManifest,
  };
}

/**
 * Runtime asset loader probing `/steam-vault/manifest.json` and bridging local Steam
 * assets read-only, or falling back seamlessly to `createProceduralFallbackBundle()`.
 */
export class VaultLoader implements IVaultLoader {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly hasCustomTransport: boolean;

  constructor(options?: VaultLoaderOptions) {
    this.baseUrl = (options?.baseUrl ?? '').replace(/\/+$/, '');
    this.fetchImpl = options?.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.hasCustomTransport =
      options?.baseUrl !== undefined || options?.fetchImpl !== undefined;
  }

  private async fetchText(relPath: string): Promise<string> {
    const res = await this.fetchImpl(`${this.baseUrl}/steam-vault/file/${relPath}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch ${relPath}: HTTP ${res.status}`);
    }
    return res.text();
  }

  private async fetchBytesOptional(relPath: string): Promise<Uint8Array | null> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/steam-vault/file/${relPath}`);
      if (!res.ok) {
        return null;
      }
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  async load(): Promise<VaultAssetBundle> {
    const hostname = (globalThis as { location?: { hostname?: string } }).location?.hostname;
    if (!this.hasCustomTransport && typeof hostname === 'string' && hostname.endsWith('.github.io')) {
      return createProceduralFallbackBundle();
    }

    try {
      const manifestRes = await this.fetchImpl(`${this.baseUrl}/steam-vault/manifest.json`);
      if (!manifestRes.ok) {
        return createProceduralFallbackBundle();
      }
      const manifest = (await manifestRes.json()) as SteamManifestPayload;
      if (!manifest.available) {
        return createProceduralFallbackBundle();
      }

      const [
        playerRaw,
        projectilesRaw,
        enemiesRaw,
        enemiesSfmtRaw,
        spawnRaw,
        spawnSfmtRaw,
        globalRaw,
        fxRaw,
        parallaxRaw,
        roomRaw,
        spritesRaw,
        menuSpritesRaw,
        nukeSpritesRaw,
        spritesBytes,
        menuBytes,
        nukeBytes,
        ...fontResults
      ] = await Promise.all([
        this.fetchText('res/player.json'),
        this.fetchText('res/projectiles.json'),
        this.fetchText('res/enemies.json'),
        this.fetchText('res/enemies_sfmt.json'),
        this.fetchText('res/spawncoordinator.json'),
        this.fetchText('res/spawncoordinator_sfmt.json'),
        this.fetchText('res/global.json'),
        this.fetchText('res/fxparticle.json'),
        this.fetchText('res/parallax.json'),
        this.fetchText('res/room.json'),
        this.fetchText('gfx/sprites.json'),
        this.fetchText('gfx/menusprites.json'),
        this.fetchText('gfx/nukesprites.json'),
        this.fetchBytesOptional('gfx/textures/diffuse/sheet1grey.png'),
        this.fetchBytesOptional('gfx/textures/diffuse/sheet2grey.png'),
        this.fetchBytesOptional('gfx/textures/diffuse/nuke.png'),
        ...FONT_NAMES.map(async (fontName) => ({
          name: fontName,
          text: await this.fetchText(`gfx/fonts/${fontName}.fnt`),
          bytes: await this.fetchBytesOptional(`gfx/fonts/${fontName}_0.png`),
        })),
      ]);

      if (!spritesBytes) {
        return createProceduralFallbackBundle();
      }

      const fontTexts: Record<string, string> = {};
      const fontImageBytes: Record<string, Uint8Array | null> = {};
      for (const fr of fontResults) {
        fontTexts[fr.name] = fr.text;
        fontImageBytes[fr.name] = fr.bytes;
      }

      return assembleSteamVaultBundle({
        steamDir: manifest.steamDir,
        playerRaw,
        projectilesRaw,
        enemiesRaw,
        enemiesSfmtRaw,
        spawnRaw,
        spawnSfmtRaw,
        globalRaw,
        fxRaw,
        parallaxRaw,
        roomRaw,
        spritesRaw,
        menuSpritesRaw,
        nukeSpritesRaw,
        fontTexts,
        spritesBytes,
        menuBytes,
        nukeBytes,
        fontImageBytes,
        bgmFiles: manifest.bgm ?? [],
        sfxFiles: manifest.sfx ?? [],
        baseUrl: this.baseUrl,
      });
    } catch {
      return createProceduralFallbackBundle();
    }
  }
}

type NodeFsModule = typeof import('node:fs');
type NodePathModule = typeof import('node:path');

function getNodeModules(): { fs: NodeFsModule; path: NodePathModule } | null {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  if (!proc || typeof proc.getBuiltinModule !== 'function') {
    return null;
  }
  const fsMod = proc.getBuiltinModule('node:fs') as NodeFsModule | undefined;
  const pathMod = proc.getBuiltinModule('node:path') as NodePathModule | undefined;
  if (!fsMod || !pathMod) {
    return null;
  }
  return { fs: fsMod, path: pathMod };
}

/**
 * Synchronous Node.js loader for headless Vitest parity tests and CLI audit scripts.
 * Reads strictly read-only from `steamDir` (or `LUFTRAUSERS_STEAM_DIR` or default Steam path)
 * and falls back cleanly to `createProceduralFallbackBundle()` when unavailable.
 */
export function loadVaultFromDisk(steamDir?: string): VaultAssetBundle {
  const mods = getNodeModules();
  if (!mods) {
    return createProceduralFallbackBundle();
  }
  const { fs, path } = mods;
  const envDir =
    typeof process !== 'undefined' ? process.env.LUFTRAUSERS_STEAM_DIR?.trim() : undefined;
  const resolvedDir = steamDir?.trim() || envDir || DEFAULT_STEAM_DATA_DIR;

  try {
    if (!fs.statSync(resolvedDir).isDirectory()) {
      return createProceduralFallbackBundle();
    }
  } catch {
    return createProceduralFallbackBundle();
  }

  const readText = (relPath: string): string =>
    fs.readFileSync(path.join(resolvedDir, relPath), 'utf8');

  const readBytesOptional = (relPath: string): Uint8Array | null => {
    try {
      return new Uint8Array(fs.readFileSync(path.join(resolvedDir, relPath)));
    } catch {
      return null;
    }
  };

  const listDir = (relDir: string): string[] => {
    try {
      return fs
        .readdirSync(path.join(resolvedDir, relDir), { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  };

  try {
    const spritesBytes = readBytesOptional('gfx/textures/diffuse/sheet1grey.png');
    if (!spritesBytes) {
      return createProceduralFallbackBundle();
    }

    const fontTexts: Record<string, string> = {};
    const fontImageBytes: Record<string, Uint8Array | null> = {};
    for (const fontName of FONT_NAMES) {
      fontTexts[fontName] = readText(`gfx/fonts/${fontName}.fnt`);
      fontImageBytes[fontName] = readBytesOptional(`gfx/fonts/${fontName}_0.png`);
    }

    return assembleSteamVaultBundle({
      steamDir: resolvedDir,
      playerRaw: readText('res/player.json'),
      projectilesRaw: readText('res/projectiles.json'),
      enemiesRaw: readText('res/enemies.json'),
      enemiesSfmtRaw: readText('res/enemies_sfmt.json'),
      spawnRaw: readText('res/spawncoordinator.json'),
      spawnSfmtRaw: readText('res/spawncoordinator_sfmt.json'),
      globalRaw: readText('res/global.json'),
      fxRaw: readText('res/fxparticle.json'),
      parallaxRaw: readText('res/parallax.json'),
      roomRaw: readText('res/room.json'),
      spritesRaw: readText('gfx/sprites.json'),
      menuSpritesRaw: readText('gfx/menusprites.json'),
      nukeSpritesRaw: readText('gfx/nukesprites.json'),
      fontTexts,
      spritesBytes,
      menuBytes: readBytesOptional('gfx/textures/diffuse/sheet2grey.png'),
      nukeBytes: readBytesOptional('gfx/textures/diffuse/nuke.png'),
      fontImageBytes,
      bgmFiles: listDir('bgm'),
      sfxFiles: listDir('sfx'),
      baseUrl: '',
    });
  } catch {
    return createProceduralFallbackBundle();
  }
}

const FORBIDDEN_EXTENSIONS = [
  '.ogg',
  '.wav',
  '.exe',
  '.dll',
  '.fnt',
  '.shader',
  '.geo',
  '.tga',
  '.pak',
  '.pcp',
];

const FORBIDDEN_FILENAMES = new Set([
  'sheet1grey.png',
  'sheet2grey.png',
  'nuke.png',
  'characters_texture.png',
  'cutscenes_blended.png',
  'fntb_0.png',
  'fntm_0.png',
  'fntmb_0.png',
  'fnts_0.png',
  'fntxl_0.png',
  'dex_log.html',
]);

const FORBIDDEN_PATH_PATTERN =
  /(^|[\\/])(steamapps[\\/]common[\\/]luftrausers|data[\\/](res|gfx|bgm|sfx)[\\/])/i;

/**
 * Validates that no proprietary Steam media, binary, shader, font, or copied data files
 * appear in a tracked git file list. Returns offending file paths (empty array when clean).
 */
export function checkCleanRoomGitHygiene(trackedFiles: readonly string[]): string[] {
  const violations: string[] = [];

  for (const file of trackedFiles) {
    const normalized = file.replace(/\\/g, '/').toLowerCase();
    const base = normalized.slice(normalized.lastIndexOf('/') + 1);

    const hasForbiddenExt = FORBIDDEN_EXTENSIONS.some((ext) => normalized.endsWith(ext));
    const hasForbiddenName = FORBIDDEN_FILENAMES.has(base);
    const hasForbiddenDir = FORBIDDEN_PATH_PATTERN.test(normalized);

    if (hasForbiddenExt || hasForbiddenName || hasForbiddenDir) {
      violations.push(file);
    }
  }

  return violations;
}
