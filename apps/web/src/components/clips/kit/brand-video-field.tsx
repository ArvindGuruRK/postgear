'use client';

/**
 * A brand kit's intro or outro video on the kit page: the small player with
 * **Remove** when there is one, else **Upload Video**, which checks the file
 * (at most 5 seconds and 50 MB), uploads it into the Clips library and saves
 * it on the kit once it is ready (`use-brand-video-upload.ts`). A refusal is
 * a design-system Alert under the button, in one sentence.
 */
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import { UploadIcon } from '@animateicons/react/lucide/upload-icon';
import { Alert, Button, MotionIcon, Progress } from '@postgear/ui';
import { TriangleAlert } from 'lucide-react';
import { type ChangeEvent, useRef, useState } from 'react';
import { NOTE } from '@/components/studio/panel-ui';
import type { BrandVideoView } from '@/types/clips-recipes';
import { UPLOAD_ACCEPT } from '../home/home-model';
import { BRAND_VIDEO_WAITING, secondsWords } from './kit-model';
import { type BrandUploadDeps, useBrandVideoUpload } from './use-brand-video-upload';

export function BrandVideoField({
  label,
  video,
  onUploaded,
  onRemove,
  uploadDeps,
  testId,
}: {
  /** What the video is, for the player's and buttons' spoken names: "Intro", "Outro". */
  label: string;
  video: BrandVideoView | null;
  /** Saves the ready video on the kit: null when it worked, or the sentence to show. */
  onUploaded: (videoId: string) => Promise<string | null>;
  onRemove: () => Promise<void>;
  /** Tests hand in their own transport and clock. */
  uploadDeps?: BrandUploadDeps;
  testId: string;
}) {
  const upload = useBrandVideoUpload(onUploaded, uploadDeps);
  const input = useRef<HTMLInputElement | null>(null);
  const [removing, setRemoving] = useState(false);
  const { state } = upload;
  const busy = state.phase === 'uploading' || state.phase === 'waiting';

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so picking the same file again still fires.
    event.target.value = '';
    if (file) upload.start(file);
  };

  const remove = async () => {
    if (removing) return;
    setRemoving(true);
    try {
      await onRemove();
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <input
        ref={input}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onFile}
        data-testid={`${testId}-input`}
      />

      {video && !busy ? (
        <div className="flex flex-wrap items-end gap-3">
          {video.url ? (
            <video
              src={video.url}
              poster={video.posterUrl ?? undefined}
              controls
              muted
              playsInline
              preload="metadata"
              aria-label={`${label} video`}
              className="h-40 w-auto max-w-full rounded-md border-2 border-outline bg-inset"
              data-testid={`${testId}-player`}
            />
          ) : (
            <p className={NOTE}>{BRAND_VIDEO_WAITING}</p>
          )}
          <div className="flex min-w-0 flex-col gap-2">
            <p className="m-0 truncate font-sans text-sm text-ink">{video.title}</p>
            <p className={NOTE}>{secondsWords(video.durationMs)}</p>
            <Button
              variant="danger"
              size="sm"
              disabled={removing}
              onClick={() => void remove()}
              aria-label={`Remove ${label}`}
              data-testid={`${testId}-remove`}
            >
              <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
              Remove
            </Button>
          </div>
        </div>
      ) : null}

      {state.phase === 'uploading' ? (
        <div className="flex flex-col gap-2" data-testid={`${testId}-progress`}>
          <Progress value={state.percent} aria-label={`Uploading ${state.name}`} />
          <div className="flex items-center justify-between gap-3">
            <p className={NOTE}>{`Uploading ${state.name}`}</p>
            <Button variant="secondary" size="sm" onClick={upload.cancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {state.phase === 'waiting' ? (
        <p className={NOTE} data-testid={`${testId}-waiting`}>
          {BRAND_VIDEO_WAITING}
        </p>
      ) : null}

      {!video && !busy ? (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => input.current?.click()}
          aria-label={`Upload ${label} Video`}
          data-testid={`${testId}-upload`}
        >
          <MotionIcon icon={UploadIcon} className="h-4 w-4" />
          Upload Video
        </Button>
      ) : null}

      {state.phase === 'failed' ? (
        <Alert variant="warning" className="items-center" data-testid={`${testId}-error`}>
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{state.message}</p>
        </Alert>
      ) : null}
    </div>
  );
}
