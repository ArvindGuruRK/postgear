import {
  clearRecent,
  forgetSearch,
  MAX_RECENT,
  readRecent,
  rememberSearch,
} from './recent-searches';

describe('recent searches', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts empty', () => {
    expect(readRecent('org_1')).toEqual([]);
  });

  it('remembers the newest first', () => {
    rememberSearch('org_1', 'launch');
    rememberSearch('org_1', 'summer sale');

    expect(readRecent('org_1')).toEqual(['summer sale', 'launch']);
  });

  it('moves a repeated search to the front instead of listing it twice, ignoring case', () => {
    rememberSearch('org_1', 'launch');
    rememberSearch('org_1', 'sale');
    rememberSearch('org_1', 'LAUNCH');

    expect(readRecent('org_1')).toEqual(['LAUNCH', 'sale']);
  });

  it('collapses whitespace and ignores a blank search', () => {
    rememberSearch('org_1', '  summer   sale ');
    rememberSearch('org_1', '   ');

    expect(readRecent('org_1')).toEqual(['summer sale']);
  });

  it('keeps only the latest few', () => {
    for (let index = 0; index < MAX_RECENT + 3; index += 1) {
      rememberSearch('org_1', `search ${index}`);
    }

    const recent = readRecent('org_1');
    expect(recent).toHaveLength(MAX_RECENT);
    expect(recent[0]).toBe(`search ${MAX_RECENT + 2}`);
  });

  it('keeps each workspace to itself', () => {
    rememberSearch('org_1', 'launch');

    expect(readRecent('org_2')).toEqual([]);
  });

  it('forgets one search, or all of them', () => {
    rememberSearch('org_1', 'launch');
    rememberSearch('org_1', 'sale');

    expect(forgetSearch('org_1', 'launch')).toEqual(['sale']);

    clearRecent('org_1');
    expect(readRecent('org_1')).toEqual([]);
  });

  it('survives storage holding something unexpected', () => {
    window.localStorage.setItem('pg:recent-searches:org_1', '{"not":"a list"}');
    expect(readRecent('org_1')).toEqual([]);

    window.localStorage.setItem('pg:recent-searches:org_1', 'not json');
    expect(readRecent('org_1')).toEqual([]);

    window.localStorage.setItem('pg:recent-searches:org_1', JSON.stringify(['ok', 3, '', null]));
    expect(readRecent('org_1')).toEqual(['ok']);
  });

  it('works when storage throws', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(readRecent('org_1')).toEqual([]);
    expect(() => rememberSearch('org_1', 'launch')).not.toThrow();

    spy.mockRestore();
    set.mockRestore();
  });
});
