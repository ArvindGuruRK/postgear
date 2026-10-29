'use client';

/**
 * The Output pane (blueprint 5.2) and the pin controls it shares with the
 * Test tab. Until Module 08 runs a step, its output is what is pinned:
 *
 * - nothing pinned: "Test this step to see its result." and **Pin Data**,
 *   which opens the editor on the built-in sample;
 * - pinned here: the data in the Data, Table and Raw views, with **Edit
 *   Pinned Data** in Raw and **Unpin** in one click;
 * - pinned earlier: the API keeps the data to itself (it lists only which
 *   steps are pinned and when), so the pane says when, and offers the
 *   editor and Unpin.
 */
import { PinIcon } from '@animateicons/react/lucide/pin-icon';
import { PinOffIcon } from '@animateicons/react/lucide/pin-off-icon';
import { type GraphNode, outputFieldsOf, type RunScope } from '@postgear/automation';
import { Badge, Button, MotionIcon, Text } from '@postgear/ui';
import { useState } from 'react';
import type { PinnedStep } from '@/types/workflows';
import { DataTable, DataTree, type DataViewKind, DataViews, RawView } from './data-view';
import { OUTPUT_EMPTY, PIN_NOTE, rawText, sampleOutput, valueTree } from './panel-view-model';
import { PinnedDataEditor } from './pinned-data-editor';

export interface PinControls {
  pinned: PinnedStep | undefined;
  /** Saves through the API; throws to show its refusal in the editor. */
  onPin: (output: unknown) => Promise<void>;
  onUnpin: () => Promise<void>;
}

function pinnedWhen(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return 'Pinned earlier.';
  return `Pinned ${date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })}.`;
}

/** Pin Data, Edit Pinned Data and Unpin, with the editor when it is open. */
export function PinArea({
  node,
  scope,
  pin,
  compact = false,
}: {
  node: GraphNode;
  scope: RunScope;
  pin: PinControls;
  /** The Test tab: no data views, only the buttons and the editor. */
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [unpinning, setUnpinning] = useState(false);
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
      <div className="flex flex-col items-start gap-2">
        {compact ? null : <Text size="sm">{OUTPUT_EMPTY}</Text>}
        <Text size="sm" muted>
          {PIN_NOTE}
        </Text>
        <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
          <MotionIcon icon={PinIcon} className="h-4 w-4" />
          Pin Data
        </Button>
      </div>
    );
  }

  if (!known || compact) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Text size="sm">{pinnedWhen(pinned.pinnedAt)}</Text>
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
      <div className="flex flex-wrap items-center gap-2">
        <Text size="sm" className="me-auto">
          {pinnedWhen(pinned.pinnedAt)}
        </Text>
        {unpinButton}
      </div>
      <DataViews
        view={view}
        onViewChange={setView}
        data={<DataTree fields={fields} label={label} />}
        table={<DataTable fields={fields} label={label} />}
        raw={
          <>
            <RawView text={rawText(pinned.output)} label={label} />
            <div className="flex justify-end">{editButton}</div>
          </>
        }
      />
    </div>
  );
}

export function OutputPane({
  node,
  scope,
  pin,
}: {
  node: GraphNode;
  scope: RunScope;
  pin: PinControls;
}) {
  return (
    <section aria-label="Output" className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <h3 className="type-heading text-base text-ink">Output</h3>
        {pin.pinned ? <Badge variant="outline">Pinned</Badge> : null}
      </div>
      <PinArea node={node} scope={scope} pin={pin} />
    </section>
  );
}
