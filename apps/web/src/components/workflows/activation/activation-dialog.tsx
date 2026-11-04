'use client';

/**
 * The activation dialog (Module 09, blueprint 8), opened by the Activate
 * switch, Activate Changes and the list's row menu.
 *
 * With errors in the draft it lists them instead, each one opening its
 * step. Otherwise it says in one sentence what the workflow will do, the AI
 * credits a run can use, a Schedule's next three runs, an optional version
 * note, and, when posts can go out without a review, the tick that Turn On
 * waits for. Turn On saves the latest edits first (`flush`), so it
 * activates exactly the draft on screen.
 */
import type { AutomationGraph, SummaryContext, ValidationIssue } from '@postgear/automation';
import { getDefinition } from '@postgear/automation';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  FormHelperText,
  FormLabel,
  SummaryBox,
  Textarea,
  timeText,
  toast,
  useTwelveHourClock,
} from '@postgear/ui';
import { Sparkles, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { activateWorkflow } from '@/lib/workflows-api';
import type { ActivationResult } from '@/types/workflows';
import { runRows } from '../fields/schedule-model';
import { StepGlyph } from '../list/step-glyph';
import { issueKey } from '../builder/builder-view-model';
import {
  type ActivationContent,
  AUTOMATIC_POSTING_TICK,
  activatedToast,
  activateFailure,
  activationContent,
  issueRows,
  canTurnOn,
  NOTE_MAX,
  saveFirstFailure,
} from './activation-model';

/** `turnOn` from the switch or the list; `changes` from Activate Changes. */
export type ActivationMode = 'turnOn' | 'changes';

export interface ActivationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  automationId: string;
  mode: ActivationMode;
  /** The draft about to go live. */
  graph: AutomationGraph;
  /** The draft's issues; any error is listed instead of the confirm. */
  issues: readonly ValidationIssue[];
  /** Channel and connection names, so the sentence can name them. */
  summary?: SummaryContext;
  /** Saves pending edits first; resolves with the saved draft revision. */
  flush: () => Promise<number>;
  onActivated: (result: ActivationResult) => void;
  onOpenIssue: (issue: ValidationIssue) => void;
}

