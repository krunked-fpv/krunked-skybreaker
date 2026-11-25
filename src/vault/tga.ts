/**
 * Clean-room TGA decoder and PCP blob detector.
 *
 * Steam Luftrausers stores `sheet1grey.png` as an uncompressed 32-bit BGRA TGA
 * (header[2] === 2, header[16] === 32, top-left origin header[17] & 0x20).
 * Other `.png` assets (`sheet2grey.png`, `nuke.png`, `fnt*_0.png`) are proprietary
 * `PCP\0`-packed IMTX blobs, which must be detected cleanly and never passed to <img>.
 */

export interface DecodedTgaImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/**
 * Returns true if `bytes` begins with the proprietary `PCP\0` (`50 43 50 00`) magic header.
 */
export function isPcpBlob(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x43 &&
    bytes[2] === 0x50 &&
    bytes[3] === 0x00
  );
}

/**
 * Decodes an uncompressed 24-bit BGR or 32-bit BGRA TGA image into tightly packed RGBA8 bytes.
 */
export function decodeTgaRgba(bytes: Uint8Array): DecodedTgaImage {
  if (isPcpBlob(bytes)) {
    throw new Error('Cannot decode PCP\\0 blob as TGA');
  }
  if (bytes.length < 18) {
    throw new Error(`Invalid TGA buffer: expected >= 18 header bytes, got ${bytes.length}`);
  }

  const idLength = bytes[0]!;
  const colorMapType = bytes[1]!;
  const imageType = bytes[2]!;

  if (colorMapType !== 0) {
    throw new Error(`Unsupported TGA colorMapType: ${colorMapType}`);
  }
  if (imageType !== 2) {
    throw new Error(`Unsupported TGA imageType: ${imageType} (expected 2 uncompressed true-color)`);
  }

  const width = bytes[12]! | (bytes[13]! << 8);
  const height = bytes[14]! | (bytes[15]! << 8);
  const bpp = bytes[16]!;
  const descriptor = bytes[17]!;

  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid TGA dimensions: ${width}x${height}`);
  }
  if (bpp !== 32 && bpp !== 24) {
    throw new Error(`Unsupported TGA bit depth: ${bpp} (expected 24 or 32)`);
  }

  const bytesPerPixel = bpp >> 3;
  const pixelOffset = 18 + idLength;
  const requiredBytes = pixelOffset + width * height * bytesPerPixel;
  if (bytes.length < requiredBytes) {
    throw new Error(
      `Truncated TGA pixel data: expected ${requiredBytes} bytes, got ${bytes.length}`,
    );
  }

  const topOrigin = (descriptor & 0x20) !== 0;
  const rightOrigin = (descriptor & 0x10) !== 0;
  const rgba = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const srcY = topOrigin ? y : height - 1 - y;
    const dstRow = y * width * 4;
    const srcRow = pixelOffset + srcY * width * bytesPerPixel;

    for (let x = 0; x < width; x++) {
      const srcX = rightOrigin ? width - 1 - x : x;
      const s = srcRow + srcX * bytesPerPixel;
      const d = dstRow + x * 4;

      rgba[d] = bytes[s + 2]!;
      rgba[d + 1] = bytes[s + 1]!;
      rgba[d + 2] = bytes[s]!;
      rgba[d + 3] = bytesPerPixel === 4 ? bytes[s + 3]! : 255;
    }
  }

  return { width, height, rgba };
}
