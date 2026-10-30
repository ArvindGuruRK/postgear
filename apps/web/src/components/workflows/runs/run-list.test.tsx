import { TooltipProvider } from '@postgear/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { listRuns } from '@/lib/workflows-api';
import { RunList } from './run-list';
import { NO_MATCHING_RUNS, NO_RUNS } from './run-list-model';
import { makeRun } from './run-test-fixtures';

jest.mock('@/lib/workflows-api', () => ({ listRuns: jest.fn() }));

const list = listRuns as jest.MockedFunction<typeof listRuns>;

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList;
});

beforeEach(() => list.mockReset());

function renderList(props: Partial<Parameters<typeof RunList>[0]> = {}) {
  const onSelect = jest.fn();
  render(
    <TooltipProvider>
      <RunList
        automationId="wf-1"
        catalog={null}
        selectedId={null}
        onSelect={onSelect}
        reloadKey={0}
        patch={null}
        {...props}
      />
    </TooltipProvider>,
  );
  return { onSelect };
}

describe('RunList', () => {
  it('shows each run with its status, mode, trigger, version and credits', async () => {
    list.mockResolvedValue({
      runs: [
        makeRun({ id: 'live', creditsUsed: 2 }),
        makeRun({
          id: 'test',
          mode: 'TEST',
          status: 'REJECTED',
          version: null,
          triggerSummary: null,
          triggerType: 'trigger.manual',
        }),
      ],
      nextCursor: null,
    });
    const { onSelect } = renderList({ selectedId: 'test' });

    const rows = await screen.findAllByTestId('run-row');
    expect(rows).toHaveLength(2);
    const [live, test] = rows;
    expect(within(live).getByText('Succeeded')).toBeTruthy();
    expect(within(live).getByText('Live')).toBeTruthy();
    expect(within(live).getByText('Post published on Instagram')).toBeTruthy();
    expect(within(live).getByText('v3')).toBeTruthy();
    expect(within(live).getByText('2 Credits')).toBeTruthy();
    expect(within(live).getByText('3.1 s')).toBeTruthy();
    expect(live.querySelector('time')?.getAttribute('title')).toBeTruthy();

    expect(within(test).getByText('Test')).toBeTruthy();
    expect(within(test).getByText('Manual')).toBeTruthy();
    expect(within(test).queryByText(/^v\d/)).toBeNull();
    expect(within(test).getByText('Rejected').className).not.toMatch(/actionDanger/);
    expect(test.getAttribute('aria-current')).toBe('true');

    fireEvent.click(live);
    expect(onSelect).toHaveBeenCalledWith('live');
  });

  it('asks the API again with each filter', async () => {
    list.mockResolvedValue({ runs: [makeRun()], nextCursor: null });
    renderList();
    await screen.findByTestId('run-row');
    expect(list).toHaveBeenLastCalledWith('wf-1', {});

    list.mockResolvedValue({ runs: [], nextCursor: null });
    fireEvent.click(screen.getByRole('button', { name: 'Failed' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith('wf-1', { status: 'FAILED' }));
    expect(await screen.findByText(NO_MATCHING_RUNS)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Failed' }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith('wf-1', { mode: 'TEST' }));
  });

  it('says there are no runs yet, in a sentence', async () => {
    list.mockResolvedValue({ runs: [], nextCursor: null });
    renderList();
    expect(await screen.findByText(NO_RUNS)).toBeTruthy();
  });

  it('loads the next page with the cursor', async () => {
    list.mockResolvedValueOnce({ runs: [makeRun({ id: 'a' })], nextCursor: 'cursor-2' });
    list.mockResolvedValueOnce({ runs: [makeRun({ id: 'b' })], nextCursor: null });
    renderList();
    await screen.findByTestId('run-row');
    fireEvent.click(screen.getByRole('button', { name: 'Load More Runs' }));
    await waitFor(() => expect(screen.getAllByTestId('run-row')).toHaveLength(2));
    expect(list).toHaveBeenLastCalledWith('wf-1', { cursor: 'cursor-2' });
    expect(screen.queryByRole('button', { name: 'Load More Runs' })).toBeNull();
  });

  it('keeps the open run row in step with its live state', async () => {
    list.mockResolvedValue({
      runs: [makeRun({ id: 'a', status: 'RUNNING', finishedAt: null })],
      nextCursor: null,
    });
    renderList({
      patch: {
        id: 'a',
        status: 'FAILED',
        startedAt: '2026-10-29T14:02:00.000Z',
        finishedAt: '2026-10-29T14:02:01.000Z',
      },
    });
    const row = await screen.findByTestId('run-row');
    expect(within(row).getByText('Failed')).toBeTruthy();
  });
});
