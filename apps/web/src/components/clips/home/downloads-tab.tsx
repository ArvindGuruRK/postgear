'use client';

/**
 * The Downloads tab (Module 18; blueprint sections 4 and 11): every file this
 * workspace asked for in the last 48 hours, newest first.
 *
 * A row, by state:
 * - **Preparing**: "Getting your file, 40%" with a `Progress`, followed live
 *   through `useClipJob`; when the job ends the list is asked again (for the
 *   size and the expiry).
 * - **Ready**: the size, **Save File** (primary, small: asks the API's file
 *   route for a short-lived signed address and sends the browser there, so
 *   it saves the file under the video's name; a refusal, such as a file
 *   that expired, shows its sentence in the row), **Save To Media**
 *   (secondary, small, MP4 only, while it is not in Media yet) and "Expires
 *   in 23 hours" in `type-muted`. Once saved, an "In Media" badge.
 * - **Failed**: the reason in a danger `Alert`.
 * - **Expired**: "Expired"; only Delete is left. The page's own clock turns a
 *   row Expired on time, so Save File is never offered for a file that is gone.
 *
 * Every row's menu has **Delete Download** with a red confirm. Deleting a file
 * still being prepared stops it and gives back what it used.
 */
import { EllipsisVerticalIcon } from '@animateicons/react/lucide/ellipsis-vertical-icon';
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
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  MotionIcon,
  Progress,
  Skeleton,
  TooltipHint,
} from '@postgear/ui';
import { expiresInLine, formatBytes, isDownloadExpired } from '@postgear/video-engine';
import { Download } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { deleteDownload, saveDownloadFile, saveDownloadToMedia } from '@/lib/clips-api';
import type { DownloadView } from '@/types/clips';
import { isTerminalJob } from '../clip-job-model';
import { useClipJob } from '../use-clip-job';
import type { DownloadsState } from './use-downloads';

export const DOWNLOADS_EMPTY = 'No downloads yet. Paste a link and choose Download.';
export const DOWNLOAD_STARTED = 'Getting your file. We will keep it for 24 hours.';
export const DOWNLOAD_EXISTS = 'This file is already in your downloads.';
const NOT_THROUGH = 'That did not go through. Check your connection and try again.';
const SAVE_FAILED = 'This file was not saved to Media. Try again.';
const FAILED_FALLBACK = 'This download did not finish.';

function messageOf(cause: unknown, fallback = NOT_THROUGH): string {
  return cause instanceof ApiError && cause.status !== 0 ? cause.message : fallback;
}

/** "Getting your file, 40%"; without a number yet, just the words. */
export function preparingLine(progress: number, queued: boolean): string {
  if (queued) return 'Waiting for its turn';
  const percent = Math.max(0, Math.min(100, Math.round(progress)));
  return percent > 0 ? `Getting your file, ${percent}%` : 'Getting your file';
}

/** The row's state as the page shows it now: a ready file past its time is Expired. */
export function shownState(view: DownloadView, now: Date): DownloadView['state'] {
  if (view.state === 'ready' && isDownloadExpired(view.expiresAt, now)) return 'expired';
  return view.state;
}

export function DownloadsTab({
  downloads,
  onSettled,
}: {
  downloads: DownloadsState;
  /** A download ended or was deleted: the page reads its storage meter again. */
  onSettled?: () => void;
}) {
  const { rows, loading, error, now, refresh, replace, remove } = downloads;
  const ended = useCallback(() => {
    refresh();
    onSettled?.();
  }, [refresh, onSettled]);
  const removed = useCallback(
    (id: string) => {
      remove(id);
      onSettled?.();
    },
    [remove, onSettled],
  );

  if (loading && rows.length === 0) return <DownloadRowsSkeleton />;
  if (error && rows.length === 0) {
    return (
      <ErrorState
        title={error}
        action={{ label: 'Try Again', onClick: refresh, variant: 'secondary' }}
      />
    );
  }
  if (rows.length === 0) {
    return <EmptyState icon={Download} title={DOWNLOADS_EMPTY} />;
  }
  return (
    <ul data-testid="clips-downloads" className="m-0 flex list-none flex-col gap-3 p-0">
      {rows.map((view) => (
        <DownloadRow
          key={view.id}
          view={view}
          now={now}
          onEnded={ended}
          onChanged={replace}
          onRemoved={removed}
        />
      ))}
    </ul>
  );
}

