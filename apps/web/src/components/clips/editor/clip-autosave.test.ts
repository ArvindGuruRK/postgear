import { type ClipDocument, createClipDocument } from '@postgear/video-engine';
import { ApiError } from '@/lib/api';
import type { ClipView } from '@/types/clips';
import {
  CLIP_CHANGE_REFUSED,
  CLIP_GONE,
  CLIP_SAVE_DELAY_MS,
  ClipAutosave,
  type ClipSaveBody,
  type ClipSaveState,
  clipSaveLabel,
  keepaliveFits,
  utf8Length,
} from './clip-autosave';

function makeDoc(toMs = 40_000): ClipDocument {
  return createClipDocument({
    videoId: '3f2a9c1e-0000-4000-8000-000000000001',
    fromMs: 10_000,
    toMs,
    ratio: '9:16',
  });
}

function clipAt(revision: number): ClipView {
  return { revision } as ClipView;
}

interface Call {
  body: ClipSaveBody;
  keepalive: boolean;
  resolve: (clip: ClipView) => void;
  reject: (error: unknown) => void;
}

function harness(options: { online?: () => boolean } = {}) {
  const calls: Call[] = [];
  const states: ClipSaveState[] = [];
  const doc = makeDoc();
  const autosave = new ClipAutosave(
    { document: doc, title: 'Clip', revision: 1 },
    {
      send: (body, { keepalive }) =>
        new Promise<ClipView>((resolve, reject) =>
          calls.push({ body, keepalive, resolve, reject }),
        ),
      onStatus: (state) => states.push(state),
      isOnline: options.online,
      retryDelays: [100, 200],
    },
  );
  return { autosave, calls, states, doc };
}

