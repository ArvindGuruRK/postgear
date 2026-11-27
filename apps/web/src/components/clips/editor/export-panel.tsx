'use client';

/**
 * The Export tab (Module 15 section 7).
 *
 * - **Quality**: the four tiles with their help lines. One above the plan's
 *   `clips.export_max_quality` carries the lock and opens the plan dialog
 *   instead of being chosen; with the sharp video gone, only 720p is left
 *   (the copy we kept). The best one allowed is preselected.
 * - **The summary**: "Vertical 9:16, 0:42, 1080p, about 26 MB", then the
 *   notes that are true (the mark, 60 fps on a 30 fps video, the sharp
 *   video gone or still coming, a zoom).
 * - **Preview Export**: a small copy of the whole clip through the same
 *   compiler, in a dialog (`PreviewDialog`). Export Clip is the panel's own
 *   footer button, where Next sits on every other tab.
 * - **While an export runs**: the step in words, the bar, the time left,
 *   that closing is fine, and Cancel Export. Opening the editor on a clip
 *   whose export runs picks it up (`GET /clips/:clipId/exports`).
 * - **Done**: the result card (poster, quality, size, the loudness line,
 *   Download, Send To Composer (Module 17), Open In Media), the
 *   out-of-date alert once the clip changed, and the newest five exports.
 * - **Failed**: one sentence and Try Again.
 *
 * What is on screen is saved first: an export draws the saved version.
 */
import { DownloadIcon } from '@animateicons/react/lucide/download-icon';
import { PlayIcon } from '@animateicons/react/lucide/play-icon';
import { SendIcon } from '@animateicons/react/lucide/send-icon';
import {
  Alert,
  Button,
  buttonVariants,
  ChoiceTiles,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  MotionIcon,
  Progress,
  SummaryBox,
} from '@postgear/ui';
import {
  allowedQualities,
  bestAllowedQuality,
  type ClipDocument,
  EXPORT_QUALITIES,
  type ExportQuality,
  formatBytes,
  QUALITY_LABELS,
  qualityAllowed,
  qualityLockedSentence,
} from '@postgear/video-engine';
import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';
import { NOTE, PanelSection } from '@/components/studio/panel-ui';
import { PremiumLockDialog } from '@/components/studio/premium-lock';
import { ApiError, downloadFile } from '@/lib/api';
import {
  cancelClipJob,
  exportClip,
  latestClipPreview,
  listClipExports,
  previewClip,
} from '@/lib/clips-api';
import { useEntitlements } from '@/lib/entitlements';
import type { ClipExportView, ClipPreviewView, ClipSharpState } from '@/types/clips';
import { isTerminalJob } from '../clip-job-model';
import { type ClipJobState, useClipJob } from '../use-clip-job';
import {
  changedSince,
  EXPORT_FAILED_SENTENCE,
  EXPORT_UNREACHABLE_SENTENCE,
  EXPORT_UNSAVED_SENTENCE,
  exportDate,
  exportNotes,
  isRunning,
  latestDone,
  loudnessLine,
  OUT_OF_DATE,
  PREVIEW_FAILED_SENTENCE,
  PREVIEW_LINE,
  PREVIEW_SMALLER,
  PREVIEW_STALE,
  QUALITY_LOCK_CODE,
  runningExport,
  SHARP_LOCK_LINE,
  summaryLine,
  timeLeft,
} from './export-model';
import { qualityTileOptions } from './quality-tiles';

export {
  EXPORT_FAILED_SENTENCE,
  EXPORT_UNREACHABLE_SENTENCE,
  EXPORT_UNSAVED_SENTENCE,
} from './export-model';

/** The preview's state: the dialog, its job, and the file once made. */
export interface ClipPreviewState {
  open: boolean;
  setOpen: (open: boolean) => void;
  job: ClipJobState;
  view: ClipPreviewView | null;
  starting: boolean;
  problem: string | null;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
}

export interface ClipExportState {
  quality: ExportQuality;
  setQuality: (quality: ExportQuality) => void;
  /** The highest quality this clip may export at now (the plan's, or 720p with the sharp video gone); null while unknown. */
  ceiling: string | null;
  /** The plan's own highest quality; null while unknown. */
  planCeiling: string | null;
  /** The plan puts the small mark on exports. */
  mark: boolean;
  exports: ClipExportView[];
  job: ClipJobState;
  running: boolean;
  starting: boolean;
  problem: string | null;
  jobId: string | null;
  /** The locked quality whose plan dialog is open. */
  lockFor: ExportQuality | null;
  setLockFor: (quality: ExportQuality | null) => void;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  preview: ClipPreviewState;
}

