/**
 * Follow The Speaker on the `two-speakers` sample (Module 08): the same face
 * boxes the simulated detector records
 * (`apps/media/src/postgear_media/providers/vision/simulated_faces.py`,
 * mirrored here exactly) and the sample's recorded transcript, so the frame
 * is checked against the plan's turn times.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CropKeyframe } from '../document/schema';
import { cropAt } from '../render/frame-state';
import { followPath } from './path';
import { type FaceBoxInput, type FacePictureInput, linkPeople } from './people';
import { chooseSubjects, speechStretches } from './speaker';
import { FOLLOW_CUT_MS } from './tuning';

const ROOT = join(__dirname, '../../../..');
const PLAN = JSON.parse(
  readFileSync(join(ROOT, 'packages/media-tools/fixtures/samples/plan.json'), 'utf8'),
).twoSpeakers as {
  durationSec: number;
  width: number;
  height: number;
  speakers: Array<{
    id: string;
    centreX: number;
    centreY: number;
    faceWidth: number;
    faceHeight: number;
  }>;
  turns: Array<{ speaker: string; startSec: number; endSec: number }>;
};
const WORDS = (
  JSON.parse(
    readFileSync(
      join(ROOT, 'apps/media/src/postgear_media/simulation/transcripts/two-speakers.json'),
      'utf8',
    ),
  ) as { words: Array<{ start: number; end: number }> }
).words;

// The Python recording's numbers (simulated_faces.py).
const NAME = 'two-speakers';
const RATE_MS = 200;
const DROPOUT_EVERY = 157;
const DROPOUT_PICTURES = 3;
const MOUTH_MOVE = 0.04;
const LOST_SPEAKER = { speaker: 0, from: 60_000, to: 63_000 };

function round(value: number, places: number): number {
  const k = 10 ** places;
  return Math.round(value * k) / k;
}

function wobble(index: number, salt: number): number {
  const digest = createHash('sha256').update(`${NAME}:${salt}:${index}`).digest();
  return (((digest[0] as number) % 41) - 20) / 20;
}

function talking(speaker: number, t: number): boolean {
  const id = PLAN.speakers[speaker]?.id;
  return PLAN.turns.some(
    (turn) => turn.speaker === id && turn.startSec * 1000 <= t && t < turn.endSec * 1000,
  );
}

function recorded(t: number): FaceBoxInput[] {
  const index = Math.floor(t / RATE_MS);
  const out: FaceBoxInput[] = [];
  PLAN.speakers.forEach((s, salt) => {
    if ((index + salt * 61) % DROPOUT_EVERY < DROPOUT_PICTURES) return;
    if (salt === LOST_SPEAKER.speaker && t >= LOST_SPEAKER.from && t < LOST_SPEAKER.to) return;
    const { centreX: cx, centreY: cy, faceWidth: w, faceHeight: h } = s;
    const x = cx - w / 2 + wobble(index, salt) * 0.003;
    const y = cy - h / 2 + wobble(index, salt + 7) * 0.003;
    const tall = talking(salt, t) ? round(h * (1 + wobble(index, salt + 29) * MOUTH_MOVE), 4) : h;
    out.push({
      x: round(Math.min(Math.max(x, 0), 1 - w), 4),
      y: round(Math.min(Math.max(y, 0), 1 - tall), 4),
      w,
      h: tall,
      score: round(0.9 + wobble(index, salt + 13) * 0.05, 3),
    });
  });
  return out;
}

function cutsOf(keys: readonly CropKeyframe[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < keys.length; i += 1) {
    const a = keys[i - 1] as CropKeyframe;
    const b = keys[i] as CropKeyframe;
    if (b.at - a.at === FOLLOW_CUT_MS && a.rect.x !== b.rect.x) out.push(b.at);
  }
  return out;
}

describe('Follow The Speaker on the two-speakers sample', () => {
  const toMs = PLAN.durationSec * 1000;
  const frames: FacePictureInput[] = [];
  for (let t = 0; t < toMs; t += RATE_MS) frames.push({ t, boxes: recorded(t) });
  const people = linkPeople(frames);
  const choice = chooseSubjects(people, {
    fromMs: 0,
    toMs,
    speech: speechStretches(WORDS),
  });
  /** The turns where the speaker changes, ms. */
  const turnStarts = PLAN.turns
    .filter((turn, i) => i > 0 && turn.speaker !== PLAN.turns[i - 1]?.speaker)
    .map((turn) => turn.startSec * 1000);

  it('sees two people', () => {
    expect(people).toHaveLength(2);
  });

  it('switches subject at every turn, within half a second', () => {
    if (choice.kind !== 'spans') throw new Error(choice.kind);
    const switches = choice.spans.slice(1).map((s) => s.from);
    expect(switches).toHaveLength(turnStarts.length);
    switches.forEach((at, i) => {
      expect(Math.abs(at - (turnStarts[i] as number))).toBeLessThanOrEqual(500);
    });
    // Each span's subject sits where the plan's speaker of that turn sits.
    for (const turn of PLAN.turns) {
      const mid = ((turn.startSec + turn.endSec) / 2) * 1000;
      const span = choice.spans.find((s) => s.from <= mid && mid < s.to);
      const person = people.find((p) => p.id === span?.personId);
      const x = (person?.boxes[0]?.rect.x ?? 0) + 0.1;
      const planned = PLAN.speakers.find((s) => s.id === turn.speaker)?.centreX ?? -1;
      expect(Math.abs(x - planned)).toBeLessThan(0.05);
    }
  });

  it('cuts the tall frame at each turn and reports the lost speaker', () => {
    if (choice.kind !== 'spans') throw new Error(choice.kind);
    const { keyframes, lost } = followPath(people, choice.spans, [], {
      aspect: 1080 / 1920,
      video: { width: PLAN.width, height: PLAN.height },
    });
    const cuts = cutsOf(keyframes);
    expect(cuts).toHaveLength(turnStarts.length);
    cuts.forEach((at, i) => {
      expect(Math.abs(at - (turnStarts[i] as number))).toBeLessThanOrEqual(500);
    });
    // The frame shows the speaker's face in the middle of each turn.
    for (const turn of PLAN.turns) {
      const crop = cropAt(keyframes, ((turn.startSec + turn.endSec) / 2) * 1000);
      const planned = PLAN.speakers.find((s) => s.id === turn.speaker)?.centreX ?? -1;
      expect(crop.x).toBeLessThan(planned - 0.1);
      expect(crop.x + crop.w).toBeGreaterThan(planned + 0.1);
    }
    // Within a few pictures (a short dropout may sit next to it).
    expect(lost).toHaveLength(1);
    expect(Math.abs((lost[0]?.from ?? 0) - LOST_SPEAKER.from)).toBeLessThanOrEqual(600);
    expect(Math.abs((lost[0]?.to ?? 0) - LOST_SPEAKER.to)).toBeLessThanOrEqual(600);
    // While lost, the frame holds on where the speaker was.
    expect(cropAt(keyframes, 61_500)).toEqual(cropAt(keyframes, 59_000));
    expect(keyframes.length).toBeLessThan(120);
  });
});
