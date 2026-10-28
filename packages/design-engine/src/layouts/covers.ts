/**
 * Cover slides: the first thing somebody sees in a feed, and the one slide
 * that has to work as a thumbnail.
 *
 * All three keep the headline in the upper two thirds and leave the footer
 * clear, because Instagram's grid and LinkedIn's document viewer both crop or
 * cover the bottom strip of a carousel's first card.
 *
 * `cover-picture` has no picture *slot*: a photo that fills the slide is the
 * slide's background (`background.kind === 'media'`), which is also where the
 * darkening overlay lives. Its inks are the ones that read on the brand's main
 * colour, and `ink.ts` swaps any that would not read on a photo for the light
 * ink a photo takes, so the layout does not have to guess.
 */
import type { SlideLayout } from '../types';
import { frameLogo, layout, rect, standardFooter, standardHeader, text, threeRows } from './shared';

export const COVER_LAYOUTS: SlideLayout[] = [
  layout({
    id: 'cover-headline',
    name: 'Cover Headline',
    role: 'cover',
    regions: threeRows({ header: 12, footer: 10 }),
    slots: [
      ...standardHeader(),
      frameLogo(),
      text('eyebrow', 'eyebrow', {
        box: rect(0, 0, 100, 10),
        optional: true,
        recommendedChars: 28,
      }),
      text('headline', 'headline', {
        box: rect(0, 14, 100, 56),
        resizable: true,
        recommendedChars: 64,
      }),
      text('subheadline', 'subheadline', {
        box: rect(0, 74, 92, 26),
        colorRole: 'textMuted',
        optional: true,
        recommendedChars: 120,
      }),
      ...standardFooter(),
    ],
  }),

  layout({
    id: 'cover-block',
    name: 'Cover Block',
    role: 'cover',
    // A wider gap under the header than the shared frame's: the block's top
    // edge sits in it, clear of the header above and the body below in every
    // format, so nothing that moves in either one can end up half on it.
    regions: threeRows({ header: 10, footer: 10, gapTop: 12 }),
    // Painted across the whole canvas from just above the body to the bottom
    // edge, so the body and the footer are both entirely on it.
    decor: [{ kind: 'block', box: rect(0, 21, 100, 79), colorRole: 'primary' }],
    slots: [
      ...standardHeader(),
      frameLogo(),
      text('eyebrow', 'eyebrow', {
        box: rect(0, 0, 100, 12),
        colorRole: 'onPrimary',
        optional: true,
        recommendedChars: 28,
      }),
      text('headline', 'headline', {
        box: rect(0, 15, 100, 52),
        colorRole: 'onPrimary',
        resizable: true,
        recommendedChars: 56,
      }),
      text('subheadline', 'subheadline', {
        box: rect(0, 70, 92, 30),
        colorRole: 'onPrimary',
        optional: true,
        recommendedChars: 110,
      }),
      ...standardFooter({ colorRole: 'onPrimary' }),
    ],
  }),

  layout({
    id: 'cover-picture',
    name: 'Cover Picture',
    role: 'cover',
    // Without a photo this is a solid cover in the brand's main colour, so a
    // design that has not chosen one yet still looks deliberate.
    background: { kind: 'role', role: 'primary' },
    regions: threeRows({ header: 12, footer: 10 }),
    slots: [
      ...standardHeader({ colorRole: 'onPrimary' }),
      frameLogo(),
      text('eyebrow', 'eyebrow', {
        box: rect(0, 2, 100, 12),
        colorRole: 'onPrimary',
        optional: true,
        recommendedChars: 28,
      }),
      text('headline', 'headline', {
        box: rect(0, 32, 100, 50),
        colorRole: 'onPrimary',
        valign: 'end',
        resizable: true,
        recommendedChars: 56,
      }),
      text('subheadline', 'subheadline', {
        box: rect(0, 84, 92, 16),
        colorRole: 'onPrimary',
        optional: true,
        recommendedChars: 90,
      }),
      ...standardFooter({ colorRole: 'onPrimary' }),
    ],
  }),
];
