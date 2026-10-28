import {
  addSlide,
  applyBrandKit,
  documentFromPreset,
  setBackground,
  updateElement,
} from './document';
import { latestLayout, layoutKey } from './layouts';
import { designMediaIds, slideMediaIds } from './media';
import type { DesignDocument } from './types';

/** tips-steps-ink: cover, numbered list, content, statistic, closing. */
function design(): DesignDocument {
  return documentFromPreset({ presetId: 'tips-steps-ink', format: 'square' });
}

function withKitLogo(document: DesignDocument, logoMediaId: string | null): DesignDocument {
  return applyBrandKit(document, {
    kitId: 'kit-1',
    colors: null,
    logoMediaId,
    name: 'Brand',
    kitVersion: null,
    fonts: null,
  });
}

describe('slideMediaIds', () => {
  it('is empty for a template with no pictures and no logo', () => {
    const document = design();
    expect(document.slides.map((_, index) => slideMediaIds(document, index))).toEqual(
      document.slides.map(() => []),
    );
  });

  it('includes the brand kit logo on a slide whose logo slot has nothing of its own', () => {
    const document = withKitLogo(design(), 'kit-logo');
    expect(slideMediaIds(document, 0)).toEqual(['kit-logo']);
  });

  it('uses the slot own logo instead of the kit one when it has one', () => {
    const document = withKitLogo(design(), 'kit-logo');
    const own = updateElement(document, document.slides[0].id, 'logo', { mediaId: 'own-logo' });
    expect(slideMediaIds(own, 0)).toEqual(['own-logo']);
  });

  it('leaves out a picture in a hidden slot, because the slide does not draw it', () => {
    const document = withKitLogo(design(), 'kit-logo');
    const hidden = updateElement(document, document.slides[0].id, 'logo', { hidden: true });
    expect(slideMediaIds(hidden, 0)).toEqual([]);
  });

  it('includes a photo background and a picture slot', () => {
    const layout = latestLayout('split-picture');
    const document = addSlide(design(), { layoutId: layout ? layoutKey(layout) : '' });
    const id = document.slides[5].id;
    const filled = setBackground(updateElement(document, id, 'image', { mediaId: 'picture' }), id, {
      kind: 'media',
      mediaId: 'photo',
      overlay: 0.6,
    });

    expect(slideMediaIds(filled, 5).sort()).toEqual(['photo', 'picture']);
  });

  it('is empty for a slide that does not exist or uses a layout that is gone', () => {
    const document = withKitLogo(design(), 'kit-logo');
    expect(slideMediaIds(document, 99)).toEqual([]);

    const gone: DesignDocument = {
      ...document,
      slides: [{ ...document.slides[0], layoutId: 'retired@9' }],
    };
    expect(slideMediaIds(gone, 0)).toEqual([]);
  });
});

describe('designMediaIds', () => {
  it('lists each picture once, however many slides draw it', () => {
    const document = withKitLogo(design(), 'kit-logo');
    expect(designMediaIds(document)).toEqual(['kit-logo']);
  });
});
