/**
 * Studio's display logic (Sprint 9), kept pure so it can be tested without a
 * browser: badges and labels, the "Updated 2 hours ago" line, the create
 * wizard's state in the URL, the brand kit form's checks, the gallery's
 * filters, order, pages and locks (Sprint 9b), the kit the wizard remembers,
 * the save indicator, the brand kit update offer and share expiry.
 *
 * The API answers a malformed body with "Invalid input" and nothing more (a
 * project rule), so every rule a form can break is checked here first, in the
 * sentences the API itself uses where it has one.
 */
import {
  ART_STYLES,
  type ArtKind,
  BRAND_COLOR_KEYS,
  type BrandColors,
  brandFromTheme,
  COLOR_FAMILIES,
  COLOR_FAMILY_LABELS,
  type ColorFamily,
  DEFAULT_THEME_ID,
  type DesignBrand,
  type DesignFonts,
  exportSizeLabel,
  FEATURED_PRESET_IDS,
  FORMATS,
  type FormatId,
  isArtId,
  isFormatId,
  isPresetPremium,
  LOOK_NONE,
  MAX_SLIDES,
  matchesPresetQuery,
  normalizeHex,
  PRESET_CATEGORIES,
  PRESET_COLLECTIONS,
  PRESETS,
  type Preset,
  type PresetCategory,
  type PresetCollection,
  presetById,
  presetCollection,
  presetFamily,
  presetFormats,
  presetLook,
  presetStyle,
  type ThemeStyle,
  themeById,
} from '@postgear/design-engine';
import type { BrandKitBody, BrandKitView, DesignStatusView, StudioMediaRef } from '@/types/studio';

// ---------------------------------------------------------------------------
// Designs
// ---------------------------------------------------------------------------

export const STATUS_BADGES: Record<
  DesignStatusView,
  { label: string; variant: 'outline' | 'primary' | 'success' }
> = {
  DRAFT: { label: 'Draft', variant: 'outline' },
  EXPORTED: { label: 'Exported', variant: 'primary' },
  SENT: { label: 'Sent', variant: 'success' },
};

/** "Portrait (4:5)", as the format cards, badges and filter name it. */
export function formatName(format: FormatId): string {
  const spec = FORMATS[format];
  return `${spec.label} (${spec.ratio})`;
}

/** "1080 x 1350. Instagram and Facebook portrait feed posts." (DS-3.1) */
export function formatHint(format: FormatId): string {
  return `${exportSizeLabel(format)}. ${FORMATS[format].hint}.`;
}

