import { ART_STYLES, isArtId } from '../art';
import { THEMES, themeById } from '../themes';
import { COLLECTION_LABELS, COLOR_FAMILIES, PRESET_COLLECTIONS } from '../types';
import {
  buildPresets,
  isPresetPremium,
  LOOK_NONE,
  matchesPresetQuery,
  PRESETS,
  type PresetShape,
  presetById,
  presetCollection,
  presetFamily,
  presetLook,
  slide,
} from '.';

/**
 * Sprint 9's forty-seven, as they shipped: id, theme and name. Designs made
 * from these ids exist, and Reset rebuilds a slide from its preset by id, so
 * none of them may change or go.
 */
const SPRINT_9: ReadonlyArray<[id: string, themeId: string, name: string]> = [
  ['tips-steps-ink', 'ink', '5 Simple Steps'],
  ['tips-steps-sunrise', 'sunrise', 'Warm Morning Steps'],
  ['tips-steps-midnight', 'midnight', 'Night Mode Steps'],
  ['tips-steps-blossom', 'blossom', 'Soft Steps'],
  ['tips-mistakes-bold', 'bold', 'Loud Mistakes'],
  ['tips-mistakes-slate', 'slate', 'Quiet Mistakes'],
  ['tips-mistakes-ocean', 'ocean', 'Deep Dive Mistakes'],
  ['educational-explainer-slate', 'slate', 'Plain Explainer'],
  ['educational-explainer-editorial', 'editorial', 'Long Read Explainer'],
  ['educational-explainer-terminal', 'terminal', 'Developer Explainer'],
  ['educational-myths-ink', 'ink', 'Myth Versus Fact'],
  ['educational-myths-violet', 'violet', 'Bright Myth Buster'],
  ['educational-myths-midnight', 'midnight', 'Dark Myth Buster'],
  ['announcement-launch-bold', 'bold', 'Big Launch'],
  ['announcement-launch-ocean', 'ocean', 'Calm Launch'],
  ['announcement-launch-sunrise', 'sunrise', 'Sunrise Launch'],
  ['announcement-launch-ink', 'ink', 'Clean Launch'],
  ['product-update-slate', 'slate', 'Product Update'],
  ['product-update-midnight', 'midnight', 'Dark Product Update'],
  ['product-update-violet', 'violet', 'Release Highlights'],
  ['product-update-terminal', 'terminal', 'Changelog'],
  ['quote-testimonial-editorial', 'editorial', 'Editorial Testimonials'],
  ['quote-testimonial-blossom', 'blossom', 'Soft Testimonials'],
  ['quote-testimonial-ink', 'ink', 'Plain Testimonials'],
  ['quote-testimonial-ocean', 'ocean', 'Deep Testimonials'],
  ['listicle-tools-ink', 'ink', 'Tool Round-Up'],
  ['listicle-tools-bold', 'bold', 'Bold Round-Up'],
  ['listicle-tools-sunrise', 'sunrise', 'Warm Round-Up'],
  ['statistic-report-slate', 'slate', 'Annual Report'],
  ['statistic-report-midnight', 'midnight', 'Dark Data'],
  ['statistic-report-violet', 'violet', 'Bright Data'],
  ['statistic-report-terminal', 'terminal', 'Raw Numbers'],
  ['case-study-editorial', 'editorial', 'Editorial Case Study'],
  ['case-study-ink', 'ink', 'Before And After'],
  ['case-study-ocean', 'ocean', 'Deep Case Study'],
  ['promotion-offer-bold', 'bold', 'Loud Offer'],
  ['promotion-offer-sunrise', 'sunrise', 'Warm Offer'],
  ['promotion-offer-violet', 'violet', 'Bright Offer'],
  ['story-behind-editorial', 'editorial', 'Founder Story'],
  ['story-behind-blossom', 'blossom', 'Soft Story'],
  ['story-behind-midnight', 'midnight', 'Night Story'],
  ['event-invite-violet', 'violet', 'Workshop Invite'],
  ['event-invite-ink', 'ink', 'Plain Invite'],
  ['event-invite-ocean', 'ocean', 'Calm Invite'],
  ['hiring-role-slate', 'slate', 'We Are Hiring'],
  ['hiring-role-bold', 'bold', 'Loud Hiring'],
  ['hiring-role-blossom', 'blossom', 'Friendly Hiring'],
];

const SHAPES: Record<string, PresetShape> = {
  shape: {
    category: 'tips',
    tags: ['sample'],
    slides: [slide('cover-headline', { headline: 'A Sample Headline' })],
  },
};

