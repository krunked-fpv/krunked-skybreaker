import {
  VIRTUAL_HEIGHT,
  VIRTUAL_WIDTH,
  type PaletteDefinition,
  type PostShaderUniforms,
} from '../contracts/render';
import type { SimSnapshot } from '../contracts/sim';

export const BATCH_VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 iWorldPosAngle; // x, y, angleRad
layout(location = 2) in vec4 iAtlasRect;     // ax, ay, w, h
layout(location = 3) in vec4 iCenterScale;   // cx, cy, sx, sy
layout(location = 4) in vec2 iDepthFlash;    // depth, flash

uniform mat4 uViewProjMatrix;
uniform vec2 uSpritesheetSize;

out vec4 vWorldPos;
out vec2 vTexCoords;
out float vFlash;

void main() {
  vec2 uv01 = aCorner;
  vec2 localPx = (uv01 * iAtlasRect.zw - iCenterScale.xy) * iCenterScale.zw;

  float c = cos(iWorldPosAngle.z);
  float s = sin(iWorldPosAngle.z);
  vec2 rotated = vec2(
    localPx.x * c - localPx.y * s,
    localPx.x * s + localPx.y * c
  );

  vec4 pos = vec4(floor(rotated + iWorldPosAngle.xy + 0.5), iDepthFlash.x, 1.0);
  vWorldPos = pos;
  vTexCoords = (iAtlasRect.xy + uv01 * iAtlasRect.zw) / uSpritesheetSize;
  vFlash = iDepthFlash.y;
  gl_Position = uViewProjMatrix * pos;
}
`;

export const BATCH_REFLECT_VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 iWorldPosAngle; // x, y, angleRad
layout(location = 2) in vec4 iAtlasRect;     // ax, ay, w, h
layout(location = 3) in vec4 iCenterScale;   // cx, cy, sx, sy
layout(location = 4) in vec2 iDepthFlash;    // depth, flash

uniform mat4 uViewProjMatrix;
uniform vec2 uSpritesheetSize;

out vec4 vWorldPos;
out vec2 vTexCoords;
out float vFlash;

void main() {
  vec2 uv01 = aCorner;
  vec2 localPx = (uv01 * iAtlasRect.zw - iCenterScale.xy) * iCenterScale.zw;

  float c = cos(iWorldPosAngle.z);
  float s = sin(iWorldPosAngle.z);
  vec2 rotated = vec2(
    localPx.x * c - localPx.y * s,
    localPx.x * s + localPx.y * c
  );

  vec4 pos = vec4(floor(rotated + iWorldPosAngle.xy + 0.5), iDepthFlash.x, 1.0);
  pos.y = -pos.y;
  vWorldPos = pos;
  vTexCoords = (iAtlasRect.xy + uv01 * iAtlasRect.zw) / uSpritesheetSize;
  vFlash = iDepthFlash.y;
  gl_Position = uViewProjMatrix * pos;
}
`;

export const BATCH_FRAG = `#version 300 es
precision highp float;

uniform sampler2D diffuseTex;
uniform vec4 uniform_colors[8];
uniform float uClipSea;

in vec4 vWorldPos;
in vec2 vTexCoords;
in float vFlash;

out vec4 fragColor;

void main() {
  if (vTexCoords.x < 0.0 || vTexCoords.y < 0.0 || vTexCoords.x > 1.0 || vTexCoords.y > 1.0) {
    discard;
  }
  vec4 diffuse = texture(diffuseTex, vTexCoords);
  if (diffuse.rgb == vec3(0.0) || diffuse.a == 0.0) {
    discard;
  }
  if (uClipSea > 0.5 && vWorldPos.y > 0.0) {
    discard;
  }

  int thecolind = clamp(int(diffuse.r * 8.0), 0, 7);
  if (thecolind == 0) {
    discard;
  }
  vec4 outdiffuse = uniform_colors[thecolind];
  if (vFlash > 0.5) {
    outdiffuse = uniform_colors[7];
  }
  fragColor = outdiffuse;
}
`;

