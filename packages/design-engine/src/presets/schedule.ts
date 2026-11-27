/**
 * The Schedule collection's templates (Sprint 13, Module 14 section C1): one
 * week of streams, `schedule-week@1`, in each of the five schedule themes.
 *
 * The Schedule Maker opens one of these with the person's own week written
 * over the sample (`applySchedule`), and the Studio gallery shows them under
 * the Schedule category like any other template. All five are free: neither
 * the themes nor the Aurora art Cool wears are premium, so `buildPresets`
 * leaves them unlocked.
 *
 * The sample week is the shape a streamer's week usually has (a day off, a
 * double on Friday) so the gallery card reads like a real schedule. The zone
 * line is the design's, worked out from its schedule, so a preset never
 * writes it; the handle is the design's too.
 */
import type { Preset, ScheduleRow } from '../types';
import { buildPresets, type PresetRow, type PresetShape } from './build';

/** A week as the gallery shows it before anyone fetches or types theirs. */
export const SAMPLE_WEEK: readonly ScheduleRow[] = [
  { day: 'Mon', time: '7 PM', title: 'Minecraft Hardcore' },
  { day: 'Tue', time: '', title: '', off: true },
  { day: 'Wed', time: '7 PM', title: 'Just Chatting' },
  { day: 'Thu', time: '8 PM', title: 'Viewer Games' },
  { day: 'Fri', time: '7 PM', title: 'Minecraft, 10 PM Chat' },
  { day: 'Sat', time: '3 PM', title: 'Variety Saturday' },
  { day: 'Sun', time: '', title: '', off: true },
];

const SHAPES: Record<string, PresetShape> = {
  'stream-week': {
    category: 'schedule',
    tags: ['stream', 'schedule', 'twitch', 'week', 'live'],
    slides: [
      {
        layoutId: 'schedule-week',
        text: { eyebrow: 'This week on stream', headline: 'Catch Me Live' },
        rows: { schedule: SAMPLE_WEEK.map((row) => ({ ...row })) },
      },
    ],
  },
};

const ROWS: PresetRow[] = [
  {
    id: 'schedule-week-clean-blue',
    name: 'Clean Blue Week',
    shape: 'stream-week',
    theme: 'schedule-clean-blue',
  },
  {
    id: 'schedule-week-light-blue',
    name: 'Light Blue Week',
    shape: 'stream-week',
    theme: 'schedule-light-blue',
  },
  {
    id: 'schedule-week-cool',
    name: 'Cool Week',
    shape: 'stream-week',
    theme: 'schedule-cool',
    art: 'aurora',
  },
  { id: 'schedule-week-dark', name: 'Dark Week', shape: 'stream-week', theme: 'schedule-dark' },
  { id: 'schedule-week-red', name: 'Red Week', shape: 'stream-week', theme: 'schedule-red' },
];

export const SCHEDULE_PRESETS: Preset[] = buildPresets('schedule', SHAPES, ROWS);

/**
 * The template the Schedule Maker opens for each theme, by theme id, in the
 * order its theme cards show them.
 */
export const SCHEDULE_PRESET_BY_THEME: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(SCHEDULE_PRESETS.map((preset) => [preset.themeId, preset.id])),
);
