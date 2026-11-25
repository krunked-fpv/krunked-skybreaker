import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  VANILLA_BGM_STEMS,
  VANILLA_ENEMIES_RAW,
  VANILLA_ENEMIES_SFMT_RAW,
  VANILLA_FX_RAW,
  VANILLA_GLOBAL_RAW,
  VANILLA_PARALLAX_RAW,
  VANILLA_PLAYER_RAW,
  VANILLA_PROJECTILES_RAW,
  VANILLA_ROOM_RAW,
  VANILLA_SFX_CUES,
  VANILLA_SPAWN_COORDINATOR_RAW,
  VANILLA_SPAWN_COORDINATOR_SFMT_RAW,
} from '../src/vault/vanilla-defaults.ts';

const DEFAULT_STEAM_DATA_DIR =
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Luftrausers\\data';

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
] as const;

const FORBIDDEN_FILENAMES = new Set<string>([
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

const TRADEMARK_SCAN_FILES = [
  'src/vault/vanilla-defaults.ts',
  'src/render/palettes.ts',
  'src/render/renderer.ts',
  'src/sim/mod-packs.ts',
  'index.html',
  'package.json',
] as const;

const FORBIDDEN_TRADEMARK_TERMS: ReadonlyArray<{ label: string; regex: RegExp }> = [
  { label: 'luftrauser', regex: /luftrauser/i },
  { label: 'urauser', regex: /urauser/i },
  { label: 'kozilek', regex: /kozilek/i },
  { label: 'vlambeer', regex: /vlambeer/i },
  { label: 'devolver', regex: /devolver/i },
  { label: 'equiped', regex: /\bequiped\b/i },
  { label: 'bob raus', regex: /bob\s+raus/i },
  { label: 'unhealthy boeing', regex: /unhealthy\s+boeing/i },
];

/**
 * Lines allowed strictly for optional read-only Steam bridge compatibility keys
 * (never user-facing text, branding, descriptions, or callsigns).
 */
function isSteamBridgeCompatLine(relPath: string, line: string): boolean {
  const trimmed = line.trim();
  if (relPath === 'src/vault/vanilla-defaults.ts') {
    // Steam OGG stem manifest IDs ('luftrauser_bass1', 'luftrauser__urauser', etc.)
    if (/^'luftrauser_[a-z0-9_]+',?$/i.test(trimmed)) {
      return true;
    }
    // Steam sprites.json internal apex chassis atlas entry lookup key
    if (/^\{\s*name:\s*'urauser',\s*size:/i.test(trimmed)) {
      return true;
    }
  }
  return false;
}

function scanTrademarkLeaksInFiles(rootDir: string): string[] {
  const leaks: string[] = [];
  for (const relPath of TRADEMARK_SCAN_FILES) {
    const fullPath = path.join(rootDir, relPath);
    if (!fs.existsSync(fullPath)) {
      leaks.push(`${relPath}: missing file`);
      continue;
    }
    const lines = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/);
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx] ?? '';
      if (isSteamBridgeCompatLine(relPath, line)) {
        continue;
      }
      for (const term of FORBIDDEN_TRADEMARK_TERMS) {
        if (term.regex.test(line)) {
          leaks.push(`${relPath}:${idx + 1} (${term.label})`);
        }
      }
    }
  }
  return leaks;
}

function scanDefaultCopyForTrademarkLeaks(): string[] {
  const leaks: string[] = [];
  const checkValue = (label: string, text: unknown): void => {
    if (typeof text !== 'string') return;
    for (const term of FORBIDDEN_TRADEMARK_TERMS) {
      if (term.regex.test(text)) {
        leaks.push(`${label} matched "${term.label}": ${JSON.stringify(text)}`);
      }
    }
  };

  const player = asObject(VANILLA_PLAYER_RAW);
  for (const cat of ['engines', 'bodyparts', 'weapons'] as const) {
    const group = asObject(player[cat]);
    for (const [key, rawEntry] of Object.entries(group)) {
      const entry = asObject(rawEntry);
      checkValue(`player.${cat}.${key}.name`, entry.name);
      checkValue(`player.${cat}.${key}.descr`, entry.descr);
    }
  }

  const globalObj = asObject(VANILLA_GLOBAL_RAW);
  const planenames = Array.isArray(globalObj.planenames)
    ? (globalObj.planenames as JsonObject[])
    : [];
  for (let i = 0; i < planenames.length; i++) {
    checkValue(`global.planenames[${i}].name`, planenames[i]?.name);
  }
  return leaks;
}

