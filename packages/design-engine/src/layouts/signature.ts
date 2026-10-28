/**
 * The Signature family: CarouselClick's stacked layout, on its own geometry.
 *
 * CarouselClick (the post builder these looks are ported from) draws every
 * slide in one frame of four bands, stacked: a header with a short eyebrow at
 * its foot, a title band holding one big line, a body band of supporting
 * text, and a footer band that opens with a short accent rule. Its slide
 * types only change which words go in which band (`ELEMENT_BLOCKS` in its
 * `src/features/editor/project.ts`): a statistic is the title band holding a
 * number, a quote is the title band holding the quote, a closing slide is the
 * footer band holding the call to action. The six layouts here are that frame
 * with PostGear's slots in it, so a carousel built from them reads as one set.
 *
 * ## The regions
 *
 * CarouselClick states its bands as fractions of the slide (`REGIONS` in its
 * `src/features/editor/layout.ts`; portrait 4:5 is its `STACKED` set, and its
 * 1600 x 900 landscape is the same shape as ours). PostGear states a region
 * as a percentage of the content box, the slide minus the format's safe area,
 * so each band is converted with
 *
 *     (slide% - safe%) / (100 - 2 x safe%) x 100
 *
 * and clamped into 0-100. The clamp only bites where a band reaches past
 * PostGear's safe area: half a percent at the sides of the stacked formats,
 * the top of the square and portrait headers, the foot of the square footer.
 * The result, as x, y, w, h of the content box:
 *
 *     band     square                 portrait               story                  landscape
 *     header   0, 0, 100, 15.476      0, 0, 100, 14.943      0, 1.22, 100, 14.634   0, 0, 45.455, 23.81
 *     title    0, 16.667, 100, 35.714 0, 15.517, 100, 28.736 0, 18.293, 100, 29.268 0, 26.19, 45.455, 71.429
 *     body     0, 53.571, 100, 23.81  0, 45.402, 100, 21.839 0, 50, 100, 19.512     53.409, 4.762, 46.591, 59.524
 *     footer   0, 79.762, 100, 20.238 0, 68.966, 100, 29.885 0, 71.951, 100, 19.512 53.409, 69.048, 46.591, 28.571
 *
 * Stacked in square, portrait and story; two columns in landscape, header and
 * title on the left, body and footer on the right, exactly as CarouselClick
 * splits a wide slide.
 *
 * PostGear has no `title` region id, so the bands take ids by what sits in
 * them: header to `header`, title to `body` (where every other layout keeps
 * its headline), body to `aside`, footer to `footer`. The two middle ones are
 * labelled with CarouselClick's own band names, Title and Body, because the
 * generic ones would mislead while dragging: there is no panel here for
 * `aside` to be, and two regions must not both show as "Body".
 *
 * ## The slots
 *
 * Each sits where CarouselClick's `DEFAULT_BOX` puts its element: the eyebrow
 * in the lower 38% of the header, the headline filling the title band, the
 * supporting text filling the body band, the footer line in the lower three
 * quarters of the footer band under the rule. Every text slot starts at the
 * top-left of its box, as CarouselClick's text does.
 *
 * Type roles follow CarouselClick's hierarchy, which the signature themes set
 * to its sizes: the footer line is `cta`, because CarouselClick sets its
 * footer at call-to-action size (56px, weight 820), not as small print.
 * Colour roles follow its palette mapping: the eyebrow, the footer line, the
 * call to action and the accent rule in `primary` (its accent), the headline,
 * the number and the quote in `text`, everything else in `textMuted`.
 *
 * The suggested lengths start from CarouselClick's copy budgets for a stacked
 * slide (`CHARACTER_BUDGETS` in its `server/prompts/carousel.ts`: eyebrow 40,
 * headline 60, supporting text 180, footer 40) and were measured against
 * these boxes in every format and every theme with the headless model
 * `presets.test.ts` uses, so copy written to them fits after the fitter's
 * shrink, landscape's narrow columns included. Where a slot differs from
 * CarouselClick's number, the layout says why.
 */
import { contentBox, FORMAT_IDS, FORMATS } from '../formats';
import type {
  DecorDef,
  FormatId,
  LogoPlacement,
  LogoSpot,
  Rect,
  RegionDef,
  RegionId,
  SlideLayout,
  SlotDef,
} from '../types';
import { FULL, layout, list, logo, rect, text } from './shared';

// ---------------------------------------------------------------------------
// The bands
// ---------------------------------------------------------------------------

type Band = 'header' | 'title' | 'body' | 'footer';

