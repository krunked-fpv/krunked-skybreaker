import type {
  AudioAssetManifest,
  BitmapFontSpec,
  DecodedTexture,
  GameDataBundle,
  SpriteAtlasSpec,
  SpriteEntry,
  VaultAssetBundle,
} from '../contracts/vault';
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
  BODY_ARMOR_TOP,
  BODY_BOMB_TOP,
  BODY_MELEE_TOP,
  BODY_NUKE_TOP,
  BODY_STANDARD_TOP,
  ENGINE_GUNGINE_TOP,
  ENGINE_HOVER_TOP,
  ENGINE_STANDARD_TOP,
  ENGINE_SUPERBOOST_TOP,
  ENGINE_UNDERWATER_TOP,
  SpritePainter,
  WINGS_CANNON_TOP,
  WINGS_LASER_TOP,
  WINGS_MISSILES_TOP,
  WINGS_SPREAD_TOP,
  WINGS_STANDARD_TOP,
  drawUnderwaterPropeller,
} from './painter';
import { createProceduralFontSpec, createProceduralFontTexture } from './procedural-fonts';
import { createProceduralMenuTexture } from './procedural-menu';
import {
  VANILLA_BGM_STEMS,
  VANILLA_ENEMIES_RAW,
  VANILLA_ENEMIES_SFMT_RAW,
  VANILLA_FX_RAW,
  VANILLA_GLOBAL_RAW,
  VANILLA_MENU_SPRITES_RAW,
  VANILLA_NUKE_SPRITES_RAW,
  VANILLA_PARALLAX_RAW,
  VANILLA_PLAYER_RAW,
  VANILLA_PROJECTILES_RAW,
  VANILLA_ROOM_RAW,
  VANILLA_SFX_CUES,
  VANILLA_SPAWN_COORDINATOR_RAW,
  VANILLA_SPAWN_COORDINATOR_SFMT_RAW,
  VANILLA_SPRITES_RAW,
} from './vanilla-defaults';

export { createProceduralFontTexture, createProceduralMenuTexture };

// ============================================================================
// Handcrafted Clean-Room Enemy Small Aircraft & Ordnance Silhouettes
// Pure graphic-novel silhouettes adhering to authentic palette indices:
//   1 = player & player ordnance
//   2 = enemy craft, ships, subs, blimps, guns & enemy projectile rims
//   3 = gritty dark smoke (`fx_smoke`, `fx_smokelong`)
//   4 = distant horizon background silhouettes (`bg_*`)
//   5 = sky-cutout aura around player bullets & muzzle flashes
//   6 = midground `parallax_clouds`, `bg_jet_trail`, `space_clouds` f2
//   7 = foreground `clouds`, `ocean_line`, `space_clouds` f0, splashes, boosts, blasts
// ============================================================================

// Enemy Fighter (20x20, 10 top rows mirrored vertically -> pure bold silhouette in 2)
const ENEMY_FIGHTER_BODY_TOP: readonly string[] = [
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '..22................',
  '..222222............',
  '....2222222222......',
  '...22222222222222...',
];

const ENEMY_FIGHTER_WINGS_TOP: readonly string[] = [
  '........22..........',
  '.......2222.........',
  '.......2222.........',
  '.......22222........',
  '.......22222........',
  '.......22222........',
  '.......22222........',
  '.......22222........',
  '....................',
  '....................',
];

// Enemy Supersonic Jet (20x20, 10 top rows mirrored vertically -> razor-sleek delta in 2)
const ENEMY_JET_BODY_TOP: readonly string[] = [
  '....................',
  '....................',
  '....................',
  '....................',
  '.22.................',
  '.222................',
  '..2222..............',
  '..222222222.........',
  '.22222222222222.....',
  '22222222222222222222',
];

const ENEMY_JET_WINGS_TOP: readonly string[] = [
  '......22............',
  '......222...........',
  '.......222..........',
  '.......2222.........',
  '.......22222........',
  '........22222.......',
  '........222222......',
  '........222222......',
  '....................',
  '....................',
];

const ENEMY_JET_BODY_CRASH: readonly string[] = [
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '..22................',
  '...222..222.........',
  '.222222.222222......',
  '222222222222222222..',
  '..222222.22222222...',
  '....2222..2222......',
  '..222...............',
  '.22.................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
];

const ENEMY_JET_WINGS_CRASH: readonly string[] = [
  '....................',
  '....................',
  '....................',
  '.......22...........',
  '.......222..........',
  '........2222........',
  '........22222.......',
  '........22222.......',
  '....................',
  '....................',
  '....................',
  '....................',
  '........22222.......',
  '.......22222........',
  '.......222..........',
  '......222...........',
  '.....22.............',
  '....................',
  '....................',
  '....................',
];

// Enemy Finned Torpedo Missile (24x10, 5 top rows mirrored vertically -> pure 2)
const ENEMY_MISSILE_TOP: readonly string[] = [
  '222.....................',
  '.2222...................',
  '..22222.................',
  '.22222222222222222222...',
  '222222222222222222222222',
];

// Player Homing Micro-Rocket (10x7, 3 top rows + center -> pure 1)
const PROJ_HOMING_TOP: readonly string[] = [
  '11........',
  '.111111...',
  '11111111..',
];
const PROJ_HOMING_MID = '1111111111';

// Player Drop Bomb (10x4, 2 top rows mirrored -> pure 1)
const PROJ_BOMB_TOP: readonly string[] = [
  '11..1111..',
  '.111111111',
];

// ============================================================================
// Procedural Sprite Compositors
// ============================================================================

function resolveSpritePaletteIndex(spriteName: string): number {
  const n = spriteName.toLowerCase();
  if (
    n === 'urauser' ||
    n.startsWith('engine_') ||
    n.startsWith('body_') ||
    n.startsWith('wings_') ||
    n === 'projectile_homing_missile' ||
    n === 'projectile_bomb' ||
    n === 'fx_player_hit'
  ) {
    return 1;
  }
  if (
    n.startsWith('fighter_') ||
    n.startsWith('jet_') ||
    n.startsWith('ace_') ||
    n.startsWith('laserace_') ||
    n.startsWith('acemarine') ||
    n.startsWith('submarine') ||
    n.startsWith('big_boat') ||
    n.startsWith('small_boat') ||
    n.startsWith('blimp') ||
    n === 'missile' ||
    n === 'projectile_ebullet' ||
    n === 'projectile_elaser' ||
    n === 'projectile_artillery_bullet' ||
    n === 'fx_planepart'
  ) {
    return 2;
  }
  if (n.startsWith('fx_smoke')) {
    return 3;
  }
  if (n === 'bg_jet_trail' || n === 'parallax_clouds') {
    return 6;
  }
  if (n.startsWith('bg_')) {
    return 4;
  }
  if (
    n.startsWith('projectile_') ||
    n.includes('flash') ||
    n.includes('fade')
  ) {
    return 5;
  }
  return 7;
}

/**
 * Clean-room APEX OMEGA super-craft (416x300, bold flying-wing dreadnought silhouette in 1).
 */
function drawApexOmega(p: SpritePainter): void {
  const w = p.w;
  const h = p.h;
  const cy = h * 0.5;

  // Massive twin-sweep flying-wing outer delta plates
  p.tri(w * 0.72, cy - 22, w * 0.14, h * 0.05, w * 0.34, cy - 14, 1);
  p.tri(w * 0.72, cy + 22, w * 0.14, h * 0.95, w * 0.34, cy + 14, 1);
  // Secondary heavy mid-wing armored root extensions
  p.quad(w * 0.18, h * 0.16, w * 0.6, cy - 20, w * 0.6, cy + 20, w * 0.18, h * 0.84, 1);
  // Forward predator canards
  p.tri(w * 0.88, cy - 12, w * 0.66, cy - 58, w * 0.7, cy - 10, 1);
  p.tri(w * 0.88, cy + 12, w * 0.66, cy + 58, w * 0.7, cy + 10, 1);
  // Wingtip heavy lance pods
  p.rect(w * 0.12, h * 0.04, w * 0.28, 12, 1);
  p.rect(w * 0.12, h * 0.96 - 12, w * 0.28, 12, 1);
  // Triple rear afterburner cowlings
  for (const offsetY of [-46, 0, 46]) {
    p.rect(w * 0.04, cy + offsetY - 14, w * 0.16, 28, 1);
  }
  // Armored dreadnought fuselage spine & spear prow
  p.ellipse(w * 0.48, cy, w * 0.38, h * 0.14, 1);
  p.tri(w * 0.98, cy, w * 0.68, cy - 30, w * 0.68, cy + 30, 1);
  // Clean crisp negative-space aerodynamic intake slits & cockpit notch (authentic silhouette cut)
  p.rect(w * 0.24, cy - 64, w * 0.18, 6, 0);
  p.rect(w * 0.24, cy + 58, w * 0.18, 6, 0);
  p.tri(w * 0.06, cy - 28, w * 0.16, cy - 28, w * 0.16, cy - 18, 0);
  p.tri(w * 0.06, cy + 28, w * 0.16, cy + 28, w * 0.16, cy + 18, 0);
}

