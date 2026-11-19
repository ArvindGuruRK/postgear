'use client';

/**
 * The Videos tab's list (Module 06): the first page, Show More, the sort, and
 * the small changes a card makes to it (a finished import, a retry, a delete)
 * without loading the whole list again.
 *
 * Every request carries a sequence number: an answer for an older sort or an
 * older refresh is dropped, so the list never flips back. Pages are joined by
 * id, so a video that moved while paging is never drawn twice.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { getVideo, listVideos } from '@/lib/clips-api';
import type { ClipVideoCard, ClipVideoSort } from '@/types/clips';

export const VIDEOS_LOAD_FAILED = 'Your videos could not be loaded. Check your connection.';

export interface VideosState {
  cards: ClipVideoCard[];
  total: number;
  sort: ClipVideoSort;
  setSort: (sort: ClipVideoSort) => void;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
  /** Re-reads one video (an import that ended) and puts it in place. */
  refreshOne: (videoId: string) => Promise<void>;
  replace: (card: ClipVideoCard) => void;
  remove: (videoId: string) => void;
}

function messageOf(cause: unknown): string {
  return cause instanceof ApiError && cause.status !== 0 ? cause.message : VIDEOS_LOAD_FAILED;
}

function joinById(current: ClipVideoCard[], more: ClipVideoCard[]): ClipVideoCard[] {
  const seen = new Set(current.map((card) => card.video.id));
  return [...current, ...more.filter((card) => !seen.has(card.video.id))];
}

export function useVideos(initialSort: ClipVideoSort = 'newest'): VideosState {
  const [cards, setCards] = useState<ClipVideoCard[]>([]);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState<ClipVideoSort>(initialSort);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const sequence = useRef(0);

  useEffect(() => {
    void tick;
    const mine = ++sequence.current;
    const controller = new AbortController();
    setLoading(true);
    listVideos({ sort, signal: controller.signal })
      .then((page) => {
        if (mine !== sequence.current) return;
        setCards(page.videos);
        setTotal(page.total);
        setCursor(page.nextCursor);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (mine !== sequence.current || controller.signal.aborted) return;
        setError(messageOf(cause));
      })
      .finally(() => {
        if (mine === sequence.current) setLoading(false);
      });
    return () => controller.abort();
  }, [sort, tick]);

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore) return;
    const mine = sequence.current;
    setLoadingMore(true);
    listVideos({ sort, cursor })
      .then((page) => {
        if (mine !== sequence.current) return;
        setCards((current) => joinById(current, page.videos));
        setTotal(page.total);
        setCursor(page.nextCursor);
      })
      .catch((cause: unknown) => {
        if (mine === sequence.current) setError(messageOf(cause));
      })
      .finally(() => setLoadingMore(false));
  }, [cursor, loadingMore, sort]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  const replace = useCallback((card: ClipVideoCard) => {
    setCards((current) => {
      const at = current.findIndex((item) => item.video.id === card.video.id);
      if (at === -1) return [card, ...current];
      const next = [...current];
      next[at] = card;
      return next;
    });
  }, []);

  // The list as last drawn, so `remove` can tell whether the card was there
  // without a side effect inside a state updater (StrictMode runs those twice).
  const shown = useRef(cards);
  shown.current = cards;

  const remove = useCallback((videoId: string) => {
    if (!shown.current.some((card) => card.video.id === videoId)) return;
    shown.current = shown.current.filter((card) => card.video.id !== videoId);
    setCards((current) => current.filter((card) => card.video.id !== videoId));
    setTotal((value) => Math.max(0, value - 1));
  }, []);

  const refreshOne = useCallback(
    async (videoId: string) => {
      try {
        const detail = await getVideo(videoId);
        replace({ video: detail.video, job: detail.job, clipCount: detail.clips.length });
      } catch (cause) {
        // Gone meanwhile (deleted in another tab, or a cancelled import): take it off the list.
        if (cause instanceof ApiError && cause.status === 404) remove(videoId);
      }
    },
    [remove, replace],
  );

  return {
    cards,
    total,
    sort,
    setSort,
    loading,
    loadingMore,
    error,
    hasMore: cursor !== null,
    loadMore,
    refresh,
    refreshOne,
    replace,
    remove,
  };
}
