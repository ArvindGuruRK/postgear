/**
 * Text as data: the three ready styles, the shadow every text shares, and the
 * text a press of **Add Text** makes (Module 11).
 *
 * The styles are PostGear's own designs, plain values, so the panel, the
 * preview and the compiler read the same numbers. None copies a reference
 * product's caption art.
 */
import { outputDuration } from '../time/time-map';
import { ITEM_MIN_MS } from './limits';
import type { ClipDocument, TextItem, TextStyle } from './schema';

/** The three hook title looks (Module 09): large, high contrast, for the top third. */
export const HOOK_STYLE_IDS = ['hook-bold', 'hook-box', 'hook-pop'] as const;
export type HookStyleId = (typeof HOOK_STYLE_IDS)[number];

export const TEXT_STYLE_IDS = ['bold-outline', 'on-a-box', 'plain', ...HOOK_STYLE_IDS] as const;
export type TextStyleId = (typeof TEXT_STYLE_IDS)[number];

export interface TextStylePreset {
  id: TextStyleId;
  /** Title Case, as the tile shows it. */
  name: string;
  style: TextStyle;
  /** A hook title look (Add Hook Title offers these; Add Text may leave them out). */
  hook?: true;
}

/**
 * The ready styles. Bold Outline keeps a modest outline: libass draws an
 * image per glyph and layer, so a thick outline with a shadow is the slowest
 * thing in a render (research 09 section 6).
 */
export const TEXT_STYLES: readonly TextStylePreset[] = Object.freeze([
  {
    id: 'bold-outline',
    name: 'Bold Outline',
    style: {
      font: 'Montserrat',
      size: 76,
      weight: 800,
      italic: false,
      colour: '#FFFFFF',
      align: 'center',
      outline: { colour: '#111111', width: 5 },
      background: null,
      shadow: false,
      uppercase: false,
    },
  },
  {
    id: 'on-a-box',
    name: 'On A Box',
    style: {
      font: 'Inter',
      size: 56,
      weight: 700,
      italic: false,
      colour: '#111111',
      align: 'center',
      outline: null,
      background: { colour: '#FFFFFF', opacity: 1, radius: 0, pad: 18 },
      shadow: false,
      uppercase: false,
    },
  },
  {
    id: 'plain',
    name: 'Plain',
    style: {
      font: 'Inter',
      size: 64,
      weight: 600,
      italic: false,
      colour: '#FFFFFF',
      align: 'center',
      outline: null,
      background: null,
      shadow: true,
      uppercase: false,
    },
  },
  // Hook title looks (Module 09), PostGear's own: every font is one the render ships.
  {
    id: 'hook-bold',
    name: 'Hook Bold',
    hook: true,
    style: {
      font: 'Anton',
      size: 112,
      weight: 400,
      italic: false,
      colour: '#FFFFFF',
      align: 'center',
      outline: { colour: '#000000', width: 8 },
      background: null,
      shadow: false,
      uppercase: true,
    },
  },
  {
    id: 'hook-box',
    name: 'Hook Box',
    hook: true,
    style: {
      font: 'Montserrat',
      size: 84,
      weight: 900,
      italic: false,
      colour: '#111111',
      align: 'center',
      outline: null,
      background: { colour: '#FFD43B', opacity: 1, radius: 0, pad: 26 },
      shadow: false,
      uppercase: false,
    },
  },
  {
    id: 'hook-pop',
    name: 'Hook Pop',
    hook: true,
    style: {
      font: 'Luckiest Guy',
      size: 104,
      weight: 400,
      italic: false,
      colour: '#FFE14D',
      align: 'center',
      outline: { colour: '#111111', width: 7 },
      background: null,
      shadow: true,
      uppercase: false,
    },
  },
]);

/** The hook title looks, in the order Add Hook Title shows them. */
export const HOOK_TEXT_STYLES: readonly TextStylePreset[] = Object.freeze(
  TEXT_STYLES.filter((preset) => preset.hook === true),
);

export function textStylePreset(id: TextStyleId): TextStylePreset {
  return TEXT_STYLES.find((preset) => preset.id === id) ?? (TEXT_STYLES[0] as TextStylePreset);
}

/** A style with its own outline and box objects, so an edit never reaches a ready style. */
export function copyTextStyle(style: TextStyle): TextStyle {
  return {
    ...style,
    outline: style.outline ? { ...style.outline } : null,
    background: style.background ? { ...style.background } : null,
  };
}

/**
 * The one shadow every text with `shadow: true` gets: down and to the right,
 * in canvas pixels, half-black. The compiler writes it as the style's
 * `Shadow` and `BackColour`; the preview as a `text-shadow` with no blur.
 */
export const TEXT_SHADOW = Object.freeze({ offsetPx: 4, colour: '#000000', opacity: 0.6 });

/** A box with no `pad` of its own gets this much margin, canvas pixels. */
export const TEXT_BOX_PAD_DEFAULT = 18;

/** The box's padding, canvas pixels before the item's scale. */
export function textBoxPad(style: TextStyle): number {
  return style.background ? (style.background.pad ?? TEXT_BOX_PAD_DEFAULT) : 0;
}

/** What Add Text writes until the person types. */
export const DEFAULT_TEXT = 'Your text here';

/** How long a new text shows. */
export const DEFAULT_TEXT_MS = 3_000;

/** A new text box is this share of the canvas width. */
export const DEFAULT_TEXT_WIDTH_SHARE = 0.8;

/** The words as they are drawn: upper case when the style asks for it (never by CSS, so both sides agree). */
export function displayText(item: Pick<TextItem, 'text' | 'style'>): string {
  return item.style.uppercase ? item.text.toUpperCase() : item.text;
}

/**
 * A new text at `atMs` (output time): centred across, in the upper third,
 * 3 seconds long (shorter when the clip ends sooner), on its moment of the
 * video, in the chosen ready style. The id is left to `addItem`.
 */
export function defaultTextItem(
  doc: ClipDocument,
  atMs: number,
  styleId: TextStyleId = 'bold-outline',
  id = 'txt_new',
): TextItem {
  const total = outputDuration(doc);
  const duration = Math.max(Math.min(ITEM_MIN_MS, total), Math.min(DEFAULT_TEXT_MS, total));
  const wanted = Math.round(Number.isFinite(atMs) ? atMs : 0);
  const start = Math.min(Math.max(0, wanted), Math.max(0, total - duration));
  const preset = textStylePreset(styleId);
  return {
    id,
    type: 'text',
    start,
    duration,
    anchor: 'moment',
    text: DEFAULT_TEXT,
    style: copyTextStyle(preset.style),
    transform: { x: 0.5, y: 0.2, scale: 1, rotation: 0, opacity: 1 },
    widthPx: Math.round(doc.canvas.width * DEFAULT_TEXT_WIDTH_SHARE),
    fadeInMs: 0,
    fadeOutMs: 0,
  };
}

/**
 * A text restyled by a ready style: the look changes, the alignment the
 * person chose stays.
 */
export function applyTextStyle(item: TextItem, styleId: TextStyleId): TextItem {
  const preset = textStylePreset(styleId);
  return { ...item, style: { ...copyTextStyle(preset.style), align: item.style.align } };
}

/** The ready style a text's look matches exactly, or null when it was changed by hand. */
export function matchingTextStyle(style: TextStyle): TextStyleId | null {
  const key = (s: TextStyle) => JSON.stringify({ ...s, align: 'center' });
  const found = TEXT_STYLES.find((preset) => key(preset.style) === key(style));
  return found ? found.id : null;
}
