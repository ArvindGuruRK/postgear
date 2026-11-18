'use client';

/**
 * A refusal, as every Clips screen shows it (blueprint section 3): an
 * `Alert variant="warning"` with the API's sentence, plus what helps next.
 * A plan limit (`clips_*`, `channel_limit`) offers See Plans; a link we
 * cannot read (another site, a platform resting or paused) offers Upload A
 * Video. The sentence is the API's own, so nothing is mapped here.
 */
import { UploadIcon } from '@animateicons/react/lucide/upload-icon';
import { Alert, Button, cn, MotionIcon } from '@postgear/ui';
import { TriangleAlert } from 'lucide-react';
import { ActionLink } from '@/components/home/home-actions';
import { refusalExtras } from './home-model';

export function RefusalAlert({
  message,
  code,
  orgId,
  onUpload,
  onRetry,
  className,
}: {
  message: string;
  code: string | undefined;
  orgId: string;
  /** Offered for a link we cannot read, when the page can upload. */
  onUpload?: () => void;
  /** Offered when trying again could help (a list that did not load). */
  onRetry?: () => void;
  className?: string;
}) {
  const extras = refusalExtras(code);
  const upload = extras.upload && onUpload;

  return (
    <Alert variant="warning" className={cn('items-center', className)} data-code={code}>
      <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
      <p className="m-0 min-w-0 flex-1">{message}</p>
      {extras.seePlans || upload || onRetry ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Try Again
            </Button>
          ) : null}
          {upload ? (
            <Button variant="secondary" size="sm" onClick={onUpload}>
              <MotionIcon icon={UploadIcon} className="h-4 w-4" />
              Upload A Video
            </Button>
          ) : null}
          {extras.seePlans ? (
            <ActionLink href={`/${encodeURIComponent(orgId)}/settings/billing`}>
              See Plans
            </ActionLink>
          ) : null}
        </div>
      ) : null}
    </Alert>
  );
}
