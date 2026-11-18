/**
 * The brand block list (Module 12): company, product, platform, game, film
 * and show names a library item may not carry in its name or tags, because
 * a sticker named after someone else's brand is a trademark problem even
 * under an open licence. The operator extends it with a file of one name per
 * line (`--brands <file>` or `CLIPS_LIBRARY_BRANDS_FILE`).
 */
import { readFileSync } from 'node:fs';

export const BUILT_IN_BRANDS: readonly string[] = [
  // Platforms and companies.
  'youtube',
  'twitch',
  'kick',
  'tiktok',
  'instagram',
  'facebook',
  'meta',
  'twitter',
  'threads',
  'snapchat',
  'discord',
  'reddit',
  'linkedin',
  'pinterest',
  'whatsapp',
  'telegram',
  'spotify',
  'netflix',
  'disney',
  'pixar',
  'marvel',
  'dc comics',
  'warner',
  'google',
  'android',
  'microsoft',
  'iphone',
  'ipad',
  'macbook',
  'amazon',
  'coca cola',
  'pepsi',
  'nike',
  'adidas',
  'mcdonalds',
  'starbucks',
  'tesla',
  'giphy',
  'tenor',
  'klipy',
  // Games and consoles.
  'nintendo',
  'playstation',
  'xbox',
  'pokemon',
  'pikachu',
  'mario',
  'zelda',
  'sonic',
  'fortnite',
  'minecraft',
  'roblox',
  'valorant',
  'league of legends',
  'call of duty',
  'among us',
  'grand theft auto',
  'overwatch',
  'genshin',
  'tetris',
  'pac man',
  // Films, shows and characters.
  'star wars',
  'harry potter',
  'batman',
  'superman',
  'spiderman',
  'spider man',
  'avengers',
  'simpsons',
  'spongebob',
  'shrek',
  'barbie',
  'lego',
  'hello kitty',
  'mickey',
  'minions',
  'peppa pig',
  'friends tv',
  'the office',
  'game of thrones',
];

/**
 * Brand words only a sound is refused for (Module 14): StreamLadder's own
 * list carries "Windows 10 Notification", and an Apple or a Windows sound is
 * that company's. A sticker of an apple or a window is fruit and glass, so
 * the shared list leaves them out.
 */
export const SOUND_ONLY_BRANDS: readonly string[] = [
  'windows',
  'apple',
  'macos',
  'mac os',
  'ios',
  'skype',
  'slack',
  'messenger',
  'nokia',
  'samsung',
  'nintendo switch',
  'nes',
  'snes',
  'gamecube',
  'game boy',
  'gameboy',
  'sega',
  'atari',
  'street fighter',
  'mortal kombat',
  'metal gear',
  'final fantasy',
  'super smash',
  'jurassic park',
  'james bond',
  'mission impossible',
  'looney tunes',
  'tom and jerry',
  'scooby doo',
  'thx',
  'dolby',
];

/**
 * Brand words a sound may carry anyway, because in sound they are plain
 * words: a kick is a drum.
 */
export const SOUND_BRAND_EXCEPTIONS: readonly string[] = ['kick'];

/** The brand list for sounds: the shared one, the sound-only words, less the exceptions. */
export function soundBrands(brands: readonly string[]): string[] {
  const all = [...brands, ...SOUND_ONLY_BRANDS.map((name) => plainWords(name).trim())];
  return [...new Set(all)].filter((brand) => !SOUND_BRAND_EXCEPTIONS.includes(brand));
}

/** Lowercase, with anything that is not a letter or a digit as one space. */
export function plainWords(text: string): string {
  return ` ${text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

/** The built-in list plus the operator's file, if one is given. */
export function loadBrands(file?: string | null): string[] {
  const extra = file
    ? readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
    : [];
  return [
    ...new Set(
      [...BUILT_IN_BRANDS, ...extra].map((name) => plainWords(name).trim()).filter(Boolean),
    ),
  ];
}

/** The first brand a text names as whole words (so "kicking" is not "kick"), or null. */
export function brandIn(texts: readonly string[], brands: readonly string[]): string | null {
  const haystack = texts.map(plainWords).join(' ');
  return brands.find((brand) => haystack.includes(` ${brand} `)) ?? null;
}
