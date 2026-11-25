import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Connect, Plugin } from 'vite';

export const DEFAULT_STEAM_DATA_DIR =
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Luftrausers\\data';

export interface SteamBridgeManifest {
  available: boolean;
  steamDir: string | null;
  res: string[];
  gfx: string[];
  fonts: string[];
  bgm: string[];
  sfx: string[];
}

export interface SteamBridgeOptions {
  steamDir?: string;
}

export function resolveSteamDataDir(options?: SteamBridgeOptions): string {
  const skybreakerEnv = process.env.SKYBREAKER_STEAM_DIR?.trim();
  const legacyEnv = process.env.LUFTRAUSERS_STEAM_DIR?.trim();
  const optDir = options?.steamDir?.trim();
  return skybreakerEnv || legacyEnv || optDir || DEFAULT_STEAM_DATA_DIR;
}

function listDirFiles(dirPath: string): string[] {
  try {
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export function buildSteamManifest(steamDir: string): SteamBridgeManifest {
  try {
    const stat = fs.statSync(steamDir);
    if (!stat.isDirectory()) {
      return { available: false, steamDir: null, res: [], gfx: [], fonts: [], bgm: [], sfx: [] };
    }
  } catch {
    return { available: false, steamDir: null, res: [], gfx: [], fonts: [], bgm: [], sfx: [] };
  }

  return {
    available: true,
    steamDir,
    res: listDirFiles(path.join(steamDir, 'res')),
    gfx: listDirFiles(path.join(steamDir, 'gfx')),
    fonts: listDirFiles(path.join(steamDir, 'gfx', 'fonts')),
    bgm: listDirFiles(path.join(steamDir, 'bgm')),
    sfx: listDirFiles(path.join(steamDir, 'sfx')),
  };
}

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.ogg':
      return 'audio/ogg';
    case '.wav':
      return 'audio/wav';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.fnt':
    case '.txt':
    case '.shader':
    case '.geo':
      return 'text/plain; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Validates and resolves a relative `/steam-vault/file/<relPath>` strictly within `steamDir`.
 * Returns `null` if path traversal or escape is detected.
 */
export function resolveSafeSteamFilePath(steamDir: string, rawRelPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawRelPath);
  } catch {
    return null;
  }

  if (!decoded || decoded.includes('\0')) {
    return null;
  }
  if (decoded.startsWith('/') || decoded.startsWith('\\') || /^[a-zA-Z]:/.test(decoded)) {
    return null;
  }

  const segments = decoded.split(/[\\/]+/);
  if (segments.some((seg) => seg === '..' || seg === '')) {
    return null;
  }

  const rootAbs = path.resolve(steamDir);
  const candidateAbs = path.resolve(rootAbs, ...segments);
  const rel = path.relative(rootAbs, candidateAbs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }

  return candidateAbs;
}

export function createSteamBridgeMiddleware(
  options?: SteamBridgeOptions,
): Connect.NextHandleFunction {
  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const rawUrl = req.url ?? '';
    const pathname = rawUrl.split('?')[0] ?? '';
    if (!pathname.startsWith('/steam-vault/')) {
      next();
      return;
    }

    const method = (req.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      res.end('Method Not Allowed');
      return;
    }

    const steamDir = resolveSteamDataDir(options);

    if (pathname === '/steam-vault/manifest.json') {
      const manifest = buildSteamManifest(steamDir);
      const body = JSON.stringify(manifest);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(method === 'HEAD' ? undefined : body);
      return;
    }

    const filePrefix = '/steam-vault/file/';
    if (pathname.startsWith(filePrefix)) {
      const relPart = pathname.slice(filePrefix.length);
      const safePath = resolveSafeSteamFilePath(steamDir, relPart);
      if (!safePath) {
        res.statusCode = 403;
        res.setHeader('Cache-Control', 'no-store');
        res.end('Forbidden');
        return;
      }

      let realRoot: string;
      let realTarget: string;
      let stat: fs.Stats;
      try {
        realRoot = fs.realpathSync(steamDir);
        realTarget = fs.realpathSync(safePath);
        const relReal = path.relative(realRoot, realTarget);
        if (!relReal || relReal.startsWith('..') || path.isAbsolute(relReal)) {
          res.statusCode = 403;
          res.setHeader('Cache-Control', 'no-store');
          res.end('Forbidden');
          return;
        }
        stat = fs.statSync(realTarget);
      } catch {
        res.statusCode = 404;
        res.setHeader('Cache-Control', 'no-store');
        res.end('Not Found');
        return;
      }

      if (!stat.isFile()) {
        res.statusCode = 404;
        res.setHeader('Cache-Control', 'no-store');
        res.end('Not Found');
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', getContentType(realTarget));
      res.setHeader('Content-Length', String(stat.size));
      res.setHeader('Cache-Control', 'no-store');

      if (method === 'HEAD') {
        res.end();
        return;
      }

      const stream = fs.createReadStream(realTarget);
      stream.on('error', () => {
        if (!res.headersSent) {
          res.statusCode = 500;
        }
        res.end();
      });
      stream.pipe(res);
      return;
    }

    res.statusCode = 404;
    res.setHeader('Cache-Control', 'no-store');
    res.end('Not Found');
  };
}

/**
 * Read-only Vite middleware plugin bridging local Steam Luftrausers data under `/steam-vault/`.
 */
export function steamBridgePlugin(options?: SteamBridgeOptions): Plugin {
  const middleware = createSteamBridgeMiddleware(options);
  return {
    name: 'krunked-steam-bridge',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
