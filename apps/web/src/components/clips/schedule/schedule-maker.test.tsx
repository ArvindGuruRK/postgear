/**
 * The Schedule Maker page (Sprint 13, Module 14 section C4): a Twitch read,
 * Twitch's 404, Try A Sample with no call, and Open In Design Studio. The
 * API and the router are mocked: nothing is fetched.
 */
import { SAMPLE_WEEK } from '@postgear/design-engine';
import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NO_SCHEDULE_NOTE } from '@/components/studio/schedule-field-model';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { api } from '@/lib/api';
import type { ScheduleAnswer } from '@/types/studio-schedules';
import { ScheduleMaker } from './schedule-maker';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/org-1/clips/tools/schedule',
}));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: jest.fn() };
});

const ANSWER: ScheduleAnswer = {
  broadcaster: { login: 'simstreamer', displayName: 'SimStreamer' },
  segments: [],
  vacation: null,
  fetchedAt: '2026-11-26T10:00:00.000Z',
  weekStart: '2026-11-23',
};

function mount() {
  return render(
    <TooltipProvider>
      <ScheduleMaker orgId="org-1" />
    </TooltipProvider>,
  );
}

beforeAll(() => stubBrowserLayout());
beforeEach(() => {
  jest.mocked(api).mockReset();
  push.mockReset();
});

describe('the Schedule Maker', () => {
  it('reads a Twitch name and says when the channel has no schedule', async () => {
    jest.mocked(api).mockResolvedValue({ ...ANSWER, noSchedule: true });
    mount();

    const read = screen.getByRole('button', { name: 'Read Schedule' });
    expect(read).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Twitch name'), {
      target: { value: 'https://twitch.tv/SimNoSchedule' },
    });
    const enabled = screen.getByRole('button', { name: 'Read Schedule' });
    expect(enabled).toBeEnabled();
    await act(async () => {
      fireEvent.submit(enabled.closest('form') as HTMLFormElement);
    });

    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(jest.mocked(api).mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: { login: 'simnoschedule' },
    });
    expect(await screen.findByText(NO_SCHEDULE_NOTE)).toBeInTheDocument();
  });

  it('says a name cannot be a Twitch name before any call', () => {
    mount();
    fireEvent.change(screen.getByLabelText('Twitch name'), { target: { value: 'no' } });
    expect(screen.getByText(/4 to 25 letters/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read Schedule' })).toBeDisabled();
    expect(api).not.toHaveBeenCalled();
  });

  it('fills the by-hand rows with the sample, with no call, and opens the design', async () => {
    jest.mocked(api).mockResolvedValue({ design: { id: 'design-9' } });
    mount();

    await act(async () => {
      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Fill It In By Hand' }));
      fireEvent.click(screen.getByRole('tab', { name: 'Fill It In By Hand' }));
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Try A Sample' }));
    expect(screen.getByLabelText('Monday stream')).toHaveValue('Minecraft Hardcore');
    expect(api).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open In Design Studio' }));
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/org-1/studio/design-9'));
    const [path, options] = jest.mocked(api).mock.calls[0] as [string, { body: unknown }];
    expect(path).toBe('/studio/designs');
    expect(options.body).toMatchObject({
      presetId: 'schedule-week-clean-blue',
      format: 'portrait',
      schedule: { source: { source: 'manual', login: null }, rows: SAMPLE_WEEK },
    });
  });
});
