'use client';

/**
 * Test Workflow (Module 08, blueprint 3 and 7): the primary button in the
 * builder's PageActions row, and Ctrl/Cmd+Enter (`startSignal`).
 *
 * - The button tests with the data the API picks (pinned trigger data,
 *   else the last real event, else the built-in sample); its menu picks
 *   one: "Use The Last Real Published Post", "Use The Built-In Sample",
 *   and "Use Pinned Data" when the trigger has pinned data.
 * - A Manual trigger with fields asks for them first (`ManualInputsDialog`).
 * - While a test runs the button becomes **Stop** (one test at a time).
 */
import { ChevronDownIcon } from '@animateicons/react/lucide/chevron-down-icon';
import { CircleStopIcon } from '@animateicons/react/lucide/circle-stop-icon';
import { PlayIcon } from '@animateicons/react/lucide/play-icon';
import type { GraphNode } from '@postgear/automation';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  MotionIcon,
} from '@postgear/ui';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ManualInputsDialog } from './manual-inputs-dialog';
import type { StartTestOptions, TriggerDataChoice } from './use-test-run';

/** "Use The Last Real ..." per trigger: the real event a test can replay. */
const LAST_REAL: Record<string, string> = {
  'trigger.postPublished': 'Use The Last Real Published Post',
  'trigger.postFailed': 'Use The Last Real Failed Post',
  'trigger.schedule': 'Use The Last Real Scheduled Run',
  'trigger.manual': 'Use The Last Real Run',
  'trigger.webhook': 'Use The Last Received Data',
};

export function lastRealLabel(triggerType: string | undefined): string {
  return (triggerType && LAST_REAL[triggerType]) || 'Use The Last Real Run';
}

/** A Manual trigger asks for its fields before a test. */
export function asksForInputs(trigger: GraphNode | undefined): trigger is GraphNode {
  const fields = trigger?.type === 'trigger.manual' ? trigger.config.fields : undefined;
  return Array.isArray(fields) && fields.length > 0;
}

export interface TestControlsProps {
  /** The workflow's trigger, if it has one. */
  trigger: GraphNode | undefined;
  /** The trigger has pinned data: "Use Pinned Data" is offered. */
  hasPinnedTrigger: boolean;
  /** A test is starting or going. */
  busy: boolean;
  /** The test has not ended: the button reads Stop. */
  running: boolean;
  stopping: boolean;
  onStart: (options: StartTestOptions) => void;
  onStop: () => void;
  /** Bumped by Ctrl/Cmd+Enter. */
  startSignal: number;
}

export function TestControls({
  trigger,
  hasPinnedTrigger,
  busy,
  running,
  stopping,
  onStart,
  onStop,
  startSignal,
}: TestControlsProps) {
  const [asking, setAsking] = useState<{ triggerData?: TriggerDataChoice } | null>(null);
  const seen = useRef(startSignal);

  function request(triggerData?: TriggerDataChoice) {
    if (busy) return;
    if (asksForInputs(trigger)) {
      setAsking(triggerData ? { triggerData } : {});
      return;
    }
    onStart(triggerData ? { triggerData } : {});
  }
  const requestRef = useRef(request);
  useLayoutEffect(() => {
    requestRef.current = request;
  });

  // Ctrl/Cmd+Enter: the same as pressing the button, once per press.
  useEffect(() => {
    if (startSignal === seen.current) return;
    seen.current = startSignal;
    requestRef.current();
  }, [startSignal]);

  if (running) {
    return (
      <Button
        size="sm"
        onClick={onStop}
        disabled={stopping}
        data-testid="stop-test"
        aria-keyshortcuts="Control+Enter Meta+Enter"
      >
        {stopping ? (
          <LoaderCircle
            aria-hidden="true"
            className="h-4 w-4 motion-safe:animate-spin"
            strokeWidth={2.5}
          />
        ) : (
          <MotionIcon icon={CircleStopIcon} className="h-4 w-4" />
        )}
        {stopping ? 'Stopping...' : 'Stop'}
      </Button>
    );
  }

  return (
    <>
      <div className="flex items-stretch" data-testid="test-controls">
        <Button
          size="sm"
          onClick={() => request()}
          disabled={busy}
          className="rounded-r-none"
          aria-keyshortcuts="Control+Enter Meta+Enter"
          data-testid="test-workflow"
        >
          {busy ? (
            <LoaderCircle
              aria-hidden="true"
              className="h-4 w-4 motion-safe:animate-spin"
              strokeWidth={2.5}
            />
          ) : (
            <MotionIcon icon={PlayIcon} className="h-4 w-4" />
          )}
          Test Workflow
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              disabled={busy}
              aria-label="Choose the test data"
              className={cn('rounded-l-none border-l-0 px-2')}
              data-testid="test-data-menu"
            >
              <MotionIcon icon={ChevronDownIcon} className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Test Data</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => request('last')}>
              {lastRealLabel(trigger?.type)}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => request('sample')}>
              Use The Built-In Sample
            </DropdownMenuItem>
            {hasPinnedTrigger ? (
              <DropdownMenuItem onSelect={() => request('pinned')}>
                Use Pinned Data
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {trigger && asksForInputs(trigger) ? (
        <ManualInputsDialog
          open={asking !== null}
          onOpenChange={(open) => !open && setAsking(null)}
          trigger={trigger}
          title="Test Workflow"
          submitLabel="Start Test"
          busy={busy}
          onSubmit={(inputs) => {
            const choice = asking ?? {};
            setAsking(null);
            onStart({ ...choice, inputs });
          }}
        />
      ) : null}
    </>
  );
}
