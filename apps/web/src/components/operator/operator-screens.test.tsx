/**
 * The operator screens in jsdom (Sprint 12, Module 19 Part B): Review
 * Changes stays disabled until a cell changes, an invalid value says why
 * inline and blocks the review, the review reads "Clips Storage, Pro: 50 GB
 * to 60 GB" and needs a reason, a 409 shows the conflict sentence; Publish
 * Run needs its tick; Remove Item is a red confirm that needs a reason.
 */
import '@testing-library/jest-dom';
import { getDef, KEYS, seedValue, TIERS } from '@postgear/entitlements';
import { TooltipProvider } from '@postgear/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError, api } from '@/lib/api';
import type {
  LibraryItemDetail,
  LibraryRun,
  LibraryRunDetail,
  PlanCell,
  PlansView,
} from '@/types/operator';
import { stubBrowserLayout } from '../workflows/fields/test-dom';
import { LibraryItemDialog } from './library-item-dialog';
import { PublishRunDialog } from './library-runs';
import { OPERATOR_COPY } from './operator-model';
import { PlansTab } from './plans-tab';

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: jest.fn() };
});

const mockedApi = api as jest.MockedFunction<typeof api>;

beforeAll(stubBrowserLayout);
beforeEach(() => mockedApi.mockReset());

function seededPlans(): PlansView {
  const cells: PlanCell[] = TIERS.flatMap((tier) =>
    KEYS.map((key) => ({
      tier,
      key,
      value: seedValue(tier, key),
      seed: seedValue(tier, key),
      updatedAt: '2026-11-01T00:00:00.000Z',
      valid: true,
    })),
  );
  return {
    tiers: [...TIERS],
    keys: KEYS.map((key) => ({
      key,
      label: getDef(key)?.label ?? key,
      group: 'clips',
      description: '',
    })),
    cells,
    endingSoon: [],
  };
}

function renderPlans() {
  return render(
    <TooltipProvider>
      <PlansTab
        plans={seededPlans()}
        onPlansChange={jest.fn()}
        onReload={jest.fn(async () => undefined)}
        onOpenOverride={jest.fn()}
      />
    </TooltipProvider>,
  );
}

