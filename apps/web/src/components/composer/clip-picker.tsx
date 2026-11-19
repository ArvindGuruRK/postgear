'use client';

/**
 * Select A Clip: the Clips tab of the composer's Insert Media (Module 17
 * section 5, CL-11.2). The workspace's exported clips, newest first or
 * oldest, in a grid or a list (the Clips tab's own switch and memory), 24 a
 * page, searched by name. A pick is the clip's exported file, attached
 * exactly as a Media pick, so the composer's rules and previews apply.
 */
import { LayoutGridIcon } from '@animateicons/react/lucide/layout-grid-icon';
import { ListIcon } from '@animateicons/react/lucide/list-icon';
import {
  Badge,
  cn,
  EmptyState,
  ErrorState,
  Pagination,
  SearchInput,
  Segmented,
  Skeleton,
} from '@postgear/ui';
import { Check, Clapperboard } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ClipPosterBox } from '@/components/clips/library/clip-card';
import {
  type ClipsView,
  readClipsView,
  writeClipsView,
} from '@/components/clips/library/clips-view-memory';
import { ApiError } from '@/lib/api';
import { listClips } from '@/lib/clips-api';
import type { ClipListItem, ClipListPage, ClipListSort } from '@/types/clips';
import {
  CLIP_PICKER_CHANGED,
  CLIP_PICKER_EMPTY,
  CLIP_PICKER_FILE_GONE,
  CLIP_PICKER_NO_MATCH,
  CLIP_PICKER_PICTURES_ONLY,
  type ClipPickBlock,
  changedSinceExport,
  clipFactsLine,
  clipPickBadge,
  clipPickBlock,
  exportedLine,
  pageCountOf,
} from './clip-picker-model';

const LOAD_FAILED = 'Your clips did not load. Check your connection and try again.';
const SEARCH_WAIT_MS = 250;

function useExportedClips() {
  const [sort, setSortState] = useState<ClipListSort>('newest');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ClipListPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = search.replace(/\s+/g, ' ').trim();
      setQ((current) => {
        if (current !== next) setPage(1);
        return next;
      });
    }, SEARCH_WAIT_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the explicit reload trigger
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    listClips({ withExport: true, sort, q: q || undefined, page, signal: abort.signal })
      .then((answer) => {
        if (!abort.signal.aborted) setData(answer);
      })
      .catch((cause: unknown) => {
        if (abort.signal.aborted) return;
        setError(cause instanceof ApiError && cause.status !== 0 ? cause.message : LOAD_FAILED);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [sort, q, page, attempt]);

  const setSort = (next: ClipListSort) => {
    setSortState(next);
    setPage(1);
  };

  return {
    sort,
    setSort,
    search,
    setSearch,
    q,
    page,
    setPage,
    data,
    loading,
    error,
    reload: () => setAttempt((count) => count + 1),
  };
}

export function ClipPickerPane({
  orgId,
  imagesOnly,
  attached,
  selected,
  onToggle,
}: {
  orgId: string;
  imagesOnly: boolean;
  /** Media ids already on the part. */
  attached: readonly string[];
  selected: readonly ClipListItem[];
  onToggle: (clip: ClipListItem) => void;
}) {
  const list = useExportedClips();
  const [view, setView] = useState<ClipsView>('grid');
  // Read after the first paint: the server never knows the browser's choice.
  useEffect(() => setView(readClipsView()), []);
  const clips = list.data?.clips ?? [];
  const pageCount = list.data ? pageCountOf(list.data.total, list.data.pageSize) : 1;

  return (
    <div className="flex flex-col gap-4" data-testid="clip-picker">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <SearchInput
            value={list.search}
            onChange={(event) => list.setSearch(event.target.value)}
            onClear={() => list.setSearch('')}
            placeholder="Enter your search"
            aria-label="Search clips"
          />
        </div>
        <Segmented
          label="Sort Clips"
          tight
          value={list.sort}
          onValueChange={(value) => list.setSort(value as ClipListSort)}
          options={[
            { value: 'newest', label: 'Newest' },
            { value: 'oldest', label: 'Oldest' },
          ]}
        />
        <Segmented
          label="View"
          tight
          value={view}
          onValueChange={(value) => {
            const next = value as ClipsView;
            setView(next);
            writeClipsView(next);
          }}
          options={[
            { value: 'grid', label: 'Grid', icon: LayoutGridIcon },
            { value: 'list', label: 'List', icon: ListIcon },
          ]}
        />
      </div>

      {imagesOnly ? (
        <p
          className="m-0 font-sans text-sm text-ink type-ui"
          data-testid="clip-picker-pictures-only"
        >
          {CLIP_PICKER_PICTURES_ONLY}
        </p>
      ) : null}

      {list.error ? (
        <ErrorState
          title="Clips didn't load"
          description={list.error}
          action={{ label: 'Try Again', onClick: list.reload }}
        />
      ) : list.loading && clips.length === 0 ? (
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
            <Skeleton key={index} className="aspect-[3/4]" />
          ))}
        </div>
      ) : clips.length === 0 ? (
        <div className="flex flex-col items-center gap-2" data-testid="clip-picker-empty">
          <EmptyState
            icon={Clapperboard}
            title={list.q ? 'Nothing matches that name' : 'No Exported Clips'}
            description={list.q ? CLIP_PICKER_NO_MATCH : CLIP_PICKER_EMPTY}
          />
          {list.q ? null : (
            <Link
              href={`/${encodeURIComponent(orgId)}/clips?tab=clips`}
              className="font-sans text-sm text-ink underline underline-offset-2 type-ui hover:text-actionPrimary"
            >
              Go To Clips
            </Link>
          )}
        </div>
      ) : (
        <ul
          className={cn(
            'm-0 list-none p-0',
            view === 'grid' ? 'grid grid-cols-4 gap-4' : 'flex flex-col gap-2',
          )}
          aria-busy={list.loading}
          aria-label="Exported clips"
        >
          {clips.map((clip) => (
            <li key={clip.id} className="min-w-0">
              <ClipChoice
                clip={clip}
                view={view}
                block={clipPickBlock(clip, { imagesOnly, attached })}
                selected={selected.some((one) => one.id === clip.id)}
                onToggle={onToggle}
              />
            </li>
          ))}
        </ul>
      )}

      {pageCount > 1 ? (
        <Pagination
          page={list.page}
          pageCount={pageCount}
          onPageChange={list.setPage}
          className="justify-center"
        />
      ) : null}
    </div>
  );
}

