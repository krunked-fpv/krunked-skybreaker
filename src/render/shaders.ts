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
  vec4 diffuse = texture(diffuseTex, vTexCoords);
  if (diffuse.rgb == vec3(0.0) || diffuse.a == 0.0) {
    discard;
  }
  if (uClipSea > 0.5 && vWorldPos.y > 0.0) {
    discard;
  }

  int thecolind = clamp(int(diffuse.r * 8.0), 0, 7);
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
  vec4 diffuse = texture(diffuseTex, vTexCoords);
  if (diffuse.rgb == vec3(0.0) || diffuse.a == 0.0) {
    discard;
  }
  if (vWorldPos.y < 0.0) {
    discard;
  }

  int thecolind = clamp(int(diffuse.r * 8.0), 0, 7);
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
      outColor = healthRadius.z < 1.0 ? uniform_colors[7] : uniform_colors[6];
    } else {
      outColor = uniform_backcol;
    }
  } else {
    outColor = finalColor;
  }

  // Subtle flash tint during nuke detonation sequence
  if (delta.y > 0.0) {
    float flashMix = clamp(delta.y / 12.0, 0.0, 0.75);
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

in vec2 vTexCoords;

out vec4 fragColor;

void main() {
  vec4 cta = texture(colorTexture, vTexCoords);
  if (cta.rgb == vec3(1.0)) {
    cta = uniform_colors[7];
  }
  fragColor = vec4(cta.rgb, 1.0);
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

  // Critical HP (< 33.33%) alternates between colors[7] and colors[6] via healthRadius.z
  const isCritical =
    snapshot.phase === 'playing' && hpRatio > 0 && hpRatio < 0.333333;
  const pulse =
    isCritical && Math.floor(Math.max(0, elapsedSec) * 10) % 2 === 0 ? 1 : 0;

  const cameraYViewSpace = cameraY / VIRTUAL_HEIGHT;

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
      rawHp,
      maxHp,
      pulse,
      snapshot.player.healing ? 1 : 0,
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
    uniform_backcol: [...palette.backcol] as PaletteDefinition['backcol'],
    uniform_colors: palette.colors.map(
      (c) => [...c] as PaletteDefinition['backcol'],
    ),
  };
}
