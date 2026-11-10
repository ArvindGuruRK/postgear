'use client';

/**
 * One tab's answer for the current place and language.
 *
 * Sequenced like `use-analytics.ts`: an answer for Paris that lands after the
 * reader has moved on to Chennai is dropped, never shown under the Chennai
 * chip. The last good answer stays on screen while the next one loads, so a
 * language switch dims the page instead of blanking it.
 *
 * Refresh only asks again. Whether that reaches Google is the API's call: its
 * shared copy answers until its window is up, so pressing Refresh twenty
 * times costs nothing outside.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { getFeed } from '@/lib/discover-api';
import type { FeedKind, FeedResponse, Locality } from '@/types/discover';

export interface FeedHandle {
  data: FeedResponse | null;
  loading: boolean;
  /** The API's sentence for a refusal, or a plain one when it did not answer. */
  error: string | null;
  refresh: () => void;
}

export const FEED_FAILED = 'Try again in a moment.';

/** The key of what was asked, so an answer can be matched to its question. */
function feedKey(kind: FeedKind, place: Locality, language: string): string {
  return [kind, place.countryCode, place.regionCode, place.city, language].join('|');
}

export function useFeed(
  kind: FeedKind | null,
  place: Locality | null,
  language: string | null,
): FeedHandle {
  const [data, setData] = useState<FeedResponse | null>(null);
  const [dataKey, setDataKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const latest = useRef(0);

  const key = kind && place && language ? feedKey(kind, place, language) : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for kind, place and language; `version` is the refresh trigger
  useEffect(() => {
    if (!kind || !place || !language || !key) {
      latest.current += 1;
      setLoading(false);
      return;
    }

    const request = ++latest.current;
    setLoading(true);
    setError(null);

    getFeed(kind, place, language)
      .then((answer) => {
        if (request !== latest.current) return;
        setData(answer);
        setDataKey(key);
      })
      .catch((cause: unknown) => {
        if (request !== latest.current) return;
        setError(cause instanceof ApiError && cause.status !== 0 ? cause.message : FEED_FAILED);
      })
      .finally(() => {
        if (request === latest.current) setLoading(false);
      });
  }, [key, version]);

  const refresh = useCallback(() => setVersion((count) => count + 1), []);

  // An answer for another tab is never shown as this one's, even for a frame.
  const shown = data && kind && data.kind === kind ? data : null;

  return {
    data: shown,
    loading: loading || (key !== null && dataKey !== key && !error),
    error,
    refresh,
  };
}
