import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { ApiError } from '@/lib/api';
import type { ClipImportOutcome, ClipProbe } from '@/types/clips';
import { FIXTURE_CARDS, fixtureProbe } from '../clips-fixtures';
import { ALREADY_HERE, LinkCard, RIGHTS_LINE, TWITCH_MUTED_LINE } from './link-card';

beforeAll(() => stubBrowserLayout());

const OUTCOME: ClipImportOutcome = {
  video: FIXTURE_CARDS.busy.video,
  job: FIXTURE_CARDS.busy.job,
  existing: false,
};

function renderCard(ui: ReactElement) {
  const view = render(<TooltipProvider>{ui}</TooltipProvider>);
  return {
    ...view,
    rerender: (next: ReactElement) => view.rerender(<TooltipProvider>{next}</TooltipProvider>),
  };
}

function card(props: Partial<Parameters<typeof LinkCard>[0]> & { probe?: ClipProbe } = {}) {
  return (
    <LinkCard
      key={props.probe?.link.canonicalUrl ?? 'first'}
      probe={fixtureProbe()}
      orgId="org-1"
      onImported={jest.fn()}
      importFn={jest.fn(async () => OUTCOME)}
      {...props}
    />
  );
}

const importButton = () => screen.getByRole('button', { name: 'Import Video' });
const rights = () => screen.getByRole('checkbox', { name: RIGHTS_LINE });

describe('LinkCard', () => {
  it('shows what the link is', () => {
    renderCard(card());
    expect(
      screen.getByRole('heading', { name: 'Friday Night Speedrun, Any Percent Attempts' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Twitch')).toBeInTheDocument();
    expect(screen.getByText('simstreamer, Past stream, 10 min')).toBeInTheDocument();
    expect(screen.getByText(TWITCH_MUTED_LINE)).toBeInTheDocument();
  });

  it('keeps Import Video off until the rights box is ticked', () => {
    renderCard(card());
    expect(rights()).not.toBeChecked();
    expect(importButton()).toBeDisabled();
    fireEvent.click(rights());
    expect(rights()).toBeChecked();
    expect(importButton()).toBeEnabled();
  });

  it('imports the canonical link with the tick and hands the outcome back', async () => {
    const importFn = jest.fn(async () => OUTCOME);
    const onImported = jest.fn();
    renderCard(card({ importFn, onImported }));

    fireEvent.click(rights());
    await act(async () => {
      fireEvent.click(importButton());
    });

    expect(importFn).toHaveBeenCalledTimes(1);
    expect(importFn).toHaveBeenCalledWith('https://www.twitch.tv/videos/1000000001', true);
    expect(onImported).toHaveBeenCalledWith(OUTCOME);
  });

  it('cannot be pressed twice while importing', async () => {
    let finish: (outcome: ClipImportOutcome) => void = () => undefined;
    const importFn = jest.fn(
      () =>
        new Promise<ClipImportOutcome>((resolve) => {
          finish = resolve;
        }),
    );
    renderCard(card({ importFn }));
    fireEvent.click(rights());
    fireEvent.click(importButton());

    const busy = screen.getByRole('button', { name: 'Importing' });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(importFn).toHaveBeenCalledTimes(1);
    await act(async () => finish(OUTCOME));
  });

  it('stays off while the video tools are down, even when ticked', () => {
    renderCard(card({ disabled: true }));
    fireEvent.click(rights());
    expect(importButton()).toBeDisabled();
  });

  it('starts unticked again for a new link', () => {
    const { rerender } = renderCard(card());
    fireEvent.click(rights());
    expect(importButton()).toBeEnabled();

    const next = fixtureProbe({
      link: {
        ...fixtureProbe().link,
        canonicalUrl: 'https://www.twitch.tv/videos/2',
        externalId: '2',
      },
    });
    rerender(card({ probe: next }));
    expect(rights()).not.toBeChecked();
    expect(importButton()).toBeDisabled();
  });

  it('offers Open Video, and no tick, for a video the workspace already has', () => {
    const importFn = jest.fn(async () => OUTCOME);
    renderCard(card({ probe: fixtureProbe({ existingVideoId: 'video-ready' }), importFn }));

    expect(screen.getByText(ALREADY_HERE)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Video' })).toHaveAttribute(
      'href',
      '/org-1/clips/video/video-ready',
    );
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import Video' })).not.toBeInTheDocument();
  });

  it("shows the API's refusal as an alert with See Plans for a plan limit", async () => {
    const importFn = jest.fn(async () => {
      throw new ApiError(
        'This workspace has used its import minutes for this month.',
        402,
        'clips_import_minutes',
      );
    });
    const onImported = jest.fn();
    renderCard(card({ importFn, onImported }));
    fireEvent.click(rights());
    await act(async () => {
      fireEvent.click(importButton());
    });

    expect(
      screen.getByText('This workspace has used its import minutes for this month.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See Plans' })).toHaveAttribute(
      'href',
      '/org-1/settings/billing',
    );
    expect(onImported).not.toHaveBeenCalled();
    // The tick stays, so a second try needs no second tick.
    expect(importButton()).toBeEnabled();
  });

  it('says Clips could not be reached when the import has no answer', async () => {
    const importFn = jest.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    renderCard(card({ importFn }));
    fireEvent.click(rights());
    await act(async () => {
      fireEvent.click(importButton());
    });
    expect(
      screen.getByText('We could not reach Clips. Check your connection and try again.'),
    ).toBeInTheDocument();
  });
});
