'use client';

/**
 * The step panel's Test tab (Module 08, blueprint 5.1).
 *
 * - **Test Step** runs this one step with the saved draft; the line under
 *   it says where its input comes from ("Using: pinned data from Set
 *   Fields."), the way the API seeds it.
 * - **The result** (`step-result.tsx`, shared with the Output pane), then
 *   the pin controls.
 * - **Send for real in tests** (steps that leave PostGear): a switch with a
 *   confirm naming the effect ("This test will really send a Slack
 *   message."). Kept in the builder's memory only.
 * - **AI steps** (Module 11) run for real in tests and charge credits: an
 *   info notice says so, with Use Sample Text Instead, which pins the
 *   step's sample output so the steps after it test for free.
 */
import { PlayIcon } from '@animateicons/react/lucide/play-icon';
import { SparklesIcon } from '@animateicons/react/lucide/sparkles-icon';
import { type GraphNode, getDefinition, type RunScope, stepSample } from '@postgear/automation';
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
  Button,
  Label,
  MotionIcon,
  Text,
  Toggle,
  toast,
} from '@postgear/ui';
import { Info, LoaderCircle } from 'lucide-react';
import { useId, useState } from 'react';
import { PinArea, type PinControls } from './output-pane';
import {
  liveEffectSentence,
  OUTPUT_EMPTY,
  runsDryInTests,
  type StepRunResult,
} from './panel-view-model';
import { StepResultView } from './step-result';

/** What the Test tab and the Output pane need from the builder's test runs. */
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

/**
 * The AI notice: tests cost real credits. Use Sample Text Instead pins the
 * step's built-in sample output, so the steps after it test for free.
 */
function AiCreditsNotice({
  node,
  scope,
  pin,
}: {
  node: GraphNode;
  scope: RunScope;
  pin: PinControls;
}) {
  const [pinning, setPinning] = useState(false);
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
  return (
    <Alert variant="info" className="flex-wrap items-center gap-2 p-3" data-testid="ai-test-note">
      <Info aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2.5} />
      <span className="flex-1">
        {AI_TEST_NOTE}
        {pin.pinned ? ' The steps after it test with the pinned data.' : ''}
      </span>
      {pin.pinned ? null : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pinning}
          onClick={() => void pinSample()}
        >
          <MotionIcon icon={SparklesIcon} className="h-4 w-4" />
          {pinning ? 'Pinning...' : 'Use Sample Text Instead'}
        </Button>
      )}
    </Alert>
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

export function TestTab({
  node,
  scope,
  pin,
  test,
}: {
  node: GraphNode;
  scope: RunScope;
  pin: PinControls;
  /** Left out where no test runs (a component test, a read-only view). */
  test?: StepTestControls;
}) {
  const aiNotice = usesAiCredits(node) ? (
    <AiCreditsNotice node={node} scope={scope} pin={pin} />
  ) : null;

  if (!test) {
    return (
      <div className="flex flex-col gap-4">
        {aiNotice}
        <Text size="sm" muted>
          {OUTPUT_EMPTY}
        </Text>
        <PinArea node={node} scope={scope} pin={pin} compact />
      </div>
    );
  }

  const turnedOff = node.disabled === true;
  const waitingForOther = test.busy && !test.testing;
  return (
    <div className="flex flex-col gap-4" data-testid="test-tab">
      {aiNotice}
      <div className="flex flex-col items-start gap-2">
        <Button
          size="sm"
          onClick={test.onTestStep}
          disabled={turnedOff || test.busy}
          data-testid="test-step"
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
        {turnedOff ? (
          <Text size="sm" muted>
            Turn this step on to test it.
          </Text>
        ) : waitingForOther ? (
          <Text size="sm" muted>
            Another test is running. Test this step once it ends.
          </Text>
        ) : test.inputLine ? (
          <Text size="sm" muted data-testid="test-input-line">
            {test.inputLine}
          </Text>
        ) : null}
      </div>

      {runsDryInTests(node) ? (
        <LiveInTestsSwitch node={node} on={test.liveInTests} onChange={test.onLiveInTestsChange} />
      ) : null}

      {test.result ? (
        <StepResultView
          node={node}
          result={test.result}
          workflowName={test.workflowName}
          pin={pin}
        />
      ) : (
        <Text size="sm">{OUTPUT_EMPTY}</Text>
      )}

      <PinArea node={node} scope={scope} pin={pin} compact />
    </div>
  );
}
