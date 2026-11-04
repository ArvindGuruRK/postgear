'use client';

/**
 * The Output pane (blueprint 5.2) and the pin controls it shares with the
 * Test tab. Once a test ran the step (Module 08), the pane shows that
 * result (`step-result.tsx`, labelled "Last Test 14:02") with Pin This
 * Result, and the pin controls when it is pinned too. Before that, its
 * output is what is pinned:
 *
 * - nothing pinned: "No output yet" with **Test Step** and **Pin Data**, which
 *   opens the editor on the built-in sample (an AI step offers **Use Sample
 *   Text**, which pins it in one click, so no credits go on a test);
 * - pinned here: the data in the Data, Table and Raw views, with **Edit
 *   Pinned Data** and **Unpin** in one click;
 * - pinned earlier: the API keeps the data to itself (it lists only which
 *   steps are pinned and when), so the pane says when, and offers the
 *   editor and Unpin.
 */
import { PinIcon } from '@animateicons/react/lucide/pin-icon';
import { PinOffIcon } from '@animateicons/react/lucide/pin-off-icon';
import { SparklesIcon } from '@animateicons/react/lucide/sparkles-icon';
import { type GraphNode, outputFieldsOf, type RunScope, stepSample } from '@postgear/automation';
import { Badge, Button, EmptyState, MotionIcon, Text, TooltipHint, toast } from '@postgear/ui';
import { FileOutput } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { PinnedStep } from '@/types/workflows';
import { DataTable, DataTree, type DataViewKind, DataViews, RawView } from './data-view';
import { PaneHeader } from './pane-header';
import {
  OUTPUT_EMPTY,
  PIN_NOTE,
  rawText,
  type StepRunResult,
  sampleOutput,
  valueTree,
} from './panel-view-model';
import { PinnedDataEditor } from './pinned-data-editor';
import { StepResultView } from './step-result';
import { StepTestButton, type StepTestControls, usesAiCredits } from './step-test';

export interface PinControls {
  pinned: PinnedStep | undefined;
  /** Saves through the API; throws to show its refusal in the editor. */
  onPin: (output: unknown) => Promise<void>;
  onUnpin: () => Promise<void>;
}

function pinnedWhen(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return 'Pinned earlier';
  return `Pinned ${date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

/** Pin Data, Edit Pinned Data and Unpin, with the editor when it is open. */
export function PinArea({
  node,
  scope,
  pin,
  compact = false,
  test,
}: {
  node: GraphNode;
  scope: RunScope;
  pin: PinControls;
  /** Under a result: no data views, only the buttons and the editor. */
  compact?: boolean;
  /** Test Step in the empty state. */
  test?: StepTestControls;
}) {
  const [editing, setEditing] = useState(false);
  const [unpinning, setUnpinning] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [view, setView] = useState<DataViewKind>('data');
  const pinned = pin.pinned;
  const known = pinned?.output !== undefined;

  if (editing) {
    return (
      <PinnedDataEditor
        node={node}
        initialText={rawText(known ? pinned?.output : sampleOutput(node, scope))}
        onCancel={() => setEditing(false)}
        onSave={async (output) => {
          await pin.onPin(output);
          setEditing(false);
          setView('data');
        }}
      />
    );
  }

  async function unpin() {
    setUnpinning(true);
    try {
      await pin.onUnpin();
    } finally {
      setUnpinning(false);
    }
  }

  async function pinSample() {
    setPinning(true);
    try {
      await pin.onPin(stepSample(node, scope));
      toast({ title: 'Sample text pinned' });
    } catch (cause) {
      toast({
        title:
          cause instanceof Error && cause.message ? cause.message : 'That did not work. Try again.',
        variant: 'danger',
      });
    } finally {
      setPinning(false);
    }
  }

  const unpinButton = (
    <Button variant="secondary" size="sm" onClick={() => void unpin()} disabled={unpinning}>
      <MotionIcon icon={PinOffIcon} className="h-4 w-4" />
      {unpinning ? 'Unpinning...' : 'Unpin'}
    </Button>
  );
  const editButton = (
    <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
      Edit Pinned Data
    </Button>
  );

  if (!pinned) {
    return (
      <EmptyState
        icon={FileOutput}
        title="No output yet"
        description={OUTPUT_EMPTY}
        className="flex-1 justify-start pt-24"
        actions={
          <>
            {test ? (
              <StepTestButton
                node={node}
                test={test}
                testId="test-step-output"
                variant="secondary"
              />
            ) : null}
            {usesAiCredits(node) ? (
              <TooltipHint label={PIN_NOTE}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pinning}
                  onClick={() => void pinSample()}
                >
                  <MotionIcon icon={SparklesIcon} className="h-4 w-4" />
                  {pinning ? 'Pinning...' : 'Use Sample Text'}
                </Button>
              </TooltipHint>
            ) : (
              <TooltipHint label={PIN_NOTE}>
                <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                  <MotionIcon icon={PinIcon} className="h-4 w-4" />
                  Pin Data
                </Button>
              </TooltipHint>
            )}
          </>
        }
      />
    );
  }

  if (compact) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        {/* The header's badge already says Pinned; this says when. */}
        <span
          className="min-w-0 flex-1 truncate font-sans text-xs text-ink type-muted"
          title={PIN_NOTE}
        >
          {pinnedWhen(pinned.pinnedAt).replace('Pinned ', '')}
        </span>
        {editButton}
        {unpinButton}
      </div>
    );
  }

  if (!known) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Text size="sm">{pinnedWhen(pinned.pinnedAt)}.</Text>
        <Text size="sm" muted>
          {PIN_NOTE}
        </Text>
        <div className="flex flex-wrap gap-2">
          {editButton}
          {unpinButton}
        </div>
      </div>
    );
  }

  const fields = valueTree(pinned.output, outputFieldsOf(node));
  const label = `${node.name} pinned data`;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <DataViews
        view={view}
        onViewChange={setView}
        meta={
          <span className="truncate font-sans text-xs text-ink type-muted">
            {pinnedWhen(pinned.pinnedAt)}
          </span>
        }
        data={<DataTree fields={fields} label={label} />}
        table={<DataTable fields={fields} label={label} />}
        raw={<RawView text={rawText(pinned.output)} label={label} />}
      />
      <div className="flex shrink-0 justify-end gap-2">
        {editButton}
        {unpinButton}
      </div>
    </div>
  );
}

export function OutputPane({
  node,
  scope,
  pin,
  result = null,
  workflowName = '',
  test,
  connected,
}: {
  node: GraphNode;
  scope: RunScope;
  pin: PinControls;
  /** This step's latest test result (Module 08). */
  result?: StepRunResult | null;
  /** For Copy Details. */
  workflowName?: string;
  /** Test Step in the empty state. */
  test?: StepTestControls;
  /** The button to the step after this one, in the header. */
  connected?: ReactNode;
}) {
  return (
    <section aria-label="Output" className="flex min-h-0 flex-1 flex-col">
      <PaneHeader
        title={
          <>
            <h3 className="type-heading text-base text-ink">Output</h3>
            {pin.pinned ? <Badge variant="outline">Pinned</Badge> : null}
          </>
        }
      >
        {connected}
      </PaneHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 pg-scrollbar">
        {result ? (
          <>
            <StepResultView node={node} result={result} workflowName={workflowName} pin={pin} />
            {pin.pinned ? <PinArea node={node} scope={scope} pin={pin} compact /> : null}
          </>
        ) : (
          <PinArea node={node} scope={scope} pin={pin} test={test} />
        )}
      </div>
    </section>
  );
}
