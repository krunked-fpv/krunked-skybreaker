/**
 * Clean-room procedural menu sprite atlas (`menusprites` / `sheet2grey.png` replacement).
 *
 * Crafts authentic, high-contrast industrial projector, customize machine,
 * part icon tiles, mission bars, rank badges, enemy debrief icons, and emblems
 * strictly adhering to `menusprites.json` coordinates and palette index semantics:
 *   1 = darkest outline / silhouette / icon ink
 *   2 = projector canvas / recessed panel body / backdrop emblem
 *   3 = mid bevel shadow / muted tile face
 *   5 = bright parchment highlight / selected tile face / skull accent
 *   7 = crisp white mission icon / focused tile / bright debrief silhouette
 */

import type { DecodedTexture, SpriteAtlasSpec, SpriteEntry } from '../contracts/vault';
import { normalizeSpriteAtlas } from './normalizer';
import {
  PLAYER_BODY_GRIDS,
  PLAYER_ENGINE_GRIDS,
  PLAYER_WING_GRIDS,
  SpritePainter,
} from './painter';
import { VANILLA_MENU_SPRITES_RAW } from './vanilla-defaults';

function drawPadlockIcon(p: SpritePainter, pal: number): void {
  const cx = Math.floor(p.w / 2);
  const cy = Math.floor(p.h / 2);
  // Shackle arch
  p.ring(cx, cy - 4, 6, 3.5, pal);
  p.rect(cx - 7, cy - 3, 14, 5, 0);
  // Lock body
  p.rect(cx - 7, cy - 1, 14, 10, pal);
  // Keyhole cutout
  p.circle(cx, cy + 3, 2, 0);
  p.rect(cx - 1, cy + 4, 2, 3, 0);
}

function drawOmegaQuestionIcon(p: SpritePainter, pal: number): void {
  const cx = Math.floor(p.w / 2);
  const cy = Math.floor(p.h / 2);
  // Bold '?' emblem
  p.rect(cx - 5, cy - 9, 10, 3, pal);
  p.rect(cx - 6, cy - 8, 3, 4, pal);
  p.rect(cx + 3, cy - 8, 3, 6, pal);
  p.rect(cx - 1, cy - 3, 5, 3, pal);
  p.rect(cx - 2, cy - 1, 4, 4, pal);
  p.rect(cx - 2, cy + 5, 4, 4, pal);
}

function drawWeaponIcon(p: SpritePainter, partId: number, pal: number, compact = false): void {
  const cx = Math.floor(p.w / 2);
  const cy = Math.floor(p.h / 2);
  const s = compact ? 0.72 : 1.0;

  if (partId === 0) {
    // Standard twin autocannon bolt + barrel
    p.rect(cx - 10 * s, cy - 3 * s, 14 * s, 6 * s, pal);
    p.tri(cx + 11 * s, cy, cx + 3 * s, cy - 4 * s, cx + 3 * s, cy + 4 * s, pal);
    p.rect(cx - 10 * s, cy - 6 * s, 4 * s, 12 * s, pal);
    p.rect(cx - 7 * s, cy - 1, 8 * s, 2, 0);
    return;
  }
  if (partId === 1) {
    // Laser emitter prongs + focused beam
    p.rect(cx - 11 * s, cy - 6 * s, 7 * s, 12 * s, pal);
    p.rect(cx - 4 * s, cy - 6 * s, 6 * s, 3 * s, pal);
    p.rect(cx - 4 * s, cy + 3 * s, 6 * s, 3 * s, pal);
    p.rect(cx - 2 * s, cy - 1.5 * s, 13 * s, Math.max(2, Math.round(3 * s)), pal);
    p.tri(cx + 6 * s, cy - 5 * s, cx + 11 * s, cy, cx + 6 * s, cy + 5 * s, pal);
    return;
  }
  if (partId === 2) {
    // Spread 5-way fan burst
    p.circle(cx - 7 * s, cy, 4 * s, pal);
    for (const ang of [-0.55, -0.27, 0, 0.27, 0.55]) {
      const x1 = cx - 4 * s + Math.cos(ang) * 14 * s;
      const y1 = cy + Math.sin(ang) * 14 * s;
      p.line(cx - 4 * s, cy, x1, y1, pal, compact ? 1 : 2);
      p.circle(x1, y1, compact ? 1.2 : 1.8, pal);
    }
    return;
  }
  if (partId === 3) {
    // Homing missiles twin finned rockets
    for (const dy of [-4.5 * s, 4.5 * s]) {
      const y = cy + dy;
      p.rect(cx - 8 * s, y - 2 * s, 13 * s, Math.max(2, Math.round(4 * s)), pal);
      p.tri(cx + 10 * s, y, cx + 4 * s, y - 2.5 * s, cx + 4 * s, y + 2.5 * s, pal);
      p.tri(cx - 10 * s, y - 4 * s, cx - 5 * s, y - 1 * s, cx - 10 * s, y + 4 * s, pal);
    }
    return;
  }
  if (partId === 4) {
    // Heavy plasma cannon mortar barrel + energy sphere
    p.rect(cx - 11 * s, cy - 5 * s, 11 * s, 10 * s, pal);
    p.rect(cx - 11 * s, cy - 7 * s, 4 * s, 14 * s, pal);
    p.circle(cx + 6 * s, cy, 5 * s, pal);
    p.circle(cx + 6 * s, cy, 2 * s, 0);
    return;
  }
  drawOmegaQuestionIcon(p, pal);
}

