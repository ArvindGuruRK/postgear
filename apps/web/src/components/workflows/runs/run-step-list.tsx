'use client';

/**
 * The step list under a run's canvas (Module 08, blueprint 7.3): each step
 * in run order with its state in words, attempts and duration, opening to
 * its input and output (Data, Table, Raw). A failed step says what went
 * wrong in one sentence and what to do, with Copy Details and Retry From
 * Here; a Manual Review shows its card.
 */
import { CopyIcon } from '@animateicons/react/lucide/copy-icon';
import { RotateCcwIcon } from '@animateicons/react/lucide/rotate-ccw-icon';
import { type GraphNode, getDefinition, outputFieldsOf } from '@postgear/automation';
import { Alert, Badge, Button, cn, MotionIcon, Text, TooltipHint, toast } from '@postgear/ui';
import { ChevronDown } from 'lucide-react';
import { memo, useState } from 'react';
import type { AutomationRunMode, AutomationRunStatus, RunStep } from '@/types/workflows';
import { AppIcon } from '../app-icon';
import { DataTable, DataTree, type DataViewKind, DataViews, RawView } from '../panel/data-view';
import { rawText, valueTree, valueWords } from '../panel/panel-view-model';
import { copyDetailsText, failureNextStep, oneSentence } from './copy-details';
import { retryFromHereState } from './retry-rules';
import { ReviewCard } from './review-card';
import { isReviewStep } from './review-words';
import { CUT_NOTE, DRY_RUN_NOTE, STEP_BADGE } from './run-detail-model';
import type { StepPaint } from './run-model';
import { formatDuration, stepBadgeText } from './run-words';

function RunData({
  label,
  value,
  node,
}: {
  label: string;
  value: unknown;
  /** The step, for its own field labels (outputs only). */
  node?: GraphNode;
}) {
  const [view, setView] = useState<DataViewKind>('data');
  if (value === undefined || value === null) {
    return (
      <Text size="sm" muted>
        No data.
      </Text>
    );
  }
  const fields = valueTree(value, node ? outputFieldsOf(node) : []);
  const plain = (
    <Text size="sm" className="whitespace-pre-wrap break-words">
      {valueWords(value, 2_000)}
    </Text>
  );
  return (
    <div className="flex max-h-96 min-h-0 flex-col">
      <DataViews
        view={view}
        onViewChange={setView}
        data={fields.length ? <DataTree fields={fields} label={label} /> : plain}
        table={fields.length ? <DataTable fields={fields} label={label} /> : plain}
        raw={<RawView text={rawText(value)} label={label} />}
      />
    </div>
  );
}

export interface RunInfo {
  runId: string;
  status: AutomationRunStatus;
  mode: AutomationRunMode;
  version: number | null;
}

interface StepRowProps {
  step: RunStep;
  paint: StepPaint | undefined;
  node: GraphNode | undefined;
  icon: string | null;
  run: RunInfo;
  workflowName: string;
  activeVersion: number | null;
  open: boolean;
  selected: boolean;
  retrying: boolean;
  focusReview: boolean;
  onToggle: (nodeKey: string) => void;
  onRetry: (nodeKey: string) => void;
  onReviewAnswered: () => void;
  rowRef: (nodeKey: string, element: HTMLLIElement | null) => void;
}

async function copyDetails(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast({ title: 'Details copied' });
  } catch {
    toast({ title: 'The browser did not allow copying.', variant: 'danger' });
  }
}

function FailureBox({
  step,
  run,
  workflowName,
  activeVersion,
  retrying,
  onRetry,
}: Pick<StepRowProps, 'step' | 'run' | 'workflowName' | 'activeVersion' | 'retrying' | 'onRetry'>) {
  const handled = step.status === 'HANDLED_ERROR';
  const retry = retryFromHereState({ step, run, activeVersion });
  const message = step.error?.message ? oneSentence(step.error.message) : 'This step failed.';

  const retryButton = (
    <Button
      variant="secondary"
      size="sm"
      disabled={!retry.show || !retry.enabled || retrying}
      onClick={() => onRetry(step.nodeKey)}
    >
      <MotionIcon icon={RotateCcwIcon} className="h-4 w-4" />
      {retrying ? 'Retrying...' : 'Retry From Here'}
    </Button>
  );

  return (
    <Alert variant={handled ? 'warning' : 'danger'} className="flex-col gap-2">
      <p className="font-sans text-sm font-bold">{message}</p>
      <p className="font-sans text-sm font-medium">
        {handled
          ? 'The workflow went on through the error path, as this step is set to.'
          : failureNextStep(step.error)}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            void copyDetails(copyDetailsText({ workflowName, runId: run.runId, step }))
          }
        >
          <MotionIcon icon={CopyIcon} className="h-4 w-4" />
          Copy Details
        </Button>
        {retry.show && !handled ? (
          retry.enabled ? (
            retryButton
          ) : (
            <TooltipHint label={retry.reason} disabled>
              {retryButton}
            </TooltipHint>
          )
        ) : null}
      </div>
      {retry.show && !retry.enabled && !handled ? (
        <p className="font-sans text-xs font-medium" data-testid="retry-reason">
          {retry.reason}
        </p>
      ) : null}
    </Alert>
  );
}

