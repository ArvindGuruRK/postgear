'use client';

/**
 * One tab's answer (Trending, News, Videos or Festivals) for the current
 * place and language.
 *
 * Sequenced like `use-analytics.ts`: an answer for Paris that lands after the
 * reader has moved on to Chennai is dropped, never shown under the Chennai
 * chip. The last good answer stays on screen while the next one loads, so a
 * language switch dims the page instead of blanking it.
 *
 * Refresh only asks again. Whether that reaches Google is the API's call: its
 * shared copy answers until its window is up, so pressing Refresh twenty
 * times costs nothing outside.
 *
 * News can carry a topic (Module 06). It is part of the question on that tab
 * only, so a topic picked on News never makes Trending ask again.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { getFeed } from '@/lib/discover-api';
import type { FeedKind, FeedResponse, Locality, NewsTopic } from '@/types/discover';

export interface FeedHandle {
  data: FeedResponse | null;
  loading: boolean;
  /** The API's sentence for a refusal, or a plain one when it did not answer. */
  error: string | null;
  refresh: () => void;
}

export const FEED_FAILED = 'Try again in a moment.';

/** The tabs whose answer is in the chip's language. Videos and festivals read the same in every one. */
const SPOKEN_KINDS: ReadonlySet<FeedKind> = new Set(['trending', 'news']);

/**
 * The key of what was asked, so an answer can be matched to its question.
 * The language is part of it only where it changes the answer, so switching
 * it on Videos or Festivals asks for nothing. The topic is News's alone.
 */
export function feedKey(
  kind: FeedKind,
  place: Locality,
  language: string,
  topic?: NewsTopic | null,
): string {
  const spoken = SPOKEN_KINDS.has(kind) ? language : '';
  const about = kind === 'news' && topic ? topic : '';
  return [kind, place.countryCode, place.regionCode, place.city, spoken, about].join('|');
}

export function useFeed(
  kind: FeedKind | null,
  place: Locality | null,
  language: string | null,
  /** The News topic; null or left out is All. Ignored on the other tabs. */
  topic?: NewsTopic | null,
): FeedHandle {
  const [data, setData] = useState<FeedResponse | null>(null);
  const [dataKey, setDataKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const latest = useRef(0);

  const about = kind === 'news' && topic ? topic : null;
  const key = kind && place && language ? feedKey(kind, place, language, about) : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for kind, place, language and topic; `version` is the refresh trigger
  useEffect(() => {
    if (!kind || !place || !language || !key) {
      latest.current += 1;
      setLoading(false);
      return;
    }

    const request = ++latest.current;
    // Module 10: a question nobody is waiting for any more is cancelled, not
    // only ignored, so a quick run through three places costs one request.
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    getFeed(kind, place, language, about ?? undefined, controller.signal)
      .then((answer) => {
        if (request !== latest.current) return;
        setData(answer);
        setDataKey(key);
      })
      .catch((cause: unknown) => {
        if (request !== latest.current || controller.signal.aborted) return;
        setError(cause instanceof ApiError && cause.status !== 0 ? cause.message : FEED_FAILED);
      })
      .finally(() => {
        if (request === latest.current) setLoading(false);
      });

    return () => controller.abort();
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
