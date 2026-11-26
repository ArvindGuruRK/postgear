/**
 * Who is speaking (Sprint 13, Module 08): which person Follow The Speaker
 * keeps in frame, stretch by stretch.
 *
 * There is no speaker model here; the speaker is worked out from what the
 * clip already has:
 * - one person in the stretch: they are the subject throughout;
 * - several: for each stretch of speech, each person seen in it is scored by
 *   how much their face box's height changes between pictures (the lower
 *   half moves when a mouth does; five a second), by size and by how central
 *   they are, and the highest wins. A winner keeps the frame through the
 *   silence after their words, until the next stretch someone else wins;
 * - no speech track (never listened to) or no words in the stretch: the
 *   largest face;
 * - more than `SPEAKER_MANY_PEOPLE`: `many`, so the editor asks whom to
 *   follow, and `pick` then makes that person the subject throughout.
 *
 * A subject's stretch shorter than `SPEAKER_JOIN_MS` is joined to a
 * neighbour, so a short "yeah" never flicks the frame. Nobody visible is a
 * `null` subject. This is the weakest part of the feature, kept in one file
 * with its numbers in `tuning.ts`, so a dedicated speaker model (Module 17)
 * can replace it without touching the camera path.
 *
 * Pass the people from `linkPeople` as they are, NOT smoothed: smoothing
 * takes out the very height changes the mouth measure reads. Pure.
 */
import { FACE_FILE_SAMPLE_FPS } from './face-file';
import type { Person, PersonBox } from './people';
import {
  MOUTH_NOISE_FLOOR,
  MOUTH_STEP_MAX_MS,
  SPEAKER_JOIN_MS,
  SPEAKER_MANY_PEOPLE,
  SPEAKER_WEIGHT_CENTRE,
  SPEAKER_WEIGHT_MOUTH,
  SPEAKER_WEIGHT_SIZE,
  SPEECH_JOIN_GAP_MS,
} from './tuning';

/** One stretch of the clip and who is followed in it (`null`: nobody visible). Ms of the video. */
export interface SubjectSpan {
  from: number;
  to: number;
  personId: string | null;
}

export type SpeakerChoice =
  | { kind: 'spans'; spans: SubjectSpan[]; people: Person[] }
  /** More than `SPEAKER_MANY_PEOPLE` people: the caller asks whom to follow (their boxes draw the thumbnails). */
  | { kind: 'many'; people: Person[] }
  /** Nobody found in the stretch. */
  | { kind: 'none' };

/** A stretch of speech, ms of the video. */
export interface SpeechStretch {
  from: number;
  to: number;
}

/** How long one face picture stands for, ms. */
const PICTURE_MS = 1000 / FACE_FILE_SAMPLE_FPS;

/**
 * The speech stretches of a transcript's words: words closer than
 * `joinGapMs` are one stretch. Keep the gap short (a breath), so two people's
 * turns are never one stretch.
 */
export function speechStretches(
  words: readonly { start: number; end: number }[],
  joinGapMs = SPEECH_JOIN_GAP_MS,
): SpeechStretch[] {
  const sorted = words
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .map((w) => ({ from: w.start, to: w.end }))
    .sort((a, b) => a.from - b.from);
  const out: SpeechStretch[] = [];
  for (const word of sorted) {
    const last = out[out.length - 1];
    if (last && word.from - last.to < joinGapMs) {
      last.to = Math.max(last.to, word.to);
    } else {
      out.push({ ...word });
    }
  }
  return out;
}

function boxesIn(person: Person, from: number, to: number): PersonBox[] {
  return person.boxes.filter((b) => b.t >= from && b.t < to);
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}

function length(span: SubjectSpan): number {
  return span.to - span.from;
}

/** Neighbours with the same subject made one, empty spans dropped. */
function mergeSame(spans: readonly SubjectSpan[]): SubjectSpan[] {
  const out: SubjectSpan[] = [];
  for (const span of spans) {
    if (span.to <= span.from) continue;
    const last = out[out.length - 1];
    if (last && last.personId === span.personId && last.to === span.from) {
      last.to = span.to;
    } else {
      out.push({ ...span });
    }
  }
  return out;
}

