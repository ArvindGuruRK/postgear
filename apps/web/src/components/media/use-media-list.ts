'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { MediaItem, MediaPage } from '@/types/media';

export type MediaFilter = 'all' | 'image' | 'video';

/** How long typing pauses before a search is sent. */
const SEARCH_DELAY_MS = 250;

/**
 * One page of the media library, with search, type filter and paging.
 *
 * Shared by the Media page and the composer's picker, so both show the same
 * library the same way. Responses are sequenced: typing "beach" fires several
 * searches, and a slow early one must not land after a fast later one and
 * replace its results.
 */
export function useMediaList(initial?: MediaPage | null) {
  const [search, setSearchValue] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [type, setTypeValue] = useState<MediaFilter>('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MediaPage | null>(initial ?? null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const latest = useRef(0);
  const skipFirst = useRef(Boolean(initial));

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the explicit reload trigger
  useEffect(() => {
    // The server already rendered the first page; fetching it again on mount
    // would flash a spinner over content that is already correct.
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }

    const request = ++latest.current;
    const params = new URLSearchParams({ page: String(page) });

    if (debouncedSearch) {
      params.set('search', debouncedSearch);
    }
    if (type !== 'all') {
      params.set('type', type);
    }

    setLoading(true);

    api<MediaPage>(`/media?${params.toString()}`)
      .then((result) => {
        if (request === latest.current) {
          setData(result);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (request === latest.current) {
          setError(
            cause instanceof ApiError ? cause.message : 'The media library could not be loaded.',
          );
        }
      })
      .finally(() => {
        if (request === latest.current) {
          setLoading(false);
        }
      });
  }, [debouncedSearch, type, page, version]);

  const setSearch = useCallback((value: string) => {
    setSearchValue(value);
    setPage(1);
  }, []);

  const setType = useCallback((value: MediaFilter) => {
    setTypeValue(value);
    setPage(1);
  }, []);

  const reload = useCallback(() => setVersion((current) => current + 1), []);

  /** Shows a fresh upload at once, ahead of the refetch that confirms it. */
  const prepend = useCallback((item: MediaItem) => {
    setData((current) =>
      current
        ? {
            ...current,
            media: [item, ...current.media.filter((entry) => entry.id !== item.id)],
            total: current.total + 1,
          }
        : { media: [item], page: 1, pageCount: 1, total: 1 },
    );
  }, []);

  return { search, setSearch, type, setType, page, setPage, data, loading, error, reload, prepend };
}
