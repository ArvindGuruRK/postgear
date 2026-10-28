/**
 * Pieces every layout is built from.
 *
 * A layout is a list of regions (rectangles of the content box) and a list of
 * slots (rectangles of a region). Writing both out by hand for fifteen
 * layouts and four formats would be a wall of numbers nobody could review, so
 * the common shapes are here: the three-row frame almost every slide uses,
 * the splits that turn from side-by-side into stacked on a tall canvas, and
 * the slot constructors.
 *
 * The grouping is by slide role rather than one file per layout, deliberately:
 * the layouts in a group share a frame and are read against each other, which
 * is how a reviewer notices that two "list" layouts drifted apart.
 *
 * `layouts.test.ts` checks the rules these helpers are meant to keep (slots
 * inside their regions, no two slots on top of each other, a painted block
 * covering a region completely or not at all), so a layout written without
 * them is still held to them.
 */
import { FORMAT_IDS, nest } from '../formats';
import type {
  Align,
  ColorRole,
  DecorDef,
  ListMarker,
  LogoPlacement,
  LogoSpot,
  Rect,
  RegionDef,
  RegionId,
  SlideBackground,
  SlideLayout,
  SlideRole,
  SlotBinding,
  SlotDef,
  SlotId,
  TypeRole,
} from '../types';

export function rect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, w, h };
}

/** The whole of whatever box a rectangle is relative to. */
export const FULL: Rect = { x: 0, y: 0, w: 100, h: 100 };

export interface RowOptions {
  /** Percentages of the content box's height. */
  header?: number;
  footer?: number;
  /** The space between the header and the body. */
  gapTop?: number;
  /** The space between the body and the footer. */
  gapBottom?: number;
}

/**
 * The frame nearly every slide uses: a thin header, the body, a thin footer.
 *
 * The heights are percentages of the content box and add up with the gaps
 * between them. A story has a much taller content box than a landscape, so
 * the same percentages give the story a roomier body in pixels, which is what
 * a 9:16 wants.
 */
export function threeRows(options: RowOptions = {}): [RegionDef, RegionDef, RegionDef] {
  const header = options.header ?? 14;
  const footer = options.footer ?? 9;
  const bodyTop = header + (options.gapTop ?? 6);
  const bodyHeight = 100 - bodyTop - footer - (options.gapBottom ?? 5);

  return [
    { id: 'header', area: rect(0, 0, 100, header) },
    { id: 'body', area: rect(0, bodyTop, 100, bodyHeight) },
    { id: 'footer', area: rect(0, 100 - footer, 100, footer) },
  ];
}

/**
 * A body split into text and something else (a picture, a panel, a second
 * point), as the `body` and `aside` regions.
 *
 * Side by side in a square or a landscape, stacked in a portrait or a story:
 * a 9:16 has no room for two columns, and a layout that only looked right in
 * one format would not be one layout.
 */
export function splitBody(options: {
  /** How much of the width the text takes in the wide formats. */
  textWidth?: number;
  /** How much of the height the text takes in the tall formats. */
  textHeight?: number;
  /** Puts the second region first: left in the wide formats, on top in the tall ones. */
  asideFirst?: boolean;
  /** What the editor calls the second region while something is dragged in it. */
  asideLabel: string;
}): RegionDef[] {
  const textWidth = options.textWidth ?? 52;
  const textHeight = options.textHeight ?? 46;
  const gapX = 5;
  const gapY = 4;
  const asideWidth = 100 - textWidth - gapX;
  const asideHeight = 100 - textHeight - gapY;

  const bodyWide = options.asideFirst
    ? rect(asideWidth + gapX, 0, textWidth, 100)
    : rect(0, 0, textWidth, 100);
  const asideWide = options.asideFirst
    ? rect(0, 0, asideWidth, 100)
    : rect(textWidth + gapX, 0, asideWidth, 100);

  const bodyTall = options.asideFirst
    ? rect(0, asideHeight + gapY, 100, textHeight)
    : rect(0, 0, 100, textHeight);
  const asideTall = options.asideFirst
    ? rect(0, 0, 100, asideHeight)
    : rect(0, textHeight + gapY, 100, asideHeight);

  const [header, body, footer] = threeRows();

  return [
    header,
    {
      id: 'body',
      area: nest(body.area, bodyWide),
      byFormat: {
        portrait: nest(body.area, bodyTall),
        story: nest(body.area, bodyTall),
      },
    },
    {
      id: 'aside',
      label: options.asideLabel,
      area: nest(body.area, asideWide),
      byFormat: {
        portrait: nest(body.area, asideTall),
        story: nest(body.area, asideTall),
      },
    },
    footer,
  ];
}

