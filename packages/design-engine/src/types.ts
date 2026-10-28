/**
 * The vocabulary of a design: what a template is made of, and what a user's
 * own copy of one stores.
 *
 * Two things live here and they are deliberately different shapes:
 *
 * - **`SlideLayout`, `Theme`, `Preset`**: the template library. Data in code,
 *   versioned with git, never in the database. A user cannot edit any of it,
 *   so "choosing a template never changes the template" is true by
 *   construction rather than by a rule somebody has to remember.
 * - **`DesignDocument`**: the user's copy. Text, colours, pictures and small
 *   nudges, and nothing else: no CSS, no free coordinates, no element the
 *   layout did not offer. The Zod schema in `schema.ts` is what refuses the
 *   rest, and the API parses every write through it.
 *
 * **Coordinates are percentages, never pixels.** A region or a slot is a
 * rectangle in 0-100 of the *content box* (the canvas minus the format's safe
 * area), so one layout definition serves all four formats and the editor can
 * draw the canvas at whatever size fits the screen. Only `render/` turns a
 * percentage into a pixel, and it does that identically in the browser and at
 * export, which is what makes the preview honest.
 *
 * The id lists (`COLOR_ROLES`, `SLOT_IDS`, `LOGO_PLACEMENTS`) are built
 * from a `Record` over the union, so leaving a member out is a compile error
 * rather than a schema that quietly refuses a value the types allow.
 */

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

export type FormatId = 'square' | 'portrait' | 'story' | 'landscape';

export interface FormatSpec {
  id: FormatId;
  /** Title Case, as the wizard's cards show it. */
  label: string;
  /** "1:1", shown next to the label. */
  ratio: string;
  width: number;
  height: number;
  /**
   * Where it fits, as the hover hint reads it. Guidance only: what a platform
   * actually accepts is decided by the composer's own rules at Send time.
   */
  hint: string;
  /**
   * The margin the content box keeps from the canvas edge, as a percentage of
   * each axis. A story is tall, so an equal percentage on both axes would
   * leave a thin side margin and a huge top one; each format states its own.
   */
  safeArea: { x: number; y: number };
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/**
 * Every colour a slide can name. A design never stores "#1A2B3C" for text: it
 * stores a role, and the theme (or the brand kit applied over it) decides the
 * hex. That is what lets Theme and Apply A Brand Kit recolour a whole design
 * in one step, and what lets the contrast guard reason about a pairing.
 *
 * A custom hex is still possible (`background.kind === 'color'` and an
 * element's own `color`), but it is the exception the panel puts one click
 * deeper, not the normal way to colour something.
 */
export type ColorRole =
  /** The slide's ground. */
  | 'background'
  /** A panel or card drawn on the ground. */
  | 'surface'
  /** The brand's main colour: bars, numbers, the cover's block. */
  | 'primary'
  /** The brand's support colour. */
  | 'secondary'
  /** The brand's highlight: one thing per slide, not a second primary. */
  | 'accent'
  /** Default ink on `background`. */
  | 'text'
  /** Ink for a second line: a caption, a handle, a slide number. */
  | 'textMuted'
  /** Ink that reads on `primary`. Derived, never taken from the brand kit. */
  | 'onPrimary'
  /** Ink that reads on `accent`. Derived. */
  | 'onAccent'
  /** Ink that reads on `surface`. Derived. */
  | 'onSurface';

const COLOR_ROLE_TABLE: Record<ColorRole, true> = {
  background: true,
  surface: true,
  primary: true,
  secondary: true,
  accent: true,
  text: true,
  textMuted: true,
  onPrimary: true,
  onAccent: true,
  onSurface: true,
};

export const COLOR_ROLES = Object.keys(COLOR_ROLE_TABLE) as [ColorRole, ...ColorRole[]];

export type Palette = Record<ColorRole, string>;

/** The five colours a brand kit holds. The other roles are derived from them. */
export interface BrandColors {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
}

export const BRAND_COLOR_KEYS: readonly (keyof BrandColors)[] = [
  'primary',
  'secondary',
  'accent',
  'background',
  'text',
];

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

export type FontId =
  | 'sora'
  | 'inter'
  | 'poppins'
  | 'space-grotesk'
  | 'archivo-black'
  | 'dm-serif-display'
  | 'playfair-display'
  | 'jetbrains-mono';

/**
 * What a slot's text is *for*. The theme turns a role into a family, weight,
 * size and spacing; a layout never names a font or a pixel size, so swapping
 * the theme restyles every slide without touching a single slot.
 */
export type TypeRole =
  | 'eyebrow'
  | 'headline'
  | 'subheadline'
  | 'body'
  | 'list'
  | 'quote'
  | 'attribution'
  | 'stat'
  | 'statLabel'
  | 'footer'
  | 'brandName'
  | 'cta'
  | 'pageNumber';

export interface TypeStyle {
  font: FontId;
  weight: number;
  /**
   * Size as a percentage of the canvas's *short* edge, so text keeps its
   * proportion in every format rather than growing with a 9:16's height.
   */
  size: number;
  lineHeight: number;
  /** em, as CSS letter-spacing. */
  tracking: number;
  uppercase?: boolean;
  italic?: boolean;
}

/** The three size steps the panel offers on a headline, as multipliers. */
export type SizeStep = 'sm' | 'md' | 'lg';
export const SIZE_STEPS: Record<SizeStep, number> = { sm: 0.82, md: 1, lg: 1.22 };

export type Align = 'start' | 'center' | 'end';

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

/** A slide's job in a carousel. Add Slide groups its choices by this. */
export type SlideRole = 'cover' | 'content' | 'list' | 'quote' | 'statistic' | 'closing';

/**
 * The areas of a slide. An element belongs to exactly one and can never leave
 * it, which is the whole guardrail: a user nudges inside an area, they do not
 * rearrange the slide.
 */
export type RegionId = 'header' | 'body' | 'footer' | 'media' | 'aside';

/** What the editor calls a region while an element is dragged inside it. */
export const REGION_LABELS: Record<RegionId, string> = {
  header: 'Header',
  body: 'Body',
  footer: 'Footer',
  media: 'Picture',
  aside: 'Panel',
};

/** A rectangle in percentages of whatever box it is relative to. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RegionDef {
  id: RegionId;
  /** Percentages of the content box. */
  area: Rect;
  /** Formats whose proportions need a different rectangle. */
  byFormat?: Partial<Record<FormatId, Rect>>;
  /**
   * The name the editor shows while dragging, when the generic one would
   * mislead: a side column that a tall format stacks underneath is not a
   * "side" any more, and a picture column is a picture.
   */
  label?: string;
}

