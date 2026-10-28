/**
 * The middle of a carousel: a point made in words, with or without a picture.
 *
 * `plain` is also what Start From Blank uses, which is why it carries nothing
 * but a headline and a paragraph: a blank design should be the shortest
 * possible thing that is still a design.
 */
import type { SlideLayout } from '../types';
import {
  frameLogo,
  image,
  layout,
  rect,
  splitBody,
  standardFooter,
  standardHeader,
  text,
  threeRows,
} from './shared';

export const CONTENT_LAYOUTS: SlideLayout[] = [
  layout({
    id: 'plain',
    name: 'Plain',
    role: 'content',
    regions: threeRows(),
    slots: [
      ...standardHeader(),
      frameLogo(),
      text('headline', 'headline', {
        box: rect(0, 0, 100, 40),
        resizable: true,
        recommendedChars: 60,
      }),
      text('body', 'body', {
        box: rect(0, 46, 100, 54),
        colorRole: 'textMuted',
        recommendedChars: 320,
      }),
      ...standardFooter(),
    ],
  }),

  layout({
    id: 'content-eyebrow',
    name: 'Point With Eyebrow',
    role: 'content',
    regions: threeRows(),
    // A short rule under the eyebrow: the one piece of decoration this layout
    // has, and it is what makes an eyebrow read as a label rather than a line
    // of small text that got lost.
    decor: [{ kind: 'rule', region: 'body', box: rect(0, 10, 12, 0.9), colorRole: 'accent' }],
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
        box: rect(0, 14, 100, 38),
        resizable: true,
        recommendedChars: 56,
      }),
      text('body', 'body', {
        box: rect(0, 56, 100, 44),
        colorRole: 'textMuted',
        recommendedChars: 280,
      }),
      ...standardFooter(),
    ],
  }),

  layout({
    id: 'split-picture',
    name: 'Split Picture',
    role: 'content',
    regions: splitBody({ textWidth: 50, textHeight: 44, asideLabel: 'Picture' }),
    slots: [
      ...standardHeader(),
      frameLogo(),
      text('headline', 'headline', {
        box: rect(0, 0, 100, 46),
        resizable: true,
        recommendedChars: 48,
      }),
      text('body', 'body', {
        box: rect(0, 52, 100, 48),
        colorRole: 'textMuted',
        recommendedChars: 220,
      }),
      image({
        region: 'aside',
        box: rect(0, 0, 100, 100),
        radius: 4,
      }),
      ...standardFooter(),
    ],
  }),

  layout({
    id: 'split-panel',
    name: 'Split Panel',
    role: 'content',
    regions: splitBody({ textWidth: 54, textHeight: 50, asideFirst: true, asideLabel: 'Panel' }),
    // The panel itself: the whole of the side region, so it follows that
    // region when a portrait or a story stacks the two.
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
      text('eyebrow', 'eyebrow', {
        box: rect(0, 0, 100, 10),
        colorRole: 'accent',
        optional: true,
        recommendedChars: 24,
      }),
      text('headline', 'headline', {
        box: rect(0, 14, 100, 42),
        resizable: true,
        recommendedChars: 48,
      }),
      text('body', 'body', {
        box: rect(0, 60, 100, 40),
        colorRole: 'textMuted',
        recommendedChars: 200,
      }),
      // The panel's own words, on the surface colour rather than the ground.
      text('subheadline', 'subheadline', {
        region: 'aside',
        label: 'Panel Text',
        box: rect(10, 10, 80, 80),
        valign: 'center',
        colorRole: 'onSurface',
        recommendedChars: 120,
      }),
      ...standardFooter(),
    ],
  }),

  layout({
    id: 'picture-top',
    name: 'Picture First',
    role: 'content',
    regions: splitBody({ textHeight: 42, textWidth: 50, asideFirst: true, asideLabel: 'Picture' }),
    slots: [
      ...standardHeader(),
      frameLogo(),
      image({
        region: 'aside',
        box: rect(0, 0, 100, 100),
        radius: 4,
      }),
      text('headline', 'headline', {
        box: rect(0, 0, 100, 44),
        resizable: true,
        recommendedChars: 48,
      }),
      text('body', 'body', {
        box: rect(0, 50, 100, 50),
        colorRole: 'textMuted',
        recommendedChars: 200,
      }),
      ...standardFooter(),
    ],
  }),
];
