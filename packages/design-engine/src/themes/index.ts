/**
 * The colour and type themes a preset is built from.
 *
 * A theme is half a template: the other half is the layout. A handful of
 * themes across the layouts is what turns a library of a hundred and fifty
 * presets into a content task rather than a hundred and fifty hand-drawn
 * designs, and it is why swapping Theme in the design panel restyles every
 * slide at once without touching a slot.
 *
 * The themes come in the three collections the gallery and the Design tab
 * group by, one file each:
 *
 * - **Classic** (`classic.ts`): Sprint 9's ten, exactly as they shipped.
 * - **Signature** (`signature.ts`): CarouselClick's palettes and type, the
 *   look its patterns and hand-made backgrounds were drawn for. Free.
 * - **Luxury** (`luxury.ts`): PostGear's own deep and ivory grounds with
 *   metallic inks, in the luxury serifs. Premium.
 *
 * Each palette states every role, including the three derived inks
 * (`onPrimary`, `onAccent`, `onSurface`). They are written out rather than
 * computed so a theme's own look is exactly what the author chose; `brand.ts`
 * recomputes them when a brand kit replaces the colours, because a brand's
 * colours are not something an author saw.
 *
 * **Every pairing here clears WCAG AA**, and `themes.test.ts` fails the build
 * if a new theme breaks that. Type sizes are percentages of the canvas's
 * short edge: 9 means 97px on a 1080-wide square.
 *
 * An id is never renamed or reused: a design stores its theme by id, and
 * Reset finds it again by that id.
 */
import type { FontId, PresetCollection, Theme } from '../types';
import { CLASSIC_THEMES } from './classic';
import { LUXURY_THEMES } from './luxury';
import { SIGNATURE_THEMES } from './signature';

export { CLASSIC_THEMES } from './classic';
export { LUXURY_THEMES } from './luxury';
export { SIGNATURE_THEMES } from './signature';

/** Every theme, Classic first so Sprint 9's order is unchanged at the front. */
export const THEMES: Theme[] = [...CLASSIC_THEMES, ...SIGNATURE_THEMES, ...LUXURY_THEMES];

export const CLASSIC_THEME_IDS: readonly string[] = CLASSIC_THEMES.map((theme) => theme.id);
export const SIGNATURE_THEME_IDS: readonly string[] = SIGNATURE_THEMES.map((theme) => theme.id);
export const LUXURY_THEME_IDS: readonly string[] = LUXURY_THEMES.map((theme) => theme.id);

/**
 * A `Map`, not an object: a stored `themeId` of `"toString"` must miss, and on
 * a plain object it would find `Object.prototype.toString`.
 */
const BY_ID: ReadonlyMap<string, Theme> = new Map(THEMES.map((theme) => [theme.id, theme]));

const COLLECTION_BY_ID: ReadonlyMap<string, PresetCollection> = new Map([
  ...CLASSIC_THEME_IDS.map((id) => [id, 'classic'] as const),
  ...SIGNATURE_THEME_IDS.map((id) => [id, 'signature'] as const),
  ...LUXURY_THEME_IDS.map((id) => [id, 'luxury'] as const),
]);

export const DEFAULT_THEME_ID = 'ink';

export function isThemeId(value: unknown): value is string {
  return typeof value === 'string' && BY_ID.has(value);
}

/** The theme, or the default one for an id that no longer exists. */
export function themeById(id: string): Theme {
  return BY_ID.get(id) ?? (BY_ID.get(DEFAULT_THEME_ID) as Theme);
}

/**
 * The collection a theme belongs to, for the Design tab's grouping. An id
 * that no longer exists reads as Classic, the collection `themeById` falls
 * back into.
 */
export function themeCollection(id: string): PresetCollection {
  return COLLECTION_BY_ID.get(id) ?? 'classic';
}

/** Every font a theme uses, for the exporter's "inline only what this needs". */
export function fontsOf(theme: Theme): FontId[] {
  return [...new Set(Object.values(theme.type).map((style) => style.font))];
}
