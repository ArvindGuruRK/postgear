import { FACEBOOK_RULES } from '../providers/facebook';
import { INSTAGRAM_RULES } from '../providers/instagram';
import { INSTAGRAM_STANDALONE_RULES } from '../providers/instagram-standalone';
import { LINKEDIN_RULES } from '../providers/linkedin';
import { PINTEREST_RULES } from '../providers/pinterest';
import { THREADS_RULES } from '../providers/threads';
import { TIKTOK_RULES } from '../providers/tiktok';
import { X_RULES } from '../providers/twitter';
import { YOUTUBE_RULES } from '../providers/youtube';
import type { ProviderRules } from './rules';
import {
  formatLengthLimit,
  formatVideoLength,
  type VideoFacts,
  videoFit,
  videoFitSentence,
  videoShapeOf,
} from './video-fit';

const MB = 1024 * 1024;
const MINUTE = 60_000;

function rules(media: Partial<ProviderRules['media']> = {}): Pick<ProviderRules, 'media'> {
  return {
    media: {
      required: false,
      maxItems: 1,
      maxImages: 0,
      maxVideos: 1,
      allowMixed: false,
      ...media,
    },
  };
}

/** A 40 second vertical 1080p clip of 20 MB. */
const clip = (extra: Partial<VideoFacts> = {}): VideoFacts => ({
  durationMs: 40_000,
  width: 1080,
  height: 1920,
  bytes: 20 * MB,
  ...extra,
});

function sentenceFor(media: Partial<ProviderRules['media']>, facts: VideoFacts): string {
  const fit = videoFit(rules(media), facts);
  if (fit.ok) throw new Error('expected a refusal');
  return videoFitSentence(fit, 'Facebook', facts);
}

describe('videoFit', () => {
  it('fits a platform with no video limits', () => {
    expect(videoFit(rules(), clip())).toEqual({ ok: true });
  });

  it('no_video: a platform that takes no video here', () => {
    expect(videoFit(rules({ maxVideos: 0 }), clip())).toEqual({
      ok: false,
      reason: 'no_video',
      limit: null,
    });
    expect(sentenceFor({ maxVideos: 0 }, clip())).toBe('Facebook does not take video here.');
  });

  it('too_long: names the clip length and the limit', () => {
    const facts = clip({ durationMs: 130_000 });
    expect(videoFit(rules({ videoMaxMs: 90_000 }), facts)).toEqual({
      ok: false,
      reason: 'too_long',
      limit: 90_000,
    });
    expect(sentenceFor({ videoMaxMs: 90_000 }, facts)).toBe(
      'This clip is 2 min 10 s. Facebook takes up to 90 seconds.',
    );
    // Exactly at the limit fits.
    expect(videoFit(rules({ videoMaxMs: 90_000 }), clip({ durationMs: 90_000 })).ok).toBe(true);
  });

  it('too_short', () => {
    const facts = clip({ durationMs: 2_000 });
    expect(videoFit(rules({ videoMinMs: 3_000 }), facts)).toMatchObject({
      ok: false,
      reason: 'too_short',
      limit: 3_000,
    });
    expect(sentenceFor({ videoMinMs: 3_000 }, facts)).toBe(
      'This clip is shorter than Facebook allows.',
    );
  });

  it('wrong_shape: a wide clip where only vertical or square is taken', () => {
    const facts = clip({ width: 1920, height: 1080 });
    const media = { videoRatios: ['9:16', '1:1', '4:5'] as const };
    expect(videoFit(rules(media), facts)).toMatchObject({ ok: false, reason: 'wrong_shape' });
    expect(sentenceFor(media, facts)).toBe('Facebook needs a vertical or square video.');
    expect(videoFit(rules(media), clip()).ok).toBe(true);
    expect(videoFit(rules({ videoRatios: 'any' }), facts).ok).toBe(true);
    expect(sentenceFor({ videoRatios: ['9:16'] }, facts)).toBe('Facebook needs a vertical video.');
  });

  it('too_big: names the file size and the limit', () => {
    const facts = clip({ bytes: 340 * MB });
    expect(videoFit(rules({ maxVideoBytes: 300 * MB }), facts)).toMatchObject({
      ok: false,
      reason: 'too_big',
      limit: 300 * MB,
    });
    expect(sentenceFor({ maxVideoBytes: 300 * MB }, facts)).toBe(
      'This file is 340 MB. Facebook takes up to 300 MB.',
    );
  });

  it('too_wide', () => {
    const facts = clip({ width: 2160, height: 3840 });
    expect(videoFit(rules({ videoMaxWidth: 1920 }), facts)).toMatchObject({
      ok: false,
      reason: 'too_wide',
      limit: 1920,
    });
    expect(sentenceFor({ videoMaxWidth: 1920 }, facts)).toBe(
      'This clip is 2160 pixels wide. Facebook takes up to 1920.',
    );
  });

  it('checks the rules in order and reports the first one broken', () => {
    const facts = clip({ durationMs: 200_000, bytes: 999 * MB, width: 4000, height: 2250 });
    const media = {
      videoMaxMs: 90_000,
      videoRatios: ['9:16'] as const,
      maxVideoBytes: 300 * MB,
      videoMaxWidth: 1920,
    };
    expect(videoFit(rules(media), facts)).toMatchObject({ reason: 'too_long' });
  });

  it('never holds an unknown fact against a video', () => {
    const unknown: VideoFacts = { durationMs: null, width: null, height: null, bytes: null };
    const strict = {
      videoMinMs: 3_000,
      videoMaxMs: 90_000,
      videoRatios: ['9:16'] as const,
      maxVideoBytes: MB,
      videoMaxWidth: 720,
    };
    expect(videoFit(rules(strict), unknown)).toEqual({ ok: true });
  });
});

