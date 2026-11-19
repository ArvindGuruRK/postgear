/**
 * Reading FFmpeg's per-frame metadata print (`metadata=mode=print:file=...`
 * and `ametadata=...`), the form both signal filters write: a header line per
 * frame, then one `key=value` line per key.
 *
 *     frame:29   pts:46400   pts_time:2.9
 *     lavfi.r128.S=-46.976
 *
 * (FFmpeg 9.0.2, captured from `ebur128` and `scdet` on the generated
 * samples, 2026-11-19.) A value line before any frame line, or one that is
 * not a number, is skipped.
 */
import type { TimedValue } from '@postgear/video-engine';

const FRAME_LINE = /^frame:\s*\d+\s+pts:\s*-?\d+\s+pts_time:\s*(-?[\d.]+(?:e-?\d+)?)\s*$/;

/** The values of `key`, each at the time of the frame it follows. */
export function parseMetadataPrint(text: string, key: string): TimedValue[] {
  const prefix = `${key}=`;
  const out: TimedValue[] = [];
  let sec: number | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const frame = FRAME_LINE.exec(line);
    if (frame) {
      const time = Number(frame[1]);
      sec = Number.isFinite(time) ? time : null;
      continue;
    }
    if (sec === null || !line.startsWith(prefix)) continue;
    const value = Number(line.slice(prefix.length));
    if (Number.isFinite(value)) out.push({ sec, value });
  }
  return out;
}
