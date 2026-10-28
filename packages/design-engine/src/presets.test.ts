/**
 * The library's own guard rail.
 *
 * Every preset is checked for the things that would otherwise be found by a
 * user: a layout that no longer exists, sample content that overflows a slot,
 * and markup that does not render. The overflow check uses the headless
 * measuring model from `fit.ts`, which is deliberately a little wider than any
 * real face, so content that passes here fits in a browser too.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { slotText } from './bindings';
import { documentFromPreset } from './document';
import {
  approximateMeasure,
  baseFontSize,
  MIN_FIT_SCALE,
  type MeasuredStyle,
  wrapText,
} from './fit';
import { fitText } from './fit';
import { FORMAT_IDS, formatSpec, shortEdge } from './formats';
import { fontStack } from './fonts';
import { findLayout, latestLayout, slotFrame } from './layouts';
import {
  FEATURED_PRESET_IDS,
  matchesPresetQuery,
  PRESETS,
  presetById,
  presetFormats,
  presetsByCategory,
  presetStyle,
} from './presets';
import { SlideView } from './render/SlideView';
import { designDocumentSchema } from './schema';
import { isThemeId, themeById } from './themes';
import { type DesignDocument, type ListMarker, PRESET_CATEGORIES } from './types';

describe('the preset library', () => {
  it('ships at least the forty the sprint asks for', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(40);
  });

  it('has unique ids and names', () => {
    expect(new Set(PRESETS.map((preset) => preset.id)).size).toBe(PRESETS.length);
    expect(new Set(PRESETS.map((preset) => preset.name)).size).toBe(PRESETS.length);
  });

  it('uses ids the schema accepts as a preset id', () => {
    for (const preset of PRESETS) expect(preset.id).toMatch(/^[a-z0-9-]+$/);
  });

  it('names a theme that exists and a category the gallery filters by', () => {
    for (const preset of PRESETS) {
      expect(isThemeId(preset.themeId)).toBe(true);
      expect(PRESET_CATEGORIES).toContain(preset.category);
    }
  });

  it('names a layout that exists, for every slide, and stays inside the slide limit', () => {
    for (const preset of PRESETS) {
      expect(preset.slides.length).toBeGreaterThan(0);
      expect(preset.slides.length).toBeLessThanOrEqual(20);

      for (const slide of preset.slides) {
        expect(latestLayout(slide.layoutId)).not.toBeNull();
      }
    }
  });

  it('can be drawn in every format', () => {
    for (const preset of PRESETS) expect(presetFormats(preset)).toEqual([...FORMAT_IDS]);
  });

  it('writes sample content only into slots its layout has, and never into a bound one', () => {
    for (const preset of PRESETS) {
      for (const slide of preset.slides) {
        const layout = latestLayout(slide.layoutId);
        const slots = new Map(layout?.slots.map((slot) => [slot.id, slot]));

        for (const id of Object.keys(slide.text ?? {}) as Array<keyof typeof slide.text>) {
          const slot = slots.get(id);
          expect(slot?.kind).toBe('text');
          expect(slot?.bind).toBeUndefined();
        }
        for (const id of Object.keys(slide.items ?? {}) as Array<keyof typeof slide.items>) {
          expect(slots.get(id)?.kind).toBe('list');
        }
      }
    }
  });

  it('covers every category the gallery offers', () => {
    for (const category of PRESET_CATEGORIES) {
      expect(presetsByCategory(category).length).toBeGreaterThan(0);
    }
  });

  it('offers the three featured templates the empty state shows', () => {
    expect(FEATURED_PRESET_IDS).toHaveLength(3);
    for (const id of FEATURED_PRESET_IDS) expect(presetById(id)).not.toBeNull();
  });

  it('finds nothing by a name from the object prototype', () => {
    for (const id of ['toString', 'constructor', '__proto__']) expect(presetById(id)).toBeNull();
  });

  it('builds a document the schema accepts, in every format', () => {
    for (const preset of PRESETS) {
      for (const format of FORMAT_IDS) {
        const document = documentFromPreset({ presetId: preset.id, format });
        const result = designDocumentSchema.safeParse(document);

        expect(document.presetId).toBe(preset.id);
        if (!result.success) {
          throw new Error(`${preset.id} in ${format}: ${result.error.issues[0]?.message}`);
        }
      }
    }
  });

  it('describes its style from its theme', () => {
    for (const preset of PRESETS) {
      expect(presetStyle(preset)).toBe(themeById(preset.themeId).style);
    }
  });
});

describe('gallery search', () => {
  const preset = PRESETS[0];

  it('matches the name, the category and the tags, ignoring case', () => {
    expect(matchesPresetQuery(preset, preset.name.toUpperCase())).toBe(true);
    expect(matchesPresetQuery(preset, preset.category)).toBe(true);
    expect(matchesPresetQuery(preset, preset.tags[0])).toBe(true);
  });

  it('matches everything for an empty query and nothing for nonsense', () => {
    expect(matchesPresetQuery(preset, '   ')).toBe(true);
    expect(matchesPresetQuery(preset, 'zzzz-not-a-word')).toBe(false);
  });
});

/**
 * Whether a slot's words fit after the same shrink the page's fitter runs,
 * under the headless measuring model. A list is laid out the way `SlideView`
 * draws it: each item wrapped on its own in the column beside its marker,
 * with the gaps between items, all of it in `em` so it shrinks together.
 */