/** CarouselClick's bands, as fractions of the slide. */
const BANDS: Record<FormatId, Record<Band, Rect>> = {
  square: {
    header: { x: 0.075, y: 0.06, w: 0.85, h: 0.15 },
    title: { x: 0.075, y: 0.22, w: 0.85, h: 0.3 },
    body: { x: 0.075, y: 0.53, w: 0.85, h: 0.2 },
    footer: { x: 0.075, y: 0.75, w: 0.85, h: 0.19 },
  },
  portrait: {
    header: { x: 0.075, y: 0.055, w: 0.85, h: 0.14 },
    title: { x: 0.075, y: 0.2, w: 0.85, h: 0.25 },
    body: { x: 0.075, y: 0.46, w: 0.85, h: 0.19 },
    footer: { x: 0.075, y: 0.665, w: 0.85, h: 0.26 },
  },
  // A story keeps clear of the platform's own buttons at the top and the
  // bottom, which is why its footer ends at 84% of the height.
  story: {
    header: { x: 0.075, y: 0.1, w: 0.85, h: 0.12 },
    title: { x: 0.075, y: 0.24, w: 0.85, h: 0.24 },
    body: { x: 0.075, y: 0.5, w: 0.85, h: 0.16 },
    footer: { x: 0.075, y: 0.68, w: 0.85, h: 0.16 },
  },
  landscape: {
    header: { x: 0.06, y: 0.08, w: 0.4, h: 0.2 },
    title: { x: 0.06, y: 0.3, w: 0.4, h: 0.6 },
    body: { x: 0.53, y: 0.12, w: 0.41, h: 0.5 },
    footer: { x: 0.53, y: 0.66, w: 0.41, h: 0.24 },
  },
};

/** Clamped into 0-100 and kept to a thousandth, a small fraction of a pixel. */
function percent(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)) * 1000) / 1000;
}

/** A band, from fractions of the slide to percentages of the content box. */
function bandRect(format: FormatId, band: Band): Rect {
  const box = contentBox(format);
  const fraction = BANDS[format][band];
  const across = (value: number) => percent(((value * 100 - box.x) / box.w) * 100);
  const down = (value: number) => percent(((value * 100 - box.y) / box.h) * 100);

  const left = across(fraction.x);
  const top = down(fraction.y);
  return rect(
    left,
    top,
    across(fraction.x + fraction.w) - left,
    down(fraction.y + fraction.h) - top,
  );
}

/** One band as a region: portrait as its own area, the other three by format. */
function bandRegion(id: RegionId, band: Band, label?: string): RegionDef {
  const byFormat: Partial<Record<FormatId, Rect>> = {};

  for (const format of FORMAT_IDS) {
    if (format !== 'portrait') byFormat[format] = bandRect(format, band);
  }

  const region: RegionDef = { id, area: bandRect('portrait', band), byFormat };
  if (label) region.label = label;
  return region;
}

function regions(): RegionDef[] {
  return [
    bandRegion('header', 'header'),
    bandRegion('body', 'title', 'Title'),
    bandRegion('aside', 'body', 'Body'),
    bandRegion('footer', 'footer'),
  ];
}

// ---------------------------------------------------------------------------
// The logo
// ---------------------------------------------------------------------------

/**
 * CarouselClick's logo box: 190 x 48 units, a unit being a pixel on a 1080px
 * short edge. Every PostGear format has a 1080px short edge, so here a unit
 * is simply a pixel.
 */
const LOGO_UNITS = { w: 190, h: 48 };

/** A band's size in pixels, in one format. */
function bandPixels(format: FormatId, band: Band): { w: number; h: number } {
  const { width, height } = FORMATS[format];
  const box = contentBox(format);
  const area = bandRect(format, band);

  return {
    w: (area.w / 100) * (box.w / 100) * width,
    h: (area.h / 100) * (box.h / 100) * height,
  };
}

/**
 * The logo box as a percentage of its band.
 *
 * A spot states one box for all four formats, while a band's pixel size
 * differs in each, so the box cannot be 190 x 48 everywhere. It is chosen so
 * a wordmark, the shape CarouselClick's box is drawn for, comes out exactly
 * as CarouselClick draws it wherever the band allows:
 *
 * - **Width**: 190 units in the widest band (the three stacked formats, where
 *   both bands are 907px), so the logo is never wider than CarouselClick's.
 *   Landscape's narrower columns draw it about 15% smaller.
 * - **Height**: at least 48 units in every format (the shortest band, the
 *   square's, sets it), so a wordmark is held by its width, not its height.
 *   A squarer mark grows into the spare height of the taller bands, up to
 *   about 79 units in a story header, and a wordmark sits centred in that
 *   height, a few pixels lower than CarouselClick's.
 *
 * Header: 20.944 x 34.188. Footer: 20.944 x 26.144.
 */
