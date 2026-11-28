'use client';

/**
 * A video card (Module 06; blueprint section 4), in each of its states:
 *
 * - **Ready**: the poster (16:9), the title (two lines at most), "Twitch,
 *   3 h 42 min, 12 clips", "Kept until 28 Nov", Open and the menu.
 * - **Coming in**: the poster area is `bg-inset` with a `Progress`, the step
 *   in words and, once the job can tell, "About 4 minutes left"; Cancel. A
 *   job waiting for a slot says "Waiting for our turn" with its time when
 *   the API can tell, and "Plans with a higher priority go first." under it
 *   for a low priority job (Sprint 13, Module 15). The card follows its
 *   job live (`useClipJob`) and asks for its own row again when the job ends.
 * - **Failed**: an `Alert variant="danger"` with the reason and Try Again.
 *
 * A card that only holds buttons does not move on hover; its buttons do.
 * The menu holds Edit Whole Video (Module 07, when the page offers it),
 * Auto-Edit Video (Sprint 13, Module 10: a ready video, its dialog held by
 * the card), Download Original (Module 18, an uploaded video only) and
 * Delete Video, whose confirm counts the clips that go with the video.
 */
import { DownloadIcon } from '@animateicons/react/lucide/download-icon';
import { EllipsisVerticalIcon } from '@animateicons/react/lucide/ellipsis-vertical-icon';
import { ScissorsIcon } from '@animateicons/react/lucide/scissors-icon';
import { WandSparklesIcon } from '@animateicons/react/lucide/wand-sparkles-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MotionIcon,
  Progress,
  Skeleton,
  TooltipHint,
} from '@postgear/ui';
import { CLIP_MAX_MS } from '@postgear/video-engine';
import { CircleAlert, Clock, Film } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { getVideo } from '@/lib/clips-api';
import type { ClipJobView, ClipVideoCard } from '@/types/clips';
import { PrimaryLink } from '../button-link';
import { isTerminalJob } from '../clip-job-model';
import { useClipJob } from '../use-clip-job';
import { WaitingNote } from '../waiting-note';
import { AutoEditDialog } from '../video/auto-edit-dialog';
import {
  deleteVideoSentence,
  etaLabel,
  keptUntilView,
  OPEN_TO_KEEP_HINT,
  stageLabel,
  videoMetaLine,
} from './home-model';

export const EDIT_WHOLE_TOO_LONG =
  'Edit Whole Video works for videos up to 30 minutes. Mark a range to make a clip.';

export interface VideoCardActions {
  onCancel: (videoId: string) => Promise<void>;
  onRetry: (videoId: string) => Promise<void>;
  onDelete: (videoId: string) => Promise<void>;
  /** The import ended (done, failed, cancelled): read the row again. */
  onSettled: (videoId: string) => void;
  /** Module 07: make a clip of the whole video and open it. */
  onEditWhole?: (videoId: string) => Promise<void>;
  /** Module 18: save an uploaded video's own file again. */
  onDownloadOriginal?: (videoId: string) => Promise<void>;
}

/** The card's job: the live one once it is known, else the one the list carried. */
function useLiveJob(card: ClipVideoCard, live: boolean): ClipJobView | null {
  const { job } = useClipJob(live ? (card.job?.id ?? null) : null);
  return job ?? card.job;
}

