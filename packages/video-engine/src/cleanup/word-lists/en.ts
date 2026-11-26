/**
 * Bleep Bad Words, English (Module 09): PostGear's own short default list.
 * Written for PostGear, not copied from any list; see `README.md` here.
 *
 * Strong swear words only, as base forms: the matcher adds the English
 * endings (-s, -es, -ing, -ed) itself. Mild words ("damn", "hell", "crap")
 * are left to each workspace's own list (My Words), and no slur is here.
 * Words with a common innocent meaning ("cock", "prick") are left out so a
 * cooking or gardening clip is never bleeped.
 */
export const EN_BLEEP_WORDS: readonly string[] = Object.freeze([
  'arse',
  'arsehole',
  'ass',
  'asshole',
  'bastard',
  'bitch',
  'bitchy',
  'bollocks',
  'bullshit',
  'cocksucker',
  'cunt',
  'dick',
  'dickhead',
  'douche',
  'douchebag',
  'dumbass',
  'fuck',
  'fucker',
  'fuckin',
  'fuckup',
  'goddamn',
  'horseshit',
  'jackass',
  'motherfucker',
  'motherfucking',
  'piss',
  'shit',
  'shithead',
  'shitty',
  'stfu',
  'tits',
  'twat',
  'wanker',
  'wtf',
]);