export function slideCountLabel(count: number): string {
  return count === 1 ? '1 slide' : `${count} slides`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * When something happened: "just now", "5 minutes ago", "yesterday", "3 days
 * ago", then a date once it is a week old. The design cards' "Updated" line
 * and the share links' "Created" and "Last viewed" all count this way, so
 * they never disagree about what "yesterday" is.
 */
export function sinceLabel(iso: string, now: Date): string {
  const at = new Date(iso);
  const elapsed = now.getTime() - at.getTime();

  if (Number.isNaN(elapsed)) return 'recently';
  // A browser clock a little behind the server's still reads "just now".
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${plural(Math.floor(elapsed / MINUTE), 'minute')} ago`;
  if (elapsed < DAY) return `${plural(Math.floor(elapsed / HOUR), 'hour')} ago`;
  if (elapsed < 2 * DAY) return 'yesterday';
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)} days ago`;

  const sameYear = at.getFullYear() === now.getFullYear();
  return `on ${at.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  })}`;
}

/** "Updated 2 hours ago" (DS-1.3), and a date once it is more than a week old. */
export function updatedLabel(iso: string, now: Date): string {
  return `Updated ${sinceLabel(iso, now)}`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export const MAX_TITLE_LENGTH = 120;

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this strips.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]+/g;

/**
 * A title as typed into the rename field: one line, whitespace collapsed,
 * within the API's limit. Empty falls back to the previous title (DS-6.4).
 */
export function cleanTitle(input: string, previous: string): string {
  const cleaned = Array.from(input.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim())
    .slice(0, MAX_TITLE_LENGTH)
    .join('')
    .trim();

  return cleaned || previous;
}

export const SLIDE_LIMIT_MESSAGE = `A design can have up to ${MAX_SLIDES} slides.`;

/**
 * Turns a design's media map into what the renderer asks for. A small slide
 * (a thumbnail) takes the library's thumbnail; anything bigger the full file.
 * An id missing from the map was deleted, and draws as an empty slot.
 */
export function mediaResolver(
  media: Record<string, StudioMediaRef>,
  size: 'thumbnail' | 'full' = 'full',
): (mediaId: string) => string | null {
  return (mediaId) => {
    const ref = media[mediaId];
    if (!ref) return null;
    return size === 'thumbnail' ? (ref.thumbnailUrl ?? ref.url) : ref.url;
  };
}

// ---------------------------------------------------------------------------
// The create wizard, in the URL
// ---------------------------------------------------------------------------

export type WizardStep = 'brand' | 'format' | 'template';

export const WIZARD_STEPS: readonly WizardStep[] = ['brand', 'format', 'template'];

export interface WizardState {
  step: WizardStep;
  /** The brand kit chosen in step one; null after Skip For Now. */
  kitId: string | null;
  format: FormatId | null;
  /** A template picked before the wizard (the empty state's examples). */
  presetId: string | null;
}

type SearchParamsLike = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === 'string' ? text : null;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Reads the wizard from the URL, so a refresh keeps every answer. Anything
 * malformed is dropped rather than trusted, and a step that needs an earlier
 * answer it does not have goes back to that step.
 */
export function parseWizard(params: SearchParamsLike): WizardState {
  const kit = first(params.kit);
  const format = first(params.format);
  const template = first(params.template);
  const step = first(params.step);

  const state: WizardState = {
    step: step === 'format' || step === 'template' ? step : 'brand',
    kitId: kit && ID_PATTERN.test(kit) ? kit : null,
    format: isFormatId(format) ? format : null,
    presetId: template && presetById(template) ? template : null,
  };

  if (state.step === 'template' && !state.format) state.step = 'format';
  return state;
}

/** The query string for a wizard state; the inverse of `parseWizard`. */
export function wizardQuery(state: WizardState): string {
  const query = new URLSearchParams({ step: state.step });
  if (state.kitId) query.set('kit', state.kitId);
  if (state.format) query.set('format', state.format);
  if (state.presetId) query.set('template', state.presetId);
  return query.toString();
}

// ---------------------------------------------------------------------------
// Brand kits
// ---------------------------------------------------------------------------

export const HEX_ERROR = 'Enter a colour like #1A2B3C.';
export const KIT_NAME_ERROR = 'Enter a name for this brand kit.';
export const WEBSITE_ERROR = 'Enter a website address like https://example.com.';
export const MAX_KIT_NAME_LENGTH = 120;
export const MAX_KIT_DESCRIPTION_LENGTH = 500;

export const COLOR_LABELS: Record<keyof BrandColors, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  accent: 'Accent',
  background: 'Background',
  text: 'Text',
};

/** The brand kit form as typed: colours are text until they are valid. */
export interface BrandKitDraft {
  name: string;
  description: string;
  websiteUrl: string;
  logoMediaId: string | null;
  colors: Record<keyof BrandColors, string>;
}

export function draftFromKit(kit: BrandKitView): BrandKitDraft {
  return {
    name: kit.name,
    description: kit.description ?? '',
    websiteUrl: kit.websiteUrl ?? '',
    logoMediaId: kit.logoMediaId,
    colors: { ...kit.colors },
  };
}

/** `#1a2b3c`, `1A2B3C` and `#abc` all read as a colour; anything else is null. */
export function hexFromInput(value: string): string | null {
  return normalizeHex(value);
}

/**
 * A website as a person types it, with or without `https://`. A light check:
 * the API decides for certain, and refuses private addresses on extraction.
 * A name with no dot is taken for a typo ("acme" for "acme.com"), except the
 * local machine and an IPv6 address: those go on to the API, which answers
 * that they are not public (DS-2.2), rather than being called malformed.
 */
