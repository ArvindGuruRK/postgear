/**
 * Export The Transcript (Sprint 13, Module 17 item 10): the file a video's or
 * a clip's words become, and how it is sent.
 *
 * - `GET /clips/videos/:videoId/transcript/download?format=txt|srt&language`:
 *   the video's own words with its fixes, on the video's clock.
 * - `GET /clips/:clipId/transcript/download?format=txt|srt`: the words the
 *   clip's captions show (a translation or a file when that is what they
 *   show, the clip's own edits, hidden words left out, bleeps masked), on the
 *   clip's clock through the time map; the video's own words when the clip
 *   has no captions yet. A montage gives each of its videos' words in play
 *   order.
 *
 * Both are free, read-only and allowed to Editors. 409 `transcript_missing`
 * when nothing was listened to, 409 `transcript_empty` when nothing is left
 * to write. The file is speech, so it is never cached and never logged: the
 * log line carries counts only.
 */
import {
  type TimedWord,
  TRANSCRIPT_FILE_FORMATS,
  type TranscriptFileFormat,
  transcriptFile,
} from '@postgear/video-engine';
import type { Response } from 'express';
import { z } from 'zod';
import { contentDisposition, safeFileName } from '../../../common/attachment';

export const transcriptFormatSchema = z.enum(TRANSCRIPT_FILE_FORMATS);

/** Every word a transcript file holds: the whole stored file, not a window of it. */
export const WHOLE_TRANSCRIPT = [{ fromMs: 0, toMs: Number.MAX_SAFE_INTEGER }] as const;

export interface TranscriptDownload {
  fileName: string;
  contentType: string;
  body: string;
  words: number;
  cues: number;
}

const CONTENT_TYPES: Record<TranscriptFileFormat, string> = {
  txt: 'text/plain; charset=utf-8',
  srt: 'application/x-subrip; charset=utf-8',
};

/** The file for these words, named after the clip or video it came from. */
export function transcriptDownload(
  title: string,
  words: readonly TimedWord[],
  format: TranscriptFileFormat,
): TranscriptDownload {
  const file = transcriptFile(words, format);
  return {
    fileName: `${safeFileName(title, 'Transcript')}.${format}`,
    contentType: CONTENT_TYPES[format],
    ...file,
  };
}

/** Sent as an attachment that no cache keeps. */
export function sendTranscriptDownload(response: Response, file: TranscriptDownload): void {
  response
    .status(200)
    .set({
      'Content-Type': file.contentType,
      'Content-Disposition': contentDisposition(file.fileName),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    .send(file.body);
}
