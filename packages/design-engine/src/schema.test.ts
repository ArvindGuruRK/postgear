import { ART_STYLES } from './art';
import { documentFromPreset } from './document';
import { findLayout, findSlot, slotPlacement } from './layouts';
import { PRESETS, presetFormats } from './presets';
import {
  DesignVersionError,
  designDocumentSchema,
  parseDesignDocument,
  safeParseDesignDocument,
  upgrade,
} from './schema';
import { DESIGN_SCHEMA_VERSION, type DesignDocument, type FontId } from './types';

let counter = 0;
const stableId = () => `s-${++counter}`;

/** tips-steps-ink: cover, numbered list, content, statistic, closing. */
function document(): DesignDocument {
  counter = 0;
  return documentFromPreset({ presetId: 'tips-steps-ink', format: 'square', newId: stableId });
}

const accepts = (value: unknown) => designDocumentSchema.safeParse(value).success;

/**
 * A design as Sprint 9 stored it, at schema 1: shaped like the demo seed's
 * carousel, with a photo cover, a nudged and recoloured headline, a list and
 * a quote on the surface colour. Written out, because the engine no longer
 * builds this version.
 */
const VERSION_1 = {
  schemaVersion: 1,
  format: 'portrait',
  presetId: 'tips-steps-ink',
  themeId: 'ink',
  brand: {
    kitId: 'seed-brand-kit-lotus',
    colors: {
      primary: '#0F766E',
      secondary: '#115E59',
      accent: '#C2410C',
      background: '#FFFFFF',
      text: '#0F1A19',
    },
    logoMediaId: null,
    name: 'Lotus Flow Yoga',
    kitVersion: '2026-10-27T09:00:00.000Z',
  },
  handle: '@lotusflowyoga',
  caption: 'Five stretches that take ten minutes. Save this one for tomorrow morning.',
  slides: [
    {
      id: 'seed-slide-1',
      layoutId: 'cover-headline@1',
      background: { kind: 'media', mediaId: 'seed-media-1', overlay: 0.6 },
      elements: {
        eyebrow: { text: 'Start here' },
        headline: {
          text: '5 Morning Stretches For Beginners',
          size: 'lg',
          offset: { x: 0, y: 4 },
          color: '#FFFFFF',
        },
      },
      origin: 0,
    },
    {
      id: 'seed-slide-2',
      layoutId: 'list-numbered@1',
      background: { kind: 'role', role: 'background' },
      elements: {
        headline: { text: 'The Five Stretches' },
        list: { items: ['Neck rolls, slowly', 'Shoulder openers', 'Low lunge, both sides'] },
      },
      origin: 1,
    },
    {
      id: 'seed-slide-3',
      layoutId: 'quote-centre@1',
      background: { kind: 'role', role: 'surface' },
      elements: {
        quote: { text: '"I stopped waking up stiff within a fortnight."' },
        attribution: { text: 'Asha, Tuesday class' },
      },
      origin: 3,
    },
  ],
};

