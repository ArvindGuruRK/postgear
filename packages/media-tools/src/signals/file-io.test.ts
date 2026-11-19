import { gzipSync } from 'node:zlib';
import {
  chatTrack,
  SIGNALS_FILE_FORMAT,
  type SignalsFile,
  SignalsFileError,
} from '@postgear/video-engine';
import { gunzipSignalsFile, gzipSignalsFile, SIGNALS_MAX_GZ_BYTES } from './file-io';

const FILE: SignalsFile = {
  format: SIGNALS_FILE_FORMAT,
  durationMs: 60_000,
  tracks: [chatTrack([{ offsetMs: 1_000 }, { offsetMs: 30_000, weight: 1.5 }], 60_000)],
};

describe('the stored signals file', () => {
  it('round trips through gzip', async () => {
    const bytes = await gzipSignalsFile(FILE);
    expect(bytes[0]).toBe(0x1f);
    expect(bytes[1]).toBe(0x8b);
    const back = await gunzipSignalsFile(bytes);
    expect(back.durationMs).toBe(60_000);
    expect(back.tracks[0]?.name).toBe('chat');
    expect(back.tracks[0]?.values).toEqual(FILE.tracks[0]?.values);
  });

  it('refuses bytes that are not a gzipped signals file', async () => {
    await expect(gunzipSignalsFile(Buffer.from('not gzip'))).rejects.toBeInstanceOf(
      SignalsFileError,
    );
    await expect(gunzipSignalsFile(gzipSync(Buffer.from('{"format":9}')))).rejects.toBeInstanceOf(
      SignalsFileError,
    );
    await expect(gunzipSignalsFile(Buffer.alloc(SIGNALS_MAX_GZ_BYTES + 1))).rejects.toBeInstanceOf(
      SignalsFileError,
    );
  });
});
