/**
 * Times as people read them. One file, so the video card, the clip card, the
 * timeline and the API's sentences all write a length the same way.
 *
 * Every formatter floors: a 42.9 second clip reads "0:42", like every video
 * player. A time that is negative or not a number reads as zero.
 */

function safeMs(ms: number): number {
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

/**
 * A video's length in words, for cards: "3 h 42 min", "3 h", "58 min", and
 * "42 s" under a minute.
 */
export function formatVideoLength(ms: number): string {
  const safe = safeMs(ms);
  const totalMinutes = Math.floor(safe / 60_000);
  if (totalMinutes < 1) {
    return `${Math.floor(safe / 1000)} s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/** A clip's length as a clock: "0:42", "12:05", "1:02:05". */
export function formatClipLength(ms: number): string {
  const totalSeconds = Math.floor(safeMs(ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(seconds)}` : `${minutes}:${pad2(seconds)}`;
}

/** A playhead position with tenths, for the timeline: "0:12.4", "1:02:05.3". */
export function formatTimecode(ms: number): string {
  const safe = safeMs(ms);
  const tenths = Math.floor((safe % 1000) / 100);
  return `${formatClipLength(safe)}.${tenths}`;
}