function drawBodyIcon(p: SpritePainter, partId: number, pal: number, compact = false): void {
  const cx = Math.floor(p.w / 2);
  const cy = Math.floor(p.h / 2);
  const s = compact ? 0.72 : 1.0;

  if (partId === 0) {
    // Standard streamlined fuselage silhouette
    p.ellipse(cx, cy, 11 * s, 4.5 * s, pal);
    p.tri(cx - 11 * s, cy - 6 * s, cx - 5 * s, cy, cx - 11 * s, cy + 6 * s, pal);
    p.rect(cx + 1 * s, cy - 1.5 * s, 4 * s, Math.max(2, Math.round(3 * s)), 0);
    return;
  }
  if (partId === 1) {
    // Armor heavy shield / crest
    p.quad(
      cx - 8 * s,
      cy - 8 * s,
      cx + 8 * s,
      cy - 8 * s,
      cx + 8 * s,
      cy + 1 * s,
      cx - 8 * s,
      cy + 1 * s,
      pal,
    );
    p.tri(cx - 8 * s, cy + 1 * s, cx + 8 * s, cy + 1 * s, cx, cy + 10 * s, pal);
    p.rect(cx - 1 * s, cy - 5 * s, Math.max(2, Math.round(2 * s)), 11 * s, 0);
    p.rect(cx - 5 * s, cy - 2 * s, 10 * s, Math.max(2, Math.round(2 * s)), 0);
    return;
  }
  if (partId === 2) {
    // Melee serrated ramming prow / spear blade
    p.tri(cx + 11 * s, cy, cx - 5 * s, cy - 9 * s, cx - 2 * s, cy, pal);
    p.tri(cx + 11 * s, cy, cx - 5 * s, cy + 9 * s, cx - 2 * s, cy, pal);
    p.rect(cx - 10 * s, cy - 3 * s, 10 * s, 6 * s, pal);
    p.tri(cx - 11 * s, cy - 7 * s, cx - 6 * s, cy - 3 * s, cx - 11 * s, cy + 7 * s, pal);
    return;
  }
  if (partId === 3) {
    // Nuke trefoil hazard core
    p.circle(cx, cy, 9.5 * s, pal);
    p.circle(cx, cy, 7 * s, 0);
    for (let i = 0; i < 3; i++) {
      const a0 = -Math.PI / 2 + (i * Math.PI * 2) / 3;
      const a1 = a0 + 0.55;
      const a2 = a0 - 0.55;
      p.tri(
        cx,
        cy,
        cx + Math.cos(a1) * 7.5 * s,
        cy + Math.sin(a1) * 7.5 * s,
        cx + Math.cos(a2) * 7.5 * s,
        cy + Math.sin(a2) * 7.5 * s,
        pal,
      );
    }
    p.circle(cx, cy, 2.8 * s, 0);
    p.circle(cx, cy, 1.5 * s, pal);
    return;
  }
  if (partId === 4) {
    // Bomb drop ordnance silhouette
    p.ellipse(cx + 1 * s, cy, 8 * s, 6 * s, pal);
    p.tri(cx - 10 * s, cy - 6 * s, cx - 4 * s, cy, cx - 10 * s, cy + 6 * s, pal);
    p.rect(cx - 10 * s, cy - 6 * s, 3 * s, 12 * s, pal);
    p.rect(cx + 2 * s, cy - 2 * s, 3 * s, 2 * s, 0);
    return;
  }
  drawOmegaQuestionIcon(p, pal);
}