export function VideoCard({
  card,
  orgId,
  actions,
  follow = true,
  showSize = false,
  className,
}: {
  card: ClipVideoCard;
  orgId: string;
  actions: VideoCardActions;
  /** Follow a busy card's job live (off only in the playground, which has no API). */
  follow?: boolean;
  /** Module 19: sorted by size, the meta line says what the video keeps. */
  showSize?: boolean;
  className?: string;
}) {
  const { video } = card;
  const importing = video.status === 'IMPORTING';
  const job = useLiveJob(card, importing && follow);
  const [busy, setBusy] = useState<null | 'cancel' | 'retry' | 'whole' | 'original'>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [autoEditOpen, setAutoEditOpenState] = useState(false);
  // Mounted on first use and kept, so a run started there still opens its clip once closed.
  const [autoEditUsed, setAutoEditUsed] = useState(false);
  const setAutoEditOpen = (open: boolean) => {
    if (open) setAutoEditUsed(true);
    setAutoEditOpenState(open);
  };

  // The job ended while the card was open: ask for the row again (once).
  const settled = useRef(false);
  const onSettled = actions.onSettled;
  useEffect(() => {
    if (!importing || !job || settled.current) return;
    if (isTerminalJob(job.status)) {
      settled.current = true;
      onSettled(video.id);
    }
  }, [importing, job, onSettled, video.id]);

  const run = async (
    kind: 'cancel' | 'retry' | 'whole' | 'original',
    action: () => Promise<void>,
  ) => {
    setBusy(kind);
    setActionError(null);
    try {
      await action();
    } catch (cause) {
      setActionError(
        cause instanceof ApiError && cause.status !== 0
          ? cause.message
          : 'That did not go through. Check your connection and try again.',
      );
    } finally {
      setBusy(null);
    }
  };

  const href = `/${encodeURIComponent(orgId)}/clips/video/${encodeURIComponent(video.id)}`;
  const poster = video.posterUrl && !posterFailed ? video.posterUrl : null;
  const kept = keptUntilView(video.expiresAt);
  const tooLongForWhole = (video.durationMs ?? 0) > CLIP_MAX_MS;
  const canDownloadOriginal =
    actions.onDownloadOriginal !== undefined &&
    video.status === 'READY' &&
    video.platform === 'upload';
  // The playground (no API) shows no Auto-Edit; every live card of a ready video does.
  const canAutoEdit = follow && video.status === 'READY';
  const percent = Math.max(0, Math.min(100, Math.round(job?.progress ?? 0)));
  const eta = job?.status === 'RUNNING' ? etaLabel(job.etaSeconds) : null;

  return (
    <li
      data-testid="clips-video-card"
      data-status={video.status}
      className={cn(
        'flex min-w-0 animate-fadeIn flex-col overflow-hidden rounded-card border-2 border-outline bg-secondary shadow-surfaceSm motion-reduce:animate-none',
        className,
      )}
    >
      <div className="relative aspect-video w-full border-b-2 border-outline bg-inset">
        {video.status === 'READY' && poster ? (
          // biome-ignore lint/performance/noImgElement: a short-lived signed address from our private space
          <img
            src={poster}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setPosterFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : null}
        {video.status === 'READY' && !poster ? (
          <div className="flex h-full w-full items-center justify-center">
            <Film className="h-8 w-8 text-ink" strokeWidth={2} aria-hidden="true" />
          </div>
        ) : null}
        {importing ? (
          <div className="flex h-full w-full flex-col justify-center gap-2 p-4">
            <span className="font-sans text-sm font-bold text-ink">{stageLabel(job)}</span>
            <Progress
              value={percent}
              size="sm"
              striped
              animated={job?.status === 'RUNNING'}
              aria-label={`${video.title}: ${stageLabel(job)}, ${percent}%`}
            />
            <span className="flex justify-between font-sans text-xs text-ink type-muted">
              <span className="tabular-nums">{percent}%</span>
              {eta ? <span>{eta}</span> : null}
            </span>
            <WaitingNote job={job} />
          </div>
        ) : null}
        {video.status === 'FAILED' ? (
          <div className="flex h-full w-full items-center justify-center">
            <CircleAlert className="h-8 w-8 text-ink" strokeWidth={2} aria-hidden="true" />
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="m-0 line-clamp-2 type-heading text-base text-ink" title={video.title}>
          {video.title}
        </h3>
        <p className="m-0 font-sans text-xs text-ink type-muted">
          {videoMetaLine(card, { withSize: showSize })}
        </p>
        {video.status === 'READY' && kept ? (
          kept.soon ? (
            <p
              className="m-0 inline-flex items-center gap-1 font-sans text-xs font-bold text-accentInk"
              data-testid="clips-video-removed-soon"
              title={OPEN_TO_KEEP_HINT}
            >
              <Clock className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              {kept.text}
              <span className="sr-only">. {OPEN_TO_KEEP_HINT}</span>
            </p>
          ) : (
            <p className="m-0 font-sans text-xs text-ink type-muted">{kept.text}</p>
          )
        ) : null}

        {video.status === 'FAILED' ? (
          <Alert variant="danger" className="flex-col items-start gap-2 p-3 text-xs">
            <p className="m-0">{video.error?.message ?? 'This did not finish. Try again.'}</p>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => run('retry', () => actions.onRetry(video.id))}
            >
              {busy === 'retry' ? 'Trying Again' : 'Try Again'}
            </Button>
          </Alert>
        ) : null}

        {actionError ? (
          <p role="alert" className="m-0 font-sans text-xs font-bold text-dangerInk">
            {actionError}
          </p>
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          {video.status === 'READY' ? <PrimaryLink href={href}>Open</PrimaryLink> : null}
          {importing ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => run('cancel', () => actions.onCancel(video.id))}
            >
              {busy === 'cancel' ? 'Cancelling' : 'Cancel'}
            </Button>
          ) : null}
          {video.status === 'FAILED' ? <span /> : null}

          <DropdownMenu>
            <TooltipHint label="More Actions">
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`More for ${video.title}`}
                  className="w-9 shrink-0 px-0"
                  disabled={busy !== null}
                >
                  <MotionIcon icon={EllipsisVerticalIcon} className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipHint>
            <DropdownMenuContent align="end">
              {actions.onEditWhole && video.status === 'READY' ? (
                <>
                  <DropdownMenuItem
                    disabled={tooLongForWhole}
                    title={tooLongForWhole ? EDIT_WHOLE_TOO_LONG : undefined}
                    onSelect={() => {
                      const edit = actions.onEditWhole;
                      if (edit) void run('whole', () => edit(video.id));
                    }}
                  >
                    <MotionIcon icon={ScissorsIcon} className="h-4 w-4" />
                    Edit Whole Video
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              {canAutoEdit ? (
                <>
                  <DropdownMenuItem
                    onSelect={() => setAutoEditOpen(true)}
                    data-testid="clips-video-auto-edit"
                  >
                    <MotionIcon icon={WandSparklesIcon} className="h-4 w-4" />
                    Auto-Edit Video
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              {canDownloadOriginal ? (
                <>
                  <DropdownMenuItem
                    onSelect={() => {
                      const save = actions.onDownloadOriginal;
                      if (save) void run('original', () => save(video.id));
                    }}
                  >
                    <MotionIcon icon={DownloadIcon} className="h-4 w-4" />
                    Download Original
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuItem className="text-dangerInk" onSelect={() => setDeleting(true)}>
                <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
                Delete Video
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <DeleteVideoDialog
        videoId={deleting ? video.id : null}
        title={video.title}
        onOpenChange={(open) => {
          if (!open) setDeleting(false);
        }}
        onDelete={actions.onDelete}
      />
      {canAutoEdit && autoEditUsed ? (
        <AutoEditDialog
          orgId={orgId}
          video={{ id: video.id, title: video.title, durationMs: video.durationMs ?? 0 }}
          open={autoEditOpen}
          onOpenChange={setAutoEditOpen}
        />
      ) : null}
    </li>
  );
}

/**
 * "Delete this video and its 4 clips that were never exported? Exported
 * clips stay in Media." The count is read from the video when the dialog
 * opens; the red button waits for it, so nobody confirms a wrong number.
 */
export function DeleteVideoDialog({
  videoId,
  title,
  onOpenChange,
  onDelete,
}: {
  videoId: string | null;
  title: string;
  onOpenChange: (open: boolean) => void;
  onDelete: (videoId: string) => Promise<void>;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCount(null);
    setError(null);
    if (!videoId) return;
    const controller = new AbortController();
    getVideo(videoId, { signal: controller.signal })
      .then((detail) => setCount(detail.clips.filter((clip) => !clip.exported).length))
      .catch(() => {
        // Without the count the sentence still holds: it says what stays.
        if (!controller.signal.aborted) setCount(0);
      });
    return () => controller.abort();
  }, [videoId]);

  const confirm = async () => {
    if (!videoId || working) return;
    setWorking(true);
    setError(null);
    try {
      await onDelete(videoId);
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status !== 0
          ? cause.message
          : 'The video was not deleted. Check your connection and try again.',
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <AlertDialog open={videoId !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Video</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              <span className="font-bold">{title}</span>
              {count === null ? (
                <Skeleton className="h-4 w-full" />
              ) : (
                <span data-testid="delete-video-sentence">{deleteVideoSentence(count)}</span>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="m-0 font-sans text-sm font-bold text-dangerInk">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={working}>Keep It</AlertDialogCancel>
          <AlertDialogAction
            variant="danger"
            disabled={working || count === null}
            onClick={(event) => {
              event.preventDefault();
              void confirm();
            }}
          >
            {working ? 'Deleting' : 'Delete Video'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Four card footprints while the list loads (blueprint section 11). */
export function VideoCardsSkeleton() {
  return (
    <ul aria-busy="true" className="m-0 grid list-none grid-cols-4 gap-4 p-0">
      {[0, 1, 2, 3].map((n) => (
        <li key={n} className="flex flex-col gap-2 rounded-card border-2 border-outline p-3">
          <Skeleton className="aspect-video w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-9 w-20" />
        </li>
      ))}
    </ul>
  );
}
