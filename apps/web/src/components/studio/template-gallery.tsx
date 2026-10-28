'use client';

/**
 * The template gallery, the last step of Create Design (DS-3.2 to DS-3.5,
 * Sprint 9b section 13).
 *
 * Only templates that can be drawn in the chosen format are listed, then the
 * filters: a search (names, categories, tags, collections, themes and art),
 * Category, Collection, Style, Look (the background art), Colour (the
 * theme's family) and Favourites. The order and the pages are the view
 * model's (`galleryView`): favourites, the featured templates, then
 * Signature, Luxury and Classic, 24 places a page, and any change to the
 * filters goes back to page one.
 *
 * With a brand kit chosen every thumbnail is drawn in it (DS-3.3); Show
 * original colours draws the templates' own themes instead. A template's
 * document is built the first time its page shows it, and its slide is drawn
 * as it scrolls near and never again while nothing about it changes, so a
 * page of art stays smooth.
 *
 * Premium templates in a workspace whose plan does not include them keep
 * their thumbnail and wear a lock; choosing one opens the lock dialog. The
 * API has the last word: a create it refuses for the plan opens the same
 * dialog and locks the rest of the page (`onLocked`).
 *
 * Choosing a template creates the design on the server from the library's
 * own copy (the template itself never changes), remembers the kit for next
 * time and opens the editor; Start From Blank makes a plain design in the
 * brand's colours.
 */
import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { StarIcon } from '@animateicons/react/lucide/star-icon';
import {
  BLANK_PRESET_ID,
  CATEGORY_LABELS,
  type DesignDocument,
  documentFromPreset,
  FORMATS,
  type FormatId,
  type Preset,
} from '@postgear/design-engine';
import {
  Alert,
  AlertDescription,
  Button,
  cn,
  EmptyState,
  Label,
  MotionIcon,
  pressSm,
  SearchInput,
  Toggle,
  TooltipHint,
  toast,
} from '@postgear/ui';
import { Search, Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  memo,
  type Ref,
  useCallback,
  useDeferredValue,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ApiError, api } from '@/lib/api';
import type { BrandKitView, DesignDetail } from '@/types/studio';
import { FOCUS } from './design-card';
import {
  isPremiumRefusal,
  PREMIUM_LOCK_MESSAGE,
  PremiumLockDialog,
  PremiumLockMark,
} from './premium-lock';
import { SlideFrame } from './slide-frame';
import { StudioPagination } from './studio-pagination';
import { INSET } from './studio-ui';
import {
  brandFromKitView,
  type GalleryFilter,
  type GalleryTile,
  galleryView,
  isFiltered,
  kitLogoResolver,
  NO_FILTER,
  pageAnnouncement,
  rememberKit,
  slideCountLabel,
  templateCountLabel,
} from './studio-view-model';
import {
  CategoryFilter,
  CollectionFilter,
  ColourFilter,
  LookFilter,
  StyleFilter,
} from './template-filters';
import { CHOSEN, StepHeader } from './wizard-steps';

const GRID =
  'm-0 grid list-none grid-cols-2 gap-4 p-0 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5';

type TemplateTile = Extract<GalleryTile, { kind: 'template' }>;