function drawEngineIcon(p: SpritePainter, partId: number, pal: number, compact = false): void {
  const cx = Math.floor(p.w / 2);
  const cy = Math.floor(p.h / 2);
  const s = compact ? 0.72 : 1.0;

  if (partId === 0) {
    // Standard jet turbine + flame plume
    p.rect(cx - 2 * s, cy - 5 * s, 11 * s, 10 * s, pal);
    p.tri(cx - 11 * s, cy, cx - 2 * s, cy - 5 * s, cx - 2 * s, cy + 5 * s, pal);
    p.tri(cx - 7 * s, cy, cx - 2 * s, cy - 2 * s, cx - 2 * s, cy + 2 * s, 0);
    return;
  }
  if (partId === 1) {
    // Superboost double chevron afterburner
    p.tri(cx + 10 * s, cy, cx + 1 * s, cy - 8 * s, cx + 4 * s, cy, pal);
    p.tri(cx + 10 * s, cy, cx + 1 * s, cy + 8 * s, cx + 4 * s, cy, pal);
    p.tri(cx + 2 * s, cy, cx - 7 * s, cy - 8 * s, cx - 4 * s, cy, pal);
    p.tri(cx + 2 * s, cy, cx - 7 * s, cy + 8 * s, cx - 4 * s, cy, pal);
    p.rect(cx - 11 * s, cy - 2 * s, 6 * s, 4 * s, pal);
    return;
  }
  if (partId === 2) {
    // Gungine rear-firing twin recoil barrels + shell burst
    p.rect(cx + 1 * s, cy - 6 * s, 8 * s, 12 * s, pal);
    p.rect(cx - 8 * s, cy - 5 * s, 9 * s, 3 * s, pal);
    p.rect(cx - 8 * s, cy + 2 * s, 9 * s, 3 * s, pal);
    p.circle(cx - 10 * s, cy - 3.5 * s, 1.8 * s, pal);
    p.circle(cx - 10 * s, cy + 3.5 * s, 1.8 * s, pal);
    return;
  }
  if (partId === 3) {
    // Underwater spinning marine propeller + wave
    p.circle(cx, cy, 3 * s, pal);
    p.ellipse(cx, cy - 6 * s, 3 * s, 4.5 * s, pal);
    p.ellipse(cx, cy + 6 * s, 3 * s, 4.5 * s, pal);
    p.ellipse(cx - 6 * s, cy, 4.5 * s, 3 * s, pal);
    p.ellipse(cx + 6 * s, cy, 4.5 * s, 3 * s, pal);
    p.circle(cx, cy, 1.5 * s, 0);
    return;
  }
  if (partId === 4) {
    // Hover gyro ring + stabilization cross
    p.ring(cx, cy, 9.5 * s, 6 * s, pal);
    p.circle(cx, cy, 3 * s, pal);
    p.hline(cx - 10 * s, cx + 10 * s, cy, pal);
    p.vline(cx, cy - 10 * s, cy + 10 * s, pal);
    return;
  }
  drawOmegaQuestionIcon(p, pal);
}

function drawEnemyDebriefIcon(p: SpritePainter, kindIdx: number, pal: number): void {
  // Right-aligned crisp silhouettes inside 40x16 matching sheet2grey enemy_icons layout
  const cy = 8;
  switch (kindIdx) {
    case 0: // '?' mystery / any
      p.rect(32, 2, 6, 2, pal);
      p.rect(31, 3, 2, 3, pal);
      p.rect(36, 3, 2, 4, pal);
      p.rect(34, 6, 3, 2, pal);
      p.rect(34, 8, 2, 2, pal);
      p.rect(34, 12, 2, 2, pal);
      break;
    case 1: // Fighter
      p.rect(26, 7, 13, 2, pal);
      p.rect(31, 2, 3, 12, pal);
      p.rect(26, 5, 2, 6, pal);
      break;
    case 2: // Small Boat
      p.quad(23, 14, 38, 14, 39, 10, 22, 10, pal);
      p.rect(28, 6, 6, 4, pal);
      p.vline(31, 3, 6, pal);
      break;
    case 3: // Jet
      p.rect(25, 7, 14, 2, pal);
      p.tri(37, 8, 29, 2, 31, 8, pal);
      p.tri(37, 8, 29, 14, 31, 8, pal);
      break;
    case 4: // Big Boat / Battleship
      p.quad(2, 14, 37, 14, 39, 9, 1, 9, pal);
      p.rect(12, 5, 14, 5, pal);
      p.rect(15, 2, 3, 4, pal);
      p.rect(21, 2, 3, 4, pal);
      p.rect(6, 7, 4, 2, pal);
      p.rect(29, 7, 4, 2, pal);
      break;
    case 5: // Ace
      p.rect(22, 6, 17, 4, pal);
      p.tri(36, 8, 26, 1, 30, 8, pal);
      p.tri(36, 8, 26, 15, 30, 8, pal);
      p.rect(22, 3, 4, 10, pal);
      break;
    case 6: // Submarine
      p.ellipse(21, 12, 18, 3, pal);
      p.rect(15, 5, 8, 6, pal);
      p.vline(19, 2, 5, pal);
      break;
    case 7: // Enemy Missile (finned torpedo rocket, matching sheet2grey f7/f16)
      p.rect(18, 6, 18, 4, pal);
      p.tri(39, 8, 35, 6, 35, 10, pal);
      p.tri(15, 2, 23, 6, 17, 6, pal);
      p.tri(15, 14, 23, 10, 17, 10, pal);
      break;
    default: // Blimp
      p.ellipse(21, 7, 18, 6, pal);
      p.rect(1, 2, 6, 10, pal);
      p.rect(14, 12, 12, 3, pal);
      p.px(2, cy, pal);
      break;
  }
}