export const BATCH_REFLECT_FRAG = `#version 300 es
precision highp float;

uniform sampler2D diffuseTex;
uniform vec4 uniform_colors[8];

in vec4 vWorldPos;
in vec2 vTexCoords;
in float vFlash;

out vec4 fragColor;

void main() {
  if (vTexCoords.x < 0.0 || vTexCoords.y < 0.0 || vTexCoords.x > 1.0 || vTexCoords.y > 1.0) {
    discard;
  }
  vec4 diffuse = texture(diffuseTex, vTexCoords);
  if (diffuse.rgb == vec3(0.0) || diffuse.a == 0.0) {
    discard;
  }
  if (vWorldPos.y < 0.0) {
    discard;
  }

  int thecolind = clamp(int(diffuse.r * 8.0), 0, 7);
  if (thecolind == 0) {
    discard;
  }
  vec4 outdiffuse = uniform_colors[thecolind];
  if (vFlash > 0.5) {
    outdiffuse = uniform_colors[7];
  }
  fragColor = outdiffuse;
}
`;

export const BATCH_MENU_VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 iWorldPosAngle; // x, y, angleRad
layout(location = 2) in vec4 iAtlasRect;     // ax, ay, w, h
layout(location = 3) in vec4 iCenterScale;   // cx, cy, sx, sy
layout(location = 4) in vec2 iDepthFlash;    // depth, flash

uniform mat4 uViewProjMatrix;
uniform vec2 uSpritesheetSize;

out vec4 vWorldPos;
out vec2 vTexCoords;
out float vFlash;

void main() {
  vec2 uv01 = aCorner;
  vec2 localPx = (uv01 * iAtlasRect.zw - iCenterScale.xy) * iCenterScale.zw;

  float c = cos(iWorldPosAngle.z);
  float s = sin(iWorldPosAngle.z);
  vec2 rotated = vec2(
    localPx.x * c - localPx.y * s,
    localPx.x * s + localPx.y * c
  );

  vec4 pos = vec4(floor(rotated + iWorldPosAngle.xy + 0.5), iDepthFlash.x, 1.0);
  vWorldPos = pos;
  vTexCoords = (iAtlasRect.xy + uv01 * iAtlasRect.zw) / uSpritesheetSize;
  vFlash = iDepthFlash.y;
  gl_Position = uViewProjMatrix * pos;
}
`;

export const BATCH_MENU_FRAG = `#version 300 es
precision highp float;

uniform sampler2D diffuseTex;
uniform vec4 uniform_colors[8];

in vec4 vWorldPos;
in vec2 vTexCoords;
in float vFlash;

out vec4 fragColor;

void main() {
  vec2 texc = vTexCoords;
  if (texc.x < 0.0 || texc.y < 0.0 || texc.y > 1.0 || texc.x >= 2.0) {
    discard;
  }
  float colv;
  if (texc.x >= 1.0) {
    texc.x -= 1.0;
    vec4 s = texture(diffuseTex, texc);
    if (s.a == 0.0) {
      discard;
    }
    colv = s.b;
  } else {
    vec4 s = texture(diffuseTex, texc);
    if (s.a == 0.0) {
      discard;
    }
    colv = s.r;
  }
  if (colv == 0.0) {
    discard;
  }

  int thecolind = clamp(int(colv * 8.0), 0, 7);
  if (thecolind == 0) {
    discard;
  }
  vec4 outdiffuse = uniform_colors[thecolind];
  if (vFlash > 0.5) {
    outdiffuse = uniform_colors[7];
  }
  fragColor = outdiffuse;
}
`;

export const POST_WATER_VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aPosition;

out vec4 vNdc;
out vec2 vTexCoords;

void main() {
  vTexCoords = (aPosition + 1.0) * 0.5;
  vNdc = vec4(aPosition, 0.0, 1.0);
  gl_Position = vNdc;
}
`;

