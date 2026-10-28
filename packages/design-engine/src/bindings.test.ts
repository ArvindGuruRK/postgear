import { boundText, clampText, isTypeable, singleLine, slotText } from './bindings';
import { addSlide, documentFromPreset, setBackground } from './document';
import { findLayout, findSlot, LAYOUTS, layoutKey } from './layouts';
import { sampleElements } from './samples';
import { designDocumentSchema } from './schema';
import type { DesignDocument, SlotDef } from './types';

function design(): DesignDocument {
  return documentFromPreset({ presetId: 'tips-steps-ink', format: 'square', handle: '@lotus' });
}

function slotOf(document: DesignDocument, index: number, id: string): SlotDef {
  const layout = findLayout(document.slides[index].layoutId);
  const slot = layout ? findSlot(layout, id) : null;
  if (!slot) throw new Error(`No ${id} slot on slide ${index + 1}.`);
  return slot;
}

describe('bound text', () => {
  it('shows the design handle and brand name on every slide', () => {
    const document = { ...design(), brand: { ...design().brand, name: 'Lotus Flow' } };

    expect(boundText(document, 0, 'handle')).toBe('@lotus');
    expect(boundText(document, 3, 'brandName')).toBe('Lotus Flow');
  });

  it('shows nothing for a brand with no name', () => {
    expect(boundText(design(), 0, 'brandName')).toBe('');
  });

  it('counts the slides, and shows no number on a single post', () => {
    const document = design();

    expect(boundText(document, 0, 'slideNumber')).toBe(`1/${document.slides.length}`);
    expect(boundText(document, 4, 'slideNumber')).toBe(`5/${document.slides.length}`);
    expect(boundText({ ...document, slides: [document.slides[0]] }, 0, 'slideNumber')).toBe('');
  });

  it('reads a slot own text, or the design words for a bound one', () => {
    const document = design();

    expect(slotText(document, 0, slotOf(document, 0, 'headline'))).toBe(
      document.slides[0].elements.headline?.text,
    );
    expect(slotText(document, 1, slotOf(document, 1, 'handle'))).toBe('@lotus');
    expect(slotText(document, 1, slotOf(document, 1, 'pageNumber'))).toBe(
      `2/${document.slides.length}`,
    );
  });

  it('lets the user type into every text slot but the counted one', () => {
    const document = design();

    expect(isTypeable(slotOf(document, 0, 'headline'))).toBe(true);
    expect(isTypeable(slotOf(document, 0, 'handle'))).toBe(true);
    expect(isTypeable(slotOf(document, 0, 'brandName'))).toBe(true);
    expect(isTypeable(slotOf(document, 0, 'pageNumber'))).toBe(false);
    expect(isTypeable(slotOf(document, 1, 'list'))).toBe(false);
    expect(isTypeable(slotOf(document, 0, 'logo'))).toBe(false);
  });
});

describe('text helpers', () => {
  it('folds line breaks into one space', () => {
    expect(singleLine('one\r\ntwo \n  three')).toBe('one two three');
  });

  it('cuts to a limit without leaving half a character', () => {
    expect(clampText('abcdef', 3)).toBe('abc');
    expect(clampText('ab\u{1F600}', 3)).toBe('ab');
    expect(clampText('short', 50)).toBe('short');
  });
});

describe('sample words', () => {
  it('give every layout a slide the schema accepts, in every format', () => {
    for (const layout of LAYOUTS) {
      for (const format of layout.formats) {
        const base = documentFromPreset({ presetId: 'blank', format });
        const document = addSlide(base, { layoutId: layoutKey(layout) });
        const result = designDocumentSchema.safeParse(document);

        expect(document.slides).toHaveLength(2);
        if (!result.success) {
          throw new Error(`${layoutKey(layout)} ${format}: ${result.error.issues[0]?.message}`);
        }
      }
    }
  });

  it('never fill a bound slot, and start a hidden-by-default one hidden', () => {
    for (const layout of LAYOUTS) {
      const elements = sampleElements(layout);

      for (const slot of layout.slots) {
        if (slot.bind) expect(elements[slot.id]?.text).toBeUndefined();
        if (slot.defaultHidden) expect(elements[slot.id]?.hidden).toBe(true);
        if (slot.kind === 'list') {
          expect(elements[slot.id]?.items?.length ?? 0).toBeLessThanOrEqual(slot.maxItems ?? 0);
        }
      }
    }
  });

  it('survive a photo background', () => {
    const document = design();
    const onPhoto = setBackground(document, document.slides[0].id, {
      kind: 'media',
      mediaId: 'seed-media-1',
      overlay: 0.6,
    });
    expect(designDocumentSchema.safeParse(onPhoto).success).toBe(true);
  });
});
