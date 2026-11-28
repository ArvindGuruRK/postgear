/**
 * The Costs tab (Sprint 13, Module 15 section 3): it asks for today with To
 * counted (so `to` is the day after), shows the totals, the five tables with
 * Title Case headers and dollar amounts down to a fraction of a cent, the
 * person of each ledger row, the missing and estimated notes, and a failed
 * load with a retry. The pure helpers are pinned too.
 */
import '@testing-library/jest-dom';
import { TooltipProvider } from '@postgear/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError, api } from '@/lib/api';
import type { CostsView } from '@/types/operator';
import { stubBrowserLayout } from '../workflows/fields/test-dom';
import { CostsTab } from './costs-tab';
import {
  costsMissingSentence,
  costsQuery,
  costsRangeProblem,
  costsTotalSentence,
  jobKindName,
  lastCostsDay,
  OPERATOR_COPY,
  usd,
} from './operator-model';

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: jest.fn() };
});

const mockedApi = api as jest.MockedFunction<typeof api>;

beforeAll(stubBrowserLayout);
beforeEach(() => mockedApi.mockReset());

const AI = 'clips.ai_minutes_per_month';

function view(): CostsView {
  return {
    from: '2026-11-28T00:00:00.000Z',
    to: '2026-11-29T00:00:00.000Z',
    prices: '2026-11-14',
    totals: { jobs: 11, costed: 10, missing: 1, estimated: 2, cents: 5.8933 },
    byKind: [
      { kind: 'TRANSCRIBE', jobs: 4, costed: 4, estimated: 1, cents: 2.5 },
      { kind: 'RENDER', jobs: 4, costed: 4, estimated: 0, cents: 0.1733 },
    ],
    byWorkspace: [
      { organizationId: 'org-a', workspace: 'Acme Media', jobs: 5, costed: 4, cents: 3.5001 },
      { organizationId: 'org-gone', workspace: null, jobs: 1, costed: 1, cents: 0.0017 },
    ],
    byMeter: [
      {
        meter: AI,
        label: 'AI Minutes',
        kinds: ['HIGHLIGHTS', 'TRANSCRIBE'],
        cents: 4,
        charged: 19,
        reversed: 2,
        adjusted: -1,
        net: 16,
        centsPerUnit: 0.25,
      },
    ],
    usageByWorkspace: [
      {
        meter: AI,
        label: 'AI Minutes',
        organizationId: 'org-a',
        workspace: 'Acme Media',
        charged: 15,
        reversed: 2,
        adjusted: -1,
        net: 12,
      },
    ],
    usageByPerson: [
      {
        userId: 'asha',
        person: 'Asha Rao',
        organizationId: 'org-a',
        workspace: 'Acme Media',
        meter: AI,
        label: 'AI Minutes',
        charged: 12,
        reversed: 2,
        adjusted: 0,
        net: 10,
      },
      {
        userId: null,
        person: null,
        organizationId: 'org-a',
        workspace: 'Acme Media',
        meter: AI,
        label: 'AI Minutes',
        charged: 3,
        reversed: 0,
        adjusted: 0,
        net: 3,
      },
    ],
  };
}

function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function renderTab() {
  return render(
    <TooltipProvider>
      <CostsTab />
    </TooltipProvider>,
  );
}

