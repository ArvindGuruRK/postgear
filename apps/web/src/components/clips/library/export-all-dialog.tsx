'use client';

/**
 * Export All (Module 11, section 2; blueprint section 9).
 *
 * - **First**: the quality tiles exactly as the Export tab draws them (a lock
 *   on the ones above the plan, which open the plan dialog instead), the
 *   ticked clips, and **Export**. When every clip wears the same recipe and
 *   it names a quality, that quality is picked to start with.
 * - **Then** the same dialog is the batch's list: each clip with its note
 *   (a lowered quality, already exported, already exporting) and a
 *   `Progress`, live through the batch's stream. One failure never stops
 *   the rest. It can be closed; the page's chip opens it again.
 */
import {
  Alert,
  Badge,
  Button,
  ChoiceTiles,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Progress,
} from '@postgear/ui';
import {
  allowedQualities,
  bestAllowedQuality,
  EXPORT_QUALITIES,
  type ExportQuality,
  QUALITY_LABELS,
  qualityAllowed,
  qualityLockedSentence,
} from '@postgear/video-engine';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { GroupLabel, NOTE } from '@/components/studio/panel-ui';
import { PremiumLockDialog } from '@/components/studio/premium-lock';
import { ApiError } from '@/lib/api';
import { startExportBatch } from '@/lib/clips-bulk-api';
import { listRecipes } from '@/lib/clips-recipes-api';
import { useEntitlements } from '@/lib/entitlements';
import type { ClipListItem } from '@/types/clips';
import type { ClipExportBatchJob, ClipExportBatchView } from '@/types/clips-batch';
import { qualityTileOptions } from '../editor/quality-tiles';
import { WaitingNote } from '../waiting-note';
import { jobWords } from '../waiting-words';
import { clipFacts } from '../video/video-clip-list';
import {
  batchCounts,
  batchFromStart,
  countsLine,
  EXPORT_ALL_CANCELLED_ROW,
  EXPORT_ALL_CLOSE_LINE,
  EXPORT_ALL_FAILED_ROW,
  EXPORT_ALL_UNREACHABLE,
  WAITING_LABEL,
  noteLine,
  rowState,
  sharedRecipeQuality,
} from './export-all-model';
import { useExportBatch } from './use-export-batch';

/** What the dialog shows: the clips to choose a quality for, or a batch already going. */
export type ExportAllRequest =
  | { kind: 'choose'; clips: ClipListItem[] }
  | { kind: 'batch'; batchId: string; initial?: ClipExportBatchView | null };