export function websiteProblem(value: string): string | null {
  const text = value.trim();
  if (!text) return null;

  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return WEBSITE_ERROR;

    const host = url.hostname.toLowerCase();
    const named = host.includes('.') || host === 'localhost' || host.startsWith('[');
    return named ? null : WEBSITE_ERROR;
  } catch {
    return WEBSITE_ERROR;
  }
}

export interface BrandKitProblems {
  name: string | null;
  websiteUrl: string | null;
  colors: Partial<Record<keyof BrandColors, string>>;
}

export function brandKitProblems(draft: BrandKitDraft): BrandKitProblems {
  const colors: BrandKitProblems['colors'] = {};
  for (const key of BRAND_COLOR_KEYS) {
    if (!hexFromInput(draft.colors[key])) colors[key] = HEX_ERROR;
  }

  return {
    name: draft.name.trim() === '' ? KIT_NAME_ERROR : null,
    websiteUrl: websiteProblem(draft.websiteUrl),
    colors,
  };
}

export function hasProblems(problems: BrandKitProblems): boolean {
  return (
    problems.name !== null ||
    problems.websiteUrl !== null ||
    Object.keys(problems.colors).length > 0
  );
}

/** What `POST /studio/brand-kits` takes, or null while the form has a problem. */
export function brandKitBody(
  draft: BrandKitDraft,
  source: BrandKitBody['source'] = 'MANUAL',
): BrandKitBody | null {
  if (hasProblems(brandKitProblems(draft))) return null;

  const colors = {} as BrandColors;
  for (const key of BRAND_COLOR_KEYS) colors[key] = hexFromInput(draft.colors[key]) as string;

  return {
    name: draft.name.trim().slice(0, MAX_KIT_NAME_LENGTH),
    description: draft.description.trim().slice(0, MAX_KIT_DESCRIPTION_LENGTH) || null,
    websiteUrl: draft.websiteUrl.trim() || null,
    logoMediaId: draft.logoMediaId,
    colors,
    source,
  };
}

export type KitNotice = { kind: 'deleted' } | { kind: 'newer'; kit: BrandKitView } | null;

/**
 * What the design panel says about the design's brand kit (DS-2.5, and the
 * deleted-kit edge case). A kit edited since the design copied it is offered
 * only when its colours or fonts really differ: Update From Kit takes nothing
 * else, so offering it for a renamed kit would be a button that changes
 * nothing.
 */
export function kitNotice(brand: DesignBrand, kits: BrandKitView[] | null): KitNotice {
  if (!brand.kitId || !kits) return null;

  const kit = kits.find((entry) => entry.id === brand.kitId);
  if (!kit) return { kind: 'deleted' };

  const copied = brand.kitVersion ? Date.parse(brand.kitVersion) : Number.NaN;
  const edited = Date.parse(kit.updatedAt);
  const newer = Number.isNaN(copied) || edited > copied;

  const same =
    sameColors(kit.colors, brand.colors) && sameFonts(brandFromKitView(kit).fonts, brand.fonts);
  return newer && !same ? { kind: 'newer', kit } : null;
}

/** Null and a choice of neither face mean the same: the theme's fonts. */
function sameFonts(a: DesignFonts | null, b: DesignFonts | null): boolean {
  return (a?.heading ?? null) === (b?.heading ?? null) && (a?.body ?? null) === (b?.body ?? null);
}

export function sameColors(a: BrandColors | null, b: BrandColors | null): boolean {
  if (!a || !b) return a === b;
  return BRAND_COLOR_KEYS.every((key) => normalizeHex(a[key]) === normalizeHex(b[key]));
}

// ---------------------------------------------------------------------------
// The template gallery
// ---------------------------------------------------------------------------

/** What every filter but the search and Favourites reads when it is off. */
export const ALL = 'all';

