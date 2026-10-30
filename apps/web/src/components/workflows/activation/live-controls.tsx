'use client';

/**
 * The builder's live state (Module 09, blueprint 8): the status badge
 * (Draft, Active v3, Paused), Unpublished Changes with Activate Changes and
 * Discard Changes, Run Now for an active Manual workflow, and the Activate
 * switch with its turn on and pause dialogs.
 *
 * Turning on and off is for workspace admins: members see the switch
 * disabled with the reason, and no Activate Changes. Discard Changes and
 * Run Now are open to every member, as the API allows.
 */
import { PlayIcon } from '@animateicons/react/lucide/play-icon';
import { UndoIcon } from '@animateicons/react/lucide/undo-icon';
import { UploadIcon } from '@animateicons/react/lucide/upload-icon';
import type {
  AutomationGraph,
  GraphNode,
  SummaryContext,
  ValidationIssue,
} from '@postgear/automation';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Label,
  MotionIcon,
  Toggle,
  TooltipHint,
  toast,
} from '@postgear/ui';
import { useId, useMemo, useState } from 'react';
import { discardChanges, getVersion, runNow } from '@/lib/workflows-api';
import type {
  AutomationDetail,
  AutomationStatus,
  RunSummary,
  WorkspaceCatalog,
} from '@/types/workflows';
import { ManualInputsDialog } from '../runs/manual-inputs-dialog';
import { ActivationDialog, type ActivationMode } from './activation-dialog';
import {
  ADMINS_ONLY,
  activationIssues,
  CHANGES_DISCARDED,
  canRunNow,
  discardFailure,
  discardText,
  manualFields,
  runNowFailure,
  showsUnpublishedChanges,
  statusBadge,
  triggerOf,
} from './activation-model';
import { PauseDialog } from './pause-dialog';

export interface LiveControlsProps {
  automation: {
    id: string;
    name: string;
    status: AutomationStatus;
    activeVersion: number | null;
    hasUnpublishedChanges: boolean;
  };
  /** The current draft. */
  graph: AutomationGraph;
  /** The builder's latest issues for the draft. */
  issues: ValidationIssue[];
  catalog: WorkspaceCatalog | null;
  /** Workspace admins turn workflows on and off. */
  canManage: boolean;
  /** Saves pending edits first; resolves with the saved draft revision. */
  flush: () => Promise<number>;
  /** After activate, pause or discard: the page swaps in the new detail (status, graph, revision). */
  onChanged: (automation: AutomationDetail) => void;
  onOpenIssue: (issue: ValidationIssue) => void;
  /** Run Now started a live run: the page opens it in the Runs tab. */
  onRunStarted: (run: RunSummary) => void;
  /**
   * Optional: channel and connection names for the activation sentence
   * ("publish to Acme on LinkedIn"); without it the sentence counts them.
   */
  summary?: SummaryContext;
}

