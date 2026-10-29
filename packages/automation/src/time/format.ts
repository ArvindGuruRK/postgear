/**
 * The `date` data format ("Date as 2026-11-03"): a small fixed pattern
 * language, the letters people know from spreadsheets. Anything that is
 * not a pattern letter is kept as written; quote words to keep letters
 * literal (`'at' HH:mm`).
 */
import { zonedTime } from './zone';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const DEFAULT_DATE_PATTERN = 'yyyy-MM-dd';

const PATTERN = /'([^']*)'|yyyy|yy|MMMM|MMM|MM|M|dd|d|EEEE|EEE|HH|H|hh|h|mm|ss|a/g;

const pad = (value: number) => String(value).padStart(2, '0');

/** `formatDate(ms, 'd MMM yyyy', 'Asia/Kolkata')` is "3 Nov 2026". */
export function formatDate(epochMs: number, pattern: string, timeZone = 'UTC'): string {
  const t = zonedTime(epochMs, timeZone);
  const hour12 = t.hour % 12 === 0 ? 12 : t.hour % 12;
  return pattern.replace(PATTERN, (token, quoted: string | undefined) => {
    if (quoted !== undefined) return quoted === '' ? "'" : quoted;
    switch (token) {
      case 'yyyy':
        return String(t.year).padStart(4, '0');
      case 'yy':
        return pad(t.year % 100);
      case 'MMMM':
        return MONTHS[t.month - 1];
      case 'MMM':
        return MONTHS[t.month - 1].slice(0, 3);
      case 'MM':
        return pad(t.month);
      case 'M':
        return String(t.month);
      case 'dd':
        return pad(t.day);
      case 'd':
        return String(t.day);
      case 'EEEE':
        return DAYS[t.weekday];
      case 'EEE':
        return DAYS[t.weekday].slice(0, 3);
      case 'HH':
        return pad(t.hour);
      case 'H':
        return String(t.hour);
      case 'hh':
        return pad(hour12);
      case 'h':
        return String(hour12);
      case 'mm':
        return pad(t.minute);
      case 'ss':
        return pad(t.second);
      default:
        return t.hour < 12 ? 'AM' : 'PM';
    }
  });
}
