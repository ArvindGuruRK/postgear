'use client';

/**
 * The Clips home (Module 06, section 3; redone 2026-11-19 with no tab bar):
 * the way in, then what you already have, each drawn only when there is
 * something to show.
 *
 * 1. **The entry card** (`LinkBox`) with the uploads and the videos on their
 *    way in (`OpeningRow`) inside it, under its buttons.
 * 2. **Coming Up** (Module 17), only when a post with a clip is coming up.
 * 3. **Recent Videos**, **Recent Clips** and **Downloads**, each with See All,
 *    which opens the full list in place of the home.
 *
 * Everything that must outlive a move to a list and back (the probe, the
 * uploads, the video list) is owned by the page and passed in, so leaving the
 * home never cancels an upload or forgets the link card.
 */
import type { ClipPlatformId } from '@postgear/video-engine';
import { useId } from 'react';
import { AnalyticsPanel, PanelHeader } from '@/components/analytics/analytics-ui';
import type { ClipImportOutcome, DownloadStarted } from '@/types/clips';
import { DownloadsTab } from './downloads-tab';
import { LinkBox } from './link-box';
import { OpeningRow } from './opening-row';
import { SeeAll } from './see-all';
import { UploadRow } from './upload-row';
import type { DownloadsState } from './use-downloads';
import type { LinkProbe } from './use-link-probe';
import type { OpenWhenReady } from './use-open-when-ready';
import type { VideoUploads } from './use-video-upload';
import type { VideosState } from './use-videos';
import { VideoCard, type VideoCardActions } from './video-card';

/** How many videos Recent Videos shows: one row of the four-across grid. */
export const RECENT_VIDEOS = 4;
/** How many downloads the home shows. */
export const RECENT_DOWNLOADS = 3;

export function CreateTab({
  orgId,
  platforms,
  probe,
  disabled,
  focusRights,
  sampleAvailable,
  sampleBusy,
  uploadHelp,
  uploads,
  openings,
  videos,
  videoActions,
  downloads,
  recentClips,
  comingUp,
  onImported,
  onDownloaded,
  onUpload,
  onDropFiles,
  onBrowse,
  onSample,
  onAllVideos,
  onAllDownloads,
  onDownloadsSettled,
}: {
  orgId: string;
  platforms: readonly ClipPlatformId[];
  probe: LinkProbe;
  disabled: boolean;
  focusRights: boolean;
  sampleAvailable: boolean;
  sampleBusy: boolean;
  uploadHelp: string;
  uploads: VideoUploads;
  /** Videos that open by themselves once ready. */
  openings: OpenWhenReady;
  videos: VideosState;
  videoActions: VideoCardActions;
  downloads: DownloadsState;
  /** Module 07's Recent Clips panel. */
  recentClips?: React.ReactNode;
  /** Module 17's Coming Up panel. */
  comingUp?: React.ReactNode;
  onImported: (outcome: ClipImportOutcome) => void;
  /** Module 18: a download was asked for on the link card. */
  onDownloaded?: (outcome: DownloadStarted) => void;
  onUpload: () => void;
  onDropFiles: (files: File[]) => void;
  onBrowse?: (platform: ClipPlatformId) => void;
  onSample: () => void;
  onAllVideos: () => void;
  onAllDownloads: () => void;
  onDownloadsSettled: () => void;
}) {
  const recentId = useId();
  const downloadsId = useId();
  // Newest first whatever the Videos list is sorted by.
  const recent = [...videos.cards]
    .sort((a, b) => Date.parse(b.video.createdAt) - Date.parse(a.video.createdAt))
    .slice(0, RECENT_VIDEOS);
  // A finished upload that is being opened is shown once, as its opening row.
  const opening = new Set(openings.openings.map((one) => one.videoId));
  const uploadRows = uploads.uploads.filter(
    (upload) => !(upload.phase === 'done' && upload.videoId && opening.has(upload.videoId)),
  );

  return (
    <div className="flex flex-col gap-6">
      <LinkBox
        orgId={orgId}
        platforms={platforms}
        probe={probe}
        disabled={disabled}
        focusRights={focusRights}
        sampleAvailable={sampleAvailable}
        sampleBusy={sampleBusy}
        uploadHelp={uploadHelp}
        onImported={onImported}
        onDownloaded={onDownloaded}
        onUpload={onUpload}
        onDropFiles={onDropFiles}
        onBrowse={onBrowse}
        onSample={onSample}
      >
        {uploadRows.length + openings.openings.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Uploads">
            {uploadRows.map((upload) => (
              <UploadRow
                key={upload.id}
                upload={upload}
                orgId={orgId}
                onCancel={() => uploads.cancel(upload.id)}
                onDismiss={() => uploads.dismiss(upload.id)}
              />
            ))}
            {openings.openings.map((one) => (
              <OpeningRow
                key={one.videoId}
                opening={one}
                onStay={() => openings.stay(one.videoId)}
              />
            ))}
          </ul>
        ) : null}
      </LinkBox>

      {comingUp}

      {recent.length > 0 ? (
        <AnalyticsPanel aria-labelledby={recentId} className="flex flex-col gap-4 p-5">
          <PanelHeader
            id={recentId}
            title="Recent Videos"
            aside={<SeeAll label="See All Videos" onClick={onAllVideos} />}
          />
          <ul className="m-0 grid list-none grid-cols-4 gap-4 p-0">
            {recent.map((card) => (
              <VideoCard key={card.video.id} card={card} orgId={orgId} actions={videoActions} />
            ))}
          </ul>
        </AnalyticsPanel>
      ) : null}

      {recentClips}

      {downloads.rows.length > 0 ? (
        <AnalyticsPanel aria-labelledby={downloadsId} className="flex flex-col gap-4 p-5">
          <PanelHeader
            id={downloadsId}
            title="Downloads"
            aside={<SeeAll label="See All Downloads" onClick={onAllDownloads} />}
          />
          <DownloadsTab
            downloads={downloads}
            onSettled={onDownloadsSettled}
            limit={RECENT_DOWNLOADS}
          />
        </AnalyticsPanel>
      ) : null}
    </div>
  );
}