function sentenceOf(cause: unknown, fallback: string): string {
  return cause instanceof ApiError && cause.status !== 0 ? cause.message : fallback;
}

/** The export's state, kept by the editor so the top bar, the footer and the panel share it. */
export function useClipExport({
  orgId,
  clipId,
  flush,
  sharp,
}: {
  orgId: string;
  clipId: string;
  /**
   * Saves what is on screen now; the saved revision once the server has it,
   * else null. The revision goes with the export, so a clip changed in
   * another tab in between is refused (409) instead of drawn unseen.
   */
  flush: () => Promise<number | null>;
  sharp: ClipSharpState;
}): ClipExportState {
  const { snapshot } = useEntitlements(orgId);
  const planValue = snapshot?.values['clips.export_max_quality'];
  const planCeiling = typeof planValue === 'string' ? planValue : null;
  const mark = snapshot?.values['clips.export_watermark'] === true;
  // With the sharp video gone, the copy we kept is 720p: nothing above it.
  const ceiling = sharp === 'gone' && planCeiling !== null ? '720p' : planCeiling;
  const [chosen, setChosen] = useState<ExportQuality | null>(null);
  const allowed = ceiling === null ? [...EXPORT_QUALITIES] : allowedQualities(ceiling);
  const quality =
    chosen && allowed.includes(chosen)
      ? chosen
      : ceiling === null
        ? '1080p'
        : bestAllowedQuality(ceiling);

  const [exports, setExports] = useState<ClipExportView[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [lockFor, setLockFor] = useState<ExportQuality | null>(null);
  const job = useClipJob(jobId);
  const running = job.job ? !isTerminalJob(job.job.status) : false;

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      const list = await listClipExports(clipId, { signal });
      if (!signal?.aborted) setExports(list);
      return list;
    },
    [clipId],
  );

  // On open: the newest exports, and a running one followed.
  useEffect(() => {
    const abort = new AbortController();
    reload(abort.signal)
      .then((list) => {
        const run = runningExport(list);
        if (run && !abort.signal.aborted) setJobId((current) => current ?? run.job.id);
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [reload]);

  // The followed export ended: read the list again for its file and its loudness.
  const ended = job.job && isTerminalJob(job.job.status) ? `${job.job.id}:${job.job.status}` : null;
  useEffect(() => {
    if (ended) reload().catch(() => undefined);
  }, [ended, reload]);

  const start = useCallback(async () => {
    if (starting || running) return;
    setStarting(true);
    setProblem(null);
    try {
      const revision = await flush();
      if (revision === null) {
        setProblem(EXPORT_UNSAVED_SENTENCE);
        return;
      }
      const made = await exportClip(clipId, quality, revision);
      setJobId(made.id);
      setExports((list) =>
        [
          { job: made, quality, fingerprint: null, media: null, loudness: null },
          ...list.filter((row) => row.job.id !== made.id),
        ].slice(0, 5),
      );
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === QUALITY_LOCK_CODE) {
        setLockFor(quality);
        return;
      }
      if (cause instanceof ApiError && cause.code === 'export_running') {
        const list = await reload().catch(() => [] as ClipExportView[]);
        const run = runningExport(list);
        if (run) {
          setJobId(run.job.id);
          return;
        }
      }
      setProblem(sentenceOf(cause, EXPORT_UNREACHABLE_SENTENCE));
    } finally {
      setStarting(false);
    }
  }, [clipId, flush, quality, reload, running, starting]);

  const cancel = useCallback(async () => {
    if (!jobId) return;
    try {
      await cancelClipJob(jobId);
    } catch (cause) {
      setProblem(sentenceOf(cause, EXPORT_UNREACHABLE_SENTENCE));
    }
    job.refresh();
  }, [job, jobId]);

  const preview = useClipPreview({ clipId, flush });

  return {
    quality,
    setQuality: setChosen,
    ceiling,
    planCeiling,
    mark,
    exports,
    job,
    running,
    starting,
    problem,
    jobId,
    lockFor,
    setLockFor,
    start,
    cancel,
    preview,
  };
}

function useClipPreview({
  clipId,
  flush,
}: {
  clipId: string;
  flush: () => Promise<number | null>;
}): ClipPreviewState {
  const [open, setOpen] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [view, setView] = useState<ClipPreviewView | null>(null);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const job = useClipJob(jobId);

  // On open: the newest preview (a running one followed; a done one known for its stale line).
  useEffect(() => {
    const abort = new AbortController();
    latestClipPreview(clipId, { signal: abort.signal })
      .then((found) => {
        if (abort.signal.aborted) return;
        setView(found);
        if (found && isRunning(found.job)) setJobId((current) => current ?? found.job.id);
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [clipId]);

  // The followed preview is done: read it again for its address.
  const doneId = job.job?.status === 'DONE' ? job.job.id : null;
  useEffect(() => {
    if (!doneId) return;
    const abort = new AbortController();
    latestClipPreview(clipId, { signal: abort.signal })
      .then((found) => {
        if (!abort.signal.aborted) setView(found);
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [clipId, doneId]);

  const start = useCallback(async () => {
    setOpen(true);
    if (starting || isRunning(job.job)) return;
    setStarting(true);
    setProblem(null);
    try {
      const revision = await flush();
      if (revision === null) {
        setProblem(EXPORT_UNSAVED_SENTENCE);
        return;
      }
      const made = await previewClip(clipId, revision);
      setJobId(made.id);
      setView((current) => (current?.job.id === made.id ? current : null));
    } catch (cause) {
      setProblem(sentenceOf(cause, PREVIEW_FAILED_SENTENCE));
    } finally {
      setStarting(false);
    }
  }, [clipId, flush, job.job, starting]);

  const cancel = useCallback(async () => {
    if (!jobId) return;
    await cancelClipJob(jobId).catch(() => undefined);
    job.refresh();
  }, [job, jobId]);

  return { open, setOpen, job, view, starting, problem, start, cancel };
}

/**
 * The export's file, through Media's own download route. Never its storage
 * address: that is another origin, where the browser ignores `download` and
 * opens the video in the tab instead of saving it.
 */
function download(mediaId: string, name: string): Promise<void> {
  return downloadFile(`/media/${encodeURIComponent(mediaId)}/download`, name);
}

export function ExportPanel({
  orgId,
  state,
  sharp,
  document,
  sourceFps,
  onExport,
  onSend,
}: {
  orgId: string;
  state: ClipExportState;
  sharp: ClipSharpState;
  document: ClipDocument;
  /** The video's own frame rate (60 fps tiles warn on a 30 fps one); null when unknown. */
  sourceFps: number | null;
  /** Export Clip from the preview dialog and Export Again (the editor asks first about removed items). */
  onExport: () => void;
  /** Module 17: Send To Composer from the result card; `from` gets focus back. */
  onSend: (from: HTMLElement | null) => void;
}) {
  const qualityId = useId();
  const [downloadProblem, setDownloadProblem] = useState<string | null>(null);
  const view = state.job.job;
  const live = view && !isTerminalJob(view.status) ? view : null;
  const failed = view?.status === 'FAILED' ? view : null;
  const done = latestDone(state.exports);
  const stale = done ? changedSince(document, done.fingerprint) : false;
  const history = state.exports.filter((row) => row.job.status === 'DONE' && row.media !== null);

  const options = qualityTileOptions(state.ceiling);

  const choose = (quality: ExportQuality) => {
    const lockedByPlan = state.planCeiling !== null && !qualityAllowed(quality, state.planCeiling);
    if (lockedByPlan) {
      state.setLockFor(quality);
      return;
    }
    // Above 720p with the sharp video gone: the note says why; nothing to choose.
    if (state.ceiling !== null && !qualityAllowed(quality, state.ceiling)) return;
    state.setQuality(quality);
  };

  const fetchFile = (mediaId: string, name: string) => {
    setDownloadProblem(null);
    download(mediaId, name).catch((cause: unknown) =>
      setDownloadProblem(sentenceOf(cause, EXPORT_UNREACHABLE_SENTENCE)),
    );
  };

  return (
    <div className="flex flex-col gap-5 pt-1" data-testid="clip-export-panel">
      <PanelSection title="Quality" headingId={qualityId}>
        <ChoiceTiles<ExportQuality>
          labelledBy={qualityId}
          columns={2}
          options={options}
          value={state.quality}
          disabled={state.running || state.starting}
          onValueChange={choose}
        />
        {sharp === 'gone' ? <p className={NOTE}>{SHARP_LOCK_LINE}</p> : null}
      </PanelSection>

      <SummaryBox
        data-testid="clip-export-summary"
        title={summaryLine(document, state.quality)}
        notes={exportNotes({
          doc: document,
          quality: state.quality,
          mark: state.mark,
          sourceFps,
          sharp,
        })}
      />

      <div className="flex flex-col gap-2">
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => void state.preview.start()}
          data-testid="clip-preview-export"
        >
          <MotionIcon icon={PlayIcon} className="h-4 w-4" />
          Preview Export
        </Button>
      </div>

      {state.problem ? (
        <Alert variant="warning" className="items-center" data-testid="clip-export-problem">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{state.problem}</p>
        </Alert>
      ) : null}

      {live ? (
        <div className="flex flex-col gap-2" data-testid="clip-export-progress">
          <div className="flex items-center justify-between gap-3 font-sans text-sm text-ink">
            <span className="type-ui">{live.stageLabel}</span>
            <span className="tabular-nums type-muted">{Math.round(live.progress)}%</span>
          </div>
          <Progress value={live.progress} aria-label={live.stageLabel} />
          {timeLeft(live.etaSeconds) ? <p className={NOTE}>{timeLeft(live.etaSeconds)}</p> : null}
          <Button
            variant="secondary"
            size="sm"
            className="w-fit"
            onClick={() => void state.cancel()}
          >
            Cancel Export
          </Button>
        </div>
      ) : null}

      {failed ? (
        <Alert variant="danger" className="items-center" data-testid="clip-export-failed">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{EXPORT_FAILED_SENTENCE}</p>
          <Button variant="secondary" size="sm" onClick={onExport}>
            Try Again
          </Button>
        </Alert>
      ) : null}

      {done && !live && stale ? (
        <Alert variant="warning" className="items-center" data-testid="clip-export-stale">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{OUT_OF_DATE}</p>
          <Button variant="secondary" size="sm" onClick={onExport}>
            Export Again
          </Button>
        </Alert>
      ) : null}

      {done?.media ? (
        <PanelSection title="Last Export">
          <ResultCard orgId={orgId} row={done} onDownload={fetchFile} onSend={onSend} />
        </PanelSection>
      ) : null}

      {downloadProblem ? (
        <Alert variant="danger" className="items-center">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{downloadProblem}</p>
        </Alert>
      ) : null}

      {history.length > 1 ? (
        <PanelSection title="Recent Exports">
          <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="clip-export-history">
            {history.map((row) => (
              <li
                key={row.job.id}
                className="flex items-center gap-2 rounded-md border-2 border-outline bg-inset p-2"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-sans text-sm text-ink type-ui">
                    {QUALITY_LABELS[row.quality]}
                  </span>
                  <span className="font-sans text-xs text-ink type-muted">
                    {exportDate(row.job.finishedAt ?? row.job.createdAt)}
                  </span>
                </span>
                {row.media ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-8 shrink-0 px-0"
                    aria-label={`Download ${QUALITY_LABELS[row.quality]} From ${exportDate(row.job.finishedAt ?? row.job.createdAt)}`}
                    onClick={() => row.media && fetchFile(row.media.id, row.media.name)}
                  >
                    <MotionIcon icon={DownloadIcon} className="h-4 w-4" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </PanelSection>
      ) : null}

      <div className="flex flex-col gap-1 border-t-2 border-outline pt-3">
        <Link
          href="/credits/clips"
          target="_blank"
          rel="noopener"
          className="w-fit font-sans text-sm text-ink underline underline-offset-2 type-ui hover:text-actionPrimary"
        >
          Credits
        </Link>
      </div>

      <PremiumLockDialog
        open={state.lockFor !== null}
        onOpenChange={(open) => !open && state.setLockFor(null)}
        newTab
        title={state.lockFor ? `${QUALITY_LABELS[state.lockFor]} Export` : 'Export Quality'}
        description={state.lockFor ? qualityLockedSentence(state.lockFor) : undefined}
      />
      <PreviewDialog preview={state.preview} document={document} onExport={onExport} />
    </div>
  );
}

function ResultCard({
  orgId,
  row,
  onDownload,
  onSend,
}: {
  orgId: string;
  row: ClipExportView;
  onDownload: (mediaId: string, name: string) => void;
  onSend: (from: HTMLElement | null) => void;
}) {
  const media = row.media;
  if (!media) return null;
  const loudness = loudnessLine(row.loudness);
  return (
    <div
      className="flex flex-col gap-3 rounded-md border-2 border-outline bg-inset p-3"
      data-testid="clip-export-result"
    >
      <div className="flex items-center gap-3">
        {media.posterUrl ? (
          // biome-ignore lint/performance/noImgElement: a signed poster from storage, drawn as it is.
          <img
            src={media.posterUrl}
            alt=""
            className="h-16 w-16 shrink-0 rounded-sm border-2 border-outline object-cover"
          />
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-sans text-sm text-ink type-heading">{media.name}</span>
          <span className="font-sans text-xs text-ink type-muted">
            {QUALITY_LABELS[row.quality]}, {formatBytes(media.bytes)}
          </span>
          {loudness ? (
            <span
              className="font-sans text-xs text-ink type-muted"
              data-testid="clip-export-loudness"
            >
              {loudness}
            </span>
          ) : null}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => onDownload(media.id, media.name)}>
          <MotionIcon icon={DownloadIcon} className="h-4 w-4" />
          Download
        </Button>
        <Button
          size="sm"
          onClick={(event) => onSend(event.currentTarget)}
          data-testid="clip-export-send"
        >
          <MotionIcon icon={SendIcon} className="h-4 w-4" />
          Send To Composer
        </Button>
        <Link
          href={`/${encodeURIComponent(orgId)}/media`}
          className={buttonVariants({ variant: 'secondary', size: 'sm' })}
        >
          Open In Media
        </Link>
      </div>
    </div>
  );
}

function PreviewDialog({
  preview,
  document,
  onExport,
}: {
  preview: ClipPreviewState;
  document: ClipDocument;
  onExport: () => void;
}) {
  const job = preview.job.job;
  const running = preview.starting || isRunning(job);
  const failed = job?.status === 'FAILED';
  const ready =
    !running && preview.view?.job.status === 'DONE' && preview.view.url ? preview.view : null;
  const stale = ready ? changedSince(document, ready.fingerprint) : false;

  return (
    <Dialog open={preview.open} onOpenChange={preview.setOpen}>
      <DialogContent className="max-w-xl" data-testid="clip-preview-dialog">
        <DialogHeader>
          <DialogTitle>Preview Export</DialogTitle>
          <DialogDescription className="sr-only">
            {ready ? PREVIEW_SMALLER : PREVIEW_LINE}
          </DialogDescription>
        </DialogHeader>

        {preview.problem ? (
          <Alert variant="danger" className="items-center">
            <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <p className="m-0 min-w-0 flex-1">{preview.problem}</p>
          </Alert>
        ) : null}

        {running ? (
          <div className="flex flex-col gap-2" data-testid="clip-preview-progress">
            <div className="flex items-center justify-between gap-3 font-sans text-sm text-ink">
              <span className="type-ui">{job?.stageLabel ?? 'Making the preview'}</span>
              <span className="tabular-nums type-muted">{Math.round(job?.progress ?? 0)}%</span>
            </div>
            <Progress value={job?.progress ?? 0} aria-label="Making the preview" />
          </div>
        ) : failed ? (
          <Alert variant="danger" className="items-center" data-testid="clip-preview-failed">
            <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <p className="m-0 min-w-0 flex-1">{PREVIEW_FAILED_SENTENCE}</p>
            <Button variant="secondary" size="sm" onClick={() => void preview.start()}>
              Try Again
            </Button>
          </Alert>
        ) : ready?.url ? (
          <div className="flex flex-col gap-2">
            {/* biome-ignore lint/a11y/useMediaCaption: the clip's own words are in the picture; there is no caption file. */}
            <video
              key={ready.url}
              src={ready.url}
              controls
              playsInline
              className="max-h-[60vh] w-full rounded-md border-2 border-outline bg-black"
              data-testid="clip-preview-video"
            />
            {stale ? <p className={NOTE}>{PREVIEW_STALE}</p> : null}
          </div>
        ) : null}

        <DialogFooter>
          {running ? (
            <Button variant="secondary" onClick={() => void preview.cancel()}>
              Cancel
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => preview.setOpen(false)}>
              Close
            </Button>
          )}
          {ready ? (
            <Button
              onClick={() => {
                preview.setOpen(false);
                onExport();
              }}
            >
              Export Clip
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
