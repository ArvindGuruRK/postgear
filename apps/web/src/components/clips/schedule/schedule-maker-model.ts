/**
 * The Schedule Maker's pure half (Sprint 13, Module 14 section C4): which
 * week the page holds (read from Twitch, or typed by hand), the source the
 * new design keeps, the five theme cards' pictures and the body that opens
 * the design.
 */
import {
  applySchedule,
  type DesignDocument,
  documentFromPreset,
  SAMPLE_WEEK,
  SCHEDULE_PRESET_BY_THEME,
  SCHEDULE_THEMES,
  type ScheduleRow,
  type ScheduleSource,
  WEEKDAY_LABELS,
  withClock,
} from '@postgear/design-engine';
import {
  crowdedWarning,
  rowsFromAnswer,
  twitchSource,
} from '@/components/studio/schedule-field-model';
import type { ScheduleAnswer } from '@/types/studio-schedules';

export type MakerTab = 'twitch' | 'hand';

export const MAKER_TAB_NAMES: Readonly<Record<MakerTab, string>> = {
  twitch: 'From Twitch',
  hand: 'Fill It In By Hand',
};

/** The two shapes the maker offers (the editor can change it later like any design). */
export type MakerFormat = 'portrait' | 'landscape';

export const MAKER_FORMATS: readonly { value: MakerFormat; label: string; line: string }[] = [
  { value: 'portrait', label: 'Portrait', line: '1080 by 1350' },
  { value: 'landscape', label: 'Landscape', line: '1920 by 1080' },
];

/** The five looks, in the order the cards show them, with the template each opens. */
export const MAKER_THEMES: readonly { id: string; name: string; presetId: string }[] =
  SCHEDULE_THEMES.map((theme) => ({
    id: theme.id,
    name: theme.name,
    presetId: SCHEDULE_PRESET_BY_THEME[theme.id],
  }));

/** Seven days, each on, with nothing typed yet: where the by-hand tab starts. */
export function blankWeek(): ScheduleRow[] {
  return WEEKDAY_LABELS.map((day) => ({ day, time: '', title: '' }));
}

/** Try A Sample: `simstreamer`'s week, with no call, on the chosen clock. */
export function sampleWeek(hour12: boolean): ScheduleRow[] {
  return withClock(
    SAMPLE_WEEK.map((row) => ({ ...row })),
    hour12,
  );
}

export interface MakerInput {
  tab: MakerTab;
  timeZone: string;
  weekStart: string;
  hour12: boolean;
  /** The last Twitch answer, for the login and week now asked; null before one. */
  answer: ScheduleAnswer | null;
  handRows: readonly ScheduleRow[];
}

export interface MakerWeek {
  rows: ScheduleRow[];
  source: ScheduleSource;
  /** Twitch's 404: the page shows the note, and the design opens with seven Off rows. */
  noSchedule: boolean;
  /** The warning for a day with more streams than fit, or null. */
  crowded: string | null;
  /** False while the Twitch tab has read nothing yet: there is no week to open. */
  ready: boolean;
}

/** The week the page holds now. A zone or clock change reworks it with no call. */
export function makerWeek(input: MakerInput): MakerWeek {
  if (input.tab === 'twitch' && input.answer) {
    const week = rowsFromAnswer(input.answer, {
      timeZone: input.timeZone,
      hour12: input.hour12,
    });
    return {
      rows: week.rows,
      source: twitchSource(input.answer, {
        timeZone: input.timeZone,
        hour12: input.hour12,
        vacationUntil: week.vacationUntil,
      }),
      noSchedule: input.answer.noSchedule === true,
      crowded: crowdedWarning(week.rows),
      ready: true,
    };
  }

  const manual: ScheduleSource = {
    source: 'manual',
    login: null,
    timeZone: input.timeZone,
    weekStart: input.weekStart,
    fetchedAt: null,
    hour12: input.hour12,
  };
  if (input.tab === 'twitch') {
    // Nothing read yet: the cards show the sample week so there is something to choose from.
    return {
      rows: sampleWeek(input.hour12),
      source: manual,
      noSchedule: false,
      crowded: null,
      ready: false,
    };
  }
  const rows = input.handRows.map((row) => ({ ...row }));
  return { rows, source: manual, noSchedule: false, crowded: crowdedWarning(rows), ready: true };
}

/** A theme card's picture: the template in the shape, with the page's week on it. */
export function previewDocument(
  presetId: string,
  format: MakerFormat,
  week: Pick<MakerWeek, 'rows' | 'source'>,
): DesignDocument {
  let counter = 0;
  const document = documentFromPreset({
    presetId,
    format,
    newId: () => `preview-${presetId}-${++counter}`,
  });
  return applySchedule(document, { source: week.source, rows: week.rows });
}

/** `POST /studio/designs`: the template, the shape and the week. */
export function createDesignBody(
  presetId: string,
  format: MakerFormat,
  week: Pick<MakerWeek, 'rows' | 'source'>,
) {
  return { presetId, format, schedule: { source: week.source, rows: week.rows } };
}
