'use client';

/**
 * The Elements tab's data (Module 12 section 9).
 *
 * - `useStickerSearch`: the tiles for a tab, a search and a category, 24 at
 *   a time. Typing waits `SEARCH_DEBOUNCE_MS` before it searches; a newer
 *   search cancels the one in flight, so tiles never arrive out of order.
 *   Stars change at once and go back if the API refuses.
 * - `useStickerCategories`: the chips for a kind, with their counts.
 * - `useStickerUploads`: the workspace's own stickers. An upload shows as
 *   Checking at once and waits for the check; a sticker still checking when
 *   the answer comes is read again every few seconds until it settles.
 */
import {
  CLIP_ERROR_MESSAGES,
  type LibraryCategoryCount,
  type LibraryStickerView,
  STICKER_UPLOAD_MAX_BYTES,
  type StickerCategory,
  type StickerUploadView,
} from '@postgear/video-engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  deleteStickerUpload,
  favouriteSticker,
  listStickerUploads,
  searchStickers,
  stickerCategories,
  unfavouriteSticker,
  uploadSticker,
} from '@/lib/clips-api';
import {
  type ElementsTab,
  kindOfTab,
  LOAD_FAILED,
  SEARCH_DEBOUNCE_MS,
  STICKERS_PAGE,
} from './elements-model';

/** The API's sentence, or ours when the request never reached it. */
function sentenceOf(cause: unknown): string {
  return cause instanceof ApiError && cause.status !== 0 ? cause.message : LOAD_FAILED;
}

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

/** `value`, once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export interface StickerSearch {
  items: LibraryStickerView[];
  total: number;
  hasMore: boolean;
  /** The first page is on its way. */
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  /** The nearest categories when nothing matched. */
  suggest: LibraryCategoryCount[] | null;
  /** The search the tiles answer (after the wait). */
  query: string;
  loadMore: () => void;
  setFavourite: (sticker: LibraryStickerView, favourite: boolean) => void;
  retry: () => void;
}

