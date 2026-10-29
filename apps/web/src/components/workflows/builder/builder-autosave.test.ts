import { type AutomationGraph, emptyGraph } from '@postgear/automation';
import { ApiError } from '@/lib/api';
import type { AutomationSaveResult } from '@/types/workflows';
import { BuilderAutosave, type SaveBody, type SaveStatus } from './builder-autosave';

function result(revision: number): AutomationSaveResult {
  return {
    id: 'w1',
    name: 'Report',
    draftRevision: revision,
    triggerType: null,
    hasUnpublishedChanges: false,
    updatedAt: '2026-10-29T00:00:00.000Z',
  };
}

function setup(send: jest.Mock, online = true) {
  const statuses: SaveStatus[] = [];
  const saver = new BuilderAutosave(
    { graph: emptyGraph(), name: 'Report', revision: 3 },
    {
      send,
      onStatus: (status) => statuses.push(status),
      isOnline: () => online,
      retryDelays: [100, 200],
    },
  );
  return { saver, statuses };
}

const edited = (): AutomationGraph => ({ ...emptyGraph(), notes: [] });

describe('BuilderAutosave', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('waits for a 1 s pause, then sends the graph with the revision', async () => {
    const send = jest.fn(async (body: SaveBody) => result(body.draftRevision + 1));
    const { saver, statuses } = setup(send);
    const graph = edited();

    saver.update({ graph, name: 'Report' });
    jest.advanceTimersByTime(900);
    saver.update({ graph: edited(), name: 'Report' });
    jest.advanceTimersByTime(900);
    expect(send).not.toHaveBeenCalled();
    expect(saver.status).toBe('pending');

    await jest.advanceTimersByTimeAsync(200);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ draftRevision: 3 });
    expect(send.mock.calls[0][0].name).toBeUndefined();
    expect(saver.status).toBe('saved');
    expect(saver.currentRevision).toBe(4);
    expect(statuses).toEqual(['pending', 'saving', 'saved']);
  });

  it('says Saved only after the server answers', async () => {
    let answer: (value: AutomationSaveResult) => void = () => undefined;
    const send = jest.fn(
      () =>
        new Promise<AutomationSaveResult>((resolve) => {
          answer = resolve;
        }),
    );
    const { saver } = setup(send);
    saver.update({ graph: edited(), name: 'Renamed' });
    jest.advanceTimersByTime(1_000);
    expect(saver.status).toBe('saving');
    expect(saver.unsaved).toBe(true);
    answer(result(4));
    await Promise.resolve();
    expect(saver.status).toBe('saved');
  });

  it('stops on a 409 and sends nothing more', async () => {
    const send = jest.fn(async () => {
      throw new ApiError('Changed elsewhere', 409);
    });
    const { saver } = setup(send);
    saver.update({ graph: edited(), name: 'Report' });
    await jest.advanceTimersByTimeAsync(1_000);
    expect(saver.status).toBe('conflict');
    saver.update({ graph: edited(), name: 'Report' });
    await jest.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(1);
    await expect(saver.flush()).resolves.toBe(false);
  });

  it('retries a network failure, offline when the browser says so, and goes at once when back', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new ApiError('Network', 0))
      .mockResolvedValueOnce(result(4));
    const { saver } = setup(send, false);
    saver.update({ graph: edited(), name: 'Report' });
    await jest.advanceTimersByTimeAsync(1_000);
    expect(saver.status).toBe('offline');

    saver.online();
    await jest.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(2);
    expect(saver.status).toBe('saved');
  });

  it('keeps retrying a busy server on a growing delay', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new ApiError('Busy', 503))
      .mockRejectedValueOnce(new ApiError('Busy', 503))
      .mockResolvedValueOnce(result(4));
    const { saver } = setup(send);
    saver.update({ graph: edited(), name: 'Report' });
    await jest.advanceTimersByTimeAsync(1_000);
    expect(saver.status).toBe('retrying');
    await jest.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(200);
    expect(send).toHaveBeenCalledTimes(3);
    expect(saver.status).toBe('saved');
  });

  it('sends a change made during a save right after it, on the new revision', async () => {
    const send = jest.fn(async (body: SaveBody) => result(body.draftRevision + 1));
    const { saver } = setup(send);
    saver.update({ graph: edited(), name: 'Report' });
    jest.advanceTimersByTime(1_000);
    saver.update({ graph: edited(), name: 'Report' });
    await jest.advanceTimersByTimeAsync(1_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].draftRevision).toBe(4);
  });

  it('flushes before leaving, and an undo back to the saved graph needs no save', async () => {
    const send = jest.fn(async () => result(4));
    const { saver } = setup(send);
    const original = emptyGraph();
    const other = new BuilderAutosave(
      { graph: original, name: 'Report', revision: 3 },
      { send, onStatus: () => undefined },
    );
    other.update({ graph: edited(), name: 'Report' });
    other.update({ graph: original, name: 'Report' });
    expect(other.status).toBe('saved');
    expect(other.unsaved).toBe(false);

    saver.update({ graph: edited(), name: 'Report' });
    await expect(saver.flush()).resolves.toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
