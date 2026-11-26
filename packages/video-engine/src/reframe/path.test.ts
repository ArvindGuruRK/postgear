import { MAX_CROP_KEYFRAMES } from '../document/limits';
import type { CropKeyframe } from '../document/schema';
import { cropAt } from '../render/frame-state';
import { type FollowArea, followBoth, followPath } from './path';
import { type FaceBoxInput, type FacePictureInput, linkPeople, type Person } from './people';
import { chooseSubjects, type SubjectSpan, soleSubject, speechStretches } from './speaker';
import {
  FOLLOW_CUT_MS,
  FOLLOW_LOST_REPORT_MS,
  FOLLOW_MAX_SPEED,
  FOLLOW_REDUCE_TOLERANCE,
  SPEAKER_JOIN_MS,
} from './tuning';

const STEP = 200;
const VIDEO = { width: 1280, height: 720 };
/** A full 9:16 area (Fullscreen on a Vertical clip). */
const TALL: FollowArea = { aspect: 1080 / 1920, video: VIDEO };

function box(cx: number, cy: number, w: number, h: number, score = 0.9): FaceBoxInput {
  return { x: cx - w / 2, y: cy - h / 2, w, h, score };
}

function pictures(
  fromMs: number,
  toMs: number,
  at: (t: number) => FaceBoxInput[],
): FacePictureInput[] {
  const out: FacePictureInput[] = [];
  for (let t = fromMs; t < toMs; t += STEP) out.push({ t, boxes: at(t) });
  return out;
}

/** A steady pseudo-random number from -0.5 to 0.5, never random. */
function noise(t: number, salt: number): number {
  const v = Math.sin((t / STEP) * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v) - 0.5;
}

function only(people: Person[]): Person {
  expect(people).toHaveLength(1);
  return people[0] as Person;
}

/** The cuts of a path: the times where a keyframe follows another `FOLLOW_CUT_MS` later with another crop. */
function cutsOf(keys: readonly CropKeyframe[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < keys.length; i += 1) {
    const a = keys[i - 1] as CropKeyframe;
    const b = keys[i] as CropKeyframe;
    if (b.at - a.at === FOLLOW_CUT_MS && (a.rect.x !== b.rect.x || a.rect.y !== b.rect.y)) {
      out.push(b.at);
    }
  }
  return out;
}

function expectValidPath(keys: readonly CropKeyframe[]): void {
  expect(keys.length).toBeGreaterThan(0);
  expect(keys.length).toBeLessThanOrEqual(MAX_CROP_KEYFRAMES);
  const first = keys[0] as CropKeyframe;
  keys.forEach((k, i) => {
    expect(Number.isInteger(k.at)).toBe(true);
    if (i > 0) expect(k.at).toBeGreaterThan((keys[i - 1] as CropKeyframe).at);
    // One crop size for the whole path: only x and y move.
    expect(k.rect.w).toBe(first.rect.w);
    expect(k.rect.h).toBe(first.rect.h);
    expect(k.rect.x).toBeGreaterThanOrEqual(0);
    expect(k.rect.y).toBeGreaterThanOrEqual(0);
    expect(k.rect.x + k.rect.w).toBeLessThanOrEqual(1 + 1e-6);
    expect(k.rect.y + k.rect.h).toBeLessThanOrEqual(1 + 1e-6);
  });
}

