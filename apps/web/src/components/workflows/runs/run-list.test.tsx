import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { listRuns } from '@/lib/workflows-api';
import { RunList } from './run-list';
import { NO_MATCHING_RUNS, NO_RUNS } from './run-list-model';
import { makeRun } from './run-test-fixtures';

jest.mock('@/lib/workflows-api', () => ({ listRuns: jest.fn() }));
// jsdom spends minutes matching selectors while a real menu closes; plain buttons test the same.
jest.mock('@postgear/ui', () => {
  const { Children, cloneElement, createElement } =
    jest.requireActual<typeof import('react')>('react');
  type Props = { children?: React.ReactNode; onValueChange?: (value: string) => void };
  const pass = ({ children }: Props) => children;
  return {
    ...jest.requireActual('@postgear/ui'),
    DropdownMenu: pass,
    DropdownMenuTrigger: pass,
    DropdownMenuContent: pass,
    DropdownMenuRadioGroup: ({ children, onValueChange }: Props) =>
      Children.map(children as React.ReactElement<Props>[], (child) =>
        cloneElement(child, { onValueChange }),
      ),
    DropdownMenuRadioItem: ({
      children,
      value,
      onValueChange,
    }: Props & { value: string }) =>
      createElement(
        'button',
        { type: 'button', role: 'menuitemradio', onClick: () => onValueChange?.(value) },
        children,
      ),
  };
});

const list = listRuns as jest.MockedFunction<typeof listRuns>;

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList;
  // A focused button plays its animated icon; the icon stub is a bare <svg> without the handle.
  Object.assign(SVGElement.prototype, { startAnimation() {}, stopAnimation() {} });
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
    const choose = (name: string) =>
      fireEvent.click(screen.getByRole('menuitemradio', { name }));
    choose('Failed');
    await waitFor(() => expect(list).toHaveBeenLastCalledWith('wf-1', { status: 'FAILED' }));
    expect(await screen.findByText(NO_MATCHING_RUNS)).toBeTruthy();
    expect(screen.getByTestId('run-filter').getAttribute('aria-label')).toBe(
      'Filter runs: Failed',
    );

    choose('Test');
    await waitFor(() => expect(list).toHaveBeenLastCalledWith('wf-1', { mode: 'TEST' }));
  });

  it('refreshes by itself while one page is loaded, until Auto refresh is off', async () => {
    jest.useFakeTimers();
    try {
      list.mockResolvedValue({ runs: [makeRun()], nextCursor: null });
      renderList();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });
      const before = list.mock.calls.length;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(5_000);
      });
      expect(list.mock.calls.length).toBe(before + 1);

      fireEvent.click(screen.getByRole('checkbox', { name: 'Auto refresh' }));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(20_000);
      });
      expect(list.mock.calls.length).toBe(before + 1);
    } finally {
      jest.useRealTimers();
    }
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
