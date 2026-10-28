import {
  ART_STYLES,
  artById,
  COLOR_FAMILIES,
  FEATURED_PRESET_IDS,
  isPresetPremium,
  LOOK_NONE,
  PRESETS,
  type Preset,
  presetCollection,
  presetFamily,
  presetFormats,
  presetLook,
} from '@postgear/design-engine';
import type { BrandKitView } from '@/types/studio';
import {
  ALL,
  addFoundColor,
  assignRole,
  type BrandKitDraft,
  brandFromKitView,
  brandKitBody,
  brandKitProblems,
  COLLECTION_ORDER,
  clampPage,
  cleanTitle,
  collectionOptions,
  expiryLabel,
  extractionSummary,
  familyOptions,
  fileFromDataUri,
  filterPresets,
  formatHint,
  formatName,
  foundColors,
  GALLERY_PAGE_SIZE,
  type GalleryTile,
  galleryView,
  HEX_ERROR,
  hasNoArtTemplates,
  hexFromInput,
  isFiltered,
  isLocked,
  KIT_NAME_ERROR,
  type KitStorage,
  kitColors,
  kitLogoResolver,
  kitNotice,
  LOOK_KIND_LABELS,
  lastKitKey,
  lookGroups,
  mediaResolver,
  NO_FILTER,
  newKitDraft,
  orderPresets,
  pageAnnouncement,
  pageCountOf,
  pageOf,
  parseCategory,
  parseCollection,
  parseFamily,
  parseLook,
  parseStyle,
  parseWizard,
  prefillField,
  preselectedKit,
  readLastKit,
  rememberKit,
  saveLabel,
  siteName,
  slideCountLabel,
  templateCardLabel,
  templateCountLabel,
  updatedLabel,
  validColors,
  WEBSITE_ERROR,
  websiteProblem,
  withLock,
  wizardQuery,
} from './studio-view-model';

const NOW = new Date('2026-10-27T12:00:00.000Z');

const COLORS = {
  primary: '#1A2B3C',
  secondary: '#334455',
  accent: '#FF5A1F',
  background: '#FFFFFF',
  text: '#111111',
};

