/**
 * Caption styles, as data (Sprint 13, Module 03).
 *
 * A style says how a page of captions looks and how the spoken word is
 * marked. Six are built in; a workspace saves its own (`ClipCaptionStyle`,
 * the same shape, checked by `captionStyleSchema`). Names and looks are our
 * own designs.
 *
 * ## How the spoken word is marked (`mark.kind`)
 *
 * Each kind is one ASS pattern verified on FFmpeg 9.0.2 (research 09,
 * section 2.1), and only what ASS can draw is offered:
 *
 * - `none`: the whole page shows at once, nothing is marked.
 * - `colour`: only the word being said takes the mark colour (and, with
 *   `pop`, grows for a moment). One event per word.
 * - `box`: a box sits behind the word being said. One event per word.
 * - `fill`: words take the mark colour as they are said and keep it
 *   (`\k`). One event per page.
 * - `reveal`: words appear as they are said and stay; the page keeps its
 *   final layout from the start, so nothing shifts. One event per word.
 *
 * A page has an outline **or** a box, never both, and a `box` mark needs
 * neither: an ASS box is the outline drawn as a filled rectangle
 * (`BorderStyle 3`), so one event cannot have two.
 *
 * When the spoken word cannot be marked on its own (Tamil, Hindi, a supplied
 * file, a translation), every kind falls back to the whole page: a `box`
 * style then puts its box behind the whole page, so the words stay readable.
 */
import { z } from 'zod';
import { CAPTION_CASES, type CaptionCase, type CaptionsTrack } from '../document/schema';
import { CAPTION_MAX_WORDS, CAPTION_SIZE_MAX, CAPTION_SIZE_MIN } from '../document/limits';

export const CAPTION_MARK_KINDS = ['none', 'colour', 'box', 'fill', 'reveal'] as const;
export type CaptionMarkKind = (typeof CAPTION_MARK_KINDS)[number];

export const CAPTION_ENTRANCES = ['none', 'pop', 'fade'] as const;
export type CaptionEntrance = (typeof CAPTION_ENTRANCES)[number];

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'A colour is #RRGGBB');

/** How a caption page looks. Sizes are canvas pixels on the 1080 short side. */
export const captionLookSchema = z
  .object({
    /** A Studio font family; a missing one fails an export with `font_missing`. */
    font: z.string().trim().min(1).max(80),
    weight: z.number().int().min(100).max(900),
    italic: z.boolean(),
    colour: hexColour,
    outline: z
      .object({ colour: hexColour, width: z.number().min(0).max(24) })
      .strict()
      .nullable(),
    /**
     * A box behind the whole page, always solid. libass draws one box for
     * each run of a line, and a marked word or another script's font starts
     * a new run: see-through boxes would show a darker seam wherever two
     * overlap (seen in real frames), so a caption box has no opacity.
     */
    box: z
      .object({ colour: hexColour, pad: z.number().min(0).max(60) })
      .strict()
      .nullable(),
    shadow: z.boolean(),
    letterCase: z.enum(CAPTION_CASES),
    mark: z
      .object({
        kind: z.enum(CAPTION_MARK_KINDS),
        colour: hexColour,
        /** The marked word grows for a moment as it is said (`colour` only). */
        pop: z.boolean(),
      })
      .strict(),
    /** How a page arrives. */
    entrance: z.enum(CAPTION_ENTRANCES),
    /** Words on a page at once, by default. */
    maxWords: z.number().int().min(1).max(CAPTION_MAX_WORDS),
    /** The text's size, by default. */
    sizePx: z.number().min(CAPTION_SIZE_MIN).max(CAPTION_SIZE_MAX),
  })
  .strict()
  .refine((look) => !(look.outline && look.box), 'Captions have an outline or a box, not both')
  .refine(
    (look) => look.mark.kind !== 'box' || (!look.outline && !look.box),
    'A box behind the spoken word cannot be combined with an outline or a page box',
  )
  .refine(
    (look) => !look.mark.pop || look.mark.kind === 'colour',
    'Only a coloured word can grow as it is said',
  );

export type CaptionLook = z.infer<typeof captionLookSchema>;

/** A style a person picks: a look with an id and a name. */
export interface CaptionStyle {
  id: string;
  name: string;
  /** One line under the name, sentence case. */
  hint: string;
  builtIn: boolean;
  look: CaptionLook;
}

export const CAPTION_STYLE_IDS = [
  'bold-pop',
  'marker',
  'karaoke',
  'clean',
  'boxed',
  'typewriter',
] as const;
export type BuiltInCaptionStyleId = (typeof CAPTION_STYLE_IDS)[number];

/** The style new captions get. */
export const DEFAULT_CAPTION_STYLE: BuiltInCaptionStyleId = 'bold-pop';

/** Where captions sit until a person moves them: centred, in the lower third above the platform buttons. */
export const DEFAULT_CAPTION_POSITION = Object.freeze({ x: 0.5, y: 0.72 });

function style(
  id: BuiltInCaptionStyleId,
  name: string,
  hint: string,
  look: CaptionLook,
): CaptionStyle {
  return Object.freeze({ id, name, hint, builtIn: true, look: Object.freeze(look) });
}

