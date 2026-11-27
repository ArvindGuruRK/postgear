/**
 * Sprint 13 Module 13: Manage Posting Time Slots and Shuffle Times. The
 * model's words and rules, then the dialogs: a window, the weekday chips
 * (at least one stays on), Add Another Time, Shuffle's preview and Use These
 * Times, and the saved body.
 */
import { TooltipProvider } from '@postgear/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { api } from '@/lib/api';
import type { Channel } from '@/types/channel';
import { PostingTimesDialog } from './posting-times-dialog';
import {
  daysLabel,
  nextNewSlot,
  slotsProblem,
  slotsToSave,
  slotTimesOn,
  toggleDay,
  weeklyLabel,
} from './posting-slots-model';

jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: jest.fn(),
}));

const apiMock = api as jest.MockedFunction<typeof api>;
const ALL = [1, 2, 3, 4, 5, 6, 7];

beforeAll(() => stubBrowserLayout());
beforeEach(() => apiMock.mockReset());

describe('posting slots model', () => {
  it('names the days', () => {
    expect(daysLabel(ALL)).toBe('Every day');
    expect(daysLabel([1, 2, 3, 4, 5])).toBe('Weekdays');
    expect(daysLabel([6, 7])).toBe('Weekends');
    expect(daysLabel([4, 2, 3])).toBe('Tue, Wed, Thu');
  });

  it('keeps at least one weekday on', () => {
    expect(toggleDay([2], 2)).toEqual([2]);
    expect(toggleDay([2, 4], 2)).toEqual([4]);
    expect(toggleDay([4], 1)).toEqual([1, 4]);
  });

  it('says what stops a save', () => {
    expect(slotsProblem([])).toBe('Add at least one time before saving.');
    expect(
      slotsProblem([
        { time: 540, windowMinutes: 0, days: ALL },
        { time: 540, windowMinutes: 15, days: [1] },
      ]),
    ).toBe('Two slots have the same time. Change one.');
    expect(slotsProblem([{ time: 540, windowMinutes: 7, days: ALL }])).toBe(
      'Choose a window for each time.',
    );
    expect(slotsProblem([{ time: 540, windowMinutes: 15, days: [3] }])).toBeNull();
  });

  it('adds a new slot an hour after the last, and saves sorted', () => {
    expect(nextNewSlot([])).toEqual({ time: 540, windowMinutes: 0, days: ALL });
    expect(nextNewSlot([{ time: 600, windowMinutes: 0, days: ALL }]).time).toBe(660);
    expect(
      slotsToSave([
        { time: 700, windowMinutes: 0, days: [3, 1] },
        { time: 120, windowMinutes: 5, days: ALL },
      ]).map((slot) => [slot.time, slot.days]),
    ).toEqual([
      [120, ALL],
      [700, [1, 3]],
    ]);
  });

  it('counts posts a week and finds the slots of one weekday', () => {
    const slots = [
      { time: 540, windowMinutes: 15, days: ALL },
      { time: 1000, windowMinutes: 15, days: [2, 3, 4] },
    ];
    expect(weeklyLabel(slots)).toBe('10 posts a week');
    // 17 November 2026 is a Tuesday; the 22nd a Sunday.
    expect(slotTimesOn(slots, new Date(2026, 10, 17))).toEqual([540, 1000]);
    expect(slotTimesOn(slots, new Date(2026, 10, 22))).toEqual([540]);
  });
});

function channel(postingTimes: Channel['postingTimes']): Channel {
  return {
    id: 'ch-1',
    name: 'Acme',
    postingTimes,
  } as unknown as Channel;
}

function renderDialog(slots: Channel['postingTimes']) {
  const onDone = jest.fn();
  render(
    <TooltipProvider>
      <PostingTimesDialog channel={channel(slots)} onOpenChange={jest.fn()} onDone={onDone} />
    </TooltipProvider>,
  );
  return { onDone };
}

describe('Manage Posting Time Slots', () => {
  it('turns weekdays off, keeps the last one on, adds a time, and saves the slots', async () => {
    apiMock.mockResolvedValue({} as never);
    const { onDone } = renderDialog([{ time: 540, windowMinutes: 0, days: ALL }]);

    expect(screen.getByRole('heading', { name: 'Manage Posting Time Slots' })).toBeTruthy();
    const row = screen.getAllByTestId('posting-slot')[0] as HTMLElement;
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) {
      fireEvent.click(within(row).getByRole('button', { name: day }));
    }
    const sunday = within(row).getByRole('button', { name: 'Sunday' });
    fireEvent.click(sunday);
    expect(sunday.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /Add Another Time/ }));
    expect(screen.getAllByTestId('posting-slot')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Save Times' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith('/channels/ch-1', {
      method: 'PATCH',
      body: {
        postingTimes: [
          { time: 540, windowMinutes: 0, days: [7] },
          { time: 600, windowMinutes: 0, days: ALL },
        ],
      },
    });
  });

  it('Shuffle Times previews a week and Use These Times fills the rows', async () => {
    renderDialog([{ time: 540, windowMinutes: 0, days: ALL }]);

    fireEvent.click(screen.getByRole('button', { name: /Shuffle Times/ }));
    expect(await screen.findByRole('heading', { name: 'Shuffle Times' })).toBeTruthy();
    expect(screen.getByTestId('shuffle-per-week').textContent).toBe('21 a week');
    const preview = screen.getByRole('list', { name: 'Suggested times' });
    expect(within(preview).getAllByRole('listitem')).toHaveLength(3);
    expect(preview.textContent).toContain('around');
    expect(preview.textContent).toContain('Every day');

    fireEvent.click(screen.getByRole('button', { name: 'Use These Times' }));
    expect(await screen.findByRole('heading', { name: 'Manage Posting Time Slots' })).toBeTruthy();
    expect(screen.getAllByTestId('posting-slot')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Back To Suggested Times' })).toBeTruthy();
  });
});