/**
 * Clean-room Enemy Ace & LaserAce bodies (45x45, bold pure silhouette in index 2).
 */
function drawAceBody(p: SpritePainter, isLaser: boolean): void {
  const cy = Math.floor(p.h / 2); // 22
  // Twin rear thruster nacelles
  p.rect(3, cy - 8, 11, 5, 2);
  p.rect(3, cy + 4, 11, 5, 2);
  // Swept vertical twin tail fins
  p.tri(14, cy - 5, 4, cy - 11, 8, cy - 4, 2);
  p.tri(14, cy + 5, 4, cy + 11, 8, cy + 4, 2);

  if (isLaser) {
    // Sleek futuristic split-rail emitter fuselage (unmistakable twin forward prongs)
    p.quad(8, cy - 6, 26, cy - 7, 30, cy - 3, 8, cy + 6, 2);
    p.quad(8, cy + 6, 26, cy + 7, 30, cy + 3, 8, cy - 6, 2);
    p.rect(24, cy - 7, 15, 4, 2);
    p.rect(24, cy + 4, 15, 4, 2);
    // Crisp negative-space emitter channel between prongs
    p.rect(28, cy - 2, 12, 5, 0);
    // Emitter focus ring
    p.circle(26, cy, 3, 2);
  } else {
    // Heavy predator interceptor fuselage with twin armored nose cannons
    p.quad(8, cy - 6, 30, cy - 6, 44, cy, 8, cy + 6, 2);
    p.quad(8, cy + 6, 30, cy + 6, 44, cy, 8, cy - 6, 2);
    p.rect(31, cy - 5, 11, 2, 2);
    p.rect(31, cy + 4, 11, 2, 2);
  }
}

/**
 * Clean-room Enemy Ace & LaserAce wings (45x45, full-span bold silhouettes in index 2).
 */
function drawAceWings(p: SpritePainter, isLaser: boolean): void {
  const cy = Math.floor(p.h / 2); // 22
  if (isLaser) {
    // Dramatic forward-swept angular delta blades with outer rail-capacitor pods
    p.quad(20, cy - 6, 29, cy - 6, 39, 2, 28, 2, 2);
    p.quad(20, cy + 6, 29, cy + 6, 39, 42, 28, 42, 2);
    p.rect(26, 2, 14, 3, 2);
    p.rect(26, 40, 14, 3, 2);
  } else {
    // Broad swept-back elite warbird wings + forward interceptor canards + underwing gun pods
    p.quad(21, cy - 6, 33, cy - 6, 26, 0, 19, 0, 2);
    p.quad(21, cy + 6, 33, cy + 6, 26, 44, 19, 44, 2);
    p.tri(37, cy - 6, 29, cy - 13, 31, cy - 6, 2);
    p.tri(37, cy + 6, 29, cy + 13, 31, cy + 6, 2);
    p.rect(22, cy - 14, 14, 3, 2);
    p.rect(22, cy + 12, 14, 3, 2);
  }
}

/**
 * Clean-room Naval Gunboat (60x17, crisp authentic silhouette in index 2, flush on waterline).
 */
function drawSmallBoat(p: SpritePainter, sinking: boolean): void {
  const w = p.w;
  const h = p.h;
  // Raked patrol-boat / corvette hull sitting flush on waterline
  p.quad(3, h - 1, w - 3, h - 1, w - 1, h - 7, 1, h - 6, 2);
  // Foredeck turret plinth
  p.rect(w - 20, h - 10, 9, 4, 2);
  // Stepped armored bridge & funnel
  p.rect(18, h - 12, 18, 6, 2);
  p.rect(22, h - 15, 10, 4, 2);
  p.quad(13, h - 7, 18, h - 7, 17, h - 11, 12, h - 11, 2);
  // Crisp radio mast & crossbar
  p.vline(27, 1, h - 15, 2);
  p.hline(24, 30, 3, 2);

  if (sinking) {
    // Jagged hull split down the middle
    p.tri(26, h - 15, 32, h - 1, 39, h - 15, 0);
    p.tri(14, h - 11, 18, h - 4, 21, h - 11, 0);
  }
}

/**
 * Clean-room Dreadnought Battleship (300x50 / 300x51, monumental silhouette in index 2).
 */
function drawBigBoat(p: SpritePainter, sinking: boolean): void {
  const w = p.w;
  const h = p.h;
  // Massive raked steel cruiser/battleship hull
  p.quad(6, h - 1, w - 10, h - 1, w - 1, h - 18, 2, h - 15, 2);
  // Raised forecastle bow deck
  p.quad(w - 86, h - 18, w - 1, h - 18, w - 3, h - 22, w - 82, h - 21, 2);

  // Fore & aft dual armored main turret barbettes
  p.rect(42, h - 25, 34, 10, 2);
  p.rect(48, h - 29, 22, 5, 2);
  p.rect(210, h - 26, 36, 10, 2);
  p.rect(216, h - 30, 22, 5, 2);
  // Secondary super-firing turrets
  p.rect(82, h - 28, 22, 12, 2);
  p.rect(186, h - 28, 22, 12, 2);

  // Towering terraced pagoda citadel superstructure
  p.rect(100, h - 31, 90, 16, 2);
  p.rect(112, h - 38, 66, 9, 2);
  p.rect(126, h - 44, 36, 7, 2);

  // Twin thick raked armored smokestacks
  p.quad(116, h - 36, 128, h - 36, 124, h - 48, 112, h - 48, 2);
  p.quad(162, h - 36, 174, h - 36, 170, h - 48, 158, h - 48, 2);

  // Tall tripod lattice radar mast & rangefinder arms
  p.vline(144, 1, h - 44, 2);
  p.vline(147, 4, h - 44, 2);
  p.hline(133, 158, 6, 2);
  p.hline(137, 154, 11, 2);
  // Aft spotting crane
  p.line(34, h - 16, 22, h - 28, 2, 2);
  p.line(22, h - 28, 16, h - 23, 2, 1);

  if (sinking) {
    // Catastrophic keel break & sheared bridge
    p.tri(132, h - 48, 154, h - 1, 182, h - 48, 0);
    p.tri(74, h - 28, 86, h - 8, 98, h - 28, 0);
    p.tri(210, h - 30, 224, h - 10, 236, h - 30, 0);
  }
}

/**
 * Clean-room Attack Submarine (198x36) & Submersible Carrier AceMarine (240x36) in pure index 2.
 */
function drawSubmarine(p: SpritePainter, isCarrier: boolean, sinking: boolean): void {
  const w = p.w;
  const h = p.h;
  // Low streamlined pressure hull resting flush on ocean surface
  p.ellipse(w * 0.5, h - 6, w * 0.48, 11, 2);
  p.rect(w * 0.06, h - 13, w * 0.86, 13, 2);
  // Aft hydroplane rudder fin
  p.tri(4, h - 8, 18, h - 20, 25, h - 10, 2);

  if (isCarrier) {
    // Submersible aircraft carrier: sleek ski-jump catapult deck + offset island tower
    p.quad(w * 0.48, h - 14, w - 10, h - 23, w - 6, h - 12, w * 0.46, h - 10, 2);
    p.rect(w * 0.24, h - 30, 44, 18, 2);
    p.rect(w * 0.28, h - 33, 30, 4, 2);
    // Twin radar masts & launch control crane
    p.vline(w * 0.31, 0, h - 33, 2);
    p.hline(w * 0.28, w * 0.34, 3, 2);
    p.vline(w * 0.38, 2, h - 33, 2);
    p.hline(w * 0.36, w * 0.41, 5, 2);
    // Tiny silhouette of parked interceptor on ramp
    p.rect(w * 0.66, h - 22, 12, 3, 2);
    p.vline(w * 0.7, h - 25, h - 19, 2);
  } else {
    // Classic attack submarine: sculpted conning tower sail + periscope + VLS hatches
    const sailX = Math.floor(w * 0.39);
    p.quad(sailX, h - 12, sailX + 38, h - 12, sailX + 31, h - 28, sailX + 6, h - 28, 2);
    // Periscope & snorkel mast
    p.vline(sailX + 14, 1, h - 28, 2);
    p.hline(sailX + 14, sailX + 19, 1, 2);
    p.vline(sailX + 23, 5, h - 28, 2);
    // Foredeck missile hatches & deck gun
    p.rect(sailX + 46, h - 16, 10, 4, 2);
    p.rect(sailX + 60, h - 16, 10, 4, 2);
    p.rect(sailX + 74, h - 16, 10, 4, 2);
  }

  if (sinking) {
    // Torn pressure hull breach
    p.circle(w * 0.58, h - 14, 14, 0);
    p.tri(w * 0.34, h - 28, w * 0.44, h - 10, w * 0.52, h - 28, 0);
  }
}