describe('videoShapeOf', () => {
  it('names the four shapes, with a little room, and nothing else', () => {
    expect(videoShapeOf(1080, 1920)).toBe('9:16');
    expect(videoShapeOf(720, 1280)).toBe('9:16');
    expect(videoShapeOf(1920, 1080)).toBe('16:9');
    expect(videoShapeOf(1080, 1080)).toBe('1:1');
    expect(videoShapeOf(1080, 1350)).toBe('4:5');
    expect(videoShapeOf(1078, 1920)).toBe('9:16');
    expect(videoShapeOf(1000, 3000)).toBeNull();
    expect(videoShapeOf(0, 1920)).toBeNull();
  });
});

describe('lengths in words', () => {
  it('a video length', () => {
    expect(formatVideoLength(42_000)).toBe('42 s');
    expect(formatVideoLength(120_000)).toBe('2 min');
    expect(formatVideoLength(130_400)).toBe('2 min 10 s');
  });

  it('a limit', () => {
    expect(formatLengthLimit(90_000)).toBe('90 seconds');
    expect(formatLengthLimit(60_000)).toBe('60 seconds');
    expect(formatLengthLimit(3 * MINUTE)).toBe('3 minutes');
    expect(formatLengthLimit(15 * MINUTE)).toBe('15 minutes');
    expect(formatLengthLimit(1_000)).toBe('1 second');
  });
});

describe('each platform declares its video rules (research 07, section 7)', () => {
  it('Instagram, both ways: Reels take 3 s to 15 min, 300 MB, up to 1920 px wide', () => {
    for (const media of [INSTAGRAM_RULES.media, INSTAGRAM_STANDALONE_RULES.media]) {
      expect(media).toMatchObject({
        videoMinMs: 3_000,
        videoMaxMs: 15 * MINUTE,
        maxVideoBytes: 300 * MB,
        videoMaxWidth: 1920,
      });
    }
  });

  it('Threads: five minutes, 1 GB, up to 1920 px wide', () => {
    expect(THREADS_RULES.media).toMatchObject({
      videoMaxMs: 5 * MINUTE,
      maxVideoBytes: 1024 * MB,
      videoMaxWidth: 1920,
    });
  });

  it('TikTok: ten minutes, 4 GB, up to 4096 px', () => {
    expect(TIKTOK_RULES.media).toMatchObject({
      videoMaxMs: 10 * MINUTE,
      maxVideoBytes: 4 * 1024 * MB,
      videoMaxWidth: 4096,
    });
  });

  it('X: half a second to 20 minutes, 512 MB through PostGear', () => {
    expect(X_RULES.media).toMatchObject({
      videoMinMs: 500,
      videoMaxMs: 20 * MINUTE,
      maxVideoBytes: 512 * MB,
    });
  });

  it('YouTube: fifteen minutes (an unverified account), any shape', () => {
    expect(YOUTUBE_RULES.media.videoMaxMs).toBe(15 * MINUTE);
    expect(YOUTUBE_RULES.media.videoRatios ?? 'any').toBe('any');
  });

  it('Facebook posts a Page video, not a Reel: no length or shape limit', () => {
    expect(FACEBOOK_RULES.media.maxVideos).toBe(1);
    expect(FACEBOOK_RULES.media.videoMaxMs).toBeUndefined();
    expect(FACEBOOK_RULES.media.videoRatios).toBeUndefined();
  });

  it('LinkedIn and Pinterest take no video here', () => {
    for (const media of [LINKEDIN_RULES.media, PINTEREST_RULES.media]) {
      expect(videoFit({ media }, clip())).toMatchObject({ reason: 'no_video' });
    }
  });

  it('a 2 minute wide clip fits every platform that takes video', () => {
    const wide = clip({ durationMs: 120_000, width: 1920, height: 1080 });
    for (const rule of [
      INSTAGRAM_RULES,
      INSTAGRAM_STANDALONE_RULES,
      THREADS_RULES,
      TIKTOK_RULES,
      X_RULES,
      YOUTUBE_RULES,
      FACEBOOK_RULES,
    ]) {
      expect(videoFit(rule, wide)).toEqual({ ok: true });
    }
  });
});