export function WorkflowLiveControls({
  automation,
  graph,
  issues,
  catalog,
  canManage,
  flush,
  onChanged,
  onOpenIssue,
  onRunStarted,
  summary,
}: LiveControlsProps) {
  const switchId = useId();
  const reasonId = useId();
  const [activation, setActivation] = useState<ActivationMode | null>(null);
  const [pausing, setPausing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discardBusy, setDiscardBusy] = useState(false);
  // The Manual trigger whose fields Run Now asks for; the dialog is open while set.
  const [asking, setAsking] = useState<GraphNode | null>(null);
  const [running, setRunning] = useState(false);

  const badge = statusBadge(automation.status, automation.activeVersion);
  const unpublished = showsUnpublishedChanges(automation);
  const runnable = canRunNow(automation.status, graph);
  const active = automation.status === 'ACTIVE';
  // Worked out only while the dialog is open: the draft changes on every edit.
  const dialogIssues = useMemo(
    () => (activation === null ? [] : activationIssues(graph, issues, catalog)),
    [activation, graph, issues, catalog],
  );

  /**
   * Run Now runs the live version, so with unpublished changes its own
   * trigger says which fields to ask for; the draft's is the fallback.
   */
  async function liveTrigger(): Promise<GraphNode | undefined> {
    if (automation.hasUnpublishedChanges && automation.activeVersion !== null) {
      try {
        const live = await getVersion(automation.id, automation.activeVersion);
        return triggerOf(live.graph);
      } catch {
        // Fall back to the draft's trigger.
      }
    }
    return triggerOf(graph);
  }

  async function startRun(inputs: Record<string, unknown>) {
    setRunning(true);
    try {
      const run = await runNow(automation.id, inputs);
      setAsking(null);
      onRunStarted(run);
    } catch (cause) {
      toast({ title: runNowFailure(cause), variant: 'danger' });
    } finally {
      setRunning(false);
    }
  }

  async function clickRunNow() {
    setRunning(true);
    const trigger = await liveTrigger();
    setRunning(false);
    if (trigger && manualFields(trigger).length > 0) {
      setAsking(trigger);
      return;
    }
    await startRun({});
  }

  async function discard() {
    setDiscardBusy(true);
    // Pending edits are saved first, so a late autosave cannot land on the restored draft.
    try {
      await flush();
    } catch {
      // Discarding replaces them anyway.
    }
    try {
      const next = await discardChanges(automation.id);
      toast({ title: CHANGES_DISCARDED });
      setDiscarding(false);
      onChanged(next);
    } catch (cause) {
      toast({ title: discardFailure(cause), variant: 'danger' });
    } finally {
      setDiscardBusy(false);
    }
  }

  const toggle = (
    <Toggle
      id={switchId}
      checked={active}
      disabled={!canManage}
      aria-describedby={canManage ? undefined : reasonId}
      data-testid="activate-switch"
      onCheckedChange={(next) => {
        if (next) setActivation('turnOn');
        else setPausing(true);
      }}
    />
  );

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="live-controls">
      <Badge variant={badge.variant} data-testid="status-badge">
        {badge.label}
      </Badge>

      {unpublished ? (
        <>
          <Badge variant="accent" data-testid="unpublished-badge">
            Unpublished Changes
          </Badge>
          {canManage && active ? (
            <Button variant="secondary" size="sm" onClick={() => setActivation('changes')}>
              <MotionIcon icon={UploadIcon} className="h-4 w-4" />
              Activate Changes
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={() => setDiscarding(true)}>
            <MotionIcon icon={UndoIcon} className="h-4 w-4" />
            Discard Changes
          </Button>
        </>
      ) : null}

      {runnable ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void clickRunNow()}
          disabled={running}
          data-testid="run-now"
        >
          <MotionIcon icon={PlayIcon} className="h-4 w-4" />
          {running && asking === null ? 'Starting...' : 'Run Now'}
        </Button>
      ) : null}

      <div className="flex items-center gap-2">
        <Label htmlFor={switchId} className={canManage ? undefined : 'type-muted'}>
          Activate
        </Label>
        {canManage ? (
          toggle
        ) : (
          <TooltipHint label={ADMINS_ONLY} disabled>
            {toggle}
          </TooltipHint>
        )}
        {canManage ? null : (
          <span id={reasonId} className="sr-only">
            {ADMINS_ONLY}
          </span>
        )}
      </div>

      {activation !== null ? (
        <ActivationDialog
          open
          onOpenChange={(open) => {
            if (!open) setActivation(null);
          }}
          automationId={automation.id}
          mode={activation}
          graph={graph}
          issues={dialogIssues}
          summary={summary}
          flush={flush}
          onActivated={(result) => onChanged(result.automation)}
          onOpenIssue={onOpenIssue}
        />
      ) : null}

      <PauseDialog
        open={pausing}
        onOpenChange={setPausing}
        automationId={automation.id}
        triggerType={triggerOf(graph)?.type ?? null}
        onPaused={onChanged}
      />

      <AlertDialog
        open={discarding}
        onOpenChange={(open) => {
          if (!discardBusy) setDiscarding(open);
        }}
      >
        <AlertDialogContent data-testid="discard-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard Changes?</AlertDialogTitle>
            <AlertDialogDescription>{discardText(automation.activeVersion)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={discardBusy}>Keep Editing</AlertDialogCancel>
            <Button
              variant="danger"
              onClick={() => void discard()}
              disabled={discardBusy}
              data-testid="discard-confirm"
            >
              {discardBusy ? 'Discarding...' : 'Discard Changes'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {asking ? (
        <ManualInputsDialog
          open
          onOpenChange={(open) => {
            if (!open) setAsking(null);
          }}
          trigger={asking}
          title="Run Now"
          submitLabel="Run Now"
          busy={running}
          onSubmit={(inputs) => void startRun(inputs)}
        />
      ) : null}
    </div>
  );
}
