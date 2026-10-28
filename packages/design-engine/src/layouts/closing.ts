/**
 * Closing slides: the last card, where a carousel asks for something.
 *
 * `closing-cta` puts the logo in the middle of the slide, above the headline:
 * the one place a logo earns its size, because the reader has finished and
 * this is the slide they look at while deciding whether to follow. It can
 * move up into the header instead. `closing-band` keeps it in the header,
 * because its footer is the coloured band with the call to action in it.
 *
 * Neither has a slide number: a closing card does not need to say it is last.
 */
import type { SlideLayout } from '../types';
import { layout, logo, rect, text, threeRows } from './shared';

export const CLOSING_LAYOUTS: SlideLayout[] = [
  layout({
    id: 'closing-cta',
    name: 'Closing Call To Action',
    role: 'closing',
    regions: threeRows({ header: 12, footer: 10 }),
    slots: [
      logo({
        spots: {
          centre: { region: 'body', box: rect(38, 0, 24, 18), align: 'center' },
          header: { region: 'header', box: rect(38, 0, 24, 100), align: 'center' },
        },
        placement: 'centre',
      }),
      text('headline', 'headline', {
        box: rect(4, 22, 92, 32),
        align: 'center',
        valign: 'center',
        resizable: true,
        recommendedChars: 48,
      }),
      text('subheadline', 'subheadline', {
        box: rect(8, 57, 84, 18),
        align: 'center',
        colorRole: 'textMuted',
        optional: true,
        recommendedChars: 110,
      }),
      text('cta', 'cta', {
        box: rect(10, 79, 80, 21),
        align: 'center',
        valign: 'center',
        colorRole: 'accent',
        recommendedChars: 36,
      }),
      text('handle', 'footer', {
        region: 'footer',
        box: rect(0, 0, 100, 100),
        align: 'center',
        valign: 'center',
        colorRole: 'textMuted',
        optional: true,
        alignable: false,
        recommendedChars: 32,
        bind: 'handle',
      }),
    ],
  }),

  layout({
    id: 'closing-band',
    name: 'Closing Band',
    role: 'closing',
    regions: threeRows({ header: 14, footer: 12 }),
    // A band across the canvas from just above the footer to the bottom edge.
    // Its top sits in the gap between the body and the footer in every
    // format, so the footer is entirely on it and the body never touches it.
    decor: [{ kind: 'block', box: rect(0, 80, 100, 20), colorRole: 'accent' }],
    slots: [
      logo({
        spots: { header: { region: 'header', box: rect(0, 0, 24, 100), align: 'start' } },
        placement: 'header',
      }),
      text('headline', 'headline', {
        box: rect(0, 12, 100, 44),
        resizable: true,
        recommendedChars: 48,
      }),
      text('subheadline', 'subheadline', {
        box: rect(0, 60, 92, 30),
        colorRole: 'textMuted',
        optional: true,
        recommendedChars: 140,
      }),
      text('cta', 'cta', {
        region: 'footer',
        box: rect(0, 0, 58, 100),
        valign: 'center',
        colorRole: 'onAccent',
        recommendedChars: 36,
      }),
      text('handle', 'footer', {
        region: 'footer',
        box: rect(60, 0, 40, 100),
        align: 'end',
        valign: 'center',
        colorRole: 'onAccent',
        optional: true,
        alignable: false,
        recommendedChars: 28,
        bind: 'handle',
      }),
    ],
  }),
];