export interface GalleryFilter {
  query: string;
  category: PresetCategory | typeof ALL;
  style: ThemeStyle | typeof ALL;
  /** An art style's id, `LOOK_NONE` for templates without art, or every look. */
  look: string;
  /** The colour family of the template's theme (the Colour filter). */
  family: ColorFamily | typeof ALL;
  collection: PresetCollection | typeof ALL;
  favourites: boolean;
}

export const NO_FILTER: GalleryFilter = {
  query: '',
  category: ALL,
  style: ALL,
  look: ALL,
  family: ALL,
  collection: ALL,
  favourites: false,
};

export const STYLE_LABELS: Record<ThemeStyle, string> = {
  light: 'Light',
  dark: 'Dark',
  colourful: 'Colourful',
};

/** Only templates that can be drawn in the chosen format, then the filters (DS-3.2). */
export function filterPresets(
  presets: readonly Preset[],
  format: FormatId,
  filter: GalleryFilter,
  favourites: ReadonlySet<string>,
): Preset[] {
  return presets.filter(
    (preset) =>
      presetFormats(preset).includes(format) &&
      (filter.category === ALL || preset.category === filter.category) &&
      (filter.style === ALL || presetStyle(preset) === filter.style) &&
      (filter.look === ALL || presetLook(preset) === filter.look) &&
      (filter.family === ALL || presetFamily(preset) === filter.family) &&
      (filter.collection === ALL || presetCollection(preset) === filter.collection) &&
      (!filter.favourites || favourites.has(preset.id)) &&
      matchesPresetQuery(preset, filter.query),
  );
}

export function isFiltered(filter: GalleryFilter): boolean {
  return (
    filter.query.trim() !== '' ||
    filter.category !== ALL ||
    filter.style !== ALL ||
    filter.look !== ALL ||
    filter.family !== ALL ||
    filter.collection !== ALL ||
    filter.favourites
  );
}

// The Selects hand back strings; each is read back into its filter here, and
// anything the library does not know (a stale link, `toString`) reads as off.

export function parseCategory(value: string): PresetCategory | typeof ALL {
  return (PRESET_CATEGORIES as readonly string[]).includes(value) ? (value as PresetCategory) : ALL;
}

export function parseStyle(value: string): ThemeStyle | typeof ALL {
  return Object.hasOwn(STYLE_LABELS, value) ? (value as ThemeStyle) : ALL;
}

export function parseLook(value: string): string {
  return value === LOOK_NONE || isArtId(value) ? value : ALL;
}

export function parseFamily(value: string): ColorFamily | typeof ALL {
  return (COLOR_FAMILIES as readonly string[]).includes(value) ? (value as ColorFamily) : ALL;
}

export function parseCollection(value: string): PresetCollection | typeof ALL {
  return (PRESET_COLLECTIONS as readonly string[]).includes(value)
    ? (value as PresetCollection)
    : ALL;
}

/** One choice in the Look filter. */
export interface LookOption {
  id: string;
  name: string;
}

/** The Look filter's choices of one kind of art, under its own heading. */
export interface LookGroup {
  kind: ArtKind;
  label: string;
  looks: LookOption[];
}

export const LOOK_KIND_LABELS: Record<ArtKind, string> = {
  pattern: 'Patterns',
  original: 'Hand-Made',
  luxury: 'Luxury',
};

/** What the Look filter calls templates without background art. */
export const NO_ART_LABEL = 'None';

/**
 * The art styles some template wears, grouped by kind in the art library's
 * own order. A style no template uses is left out: choosing it could only
 * ever show "No templates match".
 */
export function lookGroups(presets: readonly Preset[] = PRESETS): LookGroup[] {
  const worn = new Set(presets.map(presetLook));
  const groups: LookGroup[] = [];

  for (const art of ART_STYLES) {
    if (!worn.has(art.id)) continue;

    let group = groups.find((entry) => entry.kind === art.kind);
    if (!group) {
      group = { kind: art.kind, label: LOOK_KIND_LABELS[art.kind], looks: [] };
      groups.push(group);
    }
    group.looks.push({ id: art.id, name: art.name });
  }

  return groups;
}

