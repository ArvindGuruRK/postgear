/**
 * Download All (DS-8.3): a design's exported slides as one zip, in slide order.
 *
 * Stored, not deflated: the slides are JPEG or PNG, already compressed, so a
 * second compression costs CPU to save a few bytes. The archive is written as
 * it is read, one slide at a time, so a twenty-slide PNG export never sits in
 * memory whole, and everything that can be refused (no export yet, a slide
 * gone from the library) is checked by the service before the first byte, so
 * a refusal is still an ordinary JSON error.
 */
import { once } from 'node:events';
import { Logger } from '@nestjs/common';
import type { Response } from 'express';
import { Zip, ZipPassThrough } from 'fflate';
import { contentDisposition, fileNameParts, safeFileName } from '../../common/attachment';

export interface ArchiveEntry {
  name: string;
  bytes: Uint8Array;
}

export interface DesignArchive {
  /** What the browser saves the zip as: the design's title, made safe. */
  fileName: string;
  entries: AsyncIterable<ArchiveEntry>;
}

/** The zip's own name: "Spring Sale.zip". */
export function archiveFileName(title: string): string {
  return `${safeFileName(title, 'Design')}.zip`;
}

/**
 * The caption file Download All adds after the slides (Sprint 9b). No slide
 * can take this name: every slide name ends in an image extension.
 */
export const CAPTION_FILE_NAME = 'captions.txt';

/**
 * The design's caption as a text file, or null when there is no caption to
 * put in one. UTF-8 without a byte order mark (every current editor reads
 * it, emoji included), with the line breaks Preview shows and one at the end.
 */
export function captionEntry(caption: string): ArchiveEntry | null {
  const text = caption.replace(/\r\n?/g, '\n').trim();
  if (!text) return null;

  return { name: CAPTION_FILE_NAME, bytes: new TextEncoder().encode(`${text}\n`) };
}

/**
 * The name of each slide inside the zip, in order: the library's own name
 * ("Spring Sale 01.jpg"), made safe, given the extension its type calls for
 * when it lacks one, and made unique (an unzip would otherwise overwrite one
 * slide with the next). Case-insensitive, because Windows and macOS are.
 */
export function archiveNames(files: Array<{ name: string; mimeType: string | null }>): string[] {
  const taken = new Set<string>();

  return files.map((file, index) => {
    const fallback = `Slide ${String(index + 1).padStart(2, '0')}`;
    const parts = fileNameParts(file.name, file.mimeType, fallback);
    const { stem } = parts;
    // Every image type the library stores has its extension; this only covers
    // a row whose type was never recorded.
    const extension = parts.extension ?? 'jpg';

    let candidate = `${stem}.${extension}`;
    for (let copy = 2; taken.has(candidate.toLowerCase()); copy++) {
      candidate = `${stem} (${copy}).${extension}`;
    }

    taken.add(candidate.toLowerCase());
    return candidate;
  });
}

/**
 * A zip of `entries`, stored, yielded chunk by chunk as each entry arrives.
 *
 * fflate writes synchronously: pushing a whole entry hands back its header
 * and bytes before `push` returns, and `end` hands back the central
 * directory. Collecting them per entry and yielding them lets the caller
 * respect backpressure between slides.
 */
export async function* zipStored(entries: AsyncIterable<ArchiveEntry>): AsyncGenerator<Uint8Array> {
  const ready: Uint8Array[] = [];
  let failure: Error | null = null;

  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else ready.push(chunk);
  });

  const drain = function* () {
    if (failure) throw failure;
    while (ready.length > 0) yield ready.shift() as Uint8Array;
  };

  for await (const entry of entries) {
    const file = new ZipPassThrough(entry.name);
    zip.add(file);
    file.push(entry.bytes, true);
    yield* drain();
  }

  zip.end();
  yield* drain();
}

const logger = new Logger('DesignArchive');

/**
 * Streams an archive to the response. A failure after the headers went out
 * can no longer be a status code, so the connection is cut: the browser then
 * reports a failed download rather than saving a truncated zip as if it
 * were whole. A browser that goes away stops the reading too.
 */
export async function sendArchive(archive: DesignArchive, response: Response): Promise<void> {
  response.status(200);
  response.setHeader('Content-Type', 'application/zip');
  response.setHeader('Content-Disposition', contentDisposition(archive.fileName));
  response.setHeader('Cache-Control', 'no-store');

  try {
    for await (const chunk of zipStored(archive.entries)) {
      if (response.destroyed) return;
      if (!response.write(chunk)) await writable(response);
    }

    response.end();
  } catch (error) {
    logger.error(
      `studio.archive_failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    response.destroy();
  }
}

/** Waits until the response takes more bytes, or until the browser has gone. */
async function writable(response: Response): Promise<void> {
  const settled = new AbortController();

  try {
    await Promise.race([
      once(response, 'drain', { signal: settled.signal }),
      once(response, 'close', { signal: settled.signal }),
    ]);
  } finally {
    // Removes the listener of whichever did not happen.
    settled.abort();
  }
}
