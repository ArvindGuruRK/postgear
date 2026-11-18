'use client';

/**
 * One upload in words (Module 06, section 4), drawn like the Media uploader's
 * rows: the file name, a `Progress`, the step ("Uploading, 48%", "Waiting for
 * your connection") and Cancel. A refusal is the usual warning alert (See
 * Plans for a plan limit); a finished upload hands over to the Videos tab.
 */
import { XIcon } from '@animateicons/react/lucide/x-icon';
import { Button, MotionIcon, Progress, TooltipHint } from '@postgear/ui';
import { FileVideo } from 'lucide-react';
import { WAITING_FOR_CONNECTION, type UploadSnapshot } from './video-uploader';
import { formatSize } from './home-model';
import { RefusalAlert } from './refusal-alert';

export function uploadStepText(upload: UploadSnapshot): string {
  switch (upload.phase) {
    case 'checking':
      return 'Checking the file';
    case 'starting':
      return 'Starting the upload';
    case 'uploading':
      return `Uploading, ${upload.percent}%`;
    case 'waiting':
      return WAITING_FOR_CONNECTION;
    case 'finishing':
      return 'Finishing the upload';
    case 'done':
      return 'Uploaded. It is in Videos now.';
    case 'cancelled':
      return 'Cancelled.';
    case 'failed':
      return upload.error ?? 'The upload did not finish.';
  }
}

const ACTIVE = new Set(['checking', 'starting', 'uploading', 'waiting', 'finishing']);

export function UploadRow({
  upload,
  orgId,
  onCancel,
  onDismiss,
}: {
  upload: UploadSnapshot;
  orgId: string;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const active = ACTIVE.has(upload.phase);

  return (
    <li
      data-testid="clips-upload-row"
      data-phase={upload.phase}
      className="flex animate-fadeIn flex-col gap-2 rounded-md border-2 border-outline bg-inset p-3 motion-reduce:animate-none"
    >
      <div className="flex items-center gap-3">
        <FileVideo className="h-5 w-5 shrink-0 text-ink" strokeWidth={2.5} aria-hidden="true" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-sans text-sm font-bold text-ink">{upload.name}</span>
          <span className="font-sans text-xs text-ink type-muted">
            {formatSize(upload.bytes)}
            {upload.phase !== 'failed' ? `, ${uploadStepText(upload)}` : ''}
          </span>
        </div>
        {active && upload.phase !== 'finishing' ? (
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        {!active ? (
          <TooltipHint label="Dismiss">
            <Button variant="ghost" size="sm" aria-label="Dismiss" onClick={onDismiss}>
              <MotionIcon icon={XIcon} className="h-4 w-4" />
            </Button>
          </TooltipHint>
        ) : null}
      </div>
      {active ? (
        <Progress
          value={upload.percent}
          size="sm"
          striped={upload.phase === 'uploading'}
          animated={upload.phase === 'uploading'}
          aria-label={`${upload.name}: ${uploadStepText(upload)}`}
        />
      ) : null}
      {upload.phase === 'failed' && upload.error ? (
        <RefusalAlert message={upload.error} code={upload.errorCode ?? undefined} orgId={orgId} />
      ) : null}
    </li>
  );
}
