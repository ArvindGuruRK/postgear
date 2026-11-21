'use client';

/**
 * The Elements tab (Module 12 section 9): stickers, GIFs, the workspace's
 * favourites and its own stickers, and the selected sticker's controls.
 *
 * - **Stickers** (still pictures) and **GIFs** (moving ones): a search that
 *   runs as you type, category chips with counts, tiles 24 at a time. The
 *   Follow Badge tile sits with Social (and on the Stickers tab before any
 *   search). A tile adds its sticker at the playhead and selects it.
 * - **Favourites**: both kinds, newest star first, with its own search.
 * - **Uploaded**: `uploaded-stickers.tsx`.
 * - **The selected sticker**: its picture and name (a warning when it left
 *   the library), Loop for a moving one, Flip, Opacity, When It Shows, and
 *   Remove Sticker; a badge edits its platform and name instead of Flip.
 *
 * Like the Text tab, the panel never edits the document itself: each change
 * goes to the editor (`onEdit`) as one undo step; a slider passes a
 * coalesce key so its whole drag is one step.
 */
import { ClapperboardIcon } from '@animateicons/react/lucide/clapperboard-icon';
import { ImageIcon } from '@animateicons/react/lucide/image-icon';
import { StarIcon } from '@animateicons/react/lucide/star-icon';
import { UploadIcon } from '@animateicons/react/lucide/upload-icon';
import {
  Alert,
  type AnimatedIcon,
  Button,
  ChoiceTiles,
  EmptyState,
  SearchInput,
  Spinner,
  Toggle,
} from '@postgear/ui';
import type {
  BadgePlatform,
  LibraryStickerView,
  StickerCategory,
  StickerItem,
  StickerUploadView,
} from '@postgear/video-engine';
import { Star, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { GroupLabel, NOTE, PanelSection, PercentSlider } from '@/components/studio/panel-ui';
import { BadgeFields, BadgeFormDialog, measureBadgeWidth } from './badge-form';
import {
  badgeNameOf,
  ELEMENTS_TABS,
  type ElementsTab,
  FAVOURITES_EMPTY,
  noMatchSentence,
  REMOVED_STICKER,
  SEARCH_PLACEHOLDER,
  type StickerFileInfo,
  stickerTitle,
  UPLOAD_GONE,
} from './elements-model';
import { BadgeTile, CategoryChips, CHECKER, StickerTile, TilePicture } from './sticker-tiles';
import { UploadedStickers } from './uploaded-stickers';
import { useStickerCategories, useStickerSearch, useStickerUploads } from './use-sticker-library';
import { WhenItShows } from './when-it-shows';

/**
 * A change to a sticker (the selected one unless `itemId` names it), and the
 * key that makes a drag one undo step.
 */
export type StickerEdit = (
  change: (item: StickerItem) => StickerItem,
  coalesceKey?: string,
  itemId?: string,
) => void;

export interface ElementsPanelProps {
  /** The selected sticker, or null. */
  selected: StickerItem | null;
  /** What the editor knows of its file (null for a badge, or while it is being looked up). */
  selectedFile: StickerFileInfo | null;
  totalMs: number;
  fps: number;
  onAddLibrary: (sticker: LibraryStickerView) => void;
  onAddUpload: (sticker: StickerUploadView) => void;
  onAddBadge: (platform: BadgePlatform, name: string, widthPx: number) => void;
  onEdit: StickerEdit;
  onTiming: (startMs: number, durationMs: number) => void;
  onAnchor: (choice: 'moment' | 'whole') => void;
  onRemove: () => void;
}

const ELEMENTS_TAB_ICONS: Readonly<Record<ElementsTab, AnimatedIcon>> = {
  stickers: ImageIcon,
  gifs: ClapperboardIcon,
  favourites: StarIcon,
  uploaded: UploadIcon,
};

export function ElementsPanel({
  selected,
  selectedFile,
  totalMs,
  fps,
  onAddLibrary,
  onAddUpload,
  onAddBadge,
  onEdit,
  onTiming,
  onAnchor,
  onRemove,
}: ElementsPanelProps) {
  const [tab, setTab] = useState<ElementsTab>('stickers');
  const [badgeOpen, setBadgeOpen] = useState(false);
  const uploads = useStickerUploads(tab === 'uploaded');

  return (
    <div className="flex flex-col gap-5 pt-1" data-testid="clip-elements-panel">
      {selected ? (
        <SelectedSticker
          key={selected.id}
          item={selected}
          file={selectedFile}
          totalMs={totalMs}
          fps={fps}
          onEdit={onEdit}
          onTiming={onTiming}
          onAnchor={onAnchor}
          onRemove={onRemove}
        />
      ) : null}

      <div className="flex flex-col gap-3">
        {/* Tiles, not a tab bar (2026-11-19): "Uploaded" ran into the frame of a
            four-way bar, and the owner asked for no more tab bars. */}
        <ChoiceTiles<ElementsTab>
          label="Elements"
          columns={2}
          value={tab}
          onValueChange={setTab}
          options={ELEMENTS_TABS.map((choice) => ({
            ...choice,
            icon: ELEMENTS_TAB_ICONS[choice.value],
          }))}
        />
        {tab === 'uploaded' ? (
          <UploadedStickers uploads={uploads} onAdd={onAddUpload} />
        ) : (
          <LibraryBrowser
            key={tab}
            tab={tab}
            onAdd={onAddLibrary}
            onBadge={() => setBadgeOpen(true)}
          />
        )}
      </div>

      <div className="flex flex-col gap-1 border-t-2 border-outline pt-3">
        <Link
          href="/credits/clips"
          target="_blank"
          rel="noopener"
          className="w-fit font-sans text-sm text-ink underline underline-offset-2 type-ui hover:text-actionPrimary"
        >
          Credits
        </Link>
      </div>

      <BadgeFormDialog
        open={badgeOpen}
        onOpenChange={setBadgeOpen}
        onAdd={(platform, name) => {
          setBadgeOpen(false);
          void measureBadgeWidth(platform, name).then((width) => onAddBadge(platform, name, width));
        }}
      />
    </div>
  );
}

function LibraryBrowser({
  tab,
  onAdd,
  onBadge,
}: {
  tab: 'stickers' | 'gifs' | 'favourites';
  onAdd: (sticker: LibraryStickerView) => void;
  onBadge: () => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<StickerCategory | null>(null);
  const search = useStickerSearch({ tab, query, category, enabled: true });
  const categories = useStickerCategories(tab, true);
  const typed = search.query.trim();
  const badgeHere =
    tab === 'stickers' && typed === '' && (category === null || category === 'social');
  const nothing = !search.loading && !search.error && search.items.length === 0;
  const name = tab === 'gifs' ? 'GIFs' : tab === 'favourites' ? 'Favourites' : 'Stickers';

  return (
    <div className="flex flex-col gap-3">
      <SearchInput
        aria-label={`Search ${name}`}
        placeholder={SEARCH_PLACEHOLDER}
        value={query}
        maxLength={80}
        onChange={(event) => setQuery(event.target.value)}
        onClear={() => setQuery('')}
      />
      <CategoryChips
        categories={categories}
        value={category}
        onChange={setCategory}
        label="Categories"
      />

      {search.error ? (
        <Alert variant="danger" className="items-center" data-testid="clip-stickers-failed">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{search.error}</p>
          <Button variant="secondary" size="sm" onClick={search.retry}>
            Try Again
          </Button>
        </Alert>
      ) : null}

      {search.loading && search.items.length === 0 ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : null}

      {nothing && tab === 'favourites' && typed === '' ? (
        <EmptyState icon={Star} title={FAVOURITES_EMPTY} />
      ) : nothing && !badgeHere ? (
        <div className="flex flex-col gap-2" data-testid="clip-stickers-none">
          <p className={NOTE}>{noMatchSentence(typed)}</p>
          {search.suggest ? (
            <CategoryChips
              categories={search.suggest}
              value={null}
              onChange={(next) => {
                setQuery('');
                setCategory(next);
              }}
              label="Nearest Categories"
            />
          ) : null}
        </div>
      ) : null}

      {search.items.length > 0 || badgeHere ? (
        <div className="grid grid-cols-3 gap-2" data-testid="clip-sticker-grid">
          {badgeHere ? <BadgeTile onOpen={onBadge} /> : null}
          {search.items.map((sticker) => (
            <StickerTile
              key={sticker.id}
              sticker={sticker}
              onAdd={onAdd}
              onFavourite={search.setFavourite}
            />
          ))}
        </div>
      ) : null}

      {search.hasMore ? (
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          disabled={search.loadingMore}
          onClick={search.loadMore}
        >
          {search.loadingMore ? 'Loading' : 'Show More'}
        </Button>
      ) : null}
    </div>
  );
}

function SelectedSticker({
  item,
  file,
  totalMs,
  fps,
  onEdit,
  onTiming,
  onAnchor,
  onRemove,
}: {
  item: StickerItem;
  file: StickerFileInfo | null;
  totalMs: number;
  fps: number;
  onEdit: StickerEdit;
  onTiming: (startMs: number, durationMs: number) => void;
  onAnchor: (choice: 'moment' | 'whole') => void;
  onRemove: () => void;
}) {
  const loopId = useId();
  const flipId = useId();
  const badge = 'badge' in item.ref ? item.ref : null;
  const moving = file?.picture?.animated === true;
  const picture = file?.previewUrl ?? file?.picture?.fileUrl ?? null;

  return (
    <div className="flex flex-col gap-5" data-testid="clip-selected-sticker">
      <div className="flex items-center gap-3 rounded-md border-2 border-outline bg-inset p-2">
        <span
          className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-sm"
          style={CHECKER}
        >
          {picture ? <TilePicture src={picture} animated={moving} playing /> : null}
        </span>
        <span className="min-w-0 flex-1 truncate font-sans text-sm text-ink type-heading">
          {stickerTitle(item, file)}
        </span>
      </div>

      {file?.missing ? (
        <Alert variant="warning" className="items-center" data-testid="clip-sticker-missing">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">
            {'asset' in item.ref ? UPLOAD_GONE : REMOVED_STICKER}
          </p>
        </Alert>
      ) : null}

      {badge ? <BadgeSection item={item} badge={badge} onEdit={onEdit} /> : null}

      <PanelSection title="Look">
        {moving ? (
          <div className="flex items-center justify-between gap-3">
            <GroupLabel id={loopId}>Loop</GroupLabel>
            <Toggle
              aria-labelledby={loopId}
              checked={item.loop}
              onCheckedChange={(loop) => onEdit((current) => ({ ...current, loop }))}
            />
          </div>
        ) : null}
        {badge ? null : (
          <div className="flex items-center justify-between gap-3">
            <GroupLabel id={flipId}>Flip</GroupLabel>
            <Toggle
              aria-labelledby={flipId}
              checked={item.flipX}
              onCheckedChange={(flipX) => onEdit((current) => ({ ...current, flipX }))}
            />
          </div>
        )}
        <PercentSlider
          label="Opacity"
          value={Math.round(item.transform.opacity * 100)}
          onValueChange={(percent) =>
            onEdit(
              (current) => ({
                ...current,
                transform: { ...current.transform, opacity: percent / 100 },
              }),
              `opacity:${item.id}`,
            )
          }
        />
      </PanelSection>

      <WhenItShows
        item={item}
        totalMs={totalMs}
        fps={fps}
        onTiming={onTiming}
        onAnchor={onAnchor}
      />

      <Button variant="danger" className="w-full" onClick={onRemove}>
        Remove Sticker
      </Button>
    </div>
  );
}

/** A selected badge's platform and name: the pill is measured again to fit. */
function BadgeSection({
  item,
  badge,
  onEdit,
}: {
  item: StickerItem;
  badge: { badge: BadgePlatform; name: string };
  onEdit: StickerEdit;
}) {
  const [name, setName] = useState(badge.name);
  useEffect(() => setName(badge.name), [badge.name]);
  // Measuring waits for the font: only the newest change lands.
  const latest = useRef(0);

  const change = (platform: BadgePlatform, raw: string) => {
    const clean = badgeNameOf(raw);
    // An empty name stays in the field only: a badge always has one.
    if (!clean) return;
    latest.current += 1;
    const mine = latest.current;
    void measureBadgeWidth(platform, clean).then((widthPx) => {
      if (mine !== latest.current) return;
      onEdit(
        (current) => ({ ...current, ref: { badge: platform, name: clean }, widthPx }),
        `badge:${item.id}`,
        item.id,
      );
    });
  };

  return (
    <PanelSection title="Follow Badge">
      <BadgeFields
        platform={badge.badge}
        name={name}
        onPlatform={(platform) => change(platform, name)}
        onName={(next) => {
          setName(next);
          change(badge.badge, next);
        }}
      />
    </PanelSection>
  );
}
