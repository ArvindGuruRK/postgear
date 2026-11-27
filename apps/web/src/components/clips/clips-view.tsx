'use client';

/**
 * The Clips page (Sprint 12; redone 2026-11-19 with no tab bar, after
 * StreamLadder's home). One view at a time, named in `?tab=` so a link or a
 * reload lands on it (old links keep working):
 *
 * - **Home** (`create`, the default): the entry card, then Coming Up, Recent
 *   Videos, Recent Clips and Downloads, each with See All (`create-tab.tsx`).
 * - **Videos**, **Clips** and **Downloads**: the whole list, opened from its
 *   See All, with Back to the home. They are views of this page, not routes,
 *   so an upload running on the home carries on while a list is open.
 * - **Streams** is not a view any more: Browse Twitch, Browse Kick and Browse
 *   YouTube open the saved channels of that platform in a dialog, and
 *   `?tab=streams` opens it for every platform.
 *
 * The actions row carries the storage meter and (Sprint 13, Module 10) the
 * Recipes And Brand Kit link on the right (2026-11-20: no
 * Simulated sticker and no AI minutes chip on the home; the chip lives on a
 * video's Find Clips panel), and on the left Back and the list's name on a
 * list. When the video tools
 * are not running, one warning says so and every way in is off; looking at
 * videos still works.
 *
 * After an upload or a new import the page waits for the video and opens it
 * (`useOpenWhenReady`).
 */
import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { Alert, Button, EmptyState, MotionIcon, PageActions, toast } from '@postgear/ui';
import { type ChannelPlatformId, isChannelPlatform } from '@postgear/video-engine';
import { Lock, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionLink } from '@/components/home/home-actions';
import { createWholeClip, downloadOriginal } from '@/lib/clips-api';
import type {
  ClipImportOutcome,
  ClipProbe,
  ClipsStatus,
  ClipVideoSort,
  DownloadStarted,
} from '@/types/clips';
import { BrowseChannelsDialog, LinkCardDialog } from './channels/channel-dialogs';
import { useChannels } from './channels/use-channels';
import { CLIPS_TAB_NAMES, type ClipsTab, DEFAULT_CLIPS_TAB } from './clips-model';
import { StorageMeter } from './home/clips-meters';
import { ComingUp } from './home/coming-up';
import { CreateTab } from './home/create-tab';
import { DOWNLOAD_EXISTS, DOWNLOAD_STARTED, DownloadsTab } from './home/downloads-tab';
import { useDrivePicker } from './home/drive-picker';
import {
  CLIPS_NOT_IN_PLAN_SENTENCE,
  clipsInPlan,
  storageOverSentence,
  UPLOAD_ACCEPT,
} from './home/home-model';
import { ALREADY_HERE } from './home/link-card';
import { useDownloads } from './home/use-downloads';
import { useLinkProbe } from './home/use-link-probe';
import { useOpenWhenReady } from './home/use-open-when-ready';
import { useVideoUpload } from './home/use-video-upload';
import { useVideos } from './home/use-videos';
import { VideosTab, videoCardActions } from './home/videos-tab';
import { kitHref } from './kit/kit-model';
import { ClipsTab as ClipsLibraryTab } from './library/clips-tab';
import { RecentClips } from './library/recent-clips';
import { useClipsList } from './library/use-clips-list';
import { useExportAll } from './library/use-export-all';
import { useClipsStatus } from './use-clips-status';
import { clipEditHref } from './video/video-clip-list';

/** A list opened from the home; `create` is the home itself. */
type ClipsView = Exclude<ClipsTab, 'streams'>;

export const TOOLS_DOWN_SENTENCE =
  'Video tools are not running right now. You can look at your videos, but nothing new can be brought in.';

export function videoHref(orgId: string, videoId: string): string {
  return `/${encodeURIComponent(orgId)}/clips/video/${encodeURIComponent(videoId)}`;
}

/**
 * Back to the top of the page's own scroll area (the shell scrolls a region,
 * not the window; `scrollIntoView` would nudge the window too).
 */
function scrollToTop(element: HTMLElement | null) {
  let node = element?.parentElement ?? null;
  while (node) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) {
      node.scrollTop = 0;
      return;
    }
    node = node.parentElement;
  }
}

