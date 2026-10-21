/**
 * What `GET /search` accepts: cleaned text of 2 to 100 characters, nothing
 * else in the query string.
 */
import { searchQuerySchema } from './search.schema';

describe('searchQuerySchema', () => {
  it('accepts a search and cleans it up', () => {
    expect(searchQuerySchema.parse({ q: '  summer \n  sale ' })).toEqual({ q: 'summer sale' });
  });

  it('refuses one letter, and refuses a search that is only invisible characters', () => {
    expect(searchQuerySchema.safeParse({ q: 'a' }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: 'a​' }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: '   ' }).success).toBe(false);
  });

  it('accepts exactly two characters and exactly 100', () => {
    expect(searchQuerySchema.safeParse({ q: 'ab' }).success).toBe(true);
    expect(searchQuerySchema.safeParse({ q: 'a'.repeat(100) }).success).toBe(true);
    expect(searchQuerySchema.safeParse({ q: 'a'.repeat(101) }).success).toBe(false);
  });

  it('refuses a missing search and any extra key', () => {
    expect(searchQuerySchema.safeParse({}).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: 'launch', orgId: 'org_2' }).success).toBe(false);
  });

  it('refuses a repeated parameter (an array)', () => {
    expect(searchQuerySchema.safeParse({ q: ['one', 'two'] }).success).toBe(false);
  });
});
