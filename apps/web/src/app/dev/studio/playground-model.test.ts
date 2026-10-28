import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FORMAT_IDS,
  PRESETS,
  presetById,
  presetFormats,
  presetStyle,
  type SlotId,
} from '@postgear/design-engine';
import {
  APP_DARK_THEMES,
  APP_LIGHT_THEMES,
  createFitStore,
  documentKey,
  type FitReport,
  fitHeadline,
  fitProgress,
  fitReport,
  isFiltered,
  parseCategory,
  parseFormat,
  parseStyle,
  playgroundDocuments,
  SHOW_ALL,
  sameSlots,
  shownLabel,
  shownPresets,
  slideDomId,
  slideKey,
  slideTotal,
} from './playground-model';

const documents = playgroundDocuments();

describe('shownPresets', () => {
  it('shows every preset in every format it supports, in library order', () => {
    const shown = shownPresets(SHOW_ALL);

    expect(shown.map(({ preset }) => preset.id)).toEqual(PRESETS.map((preset) => preset.id));
    for (const { preset, formats } of shown) {
      expect(formats).toEqual(presetFormats(preset));
    }
  });

  it('narrows to one format', () => {
    const shown = shownPresets({ ...SHOW_ALL, format: 'story' });

    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every(({ formats }) => formats.length === 1 && formats[0] === 'story')).toBe(true);
  });

  it('narrows to a category and a style with the gallery filter', () => {
    const tips = shownPresets({ ...SHOW_ALL, category: 'tips' });
    expect(tips.length).toBeGreaterThan(0);
    expect(tips.every(({ preset }) => preset.category === 'tips')).toBe(true);

    const dark = shownPresets({ ...SHOW_ALL, style: 'dark' });
    expect(dark.length).toBeGreaterThan(0);
    expect(dark.every(({ preset }) => presetStyle(preset) === 'dark')).toBe(true);
  });

  it('searches names, categories and tags, and can leave nothing', () => {
    const hiring = shownPresets({ ...SHOW_ALL, query: 'hiring' });
    expect(hiring.length).toBeGreaterThan(0);
    expect(hiring.every(({ preset }) => preset.category === 'hiring')).toBe(true);

    expect(shownPresets({ ...SHOW_ALL, query: 'zzz-nothing-matches' })).toEqual([]);
  });

  it('counts presets and slides', () => {
    const shown = shownPresets({ ...SHOW_ALL, format: 'square' });
    const slides = shown.reduce((sum, { preset }) => sum + preset.slides.length, 0);

    expect(slideTotal(shown)).toBe(slides);
    expect(shownLabel(shown)).toBe(`${shown.length} presets, ${slides} slides`);

    const one = shownPresets({ ...SHOW_ALL, format: 'square', query: 'Loud Mistakes' });
    expect(shownLabel(one)).toBe(`1 preset, ${one[0]?.preset.slides.length} slides`);
  });

  it('knows when a filter is on', () => {
    expect(isFiltered(SHOW_ALL)).toBe(false);
    expect(isFiltered({ ...SHOW_ALL, query: '  ' })).toBe(false);
    expect(isFiltered({ ...SHOW_ALL, style: 'light' })).toBe(true);
  });
});

describe('the Select values', () => {
  it('reads a known value and falls back to all for anything else', () => {
    expect(parseFormat('portrait')).toBe('portrait');
    expect(parseFormat('toString')).toBe('all');
    expect(parseCategory('case-study')).toBe('case-study');
    expect(parseCategory('constructor')).toBe('all');
    expect(parseStyle('colourful')).toBe('colourful');
    expect(parseStyle('hasOwnProperty')).toBe('all');
  });
});

describe('playgroundDocuments', () => {
  it('builds every preset in every format it supports, slide for slide', () => {
    for (const preset of PRESETS) {
      for (const format of presetFormats(preset)) {
        const design = documents.get(documentKey(preset.id, format));

        expect(design?.presetId).toBe(preset.id);
        expect(design?.format).toBe(format);
        expect(design?.slides).toHaveLength(preset.slides.length);
      }
    }
  });

  it('gives every slide its own key and a usable element id', () => {
    const keys = new Set<string>();
    const ids = new Set<string>();
    let slides = 0;

    for (const preset of PRESETS) {
      for (const format of FORMAT_IDS) {
        for (let index = 0; index < preset.slides.length; index += 1) {
          slides += 1;
          keys.add(slideKey(preset.id, format, index));
          const id = slideDomId(preset.id, format, index);
          expect(id).toMatch(/^slide-[a-z0-9-]+-\d+$/);
          ids.add(id);
        }
      }
    }

    expect(keys.size).toBe(slides);
    expect(ids.size).toBe(slides);
  });
});