describe('designDocumentSchema', () => {
  it('accepts every document the engine builds, for every preset and format', () => {
    for (const preset of PRESETS) {
      for (const format of presetFormats(preset)) {
        const result = designDocumentSchema.safeParse(
          documentFromPreset({ presetId: preset.id, format }),
        );

        if (!result.success) {
          throw new Error(`${preset.id} ${format}: ${result.error.issues[0]?.message}`);
        }
      }
    }
  });

  it('gives back what it was given, for a document the engine built', () => {
    const value = document();
    expect(designDocumentSchema.parse(value)).toEqual(value);
  });

  it('refuses a property the renderer never reads', () => {
    expect(accepts({ ...document(), style: 'display:none' })).toBe(false);

    const onElement = document();
    (onElement.slides[0].elements.headline as Record<string, unknown>).className = 'x';
    expect(accepts(onElement)).toBe(false);
  });

  it('refuses an element on a slot the layout does not have', () => {
    const bad = document();
    (bad.slides[0].elements as Record<string, unknown>).stat = { text: '99%' };
    expect(accepts(bad)).toBe(false);
  });

  it('refuses a slot id the engine has never heard of', () => {
    const bad = document();
    (bad.slides[0].elements as Record<string, unknown>).script = { text: 'x' };
    expect(accepts(bad)).toBe(false);
  });

  it('refuses text on a picture slot and a picture on a text slot', () => {
    const withPicture = document();
    withPicture.slides[1].elements.headline = { mediaId: 'media-1' };
    expect(accepts(withPicture)).toBe(false);

    const withText = document();
    withText.slides[0].elements.logo = { text: 'not a picture' };
    expect(accepts(withText)).toBe(false);
  });

  it('refuses typed text on a slot that shows the design own words', () => {
    const handle = document();
    handle.slides[0].elements.handle = { text: '@someone-else' };
    expect(accepts(handle)).toBe(false);

    const number = document();
    number.slides[0].elements.pageNumber = { text: '9/9' };
    expect(accepts(number)).toBe(false);
  });

  it('refuses hiding an element the layout does not make optional', () => {
    const bad = document();
    bad.slides[0].elements.headline = { ...bad.slides[0].elements.headline, hidden: true };
    expect(accepts(bad)).toBe(false);
  });

  it('refuses a style option the slot does not offer', () => {
    const size = document();
    size.slides[0].elements.eyebrow = { ...size.slides[0].elements.eyebrow, size: 'lg' };
    expect(accepts(size)).toBe(false);

    const align = document();
    align.slides[0].elements.brandName = { align: 'center' };
    expect(accepts(align)).toBe(false);

    const colour = document();
    colour.slides[0].elements.logo = { colorRole: 'accent' };
    expect(accepts(colour)).toBe(false);
  });

  it('refuses a logo placement the layout did not draw room for', () => {
    const bad = document();
    bad.slides[0].elements.logo = { placement: 'centre' };
    expect(accepts(bad)).toBe(false);

    const good = document();
    good.slides[4].elements.logo = { placement: 'header' };
    expect(accepts(good)).toBe(true);
  });

  it('refuses a colour that is not a hex', () => {
    const bad = document();
    bad.slides[0].elements.headline = {
      ...bad.slides[0].elements.headline,
      color: 'url(https://evil.test)',
    };
    expect(accepts(bad)).toBe(false);
  });

  it('normalises a short hex', () => {
    const value = document();
    value.slides[0].elements.headline = { ...value.slides[0].elements.headline, color: '#abc' };
    expect(designDocumentSchema.parse(value).slides[0].elements.headline?.color).toBe('#AABBCC');
  });

  it('clamps a nudge to the element region instead of refusing it', () => {
    const value = document();
    value.slides[0].elements.headline = { offset: { x: 150, y: -150 } };

    const parsed = designDocumentSchema.parse(value);
    const offset = parsed.slides[0].elements.headline?.offset;
    const layout = findLayout(parsed.slides[0].layoutId);
    const slot = layout ? findSlot(layout, 'headline') : null;
    const box = slot ? slotPlacement(slot, null).box : null;

    expect(box && offset ? box.x + offset.x + box.w : 999).toBeLessThanOrEqual(100.0001);
    expect(box && offset ? box.y + offset.y : -999).toBeGreaterThanOrEqual(-0.0001);
  });

  it('refuses a nudge that could not be a percentage', () => {
    const bad = document();
    bad.slides[0].elements.headline = { offset: { x: 1e9, y: 0 } };
    expect(accepts(bad)).toBe(false);
  });

  it('refuses a layout that is not in the library', () => {
    const bad = document();
    bad.slides[0].layoutId = 'anything@9';
    expect(accepts(bad)).toBe(false);
  });

  it('refuses a theme that is not in the library, including names from the prototype', () => {
    for (const themeId of ['nope', 'toString', '__proto__', 'constructor']) {
      expect(accepts({ ...document(), themeId })).toBe(false);
    }
  });

  it('refuses a preset id with characters no preset has', () => {
    expect(accepts({ ...document(), presetId: '../etc' })).toBe(false);
  });

  it('refuses two slides with the same id', () => {
    const bad = document();
    bad.slides[1].id = bad.slides[0].id;
    expect(accepts(bad)).toBe(false);
  });

  it('refuses more than twenty slides', () => {
    const bad = document();
    bad.slides = Array.from({ length: 21 }, (_, index) => ({
      ...bad.slides[0],
      id: `slide-${index}`,
    }));
    expect(accepts(bad)).toBe(false);
  });

  it('refuses a design with no slides', () => {
    expect(accepts({ ...document(), slides: [] })).toBe(false);
  });

  it('refuses a template slide index that cannot exist', () => {
    const bad = document();
    bad.slides[0].origin = 50;
    expect(accepts(bad)).toBe(false);
  });

  it('refuses a media id with path or URL characters', () => {
    for (const mediaId of ['../../etc/passwd', 'https://evil.test/a.png', 'a b']) {
      const bad = document();
      bad.slides[0].background = { kind: 'media', mediaId, overlay: 0.6 };
      expect(accepts(bad)).toBe(false);
    }
  });

  it('accepts the readable ids the seeds use as well as uuids', () => {
    for (const mediaId of ['seed-media-1', '11111111-1111-4111-8111-111111111111']) {
      const value = document();
      value.slides[0].background = { kind: 'media', mediaId, overlay: 0.6 };
      expect(accepts(value)).toBe(true);
    }
  });

  it('refuses an overlay outside nothing-to-black', () => {
    const bad = document();
    bad.slides[0].background = { kind: 'media', mediaId: 'media-1', overlay: 4 };
    expect(accepts(bad)).toBe(false);
  });

  it('strips control characters from text instead of refusing it', () => {
    const value = document();
    value.slides[0].elements.headline = { text: 'Hello\u0000 there\u0007' };
    expect(designDocumentSchema.parse(value).slides[0].elements.headline?.text).toBe('Hello there');
  });

  it('keeps a newline, which a two-line headline needs, and makes Windows ones plain', () => {
    const value = document();
    value.slides[0].elements.headline = { text: 'Two\r\nlines' };
    expect(designDocumentSchema.parse(value).slides[0].elements.headline?.text).toBe('Two\nlines');
  });

  it('keeps the handle and the brand name on one line', () => {
    const value = document();
    value.handle = '@one\ntwo';
    value.brand = { ...value.brand, name: 'Lotus\r\nFlow' };

    const parsed = designDocumentSchema.parse(value);
    expect(parsed.handle).toBe('@one two');
    expect(parsed.brand.name).toBe('Lotus Flow');
  });

  it('reads a document saved without a handle as one with none', () => {
    const value: Record<string, unknown> = { ...document() };
    delete value.handle;
    expect(designDocumentSchema.parse(value).handle).toBe('');
  });

  it('refuses a brand kit version that is not a timestamp', () => {
    const bad = document();
    bad.brand = { ...bad.brand, kitVersion: 'yesterday' };
    expect(accepts(bad)).toBe(false);
  });

  it('refuses a list longer than the slot allows', () => {
    const bad = document();
    bad.slides[1].elements.list = { items: Array.from({ length: 8 }, (_, i) => `item ${i}`) };
    expect(accepts(bad)).toBe(false);
  });

  it('refuses a slide id with characters that would end up in the DOM', () => {
    const bad = document();
    bad.slides[0].id = '"><script>';
    expect(accepts(bad)).toBe(false);
  });

  it('refuses a current design that does not say whether it has art or fonts', () => {
    for (const key of ['art', 'fonts'] as const) {
      const value: Record<string, unknown> = { ...document() };
      delete value[key];
      expect(accepts(value)).toBe(false);
    }

    const brand: Record<string, unknown> = { ...document().brand };
    delete brand.fonts;
    expect(accepts({ ...document(), brand })).toBe(false);
  });

  it('accepts no art, and every art the library draws', () => {
    expect(accepts({ ...document(), art: null })).toBe(true);
    for (const art of ART_STYLES) expect(accepts({ ...document(), art: art.id })).toBe(true);
  });

  it('refuses art the library does not draw, including names from the prototype', () => {
    for (const art of ['nope', 'toString', '__proto__', 'constructor', '', 'x'.repeat(65), 7]) {
      expect(accepts({ ...document(), art })).toBe(false);
    }
  });

  it('accepts a choice of faces from the library, either face left to the one beneath', () => {
    for (const fonts of [
      { heading: 'playfair-display', body: 'inter' },
      { heading: null, body: 'poppins' },
      { heading: null, body: null },
    ]) {
      expect(accepts({ ...document(), fonts })).toBe(true);
      expect(accepts({ ...document(), brand: { ...document().brand, fonts } })).toBe(true);
    }
  });

  it('refuses a font the library does not have, a missing face and anything else in a choice', () => {
    for (const fonts of [
      { heading: 'comic-sans', body: null },
      { heading: 'toString', body: null },
      { heading: 'inter' },
      { heading: 'inter', body: null, weight: 800 },
      'inter',
    ]) {
      expect(accepts({ ...document(), fonts })).toBe(false);
      expect(accepts({ ...document(), brand: { ...document().brand, fonts } })).toBe(false);
    }
  });

  it('accepts an element font on text and list slots', () => {
    const value = document();
    value.slides[0].elements.headline = {
      ...value.slides[0].elements.headline,
      font: 'playfair-display',
    };
    value.slides[1].elements.list = { ...value.slides[1].elements.list, font: 'inter' };
    expect(accepts(value)).toBe(true);
  });

  it('refuses an element font on a slot with no words, and says why', () => {
    const value = document();
    value.slides[0].elements.logo = { font: 'inter' };

    const result = designDocumentSchema.safeParse(value);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      'That element has no text to set in a font.',
    );
  });

  it('refuses an element font the library does not have', () => {
    const value = document();
    value.slides[0].elements.headline = {
      ...value.slides[0].elements.headline,
      font: 'wingdings' as FontId,
    };
    expect(accepts(value)).toBe(false);
  });

  it('accepts a dark or a light tint on a photo, and nothing else', () => {
    const tinted = (tint: unknown) => {
      const value = document();
      (value.slides[0] as { background: unknown }).background = {
        kind: 'media',
        mediaId: 'media-1',
        overlay: 0.6,
        tint,
      };
      return value;
    };

    expect(accepts(tinted('dark'))).toBe(true);
    expect(accepts(tinted('light'))).toBe(true);
    expect(accepts(tinted('sepia'))).toBe(false);
    expect(accepts(tinted(null))).toBe(false);
  });

  it('refuses a tint on a background that is not a photo', () => {
    const value = document();
    (value.slides[0] as { background: unknown }).background = {
      kind: 'role',
      role: 'background',
      tint: 'light',
    };
    expect(accepts(value)).toBe(false);
  });

  it('never throws, whatever it is handed', () => {
    for (const value of [
      null,
      1,
      'x',
      [],
      {},
      { slides: 'x' },
      { schemaVersion: 1, slides: [{}] },
    ]) {
      expect(() => designDocumentSchema.safeParse(value)).not.toThrow();
      expect(safeParseDesignDocument(value).ok).toBe(false);
    }
  });
});

