/**
 * Sprint 13, Module 16 section 2: the engine's share of the Clips AI stories'
 * edge cases (section 5 of `docs/new-modules/user-stories-clips-ai.md`).
 *
 * Every sentence a job or a refusal carries lives in `errors.ts`, so this file
 * pins each one the stories name, word for word as the code says it. Where
 * the code says more than the story (what to do next, the site's name), the
 * code's sentence is the one kept; the Module 16 report lists each difference.
 * The Sprint 12 rows are `edge-cases.test.ts`.
 */
import { createClipDocument } from './document/create';
import {
  builtInCaptionStyle,
  type CaptionLook,
  captionLayout,
  createCaptionsTrack,
} from './captions';
import {
  CLIP_ERROR_MESSAGES,
  clipErrorMessage,
  NON_RETRYABLE_CLIP_CODES,
  platformPausedMessage,
  platformRestingMessage,
} from './errors';
import { CLIP_PLATFORMS, PLATFORM_NAMES } from './links/types';
import {
  emptyTranscript,
  isLanguageChoice,
  isUnsure,
  mergeTranscript,
  UNSURE_BELOW,
} from './transcript';

describe('the Clips AI edge case sentences', () => {
  it('"No speech in the video"', () => {
    expect(CLIP_ERROR_MESSAGES.no_speech).toBe('We could not hear any speech in this video.');
  });

  it('"A language we do not support" says what to do next', () => {
    expect(CLIP_ERROR_MESSAGES.language_unsupported).toBe(
      'We cannot make captions in this language yet. Pick another language.',
    );
    // A language with no font for its captions is not one a request may name.
    expect(isLanguageChoice('ja')).toBe(false);
    expect(isLanguageChoice('auto')).toBe(true);
    expect(isLanguageChoice('ta')).toBe(true);
  });

  it('"The AI service is not running"', () => {
    expect(CLIP_ERROR_MESSAGES.captions_off).toBe(
      'Captions are not available right now. Everything else still works.',
    );
  });

  it('"Listening fails half way" says the minutes were given back', () => {
    expect(CLIP_ERROR_MESSAGES.transcribe_failed).toBe(
      'We could not finish listening to this video. Your AI minutes were given back.',
    );
    // A failure worth another try: Try Again is offered, and Temporal may retry it.
    expect(NON_RETRYABLE_CLIP_CODES).not.toContain('transcribe_failed');
  });

  it('no speech, an unsupported language and captions off are never tried again', () => {
    for (const code of ['no_speech', 'language_unsupported', 'captions_off']) {
      expect(NON_RETRYABLE_CLIP_CODES).toContain(code);
    }
  });

  it('"An emote stretch is longer than 3 seconds", from the server', () => {
    expect(CLIP_ERROR_MESSAGES.emote_too_long).toBe(
      'An emote can be at most 3 seconds long. Pick a shorter stretch.',
    );
  });

  it('"A captions file cannot be read"', () => {
    expect(CLIP_ERROR_MESSAGES.captions_file_unreadable).toBe(
      'We could not read this captions file. Check that it is an SRT or VTT file.',
    );
  });

  it('"A link from TikTok or Instagram while they are off" names the site and offers the upload', () => {
    expect(platformPausedMessage('tiktok')).toBe(
      'TikTok links are paused for now. You can upload the file instead.',
    );
    expect(clipErrorMessage('platform_paused', 'instagram')).toBe(
      'Instagram links are paused for now. You can upload the file instead.',
    );
  });

  it('"A montage of clips with different shapes"', () => {
    expect(CLIP_ERROR_MESSAGES.montage_shapes_differ).toBe(
      'These clips have different shapes. Pick one shape for the montage.',
    );
  });

  it('"A link from a newly added site fails": the Sprint 12 sentences, with the site name', () => {
    const sprint12 = platformRestingMessage('youtube').replace('YouTube', '{site}');
    for (const platform of CLIP_PLATFORMS) {
      const name = PLATFORM_NAMES[platform];
      expect(clipErrorMessage('platform_resting', platform)).toBe(sprint12.replace('{site}', name));
      expect(clipErrorMessage('platform_paused', platform)).toBe(
        platformPausedMessage('youtube').replace('YouTube', name),
      );
    }
  });

  it('"Google Drive is not connected, or access was removed" asks for the file again', () => {
    // No Drive connection is stored: each pick signs in through Google's own picker.
    expect(CLIP_ERROR_MESSAGES.drive_not_connected).toBe(
      'Google Drive did not let us read this file. Pick it again from Google Drive.',
    );
    expect(NON_RETRYABLE_CLIP_CODES).toContain('drive_not_connected');
  });

  it('"Text To Speech in a language the voice cannot read"', () => {
    expect(CLIP_ERROR_MESSAGES.voice_language).toBe(
      'This voice cannot read this language. Pick another voice.',
    );
  });
});

describe('"Two languages in one video"', () => {
  // English and Tamil in one stream, as a listener heard them: the Tamil words less sure.
  const HEARD: Array<[string, number]> = [
    ['Okay', 0.95],
    ['friends', 0.92],
    ['நண்பர்களே', 0.41],
    ['இந்த', 0.55],
    ['game', 0.9],
    ['அருமை', 0.38],
    ['right', 0.93],
  ];
  const transcript = mergeTranscript(emptyTranscript('en', 'simulation'), {
    ranges: [{ fromMs: 10_000, toMs: 20_000 }],
    words: HEARD.map(([text, sure], index) => ({
      start: 10_000 + index * 1_000,
      end: 10_000 + index * 1_000 + 600,
      text,
      sure,
    })),
  });
  const look = builtInCaptionStyle('bold-pop')?.look as CaptionLook;
  const layout = captionLayout({
    doc: createClipDocument({
      videoId: '5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e',
      fromMs: 10_000,
      toMs: 20_000,
      ratio: '9:16',
    }),
    track: createCaptionsTrack({
      transcriptAssetId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      language: 'en',
      styleId: 'bold-pop',
      look,
    }),
    look,
    transcript,
    wordTimed: true,
  });

  it('captions every word of both languages, in the order said', () => {
    expect(layout.words.map((word) => word.text)).toEqual(HEARD.map(([text]) => text));
    const paged = layout.pages.flatMap((page) => page.words.map((word) => word.i));
    expect(paged).toEqual(layout.words.map((word) => word.i));
  });

  it('keeps the unsure words unsure, so they are underlined', () => {
    const unsure = layout.words.filter((word) => isUnsure(word)).map((word) => word.text);
    expect(unsure).toEqual(['நண்பர்களே', 'இந்த', 'அருமை']);
    expect(HEARD.filter(([, sure]) => sure < UNSURE_BELOW)).toHaveLength(3);
  });
});
