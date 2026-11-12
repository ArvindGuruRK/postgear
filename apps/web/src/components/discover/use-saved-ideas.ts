'use client';

/**
 * The workspace's Saved ideas (Module 10, backlog #3): what the bookmark on a
 * card writes, and what the Saved tab lists.
 *
 * Loaded once when the page opens, so every card knows straight away whether
 * it is saved. A press is optimistic: the bookmark fills at once and a failed
 * save takes it back with a toast saying why, so the button never lies for
 * longer than one request. A card already on its way (saving or removing) is
 * busy, so a double press is one request.
 *
 * Saved ideas are the workspace's, not one person's: everyone sees the same
 * list, with who saved each one.
 */
import { toast } from '@postgear/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { getSavedIdeas, removeIdea, saveIdea, updateIdeaNote } from '@/lib/discover-api';
import type { DiscoverItem, SavedIdea } from '@/types/discover';
import type { SaveControl } from './discover-cards';

export const IDEAS_LOAD_FAILED = 'Your saved ideas could not be loaded. Try again in a moment.';
export const IDEA_SAVE_FAILED = 'That card could not be saved. Try again in a moment.';
export const IDEA_REMOVE_FAILED = 'That idea could not be removed. Try again in a moment.';
export const IDEA_NOTE_FAILED = 'Your note could not be saved. Try again in a moment.';

/** The API's own sentence when it gave one (the 200 limit), a plain one when it did not answer. */
function sentenceOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError && cause.status !== 0 && cause.status < 500
    ? cause.message
    : fallback;
}

/**
 * Only the fields Discover itself writes on an item. The API holds a saved
 * card to exactly that shape, so anything a newer feed adds is left behind
 * here instead of turning the save into a refusal.
 */
export function ideaItem(item: DiscoverItem): DiscoverItem {
  const kept: DiscoverItem = {
    id: item.id,
    kind: item.kind,
    source: {
      id: item.source.id,
      name: item.source.name,
      ...(item.source.url ? { url: item.source.url } : {}),
    },
    title: item.title,
    brief: item.brief,
  };
  if (item.summary) kept.summary = item.summary;
  if (item.url) kept.url = item.url;
  if (item.opaqueUrl) kept.opaqueUrl = item.opaqueUrl;
  if (item.image) kept.image = item.image;
  if (item.publishedAt) kept.publishedAt = item.publishedAt;
  if (item.language) kept.language = item.language;
  if (item.date) kept.date = item.date;
  if (typeof item.observance === 'boolean') kept.observance = item.observance;
  if (item.signal) {
    const { label, rank, traffic, views, posts } = item.signal;
    kept.signal = {
      label,
      ...(typeof rank === 'number' ? { rank } : {}),
      ...(typeof traffic === 'number' ? { traffic } : {}),
      ...(typeof views === 'number' ? { views } : {}),
      ...(typeof posts === 'number' ? { posts } : {}),
    };
  }
  if (item.related?.length) {
    kept.related = item.related
      .slice(0, 5)
      .map(({ title, url, source }) => ({ title, url, source }));
  }
  return kept;
}

export interface SavedIdeasHandle {
  ideas: SavedIdea[];
  limit: number;
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** The bookmark for one card, read in this place and language. */
  controlFor: (
    item: DiscoverItem,
    where: { place: SavedIdea['place']; language: string } | null,
  ) => SaveControl | undefined;
  remove: (idea: SavedIdea) => Promise<boolean>;
  updateNote: (idea: SavedIdea, note: string | null) => Promise<boolean>;
}

const DEFAULT_LIMIT = 200;

