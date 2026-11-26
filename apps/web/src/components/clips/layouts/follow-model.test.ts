/**
 * Follow The Speaker's sums (Module 08): what is read, the plan for each
 * case (one person, a lost stretch, two people, many, nobody), the strip in
 * the clip's time, hand fixes, and a layout change turning following off.
 */
import {
  applyLayout,
  disableFollow,
  isFollowing,
  linkPeople,
  splitAt,
  trimSegment,
} from '@postgear/video-engine';
import {
  FOLLOW_HANDLE_MS,
  facesCoverClip,
  followRanges,
  followWith,
  lostSentence,
  pickAnchor,
  picturesToFollow,
  resolvePick,
  placeOverride,
  planFollow,
  speakerStretches,
  thumbBox,
  canShowBoth,
  clearOverride,
  clipStretchesOf,
  unfollowFirst,
  withOverrides,
} from './follow-model';
import {
  FACE_ASSET,
  faceData,
  manyPeople,
  nobody,
  onePersonWithGap,
  tallClip,
  twoPeople,
  VIDEO_SIZE,
} from './follow-fixtures';

describe('what Follow The Speaker reads', () => {
  it('reads the played stretch plus a handle, inside the face file', () => {
    const doc = tallClip();
    expect(followRanges(doc, { fromMs: 5_000, toMs: 45_000 })).toEqual([
      { from: 10_000 - FOLLOW_HANDLE_MS, to: 40_000 + FOLLOW_HANDLE_MS },
    ]);
    expect(followRanges(doc, { fromMs: 9_000, toMs: 41_000 })).toEqual([
      { from: 9_000, to: 41_000 },
    ]);
    const pics = picturesToFollow(doc, faceData(twoPeople()));
    expect(pics[0]?.t).toBe(8_000);
    expect(pics.at(-1)?.t).toBe(41_800);
  });

  it('knows when the clip plays past the face file', () => {
    const doc = tallClip();
    expect(facesCoverClip(doc, { fromMs: 5_000, toMs: 45_000 })).toBe(true);
    expect(facesCoverClip(doc, { fromMs: 12_000, toMs: 45_000 })).toBe(false);
  });
});

describe('the plan', () => {
  it('follows one person, and reports where they were lost', () => {
    const plan = planFollow(tallClip(), faceData(onePersonWithGap()), VIDEO_SIZE, {
      mode: 'speaker',
    });
    if (plan.kind !== 'ready') throw new Error('expected a path');
    expect(plan.people).toHaveLength(1);
    expect(plan.paths[0]?.length).toBeGreaterThan(0);
    expect(plan.lost).toHaveLength(1);
    expect(plan.lost[0]?.from).toBeGreaterThanOrEqual(19_000);
    expect(plan.lost[0]?.to).toBeLessThanOrEqual(25_000);
    expect(canShowBoth(plan)).toBe(false);
  });

  it('offers Show Both with two people, and makes two paths for it', () => {
    const data = faceData(twoPeople());
    const plan = planFollow(tallClip(), data, VIDEO_SIZE, { mode: 'speaker' });
    expect(canShowBoth(plan)).toBe(true);
    const both = planFollow(tallClip(), data, VIDEO_SIZE, { mode: 'both' });
    expect(both.kind === 'ready' && both.paths.length).toBe(2);
  });

  it('asks whom to follow with many faces, and follows the one picked', () => {
    const data = faceData(manyPeople());
    const plan = planFollow(tallClip(), data, VIDEO_SIZE, { mode: 'speaker' });
    expect(plan.kind).toBe('many');
    if (plan.kind !== 'many') return;
    const person = plan.people[2];
    if (!person) throw new Error('person');
    const picked = planFollow(tallClip(), data, VIDEO_SIZE, {
      mode: 'speaker',
      pick: pickAnchor(tallClip(), data, person),
    });
    expect(picked.kind).toBe('ready');
  });

  it('finds nobody in an empty file', () => {
    expect(planFollow(tallClip(), faceData(nobody()), VIDEO_SIZE, { mode: 'speaker' })).toEqual({
      kind: 'none',
    });
  });
});

describe('turning it on and off', () => {
  it('writes the keyframes and the face file, and off gives back the layout exactly', () => {
    const doc = tallClip();
    const { doc: next, plan } = followWith(doc, faceData(onePersonWithGap()), VIDEO_SIZE, {
      mode: 'speaker',
    });
    expect(plan.kind).toBe('ready');
    expect(isFollowing(next)).toBe(true);
    expect(next.layout.follow?.faceAssetId).toBe(FACE_ASSET);
    expect(next.layout.areas[0]?.crop.length).toBeGreaterThan(1);
    expect(disableFollow(next).layout).toEqual(doc.layout);
  });

  it('changes nothing when nobody is found', () => {
    const doc = tallClip();
    expect(followWith(doc, faceData(nobody()), VIDEO_SIZE, { mode: 'speaker' }).doc).toBe(doc);
  });

  it('turns following off before a layout change, from the own layout', () => {
    const doc = tallClip();
    const followed = followWith(doc, faceData(twoPeople()), VIDEO_SIZE, { mode: 'speaker' }).doc;
    const split = unfollowFirst((d) => applyLayout(d, 'split', VIDEO_SIZE))(followed);
    expect(isFollowing(split)).toBe(false);
    const own = applyLayout(doc, 'split', VIDEO_SIZE);
    const shape = (d: typeof doc) =>
      d.layout.areas.map((a) => ({ name: a.name, frame: a.frame, crop: a.crop }));
    expect(split.layout.kind).toBe('split');
    expect(shape(split)).toEqual(shape(own));
  });
});

