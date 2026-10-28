/**
 * The template playground's logic (Sprint 9, Task 1), kept pure so it can be
 * tested without a browser: which presets and formats the filters leave, the
 * documents the slides are drawn from, the store the overflow check collects
 * into, what that check says, and the app themes the page can wear.
 *
 * The filters are the gallery's own (`filterPresets` and its vocabulary in
 * `studio-view-model.ts`), applied once per format, so a template the gallery
 * would hide in a format is hidden here too.
 */
import {
  type DesignDocument,
  documentFromPreset,
  FORMAT_IDS,
  type FormatId,
  findLayout,
  findSlot,
  isFormatId,
  PRESET_CATEGORIES,
  PRESETS,
  type Preset,
  type PresetCategory,
  presetFormats,
  type SlotId,
  type ThemeStyle,
} from '@postgear/design-engine';
import {
  filterPresets,
  type GalleryFilter,
  NO_FILTER,
  STYLE_LABELS,
  slideCountLabel,
} from '@/components/studio/studio-view-model';

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface PlaygroundFilter {
  query: string;
  format: FormatId | 'all';
  category: PresetCategory | 'all';
  style: ThemeStyle | 'all';
}

export const SHOW_ALL: PlaygroundFilter = {
  query: '',
  format: 'all',
  category: 'all',
  style: 'all',
};

export function isFiltered(filter: PlaygroundFilter): boolean {
  return (
    filter.query.trim() !== '' ||
    filter.format !== 'all' ||
    filter.category !== 'all' ||
    filter.style !== 'all'
  );
}

/** A Select's value as a format, or every format for anything else. */
export function parseFormat(value: string): FormatId | 'all' {
  return isFormatId(value) ? value : 'all';
}

export function parseCategory(value: string): PresetCategory | 'all' {
  return (PRESET_CATEGORIES as readonly string[]).includes(value)
    ? (value as PresetCategory)
    : 'all';
}

export function parseStyle(value: string): ThemeStyle | 'all' {
  return Object.hasOwn(STYLE_LABELS, value) ? (value as ThemeStyle) : 'all';
}

export interface ShownPreset {
  preset: Preset;
  /** The formats it is drawn in here, in `FORMAT_IDS` order. */
  formats: FormatId[];
}

/** The playground has no favourites; the gallery's filter still asks for the set. */
const NO_FAVOURITES: ReadonlySet<string> = new Set();

/**
 * The presets the filters leave, in library order, each with the formats it
 * is shown in: every format it supports, or the one the format filter names.
 */
export function shownPresets(
  filter: PlaygroundFilter,
  presets: readonly Preset[] = PRESETS,
): ShownPreset[] {
  const gallery: GalleryFilter = {
    ...NO_FILTER,
    query: filter.query,
    category: filter.category,
    style: filter.style,
  };
  const formats = filter.format === 'all' ? FORMAT_IDS : [filter.format];
  const passing = formats.map((format) => ({
    format,
    ids: new Set(filterPresets(presets, format, gallery, NO_FAVOURITES).map(({ id }) => id)),
  }));

  return presets.flatMap((preset) => {
    const shown = passing.filter(({ ids }) => ids.has(preset.id)).map(({ format }) => format);
    return shown.length > 0 ? [{ preset, formats: shown }] : [];
  });
}

/** How many slides a list of shown presets draws. */
export function slideTotal(shown: readonly ShownPreset[]): number {
  return shown.reduce((sum, { preset, formats }) => sum + preset.slides.length * formats.length, 0);
}

/** "48 presets, 860 slides" beside the filters. */
export function shownLabel(shown: readonly ShownPreset[]): string {
  const presets = shown.length === 1 ? '1 preset' : `${shown.length} presets`;
  return `${presets}, ${slideCountLabel(slideTotal(shown))}`;
}

// ---------------------------------------------------------------------------
// Documents and keys
// ---------------------------------------------------------------------------

export function documentKey(presetId: string, format: FormatId): string {
  return `${presetId}:${format}`;
}

/** One slide of one preset in one format; `index` is zero-based. */
export function slideKey(presetId: string, format: FormatId, index: number): string {
  return `${presetId}:${format}:${index}`;
}

/** The slide's element id, numbered from 1: `slide-tips-steps-ink-story-2`. */
export function slideDomId(presetId: string, format: FormatId, index: number): string {
  return `slide-${presetId}-${format}-${index + 1}`;
}

/**
 * Every preset in every format it supports, built the way a new design is
 * (`documentFromPreset`, no brand kit, the sample handle), so each slide is
 * what a person would get by picking that template.
 */
export function playgroundDocuments(
  presets: readonly Preset[] = PRESETS,
): ReadonlyMap<string, DesignDocument> {
  const documents = new Map<string, DesignDocument>();

  for (const preset of presets) {
    for (const format of presetFormats(preset)) {
      let next = 0;
      documents.set(
        documentKey(preset.id, format),
        documentFromPreset({
          presetId: preset.id,
          format,
          newId: () => `playground-${preset.id}-${format}-${next++}`,
        }),
      );
    }
  }

  return documents;
}

// ---------------------------------------------------------------------------
// The overflow check
// ---------------------------------------------------------------------------

/** What each slide's last fit reported: the slots still too long at their smallest size. */
export type Fits = ReadonlyMap<string, readonly SlotId[]>;