function normalizePlayerCategoryNumericById(
  categoryObj: JsonObject,
): Record<string, Record<string, unknown>> {
  const entries = Object.values(categoryObj).map((v) => asObject(canonicalizeLower(v)));
  const baseEntry = entries.find((e) => e.id === 0) ?? {};
  const byId: Record<string, Record<string, unknown>> = {};
  for (const entry of entries) {
    const id = String(entry.id ?? '');
    const merged: Record<string, unknown> = { ...baseEntry, ...entry };
    delete merged.name;
    delete merged.descr;
    byId[id] = merged;
  }
  return byId;
}

function normalizePlayerNumericParity(rawPlayer: JsonObject): Record<string, unknown> {
  const settings = asObject(canonicalizeLower(rawPlayer.settings));
  return {
    settings: {
      canshoot: settings.canshoot,
      meleedmg: settings.meleedmg,
      waterrotationforcedegrees: settings.waterrotationforcedegrees,
    },
    enginesById: normalizePlayerCategoryNumericById(asObject(rawPlayer.engines)),
    bodiesById: normalizePlayerCategoryNumericById(asObject(rawPlayer.bodyparts)),
    weaponsById: normalizePlayerCategoryNumericById(asObject(rawPlayer.weapons)),
  };
}

function normalizeGlobalNumericParity(rawGlobal: JsonObject): Record<string, unknown> {
  const planenames = Array.isArray(rawGlobal.planenames)
    ? (rawGlobal.planenames as JsonObject[]).map((p) => ({
        weapon: p.weapon,
        body: p.body,
        engine: p.engine,
      }))
    : [];
  const missions = Array.isArray(rawGlobal.missions)
    ? canonicalizeLower(rawGlobal.missions)
    : [];
  return { planenames, missions };
}

interface AuditCheckResult {
  category: string;
  name: string;
  passed: boolean;
  detail: string;
}

type JsonObject = Record<string, unknown>;

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';
}

/**
 * Independent clean-room JSONCPP parser for adversarial verification of raw Steam data.
 */
function parseRawJsonCpp<T>(raw: string): T {
  const input = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const stage1: string[] = [];
  let inString = false;
  let escaped = false;
  let prevChar = '';

  for (let i = 0; i < input.length; i++) {
    const ch = input[i] ?? '';
    const next = i + 1 < input.length ? (input[i + 1] ?? '') : '';

    if (inString) {
      stage1.push(ch);
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      prevChar = ch;
      continue;
    }

    if (ch === '"') {
      inString = true;
      stage1.push(ch);
      prevChar = ch;
      continue;
    }

    if (ch === '/' && next === '/') {
      i += 2;
      while (i < input.length && input[i] !== '\n') {
        i++;
      }
      if (i < input.length && input[i] === '\n') {
        stage1.push('\n');
        prevChar = '\n';
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
        if (input[i] === '\n') {
          stage1.push('\n');
        }
        i++;
      }
      prevChar = ' ';
      continue;
    }

    if (ch === '.' && isDigit(prevChar) && !isDigit(next)) {
      stage1.push('.0');
      prevChar = '0';
      continue;
    }

    if (ch === '.' && !isDigit(prevChar) && isDigit(next)) {
      stage1.push('0.');
      prevChar = '.';
      continue;
    }

    stage1.push(ch);
    prevChar = ch;
  }

  const joined = stage1.join('');
  const stage2: string[] = [];
  inString = false;
  escaped = false;

  for (let i = 0; i < joined.length; i++) {
    const ch = joined[i] ?? '';
    if (inString) {
      stage2.push(ch);
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
      stage2.push(ch);
      continue;
    }

    if (ch === ',') {
      let j = i + 1;
      while (j < joined.length && isWhitespace(joined[j] ?? '')) {
        j++;
      }
      const nextTok = j < joined.length ? (joined[j] ?? '') : '';
      if (nextTok === '}' || nextTok === ']') {
        continue;
      }
    }

    stage2.push(ch);
  }

  return JSON.parse(stage2.join('')) as T;
}

