import { defaultLayoutFor, layoutKey, plainLayout, SLIDE_ROLES } from '@postgear/design-engine';
import { slideName } from './rail-model';

const on = (layoutId: string) => ({ layoutId });

describe('slideName', () => {
  it("names a slide by its place and its layout's kind", () => {
    expect(slideName(on(layoutKey(defaultLayoutFor('cover'))), 0)).toBe('1. Cover');
    expect(slideName(on(layoutKey(defaultLayoutFor('content'))), 1)).toBe('2. Content');
    expect(slideName(on(layoutKey(defaultLayoutFor('closing'))), 4)).toBe('5. Closing CTA');
  });

  it('calls the plain layout a content slide, which is what it is for', () => {
    expect(slideName(on(layoutKey(plainLayout())), 2)).toBe('3. Content');
  });

  it('keeps the number for a layout this version does not know', () => {
    expect(slideName(on('from-the-future@9'), 2)).toBe('3. Slide');
  });

  it('writes every kind of slide in Title Case', () => {
    for (const role of SLIDE_ROLES) {
      const name = slideName(on(layoutKey(defaultLayoutFor(role))), 0);
      expect(name).toMatch(/^\d+\. [A-Z]\w*( [A-Z]\w*)*$/);
    }
  });
});