/**
 * Clean-room Sky-Dreadnought Dirigible Blimp (550x219, iconic pure silhouette in index 2).
 */
function drawBlimp(p: SpritePainter, dying: boolean): void {
  const w = p.w;
  const h = p.h;
  const cx = w * 0.53;
  const cy = h * 0.43;
  const rx = w * 0.45;
  const ry = h * 0.35;

  // Massive dorsal & ventral cruciform tailfins with aerodynamic sweep
  p.quad(20, 6, 138, 12, 166, cy - 26, 36, cy - 16, 2);
  p.quad(20, h - 24, 138, h - 30, 166, cy + 26, 36, cy + 16, 2);
  // Rear horizontal stabilizer & propeller housing boss
  p.quad(8, cy - 10, 124, cy - 14, 124, cy + 14, 8, cy + 10, 2);

  // Monumental rigid zeppelin envelope
  p.ellipse(cx, cy, rx, ry, 2);
  // Subtle stepped nose cone & mooring spike
  p.tri(w - 2, cy, w - 34, cy - 18, w - 34, cy + 18, 2);
  p.rect(w - 18, cy - 2, 17, 4, 2);

  // Underslung armored battle gondola + rigging struts with crisp negative-space windows
  const gx = Math.floor(w * 0.32);
  const gw = Math.floor(w * 0.38);
  const gy = Math.floor(h * 0.77);
  const gh = Math.floor(h * 0.19);
  p.line(gx + 18, cy + ry - 12, gx + 12, gy + 2, 2, 4);
  p.line(gx + gw - 18, cy + ry - 12, gx + gw - 12, gy + 2, 2, 4);
  p.line(gx + gw * 0.35, cy + ry - 4, gx + gw * 0.35, gy + 2, 2, 3);
  p.line(gx + gw * 0.65, cy + ry - 4, gx + gw * 0.65, gy + 2, 2, 3);
  p.quad(gx, gy, gx + gw, gy, gx + gw - 16, gy + gh, gx + 16, gy + gh, 2);
  // Rear engine/gunner sub-pod
  p.quad(gx - 56, gy - 4, gx - 10, gy - 4, gx - 16, gy + 18, gx - 50, gy + 18, 2);
  p.line(gx - 34, cy + ry - 16, gx - 34, gy, 2, 3);

  // Subtle architectural negative-space gondola viewport slits
  for (let wx = gx + 24; wx < gx + gw - 30; wx += 22) {
    p.rect(wx, gy + 10, 11, 5, 0);
  }

  if (dying) {
    // Dramatic catastrophic gasbag tears & ruptured framing
    p.circle(w * 0.36, cy - 14, 42, 0);
    p.circle(w * 0.64, cy + 12, 36, 0);
    p.circle(w * 0.5, cy - 30, 28, 0);
    p.tri(gx + 40, gy - 6, gx + 80, gy + gh + 2, gx + 115, gy - 6, 0);
    // Jagged exposed rib remnants across blast holes
    p.line(w * 0.32, cy - 48, w * 0.4, cy + 20, 2, 3);
    p.line(w * 0.6, cy - 18, w * 0.68, cy + 40, 2, 3);
  }
}

function drawBlimpPropeller(p: SpritePainter, frameIdx: number): void {
  const cx = Math.floor(p.w / 2);
  const cy = Math.floor(p.h / 2);
  const phase = frameIdx % 6;
  const bladeH = [22, 17, 10, 4, 10, 17][phase]!;
  p.rect(cx - 2, cy - 5, 5, 10, 2);
  p.rect(cx - 1, cy - bladeH, 3, bladeH * 2, 2);
  if (phase % 2 === 0) {
    p.rect(cx - 3, cy - Math.floor(bladeH * 0.7), 7, 2, 2);
    p.rect(cx - 3, cy + Math.floor(bladeH * 0.7), 7, 2, 2);
  }
}

function drawGunBarrel(p: SpritePainter, frameIdx: number): void {
  const w = p.w;
  const h = p.h;
  const recoil = frameIdx === 1 ? 4 : frameIdx === 2 ? 3 : frameIdx === 3 ? 2 : frameIdx === 4 ? 1 : 0;
  const mid = Math.floor(h / 2);
  if (h <= 4) {
    // Small boat deck gun barrel (16x3, pure index 2)
    p.rect(0, 0, Math.max(5, w - 1 - recoil), h, 2);
    p.rect(Math.max(5, w - 3 - recoil), 0, 2, h, 2);
  } else {
    // Big boat heavy turret barrel (35x9, pure index 2)
    p.rect(0, 1, 11, h - 2, 2);
    p.rect(8, mid - 2, Math.max(10, w - 10 - recoil), 5, 2);
    // Flared muzzle collar
    p.rect(Math.max(12, w - 6 - recoil), mid - 3, 4, 7, 2);
  }
}

/**
 * Lush, sculpted organic cumulus clouds!
 * - `clouds` (352x192, 6 unique frames): PURE index `7` (blazing white sunlit clouds)
 * - `parallax_clouds` (88x48, 6 unique frames): PURE index `6` (soft midground haze clouds)
 * Each frame has a distinct painterly multi-lobe silhouette with towering peaks,
 * stepped trailing wisps, and softly scalloped undersides (zero flat gray ovals!).
 */
function drawCloudFormation(p: SpritePainter, frameIdx: number, isParallax: boolean): void {
  const w = p.w;
  const h = p.h;
  const pal = isParallax ? 6 : 7;

  // 6 handcrafted painterly cumulus recipes (normalized [cx, cy, rx, ry] lobes)
  const recipes: readonly (readonly (readonly [number, number, number, number])[])[] = [
    // 0: Classic towering cumulus anvil
    [
      [0.2, 0.7, 0.17, 0.16],
      [0.36, 0.56, 0.2, 0.28],
      [0.54, 0.42, 0.22, 0.34],
      [0.72, 0.58, 0.19, 0.24],
      [0.84, 0.72, 0.13, 0.13],
      [0.48, 0.73, 0.32, 0.15],
      [0.11, 0.76, 0.09, 0.09],
    ],
    // 1: Windswept twin-peak cloudbank
    [
      [0.16, 0.68, 0.14, 0.15],
      [0.31, 0.48, 0.18, 0.3],
      [0.48, 0.62, 0.17, 0.22],
      [0.65, 0.44, 0.2, 0.32],
      [0.81, 0.65, 0.16, 0.18],
      [0.5, 0.74, 0.35, 0.13],
      [0.91, 0.73, 0.07, 0.08],
    ],
    // 2: Sweeping diagonal cumulus drift
    [
      [0.14, 0.74, 0.12, 0.11],
      [0.28, 0.66, 0.17, 0.19],
      [0.46, 0.54, 0.2, 0.28],
      [0.64, 0.38, 0.21, 0.32],
      [0.8, 0.56, 0.16, 0.24],
      [0.56, 0.72, 0.3, 0.15],
      [0.89, 0.7, 0.09, 0.11],
    ],
    // 3: Broad low sunlit strato-cumulus
    [
      [0.15, 0.68, 0.14, 0.16],
      [0.32, 0.58, 0.18, 0.24],
      [0.5, 0.52, 0.21, 0.27],
      [0.69, 0.58, 0.18, 0.23],
      [0.85, 0.69, 0.13, 0.15],
      [0.5, 0.73, 0.37, 0.13],
    ],
    // 4: Billowing stormhead cluster
    [
      [0.24, 0.64, 0.18, 0.21],
      [0.42, 0.36, 0.2, 0.31],
      [0.58, 0.48, 0.21, 0.3],
      [0.74, 0.64, 0.18, 0.2],
      [0.48, 0.72, 0.31, 0.16],
      [0.12, 0.73, 0.1, 0.11],
      [0.88, 0.74, 0.09, 0.09],
    ],
    // 5: High puffy cumulus trio
    [
      [0.22, 0.6, 0.17, 0.24],
      [0.44, 0.48, 0.19, 0.29],
      [0.66, 0.55, 0.19, 0.26],
      [0.82, 0.68, 0.14, 0.15],
      [0.48, 0.72, 0.33, 0.14],
      [0.1, 0.72, 0.08, 0.1],
    ],
  ];

  const lobes = recipes[frameIdx % recipes.length]!;
  for (const [cx, cy, rx, ry] of lobes) {
    p.ellipse(cx * w, cy * h, rx * w, ry * h, pal);
  }

  // Sculpt delicate secondary micro-billows along upper sunlit ridges for rich pixel-art silhouette
  const ridgeSteps = isParallax ? 7 : 13;
  for (let i = 0; i < ridgeSteps; i++) {
    const u = (i + 0.5) / ridgeSteps;
    const wave = Math.sin(i * 2.1 + frameIdx * 1.7);
    const arch = Math.sin(u * Math.PI);
    const bx = w * (0.12 + u * 0.76);
    const by = h * (0.64 - arch * 0.24 + wave * 0.04);
    const br = Math.min(w, h) * (0.06 + 0.05 * arch);
    p.circle(bx, by, br, pal);
  }
}

