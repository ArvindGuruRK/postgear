/**
 * The public catalogue keys, the media pattern the worker shares, and where
 * the upload and private folders land whichever process asks.
 */
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { findWorkspaceRoot, privateDirectoryFor, resolveUploadDirectory } from './storage.factory';
import {
  createAvatarKey,
  isMediaKey,
  isValidKey,
  isValidLibraryKey,
  libraryKeys,
} from './storage-keys';

describe('media key pattern', () => {
  it('is shared with the worker and accepts media keys only', () => {
    expect(isMediaKey('2026/10/0123456789abcdef0123456789abcdef.jpg')).toBe(true);
    expect(isMediaKey('2026/10/0123456789abcdef0123456789abcdef.thumb.webp')).toBe(true);
    expect(isMediaKey(createAvatarKey('3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e'))).toBe(false);
  });
});

describe('library keys', () => {
  const hash = 'ab'.repeat(32);

  it('live under library/<kind>/<first two hex>/<sha256>', () => {
    expect(libraryKeys.sound(hash)).toBe(`library/sounds/ab/${hash}.m4a`);
    expect(libraryKeys.sticker(hash, 'apng')).toBe(`library/stickers/ab/${hash}.apng`);
    expect(libraryKeys.sticker(hash, 'png')).toBe(`library/stickers/ab/${hash}.png`);
    expect(libraryKeys.preview(hash)).toBe(`library/previews/ab/${hash}.webp`);
    expect(isValidKey(libraryKeys.sound(hash))).toBe(true);
  });

  it('refuse a folder that is not the hash prefix, a short hash, and escapes', () => {
    for (const key of [
      `library/sounds/cd/${hash}.m4a`,
      `library/sounds/ab/${'ab'.repeat(16)}.m4a`,
      `library/sounds/ab/${hash}.mp3`,
      `library/stickers/ab/${hash}.svg`,
      `library/sounds/../${hash}.m4a`,
      `/library/sounds/ab/${hash}.m4a`,
      `library\\sounds\\ab\\${hash}.m4a`,
    ]) {
      expect(isValidLibraryKey(key)).toBe(false);
      expect(isValidKey(key)).toBe(false);
    }
    expect(() => libraryKeys.sound('../../etc/passwd')).toThrow();
    expect(() => libraryKeys.sound(hash.toUpperCase())).toThrow();
  });
});

describe('upload directory', () => {
  it('finds the repository root from any workspace, so the API and the worker agree', () => {
    const root = findWorkspaceRoot(__dirname);
    expect(findWorkspaceRoot(join(root, 'apps', 'worker', 'src'))).toBe(root);
    expect(resolveUploadDirectory(undefined, join(root, 'apps', 'worker'))).toBe(
      join(root, 'apps', 'api', 'uploads'),
    );
    expect(resolveUploadDirectory()).toBe(join(root, 'apps', 'api', 'uploads'));
  });

  it('takes a configured directory as given', () => {
    const configured = join(tmpdir(), 'postgear-uploads');
    expect(resolveUploadDirectory(configured)).toBe(configured);
  });

  it('puts the private folder beside the uploads, never inside the public route', () => {
    const uploads = join(tmpdir(), 'site', 'uploads');
    expect(privateDirectoryFor(uploads)).toBe(join(tmpdir(), 'site', 'uploads-private'));
    expect(privateDirectoryFor(uploads).startsWith(uploads + sep)).toBe(false);
  });
});
