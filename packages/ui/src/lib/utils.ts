import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge only knows Tailwind's own utilities. Our custom texture
 * utilities (`bg-stripes`, `bg-halftone` — see packages/config/tailwind.css)
 * look like `bg-<color>` to it, so it treated them as background-COLOR and
 * dropped the real color that preceded them:
 *
 *   twMerge('bg-actionPrimary bg-stripes') === 'bg-stripes'   // color gone
 *
 * They set background-image, so they belong in the `bg-image` group, where
 * they conflict only with each other and layer over any fill.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'bg-image': ['bg-stripes', 'bg-halftone'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
