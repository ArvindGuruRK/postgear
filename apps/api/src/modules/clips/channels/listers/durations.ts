/**
 * The two ways the platforms write a video's length, read into whole
 * seconds. Pure; anything that does not match reads as unknown (null), and
 * the list shows a dash instead of a wrong number.
 *
 * - Twitch Helix: `3m21s`, `1h0m5s`, `45s`.
 * - YouTube Data API: ISO 8601 durations, `PT1H2M3S`, `P1DT2H`, `PT45.5S`.
 *   Live and upcoming videos say `P0D` or `PT0S`, which is 0.
 */

const HELIX = /^(?:(\d{1,5})h)?(?:(\d{1,5})m)?(?:(\d{1,5})s)?$/;
const ISO_8601 =
  /^P(?:(\d{1,5})D)?(?:T(?:(\d{1,5})H)?(?:(\d{1,5})M)?(?:(\d{1,7}(?:\.\d{1,6})?)S)?)?$/;

/** Helix's `duration` in seconds, or null. */
export function parseHelixDuration(text: unknown): number | null {
  if (typeof text !== 'string' || text.length === 0) return null;
  const match = HELIX.exec(text);
  if (!match || (match[1] === undefined && match[2] === undefined && match[3] === undefined)) {
    return null;
  }
  const [, hours = '0', minutes = '0', seconds = '0'] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

/** An ISO 8601 duration in whole seconds (rounded), or null. Years, months and weeks are not used for videos. */
export function parseIso8601Duration(text: unknown): number | null {
  if (typeof text !== 'string' || text.length < 3) return null;
  const match = ISO_8601.exec(text);
  if (!match || text.endsWith('T')) return null;
  const [, days, hours, minutes, seconds] = match;
  if (days === undefined && hours === undefined && minutes === undefined && seconds === undefined) {
    return null;
  }
  return Math.round(
    Number(days ?? 0) * 86_400 +
      Number(hours ?? 0) * 3_600 +
      Number(minutes ?? 0) * 60 +
      Number(seconds ?? 0),
  );
}