/** True when some template has no background art, so None is worth offering. */
export function hasNoArtTemplates(presets: readonly Preset[] = PRESETS): boolean {
  return presets.some((preset) => presetLook(preset) === LOOK_NONE);
}

/** The colour families some template's theme belongs to, in `COLOR_FAMILIES` order. */
export function familyOptions(presets: readonly Preset[] = PRESETS): ColorFamily[] {
  const worn = new Set(presets.map(presetFamily));
  return COLOR_FAMILIES.filter((family) => worn.has(family));
}

export function familyLabel(family: ColorFamily): string {
  return COLOR_FAMILY_LABELS[family];
}

/** The collections the library has templates in, in `PRESET_COLLECTIONS` order. */
export function collectionOptions(presets: readonly Preset[] = PRESETS): PresetCollection[] {
  const worn = new Set(presets.map(presetCollection));
  return PRESET_COLLECTIONS.filter((collection) => worn.has(collection));
}

/** The collections in the order the gallery shows them, after favourites and the featured. */
export const COLLECTION_ORDER: readonly PresetCollection[] = ['signature', 'luxury', 'classic'];

/**
 * The gallery's order (Sprint 9b): a template chosen before the wizard first,
 * then the workspace's favourites, then the featured templates in the order
 * they are featured, then Signature, Luxury and Classic. Within a group the
 * registry's own order holds (the sort is stable), so a new template lands
 * where its collection's file puts it.
 */
export function orderPresets(
  presets: readonly Preset[],
  favourites: ReadonlySet<string>,
  leading: string | null = null,
  featured: readonly string[] = FEATURED_PRESET_IDS,
): Preset[] {
  const rank = (preset: Preset): [number, number] => {
    if (preset.id === leading) return [0, 0];
    if (favourites.has(preset.id)) return [1, 0];

    const place = featured.indexOf(preset.id);
    if (place >= 0) return [2, place];

    return [3 + COLLECTION_ORDER.indexOf(presetCollection(preset)), 0];
  };

  return presets
    .map((preset) => ({ preset, rank: rank(preset) }))
    .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1])
    .map(({ preset }) => preset);
}

/** Tiles to a gallery page: rows of 2, 3 and 4 come out full. */
export const GALLERY_PAGE_SIZE = 24;

/** How many pages `total` items take, never fewer than one. */
export function pageCountOf(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size));
}

/** A page the list has: a whole number from 1 to the last page. */
export function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.floor(page)), Math.max(1, pageCount));
}

/** One page of a list, numbered from 1; a page past the end is the last one. */
export function pageOf<T>(items: readonly T[], page: number, size: number): T[] {
  const start = (clampPage(page, pageCountOf(items.length, size)) - 1) * size;
  return items.slice(start, start + size);
}

/**
 * A premium template in a workspace whose plan is known not to include them
 * (`premium-lock.tsx`). An unknown plan (`null`) locks nothing: the API
 * refuses what it does not allow, and the page catches up from that.
 */
export function isLocked(preset: Preset, premium: boolean | null): boolean {
  return premium === false && isPresetPremium(preset);
}

/** A control's accessible name, saying "locked" when it is: the lock itself is hidden from screen readers. */
export function withLock(label: string, locked: boolean): string {
  return locked ? `${label}, locked` : label;
}

/** A template card's name: what choosing it does, and that it is locked when it is. */
export function templateCardLabel(name: string, locked: boolean): string {
  return withLock(`Use ${name}`, locked);
}

/** One place in the gallery's grid. */
export type GalleryTile =
  | { kind: 'blank' }
  | { kind: 'template'; preset: Preset; locked: boolean; label: string };

export interface GalleryView {
  /** How many templates match (Start From Blank is not one of them). */
  count: number;
  /** The page shown: the one asked for, or the last there is. */
  page: number;
  pageCount: number;
  tiles: GalleryTile[];
}