export const POST_WATER_FRAG = `#version 300 es
precision highp float;

uniform sampler2D colorTexture;
uniform vec2 viewport;
uniform vec4 cameraPosition;
uniform vec4 healthRadius;
uniform vec4 playerPosition;
uniform vec4 cameraWorldPosition;
uniform vec4 delta;
uniform vec4 uniform_colors[8];
uniform vec4 uniform_backcol;

in vec4 vNdc;
in vec2 vTexCoords;

out vec4 fragColor;

void main() {
  vec2 pixelPosition = cameraWorldPosition.xy - vNdc.xy * vec2(-300.0, 200.0);
  vec2 playerToPixel = floor((playerPosition.xy - pixelPosition) * 0.5) * 2.0;
  float distanceToPlayer = length(playerToPixel) / 350.0;

  float healthAmount = healthRadius.x / max(healthRadius.y, 0.0001);
  if (healthAmount > 0.99) {
    healthAmount = 1000.0;
  }

  vec2 texCoords = vec2(vTexCoords.x, 1.0 - vTexCoords.y);
  float cameraYViewSpace = cameraPosition.x;
  float seaExpr = texCoords.y + (cameraYViewSpace - 0.5);

  vec4 finalColor = texture(colorTexture, vTexCoords);

  if (seaExpr > 0.0) {
    float colDelta = 0.01;
    if (length(finalColor.rgb - uniform_colors[1].rgb) < colDelta) {
      finalColor = uniform_colors[3];
    } else if (length(finalColor.rgb - uniform_colors[2].rgb) < colDelta) {
      finalColor = uniform_colors[3];
    } else if (length(finalColor.rgb - uniform_colors[4].rgb) < colDelta) {
      finalColor = uniform_backcol;
    } else if (length(finalColor.rgb - uniform_colors[5].rgb) < colDelta) {
      finalColor = uniform_colors[6];
    } else if (length(finalColor.rgb - uniform_colors[6].rgb) < colDelta) {
      finalColor = uniform_backcol;
    } else if (length(finalColor.rgb - uniform_colors[7].rgb) < colDelta) {
      finalColor = uniform_colors[6];
    }
  }

  vec4 outColor;
  if (finalColor.a == 0.0) {
    if (healthAmount < distanceToPlayer && seaExpr < 0.0) {
      outColor = (healthRadius.z >= 0.5 || healthRadius.w >= 1.5)
        ? uniform_colors[7]
        : uniform_colors[6];
    } else {
      outColor = uniform_backcol;
    }
  } else {
    outColor = finalColor;
  }

  // Subtle flash tint during nuke detonation sequence
  if (delta.y > 0.0) {
    float flashMix = clamp(delta.y / 14.0, 0.0, 0.55);
    outColor = mix(outColor, uniform_colors[7], flashMix);
  }

  fragColor = outColor;
}
`;

export const FONT_VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec2 aTexCoords;

uniform mat4 viewProjMatrix;

out vec4 vPosition;
out vec2 vTexCoords;

void main() {
  vec4 pos4 = vec4(aPosition, 0.0, 1.0);
  vPosition = pos4;
  vTexCoords = aTexCoords;
  gl_Position = viewProjMatrix * pos4;
}
`;

export const FONT_FRAG = `#version 300 es
precision highp float;

uniform sampler2D diffuseTex;
uniform vec4 textColor;
uniform vec4 cutoff;

in vec4 vPosition;
in vec2 vTexCoords;

out vec4 fragColor;

void main() {
  vec4 texel = texture(diffuseTex, vTexCoords);
  float mask = min(texel.r, texel.a);
  if (mask < 0.25) {
    discard;
  }
  if (vPosition.y > cutoff.y) {
    discard;
  }
  fragColor = vec4(textColor.rgb, textColor.a * mask);
}
`;

export const COMBO_FONT_FRAG = `#version 300 es
precision highp float;

uniform sampler2D diffuseTex;
uniform vec4 textColor;
uniform vec4 fillColor;
uniform vec4 barh;

in vec4 vPosition;
in vec2 vTexCoords;

out vec4 fragColor;

void main() {
  vec4 texel = texture(diffuseTex, vTexCoords);
  float mask = min(texel.r, texel.a);
  if (mask < 0.25) {
    discard;
  }

  float thebarh = barh.x;
  float posy = vPosition.y;
  vec3 rgb = fillColor.rgb;
  if (thebarh > posy) {
    rgb = textColor.rgb;
  }
  fragColor = vec4(rgb, mask);
}
`;

export const PAUSE_LINES_VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aPosition;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const PAUSE_LINES_FRAG = `#version 300 es
precision highp float;

uniform vec4 uLineColor;

out vec4 fragColor;

void main() {
  int py = int(floor(gl_FragCoord.y));
  int px = int(floor(gl_FragCoord.x));
  if ((py & 1) == 0 && ((px + py) & 3) != 0) {
    discard;
  }
  fragColor = uLineColor;
}
`;

export const SOLID_VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aPosition;
layout(location = 1) in vec4 aColor;

uniform mat4 viewProjMatrix;

out vec4 vColor;

void main() {
  vColor = aColor;
  gl_Position = viewProjMatrix * vec4(aPosition, 0.0, 1.0);
}
`;

export const SOLID_FRAG = `#version 300 es
precision highp float;

in vec4 vColor;
out vec4 fragColor;

void main() {
  fragColor = vColor;
}
`;

export const OUTPASS_VERT = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aPosition;

uniform vec2 viewport;

out vec2 vTexCoords;