export function ExportAllDialog({
  orgId,
  open,
  request,
  onOpenChange,
  onStarted,
  onFinished,
}: {
  orgId: string;
  open: boolean;
  request: ExportAllRequest | null;
  onOpenChange: (open: boolean) => void;
  /** The batch began: the dialog now follows it. */
  onStarted: (view: ClipExportBatchView) => void;
  /** Every clip of the batch is done or failed. */
  onFinished?: (batchId: string) => void;
}) {
  return (
    <Dialog open={open && request !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="clips-export-all-dialog">
        {request?.kind === 'choose' ? (
          <ChooseQuality
            orgId={orgId}
            clips={request.clips}
            onCancel={() => onOpenChange(false)}
            onStarted={onStarted}
          />
        ) : request?.kind === 'batch' ? (
          <BatchList
            batchId={request.batchId}
            initial={request.initial ?? null}
            onClose={() => onOpenChange(false)}
            onFinished={onFinished}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ChooseQuality({
  orgId,
  clips,
  onCancel,
  onStarted,
}: {
  orgId: string;
  clips: ClipListItem[];
  onCancel: () => void;
  onStarted: (view: ClipExportBatchView) => void;
}) {
  const qualityId = useId();
  const { snapshot } = useEntitlements(orgId);
  const planValue = snapshot?.values['clips.export_max_quality'];
  const ceiling = typeof planValue === 'string' ? planValue : null;
  const [chosen, setChosen] = useState<ExportQuality | null>(null);
  const [recipeQuality, setRecipeQuality] = useState<ExportQuality | null>(null);
  const [lockFor, setLockFor] = useState<ExportQuality | null>(null);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // A recipe every ticked clip shares may name its export quality.
  const sharedRecipe =
    clips.length > 0 && clips.every((clip) => clip.recipeId && clip.recipeId === clips[0]?.recipeId)
      ? (clips[0]?.recipeId ?? null)
      : null;
  useEffect(() => {
    if (!sharedRecipe) return;
    const abort = new AbortController();
    listRecipes({ signal: abort.signal })
      .then(({ recipes }) => {
        if (!abort.signal.aborted) setRecipeQuality(sharedRecipeQuality(clips, recipes));
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [sharedRecipe, clips]);

  const allowed = ceiling === null ? [...EXPORT_QUALITIES] : allowedQualities(ceiling);
  const wanted = chosen ?? recipeQuality;
  const quality =
    wanted && allowed.includes(wanted)
      ? wanted
      : ceiling === null
        ? '1080p'
        : bestAllowedQuality(ceiling);

  const choose = (next: ExportQuality) => {
    if (ceiling !== null && !qualityAllowed(next, ceiling)) {
      setLockFor(next);
      return;
    }
    setChosen(next);
  };

  const start = async () => {
    setStarting(true);
    setProblem(null);
    try {
      const started = await startExportBatch(
        clips.map((clip) => clip.id),
        quality,
      );
      onStarted(batchFromStart(started, clips));
    } catch (cause) {
      setProblem(
        cause instanceof ApiError && cause.status !== 0 ? cause.message : EXPORT_ALL_UNREACHABLE,
      );
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Export All</DialogTitle>
        <DialogDescription>
          {clips.length === 1
            ? 'Export this clip at the quality you pick.'
            : `Export these ${clips.length} clips at the quality you pick.`}
        </DialogDescription>
      </DialogHeader>
      <div className="mt-4 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <GroupLabel id={qualityId}>Quality</GroupLabel>
          <ChoiceTiles<ExportQuality>
            labelledBy={qualityId}
            columns={2}
            options={qualityTileOptions(ceiling)}
            value={quality}
            disabled={starting}
            onValueChange={choose}
          />
        </div>
        <ul
          className="m-0 flex max-h-64 list-none flex-col gap-1.5 overflow-y-auto p-0 pg-scrollbar"
          aria-label="Clips To Export"
          data-testid="clips-export-all-clips"
        >
          {clips.map((clip) => (
            <li
              key={clip.id}
              className="flex items-center gap-3 rounded-md border-2 border-outline bg-inset px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate font-sans text-sm text-ink type-ui">
                {clip.title}
              </span>
              <span className="shrink-0 font-sans text-xs text-ink tabular-nums type-muted">
                {clipFacts(clip)}
              </span>
            </li>
          ))}
        </ul>
        {problem ? (
          <Alert variant="danger" className="items-center" data-testid="clips-export-all-problem">
            <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <p className="m-0 min-w-0 flex-1">{problem}</p>
          </Alert>
        ) : null}
      </div>
      <DialogFooter className="mt-5 gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={starting}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => void start()}
          disabled={starting || clips.length === 0}
          data-testid="clips-export-all-start"
        >
          {starting ? 'Starting' : 'Export'}
        </Button>
      </DialogFooter>
      <PremiumLockDialog
        open={lockFor !== null}
        onOpenChange={(next) => !next && setLockFor(null)}
        newTab
        title={lockFor ? `${QUALITY_LABELS[lockFor]} Export` : 'Export Quality'}
        description={lockFor ? qualityLockedSentence(lockFor) : undefined}
      />
    </>
  );
}

function BatchList({
  batchId,
  initial,
  onClose,
  onFinished,
}: {
  batchId: string;
  initial: ClipExportBatchView | null;
  onClose: () => void;
  onFinished?: (batchId: string) => void;
}) {
  const { view, error } = useExportBatch(batchId, initial);
  const counts = view ? batchCounts(view.jobs) : null;
  const finished = counts?.finished === true;

  useEffect(() => {
    if (finished) onFinished?.(batchId);
  }, [finished, batchId, onFinished]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Export All</DialogTitle>
        <DialogDescription aria-live="polite" data-testid="clips-export-all-counts">
          {counts ? countsLine(counts) : 'Loading the exports.'}
        </DialogDescription>
      </DialogHeader>
      <div className="mt-4 flex flex-col gap-3">
        {error && !view ? (
          <Alert variant="warning" className="items-center">
            <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <p className="m-0 min-w-0 flex-1">{error}</p>
          </Alert>
        ) : null}
        {view ? (
          <ul
            className="m-0 flex max-h-96 list-none flex-col gap-1.5 overflow-y-auto p-0 pg-scrollbar"
            aria-label="Exports"
            data-testid="clips-export-all-list"
          >
            {view.jobs.map((row) => (
              <BatchRow key={row.clipId} row={row} />
            ))}
          </ul>
        ) : null}
        {!finished ? <p className={NOTE}>{EXPORT_ALL_CLOSE_LINE}</p> : null}
      </div>
      <DialogFooter className="mt-5">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </>
  );
}

function BatchRow({ row }: { row: ClipExportBatchJob }) {
  const state = rowState(row);
  const note = noteLine(row.note, row.quality);
  const progress = row.job?.progress ?? 0;
  return (
    <li
      className="flex flex-col gap-1.5 rounded-md border-2 border-outline bg-inset px-3 py-2"
      data-testid="clips-export-all-row"
      data-state={state}
    >
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate font-sans text-sm text-ink type-ui">
          {row.clipTitle}
        </span>
        {state === 'done' ? (
          <Badge variant="success">Done</Badge>
        ) : state === 'failed' ? (
          <Badge variant="danger">Failed</Badge>
        ) : state === 'removed' ? (
          <Badge variant="outline">Skipped</Badge>
        ) : (
          <span className="shrink-0 font-sans text-xs text-ink tabular-nums type-muted">
            {state === 'skipped' ? '' : `${Math.round(progress)}%`}
          </span>
        )}
      </div>
      {note ? <p className="m-0 font-sans text-xs text-ink type-muted">{note}</p> : null}
      {state === 'running' || state === 'waiting' ? (
        <p
          className="m-0 font-sans text-xs text-ink type-muted"
          data-testid="clips-export-all-stage"
        >
          {jobWords(row.job, WAITING_LABEL)}
        </p>
      ) : null}
      {state === 'waiting' ? <WaitingNote job={row.job} /> : null}
      {state === 'running' || state === 'waiting' ? (
        <Progress
          value={progress}
          size="sm"
          aria-label={`${row.clipTitle}, ${jobWords(row.job, WAITING_LABEL)}`}
        />
      ) : null}
      {state === 'failed' ? (
        <p className="m-0 font-sans text-xs text-ink">{EXPORT_ALL_FAILED_ROW}</p>
      ) : null}
      {state === 'cancelled' ? (
        <p className="m-0 font-sans text-xs text-ink type-muted">{EXPORT_ALL_CANCELLED_ROW}</p>
      ) : null}
    </li>
  );
}
