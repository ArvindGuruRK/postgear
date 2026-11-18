import { CLIPS_TAB_NAMES, CLIPS_TABS, clipsTabFrom } from './clips-model';

describe('clipsTabFrom', () => {
  it('opens a named tab', () => {
    for (const tab of CLIPS_TABS) {
      expect(clipsTabFrom(tab)).toBe(tab);
    }
  });

  it('falls back to Create for anything else', () => {
    expect(clipsTabFrom(undefined)).toBe('create');
    expect(clipsTabFrom(null)).toBe('create');
    expect(clipsTabFrom('')).toBe('create');
    expect(clipsTabFrom('Videos')).toBe('create');
    expect(clipsTabFrom(['videos'])).toBe('create');
    expect(clipsTabFrom('__proto__')).toBe('create');
  });

  it('names every tab', () => {
    expect(CLIPS_TABS.map((tab) => CLIPS_TAB_NAMES[tab])).toEqual([
      'Create',
      'Videos',
      'Clips',
      'Downloads',
    ]);
  });
});