function logoBox(band: Band): { w: number; h: number } {
  const sizes = FORMAT_IDS.map((format) => bandPixels(format, band));

  return {
    w: percent(Math.min(...sizes.map((size) => (LOGO_UNITS.w / size.w) * 100))),
    h: percent(Math.max(...sizes.map((size) => (LOGO_UNITS.h / size.h) * 100))),
  };
}

const HEADER_LOGO = logoBox('header');
const FOOTER_LOGO = logoBox('footer');

/**
 * Where CarouselClick puts its logo (`resolveSlide`): the top-left corner of
 * the header; centred on the slide at the top of the header; the bottom-right
 * corner of the footer. The eyebrow sits in the lower 38% of the header,
 * below both header spots, and the footer line stops at 62% of the footer's
 * width, short of the footer spot, so no spot covers a word in any format.
 *
 * A landscape header is the left column, so there the centre spot is centred
 * over that column. CarouselClick centres it on the whole slide, which puts
 * it across the gap between the columns and onto the corner of the body
 * text; that is not a place a PostGear region can hold, nor one it should.
 */
const LOGO_SPOTS: Partial<Record<LogoPlacement, LogoSpot>> = {
  header: {
    region: 'header',
    box: rect(0, 0, HEADER_LOGO.w, HEADER_LOGO.h),
    align: 'start',
  },
  centre: {
    region: 'header',
    box: rect(percent(50 - HEADER_LOGO.w / 2), 0, HEADER_LOGO.w, HEADER_LOGO.h),
    align: 'center',
  },
  footer: {
    region: 'footer',
    box: rect(
      percent(100 - FOOTER_LOGO.w),
      percent(100 - FOOTER_LOGO.h),
      FOOTER_LOGO.w,
      FOOTER_LOGO.h,
    ),
    align: 'end',
  },
};

/** The logo starts in the header, as it does in CarouselClick. */
function signatureLogo(): SlotDef {
  return logo({ spots: LOGO_SPOTS, placement: 'header' });
}

// ---------------------------------------------------------------------------
// The frame's pieces
// ---------------------------------------------------------------------------

/**
 * The accent rule: CarouselClick's pill at the top-left of the footer band,
 * 18% of the band wide and 2% of it tall (7px in a portrait, 4 to 6px in the
 * others). The rounding is more than half its thickness in every format, so
 * CSS draws the ends fully round, as CarouselClick's `border-radius: 999px`
 * does. A rule is not a ground: the text near it is read against the slide.
 */
function accentRule(): DecorDef {
  return {
    kind: 'rule',
    region: 'footer',
    box: rect(0, 0, 18, 2),
    colorRole: 'primary',
    radius: 1,
  };
}

/**
 * The footer line's box: CarouselClick's footer element (the lower three
 * quarters of the band, under the rule), narrowed to 62% of the band's width
 * the way CarouselClick narrows it when the logo is in the footer. Here it is
 * always narrowed: a slot cannot change shape with the logo's placement, and
 * the footer spot has to be free space whether the logo is in it or not.
 */
const FOOTER_TEXT = rect(0, 25, 62, 75);

function eyebrow(): SlotDef {
  return text('eyebrow', 'eyebrow', {
    region: 'header',
    box: rect(0, 62, 100, 38),
    colorRole: 'primary',
    optional: true,
    recommendedChars: 40,
  });
}

/** The supporting text: the body band, whatever the slot is called. */
function supporting(id: 'subheadline' | 'body', options: { optional: boolean }): SlotDef {
  return text(id, 'subheadline', {
    region: 'aside',
    box: FULL,
    colorRole: 'textMuted',
    optional: options.optional,
    recommendedChars: 180,
  });
}

/**
 * The footer line, the slide's own words (a takeaway, a source, "Swipe"), not
 * the design's handle. Not alignable: centred or set right inside a box that
 * stops at 62% of the band, it would sit off-centre on the slide.
 */
function footer(): SlotDef {
  return text('footer', 'cta', {
    region: 'footer',
    box: FOOTER_TEXT,
    colorRole: 'primary',
    optional: true,
    alignable: false,
    recommendedChars: 40,
  });
}

/**
 * The slide number, hidden until asked for: CarouselClick has none. It takes
 * the header's top-right corner, on the logo's line and clear of both header
 * spots (the centre one ends at 60.5% of the header's width) and of the
 * eyebrow below.
 */
function pageNumber(): SlotDef {
  return text('pageNumber', 'pageNumber', {
    region: 'header',
    box: rect(84, 0, 16, HEADER_LOGO.h),
    align: 'end',
    valign: 'center',
    colorRole: 'textMuted',
    optional: true,
    defaultHidden: true,
    alignable: false,
    recommendedChars: 5,
    bind: 'slideNumber',
  });
}

// ---------------------------------------------------------------------------
// The layouts
// ---------------------------------------------------------------------------