/**
 * Horizontally seamless upper stratosphere cloud banks (`space_clouds`, 600x100, 3 frames):
 * - Frame 0: index `7` (bright white foreground upper ceiling bank)
 * - Frame 1: index `2` (deep storm cloud bank for Overdrive)
 * - Frame 2: index `6` (pale cream background haze bank)
 */
function drawSpaceClouds(p: SpritePainter, frameIdx: number): void {
  const w = p.w;
  const h = p.h;
  const pal = frameIdx === 1 ? 2 : frameIdx === 2 ? 6 : 7;

  // Solid upper bank merging seamlessly with `space_clouds_blank` above
  p.rect(0, 0, w, Math.floor(h * 0.42), pal);

  // Periodically seamless billowing hanging cloud lobes across full 600px width
  const lobes = 10;
  for (let i = 0; i <= lobes; i++) {
    const u = i / lobes;
    const cx = u * w;
    // Use integer harmonics of 2*PI so x=0 and x=w match seamlessly!
    const h1 = Math.sin(u * Math.PI * 2 + frameIdx * 1.9);
    const h2 = Math.cos(u * Math.PI * 4 - frameIdx * 1.1);
    const rx = (w / lobes) * (0.66 + 0.14 * h1);
    const ry = h * (0.28 + 0.14 * Math.abs(h1) + 0.08 * Math.abs(h2));
    p.ellipse(cx, h * 0.42, rx, ry, pal);
    // Secondary sub-billows for organic pixel cloud ceiling
    const subX = cx + (w / lobes) * 0.5;
    const subRy = h * (0.2 + 0.12 * Math.abs(h2));
    p.ellipse(subX, h * 0.4, rx * 0.65, subRy, pal);
  }
}

/**
 * Iconic multi-frame arcade explosions (`fx_explodetiny/small/medium/big`):
 * Pure punchy white (`7`) expanding starburst -> multi-lobe billowing fireball with
 * crisp negative-space pockets -> fracturing hollowing smoke-ring embers!
 */
function drawExplosion(p: SpritePainter, frameIdx: number, totalFrames: number): void {
  const w = p.w;
  const h = p.h;
  const cx = w * 0.5;
  const cy = h * 0.5;
  const maxR = Math.min(w, h) * 0.46;
  const t = totalFrames > 1 ? frameIdx / (totalFrames - 1) : 0.4;

  // Iconic arcade 1-frame impact inversion: f0 blinding white (7) -> f1 stark dark (1) disc
  if (frameIdx === 0) {
    p.circle(cx, cy, maxR * 0.62, 7);
    const rays = 8;
    for (let i = 0; i < rays; i++) {
      const ang = (i / rays) * Math.PI * 2;
      const len = maxR * (0.78 + (i % 2) * 0.2);
      p.line(
        cx,
        cy,
        cx + Math.cos(ang) * len,
        cy + Math.sin(ang) * len,
        7,
        Math.max(1, Math.round(w / 16)),
      );
    }
    return;
  }

  if (frameIdx === 1 && w >= 20) {
    // Signature single-frame dark inversion disc (index 1) for maximum punch!
    p.circle(cx, cy, maxR * 0.84, 1);
    return;
  }

  if (t < 0.56) {
    // Phase 2: Full billowing multi-lobe white blast cloud with crisp hollowing pocket
    const u = Math.max(0, (t - 0.16) / 0.4);
    const lobes = w >= 40 ? 9 : 6;
    for (let i = 0; i < lobes; i++) {
      const ang = (i / lobes) * Math.PI * 2 + frameIdx * 0.48;
      const dist = maxR * (0.14 + u * 0.34);
      const lr = maxR * (0.44 - u * 0.1) * (0.82 + 0.22 * Math.sin(i * 2.3 + frameIdx));
      p.circle(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, lr, 7);
    }
    p.circle(cx, cy, maxR * (0.58 - u * 0.14), 7);
    if (u > 0.32) {
      p.circle(cx, cy, maxR * ((u - 0.32) * 0.62), 0);
    }
    return;
  }

  // Phase 3: Hollow expanding blast ring shattering into crisp drifting flecks
  const u = (t - 0.56) / 0.44;
  const puffs = w >= 40 ? 11 : 7;
  for (let i = 0; i < puffs; i++) {
    const ang = (i / puffs) * Math.PI * 2 + frameIdx * 0.27;
    const dist = maxR * (0.48 + u * 0.38);
    const pr = Math.max(1.2, maxR * (0.3 * (1 - u * 0.78)) * (0.75 + 0.3 * Math.cos(i * 1.9)));
    p.circle(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist, pr, 7);
  }
}

/**
 * Gritty multi-frame smoke (`fx_smoke` / `fx_smokelong` in palette index `3`)
 * or bright puffs (`fx_poof` / `fx_missile_trail` in index `7`).
 */
function drawSmokePuff(p: SpritePainter, frameIdx: number, totalFrames: number, pal: number): void {
  const w = p.w;
  const h = p.h;
  const cx = w * 0.5;
  const cy = h * 0.5;
  const maxR = Math.min(w, h) * 0.44;
  const t = totalFrames > 1 ? frameIdx / (totalFrames - 1) : 0.4;

  if (t < 0.35) {
    const r = Math.max(1.5, maxR * (0.48 + t * 1.2));
    p.circle(cx, cy, r, pal);
    p.circle(cx - r * 0.38, cy - r * 0.2, r * 0.68, pal);
    p.circle(cx + r * 0.35, cy + r * 0.22, r * 0.6, pal);
  } else if (t < 0.72) {
    const u = (t - 0.35) / 0.37;
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2 + frameIdx * 0.5;
      const d = maxR * (0.28 + u * 0.25);
      p.circle(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, maxR * (0.38 - u * 0.1), pal);
    }
    p.circle(cx, cy, maxR * (0.18 + u * 0.22), 0);
  } else {
    const u = (t - 0.72) / 0.28;
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + frameIdx * 0.7;
      const d = maxR * (0.52 + u * 0.24);
      p.circle(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, Math.max(1, maxR * (0.22 * (1 - u * 0.6))), pal);
    }
  }
}

/**
 * Pure crisp white (`7`) organic bubbling ocean water splashes & boat wakes!
 */
