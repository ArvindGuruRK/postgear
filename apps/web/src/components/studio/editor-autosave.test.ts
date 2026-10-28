import type { DesignDocument } from '@postgear/design-engine';
import { ApiError } from '@/lib/api';
import type { DesignSaveResult } from '@/types/studio';
import {
  Autosave,
  KEEPALIVE_MAX_BYTES,
  keepaliveFits,
  RETRY_DELAYS_MS,
  refusalOf,
  SAVE_DELAY_MS,
  type SaveBody,
  type SaveRefusal,
  saveInWorkspace,
  utf8Length,
} from './editor-autosave';
import type { SaveState } from './studio-view-model';

/** The controller compares documents by reference and reads only their slide count. */
function doc(label: string, slides = 3): DesignDocument {
  return {
    label,
    slides: Array.from({ length: slides }, (_, index) => ({ id: `${label}-${index}` })),
  } as unknown as DesignDocument;
}

interface Call {
  body: SaveBody;
  keepalive: boolean;
  resolve: (result: DesignSaveResult) => void;
  reject: (error: unknown) => void;
}

function answer(revision: number, title = 'Launch'): DesignSaveResult {
  return {
    id: 'design-1',
    title,
    revision,
    status: 'DRAFT',
    exportStale: true,
    lastSlideIndex: 0,
    updatedAt: '2026-10-27T12:00:00.000Z',
  };
}

function setup() {
  const calls: Call[] = [];
  const statuses: SaveState[] = [];
  const problems: (SaveRefusal | null)[] = [];
  const saved: DesignSaveResult[] = [];
  let online = true;
  const base = doc('base');

  const autosave = new Autosave({ document: base, title: 'Launch', revision: 1 }, 0, {
    send: (body, { keepalive }) =>
      new Promise<DesignSaveResult>((resolve, reject) =>
        calls.push({ body, keepalive, resolve, reject }),
      ),
    onStatus: (status, problem) => {
      statuses.push(status);
      problems.push(problem);
    },
    onSaved: (result) => saved.push(result),
    isOnline: () => online,
  });

  return {
    autosave,
    calls,
    statuses,
    problems,
    saved,
    base,
    goOffline: () => {
      online = false;
    },
  };
}

