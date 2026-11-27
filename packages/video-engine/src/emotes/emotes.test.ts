import {
  CLIP_JOB_INPUT_SCHEMAS,
  CLIP_JOB_KINDS,
  CLIP_JOB_OUTPUT_SCHEMAS,
  CLIP_JOB_STAGES,
  jobLabel,
} from '../jobs';
import { clipErrorMessage, NON_RETRYABLE_CLIP_CODES } from '../errors';
import {
  checkEmoteBounds,
  climbLadder,
  compileEmote,
  EMOTE_PLATFORMS,
  EMOTE_PROFILES,
  emoteBoundsSchema,
  emoteBytesLabel,
  emoteFileName,
  emoteGraph,
  emoteInputSchema,
  emoteOutputSchema,
  emoteOverReason,
  emoteProfileSchema,
  emoteTooBigSentence,
  type EmoteRung,
  fitsEmoteOutput,
  ladderLength,
  nextRung,
  planEmote,
  scaleEmoteCrop,
} from './index';

const VIDEO = '11111111-1111-4111-8111-111111111111';
const FRAME = { width: 1280, height: 720 };
const twitch = EMOTE_PROFILES.twitch;
const gif112 = twitch.outputs[0];

function request(overrides: Record<string, unknown> = {}) {
  return {
    videoId: VIDEO,
    platform: 'twitch' as const,
    startMs: 12_400,
    endMs: 15_400,
    crop: { x: 620, y: 210, size: 480 },
    key: null,
    flip: false,
    still: false,
    ...overrides,
  };
}

describe('emote profiles (data)', () => {
  it.each(EMOTE_PLATFORMS)('%s parses and lists outputs largest first', (platform) => {
    const profile = EMOTE_PROFILES[platform];
    expect(emoteProfileSchema.safeParse(profile).success).toBe(true);
    const moving = profile.outputs.filter((output) => output.format !== 'png');
    const sizes = moving.map((output) => output.size);
    expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);
  });

  it('holds the strictest caps: 512 KB and 60 frames for Twitch and BTTV, 25 KB stills, 7 MB for 7TV', () => {
    for (const platform of ['twitch', 'bttv'] as const) {
      const profile = EMOTE_PROFILES[platform];
      expect(profile.maxFrames).toBe(60);
      const gifs = profile.outputs.filter((output) => output.format === 'gif');
      expect(gifs.map((output) => output.size)).toEqual([112, 56, 28]);
      expect(gifs.every((output) => output.maxBytes === 512_000)).toBe(true);
    }
    const stills = twitch.outputs.filter((output) => output.format === 'png');
    expect(stills.map((output) => [output.size, output.maxBytes])).toEqual([
      [112, 25_000],
      [56, 25_000],
      [28, 25_000],
    ]);
    const seven = EMOTE_PROFILES.sevenTv;
    expect(seven.maxFrames).toBe(1_000);
    expect(seven.outputs.map((output) => [output.format, output.extra === true])).toEqual([
      ['gif', false],
      ['webp', true],
      ['apng', true],
    ]);
    expect(
      seven.outputs.every((output) => output.size === 256 && output.maxBytes === 7_000_000),
    ).toBe(true);
  });

  it('refuses a profile with no required moving file', () => {
    expect(
      emoteProfileSchema.safeParse({
        ...twitch,
        outputs: [{ size: 112, format: 'png', maxBytes: 25_000 }],
      }).success,
    ).toBe(false);
  });

  it('names files the way the private keys allow', () => {
    expect(emoteFileName(twitch, gif112)).toBe('emote-twitch-112.gif');
    expect(emoteFileName(EMOTE_PROFILES.sevenTv, EMOTE_PROFILES.sevenTv.outputs[2])).toBe(
      'emote-seventv-256.apng',
    );
  });
});

