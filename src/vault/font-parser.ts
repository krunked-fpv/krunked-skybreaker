import type { BitmapFontGlyph, BitmapFontSpec } from '../contracts/vault';

function parseAttributes(line: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /([a-zA-Z0-9_]+)=("([^"]*)"|([^\s]*))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    const key = match[1]!;
    const value = match[3] !== undefined ? match[3] : (match[4] ?? '');
    attrs[key] = value;
  }
  return attrs;
}

function toInt(value: string | undefined, fallback = 0): number {
  if (value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Parses an AngelCode BMFont text `.fnt` specification (`info`, `common`, `page`, `char` lines).
 */
export function parseAngelCodeFnt(name: string, text: string): BitmapFontSpec {
  let face = name;
  let size = 16;
  let lineHeight = 16;
  let base = 13;
  let scaleW = 128;
  let scaleH = 128;
  let pageFile = `${name}_0.png`;
  const glyphs: Record<number, BitmapFontGlyph> = {};

  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (line.startsWith('info ')) {
      const attrs = parseAttributes(line.slice(5));
      if (attrs.face) {
        face = attrs.face;
      }
      if (attrs.size !== undefined) {
        size = Math.abs(toInt(attrs.size, 16));
      }
    } else if (line.startsWith('common ')) {
      const attrs = parseAttributes(line.slice(7));
      lineHeight = toInt(attrs.lineHeight, lineHeight);
      base = toInt(attrs.base, base);
      scaleW = toInt(attrs.scaleW, scaleW);
      scaleH = toInt(attrs.scaleH, scaleH);
    } else if (line.startsWith('page ')) {
      const attrs = parseAttributes(line.slice(5));
      if (attrs.file) {
        pageFile = attrs.file;
      }
    } else if (line.startsWith('char ')) {
      const attrs = parseAttributes(line.slice(5));
      if (attrs.id === undefined) {
        continue;
      }
      const id = toInt(attrs.id, -1);
      if (id < 0) {
        continue;
      }
      glyphs[id] = {
        id,
        x: toInt(attrs.x),
        y: toInt(attrs.y),
        width: toInt(attrs.width),
        height: toInt(attrs.height),
        xoffset: toInt(attrs.xoffset),
        yoffset: toInt(attrs.yoffset),
        xadvance: toInt(attrs.xadvance),
      };
    }
  }

  return {
    name,
    face,
    size,
    lineHeight,
    base,
    scaleW,
    scaleH,
    pageFile,
    glyphs,
  };
}