describe('the Classic collection', () => {
  it('keeps every Sprint 9 id, with its theme and name, at the front and in order', () => {
    expect(
      PRESETS.slice(0, SPRINT_9.length).map((preset) => [preset.id, preset.themeId, preset.name]),
    ).toEqual(SPRINT_9);
  });

  it('builds them exactly as Sprint 9 did, with no collection, art or premium key', () => {
    for (const [id] of SPRINT_9) {
      expect(Object.keys(presetById(id) ?? {}).sort()).toEqual([
        'category',
        'id',
        'name',
        'slides',
        'tags',
        'themeId',
      ]);
    }
  });
});

describe('names', () => {
  it('names every preset in Title Case, as the gallery shows names', () => {
    const lower = PRESETS.filter((preset) =>
      preset.name.split(/\s+/).some((word) => !/^[\p{Lu}\p{N}]/u.test(word)),
    );
    expect(lower.map((preset) => `${preset.id}: ${preset.name}`)).toEqual([]);
  });
});

describe('collections, looks and colours', () => {
  it('puts every preset in a collection the gallery offers', () => {
    for (const preset of PRESETS) {
      expect(PRESET_COLLECTIONS).toContain(presetCollection(preset));
    }
  });

  it('names only art that exists', () => {
    for (const preset of PRESETS) {
      if (preset.art !== undefined) expect(isArtId(preset.art)).toBe(true);
    }
  });

  it('reads no art as none, and no art style can be mistaken for it', () => {
    expect(presetLook(PRESETS[0])).toBe(LOOK_NONE);
    expect(ART_STYLES.map((art) => art.id)).not.toContain(LOOK_NONE);

    for (const preset of PRESETS) {
      expect(presetLook(preset)).toBe(preset.art ?? LOOK_NONE);
    }
  });

  it('takes the colour family from the theme', () => {
    for (const preset of PRESETS) {
      expect(COLOR_FAMILIES).toContain(presetFamily(preset));
      expect(presetFamily(preset)).toBe(themeById(preset.themeId).family);
    }
  });
});

describe('premium', () => {
  it('marks a preset premium exactly when its collection, theme or art is', () => {
    for (const preset of PRESETS) {
      const art = ART_STYLES.find((style) => style.id === preset.art);
      const expected =
        presetCollection(preset) === 'luxury' ||
        themeById(preset.themeId).premium === true ||
        art?.premium === true;

      expect([preset.id, isPresetPremium(preset)]).toEqual([preset.id, expected]);
      expect([preset.id, preset.premium === true]).toEqual([preset.id, expected]);
    }
  });

  it('works the rule out when building, whatever a row says', () => {
    const free = THEMES.find((theme) => theme.premium !== true);
    if (!free) throw new Error('There is no free theme to build with.');
    const row = { id: 'sample', name: 'Sample', shape: 'shape', theme: free.id };

    expect(buildPresets('luxury', SHAPES, [row])[0].premium).toBe(true);
    expect(buildPresets('signature', SHAPES, [row])[0].premium).toBeUndefined();
    expect(buildPresets('signature', SHAPES, [row])[0].collection).toBe('signature');
    expect(buildPresets('classic', SHAPES, [row])[0]).not.toHaveProperty('collection');

    const premiumTheme = THEMES.find((theme) => theme.premium === true);
    if (premiumTheme) {
      expect(
        buildPresets('signature', SHAPES, [{ ...row, theme: premiumTheme.id }])[0].premium,
      ).toBe(true);
    }

    const premiumArt = ART_STYLES.find((art) => art.premium);
    if (premiumArt) {
      expect(buildPresets('classic', SHAPES, [{ ...row, art: premiumArt.id }])[0].premium).toBe(
        true,
      );
    }

    const freeArt = ART_STYLES.find((art) => !art.premium);
    if (freeArt) {
      const built = buildPresets('classic', SHAPES, [{ ...row, art: freeArt.id }])[0];
      expect(built.art).toBe(freeArt.id);
      expect(built.premium).toBeUndefined();
    }
  });

  it('refuses a row whose shape does not exist, by name', () => {
    expect(() =>
      buildPresets('signature', SHAPES, [{ id: 'x', name: 'X', shape: 'missing', theme: 'ink' }]),
    ).toThrow(/missing/);
    expect(() =>
      buildPresets('signature', SHAPES, [{ id: 'x', name: 'X', shape: 'toString', theme: 'ink' }]),
    ).toThrow(/toString/);
  });
});

describe('search', () => {
  it('finds a preset by its collection, its theme and its art', () => {
    for (const preset of PRESETS) {
      expect(matchesPresetQuery(preset, COLLECTION_LABELS[presetCollection(preset)])).toBe(true);
      expect(matchesPresetQuery(preset, themeById(preset.themeId).name)).toBe(true);

      const art = ART_STYLES.find((style) => style.id === preset.art);
      if (art) expect(matchesPresetQuery(preset, art.name)).toBe(true);
    }
  });
});
