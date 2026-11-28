/**
 * Sprint 13, Module 16 section 2: "A random time of day has no free minute"
 * (`docs/new-modules/user-stories-clips-ai.md` section 5).
 *
 * A part of the day with no minute left says why: full when the channel's
 * posts take every minute of it, passed when it is over. Before Module 16 a
 * full Noon read "has passed". Nothing is picked in either case.
 */
import { DAY_PART_RANGES } from '@postgear/automation';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { api } from '@/lib/api';
import type { PostSummary } from '@/types/post';
import { PART_FULL, PART_PASSED, RandomTimePanel } from './random-time-panel';

jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: jest.fn(),
}));

const apiMock = api as jest.MockedFunction<typeof api>;
beforeAll(() => stubBrowserLayout());
beforeEach(() => apiMock.mockReset());

function dayFromNow(days: number): Date {
  const day = new Date();
  day.setDate(day.getDate() + days);
  day.setHours(0, 0, 0, 0);
  return day;
}

/** A post on channel `a` at every minute of Noon on `day`, in the browser's zone. */
function noonFilled(day: Date): PostSummary[] {
  const [first, last] = DAY_PART_RANGES.noon;
  const posts: PostSummary[] = [];
  for (let minutes = first; minutes <= last; minutes += 1) {
    const at = new Date(day);
    at.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    posts.push({
      group: `g${minutes}`,
      state: 'QUEUE',
      publishDate: at.toISOString(),
      channels: [{ channelId: 'a' }],
    } as unknown as PostSummary);
  }
  return posts;
}

describe('"A random time of day has no free minute"', () => {
  it('says the part is full when the posts take every minute, and picks nothing', async () => {
    const tomorrow = dayFromNow(1);
    apiMock.mockResolvedValue({ posts: noonFilled(tomorrow) } as never);
    const onPick = jest.fn();
    render(<RandomTimePanel day={tomorrow} onPick={onPick} channelId="a" group={null} />);
    // The day's list shows once the posts are in.
    await waitFor(() => expect(screen.queryByText('Nothing yet.')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Noon' }));
    expect(screen.getByText(PART_FULL)).toBeInTheDocument();
    expect(PART_FULL).toBe('That part of the day is full. Try another.');
    expect(onPick).not.toHaveBeenCalled();

    // Another part of the same day still has room.
    fireEvent.click(screen.getByRole('button', { name: 'Evening' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(PART_FULL)).toBeNull();
  });

  it('another channel’s posts leave the part free', async () => {
    const tomorrow = dayFromNow(1);
    apiMock.mockResolvedValue({ posts: noonFilled(tomorrow) } as never);
    const onPick = jest.fn();
    render(<RandomTimePanel day={tomorrow} onPick={onPick} channelId="b" group={null} />);
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Noon' }));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('says a part that is over has passed', async () => {
    apiMock.mockResolvedValue({ posts: [] } as never);
    const onPick = jest.fn();
    render(<RandomTimePanel day={dayFromNow(-1)} onPick={onPick} channelId="a" group={null} />);
    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Evening' }));
    expect(screen.getByText(PART_PASSED)).toBeInTheDocument();
    expect(screen.queryByText(PART_FULL)).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });
});
