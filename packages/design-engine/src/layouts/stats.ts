/**
 * Statistic slides: one number, large, with the sentence that makes it mean
 * something.
 *
 * The number is its own type role (`stat`), several times the headline size,
 * because a statistic slide that sets the figure at headline size is just a
 * content slide with a number in it.
 */
import type { SlideLayout } from '../types';
import {
  frameLogo,
  layout,
  rect,
  splitBody,
  standardFooter,
  standardHeader,
  text,
  threeRows,
} from './shared';

export const STAT_LAYOUTS: SlideLayout[] = [
  layout({
    id: 'stat-big',
    name: 'Big Number',
    role: 'statistic',
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
      text('stat', 'stat', {
        box: rect(0, 12, 100, 40),
        colorRole: 'primary',
        resizable: true,
        recommendedChars: 8,
      }),
      text('statLabel', 'statLabel', {
        box: rect(0, 54, 100, 16),
        recommendedChars: 48,
      }),
      text('body', 'body', {
        box: rect(0, 74, 100, 26),
        colorRole: 'textMuted',
        optional: true,
        recommendedChars: 160,
      }),
      ...standardFooter(),
    ],
  }),

  layout({
    id: 'stat-split',
    name: 'Number And Point',
    role: 'statistic',
    regions: splitBody({ textWidth: 46, textHeight: 38, asideLabel: 'Point' }),
    slots: [
      ...standardHeader(),
      frameLogo(),
      text('stat', 'stat', {
        box: rect(0, 10, 100, 54),
        colorRole: 'primary',
        resizable: true,
        recommendedChars: 8,
      }),
      text('statLabel', 'statLabel', {
        box: rect(0, 68, 100, 28),
        colorRole: 'textMuted',
        recommendedChars: 40,
      }),
      text('headline', 'headline', {
        region: 'aside',
        box: rect(0, 6, 100, 44),
        resizable: true,
        recommendedChars: 48,
      }),
      text('body', 'body', {
        region: 'aside',
        box: rect(0, 56, 100, 44),
        colorRole: 'textMuted',
        recommendedChars: 200,
      }),
      ...standardFooter(),
    ],
  }),
];
