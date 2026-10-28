import { LAYOUTS } from './layouts';
import { sampleElements } from './samples';

describe('the words a new slide starts with', () => {
  it('fill a footer with a line, and a footer the layout calls a link with an address', () => {
    let footers = 0;

    for (const layout of LAYOUTS) {
      const elements = sampleElements(layout);

      for (const slot of layout.slots) {
        if (slot.id !== 'footer' || slot.kind !== 'text' || slot.bind) continue;
        footers += 1;

        const expected = slot.label === 'Link' ? 'yourbrand.com' : 'Swipe for more';
        expect([layout.id, elements.footer?.text]).toEqual([layout.id, expected]);
        expect(expected.length).toBeLessThanOrEqual(
          slot.recommendedChars ?? Number.POSITIVE_INFINITY,
        );
      }
    }

    // The Signature family has footers; without them this would pass on nothing.
    expect(footers).toBeGreaterThan(0);
  });
});
