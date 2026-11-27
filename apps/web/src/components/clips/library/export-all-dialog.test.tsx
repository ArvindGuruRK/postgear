import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import type { ClipJobEvent, ClipJobView, ClipListItem } from '@/types/clips';
import type { ClipExportBatchView } from '@/types/clips-batch';
import { fixtureClipItem } from './clip-list-fixtures';
import { useExportAll } from './use-export-all';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
jest.mock('@/components/navigation/workspace-provider', () => ({
  useWorkspace: () => ({ activeOrgId: 'org-1' }),
}));
const mockPlan: { values: Record<string, unknown> | null } = { values: null };
jest.mock('@/lib/entitlements', () => ({
  useEntitlements: () => ({
    snapshot: mockPlan.values ? { values: mockPlan.values } : null,
    status: 'ready',
    refresh: jest.fn(),
  }),
}));
jest.mock('@/lib/clips-bulk-api', () => ({
  startExportBatch: jest.fn(),
  getExportBatch: jest.fn(),
  listOpenExportBatches: jest.fn(),
  exportBatchEventsPath: (batchId: string) => `/clips/exports/batches/${batchId}/events`,
}));
jest.mock('@/lib/clips-recipes-api', () => ({ listRecipes: jest.fn() }));
jest.mock('@/lib/sse', () => ({ streamGetEvents: jest.fn() }));

const api = jest.requireMock('@/lib/clips-bulk-api') as {
  startExportBatch: jest.Mock;
  getExportBatch: jest.Mock;
  listOpenExportBatches: jest.Mock;
};
const { listRecipes } = jest.requireMock('@/lib/clips-recipes-api') as { listRecipes: jest.Mock };
const { streamGetEvents } = jest.requireMock('@/lib/sse') as { streamGetEvents: jest.Mock };

beforeAll(() => {
  stubBrowserLayout();
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
});

/** The batch stream's listener, to push events as the server would. */
let pushEvent: ((event: ClipJobEvent) => void) | null = null;

beforeEach(() => {
  api.startExportBatch.mockReset();
  api.getExportBatch.mockReset();
  api.listOpenExportBatches.mockReset();
  listRecipes.mockReset();
  streamGetEvents.mockReset();
  mockPlan.values = { 'clips.export_max_quality': '1080p' };
  pushEvent = null;
  api.listOpenExportBatches.mockResolvedValue([]);
  streamGetEvents.mockImplementation(
    (_path: string, options: { onEvent: (event: ClipJobEvent) => void }) => {
      pushEvent = options.onEvent;
      return new Promise(() => undefined);
    },
  );
});

const A = fixtureClipItem({ id: 'clip-a', title: 'Team Talk' });
const B = fixtureClipItem({ id: 'clip-b', title: 'Big Play' });
const C = fixtureClipItem({ id: 'clip-c', title: 'The Save' });

