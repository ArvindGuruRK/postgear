/**
 * The template gallery.
 *
 * A preset is a **shape** (which layouts, in which order), a **theme**
 * (colours and type), an optional **art** style (the drawing under the text)
 * and **sample content**. Pairing shapes with themes and arts is what gets
 * the library past a hundred and fifty without anyone hand-drawing a hundred
 * and fifty designs: adding one is a row in a collection's file (`build.ts`
 * says how they are written).
 *
 * The library is three collections, which the gallery filters by:
 *
 * - **Classic** (`classic.ts`, `classic-art.ts`): Sprint 9's forty-seven,
 *   unchanged, and classic shapes over a pattern;
 * - **Signature** (`signature.ts`, `originals.ts`): CarouselClick's look, its
 *   generated patterns and its hand-made backgrounds on the signature themes;
 * - **Luxury** (`luxury.ts`): the luxury themes and art.
 *
 * The brand name, the handle and the slide numbers are not sample content:
 * they belong to the design (`bindings.ts`), so a preset never writes them.
 *
 * Nothing here is ever written to the database. A design stores the preset's
 * id and its own copy of the content (`document.ts`), so a preset can be
 * reworded in a later release without touching a design anybody made.
 */
import { artById } from '../art';
import { latestLayout } from '../layouts';
import { themeById } from '../themes';
import {
  COLLECTION_LABELS,
  type ColorFamily,
  type FormatId,
  type Preset,
  type PresetCategory,
  type PresetCollection,
  type ThemeStyle,
} from '../types';
import { CLASSIC_PRESETS } from './classic';
import { CLASSIC_ART_PRESETS } from './classic-art';
import { LUXURY_PRESETS } from './luxury';
import { ORIGINAL_PRESETS } from './originals';
import { SIGNATURE_PRESETS } from './signature';

export { buildPresets, type PresetRow, type PresetShape, slide } from './build';

/**
 * The handle a design made from a preset starts with, so the footer reads
 * like a footer in the gallery. It is the design's own from then on: typed
 * once, shown on every slide.
 */
export const SAMPLE_HANDLE = '@yourbrand';

/** Every template, Classic first so Sprint 9's order is unchanged at the front. */
export const PRESETS: Preset[] = [
  ...CLASSIC_PRESETS,
  ...CLASSIC_ART_PRESETS,
  ...SIGNATURE_PRESETS,
  ...ORIGINAL_PRESETS,
  ...LUXURY_PRESETS,
];

const BY_ID: ReadonlyMap<string, Preset> = new Map(PRESETS.map((preset) => [preset.id, preset]));

export function presetById(id: string): Preset | null {
  return BY_ID.get(id) ?? null;
}

export function presetsByCategory(category: PresetCategory): Preset[] {
  return PRESETS.filter((preset) => preset.category === category);
}

/**
 * The formats every slide of a preset can be drawn in. Every layout takes all
 * four today; this is what keeps a future single-format layout out of the
 * wrong gallery rather than producing a design the schema refuses.
 */
export function presetFormats(preset: Preset): FormatId[] {
  let formats: FormatId[] | null = null;

  for (const entry of preset.slides) {
    const layout = latestLayout(entry.layoutId);
    if (!layout) return [];

    formats =
      formats === null
        ? [...layout.formats]
        : formats.filter((format) => layout.formats.includes(format));
  }

  return formats ?? [];
}

// ---------------------------------------------------------------------------
// Facets: what the gallery and the playground filter by
// ---------------------------------------------------------------------------

/** Light, dark or colourful: the gallery's Style filter. */
export function presetStyle(preset: Preset): ThemeStyle {
  return themeById(preset.themeId).style;
}

/** The gallery's Collection filter. A preset that names none is Classic. */
export function presetCollection(preset: Preset): PresetCollection {
  return preset.collection ?? 'classic';
}

/** What the Look filter calls a preset with no background art. */
export const LOOK_NONE = 'none';

/**
 * The gallery's Look filter: the art style's id, or `LOOK_NONE`. An art id
 * that no longer resolves reads as none, the way the renderer draws it.
 */
export function presetLook(preset: Preset): string {
  return artById(preset.art) ? (preset.art as string) : LOOK_NONE;
}

/** The gallery's Colour filter, from the theme the preset wears. */
export function presetFamily(preset: Preset): ColorFamily {
  return themeById(preset.themeId).family;
}

/**
 * Whether a preset is locked to paid plans: the luxury collection, and any
 * preset whose theme or art is premium. `buildPresets` writes the same rule
 * into `preset.premium`; this checks the parts as well, so a preset built by
 * hand cannot slip through unlocked.
 */
export function isPresetPremium(preset: Preset): boolean {
  return (
    preset.premium === true ||
    presetCollection(preset) === 'luxury' ||
    themeById(preset.themeId).premium === true ||
    artById(preset.art)?.premium === true
  );
}

/**
 * Whether a preset matches what was typed in the gallery's search: every word
 * has to appear in its name, its category, its tags, its collection, its
 * theme's name or its art's name, so "luxury", "forest" and "aurora" all find
 * something.
 */
export function matchesPresetQuery(preset: Preset, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;

  const haystack = [
    preset.name,
    preset.category,
    ...preset.tags,
    COLLECTION_LABELS[presetCollection(preset)],
    themeById(preset.themeId).name,
    artById(preset.art)?.name ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * The three the empty state offers as inspiration (DS-1.2), and the first
 * the gallery shows after any favourites: one of each collection since
 * Sprint 9b, so a new workspace sees the CarouselClick look, the luxury set
 * (locked on a free plan, which is the point of showing it) and a classic.
 */
export const FEATURED_PRESET_IDS: readonly string[] = [
  'signature-post-planning-forest',
  'luxury-collection-launch-gilded-noir',
  'tips-steps-ink',
];
