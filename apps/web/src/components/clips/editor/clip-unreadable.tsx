/**
 * A clip whose stored document no longer reads (the API answers it with
 * `document: null`). Nothing can be edited, so the editor is not opened: one
 * sentence and the way back. A server component.
 */
import { ErrorState } from '@postgear/ui';
import { FileWarning } from 'lucide-react';
import { PrimaryLink } from '../button-link';
import { backHref, clipsTabHref, DOCUMENT_UNREADABLE_SENTENCE } from './clip-editor-model';

export function ClipUnreadable({
  orgId,
  videoId,
  clipId,
}: {
  orgId: string;
  videoId: string | null;
  clipId: string;
}) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-4"
      data-testid="clip-unreadable"
    >
      <ErrorState icon={FileWarning} title={DOCUMENT_UNREADABLE_SENTENCE} />
      <PrimaryLink href={videoId ? backHref(orgId, videoId, clipId) : clipsTabHref(orgId)}>
        {videoId ? 'Back To Video' : 'Back To Clips'}
      </PrimaryLink>
    </div>
  );
}
