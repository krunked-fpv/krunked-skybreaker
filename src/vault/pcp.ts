/**
 * Clean-room runtime decoder for `PCP\0`-compressed `IMTX` texture blobs.
 *
 * Used strictly at runtime in optional `steam-local` mode to decode textures
 * served read-only from a user's local Steam installation (`sheet2grey.png`,
 * `nuke.png`, and `fnt*_0.png`) directly into tightly packed RGBA8 buffers.
 *
 * Format overview:
 * - `PCP\0` wrapper (44-byte header + tag-driven stream):
 *   - `[0..3]`   magic `"PCP\0"` (`50 43 50 00`)
 *   - `[4]`      flags byte (`0x3f`)
 *   - `[5..11]`  7-entry frequent-byte lookup table
 *   - `[12..39]` 7-entry frequent-uint32 (LE) lookup table
 *   - `[40..43]` uncompressed byte length (uint32 LE)
 *   - `[44..]`   compressed stream (literal runs, LEB128 LZ back-references,
 *                1-byte RLE, 4-byte RLE, and N-byte pattern RLE)
 * - `IMTX` image payload (20-byte header + `width * height` packed pixel bytes):
 *   - `[0..3]`   magic `"IMTX"`
 *   - `[4]`      version (`0x00`)
 *   - `[5]`      format flags (`0x22`: 4-bit dual-nibble channels)
 *   - `[6..7]`   width (uint16 LE)
 *   - `[8..9]`   height (uint16 LE)
 *   - `[10..13]` channel descriptors (each byte has `(b & 3) === 1`)
 *   - `[14..19]` reserved zeroes
 *   - `[20..]`   top-left origin pixel bytes; each byte stores two 4-bit nibbles
 *                matching `GL_UNSIGNED_SHORT_4_4_4_4_REV`:
 *                low nibble -> R channel (`* 17`), high nibble -> B channel (`* 17`).
 */

import { isPcpBlob } from './tga';

export interface DecodedPcpImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

const PCP_HEADER_SIZE = 44;
const IMTX_HEADER_SIZE = 20;
const MAX_PCP_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;

/**
 * Pattern lengths indexed by `tag >>> 3` for opcode 3 (skips 1 and 4 because
 * opcodes 1 and 2 handle 1-byte and 4-byte runs directly).
 */
const PCP_PATTERN_LENGTHS: readonly number[] = [
  0, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
  28, 29, 30, 31, 32, 33,
];

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

function readVarint(bytes: Uint8Array, startOffset: number): { value: number; nextOffset: number } {
  let pos = startOffset;
  let value = 0;
  let multiplier = 1;
  let count = 0;

  while (true) {
    if (pos >= bytes.length) {
      throw new Error(`Truncated PCP varint at offset ${pos}`);
    }
    if (count >= 9) {
      throw new Error(`Oversized PCP varint at offset ${startOffset}`);
    }
    const b = bytes[pos++]!;
    value += (b & 0x7f) * multiplier;
    if ((b & 0x80) === 0) {
      return { value, nextOffset: pos };
    }
    multiplier *= 128;
    count++;
  }
}

/**
 * Decompresses a `PCP\0` stream into its raw uncompressed payload bytes (e.g. an `IMTX` buffer).
 */
