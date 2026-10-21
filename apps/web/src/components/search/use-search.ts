'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { SearchResponse } from '@/types/search';

/** How long typing pauses before a search is sent. */
const SEARCH_DELAY_MS = 250;

/** The API refuses a search shorter than this; one letter would match nearly everything. */
export const MIN_SEARCH_LENGTH = 2;

/** The API refuses a longer one. */
export const MAX_SEARCH_LENGTH = 100;

/** The typed text as the API will read it: whitespace collapsed, ends trimmed. */
export function cleanQuery(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export interface WorkspaceSearch {
  /** The search is long enough to run. False means "show the starting view". */
  active: boolean;
  /** The results shown. Belong to `answeredFor`, which may lag behind what is typed. */
  data: SearchResponse | null;
  /** The cleaned search that `data` answers. */
  answeredFor: string;
  /** Typing has paused or a request is out: the results shown are about to change. */
  pending: boolean;
  error: string | null;
  retry: () => void;
}

/**
 * Searches the workspace as the person types (2026-10-21).
 *
 * Typing is debounced, and responses are sequenced: "launch" fires several
 * searches on the way, and a slow early one must not land after a fast later
 * one and replace its results. The last good answer stays up while the next
 * one loads, so the list does not flash empty between keystrokes. A search too
 * short to run clears everything and sends nothing.
 */
export function useWorkspaceSearch(query: string, enabled: boolean): WorkspaceSearch {
  const cleaned = useMemo(() => cleanQuery(query).slice(0, MAX_SEARCH_LENGTH), [query]);
  const runnable = enabled && cleaned.length >= MIN_SEARCH_LENGTH;

  const [settled, setSettled] = useState('');
  const [data, setData] = useState<SearchResponse | null>(null);
  const [answeredFor, setAnsweredFor] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    // Short or closed: nothing to wait for, and nothing may linger.
    if (!runnable) {
      setSettled('');
      return;
    }

    const timer = setTimeout(() => setSettled(cleaned), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [runnable, cleaned]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the explicit retry trigger
  useEffect(() => {
    // Invalidates any request still out, so a late answer to an old search
    // cannot appear once the box has been cleared or closed.
    const request = ++latest.current;

    if (settled === '') {
      setData(null);
      setAnsweredFor('');
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    api<SearchResponse>(`/search?${new URLSearchParams({ q: settled }).toString()}`)
      .then((result) => {
        if (request === latest.current) {
          setData(result);
          setAnsweredFor(settled);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (request === latest.current) {
          setError(cause instanceof ApiError ? cause.message : 'The search could not be loaded.');
        }
      })
      .finally(() => {
        if (request === latest.current) {
          setLoading(false);
        }
      });
  }, [settled, version]);

  const retry = useCallback(() => setVersion((current) => current + 1), []);

  return {
    active: runnable,
    data: runnable ? data : null,
    answeredFor: runnable ? answeredFor : '',
    pending: runnable && (cleaned !== settled || loading),
    error: runnable ? error : null,
    retry,
  };
}