export function useSavedIdeas(enabled: boolean): SavedIdeasHandle {
  const [ideas, setIdeas] = useState<SavedIdea[]>([]);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  // Cards on their way, by item id, so a double press is one request.
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const busyRef = useRef(busy);
  busyRef.current = busy;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the reload trigger
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    getSavedIdeas(controller.signal)
      .then((answer) => {
        // An answer of the wrong shape (an older API, a proxy page) reads as nothing saved.
        setIdeas(Array.isArray(answer?.ideas) ? answer.ideas : []);
        setLimit(typeof answer?.limit === 'number' ? answer.limit : DEFAULT_LIMIT);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(sentenceOf(cause, IDEAS_LOAD_FAILED));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [enabled, version]);

  const reload = useCallback(() => setVersion((count) => count + 1), []);

  const mark = useCallback((itemId: string, on: boolean) => {
    setBusy((current) => {
      const next = new Set(current);
      if (on) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }, []);

  // Which cards are saved, by item id.
  const savedByItem = useMemo(() => {
    const map = new Map<string, SavedIdea>();
    for (const idea of ideas) map.set(idea.item.id, idea);
    return map;
  }, [ideas]);

  const remove = useCallback(
    async (idea: SavedIdea): Promise<boolean> => {
      if (busyRef.current.has(idea.item.id)) return false;
      mark(idea.item.id, true);
      const before = ideas;
      setIdeas((current) => current.filter((each) => each.id !== idea.id));
      try {
        await removeIdea(idea.id);
        return true;
      } catch (cause) {
        // A 404 means someone else removed it first: the list is already right.
        if (cause instanceof ApiError && cause.status === 404) return true;
        setIdeas(before);
        toast({
          variant: 'danger',
          title: 'Not removed',
          description: sentenceOf(cause, IDEA_REMOVE_FAILED),
        });
        return false;
      } finally {
        mark(idea.item.id, false);
      }
    },
    [ideas, mark],
  );

  const save = useCallback(
    async (item: DiscoverItem, where: { place: SavedIdea['place']; language: string }) => {
      if (busyRef.current.has(item.id)) return;
      mark(item.id, true);
      // A stand-in so the bookmark fills at once; the API's copy replaces it.
      const now = new Date().toISOString();
      const pending: SavedIdea = {
        id: `pending:${item.id}`,
        item,
        place: where.place,
        language: where.language,
        note: null,
        savedBy: null,
        createdAt: now,
        updatedAt: now,
      };
      setIdeas((current) => [pending, ...current]);
      try {
        const idea = await saveIdea({ item: ideaItem(item), ...where });
        setIdeas((current) => [
          idea,
          ...current.filter((each) => each.id !== pending.id && each.id !== idea.id),
        ]);
      } catch (cause) {
        setIdeas((current) => current.filter((each) => each.id !== pending.id));
        toast({
          variant: 'danger',
          title: 'Not saved',
          description: sentenceOf(cause, IDEA_SAVE_FAILED),
        });
      } finally {
        mark(item.id, false);
      }
    },
    [mark],
  );

  const controlFor = useCallback(
    (
      item: DiscoverItem,
      where: { place: SavedIdea['place']; language: string } | null,
    ): SaveControl | undefined => {
      // Until the list is known, a bookmark could say the wrong thing.
      if (!enabled || loading || error) return undefined;
      const idea = savedByItem.get(item.id);
      if (!idea && !where) return undefined;
      return {
        saved: Boolean(idea),
        busy: busy.has(item.id) || idea?.id.startsWith('pending:'),
        onToggle: () => {
          if (idea) void remove(idea);
          else if (where) void save(item, where);
        },
      };
    },
    [enabled, loading, error, savedByItem, busy, remove, save],
  );

  const updateNote = useCallback(async (idea: SavedIdea, note: string | null): Promise<boolean> => {
    try {
      const updated = await updateIdeaNote(idea.id, note);
      setIdeas((current) => current.map((each) => (each.id === updated.id ? updated : each)));
      return true;
    } catch (cause) {
      toast({
        variant: 'danger',
        title: 'Note not saved',
        description: sentenceOf(cause, IDEA_NOTE_FAILED),
      });
      return false;
    }
  }, []);

  return { ideas, limit, loading, error, reload, controlFor, remove, updateNote };
}
