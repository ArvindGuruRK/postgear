/**
 * Sprint 12, Module 20 section 2: every edge case sentence of the stories
 * (section 5 of `docs/new-modules/user-stories-clips.md`) that lives in the
 * engine, pinned word for word against the story. The API answers with these
 * sentences and the worker stores them on a failed job, so a change here is a
 * change the person reads everywhere.
 */
import {
  CLIP_ERROR_MESSAGES,
  clipErrorMessage,
  platformPausedMessage,
  platformRestingMessage,
} from './errors';

/** The story's row, then the sentence it promises, then the code that carries it. */
const STORY_ROWS: ReadonlyArray<[string, string, keyof typeof CLIP_ERROR_MESSAGES]> = [
  [
    'The link is not YouTube, Twitch or Kick',
    'We can only read YouTube, Twitch and Kick links for now. You can upload the file instead.',
    'link_unsupported',
  ],
  [
    'The link is a channel or a playlist, not one video',
    'This link is a channel or a list. Paste the link of one video.',
    'link_not_a_video',
  ],
  [
    'The video is private, members-only, subscribers-only or age-restricted',
    'This video is private or needs a login, so we cannot read it.',
    'link_private',
  ],
  [
    'The stream is still live',
    'This stream is still live. Come back when it has ended.',
    'link_live',
  ],
  [
    'The video does not exist or was removed',
    'We could not find a video at this link.',
    'link_not_found',
  ],
  [
    'A channel name is not found',
    'We could not find that channel. Check the spelling.',
    'channel_not_found',
  ],
  [
    "The platform's list allowance for the day is used",
    "We have reached today's limit for YouTube lists. Try again tomorrow, or paste a video link.",
    'quota_exhausted',
  ],
  [
    'A channel list cannot be read',
    "This channel's list is not available right now. Try again in a few minutes.",
    'channel_listing_failed',
  ],
  [
    'The upload is not a video',
    'This file is not a video we can read. Use MP4, MOV, MKV or WebM.',
    'upload_not_video',
  ],
  [
    'Find Clips fails',
    'We could not finish looking for clips. Your AI minutes were given back.',
    'highlights_failed',
  ],
  [
    'The sharp video cannot be fetched any more',
    'The sharp video is no longer online. This clip will export at 720p from the copy we kept.',
    'sharp_gone',
  ],
  [
    'Two people edit one clip',
    'Someone else changed this clip. Reload to see their version.',
    'clip_changed_elsewhere',
  ],
  [
    'The export fails',
    'We could not export this clip. Nothing was charged. Try again.',
    'export_failed',
  ],
  ['Preview Export fails', 'We could not make the preview. Try again.', 'preview_failed'],
  [
    'A download is asked for a format that is gone',
    'This quality is no longer offered for this video. Pick another.',
    'format_gone',
  ],
  [
    'The video was removed after a rights request',
    'This video was removed after a request from its owner.',
    'video_removed',
  ],
];

describe('the edge case sentences, as the stories write them', () => {
  it.each(STORY_ROWS)('"%s" reads "%s" (%s)', (_row, sentence, code) => {
    expect(CLIP_ERROR_MESSAGES[code]).toBe(sentence);
    expect(clipErrorMessage(code)).toBe(sentence);
  });

  it('"The platform refuses or does not answer" names the platform', () => {
    expect(platformRestingMessage('youtube')).toBe(
      'YouTube is not answering us right now. Try again in a little while, or upload the file instead.',
    );
    expect(platformRestingMessage('twitch')).toBe(
      'Twitch is not answering us right now. Try again in a little while, or upload the file instead.',
    );
    expect(clipErrorMessage('platform_resting', 'kick')).toBe(
      'Kick is not answering us right now. Try again in a little while, or upload the file instead.',
    );
  });

  it('"The platform is switched off" names the platform', () => {
    expect(platformPausedMessage('youtube')).toBe(
      'YouTube links are paused for now. You can upload the file instead.',
    );
    expect(clipErrorMessage('platform_paused', 'twitch')).toBe(
      'Twitch links are paused for now. You can upload the file instead.',
    );
  });

  it('the export failures the worker can meet all read as the one export sentence', () => {
    for (const code of ['export_failed', 'font_missing', 'render_output_invalid'] as const) {
      expect(CLIP_ERROR_MESSAGES[code]).toBe(
        'We could not export this clip. Nothing was charged. Try again.',
      );
    }
  });

  it('"The import fails half way": a reason the engine does not know reads as one plain sentence', () => {
    expect(clipErrorMessage('something_new')).toBe(
      'Something went wrong on our side. Try again in a little while.',
    );
  });
});