function typeInCell(label: string, inputLabel: string, text: string) {
  fireEvent.click(screen.getByRole('button', { name: `Edit ${label}` }));
  const input = screen.getByLabelText(inputLabel);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('Plans', () => {
  it('keeps Review Changes disabled until a cell changes, and shows the banner', () => {
    renderPlans();
    expect(screen.getByText(OPERATOR_COPY.plansBanner)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review Changes' })).toBeDisabled();
  });

  it('says why a value cannot be saved, inline, and blocks the review', () => {
    renderPlans();
    typeInCell('Longest Video, Pro', 'Longest Video in minutes', '1441');
    expect(screen.getByText('Enter a whole number from 1 to 1,440.')).toBeInTheDocument();
    expect(screen.getByText('1 change waiting')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review Changes' })).toBeDisabled();
  });

  it('reviews "Clips Storage, Pro: 50 GB to 60 GB", needs a reason, and shows the conflict sentence on a 409', async () => {
    renderPlans();
    typeInCell('Clips Storage, Pro', 'Clips Storage in GB', '60');
    expect(screen.getByText('1 change waiting')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review Changes' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Clips Storage, Pro: 50 GB to 60 GB')).toBeInTheDocument();

    // Too short a reason sends nothing.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }));
    expect(mockedApi).not.toHaveBeenCalled();
    expect(within(dialog).getByText(OPERATOR_COPY.reasonHelp)).toBeInTheDocument();

    mockedApi.mockRejectedValueOnce(new ApiError(OPERATOR_COPY.conflict, 409, 'operator_conflict'));
    fireEvent.change(within(dialog).getByPlaceholderText('Enter your reason'), {
      target: { value: 'Pro customers asked for more room' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(screen.getByTestId('plans-conflict')).toBeInTheDocument());
    expect(screen.getByTestId('plans-conflict')).toHaveTextContent(OPERATOR_COPY.conflict);
    expect(mockedApi).toHaveBeenCalledWith('/operator/entitlements/plans', {
      method: 'PUT',
      body: {
        cells: [
          {
            tier: 'PRO',
            key: 'clips.storage_gb',
            value: 60,
            updatedAt: '2026-11-01T00:00:00.000Z',
          },
        ],
        reason: 'Pro customers asked for more room',
      },
    });
  });
});

const RUN: LibraryRun = {
  id: '7a1c2a8e-8f43-4c55-9a5c-0e3a7f2d6b11',
  origin: 'openverse',
  type: 'sound',
  startedAt: '2026-11-18T09:00:00.000Z',
  finishedAt: '2026-11-18T09:05:00.000Z',
  accepted: 120,
  rejected: 47,
  rejections: [{ reason: 'licence_not_allowed', count: 41 }],
  counts: { staged: 120, active: 0, hidden: 0, removed: 0 },
  needsReview: true,
  hasReport: true,
};

describe('Publish Run', () => {
  it('asks "Publish 120 items from this run?" and publishes only once the tick is ticked', async () => {
    const detail: LibraryRunDetail = {
      ...RUN,
      args: {},
      reportUrl: null,
      publishable: 120,
      heldBack: [],
    };
    mockedApi.mockResolvedValueOnce(detail);
    const onPublished = jest.fn();
    render(<PublishRunDialog run={RUN} onClose={jest.fn()} onPublished={onPublished} />);

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(
        'Publish 120 items from this run? They become visible to every workspace.',
      ),
    ).toBeInTheDocument();
    const publish = within(dialog).getByRole('button', { name: 'Publish Run' });
    expect(publish).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('checkbox'));
    expect(within(dialog).getByText(OPERATOR_COPY.publishTick)).toBeInTheDocument();
    await waitFor(() => expect(publish).toBeEnabled());

    mockedApi.mockResolvedValueOnce({ published: 120, heldBack: [], run: detail });
    fireEvent.click(publish);
    await waitFor(() => expect(onPublished).toHaveBeenCalled());
    expect(mockedApi).toHaveBeenLastCalledWith(`/operator/library/runs/${RUN.id}/publish`, {
      method: 'POST',
      body: { reviewed: true },
    });
  });
});

describe('Remove Item', () => {
  it('shows how many clips use the item and needs a reason before the red confirm', async () => {
    const item: LibraryItemDetail = {
      id: '0b8f0f3e-3d7a-4b8e-9b1f-6c1f8f0a2d33',
      type: 'sound',
      name: 'Whoosh Fast',
      kind: 'sfx',
      category: 'transitions',
      status: 'ACTIVE',
      licence: 'CC0-1.0',
      author: 'Kenney',
      authorUrl: null,
      sourceUrl: 'https://kenney.example/whoosh',
      origin: 'kenney',
      runId: RUN.id,
      sourceId: 'source-1',
      sourceName: 'Kenney',
      previewUrl: null,
      audioUrl: null,
      durationMs: 1200,
      createdAt: '2026-11-18T09:05:00.000Z',
      statusAt: null,
      statusReason: null,
      tags: ['whoosh'],
      licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      originId: 'whoosh-fast',
      originalWork: true,
      retrievedAt: '2026-11-18T09:01:00.000Z',
      sourceChecksum: 'abc123',
      bytes: 2048,
      width: null,
      height: null,
      statusByEmail: null,
      usage: 3,
      source: { id: 'source-1', name: 'Kenney', requiresCredit: false, creditLine: null },
      publishRefusal: null,
    };
    mockedApi.mockResolvedValueOnce(item);
    const onChanged = jest.fn();
    render(
      <LibraryItemDialog type="sound" itemId={item.id} onClose={jest.fn()} onChanged={onChanged} />,
    );

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('3 clips use this item.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Publish Item' })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Item' }));
    expect(within(dialog).getByText(/adds it to the deny list/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Item' }));
    expect(mockedApi).toHaveBeenCalledTimes(1);

    mockedApi.mockResolvedValueOnce({ ...item, status: 'REMOVED', usage: 3 });
    fireEvent.change(within(dialog).getByPlaceholderText('Enter your reason'), {
      target: { value: 'Takedown request from the author' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Item' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(mockedApi).toHaveBeenLastCalledWith(`/operator/library/items/sound/${item.id}/remove`, {
      method: 'POST',
      body: { reason: 'Takedown request from the author' },
    });
  });
});
