'use client';

/**
 * The Videos tab (Module 06, section 5): every video the workspace brought
 * in, four across, newest first, with Show More.
 *
 * The list is owned by the page (`useVideos`), so an import started on the
 * Create tab shows up here at once and a delete moves the storage meter.
 * Empty: "No videos yet. Paste a link or upload a video to start." with
 * Create. Loading: four card footprints. A list that failed: `ErrorState`
 * with Try Again.
 */
import { Button, EmptyState, ErrorState, Segmented, toast } from '@postgear/ui';
import { Film } from 'lucide-react';
import { cancelVideo, deleteVideo, retryVideo } from '@/lib/clips-api';
import type { ClipVideoSort } from '@/types/clips';
import { type VideoCardActions, VideoCard, VideoCardsSkeleton } from './video-card';
import type { VideosState } from './use-videos';

export const VIDEOS_EMPTY = 'No videos yet. Paste a link or upload a video to start.';

const SORTS: ReadonlyArray<{ value: ClipVideoSort; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
];

/** The card actions over the API, shared with Recent Videos on the Create tab. */
export function videoCardActions(
  videos: VideosState,
  onChanged: () => void,
  onEditWhole?: (videoId: string) => Promise<void>,
): VideoCardActions {
  return {
    onCancel: async (videoId) => {
      const { message } = await cancelVideo(videoId);
      toast({ title: message });
      await videos.refreshOne(videoId);
      onChanged();
    },
    onRetry: async (videoId) => {
      const { video, job } = await retryVideo(videoId);
      const current = videos.cards.find((card) => card.video.id === videoId);
      videos.replace({ video, job, clipCount: current?.clipCount });
    },
    onDelete: async (videoId) => {
      const { message } = await deleteVideo(videoId);
      videos.remove(videoId);
      toast({ title: message });
      onChanged();
    },
    onSettled: (videoId) => {
      void videos.refreshOne(videoId).then(onChanged);
    },
    onEditWhole,
  };
}

export function VideosTab({
  orgId,
  videos,
  actions,
  onCreate,
}: {
  orgId: string;
  videos: VideosState;
  actions: VideoCardActions;
  onCreate: () => void;
}) {
  if (videos.loading && videos.cards.length === 0) {
    return <VideoCardsSkeleton />;
  }
  if (videos.error && videos.cards.length === 0) {
    return (
      <ErrorState
        title={videos.error}
        action={{ label: 'Try Again', onClick: videos.refresh, variant: 'secondary' }}
      />
    );
  }
  if (videos.cards.length === 0) {
    return (
      <EmptyState
        icon={Film}
        title={VIDEOS_EMPTY}
        action={{ label: 'Create', onClick: onCreate, variant: 'primary' }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 font-sans text-sm text-ink type-muted">
          {videos.total === 1 ? '1 video' : `${videos.total.toLocaleString('en-GB')} videos`}
        </p>
        <Segmented
          label="Sort Videos"
          tight
          value={videos.sort}
          onValueChange={(value) => videos.setSort(value as ClipVideoSort)}
          options={SORTS.map((sort) => ({ value: sort.value, label: sort.label }))}
        />
      </div>
      <ul className="m-0 grid list-none grid-cols-4 gap-4 p-0" aria-busy={videos.loading}>
        {videos.cards.map((card) => (
          <VideoCard key={card.video.id} card={card} orgId={orgId} actions={actions} />
        ))}
      </ul>
      {videos.hasMore ? (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={videos.loadMore} disabled={videos.loadingMore}>
            {videos.loadingMore ? 'Loading' : 'Show More'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
