'use client';

/**
 * The template playground (Sprint 9, Task 1): every preset in every format
 * it supports, every slide, drawn by the renderer the editor, the gallery and
 * the export share, so the library can be checked by eye. The design-system
 * playground's pattern: dev only (see page.tsx), in the app shell, and no
 * session needed.
 *
 * - **Overflow**: each slide reports the slots still too long at their
 *   smallest size; the status at the top counts and lists them.
 * - **App themes**: the Light Theme and Dark Theme Selects with the top bar's
 *   toggle put the page on any ground the app has, Lilac included.
 * - **Filters**: format, category, style and a search, in the gallery's words.
 *
 * Slides are drawn only as they come near the screen (`SlideFrame`'s `lazy`):
 * the library in four formats is over 800 slides.
 */
import { ComponentIcon } from '@animateicons/react/lucide/component-icon';
import { PaletteIcon } from '@animateicons/react/lucide/palette-icon';
import {
  CATEGORY_LABELS,
  FORMAT_IDS,
  PRESET_CATEGORIES,
  type ThemeStyle,
} from '@postgear/design-engine';
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
import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { AppShell } from '@/components/navigation/app-shell';
import type { SidebarItem } from '@/components/navigation/sidebar';
import { StudioFonts } from '@/components/studio/studio-fonts';
import { formatName, STYLE_LABELS } from '@/components/studio/studio-view-model';
import { AppThemeSelects } from './app-theme-selects';
import { FitStatus } from './fit-status';
import {
  createFitStore,
  isFiltered,
  type Overflow,
  type PlaygroundFilter,
  parseCategory,
  parseFormat,
  parseStyle,
  playgroundDocuments,
  SHOW_ALL,
  shownLabel,
  shownPresets,
} from './playground-model';
import { PresetSection } from './preset-section';

const NAV_ITEMS: SidebarItem[] = [
  { label: 'Design System', href: '/dev/components', animatedIcon: ComponentIcon },
  { label: 'Templates', href: '/dev/studio', animatedIcon: PaletteIcon, active: true },
];

const STYLES = Object.keys(STYLE_LABELS) as ThemeStyle[];

export function TemplatePlayground() {
  const [filter, setFilter] = useState<PlaygroundFilter>(SHOW_ALL);
  const query = useDeferredValue(filter.query);
  const [store] = useState(createFitStore);
  const [target, setTarget] = useState<string | null>(null);

  // Built once; the filters only choose among them, so typing never rebuilds a slide.
  const documents = useMemo(() => playgroundDocuments(), []);
  const shown = useMemo(
    () =>
      shownPresets({
        query,
        format: filter.format,
        category: filter.category,
        style: filter.style,
      }),
    [query, filter.format, filter.category, filter.style],
  );

  function update(patch: Partial<PlaygroundFilter>) {
    setFilter((current) => ({ ...current, ...patch }));
  }

  // Overflowing slides have been drawn (that is how they reported), so the
  // element is there to scroll to. A jump, not a smooth scroll: gliding past
  // a few hundred slides would draw every one of them on the way. The focus
  // moves too, for the keyboard.
  const goTo = useCallback((overflow: Overflow) => {
    const slide = document.getElementById(overflow.domId);
    if (!slide) return;

    setTarget(overflow.key);
    slide.focus({ preventScroll: true });
    slide.scrollIntoView({ block: 'center' });
  }, []);

  return (
    // The top bar's theme button switches the theme here only: no account to save it to.
    <AppShell navItems={NAV_ITEMS} pageTitle="Template Playground" saveThemeToAccount={false}>
      <StudioFonts />

      <div className="flex flex-col gap-6 pb-16">
        <PageActions className="items-end justify-between gap-4">
          <div className="flex w-full flex-col gap-3 xl:w-auto xl:flex-row xl:flex-wrap xl:items-center">
            <div className="xl:w-72">
              <SearchInput
                value={filter.query}
                onChange={(event) => update({ query: event.target.value })}
                onClear={() => update({ query: '' })}
                placeholder="Enter your search"
                aria-label="Search templates"
              />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center">
              <Select
                value={filter.format}
                onValueChange={(value) => update({ format: parseFormat(value) })}
              >
                <SelectTrigger aria-label="Filter by format" className="sm:w-48">
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
              <Select
                value={filter.category}
                onValueChange={(value) => update({ category: parseCategory(value) })}
              >
                <SelectTrigger aria-label="Filter by category" className="sm:w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {PRESET_CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>
                      {CATEGORY_LABELS[category]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filter.style}
                onValueChange={(value) => update({ style: parseStyle(value) })}
              >
                <SelectTrigger aria-label="Filter by style" className="sm:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Styles</SelectItem>
                  {STYLES.map((style) => (
                    <SelectItem key={style} value={style}>
                      {STYLE_LABELS[style]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p
                className="m-0 self-center font-sans text-sm text-ink type-muted"
                aria-live="polite"
                data-testid="shown-count"
              >
                {shownLabel(shown)}
              </p>
            </div>
          </div>
          <AppThemeSelects />
        </PageActions>

        <FitStatus store={store} shown={shown} documents={documents} onGoTo={goTo} />

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
                ? { label: 'Clear Filters', onClick: () => setFilter(SHOW_ALL) }
                : undefined
            }
          />
        ) : (
          shown.map(({ preset, formats }) => (
            <PresetSection
              key={preset.id}
              preset={preset}
              formats={formats}
              documents={documents}
              store={store}
              target={target}
            />
          ))
        )}
      </div>
    </AppShell>
  );
}
