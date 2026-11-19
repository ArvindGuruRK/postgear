import { TooltipProvider } from '@postgear/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { fixtureStatus } from '../clips-fixtures';
import { AiMinutesChipView, StorageMeter } from './clips-meters';

// The page's chip reads the plan snapshot; these tests draw the view only.
jest.mock('@/lib/entitlements', () => ({ meterOf: () => null, useEntitlements: () => ({}) }));

beforeAll(() => stubBrowserLayout());

const GB = 1_000_000_000;
const CYCLE_END = '2026-12-01T00:00:00.000Z';

function draw(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

const meter = (remaining: number) => ({ limit: 300, remaining, cycleEnd: CYCLE_END });

describe('AiMinutesChipView', () => {
  it('reads how many AI minutes are left, and never mentions credits', () => {
    draw(<AiMinutesChipView meter={meter(240)} orgId="org-1" />);
    const chip = screen.getByTestId('clips-ai-minutes');
    expect(chip).toHaveTextContent('240 of 300 AI minutes left');
    expect(chip).toHaveAttribute('data-tone', 'plenty');
    expect(chip.textContent).not.toMatch(/credit/i);
    expect(screen.queryByRole('link', { name: 'See Plans' })).not.toBeInTheDocument();
  });

  it('turns to the warning under a tenth left', () => {
    draw(<AiMinutesChipView meter={meter(18)} orgId="org-1" />);
    expect(screen.getByTestId('clips-ai-minutes')).toHaveAttribute('data-tone', 'low');
  });

  it('says none are left and offers See Plans', () => {
    draw(<AiMinutesChipView meter={meter(0)} orgId="org-1" />);
    expect(screen.getByTestId('clips-ai-minutes')).toHaveTextContent('No AI minutes left');
    expect(screen.getByRole('link', { name: 'See Plans' })).toHaveAttribute(
      'href',
      '/org-1/settings/billing',
    );
  });

  it('draws nothing before there is a meter', () => {
    draw(<AiMinutesChipView meter={null} orgId="org-1" />);
    expect(screen.queryByTestId('clips-ai-minutes')).not.toBeInTheDocument();
  });
});

describe('StorageMeter', () => {
  const at = (share: number) =>
    fixtureStatus({
      storage: { usedBytes: share * 20 * GB, limitBytes: 20 * GB },
      usage: { storageBytes: share * 20 * GB },
    });

  it('reads the space used against the resolved limit', () => {
    draw(<StorageMeter status={at(0.2)} />);
    const gauge = screen.getByTestId('clips-storage-meter');
    expect(gauge).toHaveTextContent('4 GB of 20 GB');
    expect(gauge).toHaveAttribute('data-percent', '20');
    expect(gauge).not.toHaveAttribute('data-warning');
  });

  it('warns from 80%', () => {
    draw(<StorageMeter status={at(0.85)} />);
    const gauge = screen.getByTestId('clips-storage-meter');
    expect(gauge).toHaveAttribute('data-percent', '85');
    expect(gauge).toHaveAttribute('data-warning', 'true');
  });

  it('shows a full space at 100%', () => {
    draw(<StorageMeter status={at(1)} />);
    const gauge = screen.getByTestId('clips-storage-meter');
    expect(gauge).toHaveTextContent('20 GB of 20 GB');
    expect(gauge).toHaveAttribute('data-percent', '100');
  });

  it('opens a panel with what the space holds and See What Uses Space (Module 19)', () => {
    const onSee = jest.fn();
    const status = fixtureStatus({
      storage: { usedBytes: 3.4 * GB, limitBytes: 20 * GB },
      usage: {
        storageBytes: 3.4 * GB,
        byKind: { videos: 3.2 * GB, downloads: 0.15 * GB, library: 0.05 * GB },
      },
    });
    draw(<StorageMeter status={status} onSeeWhatUsesSpace={onSee} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Video space: 3.4 GB of 20 GB. Show what uses it.' }),
    );

    const panel = screen.getByTestId('clips-storage-panel');
    expect(panel).toHaveTextContent('Videos3.2 GB');
    expect(panel).toHaveTextContent('Downloads150 MB');
    expect(panel).toHaveTextContent('Your stickers and sounds50 MB');
    fireEvent.click(screen.getByRole('button', { name: 'See What Uses Space' }));
    expect(onSee).toHaveBeenCalledTimes(1);
  });

  it('offers no button without a place to go (the playground)', () => {
    draw(<StorageMeter status={at(0.2)} />);
    fireEvent.click(screen.getByTestId('clips-storage-meter'));
    expect(screen.queryByRole('button', { name: 'See What Uses Space' })).toBeNull();
  });
});
