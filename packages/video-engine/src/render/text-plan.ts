/**
 * Text in the render plan (Module 11): every text item as the numbers its
 * ASS line needs, in **canvas pixels** (the ASS file's `PlayRes` is the
 * document canvas, and libass scales the file to the export size itself).
 *
 * The geometry comes from `textGeometry`, which the preview reads too: the
 * box is centred on the item's centre, `widthPx x scale` wide; the font is
 * the manifest's twin at the nearest weight (`resolveTextFont`); letters the
 * twin lacks go to a script fallback (`textRuns`). A family the manifest
 * does not have, or a letter no font has, is `font_missing`: the compiler
 * never lets libass pick some other face.
 */
import type { ClipDocument, TextItem } from '../document/schema';
import { badgeLayout, type BadgeShape } from '../document/sticker';
import { displayText, TEXT_SHADOW, textBoxPad } from '../document/text';
import { RenderCompileError } from './errors';
import {
  assFontSize,
  type FontManifest,
  type FontManifestEntry,
  resolveTextFont,
  textRuns,
} from './fonts';

/** Where a text box sits on the canvas, in canvas pixels. Pure, shared with the preview. */
export interface TextGeometry {
  /** The item's centre. */
  cx: number;
  cy: number;
  /** The wrapping box: its left edge and width (`widthPx x scale`). */
  boxLeft: number;
  boxWidth: number;
  /** The CSS-style em size after the item's scale. */
  sizePx: number;
  /** Outline width or box padding after the scale (0 for none). */
  backingPx: number;
  /** The shadow's offset after the scale (0 for none). */
  shadowPx: number;
}

export function textGeometry(
  item: Pick<TextItem, 'transform' | 'widthPx' | 'style'>,
  canvas: { width: number; height: number },
): TextGeometry {
  const { transform, style } = item;
  const scale = transform.scale;
  const boxWidth = item.widthPx * scale;
  const cx = transform.x * canvas.width;
  const backing = style.outline
    ? style.outline.width * scale
    : style.background
      ? textBoxPad(style) * scale
      : 0;
  return {
    cx,
    cy: transform.y * canvas.height,
    boxLeft: cx - boxWidth / 2,
    boxWidth,
    sizePx: style.size * scale,
    backingPx: backing,
    shadowPx: style.shadow ? TEXT_SHADOW.offsetPx * scale : 0,
  };
}

/**
 * A text's own fades, cut so the two never overlap: each is at most half the
 * item's length. The preview's opacity and the ASS `\fad` both read this.
 */
export function textFades(item: Pick<TextItem, 'fadeInMs' | 'fadeOutMs' | 'duration'>): {
  inMs: number;
  outMs: number;
} {
  const half = Math.floor(item.duration / 2);
  return {
    inMs: Math.max(0, Math.min(item.fadeInMs, half)),
    outMs: Math.max(0, Math.min(item.fadeOutMs, half)),
  };
}

/** A text's own fade factor at `localMs` since it started (1 when it is fully shown). */
export function textFadeAt(
  item: Pick<TextItem, 'fadeInMs' | 'fadeOutMs' | 'duration'>,
  localMs: number,
): number {
  const { inMs, outMs } = textFades(item);
  const fadeIn = inMs > 0 ? Math.min(1, Math.max(0, localMs / inMs)) : 1;
  const fadeOut = outMs > 0 ? Math.min(1, Math.max(0, (item.duration - localMs) / outMs)) : 1;
  return fadeIn * fadeOut;
}

/** One run of a text in one font. */
export interface PlanTextRun {
  text: string;
  assName: string;
  psName: string;
  /** The ASS `\fs` for this font at the text's size. */
  fontSize: number;
  weight: number;
}

export type PlanTextBacking =
  | { kind: 'none' }
  | { kind: 'outline'; colour: string; width: number }
  | { kind: 'box'; colour: string; opacity: number; pad: number };

export interface PlanText {
  id: string;
  /** Drawing order: higher draws on top (the ASS `Layer`). */
  layer: number;
  /** Output ms, `endMs` exclusive. */
  startMs: number;
  endMs: number;
  geometry: TextGeometry;
  align: 'left' | 'center' | 'right';
  /** Degrees, clockwise positive (ASS writes `\frz` as minus this). */
  rotationDeg: number;
  opacity: number;
  fadeInMs: number;
  fadeOutMs: number;
  /** The style's own font: the first run's, and the one fallback runs switch back to. */
  main: PlanTextRun;
  runs: PlanTextRun[];
  italic: boolean;
  colour: string;
  backing: PlanTextBacking;
  shadow: boolean;
}

/**
 * How many ASS layers each overlay takes, in drawing order: a text one, a
 * Follow Badge five (its pill, disc and mark, then its two lines), a picture
 * sticker none (it is an overlay under the whole text layer).
 */
export const BADGE_LAYERS = 5;