void main() {
  float ar = viewport.y / max(viewport.x, 1.0);
  float targetAr = 400.0 / 600.0;
  vTexCoords = (aPosition + 1.0) * 0.5;
  vec4 outPos = vec4(aPosition, 0.0, 1.0);
  if (ar / targetAr < 1.0) {
    gl_Position = outPos * vec4(ar / targetAr, 1.0, 1.0, 1.0);
  } else {
    gl_Position = outPos * vec4(1.0, targetAr / ar, 1.0, 1.0);
  }
}
`;

export const OUTPASS_FRAG = `#version 300 es
precision highp float;

uniform sampler2D colorTexture;
uniform vec4 uniform_colors[8];
uniform vec4 uFxFlags;       // x=crtScanlines, y=phosphorBloom, z=speedWarp, w=shockwaves
uniform vec4 uFxParams;      // x=elapsedSec, y=playerSpeedNorm, z=0, w=0
uniform vec4 uShockwaves[4]; // xy=uvCenter, z=radiusNorm, w=intensity

in vec2 vTexCoords;

out vec4 fragColor;

vec3 resolveOutColor(vec2 uv) {
  vec4 cta = texture(colorTexture, clamp(uv, vec2(0.0), vec2(1.0)));
  if (cta.rgb == vec3(1.0)) {
    cta = uniform_colors[7];
  }
  return cta.rgb;
}