/** Lets settled promises run their callbacks. */
async function flushPromises() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('Autosave', () => {
  it('saves after a pause, and says Saved only once the server confirms', async () => {
    const { autosave, calls, statuses, saved } = setup();
    const edited = doc('edited');

    autosave.update({ document: edited, title: 'Launch', slideIndex: 2 });
    expect(autosave.status).toBe('pending');

    jest.advanceTimersByTime(SAVE_DELAY_MS - 1);
    expect(calls).toHaveLength(0);

    jest.advanceTimersByTime(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ revision: 1, document: edited, lastSlideIndex: 2 });
    expect(calls[0]?.keepalive).toBe(false);
    expect(autosave.status).toBe('saving');

    calls[0]?.resolve(answer(2));
    await flushPromises();

    expect(autosave.status).toBe('saved');
    expect(saved).toEqual([answer(2)]);
    expect(autosave.revision).toBe(2);
    expect(statuses).toEqual(['pending', 'saving', 'saved']);
  });

  it('restarts the pause while edits keep coming', () => {
    const { autosave, calls } = setup();

    autosave.update({ document: doc('a'), title: 'Launch', slideIndex: 0 });
    jest.advanceTimersByTime(1_000);
    autosave.update({ document: doc('b'), title: 'Launch', slideIndex: 0 });
    jest.advanceTimersByTime(1_000);

    expect(calls).toHaveLength(0);
    jest.advanceTimersByTime(SAVE_DELAY_MS);
    expect(calls).toHaveLength(1);
  });

  it('does not save for moving between slides alone', () => {
    const { autosave, calls, base } = setup();

    autosave.update({ document: base, title: 'Launch', slideIndex: 2 });
    jest.advanceTimersByTime(SAVE_DELAY_MS * 2);

    expect(calls).toHaveLength(0);
    expect(autosave.status).toBe('saved');
  });

  it('sends a rename without the document, and both together when both changed', async () => {
    const { autosave, calls, base } = setup();

    autosave.update({ document: base, title: 'Spring Launch', slideIndex: 0 });
    jest.advanceTimersByTime(SAVE_DELAY_MS);
    expect(calls[0]?.body).toEqual({ revision: 1, title: 'Spring Launch' });

    calls[0]?.resolve(answer(2, 'Spring Launch'));
    await flushPromises();

    const edited = doc('edited', 2);
    autosave.update({ document: edited, title: 'Summer Launch', slideIndex: 5 });
    jest.advanceTimersByTime(SAVE_DELAY_MS);
    expect(calls[1]?.body).toEqual({
      revision: 2,
      title: 'Summer Launch',
      document: edited,
      lastSlideIndex: 1,
    });
  });

  it('sends a change made during a save after it, against the new revision', async () => {
    const { autosave, calls } = setup();
    const first = doc('first');
    const second = doc('second');

    autosave.update({ document: first, title: 'Launch', slideIndex: 0 });
    jest.advanceTimersByTime(SAVE_DELAY_MS);
    autosave.update({ document: second, title: 'Launch', slideIndex: 0 });
    jest.advanceTimersByTime(SAVE_DELAY_MS);

    // The pause ended while the first save was still out: nothing races it.
    expect(calls).toHaveLength(1);

    calls[0]?.resolve(answer(2));
    await flushPromises();

    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toMatchObject({ revision: 2, document: second });
    expect(autosave.status).toBe('saving');
  });

  it('cancels a waiting save when an undo goes back to what the server has', () => {
    const { autosave, calls, base } = setup();

    autosave.update({ document: doc('edited'), title: 'Launch', slideIndex: 0 });
    autosave.update({ document: base, title: 'Launch', slideIndex: 0 });
    jest.advanceTimersByTime(SAVE_DELAY_MS * 2);

    expect(calls).toHaveLength(0);
    expect(autosave.status).toBe('saved');
  });

  it('retries a save that failed for want of a connection, on a growing delay', async () => {
    const { autosave, calls, goOffline } = setup();

    autosave.update({ document: doc('edited'), title: 'Launch', slideIndex: 0 });
    jest.advanceTimersByTime(SAVE_DELAY_MS);
    goOffline();
    calls[0]?.reject(new TypeError('Failed to fetch'));
    await flushPromises();

    expect(autosave.status).toBe('offline');

    jest.advanceTimersByTime(RETRY_DELAYS_MS[0] ?? 0);
    expect(calls).toHaveLength(2);

    calls[1]?.reject(new TypeError('Failed to fetch'));
    await flushPromises();
    jest.advanceTimersByTime((RETRY_DELAYS_MS[1] ?? 0) - 1);
    expect(calls).toHaveLength(2);
    jest.advanceTimersByTime(1);
    expect(calls).toHaveLength(3);

    calls[2]?.resolve(answer(2));
    await flushPromises();
    expect(autosave.status).toBe('saved');
  });

  it('says Retrying for a server error while the browser is online', async () => {
    const { autosave, calls } = setup();

    autosave.update({ document: doc('edited'), title: 'Launch', slideIndex: 0 });
    jest.advanceTimersByTime(SAVE_DELAY_MS);
    calls[0]?.reject(new ApiError('Something went wrong. Please try again.', 503));
    await flushPromises();

    expect(autosave.status).toBe('retrying');
  });

  it('sends at once when the connection comes back', async () => {
    const { autosave, calls, goOffline } = setup();

    autosave.update({ document: doc('edited'), title: 'Launch', slideIndex: 0 });
    jest.advanceTimersByTime(SAVE_DELAY_MS);
    goOffline();
    calls[0]?.reject(new TypeError('Failed to fetch'));
    await flushPromises();

    autosave.online();
    expect(calls).toHaveLength(2);
  });

  it('keeps what is on screen and the latest edits while it retries', async () => {
    const { autosave, calls } = setup();
    const later = doc('later');

    autosave.update({ document: doc('edited'), title: 'Launch', slideIndex: 0 });
    jest.advanceTimersByTime(SAVE_DELAY_MS);
    calls[0]?.reject(new ApiError('Bad gateway', 502));
    await flushPromises();

    autosave.update({ document: later, title: 'Launch', slideIndex: 0 });
    // Edits during a retry do not reset its clock or send early.
    jest.advanceTimersByTime(SAVE_DELAY_MS);
    expect(calls).toHaveLength(1);

    jest.advanceTimersByTime(RETRY_DELAYS_MS[0] ?? 0);
    expect(calls[1]?.body.document).toBe(later);
  });

  it('stops on a conflict and sends nothing until the person chooses', async () => {
    const { autosave, calls } = setup();

    autosave.update({ document: doc('edited'), title: 'Launch', slideIndex: 0 });
    jest.advanceTimersByTime(SAVE_DELAY_MS);
    calls[0]?.reject(new ApiError('This design changed in another tab.', 409, 'design_conflict'));
    await flushPromises();

    expect(autosave.status).toBe('conflict');

    autosave.update({ document: doc('more'), title: 'Launch', slideIndex: 0 });
    jest.advanceTimersByTime(SAVE_DELAY_MS * 10);
    expect(calls).toHaveLength(1);
    await expect(autosave.flush()).resolves.toBe(false);
  });

  it('starts again from the server after Reload', async () => {
    const { autosave, calls } = setup();
    const server = doc('server');

    autosave.update({ document: doc('edited'), title: 'Launch', slideIndex: 0 });
    jest.advanceTimersByTime(SAVE_DELAY_MS);
    calls[0]?.reject(new ApiError('Conflict', 409, 'design_conflict'));
    await flushPromises();

    autosave.replace(
      { document: server, title: 'Launch', revision: 7 },
      { document: server, title: 'Launch', slideIndex: 0 },
    );

    expect(autosave.status).toBe('saved');
    expect(calls).toHaveLength(1);
  });

  it('saves the version on screen over the server when the person keeps it', async () => {
    const { autosave, calls } = setup();
    const mine = doc('mine');

    autosave.update({ document: mine, title: 'Launch', slideIndex: 1 });
    jest.advanceTimersByTime(SAVE_DELAY_MS);
    calls[0]?.reject(new ApiError('Conflict', 409, 'design_conflict'));
    await flushPromises();

    autosave.replace(
      { document: doc('theirs'), title: 'Their Title', revision: 9 },
      { document: mine, title: 'Launch', slideIndex: 1 },
    );

    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toEqual({
      revision: 9,
      title: 'Launch',
      document: mine,
      lastSlideIndex: 1,
    });
  });

  it('ignores the answer to a save sent before a reload', async () => {
    const { autosave, calls, saved } = setup();
    const server = doc('server');

    autosave.update({ document: doc('edited'), title: 'Launch', slideIndex: 0 });
    jest.advanceTimersByTime(SAVE_DELAY_MS);
    autosave.replace(
      { document: server, title: 'Launch', revision: 4 },
      { document: server, title: 'Launch', slideIndex: 0 },
    );

    calls[0]?.resolve(answer(2));
    await flushPromises();

    expect(saved).toHaveLength(0);
    expect(autosave.revision).toBe(4);
  });

  it('stops on a refusal with a sentence to show, and Try Again sends once more', async () => {
    const { autosave, calls, problems } = setup();

    autosave.update({ document: doc('edited'), title: 'Launch', slideIndex: 0 });
    jest.advanceTimersByTime(SAVE_DELAY_MS);
    calls[0]?.reject(new ApiError('Invalid input', 400));
    await flushPromises();

    expect(autosave.status).toBe('failed');
    expect(problems.at(-1)).toEqual({
      kind: 'retry',
      message: 'This change could not be saved. Undo it, then try again.',
    });

    jest.advanceTimersByTime(RETRY_DELAYS_MS.at(-1) ?? 0);
    expect(calls).toHaveLength(1);

    autosave.retry();
    expect(calls).toHaveLength(2);
    expect(problems.at(-1)).toBeNull();
    calls[1]?.resolve(answer(2));
    await flushPromises();
    expect(autosave.status).toBe('saved');
  });

  it('says a design that is gone is gone, and a session that ended needs a sign-in', async () => {
    const gone = setup();
    gone.autosave.update({ document: doc('edited'), title: 'Launch', slideIndex: 0 });
    jest.advanceTimersByTime(SAVE_DELAY_MS);
    gone.calls[0]?.reject(new ApiError('That design could not be found.', 404));
    await flushPromises();

    expect(gone.autosave.status).toBe('failed');
    expect(gone.problems.at(-1)).toEqual({
      kind: 'gone',
      message: 'This design was deleted, so your changes cannot be saved.',
    });
    // Nothing is left that could be saved, so closing the tab does not ask.
    expect(gone.autosave.unsaved).toBe(false);
    // Nothing more is sent, and leaving cannot save it either.
    jest.advanceTimersByTime(RETRY_DELAYS_MS.at(-1) ?? 0);
    gone.autosave.dispose();
    expect(gone.calls).toHaveLength(1);

    const ended = setup();
    ended.autosave.update({ document: doc('edited'), title: 'Launch', slideIndex: 0 });
    jest.advanceTimersByTime(SAVE_DELAY_MS);
    ended.calls[0]?.reject(new ApiError('Unauthorized', 401));
    await flushPromises();

    expect(ended.autosave.status).toBe('failed');
    expect(ended.problems.at(-1)?.kind).toBe('signIn');
    // Signing in again can still save it: leaving still asks.
    expect(ended.autosave.unsaved).toBe(true);
    await expect(ended.autosave.flush()).resolves.toBe(false);
  });

  it('flushes on demand, answering whether the server has everything', async () => {
    const { autosave, calls } = setup();

    await expect(autosave.flush()).resolves.toBe(true);

    autosave.update({ document: doc('edited'), title: 'Launch', slideIndex: 0 });
    const done = autosave.flush();
    expect(calls).toHaveLength(1);

    calls[0]?.resolve(answer(2));
    await expect(done).resolves.toBe(true);
  });

  it('answers a flush with false when the save fails', async () => {
    const { autosave, calls } = setup();

    autosave.update({ document: doc('edited'), title: 'Launch', slideIndex: 0 });
    const done = autosave.flush();
    calls[0]?.reject(new ApiError('Service unavailable', 503));

    await expect(done).resolves.toBe(false);
  });

  it('sends what is unsaved on a request that outlives the page when it closes', () => {
    const { autosave, calls } = setup();

    autosave.update({ document: doc('edited'), title: 'Launch', slideIndex: 0 });
    autosave.dispose();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.keepalive).toBe(true);

    // Nothing more happens after it is closed.
    jest.advanceTimersByTime(SAVE_DELAY_MS * 10);
    expect(calls).toHaveLength(1);
  });

  it('sends the rest after a save still in flight when the editor closes', async () => {
    const { autosave, calls } = setup();
    const later = doc('later');

    autosave.update({ document: doc('edited'), title: 'Launch', slideIndex: 0 });
    jest.advanceTimersByTime(SAVE_DELAY_MS);
    autosave.update({ document: later, title: 'Launch', slideIndex: 0 });
    autosave.dispose();
    expect(calls).toHaveLength(1);

    calls[0]?.resolve(answer(2));
    await flushPromises();

    expect(calls).toHaveLength(2);
    expect(calls[1]?.keepalive).toBe(true);
    expect(calls[1]?.body).toMatchObject({ revision: 2, document: later });
  });

  it('sends what is waiting when the page is hidden, and copies a save in flight', async () => {
    const { autosave, calls } = setup();

    autosave.update({ document: doc('edited'), title: 'Launch', slideIndex: 0 });
    autosave.keepalive();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.keepalive).toBe(true);

    autosave.update({ document: doc('later'), title: 'Launch', slideIndex: 0 });
    autosave.keepalive();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.keepalive).toBe(true);
    expect(calls[1]?.body.revision).toBe(1);

    // The copy's answer is not the controller's business.
    calls[1]?.reject(new ApiError('Conflict', 409, 'design_conflict'));
    calls[0]?.resolve(answer(2));
    await flushPromises();
    expect(autosave.status).not.toBe('conflict');
  });

  it('sends nothing on close when everything is saved', () => {
    const { autosave, calls } = setup();

    autosave.dispose();
    expect(calls).toHaveLength(0);
  });
});

