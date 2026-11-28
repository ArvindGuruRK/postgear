/**
 * The editor's Schedule element (Sprint 13, Module 14 section C4): the seven
 * rows, Off, the clock, and Refresh From Twitch, which asks before it
 * replaces anything. The API is mocked: nothing is fetched.
 */
import {
  applySchedule,
  type DesignDocument,
  documentFromPreset,
  findLayout,
  type ScheduleRow,
  type ScheduleSource,
  scheduleRowsOf,
} from '@postgear/design-engine';
import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { api } from '@/lib/api';
import type { ScheduleAnswer } from '@/types/studio-schedules';
import { ScheduleField } from './schedule-field';
import { NO_SCHEDULE_NOTE, REPLACE_EDITS_QUESTION } from './schedule-field-model';

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: jest.fn() };
});

const WEEK: ScheduleRow[] = [
  { day: 'Mon', time: '7 PM', title: 'Minecraft' },
  { day: 'Tue', time: '', title: '', off: true },
  { day: 'Wed', time: '8 PM', title: 'Just Chatting' },
  { day: 'Thu', time: '', title: '', off: true },
  { day: 'Fri', time: '7 PM', title: 'Chat' },
  { day: 'Sat', time: '3 PM', title: 'Variety' },
  { day: 'Sun', time: '', title: '', off: true },
];

function twitch(overrides: Partial<ScheduleSource> = {}): ScheduleSource {
  return {
    source: 'twitch',
    login: 'simstreamer',
    timeZone: 'Asia/Kolkata',
    weekStart: '2026-11-23',
    fetchedAt: '2026-11-26T10:00:00.000Z',
    hour12: true,
    ...overrides,
  };
}

/** The field over a live document, so every change lands the way the editor applies it. */
function mount(source: ScheduleSource, rows: ScheduleRow[] = WEEK) {
  let document: DesignDocument = applySchedule(
    documentFromPreset({ presetId: 'schedule-week-cool', format: 'portrait' }),
    { source, rows },
  );
  const slide = () => document.slides[0];
  const slot = findLayout(document.slides[0].layoutId)?.slots.find(
    (entry) => entry.kind === 'rows',
  );
  if (!slot) throw new Error('No schedule slot.');

  const view = () => (
    <TooltipProvider>
      <ScheduleField document={document} slide={slide()} slot={slot} onChange={onChange} />
    </TooltipProvider>
  );
  const onChange = jest.fn((change: (latest: DesignDocument) => DesignDocument) => {
    document = change(document);
    utils.rerender(view());
  });
  const utils = render(view());
  return { onChange, current: () => document };
}

beforeAll(() => stubBrowserLayout());
beforeEach(() => jest.mocked(api).mockReset());

describe('the Schedule element', () => {
  it('shows seven days, and a typed title lands on the design', () => {
    const { current } = mount(twitch());
    expect(screen.getAllByRole('listitem')).toHaveLength(7);

    fireEvent.change(screen.getByLabelText('Monday stream'), {
      target: { value: 'Minecraft Hardcore' },
    });
    expect(scheduleRowsOf(current())?.[0].title).toBe('Minecraft Hardcore');
  });

  it('names each Off box with its day (Module 16)', () => {
    mount(twitch());
    expect(screen.getByRole('checkbox', { name: 'Monday off' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Sunday off' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Off' })).toBeNull();
  });

  it('turns a day off and on with its words kept', () => {
    const { current } = mount(twitch());
    const box = screen.getAllByRole('checkbox')[0];
    fireEvent.click(box);
    expect(scheduleRowsOf(current())?.[0]).toMatchObject({ off: true, title: 'Minecraft' });
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(scheduleRowsOf(current())?.[0]).toEqual(WEEK[0]);
  });

  it('switches to a 24 hour clock over the rows', () => {
    const { current } = mount(twitch());
    fireEvent.click(screen.getByRole('button', { name: '24 Hour' }));
    expect(current().schedule?.hour12).toBe(false);
    expect(scheduleRowsOf(current())?.[0].time).toBe('19:00');
  });

  it('offers Refresh From Twitch only for a week read from Twitch', () => {
    mount(twitch({ source: 'manual', login: null, fetchedAt: null }));
    expect(screen.queryByRole('button', { name: 'Refresh From Twitch' })).toBeNull();
  });

  it('asks before Refresh From Twitch replaces the rows, then replaces them', async () => {
    const answer: ScheduleAnswer = {
      broadcaster: { login: 'simstreamer', displayName: 'SimStreamer' },
      segments: [],
      vacation: null,
      fetchedAt: '2026-11-26T11:00:00.000Z',
      weekStart: '2026-11-23',
      noSchedule: true,
    };
    jest.mocked(api).mockResolvedValue(answer);
    jest.useFakeTimers({
      now: Date.parse('2026-11-26T12:00:00Z'),
      doNotFake: [
        'setTimeout',
        'setInterval',
        'setImmediate',
        'nextTick',
        'queueMicrotask',
        'requestAnimationFrame',
      ],
    });
    try {
      const { current } = mount(twitch());

      fireEvent.click(screen.getByRole('button', { name: 'Refresh From Twitch' }));
      expect(await screen.findByText(REPLACE_EDITS_QUESTION)).toBeInTheDocument();
      expect(api).not.toHaveBeenCalled();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
      });
      await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
      expect(jest.mocked(api).mock.calls[0]).toEqual([
        '/studio/schedules/fetch',
        expect.objectContaining({
          method: 'POST',
          body: { login: 'simstreamer', timeZone: 'Asia/Kolkata', weekStart: '2026-11-23' },
        }),
      ]);
      await waitFor(() =>
        expect(scheduleRowsOf(current())?.every((row) => row.off === true)).toBe(true),
      );
      expect(await screen.findByText(NO_SCHEDULE_NOTE)).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps the rows when the question is answered Keep My Edits', async () => {
    const { current } = mount(twitch());
    fireEvent.click(screen.getByRole('button', { name: 'Refresh From Twitch' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep My Edits' }));
    expect(api).not.toHaveBeenCalled();
    expect(scheduleRowsOf(current())).toEqual(WEEK);
  });
});
