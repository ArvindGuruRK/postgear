/**
 * Reading and writing a video's transcript file in the private space
 * (Sprint 13, Module 02). The file is the engine's transcript JSON, gzipped.
 *
 * The API reads it to answer words and to keep fixes; it writes it only for a
 * captions file a person supplied (Module 03). A listened transcript is
 * written by the worker.
 */
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import { Inject, Injectable } from '@nestjs/common';
import type { PrivateStorage } from '@postgear/storage';
import { decodeTranscript, encodeTranscript, type Transcript } from '@postgear/video-engine';
import { PRIVATE_STORAGE } from '../../media/storage/storage.interface';

const gunzipAsync = promisify(gunzip);
const gzipAsync = promisify(gzip);

export const TRANSCRIPT_MIME = 'application/gzip';
/** A stored transcript larger than this is refused before it is unzipped (a day of speech is far under). */
export const TRANSCRIPT_MAX_GZ_BYTES = 32 * 1024 * 1024;
const TRANSCRIPT_MAX_JSON_BYTES = 256 * 1024 * 1024;

@Injectable()
export class ClipTranscriptStore {
  constructor(@Inject(PRIVATE_STORAGE) private readonly storage: PrivateStorage) {}

  /** The transcript at `key`, or null when the file is gone or does not read. Never throws its text. */
  async read(key: string): Promise<Transcript | null> {
    const opened = await this.storage.getStream(key);
    if (!opened) return null;
    if (opened.totalBytes > TRANSCRIPT_MAX_GZ_BYTES) {
      opened.body.destroy();
      return null;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of opened.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    try {
      const json = await gunzipAsync(Buffer.concat(chunks), {
        maxOutputLength: TRANSCRIPT_MAX_JSON_BYTES,
      });
      return decodeTranscript(json.toString('utf8'));
    } catch {
      // A file that does not unzip or does not read is treated as not there, never echoed.
      return null;
    }
  }

  /** Stores a transcript at `key`; answers the bytes written. */
  async write(key: string, transcript: Transcript): Promise<number> {
    const bytes = await gzipAsync(Buffer.from(encodeTranscript(transcript), 'utf8'));
    await this.storage.put(key, bytes, TRANSCRIPT_MIME);
    return bytes.length;
  }

  delete(key: string): Promise<void> {
    return this.storage.delete(key);
  }
}