describe('refusalOf', () => {
  it('says what is left to do for each refusal', () => {
    expect(refusalOf(new ApiError('Invalid input', 400)).kind).toBe('retry');
    expect(refusalOf(new ApiError('Unauthorized', 401))).toEqual({
      kind: 'signIn',
      message:
        'Your session has ended, so your changes cannot be saved. Sign in again to keep editing this design.',
    });
    expect(refusalOf(new ApiError('That design could not be found.', 404)).kind).toBe('gone');
    // Anything else keeps the API's own sentence.
    expect(refusalOf(new ApiError('You cannot edit designs.', 403))).toEqual({
      kind: 'retry',
      message: 'You cannot edit designs.',
    });
  });
});

describe('keepaliveFits', () => {
  const body = (title: string): SaveBody => ({ revision: 1, title });
  /** The bytes the body takes around a title of plain letters. */
  const frame = JSON.stringify(body('')).length;

  it('counts the bytes a body is sent as', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('é')).toBe(2);
    expect(utf8Length('€')).toBe(3);
    expect(utf8Length('😀')).toBe(4);
  });

  it('asks for keepalive only while the body is at most the cap, in UTF-8', () => {
    expect(keepaliveFits(body('a'.repeat(KEEPALIVE_MAX_BYTES - frame)))).toBe(true);
    expect(keepaliveFits(body('a'.repeat(KEEPALIVE_MAX_BYTES - frame + 1)))).toBe(false);

    // Fewer characters than the cap, more bytes than it.
    const wide = '€'.repeat(Math.ceil(KEEPALIVE_MAX_BYTES / 3));
    expect(wide.length).toBeLessThan(KEEPALIVE_MAX_BYTES);
    expect(keepaliveFits(body(wide))).toBe(false);
  });
});