/** Lets the promise callbacks run. */
async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('ClipAutosave', () => {
  it('waits for a pause, then sends the document with the revision', async () => {
    const { autosave, calls, doc } = harness();
    const next = makeDoc(30_000);
    autosave.update({ document: next, title: 'Clip' });
    expect(autosave.status).toBe('pending');

    jest.advanceTimersByTime(CLIP_SAVE_DELAY_MS - 1);
    autosave.update({ document: makeDoc(31_000), title: 'Clip' });
    jest.advanceTimersByTime(CLIP_SAVE_DELAY_MS - 1);
    expect(calls).toHaveLength(0);
    jest.advanceTimersByTime(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].body.revision).toBe(1);
    expect(calls[0].body.document).not.toBe(doc);
    expect(calls[0].body.title).toBeUndefined();
    expect(autosave.status).toBe('saving');

    calls[0].resolve(clipAt(2));
    await settle();
    expect(autosave.status).toBe('saved');
    expect(autosave.revision).toBe(2);
  });

  it('sends a rename alone, without the document', () => {
    const { autosave, calls, doc } = harness();
    autosave.update({ document: doc, title: 'Renamed' });
    jest.advanceTimersByTime(CLIP_SAVE_DELAY_MS);
    expect(calls[0].body).toEqual({ revision: 1, title: 'Renamed' });
  });

  it('is saved again when an undo goes back to what the server has', () => {
    const { autosave, calls, doc } = harness();
    autosave.update({ document: makeDoc(30_000), title: 'Clip' });
    autosave.update({ document: doc, title: 'Clip' });
    expect(autosave.status).toBe('saved');
    jest.advanceTimersByTime(CLIP_SAVE_DELAY_MS * 2);
    expect(calls).toHaveLength(0);
  });

  it('sends a change made while a save is in flight after it, on the new revision', async () => {
    const { autosave, calls } = harness();
    autosave.update({ document: makeDoc(30_000), title: 'Clip' });
    jest.advanceTimersByTime(CLIP_SAVE_DELAY_MS);
    autosave.update({ document: makeDoc(31_000), title: 'Clip' });
    jest.advanceTimersByTime(CLIP_SAVE_DELAY_MS);
    expect(calls).toHaveLength(1);

    calls[0].resolve(clipAt(2));
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls[1].body.revision).toBe(2);
  });

  it('retries a failure that may pass, on a growing delay', async () => {
    const { autosave, calls } = harness();
    autosave.update({ document: makeDoc(30_000), title: 'Clip' });
    jest.advanceTimersByTime(CLIP_SAVE_DELAY_MS);
    calls[0].reject(new ApiError('Busy', 503));
    await settle();
    expect(autosave.status).toBe('retrying');

    jest.advanceTimersByTime(100);
    expect(calls).toHaveLength(2);
    calls[1].reject(new ApiError('Busy', 503));
    await settle();
    jest.advanceTimersByTime(199);
    expect(calls).toHaveLength(2);
    jest.advanceTimersByTime(1);
    expect(calls).toHaveLength(3);
    calls[2].resolve(clipAt(2));
    await settle();
    expect(autosave.status).toBe('saved');
  });

  it('says offline without a connection, and saves as soon as it is back', async () => {
    let online = false;
    const { autosave, calls, states } = harness({ online: () => online });
    autosave.update({ document: makeDoc(30_000), title: 'Clip' });
    jest.advanceTimersByTime(CLIP_SAVE_DELAY_MS);
    calls[0].reject(new ApiError('No connection', 0));
    await settle();
    expect(autosave.status).toBe('offline');
    expect(states).toContain('offline');

    online = true;
    autosave.online();
    expect(calls).toHaveLength(2);
    calls[1].resolve(clipAt(2));
    await settle();
    expect(autosave.status).toBe('saved');
  });

  it('stops saving on a conflict and never overwrites', async () => {
    const { autosave, calls } = harness();
    autosave.update({ document: makeDoc(30_000), title: 'Clip' });
    jest.advanceTimersByTime(CLIP_SAVE_DELAY_MS);
    calls[0].reject(new ApiError('Changed elsewhere', 409, 'clip_changed_elsewhere'));
    await settle();
    expect(autosave.status).toBe('conflict');

    autosave.update({ document: makeDoc(31_000), title: 'Clip' });
    jest.advanceTimersByTime(CLIP_SAVE_DELAY_MS * 10);
    autosave.online();
    autosave.keepalive();
    await expect(autosave.flush()).resolves.toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('starts again from the server after Reload', async () => {
    const { autosave, calls } = harness();
    autosave.update({ document: makeDoc(30_000), title: 'Clip' });
    jest.advanceTimersByTime(CLIP_SAVE_DELAY_MS);
    calls[0].reject(new ApiError('Changed elsewhere', 409));
    await settle();

    const server = makeDoc(35_000);
    autosave.replace(
      { document: server, title: 'Theirs', revision: 7 },
      { document: server, title: 'Theirs' },
    );
    expect(autosave.status).toBe('saved');
    autosave.update({ document: makeDoc(32_000), title: 'Theirs' });
    jest.advanceTimersByTime(CLIP_SAVE_DELAY_MS);
    expect(calls[1].body.revision).toBe(7);
  });

  it('holds a refusal with its sentence, and Try Again sends it', async () => {
    const statuses: { state: ClipSaveState; message: string | null }[] = [];
    const calls: Call[] = [];
    const doc = makeDoc();
    const autosave = new ClipAutosave(
      { document: doc, title: 'Clip', revision: 1 },
      {
        send: (body, { keepalive }) =>
          new Promise<ClipView>((resolve, reject) =>
            calls.push({ body, keepalive, resolve, reject }),
          ),
        onStatus: (state, refusal) => statuses.push({ state, message: refusal?.message ?? null }),
      },
    );
    autosave.update({ document: makeDoc(30_000), title: 'Clip' });
    jest.advanceTimersByTime(CLIP_SAVE_DELAY_MS);
    calls[0].reject(new ApiError('Invalid', 422, 'clip_document_invalid'));
    await settle();
    expect(statuses.at(-1)).toEqual({ state: 'failed', message: CLIP_CHANGE_REFUSED });

    autosave.retry();
    expect(calls).toHaveLength(2);
  });

  it('does not ask before leaving a clip that was deleted', async () => {
    const statuses: (string | null)[] = [];
    const calls: Call[] = [];
    const autosave = new ClipAutosave(
      { document: makeDoc(), title: 'Clip', revision: 1 },
      {
        send: (body, { keepalive }) =>
          new Promise<ClipView>((resolve, reject) =>
            calls.push({ body, keepalive, resolve, reject }),
          ),
        onStatus: (_state, refusal) => statuses.push(refusal?.message ?? null),
      },
    );
    autosave.update({ document: makeDoc(30_000), title: 'Clip' });
    jest.advanceTimersByTime(CLIP_SAVE_DELAY_MS);
    calls[0].reject(new ApiError('Not found', 404));
    await settle();
    expect(statuses.at(-1)).toBe(CLIP_GONE);
    expect(autosave.unsaved).toBe(false);
  });

  it('flush saves at once and answers once the server has it', async () => {
    const { autosave, calls } = harness();
    autosave.update({ document: makeDoc(30_000), title: 'Clip' });
    const flushed = autosave.flush();
    expect(calls).toHaveLength(1);
    calls[0].resolve(clipAt(2));
    await expect(flushed).resolves.toBe(true);
  });

  it('flushRevision answers the revision the server saved, for an export to send', async () => {
    const { autosave, calls } = harness();
    // Nothing waiting: the revision the editor opened on.
    await expect(autosave.flushRevision()).resolves.toBe(1);

    autosave.update({ document: makeDoc(30_000), title: 'Clip' });
    const flushed = autosave.flushRevision();
    calls[0].resolve(clipAt(4));
    await expect(flushed).resolves.toBe(4);

    // A conflict: nothing the export could trust.
    autosave.update({ document: makeDoc(31_000), title: 'Clip' });
    const refused = autosave.flushRevision();
    calls[1].reject(new ApiError('Changed elsewhere', 409, 'clip_changed_elsewhere'));
    await expect(refused).resolves.toBeNull();
  });

  it('sends what is unsaved as keepalive when the page hides or the editor closes', () => {
    const first = harness();
    first.autosave.update({ document: makeDoc(30_000), title: 'Clip' });
    first.autosave.keepalive();
    expect(first.calls[0].keepalive).toBe(true);

    const second = harness();
    second.autosave.update({ document: second.doc, title: 'Renamed' });
    second.autosave.dispose();
    expect(second.calls[0]).toMatchObject({ keepalive: true, body: { title: 'Renamed' } });
  });

  it('a send that throws at once is a failure like any other', async () => {
    const autosave = new ClipAutosave(
      { document: makeDoc(), title: 'Clip', revision: 1 },
      {
        send: () => {
          throw new ApiError('Busy', 503);
        },
        onStatus: () => undefined,
        retryDelays: [100],
      },
    );
    autosave.update({ document: makeDoc(30_000), title: 'Clip' });
    jest.advanceTimersByTime(CLIP_SAVE_DELAY_MS);
    await settle();
    expect(autosave.status).toBe('retrying');
  });
});

describe('save words and sizes', () => {
  it('says Offline, will retry', () => {
    expect(clipSaveLabel('offline')).toBe('Offline, will retry');
    expect(clipSaveLabel('saving')).toBe('Saving');
    expect(clipSaveLabel('conflict')).toBe('Not saved');
  });

  it('counts UTF-8 bytes and caps keepalive bodies', () => {
    expect(utf8Length('aé€😀')).toBe(1 + 2 + 3 + 4);
    expect(keepaliveFits({ revision: 1, title: 'x' })).toBe(true);
    expect(keepaliveFits({ revision: 1, title: 'x'.repeat(70_000) })).toBe(false);
  });
});
