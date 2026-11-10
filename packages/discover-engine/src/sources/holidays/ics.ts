/**
 * A small reader for iCalendar text, written for the holiday calendars Google
 * publishes (research 02, section 1.3). Those hold nothing but plain all-day
 * events: `DTSTART;VALUE=DATE`, `DTEND`, `SUMMARY`, `DESCRIPTION`, `UID`, and no
 * recurrence rule. `node-ical` would read them too, but it needs Node 22 and
 * this repo runs on 20.9, so the five properties are read here.
 *
 * It follows RFC 5545 where a calendar could trip a naive reader: long lines
 * arrive folded, a parameter can quote a colon, text escapes its commas, and an
 * event can hold an alarm with a description of its own. It does not expand
 * `RRULE`: if a calendar ever sends one, the event reads as its first day only.
 *
 * A calendar is a stranger's input, so this never throws. Whatever cannot be
 * read is left out.
 */
import { cleanText } from '../html-text';
import { isCalendarDate } from './dates';

export interface IcsEvent {
  uid?: string;
  /** The first day, `YYYY-MM-DD`, as the calendar wrote it. */
  start: string;
  /** As written, which for an all-day event is the day AFTER its last day. */
  end?: string;
  /** Unescaped, otherwise untouched. Empty when the event has none. */
  summary: string;
  /** Unescaped, so its line breaks are real ones. Empty when the event has none. */
  description: string;
}

interface ContentLine {
  /** Upper case, without its parameters: `DTSTART` for `DTSTART;VALUE=DATE`. */
  name: string;
  value: string;
}

/**
 * `NAME;PARAM=...:value`. The value starts at the first colon outside quotes,
 * because a parameter may quote one: `DTSTART;TZID="GMT+05:30":2026...`.
 */
function splitLine(line: string): ContentLine | null {
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ':' && !quoted) {
      const name = line.slice(0, i).split(';', 1)[0].trim().toUpperCase();
      return name ? { name, value: line.slice(i + 1) } : null;
    }
  }
  return null;
}

/**
 * Every content line, unfolded. A line break is CRLF by the standard, but LF and
 * a lone CR turn up too. A break followed by a space or a tab is not a break at
 * all: it is where a long line was folded, and both characters go.
 */
function contentLines(body: string): ContentLine[] {
  const text = body
    .replace(/^\u{FEFF}/u, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '');
  return text.split('\n').flatMap((line) => splitLine(line) ?? []);
}

/** One pass, so an escaped backslash before an `n` stays a backslash and an `n`. */
function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_match, ch: string) =>
    ch === 'n' || ch === 'N' ? '\n' : ch,
  );
}

/** `20261108` and `20261108T183000Z` both read as the day they are written on. */
function readDate(value: string): string | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T|$)/.exec(value.trim());
  if (!match) return undefined;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return isCalendarDate(date) ? date : undefined;
}

/**
 * The events of a calendar, in the order it lists them. An event with no
 * readable start is left out, and so is one the body ends in the middle of.
 */
export function parseIcs(body: string): IcsEvent[] {
  if (typeof body !== 'string') return [];

  const events: IcsEvent[] = [];
  let open: Partial<IcsEvent> | null = null;
  // How deep inside the open event we are: an alarm has a description of its own.
  let nested = 0;

  for (const { name, value } of contentLines(body)) {
    if (name === 'BEGIN' || name === 'END') {
      const isEvent = value.trim().toUpperCase() === 'VEVENT';

      if (name === 'BEGIN' && isEvent) {
        open = {};
        nested = 0;
      } else if (name === 'BEGIN') {
        if (open) nested += 1;
      } else if (!isEvent) {
        if (nested > 0) nested -= 1;
      } else {
        if (open?.start) {
          events.push({
            ...(open.uid ? { uid: open.uid } : {}),
            start: open.start,
            ...(open.end ? { end: open.end } : {}),
            summary: open.summary ?? '',
            description: open.description ?? '',
          });
        }
        open = null;
        nested = 0;
      }
      continue;
    }

    if (!open || nested > 0) continue;

    // A property is allowed once in an event. If one repeats, the first stands.
    if (name === 'DTSTART') open.start ??= readDate(value);
    else if (name === 'DTEND') open.end ??= readDate(value);
    else if (name === 'SUMMARY') open.summary ??= unescapeText(value).trim();
    else if (name === 'DESCRIPTION') open.description ??= unescapeText(value).trim();
    else if (name === 'UID') open.uid ??= value.trim();
  }

  return events;
}

/**
 * What the calendar calls itself (`X-WR-CALNAME`, "Holidays in India"), or null.
 * It is how an id in the table is checked against the country it stands for.
 */
export function calendarName(body: string): string | null {
  if (typeof body !== 'string') return null;
  const line = contentLines(body).find((entry) => entry.name === 'X-WR-CALNAME');
  return (line && cleanText(unescapeText(line.value))) || null;
}
