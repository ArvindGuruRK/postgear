/**
 * Clip Setup with a recipe picked (Module 10). Pure.
 *
 * The setup form opens filled from the recipe, and the person may change any
 * control after; the run then applies the recipe's settings with the form's
 * own controls on top. A switch the form turns off that the recipe never
 * had is left out (there is nothing to switch off on a new clip); one the
 * recipe had is written off, so the person's choice wins.
 */
import { SILENCE_DEFAULT_MS } from '../cleanup/silences';
import { HOOK_STYLE_IDS } from '../document/text';
import type { ClipSetup } from '../highlights/setup';
import { RECIPE_VERSION, type RecipeSettings } from './schema';

type SetupControls = Pick<
  ClipSetup,
  'ratio' | 'length' | 'genre' | 'captions' | 'follow' | 'silences' | 'hookTitle'
>;

/** The recipe's settings (or none) with the setup's own controls on top. */
export function recipeFromSetup(setup: SetupControls, base: RecipeSettings | null): RecipeSettings {
  const settings: RecipeSettings = {
    ...(base ?? { version: RECIPE_VERSION }),
    version: RECIPE_VERSION,
  };
  settings.ratio = setup.ratio;
  settings.clipLength = setup.length;
  settings.genre = setup.genre;

  if (setup.captions.on) {
    // The recipe's place, size and words on a page stay while the style is the recipe's own.
    const same = base?.captions?.styleId === setup.captions.styleId ? base.captions : undefined;
    settings.captions = {
      ...(same ?? {}),
      on: true,
      styleId: setup.captions.styleId,
    };
  } else if (base?.captions) {
    settings.captions = { on: false, styleId: setup.captions.styleId };
  }

  if (setup.follow) {
    settings.follow = { on: true, mode: base?.follow?.mode ?? 'speaker' };
  } else if (base?.follow) {
    settings.follow = { on: false, mode: base.follow.mode };
  }

  if (setup.silences) {
    settings.silences = { on: true, minMs: base?.silences?.minMs ?? SILENCE_DEFAULT_MS };
  } else if (base?.silences) {
    settings.silences = { on: false, minMs: base.silences.minMs };
  }

  if (setup.hookTitle) {
    settings.hookTitle = { on: true, look: base?.hookTitle?.look ?? HOOK_STYLE_IDS[0] };
  } else if (base?.hookTitle) {
    settings.hookTitle = { on: false, look: base.hookTitle.look };
  }
  return settings;
}
