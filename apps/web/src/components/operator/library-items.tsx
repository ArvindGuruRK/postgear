'use client';

/**
 * Library, Sounds and Stickers (module 19 section 9): items in every status,
 * filtered by status, kind, category and source, and searched with the same
 * Postgres search as the product (name, tags, category). A row shows a play
 * button or the picture, the name, the licence, the author (a link to the
 * item's page), the status and the run; opening it shows the takedown view.
 */
import { PauseIcon } from '@animateicons/react/lucide/pause-icon';
import { PlayIcon } from '@animateicons/react/lucide/play-icon';
import { XIcon } from '@animateicons/react/lucide/x-icon';
import {
  Badge,
  Button,
  FormField,
  FormLabel,
  MotionIcon,
  Pagination,
  SearchInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TooltipHint,
} from '@postgear/ui';
import {
  LIBRARY_SOUND_ORIGINS,
  LIBRARY_STICKER_ORIGINS,
  SOUND_CATEGORIES,
  SOUND_CATEGORY_NAMES,
  STICKER_CATEGORIES,
  STICKER_CATEGORY_NAMES,
} from '@postgear/video-engine';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type {
  LibraryItem,
  LibraryItemsPage,
  LibraryItemType,
  LibraryStatus,
} from '@/types/operator';
import { LibraryItemDialog } from './library-item-dialog';
import { errorSentence, LoadFailed } from './operator-fields';
import {
  categoryName,
  durationLabel,
  LIBRARY_KIND_NAMES,
  LIBRARY_STATUS_NAMES,
} from './operator-model';

const ALL = 'all';
const SEARCH_DELAY_MS = 300;

export interface ItemFilters {
  status: LibraryStatus | typeof ALL;
  kind: string;
  category: string;
  origin: string;
  q: string;
  runId: string | null;
}

export function emptyItemFilters(runId: string | null = null): ItemFilters {
  return { status: runId ? 'STAGED' : ALL, kind: ALL, category: ALL, origin: ALL, q: '', runId };
}

/** The query string of `GET /operator/library/items`. */
export function itemsQuery(type: LibraryItemType, filters: ItemFilters, page: number): string {
  const params = new URLSearchParams({ type });
  if (filters.status !== ALL) params.set('status', filters.status);
  if (filters.kind !== ALL) params.set('kind', filters.kind);
  if (filters.category !== ALL) params.set('category', filters.category);
  if (filters.origin !== ALL) params.set('origin', filters.origin);
  if (filters.q.trim()) params.set('q', filters.q.trim().slice(0, 100));
  if (filters.runId) params.set('runId', filters.runId);
  if (page > 1) params.set('page', String(page));
  return params.toString();
}

const STATUS_BADGE: Record<LibraryStatus, 'success' | 'accent' | 'outline' | 'danger'> = {
  ACTIVE: 'success',
  STAGED: 'accent',
  HIDDEN: 'outline',
  REMOVED: 'danger',
};