function ClipChoice({
  clip,
  view,
  block,
  selected,
  onToggle,
}: {
  clip: ClipListItem;
  view: ClipsView;
  block: ClipPickBlock;
  selected: boolean;
  onToggle: (clip: ClipListItem) => void;
}) {
  const badge = clipPickBadge(clip);
  const note =
    block === 'file_gone'
      ? CLIP_PICKER_FILE_GONE
      : block === 'attached'
        ? 'Already attached to this part.'
        : changedSinceExport(clip)
          ? CLIP_PICKER_CHANGED
          : null;
  const disabled = block !== null;
  const words = (
    <span className="flex min-w-0 flex-1 flex-col gap-1 text-start">
      {/* As the Clips tab's card: the name on up to two lines, then its facts and state. */}
      <span className="line-clamp-2 font-sans text-sm text-ink type-ui" title={clip.title}>
        {clip.title}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-sans text-xs text-ink tabular-nums type-muted">
          {clipFactsLine(clip)}
        </span>
        <Badge variant={badge === 'Scheduled' ? 'accent' : 'success'}>{badge}</Badge>
      </span>
      {clip.exportedAt ? (
        <span className="font-sans text-xs text-ink type-muted">
          {exportedLine(clip.exportedAt)}
        </span>
      ) : null}
      {note ? (
        <span className="font-sans text-xs text-ink type-ui" data-testid="clip-picker-note">
          {note}
        </span>
      ) : null}
    </span>
  );

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${selected ? 'Deselect' : 'Select'} ${clip.title}`}
      disabled={disabled}
      onClick={() => onToggle(clip)}
      data-testid="clip-picker-choice"
      className={cn(
        'relative w-full overflow-hidden rounded-lg border-2 border-outline bg-secondary outline-none transition-[transform,box-shadow] duration-100',
        'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
        view === 'grid' ? 'flex flex-col' : 'flex items-center gap-3 p-2',
        selected
          ? 'shadow-brutalPressed outline outline-[3px] outline-offset-2 outline-actionPrimary'
          : 'shadow-surfaceMd',
        disabled ? 'cursor-not-allowed opacity-60' : null,
      )}
    >
      {view === 'grid' ? (
        <>
          <span className="block aspect-square bg-inset p-2">
            {/* A size container: the poster box fits its shape inside it. */}
            <span
              className="flex h-full w-full items-center justify-center"
              style={{ containerType: 'size' }}
            >
              <ClipPosterBox clip={clip} previewing={false} />
            </span>
          </span>
          <span className="flex p-3">{words}</span>
        </>
      ) : (
        <>
          <span
            className="flex h-16 w-16 shrink-0 items-center justify-center bg-inset"
            style={{ containerType: 'size' }}
          >
            <ClipPosterBox clip={clip} previewing={false} />
          </span>
          {words}
        </>
      )}
      {selected ? (
        <span className="absolute end-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-outline bg-actionPrimary text-onActionPrimary">
          <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
        </span>
      ) : null}
    </button>
  );
}