/**
 * Where the slides report their fit. `SlideFrame` calls `onFit` after a fit
 * whose result differs from that frame's last one, and a frame that is drawn
 * again (a filter hid it and brought it back) reports from scratch, so a
 * report that matches what is stored is dropped here: listeners hear only
 * real changes, and an unchanged snapshot keeps its identity.
 */
export interface FitStore {
  report(key: string, slots: readonly SlotId[]): void;
  subscribe(listener: () => void): () => void;
  snapshot(): Fits;
}

/** The same slots, in any order. */
export function sameSlots(a: readonly SlotId[], b: readonly SlotId[]): boolean {
  if (a.length !== b.length) return false;
  const other = [...b].sort();
  return [...a].sort().every((slot, index) => slot === other[index]);
}

export function createFitStore(): FitStore {
  let fits: Fits = new Map();
  const listeners = new Set<() => void>();

  return {
    report(key, slots) {
      const before = fits.get(key);
      if (before && sameSlots(before, slots)) return;

      const next = new Map(fits);
      next.set(key, [...slots]);
      fits = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => fits,
  };
}

/** A slot as the editor's panel names it, and its id for finding it in the layouts. */
export interface SlotName {
  id: SlotId;
  label: string;
}

/** The names of `slots` on one slide of `design`. */
export function slotNames(
  design: DesignDocument,
  index: number,
  slots: readonly SlotId[],
): SlotName[] {
  const slide = design.slides[index];
  const layout = slide ? findLayout(slide.layoutId) : null;

  return slots.map((id) => ({ id, label: (layout && findSlot(layout, id)?.label) || id }));
}

export interface Overflow {
  key: string;
  domId: string;
  presetName: string;
  format: FormatId;
  /** Numbered from 1, as the page shows it. */
  slide: number;
  slots: SlotName[];
}

export interface FitReport {
  /** Slides the filters show. */
  total: number;
  /** Of those, the ones drawn and fitted at least once. */
  checked: number;
  /** In page order. */
  overflowing: Overflow[];
}

export function fitReport(
  shown: readonly ShownPreset[],
  documents: ReadonlyMap<string, DesignDocument>,
  fits: Fits,
): FitReport {
  let total = 0;
  let checked = 0;
  const overflowing: Overflow[] = [];

  for (const { preset, formats } of shown) {
    for (const format of formats) {
      const design = documents.get(documentKey(preset.id, format));
      if (!design) continue;

      for (let index = 0; index < design.slides.length; index += 1) {
        total += 1;
        const key = slideKey(preset.id, format, index);
        const slots = fits.get(key);
        if (!slots) continue;

        checked += 1;
        if (slots.length === 0) continue;

        overflowing.push({
          key,
          domId: slideDomId(preset.id, format, index),
          presetName: preset.name,
          format,
          slide: index + 1,
          slots: slotNames(design, index, slots),
        });
      }
    }
  }

  return { total, checked, overflowing };
}

/** The status line: how many slides overflow, or that none do. */
export function fitHeadline(report: FitReport): string {
  const count = report.overflowing.length;
  const sofar = report.checked < report.total ? ' so far' : '';

  if (count === 1) return `1 slide overflows its sample content${sofar}.`;
  if (count > 1) return `${count} slides overflow their sample content${sofar}.`;
  return sofar ? 'No slide overflows so far.' : 'Every slide fits its sample content.';
}

/** How far the check has got. Slides are drawn as they scroll near, so it grows. */
export function fitProgress(report: FitReport): string {
  if (report.checked >= report.total) return `${slideCountLabel(report.total)} drawn and checked.`;
  return `${report.checked} of ${slideCountLabel(report.total)} drawn. Scroll down to draw the rest.`;
}

// ---------------------------------------------------------------------------
// App themes
// ---------------------------------------------------------------------------

export interface AppTheme {
  id: string;
  name: string;
}

/**
 * The app's light themes, free then premium, as the catalog in
 * `apps/api/src/modules/users/appearance.catalog.ts` lists them. The app reads
 * that catalog from the API, which needs a session, and this page has none,
 * so it keeps the ids here; the test checks them against colors.css.
 */
export const APP_LIGHT_THEMES: readonly AppTheme[] = [
  { id: 'classic', name: 'Classic' },
  { id: 'cream', name: 'Cream' },
  { id: 'paper', name: 'Paper' },
  { id: 'white', name: 'White' },
  { id: 'cool', name: 'Cool' },
  { id: 'lilac', name: 'Lilac' },
  { id: 'mint', name: 'Mint' },
  { id: 'grape', name: 'Grape' },
  { id: 'peach', name: 'Peach' },
  { id: 'sky', name: 'Sky' },
  { id: 'rose', name: 'Rose' },
  { id: 'lemon', name: 'Lemon' },
];

/** The dark ones, the same way. */
export const APP_DARK_THEMES: readonly AppTheme[] = [
  { id: 'classic', name: 'Classic' },
  { id: 'midnight', name: 'Midnight' },
  { id: 'forest', name: 'Forest' },
  { id: 'plum', name: 'Plum' },
  { id: 'ocean', name: 'Ocean' },
  { id: 'mocha', name: 'Mocha' },
  { id: 'obsidian', name: 'Obsidian' },
  { id: 'nebula', name: 'Nebula' },
  { id: 'ember', name: 'Ember' },
  { id: 'aurora', name: 'Aurora' },
  { id: 'slate', name: 'Slate' },
  { id: 'orchid', name: 'Orchid' },
];
