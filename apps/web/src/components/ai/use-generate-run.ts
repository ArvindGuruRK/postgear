'use client';

/**
 * One `POST /ai/generate` run at a time, fed into the generate reducer.
 *
 * Shared by the AI page's Generate mode and Discover's Create Post sheet
 * (Sprint 11), so both stream, stop and fail the same way. An
 * `AbortController` is the Stop button, and also what unmounting pulls. A
 * stream that closes without a terminal event is reported as a failure
 * rather than left spinning: the API always ends with `done` or `error`, so
 * silence means the connection dropped. The terminal events carry the
 * post-charge balance, handed to `onCredits`.
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { ApiError } from '@/lib/api';
import { streamEvents } from '@/lib/sse';
import type { AiCredits, GenerateRequestBody, GenerateStreamEvent } from '@/types/ai';
import { type GenerateState, generateReducer, initialGenerateState } from './generate-state';

export const CONNECTION_CLOSED =
  'The connection closed before the generation finished. Please try again.';
export const SERVICE_UNREACHABLE =
  'The AI service could not be reached. Check your connection and try again.';

export interface GenerateRun {
  state: GenerateState;
  generate: (request: GenerateRequestBody) => Promise<void>;
  stop: () => void;
  /** Back to idle, keeping the last balance; stops a run first. */
  reset: () => void;
}

export function useGenerateRun(
  credits: AiCredits | null,
  onCredits: (credits: AiCredits) => void,
): GenerateRun {
  const [state, dispatch] = useReducer(generateReducer, credits, initialGenerateState);
  const controller = useRef<AbortController | null>(null);

  const generate = useCallback(
    async (request: GenerateRequestBody) => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      let settled = false;

      dispatch({ type: 'start', request });

      try {
        await streamEvents<GenerateStreamEvent>('/ai/generate', request, {
          signal: current.signal,
          onEvent: (event) => {
            dispatch({ type: 'event', event });
            if (event.type === 'done' || event.type === 'error') {
              settled = true;
              onCredits(event.credits);
            }
          },
        });

        if (!settled) {
          dispatch({ type: 'fail', message: CONNECTION_CLOSED });
        }
      } catch (cause) {
        if (current.signal.aborted) {
          dispatch({ type: 'abort' });
        } else {
          dispatch({
            type: 'fail',
            message: cause instanceof ApiError ? cause.message : SERVICE_UNREACHABLE,
            status: cause instanceof ApiError ? cause.status : undefined,
          });
        }
      } finally {
        if (controller.current === current) {
          controller.current = null;
        }
      }
    },
    [onCredits],
  );

  // Leaving the page stops the run; the API aborts the engine on disconnect.
  useEffect(() => () => controller.current?.abort(), []);

  const stop = useCallback(() => controller.current?.abort(), []);

  const reset = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    dispatch({ type: 'reset' });
  }, []);

  return { state, generate, stop, reset };
}