/**
 * A body split into a band on top and a panel under it, in every format: a
 * headline over a block of steps. The panel is its own region so that a
 * painted panel behind it covers everything that can move inside it, and
 * nothing that can move outside it.
 */
export function bandAndPanel(options: {
  /** How much of the body's height the top band takes. */
  bandHeight: number;
  /** What the editor calls the panel while something is dragged in it. */
  panelLabel: string;
}): RegionDef[] {
  const gap = 6;
  const [header, body, footer] = threeRows();

  return [
    header,
    { id: 'body', area: nest(body.area, rect(0, 0, 100, options.bandHeight)) },
    {
      id: 'aside',
      label: options.panelLabel,
      area: nest(body.area, rect(0, options.bandHeight + gap, 100, 100 - options.bandHeight - gap)),
    },
    footer,
  ];
}

// ---------------------------------------------------------------------------
// Slot constructors
// ---------------------------------------------------------------------------

interface TextOptions {
  box: Rect;
  region?: RegionId;
  label?: string;
  align?: Align;
  valign?: Align;
  colorRole?: ColorRole;
  optional?: boolean;
  defaultHidden?: boolean;
  resizable?: boolean;
  alignable?: boolean;
  colorable?: boolean;
  recommendedChars?: number;
  bind?: SlotBinding;
}

/** The names the properties panel shows. Title Case: they name an element. */
const DEFAULT_LABELS: Record<SlotId, string> = {
  eyebrow: 'Eyebrow',
  headline: 'Headline',
  subheadline: 'Subheadline',
  body: 'Body',
  list: 'List',
  quote: 'Quote',
  attribution: 'Attribution',
  stat: 'Number',
  statLabel: 'Number Label',
  cta: 'Call To Action',
  footer: 'Footer',
  brandName: 'Brand Name',
  handle: 'Handle',
  pageNumber: 'Slide Number',
  logo: 'Logo',
  image: 'Picture',
};

/** A text slot. */
export function text(id: SlotId, type: TypeRole, options: TextOptions): SlotDef {
  return {
    id,
    kind: 'text',
    region: options.region ?? 'body',
    label: options.label ?? DEFAULT_LABELS[id],
    box: options.box,
    type,
    align: options.align ?? 'start',
    valign: options.valign ?? 'start',
    colorRole: options.colorRole ?? 'text',
    optional: options.optional ?? false,
    defaultHidden: options.defaultHidden ?? false,
    resizable: options.resizable ?? false,
    alignable: options.alignable ?? true,
    colorable: options.colorable ?? true,
    recommendedChars: options.recommendedChars,
    bind: options.bind,
  };
}

export function list(
  options: Omit<TextOptions, 'bind'> & {
    maxItems?: number;
    type?: TypeRole;
    marker?: ListMarker;
  },
): SlotDef {
  const marker = options.marker ?? 'dot';

  return {
    ...text('list', options.type ?? 'list', {
      ...options,
      // A centred line with its number or tick still at the left edge looks
      // broken, so only a list without a marker column offers alignment.
      alignable: options.alignable ?? (marker === 'rule' || marker === 'none'),
    }),
    kind: 'list',
    maxItems: options.maxItems ?? 6,
    marker,
  };
}