describe('chooseSubjects', () => {
  const two = (talker: (t: number) => 0 | 1 | null) =>
    linkPeople(
      pictures(0, 30_000, (t) =>
        [0.3, 0.7].map((cx, i) => {
          const talking = talker(t) === i;
          return box(cx, 0.4, 0.15, 0.27 * (talking ? 1 + 0.08 * noise(t, i) : 1));
        }),
      ),
    );

  it('follows one person throughout', () => {
    const people = linkPeople(pictures(0, 10_000, () => [box(0.5, 0.4, 0.15, 0.27)]));
    const choice = chooseSubjects(people, { fromMs: 0, toMs: 10_000, speech: null });
    expect(choice).toEqual({
      kind: 'spans',
      spans: [{ from: 0, to: 10_000, personId: 'person-1' }],
      people,
    });
  });

  it('gives each stretch of speech to the person whose mouth moves', () => {
    const talker = (t: number) => (t < 12_000 ? 0 : 1);
    const people = two(talker);
    const speech = [
      { from: 1_000, to: 5_000 },
      { from: 6_000, to: 11_000 },
      { from: 12_200, to: 20_000 },
      { from: 21_000, to: 29_000 },
    ];
    const choice = chooseSubjects(people, { fromMs: 0, toMs: 30_000, speech });
    if (choice.kind !== 'spans') throw new Error(choice.kind);
    const left = people.find((p) => (p.boxes[0]?.rect.x ?? 0) < 0.5)?.id;
    const right = people.find((p) => (p.boxes[0]?.rect.x ?? 0) > 0.5)?.id;
    expect(choice.spans).toEqual([
      { from: 0, to: 12_200, personId: left },
      { from: 12_200, to: 30_000, personId: right },
    ]);
  });

  it('joins a short "yeah" to its neighbours', () => {
    const talker = (t: number) => (t >= 10_000 && t < 10_800 ? 1 : 0);
    const people = two(talker);
    const speech = [
      { from: 1_000, to: 9_800 },
      { from: 10_000, to: 10_800 },
      { from: 11_000, to: 29_000 },
    ];
    const choice = chooseSubjects(people, { fromMs: 0, toMs: 30_000, speech });
    if (choice.kind !== 'spans') throw new Error(choice.kind);
    expect(choice.spans).toHaveLength(1);
    expect(choice.spans[0]).toMatchObject({ from: 0, to: 30_000 });
    expect(SPEAKER_JOIN_MS).toBeGreaterThan(800);
  });

  it('falls back to the largest face with no speech track', () => {
    const people = linkPeople(
      pictures(0, 10_000, () => [box(0.3, 0.4, 0.1, 0.18), box(0.7, 0.4, 0.15, 0.27)]),
    );
    const choice = chooseSubjects(people, { fromMs: 0, toMs: 10_000, speech: null });
    if (choice.kind !== 'spans') throw new Error(choice.kind);
    const big = people.find((p) => p.avgSize > 0.2)?.id;
    expect(choice.spans).toEqual([{ from: 0, to: 10_000, personId: big }]);
  });

  it('asks whom to follow with five people, and a pick follows that person', () => {
    const people = linkPeople(
      pictures(0, 10_000, () => [0.1, 0.3, 0.5, 0.7, 0.9].map((cx) => box(cx, 0.4, 0.08, 0.14))),
    );
    expect(people).toHaveLength(5);
    const many = chooseSubjects(people, { fromMs: 0, toMs: 10_000, speech: null });
    expect(many.kind).toBe('many');
    if (many.kind === 'many') expect(many.people).toHaveLength(5);
    const picked = chooseSubjects(people, {
      fromMs: 0,
      toMs: 10_000,
      speech: null,
      pick: 'person-3',
    });
    expect(picked).toMatchObject({
      kind: 'spans',
      spans: [{ from: 0, to: 10_000, personId: 'person-3' }],
    });
  });

  it('answers none with nobody, and null where the subject is not in the picture', () => {
    expect(chooseSubjects([], { fromMs: 0, toMs: 10_000, speech: null })).toEqual({
      kind: 'none',
    });
    const late = linkPeople(pictures(4_000, 10_000, () => [box(0.5, 0.4, 0.15, 0.27)]));
    const choice = chooseSubjects(late, { fromMs: 0, toMs: 10_000, speech: [] });
    if (choice.kind !== 'spans') throw new Error(choice.kind);
    expect(choice.spans).toEqual([
      { from: 0, to: 4_000, personId: null },
      { from: 4_000, to: 10_000, personId: 'person-1' },
    ]);
  });

  it('makes speech stretches from words, a breath apart', () => {
    expect(
      speechStretches([
        { start: 0, end: 300 },
        { start: 400, end: 900 },
        { start: 2_000, end: 2_500 },
      ]),
    ).toEqual([
      { from: 0, to: 900 },
      { from: 2_000, to: 2_500 },
    ]);
  });
});