export type SlotKind = 'text' | 'list' | 'image' | 'logo';

/** What a list draws in front of each item. The layout decides, not the user. */
export type ListMarker = 'number' | 'tick' | 'dot' | 'rule' | 'none';

/**
 * Every slot id a layout may use. Fixed because the Zod schema has to refuse
 * an unknown one: an open record would let a client store whatever it liked
 * under a name the renderer would then try to draw.
 */
export type SlotId =
  | 'eyebrow'
  | 'headline'
  | 'subheadline'
  | 'body'
  | 'list'
  | 'quote'
  | 'attribution'
  | 'stat'
  | 'statLabel'
  | 'cta'
  | 'footer'
  | 'brandName'
  | 'handle'
  | 'pageNumber'
  | 'logo'
  | 'image';

const SLOT_ID_TABLE: Record<SlotId, true> = {
  eyebrow: true,
  headline: true,
  subheadline: true,
  body: true,
  list: true,
  quote: true,
  attribution: true,
  stat: true,
  statLabel: true,
  cta: true,
  footer: true,
  brandName: true,
  handle: true,
  pageNumber: true,
  logo: true,
  image: true,
};

export const SLOT_IDS = Object.keys(SLOT_ID_TABLE) as [SlotId, ...SlotId[]];

/** Where a template allows its logo to sit. */
export type LogoPlacement = 'header' | 'footer' | 'centre';

/** Key order is the order the panel offers placements in, whichever a layout supports. */
const LOGO_PLACEMENT_TABLE: Record<LogoPlacement, true> = {
  header: true,
  centre: true,
  footer: true,
};

export const LOGO_PLACEMENTS = Object.keys(LOGO_PLACEMENT_TABLE) as [
  LogoPlacement,
  ...LogoPlacement[],
];

