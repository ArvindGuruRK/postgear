import type { EmoteFile } from '@postgear/video-engine';
import {
  applyKey,
  clampCrop,
  clampStretch,
  clockLabel,
  creatorToolsHref,
  defaultCrop,
  emoteHref,
  emoteHrefFromPage,
  fileLine,
  hexToRgb,
  initialSource,
  isSoft,
  keyAlpha,
  madeAtLine,
  parseEmoteQuery,
  rgbToHex,
  scheduleMakerHref,
  secondsLabel,
  sourceOptions,
  stretchFromRange,
} from './emote-model';

const VIDEO = '11111111-1111-4111-8111-111111111111';
const CLIP = '22222222-2222-4222-8222-222222222222';
const FRAME = { width: 1280, height: 720 };

function file(overrides: Partial<EmoteFile> = {}): EmoteFile {
  return {
    name: 'emote-twitch-112.gif',
    size: 112,
    format: 'gif',
    bytes: 311_000,
    maxBytes: 512_000,
    fits: true,
    rung: 1,
    frames: 60,
    fps: 20,
    extra: false,
    ...overrides,
  };
}

describe('links', () => {
  it('opens the hub, the Schedule Maker and the Emote Maker on a clip', () => {
    expect(creatorToolsHref('seed-demo-org')).toBe('/seed-demo-org/clips/tools');
    expect(scheduleMakerHref('seed-demo-org')).toBe('/seed-demo-org/clips/tools/schedule');
    expect(emoteHref('seed-demo-org')).toBe('/seed-demo-org/clips/tools/emote');
    expect(
      emoteHref('seed-demo-org', { videoId: VIDEO, clipId: CLIP, fromMs: 12_400, toMs: 40_000 }),
    ).toBe(`/seed-demo-org/clips/tools/emote?video=${VIDEO}&clip=${CLIP}&from=12400&to=40000`);
  });

  it('reads only ids and whole milliseconds from the query', () => {
    expect(parseEmoteQuery({ video: VIDEO, clip: CLIP, from: '12400', to: '40000' })).toEqual({
      videoId: VIDEO,
      clipId: CLIP,
      fromMs: 12_400,
      toMs: 40_000,
    });
    expect(parseEmoteQuery({ video: '../x', clip: ['nope'], from: '-1', to: '1e9' })).toEqual({
      videoId: null,
      clipId: null,
      fromMs: null,
      toMs: null,
    });
  });
});

describe('the stretch', () => {
  it('never passes 3.0 seconds and moves in tenths', () => {
    expect(clampStretch({ startMs: 12_437, lengthMs: 4_200 }, 60_000)).toEqual({
      startMs: 12_400,
      lengthMs: 3_000,
    });
    expect(clampStretch({ startMs: 0, lengthMs: 20 }, 60_000)).toEqual({
      startMs: 0,
      lengthMs: 100,
    });
  });

  it('stays inside the video, even a short one', () => {
    expect(clampStretch({ startMs: 59_000, lengthMs: 3_000 }, 60_000)).toEqual({
      startMs: 57_000,
      lengthMs: 3_000,
    });
    expect(clampStretch({ startMs: 0, lengthMs: 3_000 }, 1_250)).toEqual({
      startMs: 0,
      lengthMs: 1_200,
    });
  });

  it("takes a clip's start and at most 3 seconds of it", () => {
    expect(stretchFromRange(12_430, 40_000, 600_000)).toEqual({ startMs: 12_500, lengthMs: 3_000 });
    expect(stretchFromRange(5_000, 6_450, 600_000)).toEqual({ startMs: 5_000, lengthMs: 1_400 });
    expect(stretchFromRange(null, null, 600_000)).toEqual({ startMs: 0, lengthMs: 3_000 });
  });

  it('says lengths and times in tenths', () => {
    expect(secondsLabel(2_400)).toBe('2.4 s');
    expect(clockLabel(67_400)).toBe('1:07.4');
  });
});

describe('the crop', () => {
  it('starts as a centred square and stays square inside the picture', () => {
    expect(defaultCrop(FRAME)).toEqual({ x: 424, y: 144, size: 432 });
    expect(clampCrop({ x: 1_200, y: -40, size: 900 }, FRAME)).toEqual({ x: 560, y: 0, size: 720 });
    expect(clampCrop({ x: 10.4, y: 10.6, size: 3 }, FRAME)).toEqual({ x: 10, y: 11, size: 16 });
  });

  it('warns under 112 source pixels', () => {
    expect(isSoft({ x: 0, y: 0, size: 111 })).toBe(true);
    expect(isSoft({ x: 0, y: 0, size: 112 })).toBe(false);
  });
});