describe('followPath', () => {
  it('gives a still face at most two keyframes, all one crop', () => {
    const person = only(
      linkPeople(
        pictures(0, 20_000, (t) => [
          box(0.5 + 0.002 * noise(t, 1), 0.4 + 0.002 * noise(t, 2), 0.15, 0.27),
        ]),
      ),
    );
    const { keyframes, lost } = followPath([person], soleSubject(person, 0, 20_000), [], TALL);
    expectValidPath(keyframes);
    expect(keyframes.length).toBeLessThanOrEqual(2);
    expect(new Set(keyframes.map((k) => k.rect.x)).size).toBe(1);
    expect(lost).toEqual([]);
    // The face is a third of the crop's height, and the crop has the area's shape.
    const rect = (keyframes[0] as CropKeyframe).rect;
    expect(rect.h).toBeCloseTo(0.27 * 3, 2);
    expect((rect.w * 16) / 9 / rect.h).toBeCloseTo(1080 / 1920, 5);
  });

  it('does not move for small jitter (the dead zone)', () => {
    const person = only(
      linkPeople(pictures(0, 20_000, (t) => [box(0.5 + 0.02 * noise(t, 3), 0.4, 0.15, 0.27)])),
    );
    const { keyframes } = followPath([person], soleSubject(person, 0, 20_000), [], TALL);
    expect(new Set(keyframes.map((k) => k.rect.x)).size).toBe(1);
  });

  it('follows a walk smoothly, never faster than the speed cap', () => {
    for (const speed of [0.02, 0.6]) {
      const person = only(
        linkPeople(
          pictures(0, 20_000, (t) => {
            const cx = Math.min(0.85, 0.15 + (speed * t) / 1000);
            return [box(cx + 0.003 * noise(t, 4), 0.4, 0.1, 0.2)];
          }),
        ),
      );
      const last = Math.min(0.85, 0.15 + speed * 19.8);
      const { keyframes } = followPath([person], soleSubject(person, 0, 20_000), [], TALL);
      expectValidPath(keyframes);
      expect(cutsOf(keyframes)).toEqual([]);
      for (let i = 1; i < keyframes.length; i += 1) {
        const a = keyframes[i - 1] as CropKeyframe;
        const b = keyframes[i] as CropKeyframe;
        const perSecond = Math.abs(b.rect.x - a.rect.x) / ((b.at - a.at) / 1000);
        expect(perSecond).toBeLessThanOrEqual(FOLLOW_MAX_SPEED + 1e-4);
      }
      // It gets there: the face ends inside the crop.
      const end = (keyframes[keyframes.length - 1] as CropKeyframe).rect;
      expect(last).toBeGreaterThan(end.x);
      expect(last).toBeLessThan(end.x + end.w);
    }
  });

  it('cuts (two keyframes 1 ms apart) when the speaker changes', () => {
    const people = linkPeople(
      pictures(0, 20_000, () => [box(0.2, 0.4, 0.15, 0.27), box(0.8, 0.4, 0.15, 0.27)]),
    );
    const left = people.find((p) => (p.boxes[0]?.rect.x ?? 0) < 0.5) as Person;
    const right = people.find((p) => (p.boxes[0]?.rect.x ?? 0) > 0.5) as Person;
    const spans: SubjectSpan[] = [
      { from: 0, to: 10_000, personId: left.id },
      { from: 10_000, to: 20_000, personId: right.id },
    ];
    const { keyframes } = followPath(people, spans, [], TALL);
    expectValidPath(keyframes);
    expect(cutsOf(keyframes)).toEqual([10_000]);
    expect(cropAt(keyframes, 9_000).x).toBeLessThan(0.3);
    expect(cropAt(keyframes, 11_000).x).toBeGreaterThan(0.5);
  });

  it('cuts at a scene cut instead of panning', () => {
    const person = only(
      linkPeople(pictures(0, 20_000, (t) => [box(t < 10_000 ? 0.4 : 0.5, 0.4, 0.15, 0.27)])),
    );
    const spans = soleSubject(person, 0, 20_000);
    const panned = followPath([person], spans, [], TALL).keyframes;
    expect(cutsOf(panned)).toEqual([]);
    const cut = followPath([person], spans, [10_000], TALL).keyframes;
    expect(cutsOf(cut)).toEqual([10_000]);
  });

  it('holds where the subject is lost and reports the stretch', () => {
    const person = only(
      linkPeople(
        pictures(0, 20_000, (t) => (t >= 8_000 && t < 12_000 ? [] : [box(0.5, 0.4, 0.15, 0.27)])),
      ),
    );
    const { keyframes, lost } = followPath([person], soleSubject(person, 0, 20_000), [], TALL);
    expect(lost).toEqual([{ from: 8_000, to: 12_000 }]);
    expect(cropAt(keyframes, 10_000)).toEqual(cropAt(keyframes, 7_000));
    // A stretch with nobody (a null span) holds too.
    const spans: SubjectSpan[] = [
      { from: 0, to: 5_000, personId: person.id },
      { from: 5_000, to: 7_000, personId: null },
      { from: 7_000, to: 8_000, personId: person.id },
    ];
    const held = followPath([person], spans, [], TALL);
    expect(held.lost).toEqual([{ from: 5_000, to: 7_000 }]);
    expect(FOLLOW_LOST_REPORT_MS).toBeLessThan(2_000);
  });

  it('lets a hand fix replace its range, with a cut at each end', () => {
    const person = only(linkPeople(pictures(0, 20_000, () => [box(0.5, 0.4, 0.15, 0.27)])));
    const spans = soleSubject(person, 0, 20_000);
    const plain = followPath([person], spans, [], TALL).keyframes;
    const size = (plain[0] as CropKeyframe).rect;
    const { keyframes } = followPath([person], spans, [], TALL, {
      overrides: [{ from: 5_000, to: 8_000, rect: { x: 0, y: 0, w: 0.3, h: 0.5 } }],
    });
    expectValidPath(keyframes);
    expect(cutsOf(keyframes)).toEqual([5_000, 8_000]);
    // The box keeps its centre and takes the path's size.
    expect(cropAt(keyframes, 6_000).x).toBeCloseTo(Math.max(0, 0.15 - size.w / 2), 5);
    expect(cropAt(keyframes, 4_000)).toEqual(cropAt(plain, 4_000));
    expect(cropAt(keyframes, 9_000)).toEqual(cropAt(plain, 9_000));
  });

  it('reduces within tolerance, and never past the keyframe cap', () => {
    const wander = (t: number) => 0.5 + 0.25 * Math.sin(t / 3_000) + 0.01 * noise(t, 5);
    const person = only(linkPeople(pictures(0, 60_000, (t) => [box(wander(t), 0.4, 0.1, 0.18)])));
    const spans = soleSubject(person, 0, 60_000);
    const full = followPath([person], spans, [], TALL, { tolerance: 0 }).keyframes;
    const reduced = followPath([person], spans, [], TALL).keyframes;
    expect(reduced.length).toBeLessThan(full.length);
    // Three wide swings a minute (a restless subject): tens of keyframes, not hundreds.
    expect(reduced.length).toBeLessThan(80);
    for (const k of full) {
      expect(Math.abs(cropAt(reduced, k.at).x - k.rect.x)).toBeLessThanOrEqual(
        FOLLOW_REDUCE_TOLERANCE + 1e-6,
      );
    }

    // Half an hour of a restless subject and a scene cut every second.
    const restless = (t: number) => 0.5 + 0.3 * Math.sin(t / 900) + 0.05 * noise(t, 6);
    const long = only(
      linkPeople(pictures(0, 1_800_000, (t) => [box(restless(t), 0.4, 0.1, 0.18)])),
    );
    const cuts = Array.from({ length: 1_799 }, (_, i) => (i + 1) * 1_000);
    const big = followPath([long], soleSubject(long, 0, 1_800_000), cuts, TALL).keyframes;
    expectValidPath(big);
  });
});

