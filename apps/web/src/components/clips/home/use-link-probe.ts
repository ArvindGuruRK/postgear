'use client';

/**
 * Reading a pasted link (Module 06): `probe(url)` on Enter or Find Video,
 * never while typing.
 *
 * A newer probe always wins. Each one aborts the one before it, and an answer
 * that arrives for an older sequence number is dropped even if its abort was
 * too late, so a slow first link can never replace the card of a second.
 *
 * States: `idle`, `looking` (the card's skeleton), `found` (the card), and
 * `refused` (the API's sentence and code: the alert under the field). A
 * cancel the page asked for (a new probe, leaving the page) is not an error.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { probeLink } from '@/lib/clips-api';
import type { ClipProbe } from '@/types/clips';

export const PROBE_UNREACHABLE = 'We could not reach Clips. Check your connection and try again.';

export type LinkProbeState =
  | { kind: 'idle' }
  | { kind: 'looking'; url: string }
  | { kind: 'found'; url: string; probe: ClipProbe }
  | { kind: 'refused'; url: string; message: string; code: string | undefined };

export interface LinkProbe {
  state: LinkProbeState;
  probe: (url: string) => void;
  /** Shows a probe that was made elsewhere (a channel row's Import). */
  show: (url: string, probe: ClipProbe) => void;
  reset: () => void;
}

export type ProbeFn = (url: string, options: { signal: AbortSignal }) => Promise<ClipProbe>;

export function useLinkProbe(probeFn: ProbeFn = probeLink): LinkProbe {
  const [state, setState] = useState<LinkProbeState>({ kind: 'idle' });
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const cancelRunning = useCallback(() => {
    sequence.current += 1;
    controller.current?.abort();
    controller.current = null;
  }, []);

  const probe = useCallback(
    (raw: string) => {
      const url = raw.trim();
      cancelRunning();
      if (!url) {
        setState({ kind: 'idle' });
        return;
      }
      const mine = sequence.current;
      const abort = new AbortController();
      controller.current = abort;
      setState({ kind: 'looking', url });

      probeFn(url, { signal: abort.signal })
        .then((answer) => {
          if (mine !== sequence.current) return;
          setState({ kind: 'found', url, probe: answer });
        })
        .catch((cause: unknown) => {
          if (mine !== sequence.current || abort.signal.aborted) return;
          if (cause instanceof ApiError && cause.status !== 0) {
            setState({ kind: 'refused', url, message: cause.message, code: cause.code });
          } else {
            setState({ kind: 'refused', url, message: PROBE_UNREACHABLE, code: undefined });
          }
        })
        .finally(() => {
          if (controller.current === abort) controller.current = null;
        });
    },
    [cancelRunning, probeFn],
  );

  const show = useCallback(
    (url: string, answer: ClipProbe) => {
      cancelRunning();
      setState({ kind: 'found', url, probe: answer });
    },
    [cancelRunning],
  );

  const reset = useCallback(() => {
    cancelRunning();
    setState({ kind: 'idle' });
  }, [cancelRunning]);

  useEffect(() => cancelRunning, [cancelRunning]);

  return { state, probe, show, reset };
}