function drawLevelBadge(p: SpritePainter, rankIdx: number): void {
  const cx = 12;
  const cy = 12;
  // Shield / badge backing
  p.circle(cx, cy, 10, 1);
  p.circle(cx, cy, 8, 2);
  p.ring(cx, cy, 9, 8, 3);

  const chevrons = Math.min(3, (rankIdx % 3) + 1);
  const tier = Math.floor(rankIdx / 3);
  if (tier === 0) {
    // Aviation chevrons
    for (let i = 0; i < chevrons; i++) {
      const y = cy + 3 - i * 4;
      p.line(cx - 5, y + 2, cx, y - 2, 5, 2);
      p.line(cx + 5, y + 2, cx, y - 2, 5, 2);
    }
  } else if (tier === 1) {
    // Winged star
    p.tri(cx, cy - 6, cx - 2, cy, cx + 2, cy, 5);
    p.tri(cx - 6, cy - 1, cx + 6, cy - 1, cx, cy + 4, 5);
    p.tri(cx - 4, cy + 5, cx, cy + 1, cx + 4, cy + 5, 5);
    if (chevrons >= 2) {
      p.hline(cx - 7, cx - 3, cy - 4, 5);
      p.hline(cx + 3, cx + 7, cy - 4, 5);
    }
    if (chevrons >= 3) {
      p.hline(cx - 6, cx + 6, cy + 6, 5);
    }
  } else {
    // Winged ace crown / laurel
    p.tri(cx - 7, cy - 2, cx - 2, cy + 2, cx - 6, cy + 5, 5);
    p.tri(cx + 7, cy - 2, cx + 2, cy + 2, cx + 6, cy + 5, 5);
    p.circle(cx, cy, 4, 5);
    p.circle(cx, cy, 2, 1);
    if (rankIdx >= 9) {
      p.hline(cx - 5, cx + 5, cy - 6, 5);
      p.px(cx, cy - 8, 5);
    }
  }
}

function drawCustomizeButton(p: SpritePainter, frameIdx: number): void {
  const w = p.w;
  const h = p.h;
  if (frameIdx === 0) {
    // Dark recessed empty slot
    p.rect(1, 1, w - 2, h - 2, 1);
    return;
  }
  const facePal = frameIdx === 2 ? 7 : frameIdx === 1 ? 5 : 3;
  const hiPal = frameIdx === 2 ? 7 : 5;
  const shadePal = frameIdx >= 3 ? 1 : 2;
  p.bevelBox(1, 1, w - 2, h - 2, facePal, 1, hiPal, shadePal);
  // Crisp corner rivets
  p.px(3, 3, 2);
  p.px(w - 4, 3, 2);
  p.px(3, h - 4, 2);
  p.px(w - 4, h - 4, 2);

  if (frameIdx === 3) {
    // Locked button: tan face with dark padlock icon (matching sheet2grey f3)
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    p.ring(cx, cy - 3, 5, 3, 1);
    p.rect(cx - 6, cy - 2, 12, 4, facePal);
    p.rect(cx - 6, cy - 1, 12, 9, 1);
    p.circle(cx, cy + 3, 1.5, facePal);
    p.rect(cx - 1, cy + 4, 2, 2, facePal);
  } else if (frameIdx === 4) {
    // Secret/Overdrive locked button: tan face with dark skull emblem (matching sheet2grey f4)
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    p.circle(cx, cy - 1, 6.5, 1);
    p.rect(cx - 4, cy + 3, 8, 5, 1);
    p.circle(cx - 2.5, cy - 1, 1.6, facePal);
    p.circle(cx + 2.5, cy - 1, 1.6, facePal);
    p.px(cx, cy + 2, facePal);
    p.px(cx - 2, cy + 6, facePal);
    p.px(cx, cy + 6, facePal);
    p.px(cx + 2, cy + 6, facePal);
  }
}

function drawMissionFrame(p: SpritePainter, frameIdx: number): void {
  const w = p.w;
  const h = p.h;
  if (frameIdx === 1) {
    // Mission-complete white flash frame
    p.rect(0, 0, w, h, 7);
    return;
  }
  const fillPal = frameIdx === 0 ? 1 : frameIdx === 2 ? 7 : frameIdx === 3 ? 5 : 2;
  const borderPal = frameIdx === 2 ? 3 : 1;
  const hiPal = frameIdx === 0 ? 3 : frameIdx === 2 ? 5 : 5;
  const shadePal = frameIdx === 0 ? 1 : 3;
  p.bevelBox(0, 0, w, h, fillPal, borderPal, hiPal, shadePal);
  // Left mission-icon bay divider + rivets
  p.vline(26, 2, h - 3, borderPal);
  p.vline(27, 2, h - 3, hiPal);
  p.px(w - 4, 3, shadePal);
  p.px(w - 4, h - 4, shadePal);
}