describe('upgrade', () => {
  it('passes the current version through untouched', () => {
    const value = document();
    expect(upgrade(value)).toEqual(value);
  });

  it('moves a version 1 design to version 2 by adding no art and no fonts, and nothing else', () => {
    const stored = structuredClone(VERSION_1);

    expect(upgrade(VERSION_1)).toEqual({
      ...VERSION_1,
      schemaVersion: 2,
      art: null,
      fonts: null,
      brand: { ...VERSION_1.brand, fonts: null },
    });
    // The stored row is only read, never changed in place.
    expect(VERSION_1).toEqual(stored);
  });

  it('reads a version 1 design as the same design at the current version', () => {
    const parsed = parseDesignDocument(VERSION_1);

    expect(parsed.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(parsed.art).toBeNull();
    expect(parsed.fonts).toBeNull();
    expect(parsed.brand).toEqual({ ...VERSION_1.brand, fonts: null });
    expect(parsed.slides).toEqual(VERSION_1.slides);
    expect([parsed.handle, parsed.caption]).toEqual([VERSION_1.handle, VERSION_1.caption]);
    // What is written back is current, so the next read takes no step.
    expect(upgrade(parsed)).toEqual(parsed);
  });

  it('leaves a version 1 brand that is not an object for the schema to refuse', () => {
    const broken = { ...VERSION_1, brand: 'Lotus' };

    expect((upgrade(broken) as Record<string, unknown>).brand).toBe('Lotus');
    expect(safeParseDesignDocument(broken).ok).toBe(false);
  });

  it('refuses a document from a newer PostGear rather than guessing', () => {
    expect(() => upgrade({ schemaVersion: DESIGN_SCHEMA_VERSION + 1 })).toThrow(DesignVersionError);
    expect(() => upgrade({ schemaVersion: DESIGN_SCHEMA_VERSION + 1 })).toThrow(/newer version/);
  });

  it('refuses a version it has no step for, and says it is an older one', () => {
    expect(() => upgrade({ schemaVersion: 0 })).toThrow(DesignVersionError);
    expect(() => upgrade({ schemaVersion: 0 })).toThrow(/older format \(schema 0\)/);
  });

  it('leaves something that is not a document alone, for the schema to refuse', () => {
    expect(upgrade(null)).toBeNull();
    expect(upgrade({ hello: 'world' })).toEqual({ hello: 'world' });
  });
});

describe('parseDesignDocument', () => {
  it('upgrades then parses', () => {
    expect(parseDesignDocument(document()).schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
  });

  it('reports a version failure as a result rather than a throw, when asked safely', () => {
    const result = safeParseDesignDocument({ schemaVersion: 99 });
    expect(result.ok).toBe(false);
  });
});
