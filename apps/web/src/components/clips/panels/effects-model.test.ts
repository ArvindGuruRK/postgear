import {
  type ClipDocument,
  createClipDocument,
  type FilmstripMeta,
  setSpeed,
  splitAt,
  type Zoom,
} from '@postgear/video-engine';
import {
  addZoomSentence,
  amountText,
  fadeChoice,
  fadeOf,
  fullZoomMoment,
  playheadAfterSpeed,
  SPEED_LONG_SENTENCE,
  SPEED_PART_SENTENCE,
  SPEED_SHORT_SENTENCE,
  sampleTile,
  secondsText,
  soundsRough,
  speedLengthLine,
  speedOf,
  speedSentence,
  ZOOM_LIMIT_SENTENCE,
  ZOOM_ROOM_SENTENCE,
  zoomTiming,
} from './effects-model';

const VIDEO = '3f2a9c1e-0000-4000-8000-000000000002';

/** 10 s to 40 s of the video, in one 30 s part. */
function clip(): ClipDocument {
  return createClipDocument({ videoId: VIDEO, fromMs: 10_000, toMs: 40_000, ratio: '9:16' });
}

function zoom(doc: ClipDocument, from: number, to: number): Zoom {
  return {
    id: 'z1',
    source: doc.segments[0]?.source ?? '',
    from,
    to,
    scale: 1.5,
    focus: { x: 0.5, y: 0.5 },
    ease: 300,
  };
}

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error('refused');
  return result as Extract<T, { ok: true }>;
}

describe('the zoom card', () => {
  it('writes the amount the way the slider shows it', () => {
    expect(amountText(1.5)).toBe('1.5x');
    expect(amountText(2)).toBe('2x');
    expect(amountText(1.25)).toBe('1.25x');
  });

  it('reads From and For off the zoom bars, across a change of speed', () => {
    const base = clip();
    const doc = { ...base, zooms: [zoom(base, 14_000, 16_000)] };
    expect(zoomTiming(doc, 'z1')).toEqual({ startMs: 4_000, durationMs: 2_000 });
    expect(fullZoomMoment(doc, 'z1')).toBe(5_000);

    const segmentId = doc.segments[0]?.id ?? '';
    const fast = ok(setSpeed(doc, segmentId, 2)).doc;
    expect(zoomTiming(fast, 'z1')).toEqual({ startMs: 2_000, durationMs: 1_000 });
  });

  it('has no timing for a zoom the clip no longer shows', () => {
    const base = clip();
    const doc = { ...base, zooms: [zoom(base, 50_000, 52_000)] };
    expect(zoomTiming(doc, 'z1')).toBeNull();
    expect(fullZoomMoment(doc, 'z1')).toBeNull();
    expect(zoomTiming(doc, 'nope')).toBeNull();
  });

  it('says why Add Zoom did nothing in one sentence', () => {
    expect(addZoomSentence('too_many_zooms')).toBe(ZOOM_LIMIT_SENTENCE);
    expect(addZoomSentence('zoom_no_room')).toBe(ZOOM_ROOM_SENTENCE);
    expect(addZoomSentence('zoom_not_found')).toBeNull();
  });
});

describe('the speed card', () => {
  it('turns a speed choice back into a speed, and only an allowed one', () => {
    expect(speedOf('0.25')).toBe(0.25);
    expect(speedOf('4')).toBe(4);
    expect(speedOf('3')).toBeNull();
  });

  it('says the part length before and after', () => {
    expect(speedLengthLine({ sourceIn: 0, sourceOut: 8_000, speed: 2 })).toBe(
      '8.0 s becomes 4.0 s',
    );
    expect(speedLengthLine({ sourceIn: 0, sourceOut: 8_000, speed: 0.25 })).toBe(
      '8.0 s becomes 32.0 s',
    );
    expect(speedLengthLine({ sourceIn: 0, sourceOut: 8_000, speed: 1 })).toBe(
      'This part is 8.0 s long.',
    );
    expect(secondsText(-5)).toBe('0.0 s');
  });

  it('warns about rough sound below 1x only', () => {
    expect(soundsRough(0.25)).toBe(true);
    expect(soundsRough(0.5)).toBe(true);
    expect(soundsRough(1)).toBe(false);
    expect(soundsRough(4)).toBe(false);
  });

  it('keeps the playhead on the same moment of the video', () => {
    const doc = ok(splitAt(clip(), 10_000)).doc;
    const second = doc.segments[1]?.id ?? '';
    const fast = ok(setSpeed(doc, second, 2)).doc;
    // 16 s into the clip is 26 s of the video: 10 s plus 6 s at 2x is 13 s.
    expect(playheadAfterSpeed(doc, fast, 16_000, second, 20_000)).toBe(13_000);
    // Before the part that changed: where it was.
    expect(playheadAfterSpeed(doc, fast, 4_000, second, 20_000)).toBe(4_000);
    // Past the new end: held inside the clip.
    expect(playheadAfterSpeed(doc, fast, 99_000, second, 20_000)).toBe(20_000);
  });

  it('says why a speed was refused', () => {
    expect(speedSentence('segment_too_short')).toBe(SPEED_PART_SENTENCE);
    expect(speedSentence('clip_too_short')).toBe(SPEED_SHORT_SENTENCE);
    expect(speedSentence('clip_too_long')).toBe(SPEED_LONG_SENTENCE);
    expect(SPEED_LONG_SENTENCE).toBe('At that speed the clip would be longer than 30 minutes.');
  });
});

describe('the looks card', () => {
  it('shows a fade as the nearest of its three lengths', () => {
    expect(fadeChoice(500)).toBe(500);
    expect(fadeChoice(1_400)).toBe(1_000);
    expect(fadeChoice(5_000)).toBe(2_000);
    expect(fadeOf('2000')).toBe(2_000);
    expect(fadeOf('750')).toBeNull();
  });

  it('draws the tiles on the filmstrip picture of the moment at the playhead', () => {
    const meta: FilmstripMeta = {
      tileWidth: 160,
      tileHeight: 90,
      columns: 10,
      rows: 10,
      intervalMs: 2_000,
      count: 150,
      sheets: 2,
    };
    // 5 s into the clip is 15 s of the video: picture 7.
    expect(sampleTile(clip(), meta, 5_000)).toMatchObject({ index: 7, sheet: 0, x: 1_120, y: 0 });
    // Past the strip's end: its last picture.
    const late = createClipDocument({
      videoId: VIDEO,
      fromMs: 400_000,
      toMs: 410_000,
      ratio: '9:16',
    });
    expect(sampleTile(late, meta, 1_000)?.index).toBe(149);
    expect(sampleTile(clip(), null, 0)).toBeNull();
  });
});
