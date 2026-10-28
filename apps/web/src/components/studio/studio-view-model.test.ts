import { PRESETS, presetFormats } from '@postgear/design-engine';
import type { BrandKitView } from '@/types/studio';
import {
  addFoundColor,
  assignRole,
  type BrandKitDraft,
  brandFromKitView,
  brandKitBody,
  brandKitProblems,
  cleanTitle,
  expiryLabel,
  extractionSummary,
  fileFromDataUri,
  filterPresets,
  formatHint,
  formatName,
  foundColors,
  HEX_ERROR,
  hexFromInput,
  isFiltered,
  KIT_NAME_ERROR,
  kitColors,
  kitLogoResolver,
  kitNotice,
  mediaResolver,
  NO_FILTER,
  newKitDraft,
  parseWizard,
  prefillField,
  saveLabel,
  siteName,
  slideCountLabel,
  updatedLabel,
  validColors,
  WEBSITE_ERROR,
  websiteProblem,
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

  it('knows when anything is filtered', () => {
    expect(isFiltered(NO_FILTER)).toBe(false);
    expect(isFiltered({ ...NO_FILTER, query: ' x ' })).toBe(true);
    expect(isFiltered({ ...NO_FILTER, favourites: true })).toBe(true);
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

  it('resolves only the kit logo', () => {
    const resolve = kitLogoResolver(kit({ logoMediaId: 'logo1', logoUrl: 'https://cdn/logo.png' }));

    expect(resolve('logo1')).toBe('https://cdn/logo.png');
    expect(resolve('other')).toBeNull();
    expect(kitLogoResolver(null)('logo1')).toBeNull();
  });
});
