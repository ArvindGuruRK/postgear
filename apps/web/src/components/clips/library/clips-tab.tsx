'use client';

/**
 * The Clips tab (Module 07, section 5): every clip of the workspace.
 *
 * - The state filter as a `Segmented` with counts: All, New, Drafts,
 *   Exported, Scheduled, Hidden (All leaves hidden clips out).
 * - **Platform** (a menu of checkboxes: YouTube, Twitch, Kick, Upload), with
 *   "Showing clips from Twitch" or "from 2 platforms" and Clear while set. The
 *   counts follow it.
 * - Newest or Oldest, and a List or Grid switch whose choice is remembered
 *   in this browser (a blocked storage never breaks the page).
 * - Both views share the filters, the counts, the menu and Show More.
 *
 * The UI never says "source": the module's Source filter is called Platform.
 */
import { ChevronDownIcon } from '@animateicons/react/lucide/chevron-down-icon';
import { LayoutGridIcon } from '@animateicons/react/lucide/layout-grid-icon';
import { ListIcon } from '@animateicons/react/lucide/list-icon';
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  MotionIcon,
  Segmented,
  Skeleton,
} from '@postgear/ui';
import { Clapperboard } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  ClipListItem,
  ClipListSort,
  ClipSource,
  ClipStatusFilter,
  ClipView,
} from '@/types/clips';
import { PLATFORM_LABELS } from '../home/home-model';
import { type ClipActions, clipActions } from './clip-actions';
import { ClipCard } from './clip-card';
import { ClipsTable } from './clips-table';
import { type ClipsView, readClipsView, writeClipsView } from './clips-view-memory';
import { useClipSender } from './use-clip-sender';
import type { ClipsListState } from './use-clips-list';

export const CLIPS_EMPTY = 'No clips yet. Open a video and mark a part to make one.';
export {
  type ClipsView,
  readClipsView,
  VIEW_STORAGE_KEY,
  writeClipsView,
} from './clips-view-memory';

export const STATUS_FILTERS: ReadonlyArray<{
  value: ClipStatusFilter;
  label: string;
  empty: string;
}> = [
  { value: 'all', label: 'All', empty: 'No clips here yet.' },
  { value: 'new', label: 'New', empty: 'No new clips. New ones appear here until you open them.' },
  { value: 'draft', label: 'Drafts', empty: 'No drafts. A clip you open becomes a draft.' },
  { value: 'exported', label: 'Exported', empty: 'Nothing exported yet.' },
  { value: 'scheduled', label: 'Scheduled', empty: 'No clips are scheduled.' },
  { value: 'hidden', label: 'Hidden', empty: 'No hidden clips.' },
];

export const PLATFORM_FILTERS: readonly ClipSource[] = ['youtube', 'twitch', 'kick', 'upload'];

/** "Showing clips from Twitch", "Showing clips from 2 platforms", or null when no filter is set. */
export function platformFilterSentence(sources: readonly ClipSource[]): string | null {
  if (sources.length === 0) return null;
  if (sources.length === 1) return `Showing clips from ${PLATFORM_LABELS[sources[0]]}`;
  return `Showing clips from ${sources.length} platforms`;
}

/** A changed clip as a list row: the row keeps what the clip answer does not carry. */
export function listChange(clip: ClipView): Partial<ClipListItem> {
  return {
    title: clip.title,
    status: clip.status,
    state: clip.state,
    revision: clip.revision,
    exported: clip.exported,
    exportedMediaId: clip.exportedMediaId,
    ratio: clip.ratio,
    durationMs: clip.durationMs,
    updatedAt: clip.updatedAt,
  };
}

/** The menu's calls wired to a list: change in place, add the copy, take off a deleted one. */
export function listClipActions(list: ClipsListState, send?: ClipActions['send']): ClipActions {
  return clipActions({
    onChanged: (clip) => list.patch(clip.id, listChange(clip)),
    onAdded: (clip, source) => {
      const row = list.clips.find((one) => one.id === source.id);
      if (row)
        list.prepend({ ...row, id: clip.id, ...listChange(clip), createdAt: clip.createdAt });
      else list.refresh();
    },
    onRemoved: (clipId) => list.drop(clipId),
    onStale: list.refresh,
    send,
  });
}