/**
 * One page of the gallery: the templates the format and the filters leave,
 * in `orderPresets` order, `GALLERY_PAGE_SIZE` places a page, each card
 * locked or not for this workspace's plan.
 *
 * Start From Blank leads while nothing is filtered (a filtered list answers
 * a question, and blank is not an answer to one) and takes a place like a
 * template, so page one is full too: blank and the first 23. `ranked` is the
 * set of favourites the order puts first, which the gallery holds still
 * while someone is starring (see `template-gallery.tsx`); the Favourites
 * filter always reads `favourites` itself.
 */
export function galleryView({
  presets = PRESETS,
  format,
  filter,
  favourites,
  ranked = favourites,
  leading = null,
  page,
  premium,
}: {
  presets?: readonly Preset[];
  format: FormatId;
  filter: GalleryFilter;
  favourites: ReadonlySet<string>;
  ranked?: ReadonlySet<string>;
  /** A template chosen before the wizard: it leads the list. */
  leading?: string | null;
  page: number;
  /** `StudioAccess.premium`: null while unknown, when nothing is locked. */
  premium: boolean | null;
}): GalleryView {
  const matching = orderPresets(
    filterPresets(presets, format, filter, favourites),
    ranked,
    leading,
  );
  const templates = matching.map((preset): GalleryTile => {
    const locked = isLocked(preset, premium);
    return { kind: 'template', preset, locked, label: templateCardLabel(preset.name, locked) };
  });
  const tiles: GalleryTile[] = isFiltered(filter) ? templates : [{ kind: 'blank' }, ...templates];
  const pageCount = pageCountOf(tiles.length, GALLERY_PAGE_SIZE);
  const current = clampPage(page, pageCount);

  return {
    count: matching.length,
    page: current,
    pageCount,
    tiles: pageOf(tiles, current, GALLERY_PAGE_SIZE),
  };
}

/** "155 templates" beside the step's name. */
export function templateCountLabel(count: number): string {
  return count === 1 ? '1 template' : `${count} templates`;
}

/** What a screen reader hears after the count when the list has pages: ", page 2 of 7". */
export function pageAnnouncement(page: number, pageCount: number): string {
  return pageCount > 1 ? `, page ${page} of ${pageCount}` : '';
}

// ---------------------------------------------------------------------------
// The kit the wizard remembers
// ---------------------------------------------------------------------------

const LAST_KIT_KEY = 'postgear.studio.lastKit';

/** One key per workspace: a kit belongs to one, and an id from another would never match. */
export function lastKitKey(orgId: string): string {
  return `${LAST_KIT_KEY}.${orgId}`;
}

/**
 * Where the remembered kit is kept. A function, because merely reading
 * `window.localStorage` throws where storage is blocked; tests pass their own.
 */
export type KitStorage = () => Pick<Storage, 'getItem' | 'setItem'>;

const browserStorage: KitStorage = () => window.localStorage;

