import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge only knows Tailwind's own utilities. Our custom texture
 * utilities (`bg-stripes`, `bg-stripes-flow`, `bg-halftone`: see
 * packages/config/tailwind.css)
 * look like `bg-<color>` to it, so it treated them as background-COLOR and
 * dropped the real color that preceded them:
 *
 *   twMerge('bg-actionPrimary bg-stripes') === 'bg-stripes'   // color gone
 *
 * They set background-image, so they belong in the `bg-image` group, where
 * they conflict only with each other and layer over any fill.
 *
 * The same goes for the named shadows (`shadow-brutalSm`, `shadow-surfaceMd`:
 * see the `--shadow-*` tokens there). Read as a shadow *colour*, they
 * survived a later `shadow-none`, so a component could never drop its
 * default shadow. They are box shadows, in the `shadow` group.
 *
 * And the card corner (`rounded-card`, packages/config/tailwind.css): a
 * radius, so a `rounded-*` passed to a Card replaces it rather than both
 * landing in the class list.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'bg-image': ['bg-stripes', 'bg-stripes-flow', 'bg-halftone'],
      rounded: [{ rounded: ['card'] }],
      shadow: [
        {
          shadow: [
            'brutalSm',
            'brutalMd',
            'brutalLg',
            'brutalPressed',
            'surfaceSm',
            'surfaceMd',
            'surfaceLg',
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