function asObject(val: unknown): JsonObject {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
    ? (val as JsonObject)
    : {};
}

function canonicalizeLower(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map((item) => canonicalizeLower(item));
  }
  if (val !== null && typeof val === 'object') {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(val as Record<string, unknown>).sort(([a], [b]) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    );
    for (const [k, v] of entries) {
      out[k.toLowerCase()] = canonicalizeLower(v);
    }
    return out;
  }
  if (typeof val === 'number') {
    return val === 0 ? 0 : val;
  }
  return val;
}

function diffValues(a: unknown, b: unknown, prefix = ''): string[] {
  const diffs: string[] = [];
  if (Object.is(a, b)) {
    return diffs;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) <= 1e-12) return diffs;
    diffs.push(`${prefix}: steam=${a} vs vanilla=${b}`);
    return diffs;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      diffs.push(`${prefix}.length: steam=${a.length} vs vanilla=${b.length}`);
      return diffs;
    }
    for (let i = 0; i < a.length; i++) {
      diffs.push(...diffValues(a[i], b[i], `${prefix}[${i}]`));
    }
    return diffs;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const recA = a as Record<string, unknown>;
    const recB = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(recA), ...Object.keys(recB)]);
    for (const key of [...keys].sort()) {
      const p = prefix ? `${prefix}.${key}` : key;
      if (!(key in recA)) {
        diffs.push(`${p}: missing in steam (vanilla=${JSON.stringify(recB[key])})`);
      } else if (!(key in recB)) {
        diffs.push(`${p}: missing in vanilla (steam=${JSON.stringify(recA[key])})`);
      } else {
        diffs.push(...diffValues(recA[key], recB[key], p));
      }
    }
    return diffs;
  }
  diffs.push(`${prefix}: steam=${JSON.stringify(a)} vs vanilla=${JSON.stringify(b)}`);
  return diffs;
}

function findHygieneViolations(paths: readonly string[]): string[] {
  const violations: string[] = [];
  for (const file of paths) {
    const normalized = file.replace(/\\/g, '/').toLowerCase();
    const base = normalized.slice(normalized.lastIndexOf('/') + 1);
    const hasForbiddenExt = FORBIDDEN_EXTENSIONS.some((ext) => normalized.endsWith(ext));
    const hasForbiddenName = FORBIDDEN_FILENAMES.has(base);
    const hasForbiddenPath = FORBIDDEN_PATH_PATTERN.test(normalized);
    if (hasForbiddenExt || hasForbiddenName || hasForbiddenPath) {
      violations.push(file);
    }
  }
  return violations;
}

function parsePorcelainPaths(rawOutput: string): string[] {
  const paths: string[] = [];
  for (const line of rawOutput.split(/\r?\n/)) {
    if (line.length < 4) continue;
    let payload = line.slice(3).trim();
    if (payload.includes(' -> ')) {
      const parts = payload.split(' -> ');
      for (const part of parts) {
        const cleaned = part.replace(/^"|"$/g, '');
        if (cleaned) paths.push(cleaned);
      }
      continue;
    }
    payload = payload.replace(/^"|"$/g, '');
    if (payload) paths.push(payload);
  }
  return paths;
}

