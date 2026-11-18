/**
 * The sound taxonomy (Module 14): which source words map to which of the
 * fourteen categories (the categories, their names and kinds are the
 * engine's), the tags a sound keeps, and the hints a Kenney pack's own name
 * gives.
 */
import {
  isSoundCategory,
  type SoundCategory,
  type SoundKind,
  soundKindOfCategory,
} from '@postgear/video-engine';
import { plainWords } from './brands';

export { isSoundCategory, SOUND_CATEGORY_NAMES, soundKindOfCategory } from '@postgear/video-engine';

/** Effect words for each category, lowercase; the first word of a candidate that maps wins. */
const SFX_WORDS: ReadonlyArray<readonly [SoundCategory, readonly string[]]> = [
  [
    'whooshes',
    [
      'whoosh',
      'swoosh',
      'swish',
      'woosh',
      'swing',
      'swipe air',
      'fly by',
      'flyby',
      'pass by',
      'whip',
    ],
  ],
  [
    'impacts',
    [
      'impact',
      'hit',
      'punch',
      'slam',
      'thud',
      'boom',
      'crash',
      'smash',
      'bang',
      'knock',
      'footstep',
      'footsteps',
      'explosion',
    ],
  ],
  [
    'alerts',
    [
      'alert',
      'alerts',
      'bell',
      'ding',
      'chime',
      'notification',
      'notify',
      'click',
      'beep',
      'ping',
      'pop',
      'toggle',
      'confirmation',
      'error',
      'select',
      'switch',
      'interface',
      'ui',
      'message',
    ],
  ],
  [
    'ambient',
    [
      'ambient',
      'ambience',
      'ambiance',
      'atmosphere',
      'room tone',
      'rain',
      'wind',
      'crowd',
      'waves',
      'ocean',
      'forest',
      'birds',
      'city',
      'traffic',
      'fire',
      'hum',
    ],
  ],
  [
    'comedy',
    [
      'comedy',
      'funny',
      'cartoon',
      'laugh',
      'boing',
      'honk',
      'squeak',
      'slide whistle',
      'kazoo',
      'silly',
    ],
  ],
  [
    'gaming',
    [
      'game',
      'gaming',
      'arcade',
      'retro',
      'chiptune',
      '8 bit',
      'coin',
      'jump',
      'power up',
      'powerup',
      'laser',
      'level up',
      'pickup',
      'sci fi',
      'scifi',
      'digital',
      'casino',
      'rpg',
    ],
  ],
  [
    'transitions',
    [
      'transition',
      'riser',
      'rise',
      'swipe',
      'glitch',
      'sweep',
      'stinger',
      'downlifter',
      'uplifter',
      'reverse',
    ],
  ],
  [
    'reactions',
    [
      'reaction',
      'applause',
      'clap',
      'cheer',
      'gasp',
      'wow',
      'aww',
      'fanfare',
      'win',
      'lose',
      'fail',
      'jingle',
      'voice',
    ],
  ],
];

/** Music words for each category. */
const MUSIC_WORDS: ReadonlyArray<readonly [SoundCategory, readonly string[]]> = [
  ['lofi', ['lofi', 'lo fi', 'chillhop', 'hip hop', 'hiphop', 'study', 'jazz']],
  ['epic', ['epic', 'battle', 'heroic', 'boss', 'war', 'march', 'action']],
  ['tense', ['tense', 'suspense', 'tension', 'dark', 'horror', 'thriller', 'mystery', 'creepy']],
  ['cinematic', ['cinematic', 'orchestral', 'film', 'emotional', 'inspiring', 'sad', 'adventure']],
  [
    'upbeat',
    [
      'upbeat',
      'happy',
      'cheerful',
      'energetic',
      'pop',
      'dance',
      'fun',
      'bright',
      'positive',
      'victory',
    ],
  ],
  [
    'calm',
    [
      'calm',
      'relax',
      'relaxing',
      'peaceful',
      'soft',
      'gentle',
      'chill',
      'meditation',
      'piano',
      'ambient',
    ],
  ],
];

/** Every word of a text, and every pair of neighbouring words ("room tone", "power up"). */
function phrases(text: string): string[] {
  const words = plainWords(text).trim().split(' ').filter(Boolean);
  const pairs = words.slice(1).map((word, k) => `${words[k]} ${word}`);
  return [...pairs, ...words];
}

/**
 * The category for a candidate: the slug it gives, else the category of the
 * first of its words that maps to one in the kind it is (or either kind when
 * the source does not say), else null. A pair of words is tried before its
 * single words, and a source's own words before an item's tags.
 */
export function soundCategoryFor(
  given: string | undefined,
  words: readonly string[],
  kind?: SoundKind,
): SoundCategory | null {
  if (isSoundCategory(given) && (!kind || soundKindOfCategory(given) === kind)) return given;
  const tables =
    kind === 'music' ? [MUSIC_WORDS] : kind === 'sfx' ? [SFX_WORDS] : [SFX_WORDS, MUSIC_WORDS];
  for (const text of [given, ...words]) {
    if (!text) continue;
    for (const phrase of phrases(text)) {
      for (const table of tables) {
        const match = table.find(([, known]) => known.includes(phrase));
        if (match) return match[0];
      }
    }
  }
  return null;
}

/** A sound's tags: lowercase, plain, deduplicated, brand words taken out, at most 12. */
export function soundTags(tags: readonly string[], brands: readonly string[]): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    const plain = plainWords(tag).trim();
    if (plain.length < 2 || plain.length > 40) continue;
    if (brands.some((brand) => ` ${plain} `.includes(` ${brand} `))) continue;
    if (!out.includes(plain)) out.push(plain);
    if (out.length === 12) break;
  }
  return out;
}

/**
 * What a Kenney audio pack's own name says (Module 14 doc): its kind, its
 * category when the pack is all one thing, and the words to try first.
 * Music Jingles are music by tag (`upbeat` or `cinematic`); a jingle too
 * short for music becomes a Reactions effect.
 */
export interface KenneyPackHint {
  kind: SoundKind;
  category?: SoundCategory;
  words: readonly string[];
  /** The effect category a sound takes when it is too short for music. */
  shortCategory?: SoundCategory;
}

export function kenneyPackHint(packName: string): KenneyPackHint | null {
  const name = plainWords(packName);
  if (name.includes(' impact ')) return { kind: 'sfx', category: 'impacts', words: ['impact'] };
  if (name.includes(' interface ') || name.includes(' ui audio ') || name.includes(' ui '))
    return { kind: 'sfx', category: 'alerts', words: ['interface'] };
  if (name.includes(' sci fi ') || name.includes(' digital '))
    return { kind: 'sfx', category: 'gaming', words: ['sci fi'] };
  if (name.includes(' casino ') || name.includes(' rpg '))
    return { kind: 'sfx', category: 'gaming', words: ['game'] };
  if (name.includes(' voiceover ') || name.includes(' voice over '))
    return { kind: 'sfx', category: 'reactions', words: ['voice'] };
  if (name.includes(' jingles ') || name.includes(' music '))
    return { kind: 'music', words: ['upbeat'], shortCategory: 'reactions' };
  return null;
}
