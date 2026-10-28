import { FORMAT_IDS, FORMATS } from '@postgear/design-engine';
import { formatName } from '@/components/studio/studio-view-model';
import { DESIGN_FORMATS, designFormat, designHref, thumbSize } from './design-results';

describe('design results', () => {
  it('names and sizes every format as the Studio does', () => {
    expect(Object.keys(DESIGN_FORMATS).sort()).toEqual([...FORMAT_IDS].sort());

    for (const id of FORMAT_IDS) {
      expect(DESIGN_FORMATS[id]).toEqual({
        label: formatName(id),
        width: FORMATS[id].width,
        height: FORMATS[id].height,
      });
    }
  });

  it('knows only the formats it lists', () => {
    expect(designFormat('portrait')?.label).toBe('Portrait (4:5)');
    expect(designFormat('poster')).toBeNull();
    expect(designFormat('toString')).toBeNull();
  });

  it('keeps the slide shape inside the square', () => {
    expect(thumbSize(designFormat('square'), 36)).toEqual({ width: 36, height: 36 });
    expect(thumbSize(designFormat('portrait'), 36)).toEqual({ width: 29, height: 36 });
    expect(thumbSize(designFormat('story'), 36)).toEqual({ width: 20, height: 36 });
    expect(thumbSize(designFormat('landscape'), 36)).toEqual({ width: 36, height: 20 });
    expect(thumbSize(null, 36)).toEqual({ width: 36, height: 36 });
  });

  it('opens a design in the Studio editor', () => {
    expect(designHref('/org_1', 'design_1')).toBe('/org_1/studio/design_1');
    expect(designHref('/org_1', 'a/b')).toBe('/org_1/studio/a%2Fb');
  });
});
