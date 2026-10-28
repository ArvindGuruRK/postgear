/**
 * The classic templates over a pattern: Sprint 9's shapes exactly as
 * `classic.ts` writes them (the same layouts, the same words), each in a
 * classic theme with one of the generated patterns of `art/patterns.ts` under
 * the text. Free, like everything they are made of: the classic themes and the
 * patterns are free, so `buildPresets` marks none of these premium.
 *
 * ## Which pattern, on which theme
 *
 * The classic themes pin no art colours, so a pattern here draws in colours
 * worked out from the theme's accent (`artColors`): Midnight's beams come out
 * in its gold, Violet's prisms in its magenta. A row pairs a theme with a
 * pattern that flatters that accent and keeps its busy part away from the
 * words.
 *
 * Away from the words means away from the bottom edge as well. Every classic
 * layout ends in a footer with the handle on the left and the slide number on
 * the right, and six of the ten patterns light exactly that edge: Aurora,
 * Arcs, Glass and Minimal glow from the bottom-right corner, Waves runs its
 * ribbons along the bottom, and Horizon's floor rises behind the footer and
 * its glow behind the body. Under the pixel contrast check in
 * `presets.browser.spec.ts` those six fail on every classic theme, so no row
 * here uses them. The four that work keep to the top right (Prism, Beams,
 * Halftone) or cut across two corners (Planes, which goes with the shapes
 * that close on the Closing Band, whose band covers its bottom-left plane).
 * Every row clears that check in every format.
 *
 * ## Ids and names
 *
 * An id is `classic-<shape>-<theme>-<pattern>`. None of the 47 classic ids
 * starts with `classic-`, so the two sets can never collide. A name opens with
 * the pattern and then borrows the word the classic gallery gives that theme
 * (Night, Deep, Soft, Warm, Bright), so it reads as a sibling of the plain
 * template it grew from.
 */
import type { Preset } from '../types';
import { buildPresets, type PresetRow } from './build';
import { CLASSIC_SHAPES } from './classic';

const ROWS: PresetRow[] = [
  {
    id: 'classic-tips-steps-midnight-beams',
    name: 'Beams Night Steps',
    shape: 'tips-steps',
    theme: 'midnight',
    art: 'beams',
  },
  {
    id: 'classic-educational-explainer-terminal-halftone',
    name: 'Halftone Developer Explainer',
    shape: 'educational-explainer',
    theme: 'terminal',
    art: 'halftone',
  },
  {
    id: 'classic-educational-myths-violet-prism',
    name: 'Prism Bright Myth Buster',
    shape: 'educational-myths',
    theme: 'violet',
    art: 'prism',
  },
  {
    id: 'classic-announcement-launch-bold-beams',
    name: 'Beams Big Launch',
    shape: 'announcement-launch',
    theme: 'bold',
    art: 'beams',
  },
  {
    id: 'classic-product-update-midnight-prism',
    name: 'Prism Night Release',
    shape: 'product-update',
    theme: 'midnight',
    art: 'prism',
  },
  {
    id: 'classic-quote-testimonial-blossom-halftone',
    name: 'Halftone Soft Testimonials',
    shape: 'quote-testimonial',
    theme: 'blossom',
    art: 'halftone',
  },
  {
    id: 'classic-listicle-tools-ink-planes',
    name: 'Planes Tool Round-Up',
    shape: 'listicle-tools',
    theme: 'ink',
    art: 'planes',
  },
  {
    id: 'classic-statistic-report-terminal-beams',
    name: 'Beams Raw Numbers',
    shape: 'statistic-report',
    theme: 'terminal',
    art: 'beams',
  },
  {
    id: 'classic-case-study-ocean-prism',
    name: 'Prism Deep Case Study',
    shape: 'case-study',
    theme: 'ocean',
    art: 'prism',
  },
  {
    id: 'classic-promotion-offer-sunrise-planes',
    name: 'Planes Warm Offer',
    shape: 'promotion-offer',
    theme: 'sunrise',
    art: 'planes',
  },
  {
    id: 'classic-hiring-role-violet-planes',
    name: 'Planes Bright Hiring',
    shape: 'hiring-role',
    theme: 'violet',
    art: 'planes',
  },
  {
    id: 'classic-story-behind-blossom-beams',
    name: 'Beams Soft Story',
    shape: 'story-behind',
    theme: 'blossom',
    art: 'beams',
  },
];

export const CLASSIC_ART_PRESETS: Preset[] = buildPresets('classic', CLASSIC_SHAPES, ROWS);