function kit(overrides: Partial<BrandKitView> = {}): BrandKitView {
  return {
    id: 'kit-1',
    name: 'Acme',
    description: null,
    websiteUrl: null,
    logoMediaId: null,
    logoUrl: null,
    colors: COLORS,
    headingFont: null,
    bodyFont: null,
    lockLook: false,
    ctaText: null,
    ctaUrl: null,
    source: 'MANUAL',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function draft(overrides: Partial<BrandKitDraft> = {}): BrandKitDraft {
  return {
    name: 'Lotus Flow Yoga',
    description: '',
    websiteUrl: '',
    logoMediaId: null,
    colors: { ...COLORS },
    ...overrides,
  };
}

describe('labels', () => {
  it('names a format with its ratio and hints where it fits', () => {
    expect(formatName('portrait')).toBe('Portrait (4:5)');
    expect(formatHint('portrait')).toBe('1080 x 1350. Instagram and Facebook portrait feed posts.');
  });

  it('counts slides in words', () => {
    expect(slideCountLabel(1)).toBe('1 slide');
    expect(slideCountLabel(7)).toBe('7 slides');
  });

  it('says when a design was updated', () => {
    expect(updatedLabel('2026-10-27T11:59:30.000Z', NOW)).toBe('Updated just now');
    expect(updatedLabel('2026-10-27T11:59:00.000Z', NOW)).toBe('Updated 1 minute ago');
    expect(updatedLabel('2026-10-27T10:00:00.000Z', NOW)).toBe('Updated 2 hours ago');
    expect(updatedLabel('2026-10-26T06:00:00.000Z', NOW)).toBe('Updated yesterday');
    expect(updatedLabel('2026-10-24T12:00:00.000Z', NOW)).toBe('Updated 3 days ago');
    expect(updatedLabel('2026-09-15T12:00:00.000Z', NOW)).toMatch(/^Updated on Sep 1[45]$/);
    expect(updatedLabel('2025-09-15T12:00:00.000Z', NOW)).toMatch(/2025$/);
    expect(updatedLabel('not a date', NOW)).toBe('Updated recently');
    // A clock a little ahead of the server's is still "just now".
    expect(updatedLabel('2026-10-27T12:00:20.000Z', NOW)).toBe('Updated just now');
  });

  it('keeps a typed title to one clean line, or the previous one when empty', () => {
    expect(cleanTitle('  Spring \n  Sale  ', 'Old')).toBe('Spring Sale');
    expect(cleanTitle('   ', 'Old')).toBe('Old');
    expect(cleanTitle('x'.repeat(200), 'Old')).toHaveLength(120);
  });

  it('labels the save indicator honestly', () => {
    expect(saveLabel('saved')).toBe('Saved');
    expect(saveLabel('pending')).toBe('Saving');
    expect(saveLabel('saving')).toBe('Saving');
    expect(saveLabel('offline')).toBe('Offline');
    expect(saveLabel('retrying')).toBe('Could not save. Retrying.');
    expect(saveLabel('conflict')).toBe('Not saved');
    expect(saveLabel('failed')).toBe('Not saved');
  });

  it('says when a share link expires', () => {
    expect(expiryLabel('2026-11-03T12:00:00.000Z', NOW)).toBe('Expires in 7 days');
    expect(expiryLabel('2026-10-28T11:00:00.000Z', NOW)).toBe('Expires in 23 hours');
    expect(expiryLabel('2026-10-27T12:30:00.000Z', NOW)).toBe('Expires in under an hour');
    expect(expiryLabel('2026-10-27T11:00:00.000Z', NOW)).toBe('Expired');
  });
});

describe('mediaResolver', () => {
  const media = {
    a: { url: '/a.jpg', thumbnailUrl: '/a-thumb.jpg', name: 'a', width: 10, height: 10 },
    b: { url: '/b.jpg', thumbnailUrl: null, name: 'b', width: 10, height: 10 },
  };

  it('uses the full file, or the thumbnail for small slides', () => {
    expect(mediaResolver(media)('a')).toBe('/a.jpg');
    expect(mediaResolver(media, 'thumbnail')('a')).toBe('/a-thumb.jpg');
    expect(mediaResolver(media, 'thumbnail')('b')).toBe('/b.jpg');
  });

  it('draws a deleted picture as empty', () => {
    expect(mediaResolver(media)('gone')).toBeNull();
  });
});

describe('the wizard in the URL', () => {
  it('reads every answer back', () => {
    const state = {
      step: 'template' as const,
      kitId: 'kit-1',
      format: 'portrait' as const,
      presetId: 'tips-steps-ink',
    };

    expect(parseWizard(Object.fromEntries(new URLSearchParams(wizardQuery(state))))).toEqual(state);
  });

  it('starts at the brand step and drops what it cannot trust', () => {
    expect(parseWizard({})).toEqual({
      step: 'brand',
      kitId: null,
      format: null,
      presetId: null,
    });
    expect(
      parseWizard({ step: 'nope', kit: '../etc', format: 'huge', template: 'no-such-template' }),
    ).toEqual({ step: 'brand', kitId: null, format: null, presetId: null });
  });

  it('goes back to the format step when the template step has no format', () => {
    expect(parseWizard({ step: 'template' }).step).toBe('format');
  });

  it('takes the first of a repeated parameter', () => {
    expect(parseWizard({ format: ['story', 'square'] }).format).toBe('story');
  });
});

describe('brand kit form', () => {
  it('reads a colour with or without the hash, short or long', () => {
    expect(hexFromInput('#1a2b3c')).toBe('#1A2B3C');
    expect(hexFromInput('1A2B3C')).toBe('#1A2B3C');
    expect(hexFromInput('#abc')).toBe('#AABBCC');
    expect(hexFromInput('#12345')).toBeNull();
    expect(hexFromInput('teal')).toBeNull();
  });

  it('asks for a name and a colour like #1A2B3C', () => {
    const problems = brandKitProblems(draft({ name: '  ', colors: { ...COLORS, accent: 'red' } }));

    expect(problems.name).toBe(KIT_NAME_ERROR);
    expect(problems.colors).toEqual({ accent: HEX_ERROR });
    expect(brandKitBody(draft({ name: '' }))).toBeNull();
  });

  it('checks a website lightly, with or without https', () => {
    expect(websiteProblem('')).toBeNull();
    expect(websiteProblem('acme.example')).toBeNull();
    expect(websiteProblem('https://acme.example/about')).toBeNull();
    expect(websiteProblem('acme')).toBe(WEBSITE_ERROR);
    expect(websiteProblem('ftp://acme.example')).toBe(WEBSITE_ERROR);
  });

  it('leaves private addresses to the API, which says they are not public (DS-2.2)', () => {
    for (const address of [
      'localhost:3000',
      'http://localhost/',
      'http://[::1]/',
      'http://10.0.0.8/',
      'http://169.254.169.254/latest/meta-data/',
    ]) {
      expect(websiteProblem(address)).toBeNull();
    }
  });

  it('builds the body the API takes', () => {
    expect(
      brandKitBody(
        draft({ name: ' Acme ', websiteUrl: ' acme.example ', colors: { ...COLORS, text: '111' } }),
        'EXTRACTED',
      ),
    ).toEqual({
      name: 'Acme',
      description: null,
      websiteUrl: 'acme.example',
      logoMediaId: null,
      colors: { ...COLORS, text: '#111111' },
      source: 'EXTRACTED',
    });
  });
});

describe('kitNotice', () => {
  const brand = {
    kitId: 'kit-1',
    colors: COLORS,
    logoMediaId: null,
    name: 'Acme',
    kitVersion: '2026-10-01T00:00:00.000Z',
    fonts: null,
  };

  it('says nothing for a design without a kit, or before the kits load', () => {
    expect(kitNotice({ ...brand, kitId: null }, [kit()])).toBeNull();
    expect(kitNotice(brand, null)).toBeNull();
  });

  it('says when the kit was deleted', () => {
    expect(kitNotice(brand, [])).toEqual({ kind: 'deleted' });
  });

  it('offers newer colours, never the same ones again', () => {
    const recoloured = kit({
      updatedAt: '2026-10-20T00:00:00.000Z',
      colors: { ...COLORS, primary: '#00AA88' },
    });
    const renamed = kit({ updatedAt: '2026-10-20T00:00:00.000Z', name: 'Acme Two' });

    expect(kitNotice(brand, [recoloured])).toEqual({ kind: 'newer', kit: recoloured });
    expect(kitNotice(brand, [renamed])).toBeNull();
    expect(kitNotice(brand, [kit()])).toBeNull();
  });

  it('offers newer fonts too, since Update From Kit takes them', () => {
    const refonted = kit({ updatedAt: '2026-10-20T00:00:00.000Z', headingFont: 'manrope' });
    const sameFaces = kit({ updatedAt: '2026-10-20T00:00:00.000Z', headingFont: null });

    expect(kitNotice(brand, [refonted])).toEqual({ kind: 'newer', kit: refonted });
    expect(kitNotice(brand, [sameFaces])).toBeNull();
    expect(
      kitNotice({ ...brand, fonts: { heading: 'manrope', body: null } }, [refonted]),
    ).toBeNull();
  });
});

describe('filterPresets', () => {
  const none = new Set<string>();

  it('shows only templates that draw in the chosen format', () => {
    const shown = filterPresets(PRESETS, 'story', NO_FILTER, none);

    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((preset) => presetFormats(preset).includes('story'))).toBe(true);
  });

  it('filters by category, style, favourites and words', () => {
    const tips = filterPresets(PRESETS, 'square', { ...NO_FILTER, category: 'tips' }, none);
    const dark = filterPresets(PRESETS, 'square', { ...NO_FILTER, style: 'dark' }, none);
    const starred = filterPresets(
      PRESETS,
      'square',
      { ...NO_FILTER, favourites: true },
      new Set(['tips-steps-ink']),
    );

    expect(tips.length).toBeGreaterThan(0);
    expect(tips.every((preset) => preset.category === 'tips')).toBe(true);
    expect(dark.length).toBeGreaterThan(0);
    expect(starred.map((preset) => preset.id)).toEqual(['tips-steps-ink']);
    expect(filterPresets(PRESETS, 'square', { ...NO_FILTER, query: 'zzzz' }, none)).toEqual([]);
  });

  it('filters by look, the art a template wears, and None for no art', () => {
    const look = presetLook(PRESETS.find((preset) => presetLook(preset) !== LOOK_NONE) as Preset);
    const art = filterPresets(PRESETS, 'square', { ...NO_FILTER, look }, none);
    const plain = filterPresets(PRESETS, 'square', { ...NO_FILTER, look: LOOK_NONE }, none);

    expect(art.length).toBeGreaterThan(0);
    expect(art.every((preset) => preset.art === look)).toBe(true);
    expect(plain.length).toBeGreaterThan(0);
    expect(plain.every((preset) => !artById(preset.art))).toBe(true);
  });

  it('filters by colour family and by collection', () => {
    for (const family of familyOptions()) {
      const shown = filterPresets(PRESETS, 'square', { ...NO_FILTER, family }, none);
      expect(shown.length).toBeGreaterThan(0);
      expect(shown.every((preset) => presetFamily(preset) === family)).toBe(true);
    }

    for (const collection of collectionOptions()) {
      const shown = filterPresets(PRESETS, 'portrait', { ...NO_FILTER, collection }, none);
      expect(shown.length).toBeGreaterThan(0);
      expect(shown.every((preset) => presetCollection(preset) === collection)).toBe(true);
    }
  });

  it('combines filters: every one has to hold', () => {
    const luxuryDark = filterPresets(
      PRESETS,
      'square',
      { ...NO_FILTER, collection: 'luxury', style: 'dark' },
      none,
    );
    const luxury = filterPresets(PRESETS, 'square', { ...NO_FILTER, collection: 'luxury' }, none);

    expect(luxuryDark.length).toBeLessThanOrEqual(luxury.length);
    expect(luxuryDark.every((preset) => presetCollection(preset) === 'luxury')).toBe(true);
  });

  it('knows when anything is filtered', () => {
    expect(isFiltered(NO_FILTER)).toBe(false);
    expect(isFiltered({ ...NO_FILTER, query: '   ' })).toBe(false);
    expect(isFiltered({ ...NO_FILTER, query: ' x ' })).toBe(true);
    expect(isFiltered({ ...NO_FILTER, favourites: true })).toBe(true);
    expect(isFiltered({ ...NO_FILTER, look: LOOK_NONE })).toBe(true);
    expect(isFiltered({ ...NO_FILTER, family: 'gold' })).toBe(true);
    expect(isFiltered({ ...NO_FILTER, collection: 'classic' })).toBe(true);
  });
});

describe('the filter choices', () => {
  it('reads a known Select value and falls back to all for anything else', () => {
    expect(parseCategory('case-study')).toBe('case-study');
    expect(parseCategory('constructor')).toBe(ALL);
    expect(parseStyle('colourful')).toBe('colourful');
    expect(parseStyle('hasOwnProperty')).toBe(ALL);
    expect(parseLook(LOOK_NONE)).toBe(LOOK_NONE);
    expect(parseLook(ART_STYLES[0]?.id ?? '')).toBe(ART_STYLES[0]?.id);
    expect(parseLook('toString')).toBe(ALL);
    expect(parseFamily('teal')).toBe('teal');
    expect(parseFamily('beige')).toBe(ALL);
    expect(parseCollection('luxury')).toBe('luxury');
    expect(parseCollection('premium')).toBe(ALL);
  });

  it('offers each look a template wears, grouped by kind in the art library order', () => {
    const groups = lookGroups();
    const offered = groups.flatMap((group) => group.looks.map((look) => look.id));
    const worn = new Set(PRESETS.map(presetLook));

    expect(offered.length).toBeGreaterThan(0);
    expect(offered.every((id) => worn.has(id))).toBe(true);
    expect([...worn].filter((id) => id !== LOOK_NONE).sort()).toEqual([...offered].sort());
    // The library's order, kind by kind.
    const order = ART_STYLES.map((art) => art.id).filter((id) => worn.has(id));
    expect(offered).toEqual(order);
    for (const group of groups) {
      expect(group.label).toBe(LOOK_KIND_LABELS[group.kind]);
      expect(group.looks.every((look) => artById(look.id)?.kind === group.kind)).toBe(true);
      expect(group.looks.every((look) => look.name === artById(look.id)?.name)).toBe(true);
    }
  });

  it('leaves out a look no template wears', () => {
    const plain = PRESETS.filter((preset) => presetLook(preset) === LOOK_NONE);

    expect(lookGroups(plain)).toEqual([]);
    expect(hasNoArtTemplates(plain)).toBe(true);
    expect(hasNoArtTemplates(PRESETS.filter((preset) => preset.art))).toBe(false);
  });

  it('offers the colour families and collections the library has, in their own order', () => {
    const families = familyOptions();

    expect(families.length).toBeGreaterThan(0);
    expect(families).toEqual(COLOR_FAMILIES.filter((family) => families.includes(family)));
    expect(collectionOptions()).toEqual(['classic', 'signature', 'luxury']);
    expect(collectionOptions(PRESETS.filter((preset) => !preset.collection))).toEqual(['classic']);
  });
});

/** A template of one collection, for checking the order without the real library. */
function stub(id: string, collection?: Preset['collection']): Preset {
  return {
    id,
    name: id,
    category: 'tips',
    themeId: 'ink',
    tags: [],
    slides: [],
    ...(collection ? { collection } : {}),
  };
}

describe('orderPresets', () => {
  const library = [
    stub('c1'),
    stub('s1', 'signature'),
    stub('l1', 'luxury'),
    stub('c2'),
    stub('f-classic'),
    stub('s2', 'signature'),
    stub('l2', 'luxury'),
    stub('f-luxury', 'luxury'),
  ];
  const featured = ['f-luxury', 'f-classic'];
  const ids = (presets: Preset[]) => presets.map((preset) => preset.id);

  it('goes featured, then Signature, Luxury and Classic, each in registry order', () => {
    expect(COLLECTION_ORDER).toEqual(['signature', 'luxury', 'classic']);
    expect(ids(orderPresets(library, new Set(), null, featured))).toEqual([
      'f-luxury',
      'f-classic',
      's1',
      's2',
      'l1',
      'l2',
      'c1',
      'c2',
    ]);
  });

  it('puts favourites first, in registry order, and the template already chosen before them', () => {
    const favourites = new Set(['c2', 'l1', 'f-classic']);

    expect(ids(orderPresets(library, favourites, null, featured))).toEqual([
      'l1',
      'c2',
      'f-classic',
      'f-luxury',
      's1',
      's2',
      'l2',
      'c1',
    ]);
    expect(ids(orderPresets(library, favourites, 's2', featured)).slice(0, 2)).toEqual([
      's2',
      'l1',
    ]);
  });

  it('keeps every template once, and leaves the list it was given alone', () => {
    const before = ids(library);
    const ordered = orderPresets(library, new Set(['s1']), 's1', featured);

    expect(ordered).toHaveLength(library.length);
    expect(new Set(ids(ordered)).size).toBe(library.length);
    expect(ids(library)).toEqual(before);
  });

  it('opens the real library on the featured templates, then a Signature one', () => {
    const ordered = orderPresets(PRESETS, new Set());

    expect(ids(ordered.slice(0, FEATURED_PRESET_IDS.length))).toEqual([...FEATURED_PRESET_IDS]);
    expect(presetCollection(ordered[FEATURED_PRESET_IDS.length] as Preset)).toBe('signature');
    expect(presetCollection(ordered.at(-1) as Preset)).toBe('classic');
  });
});

describe('pages', () => {
  it('counts pages, never fewer than one', () => {
    expect(pageCountOf(0, 24)).toBe(1);
    expect(pageCountOf(24, 24)).toBe(1);
    expect(pageCountOf(25, 24)).toBe(2);
    expect(pageCountOf(156, 24)).toBe(7);
  });

  it('keeps a page inside the list', () => {
    expect(clampPage(3, 7)).toBe(3);
    expect(clampPage(0, 7)).toBe(1);
    expect(clampPage(-2, 7)).toBe(1);
    expect(clampPage(99, 7)).toBe(7);
    expect(clampPage(2.7, 7)).toBe(2);
    expect(clampPage(Number.NaN, 7)).toBe(1);
    expect(clampPage(4, 0)).toBe(1);
  });

  it('slices a page, and a page past the end is the last one', () => {
    const items = Array.from({ length: 50 }, (_, index) => index);

    expect(pageOf(items, 1, 24)).toEqual(items.slice(0, 24));
    expect(pageOf(items, 3, 24)).toEqual([48, 49]);
    expect(pageOf(items, 9, 24)).toEqual([48, 49]);
    expect(pageOf([], 1, 24)).toEqual([]);
  });

  it('says how many templates there are, and the page to a screen reader', () => {
    expect(templateCountLabel(1)).toBe('1 template');
    expect(templateCountLabel(155)).toBe('155 templates');
    expect(pageAnnouncement(2, 7)).toBe(', page 2 of 7');
    expect(pageAnnouncement(1, 1)).toBe('');
  });
});

describe('galleryView', () => {
  const none = new Set<string>();
  const templates = (tiles: GalleryTile[]) =>
    tiles.flatMap((tile) => (tile.kind === 'template' ? [tile] : []));
  const view = (overrides: Partial<Parameters<typeof galleryView>[0]> = {}) =>
    galleryView({
      format: 'square',
      filter: NO_FILTER,
      favourites: none,
      page: 1,
      premium: true,
      ...overrides,
    });

  it('shows 24 places a page, Start From Blank first on page one', () => {
    const first = view();
    const total = filterPresets(PRESETS, 'square', NO_FILTER, none).length;

    expect(GALLERY_PAGE_SIZE).toBe(24);
    expect(first.count).toBe(total);
    expect(first.pageCount).toBe(Math.ceil((total + 1) / 24));
    expect(first.tiles).toHaveLength(24);
    expect(first.tiles[0]).toEqual({ kind: 'blank' });
    expect(templates(first.tiles)).toHaveLength(23);

    // Page two carries on from the 24th template, with no blank.
    const second = view({ page: 2 });
    const order = orderPresets(filterPresets(PRESETS, 'square', NO_FILTER, none), none);
    expect(second.tiles[0]).toMatchObject({ kind: 'template', preset: order[23] });
    expect(second.tiles.some((tile) => tile.kind === 'blank')).toBe(false);
  });

  it('walks every template exactly once across the pages', () => {
    const { pageCount, count } = view();
    const seen = Array.from({ length: pageCount }, (_, index) =>
      templates(view({ page: index + 1 }).tiles).map((tile) => tile.preset.id),
    ).flat();

    expect(seen).toHaveLength(count);
    expect(new Set(seen).size).toBe(count);
  });

  it('lands on the last page when asked for one past it, as when a filter shrinks the list', () => {
    const last = view({ page: 99 });

    expect(last.page).toBe(last.pageCount);
    expect(last.tiles.length).toBeGreaterThan(0);
  });

  it('drops Start From Blank while anything is filtered', () => {
    const filtered = view({ filter: { ...NO_FILTER, collection: 'luxury' } });

    expect(filtered.tiles.every((tile) => tile.kind === 'template')).toBe(true);
    expect(filtered.tiles).toHaveLength(Math.min(GALLERY_PAGE_SIZE, filtered.count));
    expect(filtered.pageCount).toBe(Math.ceil(filtered.count / GALLERY_PAGE_SIZE));
  });

  it('leads with the template chosen before the wizard', () => {
    const chosen = PRESETS.at(-1) as Preset;

    expect(view({ leading: chosen.id }).tiles[1]).toMatchObject({ preset: chosen });
  });

  it('orders by the favourites it is given to rank, filtering by the live ones', () => {
    const starred = new Set(['tips-steps-ink', PRESETS.at(-1)?.id ?? '']);
    const firstTwo = (tiles: GalleryTile[]) =>
      templates(tiles)
        .slice(0, 2)
        .map((tile) => tile.preset.id);

    // Ranked by the favourites: the starred two lead, in registry order.
    expect(firstTwo(view({ favourites: starred }).tiles)).toEqual([
      'tips-steps-ink',
      PRESETS.at(-1)?.id,
    ]);
    // A star clicked a moment ago (not ranked yet) marks the card without moving it.
    expect(firstTwo(view({ favourites: starred, ranked: none }).tiles)).toEqual(
      FEATURED_PRESET_IDS.slice(0, 2),
    );
    expect(
      templates(view({ favourites: starred, filter: { ...NO_FILTER, favourites: true } }).tiles),
    ).toHaveLength(2);
  });
});

describe('premium locks', () => {
  const premiumOne = PRESETS.find(isPresetPremium) as Preset;
  const freeOne = PRESETS.find((preset) => !isPresetPremium(preset)) as Preset;

  it('locks a premium template only where the plan is known not to include it', () => {
    expect(premiumOne).toBeDefined();
    expect(isLocked(premiumOne, false)).toBe(true);
    expect(isLocked(premiumOne, true)).toBe(false);
    expect(isLocked(premiumOne, null)).toBe(false);
    expect(isLocked(freeOne, false)).toBe(false);
  });

  it('says locked in the card name', () => {
    expect(templateCardLabel('Gold Launch', true)).toBe('Use Gold Launch, locked');
    expect(templateCardLabel('5 Simple Steps', false)).toBe('Use 5 Simple Steps');
    expect(withLock('Start with Gold Launch', true)).toBe('Start with Gold Launch, locked');
    expect(withLock('Start with Gold Launch', false)).toBe('Start with Gold Launch');
  });

  it('locks every Luxury card and no Classic one on a locked workspace page', () => {
    const luxury = galleryView({
      format: 'square',
      filter: { ...NO_FILTER, collection: 'luxury' },
      favourites: new Set(),
      page: 1,
      premium: false,
    });
    const classic = galleryView({
      format: 'square',
      filter: { ...NO_FILTER, collection: 'classic' },
      favourites: new Set(),
      page: 1,
      premium: false,
    });

    const cards = luxury.tiles.filter((tile) => tile.kind === 'template');
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card).toMatchObject({ locked: true });
      expect(card.kind === 'template' && card.label.endsWith(', locked')).toBe(true);
    }
    expect(classic.tiles.every((tile) => tile.kind === 'template' && !tile.locked)).toBe(true);
  });

  it('shows no lock at all to a workspace that has them, or while the plan is unknown', () => {
    for (const premium of [true, null]) {
      const page = galleryView({
        format: 'square',
        filter: { ...NO_FILTER, collection: 'luxury' },
        favourites: new Set(),
        page: 1,
        premium,
      });

      expect(page.tiles.some((tile) => tile.kind === 'template' && tile.locked)).toBe(false);
      expect(
        page.tiles.every((tile) => tile.kind !== 'template' || !/locked/.test(tile.label)),
      ).toBe(true);
    }
  });
});

