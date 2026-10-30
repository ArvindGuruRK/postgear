'use client';

/**
 * One run in the Runs tab (Module 08, blueprint 7.3): its head (status,
 * Test or Live, trigger, times), the graph it ran (its own version, never
 * the current draft) painted read-only, and the step list. Actions: Cancel
 * Run while it runs or waits, Debug In Editor, Retry From Here on a failed
 * step, and a waiting Manual Review's card.
 */
import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { BugIcon } from '@animateicons/react/lucide/bug-icon';
import { CircleStopIcon } from '@animateicons/react/lucide/circle-stop-icon';
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
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  MotionIcon,
  Skeleton,
  Text,
  toast,
} from '@postgear/ui';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { cancelRun, getRun, retryFromHere } from '@/lib/workflows-api';
import type {
  PinnedStep,
  RunDetail as RunDetailData,
  RunSummary,
  WorkspaceCatalog,
} from '@/types/workflows';
import { RunCanvas } from '../canvas/run-canvas';
import {
  DEBUG_PINNED,
  debugErrorMessage,
  pinRunData,
  planDebug,
  skippedText,
} from './debug-in-editor';
import { retryErrorMessage } from './retry-rules';
import { failedStepKey, orderedSteps, waitingReviewKey } from './run-detail-model';
import { exactTime, type RunPatch, runRowView, TONE_BADGE } from './run-list-model';
import { isTerminalRun } from './run-model';
import { type RunInfo, RunStepList } from './run-step-list';
import { formatDuration, RUN_STATUS } from './run-words';
import { useRunStream } from './use-run-stream';

export interface RunDetailProps {
  automationId: string;
  automationName: string;
  catalog: WorkspaceCatalog | null;
  activeVersion: number | null;
  runId: string;
  /** `?review=1`: open the waiting review's card and focus its first button. */
  openReview: boolean;
  /** Phone width: back to the list. */
  onBack: () => void;
  /** Retry From Here started this run. */
  onRetried: (run: RunSummary) => void;
  /** The run's latest state, for its row in the list. */
  onRunPatch: (patch: RunPatch) => void;
  onDebugInEditor: (result: { pinned: PinnedStep[]; focusKey: string | null }) => void;
}

function scrollBehaviour(): ScrollBehavior {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  } catch {
    return 'auto';
  }
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4" data-testid="run-detail-loading">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