function drawProjectorTop(p: SpritePainter): void {
  const w = p.w;
  const h = p.h;
  // Heavy steel overhead projector roller housing
  p.rect(0, 0, w, h, 3);
  p.rect(0, 0, w, 4, 5); // top specular bevel
  p.rect(0, 4, w, 3, 3);
  p.rect(0, 7, w, 14, 2); // recessed cylindrical body
  p.hline(0, w - 1, 11, 3);
  p.hline(0, w - 1, 12, 5); // metallic sheen band
  p.rect(0, 21, w, 4, 3);
  p.rect(0, 25, w, 5, 1); // dark underside roller slot shadow
  // End-cap brackets & industrial rivets
  p.rect(0, 0, 22, h, 1);
  p.rect(3, 3, 16, h - 6, 3);
  p.rect(w - 22, 0, 22, h, 1);
  p.rect(w - 19, 3, 16, h - 6, 3);
  for (let x = 40; x < w - 30; x += 56) {
    p.rect(x, 6, 4, 4, 1);
    p.px(x + 1, 7, 5);
    p.rect(x, 22, 4, 3, 1);
  }
}

function drawProjectorRope(p: SpritePainter): void {
  const cx = 10;
  // Braided cord descending from center
  p.rect(cx - 2, 0, 4, 18, 1);
  p.rect(cx - 1, 0, 2, 18, 3);
  for (let y = 2; y < 17; y += 4) {
    p.px(cx - 1, y, 5);
  }
  // Pull-ring handle at bottom
  p.ring(cx, 25, 8, 4.5, 1);
  p.ring(cx, 25, 7, 5.5, 3);
  p.hline(cx - 4, cx + 3, 19, 5);
}

function drawProjectorLightEdge(p: SpritePainter, frameIdx: number): void {
  const w = p.w;
  const h = p.h;
  // Left-side projector beam edge wedge (mirrored via scaleX=-1 on right side; f0/f1 subtle shimmer)
  const inset = frameIdx === 0 ? 0 : 4;
  p.tri(0, 0, w - 1 - inset, 0, 0, h - 1, 2);
}

function drawCustomizeMachine(p: SpritePainter): void {
  const w = p.w;
  const h = p.h;
  // Heavy riveted hangar assembly crane/frame (160x225)
  p.bevelBox(6, 4, w - 12, h - 8, 3, 1, 5, 2);
  // Central recessed aircraft bay cavity
  p.bevelBox(20, 26, w - 40, h - 52, 2, 1, 1, 5);
  // Top & bottom mechanical clamp teeth
  p.rect(30, 8, w - 60, 14, 1);
  p.rect(34, 11, w - 68, 8, 5);
  p.rect(30, h - 22, w - 60, 14, 1);
  p.rect(34, h - 19, w - 68, 8, 5);
  // Side rail bolts
  for (let y = 16; y < h - 16; y += 22) {
    p.rect(10, y, 5, 5, 1);
    p.px(11, y + 1, 5);
    p.rect(w - 15, y, 5, 5, 1);
    p.px(w - 14, y + 1, 5);
  }
  // Crosshair tick marks inside bay
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  p.hline(24, 34, cy, 3);
  p.hline(w - 34, w - 24, cy, 3);
  p.vline(cx, 30, 40, 3);
  p.vline(cx, h - 40, h - 30, 3);
}

function drawCustomizeScreen(p: SpritePainter, isRight: boolean): void {
  const w = p.w;
  const h = p.h;
  // Beveled display viewport frame (195x102)
  p.bevelBox(0, 0, w, h, 2, 1, 5, 3);
  p.bevelBox(5, 5, w - 10, h - 10, 2, 1, 3, 5);
  // Side mounting lugs
  const lugX = isRight ? 0 : w - 6;
  p.rect(lugX, 14, 6, 18, 1);
  p.rect(lugX + 1, 16, 4, 14, 5);
  p.rect(lugX, h - 32, 6, 18, 1);
  p.rect(lugX + 1, h - 30, 4, 14, 5);
  // Subtle blueprint corner ticks
  p.hline(10, 18, 10, 3);
  p.vline(10, 10, 18, 3);
  p.hline(w - 18, w - 10, 10, 3);
  p.vline(w - 10, 10, 18, 3);
  p.hline(10, 18, h - 10, 3);
  p.vline(10, h - 18, h - 10, 3);
  p.hline(w - 18, w - 10, h - 10, 3);
  p.vline(w - 10, h - 18, h - 10, 3);
}