/**
 * One place a logo can sit: a region and a box inside it, chosen by the
 * layout's author so that nothing else on the slide is underneath. Moving a
 * logo is picking one of these, never dropping it on top of the headline.
 */
export interface LogoSpot {
  region: RegionId;
  box: Rect;
  align: Align;
}

/**
 * Text a slot shows that is not the slide's own.
 *
 * - `brandName` and `handle` are the design's: typed once and the same on
 *   every slide, because a carousel whose handle differs on slide four is a
 *   mistake, not a choice.
 * - `slideNumber` is counted, never typed, so it is right after every add,
 *   delete and reorder (DS-5: "Slide numbers update at once").
 *
 * A bound slot never stores text of its own; the schema refuses it.
 */
export type SlotBinding = 'brandName' | 'handle' | 'slideNumber';

export interface SlotDef {
  id: SlotId;
  kind: SlotKind;
  region: RegionId;
  /** Sentence-case name for the properties panel ("Headline", "Logo"). */
  label: string;
  /** Percentages of the region's rectangle. */
  box: Rect;
  /** Text slots only. */
  type?: TypeRole;
  align?: Align;
  /** Vertical placement inside the box, for text shorter than its box. */
  valign?: Align;
  colorRole?: ColorRole;
  /** The user may hide it. A slot without this is part of the layout. */
  optional?: boolean;
  /** Starts hidden; the panel offers it under Show. */
  defaultHidden?: boolean;
  /** The panel offers S, M, L. */
  resizable?: boolean;
  /** The panel offers left, centre, right. */
  alignable?: boolean;
  /** The panel offers a colour. Almost every text slot; a few are fixed. */
  colorable?: boolean;
  /** Text slots whose words come from the design, not the slide. */
  bind?: SlotBinding;
  /**
   * Logo slots: every placement the template offers, the first entry of
   * `LOGO_PLACEMENTS` order being only a display order. `region` and `box`
   * above are the spot the logo starts in.
   */
  spots?: Partial<Record<LogoPlacement, LogoSpot>>;
  /** Logo slots: the placement `region` and `box` describe. */
  placement?: LogoPlacement;
  /** The character count the panel hints at. Not a limit: `fit.ts` is. */
  recommendedChars?: number;
  /** List slots. */
  maxItems?: number;
  /** List slots: what sits in front of each item. */
  marker?: ListMarker;
  /** Images: how the picture fills its box. */
  fit?: 'cover' | 'contain';
  /** Images: corner rounding as a percentage of the box's short edge. */
  radius?: number;
}

export interface SlideLayout {
  /** Stable, with its version: "split-headline@1". Stored on every slide. */
  id: string;
  version: number;
  /** Title Case, as Add Slide shows it. */
  name: string;
  role: SlideRole;
  /** Formats this layout draws well in. Normally all four. */
  formats: FormatId[];
  regions: RegionDef[];
  slots: SlotDef[];
  /** The default background for a slide on this layout. */
  background: SlideBackground;
  /** A painted shape the layout draws under its slots. */
  decor?: DecorDef[];
}

/**
 * Flat blocks and rules a layout paints. Not editable: part of the design.
 *
 * **A block is a ground.** Text drawn on it reads against the block, not the
 * slide, so a block must cover every region it touches completely, in every
 * format; `layouts.test.ts` fails a layout whose region straddles a block's
 * edge. Without that rule a nudge could carry white-on-colour text off the
 * colour and onto white.
 */
export interface DecorDef {
  kind: 'block' | 'rule';
  /**
   * Percentages of `region` when one is named, of the whole canvas otherwise.
   * A panel behind a side column has to follow that column when a tall format
   * stacks it, so it names the region; a band across the slide does not.
   */
  region?: RegionId;
  box: Rect;
  colorRole: ColorRole;
  /** 0-1. A block at 0.12 is a tint, at 1 a solid panel. */
  opacity?: number;
  /** Corner rounding as a percentage of the canvas's short edge. */
  radius?: number;
}

// ---------------------------------------------------------------------------
// Themes and presets
// ---------------------------------------------------------------------------

export type ThemeStyle = 'light' | 'dark' | 'colourful';

export interface Theme {
  id: string;
  name: string;
  style: ThemeStyle;
  colors: Palette;
  type: Record<TypeRole, TypeStyle>;
}