/** The six built-in styles, in the order the tiles show. */
export const CAPTION_STYLES: readonly CaptionStyle[] = Object.freeze([
  style('bold-pop', 'Bold Pop', 'Big capitals, the spoken word pops in yellow', {
    font: 'Montserrat',
    weight: 800,
    italic: false,
    colour: '#FFFFFF',
    outline: { colour: '#000000', width: 9 },
    box: null,
    shadow: false,
    letterCase: 'upper',
    mark: { kind: 'colour', colour: '#FFE600', pop: true },
    entrance: 'none',
    maxWords: 3,
    sizePx: 86,
  }),
  style('marker', 'Marker', 'A coloured box moves from word to word', {
    font: 'Inter',
    weight: 800,
    italic: false,
    colour: '#FFFFFF',
    outline: null,
    box: null,
    shadow: false,
    letterCase: 'upper',
    mark: { kind: 'box', colour: '#2563EB', pop: false },
    entrance: 'none',
    maxWords: 3,
    sizePx: 78,
  }),
  style('karaoke', 'Karaoke', 'Words fill with colour as they are said', {
    font: 'Poppins',
    weight: 700,
    italic: false,
    colour: '#FFFFFF',
    outline: { colour: '#111111', width: 7 },
    box: null,
    shadow: false,
    letterCase: 'as_spoken',
    mark: { kind: 'fill', colour: '#34D399', pop: false },
    entrance: 'pop',
    maxWords: 4,
    sizePx: 76,
  }),
  style('clean', 'Clean', 'A quiet line with a soft shadow', {
    font: 'Inter',
    weight: 600,
    italic: false,
    colour: '#FFFFFF',
    outline: { colour: '#000000', width: 3 },
    box: null,
    shadow: true,
    letterCase: 'as_spoken',
    mark: { kind: 'none', colour: '#FFFFFF', pop: false },
    entrance: 'fade',
    maxWords: 6,
    sizePx: 62,
  }),
  style('boxed', 'Boxed', 'White words on a dark box, the spoken one in yellow', {
    font: 'Sora',
    weight: 700,
    italic: false,
    colour: '#FFFFFF',
    outline: null,
    box: { colour: '#111111', pad: 18 },
    shadow: false,
    letterCase: 'as_spoken',
    mark: { kind: 'colour', colour: '#FFD60A', pop: false },
    entrance: 'none',
    maxWords: 4,
    sizePx: 64,
  }),
  style('typewriter', 'Typewriter', 'Words appear one by one as they are said', {
    font: 'JetBrains Mono',
    weight: 700,
    italic: false,
    colour: '#FFFFFF',
    outline: { colour: '#000000', width: 6 },
    box: null,
    shadow: false,
    letterCase: 'as_spoken',
    mark: { kind: 'reveal', colour: '#FFFFFF', pop: false },
    entrance: 'none',
    maxWords: 5,
    sizePx: 60,
  }),
]);

/** A workspace's own style, as the API hands it over (`ClipCaptionStyle`). */
export interface CustomCaptionStyle {
  id: string;
  name: string;
  look: unknown;
}

export function isBuiltInCaptionStyle(id: string): id is BuiltInCaptionStyleId {
  return (CAPTION_STYLE_IDS as readonly string[]).includes(id);
}

export function builtInCaptionStyle(id: string): CaptionStyle | null {
  return CAPTION_STYLES.find((candidate) => candidate.id === id) ?? null;
}

export interface ResolvedCaptionStyle {
  style: CaptionStyle;
  /** True when `styleId` was not found (deleted) and the default stands in. */
  fallback: boolean;
}

/**
 * The style a captions track names: a built-in, or one of the workspace's own
 * whose look still reads. A style that is gone (deleted, or saved by a newer
 * version) falls back to the default and says so, so captions never vanish.
 */
export function resolveStyle(
  styleId: string,
  custom: readonly CustomCaptionStyle[] = [],
): ResolvedCaptionStyle {
  const builtIn = builtInCaptionStyle(styleId);
  if (builtIn) return { style: builtIn, fallback: false };
  const own = custom.find((candidate) => candidate.id === styleId);
  if (own) {
    const look = captionLookSchema.safeParse(own.look);
    if (look.success) {
      return {
        style: { id: own.id, name: own.name, hint: '', builtIn: false, look: look.data },
        fallback: false,
      };
    }
  }
  return {
    style: builtInCaptionStyle(DEFAULT_CAPTION_STYLE) as CaptionStyle,
    fallback: true,
  };
}

/**
 * The look a track is drawn with: the style's own, with the track's size and
 * its optional letter case and mark colour on top. The track's `maxWords` is
 * read by the pager, not here.
 */
export function trackLook(
  track: Pick<CaptionsTrack, 'sizePx' | 'letterCase' | 'markColour'>,
  look: CaptionLook,
): CaptionLook {
  return {
    ...look,
    sizePx: track.sizePx,
    letterCase: (track.letterCase ?? look.letterCase) as CaptionCase,
    mark: track.markColour ? { ...look.mark, colour: track.markColour } : look.mark,
  };
}

/** The families the built-in styles draw with, for the font check. */
export const CAPTION_STYLE_FONTS: readonly string[] = Object.freeze([
  ...new Set(CAPTION_STYLES.map((candidate) => candidate.look.font)),
]);

/** The most caption styles one workspace keeps. */
export const MAX_CUSTOM_CAPTION_STYLES = 30;