function drawPlaneIconPart(
  p: SpritePainter,
  category: 'body' | 'engine' | 'weapon',
  frameIdx: number,
): void {
  if (frameIdx >= 5) {
    drawOmegaQuestionIcon(p, 7);
    return;
  }
  const grids =
    category === 'engine'
      ? PLAYER_ENGINE_GRIDS
      : category === 'body'
        ? PLAYER_BODY_GRIDS
        : PLAYER_WING_GRIDS;
  const grid = grids[frameIdx] ?? grids[0]!;
  // 1px dark drop shadow underneath + crisp bright 7 silhouette on top
  p.gridSymY(grid, undefined, 0, 1, { '1': 1 });
  p.gridSymY(grid, undefined, 0, 0, { '1': 7 });
}

function drawKeyboardKeycap(p: SpritePainter, frameIdx: number): void {
  // 13x13 crisp keycap: 0=Left, 1=Right, 2=Up, 3=Down, 4=Fire/Action
  p.bevelBox(0, 0, 13, 13, 3, 1, 5, 2);
  if (frameIdx === 0) {
    p.tri(3, 6, 9, 3, 9, 9, 7);
  } else if (frameIdx === 1) {
    p.tri(9, 6, 3, 3, 3, 9, 7);
  } else if (frameIdx === 2) {
    p.tri(6, 3, 3, 9, 9, 9, 7);
  } else if (frameIdx === 3) {
    p.tri(6, 9, 3, 3, 9, 3, 7);
  } else {
    p.circle(6, 6, 3, 7);
  }
}

function drawSkullsBanner(p: SpritePainter, frameIdx: number): void {
  // 64x14 Overdrive skull & chevron indicator (palette 5)
  const count = Math.min(5, frameIdx + 1);
  for (let i = 0; i < count; i++) {
    const sx = 6 + i * 12;
    p.circle(sx, 6, 4, 5);
    p.rect(sx - 2, 9, 5, 3, 5);
    p.px(sx - 2, 5, 0);
    p.px(sx + 2, 5, 0);
    p.px(sx, 8, 0);
  }
}

function drawSfmtProjectorBackdrop(p: SpritePainter): void {
  // 441x258 dramatic Overdrive winged-skull watermark silhouette in index 2
  const cx = p.w * 0.5;
  const cy = p.h * 0.46;
  // Swept wide emblem wings
  p.tri(cx - 24, cy - 16, 18, cy - 68, cx - 36, cy + 24, 2);
  p.tri(cx + 24, cy - 16, p.w - 18, cy - 68, cx + 36, cy + 24, 2);
  p.tri(cx - 28, cy + 4, 54, cy + 44, cx - 22, cy + 36, 2);
  p.tri(cx + 28, cy + 4, p.w - 54, cy + 44, cx + 22, cy + 36, 2);
  // Stylized cranium silhouette with crisp hollow sockets
  p.circle(cx, cy - 10, 56, 2);
  p.rect(cx - 34, cy + 26, 68, 42, 2);
  p.circle(cx - 22, cy - 6, 14, 0);
  p.circle(cx + 22, cy - 6, 14, 0);
  p.tri(cx, cy + 6, cx - 8, cy + 22, cx + 8, cy + 22, 0);
  for (let tx = -22; tx <= 22; tx += 11) {
    p.rect(cx + tx - 2, cy + 42, 4, 24, 0);
  }
}

function drawSkybreakerCrest(p: SpritePainter): void {
  const w = p.w;
  const h = p.h;
  const cx = w * 0.5;
  // Clean original winged chevron emblem & framed nameplate banner
  p.bevelBox(w * 0.08, h * 0.42, w * 0.84, h * 0.3, 2, 1, 5, 3);
  p.rect(w * 0.12, h * 0.47, w * 0.76, h * 0.2, 1);
  // Swept twin emblem wings rising above banner
  p.tri(cx, h * 0.14, cx - w * 0.28, h * 0.42, cx - w * 0.05, h * 0.42, 5);
  p.tri(cx, h * 0.14, cx + w * 0.28, h * 0.42, cx + w * 0.05, h * 0.42, 5);
  p.tri(cx, h * 0.23, cx - w * 0.16, h * 0.42, cx + w * 0.16, h * 0.42, 3);
  p.tri(cx, h * 0.3, cx - w * 0.08, h * 0.42, cx + w * 0.08, h * 0.42, 1);
}

