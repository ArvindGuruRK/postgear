'use client';

/**
 * Studio's lists: a page of designs (search, format filter, paging), the
 * workspace's brand kits and its favourite templates.
 *
 * Every fetch waits for the workspace scope (`useWorkspaceScope`): right after
 * a switch the API can still be answering for the previous workspace, and a
 * fetch on mount would show its designs for a moment. Responses are
 * sequenced like the media list's, so a slow early search never lands after
 * a fast later one and replaces its results.
 */
import type { FormatId } from '@postgear/design-engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspaceScope } from '@/components/navigation/workspace-provider';
import { ApiError, api } from '@/lib/api';
import type { BrandKitView, DesignPage, DesignSummary } from '@/types/studio';

/** How long typing pauses before a search is sent. */
const SEARCH_DELAY_MS = 250;

/**
 * One GET, refetched whenever `path` changes or `reload` is called. A
 * server-rendered `initial` is kept instead of fetched again on mount, unless
 * a workspace switch was in flight, when it may be the previous workspace's.
 */
function useScopedGet<T>(path: string, initial: T | null, fallback: string) {
  const { orgId, scope, status } = useWorkspaceScope();
  const [data, setData] = useState<T | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(initial === null);
  const [version, setVersion] = useState(0);
  const latest = useRef(0);
  const skip = useRef(initial !== null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the explicit reload trigger
  useEffect(() => {
    if (status === 'failed') {
      setError(fallback);
      setLoading(false);
      return;
    }
    if (status !== 'ready' || scope.status(orgId) !== 'ready') {
      skip.current = false;
      return;
    }
    if (skip.current) {
      skip.current = false;
      return;
    }

    const request = ++latest.current;
    setLoading(true);

    api<T>(path)
      .then((result) => {
        if (request === latest.current) {
          setData(result);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (request === latest.current) {
          setError(cause instanceof ApiError ? cause.message : fallback);
        }
      })
      .finally(() => {
        if (request === latest.current) setLoading(false);
      });
  }, [path, version, status, orgId, scope, fallback]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);

  return { data, setData, error, loading, reload };
}

export type FormatFilter = FormatId | 'all';

export function useDesigns(initial: DesignPage | null) {
  const [search, setSearchValue] = useState('');
  const [query, setQuery] = useState('');
  const [format, setFormatValue] = useState<FormatFilter>('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const params = new URLSearchParams({ page: String(page) });
  if (query) params.set('search', query);
  if (format !== 'all') params.set('format', format);

  const request = useScopedGet<DesignPage>(
    `/studio/designs?${params.toString()}`,
    initial,
    'Your designs could not be loaded.',
  );
  const { data, loading, setData } = request;

  // Deleting the last design on a later page leaves it empty: step back.
  useEffect(() => {
    if (!loading && data && data.designs.length === 0 && page > 1) {
      setPage((current) => Math.max(1, Math.min(current - 1, data.pageCount)));
    }
  }, [data, loading, page]);

  const setSearch = useCallback((value: string) => {
    setSearchValue(value);
    setPage(1);
  }, []);

  const setFormat = useCallback((value: FormatFilter) => {
    setFormatValue(value);
    setPage(1);
  }, []);

  /** Takes a deleted design off the page at once, ahead of the refetch. */
  const remove = useCallback(
    (id: string) =>
      setData((current) =>
        current
          ? {
              ...current,
              designs: current.designs.filter((design) => design.id !== id),
              total: Math.max(0, current.total - 1),
            }
          : current,
      ),
    [setData],
  );

  /** Shows a rename at once. */
  const patch = useCallback(
    (id: string, change: Partial<DesignSummary>) =>
      setData((current) =>
        current
          ? {
              ...current,
              designs: current.designs.map((design) =>
                design.id === id ? { ...design, ...change } : design,
              ),
            }
          : current,
      ),
    [setData],
  );

  const filtered = query !== '' || format !== 'all';

  return {
    ...request,
    search,
    setSearch,
    format,
    setFormat,
    page,
    setPage,
    remove,
    patch,
    filtered,
  };
}

export function useBrandKits(initial: BrandKitView[] | null) {
  const request = useScopedGet<{ brandKits: BrandKitView[] }>(
    '/studio/brand-kits',
    initial ? { brandKits: initial } : null,
    'Your brand kits could not be loaded.',
  );
  const { setData } = request;

  /** A saved kit, new or edited, first in the list like the API orders them. */
  const upsert = useCallback(
    (kit: BrandKitView) =>
      setData((current) => ({
        brandKits: [kit, ...(current?.brandKits ?? []).filter((entry) => entry.id !== kit.id)],
      })),
    [setData],
  );

  const remove = useCallback(
    (id: string) =>
      setData((current) =>
        current ? { brandKits: current.brandKits.filter((kit) => kit.id !== id) } : current,
      ),
    [setData],
  );

  return { ...request, kits: request.data?.brandKits ?? null, upsert, remove };
}

/**
 * The workspace's starred templates (DS-3.4). A star changes at once and goes
 * back if the API refuses it; the API answers with the whole list, which then
 * replaces the guess.
 */
export function useFavourites(initial: string[] | null) {
  const request = useScopedGet<{ presetIds: string[] }>(
    '/studio/favourites',
    initial ? { presetIds: initial } : null,
    'Your favourite templates could not be loaded.',
  );
  const { setData } = request;
  const [problem, setProblem] = useState<string | null>(null);

  const toggle = useCallback(
    async (presetId: string, starred: boolean) => {
      setProblem(null);
      setData((current) => {
        const ids = new Set(current?.presetIds ?? []);
        if (starred) ids.add(presetId);
        else ids.delete(presetId);
        return { presetIds: [...ids] };
      });

      try {
        const result = starred
          ? await api<{ presetIds: string[] }>('/studio/favourites', {
              method: 'POST',
              body: { presetId },
            })
          : await api<{ presetIds: string[] }>(
              `/studio/favourites/${encodeURIComponent(presetId)}`,
              { method: 'DELETE' },
            );
        setData(result);
      } catch (cause) {
        setData((current) => {
          const ids = new Set(current?.presetIds ?? []);
          if (starred) ids.delete(presetId);
          else ids.add(presetId);
          return { presetIds: [...ids] };
        });
        setProblem(
          cause instanceof ApiError ? cause.message : 'That favourite could not be saved.',
        );
      }
    },
    [setData],
  );

  const ids = useMemo(() => new Set(request.data?.presetIds ?? []), [request.data]);

  return { ...request, ids, toggle, problem };
}
