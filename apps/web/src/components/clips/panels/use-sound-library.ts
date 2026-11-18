'use client';

/**
 * The Audio tab's data (Module 14 section 8), shaped like the Elements
 * tab's (`use-sticker-library.ts`).
 *
 * - `useSoundSearch`: the rows for a tab, a search and a category, 24 at a
 *   time. Typing waits before it searches; a newer search cancels the one in
 *   flight. Stars change at once and go back if the API refuses.
 * - `useSoundCategories`: the chips for a kind, with their counts.
 * - `useSoundUploads`: the workspace's own sounds; one still checking is
 *   read again every few seconds until it settles.
 * - `useSoundPreview`: one plain `<audio>` for the whole panel, so starting
 *   a preview stops the one before.
 */
import {
  CLIP_ERROR_MESSAGES,
  type LibrarySoundView,
  SOUND_UPLOAD_MAX_BYTES,
  type SoundCategory,
  type SoundCategoryCount,
  type SoundUploadView,
} from '@postgear/video-engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  deleteSoundUpload,
  favouriteSound,
  listSoundUploads,
  searchSounds,
  soundCategories,
  unfavouriteSound,
  uploadSound,
} from '@/lib/clips-api';
import {
  type AudioTab,
  kindOfAudioTab,
  SOUND_PREVIEW_FAILED,
  SOUNDS_LOAD_FAILED,
  SOUNDS_PAGE,
} from './audio-model';
import { SEARCH_DEBOUNCE_MS } from './elements-model';
import { useDebounced } from './use-sticker-library';

function sentenceOf(cause: unknown): string {
  return cause instanceof ApiError && cause.status !== 0 ? cause.message : SOUNDS_LOAD_FAILED;
}

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

export interface SoundSearch {
  items: LibrarySoundView[];
  total: number;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  suggest: SoundCategoryCount[] | null;
  query: string;
  loadMore: () => void;
  setFavourite: (sound: LibrarySoundView, favourite: boolean) => void;
  retry: () => void;
}

