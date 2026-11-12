/**
 * A day a state's own list has and the generic calendars miss, or name or date
 * differently. Written by hand, and every one checked against a source before it
 * went in: a date that could not be checked is left out, never guessed.
 */
export type CuratedDay = CuratedDate | CuratedYearlyDay;

/** A day that moves from year to year, so each year is its own entry. */
export interface CuratedDate {
  /** `YYYY-MM-DD` in the state's calendar. */
  date: string;
  name: string;
  /** False for a public holiday (a day off), true for a day worth posting about that is not one. */
  observance: boolean;
  /** The official list, or the reliable page the date was checked on. */
  source: string;
}

/** A day on the same date every year. */
export interface CuratedYearlyDay {
  /** `MM-DD`. */
  monthDay: string;
  name: string;
  observance: boolean;
  /** The first year it was kept. A year before this has no such day. */
  since?: number;
  source?: string;
}
