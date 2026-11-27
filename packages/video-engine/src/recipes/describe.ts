/**
 * A recipe in one plain line for its card (Module 10). Pure.
 *
 * The line reads in the recipe's own order: shape, layout, follow, captions,
 * cleanup, bleep, hook title, then the Clip Setup and export choices. Names
 * keep their Title Case ("Vertical, Blurred, Marker captions, silences
 * removed, 1080p"); the words between them are sentence case, and the first
 * letter of the line is a capital.
 */
import { RATIO_LABELS } from '../canvas';
import { builtInCaptionStyle } from '../captions/styles';
import { CLIP_LENGTH_LABELS } from '../highlights/fit';
import { GENRE_LABELS } from '../highlights/genre';
import { PRESET_LABELS } from '../layout/presets';
import { QUALITY_LABELS } from '../quality';
import type { RecipeSettings } from './schema';

/** The workspace's own names, when the caller has them (a caption style, a saved layout). */
export interface RecipeNames {
  captionStyle?(id: string): string | null;
  layoutPreset?(id: string): string | null;
}

/** What an empty recipe reads. */
export const EMPTY_RECIPE_LINE = 'Changes nothing yet';

function layoutName(layout: NonNullable<RecipeSettings['layout']>, names: RecipeNames): string {
  const saved = layout.presetId ? names.layoutPreset?.(layout.presetId) : null;
  if (saved) return saved;
  if (layout.kind === 'custom') return 'Custom layout';
  return PRESET_LABELS[layout.kind];
}

function captionName(styleId: string, names: RecipeNames): string {
  return builtInCaptionStyle(styleId)?.name ?? names.captionStyle?.(styleId) ?? 'Own';
}

/** One plain line for cards ("Vertical, Blurred, Marker captions, silences removed, 1080p"). */
export function describeRecipe(settings: RecipeSettings, names: RecipeNames = {}): string {
  const parts: string[] = [];
  if (settings.ratio) parts.push(RATIO_LABELS[settings.ratio]);
  if (settings.layout) parts.push(layoutName(settings.layout, names));
  if (settings.follow) {
    if (!settings.follow.on) parts.push('stops following');
    else
      parts.push(settings.follow.mode === 'both' ? 'shows both speakers' : 'follows the speaker');
  }
  if (settings.captions) {
    parts.push(
      settings.captions.on
        ? `${captionName(settings.captions.styleId, names)} captions`
        : 'no captions',
    );
  }
  if (settings.silences?.on) parts.push('silences removed');
  if (settings.fillers?.on) parts.push('filler words removed');
  if (settings.bleep) {
    if (!settings.bleep.on) parts.push('no bleeps');
    else parts.push(settings.bleep.mode === 'mute' ? 'bad words muted' : 'bad words bleeped');
  }
  if (settings.hookTitle) parts.push(settings.hookTitle.on ? 'hook title' : 'no hook title');
  if (settings.clipLength && settings.clipLength !== 'auto') {
    parts.push(`clips ${CLIP_LENGTH_LABELS[settings.clipLength].toLowerCase()}`);
  }
  if (settings.genre && settings.genre !== 'auto') parts.push(GENRE_LABELS[settings.genre]);
  if (settings.exportQuality) parts.push(QUALITY_LABELS[settings.exportQuality]);

  if (parts.length === 0) return EMPTY_RECIPE_LINE;
  const line = parts.join(', ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}