describe('followBoth', () => {
  it('follows the two people seen most, left one first', () => {
    const people = linkPeople(
      pictures(0, 10_000, (t) => [
        box(0.75, 0.4, 0.15, 0.27),
        box(0.25, 0.4, 0.15, 0.27),
        ...(t < 3_000 ? [box(0.5, 0.2, 0.05, 0.09)] : []),
      ]),
    );
    expect(people).toHaveLength(3);
    const top = { aspect: 1080 / 720, video: VIDEO };
    const bottom = { aspect: 1080 / 1200, video: VIDEO };
    const both = followBoth(people, 0, 10_000, [], [top, bottom]);
    if (!both) throw new Error('expected two paths');
    const [upper, lower] = both;
    expectValidPath(upper.keyframes);
    expectValidPath(lower.keyframes);
    const a = cropAt(upper.keyframes, 5_000);
    const b = cropAt(lower.keyframes, 5_000);
    expect(a.x + a.w / 2).toBeLessThan(b.x + b.w / 2);
    // Each face is inside its own crop.
    expect(a.x).toBeLessThan(0.25 - 0.075);
    expect(a.x + a.w).toBeGreaterThan(0.25 + 0.075);
    expect(b.x).toBeLessThan(0.75 - 0.075);
    expect(b.x + b.w).toBeGreaterThan(0.75 + 0.075);
    expect(followBoth(people.slice(0, 1), 0, 10_000, [], TALL)).toBeNull();
  });
});
