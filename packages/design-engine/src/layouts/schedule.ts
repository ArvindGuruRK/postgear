/**
 * The stream schedule slide (Sprint 13, Module 14 section C1): a week of
 * streams on one picture, made by the Schedule Maker and edited in the
 * ordinary Studio editor.
 *
 * `schedule-week@1` has six slots:
 *
 * - `eyebrow`, a small line over the headline, hidden until asked for;
 * - `headline`, "Catch Me Live" in the presets, typed like any headline;
 * - `subheadline`, bound to the schedule's zone ("All times Asia/Kolkata",
 *   or "On a break until Mon 23 Nov"), so changing the zone changes it;
 * - `schedule`, the rows: one card per day, Monday to Sunday;
 * - `handle` and `logo`, optional, in the footer and the header.
 *
 * The header and the footer span the slide in every format. The rows fill
 * one column of seven in the square, the portrait and the story, each about
 * a ninth of the week's height plus its gap, and two columns in the
 * landscape (four days on the left, three on the right) with the headline
 * at the top left. Made for Portrait (1080 by 1350) and Landscape (1920 by
 * 1080), the two the Schedule Maker offers; drawn in the other two shapes
 * as well, so a schedule design can change format like any other.
 */
import type { LogoSpot, SlideLayout } from '../types';
import { layout, logo, rect, rows, text } from './shared';

/** The logo's two places: the header's right end, or the footer's. */
const HEADER_SPOT: LogoSpot = { region: 'header', box: rect(78, 0, 22, 100), align: 'end' };
const FOOTER_SPOT: LogoSpot = { region: 'footer', box: rect(80, 0, 20, 100), align: 'end' };

export const SCHEDULE_LAYOUTS: SlideLayout[] = [
  layout({
    id: 'schedule-week',
    name: 'Stream Week',
    role: 'schedule',
    regions: [
      { id: 'header', area: rect(0, 0, 100, 24) },
      { id: 'body', label: 'Schedule', area: rect(0, 27, 100, 64) },
      { id: 'footer', area: rect(0, 93, 100, 7) },
    ],
    slots: [
      logo({ spots: { header: HEADER_SPOT, footer: FOOTER_SPOT }, placement: 'header' }),
      text('eyebrow', 'eyebrow', {
        region: 'header',
        box: rect(0, 0, 74, 18),
        colorRole: 'primary',
        optional: true,
        defaultHidden: true,
        recommendedChars: 28,
      }),
      text('headline', 'headline', {
        region: 'header',
        box: rect(0, 18, 74, 50),
        valign: 'end',
        resizable: true,
        recommendedChars: 22,
      }),
      text('subheadline', 'subheadline', {
        region: 'header',
        label: 'Time Zone',
        box: rect(0, 70, 74, 30),
        valign: 'center',
        colorRole: 'textMuted',
        optional: true,
        alignable: false,
        recommendedChars: 40,
        bind: 'scheduleZone',
      }),
      rows({ box: rect(0, 0, 100, 100), columns: { landscape: 2 } }),
      text('handle', 'footer', {
        region: 'footer',
        box: rect(0, 0, 70, 100),
        valign: 'center',
        colorRole: 'textMuted',
        optional: true,
        alignable: false,
        recommendedChars: 24,
        bind: 'handle',
      }),
    ],
  }),
];
