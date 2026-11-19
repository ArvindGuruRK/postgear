import { TooltipProvider } from '@postgear/ui';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { ApiError } from '@/lib/api';
import type { ClipImportOutcome, ClipProbe, DownloadStarted, LinkFormat } from '@/types/clips';
import { FIXTURE_CARDS, fixtureJob, fixtureProbe } from '../clips-fixtures';
import { NO_QUALITIES } from './download-menu';
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

  it('links the rights box to how owners ask for a video to come out (Module 19)', () => {
    renderCard(card());
    const help = screen.getByRole('link', { name: 'Copyright Requests (opens in a new tab)' });
    expect(help).toHaveAttribute('href', '/legal/copyright');
    expect(help).toHaveAttribute('target', '_blank');
    expect(help).toHaveAttribute('rel', 'noopener noreferrer');
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

  describe('Download', () => {
    const FORMATS: LinkFormat[] = [
      {
        id: 'h720',
        label: '720p',
        height: 720,
        fps: 30,
        ext: 'mp4',
        bytes: null,
        audioOnly: false,
      },
      {
        id: 'audio',
        label: 'Audio Only',
        height: null,
        fps: null,
        ext: 'm4a',
        bytes: 9_000_000,
        audioOnly: true,
      },
      {
        id: 'h2160',
        label: '2160p',
        height: 2160,
        fps: 30,
        ext: 'mp4',
        bytes: 2_000_000_000,
        audioOnly: false,
      },
      {
        id: 'h1080',
        label: '1080p',
        height: 1080,
        fps: 30,
        ext: 'mp4',
        bytes: 412_000_000,
        audioOnly: false,
      },
    ];
    const withFormats = (overrides: Partial<ClipProbe> = {}) =>
      fixtureProbe({ info: { ...fixtureProbe().info, formats: FORMATS }, ...overrides });
    const STARTED: DownloadStarted = {
      job: fixtureJob({ id: 'dl-1', kind: 'DOWNLOAD', videoId: null }),
      download: {
        id: 'dl-1',
        title: 'Friday Night Speedrun, Any Percent Attempts',
        label: '720p',
        audioOnly: false,
        ext: 'mp4',
        state: 'preparing',
        job: fixtureJob({ id: 'dl-1', kind: 'DOWNLOAD', videoId: null }),
        bytes: null,
        expiresAt: null,
        canSaveToMedia: false,
        media: null,
        createdAt: '2026-11-18T10:00:00.000Z',
      },
      existing: false,
    };
    const downloadButton = () => screen.getByRole('button', { name: /Download/ });
    const openMenu = () => fireEvent.keyDown(downloadButton(), { key: 'Enter' });

    it('has no Download when the page does not offer it', () => {
      renderCard(card({ probe: withFormats() }));
      expect(screen.queryByRole('button', { name: /Download/ })).not.toBeInTheDocument();
    });

    it('stays off until the rights box is ticked', () => {
      renderCard(card({ probe: withFormats(), onDownloaded: jest.fn() }));
      expect(downloadButton()).toBeDisabled();
      fireEvent.click(rights());
      expect(downloadButton()).toBeEnabled();
    });

    it('lists the qualities tallest first up to 1080p, sizes only when known, then Audio Only', async () => {
      renderCard(card({ probe: withFormats(), onDownloaded: jest.fn() }));
      fireEvent.click(rights());
      openMenu();
      const items = await screen.findAllByRole('menuitem');
      expect(items.map((item) => item.textContent)).toEqual([
        '1080p (412 MB)',
        '720p',
        'Audio Only',
      ]);
    });

    it('says so when no quality can be downloaded', async () => {
      renderCard(card({ onDownloaded: jest.fn() }));
      fireEvent.click(rights());
      openMenu();
      expect(await screen.findByRole('menuitem', { name: NO_QUALITIES })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    });

    it('asks for the canonical link and the picked quality, with the tick', async () => {
      const downloadFn = jest.fn(async () => STARTED);
      const onDownloaded = jest.fn();
      renderCard(card({ probe: withFormats(), onDownloaded, downloadFn }));
      fireEvent.click(rights());
      openMenu();
      const item = await screen.findByRole('menuitem', { name: '720p' });
      await act(async () => {
        fireEvent.click(item);
      });
      expect(downloadFn).toHaveBeenCalledWith(
        'https://www.twitch.tv/videos/1000000001',
        'h720',
        true,
      );
      expect(onDownloaded).toHaveBeenCalledWith(STARTED);
    });

    it("shows a refusal in the card's alert", async () => {
      const downloadFn = jest.fn(async () => {
        throw new ApiError(
          "You have reached today's limit of 2 downloads. It resets at midnight UTC.",
          402,
          'clips_downloads_today',
        );
      });
      const onDownloaded = jest.fn();
      renderCard(card({ probe: withFormats(), onDownloaded, downloadFn }));
      fireEvent.click(rights());
      openMenu();
      const item = await screen.findByRole('menuitem', { name: 'Audio Only' });
      await act(async () => {
        fireEvent.click(item);
      });
      expect(
        screen.getByText(
          "You have reached today's limit of 2 downloads. It resets at midnight UTC.",
        ),
      ).toBeInTheDocument();
      expect(onDownloaded).not.toHaveBeenCalled();
    });

    it('still offers the tick and Download for a video the workspace already has', () => {
      renderCard(
        card({ probe: withFormats({ existingVideoId: 'video-ready' }), onDownloaded: jest.fn() }),
      );
      expect(screen.getByRole('link', { name: 'Open Video' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Import Video' })).not.toBeInTheDocument();
      expect(downloadButton()).toBeDisabled();
      fireEvent.click(rights());
      expect(downloadButton()).toBeEnabled();
    });
  });
});