describe('planEmote', () => {
  it('makes three GIFs for Twitch, and the stills only with the switch on', () => {
    expect(planEmote(request()).steps.map((step) => step.fileName)).toEqual([
      'emote-twitch-112.gif',
      'emote-twitch-56.gif',
      'emote-twitch-28.gif',
    ]);
    const withStill = planEmote(request({ still: true, stillAtMs: 13_000 }));
    expect(withStill.steps.map((step) => step.fileName)).toEqual([
      'emote-twitch-112.gif',
      'emote-twitch-56.gif',
      'emote-twitch-28.gif',
      'emote-twitch-112.png',
      'emote-twitch-56.png',
      'emote-twitch-28.png',
    ]);
    expect(withStill.stillAtMs).toBe(13_000);
    expect(withStill.steps.filter((step) => step.still)).toHaveLength(3);
  });

  it('never plans a still for a site with no still sizes', () => {
    expect(
      planEmote(request({ platform: 'bttv', still: true })).steps.every((step) => !step.still),
    ).toBe(true);
  });

  it('marks 7TV extras as not required', () => {
    const plan = planEmote(request({ platform: 'sevenTv' }));
    expect(plan.steps.map((step) => [step.fileName, step.required])).toEqual([
      ['emote-seventv-256.gif', true],
      ['emote-seventv-256.webp', false],
      ['emote-seventv-256.apng', false],
    ]);
    expect(plan.zipName).toBe('emote-seventv.zip');
  });

  it.each([3_000, 2_400, 1_000, 500, 100])(
    'caps Twitch frames at 60 at any fps for a %d ms stretch',
    (length) => {
      const plan = planEmote(request({ startMs: 0, endMs: length }));
      let rung: EmoteRung | null = null;
      for (;;) {
        const answer = nextRung(twitch, gif112, rung, { seconds: plan.seconds });
        if (answer.kind === 'too_big') break;
        rung = answer.rung;
        const compiled = compileEmote(
          plan,
          plan.steps[0],
          rung,
          { file: 'source-0.mp4', offsetMs: 0, width: 1280, height: 720 },
          FRAME,
        );
        expect(compiled.frames).toBeLessThanOrEqual(60);
        expect(rung.fps * plan.seconds).toBeLessThanOrEqual(60 + 1e-9);
        expect(compiled.args).toContain('-frames:v');
        expect(compiled.args[compiled.args.indexOf('-frames:v') + 1]).toBe(String(compiled.frames));
      }
    },
  );

  it('lowers the frame rate under the cap for a site with a tight frame limit', () => {
    const tight = { ...twitch, maxFrames: 30 };
    const answer = nextRung(tight, gif112, null, { seconds: 3 });
    expect(answer.kind === 'rung' && answer.rung.fps).toBe(10);
  });
});

describe('the ladder', () => {
  it('walks fps, colours and dither down, never the size', () => {
    const rungs: EmoteRung[] = [];
    let rung: EmoteRung | null = null;
    for (;;) {
      const answer = nextRung(twitch, gif112, rung, { seconds: 3 });
      if (answer.kind === 'too_big') break;
      rung = answer.rung;
      rungs.push(rung);
    }
    expect(rungs.map((r) => [r.fps, r.colours, r.dither.mode])).toEqual([
      [20, 256, 'bayer'],
      [20, 128, 'bayer'],
      [15, 128, 'bayer'],
      [15, 64, 'bayer'],
      [12, 64, 'none'],
      [10, 32, 'none'],
    ]);
    expect(rungs).toHaveLength(ladderLength('gif'));
  });

  it('walks WebP quality down instead of colours', () => {
    const webp = EMOTE_PROFILES.sevenTv.outputs[1];
    const first = nextRung(EMOTE_PROFILES.sevenTv, webp, null, { seconds: 3 });
    expect(first.kind === 'rung' && [first.rung.quality, first.rung.colours]).toEqual([80, null]);
    const second =
      first.kind === 'rung'
        ? nextRung(EMOTE_PROFILES.sevenTv, webp, first.rung, { seconds: 3 })
        : null;
    expect(second?.kind === 'rung' && second.rung.quality).toBe(70);
  });

  it('stops at the first fit', async () => {
    const sizes = [900_000, 700_000, 400_000, 300_000];
    const encode = jest.fn(async (rung: EmoteRung) => ({
      bytes: sizes[rung.index - 1] ?? 1,
      frames: 60,
    }));
    const result = await climbLadder(twitch, gif112, 3, encode);
    expect(result.fits).toBe(true);
    expect(result.rung.index).toBe(3);
    expect(encode).toHaveBeenCalledTimes(3);
  });

  it('answers emote_too_big with the site and size when no rung fits', async () => {
    const encode = jest.fn(async () => ({ bytes: 600_000, frames: 60 }));
    const result = await climbLadder(twitch, gif112, 3, encode);
    expect(result.fits).toBe(false);
    expect(encode).toHaveBeenCalledTimes(ladderLength('gif'));
    if (!result.fits) {
      expect(result.code).toBe('emote_too_big');
      expect(result.rung.index).toBe(6);
      expect(result.message).toBe(
        'This emote is too big for Twitch at 112 px. Try a shorter stretch or a smaller crop.',
      );
    }
    const past = nextRung(twitch, gif112, result.rung, { seconds: 3 });
    expect(past.kind).toBe('too_big');
  });

  it('counts frames as well as bytes, and a still is one frame', () => {
    expect(fitsEmoteOutput(twitch, gif112, { bytes: 100, frames: 61 })).toBe(false);
    expect(fitsEmoteOutput(twitch, gif112, { bytes: 512_000, frames: 60 })).toBe(true);
    const still = twitch.outputs[3];
    expect(fitsEmoteOutput(twitch, still, { bytes: 25_001, frames: 1 })).toBe(false);
    expect(fitsEmoteOutput(twitch, still, { bytes: 20_000, frames: 1 })).toBe(true);
  });

  it('names every site in its too-big sentence', () => {
    expect(emoteTooBigSentence('sevenTv', 256)).toContain('too big for 7TV at 256 px');
    expect(emoteTooBigSentence('bttv', 112)).toContain('too big for BetterTTV at 112 px');
  });
});