export function DownloadRow({
  view,
  now,
  onEnded,
  onChanged,
  onRemoved,
  follow = true,
}: {
  view: DownloadView;
  now: Date;
  /** The job ended while the row was open: ask for the list again. */
  onEnded: () => void;
  onChanged: (view: DownloadView) => void;
  onRemoved: (id: string) => void;
  /** Follow a preparing row's job live (off only in tests and the playground). */
  follow?: boolean;
}) {
  const preparing = view.state === 'preparing';
  const live = useClipJob(preparing && follow ? view.id : null).job;
  const job = live ?? view.job;
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const ended = useRef(false);
  useEffect(() => {
    if (!preparing || !live || ended.current) return;
    if (isTerminalJob(live.status)) {
      ended.current = true;
      onEnded();
    }
  }, [preparing, live, onEnded]);

  const state = shownState(view, now);
  const media = view.media;
  const expires = state === 'ready' ? expiresInLine(view.expiresAt, now) : null;
  const percent = Math.max(0, Math.min(100, Math.round(job.progress)));
  // The job is done but the row has not been read again yet (a moment).
  const line =
    job.status === 'DONE'
      ? 'Your file is ready'
      : preparingLine(job.progress, job.status === 'QUEUED');

  const onSave = async () => {
    if (saving) return;
    setSaving(true);
    setActionError(null);
    try {
      onChanged(await saveDownloadToMedia(view.id));
    } catch (cause) {
      setActionError(messageOf(cause));
    } finally {
      setSaving(false);
    }
  };

  const onSaveFile = async () => {
    if (fetching) return;
    setFetching(true);
    setActionError(null);
    try {
      await saveDownloadFile(view.id);
    } catch (cause) {
      setActionError(messageOf(cause));
    } finally {
      setFetching(false);
    }
  };

  const meta = [view.label, view.bytes && state === 'ready' ? formatBytes(view.bytes) : null]
    .filter(Boolean)
    .join(', ');

  return (
    <li
      data-testid="clips-download-row"
      data-state={state}
      className="flex min-w-0 animate-fadeIn items-center gap-4 rounded-card border-2 border-outline bg-secondary p-4 shadow-surfaceSm motion-reduce:animate-none"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="m-0 truncate type-heading text-base text-ink" title={view.title}>
          {view.title}
        </h3>
        <p className="m-0 font-sans text-xs text-ink type-muted">{meta}</p>

        {state === 'preparing' ? (
          <div className="flex max-w-md flex-col gap-1 pt-1">
            <span className="font-sans text-sm font-bold text-ink">{line}</span>
            <Progress
              value={percent > 0 ? percent : 100}
              size="sm"
              striped
              animated
              aria-label={`${view.title}: ${line}`}
            />
          </div>
        ) : null}

        {state === 'failed' ? (
          <Alert variant="danger" className="mt-1 max-w-xl p-3 text-xs">
            {job.error?.message ?? FAILED_FALLBACK}
          </Alert>
        ) : null}

        {state === 'ready' && expires ? (
          <p className="m-0 font-sans text-xs text-ink type-muted">{expires}</p>
        ) : null}
        {state === 'expired' ? (
          <p className="m-0 font-sans text-xs font-bold text-ink">Expired</p>
        ) : null}

        {media?.status === 'failed' && state === 'ready' ? (
          <p className="m-0 font-sans text-xs font-bold text-dangerInk">{SAVE_FAILED}</p>
        ) : null}
        {actionError ? (
          <p role="alert" className="m-0 font-sans text-xs font-bold text-dangerInk">
            {actionError}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {state === 'ready' ? (
          <>
            {media?.status === 'saved' ? <Badge variant="success">In Media</Badge> : null}
            {media?.status === 'saving' ? (
              <Button variant="secondary" size="sm" disabled>
                Saving To Media
              </Button>
            ) : null}
            {view.canSaveToMedia ? (
              <Button variant="secondary" size="sm" disabled={saving} onClick={onSave}>
                {saving ? 'Saving To Media' : 'Save To Media'}
              </Button>
            ) : null}
            <Button
              size="sm"
              disabled={fetching}
              onClick={onSaveFile}
              data-testid="clips-download-save-file"
            >
              Save File
            </Button>
          </>
        ) : null}

        <DropdownMenu>
          <TooltipHint label="More Actions">
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`More for ${view.title}`}
                className="w-9 shrink-0 px-0"
              >
                <MotionIcon icon={EllipsisVerticalIcon} className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipHint>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="text-dangerInk" onSelect={() => setDeleting(true)}>
              <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
              Delete Download
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <DeleteDownloadDialog
        open={deleting}
        view={view}
        preparing={state === 'preparing'}
        onOpenChange={setDeleting}
        onDeleted={() => onRemoved(view.id)}
      />
    </li>
  );
}

function DeleteDownloadDialog({
  open,
  view,
  preparing,
  onOpenChange,
  onDeleted,
}: {
  open: boolean;
  view: DownloadView;
  preparing: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const confirm = async () => {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      await deleteDownload(view.id);
      onOpenChange(false);
      onDeleted();
    } catch (cause) {
      setError(
        messageOf(cause, 'The download was not deleted. Check your connection and try again.'),
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Download</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              <span className="font-bold">{view.title}</span>
              <span>
                {preparing
                  ? 'We stop getting this file and give back what it used.'
                  : 'The file goes now. Anything you saved to Media stays there.'}
              </span>
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
            disabled={working}
            onClick={(event) => {
              event.preventDefault();
              void confirm();
            }}
          >
            {working ? 'Deleting' : 'Delete Download'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Three row footprints while the list loads (blueprint section 11). */
export function DownloadRowsSkeleton() {
  return (
    <ul aria-busy="true" className="m-0 flex list-none flex-col gap-3 p-0">
      {[0, 1, 2].map((n) => (
        <li key={n} className="flex items-center gap-4 rounded-card border-2 border-outline p-4">
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-9 w-24" />
        </li>
      ))}
    </ul>
  );
}
