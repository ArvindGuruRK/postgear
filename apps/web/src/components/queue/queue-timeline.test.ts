import type { PostSummary } from '@/types/post';
import { buildTimeline, emptyCopy, type TimelineDay } from './queue-timeline';

// Friday 23 October 2026, 18:00 local.
const NOW = new Date(2026, 9, 23, 18, 0);

function post(group: string, at: Date): PostSummary {
  return {
    group,
    state: 'QUEUE',
    publishDate: at.toISOString(),
    updatedAt: at.toISOString(),
    preview: group,
    parts: 1,
    channels: [],
    tags: [],
    intervalInDays: null,
  };
}

const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0);

/** The timeline as a compact picture: "day:post,post". */
const shape = (days: TimelineDay[]) =>
  days.map((day) => `${day.dayNumber}:${day.posts.map((entry) => entry.group).join(',')}`);

const build = (posts: PostSummary[]) => buildTimeline(posts, NOW);

describe('queue timeline', () => {
  it('groups posts under their local day, in the list order', () => {
    expect(
      shape(build([post('a', at(25, 9)), post('b', at(25, 14)), post('c', at(27, 9))])),
    ).toEqual(['25:a,b', '27:c']);
    // Newest first reads the same way, just the other way round.
    expect(
      shape(build([post('c', at(27, 9)), post('b', at(25, 14)), post('a', at(25, 9))])),
    ).toEqual(['27:c', '25:b,a']);
    expect(build([])).toEqual([]);
  });

  it('names days the way people say them', () => {
    const [yesterday, today, tomorrow, later] = build([
      post('a', at(22, 9)),
      post('b', at(23, 9)),
      post('c', at(24, 9)),
      post('d', at(28, 9)),
    ]);

    expect([yesterday.name, today.name, tomorrow.name]).toEqual(['Yesterday', 'Today', 'Tomorrow']);
    expect(later.name).toBe(at(28, 9).toLocaleDateString(undefined, { weekday: 'long' }));
    expect(today.label.startsWith('Today, ')).toBe(true);
    expect([yesterday.past, today.past, today.today, later.today]).toEqual([
      true,
      false,
      true,
      false,
    ]);
    expect(today.dayNumber).toBe('23');
  });

  it('adds the year to a day in another year', () => {
    const [day] = build([post('a', new Date(2027, 0, 4, 9))]);
    expect(day.month).toContain('2027');
  });

  it('offers to write a post only where that is the way forward', () => {
    expect(emptyCopy('QUEUE').create).toBe(true);
    expect(emptyCopy('DRAFT').create).toBe(true);
    expect(emptyCopy('ERROR').create).toBe(false);
    expect(emptyCopy('PUBLISHED').create).toBe(false);
  });
});