describe('the bounds', () => {
  const context = { durationMs: 180_000, frame: FRAME };

  it('accepts a 3 second stretch with a square inside the picture', () => {
    expect(checkEmoteBounds(request(), context)).toBeNull();
    expect(emoteBoundsSchema(context).safeParse(request()).success).toBe(true);
  });

  it('refuses a stretch over 3 seconds as emote_too_long', () => {
    expect(checkEmoteBounds(request({ endMs: 15_500 }), context)).toBe('emote_too_long');
    const parsed = emoteBoundsSchema(context).safeParse(request({ endMs: 15_500 }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues[0] as { params?: { code?: string } };
      expect(issue.params?.code).toBe('emote_too_long');
    }
  });

  it.each([
    ['ends before it starts', { startMs: 15_000, endMs: 14_000 }],
    ['is not on a tenth of a second', { startMs: 12_450, endMs: 14_000 }],
    ['runs past the video', { startMs: 179_000, endMs: 181_000 }],
    ['crops outside the picture', { crop: { x: 1000, y: 0, size: 480 } }],
    ['crops below the picture', { crop: { x: 0, y: 400, size: 480 } }],
    ['takes a still outside the stretch', { still: true, stillAtMs: 20_000 }],
  ])('refuses a request that %s as emote_range_invalid', (_name, overrides) => {
    expect(checkEmoteBounds(request(overrides), context)).toBe('emote_range_invalid');
  });

  it('refuses a crop under 16 px, a bad colour and unknown keys by shape', () => {
    const schema = emoteBoundsSchema(context);
    expect(schema.safeParse(request({ crop: { x: 0, y: 0, size: 15 } })).success).toBe(false);
    expect(schema.safeParse(request({ key: { color: 'green', similarity: 0.3 } })).success).toBe(
      false,
    );
    expect(
      schema.safeParse(request({ key: { color: '#00ff00;drop', similarity: 0.3 } })).success,
    ).toBe(false);
    expect(schema.safeParse({ ...request(), watermark: true }).success).toBe(false);
  });

  it('allows a crop under 112 source pixels (the page only warns)', () => {
    expect(checkEmoteBounds(request({ crop: { x: 0, y: 0, size: 40 } }), context)).toBeNull();
  });
});

describe('the graph and arguments', () => {
  const source = { file: 'source-0.mp4', offsetMs: 0, width: 1280, height: 720 };

  it('crops, sets the rate, scales with lanczos and builds a palette for a GIF', () => {
    const plan = planEmote(request());
    const rung = nextRung(twitch, gif112, null, { seconds: 3 });
    if (rung.kind !== 'rung') throw new Error('no rung');
    const graph = emoteGraph(plan, plan.steps[0], rung.rung, plan.crop);
    expect(graph).toBe(
      '[0:v]crop=480:480:620:210,fps=20,scale=112:112:flags=lanczos,split[a][b];' +
        '[a]palettegen=max_colors=256:reserve_transparent=0:stats_mode=diff[p];' +
        '[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
    );
  });

  it('keys the colour before the crop is scaled, flips, and keeps transparency in a GIF', () => {
    const plan = planEmote(request({ key: { color: '#00b140', similarity: 0.3 }, flip: true }));
    const rung = nextRung(twitch, gif112, null, { seconds: 3 });
    if (rung.kind !== 'rung') throw new Error('no rung');
    const graph = emoteGraph(plan, plan.steps[0], rung.rung, plan.crop);
    expect(graph).toContain('hflip,fps=20,format=rgba,colorkey=0x00b140:0.3:0.08,scale=112:112');
    expect(graph).toContain('reserve_transparent=1:stats_mode=full');
    expect(graph).toContain('alpha_threshold=128');
  });

  it('seeks inside a sharp range from its own start and passes the graph as a file', () => {
    const plan = planEmote(request());
    const rung = nextRung(twitch, gif112, null, { seconds: 3 });
    if (rung.kind !== 'rung') throw new Error('no rung');
    const compiled = compileEmote(
      plan,
      plan.steps[0],
      rung.rung,
      { file: 'source-0.mp4', offsetMs: 11_000, width: 1920, height: 1080 },
      FRAME,
    );
    expect(compiled.args.slice(0, 6)).toEqual([
      '-ss',
      '1.400',
      '-t',
      '3.000',
      '-i',
      'source-0.mp4',
    ]);
    expect(compiled.args).toContain('-/filter_complex');
    expect(compiled.args).not.toContain('-filter_complex_script');
    expect(compiled.args.at(-1)).toBe('emote-twitch-112.gif');
    // The crop is scaled from the light copy's 1280 wide frame to the 1920 wide range.
    expect(compiled.graph).toContain('crop=720:720:930:315');
  });

  it('loops a WebP and an APNG for ever, and writes one frame for a still', () => {
    const plan = planEmote(request({ platform: 'sevenTv' }));
    const seven = EMOTE_PROFILES.sevenTv;
    const webpRung = nextRung(seven, seven.outputs[1], null, { seconds: 3 });
    const apngRung = nextRung(seven, seven.outputs[2], null, { seconds: 3 });
    if (webpRung.kind !== 'rung' || apngRung.kind !== 'rung') throw new Error('no rung');
    const webp = compileEmote(plan, plan.steps[1], webpRung.rung, source, FRAME);
    expect(webp.args.join(' ')).toContain(
      '-c:v libwebp_anim -lossless 0 -quality 80 -compression_level 6 -loop 0 -f webp',
    );
    expect(webp.graph.endsWith('format=yuva420p')).toBe(true);
    const apng = compileEmote(plan, plan.steps[2], apngRung.rung, source, FRAME);
    expect(apng.args.join(' ')).toContain('-c:v apng -plays 0 -f apng');
    expect(apng.graph.endsWith('format=rgba')).toBe(true);

    const still = planEmote(request({ still: true, stillAtMs: 13_000 }));
    const stillStep = still.steps[3];
    const stillRung = nextRung(twitch, stillStep.output, null, { seconds: 3 });
    if (stillRung.kind !== 'rung') throw new Error('no rung');
    const png = compileEmote(still, stillStep, stillRung.rung, source, FRAME);
    expect(png.frames).toBe(1);
    expect(png.args.slice(0, 4)).toEqual(['-ss', '13.000', '-i', 'source-0.mp4']);
    expect(png.args).not.toContain('-t');
    expect(png.graph).not.toContain('fps=');
  });

  it('keeps a scaled crop square and inside the file', () => {
    expect(
      scaleEmoteCrop({ x: 1000, y: 500, size: 280 }, FRAME, { width: 640, height: 360 }),
    ).toEqual({
      x: 500,
      y: 220,
      size: 140,
    });
    const edge = scaleEmoteCrop({ x: 1279 - 719, y: 0, size: 720 }, FRAME, {
      width: 1281,
      height: 721,
    });
    expect(edge.x + edge.size).toBeLessThanOrEqual(1281);
    expect(edge.y + edge.size).toBeLessThanOrEqual(721);
  });
});

describe('the EMOTE job contract', () => {
  const input = {
    videoId: VIDEO,
    platform: 'twitch',
    startMs: 12_400,
    endMs: 15_400,
    crop: { x: 620, y: 210, size: 480 },
    frame: FRAME,
    key: null,
    flip: false,
    still: false,
    stillAtMs: null,
  };

  it('is a kind with three stages in words, and its schemas', () => {
    expect(CLIP_JOB_KINDS).toContain('EMOTE');
    expect(CLIP_JOB_STAGES.EMOTE).toEqual(['fetching', 'encoding', 'finishing']);
    expect(CLIP_JOB_INPUT_SCHEMAS.EMOTE).toBe(emoteInputSchema);
    expect(CLIP_JOB_OUTPUT_SCHEMAS.EMOTE).toBe(emoteOutputSchema);
    expect(jobLabel('EMOTE', 'RUNNING', 'encoding')).toBe('Making the emote');
    expect(jobLabel('EMOTE', 'RUNNING', 'finishing')).toBe('Packing the files');
  });

  it('takes a stretch of at most 3 seconds with the crop inside its frame', () => {
    expect(emoteInputSchema.safeParse(input).success).toBe(true);
    expect(emoteInputSchema.safeParse({ ...input, endMs: 15_401 }).success).toBe(false);
    expect(
      emoteInputSchema.safeParse({ ...input, crop: { x: 900, y: 0, size: 480 } }).success,
    ).toBe(false);
    expect(emoteInputSchema.safeParse({ ...input, watermark: true }).success).toBe(false);
  });

  it('answers names, never keys', () => {
    const file = {
      name: 'emote-twitch-112.gif',
      size: 112,
      format: 'gif',
      bytes: 76_000,
      maxBytes: 512_000,
      fits: true,
      rung: 1,
      frames: 60,
      fps: 20,
      extra: false,
    };
    const output = {
      platform: 'twitch',
      files: [file],
      zip: { name: 'emote-twitch.zip', bytes: 80_000 },
      sharp: false,
    };
    expect(emoteOutputSchema.safeParse(output).success).toBe(true);
    expect(
      emoteOutputSchema.safeParse({
        ...output,
        files: [{ ...file, name: 'clips/org/exports/x/emote.gif' }],
      }).success,
    ).toBe(false);
    expect(
      emoteOutputSchema.safeParse({ ...output, zip: { name: '../emote.zip', bytes: 1 } }).success,
    ).toBe(false);
  });

  it('has a sentence for every new code, and the size limit is never retried', () => {
    for (const code of ['emote_too_long', 'emote_range_invalid', 'emote_too_big', 'emote_failed']) {
      expect(clipErrorMessage(code)).not.toBe(clipErrorMessage('tool_failed'));
    }
    expect(NON_RETRYABLE_CLIP_CODES).toEqual(
      expect.arrayContaining(['emote_too_big', 'emote_too_long']),
    );
  });
});

describe('the files table words', () => {
  it('says "Under the limit" or why not', () => {
    expect(
      emoteOverReason({ bytes: 100, maxBytes: 512_000, frames: 60, maxFrames: 60 }),
    ).toBeNull();
    expect(emoteOverReason({ bytes: 600_000, maxBytes: 512_000, frames: 60, maxFrames: 60 })).toBe(
      'Over the 512 KB limit',
    );
    expect(emoteOverReason({ bytes: 100, maxBytes: 512_000, frames: 61, maxFrames: 60 })).toBe(
      'Over the 60 frame limit',
    );
  });

  it('prints sizes in decimal kilobytes and megabytes', () => {
    expect(emoteBytesLabel(76_001)).toBe('77 KB');
    expect(emoteBytesLabel(900)).toBe('1 KB');
    expect(emoteBytesLabel(7_000_000)).toBe('7 MB');
    expect(emoteBytesLabel(1_250_000)).toBe('1.3 MB');
  });
});
