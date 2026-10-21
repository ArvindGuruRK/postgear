import { findPages, MAX_PAGE_RESULTS, quickActions, SEARCH_PAGES } from './search-pages';

const ids = (query: string) => findPages(query).map((page) => page.id);

describe('findPages', () => {
  it('finds a page by its name, ignoring case', () => {
    expect(ids('CALENDAR')).toEqual(['calendar']);
  });

  it('finds a page by what a person might call it', () => {
    expect(ids('plan')).toContain('billing');
    expect(ids('theme')).toContain('appearance');
    expect(ids('invite')).toContain('team');
    expect(ids('dashboard')).toContain('home');
  });

  it('finds a settings page by its section name', () => {
    expect(ids('settings')).toEqual(
      expect.arrayContaining(['team', 'billing', 'api-keys', 'webhooks']),
    );
  });

  it('needs every word, in any order', () => {
    expect(ids('api keys')).toEqual(['api-keys']);
    expect(ids('keys api')).toEqual(['api-keys']);
    expect(ids('calendar billing')).toEqual([]);
  });

  it('puts names that start with the search first', () => {
    // Home, Team and others only contain "me"; Media starts with it.
    expect(ids('me')[0]).toBe('media');
    // Create post and Calendar both start with "c": the list order keeps the action first.
    expect(ids('c')[0]).toBe('create-post');
  });

  it('matches nothing for an empty or blank search', () => {
    expect(findPages('')).toEqual([]);
    expect(findPages('   ')).toEqual([]);
  });

  it('matches nothing for an unknown word', () => {
    expect(findPages('zzzzqqq')).toEqual([]);
  });

  it('never returns more than the cap', () => {
    expect(findPages('e').length).toBeLessThanOrEqual(MAX_PAGE_RESULTS);
  });

  it('has unique ids', () => {
    expect(new Set(SEARCH_PAGES.map((page) => page.id)).size).toBe(SEARCH_PAGES.length);
  });
});

describe('quickActions', () => {
  it('is create post and connect a channel', () => {
    expect(quickActions().map((page) => page.id)).toEqual(['create-post', 'connect-channel']);
  });
});
