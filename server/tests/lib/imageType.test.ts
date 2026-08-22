import { describe, expect, it } from 'vitest';
import { sniffImageType } from '../../src/lib/imageType';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
const avif = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypavif')]);

describe('sniffImageType', () => {
  it.each([
    ['jpeg', jpeg, 'jpg'],
    ['png', png, 'png'],
    ['webp', webp, 'webp'],
    ['avif', avif, 'avif'],
  ])('identifies %s', (_name, buffer, expected) => {
    expect(sniffImageType(buffer)).toBe(expected);
  });

  it('rejects an SVG, which can carry script', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(sniffImageType(svg)).toBeNull();
  });

  it('rejects a payload whose extension lies about its content', () => {
    // A PHP payload named cover.jpg — precisely why the bytes are sniffed
    // rather than trusting the filename or the client-supplied mimetype.
    expect(sniffImageType(Buffer.from('<?php system($_GET["c"]); ?>'))).toBeNull();
  });

  it('rejects a RIFF container that is not WEBP', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WAVE'),
    ]);
    expect(sniffImageType(wav)).toBeNull();
  });

  it('rejects a buffer too short to identify', () => {
    expect(sniffImageType(Buffer.from([0xff]))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });
});
