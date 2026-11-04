'use client';

/**
 * Testing one step (Module 08, blueprint 5.1), shared by the step editor's tab
 * row and the Setup dock.
 *
 * - **Test Step** runs this one step with the saved draft; its tooltip says
 *   where its input comes from ("Using: pinned data from Set Fields."), the way
 *   the API seeds it, or why it cannot run now. The result lands in the Output
 *   pane (`step-result.tsx`).
 * - **Send for real in tests** (steps that leave PostGear): a switch with a
 *   confirm naming the effect ("This test will really send a Slack
 *   message."). Kept in the builder's memory only.
 * - **AI steps** (Module 11) run for real in tests and charge credits: one
 *   quiet line says so. Output's empty state offers Use Sample Text, which
 *   pins the step's sample output so the steps after it test for free.
 */
import { PlayIcon } from '@animateicons/react/lucide/play-icon';
import { type GraphNode, getDefinition } from '@postgear/automation';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Label,
  MotionIcon,
  Text,
  Toggle,
  TooltipHint,
} from '@postgear/ui';
import { Info, LoaderCircle } from 'lucide-react';
import { type ComponentProps, useId, useState } from 'react';
import type { PinControls } from './output-pane';
import { liveEffectSentence, runsDryInTests, type StepRunResult } from './panel-view-model';

/** What the step editor and the Setup dock need from the builder's test runs. */
export interface StepTestControls {
  /** This step's latest result: the running test's row, else its last test. */
  result: StepRunResult | null;
  /** A test runs in this builder: one at a time. */
  busy: boolean;
  /** This step's own test is starting or running. */
  testing: boolean;
  onTestStep: () => void;
  /** Send for real in tests is on for this step. */
  liveInTests: boolean;
  onLiveInTestsChange: (on: boolean) => void;
  /** "Using: pinned data from Set Fields." */
  inputLine: string | null;
  /** For Copy Details. */
  workflowName: string;
}

export const DRY_RUN_NOTE = 'This step does not send anything during tests.';
export const LIVE_NOTE = 'Tests send this for real until you leave this page.';
export const AI_TEST_NOTE = 'Testing this step uses real AI credits.';

/** AI steps charge credits when they run, tests included (Module 11). */
export function usesAiCredits(node: Pick<GraphNode, 'type' | 'typeVersion'>): boolean {
  const def = getDefinition(node.type, node.typeVersion);
  return def?.category === 'ai' && typeof def.credits === 'function';
}

/** The AI note: tests cost real credits, unless this step's output is pinned for the next ones. */
function AiCreditsNote({ pinned }: { pinned: boolean }) {
  return (
    <Text size="sm" muted className="flex items-start gap-2" data-testid="ai-test-note">
      <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.5} />
      <span>
        {AI_TEST_NOTE}
        {pinned ? ' The steps after it test with the pinned data.' : ''}
      </span>
    </Text>
  );
}

/** Send for real in tests, with the confirm that names what it does. */
function LiveInTestsSwitch({
  node,
  on,
  onChange,
}: {
  node: GraphNode;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  const id = useId();
  const [asking, setAsking] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-md border-2 border-outline p-3">
      <Text size="sm">{on ? LIVE_NOTE : DRY_RUN_NOTE}</Text>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`${id}-live`}>Send for real in tests</Label>
        <Toggle
          id={`${id}-live`}
          checked={on}
          onCheckedChange={(checked) => (checked ? setAsking(true) : onChange(false))}
          data-testid="send-for-real"
        />
      </div>
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send for real in tests?</AlertDialogTitle>
            <AlertDialogDescription>
              {liveEffectSentence(node)} It stays on for this step until you leave this page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep It Dry</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onChange(true);
                setAsking(false);
              }}
            >
              Send For Real
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Test Step, with why it cannot run now, or where its data comes from, on hover. */
export function StepTestButton({
  node,
  test,
  testId = 'test-step',
  variant,
}: {
  node: GraphNode;
  test: StepTestControls;
  /** The editor shows it on the tab row and in the panes' empty states. */
  testId?: string;
  /** Secondary everywhere but the tab row: a view has one blue button. */
  variant?: ComponentProps<typeof Button>['variant'];
}) {
  const turnedOff = node.disabled === true;
  const waitingForOther = test.busy && !test.testing;
  const reason = turnedOff
    ? 'Turn this step on to test it.'
    : waitingForOther
      ? 'Another test is running. Test this step once it ends.'
      : null;
  const button = (
    <Button
      size="sm"
      variant={variant}
      onClick={test.onTestStep}
      disabled={turnedOff || test.busy}
      data-testid={testId}
    >
      {test.testing ? (
        <LoaderCircle
          aria-hidden="true"
          className="h-4 w-4 motion-safe:animate-spin"
          strokeWidth={2.5}
        />
      ) : (
        <MotionIcon icon={PlayIcon} className="h-4 w-4" />
      )}
      {test.testing ? 'Testing...' : 'Test Step'}
    </Button>
  );
  if (reason)
    return (
      <TooltipHint label={reason} disabled>
        {button}
      </TooltipHint>
    );
  return test.inputLine ? <TooltipHint label={test.inputLine}>{button}</TooltipHint> : button;
}

/** The safety notes under Test Step: AI credits, and Send For Real. */
export function StepTestNotices({
  node,
  pin,
  test,
}: {
  node: GraphNode;
  pin: PinControls;
  /** Left out where no test runs (a component test, a read-only view). */
  test?: StepTestControls;
}) {
  const ai = usesAiCredits(node);
  const live = test !== undefined && runsDryInTests(node);
  if (!ai && !live) return null;
  return (
    <div className="flex flex-col gap-3">
      {ai ? <AiCreditsNote pinned={Boolean(pin.pinned)} /> : null}
      {live ? (
        <LiveInTestsSwitch node={node} on={test.liveInTests} onChange={test.onLiveInTestsChange} />
      ) : null}
    </div>
  );
}