const StepRow = memo(function StepRow(props: StepRowProps) {
  const { step, paint, node, icon, open, selected, focusReview, onToggle, rowRef } = props;
  const state = paint?.state ?? 'queued';
  const duration = formatDuration(step.durationMs);
  const review = isReviewStep(step);
  const failed = step.status === 'FAILED' || step.status === 'HANDLED_ERROR';
  const bodyId = `run-step-${step.id}`;

  return (
    <li
      ref={(element) => rowRef(step.nodeKey, element)}
      data-step-key={step.nodeKey}
      className={cn(
        'scroll-mt-3 rounded-card border-2 border-outline bg-secondary',
        selected ? 'shadow-surfaceMd' : '',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => onToggle(step.nodeKey)}
        className="flex w-full min-w-0 items-center gap-3 rounded-card px-3 py-2.5 text-left outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-secondary">
          {icon ? <AppIcon icon={icon} /> : null}
        </span>
        <span className="type-ui min-w-0 flex-1 truncate text-sm text-ink">{step.nodeName}</span>
        <Badge variant={STEP_BADGE[state]} className="shrink-0">
          {paint ? stepBadgeText(paint) : 'Queued'}
        </Badge>
        {duration ? (
          <Text size="xs" as="span" muted className="hidden shrink-0 sm:inline">
            {duration}
          </Text>
        ) : null}
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'h-4 w-4 shrink-0 text-ink transition-transform motion-reduce:transition-none',
            open ? 'rotate-180' : '',
          )}
          strokeWidth={3}
        />
      </button>

      {open ? (
        <div id={bodyId} className="flex flex-col gap-4 border-t-2 border-outline p-3">
          {duration ? (
            <Text size="xs" muted className="sm:hidden">
              Took {duration}
            </Text>
          ) : null}
          {failed ? <FailureBox {...props} /> : null}
          {review ? (
            <ReviewCard
              runId={props.run.runId}
              step={step}
              autoFocus={focusReview}
              onAnswered={props.onReviewAnswered}
            />
          ) : null}
          {step.status === 'DRY_RUN' ? <Text size="sm">{DRY_RUN_NOTE}</Text> : null}
          {step.truncated ? (
            <Text size="sm" muted>
              {CUT_NOTE}
            </Text>
          ) : null}
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            <section aria-label={`${step.nodeName} input`} className="flex min-w-0 flex-col gap-2">
              <h4 className="type-heading text-base text-ink">Input</h4>
              <RunData label={`${step.nodeName} input`} value={step.input} />
            </section>
            <section aria-label={`${step.nodeName} output`} className="flex min-w-0 flex-col gap-2">
              <h4 className="type-heading text-base text-ink">Output</h4>
              <RunData label={`${step.nodeName} output`} value={step.output} node={node} />
            </section>
          </div>
        </div>
      ) : null}
    </li>
  );
});

export interface RunStepListProps {
  steps: readonly RunStep[];
  paint: Record<string, StepPaint>;
  nodes: readonly GraphNode[];
  /** Step icons by type, the workspace catalog's first. */
  iconOf: (type: string) => string | null;
  run: RunInfo;
  workflowName: string;
  activeVersion: number | null;
  open: ReadonlySet<string>;
  selectedKey: string | null;
  retryingKey: string | null;
  /** The waiting review whose first button takes focus (`?review=1`). */
  focusReviewKey: string | null;
  onToggle: (nodeKey: string) => void;
  onRetry: (nodeKey: string) => void;
  onReviewAnswered: () => void;
  rowRef: (nodeKey: string, element: HTMLLIElement | null) => void;
}

export function RunStepList(props: RunStepListProps) {
  const { steps, paint, nodes, iconOf } = props;
  if (steps.length === 0) {
    return (
      <Text size="sm" muted>
        No step has started yet.
      </Text>
    );
  }
  return (
    <ol className="flex flex-col gap-2" aria-label="Steps in run order">
      {steps.map((step) => (
        <StepRow
          key={step.nodeKey}
          step={step}
          paint={paint[step.nodeKey]}
          node={nodes.find((node) => node.key === step.nodeKey)}
          icon={iconOf(step.nodeType) ?? getDefinition(step.nodeType)?.icon ?? null}
          run={props.run}
          workflowName={props.workflowName}
          activeVersion={props.activeVersion}
          open={props.open.has(step.nodeKey)}
          selected={props.selectedKey === step.nodeKey}
          retrying={props.retryingKey === step.nodeKey}
          focusReview={props.focusReviewKey === step.nodeKey}
          onToggle={props.onToggle}
          onRetry={props.onRetry}
          onReviewAnswered={props.onReviewAnswered}
          rowRef={props.rowRef}
        />
      ))}
    </ol>
  );
}
