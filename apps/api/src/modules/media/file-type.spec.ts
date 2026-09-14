/**
 * Content sniffing.
 *
 * The allowlist is what decides whether a file can end up publicly served, so
 * both directions are pinned: each accepted signature is recognised, and the
 * lookalikes — SVG and HTML that pretend to be images, audio in a video
 * container, HEIC — are not accepted as what they resemble.
 */
import { sniffMedia } from './file-type';

function bytes(...values: Array<number | string>): Buffer {
  return Buffer.concat(
    values.map((value) =>
      typeof value === 'string' ? Buffer.from(value, 'latin1') : Buffer.from([value]),
    ),
  );
}

/** An ISO base media file header with the given major brand. */
function ftyp(brand: string): Buffer {
  return bytes(0, 0, 0, 0x18, 'ftyp', brand, 0, 0, 0, 0);
}

describe('sniffMedia', () => {
  it('recognises each accepted image signature', () => {
    expect(sniffMedia(bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({
      kind: 'image',
      mimeType: 'image/jpeg',
    });
    expect(sniffMedia(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))).toEqual({
      kind: 'image',
      mimeType: 'image/png',
    });
    expect(sniffMedia(bytes('GIF89a'))).toEqual({ kind: 'image', mimeType: 'image/gif' });
    expect(sniffMedia(bytes('GIF87a'))).toEqual({ kind: 'image', mimeType: 'image/gif' });
    expect(sniffMedia(bytes('RIFF', 0, 0, 0, 0, 'WEBP'))).toEqual({
      kind: 'image',
      mimeType: 'image/webp',
    });
    expect(sniffMedia(ftyp('avif'))).toEqual({ kind: 'image', mimeType: 'image/avif' });
  });

  it('recognises MP4 by brand and QuickTime separately', () => {
    for (const brand of ['isom', 'mp42', 'avc1', 'M4V ']) {
      expect(sniffMedia(ftyp(brand))).toEqual({ kind: 'video', mimeType: 'video/mp4' });
    }
    expect(sniffMedia(ftyp('qt  '))).toEqual({ kind: 'video', mimeType: 'video/quicktime' });
  });

  it('refuses HEIC and WebM with a reason the user can act on', () => {
    expect(sniffMedia(ftyp('heic'))).toEqual({ kind: 'refused', reason: 'heic' });
    expect(sniffMedia(ftyp('mif1'))).toEqual({ kind: 'refused', reason: 'heic' });
    expect(sniffMedia(bytes(0x1a, 0x45, 0xdf, 0xa3))).toEqual({ kind: 'refused', reason: 'webm' });
  });

  it('does not accept markup pretending to be an image', () => {
    expect(sniffMedia(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>'))).toBeNull();
    expect(sniffMedia(Buffer.from('<!DOCTYPE html><html>'))).toBeNull();
    // A leading BOM or whitespace does not make it any more of an image.
    expect(sniffMedia(Buffer.from('﻿<svg>'))).toBeNull();
  });

  it('does not accept other media that shares a container', () => {
    expect(sniffMedia(ftyp('M4A '))).toBeNull();
    expect(sniffMedia(ftyp('3gp4'))).toBeNull();
    expect(sniffMedia(bytes('RIFF', 0, 0, 0, 0, 'WAVE'))).toBeNull();
  });

  it('returns nothing for an empty or too-short file', () => {
    expect(sniffMedia(Buffer.alloc(0))).toBeNull();
    expect(sniffMedia(bytes(0xff, 0xd8))).toBeNull();
  });
});
