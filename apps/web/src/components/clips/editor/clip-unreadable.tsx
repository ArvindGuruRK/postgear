/**
 * A clip whose stored document no longer reads (the API answers it with
 * `document: null`), or (Module 11) a montage one of whose videos was
 * removed (422 `montage_video_removed`). Nothing can be edited, so the
 * editor is not opened: one sentence and the way back. A server component.
 */
import { ErrorState } from '@postgear/ui';
import { CLIP_ERROR_MESSAGES } from '@postgear/video-engine';
import { FileWarning } from 'lucide-react';
import { PrimaryLink } from '../button-link';
import { backHref, clipsTabHref, DOCUMENT_UNREADABLE_SENTENCE } from './clip-editor-model';

/** The API's code for a montage that plays a removed video, and its sentence. */
export const MONTAGE_VIDEO_REMOVED_CODE = 'montage_video_removed';
export const MONTAGE_VIDEO_REMOVED_SENTENCE = CLIP_ERROR_MESSAGES.montage_video_removed;

export function ClipUnreadable({
  orgId,
  videoId,
  clipId,
  sentence = DOCUMENT_UNREADABLE_SENTENCE,
}: {
  orgId: string;
  videoId: string | null;
  clipId: string;
  /** What went wrong; the unreadable document's sentence by default. */
  sentence?: string;
}) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-4"
      data-testid="clip-unreadable"
    >
      <ErrorState icon={FileWarning} title={sentence} />
      <PrimaryLink href={videoId ? backHref(orgId, videoId, clipId) : clipsTabHref(orgId)}>
        {videoId ? 'Back To Video' : 'Back To Clips'}
      </PrimaryLink>
    </div>
  );
}
