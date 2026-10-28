'use client';

/**
 * The template playground (Sprint 9, Task 1; pages in Sprint 9b): every
 * preset in every format it supports, every slide, drawn by the renderer the
 * editor, the gallery and the export share, so the library can be checked
 * by eye. The design-system playground's pattern: dev only (see page.tsx),
 * in the app shell, and no session needed.
 *
 * - **Filters**: the gallery's own (search, Category, Collection, Style, Look
 *   and Colour, from `template-filters.tsx`), plus the format.
 * - **Pages**: 6, 12 or 24 presets a page, in the library's order. The
 *   filters, the page and its size live in the URL (`?page=3&size=24`), so a
 *   reload or a shared link lands on the same page; any change to the
 *   filters goes back to page one, and a new size keeps the first preset in
 *   view on its new page.
 * - **Overflow**: each slide reports the slots still too long at their
 *   smallest size; the status at the top counts and lists them, across every
 *   page walked so far, and Go To Slide turns to a slide's page first.
 * - **App themes**: the Light Theme and Dark Theme Selects with the top bar's
 *   toggle put the page on any ground the app has, Lilac included.
 *
 * Slides are drawn only as they come near the screen (`SlideFrame`'s `lazy`):
 * even one page of 24 presets in four formats is several hundred slides.
 */
