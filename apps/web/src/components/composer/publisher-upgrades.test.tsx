/**
 * Sprint 13 Module 13 in the composer: Next Available (sets the time, says
 * why it is off), Pick A Random Time (a time inside each part of the day,
 * another on a second press, the day's list), and Made With AI (the switch,
 * the notes for platforms with no label, shown only for a video).
 */
import { DAY_PART_RANGES, DAY_PARTS } from '@postgear/automation';
import { TooltipProvider } from '@postgear/ui';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { api } from '@/lib/api';
import type { Channel } from '@/types/channel';
import type { PostSummary } from '@/types/post';
import { AI_LABEL_HELP, AiLabelControl, noLabelNotes, postHasVideo } from './composer-ai-label';
import { NextAvailableButton, nextSlotBlock, nextSlotPath } from './composer-next-slot';
import { textPart } from './composer-state';
import { DAY_PART_LABELS, RandomTimePanel, scheduledSentence, takenOn } from './random-time-panel';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
jest.mock('next/navigation', () => ({ useParams: () => ({ orgId: 'org-1' }) }));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: jest.fn(),
}));

const apiMock = api as jest.MockedFunction<typeof api>;
const ALL = [1, 2, 3, 4, 5, 6, 7];

beforeAll(() => stubBrowserLayout());
beforeEach(() => apiMock.mockReset());

function channel(id: string, name: string, postingTimes: Channel['postingTimes']): Channel {
  return { id, name, postingTimes } as unknown as Channel;
}

describe('Next Available', () => {
  it('asks for the chosen channels in order, in the browser zone, with a seed', () => {
    const path = nextSlotPath(['a', 'b'], 'seed1');
    expect(path).toContain('/channels/next-slot?');
    expect(path).toContain('channelIds=a%2Cb');
    expect(path).toContain('seed=seed1');
    expect(path).toContain('timeZone=');
  });

  it('is off with a reason when there is no channel or the first has no posting times', () => {
    expect(nextSlotBlock([])).toBe('Choose a channel first.');
    expect(nextSlotBlock([{ postingTimes: [] }])).toBe('Set posting times for this channel first.');
    expect(nextSlotBlock([{ postingTimes: [{ time: 540, windowMinutes: 15, days: ALL }] }])).toBe(
      null,
    );
  });

  it('sets the time to the answer', async () => {
    apiMock.mockResolvedValue({
      at: '2026-11-17T07:52:00.000Z',
      channelId: 'a',
      windowMinutes: 15,
      channels: [],
    } as never);
    const onPick = jest.fn();
    render(
      <TooltipProvider>
        <NextAvailableButton
          channels={[channel('a', 'Acme', [{ time: 480, windowMinutes: 15, days: ALL }])]}
          onPick={onPick}
          onError={jest.fn()}
        />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Next Available/ }));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    const [at, seed] = onPick.mock.calls[0] as [Date, string];
    expect(at.toISOString()).toBe('2026-11-17T07:52:00.000Z');
    expect(seed).toMatch(/^[a-z0-9]+$/);
  });

  it('stays off for a channel with no posting times', () => {
    render(
      <TooltipProvider>
        <NextAvailableButton
          channels={[channel('a', 'Acme', [])]}
          onPick={jest.fn()}
          onError={jest.fn()}
        />
      </TooltipProvider>,
    );
    expect(
      (screen.getByRole('button', { name: /Next Available/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(apiMock).not.toHaveBeenCalled();
  });
});

describe('Pick A Random Time', () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(12, 0, 0, 0);

  it('picks a time inside each part of the day, never on a five-minute mark', async () => {
    apiMock.mockResolvedValue({ posts: [] } as never);
    const onPick = jest.fn();
    render(<RandomTimePanel day={tomorrow} onPick={onPick} channelId="a" group={null} />);
    await waitFor(() => expect(apiMock).toHaveBeenCalled());

    for (const part of DAY_PARTS) {
      fireEvent.click(screen.getByRole('button', { name: DAY_PART_LABELS[part] }));
      const at = (onPick.mock.calls.at(-1) as [Date])[0];
      const minutes = at.getHours() * 60 + at.getMinutes();
      const [first, last] = DAY_PART_RANGES[part];
      expect(minutes).toBeGreaterThanOrEqual(first);
      expect(minutes).toBeLessThanOrEqual(last);
      expect(at.getMinutes() % 5).not.toBe(0);
      expect(at.getDate()).toBe(tomorrow.getDate());
    }
    expect(screen.getByText(/^Your post will be scheduled for /)).toBeTruthy();
  });

  it('gives another time on a second press', async () => {
    apiMock.mockResolvedValue({ posts: [] } as never);
    const onPick = jest.fn();
    render(<RandomTimePanel day={tomorrow} onPick={onPick} channelId="a" group={null} />);
    const times = new Set<number>();
    for (let press = 0; press < 6; press += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Evening' }));
      const last = onPick.mock.calls.at(-1) as [Date] | undefined;
      if (last) times.add(last[0].getTime());
    }
    expect(times.size).toBeGreaterThan(1);
  });

  it('lists the chosen channel’s posts that day, the post being edited left out', () => {
    const post = (group: string, channelId: string, at: string) =>
      ({
        group,
        state: 'QUEUE',
        publishDate: at,
        channels: [{ channelId }],
      }) as unknown as PostSummary;
    const posts = [
      post('g1', 'a', '2026-11-17T09:07:00.000Z'),
      post('g2', 'b', '2026-11-17T10:07:00.000Z'),
      post('g3', 'a', '2026-11-17T08:07:00.000Z'),
    ];
    expect(takenOn(posts, 'a', 'g1')).toEqual([Date.parse('2026-11-17T08:07:00.000Z')]);
    expect(scheduledSentence(new Date(2026, 10, 15, 7, 58))).toMatch(
      /^Your post will be scheduled for .*15.*2026 at 7:58/,
    );
  });
});

describe('Made With AI', () => {
  it('shows only for a post with a video', () => {
    const image = textPart('Hi', [{ id: 'm', type: 'image' } as never]);
    const video = textPart('Hi', [{ id: 'v', type: 'video' } as never]);
    expect(postHasVideo([image], {})).toBe(false);
    expect(postHasVideo([image], { ch: [video] })).toBe(true);
  });

  it('notes each platform with no label once', () => {
    expect(
      noLabelNotes([
        { name: 'YouTube', aiLabel: 'field' },
        { name: 'X', aiLabel: 'none' },
        { name: 'X', aiLabel: 'none' },
        { name: 'TikTok', aiLabel: 'none' },
      ]),
    ).toEqual([
      'X has no label for AI. Say it in your caption if you need to.',
      'TikTok has no label for AI. Say it in your caption if you need to.',
    ]);
  });

  it('turns on from its switch, with the help line', () => {
    const onChange = jest.fn();
    render(
      <AiLabelControl
        value={false}
        onChange={onChange}
        platforms={[{ name: 'LinkedIn', aiLabel: 'none' }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Made With AI' }));
    expect(screen.getByText(AI_LABEL_HELP)).toBeTruthy();
    expect(screen.getByText(/LinkedIn has no label for AI/)).toBeTruthy();
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
