export type ImageType = 'jpg' | 'png' | 'webp' | 'avif';

function matches(buffer: Buffer, bytes: number[], offset = 0): boolean {
  if (buffer.length < offset + bytes.length) {
    return false;
  }
  return bytes.every((byte, index) => buffer[offset + index] === byte);
}

/**
 * Identify an image by its magic bytes.
 *
 * multer's `file.mimetype` is whatever the client claimed and the filename
 * extension is attacker-controlled, so neither can decide what gets written to
 * disk. SVG is deliberately absent: it is a document format that can carry
 * script, and serving one from our own origin would be stored XSS.
 */
export function sniffImageType(buffer: Buffer): ImageType | null {
  if (matches(buffer, [0xff, 0xd8, 0xff])) {
    return 'jpg';
  }
  if (matches(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'png';
  }
  // RIFF is a generic container: the WEBP tag at offset 8 is what matters.
  if (matches(buffer, [0x52, 0x49, 0x46, 0x46]) && matches(buffer, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'webp';
  }
  if (matches(buffer, [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66], 4)) {
    return 'avif';
  }
  return null;
}