void main() {
  if (uFxFlags.x < 0.5 && uFxFlags.y < 0.5 && uFxFlags.z < 0.5 && uFxFlags.w < 0.5) {
    vec4 cta = texture(colorTexture, vTexCoords);
    if (cta.rgb == vec3(1.0)) {
      cta = uniform_colors[7];
    }
    fragColor = vec4(cta.rgb, 1.0);
    return;
  }

  vec2 uv = vTexCoords;
  float hudSafe = 1.0 - smoothstep(0.82, 0.88, vTexCoords.y);
  float rimBoost = 0.0;

  // Shockwaves (uFxFlags.w > 0.5): radial ring UV distortion + faint bright crest rim
  if (uFxFlags.w > 0.5) {
    vec2 aspect = vec2(600.0 / 400.0, 1.0);
    for (int i = 0; i < 4; i++) {
      vec4 sw = uShockwaves[i];
      if (sw.w > 0.001) {
        vec2 swDelta = (uv - sw.xy) * aspect;
        float dist = length(swDelta);
        float ringDist = abs(dist - sw.z);
        float band = 0.045;
        if (ringDist < band && dist > 0.0005) {
          float wave = cos((ringDist / band) * 1.5707963);
          wave = wave * wave;
          vec2 dir = swDelta / dist;
          uv -= (dir / aspect) * (wave * 0.022 * sw.w * hudSafe);
          rimBoost += wave * 0.28 * sw.w * hudSafe;
        }
      }
    }
  }

  // Speed-Warp Vignette (uFxFlags.z > 0.5): radial edge streak & contrast boost scaling with speed
  float speedNorm = clamp(uFxParams.y, 0.0, 1.0);
  vec2 centered = uv - vec2(0.5);
  float edgeDist = length(centered * vec2(1.15, 1.0));
  if (uFxFlags.z > 0.5 && speedNorm > 0.01) {
    float warpStrength = smoothstep(0.25, 0.78, edgeDist) * speedNorm;
    uv -= centered * (warpStrength * 0.045 * hudSafe);
  }

  vec3 col = resolveOutColor(uv);
  if (rimBoost > 0.001) {
    col = mix(col, uniform_colors[7].rgb, clamp(rimBoost, 0.0, 0.65));
  }

  if (uFxFlags.z > 0.5) {
    vec2 streakDir = centered * (0.014 * speedNorm * smoothstep(0.22, 0.75, edgeDist));
    vec3 streakCol = resolveOutColor(uv + streakDir);
    col = mix(col, streakCol, 0.30 * speedNorm * smoothstep(0.25, 0.75, edgeDist) * hudSafe);
    col = clamp((col - 0.5) * (1.0 + 0.14 * speedNorm) + 0.5, 0.0, 1.0);
  }

  // Phosphor Bloom (uFxFlags.y > 0.5): 8-tap cross+diagonal glow around uniform_colors[7]
  if (uFxFlags.y > 0.5) {
    vec2 px = vec2(1.0 / 600.0, 1.0 / 400.0) * 1.5;
    vec3 glowTarget = uniform_colors[7].rgb;
    vec3 bloomAcc = vec3(0.0);
    vec2 offsets[8] = vec2[8](
      vec2(1.0, 0.0),
      vec2(-1.0, 0.0),
      vec2(0.0, 1.0),
      vec2(0.0, -1.0),
      vec2(0.7071, 0.7071),
      vec2(-0.7071, 0.7071),
      vec2(0.7071, -0.7071),
      vec2(-0.7071, -0.7071)
    );
    for (int i = 0; i < 8; i++) {
      vec3 s = resolveOutColor(uv + offsets[i] * px);
      float distTo7 = length(s - glowTarget);
      float lum = dot(s, vec3(0.299, 0.587, 0.114));
      float weight = clamp(1.0 - distTo7 * 2.2, 0.0, 1.0) * 0.70 + smoothstep(0.65, 1.0, lum) * 0.30;
      bloomAcc += s * weight;
    }
    col = clamp(col + (bloomAcc / 8.0) * 0.30, 0.0, 1.0);
  }

  // CRT Scanlines (uFxFlags.x > 0.5): subtle horizontal modulation + gentle CRT edge vignette
  if (uFxFlags.x > 0.5) {
    float scan = 0.90 + 0.10 * sin(vTexCoords.y * 400.0 * 3.14159);
    float vig = 1.0 - smoothstep(0.45, 0.88, edgeDist) * 0.24;
    col *= scan * vig;
  }

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export function createOrthoMatrix(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near = -100,
  far = 100,
): Float32Array {
  const rl = right - left;
  const tb = top - bottom;
  const fn = far - near;
  return new Float32Array([
    2 / rl,
    0,
    0,
    0,
    0,
    2 / tb,
    0,
    0,
    0,
    0,
    -2 / fn,
    0,
    -(right + left) / rl,
    -(top + bottom) / tb,
    -(far + near) / fn,
    1,
  ]);
}

export function computePostShaderUniforms(
  snapshot: SimSnapshot,
  cameraX: number,
  cameraY: number,
  elapsedSec: number,
  palette: PaletteDefinition,
  viewportW: number,
  viewportH: number,
): PostShaderUniforms {
  const maxHp = Math.max(1, snapshot.player.maxHealth);
  const rawHp =
    snapshot.phase === 'hangar' ? maxHp : Math.max(0, snapshot.player.health);
  const hpRatio = rawHp / maxHp;
  const damageFlashActive =
    snapshot.phase === 'playing' && snapshot.player.flashTicks > 0;

  // Authentic Health Circle behavior:
  // - Hidden when hpRatio > 0.60 and damage flash has settled (prevents corner bleed on minor grazes)
  // - Flashes bright colors[7] (w = 2) on damage ticks, settles to soft colors[6] (z = 0, w < 1.5)
  // - Pulses colors[7] <-> colors[6] via z = 1 <-> 0 at critical HP (< 33.33%)
  const hideSettledHighHp =
    snapshot.phase === 'playing' && hpRatio > 0.6 && !damageFlashActive;
  const effectiveHp = hideSettledHighHp ? maxHp : rawHp;

  const isCritical =
    snapshot.phase === 'playing' && hpRatio > 0 && hpRatio < 0.333333;
  const pulse =
    isCritical && Math.floor(Math.max(0, elapsedSec) * 10) % 2 === 0 ? 1 : 0;
  const flashOrHealFlag = damageFlashActive
    ? 2
    : snapshot.player.healing
      ? 1
      : 0;

  const cameraYViewSpace = cameraY / VIRTUAL_HEIGHT;
  // In OVERDRIVE (sfmt) mode, sky/sea uniform_backcol shifts to darker stormy colors[3]
  const activeBackcol =
    snapshot.mode === 'sfmt' ? palette.colors[3] : palette.backcol;

  return {
    viewport: [
      Math.max(1, viewportW || VIRTUAL_WIDTH),
      Math.max(1, viewportH || VIRTUAL_HEIGHT),
    ],
    cameraPosition: [
      cameraYViewSpace,
      elapsedSec,
      cameraX / VIRTUAL_WIDTH,
      0,
    ],
    healthRadius: [
      effectiveHp,
      maxHp,
      pulse,
      flashOrHealFlag,
    ],
    playerPosition: [
      snapshot.player.x,
      snapshot.player.y,
      snapshot.player.angleDeg,
      0,
    ],
    cameraWorldPosition: [cameraX, cameraY, 0, 0],
    delta: [
      1 / 60,
      snapshot.nukeFlashTicks,
      snapshot.screenShake,
      elapsedSec,
    ],
    uniform_backcol: [...activeBackcol] as PaletteDefinition['backcol'],
    uniform_colors: palette.colors.map(
      (c) => [...c] as PaletteDefinition['backcol'],
    ),
  };
}