export function ActivationDialog({
  open,
  onOpenChange,
  automationId,
  mode,
  graph,
  issues,
  summary,
  flush,
  onActivated,
  onOpenIssue,
}: ActivationDialogProps) {
  const noteId = useId();
  const tickId = useId();
  const [note, setNote] = useState('');
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The API asked for the tick although the draft here did not seem to need it.
  const [serverTick, setServerTick] = useState(false);
  const [openedAt, setOpenedAt] = useState(() => new Date().toISOString());
  const twelveHour = useTwelveHourClock();

  useEffect(() => {
    if (!open) return;
    setNote('');
    setTicked(false);
    setBusy(false);
    setError(null);
    setServerTick(false);
    setOpenedAt(new Date().toISOString());
  }, [open]);

  const content = useMemo<ActivationContent>(
    () => activationContent(graph, issues, { summary, nowIso: openedAt }),
    [graph, issues, summary, openedAt],
  );
  const needsTick = content.kind === 'confirm' && (content.needsTick || serverTick);
  const title = mode === 'changes' ? 'Activate Changes' : 'Turn On Workflow';

  async function turnOn() {
    setBusy(true);
    setError(null);
    let revision: number;
    try {
      revision = await flush();
    } catch (cause) {
      setError(saveFirstFailure(cause));
      setBusy(false);
      return;
    }
    try {
      const trimmed = note.trim();
      const result = await activateWorkflow(automationId, {
        draftRevision: revision,
        ...(trimmed ? { note: trimmed } : {}),
        ...(needsTick && ticked ? { acceptAutomaticPosting: true } : {}),
      });
      toast({
        title: activatedToast(mode === 'changes', result.version.version),
        ...(result.warnings.length > 0
          ? { description: result.warnings.join(' '), variant: 'warning' as const }
          : {}),
      });
      onActivated(result);
      onOpenChange(false);
    } catch (cause) {
      const failure = activateFailure(cause);
      if (failure.needsTick) setServerTick(true);
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent className="max-w-lg" data-testid="activation-dialog">
        {content.kind === 'issues' ? (
          <>
            <DialogHeader>
              <DialogTitle>Fix These Issues First</DialogTitle>
              <DialogDescription>
                Every step needs to be set up before the workflow can go live. Choose an issue to go
                to its step.
              </DialogDescription>
            </DialogHeader>
            <ul className="mt-4 flex max-h-80 flex-col gap-1 overflow-y-auto" aria-label="Issues">
              {issueRows(content.issues).map(({ issue, message }) => (
                <IssueRow
                  key={issueKey(issue)}
                  issue={issue}
                  message={message}
                  graph={graph}
                  onOpen={() => {
                    onOpenChange(false);
                    onOpenIssue(issue);
                  }}
                />
              ))}
            </ul>
            <DialogFooter>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (canTurnOn(needsTick, ticked, busy)) void turnOn();
            }}
          >
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription data-testid="activation-sentence">
                {content.sentence}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 flex flex-col gap-4">
              {content.credits ? (
                <p className="flex items-center gap-2 font-sans text-sm text-ink">
                  <Sparkles aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2.5} />
                  {content.credits}
                </p>
              ) : null}

              {content.scheduleRuns.length > 0 ? (
                <SummaryBox
                  rowsLabel="Next Runs"
                  rows={runRows(content.scheduleRuns, (time) => timeText(time, twelveHour))}
                />
              ) : null}

              <FormField>
                <FormLabel htmlFor={noteId}>Version note</FormLabel>
                <Textarea
                  id={noteId}
                  value={note}
                  maxLength={NOTE_MAX}
                  onChange={(event) => setNote(event.target.value.slice(0, NOTE_MAX))}
                  placeholder="Enter your note"
                  className="min-h-20"
                  disabled={busy}
                />
                <FormHelperText>
                  Optional, shown in Versions ({note.length} of {NOTE_MAX}).
                </FormHelperText>
              </FormField>

              {needsTick ? (
                <Alert variant="warning" className="items-center">
                  <Checkbox
                    id={tickId}
                    checked={ticked}
                    onCheckedChange={(value) => setTicked(value === true)}
                    disabled={busy}
                  />
                  <label htmlFor={tickId} className="font-sans text-sm font-bold">
                    {AUTOMATIC_POSTING_TICK}
                  </label>
                </Alert>
              ) : null}

              {error ? (
                <Alert variant="danger" data-testid="activation-error">
                  <TriangleAlert
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0"
                    strokeWidth={2.5}
                  />
                  <span>{error}</span>
                </Alert>
              ) : null}
            </div>

            <DialogFooter className="flex-wrap">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canTurnOn(needsTick, ticked, busy)}>
                {busy ? 'Turning On...' : mode === 'changes' ? 'Activate Changes' : 'Turn On'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function IssueRow({
  issue,
  message,
  graph,
  onOpen,
}: {
  issue: ValidationIssue;
  message: string;
  graph: AutomationGraph;
  onOpen: () => void;
}) {
  const step = issue.nodeKey ? graph.nodes.find((node) => node.key === issue.nodeKey) : undefined;
  const icon = step ? getDefinition(step.type, step.typeVersion)?.icon : undefined;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-2 rounded-md border-2 border-transparent p-1.5 text-left outline-none hover:border-outline focus-visible:border-outline focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-focusRing"
      >
        {icon ? (
          <StepGlyph icon={icon} className="h-6 w-6 shrink-0" />
        ) : (
          <TriangleAlert
            aria-hidden="true"
            className="h-6 w-6 shrink-0 text-dangerInk"
            strokeWidth={2.5}
          />
        )}
        <span className="flex min-w-0 flex-col">
          <span className="type-ui truncate text-sm text-ink">{step?.name ?? 'Workflow'}</span>
          <span className="font-sans text-sm text-ink">
            <span className="sr-only">Error: </span>
            {message}
          </span>
        </span>
      </button>
    </li>
  );
}
