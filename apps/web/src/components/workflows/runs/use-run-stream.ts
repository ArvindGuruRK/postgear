'use client';

/**
 * One run, kept current (Module 08): the detail, then live changes until
 * the run ends. The Runs tab and the builder's test run both read it.
 *
 * - **First the detail** (`GET /automation-runs/:runId`): it carries what
 *   the stream does not (the graph that ran, the mode), and paints at once.
 * - **Then the event stream** (`runEventsPath`, `lib/sse.ts`): every `step`
 *   and `run` event goes through `applyRunEvent`, which ignores replays and
 *   never takes a finished run back to running. The stream closes after the
 *   run's final event.
 * - **Polling as the fallback**: when the stream drops, is refused or ends
 *   (after its 30 minutes, or after an `error` event) while the run is still
 *   going, the detail is fetched every 1.5 s until the run ends.
 *
 * `refresh()` starts over (after a cancel or a review answer).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { streamGetEvents } from '@/lib/sse';
import { getRun, runEventsPath } from '@/lib/workflows-api';
import {
  applyRunEvent,
  buildRunModel,
  isTerminalRun,
  type RunModel,
  type RunStreamEvent,
} from './run-model';

const POLL_MS = 1500;
const LOAD_FAILED = 'The run could not be loaded.';

export interface RunStream {
  model: RunModel | null;
  /** One sentence when the run could not be loaded. */
  error: string | null;
  /** Fetch it again now (after a cancel or a review answer). */
  refresh: () => void;
}

function messageOf(cause: unknown): string {
  return cause instanceof ApiError && cause.status !== 0 ? cause.message : LOAD_FAILED;
}

export function useRunStream(runId: string | null): RunStream {
  const [model, setModel] = useState<RunModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const current = useRef<RunModel | null>(null);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    // `tick` only asks to start over.
    void tick;
    if (!runId) {
      current.current = null;
      setModel(null);
      setError(null);
      return;
    }

    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const show = (next: RunModel) => {
      if (!live) return;
      current.current = next;
      setModel(next);
    };
    const ended = () => current.current !== null && isTerminalRun(current.current.runStatus);

    const poll = () => {
      timer = null;
      getRun(runId)
        .then((detail) => {
          if (!live) return;
          show(buildRunModel(detail));
          setError(null);
          if (!ended()) timer = setTimeout(poll, POLL_MS);
        })
        .catch((cause: unknown) => {
          if (!live) return;
          setError(messageOf(cause));
          // A run that is gone stays gone; anything else may pass.
          if (!(cause instanceof ApiError && cause.status === 404))
            timer = setTimeout(poll, POLL_MS);
        });
    };

    const listen = () => {
      streamGetEvents<RunStreamEvent>(runEventsPath(runId), {
        signal: controller.signal,
        onEvent: (event) => {
          const model = current.current;
          if (!live || !model || event.type === 'error') return;
          const next = applyRunEvent(model, event);
          if (next !== model) show(next);
        },
      })
        .catch(() => undefined)
        .then(() => {
          if (live && !ended()) timer = setTimeout(poll, POLL_MS);
        });
    };

    // A new run never shows the last one's paint while it loads.
    if (current.current?.runId !== runId) {
      current.current = null;
      setModel(null);
    }
    setError(null);

    getRun(runId)
      .then((detail) => {
        if (!live) return;
        show(buildRunModel(detail));
        if (!ended()) listen();
      })
      .catch((cause: unknown) => {
        if (!live) return;
        setError(messageOf(cause));
        if (!(cause instanceof ApiError && cause.status === 404)) timer = setTimeout(poll, POLL_MS);
      });

    return () => {
      live = false;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [runId, tick]);

  return { model, error, refresh };
}
