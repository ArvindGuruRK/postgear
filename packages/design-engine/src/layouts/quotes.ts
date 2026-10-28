/**
 * Quote slides: a testimonial, a customer line, a pull quote from a post.
 *
 * The attribution is a separate slot rather than part of the quote, so the
 * two can take different sizes and colours and so a quote with no name does
 * not leave a dangling dash.
 */
import type { SlideLayout } from '../types';
import { frameLogo, layout, rect, standardFooter, standardHeader, text, threeRows } from './shared';

export const QUOTE_LAYOUTS: SlideLayout[] = [
  layout({
    id: 'quote-centre',
    name: 'Centred Quote',
    role: 'quote',
    regions: threeRows({ header: 12, footer: 9 }),
    slots: [
      ...standardHeader(),
      frameLogo(),
      text('quote', 'quote', {
        box: rect(2, 6, 96, 64),
        align: 'center',
        valign: 'center',
        resizable: true,
        recommendedChars: 180,
      }),
      text('attribution', 'attribution', {
        box: rect(10, 76, 80, 24),
        align: 'center',
        colorRole: 'textMuted',
        optional: true,
        recommendedChars: 60,
      }),
      ...standardFooter(),
    ],
  }),

  layout({
    id: 'quote-panel',
    name: 'Quote Panel',
    role: 'quote',
    regions: threeRows({ header: 12, footer: 9 }),
    // The whole body, bleeding a little past it at the sides: everything that
    // can move in the body stays on the panel.
    decor: [
      {
        kind: 'block',
        region: 'body',
        box: rect(-4, 0, 108, 100),
        colorRole: 'primary',
        radius: 3,
      },
    ],
    slots: [
      ...standardHeader(),
      frameLogo(),
      text('quote', 'quote', {
        box: rect(6, 10, 88, 58),
        valign: 'center',
        colorRole: 'onPrimary',
        resizable: true,
        recommendedChars: 160,
      }),
      text('attribution', 'attribution', {
        box: rect(6, 74, 88, 20),
        colorRole: 'onPrimary',
        optional: true,
        recommendedChars: 60,
      }),
      ...standardFooter(),
    ],
  }),
];
