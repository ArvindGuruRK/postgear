/**
 * The shared validator, against hand-built rules.
 *
 * Deliberately independent of any real provider: these tests pin the
 * validator's behaviour, and `providers.test.ts` separately pins that each
 * provider declares the rules it actually honours. A change to one should not
 * silently pass by changing the other.
 */
import type { ProviderRules } from './rules';
import { type ComposedPart, firstIssueMessage, formatBytes, validatePost } from './validate';

const MB = 1024 * 1024;

function rules(
  overrides: Partial<ProviderRules> = {},
  media: Partial<ProviderRules['media']> = {},
): ProviderRules {
  return {
    maxLength: 280,
    lengthMethod: 'utf16',
    thread: 'replies',
    followUpMedia: true,
    ...overrides,
    media: {
      required: false,
      maxItems: 4,
      maxImages: 4,
      maxVideos: 1,
      allowMixed: false,
      ...media,
    },
  };
}

const text = (value: string): ComposedPart => ({ text: value, media: [] });
const image = (extra: Partial<ComposedPart['media'][number]> = {}) => ({
  type: 'image' as const,
  ...extra,
});
const video = (extra: Partial<ComposedPart['media'][number]> = {}) => ({
  type: 'video' as const,
  ...extra,
});

function codes(ruleSet: ProviderRules, parts: ComposedPart[], title?: string) {
  return validatePost(ruleSet, parts, { providerName: 'Test', title }).map(
    (issue) => `${issue.part}:${issue.code}`,
  );
}

