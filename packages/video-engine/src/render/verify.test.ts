import {
  type ExpectedOutput,
  expectedOutputOf,
  type RenderedFileFacts,
  verifyOutput,
} from './verify';

const EXPECTED: ExpectedOutput = {
  durationMs: 20_000,
  width: 1080,
  height: 1920,
  fps: 30,
  gopSeconds: 2,
};

function good(overrides: Partial<RenderedFileFacts> = {}): RenderedFileFacts {
  return {
    durationMs: 20_000,
    width: 1080,
    height: 1920,
    fps: 30,
    codec: 'h264',
    profile: 'High',
    pixFmt: 'yuv420p',
    keyframesMs: [0, 2_000, 4_000, 6_000, 8_000, 10_000, 12_000, 14_000, 16_000, 18_000],
    moovFirst: true,
    bytes: 12_000_000,
    ...overrides,
  };
}

describe('verifyOutput', () => {
  it('passes a file that is what the plan asked for', () => {
    expect(verifyOutput(good(), EXPECTED)).toEqual([]);
  });

  it('allows a length one frame off, not two', () => {
    expect(verifyOutput(good({ durationMs: 20_033 }), EXPECTED)).toEqual([]);
    expect(verifyOutput(good({ durationMs: 19_967 }), EXPECTED)).toEqual([]);
    expect(verifyOutput(good({ durationMs: 20_067 }), EXPECTED)).toEqual(['duration']);
    expect(verifyOutput(good({ durationMs: null }), EXPECTED)).toEqual(['duration']);
  });

  it('names every way a file is wrong, in a fixed order', () => {
    expect(
      verifyOutput(
        good({
          width: 720,
          fps: 60,
          codec: 'hevc',
          profile: 'Main',
          pixFmt: 'yuv444p',
          moovFirst: false,
        }),
        EXPECTED,
      ),
    ).toEqual(['size', 'fps', 'codec', 'profile', 'pix_fmt', 'moov']);
  });

  it('accepts 29.97 fps as near enough only within the slack', () => {
    expect(verifyOutput(good({ fps: 30.02 }), EXPECTED)).toEqual([]);
    expect(verifyOutput(good({ fps: 29.97 }), EXPECTED)).toEqual([]);
    expect(verifyOutput(good({ fps: 25 }), EXPECTED)).toEqual(['fps']);
  });

  it('wants a key frame at the start and at most two seconds apart', () => {
    expect(verifyOutput(good({ keyframesMs: [0, 2_000, 6_000] }), EXPECTED)).toEqual(['keyframes']);
    expect(verifyOutput(good({ keyframesMs: [500, 2_500] }), EXPECTED)).toEqual(['keyframes']);
    expect(verifyOutput(good({ keyframesMs: [] }), EXPECTED)).toEqual(['keyframes']);
    // A clip under two seconds has the one at the start.
    expect(
      verifyOutput(good({ durationMs: 1_500, keyframesMs: [0] }), {
        ...EXPECTED,
        durationMs: 1_500,
      }),
    ).toEqual([]);
  });

  it('calls an empty file empty and nothing else', () => {
    expect(verifyOutput(good({ bytes: 0, width: null }), EXPECTED)).toEqual(['empty']);
  });

  it('lets a proof carry the profile ultrafast writes, never an export', () => {
    const baseline = good({ profile: 'Constrained Baseline' });
    expect(verifyOutput(baseline, EXPECTED)).toEqual(['profile']);
    expect(verifyOutput(baseline, { ...EXPECTED, proof: true })).toEqual([]);
    expect(verifyOutput(good({ profile: null }), { ...EXPECTED, proof: true })).toEqual([
      'profile',
    ]);
  });

  it('reads what a plan asked for, a proof included', () => {
    const encode = { gopSeconds: 2, id: 'proof' } as const;
    const output = { width: 360, height: 640, fps: 30, durationMs: 9_000 };
    expect(expectedOutputOf({ output, encode } as never)).toEqual({
      ...output,
      gopSeconds: 2,
      proof: true,
    });
  });

  it('wants the index first, and a file where it was not found fails too', () => {
    expect(verifyOutput(good({ moovFirst: null }), EXPECTED)).toEqual(['moov']);
  });
});