/** Spans shorter than `SPEAKER_JOIN_MS` given to a neighbour (the longer one), shortest first. */
function joinShort(input: readonly SubjectSpan[]): SubjectSpan[] {
  let spans = mergeSame(input);
  for (;;) {
    if (spans.length <= 1) return spans;
    let shortest = -1;
    for (let i = 0; i < spans.length; i += 1) {
      const span = spans[i] as SubjectSpan;
      if (
        length(span) < SPEAKER_JOIN_MS &&
        (shortest < 0 || length(span) < length(spans[shortest] as SubjectSpan))
      ) {
        shortest = i;
      }
    }
    if (shortest < 0) return spans;
    const span = spans[shortest] as SubjectSpan;
    const prev = spans[shortest - 1];
    const next = spans[shortest + 1];
    const into = !next || (prev && length(prev) >= length(next)) ? prev : next;
    const personId = into?.personId ?? null;
    spans = mergeSame(spans.map((s) => (s === span ? { ...s, personId } : s)));
  }
}

/** The stretch the person is in the picture: first seen to one picture after last seen. */
function visibleRange(person: Person): { from: number; to: number } {
  return { from: person.from, to: person.to + PICTURE_MS };
}

/** Each span cut down to when its subject is in the picture; the rest is `null`. */
function onlyWhenVisible(spans: readonly SubjectSpan[], people: readonly Person[]): SubjectSpan[] {
  const out: SubjectSpan[] = [];
  for (const span of spans) {
    const person = people.find((p) => p.id === span.personId);
    if (!person) {
      out.push({ ...span, personId: null });
      continue;
    }
    const seen = visibleRange(person);
    const from = Math.min(span.to, Math.max(span.from, seen.from));
    const to = Math.max(from, Math.min(span.to, seen.to));
    out.push({ from: span.from, to: from, personId: null });
    out.push({ from, to, personId: span.personId });
    out.push({ from: to, to: span.to, personId: null });
  }
  return mergeSame(out);
}

/** `person` followed from `fromMs` to `toMs`, `null` where they are not in the picture. */
export function soleSubject(person: Person, fromMs: number, toMs: number): SubjectSpan[] {
  return joinShort(onlyWhenVisible([{ from: fromMs, to: toMs, personId: person.id }], [person]));
}

interface Clues {
  person: Person;
  mouth: number;
  size: number;
  centre: number;
  presence: number;
}

/** What one person shows in a stretch of speech, or null when they are not seen in it. */
function cluesFor(person: Person, from: number, to: number): Clues | null {
  const boxes = boxesIn(person, from, to);
  if (boxes.length === 0) return null;
  const heights = boxes.map((b) => b.rect.h);
  const size = mean(heights);
  const steps: number[] = [];
  for (let i = 1; i < boxes.length; i += 1) {
    const a = boxes[i - 1] as PersonBox;
    const b = boxes[i] as PersonBox;
    if (b.t - a.t <= MOUTH_STEP_MAX_MS) steps.push(Math.abs(b.rect.h - a.rect.h));
  }
  const mouth = size > 0 ? mean(steps) / size : 0;
  const cx = mean(boxes.map((b) => b.rect.x + b.rect.w / 2));
  const centre = 1 - Math.min(1, Math.abs(cx - 0.5) * 2);
  const expected = Math.max(1, Math.round((to - from) / PICTURE_MS));
  return { person, mouth, size, centre, presence: Math.min(1, boxes.length / expected) };
}