describe('Remove A Colour', () => {
  it('keys the picked colour away and keeps a different one, as colorkey does', () => {
    const green: [number, number, number] = [0, 177, 64];
    expect(keyAlpha(green, green, 0.3)).toBe(0);
    expect(keyAlpha([10, 170, 70], green, 0.3)).toBe(0);
    expect(keyAlpha([255, 255, 255], green, 0.3)).toBe(255);
    const pixels = new Uint8ClampedArray([0, 177, 64, 255, 250, 20, 20, 255]);
    applyKey(pixels, '#00b140', 0.3);
    expect([pixels[3], pixels[7]]).toEqual([0, 255]);
  });

  it('reads and writes #rrggbb', () => {
    expect(hexToRgb('#00B140')).toEqual([0, 177, 64]);
    expect(hexToRgb('green')).toBeNull();
    expect(rgbToHex(0, 177, 64)).toBe('#00b140');
  });
});

describe('the result card', () => {
  it('says each file size and whether it is under the limit', () => {
    expect(fileLine(file(), 'twitch')).toBe('112 px, 311 KB, under the limit');
    expect(fileLine(file({ bytes: 600_000, fits: false }), 'twitch')).toBe(
      '112 px, 600 KB, over the 512 KB limit',
    );
    expect(
      fileLine(file({ format: 'png', bytes: 7_000, maxBytes: 25_000, frames: 1 }), 'twitch'),
    ).toBe('112 px, 7 KB, under the limit');
  });

  it('says when the frame rate was lowered to fit', () => {
    expect(madeAtLine([file()])).toBeNull();
    expect(madeAtLine([file({ rung: 3, fps: 15 })])).toBe('Made at 15 frames a second to fit.');
  });
});

describe('the source picker', () => {
  const videos = [
    { id: VIDEO, title: 'Friday Stream', status: 'READY' },
    { id: '33333333-3333-4333-8333-333333333333', title: 'Still Coming In', status: 'IMPORTING' },
  ];
  const clips = [
    { id: CLIP, title: 'Best Moment', videoId: VIDEO, range: { fromMs: 12_000, toMs: 40_000 } },
    {
      id: '44444444-4444-4444-8444-444444444444',
      title: 'Not Ready',
      videoId: '33333333-3333-4333-8333-333333333333',
      range: null,
    },
  ];

  it('lists clips of ready videos, then ready videos', () => {
    expect(sourceOptions(videos, clips).map((option) => [option.value, option.label])).toEqual([
      [`clip:${CLIP}`, 'Best Moment'],
      [`video:${VIDEO}`, 'Friday Stream'],
    ]);
  });

  it("opens on the asked clip, or on the asked video with the clip's range", () => {
    const options = sourceOptions(videos, clips);
    expect(
      initialSource(options, { clipId: CLIP, videoId: null, fromMs: null, toMs: null })?.fromMs,
    ).toBe(12_000);
    expect(
      initialSource(options, {
        clipId: '55555555-5555-4555-8555-555555555555',
        videoId: VIDEO,
        fromMs: 5_000,
        toMs: 9_000,
      }),
    ).toMatchObject({ value: `video:${VIDEO}`, fromMs: 5_000, toMs: 9_000 });
    expect(
      initialSource(options, { clipId: null, videoId: null, fromMs: null, toMs: null }),
    ).toBeNull();
  });
});

describe("a clip menu's Make An Emote", () => {
  const range = { fromMs: 12_000, toMs: 40_000 };

  it('names the workspace from the address and the video from the clip or the page', () => {
    expect(emoteHrefFromPage('/seed-demo-org/clips', { clipId: CLIP, videoId: VIDEO, range })).toBe(
      `/seed-demo-org/clips/tools/emote?video=${VIDEO}&clip=${CLIP}&from=12000&to=40000`,
    );
    expect(
      emoteHrefFromPage(`/seed-demo-org/clips/video/${VIDEO}`, {
        clipId: CLIP,
        videoId: null,
        range: null,
      }),
    ).toBe(`/seed-demo-org/clips/tools/emote?video=${VIDEO}&clip=${CLIP}`);
  });

  it('shows no link off a Clips page or without a video', () => {
    expect(emoteHrefFromPage('/', { clipId: CLIP, videoId: VIDEO, range })).toBeNull();
    expect(
      emoteHrefFromPage('/seed-demo-org/clips', { clipId: CLIP, videoId: null, range }),
    ).toBeNull();
  });
});
