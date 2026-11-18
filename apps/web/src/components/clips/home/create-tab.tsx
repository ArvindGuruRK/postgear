'use client';

/**
 * The Create tab (Module 06, section 3; blueprint section 2): the link box
 * with its upload rows, then Recent Videos (and, from Module 07, Recent
 * Clips) as `AnalyticsPanel` groups, drawn only when there is something to
 * show.
 *
 * Everything that must outlive a tab switch (the probe, the uploads, the
 * video list) is owned by the page and passed in, so leaving the tab never
 * cancels an upload or forgets the link card.
 */
import { Button } from '@postgear/ui';
import type { ClipPlatformId } from '@postgear/video-engine';
import { useId } from 'react';
import { AnalyticsPanel, PanelHeader } from '@/components/analytics/analytics-ui';
import type { ClipImportOutcome } from '@/types/clips';
import { LinkBox } from './link-box';
import { UploadRow } from './upload-row';
import type { LinkProbe } from './use-link-probe';
import type { VideoUploads } from './use-video-upload';
import type { VideosState } from './use-videos';
import { type VideoCardActions, VideoCard } from './video-card';

/** How many videos Recent Videos shows: one row of the four-across grid. */
export const RECENT_VIDEOS = 4;

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
  videos,
  videoActions,
  recentClips,
  onImported,
  onUpload,
  onBrowse,
  onSample,
  onAllVideos,
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
  videos: VideosState;
  videoActions: VideoCardActions;
  /** Module 07's Recent Clips panel; nothing until then. */
  recentClips?: React.ReactNode;
  onImported: (outcome: ClipImportOutcome) => void;
  onUpload: () => void;
  onBrowse?: () => void;
  onSample: () => void;
  onAllVideos: () => void;
}) {
  const recentId = useId();
  // Newest first whatever the Videos tab is sorted by.
  const recent = [...videos.cards]
    .sort((a, b) => Date.parse(b.video.createdAt) - Date.parse(a.video.createdAt))
    .slice(0, RECENT_VIDEOS);

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
        onUpload={onUpload}
        onBrowse={onBrowse}
        onSample={onSample}
      >
        {uploads.uploads.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Uploads">
            {uploads.uploads.map((upload) => (
              <UploadRow
                key={upload.id}
                upload={upload}
                orgId={orgId}
                onCancel={() => uploads.cancel(upload.id)}
                onDismiss={() => uploads.dismiss(upload.id)}
              />
            ))}
          </ul>
        ) : null}
      </LinkBox>

      {recent.length > 0 ? (
        <AnalyticsPanel aria-labelledby={recentId} className="flex flex-col gap-4 p-5">
          <PanelHeader
            id={recentId}
            title="Recent Videos"
            aside={
              <Button variant="secondary" size="sm" onClick={onAllVideos}>
                All Videos
              </Button>
            }
          />
          <ul className="m-0 grid list-none grid-cols-4 gap-4 p-0">
            {recent.map((card) => (
              <VideoCard key={card.video.id} card={card} orgId={orgId} actions={videoActions} />
            ))}
          </ul>
        </AnalyticsPanel>
      ) : null}

      {recentClips}
    </div>
  );
}
