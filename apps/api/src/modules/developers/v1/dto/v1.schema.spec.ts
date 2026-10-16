/**
 * The public schemas' bounds, pinned — they are also what the OpenAPI
 * document states, so a change here is a change to the published contract.
 */
import { createPublicPostSchema, listPublicPostsQuerySchema } from './v1.schema';

describe('createPublicPostSchema', () => {
  const valid = { text: 'Hello', channelIds: ['ch_a'] };

  it('accepts the minimal body and defaults the state to queue', () => {
    expect(createPublicPostSchema.parse(valid)).toEqual({
      text: 'Hello',
      channelIds: ['ch_a'],
      state: 'queue',
    });
  });

  it('accepts every optional field', () => {
    expect(
      createPublicPostSchema.safeParse({
        ...valid,
        state: 'draft',
        publishAt: '2026-11-01T09:00:00+05:30',
        mediaIds: ['6f1c2f7e-5d2b-4d0c-9a4e-3b8f0e2a1c11'],
      }).success,
    ).toBe(true);
  });

  it('is strict about unknown keys', () => {
    expect(createPublicPostSchema.safeParse({ ...valid, publishDate: 'x' }).success).toBe(false);
  });

  it.each([
    ['empty text', { ...valid, text: '' }],
    ['text past 70,000 characters', { ...valid, text: 'x'.repeat(70_001) }],
    ['no channels', { ...valid, channelIds: [] }],
    ['more than twenty channels', { ...valid, channelIds: Array.from({ length: 21 }, (_, i) => `c${i}`) }],
    ['a channel listed twice', { ...valid, channelIds: ['ch_a', 'ch_a'] }],
    ['an unknown state', { ...valid, state: 'QUEUE' }],
    ['a non-ISO publishAt', { ...valid, publishAt: 'tomorrow' }],
    ['a publishAt without offset', { ...valid, publishAt: '2026-11-01T09:00:00' }],
    ['a media id that is not a uuid', { ...valid, mediaIds: ['nope'] }],
    ['more than twenty media ids', { ...valid, mediaIds: Array.from({ length: 21 }, () => '6f1c2f7e-5d2b-4d0c-9a4e-3b8f0e2a1c11') }],
  ])('refuses %s', (_label, body) => {
    expect(createPublicPostSchema.safeParse(body).success).toBe(false);
  });
});

describe('listPublicPostsQuerySchema', () => {
  it('defaults to page 1 with no filter', () => {
    expect(listPublicPostsQuerySchema.parse({})).toEqual({ page: 1 });
  });

  it('coerces the page and lowercases the state', () => {
    expect(listPublicPostsQuerySchema.parse({ page: '3', state: 'PUBLISHED' })).toEqual({
      page: 3,
      state: 'published',
    });
  });

  it.each([
    ['page 0', { page: '0' }],
    ['a fractional page', { page: '1.5' }],
    ['a page past the ceiling', { page: '10001' }],
    ['an unknown state', { state: 'scheduled' }],
    ['an unknown key', { channelId: 'x' }],
  ])('refuses %s', (_label, query) => {
    expect(listPublicPostsQuerySchema.safeParse(query).success).toBe(false);
  });
});
