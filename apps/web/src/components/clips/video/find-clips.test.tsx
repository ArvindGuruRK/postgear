import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { ApiError } from '@/lib/api';
import { cancelClipJob, startHighlights } from '@/lib/clips-api';
import type { ClipJobView, ClipSummary, HighlightRunView, HighlightsView } from '@/types/clips';
import { fixtureClipSummary } from '../library/clip-list-fixtures';
import { FindClips } from './find-clips';
import { AI_NOTE, HIGHLIGHTS_FAILED, NO_SOUND_NOTE, NOTHING_FOUND_NOTE } from './find-clips-model';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
jest.mock('@/lib/clips-api', () => ({
  startHighlights: jest.fn(),
  cancelClipJob: jest.fn(),
}));
const mockPlan: { meter: Record<string, unknown> | null; refresh: jest.Mock } = {
  meter: null,
  refresh: jest.fn(async () => undefined),
};
jest.mock('@/lib/entitlements', () => ({
  meterOf: () => mockPlan.meter,
  useEntitlements: () => ({ snapshot: {}, status: 'ready', refresh: mockPlan.refresh }),
}));
const mockJobs = new Map<string, unknown>();
const mockRefresh = jest.fn();
jest.mock('../use-clip-job', () => ({
  useClipJob: (id: string | null) => ({
    job: id ? (mockJobs.get(id) ?? null) : null,
    error: null,
    refresh: mockRefresh,
  }),
}));

const start = startHighlights as jest.MockedFunction<typeof startHighlights>;
const cancel = cancelClipJob as jest.MockedFunction<typeof cancelClipJob>;
const VIDEO = '11111111-1111-4111-8111-111111111111';

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});

beforeEach(() => {
  mockJobs.clear();
  mockPlan.meter = { limit: 300, remaining: 120, cycleEnd: '2026-12-01T00:00:00.000Z', used: 180 };
  mockPlan.refresh.mockClear();
  mockRefresh.mockClear();
  start.mockReset();
  cancel.mockReset();
});

function job(
  id: string,
  status: ClipJobView['status'],
  extra: Partial<ClipJobView> = {},
): ClipJobView {
  return {
    id,
    kind: 'HIGHLIGHTS',
    status,
    stage: status === 'RUNNING' ? 'scenes' : null,
    stageLabel:
      status === 'RUNNING' ? 'Looking for scene changes' : status === 'DONE' ? 'Done' : 'Failed',
    progress: status === 'DONE' ? 100 : 45,
    etaSeconds: null,
    videoId: VIDEO,
    clipId: null,
    error: null,
    result: null,
    createdAt: '2026-11-19T10:00:00.000Z',
    startedAt: '2026-11-19T10:00:01.000Z',
    finishedAt: null,
    ...extra,
  };
}

function run(
  status: HighlightRunView['status'],
  extra: Partial<HighlightRunView> = {},
): HighlightRunView {
  return {
    id: 'run-1',
    jobId: 'job-1',
    status,
    found: 4,
    tracks: ['loudness', 'scene'],
    foundBy: status === 'DONE' ? 'Sound and picture' : null,
    aiMinutes: 3,
    refunded: status === 'FAILED' || status === 'CANCELLED',
    createdAt: '2026-11-19T10:00:00.000Z',
    finishedAt: null,
    ...extra,
  };
}

function renderFind(highlights: Partial<HighlightsView> = {}, clips: readonly ClipSummary[] = []) {
  const onSettled = jest.fn();
  const view: HighlightsView = { price: 3, noSound: false, run: null, job: null, ...highlights };
  const utils = render(
    <TooltipProvider>
      <FindClips
        orgId="seed-demo-org"
        videoId={VIDEO}
        highlights={view}
        clips={clips}
        onSettled={onSettled}
      />
    </TooltipProvider>,
  );
  return { onSettled, ...utils };
}

const findButton = () => screen.getByRole('button', { name: /Find Clips \(3 AI Minutes\)/ });

