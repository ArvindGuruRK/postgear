/**
 * The names downloads are saved under, and the header that makes a browser
 * save rather than show: safe on every file system, with the extension the
 * stored file really has.
 */
import { contentDisposition, fileNameParts, safeFileName } from './attachment';

const CAFE = `Caf${String.fromCodePoint(0xe9)}`;
const BACKSLASH = String.fromCharCode(92);

describe('safeFileName', () => {
  it('turns separators, reserved and control characters into spaces', () => {
    expect(safeFileName(`a/b${BACKSLASH}c:d*e?f"g<h>i|j\u0007k`, 'x')).toBe(
      'a b c d e f g h i j k',
    );
  });

  it('drops the trailing dots and spaces Windows would silently remove', () => {
    expect(safeFileName('Report. . ', 'x')).toBe('Report');
  });

  it('falls back when nothing safe is left, and caps the length', () => {
    expect(safeFileName(' /// ', 'Image')).toBe('Image');
    expect(Array.from(safeFileName('a'.repeat(400), 'x'))).toHaveLength(150);
  });
});

describe('fileNameParts', () => {
  it('keeps a name that already ends in its type', () => {
    expect(fileNameParts('Spring Sale 01.jpg', 'image/jpeg', 'x')).toEqual({
      stem: 'Spring Sale 01',
      extension: 'jpg',
    });
    expect(fileNameParts('Beach.JPEG', 'image/jpeg', 'x')).toEqual({
      stem: 'Beach',
      extension: 'jpeg',
    });
  });

  it('adds the extension a type calls for when the name has none', () => {
    expect(fileNameParts('Cover', 'image/png', 'x')).toEqual({ stem: 'Cover', extension: 'png' });
    expect(fileNameParts('Dance.gif', 'image/gif', 'x')).toEqual({
      stem: 'Dance',
      extension: 'gif',
    });
  });

  it('swaps the image extension an upload had for the type it was stored as', () => {
    expect(fileNameParts('beach.webp', 'image/jpeg', 'x')).toEqual({
      stem: 'beach',
      extension: 'jpg',
    });
    expect(fileNameParts('IMG_0001.HEIC', 'image/jpeg', 'x')).toEqual({
      stem: 'IMG_0001',
      extension: 'jpg',
    });
  });

  it('keeps a dot that is not an image extension as part of the name', () => {
    expect(fileNameParts('report.v2', 'image/png', 'x')).toEqual({
      stem: 'report.v2',
      extension: 'png',
    });
  });

  it('makes the stem safe, falling back when nothing is left', () => {
    expect(fileNameParts('../../etc/passwd.jpg', 'image/jpeg', 'x').stem).toBe('.. .. etc passwd');
    expect(fileNameParts('.png', 'image/png', 'Image')).toEqual({
      stem: 'Image',
      extension: 'png',
    });
  });

  it('leaves a type it does not know alone, rather than guessing an extension', () => {
    expect(fileNameParts('clip.mp4', 'video/mp4', 'x')).toEqual({
      stem: 'clip.mp4',
      extension: null,
    });
    expect(fileNameParts('mystery', null, 'x')).toEqual({ stem: 'mystery', extension: null });
  });
});

describe('contentDisposition', () => {
  it('gives an ASCII name and the exact UTF-8 one', () => {
    expect(contentDisposition(`${CAFE} "Menu".zip`)).toBe(
      `attachment; filename="Caf_ _Menu_.zip"; filename*=UTF-8''Caf%C3%A9%20%22Menu%22.zip`,
    );
  });
});
