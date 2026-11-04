'use client';

/**
 * One step's result in a test run (Module 08), in the Output pane. The data in the Data, Table and Raw views; an error in
 * one sentence with **Copy Details**; a dry run as "Dry run: this is what
 * would have been sent." with the message itself; why it was skipped; and
 * **Pin This Result**, which keeps it as the step's pinned data.
 */
import { CopyIcon } from '@animateicons/react/lucide/copy-icon';
import { PinIcon } from '@animateicons/react/lucide/pin-icon';
import { type GraphNode, outputFieldsOf } from '@postgear/automation';
import {
  Alert,
  Badge,
  type BadgeProps,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  MotionIcon,
  Text,
  toast,
} from '@postgear/ui';
import { ChevronRight, LoaderCircle, TriangleAlert } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { StepPaintState } from '../runs/run-model';
import { formatDuration, stepBadgeText } from '../runs/run-words';
import { DataTable, DataTree, type DataViewKind, DataViews, RawView } from './data-view';
import type { PinControls } from './output-pane';
import {
  copyDetailsText,
  dryRunContent,
  rawText,
  type StepRunResult,
  skippedSentence,
  sourceLabel,
  valueTree,
} from './panel-view-model';
import { pinErrorMessage } from './pinned-data-editor';

export const DRY_RUN_RESULT = 'Dry run: this is what would have been sent.';
export const CUT_NOTE = 'This data was cut to 64 KB.';

const PAINT_STATE: Record<StepRunResult['step']['status'], StepPaintState> = {
  QUEUED: 'queued',
  RUNNING: 'running',
  WAITING: 'waiting',
  SUCCEEDED: 'succeeded',
  DRY_RUN: 'dryRun',
  HANDLED_ERROR: 'handled',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  CANCELLED: 'cancelled',
};

const STATE_BADGE: Record<StepPaintState, NonNullable<BadgeProps['variant']>> = {
  queued: 'outline',
  running: 'primary',
  waiting: 'accent',
  succeeded: 'success',
  dryRun: 'success',
  handled: 'accent',
  failed: 'danger',
  skipped: 'outline',
  cancelled: 'outline',
};

/** The data views over any value, with the step's own field labels. */
function ResultData({
  node,
  value,
  label,
  meta,
  notice,
}: {
  node: GraphNode;
  value: unknown;
  label: string;
  meta?: ReactNode;
  notice?: ReactNode;
}) {
  const [view, setView] = useState<DataViewKind>('data');
  const fields = valueTree(value, outputFieldsOf(node));
  if (fields.length === 0) {
    return (
      <>
        {meta ? <div className="flex min-h-9 items-center gap-2">{meta}</div> : null}
        {notice}
        <RawView text={rawText(value)} label={label} />
      </>
    );
  }
  return (
    <DataViews
      view={view}
      onViewChange={setView}
      meta={meta}
      notice={notice}
      data={<DataTree fields={fields} label={label} />}
      table={<DataTable fields={fields} label={label} />}
      raw={<RawView text={rawText(value)} label={label} />}
    />
  );
}

