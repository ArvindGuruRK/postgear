import {
  designDocumentSchema,
  emptyWeek,
  SAMPLE_WEEK,
  scheduleRowsOf,
} from '@postgear/design-engine';
import type { ScheduleAnswer } from '@/types/studio-schedules';
import {
  blankWeek,
  createDesignBody,
  MAKER_FORMATS,
  MAKER_TAB_NAMES,
  MAKER_THEMES,
  makerWeek,
  previewDocument,
  sampleWeek,
} from './schedule-maker-model';

const ANSWER: ScheduleAnswer = {
  broadcaster: { login: 'simstreamer', displayName: 'SimStreamer' },
  segments: [
    {
      start: '2026-11-23T13:30:00.000Z',
      end: '2026-11-23T16:30:00.000Z',
      title: 'Minecraft',
      category: 'Minecraft',
      canceledUntil: null,
      recurring: true,
    },
  ],
  vacation: null,
  fetchedAt: '2026-11-26T10:00:00.000Z',
  weekStart: '2026-11-23',
};

const BASE = {
  timeZone: 'Asia/Kolkata',
  weekStart: '2026-11-23',
  hour12: true,
  answer: null,
  handRows: blankWeek(),
};

describe('the maker', () => {
  it('offers the two tabs, the two shapes and the five looks', () => {
    expect(Object.values(MAKER_TAB_NAMES)).toEqual(['From Twitch', 'Fill It In By Hand']);
    expect(MAKER_FORMATS.map((format) => [format.label, format.line])).toEqual([
      ['Portrait', '1080 by 1350'],
      ['Landscape', '1920 by 1080'],
    ]);
    expect(MAKER_THEMES.map((theme) => [theme.name, theme.presetId])).toEqual([
      ['Clean Blue', 'schedule-week-clean-blue'],
      ['Light Blue', 'schedule-week-light-blue'],
      ['Cool', 'schedule-week-cool'],
      ['Dark', 'schedule-week-dark'],
      ['Red', 'schedule-week-red'],
    ]);
  });

  it('has no week to open on the Twitch tab before a read, and shows the sample', () => {
    const week = makerWeek({ ...BASE, tab: 'twitch' });
    expect(week.ready).toBe(false);
    expect(week.rows).toEqual(SAMPLE_WEEK);
  });

  it('turns a read into rows in the zone, and reworks them for another zone with no call', () => {
    const kolkata = makerWeek({ ...BASE, tab: 'twitch', answer: ANSWER });
    expect(kolkata.ready).toBe(true);
    expect(kolkata.rows[0]).toEqual({ day: 'Mon', time: '7 PM', title: 'Minecraft' });
    expect(kolkata.source).toMatchObject({ source: 'twitch', login: 'simstreamer' });

    const london = makerWeek({ ...BASE, tab: 'twitch', answer: ANSWER, timeZone: 'Europe/London' });
    expect(london.rows[0]).toEqual({ day: 'Mon', time: '1:30 PM', title: 'Minecraft' });
    expect(london.source.timeZone).toBe('Europe/London');
  });

  it('turns no schedule into seven Off rows and the note', () => {
    const week = makerWeek({
      ...BASE,
      tab: 'twitch',
      answer: { ...ANSWER, segments: [], noSchedule: true },
    });
    expect(week.noSchedule).toBe(true);
    expect(week.rows).toEqual(emptyWeek());
    expect(week.ready).toBe(true);
  });

  it('keeps the typed rows on the by-hand tab, with a by-hand source', () => {
    const week = makerWeek({ ...BASE, tab: 'hand', handRows: sampleWeek(false) });
    expect(week.source).toMatchObject({ source: 'manual', login: null, hour12: true });
    expect(week.rows[0]).toEqual({ day: 'Mon', time: '19:00', title: 'Minecraft Hardcore' });
  });

  it('draws each card as a valid design with the week on it, in both shapes', () => {
    const week = makerWeek({ ...BASE, tab: 'hand', handRows: sampleWeek(true) });
    for (const theme of MAKER_THEMES) {
      for (const format of ['portrait', 'landscape'] as const) {
        const document = previewDocument(theme.presetId, format, week);
        expect(document.format).toBe(format);
        expect(scheduleRowsOf(document)).toEqual(SAMPLE_WEEK);
        expect(designDocumentSchema.safeParse(document).success).toBe(true);
      }
    }
  });

  it('opens the design with the template, the shape and the week', () => {
    const week = makerWeek({ ...BASE, tab: 'hand', handRows: blankWeek() });
    expect(createDesignBody('schedule-week-red', 'landscape', week)).toEqual({
      presetId: 'schedule-week-red',
      format: 'landscape',
      schedule: { source: week.source, rows: week.rows },
    });
  });
});
