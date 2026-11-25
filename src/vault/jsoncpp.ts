/**
 * Clean-room JSONCPP parser supporting Vlambeer's Luftrausers data files:
 * - Strips UTF-8 BOM
 * - Strips `// ...` line comments and C-style block comments outside quoted strings
 * - Normalizes JSONCPP trailing-dot / leading-dot float literals (`0.` -> `0.0`, `.5` -> `0.5`)
 * - Removes trailing commas before `}` and `]` outside quoted strings
 */

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';
}

function stripCommentsAndFixNumbers(raw: string): string {
  const input = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const out: string[] = [];
  let inString = false;
  let escaped = false;
  let prevChar = '';

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    const next = i + 1 < input.length ? input[i + 1]! : '';

    if (inString) {
      out.push(ch);
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
      out.push(ch);
      prevChar = ch;
      continue;
    }

    // Line comment // ...
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < input.length && input[i] !== '\n') {
        i++;
      }
      if (i < input.length && input[i] === '\n') {
        out.push('\n');
        prevChar = '\n';
      }
      continue;
    }

    // Block comment /* ... */
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < input.length) {
        if (input[i] === '*' && input[i + 1] === '/') {
          i++;
          break;
        }
        if (input[i] === '\n') {
          out.push('\n');
        }
        i++;
      }
      prevChar = ' ';
      continue;
    }

    // Trailing-dot float like `0.` followed by non-digit (e.g. `,`, `}`, whitespace)
    if (ch === '.' && isDigit(prevChar) && !isDigit(next)) {
      out.push('.0');
      prevChar = '0';
      continue;
    }

    // Leading-dot float like `.5`
    if (ch === '.' && !isDigit(prevChar) && isDigit(next)) {
      out.push('0.');
      prevChar = '.';
      continue;
    }

    out.push(ch);
    prevChar = ch;
  }

  return out.join('');
}

function stripTrailingCommas(jsonLike: string): string {
  const out: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < jsonLike.length; i++) {
    const ch = jsonLike[i]!;

    if (inString) {
      out.push(ch);
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
      out.push(ch);
      continue;
    }

    if (ch === ',') {
      let j = i + 1;
      while (j < jsonLike.length && isWhitespace(jsonLike[j]!)) {
        j++;
      }
      const lookahead = j < jsonLike.length ? jsonLike[j]! : '';
      if (lookahead === '}' || lookahead === ']') {
        continue;
      }
    }

    out.push(ch);
  }

  return out.join('');
}

export function sanitizeJsonCpp(raw: string): string {
  return stripTrailingCommas(stripCommentsAndFixNumbers(raw));
}

export function parseJsonCpp<T>(raw: string): T {
  const cleaned = sanitizeJsonCpp(raw);
  return JSON.parse(cleaned) as T;
}