/** The kit last used to create a design in this workspace, on this browser. */
export function readLastKit(orgId: string, storage: KitStorage = browserStorage): string | null {
  try {
    const value = storage().getItem(lastKitKey(orgId));
    return value && ID_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Remembers the kit a design was just created with. Skip For Now (no kit)
 * leaves the one remembered before: one quick design without a brand should
 * not make the next one start from nothing.
 */
export function rememberKit(
  orgId: string,
  kitId: string | null,
  storage: KitStorage = browserStorage,
): void {
  if (!kitId || !ID_PATTERN.test(kitId)) return;

  try {
    storage().setItem(lastKitKey(orgId), kitId);
  } catch {
    // Private browsing or storage turned off: the kit is simply not remembered.
  }
}

/**
 * The kit the brand step starts on: the one in the URL, else the one last
 * used here, whichever the workspace still has (a deleted kit is never
 * offered). Nothing while the kits are still loading.
 */
export function preselectedKit<Kit extends { id: string }>(
  kits: readonly Kit[] | null,
  chosenId: string | null,
  lastId: string | null,
): { kit: Kit; remembered: boolean } | null {
  if (!kits) return null;

  const chosen = chosenId ? kits.find((kit) => kit.id === chosenId) : undefined;
  if (chosen) return { kit: chosen, remembered: false };

  const last = lastId ? kits.find((kit) => kit.id === lastId) : undefined;
  return last ? { kit: last, remembered: true } : null;
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

/**
 * The editor's save indicator (DS-6.1). `pending` is a change waiting for the
 * debounce; it reads Saving too, because that is what is about to happen.
 * `conflict` (DS-6.2) and `failed` (a save the server refused, which trying
 * again unchanged would not fix) both stop saving until the person chooses.
 */
export type SaveState =
  | 'saved'
  | 'pending'
  | 'saving'
  | 'offline'
  | 'retrying'
  | 'conflict'
  | 'failed';

export function saveLabel(state: SaveState): string {
  switch (state) {
    case 'saved':
      return 'Saved';
    case 'pending':
    case 'saving':
      return 'Saving';
    case 'offline':
      return 'Offline';
    case 'retrying':
      return 'Could not save. Retrying.';
    case 'conflict':
    case 'failed':
      return 'Not saved';
  }
}

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

export const SHARE_DAY_OPTIONS = [1, 3, 7, 14, 30] as const;
export const DEFAULT_SHARE_DAYS = 7;

/** "Expires in 6 days", "Expires in 5 hours", "Expired". */
export function expiryLabel(iso: string, now: Date): string {
  const left = new Date(iso).getTime() - now.getTime();

  if (Number.isNaN(left) || left <= 0) return 'Expired';
  if (left < HOUR) return 'Expires in under an hour';
  if (left < DAY) return `Expires in ${plural(Math.floor(left / HOUR), 'hour')}`;
  return `Expires in ${plural(Math.round(left / DAY), 'day')}`;
}

// ---------------------------------------------------------------------------
// Website extraction review (DS-2.2)
// ---------------------------------------------------------------------------

export type ColorRoleChoice = keyof BrandColors | 'none';

/** One colour on the review screen: what it is, and which role it fills. */
export interface FoundColor {
  id: number;
  /** As typed: the site's hex, or the person's own while it is being typed. */
  hex: string;
  role: ColorRoleChoice;
}

/** At most this many colours are reviewed (the stories' "up to 8"). */
export const MAX_FOUND_COLORS = 8;
/** At most this many logos are offered (the stories' "up to 6"). */
export const MAX_FOUND_LOGOS = 6;

/**
 * The site's colours, strongest first, each with its suggested role. A role
 * goes to the strongest colour that asks for it; a later colour asking for
 * the same role starts unassigned, so no role is filled twice.
 */
export function foundColors(
  candidates: ReadonlyArray<{ hex: string; suggestedRole: keyof BrandColors; weight: number }>,
): FoundColor[] {
  const taken = new Set<keyof BrandColors>();

  return [...candidates]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_FOUND_COLORS)
    .map((candidate, index) => {
      const free = !taken.has(candidate.suggestedRole);
      if (free) taken.add(candidate.suggestedRole);
      return { id: index + 1, hex: candidate.hex, role: free ? candidate.suggestedRole : 'none' };
    });
}

/** Gives `role` to one colour, taking it from whichever colour had it. */
export function assignRole(rows: FoundColor[], id: number, role: ColorRoleChoice): FoundColor[] {
  return rows.map((row) => {
    if (row.id === id) return { ...row, role };
    return role !== 'none' && row.role === role ? { ...row, role: 'none' } : row;
  });
}

/** A colour of the person's own, given the first role nobody holds yet. */
export function addFoundColor(rows: FoundColor[], hex: string): FoundColor[] {
  const held = new Set(rows.map((row) => row.role));
  const role = BRAND_COLOR_KEYS.find((key) => !held.has(key)) ?? 'none';
  const id = rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;

  return [...rows, { id, hex, role }];
}

/** The kit's five colours: each role from the colour that holds it, else `fallback`. */
export function kitColors(
  rows: FoundColor[],
  fallback: Record<keyof BrandColors, string>,
): Record<keyof BrandColors, string> {
  const colors = { ...fallback };

  for (const row of rows) {
    if (row.role !== 'none') colors[row.role] = row.hex;
  }
  return colors;
}

const LOGO_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

/**
 * A logo the review screen found, as a file the logo upload takes. The
 * candidate arrives as a `data:` URI; it is decoded here rather than fetched,
 * so no request is needed for bytes the page already holds.
 */
export function fileFromDataUri(uri: string, baseName: string): File | null {
  const match = /^data:([a-z0-9.+/-]+)(;base64)?,(.*)$/is.exec(uri);
  if (!match) return null;

  const [, mimeType, base64, data] = match;

  try {
    const binary = base64 ? atob(data) : decodeURIComponent(data);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const extension = LOGO_EXTENSIONS[mimeType.toLowerCase()] ?? 'png';
    const name =
      baseName
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || 'Logo';

    return new File([bytes], `${name}.${extension}`, { type: mimeType.toLowerCase() });
  } catch {
    return null;
  }
}

/** A new kit's form: nothing typed yet, the default theme's colours to start from. */
export function newKitDraft(): BrandKitDraft {
  return {
    name: '',
    description: '',
    websiteUrl: '',
    logoMediaId: null,
    colors: { ...brandFromTheme(themeById(DEFAULT_THEME_ID)) },
  };
}

/** The typed colours where they are valid, `fallback`'s where they are not yet. */
export function validColors(
  typed: Record<keyof BrandColors, string>,
  fallback: BrandColors,
): BrandColors {
  const colors = { ...fallback };
  for (const key of BRAND_COLOR_KEYS) colors[key] = hexFromInput(typed[key]) ?? fallback[key];
  return colors;
}

/**
 * What a field holds after an extraction. A found value fills an empty field,
 * and replaces what the last extraction put there if nobody has touched it
 * since; anything the person typed themselves is kept.
 */
export function prefillField(
  current: string,
  found: string | null,
  previous: string | null,
  max: number,
): string {
  const next = found?.trim().slice(0, max) ?? '';
  if (!next) return current;
  return current.trim() === '' || (previous !== null && current === previous) ? next : current;
}

/** The address as a person reads it: "example.com". */
export function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url;
  } catch {
    return url;
  }
}

