/**
 * How the template library is written down.
 *
 * A preset is a **shape** (which layouts, in which order, with which sample
 * words) worn by a **theme** (colours and type) over an optional **art**
 * style (the drawing under the text). A file of presets is therefore a
 * handful of shapes and a table of rows, each row naming one shape, one theme
 * and maybe one art. The same five steps in two themes and two arts are four
 * different-looking templates and one piece of copy.
 *
 * The rules every row has to meet (a theme and layouts that exist, content
 * only in slots the layout has, copy that fits every format) are checked by
 * `presets.test.ts` over the whole library, so a file here only has to say
 * what it wants.
 */
import { artById } from '../art';
import { themeById } from '../themes';
import type { Preset, PresetCategory, PresetCollection, PresetSlide, SlotId } from '../types';

/**
 * One slide of a shape. `hidden` starts optional slots hidden, over the
 * layout's own default, for a slide that reads better without them.
 */
export function slide(
  layoutId: string,
  text: Partial<Record<SlotId, string>> = {},
  items?: Partial<Record<SlotId, string[]>>,
  hidden?: SlotId[],
): PresetSlide {
  const entry: PresetSlide = items ? { layoutId, text, items } : { layoutId, text };
  if (hidden && hidden.length > 0) entry.hidden = hidden;
  return entry;
}

/** A carousel's layouts and sample words, before any theme is applied. */
export interface PresetShape {
  category: PresetCategory;
  /** Words the gallery search matches on every preset made from this shape. */
  tags: string[];
  slides: PresetSlide[];
}

/** One template: a shape worn by a theme, over an art style or none. */
export interface PresetRow {
  /** Stable and never reused: a design stores it, and Reset looks it up by it. */
  id: string;
  /** Title Case. The gallery card's name and the title a new design starts with. */
  name: string;
  /** A key of the shapes the row is built with. */
  shape: string;
  /** A theme id. */
  theme: string;
  /** An art style id; absent is none. */
  art?: string;
}

/**
 * Builds a collection's presets from its shapes and rows.
 *
 * `premium` is worked out rather than written on each row, so it cannot
 * disagree with the rule: the luxury collection is premium, and so is any
 * preset whose theme or art is. A classic preset comes out exactly as Sprint
 * 9 built it (no `collection`, `art` or `premium` key), because designs made
 * from those ids exist and Reset rebuilds them from here.
 *
 * A row naming a shape that does not exist throws at load: that is a typo in
 * this folder, and failing loudly in every test beats a gallery card that
 * crashes when clicked.
 */
export function buildPresets(
  collection: PresetCollection,
  shapes: Readonly<Record<string, PresetShape>>,
  rows: readonly PresetRow[],
): Preset[] {
  return rows.map(({ id, name, shape: shapeId, theme: themeId, art }) => {
    const shape = Object.hasOwn(shapes, shapeId) ? shapes[shapeId] : undefined;
    if (!shape) throw new Error(`Preset "${id}" names a shape that does not exist: "${shapeId}".`);

    const preset: Preset = {
      id,
      name,
      category: shape.category,
      themeId,
      tags: [...shape.tags, shapeId],
      slides: shape.slides,
    };

    if (art) preset.art = art;
    if (collection !== 'classic') preset.collection = collection;

    const premium =
      collection === 'luxury' ||
      themeById(themeId).premium === true ||
      artById(art)?.premium === true;
    if (premium) preset.premium = true;

    return preset;
  });
}