export function useStickerSearch({
  tab,
  query,
  category,
  enabled,
}: {
  tab: ElementsTab;
  query: string;
  category: StickerCategory | null;
  enabled: boolean;
}): StickerSearch {
  const settled = useDebounced(query, SEARCH_DEBOUNCE_MS);
  const [items, setItems] = useState<LibraryStickerView[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggest, setSuggest] = useState<LibraryCategoryCount[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);

  const kind = kindOfTab(tab);
  const favourites = tab === 'favourites';

  // `attempt` is Try Again: a new number searches again with the same words.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-runs the search on purpose.
  useEffect(() => {
    if (!enabled) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setError(null);
    searchStickers({
      q: settled,
      kind,
      category: category ?? undefined,
      favourites,
      pageSize: STICKERS_PAGE,
      signal: abort.signal,
    })
      .then((answer) => {
        if (abort.signal.aborted) return;
        setItems(answer.items);
        setTotal(answer.total);
        setPage(answer.page);
        setHasMore(answer.hasMore);
        setSuggest(answer.suggest && answer.suggest.length > 0 ? answer.suggest : null);
      })
      .catch((cause) => {
        if (abort.signal.aborted || isAbort(cause)) return;
        setItems([]);
        setTotal(0);
        setHasMore(false);
        setSuggest(null);
        setError(sentenceOf(cause));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [enabled, settled, kind, category, favourites, attempt]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    const abort = controller.current;
    setLoadingMore(true);
    searchStickers({
      q: settled,
      kind,
      category: category ?? undefined,
      favourites,
      page: page + 1,
      pageSize: STICKERS_PAGE,
      signal: abort?.signal,
    })
      .then((answer) => {
        if (abort?.signal.aborted) return;
        // A sticker starred meanwhile may already be on the list.
        setItems((current) => {
          const seen = new Set(current.map((item) => item.id));
          return [...current, ...answer.items.filter((item) => !seen.has(item.id))];
        });
        setPage(answer.page);
        setHasMore(answer.hasMore);
        setTotal(answer.total);
      })
      .catch((cause) => {
        if (abort?.signal.aborted || isAbort(cause)) return;
        setError(sentenceOf(cause));
      })
      .finally(() => setLoadingMore(false));
  }, [loading, loadingMore, hasMore, settled, kind, category, favourites, page]);

  const setFavourite = useCallback(
    (sticker: LibraryStickerView, favourite: boolean) => {
      const put = (value: boolean) =>
        setItems((current) =>
          favourites && !value
            ? current.filter((item) => item.id !== sticker.id)
            : current.map((item) =>
                item.id === sticker.id ? { ...item, isFavourite: value } : item,
              ),
        );
      put(favourite);
      if (favourites && !favourite) setTotal((count) => Math.max(0, count - 1));
      const call = favourite ? favouriteSticker(sticker.id) : unfavouriteSticker(sticker.id);
      call.catch((cause) => {
        setError(sentenceOf(cause));
        // Back as it was: on Favourites an un-star that failed puts the tile back.
        if (favourites && !favourite) {
          setItems((current) =>
            current.some((item) => item.id === sticker.id) ? current : [sticker, ...current],
          );
          setTotal((count) => count + 1);
        } else {
          put(!favourite);
        }
      });
    },
    [favourites],
  );

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    items,
    total,
    hasMore,
    loading,
    loadingMore,
    error,
    suggest,
    query: settled,
    loadMore,
    setFavourite,
    retry,
  };
}

/** The chips for one kind: our categories that have such stickers, in the taxonomy's order. */
export function useStickerCategories(tab: ElementsTab, enabled: boolean): LibraryCategoryCount[] {
  const [categories, setCategories] = useState<LibraryCategoryCount[]>([]);
  const kind = kindOfTab(tab);
  const listed = tab === 'stickers' || tab === 'gifs';
  useEffect(() => {
    if (!enabled || !listed) return;
    const abort = new AbortController();
    stickerCategories(kind, { signal: abort.signal })
      .then((found) => {
        if (!abort.signal.aborted) setCategories(found);
      })
      .catch(() => {
        // The chips are a shortcut: without them the search still works.
        if (!abort.signal.aborted) setCategories([]);
      });
    return () => abort.abort();
  }, [enabled, listed, kind]);
  return listed ? categories : [];
}

/** How often a sticker still checking is read again. */
const CHECK_POLL_MS = 3_000;
/** How many times, before the list stops asking (the next visit asks again). */
const CHECK_POLLS_MAX = 40;

export interface StickerUploads {
  stickers: StickerUploadView[];
  loading: boolean;
  /** Files being sent, by a local id, shown as Checking until the answer. */
  sending: Array<{ id: string; name: string }>;
  error: string | null;
  upload: (file: File) => Promise<StickerUploadView | null>;
  remove: (id: string) => Promise<boolean>;
  clearError: () => void;
}

export function useStickerUploads(enabled: boolean): StickerUploads {
  const [stickers, setStickers] = useState<StickerUploadView[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const polls = useRef(0);

  useEffect(() => {
    if (!enabled || loaded) return;
    const abort = new AbortController();
    setLoading(true);
    listStickerUploads({ signal: abort.signal })
      .then((found) => {
        if (abort.signal.aborted) return;
        setStickers(found);
        setLoaded(true);
      })
      .catch((cause) => {
        if (!abort.signal.aborted && !isAbort(cause)) setError(sentenceOf(cause));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [enabled, loaded]);

  // While one is checking, read the list again now and then.
  const checking = stickers.some((sticker) => sticker.status === 'checking');
  useEffect(() => {
    if (!enabled || !checking) {
      polls.current = 0;
      return;
    }
    const timer = window.setInterval(() => {
      if (polls.current >= CHECK_POLLS_MAX) return;
      polls.current += 1;
      listStickerUploads()
        .then(setStickers)
        .catch(() => undefined);
    }, CHECK_POLL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, checking]);

  const upload = useCallback(async (file: File): Promise<StickerUploadView | null> => {
    setError(null);
    // Refused here too, so a big file is not sent only to be turned away.
    if (file.size > STICKER_UPLOAD_MAX_BYTES) {
      setError(CLIP_ERROR_MESSAGES.sticker_upload_too_big);
      return null;
    }
    const local = {
      id: `sending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: file.name,
    };
    setSending((current) => [local, ...current]);
    try {
      const sticker = await uploadSticker(file);
      setStickers((current) => [sticker, ...current.filter((row) => row.id !== sticker.id)]);
      return sticker;
    } catch (cause) {
      setError(sentenceOf(cause));
      return null;
    } finally {
      setSending((current) => current.filter((row) => row.id !== local.id));
    }
  }, []);

  const remove = useCallback(async (id: string): Promise<boolean> => {
    setError(null);
    try {
      await deleteStickerUpload(id);
      setStickers((current) => current.filter((row) => row.id !== id));
      return true;
    } catch (cause) {
      setError(sentenceOf(cause));
      return false;
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { stickers, loading, sending, error, upload, remove, clearError };
}