describe('validatePost', () => {
  it('accepts a plain post within the limit', () => {
    expect(codes(rules(), [text('hello')])).toEqual([]);
  });

  it('reports length against the rendered text, naming the part in a thread', () => {
    const issues = validatePost(rules({ maxLength: 5 }), [text('fine'), text('too long')], {
      providerName: 'X',
    });

    expect(issues).toEqual([
      { code: 'too_long', part: 1, message: 'X allows 5 characters; part 2 has 8.' },
    ]);
  });

  it('words a single-part length issue as "this post"', () => {
    expect(
      firstIssueMessage(
        validatePost(rules({ maxLength: 3 }), [text('four')], { providerName: 'X' }),
      ),
    ).toBe('X allows 3 characters; this post has 4.');
  });

  it('flags an empty part, but not a media-only one', () => {
    expect(codes(rules(), [text('   ')])).toEqual(['0:empty']);
    expect(codes(rules(), [{ text: '', media: [image()] }])).toEqual([]);
  });

  describe('media', () => {
    it('requires media on the first part only', () => {
      const instagram = rules(
        { thread: 'comments', followUpMedia: false },
        { required: true, allowMixed: true, maxItems: 10, maxImages: 10, maxVideos: 10 },
      );

      expect(codes(instagram, [text('caption'), text('a comment')])).toEqual(['0:media_required']);
    });

    it('does not let an unaccepted attachment satisfy a required one', () => {
      const youtube = rules(
        { thread: 'none' },
        { required: true, maxItems: 1, maxImages: 0, maxVideos: 1 },
      );

      expect(codes(youtube, [{ text: 'hi', media: [image()] }])).toEqual([
        '0:images_not_supported',
        '0:media_required',
      ]);
    });

    it('words the requirement by what the platform accepts', () => {
      const message = (maxImages: number, maxVideos: number) =>
        firstIssueMessage(
          validatePost(rules({}, { required: true, maxImages, maxVideos }), [text('hi')], {
            providerName: 'P',
          }),
        );

      expect(message(10, 10)).toBe('P posts must include at least one image or video.');
      expect(message(0, 1)).toBe('P posts must have exactly one video.');
      expect(message(1, 0)).toBe('P posts must include one image.');
      expect(message(5, 0)).toBe('P posts must include at least one image.');
    });

    it('refuses to mix images and video where the platform cannot', () => {
      expect(
        firstIssueMessage(
          validatePost(rules(), [{ text: 'hi', media: [image(), video()] }], { providerName: 'X' }),
        ),
      ).toBe('X posts can have images or one video, not both.');
      expect(
        codes(rules({}, { allowMixed: true }), [{ text: 'hi', media: [image(), video()] }]),
      ).toEqual([]);
    });

    it('treats a GIF as needing to stand alone where the rules say so', () => {
      const x = rules({}, { gifCountsAsVideo: true });

      expect(codes(x, [{ text: '', media: [image({ mimeType: 'image/gif' })] }])).toEqual([]);
      expect(codes(x, [{ text: '', media: [image({ mimeType: 'image/gif' }), image()] }])).toEqual([
        '0:gif_not_alone',
      ]);
    });

    it('reports a per-type limit instead of repeating it as a total', () => {
      const five = Array.from({ length: 5 }, () => image());

      expect(codes(rules(), [{ text: '', media: five }])).toEqual(['0:too_many_images']);
      expect(
        codes(rules({}, { maxItems: 3, allowMixed: true }), [
          { text: '', media: [image(), image(), image(), video()] },
        ]),
      ).toEqual(['0:too_many_items']);
    });

    it('names unsupported video honestly, as a PostGear limitation', () => {
      expect(
        firstIssueMessage(
          validatePost(rules({}, { maxVideos: 0 }), [{ text: 'hi', media: [video()] }], {
            providerName: 'LinkedIn',
          }),
        ),
      ).toBe("PostGear can't publish video to LinkedIn yet.");
    });

    it('checks image type only when it is known', () => {
      const jpegOnly = rules({}, { imageMimeTypes: ['image/jpeg'] });

      expect(codes(jpegOnly, [{ text: '', media: [image()] }])).toEqual([]);
      expect(
        firstIssueMessage(
          validatePost(jpegOnly, [{ text: '', media: [image({ mimeType: 'image/png' })] }], {
            providerName: 'Instagram',
          }),
        ),
      ).toBe('Instagram only accepts JPEG images.');
    });

    it('applies the GIF size limit to GIFs and the image limit to everything else', () => {
      const x = rules({}, { maxImageBytes: 5 * MB, maxGifBytes: 15 * MB, maxVideoBytes: 512 * MB });

      expect(
        codes(x, [{ text: '', media: [image({ mimeType: 'image/gif', bytes: 10 * MB })] }]),
      ).toEqual([]);
      expect(
        firstIssueMessage(
          validatePost(
            x,
            [{ text: '', media: [image({ mimeType: 'image/jpeg', bytes: 6 * MB })] }],
            { providerName: 'X' },
          ),
        ),
      ).toBe('Images on X must be 5 MB or smaller.');
    });

    it('checks aspect ratio only when both dimensions are known', () => {
      const instagram = rules({}, { imageAspectRatio: { min: 0.8, max: 1.91 } });

      expect(
        codes(instagram, [{ text: '', media: [image({ width: 1080, height: 1350 })] }]),
      ).toEqual([]);
      expect(codes(instagram, [{ text: '', media: [image({ width: 1080 })] }])).toEqual([]);
      expect(
        firstIssueMessage(
          validatePost(instagram, [{ text: '', media: [image({ width: 1080, height: 1920 })] }], {
            providerName: 'Instagram',
          }),
        ),
      ).toBe('Instagram images must be between 4:5 (tall) and 1.91:1 (wide).');
    });
  });

  describe('multi-part posts', () => {
    it('reports once when the platform has no threads, and ignores the parts that would be lost', () => {
      const none = rules({ thread: 'none', maxLength: 3 });

      expect(codes(none, [text('ok'), text('far too long'), text('also too long')])).toEqual([
        '1:thread_unsupported',
      ]);
    });

    it('flags media on a part that will be published as a comment', () => {
      const comments = rules({ thread: 'comments', followUpMedia: false });

      expect(
        codes(comments, [
          { text: 'post', media: [image()] },
          { text: 'comment', media: [image()] },
        ]),
      ).toEqual(['1:follow_up_media']);
    });

    it('allows media on every part of a native thread', () => {
      expect(
        codes(rules(), [
          { text: 'one', media: [image()] },
          { text: 'two', media: [image()] },
        ]),
      ).toEqual([]);
    });
  });

  describe('titles', () => {
    const youtube = rules({ title: { maxLength: 100, forbiddenCharacters: ['<', '>'] } });

    it('takes the title from the first line unless one is given', () => {
      expect(codes(youtube, [text(`${'t'.repeat(101)}\nbody`)])).toEqual(['0:title_too_long']);
      expect(codes(youtube, [text(`${'t'.repeat(101)}\nbody`)], 'Short title')).toEqual([]);
    });

    it('rejects the characters the platform refuses', () => {
      expect(
        firstIssueMessage(
          validatePost(youtube, [text('A <b> title')], { providerName: 'YouTube' }),
        ),
      ).toBe('YouTube titles cannot contain < or > characters.');
    });
  });
});

describe('formatBytes', () => {
  it('uses binary megabytes', () => {
    expect(formatBytes(5 * MB)).toBe('5 MB');
    expect(formatBytes(1.5 * MB)).toBe('1.5 MB');
    expect(formatBytes(2048)).toBe('2 KB');
  });
});