describe('the kit the wizard remembers', () => {
  function memoryStorage(): { storage: KitStorage; values: Map<string, string> } {
    const values = new Map<string, string>();
    return {
      values,
      storage: () => ({
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
      }),
    };
  }

  it('remembers the kit a design was created with, per workspace', () => {
    const { storage, values } = memoryStorage();

    rememberKit('org-a', 'kit-1', storage);
    rememberKit('org-b', 'kit-9', storage);

    expect(readLastKit('org-a', storage)).toBe('kit-1');
    expect(readLastKit('org-b', storage)).toBe('kit-9');
    expect(readLastKit('org-c', storage)).toBeNull();
    expect(values.get(lastKitKey('org-a'))).toBe('kit-1');
  });

  it('keeps the kit from before when a design is made without one', () => {
    const { storage } = memoryStorage();

    rememberKit('org-a', 'kit-1', storage);
    rememberKit('org-a', null, storage);

    expect(readLastKit('org-a', storage)).toBe('kit-1');
  });

  it('never trusts what it reads back', () => {
    const { storage, values } = memoryStorage();
    values.set(lastKitKey('org-a'), '../etc/passwd');

    expect(readLastKit('org-a', storage)).toBeNull();
  });

  it('carries on without storage, whether reading it or writing throws', () => {
    const blocked: KitStorage = () => {
      throw new Error('SecurityError');
    };
    const full: KitStorage = () => ({
      getItem: () => {
        throw new Error('broken');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });

    expect(readLastKit('org-a', blocked)).toBeNull();
    expect(readLastKit('org-a', full)).toBeNull();
    expect(() => rememberKit('org-a', 'kit-1', blocked)).not.toThrow();
    expect(() => rememberKit('org-a', 'kit-1', full)).not.toThrow();
  });

  it('preselects the kit in the URL, else the remembered one while it still exists', () => {
    const kits = [kit({ id: 'kit-1' }), kit({ id: 'kit-2', name: 'Other' })];

    expect(preselectedKit(kits, 'kit-2', 'kit-1')).toEqual({ kit: kits[1], remembered: false });
    expect(preselectedKit(kits, null, 'kit-1')).toEqual({ kit: kits[0], remembered: true });
    expect(preselectedKit(kits, 'deleted', 'kit-1')).toEqual({ kit: kits[0], remembered: true });
    expect(preselectedKit(kits, null, 'deleted')).toBeNull();
    expect(preselectedKit(kits, null, null)).toBeNull();
    expect(preselectedKit(null, 'kit-1', 'kit-1')).toBeNull();
  });
});

describe('extraction review', () => {
  const candidates = [
    { hex: '#FFFFFF', suggestedRole: 'background' as const, weight: 9 },
    { hex: '#0A66C2', suggestedRole: 'primary' as const, weight: 7 },
    { hex: '#004182', suggestedRole: 'primary' as const, weight: 5 },
    { hex: '#111111', suggestedRole: 'text' as const, weight: 8 },
  ];

  it('gives each role to the strongest colour that asks for it', () => {
    expect(foundColors(candidates)).toEqual([
      { id: 1, hex: '#FFFFFF', role: 'background' },
      { id: 2, hex: '#111111', role: 'text' },
      { id: 3, hex: '#0A66C2', role: 'primary' },
      { id: 4, hex: '#004182', role: 'none' },
    ]);
  });

  it('reviews at most eight colours', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      hex: '#000000',
      suggestedRole: 'accent' as const,
      weight: index,
    }));
    expect(foundColors(many)).toHaveLength(8);
  });

  it('moves a role from one colour to another in one step', () => {
    const rows = assignRole(foundColors(candidates), 4, 'primary');

    expect(rows.find((row) => row.id === 4)?.role).toBe('primary');
    expect(rows.find((row) => row.id === 3)?.role).toBe('none');
  });

  it('adds a colour of your own into the first free role', () => {
    const rows = addFoundColor(foundColors(candidates), '#FF5A1F');
    expect(rows.at(-1)).toEqual({ id: 5, hex: '#FF5A1F', role: 'secondary' });
  });

  it('builds the five kit colours, keeping the fallback for a role nobody holds', () => {
    expect(kitColors(foundColors(candidates), COLORS)).toEqual({
      ...COLORS,
      background: '#FFFFFF',
      text: '#111111',
      primary: '#0A66C2',
    });
  });

  it('turns a found logo into a file the upload takes', () => {
    const file = fileFromDataUri('data:image/png;base64,iVBORw0K', 'Acme / Logo');

    expect(file?.name).toBe('Acme Logo.png');
    expect(file?.type).toBe('image/png');
    expect(file?.size).toBe(6);
    expect(fileFromDataUri('not a data uri', 'x')).toBeNull();
  });
});