export function TemplateGallery({
  headingRef,
  orgId,
  format,
  kit,
  brandKitId,
  presetId,
  favourites,
  starProblem,
  onStar,
  onBack,
  premium,
  onLocked,
}: {
  headingRef: Ref<HTMLHeadingElement>;
  orgId: string;
  format: FormatId;
  /** The chosen kit, when the list has it: what the thumbnails are drawn in. */
  kit: BrandKitView | null;
  /** What the new design is made with: the kit's id, or null after Skip For Now. */
  brandKitId: string | null;
  /** A template chosen before the wizard: it leads the gallery. */
  presetId: string | null;
  favourites: ReadonlySet<string>;
  starProblem: string | null;
  onStar: (presetId: string, starred: boolean) => void;
  onBack: () => void;
  /** Whether the plan includes premium templates; null while unknown (nothing locked). */
  premium: boolean | null;
  /** The API refused a premium template: everything premium on the page locks. */
  onLocked: () => void;
}) {
  const router = useRouter();
  const switchId = useId();
  const section = useRef<HTMLElement>(null);
  const [filter, setFilter] = useState<GalleryFilter>(NO_FILTER);
  const [page, setPage] = useState(1);
  const [original, setOriginal] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [lockOpen, setLockOpen] = useState(false);
  // The favourites the order puts first. A star clicked here marks its card at
  // once but does not move it: the order keeps the favourites from before the
  // first click until the filters next change, so the page under the pointer
  // never jumps. Until a star is clicked the order follows them as they load.
  const [frozen, setFrozen] = useState<ReadonlySet<string> | null>(null);
  const query = useDeferredValue(filter.query);

  const brand = useMemo(() => (kit && !original ? brandFromKitView(kit) : null), [kit, original]);
  const resolve = useMemo(() => kitLogoResolver(original ? null : kit), [kit, original]);

  const view = useMemo(
    () =>
      galleryView({
        format,
        filter: { ...filter, query },
        favourites,
        ranked: frozen ?? favourites,
        leading: presetId,
        page,
        premium,
      }),
    [format, filter, query, favourites, frozen, presetId, page, premium],
  );

  // Each template's document in this format and brand, built the first time
  // a page shows it and kept while the two stay the same: turning pages,
  // typing and starring hand every thumbnail the document it already drew,
  // so none is drawn (and fitted) again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new format or brand is what starts a new cache
  const documents = useMemo(() => new Map<string, DesignDocument>(), [format, brand]);

  function documentOf(preset: Preset): DesignDocument {
    let design = documents.get(preset.id);
    if (!design) {
      let next = 0;
      design = documentFromPreset({
        presetId: preset.id,
        format,
        brand,
        newId: () => `gallery-${preset.id}-${next++}`,
      });
      documents.set(preset.id, design);
    }
    return design;
  }

  // Favourites with none starred yet is not a search that missed.
  const noFavourites = filter.favourites && favourites.size === 0;
  const filtered = isFiltered(filter);

  // Kept the same across renders, so the memoised Selects below sit out a
  // page turn, a star or a keystroke in the search.
  const update = useCallback((patch: Partial<GalleryFilter>) => {
    setFilter((current) => ({ ...current, ...patch }));
    setPage(1);
    setFrozen(null);
  }, []);

  function clearFilters() {
    setFilter(NO_FILTER);
    setPage(1);
    setFrozen(null);
  }

  function turn(next: number) {
    setPage(next);
    // The new page starts at its first row, not where the old one ended.
    section.current?.scrollIntoView({ block: 'start' });
  }

  function star(id: string, starred: boolean) {
    setFrozen((current) => current ?? favourites);
    onStar(id, starred);
  }

  function choose(tile: TemplateTile) {
    if (tile.locked) {
      setLockOpen(true);
      return;
    }
    void create(tile.preset.id);
  }

  async function create(id: string) {
    if (creating) return;
    setCreating(id);

    try {
      const { design } = await api<{ design: DesignDetail }>('/studio/designs', {
        method: 'POST',
        body: { presetId: id, format, brandKitId },
      });
      rememberKit(orgId, brandKitId);
      router.push(`/${orgId}/studio/${design.id}`);
    } catch (cause) {
      setCreating(null);

      if (isPremiumRefusal(cause)) {
        // The plan does not include it (it changed in another tab, or the
        // page never knew): lock every premium card and say why.
        onLocked();
        setLockOpen(true);
        return;
      }

      toast({
        variant: 'danger',
        title: "Couldn't create the design",
        description: cause instanceof ApiError ? cause.message : 'Please try again.',
      });
    }
  }

  const spec = FORMATS[format];
  const width = `${Math.min(1, spec.width / spec.height) * 100}%`;

  return (
    <section
      ref={section}
      aria-labelledby="wizard-template"
      className="flex scroll-mt-4 flex-col gap-5"
    >
      <StepHeader
        headingRef={headingRef}
        id="wizard-template"
        title="Choose A Template"
        sub={
          kit && !original
            ? `Shown in the colours of ${kit.name}. Pick one to open it in the editor.`
            : "Shown in each template's own colours. Pick one to open it in the editor."
        }
        aside={
          <div className="flex flex-wrap items-center gap-3">
            {/* With nothing left, the empty state's own button resets instead. */}
            {filtered && view.count > 0 ? (
              <Button variant="secondary" size="sm" onClick={clearFilters}>
                Clear Filters
              </Button>
            ) : null}
            <span className="font-sans text-sm text-ink type-muted" aria-live="polite">
              {templateCountLabel(view.count)}
              <span className="sr-only">{pageAnnouncement(view.page, view.pageCount)}</span>
            </span>
          </div>
        }
      />

      {/* Two to a row on a phone (the long names get a row each), three from
          sm, four from lg, where search takes two places. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <div className="col-span-2 min-w-0 sm:col-span-3 lg:col-span-2">
          <SearchInput
            value={filter.query}
            onChange={(event) => update({ query: event.target.value })}
            onClear={() => update({ query: '' })}
            placeholder="Enter your search"
            aria-label="Search templates"
            className="shadow-none"
          />
        </div>
        <FilterSelects
          category={filter.category}
          collection={filter.collection}
          style={filter.style}
          look={filter.look}
          family={filter.family}
          onUpdate={update}
        />
        <Button
          variant={filter.favourites ? 'primary' : 'secondary'}
          aria-pressed={filter.favourites}
          onClick={() => update({ favourites: !filter.favourites })}
          className="w-full"
        >
          <MotionIcon
            icon={StarIcon}
            className={cn('h-4 w-4', filter.favourites && 'fill-current')}
          />
          Favourites
        </Button>
      </div>

      {kit ? (
        <div className="flex items-center gap-3">
          <Toggle id={switchId} checked={original} onCheckedChange={setOriginal} />
          <Label htmlFor={switchId}>Show original colours</Label>
        </div>
      ) : null}

      {starProblem ? (
        <Alert variant="danger">
          <AlertDescription>{starProblem}</AlertDescription>
        </Alert>
      ) : null}

      {view.tiles.length === 0 ? (
        <EmptyState
          icon={noFavourites ? Star : Search}
          title={noFavourites ? 'No favourites yet' : 'No templates match'}
          description={
            noFavourites
              ? 'Star a template to keep it here for everyone in this workspace.'
              : 'Try another word or clear the filters.'
          }
          action={filtered ? { label: 'Clear Filters', onClick: clearFilters } : undefined}
        />
      ) : (
        <ul className={GRID} aria-busy={creating !== null}>
          {view.tiles.map((tile) =>
            tile.kind === 'blank' ? (
              <li key={BLANK_PRESET_ID} className="min-w-0">
                <button
                  type="button"
                  data-testid="start-from-blank"
                  disabled={creating !== null}
                  onClick={() => void create(BLANK_PRESET_ID)}
                  className={cn(
                    'flex h-full w-full flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed border-outline bg-inset p-4 text-center',
                    FOCUS,
                    'disabled:cursor-wait disabled:opacity-60',
                  )}
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-outline bg-actionPrimary text-onActionPrimary">
                    <MotionIcon icon={PlusIcon} className="h-5 w-5" />
                  </span>
                  <span className="type-ui text-sm text-ink">
                    {creating === BLANK_PRESET_ID ? 'Creating…' : 'Start From Blank'}
                  </span>
                  <span className="max-w-48 font-sans text-xs text-ink type-muted">
                    One plain slide in the colours of your brand.
                  </span>
                </button>
              </li>
            ) : (
              <TemplateCard
                key={tile.preset.id}
                tile={tile}
                design={documentOf(tile.preset)}
                resolve={resolve}
                width={width}
                chosen={tile.preset.id === presetId}
                starred={favourites.has(tile.preset.id)}
                creating={creating}
                onChoose={choose}
                onStar={star}
              />
            ),
          )}
        </ul>
      )}

      <StudioPagination
        label="Template pages"
        page={view.page}
        pageCount={view.pageCount}
        onPageChange={turn}
        className="justify-center"
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={onBack} disabled={creating !== null}>
          <MotionIcon icon={ArrowLeftIcon} className="h-4 w-4" />
          Back
        </Button>
      </div>

      <PremiumLockDialog open={lockOpen} onOpenChange={setLockOpen} />
    </section>
  );
}

/**
 * The five Selects of the filter row, in its grid. Memoised: Radix renders
 * every option of a closed Select as well (to name the chosen one), some
 * eighty here, and a page turn, a star or a keystroke in the search changes
 * none of their values.
 */
const FilterSelects = memo(function FilterSelects({
  category,
  collection,
  style,
  look,
  family,
  onUpdate,
}: Pick<GalleryFilter, 'category' | 'collection' | 'style' | 'look' | 'family'> & {
  onUpdate: (patch: Partial<GalleryFilter>) => void;
}) {
  return (
    <>
      <CategoryFilter
        value={category}
        onChange={(next) => onUpdate({ category: next })}
        className="col-span-2 shadow-none sm:col-span-1"
      />
      <CollectionFilter
        value={collection}
        onChange={(next) => onUpdate({ collection: next })}
        className="col-span-2 shadow-none sm:col-span-1"
      />
      <StyleFilter
        value={style}
        onChange={(next) => onUpdate({ style: next })}
        className="shadow-none"
      />
      <LookFilter
        value={look}
        onChange={(next) => onUpdate({ look: next })}
        className="shadow-none"
      />
      <ColourFilter
        value={family}
        onChange={(next) => onUpdate({ family: next })}
        className="shadow-none"
      />
    </>
  );
});

/**
 * One template: its first slide, its name, category and length, and the
 * star. A locked one (`premium-lock.tsx`) keeps its picture, wears the lock,
 * says "locked" in its name and hints why on hover; choosing it opens the
 * lock dialog instead of creating anything.
 */
function TemplateCard({
  tile,
  design,
  resolve,
  width,
  chosen,
  starred,
  creating,
  onChoose,
  onStar,
}: {
  tile: TemplateTile;
  design: DesignDocument;
  resolve: (mediaId: string) => string | null;
  width: string;
  /** Chosen before the wizard: the ring says so, and so does `aria-current`. */
  chosen: boolean;
  starred: boolean;
  /** The id of the design being created, if any: every card waits for it. */
  creating: string | null;
  onChoose: (tile: TemplateTile) => void;
  onStar: (presetId: string, starred: boolean) => void;
}) {
  const { preset, locked, label } = tile;
  const metaId = `template-${preset.id}-meta`;

  const card = (
    <button
      type="button"
      data-testid="template-card"
      data-locked={locked ? 'true' : undefined}
      aria-label={label}
      aria-describedby={metaId}
      aria-current={chosen ? 'true' : undefined}
      disabled={creating !== null}
      onClick={() => onChoose(tile)}
      className={cn(
        'flex h-full w-full flex-col gap-3 rounded-card border-2 border-outline bg-secondary p-3 text-left',
        pressSm,
        FOCUS,
        'disabled:cursor-wait',
        chosen && CHOSEN,
      )}
    >
      <span
        className={cn(
          INSET,
          'relative flex aspect-square items-center justify-center bg-halftone p-4',
        )}
      >
        <Thumbnail design={design} resolve={resolve} width={width} />
        {locked ? <PremiumLockMark className="absolute start-2 top-2" /> : null}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 pe-11">
        <span
          className="line-clamp-2 break-words type-ui text-sm text-ink"
          // The lock's hint is the hover text of a locked card.
          title={locked ? undefined : preset.name}
        >
          {creating === preset.id ? 'Creating…' : preset.name}
        </span>
        <span id={metaId} className="font-sans text-xs text-ink type-muted">
          {CATEGORY_LABELS[preset.category]}, {slideCountLabel(preset.slides.length)}
        </span>
      </span>
    </button>
  );

  return (
    <li className="relative min-w-0">
      {locked ? <TooltipHint label={PREMIUM_LOCK_MESSAGE}>{card}</TooltipHint> : card}

      <Button
        variant="secondary"
        size="sm"
        aria-pressed={starred}
        aria-label={
          starred ? `Remove ${preset.name} from favourites` : `Add ${preset.name} to favourites`
        }
        onClick={() => onStar(preset.id, !starred)}
        className="absolute bottom-3 end-3 w-9 px-0"
      >
        <MotionIcon icon={StarIcon} className={cn('h-4 w-4', starred && 'fill-current')} />
      </Button>
    </li>
  );
}

/**
 * A template's first slide on the card's stage. Memoised because the fitter
 * runs after every render of a slide: a star clicked or a create started
 * re-renders the cards, and must not redraw the 24 slides under them. The
 * document, the resolver and the width all stay the same while the format
 * and the brand do.
 */
const Thumbnail = memo(function Thumbnail({
  design,
  resolve,
  width,
}: {
  design: DesignDocument;
  resolve: (mediaId: string) => string | null;
  width: string;
}) {
  return (
    <span className="block border-2 border-outline shadow-brutalSm" style={{ width }}>
      <SlideFrame design={design} resolveMedia={resolve} lazy />
    </span>
  );
});
