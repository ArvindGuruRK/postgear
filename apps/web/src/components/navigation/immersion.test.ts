import { immersion } from './immersion';

describe('immersion', () => {
  it('opens the clip editor in the whole window, fixed like Studio', () => {
    expect(immersion('clips/edit/3f2a9c1e-0000-4000-8000-000000000001')).toBe('fixed');
  });

  it('keeps the frame on the Clips page, the video page and anything else under clips', () => {
    expect(immersion('clips')).toBeNull();
    expect(immersion('clips/edit')).toBeNull();
    expect(immersion('clips/edit/')).toBeNull();
    expect(immersion('clips/edit/abc/more')).toBeNull();
    expect(immersion('clips/video/abc')).toBeNull();
    expect(immersion('clips/abc')).toBeNull();
  });

  it("keeps Studio's behaviour exactly", () => {
    expect(immersion('studio')).toBeNull();
    expect(immersion('studio/new')).toBe('scroll');
    expect(immersion('studio/design-1')).toBe('fixed');
    expect(immersion('studio/design-1/deeper')).toBeNull();
  });

  it("keeps Workflows' behaviour exactly", () => {
    expect(immersion('workflows')).toBeNull();
    expect(immersion('workflows/flow-1')).toBe('edge');
    expect(immersion('workflows/new')).toBe('edge');
    expect(immersion('workflows/flow-1/runs')).toBeNull();
  });

  it('leaves every other page in the frame', () => {
    expect(immersion('')).toBeNull();
    expect(immersion('calendar')).toBeNull();
    expect(immersion('settings/billing')).toBeNull();
    expect(immersion('edit/clips/abc')).toBeNull();
  });
});