export type PresetCategory =
  | 'tips'
  | 'educational'
  | 'announcement'
  | 'product'
  | 'quote'
  | 'listicle'
  | 'statistic'
  | 'case-study'
  | 'promotion'
  | 'story'
  | 'event'
  | 'hiring';

export const PRESET_CATEGORIES: readonly PresetCategory[] = [
  'tips',
  'educational',
  'announcement',
  'product',
  'quote',
  'listicle',
  'statistic',
  'case-study',
  'promotion',
  'story',
  'event',
  'hiring',
];

export const CATEGORY_LABELS: Record<PresetCategory, string> = {
  tips: 'Tips',
  educational: 'Educational',
  announcement: 'Announcement',
  product: 'Product',
  quote: 'Quote',
  listicle: 'Listicle',
  statistic: 'Statistic',
  'case-study': 'Case Study',
  promotion: 'Promotion',
  story: 'Story',
  event: 'Event',
  hiring: 'Hiring',
};

/** The sample content a preset's slide carries before the user types. */
export interface PresetSlide {
  layoutId: string;
  text?: Partial<Record<SlotId, string>>;
  items?: Partial<Record<SlotId, string[]>>;
  /** Slots the preset starts with hidden, over the layout's own default. */
  hidden?: SlotId[];
}

export interface Preset {
  id: string;
  /** Title Case; also the title a new design is given. */
  name: string;
  category: PresetCategory;
  themeId: string;
  /** Words the gallery search matches besides the name. */
  tags: string[];
  slides: PresetSlide[];
}

// ---------------------------------------------------------------------------
// The stored document
// ---------------------------------------------------------------------------

export type SlideBackground =
  | { kind: 'role'; role: ColorRole }
  | { kind: 'color'; hex: string }
  | { kind: 'media'; mediaId: string; overlay: number };

export interface ElementState {
  /** Text slots. Plain text; a newline is allowed, markup is not. */
  text?: string;
  /** List slots. */
  items?: string[];
  /** Image and logo slots. Absent means "the brand kit's logo" on a logo slot. */
  mediaId?: string | null;
  hidden?: boolean;
  /**
   * The nudge, in percentages of the slot's *region*, clamped so the slot's
   * box stays inside it. Absent means the layout's own position.
   */
  offset?: { x: number; y: number };
  size?: SizeStep;
  align?: Align;
  colorRole?: ColorRole;
  /** A colour of the user's own, when a role will not do. `#RRGGBB`. */
  color?: string;
  /** Logo slots only. */
  placement?: LogoPlacement;
}

export interface DesignSlide {
  /** Client generated, stable for the life of the slide. */
  id: string;
  layoutId: string;
  background: SlideBackground;
  elements: Partial<Record<SlotId, ElementState>>;
  /**
   * The preset slide this one was made from, by its index in the preset.
   * Reset Slide restores *that* slide, wherever this one has since moved;
   * absent on a slide added in the editor, which resets to its layout.
   */
  origin?: number;
}

export interface DesignBrand {
  kitId: string | null;
  colors: BrandColors | null;
  logoMediaId: string | null;
  /**
   * The brand's name as the design shows it in a brand-name slot: the kit's
   * name when one is applied, or whatever the user typed.
   */
  name: string | null;
  /**
   * The kit's `updatedAt` when these colours were copied in. The editor
   * compares it with the kit's current one to offer Update Colours, and never
   * changes a design's colours on its own.
   */
  kitVersion: string | null;
}

/** The current schema. Bump with every shape change, and extend `upgrade()`. */
export const DESIGN_SCHEMA_VERSION = 1;

export interface DesignDocument {
  schemaVersion: number;
  format: FormatId;
  presetId: string;
  themeId: string;
  brand: DesignBrand;
  /** The social handle every handle slot shows, typed once. */
  handle: string;
  /** Written in Preview and carried into the composer on Send. */
  caption: string;
  slides: DesignSlide[];
}

export const MAX_SLIDES = 20;
export const MAX_LIST_ITEMS = 8;
export const MAX_TEXT_LENGTH = 600;
export const MAX_CAPTION_LENGTH = 3_000;
export const MAX_HANDLE_LENGTH = 60;
export const MAX_BRAND_NAME_LENGTH = 120;