function fitsAfterShrinking(input: {
  text: string;
  items: string[] | null;
  marker: ListMarker;
  width: number;
  height: number;
  style: MeasuredStyle;
  lineHeight: number;
}): boolean {
  if (input.items === null) {
    return !fitText({
      text: input.text,
      width: input.width,
      height: input.height,
      style: input.style,
      lineHeight: input.lineHeight,
      measure: approximateMeasure,
    }).overflows;
  }

  const markerColumn = { number: 1.9, tick: 1.4, dot: 1.4, rule: 0, none: 0 }[input.marker];
  const perItem = input.marker === 'rule' ? 0.52 : 0;
  const steps = 12;

  for (let step = 0; step < steps; step++) {
    const fontSize = input.style.fontSize * (1 - ((1 - MIN_FIT_SCALE) * step) / (steps - 1));
    const style = { ...input.style, fontSize };
    const column = input.width - markerColumn * fontSize;

    let height = (input.items.length - 1) * 0.55 * fontSize;
    for (const item of input.items) {
      const lines = wrapText(item, column, style, approximateMeasure).length;
      height += lines * input.lineHeight * fontSize + perItem * fontSize;
    }

    if (height <= input.height) return true;
  }

  return false;
}

describe('sample content', () => {
  /**
   * Every text slot is measured against the box it is actually given in that
   * format, through the same shrink the page's fitter runs. A preset whose
   * sample copy still overflows at the floor would ship a warning ring on a
   * slide nobody has typed into yet, which is a library bug, not a user one.
   */
  it('fits its slots in every format, once the fitter has shrunk them', () => {
    const failures: string[] = [];

    for (const preset of PRESETS) {
      const theme = themeById(preset.themeId);

      for (const format of FORMAT_IDS) {
        const document = documentFromPreset({ presetId: preset.id, format });
        const spec = formatSpec(format);

        for (const [index, slide] of document.slides.entries()) {
          const layout = findLayout(slide.layoutId);
          if (!layout) continue;

          for (const slot of layout.slots) {
            if (slot.kind !== 'text' && slot.kind !== 'list') continue;

            const state = slide.elements[slot.id];
            if (state?.hidden) continue;

            const text = slotText(document, index, slot);
            const items = slot.kind === 'list' ? (state?.items ?? []) : null;
            if (items === null ? text.trim() === '' : items.length === 0) continue;

            const frame = slotFrame(layout, slot, format, state);
            if (!frame) continue;

            const style = theme.type[slot.type ?? 'body'];
            const fontSize = baseFontSize(style, shortEdge(format), state?.size);
            const fits = fitsAfterShrinking({
              text,
              items,
              marker: slot.marker ?? 'dot',
              width: (frame.rect.w / 100) * spec.width,
              height: (frame.rect.h / 100) * spec.height,
              style: {
                fontFamily: fontStack(style.font),
                fontWeight: style.weight,
                fontSize,
                letterSpacing: style.tracking * fontSize,
              },
              lineHeight: style.lineHeight,
            });

            if (!fits) failures.push(`${preset.id} ${format} slide ${index + 1} ${slot.id}`);
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });
});

describe('rendering', () => {
  const render = (design: DesignDocument, index: number, mode: 'edit' | 'preview' | 'export') =>
    renderToStaticMarkup(createElement(SlideView, { design, index, mode }));

  it('draws every preset in every format without throwing', () => {
    for (const preset of PRESETS) {
      for (const format of FORMAT_IDS) {
        const document = documentFromPreset({ presetId: preset.id, format });

        for (const [index] of document.slides.entries()) {
          const markup = render(document, index, 'export');

          expect(markup).toContain('data-slide=');
          expect(markup).not.toContain('no longer available');
        }
      }
    }
  });

  it('marks every text slot for the fitter, with its content to measure', () => {
    const document = documentFromPreset({ presetId: 'tips-steps-ink', format: 'portrait' });
    const markup = render(document, 0, 'export');

    const slots = markup.match(/data-fit="/g)?.length ?? 0;
    const contents = markup.match(/data-fit-content=""/g)?.length ?? 0;
    expect(slots).toBeGreaterThan(0);
    expect(contents).toBe(slots);
  });

  it('shows the design handle and counts the slides', () => {
    const document = documentFromPreset({ presetId: 'tips-steps-ink', format: 'square' });
    const markup = render(document, 1, 'export');

    expect(markup).toContain(document.handle);
    expect(markup).toContain(`2/${document.slides.length}`);
  });

  it('escapes whatever the user typed', () => {
    const document = documentFromPreset({ presetId: 'tips-steps-ink', format: 'square' });
    const first = document.slides[0];
    const hostile: DesignDocument = {
      ...document,
      slides: [
        {
          ...first,
          elements: { ...first.elements, headline: { text: '<img src=x onerror=alert(1)>' } },
        },
        ...document.slides.slice(1),
      ],
    };

    const markup = render(hostile, 0, 'export');
    expect(markup).not.toContain('<img src=x');
    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('marks empty pictures and logos only in the editor', () => {
    const document = documentFromPreset({ presetId: 'tips-steps-ink', format: 'square' });

    expect(render(document, 0, 'edit')).toContain('>Logo<');
    expect(render(document, 0, 'export')).not.toContain('>Logo<');
  });

  it('says so, instead of drawing nothing, for a slide that does not exist', () => {
    const document = documentFromPreset({ presetId: 'tips-steps-ink', format: 'square' });
    expect(render(document, 99, 'preview')).toContain('no longer available');
  });
});