export function useSoundSearch({
  tab,
  query,
  category,
}: {
  tab: AudioTab;
  query: string;
  category: SoundCategory | null;
}): SoundSearch {
  const settled = useDebounced(query, SEARCH_DEBOUNCE_MS);
  const [items, setItems] = useState<LibrarySoundView[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggest, setSuggest] = useState<SoundCategoryCount[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);

  const kind = kindOfAudioTab(tab);
  const favourites = tab === 'favourites';

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-runs the search on purpose.
  useEffect(() => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setError(null);
    searchSounds({
      q: settled,
      kind,
      category: category ?? undefined,
      favourites,
      pageSize: SOUNDS_PAGE,
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
  }, [settled, kind, category, favourites, attempt]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    const abort = controller.current;
    setLoadingMore(true);
    searchSounds({
      q: settled,
      kind,
      category: category ?? undefined,
      favourites,
      page: page + 1,
      pageSize: SOUNDS_PAGE,
      signal: abort?.signal,
    })
      .then((answer) => {
        if (abort?.signal.aborted) return;
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
    (sound: LibrarySoundView, favourite: boolean) => {
      const put = (value: boolean) =>
        setItems((current) =>
          favourites && !value
            ? current.filter((item) => item.id !== sound.id)
            : current.map((item) =>
                item.id === sound.id ? { ...item, isFavourite: value } : item,
              ),
        );
      put(favourite);
      if (favourites && !favourite) setTotal((count) => Math.max(0, count - 1));
      const call = favourite ? favouriteSound(sound.id) : unfavouriteSound(sound.id);
      call.catch((cause) => {
        setError(sentenceOf(cause));
        if (favourites && !favourite) {
          setItems((current) =>
            current.some((item) => item.id === sound.id) ? current : [sound, ...current],
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

/** The chips for one kind: the categories that have such sounds, in the taxonomy's order. */
export function useSoundCategories(tab: AudioTab): SoundCategoryCount[] {
  const [categories, setCategories] = useState<SoundCategoryCount[]>([]);
  const kind = kindOfAudioTab(tab);
  useEffect(() => {
    if (!kind) return;
    const abort = new AbortController();
    soundCategories(kind, { signal: abort.signal })
      .then((found) => {
        if (!abort.signal.aborted) setCategories(found);
      })
      .catch(() => {
        // The chips are a shortcut: without them the search still works.
        if (!abort.signal.aborted) setCategories([]);
      });
    return () => abort.abort();
  }, [kind]);
  return kind ? categories : [];
}

const CHECK_POLL_MS = 3_000;
const CHECK_POLLS_MAX = 40;

export interface SoundUploads {
  sounds: SoundUploadView[];
  loading: boolean;
  sending: Array<{ id: string; name: string }>;
  error: string | null;
  upload: (file: File) => Promise<SoundUploadView | null>;
  remove: (id: string) => Promise<boolean>;
}

export function useSoundUploads(enabled: boolean): SoundUploads {
  const [sounds, setSounds] = useState<SoundUploadView[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const polls = useRef(0);

  useEffect(() => {
    if (!enabled || loaded) return;
    const abort = new AbortController();
    setLoading(true);
    listSoundUploads({ signal: abort.signal })
      .then((found) => {
        if (abort.signal.aborted) return;
        setSounds(found);
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

  const checking = sounds.some((sound) => sound.status === 'checking');
  useEffect(() => {
    if (!enabled || !checking) {
      polls.current = 0;
      return;
    }
    const timer = window.setInterval(() => {
      if (polls.current >= CHECK_POLLS_MAX) return;
      polls.current += 1;
      listSoundUploads()
        .then(setSounds)
        .catch(() => undefined);
    }, CHECK_POLL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, checking]);

  const upload = useCallback(async (file: File): Promise<SoundUploadView | null> => {
    setError(null);
    if (file.size > SOUND_UPLOAD_MAX_BYTES) {
      setError(CLIP_ERROR_MESSAGES.sound_upload_too_big);
      return null;
    }
    const local = {
      id: `sending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: file.name,
    };
    setSending((current) => [local, ...current]);
    try {
      const sound = await uploadSound(file);
      setSounds((current) => [sound, ...current.filter((row) => row.id !== sound.id)]);
      return sound;
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
      await deleteSoundUpload(id);
      setSounds((current) => current.filter((row) => row.id !== id));
      return true;
    } catch (cause) {
      setError(sentenceOf(cause));
      return false;
    }
  }, []);

  return { sounds, loading, sending, error, upload, remove };
}

export interface SoundPreview {
  /** The row playing now, or null. */
  playingId: string | null;
  error: string | null;
  /** Plays a row's sound, stopping any other; pressing the playing one stops it. */
  toggle: (id: string, url: string | null) => void;
  stop: () => void;
}

/** One preview at a time: a single `<audio>` the whole panel shares. */
export function useSoundPreview(): SoundPreview {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    const el = audio.current;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    setPlayingId(null);
  }, []);

  const toggle = useCallback(
    (id: string, url: string | null) => {
      if (playingId === id) {
        stop();
        return;
      }
      if (!url) return;
      setError(null);
      if (!audio.current) {
        audio.current = new Audio();
        audio.current.preload = 'auto';
      }
      const el = audio.current;
      el.onended = () => setPlayingId(null);
      el.pause();
      el.src = url;
      setPlayingId(id);
      // `play()` answers a promise in every browser we support; older ones answered nothing.
      Promise.resolve(el.play()).catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setPlayingId((current) => (current === id ? null : current));
        setError(SOUND_PREVIEW_FAILED);
      });
    },
    [playingId, stop],
  );

  useEffect(
    () => () => {
      const el = audio.current;
      if (el) {
        el.onended = null;
        el.pause();
      }
      audio.current = null;
    },
    [],
  );

  return { playingId, error, toggle, stop };
}
