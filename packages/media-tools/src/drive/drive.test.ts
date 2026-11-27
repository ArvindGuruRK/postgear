/**
 * The Drive binding (Module 12, D13-09) against a fake `fetch`: nothing ever
 * reaches Google. The token travels in one header only, never in an address
 * or an error, and the fetch stops past its byte limit.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  createDriveFiles,
  createSimulatedDriveFiles,
  DriveError,
  driveStatusCode,
  SIMULATED_DRIVE_FILE_ID,
} from './drive';

const TOKEN = 'ya29.simulated-token-value';
const FILE = 'drive-file-0001';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'drive-test-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function fakeFetch(answer: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('the real Drive binding', () => {
  it('reads the facts with the token in the header only', async () => {
    const { impl, calls } = fakeFetch(
      () => new Response(JSON.stringify({ name: 'talk.mp4', mimeType: 'video/mp4', size: '1234' })),
    );
    const facts = await createDriveFiles({ fetchImpl: impl }).facts(FILE, TOKEN);
    expect(facts).toEqual({ name: 'talk.mp4', mimeType: 'video/mp4', bytes: 1234 });
    expect(calls[0]?.url).toContain(`/drive/v3/files/${FILE}?fields=`);
    expect(calls[0]?.url).not.toContain(TOKEN);
    expect((calls[0]?.init.headers as Record<string, string> | undefined)?.authorization).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it.each([
    [401, 'drive_not_connected'],
    [403, 'drive_not_connected'],
    [404, 'link_not_found'],
    [500, 'tool_failed'],
  ])('answers %i as %s, with no token in the error', async (status, code) => {
    const { impl } = fakeFetch(() => new Response('{"error":"x"}', { status }));
    const error = await createDriveFiles({ fetchImpl: impl })
      .facts(FILE, TOKEN)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DriveError);
    expect((error as DriveError).code).toBe(code);
    expect(String((error as Error).message)).not.toContain(TOKEN);
    expect(driveStatusCode(status)).toBe(code);
  });

  it('refuses a file with no size (a Google Doc or a folder) and one in the bin', async () => {
    const doc = fakeFetch(
      () =>
        new Response(
          JSON.stringify({ name: 'Notes', mimeType: 'application/vnd.google-apps.document' }),
        ),
    );
    await expect(
      createDriveFiles({ fetchImpl: doc.impl }).facts(FILE, TOKEN),
    ).rejects.toMatchObject({
      code: 'upload_not_video',
    });
    const binned = fakeFetch(
      () =>
        new Response(
          JSON.stringify({ name: 'a.mp4', mimeType: 'video/mp4', size: '5', trashed: true }),
        ),
    );
    await expect(
      createDriveFiles({ fetchImpl: binned.impl }).facts(FILE, TOKEN),
    ).rejects.toMatchObject({
      code: 'link_not_found',
    });
  });

  it('refuses a bad file id or token before any request', async () => {
    const { impl, calls } = fakeFetch(() => new Response('{}'));
    const files = createDriveFiles({ fetchImpl: impl });
    await expect(files.facts('../etc', TOKEN)).rejects.toMatchObject({ code: 'link_not_found' });
    await expect(files.facts(FILE, 'bad\ntoken')).rejects.toMatchObject({
      code: 'drive_not_connected',
    });
    expect(calls).toHaveLength(0);
  });

  it('fetches the bytes into the file and stops past the limit', async () => {
    const body = Buffer.alloc(4096, 7);
    const { impl } = fakeFetch(() => new Response(body));
    const files = createDriveFiles({ fetchImpl: impl });
    const outFile = path.join(dir, 'original.mp4');
    const seen: number[] = [];
    const got = await files.fetch(
      { fileId: FILE, accessToken: TOKEN, outFile, maxBytes: 10_000 },
      (bytes) => seen.push(bytes),
      new AbortController().signal,
    );
    expect(got.bytes).toBe(4096);
    expect((await readFile(outFile)).length).toBe(4096);
    expect(seen[seen.length - 1]).toBe(4096);

    const tooBig = path.join(dir, 'big.mp4');
    await expect(
      files.fetch(
        { fileId: FILE, accessToken: TOKEN, outFile: tooBig, maxBytes: 100 },
        () => {},
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'too_big' });
  });
});

describe('the simulated Drive binding', () => {
  it('answers its made-up files from a local sample and refuses the rest', async () => {
    await writeFile(path.join(dir, 'talk.mp4'), Buffer.alloc(2048, 1));
    const files = createSimulatedDriveFiles({ samplesDir: dir });
    expect(files.simulated).toBe(true);
    await expect(files.facts(SIMULATED_DRIVE_FILE_ID, TOKEN)).resolves.toEqual({
      name: 'PostGear Sample Talk From Drive.mp4',
      mimeType: 'video/mp4',
      bytes: 2048,
    });
    const outFile = path.join(dir, 'out.mp4');
    await expect(
      files.fetch(
        { fileId: SIMULATED_DRIVE_FILE_ID, accessToken: TOKEN, outFile, maxBytes: 4096 },
        () => {},
        new AbortController().signal,
      ),
    ).resolves.toEqual({ path: outFile, bytes: 2048 });
    await expect(files.facts('sim-drive-denied-0001', TOKEN)).rejects.toMatchObject({
      code: 'drive_not_connected',
    });
    await expect(files.facts('sim-drive-document-01', TOKEN)).rejects.toMatchObject({
      code: 'upload_not_video',
    });
    await expect(files.facts('someone-elses-file-01', TOKEN)).rejects.toMatchObject({
      code: 'link_not_found',
    });
  });
});