function job(id: string, overrides: Partial<ClipJobView> = {}): ClipJobView {
  return {
    id,
    kind: 'RENDER' as ClipJobView['kind'],
    status: 'RUNNING',
    stage: 'render',
    stageLabel: 'Exporting',
    progress: 10,
    etaSeconds: null,
    videoId: null,
    clipId: null,
    error: null,
    result: null,
    createdAt: '2026-11-27T10:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

function Harness({ clips }: { clips: ClipListItem[] }) {
  const exportAll = useExportAll({ orgId: 'org-1' });
  return (
    <TooltipProvider>
      <div data-testid="actions">{exportAll.chip}</div>
      <button type="button" onClick={() => exportAll.start(clips)}>
        Open Export All
      </button>
      {exportAll.dialog}
    </TooltipProvider>
  );
}

async function openDialog(clips: ClipListItem[] = [A, B, C]) {
  render(<Harness clips={clips} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Open Export All' }));
  });
  return screen.getByTestId('clips-export-all-dialog');
}

const BATCH: ClipExportBatchView = {
  batchId: 'batch-1',
  total: 3,
  done: 1,
  failed: 0,
  finished: false,
  jobs: [
    {
      clipId: 'clip-a',
      clipTitle: 'Team Talk',
      jobId: 'job-a',
      note: 'lowered',
      quality: '720p',
      job: job('job-a', { progress: 30 }),
    },
    {
      clipId: 'clip-b',
      clipTitle: 'Big Play',
      jobId: null,
      note: 'current',
      quality: '1080p',
      job: null,
    },
    {
      clipId: 'clip-c',
      clipTitle: 'The Save',
      jobId: 'job-c',
      note: 'running',
      quality: '1080p',
      job: job('job-c', { status: 'QUEUED', progress: 0, stageLabel: 'Waiting for its turn' }),
    },
  ],
};

describe('Export All', () => {
  it('shows the quality tiles, the plan lock, and the clips', async () => {
    const dialog = await openDialog();
    expect(within(dialog).getByRole('button', { name: /^1080p Sharper picture/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      within(dialog).getByRole('button', { name: '1080p 60 fps, locked' }),
    ).toBeInTheDocument();
    const clips = within(dialog).getByTestId('clips-export-all-clips');
    expect(within(clips).getAllByRole('listitem')).toHaveLength(3);
    expect(within(clips).getByText('Big Play')).toBeInTheDocument();
  });

  it('preselects the quality of a recipe every clip shares', async () => {
    listRecipes.mockResolvedValue({
      recipes: [{ id: 'rec-1', settings: { exportQuality: '720p60' } }],
      own: 1,
      max: 50,
    });
    const dialog = await openDialog([
      fixtureClipItem({ id: 'clip-a', title: 'Team Talk', recipeId: 'rec-1' }),
      fixtureClipItem({ id: 'clip-b', title: 'Big Play', recipeId: 'rec-1' }),
    ]);
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: /^720p 60 fps / })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
  });

  it('starts the batch, then lists each clip with its note and progress, live', async () => {
    api.startExportBatch.mockResolvedValue({
      batchId: 'batch-1',
      jobs: [
        { clipId: 'clip-a', jobId: 'job-a', quality: '720p', note: 'lowered' },
        { clipId: 'clip-b', jobId: null, quality: '1080p', note: 'current' },
        { clipId: 'clip-c', jobId: 'job-c', quality: '1080p', note: 'running' },
      ],
    });
    api.getExportBatch.mockResolvedValue(BATCH);
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: /^720p Smaller file/ }));
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId('clips-export-all-start'));
    });
    expect(api.startExportBatch).toHaveBeenCalledWith(['clip-a', 'clip-b', 'clip-c'], '720p');

    const list = await within(dialog).findByTestId('clips-export-all-list');
    const rows = within(list).getAllByTestId('clips-export-all-row');
    expect(rows).toHaveLength(3);
    expect(
      within(rows[0] as HTMLElement).getByText('Exports at 720p, the best this plan allows.'),
    ).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getByText('Already exported, so it is left as it is.'),
    ).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('Already exporting.')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('Waiting for its turn')).toBeInTheDocument();
    await waitFor(() => expect(rows[0]?.querySelector('[role="progressbar"]')).not.toBeNull());
    expect(within(dialog).getByTestId('clips-export-all-counts')).toHaveTextContent('1 of 3 done');

    // The stream: one clip fails, the other finishes; the failure does not stop the rest.
    await waitFor(() => expect(pushEvent).not.toBeNull());
    act(() => {
      pushEvent?.({ type: 'failed', ...job('job-a', { status: 'FAILED' }) });
      pushEvent?.({ type: 'done', ...job('job-c', { status: 'DONE', progress: 100 }) });
    });
    expect(within(dialog).getByTestId('clips-export-all-counts')).toHaveTextContent(
      '2 of 3 done, 1 could not be exported',
    );
    expect(within(dialog).getByText('This clip could not be exported.')).toBeInTheDocument();
    expect(within(dialog).getByText('Done')).toBeInTheDocument();
  });

  it('shows the chip once a batch runs, and opens the list again from it', async () => {
    api.startExportBatch.mockResolvedValue({
      batchId: 'batch-1',
      jobs: BATCH.jobs.map(({ clipId, jobId, quality, note }) => ({
        clipId,
        jobId,
        quality,
        note,
      })),
    });
    api.getExportBatch.mockResolvedValue(BATCH);
    const dialog = await openDialog();
    // The server lists the batch as running once it exists.
    api.listOpenExportBatches.mockResolvedValue([
      { batchId: 'batch-1', total: 3, done: 1, failed: 0 },
    ]);
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId('clips-export-all-start'));
    });
    const chip = await screen.findByTestId('clips-export-all-chip');
    expect(chip).toHaveTextContent('Exporting 3 Clips');
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' })[0] as HTMLElement);
    await waitFor(() => expect(screen.queryByTestId('clips-export-all-dialog')).toBeNull());
    await act(async () => {
      fireEvent.click(chip);
    });
    expect(await screen.findByTestId('clips-export-all-list')).toBeInTheDocument();
  });

  it('brings the chip back after a reload', async () => {
    api.listOpenExportBatches.mockResolvedValue([
      { batchId: 'batch-1', total: 8, done: 2, failed: 0 },
    ]);
    api.getExportBatch.mockResolvedValue(BATCH);
    render(<Harness clips={[]} />);
    const chip = await screen.findByTestId('clips-export-all-chip');
    expect(chip).toHaveTextContent('Exporting 8 Clips');
    await act(async () => {
      fireEvent.click(chip);
    });
    expect(api.getExportBatch).toHaveBeenCalledWith('batch-1', expect.anything());
    expect(await screen.findByTestId('clips-export-all-list')).toBeInTheDocument();
  });

  it("shows the server's sentence when the batch is refused", async () => {
    const { ApiError } = jest.requireActual('@/lib/api') as typeof import('@/lib/api');
    api.startExportBatch.mockRejectedValue(new ApiError('Export up to 30 clips at once.', 422));
    const dialog = await openDialog();
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId('clips-export-all-start'));
    });
    expect(within(dialog).getByTestId('clips-export-all-problem')).toHaveTextContent(
      'Export up to 30 clips at once.',
    );
  });
});