/** Who speaks in one stretch, or null when nobody is seen in it. */
function speakerOf(people: readonly Person[], from: number, to: number): string | null {
  const clues = people.map((p) => cluesFor(p, from, to)).filter((c): c is Clues => c !== null);
  if (clues.length === 0) return null;
  const maxMouth = Math.max(...clues.map((c) => c.mouth));
  const maxSize = Math.max(...clues.map((c) => c.size), 1e-9);
  let best: { id: string; score: number; size: number } | null = null;
  for (const c of clues) {
    const mouth = maxMouth >= MOUTH_NOISE_FLOOR ? c.mouth / maxMouth : 0;
    const score =
      SPEAKER_WEIGHT_MOUTH * mouth +
      c.presence * (SPEAKER_WEIGHT_SIZE * (c.size / maxSize) + SPEAKER_WEIGHT_CENTRE * c.centre);
    if (
      !best ||
      score > best.score + 1e-9 ||
      (Math.abs(score - best.score) <= 1e-9 && c.size > best.size)
    ) {
      best = { id: c.person.id, score, size: c.size };
    }
  }
  return best?.id ?? null;
}

/** The largest face in the stretch (mean height while seen), then the one seen most. */
function largest(people: readonly Person[], fromMs: number, toMs: number): Person {
  const ranked = people
    .map((person) => {
      const boxes = boxesIn(person, fromMs, toMs);
      return { person, size: mean(boxes.map((b) => b.rect.h)), seen: boxes.length };
    })
    .sort((a, b) => b.size - a.size || b.seen - a.seen);
  return (ranked[0] as { person: Person }).person;
}

/** Owners from speech, or null when no stretch of speech has anyone in it. */
function bySpeech(
  people: readonly Person[],
  speech: readonly SpeechStretch[],
  fromMs: number,
  toMs: number,
): SubjectSpan[] | null {
  const stretches = speech
    .map((s) => ({ from: Math.max(fromMs, s.from), to: Math.min(toMs, s.to) }))
    .filter((s) => s.to > s.from)
    .sort((a, b) => a.from - b.from);
  const winners: Array<{ from: number; personId: string }> = [];
  for (const stretch of stretches) {
    const personId = speakerOf(people, stretch.from, stretch.to);
    if (personId !== null) winners.push({ from: stretch.from, personId });
  }
  if (winners.length === 0) return null;
  return winners.map((w, i) => ({
    from: i === 0 ? fromMs : w.from,
    to: winners[i + 1]?.from ?? toMs,
    personId: w.personId,
  }));
}

/**
 * Who to follow from `fromMs` to `toMs` (ms of the video). `speech` is the
 * speech stretches (`speechStretches` of the transcript's words), or `null`
 * when the video was never listened to. `pick` (a person's id, from the
 * many-faces picker) makes that person the subject throughout, whatever the
 * count. The spans cover `fromMs` to `toMs` exactly, in order, with no gap or
 * overlap.
 */
export function chooseSubjects(
  people: readonly Person[],
  input: {
    fromMs: number;
    toMs: number;
    speech: readonly SpeechStretch[] | null;
    pick?: string | null;
  },
): SpeakerChoice {
  const fromMs = Math.round(input.fromMs);
  const toMs = Math.round(input.toMs);
  if (!(toMs > fromMs)) return { kind: 'none' };
  const present = people.filter((p) => boxesIn(p, fromMs, toMs).length > 0);
  if (present.length === 0) return { kind: 'none' };

  const picked = input.pick ? present.find((p) => p.id === input.pick) : undefined;
  if (picked) {
    return { kind: 'spans', spans: soleSubject(picked, fromMs, toMs), people: present };
  }
  if (present.length > SPEAKER_MANY_PEOPLE) return { kind: 'many', people: present };
  if (present.length === 1) {
    const only = present[0] as Person;
    return { kind: 'spans', spans: soleSubject(only, fromMs, toMs), people: present };
  }

  const owners = input.speech ? bySpeech(present, input.speech, fromMs, toMs) : null;
  if (!owners) {
    const big = largest(present, fromMs, toMs);
    return { kind: 'spans', spans: soleSubject(big, fromMs, toMs), people: present };
  }
  const spans = joinShort(onlyWhenVisible(joinShort(owners), present));
  return { kind: 'spans', spans, people: present };
}
