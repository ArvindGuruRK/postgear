/**
 * Files a browser saves rather than shows: the name it saves them under, and
 * the header that makes it save.
 *
 * Shared by the two downloads PostGear offers, Download All (the Design
 * Studio's zip, Sprint 9) and a single image from the media library, so a
 * name is made safe the same way wherever it ends up on someone's disk.
 */

/** Longest file name kept, before its extension: well inside every file system's limit. */
const MAX_NAME_LENGTH = 150;

/**
 * Characters a file name cannot hold on Windows, macOS or Linux, plus the
 * control characters and the two separators that would make a name a path.
 * A name built from a title or an upload has to survive all three.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what this strips.
const UNSAFE = /[\u0000-\u001f\u007f<>:"/\\|?*]+/g;

/** One safe file name, without touching its extension. */
export function safeFileName(value: string, fallback: string): string {
  const cleaned = value
    .replace(UNSAFE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // A trailing dot or space is silently dropped by Windows, which would make
    // two different names the same file.
    .replace(/[. ]+$/g, '');

  return Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join('').trim() || fallback;
}

/** The extensions each stored image type is saved under, the usual one first. */
const IMAGE_EXTENSIONS: Record<string, readonly [string, ...string[]]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
};

/** An image extension a name can carry from its upload, before the library converted it. */
const IMAGE_EXTENSION = /\.(?:jpe?g|png|gif|webp|avif|heic|heif|tiff?|bmp)$/i;

/**
 * A library file's name, split into a safe stem and the extension its stored
 * type calls for. "Spring Sale 01.jpg" keeps its name; "Cover" stored as PNG
 * gains ".png"; a photo uploaded as "beach.webp" and stored as JPEG is saved
 * as "beach.jpg", so the file opens as what it really is. A type outside the
 * table keeps the whole name and gets no extension.
 */
export function fileNameParts(
  name: string,
  mimeType: string | null,
  fallback: string,
): { stem: string; extension: string | null } {
  const extensions = IMAGE_EXTENSIONS[mimeType ?? ''];
  if (!extensions) return { stem: safeFileName(name, fallback), extension: null };

  const own = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  const matches = own !== undefined && extensions.includes(own);
  const stem =
    matches || IMAGE_EXTENSION.test(name) ? name.slice(0, -((own?.length ?? 0) + 1)) : name;

  return { stem: safeFileName(stem, fallback), extension: matches ? own : extensions[0] };
}

/**
 * `attachment` with the name twice: a plain ASCII one for old clients, and
 * the RFC 5987 UTF-8 one every current browser prefers.
 */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
