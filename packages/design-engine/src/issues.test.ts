import {
  addSlide,
  applyBrandKit,
  documentFromPreset,
  setBackground,
  updateElement,
} from './document';
import { findDesignIssues, issueMessage } from './issues';
import { latestLayout, layoutKey } from './layouts';
import type { DesignDocument } from './types';

const always = () => true;

/** tips-steps-ink: cover, numbered list, content, statistic, closing. */
function design(): DesignDocument {
  return documentFromPreset({ presetId: 'tips-steps-ink', format: 'square' });
}

/** The design with a split-picture slide added at the end. */
function withPictureSlide(): DesignDocument {
  const layout = latestLayout('split-picture');
  return addSlide(design(), { layoutId: layout ? layoutKey(layout) : '' });
}

describe('findDesignIssues', () => {
  it('finds nothing wrong with a fresh template', () => {
    expect(findDesignIssues(design(), always)).toEqual([]);
  });

  it('does not count a missing logo as a problem: the slot is simply empty', () => {
    const document = design();
    expect(document.brand.logoMediaId).toBeNull();
    expect(findDesignIssues(document, always)).toEqual([]);
  });

  it('names an empty picture by slide', () => {
    const document = withPictureSlide();

    expect(findDesignIssues(document, always)).toEqual([
      { kind: 'emptyPicture', slideIndex: 5, slot: 'image' },
    ]);
  });

  it('names a picture whose media was deleted', () => {
    const document = withPictureSlide();
    const id = document.slides[5].id;
    const filled = updateElement(document, id, 'image', { mediaId: 'gone' });

    expect(findDesignIssues(filled, (mediaId) => mediaId !== 'gone')).toEqual([
      { kind: 'missingPicture', slideIndex: 5, slot: 'image' },
    ]);
  });

  it('checks the brand kit logo on every slide that shows it', () => {
    const document = applyBrandKit(design(), {
      kitId: 'kit-1',
      colors: null,
      logoMediaId: 'logo-gone',
      name: 'Brand',
      kitVersion: null,
    });
    const issues = findDesignIssues(document, (mediaId) => mediaId !== 'logo-gone');

    expect(issues.length).toBe(document.slides.length);
    expect(issues.every((issue) => issue.kind === 'missingPicture' && issue.slot === 'logo')).toBe(
      true,
    );
  });

  it('skips a hidden element', () => {
    const document = applyBrandKit(design(), {
      kitId: 'kit-1',
      colors: null,
      logoMediaId: 'logo-gone',
      name: 'Brand',
      kitVersion: null,
    });
    const hidden = document.slides.reduce(
      (next, slide) => updateElement(next, slide.id, 'logo', { hidden: true }),
      document,
    );

    expect(findDesignIssues(hidden, (mediaId) => mediaId !== 'logo-gone')).toEqual([]);
  });

  it('warns about a photo too light to promise readable text, and a deleted one', () => {
    const document = design();
    const id = document.slides[0].id;
    const light = setBackground(document, id, { kind: 'media', mediaId: 'photo', overlay: 0.2 });
    const safe = setBackground(document, id, { kind: 'media', mediaId: 'photo', overlay: 0.6 });

    expect(findDesignIssues(light, always)).toEqual([
      { kind: 'photoTooLight', slideIndex: 0, slot: null },
    ]);
    expect(findDesignIssues(safe, always)).toEqual([]);
    expect(findDesignIssues(safe, () => false)).toEqual([
      { kind: 'missingPicture', slideIndex: 0, slot: null },
    ]);
  });

  it('reports a colour the user picked that does not read', () => {
    const document = design();
    const edited = updateElement(document, document.slides[2].id, 'body', { color: '#FFFFFF' });

    expect(findDesignIssues(edited, always)).toEqual([
      { kind: 'unreadable', slideIndex: 2, slot: 'body' },
    ]);
  });

  it('does not report the colour of text that is not there', () => {
    const document = design();
    const id = document.slides[2].id;
    const empty = updateElement(
      updateElement(document, id, 'body', { color: '#FFFFFF' }),
      id,
      'body',
      { text: '   ' },
    );

    expect(findDesignIssues(empty, always)).toEqual([]);
  });
});

describe('issueMessage', () => {
  const document = withPictureSlide();

  it('names the slide by the number the user sees and the element by its panel name', () => {
    expect(issueMessage(document, { kind: 'overflow', slideIndex: 0, slot: 'headline' })).toBe(
      'Slide 1: the headline is too long for its space.',
    );
    expect(issueMessage(document, { kind: 'unreadable', slideIndex: 2, slot: 'body' })).toBe(
      'Slide 3: the body is hard to read on its background.',
    );
    expect(issueMessage(document, { kind: 'emptyPicture', slideIndex: 5, slot: 'image' })).toBe(
      'Slide 6: the picture is empty.',
    );
    expect(issueMessage(document, { kind: 'missingPicture', slideIndex: 0, slot: 'logo' })).toBe(
      'Slide 1: the logo was deleted.',
    );
    expect(issueMessage(document, { kind: 'missingPicture', slideIndex: 0, slot: null })).toBe(
      'Slide 1: the background photo was deleted.',
    );
    expect(issueMessage(document, { kind: 'photoTooLight', slideIndex: 0, slot: null })).toBe(
      'Slide 1: text may be hard to read on the photo.',
    );
  });
});