function section(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

describe('CostsTab', () => {
  it('asks for today, To counted, and shows the totals and notes', async () => {
    mockedApi.mockResolvedValueOnce(view());
    renderTab();

    expect(mockedApi).toHaveBeenCalledWith(`/operator/clips/costs?${costsQuery(today(), today())}`);
    expect(await screen.findByTestId('costs-total')).toHaveTextContent(
      '11 jobs finished, costing $0.058933.',
    );
    expect(screen.getByText('1 job has no cost yet. The maintenance pass adds it.')).toBeVisible();
    expect(screen.getByText(OPERATOR_COPY.costsEstimated)).toBeVisible();
    expect(screen.getByText(OPERATOR_COPY.costsHelp)).toBeVisible();
  });

  it('shows the five tables with Title Case headers and the amounts', async () => {
    mockedApi.mockResolvedValueOnce(view());
    renderTab();
    await screen.findByTestId('costs-total');

    for (const heading of [
      'Cost By Job Kind',
      'Cost Against Meters',
      'Cost By Workspace',
      'Usage By Workspace',
      'Usage By Person',
    ]) {
      expect(screen.getByRole('heading', { name: heading })).toBeVisible();
    }

    const kinds = section('Cost by job kind');
    for (const header of ['Job Kind', 'Jobs', 'Costed', 'Estimated', 'Cost']) {
      expect(within(kinds).getByRole('columnheader', { name: header })).toBeVisible();
    }
    expect(within(kinds).getByText('Listen')).toBeVisible();
    expect(within(kinds).getByText('$0.025')).toBeVisible();
    expect(within(kinds).getByText('Export')).toBeVisible();
    expect(within(kinds).getByText('$0.001733')).toBeVisible();

    const meters = section('Cost against meters');
    for (const header of [
      'Meter',
      'Paid For',
      'Charged',
      'Reversed',
      'Adjusted',
      'Net',
      'Cost Per Unit',
    ]) {
      expect(within(meters).getByRole('columnheader', { name: header })).toBeVisible();
    }
    expect(within(meters).getByText('Find Clips, Listen')).toBeVisible();
    expect(within(meters).getByText('$0.0025')).toBeVisible();

    const workspaces = section('Cost by workspace');
    expect(within(workspaces).getByText('Acme Media')).toBeVisible();
    // A workspace with no name left shows its id.
    expect(within(workspaces).getByText('org-gone')).toBeVisible();

    const people = section('Usage by person');
    expect(within(people).getByText('Asha Rao')).toBeVisible();
    expect(within(people).getByText('Not Recorded')).toBeVisible();
  });

  it('says so when nothing finished in the days', async () => {
    mockedApi.mockResolvedValueOnce({
      ...view(),
      totals: { jobs: 0, costed: 0, missing: 0, estimated: 0, cents: 0 },
      byKind: [],
      byWorkspace: [],
      usageByWorkspace: [],
      usageByPerson: [],
    });
    renderTab();
    expect(await screen.findByTestId('costs-total')).toHaveTextContent(
      '0 jobs finished, costing $0.',
    );
    expect(within(section('Cost by job kind')).getByText(OPERATOR_COPY.noCosts)).toBeVisible();
    expect(screen.queryByText(OPERATOR_COPY.costsEstimated)).not.toBeInTheDocument();
  });

  it('shows a failed load with a retry that asks again', async () => {
    mockedApi.mockRejectedValueOnce(new ApiError('You do not have permission to do that.', 403));
    renderTab();
    expect(await screen.findByText('You do not have permission to do that.')).toBeVisible();

    mockedApi.mockResolvedValueOnce(view());
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('costs-total')).toBeVisible();
  });
});

describe('the Costs helpers', () => {
  it('prints dollars, keeping fractions of a cent', () => {
    expect(usd(0)).toBe('$0');
    expect(usd(Number.NaN)).toBe('$0');
    expect(usd(0.1733)).toBe('$0.001733');
    expect(usd(50)).toBe('$0.50');
    expect(usd(123)).toBe('$1.23');
    expect(usd(120_450)).toBe('$1,204.50');
    expect(usd(-25)).toBe('-$0.25');
  });

  it('sends To as the day after, both days counted', () => {
    expect(costsQuery(new Date(2026, 10, 1), new Date(2026, 10, 30))).toBe(
      'from=2026-11-01&to=2026-12-01',
    );
    expect(costsQuery(new Date(2026, 11, 31), new Date(2026, 11, 31))).toBe(
      'from=2026-12-31&to=2027-01-01',
    );
  });

  it('allows 92 days counted, and refuses 93 or a To before From', () => {
    const from = new Date(2026, 8, 1);
    expect(lastCostsDay(from)).toEqual(new Date(2026, 11, 1));
    expect(costsRangeProblem(from, new Date(2026, 11, 1))).toBeNull();
    expect(costsRangeProblem(from, new Date(2026, 11, 2))).toBe('Pick at most 92 days.');
    expect(costsRangeProblem(from, new Date(2026, 7, 31))).toBe(OPERATOR_COPY.costsToBeforeFrom);
    expect(costsRangeProblem(from, from)).toBeNull();
  });

  it('names each job kind, and leaves an unknown one as it came', () => {
    expect(jobKindName('HIGHLIGHTS')).toBe('Find Clips');
    expect(jobKindName('AUTO_EDIT')).toBe('Auto-Edit Video');
    expect(jobKindName('constructor')).toBe('constructor');
  });

  it('writes the sentences', () => {
    expect(costsTotalSentence(1, 0.5)).toBe('1 job finished, costing $0.005.');
    expect(costsMissingSentence(3)).toBe('3 jobs have no cost yet. The maintenance pass adds it.');
  });
});