/** What the review screen says it found, in one sentence. */
export function extractionSummary(extraction: {
  finalUrl: string;
  logos: readonly unknown[];
  colors: readonly unknown[];
}): string {
  const logos = Math.min(extraction.logos.length, MAX_FOUND_LOGOS);
  const colors = Math.min(extraction.colors.length, MAX_FOUND_COLORS);
  const site = siteName(extraction.finalUrl);

  if (logos === 0 && colors === 0) return `We found no logo or colours on ${site}.`;

  const found = [
    logos > 0 ? plural(logos, 'logo') : 'no logo',
    colors > 0 ? plural(colors, 'colour') : 'no colours',
  ];
  return `Found ${found.join(' and ')} on ${site}.`;
}

/**
 * A kit as a design's brand, the way the API copies it in when a design is
 * created, so a gallery thumbnail is the design the user is about to get. A
 * logo deleted from the library is left out rather than drawn broken.
 */
export function brandFromKitView(kit: BrandKitView): DesignBrand {
  const heading = kit.headingFont ?? null;
  const body = kit.bodyFont ?? null;

  return {
    kitId: kit.id,
    colors: { ...kit.colors },
    logoMediaId: kit.logoUrl ? kit.logoMediaId : null,
    name: kit.name,
    kitVersion: kit.updatedAt,
    // Its faces too (Sprint 9b). A kit that sets neither leaves the design
    // on its theme's, as the API's own `kitFonts` does.
    fonts: heading || body ? { heading, body } : null,
  };
}

/** Finds a kit's logo for the renderer; every other picture is the template's own. */
export function kitLogoResolver(kit: BrandKitView | null): (mediaId: string) => string | null {
  return (mediaId) => (kit?.logoUrl && mediaId === kit.logoMediaId ? kit.logoUrl : null);
}
