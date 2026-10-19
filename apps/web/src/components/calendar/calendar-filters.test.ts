import type { Channel } from '@/types/channel';
import type { PostSummary } from '@/types/post';
import type { Tag } from '@/types/tag';
import { filterPosts, orderChannels } from './calendar-filters';

function channel(id: string): Channel {
  return { id, name: id } as Channel;
}

const urgent: Tag = { id: 't_urgent', name: 'Urgent', color: 'rose' };
const launch: Tag = { id: 't_launch', name: 'Launch', color: 'teal' };

function post(group: string, channelIds: string[], tags: Tag[] | undefined): PostSummary {
  return {
    group,
    channels: channelIds.map((channelId) => ({ channelId })),
    tags,
  } as unknown as PostSummary;
}

describe('orderChannels', () => {
  const list = ['a', 'b', 'c', 'd'].map(channel);

  it('puts the named channels first, in the order given', () => {
    expect(orderChannels(list, ['c', 'a', 'd', 'b']).map((entry) => entry.id)).toEqual([
      'c',
      'a',
      'd',
      'b',
    ]);
  });

  it('keeps channels it was not told about after them, in their own order', () => {
    expect(orderChannels(list, ['d', 'b']).map((entry) => entry.id)).toEqual(['d', 'b', 'a', 'c']);
  });

  it('ignores ids that are not channels (one disconnected meanwhile)', () => {
    expect(orderChannels(list, ['gone', 'b']).map((entry) => entry.id)).toEqual([
      'b',
      'a',
      'c',
      'd',
    ]);
  });
});

describe('filterPosts', () => {
  const posts = [
    post('p1', ['ch_1'], [urgent]),
    post('p2', ['ch_2'], [launch, urgent]),
    post('p3', ['ch_1', 'ch_2'], []),
    // From an API older than tags: no field at all.
    post('p4', ['ch_2'], undefined),
  ];
  const groups = (list: PostSummary[]) => list.map((entry) => entry.group);

  it('shows everything with no filter', () => {
    expect(filterPosts(posts, [], [])).toBe(posts);
  });

  it('shows posts on any selected channel', () => {
    expect(groups(filterPosts(posts, ['ch_1'], []))).toEqual(['p1', 'p3']);
  });

  it('shows posts carrying any selected tag', () => {
    expect(groups(filterPosts(posts, [], ['t_urgent']))).toEqual(['p1', 'p2']);
    expect(groups(filterPosts(posts, [], ['t_launch', 't_urgent']))).toEqual(['p1', 'p2']);
  });

  it('combines the two: a post must pass both', () => {
    expect(groups(filterPosts(posts, ['ch_2'], ['t_urgent']))).toEqual(['p2']);
    expect(groups(filterPosts(posts, ['ch_1'], ['t_launch']))).toEqual([]);
  });
});
