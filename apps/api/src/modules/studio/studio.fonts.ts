/**
 * The bundled design fonts, read from disk.
 *
 * `@postgear/design-engine` stays browser-safe, so it holds the font *files*
 * and the table that says which file serves which weight, but never opens
 * one. This is the reader, and it has two customers:
 *
 * - the **exporter**, which inlines the bytes into a page that must render
 *   with no network at all;
 * - the **public font route** (`studio-fonts.controller.ts`), which the
 *   editor, the gallery thumbnails and the share page load the same files
 *   from, so the browser caches one copy of each face and the canvas is set
 *   in the very bytes the export is.
 *
 * ## Finding the folder
 *
 * Through Node's own module resolution: the folder sits next to the engine's
 * `package.json`, and `require.resolve` finds that file exactly the way the
 * `import` of the engine does. A path counted up from `__dirname` would be
 * right under `ts-node` and wrong in the compiled `dist/apps/api/src/...`
 * tree, which is one level of nesting deeper.
 *
 * ## A missing file is an error, not a fallback
 *
 * A face the table names but the disk does not have is a broken install.
 * Exporting in a fallback face would hand the user a file whose line breaks
 * differ from what they designed, with nothing to say so, so the reader
 * throws and the export fails naming the slide. Only a name that is not in
 * the table at all is a quiet "not found".
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { FONTS, type FontId, faceWeight, type InlineFont } from '@postgear/design-engine';

/** Every file the table names. A request can only ever be answered from this set. */
const KNOWN_FILES: ReadonlySet<string> = new Set(
  Object.values(FONTS).flatMap((font) => font.faces.map((face) => face.file)),
);

export class FontFileError extends Error {
  constructor(
    readonly file: string,
    cause: unknown,
  ) {
    super(`The design font "${file}" could not be read.`, { cause });
    this.name = 'FontFileError';
  }
}

let directory: string | null = null;

function fontsDirectory(): string {
  directory ??= join(dirname(require.resolve('@postgear/design-engine/package.json')), 'fonts');
  return directory;
}

/**
 * One read per file for the life of the process. A failed read is dropped
 * from the cache, so a file restored on disk is picked up on the next call
 * rather than after a restart.
 */
const reads = new Map<string, Promise<Buffer>>();

export function isKnownFontFile(file: string): boolean {
  return KNOWN_FILES.has(file);
}

/**
 * Reads one bundled file.
 *
 * `file` is checked against the table before it is joined to anything, so a
 * request can only ever name one of the known files: there is no path to
 * traverse out of, with or without a `..`.
 */
export function readFontFile(file: string): Promise<Buffer> {
  if (!isKnownFontFile(file)) {
    return Promise.reject(new FontFileError(file, new Error('not a bundled font')));
  }

  let read = reads.get(file);

  if (!read) {
    read = readFile(join(fontsDirectory(), file)).catch((error: unknown) => {
      reads.delete(file);
      throw new FontFileError(file, error);
    });
    reads.set(file, read);
  }

  return read;
}

/**
 * Every face a set of fonts needs, base64 encoded, for the export page.
 *
 * Only the theme's own fonts are inlined, not all of them: a slide set in
 * Sora and Inter needs two files, and carrying the rest would add hundreds of
 * kilobytes to every page for nothing. Throws `FontFileError` if any face is
 * missing.
 */
export async function inlineFonts(ids: Iterable<FontId>): Promise<InlineFont[]> {
  const faces = [...new Set(ids)].flatMap((id) =>
    FONTS[id].faces.map((face) => ({ font: FONTS[id], face })),
  );

  return Promise.all(
    faces.map(async ({ font, face }) => ({
      family: font.family,
      weight: faceWeight(face),
      base64: (await readFontFile(face.file)).toString('base64'),
    })),
  );
}