function drawWaterSplash(p: SpritePainter, frameIdx: number, totalFrames: number): void {
  const w = p.w;
  const h = p.h;
  const cx = w * 0.5;
  const t = totalFrames > 1 ? frameIdx / (totalFrames - 1) : 0.4;
  const arcRise = Math.sin(Math.min(1, t * 1.15) * Math.PI);
  const plumeH = Math.max(3, h * (0.2 + 0.74 * arcRise));
  const baseW = w * (0.28 + 0.44 * t);

  // Frothy organic waterline foam collar
  p.ellipse(cx, h - 2, Math.min(w * 0.48, baseW * 0.68), Math.max(2, h * 0.09), 7);
  p.circle(cx - baseW * 0.36, h - 3, Math.max(1.5, Math.min(w, h) * 0.11), 7);
  p.circle(cx + baseW * 0.36, h - 3, Math.max(1.5, Math.min(w, h) * 0.11), 7);

  if (t < 0.78) {
    // Organic billowing water spire built from stacked foam lobes (no straight broomsticks!)
    const steps = 6;
    for (let s = 0; s < steps; s++) {
      const f = s / (steps - 1);
      const y = h - 2 - plumeH * f;
      const spread = (w * 0.06 + w * 0.28 * t) * Math.sin(f * Math.PI * 0.75);
      const r = Math.max(1.4, w * (0.14 * (1 - f * 0.55) * (1 - t * 0.35)));
      p.circle(cx, y, r * (1 - t * 0.3), 7);
      if (s >= 1) {
        p.circle(cx - spread, y + r * 0.4, r * 0.85, 7);
        p.circle(cx + spread, y + r * 0.4, r * 0.85, 7);
      }
    }
    // Hollow frothy crest cutout at peak expansion
    if (t > 0.38) {
      p.circle(cx, h - plumeH * 0.45, Math.max(1.5, w * 0.09 * (t - 0.3)), 0);
    }
  }

  // Arcing airborne sea-spray droplets cascading outward & downward
  const drops = w >= 40 ? 12 : 7;
  for (let i = 0; i < drops; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const rank = Math.floor(i / 2) + 1;
    const dx = cx + side * (w * (0.08 + 0.08 * rank) * (0.4 + 0.75 * t));
    const dy = h - plumeH * (1.02 - 0.12 * rank) + t * t * h * 0.34;
    const dr = Math.max(1, Math.round(w / (rank > 3 ? 30 : 20)));
    p.circle(dx, dy, dr, 7);
  }
}

/**
 * Pure punchy white (`7`) thruster & afterburner plumes!
 */
function drawBoostFlame(
  p: SpritePainter,
  frameIdx: number,
  totalFrames: number,
  phaseKind: 'start' | 'loop' | 'end' | 'hover',
): void {
  const w = p.w;
  const h = p.h;
  const cy = h * 0.5;
  const t = totalFrames > 1 ? frameIdx / (totalFrames - 1) : 0.5;

  if (phaseKind === 'hover') {
    const r = Math.min(w, h) * (0.26 + 0.14 * (frameIdx % 3) * 0.5);
    p.ring(w * 0.55, cy, r, Math.max(1, r - 2), 7);
    p.circle(w * 0.68, cy, Math.max(1.5, r * 0.42), 7);
    return;
  }

  const scale =
    phaseKind === 'start'
      ? 0.48 + 0.52 * t
      : phaseKind === 'loop'
        ? 0.78 + 0.22 * (frameIdx % 2 === 0 ? 1 : 0)
        : 0.85 * (1 - t * 0.72);
  const tipX = Math.max(0, w * (1 - scale));
  const halfH = Math.max(2, h * 0.34 * scale);

  if (phaseKind === 'end' && t > 0.62) {
    p.circle(w * 0.42, cy, 2, 7);
    p.circle(w * 0.72, cy - 2, 1.5, 7);
    p.circle(w * 0.66, cy + 2, 1.5, 7);
    return;
  }

  // Crisp tapering incandescent jet cone pointing rearward (-X) from nozzle at +X
  p.tri(tipX, cy, w - 1, cy - halfH, w - 1, cy + halfH, 7);
  if (w >= 28) {
    // Superboost flared shock-diamond side tongues
    p.tri(tipX + 5, cy - halfH * 0.55, w - 1, cy - halfH * 1.15, w - 1, cy - 1, 7);
    p.tri(tipX + 5, cy + halfH * 0.55, w - 1, cy + halfH * 1.15, w - 1, cy + 1, 7);
  }
}

/**
 * Punchy muzzle flashes:
 * - Player flashes: crisp sky-cutout rim (`5`) + blazing white starburst core (`7`)
 * - Enemy Big Flash (`fx_EBigFlash`): pure blazing white (`7`) cannon flare
 */
function drawMuzzleFlash(
  p: SpritePainter,
  frameIdx: number,
  totalFrames: number,
  pureWhite: boolean,
): void {
  const w = p.w;
  const h = p.h;
  const cy = h * 0.5;
  const t = totalFrames > 1 ? frameIdx / (totalFrames - 1) : 0;
  const decay = 1 - t * 0.62;
  const len = Math.max(4, w * 0.92 * decay);
  const spread = Math.max(2, h * 0.44 * decay);
  const rimPal = pureWhite ? 7 : 5;

  // Outer cutout halo / starburst
  p.tri(0, cy, len, cy - spread * 0.48, len, cy + spread * 0.48, rimPal);
  p.tri(0, cy, len * 0.76, cy - spread, len * 0.42, cy, rimPal);
  p.tri(0, cy, len * 0.76, cy + spread, len * 0.42, cy, rimPal);
  // Incandescent white core
  p.tri(1, cy, len * 0.72, cy - spread * 0.28, len * 0.72, cy + spread * 0.28, 7);
}

function drawLaserCharge(p: SpritePainter, frameIdx: number, totalFrames: number): void {
  const w = p.w;
  const h = p.h;
  const cx = w * 0.44;
  const cy = h * 0.5;
  const t = totalFrames > 1 ? frameIdx / (totalFrames - 1) : 0.5;

  const sparkDist = w * 0.44 * (1 - t * 0.7);
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2 + frameIdx * 0.45;
    const sx = cx + Math.cos(ang) * sparkDist;
    const sy = cy + Math.sin(ang) * sparkDist;
    p.line(
      sx,
      sy,
      cx + Math.cos(ang) * (sparkDist * 0.45),
      cy + Math.sin(ang) * (sparkDist * 0.45),
      7,
      1,
    );
  }
  const coreR = Math.max(2, w * (0.1 + 0.22 * t));
  p.circle(cx, cy, coreR, 7);
  const flare = w * (0.18 + 0.3 * t);
  p.hline(cx - flare, cx + flare, cy, 7);
  p.vline(cx, cy - flare, cy + flare, 7);
}

function drawSkybreakerLogo(p: SpritePainter): void {
  const w = p.w;
  const h = p.h;
  const cx = w * 0.5;
  p.bevelBox(w * 0.08, h * 0.4, w * 0.84, h * 0.3, 2, 1, 5, 3);
  p.rect(w * 0.12, h * 0.45, w * 0.76, h * 0.2, 1);
  p.tri(cx, h * 0.14, cx - w * 0.28, h * 0.4, cx - w * 0.05, h * 0.4, 5);
  p.tri(cx, h * 0.14, cx + w * 0.28, h * 0.4, cx + w * 0.05, h * 0.4, 5);
  p.tri(cx, h * 0.23, cx - w * 0.16, h * 0.4, cx + w * 0.16, h * 0.4, 3);
}