describe('brand kit form helpers', () => {
  it('starts a new kit from the default theme, with nothing typed', () => {
    const draft = newKitDraft();

    expect(draft.name).toBe('');
    expect(brandKitProblems(draft).colors).toEqual({});
    expect(brandKitBody(draft)).toBeNull();
  });

  it('keeps the valid colours and falls back for one still being typed', () => {
    const colors = validColors({ ...COLORS, accent: '#12', text: '#abc' }, COLORS);

    expect(colors.accent).toBe(COLORS.accent);
    expect(colors.text).toBe('#AABBCC');
  });

  it('fills an empty field from the site and never overwrites what was typed', () => {
    expect(prefillField('', 'Acme', null, 120)).toBe('Acme');
    expect(prefillField('My Brand', 'Acme', null, 120)).toBe('My Brand');
    expect(prefillField('Acme', 'Acme Corp', 'Acme', 120)).toBe('Acme Corp');
    expect(prefillField('Mine', null, null, 120)).toBe('Mine');
    expect(prefillField('', '  Long name  ', null, 4)).toBe('Long');
  });

  it('names the site without its scheme or www', () => {
    expect(siteName('https://www.example.com/about')).toBe('example.com');
    expect(siteName('not a url')).toBe('not a url');
  });

  it('says what an extraction found in one sentence', () => {
    const site = 'https://www.example.com/';

    expect(extractionSummary({ finalUrl: site, logos: [1, 2], colors: [1, 2, 3] })).toBe(
      'Found 2 logos and 3 colours on example.com.',
    );
    expect(extractionSummary({ finalUrl: site, logos: [], colors: [1] })).toBe(
      'Found no logo and 1 colour on example.com.',
    );
    expect(extractionSummary({ finalUrl: site, logos: [], colors: [] })).toBe(
      'We found no logo or colours on example.com.',
    );
    expect(
      extractionSummary({ finalUrl: site, logos: Array(9).fill(0), colors: Array(12).fill(0) }),
    ).toBe('Found 6 logos and 8 colours on example.com.');
  });
});

describe('a kit as a design brand', () => {
  it('copies the kit the way the API does on create', () => {
    const brand = brandFromKitView(kit({ logoMediaId: 'logo1', logoUrl: 'https://cdn/logo.png' }));

    expect(brand).toMatchObject({ kitId: kit().id, logoMediaId: 'logo1', name: kit().name });
    expect(brand.kitVersion).toBe(kit().updatedAt);
  });

  it('leaves out a logo the library no longer has', () => {
    expect(brandFromKitView(kit({ logoMediaId: 'gone', logoUrl: null })).logoMediaId).toBeNull();
  });

  it("copies the kit's faces, and none when it sets neither", () => {
    expect(brandFromKitView(kit()).fonts).toBeNull();
    expect(brandFromKitView(kit({ bodyFont: 'sora' })).fonts).toEqual({
      heading: null,
      body: 'sora',
    });
  });

  it('resolves only the kit logo', () => {
    const resolve = kitLogoResolver(kit({ logoMediaId: 'logo1', logoUrl: 'https://cdn/logo.png' }));

    expect(resolve('logo1')).toBe('https://cdn/logo.png');
    expect(resolve('other')).toBeNull();
    expect(kitLogoResolver(null)('logo1')).toBeNull();
  });
});