function drawProceduralMenuSprite(
  rgba: Uint8Array,
  texW: number,
  texH: number,
  entry: SpriteEntry,
  fx: number,
  fy: number,
  frameIdx: number,
): void {
  const [w, h] = entry.size;
  if (w <= 0 || h <= 0) return;
  const p = new SpritePainter(rgba, texW, texH, fx, fy, w, h);
  const name = entry.name.toLowerCase();

  if (name === 'main_colors') {
    if (frameIdx > 0) p.px(0, 0, Math.min(7, frameIdx));
    return;
  }
  if (name === 'stiplle_lines') {
    p.px(0, 0, 1);
    return;
  }
  if (name === 'projector_bg') {
    p.px(0, 0, frameIdx === 0 ? 2 : 3);
    return;
  }
  if (name === 'projector_top') {
    drawProjectorTop(p);
    return;
  }
  if (name === 'projector_btm') {
    p.rect(0, 0, w, h, 1);
    return;
  }
  if (name === 'projector_btm_rope') {
    drawProjectorRope(p);
    return;
  }
  if (name === 'projector_lightedge') {
    drawProjectorLightEdge(p, frameIdx);
    return;
  }
  if (name === 'customize_machinebtm' || name === 'customize_machinetop') {
    drawCustomizeMachine(p);
    return;
  }
  if (name === 'customize_machinecenter') {
    p.rect(0, 0, w, h, 1);
    p.rect(6, 4, w - 12, h - 8, 2);
    for (let y = 12; y < h - 12; y += 20) {
      p.hline(8, w - 9, y, 1);
    }
    return;
  }
  if (name === 'customize_scr_left' || name === 'customize_scr_right') {
    drawCustomizeScreen(p, name === 'customize_scr_right');
    return;
  }
  if (name === 'customize_buttons') {
    drawCustomizeButton(p, frameIdx);
    return;
  }
  if (name === 'customize_buttons_chain') {
    p.rect(0, 0, w, h, 1);
    return;
  }
  if (name === 'customize_weapons') {
    if (frameIdx === 0) drawPadlockIcon(p, 1);
    else drawWeaponIcon(p, frameIdx - 1, 1, false);
    return;
  }
  if (name === 'customize_bodies') {
    if (frameIdx === 0) drawPadlockIcon(p, 1);
    else drawBodyIcon(p, frameIdx - 1, 1, false);
    return;
  }
  if (name === 'customize_engines') {
    if (frameIdx === 0) drawPadlockIcon(p, 1);
    else drawEngineIcon(p, frameIdx - 1, 1, false);
    return;
  }
  if (name === 'customize_weapons_mis') {
    drawWeaponIcon(p, frameIdx, 7, true);
    return;
  }
  if (name === 'customize_bodies_mis') {
    drawBodyIcon(p, frameIdx, 7, true);
    return;
  }
  if (name === 'customize_engines_mis') {
    drawEngineIcon(p, frameIdx, 7, true);
    return;
  }
  if (name === 'plane_icon_body') {
    drawPlaneIconPart(p, 'body', frameIdx);
    return;
  }
  if (name === 'plane_icon_engine') {
    drawPlaneIconPart(p, 'engine', frameIdx);
    return;
  }
  if (name === 'plane_icon_weapon') {
    drawPlaneIconPart(p, 'weapon', frameIdx);
    return;
  }
  if (name === 'title_bg_panel') {
    p.bevelBox(0, 0, w, h, 2, 1, 5, 3);
    p.bevelBox(4, 4, w - 8, h - 8, 2, 1, 3, 5);
    for (const [rx, ry] of [
      [8, 8],
      [w - 11, 8],
      [8, h - 11],
      [w - 11, h - 11],
    ] as const) {
      p.rect(rx, ry, 3, 3, 1);
      p.px(rx + 1, ry + 1, 5);
    }
    return;
  }
  if (name === 'mission_frame') {
    drawMissionFrame(p, frameIdx);
    return;
  }
  if (name === 'mission_bg_panel') {
    drawMissionFrame(p, 0);
    return;
  }
  if (name === 'loading_frame') {
    if (frameIdx === 0) {
      p.bevelBox(0, 0, w, h, 4, 1, 5, 3);
    } else if (frameIdx === 1) {
      p.rect(4, 4, w - 8, h - 8, 2);
    } else {
      p.rect(0, 0, w, h, 7);
    }
    return;
  }
  if (name === 'mission_frame_progress') {
    p.rect(0, 0, w, h, 2);
    return;
  }
  if (name === 'unlock_mission_frame') {
    p.bevelBox(0, 0, w, h, 2, 1, 5, 3);
    p.bevelBox(6, 6, w - 12, h - 12, 2, 1, 3, 5);
    p.hline(12, w - 13, 34, 1);
    p.hline(12, w - 13, 35, 5);
    return;
  }
  if (name === 'enemy_icons') {
    const pal = frameIdx < 9 ? 7 : 1;
    drawEnemyDebriefIcon(p, frameIdx % 9, pal);
    return;
  }
  if (name === 'level_badges') {
    drawLevelBadge(p, frameIdx);
    return;
  }
  if (name === 'skulls_stuff') {
    drawSkullsBanner(p, frameIdx);
    return;
  }
  if (name === 'sfmt_projector_bg') {
    drawSfmtProjectorBackdrop(p);
    return;
  }
  if (name === 'btns_keyboard_lrudf') {
    drawKeyboardKeycap(p, frameIdx);
    return;
  }
  if (name === 'new_blink') {
    // Bold 'NEW' tag
    p.rect(0, 0, w, h, 1);
    const pal = frameIdx % 2 === 0 ? 5 : 7;
    // N
    p.vline(2, 2, 7, pal);
    p.line(2, 2, 5, 7, pal);
    p.vline(5, 2, 7, pal);
    // E
    p.vline(8, 2, 7, pal);
    p.hline(8, 11, 2, pal);
    p.hline(8, 10, 4, pal);
    p.hline(8, 11, 7, pal);
    // W
    p.vline(13, 2, 7, pal);
    p.vline(15, 4, 7, pal);
    p.vline(17, 2, 7, pal);
    p.hline(13, 17, 7, pal);
    return;
  }
  if (name === 'unlock_palette_icon') {
    // 7-band palette swatch wheel
    for (let i = 0; i < 7; i++) {
      p.rect(2 + i * 2 + (i > 3 ? 2 : 0), 3, 3, h - 6, i + 1);
    }
    p.hline(1, w - 2, 2, 1);
    p.hline(1, w - 2, h - 3, 1);
    p.vline(1, 2, h - 3, 1);
    p.vline(w - 2, 2, h - 3, 1);
    return;
  }
  if (name === 'save_icon') {
    p.bevelBox(3, 3, w - 6, h - 6, 3, 1, 5, 2);
    p.rect(7, 4, w - 14, 9, 5);
    p.rect(8, h - 12, w - 16, 8, 1);
    return;
  }
  if (name === 'sfmt_unlock') {
    p.circle(10, 9, 7, 7);
    p.rect(6, 13, 8, 5, 7);
    p.circle(7, 8, 2, 0);
    p.circle(13, 8, 2, 0);
    p.px(10, 11, 0);
    return;
  }
  if (name === 'menu_wings') {
    const dir = frameIdx === 0 ? 1 : -1;
    const x0 = dir > 0 ? 1 : w - 2;
    p.tri(x0, 2, x0 + dir * 14, 5, x0 + dir * 4, 13, 1);
    p.tri(x0 + dir * 2, 4, x0 + dir * 12, 6, x0 + dir * 5, 11, 7);
    return;
  }
  if (name === 'skybreaker_logo' || name === 'luftrausers_logo') {
    drawSkybreakerCrest(p);
    return;
  }
  if (name === 'brand_emblem' || name === 'studio_logo') {
    p.bevelBox(8, 8, w - 16, h - 16, 2, 1, 5, 3);
    p.tri(w * 0.5, h * 0.2, w * 0.2, h * 0.72, w * 0.8, h * 0.72, 1);
    return;
  }
  if (name === 'minifaces' || name === 'credit_heads') {
    const cx = w * 0.5;
    const cy = h * 0.48;
    p.circle(cx, cy, Math.min(w, h) * 0.36, 3);
    p.circle(cx, cy - h * 0.08, Math.min(w, h) * 0.34, 5);
    p.rect(cx - w * 0.22, cy - h * 0.14, w * 0.44, h * 0.14, 1);
    p.circle(cx - w * 0.1, cy - h * 0.07, Math.max(1, w * 0.07), 7);
    p.circle(cx + w * 0.1, cy - h * 0.07, Math.max(1, w * 0.07), 7);
    return;
  }

  // Fallback beveled tile
  p.bevelBox(0, 0, w, h, 2, 1, 5, 3);
}

/**
 * Generates a clean-room 2048x1024 RGBA8 menu texture (`sheet2grey.png` replacement)
 * conforming to `menusprites.json` coordinates and authentic 8-level palette indices.
 */
export function createProceduralMenuTexture(atlas?: SpriteAtlasSpec): DecodedTexture {
  const resolvedAtlas =
    atlas ?? normalizeSpriteAtlas('menusprites', VANILLA_MENU_SPRITES_RAW, 2048, 1024);
  const width = resolvedAtlas.width || 2048;
  const height = resolvedAtlas.height || 1024;
  const rgba = new Uint8Array(width * height * 4);

  for (const entry of Object.values(resolvedAtlas.sprites)) {
    const [w, h] = entry.size;
    if (w <= 0 || h <= 0) continue;
    entry.subs.forEach((frame, idx) => {
      drawProceduralMenuSprite(rgba, width, height, entry, frame.x, frame.y, idx);
    });
  }

  return {
    name: 'menusprites',
    width,
    height,
    rgba,
    source: 'procedural',
  };
}