export function ClipsView({
  orgId,
  initialTab,
  initialSort = 'newest',
  initialStatus = null,
}: {
  orgId: string;
  initialTab: ClipsTab;
  /** Module 19: the Videos order from `?sort=` (See What Uses Space lands on `size`). */
  initialSort?: ClipVideoSort;
  initialStatus?: ClipsStatus | null;
}) {
  const router = useRouter();
  // `?tab=streams` (an old link) lands on the home with every platform's channels open.
  const [tab, setView] = useState<ClipsView>(initialTab === 'streams' ? 'create' : initialTab);
  const statusState = useClipsStatus(initialStatus);
  const { status } = statusState;
  const refreshStatus = statusState.refresh;
  const videos = useVideos(initialSort);
  const probe = useLinkProbe();
  const openings = useOpenWhenReady(orgId);
  const [browse, setBrowse] = useState<{ open: boolean; only?: ChannelPlatformId }>({
    open: initialTab === 'streams',
  });
  // Channels are asked for only once the Browse dialog opens.
  const channels = useChannels(browse.open);
  const top = useRef<HTMLDivElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const moved = useRef(false);
  const [focusRights, setFocusRights] = useState(false);
  const [streamCard, setStreamCard] = useState<{ url: string; probe: ClipProbe } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const toolsOk = status?.tools.state === 'ok';
  const disabled = !toolsOk;
  const platforms = status?.platforms ?? [];
  // Module 12: only Sprint 12's three sites have channels to browse.
  const channelPlatforms = useMemo(() => platforms.filter(isChannelPlatform), [platforms]);

  /** Opens a list (or the home) from its top, with focus on its name. */
  const setTab = useCallback((next: ClipsView) => {
    moved.current = true;
    setView(next);
  }, []);
  useEffect(() => {
    // Runs once the new view is drawn, so its name is there to take focus.
    void tab;
    if (!moved.current) return;
    moved.current = false;
    scrollToTop(top.current);
    heading.current?.focus();
  }, [tab]);

  // The open view lives in the URL without a navigation, which would re-run
  // the server page for nothing.
  // The Videos order (Module 19) rides along while the Videos list is open.
  useEffect(() => {
    const url = new URL(window.location.href);
    const wanted = tab === DEFAULT_CLIPS_TAB ? null : tab;
    const sort = tab === 'videos' && videos.sort !== 'newest' ? videos.sort : null;
    if (url.searchParams.get('tab') === wanted && url.searchParams.get('sort') === sort) return;
    if (wanted) url.searchParams.set('tab', wanted);
    else url.searchParams.delete('tab');
    if (sort) url.searchParams.set('sort', sort);
    else url.searchParams.delete('sort');
    window.history.replaceState(window.history.state, '', url);
  }, [tab, videos.sort]);

  // Module 19: See What Uses Space, from the meter's panel or the over-the-plan warning.
  const { setSort: setVideoSort } = videos;
  const seeWhatUsesSpace = useCallback(() => {
    setVideoSort('size');
    setTab('videos');
  }, [setVideoSort, setTab]);
  const overSentence = status ? storageOverSentence(status) : null;

  const uploads = useVideoUpload(status, (done) => {
    videos.refresh();
    refreshStatus();
    // Straight on into the editor once the video is ready (2026-11-19).
    if (done.videoId) {
      openings.follow({ id: done.videoId, title: done.name, platform: 'upload', kind: 'upload' });
    }
  });

  // Edit Whole Video: a clip over the whole video, opened at once (Module 07).
  const editWhole = useCallback(
    async (videoId: string) => {
      const { clip } = await createWholeClip(videoId);
      router.push(clipEditHref(orgId, clip.id));
    },
    [orgId, router],
  );

  // Download Original (Module 18): the browser follows a short-lived signed address.
  const saveOriginal = useCallback(async (videoId: string) => {
    window.location.assign(await downloadOriginal(videoId));
  }, []);

  const videoActions = useMemo(
    () => videoCardActions(videos, refreshStatus, editWhole, saveOriginal),
    [videos, refreshStatus, editWhole, saveOriginal],
  );

  // The Clips tab's list is asked for while the tab is open, and again on each return.
  const clipsList = useClipsList({ enabled: tab === 'clips' });
  // Module 11: Export All's dialog and the chip that opens it again (the list's rings move after a start).
  const exportAll = useExportAll({ orgId, onStarted: clipsList.refresh });
  // Downloads (Module 18): the home shows the newest few, so they are asked for at once.
  const downloads = useDownloads(true);

  /** A download was asked for on a link card: its row on top, the tab open. */
  const onDownloaded = useCallback(
    (outcome: DownloadStarted) => {
      downloads.add(outcome.download);
      downloads.refresh();
      refreshStatus();
      setTab('downloads');
      toast({ title: outcome.existing ? DOWNLOAD_EXISTS : DOWNLOAD_STARTED });
    },
    [downloads.add, downloads.refresh, refreshStatus, setTab],
  );

  /** An import started (the link card, a channel row, the sample). */
  const onImported = useCallback(
    (outcome: ClipImportOutcome, existingSentence: string = ALREADY_HERE) => {
      if (outcome.existing) {
        toast({ title: existingSentence });
        router.push(videoHref(orgId, outcome.video.id));
        return;
      }
      probe.reset();
      setFocusRights(false);
      videos.replace({ video: outcome.video, job: outcome.job, clipCount: 0 });
      videos.refresh();
      refreshStatus();
      // The home stays, with the video on its way in; it opens once ready (2026-11-19).
      setTab('create');
      openings.follow(outcome.video);
    },
    [orgId, probe, refreshStatus, router, videos, openings.follow, setTab],
  );

  // Module 12: Pick From Google Drive (a stand-in picker under simulation).
  const drivePicker = useDrivePicker(status?.drive, disabled, onImported);

  const openFilePicker = () => {
    if (!disabled) fileInput.current?.click();
  };

  const addFiles = (files: File[]) => {
    if (disabled || files.length === 0) return;
    uploads.add(files);
    setTab('create');
  };

  const onFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Cleared so picking the same file again still fires.
    event.target.value = '';
    addFiles(files);
  };

  const showFromChannel = (url: string, found: ClipProbe) => {
    setFocusRights(true);
    probe.show(url, found);
    setTab('create');
  };

  // Module 19: a plan without Clips (an operator turned it off). Every other
  // Clips route refuses with this sentence; the page says it once, calmly.
  if (status && !clipsInPlan(status)) {
    return (
      <div className="flex flex-col gap-5" data-testid="clips-not-in-plan">
        <EmptyState
          icon={Lock}
          title={CLIPS_NOT_IN_PLAN_SENTENCE}
          description="Upgrade to turn long videos into short clips."
          action={{
            label: 'See Plans',
            onClick: () => router.push(`/${encodeURIComponent(orgId)}/settings/billing`),
            variant: 'primary',
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div ref={top} className="flex flex-wrap items-center justify-between gap-3">
        {drivePicker.dialog}

        {tab === 'create' ? (
          <div />
        ) : (
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setTab('create')}
              data-testid="clips-back-home"
            >
              <MotionIcon icon={ArrowLeftIcon} className="h-4 w-4" />
              Back
            </Button>
            <h2
              ref={heading}
              tabIndex={-1}
              data-testid="clips-view-name"
              className="m-0 truncate font-sans text-lg text-ink type-heading outline-none"
            >
              {CLIPS_TAB_NAMES[tab]}
            </h2>
          </div>
        )}
        <PageActions>
          {exportAll.chip}
          {status ? <StorageMeter status={status} onSeeWhatUsesSpace={seeWhatUsesSpace} /> : null}
          {/* Module 10: the workspace's recipes and its brand kits for clips. */}
          <ActionLink href={kitHref(orgId)} data-testid="clips-kit-link">
            Recipes And Brand Kit
          </ActionLink>
        </PageActions>
      </div>

      {statusState.error && !status ? (
        <Alert variant="warning" className="items-center">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{statusState.error}</p>
          <Button variant="secondary" size="sm" onClick={refreshStatus}>
            Try Again
          </Button>
        </Alert>
      ) : null}
      {status && !toolsOk ? (
        <Alert variant="warning" className="items-center" data-testid="clips-tools-warning">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{TOOLS_DOWN_SENTENCE}</p>
        </Alert>
      ) : null}
      {overSentence ? (
        <Alert variant="warning" className="items-center" data-testid="clips-storage-over">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{overSentence}</p>
          <Button variant="secondary" size="sm" onClick={seeWhatUsesSpace}>
            See What Uses Space
          </Button>
          <ActionLink href={`/${encodeURIComponent(orgId)}/settings/billing`}>See Plans</ActionLink>
        </Alert>
      ) : null}

      <input
        ref={fileInput}
        type="file"
        accept={UPLOAD_ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onFiles}
      />

      {tab === 'create' ? (
        <CreateTab
          orgId={orgId}
          platforms={platforms}
          probe={probe}
          disabled={disabled}
          focusRights={focusRights}
          uploads={uploads}
          openings={openings}
          videos={videos}
          videoActions={videoActions}
          downloads={downloads}
          onImported={(outcome) => onImported(outcome)}
          onDownloaded={onDownloaded}
          onUpload={openFilePicker}
          onDropFiles={addFiles}
          onDrive={drivePicker.onPick}
          onBrowse={platforms.length > 0 ? (only) => setBrowse({ open: true, only }) : undefined}
          onAllVideos={() => setTab('videos')}
          onAllDownloads={() => setTab('downloads')}
          onDownloadsSettled={refreshStatus}
          recentClips={<RecentClips orgId={orgId} onAllClips={() => setTab('clips')} />}
          comingUp={
            <ComingUp
              orgId={orgId}
              hideWhenEmpty
              onSendAClip={() => {
                clipsList.setStatus('exported');
                setTab('clips');
              }}
            />
          }
        />
      ) : null}

      {tab === 'videos' ? (
        <VideosTab
          orgId={orgId}
          videos={videos}
          actions={videoActions}
          onCreate={() => setTab('create')}
        />
      ) : null}

      {tab === 'clips' ? (
        <ClipsLibraryTab
          orgId={orgId}
          list={clipsList}
          onVideos={() => setTab('videos')}
          onExportAll={exportAll.start}
        />
      ) : null}

      {tab === 'downloads' ? (
        <DownloadsTab downloads={downloads} onSettled={refreshStatus} />
      ) : null}

      <BrowseChannelsDialog
        open={browse.open}
        only={browse.only}
        onOpenChange={(open) => setBrowse((current) => ({ ...current, open }))}
        orgId={orgId}
        platforms={channelPlatforms}
        disabled={disabled}
        channelsState={channels}
        onProbed={showFromChannel}
      />
      {exportAll.dialog}
      <LinkCardDialog
        shown={streamCard}
        onClose={() => setStreamCard(null)}
        orgId={orgId}
        disabled={disabled}
        onImported={(outcome) => onImported(outcome)}
        onDownloaded={onDownloaded}
      />
    </div>
  );
}