export function image(options: {
  box: Rect;
  region?: RegionId;
  label?: string;
  optional?: boolean;
  fit?: 'cover' | 'contain';
  radius?: number;
}): SlotDef {
  return {
    id: 'image',
    kind: 'image',
    region: options.region ?? 'media',
    label: options.label ?? DEFAULT_LABELS.image,
    box: options.box,
    optional: options.optional ?? false,
    alignable: false,
    colorable: false,
    resizable: false,
    fit: options.fit ?? 'cover',
    radius: options.radius ?? 0,
  };
}

/**
 * The logo, with every place the template lets it sit.
 *
 * `region` and `box` are copied from the spot it starts in, so code that only
 * knows about ordinary slots still finds it where it is drawn. A spot that
 * names a placement the layout does not have is an authoring mistake, and it
 * fails loudly at load rather than drawing a logo in the wrong place.
 */
export function logo(options: {
  spots: Partial<Record<LogoPlacement, LogoSpot>>;
  placement: LogoPlacement;
  optional?: boolean;
}): SlotDef {
  const spot = options.spots[options.placement];

  if (!spot) {
    throw new Error(`A logo cannot start in "${options.placement}": the layout has no such spot.`);
  }

  return {
    id: 'logo',
    kind: 'logo',
    region: spot.region,
    label: DEFAULT_LABELS.logo,
    box: spot.box,
    align: spot.align,
    optional: options.optional ?? true,
    alignable: false,
    colorable: false,
    resizable: false,
    spots: options.spots,
    placement: options.placement,
  };
}

// ---------------------------------------------------------------------------
// The shared frame
// ---------------------------------------------------------------------------

/**
 * The header logo sits at the right end of the header and the footer one in
 * the middle of the footer, so each spot is free space in the other frame:
 * moving the logo, or hiding it, never leaves a hole in the middle of a line
 * of text.
 */
export const HEADER_LOGO: LogoSpot = { region: 'header', box: rect(76, 0, 24, 100), align: 'end' };
export const FOOTER_LOGO: LogoSpot = {
  region: 'footer',
  box: rect(42, 0, 16, 100),
  align: 'center',
};

/** The logo of the shared frame: header or footer. */
export function frameLogo(): SlotDef {
  return logo({ spots: { header: HEADER_LOGO, footer: FOOTER_LOGO }, placement: 'header' });
}

/** The header every framed layout shares: the brand's name, leaving room for the logo. */
export function standardHeader(options: { colorRole?: ColorRole } = {}): SlotDef[] {
  return [
    text('brandName', 'brandName', {
      region: 'header',
      box: rect(0, 0, 72, 100),
      valign: 'center',
      colorRole: options.colorRole ?? 'text',
      optional: true,
      alignable: false,
      recommendedChars: 28,
      bind: 'brandName',
    }),
  ];
}

/** The footer every framed layout shares: the handle on the left, the slide number on the right. */
export function standardFooter(options: { colorRole?: ColorRole } = {}): SlotDef[] {
  const colorRole = options.colorRole ?? 'textMuted';

  return [
    text('handle', 'footer', {
      region: 'footer',
      box: rect(0, 0, 40, 100),
      valign: 'center',
      colorRole,
      optional: true,
      alignable: false,
      recommendedChars: 24,
      bind: 'handle',
    }),
    text('pageNumber', 'pageNumber', {
      region: 'footer',
      box: rect(80, 0, 20, 100),
      align: 'end',
      valign: 'center',
      colorRole,
      optional: true,
      alignable: false,
      recommendedChars: 5,
      bind: 'slideNumber',
    }),
  ];
}

// ---------------------------------------------------------------------------
// The layout itself
// ---------------------------------------------------------------------------

export function layout(definition: {
  id: string;
  name: string;
  role: SlideRole;
  regions: RegionDef[];
  slots: SlotDef[];
  background?: SlideBackground;
  decor?: DecorDef[];
  formats?: SlideLayout['formats'];
  version?: number;
}): SlideLayout {
  return {
    id: definition.id,
    version: definition.version ?? 1,
    name: definition.name,
    role: definition.role,
    formats: definition.formats ?? [...FORMAT_IDS],
    regions: definition.regions,
    slots: definition.slots,
    background: definition.background ?? { kind: 'role', role: 'background' },
    decor: definition.decor,
  };
}
