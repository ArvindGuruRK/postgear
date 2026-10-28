/**
 * The search fan-out: the four owners (posts, channels, media and, since
 * Sprint 9b, Studio designs) are asked with the same workspace and the same
 * words, results are passed through, and one failing owner leaves the others
 * intact and is named in `unavailable` rather than looking like "no results".
 */
import { Logger } from '@nestjs/common';
import type { ChannelsService } from '../channels/channels.service';
import type { MediaService } from '../media/media.service';
import type { PostsService } from '../posts/posts.service';
import type { StudioService } from '../studio/studio.service';
import { SEARCH_LIMITS, SearchService } from './search.service';

describe('SearchService', () => {
  let posts: { search: jest.Mock };
  let channels: { search: jest.Mock };
  let media: { search: jest.Mock };
  let studio: { search: jest.Mock };
  let service: SearchService;

  beforeEach(() => {
    posts = { search: jest.fn().mockResolvedValue({ posts: [], more: false }) };
    channels = { search: jest.fn().mockResolvedValue({ channels: [], more: false }) };
    media = { search: jest.fn().mockResolvedValue({ media: [], more: false }) };
    studio = { search: jest.fn().mockResolvedValue({ designs: [], more: false }) };
    service = new SearchService(
      posts as unknown as PostsService,
      channels as unknown as ChannelsService,
      media as unknown as MediaService,
      studio as unknown as StudioService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('asks every owner for the active workspace with the typed words, lower-cased', async () => {
    await service.search('org_1', 'Summer  SALE');

    expect(posts.search).toHaveBeenCalledWith('org_1', ['summer', 'sale'], SEARCH_LIMITS.posts);
    expect(channels.search).toHaveBeenCalledWith(
      'org_1',
      ['summer', 'sale'],
      SEARCH_LIMITS.channels,
    );
    expect(media.search).toHaveBeenCalledWith('org_1', ['summer', 'sale'], SEARCH_LIMITS.media);
    expect(studio.search).toHaveBeenCalledWith('org_1', ['summer', 'sale'], SEARCH_LIMITS.designs);
  });

  it('passes results and the more flags through, and echoes the query', async () => {
    posts.search.mockResolvedValue({ posts: [{ group: 'g1' }], more: true });
    channels.search.mockResolvedValue({ channels: [{ id: 'ch_1' }], more: false });
    media.search.mockResolvedValue({ media: [{ id: 'm1' }], more: true });
    studio.search.mockResolvedValue({ designs: [{ id: 'd1' }], more: true });

    await expect(service.search('org_1', 'launch')).resolves.toEqual({
      query: 'launch',
      posts: [{ group: 'g1' }],
      channels: [{ id: 'ch_1' }],
      media: [{ id: 'm1' }],
      designs: [{ id: 'd1' }],
      more: { posts: true, channels: false, media: true, designs: true },
      unavailable: [],
    });
  });

  it('keeps the rest when the designs search fails, and names it', async () => {
    media.search.mockResolvedValue({ media: [{ id: 'm1' }], more: false });
    studio.search.mockRejectedValue(new Error('design table locked'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const result = await service.search('org_1', 'launch');

    expect(result.media).toEqual([{ id: 'm1' }]);
    expect(result.designs).toEqual([]);
    expect(result.more.designs).toBe(false);
    expect(result.unavailable).toEqual(['designs']);
  });

  it('keeps the other results when one owner fails, and names the one that failed', async () => {
    posts.search.mockResolvedValue({ posts: [{ group: 'g1' }], more: false });
    media.search.mockRejectedValue(new Error('storage down'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const result = await service.search('org_1', 'launch');

    expect(result.posts).toEqual([{ group: 'g1' }]);
    expect(result.media).toEqual([]);
    expect(result.more.media).toBe(false);
    expect(result.unavailable).toEqual(['media']);
  });

  it('does not write the typed words to the log when a search fails', async () => {
    posts.search.mockRejectedValue(new Error('boom'));
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await service.search('org_1', 'secret words');

    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).not.toContain('secret');
  });

  it('can have every owner fail', async () => {
    posts.search.mockRejectedValue(new Error('a'));
    channels.search.mockRejectedValue('b');
    media.search.mockRejectedValue(new Error('c'));
    studio.search.mockRejectedValue(new Error('d'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const result = await service.search('org_1', 'launch');

    expect(result.unavailable).toEqual(['posts', 'channels', 'media', 'designs']);
    expect(result.posts).toEqual([]);
  });
});