describe('createFitStore', () => {
  it('passes on a real change and drops a repeat', () => {
    const store = createFitStore();
    const heard = jest.fn();
    const stop = store.subscribe(heard);

    store.report('a:square:0', []);
    expect(heard).toHaveBeenCalledTimes(1);

    const before = store.snapshot();
    store.report('a:square:0', []);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(store.snapshot()).toBe(before);

    store.report('a:square:0', ['headline', 'body']);
    store.report('a:square:0', ['body', 'headline']);
    expect(heard).toHaveBeenCalledTimes(2);
    expect(store.snapshot().get('a:square:0')).toEqual(['headline', 'body']);

    stop();
    store.report('a:square:0', []);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('compares slots as sets', () => {
    expect(sameSlots(['headline', 'body'], ['body', 'headline'])).toBe(true);
    expect(sameSlots(['headline'], ['headline', 'body'])).toBe(false);
    expect(sameSlots([], [])).toBe(true);
  });
});

describe('fitReport', () => {
  const preset = presetById('tips-mistakes-bold');
  if (!preset) throw new Error('The library lost tips-mistakes-bold.');
  const shown = shownPresets({ ...SHOW_ALL, query: preset.name });
  const total = preset.slides.length * presetFormats(preset).length;

  it('counts what has been drawn and lists overflow in page order', () => {
    const store = createFitStore();
    store.report(slideKey(preset.id, 'story', 1), ['list']);
    store.report(slideKey(preset.id, 'square', 0), ['headline', 'subheadline']);
    store.report(slideKey(preset.id, 'square', 1), []);
    // A preset the filters hide does not count.
    store.report(slideKey('tips-steps-ink', 'square', 0), ['headline']);

    const report = fitReport(shown, documents, store.snapshot());

    expect(report.total).toBe(total);
    expect(report.checked).toBe(3);
    expect(report.overflowing.map(({ format, slide }) => `${format} ${slide}`)).toEqual([
      'square 1',
      'story 2',
    ]);
    expect(report.overflowing[0]).toMatchObject({
      presetName: preset.name,
      domId: slideDomId(preset.id, 'square', 0),
      slots: [
        { id: 'headline', label: 'Headline' },
        { id: 'subheadline', label: 'Subheadline' },
      ],
    });
  });

  it('says how many overflow, or that every slide fits', () => {
    const base: FitReport = { total: 10, checked: 4, overflowing: [] };
    const fits = new Map<string, SlotId[]>([[slideKey(preset.id, 'square', 0), ['headline']]]);
    const overflow = fitReport(shown, documents, fits).overflowing;

    expect(fitHeadline(base)).toBe('No slide overflows so far.');
    expect(fitHeadline({ ...base, checked: 10 })).toBe('Every slide fits its sample content.');
    expect(fitHeadline({ ...base, overflowing: overflow })).toBe(
      '1 slide overflows its sample content so far.',
    );
    expect(fitHeadline({ ...base, checked: 10, overflowing: [...overflow, ...overflow] })).toBe(
      '2 slides overflow their sample content.',
    );

    expect(fitProgress(base)).toBe('4 of 10 slides drawn. Scroll down to draw the rest.');
    expect(fitProgress({ ...base, checked: 10 })).toBe('10 slides drawn and checked.');
  });
});

describe('the app themes', () => {
  // The theme blocks the app actually paints: every theme but Classic has one.
  const css = readFileSync(
    join(__dirname, '..', '..', '..', '..', '..', '..', 'packages/ui/src/styles/colors.css'),
    'utf8',
  );
  const blocks = (scheme: 'light' | 'dark') =>
    [...css.matchAll(new RegExp(`\\.${scheme}\\[data-${scheme}-theme='([a-z]+)'\\]`, 'g'))]
      .map((match) => match[1])
      .sort();

  it('lists every light theme in colors.css, Lilac included', () => {
    const ids = APP_LIGHT_THEMES.map(({ id }) => id);

    expect(ids).toContain('lilac');
    expect(ids.filter((id) => id !== 'classic').sort()).toEqual(blocks('light'));
    expect(ids[0]).toBe('classic');
  });

  it('lists every dark theme in colors.css', () => {
    const ids = APP_DARK_THEMES.map(({ id }) => id);

    expect(ids.filter((id) => id !== 'classic').sort()).toEqual(blocks('dark'));
    expect(ids[0]).toBe('classic');
  });
});
