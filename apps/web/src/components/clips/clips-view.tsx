'use client';

/**
 * The Clips page (Sprint 12): the actions row, then five tabs, the open one
 * in `?tab=`.
 *
 * - **Actions row** (`PageActions`, right): the storage meter and the AI
 *   minutes chip. Clips never shows AI credits.
 * - **Tools warning**: when the video tools are not running, one warning
 *   above the tabs, and every button that would bring something in is off.
 *   Looking at videos still works.
 * - **Tabs**: Create (Module 06), Streams (Module 06, My Channels), Videos
 *   (Module 06), Clips (Module 07, with Recent Clips on Create) and
 *   Downloads (Module 18). The Simulated
 *   sticker sits at the right of the tab row under simulation.
 *
 * What must outlive a tab switch lives here: the link card, the uploads (a
 * tab switch never cancels one), the video list and the saved channels, so
 * the Create tab, the Videos tab, the Streams tab and the Browse dialog all
 * read the same state and never ask twice.
 */
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  PageActions,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@postgear/ui';
import { DownloadIcon, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { createWholeClip, importSample } from '@/lib/clips-api';
import type { ClipImportOutcome, ClipProbe, ClipsStatus } from '@/types/clips';
import { ChannelBrowser } from './channels/channel-browser';
import { BrowseChannelsDialog, LinkCardDialog } from './channels/channel-dialogs';
import { useChannels } from './channels/use-channels';
import {
  CLIPS_TAB_NAMES,
  CLIPS_TABS,
  type ClipsTab,
  DEFAULT_CLIPS_TAB,
  LATER_STEP_SENTENCE,
} from './clips-model';
import { AiMinutesChip, StorageMeter } from './home/clips-meters';
import { CreateTab } from './home/create-tab';
import { UPLOAD_ACCEPT, uploadHelpLine } from './home/home-model';
import { ALREADY_HERE } from './home/link-card';
import { useLinkProbe } from './home/use-link-probe';
import { useVideoUpload } from './home/use-video-upload';
import { useVideos } from './home/use-videos';
import { VideosTab, videoCardActions } from './home/videos-tab';
import { ClipsTab as ClipsLibraryTab } from './library/clips-tab';
import { RecentClips } from './library/recent-clips';
import { useClipsList } from './library/use-clips-list';
import { useClipsStatus } from './use-clips-status';
import { clipEditHref } from './video/video-clip-list';

export const TOOLS_DOWN_SENTENCE =
  'Video tools are not running right now. You can look at your videos, but nothing new can be brought in.';
export const SAMPLE_ALREADY_HERE = 'You already have the sample video.';
const SAMPLE_UNREACHABLE = 'We could not reach Clips. Check your connection and try again.';

/** Tabs whose module has not landed yet, and the mark their placeholder shows. */
const LATER_TABS = {
  downloads: DownloadIcon,
} as const;

export function videoHref(orgId: string, videoId: string): string {
  return `/${encodeURIComponent(orgId)}/clips/video/${encodeURIComponent(videoId)}`;
}

export function ClipsView({
  orgId,
  initialTab,
  initialStatus = null,
}: {
  orgId: string;
  initialTab: ClipsTab;
  initialStatus?: ClipsStatus | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<ClipsTab>(initialTab);
  const statusState = useClipsStatus(initialStatus);
  const { status } = statusState;
  const refreshStatus = statusState.refresh;
  const videos = useVideos();
  const probe = useLinkProbe();
  const [browseOpen, setBrowseOpen] = useState(false);
  // Channels are asked for only once the Streams tab or the dialog opens.
  const channels = useChannels(tab === 'streams' || browseOpen);
  const [focusRights, setFocusRights] = useState(false);
  const [streamCard, setStreamCard] = useState<{ url: string; probe: ClipProbe } | null>(null);
  const [sampleBusy, setSampleBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const toolsOk = status?.tools.state === 'ok';
  const disabled = !toolsOk;
  const platforms = status?.platforms ?? [];

  // The open tab lives in the URL without a navigation, which would re-run
  // the server page for nothing.
  useEffect(() => {
    const url = new URL(window.location.href);
    const wanted = tab === DEFAULT_CLIPS_TAB ? null : tab;
    if (url.searchParams.get('tab') === wanted) return;
    if (wanted) url.searchParams.set('tab', wanted);
    else url.searchParams.delete('tab');
    window.history.replaceState(window.history.state, '', url);
  }, [tab]);

  const uploads = useVideoUpload(status, () => {
    videos.refresh();
    refreshStatus();
  });

  // Edit Whole Video: a clip over the whole video, opened at once (Module 07).
  const editWhole = useCallback(
    async (videoId: string) => {
      const { clip } = await createWholeClip(videoId);
      router.push(clipEditHref(orgId, clip.id));
    },
    [orgId, router],
  );

  const videoActions = useMemo(
    () => videoCardActions(videos, refreshStatus, editWhole),
    [videos, refreshStatus, editWhole],
  );

  // The Clips tab's list is asked for while the tab is open, and again on each return.
  const clipsList = useClipsList({ enabled: tab === 'clips' });

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
      setTab('videos');
    },
    [orgId, probe, refreshStatus, router, videos],
  );

  const onSample = async () => {
    if (sampleBusy || disabled) return;
    setSampleBusy(true);
    try {
      const outcome = await importSample();
      onImported(outcome, outcome.message ?? SAMPLE_ALREADY_HERE);
    } catch (cause) {
      toast({
        title: cause instanceof ApiError && cause.status !== 0 ? cause.message : SAMPLE_UNREACHABLE,
        variant: 'warning',
      });
    } finally {
      setSampleBusy(false);
    }
  };

  const openFilePicker = () => {
    if (!disabled) fileInput.current?.click();
  };

  const onFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Cleared so picking the same file again still fires.
    event.target.value = '';
    if (files.length === 0) return;
    uploads.add(files);
    setTab('create');
  };

  const showFromChannel = (url: string, found: ClipProbe) => {
    setFocusRights(true);
    probe.show(url, found);
    setTab('create');
  };

  return (
    <div className="flex flex-col gap-5">
      <PageActions>
        {status ? <StorageMeter status={status} /> : null}
        <AiMinutesChip orgId={orgId} fallback={status?.meters.aiMinutes ?? null} />
      </PageActions>

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

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as ClipsTab)}
        className="flex flex-col gap-5"
      >
        <div className="flex items-center justify-between gap-3">
          <TabsList aria-label="Clips tabs">
            {CLIPS_TABS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {CLIPS_TAB_NAMES[value]}
              </TabsTrigger>
            ))}
          </TabsList>
          {status?.simulation ? <Badge variant="secondary">Simulated</Badge> : null}
        </div>

        <TabsContent value="create" className="mt-0">
          <CreateTab
            orgId={orgId}
            platforms={platforms}
            probe={probe}
            disabled={disabled}
            focusRights={focusRights}
            sampleAvailable={status?.sample?.available ?? false}
            sampleBusy={sampleBusy}
            uploadHelp={uploadHelpLine(status)}
            uploads={uploads}
            videos={videos}
            videoActions={videoActions}
            onImported={(outcome) => onImported(outcome)}
            onUpload={openFilePicker}
            onBrowse={platforms.length > 0 ? () => setBrowseOpen(true) : undefined}
            onSample={() => void onSample()}
            onAllVideos={() => setTab('videos')}
            recentClips={<RecentClips orgId={orgId} onAllClips={() => setTab('clips')} />}
          />
        </TabsContent>

        <TabsContent value="streams" className="mt-0">
          <section
            aria-label="My Channels"
            className="rounded-card border-2 border-outline bg-chrome p-5 shadow-surfaceSm"
          >
            <ChannelBrowser
              orgId={orgId}
              platforms={platforms}
              disabled={disabled}
              channelsState={channels}
              onProbed={(url, found) => setStreamCard({ url, probe: found })}
            />
          </section>
        </TabsContent>

        <TabsContent value="videos" className="mt-0">
          <VideosTab
            orgId={orgId}
            videos={videos}
            actions={videoActions}
            onCreate={() => setTab('create')}
          />
        </TabsContent>

        <TabsContent value="clips" className="mt-0">
          <ClipsLibraryTab orgId={orgId} list={clipsList} onVideos={() => setTab('videos')} />
        </TabsContent>

        {(Object.keys(LATER_TABS) as Array<keyof typeof LATER_TABS>).map((value) => (
          <TabsContent key={value} value={value} className="mt-0">
            <EmptyState icon={LATER_TABS[value]} title={LATER_STEP_SENTENCE} />
          </TabsContent>
        ))}
      </Tabs>

      <BrowseChannelsDialog
        open={browseOpen}
        onOpenChange={setBrowseOpen}
        orgId={orgId}
        platforms={platforms}
        disabled={disabled}
        channelsState={channels}
        onProbed={showFromChannel}
      />
      <LinkCardDialog
        shown={streamCard}
        onClose={() => setStreamCard(null)}
        orgId={orgId}
        disabled={disabled}
        onImported={(outcome) => onImported(outcome)}
      />
    </div>
  );
}
