/**
 * Sprint 13, Module 16 section 2: the web's Clips AI edge case sentences
 * (`docs/new-modules/user-stories-clips-ai.md` section 5), word for word.
 *
 * The render tests show each one at the right moment through its constant
 * (`follow-speaker.test.tsx`, `detect-camera.test.tsx`,
 * `schedule-maker.test.tsx` and the rest), so a changed word would still pass
 * there. This file pins the words. Where the code says more than the story,
 * the code's sentence is kept; the Module 16 report lists each difference.
 */
import { NO_SCHEDULE_NOTE } from '@/components/studio/schedule-field-model';
import { skipSentence } from './editor/recipe-model';
import { NO_FACE_CAMERA } from './layouts/detect-camera-model';
import { MANY_FACES, NO_ONE_TO_FOLLOW } from './layouts/follow-model';
import { NO_BLEEP_WORDS } from './panels/ai-effects-model';
import { CAPTIONS_OFF } from './panels/captions-model';
import { UNSURE_NOTE } from './transcript/transcript-model';
import { CLIP_TOO_SHORT } from './video/video-page-model';

describe('the Clips AI edge case sentences on the web', () => {
  it.each([
    [
      'Speech under loud game sound or music',
      UNSURE_NOTE,
      'Some words were hard to hear. Check the underlined ones.',
    ],
    [
      'Schedule Maker finds no Twitch schedule',
      NO_SCHEDULE_NOTE,
      'This channel has no Twitch schedule. Fill it in by hand.',
    ],
    ['No face in the video', NO_ONE_TO_FOLLOW, 'We could not find anyone to follow in this clip.'],
    ['Many faces (a crowd)', MANY_FACES, 'There are many faces here. Pick who to follow.'],
    [
      'Detect Camera finds nothing',
      NO_FACE_CAMERA,
      'We could not find a face camera. Drag the box yourself.',
    ],
    [
      'A deleted sentence would leave the clip under 3 seconds',
      CLIP_TOO_SHORT,
      'A clip needs at least 3 seconds.',
    ],
    ['Bleep finds nothing', NO_BLEEP_WORDS, 'No words to bleep in this clip.'],
  ])('"%s"', (_row, shown, story) => {
    expect(shown).toBe(story);
  });

  it('"An Auto-Edit recipe needs a part that is missing" names the part skipped', () => {
    expect(skipSentence({ part: 'follow', reason: 'no_faces' })).toBe(
      'Follow The Speaker was skipped: we could not find anyone to follow.',
    );
  });

  it('"The AI service is not running" in the captions panel points at the file upload', () => {
    // The story's "Everything else still works" is the API sentence (`captions_off`);
    // the panel says what still works there, which is the upload beside it.
    expect(CAPTIONS_OFF).toBe(
      'Captions from speech are not available right now. You can still upload a captions file.',
    );
  });
});
