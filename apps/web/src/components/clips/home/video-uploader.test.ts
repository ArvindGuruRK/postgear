import type { ClipsStatus } from '@/types/clips';
import { fixtureStatus, fixtureVideo } from '../clips-fixtures';
import {
  RETRY_WAITS_MS,
  UPLOAD_FAILED,
  type UploadSnapshot,
  type UploadTransport,
  VideoUploader,
} from './video-uploader';

const PART = 10;

function videoFile(bytes = 30, name = 'stream.mp4', type = 'video/mp4'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** A transport that answers from memory; each test bends the part it is about. */
function fakeTransport(partCount = 3) {
  let online = true;
  let signCalls = 0;
  const waiting = new Set<() => void>();
  const transport = {
    start: jest.fn(async () => ({
      videoId: 'video-1',
      uploadId: 'upload-1',
      partSize: PART,
      partCount,
    })),
    sign: jest.fn(async (_uploadId: string, partNumbers: number[]) => {
      signCalls += 1;
      const batch = signCalls;
      return partNumbers.map((partNumber) => ({
        partNumber,
        url: `https://space.test/part-${partNumber}?signed=${batch}`,
      }));
    }),
    put: jest.fn(
      async (
        url: string,
        body: Blob,
        onProgress: (loaded: number) => void,
        _signal: AbortSignal,
      ) => {
        onProgress(body.size / 2);
        onProgress(body.size);
        return `etag:${url}`;
      },
    ),
    complete: jest.fn(async () => ({ video: fixtureVideo(), job: null })),
    cancel: jest.fn(async () => ({})),
    readDuration: jest.fn(async (): Promise<number | null> => null),
    isOnline: () => online,
    onOnline: (callback: () => void) => {
      waiting.add(callback);
      return () => {
        waiting.delete(callback);
      };
    },
    wait: jest.fn(async (_ms: number, _signal: AbortSignal) => undefined),
  } satisfies UploadTransport;

  return {
    transport,
    get waitingForOnline() {
      return waiting.size;
    },
    setOnline(next: boolean) {
      online = next;
      if (next) for (const callback of [...waiting]) callback();
    },
  };
}

function record(uploader: VideoUploader): UploadSnapshot[] {
  const seen: UploadSnapshot[] = [];
  uploader.subscribe((snapshot) => seen.push(snapshot));
  return seen;
}

const partOf = (url: string) => Number(url.match(/part-(\d+)/)?.[1]);

describe('VideoUploader', () => {
  it('uploads every part, stays under 100 until the parts are joined, and completes in order', async () => {
    const fake = fakeTransport(3);
    const uploader = new VideoUploader(videoFile(30), fixtureStatus(), fake.transport);
    const seen = record(uploader);

    const final = await uploader.run();

    expect(final.phase).toBe('done');
    expect(final.percent).toBe(100);
    expect(final.videoId).toBe('video-1');
    expect(fake.transport.start).toHaveBeenCalledWith({
      name: 'stream.mp4',
      bytes: 30,
      mimeType: 'video/mp4',
    });
    const uploading = seen.filter((snapshot) => snapshot.phase === 'uploading');
    expect(uploading.length).toBeGreaterThan(0);
    expect(Math.max(...uploading.map((snapshot) => snapshot.percent))).toBe(99);
    // Progress never goes backwards.
    const percents = seen.map((snapshot) => snapshot.percent);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(seen.map((snapshot) => snapshot.phase)).toEqual(
      expect.arrayContaining(['starting', 'uploading', 'finishing', 'done']),
    );
    const [, parts] = fake.transport.complete.mock.calls[0] as unknown as [
      string,
      Array<{ partNumber: number; etag: string }>,
    ];
    expect(parts.map((part) => part.partNumber)).toEqual([1, 2, 3]);
    expect(parts[0].etag).toBe('etag:https://space.test/part-1?signed=1');
  });

  it('sends each part as its own slice of the file', async () => {
    const fake = fakeTransport(3);
    const uploader = new VideoUploader(videoFile(25), fixtureStatus(), fake.transport);
    await uploader.run();
    const sizes = fake.transport.put.mock.calls
      .map(([url, body]) => [partOf(url), body.size])
      .sort((a, b) => a[0] - b[0]);
    expect(sizes).toEqual([
      [1, 10],
      [2, 10],
      [3, 5],
    ]);
  });

  it('tries a failed part again after the first back-off and then finishes', async () => {
    const fake = fakeTransport(3);
    let failedOnce = false;
    fake.transport.put.mockImplementation(async (url, body, onProgress) => {
      if (partOf(url) === 2 && !failedOnce) {
        failedOnce = true;
        onProgress(body.size / 2);
        throw { status: 500, message: 'Storage hiccup.' };
      }
      onProgress(body.size);
      return `etag:${url}`;
    });
    const uploader = new VideoUploader(videoFile(30), fixtureStatus(), fake.transport);

    const final = await uploader.run();

    expect(final.phase).toBe('done');
    expect(fake.transport.wait).toHaveBeenCalledTimes(1);
    expect(fake.transport.wait.mock.calls[0][0]).toBe(RETRY_WAITS_MS[0]);
    expect(fake.transport.put.mock.calls.filter(([url]) => partOf(url) === 2)).toHaveLength(2);
    expect(fake.transport.complete).toHaveBeenCalledTimes(1);
  });

  it('signs a refused (403) part again before the next try', async () => {
    const fake = fakeTransport(1);
    let refused = false;
    fake.transport.put.mockImplementation(async (url) => {
      if (!refused) {
        refused = true;
        throw { status: 403, message: 'Request has expired' };
      }
      return `etag:${url}`;
    });
    const uploader = new VideoUploader(videoFile(10), fixtureStatus(), fake.transport);

    const final = await uploader.run();

    expect(final.phase).toBe('done');
    expect(fake.transport.sign).toHaveBeenCalledTimes(2);
    expect(fake.transport.sign.mock.calls[1][1]).toContain(1);
    const urls = fake.transport.put.mock.calls.map(([url]) => url);
    expect(urls).toEqual([
      'https://space.test/part-1?signed=1',
      'https://space.test/part-1?signed=2',
    ]);
  });

  it('keeps an address that was not refused (a 500 is retried on the same address)', async () => {
    const fake = fakeTransport(1);
    let failed = false;
    fake.transport.put.mockImplementation(async (url) => {
      if (!failed) {
        failed = true;
        throw { status: 500, message: 'Busy' };
      }
      return `etag:${url}`;
    });
    await new VideoUploader(videoFile(10), fixtureStatus(), fake.transport).run();
    expect(fake.transport.sign).toHaveBeenCalledTimes(1);
  });

  it('ends a part that keeps failing as failed with the answer it got', async () => {
    const fake = fakeTransport(1);
    fake.transport.put.mockImplementation(async () => {
      throw { status: 500, message: 'The storage refused this part.' };
    });
    const uploader = new VideoUploader(videoFile(10), fixtureStatus(), fake.transport);

    const final = await uploader.run();

    expect(final.phase).toBe('failed');
    expect(final.error).toBe('The storage refused this part.');
    expect(fake.transport.wait.mock.calls.map(([ms]) => ms)).toEqual([...RETRY_WAITS_MS]);
    expect(fake.transport.put).toHaveBeenCalledTimes(RETRY_WAITS_MS.length + 1);
    expect(fake.transport.complete).not.toHaveBeenCalled();
  });

  it("fails with the API's sentence and code when the start is refused", async () => {
    const fake = fakeTransport();
    fake.transport.start.mockRejectedValue({
      status: 402,
      message: 'This workspace is out of video space.',
      code: 'clips_storage',
    });
    const final = await new VideoUploader(videoFile(), fixtureStatus(), fake.transport).run();
    expect(final).toMatchObject({
      phase: 'failed',
      error: 'This workspace is out of video space.',
      errorCode: 'clips_storage',
    });
    expect(fake.transport.put).not.toHaveBeenCalled();
  });

  it('says the upload did not finish when there was no answer at all', async () => {
    const fake = fakeTransport();
    fake.transport.complete.mockRejectedValue(new TypeError('Failed to fetch'));
    const final = await new VideoUploader(videoFile(), fixtureStatus(), fake.transport).run();
    expect(final).toMatchObject({ phase: 'failed', error: UPLOAD_FAILED, errorCode: null });
  });

  it('refuses before a byte is sent: not a video, too big, too long', async () => {
    const notVideo = fakeTransport();
    const a = await new VideoUploader(
      videoFile(30, 'notes.txt', 'text/plain'),
      fixtureStatus(),
      notVideo.transport,
    ).run();
    expect(a.phase).toBe('failed');
    expect(notVideo.transport.start).not.toHaveBeenCalled();

    const tooBig = fakeTransport();
    const tinyCap = fixtureStatus();
    const status: ClipsStatus = {
      ...tinyCap,
      limits: { ...tinyCap.limits, 'clips.upload_max_gb': 0.00000001 },
    };
    const b = await new VideoUploader(videoFile(30), status, tooBig.transport).run();
    expect(b.phase).toBe('failed');
    expect(b.error).toMatch(/^This file is .+\. Uploads can be up to/);
    expect(tooBig.transport.readDuration).not.toHaveBeenCalled();
    expect(tooBig.transport.start).not.toHaveBeenCalled();

    const tooLong = fakeTransport();
    tooLong.transport.readDuration.mockResolvedValue(300 * 60_000);
    const c = await new VideoUploader(videoFile(30), fixtureStatus(), tooLong.transport).run();
    expect(c).toMatchObject({ phase: 'failed', errorCode: 'clips_video_too_long' });
    expect(tooLong.transport.start).not.toHaveBeenCalled();
  });

  it('ends in cancelled, not failed, when the person cancels mid-part', async () => {
    const fake = fakeTransport(1);
    let putStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      putStarted = resolve;
    });
    fake.transport.put.mockImplementation(
      (_url, _body, _onProgress, signal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject({ status: 0, message: '' }));
          putStarted();
        }),
    );
    const uploader = new VideoUploader(videoFile(10), fixtureStatus(), fake.transport);
    const seen = record(uploader);

    const running = uploader.run();
    await started;
    uploader.cancel();
    const final = await running;

    expect(final.phase).toBe('cancelled');
    expect(final.error).toBeNull();
    expect(seen.some((snapshot) => snapshot.phase === 'failed')).toBe(false);
    expect(fake.transport.cancel).toHaveBeenCalledWith('video-1');
    expect(fake.transport.complete).not.toHaveBeenCalled();
  });

  it('drops the new row when Cancel is pressed while the row is being made', async () => {
    const fake = fakeTransport(3);
    let answerStart: (value: Awaited<ReturnType<UploadTransport['start']>>) => void = () =>
      undefined;
    fake.transport.start.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerStart = resolve;
        }),
    );
    const uploader = new VideoUploader(videoFile(30), fixtureStatus(), fake.transport);
    const running = uploader.run();
    await Promise.resolve();
    await Promise.resolve();

    uploader.cancel();
    expect(fake.transport.cancel).not.toHaveBeenCalled();
    answerStart({ videoId: 'video-9', uploadId: 'upload-9', partSize: PART, partCount: 3 });
    const final = await running;

    expect(final.phase).toBe('cancelled');
    expect(fake.transport.cancel).toHaveBeenCalledWith('video-9');
    expect(fake.transport.put).not.toHaveBeenCalled();
  });

  it('does nothing on cancel once the upload is done', async () => {
    const fake = fakeTransport(1);
    const uploader = new VideoUploader(videoFile(10), fixtureStatus(), fake.transport);
    await uploader.run();
    uploader.cancel();
    expect(uploader.current.phase).toBe('done');
    expect(fake.transport.cancel).not.toHaveBeenCalled();
  });

  it('waits for the connection without spending a try, then carries on', async () => {
    const fake = fakeTransport(1);
    let drops = 0;
    // More drops than there are tries: if a drop spent a try, this would fail.
    fake.transport.put.mockImplementation(async (url) => {
      if (drops < RETRY_WAITS_MS.length + 2) {
        drops += 1;
        fake.setOnline(false);
        throw { status: 0, message: '' };
      }
      return `etag:${url}`;
    });
    const uploader = new VideoUploader(videoFile(10), fixtureStatus(), fake.transport);
    const seen = record(uploader);

    // Each time the uploader starts waiting, the connection comes back.
    uploader.subscribe((snapshot) => {
      if (snapshot.phase === 'waiting') setTimeout(() => fake.setOnline(true), 0);
    });

    const final = await uploader.run();

    expect(final.phase).toBe('done');
    expect(fake.transport.wait).not.toHaveBeenCalled();
    expect(seen.filter((snapshot) => snapshot.phase === 'waiting')).toHaveLength(
      RETRY_WAITS_MS.length + 2,
    );
  });

  it('does not start a part while offline, and cancel ends the wait', async () => {
    const fake = fakeTransport(1);
    fake.setOnline(false);
    const uploader = new VideoUploader(videoFile(10), fixtureStatus(), fake.transport);
    const seen = record(uploader);
    let reachedWait: () => void = () => undefined;
    const waitingNow = new Promise<void>((resolve) => {
      reachedWait = resolve;
    });
    uploader.subscribe((snapshot) => {
      if (snapshot.phase === 'waiting') reachedWait();
    });

    const running = uploader.run();
    await waitingNow;
    expect(uploader.current.phase).toBe('waiting');
    expect(fake.transport.put).not.toHaveBeenCalled();
    expect(fake.waitingForOnline).toBe(1);

    uploader.cancel();
    const final = await running;
    expect(final.phase).toBe('cancelled');
    expect(fake.waitingForOnline).toBe(0);
    expect(seen.some((snapshot) => snapshot.phase === 'failed')).toBe(false);
  });
});