export function LibraryItems({
  type,
  filters,
  onFilters,
}: {
  type: LibraryItemType;
  filters: ItemFilters;
  onFilters: (filters: ItemFilters) => void;
}) {
  const id = useId();
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState(filters.q);
  const [result, setResult] = useState<LibraryItemsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState<LibraryItem | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  // The search box waits a moment before it becomes a filter.
  useEffect(() => {
    if (query === filters.q) return;
    const timer = window.setTimeout(() => {
      setPage(1);
      onFilters({ ...filters, q: query });
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [query, filters, onFilters]);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    try {
      setResult(
        await api<LibraryItemsPage>(`/operator/library/items?${itemsQuery(type, filters, page)}`),
      );
    } catch (caught) {
      setFailed(errorSentence(caught));
    } finally {
      setLoading(false);
    }
  }, [type, filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => () => {
      audio.current?.pause();
    },
    [],
  );

  function togglePlay(item: LibraryItem) {
    if (!item.audioUrl) return;
    if (playing === item.id) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    audio.current?.pause();
    const next = new Audio(item.audioUrl);
    next.addEventListener('ended', () => setPlaying(null));
    audio.current = next;
    setPlaying(item.id);
    void next.play().catch(() => setPlaying(null));
  }

  const categories =
    type === 'sound'
      ? SOUND_CATEGORIES.map((slug) => ({ slug, name: SOUND_CATEGORY_NAMES[slug] }))
      : STICKER_CATEGORIES.map((slug) => ({ slug, name: STICKER_CATEGORY_NAMES[slug] }));
  const kinds = type === 'sound' ? (['sfx', 'music'] as const) : (['static', 'animated'] as const);
  const origins = type === 'sound' ? LIBRARY_SOUND_ORIGINS : LIBRARY_STICKER_ORIGINS;
  // Another filter is another first page.
  const set = (patch: Partial<ItemFilters>) => {
    setPage(1);
    onFilters({ ...filters, ...patch });
  };
  const pageCount = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] items-end gap-3">
        <SearchInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          placeholder="Enter your search words"
          aria-label={type === 'sound' ? 'Search sounds' : 'Search stickers'}
        />
        <FilterSelect
          id={`${id}-status`}
          label="Status"
          value={filters.status}
          onChange={(status) => set({ status: status as ItemFilters['status'] })}
          options={[
            { value: ALL, name: 'All Statuses' },
            ...(['STAGED', 'ACTIVE', 'HIDDEN', 'REMOVED'] as const).map((status) => ({
              value: status,
              name: LIBRARY_STATUS_NAMES[status],
            })),
          ]}
        />
        <FilterSelect
          id={`${id}-kind`}
          label="Kind"
          value={filters.kind}
          onChange={(kind) => set({ kind })}
          options={[
            { value: ALL, name: 'All Kinds' },
            ...kinds.map((kind) => ({ value: kind, name: LIBRARY_KIND_NAMES[kind] })),
          ]}
        />
        <FilterSelect
          id={`${id}-category`}
          label="Category"
          value={filters.category}
          onChange={(category) => set({ category })}
          options={[
            { value: ALL, name: 'All Categories' },
            ...categories.map((entry) => ({ value: entry.slug, name: entry.name })),
          ]}
        />
        <FilterSelect
          id={`${id}-origin`}
          label="Source"
          value={filters.origin}
          onChange={(origin) => set({ origin })}
          options={[
            { value: ALL, name: 'All Sources' },
            ...origins.map((origin) => ({ value: origin, name: origin })),
          ]}
        />
      </div>
      {filters.runId ? (
        <div className="flex items-center gap-2">
          <Badge variant="accent">Run {filters.runId.slice(0, 8)}</Badge>
          <TooltipHint label="Show Every Run" side="right">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 px-0"
              aria-label="Show Every Run"
              onClick={() => set({ runId: null })}
            >
              <MotionIcon icon={XIcon} className="h-4 w-4" />
            </Button>
          </TooltipHint>
        </div>
      ) : null}

      {failed ? <LoadFailed message={failed} onRetry={() => void load()} /> : null}
      {!result && loading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : null}
      {result ? (
        <div className={loading ? 'flex flex-col gap-3 opacity-60' : 'flex flex-col gap-3'}>
          <Table data-testid="library-items">
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">
                  <span className="sr-only">{type === 'sound' ? 'Play' : 'Picture'}</span>
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Licence</TableHead>
                <TableHead>Author</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Run</TableHead>
                <TableHead className="w-24">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    {type === 'sound'
                      ? 'No sound matches these filters.'
                      : 'No sticker matches these filters.'}
                  </TableCell>
                </TableRow>
              ) : (
                result.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="py-2">
                      {type === 'sound' ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="h-9 w-9 px-0"
                          aria-label={
                            playing === item.id ? `Pause ${item.name}` : `Play ${item.name}`
                          }
                          disabled={!item.audioUrl}
                          onClick={() => togglePlay(item)}
                        >
                          <MotionIcon
                            icon={playing === item.id ? PauseIcon : PlayIcon}
                            className="h-4 w-4"
                          />
                        </Button>
                      ) : item.previewUrl ? (
                        // biome-ignore lint/performance/noImgElement: a library preview from the media bucket, any host.
                        <img
                          src={item.previewUrl}
                          alt=""
                          className="h-10 w-10 rounded-sm border-2 border-outline bg-inset object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <span className="block h-10 w-10 rounded-sm border-2 border-dashed border-outline" />
                      )}
                    </TableCell>
                    <TableCell className="py-2">
                      <span className="flex flex-col">
                        <span className="font-semibold">{item.name}</span>
                        <span className="font-sans text-xs type-muted">
                          {LIBRARY_KIND_NAMES[item.kind]}, {categoryName(type, item.category)}
                          {item.durationMs !== null && type === 'sound'
                            ? `, ${durationLabel(item.durationMs)}`
                            : ''}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="py-2 font-mono text-xs">{item.licence}</TableCell>
                    <TableCell className="py-2">
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2"
                      >
                        {item.author}
                      </a>
                    </TableCell>
                    <TableCell className="py-2">
                      <Badge variant={STATUS_BADGE[item.status]}>
                        {LIBRARY_STATUS_NAMES[item.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2 font-mono text-xs">
                      {item.runId.slice(0, 8)}
                    </TableCell>
                    <TableCell className="py-2 text-right">
                      <Button variant="secondary" size="sm" onClick={() => setOpen(item)}>
                        Open
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between gap-3">
            <span className="font-sans text-xs text-ink type-muted">
              {result.total === 1 ? '1 item' : `${result.total.toLocaleString('en-GB')} items`}
            </span>
            {pageCount > 1 ? (
              <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
            ) : null}
          </div>
        </div>
      ) : null}
      {open ? (
        <LibraryItemDialog
          type={type}
          itemId={open.id}
          onClose={() => setOpen(null)}
          onChanged={() => void load()}
        />
      ) : null}
    </div>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; name: string }>;
}) {
  return (
    <FormField>
      <FormLabel htmlFor={id}>{label}</FormLabel>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}