describe('FindClips', () => {
  it('shows the price, the minutes left and the AI note; a first run starts without asking', async () => {
    start.mockResolvedValue({
      run: run('QUEUED'),
      job: job('job-1', 'QUEUED'),
      meter: { used: 183, remaining: 117, limit: 300, cycleEnd: '2026-12-01T00:00:00.000Z' },
    });
    renderFind();
    expect(findButton()).toBeEnabled();
    expect(screen.getByTestId('clips-ai-minutes')).toHaveTextContent('120 of 300 AI minutes left');
    expect(screen.getByText(AI_NOTE)).toBeInTheDocument();

    fireEvent.click(findButton());
    await waitFor(() => expect(start).toHaveBeenCalledWith(VIDEO));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(mockPlan.refresh).toHaveBeenCalled();
    // The job is followed: queued until the worker takes it.
    expect(await screen.findByTestId('find-clips-progress')).toHaveTextContent(
      'Waiting for its turn',
    );
  });

  it('a second run asks first, with the sentence and the price', async () => {
    start.mockResolvedValue({
      run: run('QUEUED'),
      job: job('job-2', 'QUEUED'),
      meter: { used: 183, remaining: 117, limit: 300, cycleEnd: '2026-12-01T00:00:00.000Z' },
    });
    renderFind({ run: run('DONE') }, [fixtureClipSummary({ origin: 'AI_SIGNALS', score: 80 })]);
    fireEvent.click(findButton());
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Find Clips Again')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Find clips again? New clips you have not opened will be replaced. This costs 3 AI minutes.',
      ),
    ).toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Find Clips' }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  });

  it('is off with the sentence and See Plans when the minutes are short', () => {
    mockPlan.meter = { limit: 300, remaining: 2, cycleEnd: '2026-12-01T00:00:00.000Z', used: 298 };
    renderFind();
    expect(findButton()).toBeDisabled();
    const alert = screen.getByTestId('find-clips-blocked');
    expect(alert).toHaveTextContent(
      'This needs 3 AI minutes and you have 2 left. They come back on 1 December, or you can upgrade the plan.',
    );
    expect(within(alert).getByRole('link', { name: 'See Plans' })).toHaveAttribute(
      'href',
      '/seed-demo-org/settings/billing',
    );
  });

  it('says so when none are left', () => {
    mockPlan.meter = { limit: 300, remaining: 0, cycleEnd: '2026-12-01T00:00:00.000Z', used: 300 };
    renderFind();
    expect(screen.getByTestId('find-clips-blocked')).toHaveTextContent(
      'This workspace has used all its AI minutes for this month. They reset on 1 December.',
    );
  });

  it('a running run shows its step in words, and Cancel gives the minutes back', async () => {
    mockJobs.set('job-1', job('job-1', 'RUNNING'));
    cancel.mockResolvedValue(job('job-1', 'CANCELLED'));
    renderFind({ run: run('RUNNING'), job: job('job-1', 'RUNNING') });
    const progress = screen.getByTestId('find-clips-progress');
    expect(progress).toHaveTextContent('Looking for scene changes');
    expect(progress).toHaveTextContent('45%');
    expect(screen.queryByRole('button', { name: /Find Clips/ })).not.toBeInTheDocument();

    fireEvent.click(within(progress).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('job-1'));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('when the run ends the page reads the video and the meter again, once', async () => {
    mockJobs.set('job-1', job('job-1', 'RUNNING'));
    const { onSettled, rerender } = renderFind({
      run: run('RUNNING'),
      job: job('job-1', 'RUNNING'),
    });
    expect(onSettled).not.toHaveBeenCalled();
    mockJobs.set('job-1', job('job-1', 'DONE'));
    await act(async () => {
      rerender(
        <TooltipProvider>
          <FindClips
            orgId="seed-demo-org"
            videoId={VIDEO}
            highlights={{
              price: 3,
              noSound: false,
              run: run('RUNNING'),
              job: job('job-1', 'RUNNING'),
            }}
            clips={[]}
            onSettled={onSettled}
          />
        </TooltipProvider>,
      );
    });
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(mockPlan.refresh).toHaveBeenCalled();
  });

  it('a failed run says the minutes came back, with Try Again', async () => {
    start.mockResolvedValue({
      run: run('QUEUED'),
      job: job('job-3', 'QUEUED'),
      meter: { used: 183, remaining: 117, limit: 300, cycleEnd: '2026-12-01T00:00:00.000Z' },
    });
    renderFind({ run: run('FAILED') });
    const failed = screen.getByTestId('find-clips-failed');
    expect(failed).toHaveTextContent(HIGHLIGHTS_FAILED);
    fireEvent.click(within(failed).getByRole('button', { name: 'Try Again' }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  });

  it('a refusal from the API shows its own sentence', async () => {
    start.mockRejectedValue(
      new ApiError(
        'This needs 3 AI minutes and you have 1 left. They come back on 1 December, or you can upgrade the plan.',
        402,
        'clips_ai_minutes_used',
      ),
    );
    renderFind();
    fireEvent.click(findButton());
    expect(await screen.findByTestId('find-clips-problem')).toHaveTextContent('you have 1 left');
  });

  it('a run already on elsewhere: the page reads the video again', async () => {
    start.mockRejectedValue(
      new ApiError('Find Clips is already running for this video.', 409, 'highlights_running'),
    );
    const { onSettled } = renderFind();
    fireEvent.click(findButton());
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('find-clips-problem')).not.toBeInTheDocument();
  });

  it('notes no sound, and nothing found', () => {
    renderFind({ noSound: true, run: run('DONE', { found: 0, foundBy: null }) });
    expect(screen.getByText(NO_SOUND_NOTE)).toBeInTheDocument();
    expect(screen.getByText(NOTHING_FOUND_NOTE)).toBeInTheDocument();
  });
});
