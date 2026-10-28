/**
 * No client branding reaches anything a user can see.
 *
 * The Signature looks are ported from CarouselClick, a post builder made for
 * one client, and its templates, palettes and backgrounds came with that
 * client's names on them. The owner cleared the designs for PostGear; the
 * names were never part of that. So every string the library can show (a
 * template's name, tags and sample copy, a theme's or an art style's name, a
 * layout's labels, a font's label) and every drawing the art makes is scanned
 * for them. Code comments may still credit CarouselClick: they never reach a
 * screen.
 */
import { ART_STYLES } from './art';
import { FONTS } from './fonts';
import { LAYOUTS } from './layouts';
import { PRESETS } from './presets';
import { THEMES } from './themes';

const BANNED: readonly RegExp[] = [
  /niti\s*core/i,
  // A word on its own: "initial" and "definition" contain the letters.
  /\bniti\b/i,
  /cloud\s*sync/i,
  /modern\s*lifestyle/i,
  /trident/i,
  /carousel\s*click/i,
];

/** Every string inside a value, however deeply it is nested. */
function strings(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') {
    found.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) strings(entry, found);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      found.push(key);
      strings(entry, found);
    }
  }
  return found;
}

function offending(source: string, value: unknown): string[] {
  return strings(value)
    .filter((text) => BANNED.some((pattern) => pattern.test(text)))
    .map((text) => `${source}: ${text.length > 80 ? `${text.slice(0, 80)}...` : text}`);
}

describe('client branding', () => {
  it('appears in no template', () => {
    expect(PRESETS.flatMap((preset) => offending(`preset ${preset.id}`, preset))).toEqual([]);
  });

  it('appears in no theme', () => {
    expect(THEMES.flatMap((theme) => offending(`theme ${theme.id}`, theme))).toEqual([]);
  });

  it('appears in no layout', () => {
    expect(LAYOUTS.flatMap((layout) => offending(`layout ${layout.id}`, layout))).toEqual([]);
  });

  it('appears in no font label', () => {
    expect(Object.values(FONTS).flatMap((font) => offending(`font ${font.id}`, font))).toEqual([]);
  });

  it('appears in no art style, nor anywhere in what it draws', () => {
    const colors = {
      background: '#05011A',
      mid: '#0B6B35',
      highlight: '#B8FF35',
      sheen: '#FFFFFF',
    };

    expect(
      ART_STYLES.flatMap((art) => [
        ...offending(`art ${art.id}`, { id: art.id, name: art.name, home: art.home }),
        ...offending(`art ${art.id} drawing`, art.draw(colors, 1080, 1350)),
        ...offending(`art ${art.id} drawing`, art.draw(colors, 1920, 1080)),
      ]),
    ).toEqual([]);
  });
});
