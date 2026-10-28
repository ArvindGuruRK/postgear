/**
 * List slides: the backbone of a tips or listicle carousel.
 *
 * The layouts cap a list at five or six items. That is not a storage limit,
 * it is a design one: seven lines of text in a 1080px square are below the
 * size a feed shows legibly, and the honest answer to "I have ten tips" is two
 * slides.
 */
import type { SlideLayout } from '../types';
import {
  bandAndPanel,
  frameLogo,
  layout,
  list,
  rect,
  standardFooter,
  standardHeader,
  text,
  threeRows,
} from './shared';

export const LIST_LAYOUTS: SlideLayout[] = [
  layout({
    id: 'list-numbered',
    name: 'Numbered List',
    role: 'list',
    regions: threeRows(),
    slots: [
      ...standardHeader(),
      frameLogo(),
      text('headline', 'headline', {
        box: rect(0, 0, 100, 26),
        resizable: true,
        recommendedChars: 44,
      }),
      list({
        box: rect(0, 32, 100, 68),
        marker: 'number',
        maxItems: 6,
        recommendedChars: 72,
      }),
      ...standardFooter(),
    ],
  }),

  layout({
    id: 'list-ticks',
    name: 'Tick List',
    role: 'list',
    regions: threeRows(),
    slots: [
      ...standardHeader(),
      frameLogo(),
      text('eyebrow', 'eyebrow', {
        box: rect(0, 0, 100, 9),
        colorRole: 'accent',
        optional: true,
        recommendedChars: 24,
      }),
      text('headline', 'headline', {
        box: rect(0, 13, 100, 24),
        resizable: true,
        recommendedChars: 44,
      }),
      list({
        box: rect(0, 42, 100, 58),
        marker: 'tick',
        maxItems: 6,
        recommendedChars: 64,
      }),
      ...standardFooter(),
    ],
  }),

  layout({
    id: 'list-steps',
    name: 'Step List',
    role: 'list',
    // The steps get a region of their own, the panel, so the painted panel
    // behind them covers everything that can move in it and nothing else: a
    // headline nudged down stays on the ground it was written for.
    regions: bandAndPanel({ bandHeight: 26, panelLabel: 'Panel' }),
    decor: [
      {
        kind: 'block',
        region: 'aside',
        box: rect(0, 0, 100, 100),
        colorRole: 'surface',
        radius: 3,
      },
    ],
    slots: [
      ...standardHeader(),
      frameLogo(),
      text('headline', 'headline', {
        box: rect(0, 0, 100, 92),
        valign: 'end',
        resizable: true,
        recommendedChars: 44,
      }),
      list({
        region: 'aside',
        box: rect(6, 8, 88, 84),
        marker: 'rule',
        maxItems: 5,
        colorRole: 'onSurface',
        recommendedChars: 72,
      }),
      ...standardFooter(),
    ],
  }),
];