function CardsSkeleton() {
  return (
    <ul className="m-0 grid list-none grid-cols-4 gap-4 p-0 2xl:grid-cols-5" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholders
          key={index}
          className="flex flex-col overflow-hidden rounded-card border-2 border-outline"
        >
          <Skeleton className="h-56 rounded-none" />
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ClipsTab({
  orgId,
  list,
  onVideos,
}: {
  orgId: string;
  list: ClipsListState;
  onVideos: () => void;
}) {
  const [view, setView] = useState<ClipsView>('grid');
  // Read after the first paint: the server never knows the browser's choice.
  useEffect(() => setView(readClipsView()), []);

  const sender = useClipSender(orgId);
  const actions = listClipActions(list, sender.open);
  const sentence = platformFilterSentence(list.sources);
  const filter = STATUS_FILTERS.find((one) => one.value === list.status) ?? STATUS_FILTERS[0];
  const nothingAtAll =
    !list.loading &&
    !list.error &&
    list.sources.length === 0 &&
    Object.values(list.counts).every((count) => count === 0);

  if (nothingAtAll) {
    return (
      <EmptyState
        icon={Clapperboard}
        title={CLIPS_EMPTY}
        action={{ label: 'Go To Videos', onClick: onVideos, variant: 'primary' }}
      />
    );
  }

  const togglePlatform = (platform: ClipSource, on: boolean) =>
    list.setSources(
      on ? [...list.sources, platform] : list.sources.filter((one) => one !== platform),
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Clip State"
          value={list.status}
          onValueChange={(value) => list.setStatus(value as ClipStatusFilter)}
          options={STATUS_FILTERS.map((one) => ({
            value: one.value,
            label: `${one.label} ${list.counts[one.value].toLocaleString('en-GB')}`,
          }))}
        />
        <div className="flex flex-wrap items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm">
                Platform
                {list.sources.length > 0 ? ` (${list.sources.length})` : ''}
                <MotionIcon icon={ChevronDownIcon} className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {PLATFORM_FILTERS.map((platform) => (
                <DropdownMenuCheckboxItem
                  key={platform}
                  checked={list.sources.includes(platform)}
                  onCheckedChange={(checked) => togglePlatform(platform, checked === true)}
                  // Ticking several in a row keeps the menu open.
                  onSelect={(event) => event.preventDefault()}
                >
                  {PLATFORM_LABELS[platform]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
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
      </div>

      {sentence ? (
        <div className="flex items-center gap-3">
          <p className="m-0 font-sans text-sm text-ink type-muted" aria-live="polite">
            {sentence}
          </p>
          <Button variant="ghost" size="sm" onClick={() => list.setSources([])}>
            Clear
          </Button>
        </div>
      ) : null}

      {list.loading && list.clips.length === 0 ? (
        <CardsSkeleton />
      ) : list.error && list.clips.length === 0 ? (
        <ErrorState
          title={list.error}
          action={{ label: 'Try Again', onClick: list.refresh, variant: 'secondary' }}
        />
      ) : list.clips.length === 0 ? (
        <p className="m-0 rounded-md border-2 border-dashed border-outline bg-inset px-6 py-10 text-center font-sans text-sm text-ink">
          {filter.empty}
        </p>
      ) : view === 'grid' ? (
        <ul
          className="m-0 grid list-none grid-cols-4 gap-4 p-0 2xl:grid-cols-5"
          aria-busy={list.loading}
          aria-label="Clips"
        >
          {list.clips.map((clip) => (
            <ClipCard key={clip.id} clip={clip} orgId={orgId} actions={actions} />
          ))}
        </ul>
      ) : (
        <ClipsTable clips={list.clips} orgId={orgId} actions={actions} />
      )}

      {list.hasMore && list.clips.length > 0 ? (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={list.loadMore} disabled={list.loadingMore}>
            {list.loadingMore ? 'Loading' : 'Show More'}
          </Button>
        </div>
      ) : null}
      {sender.dialog}
    </div>
  );
}
