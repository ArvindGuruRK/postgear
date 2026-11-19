/**
 * The SIGNALS asset on disk: the engine's signals file (one JSON holding
 * every track of a video) gzipped. Research 06 sizes a 6 hour video's tracks
 * at a few hundred KB before gzip, so it is read and written in one go.
 */
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import {
  decodeSignalsFile,
  encodeSignalsFile,
  type SignalsFile,
  SignalsFileError,
} from '@postgear/video-engine';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** The stored asset's type and extension. */
export const SIGNALS_MIME = 'application/gzip';
export const SIGNALS_EXTENSION = 'json.gz';
/** A stored file larger than this is refused before it is unzipped (a 24 hour video is well under). */
export const SIGNALS_MAX_GZ_BYTES = 8 * 1024 * 1024;
const SIGNALS_MAX_JSON_BYTES = 64 * 1024 * 1024;

/** The bytes to store. */
export async function gzipSignalsFile(file: SignalsFile): Promise<Buffer> {
  return gzipAsync(Buffer.from(encodeSignalsFile(file), 'utf8'));
}

/** The file from stored bytes. Throws `SignalsFileError` for anything that does not read. */
export async function gunzipSignalsFile(bytes: Buffer): Promise<SignalsFile> {
  if (bytes.length > SIGNALS_MAX_GZ_BYTES)
    throw new SignalsFileError('The signals file is too large.');
  let json: Buffer;
  try {
    json = await gunzipAsync(bytes, { maxOutputLength: SIGNALS_MAX_JSON_BYTES });
  } catch {
    throw new SignalsFileError();
  }
  return decodeSignalsFile(json.toString('utf8'));
}