function drawProceduralSpriteFrame(
  rgba: Uint8Array,
  texW: number,
  texH: number,
  entry: SpriteEntry,
  fx: number,
  fy: number,
  frameIdx: number,
): void {
  const [w, h] = entry.size;
  if (w <= 0 || h <= 0) {
    return;
  }
  const p = new SpritePainter(rgba, texW, texH, fx, fy, w, h);
  const name = entry.name.toLowerCase();
  const pal = resolveSpritePaletteIndex(entry.name);
  const totalFrames = Math.max(1, entry.subs.length);
  const cx = w * 0.5;
  const cy = h * 0.5;

  // --- Player Engines (24x24, pure index 1) ---
  if (name === 'engine_original') {
    p.gridSymY(ENGINE_STANDARD_TOP);
    return;
  }
  if (name === 'engine_superboost') {
    p.gridSymY(ENGINE_SUPERBOOST_TOP);
    return;
  }
  if (name === 'engine_gungine') {
    p.gridSymY(ENGINE_GUNGINE_TOP);
    return;
  }
  if (name === 'engine_underwater') {
    p.gridSymY(ENGINE_UNDERWATER_TOP);
    drawUnderwaterPropeller(p, frameIdx, 1);
    return;
  }
  if (name === 'engine_hover') {
    p.gridSymY(ENGINE_HOVER_TOP);
    return;
  }

  // --- Player Bodies (24x24, pure index 1) ---
  if (name === 'body_original') {
    p.gridSymY(BODY_STANDARD_TOP);
    return;
  }
  if (name === 'body_armor') {
    p.gridSymY(BODY_ARMOR_TOP);
    return;
  }
  if (name === 'body_melee') {
    p.gridSymY(BODY_MELEE_TOP);
    return;
  }
  if (name === 'body_nuke') {
    p.gridSymY(BODY_NUKE_TOP);
    return;
  }
  if (name === 'body_bomb') {
    p.gridSymY(BODY_BOMB_TOP);
    return;
  }

  // --- Player Wings / Weapons (24x24, pure index 1) ---
  if (name === 'wings_original') {
    p.gridSymY(WINGS_STANDARD_TOP);
    return;
  }
  if (name === 'wings_laser') {
    p.gridSymY(WINGS_LASER_TOP);
    return;
  }
  if (name === 'wings_spread') {
    p.gridSymY(WINGS_SPREAD_TOP);
    return;
  }
  if (name === 'wings_missiles') {
    p.gridSymY(WINGS_MISSILES_TOP);
    return;
  }
  if (name === 'wings_cannon') {
    p.gridSymY(WINGS_CANNON_TOP);
    return;
  }

  // --- Apex Omega Super-Craft (416x300, pure index 1) ---
  if (name === 'urauser') {
    drawApexOmega(p);
    return;
  }

  // --- Enemy Aircraft (pure index 2) ---
  if (name === 'fighter_body') {
    p.gridSymY(ENEMY_FIGHTER_BODY_TOP);
    return;
  }
  if (name === 'fighter_wings') {
    p.gridSymY(ENEMY_FIGHTER_WINGS_TOP);
    return;
  }
  if (name === 'jet_body') {
    p.gridSymY(ENEMY_JET_BODY_TOP);
    return;
  }
  if (name === 'jet_wings') {
    p.gridSymY(ENEMY_JET_WINGS_TOP);
    return;
  }
  if (name === 'jet_body_crash') {
    p.grid(ENEMY_JET_BODY_CRASH);
    return;
  }
  if (name === 'jet_wings_crash') {
    p.grid(ENEMY_JET_WINGS_CRASH);
    return;
  }
  if (name === 'ace_body') {
    drawAceBody(p, false);
    return;
  }
  if (name === 'ace_wings') {
    drawAceWings(p, false);
    return;
  }
  if (name === 'laserace_body') {
    drawAceBody(p, true);
    return;
  }
  if (name === 'laserace_wings') {
    drawAceWings(p, true);
    return;
  }

  // --- Enemy Ships, Submarines & Sky-Dreadnought Dirigible (pure index 2) ---
  if (name === 'small_boat' || name === 'small_boat_sink') {
    drawSmallBoat(p, name === 'small_boat_sink');
    return;
  }
  if (name === 'big_boat' || name === 'big_boat_sink') {
    drawBigBoat(p, name === 'big_boat_sink');
    return;
  }
  if (name === 'submarine' || name === 'submarine_sink') {
    drawSubmarine(p, false, name === 'submarine_sink');
    return;
  }
  if (name === 'acemarine' || name === 'acemarine_sink') {
    drawSubmarine(p, true, name === 'acemarine_sink');
    return;
  }
  if (name === 'blimp' || name === 'blimp_die') {
    drawBlimp(p, name === 'blimp_die');
    return;
  }
  if (name === 'blimp_anim') {
    drawBlimpPropeller(p, frameIdx);
    return;
  }
  if (name === 'small_boat_gun' || name === 'big_boat_gun') {
    drawGunBarrel(p, frameIdx);
    return;
  }
  if (name === 'missile') {
    p.gridSymY(ENEMY_MISSILE_TOP);
    return;
  }

  // --- Distant Background Silhouette Props (index 4 + contrail index 6) ---
  if (name === 'bg_boat') {
    p.quad(6, h - 1, w - 6, h - 1, w - 1, h - 6, 3, h - 6, 4);
    p.rect(w * 0.34, h - 10, w * 0.28, 5, 4);
    p.rect(w * 0.4, h - 12, w * 0.14, 3, 4);
    p.vline(w * 0.47, 0, h - 12, 4);
    return;
  }
  if (name === 'bg_sub') {
    p.ellipse(cx, h - 3, w * 0.43, 4, 4);
    p.rect(w * 0.4, 3, 14, h - 6, 4);
    p.vline(w * 0.46, 0, 4, 4);
    return;
  }
  if (name === 'bg_blimp') {
    p.ellipse(cx, h * 0.44, w * 0.44, h * 0.33, 4);
    p.tri(4, 6, 28, h * 0.34, 10, h * 0.5, 4);
    p.tri(4, h - 10, 28, h * 0.56, 10, h * 0.44, 4);
    p.rect(cx - 18, h * 0.74, 36, 9, 4);
    return;
  }
  if (name === 'bg_plane' || name === 'bg_jet' || name === 'bg_ace') {
    p.hline(0, w - 1, Math.floor(cy), 4);
    p.vline(Math.floor(w * 0.5), 0, h - 1, 4);
    if (w >= 6) {
      p.vline(Math.floor(w * 0.5) - 1, 1, h - 2, 4);
      p.vline(0, Math.max(0, Math.floor(cy) - 1), Math.min(h - 1, Math.floor(cy) + 1), 4);
    }
    return;
  }
  if (name === 'bg_jet_trail') {
    // Pale atmospheric contrail (index 6) solid near jet tip, gently feathering out behind
    for (let x = 0; x < w; x++) {
      if (x > 64 || (x > 24 && x % 2 === 0) || x % 4 === 0) {
        p.px(x, 1, 6);
        if (x > 130) p.px(x, 0, 6);
      }
    }
    return;
  }

  // --- Environment & Clouds ---
  if (name === 'ocean_line') {
    p.rect(0, 0, w, h, 7);
    return;
  }
  if (name === 'space_clouds_blank') {
    p.rect(0, 0, w, h, 7);
    return;
  }
  if (name === 'space_clouds') {
    drawSpaceClouds(p, frameIdx);
    return;
  }
  if (name === 'clouds') {
    drawCloudFormation(p, frameIdx, false);
    return;
  }
  if (name === 'parallax_clouds') {
    drawCloudFormation(p, frameIdx, true);
    return;
  }

  // --- Projectiles ---
  if (name === 'projectile_bullet') {
    // f0: tick-0 bright muzzle flash orb (28x28); f1: sleek high-velocity tracer (22x22)
    // Both use sky-cutout rim (5) + blinding white core (7).
    if (frameIdx === 0) {
      p.circle(cx, cy, 12.5, 5);
      p.circle(cx, cy, 9.5, 7);
    } else {
      p.ellipse(cx, cy, 10.5, 5.5, 5);
      p.ellipse(cx + 0.5, cy, 7.5, 3, 7);
    }
    return;
  }
  if (name === 'projectile_spreadbullet') {
    // Sharp flak chevron pellet: sky-cutout rim (5) + bright white core (7)
    p.tri(w - 1, cy, 1, 0, 4, cy, 5);
    p.tri(w - 1, cy, 4, cy, 1, h - 1, 5);
    p.tri(w - 2, cy, 4, 2, 6, cy, 7);
    p.tri(w - 2, cy, 6, cy, 4, h - 3, 7);
    return;
  }
  if (name === 'projectile_laser') {
    p.rect(0, 0, w, h, 7);
    return;
  }
  if (name === 'projectile_elaser') {
    const coreH = Math.max(2, h - 4 + (frameIdx % 2 === 0 ? 2 : 0));
    const pad = Math.floor((h - coreH) / 2);
    p.rect(0, 0, w, h, 2);
    p.rect(0, pad, w, coreH, 7);
    return;
  }
  if (name === 'laser_fade') {
    const fh = Math.max(1, Math.round(h * (1 - frameIdx / Math.max(1, totalFrames))));
    p.rect(0, Math.floor((h - fh) / 2), w, fh, 7);
    return;
  }
  if (name === 'projectile_homing_missile') {
    p.gridSymY(PROJ_HOMING_TOP, PROJ_HOMING_MID);
    return;
  }
  if (name === 'projectile_plasmabullet' || name === 'projectile_plasmaball') {
    // Crackling plasma orb: sky-cutout halo (5) + incandescent white core (7)
    const r = Math.min(w, h) * 0.4;
    p.circle(cx, cy, r, 5);
    p.circle(cx, cy, r * 0.68, 7);
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + frameIdx * 0.6;
      p.line(cx, cy, cx + Math.cos(ang) * (r * 1.15), cy + Math.sin(ang) * (r * 1.15), 7, 1);
    }
    return;
  }
  if (name === 'projectile_bomb') {
    p.gridSymY(PROJ_BOMB_TOP);
    return;
  }
  if (name === 'projectile_artillery_bullet') {
    // Heavy naval artillery shell: bold enemy silhouette (2) + bright tracer core (7)
    p.ellipse(cx, cy, w * 0.45, h * 0.42, 2);
    p.ellipse(cx + 2, cy, w * 0.28, h * 0.22, 7);
    return;
  }
  if (name === 'projectile_ebullet') {
    // Iconic high-contrast enemy bullet: bold dark (2) ring + bright white (7) center
    const r = frameIdx % 2 === 0 ? 7.5 : 6.5;
    p.circle(cx, cy, r, 2);
    p.circle(cx, cy, r - 2.2, 7);
    return;
  }
  if (name === 'laser_charge') {
    drawLaserCharge(p, frameIdx, totalFrames);
    return;
  }

  // --- Boost & Thruster FX (pure crisp 7) ---
  if (name === 'fx_booststart' || name === 'fx_superbooststart' || name === 'fx_aceboost_start') {
    drawBoostFlame(p, frameIdx, totalFrames, 'start');
    return;
  }
  if (
    name === 'fx_boostloop' ||
    name === 'fx_superboostloop' ||
    name === 'fx_aceboost_loop' ||
    name === 'fx_jetboost'
  ) {
    drawBoostFlame(p, frameIdx, totalFrames, 'loop');
    return;
  }
  if (name === 'fx_boostend' || name === 'fx_superboostend' || name === 'fx_aceboost_end') {
    drawBoostFlame(p, frameIdx, totalFrames, 'end');
    return;
  }
  if (name === 'fx_boosthover' || name === 'fx_boosthover_idle' || name === 'fx_boosthover_fade') {
    drawBoostFlame(p, frameIdx, totalFrames, 'hover');
    return;
  }
  if (name === 'fx_bigboostcircle') {
    const t = totalFrames > 1 ? frameIdx / (totalFrames - 1) : 0.4;
    const rx = Math.max(2, w * (0.22 + 0.26 * t));
    const ry = Math.max(4, h * (0.22 + 0.25 * t));
    p.ellipse(cx, cy, rx, ry, 7);
    p.ellipse(cx, cy, Math.max(0, rx - 3), Math.max(0, ry - 4), 0);
    return;
  }

  // --- Muzzle Flashes ---
  if (
    name === 'fx_fire_flash' ||
    name === 'fx_spread_fire_flash' ||
    name === 'fx_missile_fire_flash' ||
    name === 'fx_plashma_flash'
  ) {
    drawMuzzleFlash(p, frameIdx, totalFrames, false);
    return;
  }
  if (name === 'fx_ebigflash') {
    drawMuzzleFlash(p, frameIdx, totalFrames, true);
    return;
  }

  // --- Explosions, Smoke & Impact Sparks ---
  if (name.startsWith('fx_explode')) {
    drawExplosion(p, frameIdx, totalFrames);
    return;
  }
  if (name.startsWith('fx_smoke')) {
    drawSmokePuff(p, frameIdx, totalFrames, 3);
    return;
  }
  if (name === 'fx_poof' || name === 'fx_missile_trail') {
    drawSmokePuff(p, frameIdx, totalFrames, 7);
    return;
  }
  if (
    name.startsWith('fx_splash') ||
    name === 'fx_watertrail' ||
    name.startsWith('fx_boat_trail') ||
    name.startsWith('fx_big_boat_trail') ||
    name === 'fx_subsplash' ||
    name === 'fx_boostsplash' ||
    name === 'fx_laser_splash'
  ) {
    drawWaterSplash(p, frameIdx, totalFrames);
    return;
  }
  if (name === 'fx_bullet_hit') {
    const t = totalFrames > 1 ? frameIdx / (totalFrames - 1) : 0;
    const arm = Math.min(w, h) * (0.24 + 0.22 * (1 - t * 0.4));
    p.line(cx - arm, cy - arm, cx + arm, cy + arm, 7, 2);
    p.line(cx - arm, cy + arm, cx + arm, cy - arm, 7, 2);
    if (frameIdx === 0) {
      p.circle(cx, cy, Math.max(2, arm * 0.45), 7);
    }
    return;
  }
  if (name === 'fx_player_hit') {
    // Signature impact inversion: f0 solid dark (1) disc -> f1 solid white (7) disc -> f2 crisp 4-point star (7)
    if (frameIdx === 0) {
      p.circle(cx, cy, Math.min(w, h) * 0.45, 1);
    } else if (frameIdx === 1) {
      p.circle(cx, cy, Math.min(w, h) * 0.44, 7);
    } else {
      p.tri(cx, 1, cx - 3, cy, cx + 3, cy, 7);
      p.tri(cx, h - 2, cx - 3, cy, cx + 3, cy, 7);
      p.tri(1, cy, cx, cy - 3, cx, cy + 3, 7);
      p.tri(w - 2, cy, cx, cy - 3, cx, cy + 3, 7);
    }
    return;
  }
  if (name === 'fx_ebullet_fade') {
    const t = totalFrames > 1 ? frameIdx / (totalFrames - 1) : 0.4;
    const r = Math.max(2, 7.5 * (1 - t * 0.55));
    p.circle(cx, cy, r, 2);
    if (r > 3) p.circle(cx, cy, r - 2, 7);
    return;
  }
  if (name === 'fx_spread_fade' || name === 'fx_plasma_fade') {
    const t = totalFrames > 1 ? frameIdx / (totalFrames - 1) : 0.4;
    const r = Math.max(1.5, Math.min(w, h) * (0.4 * (1 - t * 0.55)));
    p.circle(cx, cy, r, 5);
    p.circle(cx, cy, Math.max(1, r * 0.6), 7);
    if (t > 0.5) p.circle(cx, cy, r * 0.35, 0);
    return;
  }
  if (name === 'fx_drip') {
    p.rect(0, frameIdx % 2, w, Math.max(1, h - 1), 7);
    return;
  }
  if (name === 'fx_repair') {
    // Twinkling repair '+' sparkle (1 + 7 matching sheet1grey)
    p.hline(0, w - 1, Math.floor(cy), 1);
    p.vline(Math.floor(cx), 0, h - 1, 1);
    p.px(Math.floor(cx), Math.floor(cy), 7);
    return;
  }
  if (name === 'skybreaker_logo' || name === 'luftrausers_logo') {
    drawSkybreakerLogo(p);
    return;
  }
  if (name === 'credit_heads') {
    p.circle(cx, cy, Math.min(w, h) * 0.34, 3);
    p.rect(cx - w * 0.22, cy - h * 0.1, w * 0.44, h * 0.14, 1);
    return;
  }

  if (w <= 4 || h <= 4) {
    p.rect(0, 0, w, h, pal);
    return;
  }

  p.ellipse(cx, cy, Math.max(1, w * 0.36), Math.max(1, h * 0.36), pal);
}