/** What else a failure carries, beyond the sentence the Alert already says. */
function ErrorDetails({ error }: { error: unknown }) {
  const { message: _said, ...rest } = (error ?? {}) as Record<string, unknown>;
  const fields = valueTree(rest, []);
  if (fields.length === 0) return null;
  return (
    <Collapsible className="rounded-md border-2 border-outline bg-secondary">
      <CollapsibleTrigger className="group flex h-10 w-full items-center gap-2 px-3 text-left outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-focusRing">
        <ChevronRight
          aria-hidden="true"
          className="h-4 w-4 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none"
          strokeWidth={2.5}
        />
        <span className="type-ui text-sm text-ink">Error Details</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t-2 border-outline p-2">
          <DataTree fields={fields} label="Error details" />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** One step's result in a run: what the Output pane shows. */
export function StepResultView({
  node,
  result,
  workflowName,
  pin,
}: {
  node: GraphNode;
  result: StepRunResult;
  workflowName: string;
  pin?: PinControls;
}) {
  const { step } = result;
  const state = PAINT_STATE[step.status];
  const [pinning, setPinning] = useState(false);
  const duration = formatDuration(step.durationMs);
  const label = `${node.name} result`;

  function copyDetails() {
    navigator.clipboard
      .writeText(copyDetailsText({ workflowName, runId: result.runId, step }))
      .then(() => toast({ title: 'Details copied' }))
      .catch(() => toast({ title: 'The browser did not allow copying.', variant: 'danger' }));
  }

  async function pinIt() {
    if (!pin) return;
    setPinning(true);
    try {
      await pin.onPin(step.output);
      toast({ title: 'Result pinned' });
    } catch (cause) {
      toast({ title: pinErrorMessage(cause), variant: 'danger' });
    } finally {
      setPinning(false);
    }
  }

  const canPin =
    pin !== undefined &&
    (step.status === 'SUCCEEDED' || step.status === 'HANDLED_ERROR') &&
    step.output !== undefined &&
    step.output !== null &&
    // Already the pinned data: there is nothing left to pin.
    JSON.stringify(pin.pinned?.output) !== JSON.stringify(step.output);

  const head = (
    <>
      <Badge variant={STATE_BADGE[state]} className="shrink-0">
        {stepBadgeText({ state, attempts: step.attempts })}
      </Badge>
      {/* The switch beside it leaves room for the time alone; the duration is in the tooltip. */}
      <span
        className="min-w-0 truncate font-sans text-xs text-ink type-muted"
        title={duration ? `Took ${duration}` : undefined}
      >
        {sourceLabel({ kind: 'lastTest', at: result.at })}
      </span>
    </>
  );
  // The data views carry `head` on their own row, beside their switch.
  const headInRow = state === 'succeeded' || state === 'handled';

  let body: React.ReactNode = null;
  if (state === 'queued' || state === 'running') {
    body = (
      <Text size="sm" className="flex items-center gap-2">
        <LoaderCircle
          aria-hidden="true"
          className="h-4 w-4 motion-safe:animate-spin"
          strokeWidth={2.5}
        />
        {state === 'queued' ? 'Waiting to start...' : 'Running...'}
      </Text>
    );
  } else if (state === 'waiting') {
    body = <Text size="sm">Waiting for review. Open it from the bar under the canvas.</Text>;
  } else if (state === 'failed') {
    body = (
      <Alert variant="danger" className="flex-wrap items-center p-3" data-testid="step-error">
        <TriangleAlert aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2.5} />
        <span className="min-w-0 grow basis-48">{step.error?.message ?? 'This step failed.'}</span>
        <Button variant="secondary" size="sm" onClick={copyDetails}>
          <MotionIcon icon={CopyIcon} className="h-4 w-4" />
          Copy Details
        </Button>
      </Alert>
    );
  } else if (state === 'dryRun') {
    const content = dryRunContent(step.output);
    body = (
      <div className="flex flex-col gap-2" data-testid="dry-run-result">
        <Text size="sm">{DRY_RUN_RESULT}</Text>
        {content.text ? (
          <p className="whitespace-pre-wrap break-words rounded-md border-2 border-outline bg-inset p-3 font-sans text-sm text-ink">
            {content.text}
          </p>
        ) : null}
        {typeof content.data === 'object' && content.data !== null ? (
          <ResultData node={node} value={content.data} label={`${node.name} would send`} />
        ) : null}
      </div>
    );
  } else if (state === 'skipped') {
    body = <Text size="sm">{skippedSentence(step.output)}</Text>;
  } else if (state === 'cancelled') {
    body = <Text size="sm">The test was stopped before this step finished.</Text>;
  } else {
    body = (
      <ResultData
        node={node}
        value={step.output}
        label={label}
        meta={head}
        notice={
          state === 'handled' ? (
            <Alert variant="warning" className="items-center p-3">
              <TriangleAlert aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2.5} />
              <span>
                Error handled: {step.error?.message ?? 'this step failed and the run went on.'}
              </span>
            </Alert>
          ) : null
        }
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="step-result">
      {headInRow ? null : <div className="flex min-h-9 shrink-0 items-center gap-2">{head}</div>}
      {body}
      {state === 'failed' ? <ErrorDetails error={step.error} /> : null}
      {step.truncated ? (
        <Text size="sm" muted>
          {CUT_NOTE}
        </Text>
      ) : null}
      {canPin ? (
        <div className="flex shrink-0 justify-end">
          <Button variant="secondary" size="sm" onClick={() => void pinIt()} disabled={pinning}>
            <MotionIcon icon={PinIcon} className="h-4 w-4" />
            {pinning ? 'Pinning...' : 'Pin This Result'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