/** The first ASS layer of every text and badge, bottom first. */
export function overlayLayers(doc: Pick<ClipDocument, 'tracks'>): Map<string, number> {
  const layers = new Map<string, number>();
  let next = 0;
  for (const track of doc.tracks) {
    if (track.kind !== 'overlay') continue;
    for (const item of track.items) {
      if (item.type === 'text') {
        layers.set(item.id, next);
        next += 1;
      } else if ('badge' in item.ref) {
        layers.set(item.id, next);
        next += BADGE_LAYERS;
      }
    }
  }
  return layers;
}

/**
 * Every text of the document, bottom first, ready for `buildAss`: the text
 * items, and each Follow Badge's two lines (ordinary left-aligned texts in
 * the badge's font).
 */
export function planTexts(doc: ClipDocument, manifest: FontManifest | null): PlanText[] {
  const texts: PlanText[] = [];
  const layers = overlayLayers(doc);
  for (const track of doc.tracks) {
    if (track.kind !== 'overlay') continue;
    for (const item of track.items) {
      const layer = layers.get(item.id);
      if (layer === undefined) continue;
      if (item.type === 'text') {
        texts.push(planText(item, doc, manifest, layer));
      } else {
        badgeLayout(item, doc.canvas).texts.forEach((line, index) => {
          texts.push(planText(line, doc, manifest, layer + 3 + index));
        });
      }
    }
  }
  return texts;
}

/** One plain shape drawn in the ASS file (the Follow Badge's pill, disc and mark), in canvas pixels. */
export interface PlanShape extends BadgeShape {
  layer: number;
  /** Output ms, `endMs` exclusive. */
  startMs: number;
  endMs: number;
}

/** Every Follow Badge's shapes, bottom first. */
export function planShapes(doc: ClipDocument): PlanShape[] {
  const shapes: PlanShape[] = [];
  const layers = overlayLayers(doc);
  for (const track of doc.tracks) {
    if (track.kind !== 'overlay') continue;
    for (const item of track.items) {
      if (item.type !== 'sticker' || !('badge' in item.ref)) continue;
      const layer = layers.get(item.id) as number;
      badgeLayout(item, doc.canvas).shapes.forEach((shape, index) => {
        shapes.push({
          ...shape,
          layer: layer + index,
          startMs: item.start,
          endMs: item.start + item.duration,
        });
      });
    }
  }
  return shapes;
}

function runOf(entry: FontManifestEntry, text: string, sizePx: number): PlanTextRun {
  return {
    text,
    assName: entry.assName,
    psName: entry.psName,
    fontSize: assFontSize(entry, sizePx),
    weight: entry.weight,
  };
}

function planText(
  item: TextItem,
  doc: ClipDocument,
  manifest: FontManifest | null,
  layer: number,
): PlanText {
  const main = manifest ? resolveTextFont(manifest, item.style.font, item.style.weight) : null;
  if (!manifest || !main) {
    throw new RenderCompileError('font_missing', 'A font the clip uses is not installed', {
      families: item.style.font,
    });
  }
  const geometry = textGeometry(item, doc.canvas);
  const words = displayText(item);
  const split = textRuns(words, main, manifest);
  if (!split.ok) {
    throw new RenderCompileError('font_missing', 'No installed font can draw a letter of a text', {
      itemId: item.id,
      characters: split.missing
        .map(
          (char) =>
            `U+${(char.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, '0')}`,
        )
        .join(' '),
    });
  }
  const style = item.style;
  const backing: PlanTextBacking = style.outline
    ? { kind: 'outline', colour: style.outline.colour, width: geometry.backingPx }
    : style.background
      ? {
          kind: 'box',
          colour: style.background.colour,
          opacity: style.background.opacity,
          pad: geometry.backingPx,
        }
      : { kind: 'none' };
  const fades = textFades(item);
  return {
    id: item.id,
    layer,
    startMs: item.start,
    endMs: item.start + item.duration,
    geometry,
    align: style.align,
    rotationDeg: item.transform.rotation,
    opacity: item.transform.opacity,
    fadeInMs: fades.inMs,
    fadeOutMs: fades.outMs,
    main: runOf(main, '', geometry.sizePx),
    runs: split.runs.map((run) => runOf(run.entry, run.text, geometry.sizePx)),
    italic: style.italic,
    colour: style.colour,
    backing,
    shadow: style.shadow,
  };
}

/** Every font file the texts use (the twins the worker copies into `fonts/`). */
export function textFontFiles(texts: readonly PlanText[], manifest: FontManifest): string[] {
  const names = new Set<string>();
  for (const text of texts) {
    names.add(text.main.psName);
    for (const run of text.runs) names.add(run.psName);
  }
  return manifest.fonts
    .filter((entry) => names.has(entry.psName))
    .map((entry) => entry.file)
    .sort((a, b) => a.localeCompare(b, 'en'));
}

/** The PostScript names the texts may draw with: libass choosing any other is a fallback. */
export function textFontNames(texts: readonly PlanText[]): string[] {
  const names = new Set<string>();
  for (const text of texts) {
    names.add(text.main.psName);
    for (const run of text.runs) names.add(run.psName);
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'en'));
}