describe('saveInWorkspace', () => {
  const RESULT = answer(2);
  const missing = () => new ApiError('That design could not be found.', 404);

  it("points the API back at the design's workspace once, after a 404, and sends again", async () => {
    const save = jest.fn().mockRejectedValueOnce(missing()).mockResolvedValueOnce(RESULT);
    const resync = jest.fn().mockResolvedValue(undefined);

    await expect(saveInWorkspace(save, resync, false)).resolves.toBe(RESULT);
    expect(resync).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('calls the design gone only when the second try is a 404 as well', async () => {
    const save = jest.fn().mockRejectedValue(missing());
    const resync = jest.fn().mockResolvedValue(undefined);

    await expect(saveInWorkspace(save, resync, false)).rejects.toMatchObject({ status: 404 });
    expect(save).toHaveBeenCalledTimes(2);
    expect(resync).toHaveBeenCalledTimes(1);
  });

  it('leaves the workspace alone for a save that outlives the page, and for other failures', async () => {
    const keepalive = jest.fn().mockRejectedValue(missing());
    const resync = jest.fn().mockResolvedValue(undefined);
    await expect(saveInWorkspace(keepalive, resync, true)).rejects.toMatchObject({ status: 404 });

    const conflict = jest.fn().mockRejectedValue(new ApiError('Conflict', 409, 'design_conflict'));
    await expect(saveInWorkspace(conflict, resync, false)).rejects.toMatchObject({ status: 409 });

    const offline = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(saveInWorkspace(offline, resync, false)).rejects.toBeInstanceOf(TypeError);

    expect(resync).not.toHaveBeenCalled();
    expect(keepalive).toHaveBeenCalledTimes(1);
  });

  it('fails as the switch failed when the workspace cannot be pointed back', async () => {
    const save = jest.fn().mockRejectedValue(missing());
    const resync = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(saveInWorkspace(save, resync, false)).rejects.toBeInstanceOf(TypeError);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