export function RunDetail({
  automationId,
  automationName,
  catalog,
  activeVersion,
  runId,
  openReview,
  onBack,
  onRetried,
  onRunPatch,
  onDebugInEditor,
}: RunDetailProps) {
  const stream = useRunStream(runId);
  const model = stream.model?.runId === runId ? stream.model : null;
  const [head, setHead] = useState<RunDetailData | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [focusReviewKey, setFocusReviewKey] = useState<string | null>(null);
  const [cancelAsk, setCancelAsk] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retryingKey, setRetryingKey] = useState<string | null>(null);
  const [debugAsk, setDebugAsk] = useState(false);
  const [alsoSteps, setAlsoSteps] = useState(false);
  const [debugging, setDebugging] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const reviewOpened = useRef(false);
  const alsoId = useId();

  const terminal = model ? isTerminalRun(model.runStatus) : false;

  // The head (version, trigger words, credits, trigger data) is read once,
  // and again when the run ends: credits are only final then.
  useEffect(() => {
    void terminal;
    let live = true;
    getRun(runId)
      .then((detail) => {
        if (live) setHead(detail);
      })
      .catch(() => {
        // The stream shows its own error; the head only adds words.
      });
    return () => {
      live = false;
    };
  }, [runId, terminal]);

  // Keep the run's row in the list in step with what the stream says.
  const status = model?.runStatus;
  const startedAt = model?.startedAt ?? null;
  const finishedAt = model?.finishedAt ?? null;
  useEffect(() => {
    if (status) onRunPatch({ id: runId, status, startedAt, finishedAt });
  }, [runId, status, startedAt, finishedAt, onRunPatch]);

  const steps = useMemo(() => (model ? orderedSteps(model) : []), [model]);

  const reveal = useCallback((nodeKey: string) => {
    setOpen((current) => (current.has(nodeKey) ? current : new Set(current).add(nodeKey)));
    // After the row has opened.
    requestAnimationFrame(() => {
      rows.current.get(nodeKey)?.scrollIntoView({ block: 'nearest', behavior: scrollBehaviour() });
    });
  }, []);

  // `?review=1`: open the waiting review once, focus its first button.
  useEffect(() => {
    if (!openReview || !model || reviewOpened.current) return;
    const key = waitingReviewKey(model);
    if (!key) return;
    reviewOpened.current = true;
    setSelectedKey(key);
    setFocusReviewKey(key);
    reveal(key);
  }, [openReview, model, reveal]);

  // A waiting review is always open: it is the thing to act on.
  const waitingKey = model ? waitingReviewKey(model) : null;
  const openKeys = useMemo(() => {
    if (!waitingKey || open.has(waitingKey)) return open;
    return new Set(open).add(waitingKey);
  }, [open, waitingKey]);

  const onToggle = useCallback((nodeKey: string) => {
    setSelectedKey(nodeKey);
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(nodeKey)) next.delete(nodeKey);
      else next.add(nodeKey);
      return next;
    });
  }, []);

  const onSelectStep = useCallback(
    (nodeKey: string) => {
      setSelectedKey(nodeKey);
      reveal(nodeKey);
    },
    [reveal],
  );

  const rowRef = useCallback((nodeKey: string, element: HTMLLIElement | null) => {
    if (element) rows.current.set(nodeKey, element);
    else rows.current.delete(nodeKey);
  }, []);

  const refresh = stream.refresh;
  const onReviewAnswered = useCallback(() => refresh(), [refresh]);

  const retrying = useRef(false);
  const onRetry = useCallback(
    (nodeKey: string) => {
      // One retry at a time: a second press while the first travels does nothing.
      if (retrying.current) return;
      retrying.current = true;
      setRetryingKey(nodeKey);
      retryFromHere(runId, nodeKey)
        .then((created) => {
          toast({ title: 'Retry started' });
          onRetried(created);
        })
        .catch((error: unknown) => {
          toast({ title: retryErrorMessage(error), variant: 'danger' });
        })
        .finally(() => {
          retrying.current = false;
          setRetryingKey(null);
        });
    },
    [runId, onRetried],
  );

  const runInfo: RunInfo | null = useMemo(
    () =>
      model
        ? {
            runId,
            status: model.runStatus,
            mode: model.mode,
            version: head?.version ?? null,
          }
        : null,
    [model, runId, head?.version],
  );

  const iconOf = useCallback(
    (type: string) => catalog?.steps.find((entry) => entry.type === type)?.icon ?? null,
    [catalog],
  );

  async function cancel() {
    setCancelling(true);
    try {
      await cancelRun(runId);
    } catch (error) {
      toast({
        title:
          error instanceof ApiError && error.code === 'run_finished'
            ? 'This run has already finished.'
            : error instanceof Error
              ? error.message
              : 'The run could not be cancelled. Try again in a moment.',
        variant: 'danger',
      });
    } finally {
      setCancelling(false);
      setCancelAsk(false);
      refresh();
    }
  }

  async function debug() {
    if (!model) return;
    const plan = planDebug(model, head?.triggerPayload, alsoSteps);
    if ('error' in plan) {
      setDebugError(plan.error);
      return;
    }
    setDebugging(true);
    setDebugError(null);
    try {
      const result = await pinRunData(automationId, plan);
      setDebugAsk(false);
      toast({ title: DEBUG_PINNED, description: skippedText(result.skipped.length) });
      onDebugInEditor({ pinned: result.pinned, focusKey: failedStepKey(model) });
    } catch (error) {
      setDebugError(debugErrorMessage(error));
    } finally {
      setDebugging(false);
    }
  }

  const backButton = (
    <Button variant="secondary" size="sm" onClick={onBack} className="self-start lg:hidden">
      <MotionIcon icon={ArrowLeftIcon} className="h-4 w-4" />
      Back To Runs
    </Button>
  );

  if (!model) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="p-4 pb-0 lg:hidden">{backButton}</div>
        {stream.error ? (
          <ErrorState
            title="The run could not be loaded"
            description={stream.error}
            action={{ label: 'Try Again', onClick: refresh, variant: 'secondary' }}
          />
        ) : (
          <DetailSkeleton />
        )}
      </div>
    );
  }

  if (model.automationId !== automationId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {backButton}
        <Text size="sm">This run belongs to another workflow.</Text>
      </div>
    );
  }

  const words = RUN_STATUS[model.runStatus];
  const view = head ? runRowView({ ...head, status: model.runStatus }, catalog) : null;
  const duration =
    model.startedAt && model.finishedAt
      ? formatDuration(new Date(model.finishedAt).getTime() - new Date(model.startedAt).getTime())
      : '';
  const canCancel =
    model.runStatus === 'RUNNING' || model.runStatus === 'WAITING' || model.runStatus === 'QUEUED';

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
      data-testid="run-detail"
    >
      {backButton}

      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={TONE_BADGE[words.tone]} data-testid="run-status">
              {words.label}
            </Badge>
            <Badge variant="outline">{model.mode === 'TEST' ? 'Test' : 'Live'}</Badge>
            {view ? (
              <span className="type-ui min-w-0 truncate text-sm text-ink">{view.trigger}</span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {model.startedAt ? (
              <Text size="xs" as="span" muted>
                <time dateTime={model.startedAt}>{exactTime(model.startedAt)}</time>
              </Text>
            ) : null}
            {duration ? (
              <Text size="xs" as="span" muted>
                {duration}
              </Text>
            ) : null}
            {view?.version ? (
              <Text size="xs" as="span" muted>
                {view.version}
              </Text>
            ) : null}
            {view?.credits ? (
              <Text size="xs" as="span" muted>
                {view.credits}
              </Text>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setDebugError(null);
              setDebugAsk(true);
            }}
            disabled={!model.graph}
          >
            <MotionIcon icon={BugIcon} className="h-4 w-4" />
            Debug In Editor
          </Button>
          {canCancel ? (
            <Button variant="secondary" size="sm" onClick={() => setCancelAsk(true)}>
              <MotionIcon icon={CircleStopIcon} className="h-4 w-4" />
              Cancel Run
            </Button>
          ) : null}
        </div>
      </div>

      {model.error ? (
        <Alert variant={words.tone === 'danger' ? 'danger' : 'default'}>{model.error}</Alert>
      ) : null}

      {model.graph ? (
        <RunCanvas
          graph={model.graph}
          run={model}
          catalog={catalog}
          selectedKey={selectedKey}
          onSelectStep={onSelectStep}
          className="h-72 w-full shrink-0 overflow-hidden rounded-card border-2 border-outline lg:h-96"
        />
      ) : (
        <Text size="sm" muted>
          This run has no saved steps to draw.
        </Text>
      )}

      <section aria-labelledby={`${alsoId}-steps`} className="flex flex-col gap-3">
        <h3 id={`${alsoId}-steps`} className="type-heading text-lg text-ink">
          Steps
        </h3>
        {runInfo ? (
          <RunStepList
            steps={steps}
            paint={model.paint}
            nodes={model.graph?.nodes ?? []}
            iconOf={iconOf}
            run={runInfo}
            workflowName={automationName}
            activeVersion={activeVersion}
            open={openKeys}
            selectedKey={selectedKey}
            retryingKey={retryingKey}
            focusReviewKey={focusReviewKey}
            onToggle={onToggle}
            onRetry={onRetry}
            onReviewAnswered={onReviewAnswered}
            rowRef={rowRef}
          />
        ) : null}
      </section>

      <AlertDialog open={cancelAsk} onOpenChange={(value) => !cancelling && setCancelAsk(value)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel This Run?</AlertDialogTitle>
            <AlertDialogDescription>
              Steps that already ran are not undone. The steps after them do not run.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Keep Running</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              disabled={cancelling}
              onClick={(event) => {
                event.preventDefault();
                void cancel();
              }}
            >
              {cancelling ? 'Cancelling...' : 'Cancel Run'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={debugAsk} onOpenChange={(value) => !debugging && setDebugAsk(value)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Debug In Editor</DialogTitle>
            <DialogDescription>
              The trigger data of this run becomes the trigger's pinned data, so your next test
              starts from it. Pinned data already on those steps is replaced.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex items-center gap-3">
            <Checkbox
              id={alsoId}
              checked={alsoSteps}
              onCheckedChange={(value) => setAlsoSteps(value === true)}
              disabled={debugging}
            />
            <label htmlFor={alsoId} className="font-sans text-sm font-bold text-ink">
              Also pin the results of steps that worked
            </label>
          </div>
          {debugError ? (
            <Alert variant="danger" className="mt-4">
              {debugError}
            </Alert>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" disabled={debugging} onClick={() => setDebugAsk(false)}>
              Cancel
            </Button>
            <Button disabled={debugging} onClick={() => void debug()}>
              {debugging ? 'Pinning...' : 'Pin And Open Editor'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