export const SIGNATURE_LAYOUTS: SlideLayout[] = [
  layout({
    id: 'signature-cover',
    name: 'Signature Cover',
    role: 'cover',
    regions: regions(),
    decor: [accentRule()],
    slots: [
      signatureLogo(),
      eyebrow(),
      text('headline', 'headline', { box: FULL, resizable: true, recommendedChars: 60 }),
      supporting('subheadline', { optional: true }),
      footer(),
      pageNumber(),
    ],
  }),

  layout({
    id: 'signature-content',
    name: 'Signature Point',
    role: 'content',
    regions: regions(),
    decor: [accentRule()],
    slots: [
      signatureLogo(),
      eyebrow(),
      text('headline', 'headline', { box: FULL, resizable: true, recommendedChars: 60 }),
      supporting('body', { optional: false }),
      footer(),
      pageNumber(),
    ],
  }),

  layout({
    id: 'signature-list',
    name: 'Signature List',
    role: 'list',
    regions: regions(),
    decor: [accentRule()],
    // CarouselClick sets its steps and checklists as the supporting text,
    // numbered, in the body band, and allows five items of 60 characters on
    // a stacked slide. Its fitter shrinks text to 40%; PostGear's stops at
    // 62%, and at that floor the square's body band (216px) holds four
    // one-line items at the signature size, never five. So four, of about
    // 48 characters, which fit every format in every theme.
    slots: [
      signatureLogo(),
      text('headline', 'headline', { box: FULL, resizable: true, recommendedChars: 60 }),
      list({
        region: 'aside',
        box: FULL,
        marker: 'number',
        maxItems: 4,
        colorRole: 'textMuted',
        recommendedChars: 48,
      }),
      footer(),
      pageNumber(),
    ],
  }),

  layout({
    id: 'signature-stat',
    name: 'Signature Number',
    role: 'statistic',
    regions: regions(),
    decor: [accentRule()],
    // The number takes the title band, where CarouselClick sets it at its
    // largest size; the sentence that explains it takes the body band.
    slots: [
      signatureLogo(),
      eyebrow(),
      text('stat', 'stat', { box: FULL, resizable: true, recommendedChars: 8 }),
      text('statLabel', 'statLabel', {
        region: 'aside',
        box: FULL,
        colorRole: 'textMuted',
        recommendedChars: 120,
      }),
      footer(),
      pageNumber(),
    ],
  }),

  layout({
    id: 'signature-quote',
    name: 'Signature Quote',
    role: 'quote',
    regions: regions(),
    decor: [accentRule()],
    // The quote takes the title band, where CarouselClick sets it as its
    // headline, and who said it the body band under it, so the footer is
    // free for a line of its own. About 80 characters rather than
    // CarouselClick's 60: the signature themes set a quote a size below the
    // headline so a real testimonial fits, and 80 still draws at full size
    // in every format.
    slots: [
      signatureLogo(),
      text('quote', 'quote', { box: FULL, resizable: true, recommendedChars: 80 }),
      text('attribution', 'attribution', {
        region: 'aside',
        box: FULL,
        colorRole: 'textMuted',
        optional: true,
        recommendedChars: 40,
      }),
      footer(),
      pageNumber(),
    ],
  }),

  layout({
    id: 'signature-closing',
    name: 'Signature Closing',
    role: 'closing',
    regions: regions(),
    decor: [accentRule()],
    // CarouselClick's closing slide puts the call to action where the footer
    // line goes, a quarter of the way down the band. PostGear's adds the link,
    // which is where a brand kit's CTA defaults land, on the band's bottom
    // edge, level with the footer logo spot and stopping short of it the way
    // the footer line does.
    //
    // The call to action keeps the full width, because it ends above the
    // footer logo spot. The link's box is a quarter of the band tall, which
    // is less than two lines of call-to-action type at the fitter's floor in
    // a story or a landscape, and in a portrait until an address passes about
    // 25 characters. That matters because a web address is one long word: in
    // a box with room for a second line it would wrap where it is cut instead
    // of shrinking. In a square the link draws a size below the call to
    // action. No slide number, as on every closing slide: the last card does
    // not need to say it is last.
    slots: [
      signatureLogo(),
      text('headline', 'headline', { box: FULL, resizable: true, recommendedChars: 60 }),
      supporting('body', { optional: true }),
      text('cta', 'cta', {
        region: 'footer',
        box: rect(0, 25, 100, 48),
        colorRole: 'primary',
        recommendedChars: 32,
      }),
      text('footer', 'cta', {
        region: 'footer',
        label: 'Link',
        box: rect(0, 75, 62, 25),
        valign: 'end',
        colorRole: 'primary',
        optional: true,
        alignable: false,
        recommendedChars: 22,
      }),
    ],
  }),
];
