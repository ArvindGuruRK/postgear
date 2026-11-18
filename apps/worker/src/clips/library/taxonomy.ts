/**
 * The sticker taxonomy (Module 12): which source words map to which of the
 * five categories (the categories and their names are the engine's). Noto's
 * own categories ("Smileys and emotions" and so on) all map to Animated
 * Emoji and stay on as tags.
 */
import { isStickerCategory, type StickerCategory } from '@postgear/video-engine';

export { isStickerCategory, STICKER_CATEGORY_NAMES } from '@postgear/video-engine';

/** Source words for each category, lowercase; the first category with a match wins. */
const WORDS: ReadonlyArray<readonly [StickerCategory, readonly string[]]> = [
  [
    'animated-emoji',
    [
      'emoji',
      'smileys and emotions',
      'people',
      'animals and nature',
      'food and drink',
      'travel and places',
      'activities and events',
      'objects',
      'symbols',
    ],
  ],
  ['gaming', ['game', 'gaming', 'controller', 'trophy', 'coin', 'crown', 'joystick', 'level']],
  ['social', ['social', 'follow', 'subscribe', 'like', 'bell', 'notification', 'share', 'comment']],
  [
    'arrows-shapes',
    ['arrow', 'shape', 'circle', 'star', 'heart', 'pointer', 'line', 'box', 'frame'],
  ],
  [
    'reactions',
    ['reaction', 'emote', 'emotion', 'expression', 'word', 'text', 'face', 'character', 'person'],
  ],
];

/**
 * The category for a candidate: the slug it gives, else the category of the
 * first of its words that maps to one, else null. Words are read in order, so
 * a source's own words (Kenney's "emote") come before an item's tags ("heart").
 */
export function categoryFor(
  given: string | undefined,
  words: readonly string[],
): StickerCategory | null {
  if (isStickerCategory(given)) return given;
  const lowered = [given, ...words]
    .filter((word): word is string => !!word)
    .map((word) => word.toLowerCase().trim());
  for (const word of lowered) {
    const match = WORDS.find(([, known]) => known.includes(word));
    if (match) return match[0];
  }
  return null;
}
