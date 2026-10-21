/**
 * `PostsService.search`: candidates come from the database, but a post is a
 * result only when its real words (or its tags) hold every search term. Also
 * the paging: how many batches are read, when `more` is set, and that nothing
 * is looked at once there is nothing left.
 */
import { State } from '@postgear/db';
import type { ChannelsService } from '../channels/channels.service';
import type { MediaService } from '../media/media.service';
import type { SchedulingService } from '../scheduling/scheduling.service';
import type { TagsService } from '../tags/tags.service';
import type { PostRow, PostsRepository } from './posts.repository';
import { PostsService } from './posts.service';

const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

let counter = 0;

function row(group: string, text: string, tags: string[] = []): PostRow {
  counter += 1;

  return {
    id: `row_${counter}`,
    group,
    integrationId: 'ch_x',
    parentPostId: null,
    state: State.QUEUE,
    publishDate: new Date('2026-10-22T10:00:00Z'),
    content: doc(text),
    image: '[]',
    settings: null,
    releaseId: null,
    releaseURL: null,
    error: null,
    intervalInDays: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    tags: tags.map((name, index) => ({ tag: { id: `tag_${index}`, name, color: 'teal' } })),
    integration: {
      id: 'ch_x',
      name: 'Acme on X',
      providerIdentifier: 'x',
      picture: null,
      profile: null,
      deletedAt: null,
    },
  };
}

describe('PostsService.search', () => {
  let repository: { searchGroups: jest.Mock; findGroups: jest.Mock };
  let channels: { colors: jest.Mock };
  let service: PostsService;

  beforeEach(() => {
    repository = { searchGroups: jest.fn(), findGroups: jest.fn() };
    channels = { colors: jest.fn().mockResolvedValue(new Map([['ch_x', 3]])) };
    service = new PostsService(
      repository as unknown as PostsRepository,
      channels as unknown as ChannelsService,
      {} as MediaService,
      {} as SchedulingService,
      {} as TagsService,
    );
  });

  it('returns a post whose text holds every term, with a summary and a snippet', async () => {
    repository.searchGroups.mockResolvedValue(['g1']);
    repository.findGroups.mockResolvedValue([row('g1', 'Big sale this summer')]);

    const result = await service.search('org_1', ['summer', 'sale'], 6);

    expect(result.more).toBe(false);
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toMatchObject({
      group: 'g1',
      snippet: 'Big sale this summer',
      preview: 'Big sale this summer',
      channels: [{ channelId: 'ch_x', name: 'Acme on X', color: 3 }],
    });
  });

  it('narrows the database query by the longest term, scoped to the workspace', async () => {
    repository.searchGroups.mockResolvedValue([]);

    await service.search('org_1', ['big', 'launch', 'day'], 6);

    expect(repository.searchGroups).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org_1', term: 'launch', skip: 0 }),
    );
  });

  it('drops a candidate that only matched the stored JSON, not the words', async () => {
    repository.searchGroups.mockResolvedValue(['g1', 'g2']);
    // "text" is in every document's JSON keys; only g2 actually says it.
    repository.findGroups.mockResolvedValue([
      row('g1', 'Hello there'),
      row('g2', 'Some text here'),
    ]);

    const result = await service.search('org_1', ['text'], 6);

    expect(result.posts.map((post) => post.group)).toEqual(['g2']);
  });

  it('matches a term against a tag name, and shows the post text as the snippet', async () => {
    repository.searchGroups.mockResolvedValue(['g1']);
    repository.findGroups.mockResolvedValue([row('g1', 'Opening day', ['Launch'])]);

    const result = await service.search('org_1', ['launch'], 6);

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].snippet).toBe('Opening day');
  });

  it('counts the words of every part and channel together', async () => {
    repository.searchGroups.mockResolvedValue(['g1']);
    repository.findGroups.mockResolvedValue([
      { ...row('g1', 'first part about summer'), id: 'row_part1' },
      { ...row('g1', 'second part about sale'), id: 'row_part2', parentPostId: 'row_part1' },
    ]);

    const result = await service.search('org_1', ['summer', 'sale'], 6);

    expect(result.posts).toHaveLength(1);
  });

  it('skips a group whose rows vanished between the two reads', async () => {
    repository.searchGroups.mockResolvedValue(['g1', 'g2']);
    repository.findGroups.mockResolvedValue([row('g2', 'summer sale')]);

    const result = await service.search('org_1', ['summer'], 6);

    expect(result.posts.map((post) => post.group)).toEqual(['g2']);
  });

  it('stops at the limit and says there are more', async () => {
    repository.searchGroups.mockResolvedValue(['g1', 'g2', 'g3']);
    repository.findGroups.mockResolvedValue([
      row('g1', 'summer one'),
      row('g2', 'summer two'),
      row('g3', 'summer three'),
    ]);

    const result = await service.search('org_1', ['summer'], 2);

    expect(result.posts.map((post) => post.group)).toEqual(['g1', 'g2']);
    expect(result.more).toBe(true);
  });

  it('does not say more when the matches are exactly the limit', async () => {
    repository.searchGroups.mockResolvedValue(['g1', 'g2']);
    repository.findGroups.mockResolvedValue([row('g1', 'summer one'), row('g2', 'summer two')]);

    const result = await service.search('org_1', ['summer'], 2);

    expect(result.posts).toHaveLength(2);
    expect(result.more).toBe(false);
  });

  it('reads the next batch while a full batch gave too few real matches', async () => {
    const fullBatch = Array.from({ length: 40 }, (_, index) => `miss_${index}`);
    repository.searchGroups.mockResolvedValueOnce(fullBatch).mockResolvedValueOnce(['hit']);
    repository.findGroups
      .mockResolvedValueOnce(fullBatch.map((group) => row(group, 'nothing relevant')))
      .mockResolvedValueOnce([row('hit', 'summer sale')]);

    const result = await service.search('org_1', ['summer'], 6);

    expect(result.posts.map((post) => post.group)).toEqual(['hit']);
    expect(repository.searchGroups).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ skip: 40 }),
    );
  });

  it('gives up after five batches of candidates that are not real matches', async () => {
    const fullBatch = Array.from({ length: 40 }, (_, index) => `miss_${index}`);
    repository.searchGroups.mockResolvedValue(fullBatch);
    repository.findGroups.mockResolvedValue(
      fullBatch.map((group) => row(group, 'nothing relevant')),
    );

    const result = await service.search('org_1', ['text'], 6);

    expect(result).toEqual({ posts: [], more: false });
    expect(repository.searchGroups).toHaveBeenCalledTimes(5);
  });

  it('stops after a short batch without asking for another', async () => {
    repository.searchGroups.mockResolvedValue(['g1']);
    repository.findGroups.mockResolvedValue([row('g1', 'nothing relevant')]);

    await service.search('org_1', ['text'], 6);

    expect(repository.searchGroups).toHaveBeenCalledTimes(1);
  });

  it('loads channel colours only when something matched', async () => {
    repository.searchGroups.mockResolvedValue([]);

    await service.search('org_1', ['summer'], 6);

    expect(channels.colors).not.toHaveBeenCalled();
  });
});