export function decompressPcp(bytes: Uint8Array): Uint8Array {
  if (!isPcpBlob(bytes)) {
    throw new Error('Invalid PCP buffer: missing PCP\\0 magic header');
  }
  if (bytes.length < PCP_HEADER_SIZE) {
    throw new Error(
      `Invalid PCP buffer: expected >= ${PCP_HEADER_SIZE} header bytes, got ${bytes.length}`,
    );
  }

  const byteTable = bytes.subarray(5, 12);
  const dwordTable = new Uint32Array(7);
  for (let i = 0; i < 7; i++) {
    dwordTable[i] = readU32LE(bytes, 12 + i * 4);
  }

  const outLen = readU32LE(bytes, 40);
  if (outLen > MAX_PCP_UNCOMPRESSED_BYTES) {
    throw new Error(`Refusing oversized PCP payload: ${outLen} bytes`);
  }

  const out = new Uint8Array(outLen);
  let inPos = PCP_HEADER_SIZE;
  let outPos = 0;

  while (outPos < outLen) {
    if (inPos >= bytes.length) {
      throw new Error(
        `Truncated PCP stream at input offset ${inPos} (decoded ${outPos}/${outLen} bytes)`,
      );
    }

    const tag = bytes[inPos++]!;

    if ((tag & 1) !== 0) {
      // Literal byte run: 1..128 bytes
      const count = (tag >>> 1) + 1;
      if (inPos + count > bytes.length) {
        throw new Error(`Truncated PCP literal run (${count} bytes) at input offset ${inPos}`);
      }
      if (outPos + count > outLen) {
        throw new Error(`PCP literal run overflows output (${outPos + count} > ${outLen})`);
      }
      out.set(bytes.subarray(inPos, inPos + count), outPos);
      inPos += count;
      outPos += count;
      continue;
    }

    const op = (tag >>> 1) & 3;

    if (op === 0) {
      // LZ back-reference: dist = ((tag >>> 3) << 7) + varint1, len = varint2
      const highDist = (tag >>> 3) << 7;
      const vDist = readVarint(bytes, inPos);
      inPos = vDist.nextOffset;
      const vLen = readVarint(bytes, inPos);
      inPos = vLen.nextOffset;

      const dist = highDist + vDist.value;
      const len = vLen.value;
      if (len === 0) {
        continue;
      }
      if (dist <= 0 || dist > outPos) {
        throw new Error(`Invalid PCP backref distance ${dist} at output offset ${outPos}`);
      }
      if (outPos + len > outLen) {
        throw new Error(`PCP backref overflows output (${outPos + len} > ${outLen})`);
      }
      for (let i = 0; i < len; i++) {
        out[outPos] = out[outPos - dist]!;
        outPos++;
      }
      continue;
    }

    if (op === 1) {
      // 1-byte RLE (dictionary index 0..6 or literal escape 7)
      const sym = (tag >>> 3) & 7;
      let val: number;
      if (sym === 7) {
        if (inPos >= bytes.length) {
          throw new Error(`Truncated PCP 1-byte RLE literal at offset ${inPos}`);
        }
        val = bytes[inPos++]!;
      } else {
        val = byteTable[sym]!;
      }

      const lenCode = (tag >>> 6) & 3;
      let count: number;
      if (lenCode === 3) {
        const vLen = readVarint(bytes, inPos);
        inPos = vLen.nextOffset;
        count = vLen.value + 2;
      } else {
        count = lenCode + 2;
      }

      if (outPos + count > outLen) {
        throw new Error(`PCP 1-byte RLE overflows output (${outPos + count} > ${outLen})`);
      }
      out.fill(val, outPos, outPos + count);
      outPos += count;
      continue;
    }

    if (op === 2) {
      // 4-byte (uint32 LE) RLE (dictionary index 0..6 or literal escape 7)
      const sym = (tag >>> 3) & 7;
      let dw: number;
      if (sym === 7) {
        if (inPos + 4 > bytes.length) {
          throw new Error(`Truncated PCP 4-byte RLE literal at offset ${inPos}`);
        }
        dw = readU32LE(bytes, inPos);
        inPos += 4;
      } else {
        dw = dwordTable[sym]!;
      }

      const lenCode = (tag >>> 6) & 3;
      let count: number;
      if (lenCode === 3) {
        const vLen = readVarint(bytes, inPos);
        inPos = vLen.nextOffset;
        count = vLen.value + 2;
      } else {
        count = lenCode + 2;
      }

      const totalBytes = count * 4;
      if (outPos + totalBytes > outLen) {
        throw new Error(`PCP 4-byte RLE overflows output (${outPos + totalBytes} > ${outLen})`);
      }
      const b0 = dw & 0xff;
      const b1 = (dw >>> 8) & 0xff;
      const b2 = (dw >>> 16) & 0xff;
      const b3 = (dw >>> 24) & 0xff;
      for (let i = 0; i < count; i++) {
        out[outPos++] = b0;
        out[outPos++] = b1;
        out[outPos++] = b2;
        out[outPos++] = b3;
      }
      continue;
    }

    // op === 3: N-byte pattern RLE
    const patLen = PCP_PATTERN_LENGTHS[tag >>> 3] ?? 0;
    const vCount = readVarint(bytes, inPos);
    inPos = vCount.nextOffset;
    const count = vCount.value + 2;

    if (inPos + patLen > bytes.length) {
      throw new Error(`Truncated PCP pattern (${patLen} bytes) at input offset ${inPos}`);
    }
    const totalBytes = patLen * count;
    if (outPos + totalBytes > outLen) {
      throw new Error(`PCP pattern RLE overflows output (${outPos + totalBytes} > ${outLen})`);
    }
    if (patLen > 0) {
      const patStart = inPos;
      for (let i = 0; i < count; i++) {
        for (let j = 0; j < patLen; j++) {
          out[outPos++] = bytes[patStart + j]!;
        }
      }
      inPos += patLen;
    }
  }

  return out;
}