/**
 * Generates a deterministic 2048x1024 RGBA8 gameplay atlas with 8-level luminance encoding
 * (`idx * 32`) covering every sprite referenced in `sprites.json`.
 */
export function createProceduralSpritesTexture(atlas: SpriteAtlasSpec): DecodedTexture {
  const width = atlas.width || 2048;
  const height = atlas.height || 1024;
  const rgba = new Uint8Array(width * height * 4);

  for (const entry of Object.values(atlas.sprites)) {
    entry.subs.forEach((frame, idx) => {
      drawProceduralSpriteFrame(rgba, width, height, entry, frame.x, frame.y, idx);
    });
  }

  return {
    name: 'sprites',
    width,
    height,
    rgba,
    source: 'procedural',
  };
}

/**
 * Generates a clean-room 2048x1024 RGBA8 16-frame dramatic thermobaric skull-cloud
 * detonation texture matching `nukesprites.json` frame offsets in authentic palette index `1`.
 *
 * Strictly protects `x === 0` and `y === 0` transparent border pixels so negative
 * frame offsets (e.g. `[-138, -160]`) clamp cleanly to transparent under `GL_CLAMP_TO_EDGE`,
 * and constrains each frame's silhouette to its non-overlapping packed region.
 */
export function createProceduralNukeTexture(atlas?: SpriteAtlasSpec): DecodedTexture {
  const resolvedAtlas =
    atlas ?? normalizeSpriteAtlas('nukesprites', VANILLA_NUKE_SPRITES_RAW, 2048, 1024);
  const width = resolvedAtlas.width || 2048;
  const height = resolvedAtlas.height || 1024;
  const rgba = new Uint8Array(width * height * 4);
  const entry = resolvedAtlas.sprites.nuke;
  if (!entry) {
    return { name: 'nukesprites', width, height, rgba, source: 'procedural' };
  }

  const [fw, fh] = entry.size;
  const total = Math.max(1, entry.subs.length);

  entry.subs.forEach((frame, idx) => {
    const p = new SpritePainter(rgba, width, height, frame.x, frame.y, fw, fh, true);
    const t = idx / Math.max(1, total - 1);
    const cx = fw * 0.52;
    const baseY = fh * 0.84;

    if (idx <= 5) {
      // Phase 1 (frames 0..5): Explosive dark-ink mushroom/skull eruption rising cleanly inside packed sub-boxes
      const grow = (idx + 1) / 6;
      const crownY = Math.max(60 - Math.min(0, frame.y) + 32, baseY - fh * (0.28 + 0.34 * grow));
      const crownR = 26 + grow * 42;
      const stemW = 14 + grow * 24;

      // Ground shock skirt
      p.ellipse(cx, baseY - 4, stemW * 1.45, 10 + grow * 10, 1);
      // Rising blast column
      p.rect(cx - stemW * 0.5, crownY, stemW, baseY - crownY, 1);
      // Billowing cranium-shaped detonation crown
      p.circle(cx, crownY, crownR, 1);
      p.circle(cx - crownR * 0.55, crownY + crownR * 0.15, crownR * 0.58, 1);
      p.circle(cx + crownR * 0.55, crownY + crownR * 0.15, crownR * 0.58, 1);
      // Dramatic screaming skull eye/jaw cutouts emerging by frame 2+
      if (idx >= 2) {
        const eyeR = Math.max(4, crownR * 0.22);
        p.circle(cx - crownR * 0.34, crownY + 2, eyeR, 0);
        p.circle(cx + crownR * 0.34, crownY + 2, eyeR, 0);
        p.ellipse(cx, crownY + crownR * 0.45, crownR * 0.26, crownR * 0.3, 0);
      }
      return;
    }

    if (idx <= 10) {
      // Phase 2 (frames 6..10): Massive towering screaming skull-plume roaring outward
      const u = (idx - 6) / 4;
      const crownY = fh * (0.34 - u * 0.07);
      const crownR = 64 + u * 22;
      const stemW = 46 * (1 - u * 0.25);

      // Ground blast wave
      p.ellipse(cx, baseY, 72 + u * 36, 15, 1);
      // Jaw / neck blast column
      p.rect(cx - stemW * 0.5, crownY + crownR * 0.55, stemW, baseY - (crownY + crownR * 0.55), 1);
      // Cranium & cheekbone billows
      p.circle(cx, crownY, crownR, 1);
      p.ellipse(cx - crownR * 0.58, crownY + crownR * 0.24, crownR * 0.44, crownR * 0.36, 1);
      p.ellipse(cx + crownR * 0.58, crownY + crownR * 0.24, crownR * 0.44, crownR * 0.36, 1);
      // Strictly separated menacing skull eye sockets, nasal cavity & screaming jaw
      const eyeR = 14 + u * 4;
      p.ellipse(cx - crownR * 0.42, crownY - 2, eyeR * 1.15, eyeR * 0.9, 0);
      p.ellipse(cx + crownR * 0.42, crownY - 2, eyeR * 1.15, eyeR * 0.9, 0);
      p.tri(cx, crownY + 8, cx - 8, crownY + 28, cx + 8, crownY + 28, 0);
      p.ellipse(cx, crownY + crownR * 0.72, 16 + u * 6, 20 + u * 8, 0);
      // Jagged teeth bars along upper jaw rim
      for (const tx of [-12, -4, 4, 12]) {
        p.rect(cx + tx - 1, crownY + crownR * 0.52, 3, 9, 1);
      }
      return;
    }

    // Phase 3 (frames 11..15): Dissipating ring of drifting dark ash tendrils
    const u = (idx - 11) / Math.max(1, total - 12);
    const puffs = Math.max(4, Math.round(12 * (1 - u * 0.65)));
    const ringR = 85 + u * 45;
    for (let i = 0; i < puffs; i++) {
      const ang = (i / puffs) * Math.PI * 2 + idx * 0.4;
      const px = cx + Math.cos(ang) * ringR;
      const py = fh * 0.42 + Math.sin(ang) * (ringR * 0.85);
      const pr = Math.max(3, (22 - u * 16) * (0.7 + 0.4 * Math.sin(i * 2.1)));
      p.circle(px, py, pr, 1);
    }
    if (t < 0.94) {
      p.ellipse(cx, baseY - 6, 48 * (1 - u * 0.5), 6, 1);
    }
  });

  return {
    name: 'nukesprites',
    width,
    height,
    rgba,
    source: 'procedural',
  };
}