describe('the strip', () => {
  it('maps people and lost stretches into the clip time', () => {
    const doc = tallClip();
    const data = faceData(onePersonWithGap());
    const plan = planFollow(doc, data, VIDEO_SIZE, { mode: 'speaker' });
    const stretches = speakerStretches(doc, plan);
    const people = stretches.filter((s) => s.kind === 'person');
    const lost = stretches.filter((s) => s.kind === 'lost');
    expect(people.length).toBeGreaterThan(0);
    expect(people.every((s) => s.person === 0)).toBe(true);
    expect(lost).toHaveLength(1);
    // The clip starts at the video's 10 s.
    expect(lost[0]?.fromMs).toBe((lost[0]?.source.from ?? 0) - 10_000);
    expect(stretches.every((s) => s.fromMs >= 0 && s.toMs <= 30_000)).toBe(true);
    expect(lost[0]?.label).toMatch(/^We lost the speaker for \d seconds here\.$/);
  });

  it('shows a stretch once per part that plays it, and not where it was cut', () => {
    const split = splitAt(tallClip(), 10_000);
    if (!split.ok) throw new Error('split');
    expect(clipStretchesOf(split.doc, { from: 18_000, to: 22_000 })).toEqual([
      { fromMs: 8_000, toMs: 10_000 },
      { fromMs: 10_000, toMs: 12_000 },
    ]);
    const first = split.doc.segments[0];
    if (!first) throw new Error('segment');
    const trimmed = trimSegment(split.doc, {
      segmentId: first.id,
      edge: 'end',
      sourceMs: 15_000,
      videoDurationMs: 60_000,
    });
    if (!trimmed.ok) throw new Error('trim');
    expect(clipStretchesOf(trimmed.doc, { from: 16_000, to: 19_000 })).toEqual([]);
  });

  it('marks a lost stretch fixed by hand, and Clear Fix takes the fix away', () => {
    const data = faceData(onePersonWithGap());
    const followed = followWith(tallClip(), data, VIDEO_SIZE, { mode: 'speaker' }).doc;
    const plan = planFollow(followed, data, VIDEO_SIZE, { mode: 'speaker' });
    if (plan.kind !== 'ready') throw new Error('path');
    const lost = plan.lost[0];
    if (!lost) throw new Error('lost');
    const rect = { x: 0.1, y: 0.1, w: 0.2, h: 0.6 };
    const overrides = placeOverride([], lost, rect);
    const fixed = withOverrides(followed, data, VIDEO_SIZE, overrides);
    expect(fixed.layout.follow?.overrides).toEqual([{ ...lost, rect }]);
    expect(fixed.layout.areas[0]?.crop).not.toEqual(followed.layout.areas[0]?.crop);
    const marked = speakerStretches(fixed, plan, fixed.layout.follow?.overrides);
    expect(marked.some((s) => s.kind === 'fixed')).toBe(true);
    const cleared = withOverrides(fixed, data, VIDEO_SIZE, clearOverride(overrides, lost));
    expect(cleared.layout.follow?.overrides).toEqual([]);
    expect(cleared.layout.areas[0]?.crop).toEqual(followed.layout.areas[0]?.crop);
  });
});

describe('copy and thumbnails', () => {
  it('says how long the speaker was lost, in whole seconds', () => {
    expect(lostSentence(3_200)).toBe('We lost the speaker for 3 seconds here.');
    expect(lostSentence(600)).toBe('We lost the speaker for 1 second here.');
  });

  it('cuts a thumbnail around the nearest face, or none when not seen then', () => {
    const person = {
      id: 'person-1',
      from: 0,
      to: 1_000,
      boxes: [{ t: 1_000, rect: { x: 0.4, y: 0.4, w: 0.1, h: 0.2 } }],
      avgSize: 0.2,
      coverage: 1,
    };
    const box = thumbBox(person, 1_200);
    expect(box?.w).toBeCloseTo(0.15);
    expect((box?.x ?? 0) + (box?.w ?? 0) / 2).toBeCloseTo(0.45);
    expect(thumbBox(person, 3_000)).toBeNull();
  });
});

describe('the many-faces pick', () => {
  it('is stored as an anchor that finds the same person after a trim', () => {
    const doc = tallClip();
    const data = faceData(manyPeople());
    const plan = planFollow(doc, data, VIDEO_SIZE, { mode: 'speaker' });
    if (plan.kind !== 'many') throw new Error('many');
    const middle = plan.people.find((p) => Math.abs((p.boxes[0]?.rect.x ?? 0) - 0.45) < 0.01);
    if (!middle) throw new Error('person');
    const anchor = pickAnchor(doc, data, middle);
    expect(anchor).toMatch(/^person@\d+:0\.490,0\.370$/);
    expect((anchor ?? '').length).toBeLessThanOrEqual(40);
    const followed = followWith(doc, data, VIDEO_SIZE, { mode: 'speaker', pick: anchor });
    expect(followed.doc.layout.follow?.personId).toBe(anchor);

    // A trim changes the pictures read (and so maybe the ids); the anchor still finds them.
    const first = followed.doc.segments[0];
    if (!first) throw new Error('segment');
    const trimmed = trimSegment(followed.doc, {
      segmentId: first.id,
      edge: 'start',
      sourceMs: 25_000,
      videoDurationMs: 60_000,
    });
    if (!trimmed.ok) throw new Error('trim');
    const people = linkPeople(picturesToFollow(trimmed.doc, data));
    const found = people.find((p) => p.id === resolvePick(people, anchor));
    expect(found?.boxes[0]?.rect.x).toBeCloseTo(0.45);
    expect(resolvePick(people, 'person@1:0.990,0.990')).toBeNull();
    expect(resolvePick(people, 'not an anchor')).toBeNull();
  });
});