/**
 * Decodes an uncompressed `IMTX` image buffer into tightly packed RGBA8 bytes.
 *
 * Each IMTX pixel byte holds two 4-bit nibbles matching `GL_UNSIGNED_SHORT_4_4_4_4_REV`:
 * - Low nibble `(b & 0x0f) * 17` -> `R` (and `G` for crisp grayscale compatibility)
 * - High nibble `(b >>> 4) * 17` -> `B` (supports `batch_menu_hack.shader` `.z` plane)
 * - `A` = `255` whenever either nibble is non-zero, else `0`.
 */
export function decodeImtxRgba(imtxBytes: Uint8Array): DecodedPcpImage {
  if (imtxBytes.length < IMTX_HEADER_SIZE) {
    throw new Error(
      `Invalid IMTX buffer: expected >= ${IMTX_HEADER_SIZE} bytes, got ${imtxBytes.length}`,
    );
  }
  if (
    imtxBytes[0] !== 0x49 ||
    imtxBytes[1] !== 0x4d ||
    imtxBytes[2] !== 0x54 ||
    imtxBytes[3] !== 0x58
  ) {
    throw new Error('Invalid IMTX buffer: missing IMTX magic header');
  }
  if (imtxBytes[4] !== 0) {
    throw new Error(`Unsupported IMTX version byte: ${imtxBytes[4]}`);
  }
  const fmt = imtxBytes[5]!;
  if ((fmt & 0x07) !== 2 || (fmt & 0xf8) !== 0x20) {
    throw new Error(`Unsupported IMTX pixel format: 0x${fmt.toString(16)}`);
  }
  for (let c = 0; c < 4; c++) {
    if ((imtxBytes[10 + c]! & 0x03) !== 1) {
      throw new Error(`Unsupported IMTX channel descriptor[${c}]: 0x${imtxBytes[10 + c]!.toString(16)}`);
    }
  }

  const width = imtxBytes[6]! | (imtxBytes[7]! << 8);
  const height = imtxBytes[8]! | (imtxBytes[9]! << 8);
  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid IMTX dimensions: ${width}x${height}`);
  }

  const pixelCount = width * height;
  const requiredBytes = IMTX_HEADER_SIZE + pixelCount;
  if (imtxBytes.length < requiredBytes) {
    throw new Error(
      `Truncated IMTX pixel data: expected ${requiredBytes} bytes, got ${imtxBytes.length}`,
    );
  }

  const rgba = new Uint8Array(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    const packed = imtxBytes[IMTX_HEADER_SIZE + i]!;
    const lo = (packed & 0x0f) * 17;
    const hi = (packed >>> 4) * 17;
    const d = i * 4;
    rgba[d] = lo;
    rgba[d + 1] = lo;
    rgba[d + 2] = hi;
    rgba[d + 3] = lo !== 0 || hi !== 0 ? 255 : 0;
  }

  return { width, height, rgba };
}

/**
 * Decodes a `PCP\0`-compressed `IMTX` texture blob directly into tightly packed RGBA8 bytes.
 */
export function decodePcpRgba(bytes: Uint8Array): DecodedPcpImage {
  const raw = decompressPcp(bytes);
  return decodeImtxRgba(raw);
}