import { ComponentIcon } from '@animateicons/react/lucide/component-icon';
import { PaletteIcon } from '@animateicons/react/lucide/palette-icon';
import { FORMAT_IDS } from '@postgear/design-engine';
import {
  EmptyState,
  PageActions,
  SearchInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@postgear/ui';
import { Search } from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '@/components/navigation/app-shell';
import type { SidebarItem } from '@/components/navigation/sidebar';
import { StudioFonts } from '@/components/studio/studio-fonts';
import { StudioPagination } from '@/components/studio/studio-pagination';
import { formatName, pageAnnouncement } from '@/components/studio/studio-view-model';
import {
  CategoryFilter,
  CollectionFilter,
  ColourFilter,
  LookFilter,
  StyleFilter,
} from '@/components/studio/template-filters';
import { AppThemeSelects } from './app-theme-selects';
import { FitStatus } from './fit-status';
import {
  createFitStore,
  isFiltered,
  type Overflow,
  PAGE_SIZES,
  type PageSize,
  type PlaygroundFilter,
  type PlaygroundView,
  pageAfterResize,
  pageOfPreset,
  parseFormat,
  parsePageSize,
  playgroundDocuments,
  playgroundQuery,
  SHOW_ALL,
  shownLabel,
  shownPage,
  shownPresets,
} from './playground-model';
import { PresetSection } from './preset-section';

const NAV_ITEMS: SidebarItem[] = [
  { label: 'Design System', href: '/dev/components', animatedIcon: ComponentIcon },
  { label: 'Templates', href: '/dev/studio', animatedIcon: PaletteIcon, active: true },
];

/** Brings a slide into view and marks it. A jump, not a glide: gliding past a few hundred slides would draw every one on the way. */
function revealSlide(overflow: Overflow, mark: (key: string) => void) {
  const slide = document.getElementById(overflow.domId);
  if (!slide) return;

  mark(overflow.key);
  // The focus moves too, for the keyboard.
  slide.focus({ preventScroll: true });
  slide.scrollIntoView({ block: 'center' });
}

export function TemplatePlayground({ initialView }: { initialView: PlaygroundView }) {
  const [filter, setFilter] = useState<PlaygroundFilter>(initialView.filter);
  const [page, setPage] = useState(initialView.page);
  const [size, setSize] = useState<PageSize>(initialView.size);
  const query = useDeferredValue(filter.query);
  const [store] = useState(createFitStore);
  const [target, setTarget] = useState<string | null>(null);
  // An overflow on another page: revealed once that page has rendered.
  const [pending, setPending] = useState<Overflow | null>(null);
  const top = useRef<HTMLDivElement>(null);

  // Built once; the filters only choose among them, so typing never rebuilds a slide.
  const documents = useMemo(() => playgroundDocuments(), []);
  const shown = useMemo(
    () =>
      shownPresets({
        query,
        format: filter.format,
        category: filter.category,
        style: filter.style,
        look: filter.look,
        family: filter.family,
        collection: filter.collection,
      }),
    [
      query,
      filter.format,
      filter.category,
      filter.style,
      filter.look,
      filter.family,
      filter.collection,
    ],
  );
  const current = useMemo(() => shownPage(shown, page, size), [shown, page, size]);

  // The URL follows the page, so a reload or a copied link opens right here.
  // Replaced, not pushed: Back leaves the playground, as on the queue.
  useEffect(() => {
    const search = playgroundQuery({ filter: { ...filter, query }, page: current.page, size });
    const next = `${window.location.pathname}${search ? `?${search}` : ''}`;

    // Only when something changed: Next's router listens to replaceState.
    if (`${window.location.pathname}${window.location.search}` !== next) {
      window.history.replaceState(null, '', next);
    }
  }, [filter, query, current.page, size]);

  useEffect(() => {
    if (!pending) return;
    revealSlide(pending, setTarget);
    setPending(null);
  }, [pending]);

  function update(patch: Partial<PlaygroundFilter>) {
    setFilter((before) => ({ ...before, ...patch }));
    setPage(1);
  }

  function turn(next: number) {
    setPage(next);
    top.current?.scrollIntoView({ block: 'start' });
  }

  function resize(next: PageSize) {
    setPage(pageAfterResize(current.page, size, next));
    setSize(next);
  }

  const goTo = useCallback(
    (overflow: Overflow) => {
      const where = pageOfPreset(shown, overflow.presetId, size);
      if (where !== null && where !== current.page) {
        setPage(where);
        setPending(overflow);
        return;
      }
      revealSlide(overflow, setTarget);
    },
    [shown, size, current.page],
  );

  return (
    // The top bar's theme button switches the theme here only: no account to save it to.
    <AppShell navItems={NAV_ITEMS} pageTitle="Template Playground" saveThemeToAccount={false}>
      <StudioFonts />

      <div className="flex flex-col gap-6 pb-16">
        <PageActions className="items-end justify-between gap-4">
          {/* The gallery's arrangement: two to a row on a phone, three from sm, four from lg. */}
          <div className="grid w-full min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:w-auto xl:flex-1">
            <div className="col-span-2 min-w-0 sm:col-span-3 lg:col-span-2">
              <SearchInput
                value={filter.query}
                onChange={(event) => update({ query: event.target.value })}
                onClear={() => update({ query: '' })}
                placeholder="Enter your search"
                aria-label="Search templates"
              />
            </div>
            <CategoryFilter
              value={filter.category}
              onChange={(category) => update({ category })}
              className="col-span-2 sm:col-span-1"
            />
            <CollectionFilter
              value={filter.collection}
              onChange={(collection) => update({ collection })}
              className="col-span-2 sm:col-span-1"
            />
            <Select
              value={filter.format}
              onValueChange={(value) => update({ format: parseFormat(value) })}
            >
              <SelectTrigger aria-label="Filter by format" className="min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Formats</SelectItem>
                {FORMAT_IDS.map((format) => (
                  <SelectItem key={format} value={format}>
                    {formatName(format)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <StyleFilter value={filter.style} onChange={(style) => update({ style })} />
            <LookFilter value={filter.look} onChange={(look) => update({ look })} />
            <ColourFilter value={filter.family} onChange={(family) => update({ family })} />
          </div>
          <AppThemeSelects />
        </PageActions>

        <div ref={top} className="flex scroll-mt-4 flex-wrap items-center justify-between gap-3">
          <p
            className="m-0 font-sans text-sm text-ink type-muted"
            aria-live="polite"
            data-testid="shown-count"
          >
            {shownLabel(shown)}
            {pageAnnouncement(current.page, current.pageCount)}
          </p>
          <Select value={String(size)} onValueChange={(value) => resize(parsePageSize(value))}>
            <SelectTrigger aria-label="Presets per page" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option} per page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <FitStatus
          store={store}
          shown={shown}
          documents={documents}
          pageCount={current.pageCount}
          onGoTo={goTo}
        />

        <p className="m-0 font-sans text-xs text-ink type-muted">
          Photos have no workspace media on this page, so picture slots and photo backgrounds draw
          their fallback colour.
        </p>

        {shown.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No templates match"
            description="Try another word or clear the filters."
            action={
              isFiltered(filter)
                ? { label: 'Clear Filters', onClick: () => update(SHOW_ALL) }
                : undefined
            }
          />
        ) : (
          <>
            <StudioPagination
              label="Template pages"
              page={current.page}
              pageCount={current.pageCount}
              onPageChange={turn}
              className="justify-center"
            />
            {current.presets.map(({ preset, formats }) => (
              <PresetSection
                key={preset.id}
                preset={preset}
                formats={formats}
                documents={documents}
                store={store}
                target={target}
              />
            ))}
            <StudioPagination
              label="Template pages, at the end"
              page={current.page}
              pageCount={current.pageCount}
              onPageChange={turn}
              className="justify-center"
            />
          </>
        )}
      </div>
    </AppShell>
  );
}