function getKeyLower(obj: JsonObject, targetKey: string): unknown {
  const lower = targetKey.toLowerCase();
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function runAudit(): number {
  const checks: AuditCheckResult[] = [];
  const record = (category: string, name: string, passed: boolean, detail: string): void => {
    checks.push({ category, name, passed, detail });
  };

  // ---------------------------------------------------------------------------
  // 1. Clean-Room IP Hygiene Audit (git ls-files + git status --porcelain)
  // ---------------------------------------------------------------------------
  try {
    const trackedRaw = execFileSync('git', ['ls-files'], { encoding: 'utf8' });
    const trackedFiles = trackedRaw.split(/\r?\n/).filter(Boolean);
    const trackedViolations = findHygieneViolations(trackedFiles);
    record(
      'IP HYGIENE',
      'git ls-files clean-room scan',
      trackedViolations.length === 0,
      trackedViolations.length === 0
        ? `0 violations across ${trackedFiles.length} tracked files`
        : `${trackedViolations.length} forbidden tracked file(s): ${trackedViolations.join(', ')}`,
    );
  } catch (err) {
    record(
      'IP HYGIENE',
      'git ls-files clean-room scan',
      false,
      `git ls-files failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    const statusRaw = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
    const statusFiles = parsePorcelainPaths(statusRaw);
    const statusViolations = findHygieneViolations(statusFiles);
    record(
      'IP HYGIENE',
      'git status --porcelain clean-room scan',
      statusViolations.length === 0,
      statusViolations.length === 0
        ? `0 violations across ${statusFiles.length} working-tree entry(ies)`
        : `${statusViolations.length} forbidden working-tree file(s): ${statusViolations.join(', ')}`,
    );
  } catch (err) {
    record(
      'IP HYGIENE',
      'git status --porcelain clean-room scan',
      false,
      `git status failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 1b. Strict IP & Trademark Hygiene Scan across default data, palettes, UI & shell
  const defaultCopyLeaks = scanDefaultCopyForTrademarkLeaks();
  const skybreakerPlanes = Array.isArray(VANILLA_GLOBAL_RAW.planenames)
    ? VANILLA_GLOBAL_RAW.planenames
    : [];
  const apexName = skybreakerPlanes[125]?.name ?? '';
  const uniqueSkybreakerNames = new Set(skybreakerPlanes.map((p) => p.name.trim().toLowerCase()));
  const defaultBrandOk =
    defaultCopyLeaks.length === 0 &&
    skybreakerPlanes.length === 126 &&
    apexName === 'APEX OMEGA' &&
    uniqueSkybreakerNames.size === 126;
  record(
    'IP HYGIENE',
    'Skybreaker defaults copy & callsigns scan',
    defaultBrandOk,
    defaultBrandOk
      ? `0 leaks across player parts & 126 unique callsigns ([5,5,5]=${apexName})`
      : defaultCopyLeaks.length > 0
        ? `${defaultCopyLeaks.length} leak(s): ${defaultCopyLeaks.slice(0, 3).join('; ')}`
        : `planenames=${skybreakerPlanes.length}, unique=${uniqueSkybreakerNames.size}, [5,5,5]=${apexName}`,
  );

  const fileTrademarkLeaks = scanTrademarkLeaksInFiles(process.cwd());
  record(
    'IP HYGIENE',
    'Source/UI/shell trademark scan (6 files)',
    fileTrademarkLeaks.length === 0,
    fileTrademarkLeaks.length === 0
      ? `0 leaks across ${TRADEMARK_SCAN_FILES.length} guarded files`
      : `${fileTrademarkLeaks.length} leak(s): ${fileTrademarkLeaks.slice(0, 4).join(', ')}`,
  );

  // ---------------------------------------------------------------------------
  // 2. Live Steam Data Verification (strictly read-only)
  // ---------------------------------------------------------------------------
  const steamDir =
    process.env.SKYBREAKER_STEAM_DIR?.trim() ||
    process.env.LUFTRAUSERS_STEAM_DIR?.trim() ||
    DEFAULT_STEAM_DATA_DIR;
  const steamAvailable = fs.existsSync(steamDir) && fs.statSync(steamDir).isDirectory();
  record(
    'STEAM VAULT',
    'Local Steam data directory reachable',
    steamAvailable,
    steamAvailable ? steamDir : `Directory not found: ${steamDir}`,
  );

  if (steamAvailable) {
    const readSteamJson = <T>(relPath: string): T => {
      const fullPath = path.join(steamDir, relPath);
      const text = fs.readFileSync(fullPath, 'utf8');
      return parseRawJsonCpp<T>(text);
    };

    try {
      // 2a. player.json (6 Engines, 6 Bodies, 6 Weapons + invariants)
      const playerRaw = asObject(readSteamJson<JsonObject>('res/player.json'));
      const enginesObj = asObject(playerRaw.engines);
      const bodiesObj = asObject(playerRaw.bodyparts);
      const weaponsObj = asObject(playerRaw.weapons);
      const engineKeys = Object.keys(enginesObj);
      const bodyKeys = Object.keys(bodiesObj);
      const weaponKeys = Object.keys(weaponsObj);

      const origEngine = asObject(enginesObj.original);
      const superboostEngine = asObject(enginesObj.superboost);
      const gungineEngine = asObject(enginesObj.gungine);
      const underwaterEngine = asObject(enginesObj.underwater);
      const hoverEngine = asObject(enginesObj.hover);
      const unkBody = asObject(bodiesObj['???']);
      const meleeBody = asObject(bodiesObj.melee);
      const nukeBody = asObject(bodiesObj.nuke);
      const bombBody = asObject(bodiesObj.bomb);
      const spreadWeapon = asObject(weaponsObj.spread);
      const missilesWeapon = asObject(weaponsObj.missiles);
      const cannonWeapon = asObject(weaponsObj.cannon);

      const playerInvariantsOk =
        engineKeys.length === 6 &&
        bodyKeys.length === 6 &&
        weaponKeys.length === 6 &&
        origEngine.turnspeed === 10 &&
        origEngine.turnspeedboost === 4 &&
        superboostEngine.turnspeedboost === 1 &&
        superboostEngine.maximumspeed === 11 &&
        superboostEngine.boostadd === 2 &&
        gungineEngine.acceleration === 5.5 &&
        gungineEngine.flags === 'gun-engine' &&
        underwaterEngine.waterproof === true &&
        underwaterEngine.spacedmg === 0.6 &&
        hoverEngine.gravity === 0.02 &&
        meleeBody.maxhealth === 11 &&
        meleeBody.impactrecvdmgmult === 0 &&
        meleeBody.impactsleeptime === 0 &&
        nukeBody.impactdmgmult === 0.25 &&
        nukeBody.flags === 'nuke-on-death' &&
        bombBody.healingspd === 0.12 &&
        bombBody.flags === 'body-drop-bomb' &&
        unkBody.maxhealth === 120 &&
        unkBody.healingspd === 0.01 &&
        spreadWeapon.recoil === 1.5 &&
        spreadWeapon.numbullets === 5 &&
        missilesWeapon.maxbullets === 4 &&
        cannonWeapon.interval === 79;

      record(
        'STEAM RES',
        'player.json parts & invariants (6E / 6B / 6W)',
        playerInvariantsOk,
        `engines=${engineKeys.length}, bodies=${bodyKeys.length}, weapons=${weaponKeys.length}`,
      );

      const playerDiffs = diffValues(
        normalizePlayerNumericParity(playerRaw),
        normalizePlayerNumericParity(VANILLA_PLAYER_RAW as unknown as JsonObject),
        'player',
      );
      record(
        'FALLBACK PARITY',
        'player.json physics/tuning vs defaults',
        playerDiffs.length === 0,
        playerDiffs.length === 0
          ? '0 numeric/tuning diffs (original Skybreaker names/copy skipped)'
          : `${playerDiffs.length} diff(s): ${playerDiffs.slice(0, 3).join('; ')}`,
      );

      // 2b. global.json (126 PlaneNames + 90 Missions)
      const globalRaw = asObject(readSteamJson<JsonObject>('res/global.json'));
      const planenames = Array.isArray(globalRaw.planenames)
        ? (globalRaw.planenames as JsonObject[])
        : [];
      const missions = Array.isArray(globalRaw.missions)
        ? (globalRaw.missions as JsonObject[])
        : [];
      const lastPlane = planenames[125];
      const uniqueStandardCombos = new Set<string>();
      for (const p of planenames.slice(0, 125)) {
        uniqueStandardCombos.add(`${p.weapon}:${p.body}:${p.engine}`);
      }
      const globalCountsOk =
        planenames.length === 126 &&
        uniqueStandardCombos.size === 125 &&
        planenames[0]?.name === 'original' &&
        lastPlane?.name === 'URAUSER' &&
        lastPlane?.weapon === 5 &&
        lastPlane?.body === 5 &&
        lastPlane?.engine === 5 &&
        missions.length === 90;

      record(
        'STEAM RES',
        'global.json planenames (126) & missions (90)',
        globalCountsOk,
        `planenames=${planenames.length} (125 unique + ${String(lastPlane?.name ?? 'missing')}), missions=${missions.length}`,
      );

      const globalDiffs = diffValues(
        normalizeGlobalNumericParity(globalRaw),
        normalizeGlobalNumericParity(VANILLA_GLOBAL_RAW as unknown as JsonObject),
        'global',
      );
      record(
        'FALLBACK PARITY',
        'global.json slots/missions vs defaults',
        globalDiffs.length === 0,
        globalDiffs.length === 0
          ? '0 slot/mission diffs (126 loadouts + 90 missions; Skybreaker callsigns original)'
          : `${globalDiffs.length} diff(s): ${globalDiffs.slice(0, 3).join('; ')}`,
      );

      // 2c. enemies.json (12) + enemies_sfmt.json (12)
      const enemiesRaw = asObject(readSteamJson<JsonObject>('res/enemies.json'));
      const enemiesSfmtRaw = asObject(readSteamJson<JsonObject>('res/enemies_sfmt.json'));
      const normCount = Object.keys(enemiesRaw).length;
      const sfmtCount = Object.keys(enemiesSfmtRaw).length;
      const normJet = asObject(enemiesRaw.jet);
      const sfmtJet = asObject(enemiesSfmtRaw.jet);
      const normBigBoat = asObject(enemiesRaw.bigboat);
      const sfmtBigBoat = asObject(enemiesSfmtRaw.bigboat);
      const enemiesOk =
        normCount === 12 &&
        sfmtCount === 12 &&
        getKeyLower(normJet, 'fireinterval') === 999999999999 &&
        getKeyLower(sfmtJet, 'fireinterval') === 5 &&
        getKeyLower(normBigBoat, 'bulletspersalvo') === 18 &&
        getKeyLower(sfmtBigBoat, 'bulletspersalvo') === 36 &&
        getKeyLower(sfmtBigBoat, 'bulletfireinterval') === 1;

      record(
        'STEAM RES',
        'enemies.json (12) & enemies_sfmt.json (12)',
        enemiesOk,
        `normal=${normCount}, sfmt=${sfmtCount}, jetFire=${String(getKeyLower(normJet, 'fireinterval'))}/${String(getKeyLower(sfmtJet, 'fireinterval'))}, bigBoatSalvo=${String(getKeyLower(normBigBoat, 'bulletspersalvo'))}/${String(getKeyLower(sfmtBigBoat, 'bulletspersalvo'))}`,
      );

      const enemiesDiffs = [
        ...diffValues(
          canonicalizeLower(enemiesRaw),
          canonicalizeLower(VANILLA_ENEMIES_RAW),
          'enemies',
        ),
        ...diffValues(
          canonicalizeLower(enemiesSfmtRaw),
          canonicalizeLower(VANILLA_ENEMIES_SFMT_RAW),
          'enemiesSfmt',
        ),
      ];
      record(
        'FALLBACK PARITY',
        'enemies (Normal+SFMT) vs vanilla-defaults.ts',
        enemiesDiffs.length === 0,
        enemiesDiffs.length === 0
          ? '0 field diffs'
          : `${enemiesDiffs.length} diff(s): ${enemiesDiffs.slice(0, 3).join('; ')}`,
      );

      // 2d. projectiles.json (6)
      const projRaw = asObject(readSteamJson<JsonObject>('res/projectiles.json'));
      const projKeys = Object.keys(projRaw).sort();
      const expectedProjKeys = [
        'bullet',
        'ebullet',
        'laser',
        'missile',
        'plasmaball',
        'spreadbullet',
      ];
      const projOk =
        projKeys.length === 6 &&
        expectedProjKeys.every((k, idx) => projKeys[idx] === k);

      record(
        'STEAM RES',
        'projectiles.json (6 projectiles)',
        projOk,
        `count=${projKeys.length} [${projKeys.join(', ')}]`,
      );

      const normalizeProjTrim = (obj: JsonObject): Record<string, unknown> => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj)) {
          const rec = asObject(v);
          out[k.toLowerCase()] = {
            ttl: rec.ttl,
            dmg: rec.dmg,
            speed: rec.speed,
            degreesoffset: rec.degreesoffset,
            sfxfire: typeof rec.sfxfire === 'string' ? rec.sfxfire.trim() : '',
            flags: typeof rec.flags === 'string' ? rec.flags.trim() : '',
          };
        }
        return out;
      };
      const projDiffs = diffValues(
        normalizeProjTrim(projRaw),
        normalizeProjTrim(VANILLA_PROJECTILES_RAW as unknown as JsonObject),
        'projectiles',
      );
      record(
        'FALLBACK PARITY',
        'projectiles.json vs vanilla-defaults.ts',
        projDiffs.length === 0,
        projDiffs.length === 0
          ? '0 field diffs'
          : `${projDiffs.length} diff(s): ${projDiffs.slice(0, 3).join('; ')}`,
      );

      // 2e. spawncoordinator.json + spawncoordinator_sfmt.json
      const spawnRaw = asObject(readSteamJson<JsonObject>('res/spawncoordinator.json'));
      const spawnSfmtRaw = asObject(readSteamJson<JsonObject>('res/spawncoordinator_sfmt.json'));
      const normSteps = Array.isArray(spawnRaw.increaseDifficulty)
        ? (spawnRaw.increaseDifficulty as JsonObject[])
        : [];
      const sfmtSteps = Array.isArray(spawnSfmtRaw.increaseDifficulty)
        ? (spawnSfmtRaw.increaseDifficulty as JsonObject[])
        : [];
      const normTiers = Array.isArray(spawnRaw.spawnlist) ? spawnRaw.spawnlist : [];
      const sfmtTiers = Array.isArray(spawnSfmtRaw.spawnlist) ? spawnSfmtRaw.spawnlist : [];
      const hasSfmtBurst = sfmtSteps.some((s) => s.add === 50 && s.max === 700);
      const spawnOk =
        spawnRaw.initialDifficulty === 60 &&
        spawnSfmtRaw.initialDifficulty === 60 &&
        normSteps.length === 3 &&
        sfmtSteps.length === 4 &&
        hasSfmtBurst &&
        normTiers.length === 7 &&
        sfmtTiers.length === 7;

      record(
        'STEAM RES',
        'spawncoordinator Normal & SFMT',
        spawnOk,
        `initialDiff=${String(spawnRaw.initialDifficulty)}, steps=${normSteps.length}/${sfmtSteps.length} (SFMT +50@700=${hasSfmtBurst}), tiers=${normTiers.length}/${sfmtTiers.length}`,
      );

      const spawnDiffs = [
        ...diffValues(
          canonicalizeLower(spawnRaw),
          canonicalizeLower(VANILLA_SPAWN_COORDINATOR_RAW),
          'spawnCoordinator',
        ),
        ...diffValues(
          canonicalizeLower(spawnSfmtRaw),
          canonicalizeLower(VANILLA_SPAWN_COORDINATOR_SFMT_RAW),
          'spawnCoordinatorSfmt',
        ),
      ];
      record(
        'FALLBACK PARITY',
        'spawncoordinator (Normal+SFMT) vs vanilla-defaults.ts',
        spawnDiffs.length === 0,
        spawnDiffs.length === 0
          ? '0 field diffs'
          : `${spawnDiffs.length} diff(s): ${spawnDiffs.slice(0, 3).join('; ')}`,
      );

      // 2f. room.json + fxparticle.json + parallax.json
      const roomRaw = asObject(readSteamJson<JsonObject>('res/room.json'));
      const roomSettings = asObject(roomRaw.settings);
      const roomOk = roomSettings.sealevel === 0 && roomSettings.spacelevel === -1300;
      record(
        'STEAM RES',
        'room.json bounds (sealevel=0, spacelevel=-1300)',
        roomOk,
        `sealevel=${String(roomSettings.sealevel)}, spacelevel=${String(roomSettings.spacelevel)}`,
      );

      const fxRaw = asObject(readSteamJson<JsonObject>('res/fxparticle.json'));
      const parallaxRaw = asObject(readSteamJson<JsonObject>('res/parallax.json'));
      const auxDiffs = [
        ...diffValues(canonicalizeLower(roomRaw), canonicalizeLower(VANILLA_ROOM_RAW), 'room'),
        ...diffValues(canonicalizeLower(fxRaw), canonicalizeLower(VANILLA_FX_RAW), 'fx'),
        ...diffValues(
          canonicalizeLower(parallaxRaw),
          canonicalizeLower(VANILLA_PARALLAX_RAW),
          'parallax',
        ),
      ];
      record(
        'FALLBACK PARITY',
        'room / fxparticle / parallax vs vanilla-defaults.ts',
        auxDiffs.length === 0,
        auxDiffs.length === 0
          ? `0 diffs (generic=${Object.keys(asObject(fxRaw.generic)).length}, explosions=${Object.keys(asObject(fxRaw.explosions)).length}, parallaxStages=${Array.isArray(parallaxRaw.stages) ? parallaxRaw.stages.length : 0})`
          : `${auxDiffs.length} diff(s): ${auxDiffs.slice(0, 3).join('; ')}`,
      );

      // 2g. BGM OGGs (20) & SFX WAVs (52)
      const bgmFiles = fs
        .readdirSync(path.join(steamDir, 'bgm'))
        .filter((f) => f.toLowerCase().endsWith('.ogg'))
        .map((f) => f.replace(/\.ogg$/i, ''))
        .sort();
      const sfxFiles = fs
        .readdirSync(path.join(steamDir, 'sfx'))
        .filter((f) => f.toLowerCase().endsWith('.wav'))
        .map((f) => f.replace(/\.wav$/i, ''))
        .sort();
      const expectedBgm = [...VANILLA_BGM_STEMS].sort();
      const expectedSfx = [...VANILLA_SFX_CUES].sort();

      const bgmMatch =
        bgmFiles.length === 20 &&
        bgmFiles.every((stem, idx) => stem === expectedBgm[idx]);
      record(
        'STEAM AUDIO',
        'BGM OGG stem inventory (20 stems)',
        bgmMatch,
        `found=${bgmFiles.length}/20, exactManifestMatch=${bgmMatch}`,
      );

      const sfxMatch =
        sfxFiles.length === 52 &&
        sfxFiles.every((cue, idx) => cue === expectedSfx[idx]);
      record(
        'STEAM AUDIO',
        'SFX WAV cue inventory (52 cues)',
        sfxMatch,
        `found=${sfxFiles.length}/52, exactManifestMatch=${sfxMatch}`,
      );

      // 2h. Texture & Font binary header sanity (sheet1grey.png TGA 2048x1024 + 5 .fnt)
      const sheet1Path = path.join(steamDir, 'gfx/textures/diffuse/sheet1grey.png');
      const sheet1Buf = fs.readFileSync(sheet1Path);
      const tgaType = sheet1Buf[2] ?? 0;
      const tgaW = sheet1Buf.readUInt16LE(12);
      const tgaH = sheet1Buf.readUInt16LE(14);
      const tgaBpp = sheet1Buf[16] ?? 0;
      const tgaOk = tgaType === 2 && tgaBpp === 32 && tgaW === 2048 && tgaH === 1024;
      record(
        'STEAM GFX',
        'sheet1grey.png 32-bit TGA (2048x1024)',
        tgaOk,
        `type=${tgaType}, bpp=${tgaBpp}, dims=${tgaW}x${tgaH}, bytes=${sheet1Buf.length}`,
      );

      const fontFiles = fs
        .readdirSync(path.join(steamDir, 'gfx/fonts'))
        .filter((f) => f.toLowerCase().endsWith('.fnt'))
        .sort();
      const fontsOk = fontFiles.length === 5;
      record(
        'STEAM GFX',
        'AngelCode bitmap font metrics (5 .fnt)',
        fontsOk,
        `found=${fontFiles.length} [${fontFiles.join(', ')}]`,
      );
    } catch (err) {
      record(
        'STEAM RES',
        'Steam JSON/asset ingestion',
        false,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Render Crisp Structured Parity Scorecard
  // ---------------------------------------------------------------------------
  const passCount = checks.filter((c) => c.passed).length;
  const failCount = checks.length - passCount;

  const line = '='.repeat(86);
  const divider = '-'.repeat(86);
  console.log(line);
  console.log(' KRUNKED SKYBREAKER — PARITY & CLEAN-ROOM IP AUDIT SCORECARD');
  console.log(line);
  console.log(
    `${'STATUS'.padEnd(8)} ${'CATEGORY'.padEnd(17)} ${'CHECK'.padEnd(44)} DETAIL`,
  );
  console.log(divider);

  for (const check of checks) {
    const status = check.passed ? '[PASS]' : '[FAIL]';
    console.log(
      `${status.padEnd(8)} ${check.category.padEnd(17)} ${check.name.padEnd(44)} ${check.detail}`,
    );
  }

  console.log(divider);
  console.log(
    ` SUMMARY: ${passCount}/${checks.length} PASSED, ${failCount} FAILED | VERDICT: ${failCount === 0 ? '1:1 PARITY VERIFIED (CLEAN-ROOM PASS)' : 'AUDIT FAILED'}`,
  );
  console.log(line);

  return failCount === 0 ? 0 : 1;
}

process.exitCode = runAudit();