/**
 * Creates a complete clean-room KRUNKED SKYBREAKER procedural asset bundle
 * (`vaultSource: 'procedural-fallback'`) with original aircraft callsigns,
 * handcrafted procedural pixel art, 90 missions, 2048x1024 RGBA8 atlases,
 * and bold procedural bitmap fonts.
 */
export function createProceduralFallbackBundle(): VaultAssetBundle {
  const spritesAtlas = normalizeSpriteAtlas('sprites', VANILLA_SPRITES_RAW, 2048, 1024);
  const menuAtlas = normalizeSpriteAtlas('menusprites', VANILLA_MENU_SPRITES_RAW, 2048, 1024);
  const nukeAtlas = normalizeSpriteAtlas('nukesprites', VANILLA_NUKE_SPRITES_RAW, 2048, 1024);

  const fonts: Record<string, BitmapFontSpec> = {
    fntb: createProceduralFontSpec('fntb', 'Pic0', 32, 34, 25, 256, 256),
    fntm: createProceduralFontSpec('fntm', 'Pic0', 16, 18, 13, 128, 128),
    fntmb: createProceduralFontSpec('fntmb', 'Pic0', 16, 18, 13, 128, 128),
    fnts: createProceduralFontSpec('fnts', 'PixelSans', 11, 10, 8, 128, 128),
    fntxl: createProceduralFontSpec('fntxl', 'Pic0', 48, 50, 37, 512, 256),
  };

  const data: GameDataBundle = {
    vaultSource: 'procedural-fallback',
    steamDir: null,
    player: normalizePlayerData(VANILLA_PLAYER_RAW),
    projectiles: normalizeProjectilesData(VANILLA_PROJECTILES_RAW),
    enemies: normalizeEnemiesData(VANILLA_ENEMIES_RAW),
    enemiesSfmt: normalizeEnemiesData(VANILLA_ENEMIES_SFMT_RAW),
    spawnCoordinator: normalizeSpawnCoordinator(VANILLA_SPAWN_COORDINATOR_RAW),
    spawnCoordinatorSfmt: normalizeSpawnCoordinator(VANILLA_SPAWN_COORDINATOR_SFMT_RAW),
    global: normalizeGlobalData(VANILLA_GLOBAL_RAW),
    fx: normalizeFxData(VANILLA_FX_RAW),
    parallax: normalizeParallaxData(VANILLA_PARALLAX_RAW),
    room: normalizeRoomData(VANILLA_ROOM_RAW),
    atlases: {
      sprites: spritesAtlas,
      menusprites: menuAtlas,
      nukesprites: nukeAtlas,
    },
    fonts,
  };

  const textures: Record<string, DecodedTexture> = {
    sprites: createProceduralSpritesTexture(spritesAtlas),
    menusprites: createProceduralMenuTexture(menuAtlas),
    nukesprites: createProceduralNukeTexture(nukeAtlas),
    fntb: createProceduralFontTexture(fonts.fntb!),
    fntm: createProceduralFontTexture(fonts.fntm!),
    fntmb: createProceduralFontTexture(fonts.fntmb!),
    fnts: createProceduralFontTexture(fonts.fnts!),
    fntxl: createProceduralFontTexture(fonts.fntxl!),
  };

  const bgm: Record<string, string | null> = {};
  for (const stem of VANILLA_BGM_STEMS) {
    bgm[stem] = null;
  }
  const sfx: Record<string, string | null> = {};
  for (const cue of VANILLA_SFX_CUES) {
    sfx[cue] = null;
  }

  const audioManifest: AudioAssetManifest = {
    source: 'procedural-fallback',
    bgm,
    sfx,
  };

  return {
    data,
    textures,
    audioManifest,
  };
}
