'use client';

/**
 * The Setup dock (after n8n's setup panel, 2026-11-03): what is left before
 * the workflow can run, on the right of the canvas, without covering it. Each
 * step that needs something is a row that opens to its real fields and Test
 * Step, so most setup never needs the step editor. Steps already done get a
 * tick and hide behind Show Completed Steps.
 *
 * Issues that are not a step's first error still have a place here: Warnings,
 * and Workflow for what belongs to no step (no trigger yet).
 */
import { XIcon } from '@animateicons/react/lucide/x-icon';
import {
  type AutomationGraph,
  type GraphNode,
  getDefinition,
  type ValidationIssue,
} from '@postgear/automation';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Alert,
  Button,
  Label,
  MotionIcon,
  Text,
  Toggle,
} from '@postgear/ui';
import { CircleCheck, CircleCheckBig, TriangleAlert } from 'lucide-react';
import { type Dispatch, useId, useState } from 'react';
import type { FieldContext } from '../fields/contract';
import { StepGlyph } from '../list/step-glyph';
import { StepSetupFields } from '../panel/step-tabs';
import { StepTestButton, type StepTestControls } from '../panel/step-test';
import type { BuilderAction } from './builder-state';
import { issueKey, SETUP_DONE, setupGroups } from './builder-view-model';

export interface SetupDockProps {
  graph: AutomationGraph;
  issues: readonly ValidationIssue[];
  context: FieldContext;
  dispatch: Dispatch<BuilderAction>;
  test: (node: GraphNode) => StepTestControls;
  onClose: () => void;
  onOpenStep: (key: string) => void;
  /** A warning or a workflow-wide issue: lands where it lives. */
  onOpenIssue: (issue: ValidationIssue) => void;
}

function IssueLine({
  issue,
  graph,
  onOpen,
}: {
  issue: ValidationIssue;
  graph: AutomationGraph;
  onOpen: () => void;
}) {
  const step = issue.nodeKey ? graph.nodes.find((node) => node.key === issue.nodeKey) : undefined;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start gap-2 rounded-md border-2 border-outline bg-secondary p-3 text-left outline-none hover:bg-primary focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
    >
      <TriangleAlert
        aria-hidden="true"
        className={
          issue.severity === 'error'
            ? 'mt-0.5 h-4 w-4 shrink-0 text-dangerInk'
            : 'mt-0.5 h-4 w-4 shrink-0 text-ink'
        }
        strokeWidth={2.5}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        {step ? <span className="type-ui text-sm text-ink">{step.name}</span> : null}
        <span className="font-sans text-sm text-ink">{issue.message}</span>
      </span>
    </button>
  );
}

export function SetupDock({
  graph,
  issues,
  context,
  dispatch,
  test,
  onClose,
  onOpenStep,
  onOpenIssue,
}: SetupDockProps) {
  const id = useId();
  const groups = setupGroups(graph, issues);
  const [showCompleted, setShowCompleted] = useState(false);
  const firstOpen = groups.steps.find((row) => !row.done)?.node.key;
  // Until someone chooses a row, the first step left stays open, even one that arrives later.
  const [chosen, setChosen] = useState<string | null>(null);
  const shown = groups.steps.filter((row) => showCompleted || !row.done);
  const completed = groups.steps.length - groups.steps.filter((row) => !row.done).length;
  const allDone = groups.workflow.length === 0 && groups.steps.every((row) => row.done);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="setup-dock">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b-2 border-outline px-4">
        <h2 className="type-heading min-w-0 flex-1 truncate text-lg text-ink">Setup</h2>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-9 px-0"
          aria-label="Close setup"
          onClick={onClose}
        >
          <MotionIcon icon={XIcon} className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {allDone ? (
          <Alert variant="success" className="items-center" data-testid="setup-done">
            <CircleCheck aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={2.5} />
            <span>{SETUP_DONE}</span>
          </Alert>
        ) : null}

        {groups.workflow.length > 0 ? (
          <section aria-label="Workflow" className="flex flex-col gap-2">
            <h3 className="type-label text-sm text-ink type-muted">Workflow</h3>
            {groups.workflow.map((issue) => (
              <IssueLine
                key={issueKey(issue)}
                issue={issue}
                graph={graph}
                onOpen={() => onOpenIssue(issue)}
              />
            ))}
          </section>
        ) : null}

        {shown.length > 0 ? (
          <Accordion
            type="single"
            collapsible
            value={chosen ?? firstOpen ?? ''}
            onValueChange={setChosen}
            className="flex flex-col gap-2"
          >
            {shown.map(({ node, errors, done }) => (
              <AccordionItem key={node.key} value={node.key} data-testid="setup-row">
                <AccordionTrigger className="min-w-0">
                  <span className="flex min-w-0 flex-1 items-center gap-3">
                    <StepGlyph
                      icon={getDefinition(node.type, node.typeVersion)?.icon ?? 'manual'}
                      className="h-6 w-6 shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate">{node.name}</span>
                    {done ? (
                      <CircleCheckBig
                        aria-label="Done"
                        role="img"
                        className="h-4 w-4 shrink-0 text-successInk"
                        strokeWidth={2.5}
                      />
                    ) : (
                      <TriangleAlert
                        aria-label="Needs attention"
                        role="img"
                        className="h-4 w-4 shrink-0 text-dangerInk"
                        strokeWidth={2.5}
                      />
                    )}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="flex flex-col gap-4 opacity-100">
                  {/* A field says its own error; these have no field to say it. */}
                  {errors
                    .filter((issue) => !issue.field)
                    .map((issue) => (
                      <Text key={issueKey(issue)} size="sm" className="text-dangerInk">
                        {issue.message}
                      </Text>
                    ))}
                  <StepSetupFields
                    node={node}
                    graph={graph}
                    issues={errors}
                    context={context}
                    dispatch={dispatch}
                    withConfigure={errors.length > 0}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <StepTestButton
                      node={node}
                      test={test(node)}
                      testId="test-step-setup"
                      variant="secondary"
                    />
                    <Button variant="secondary" size="sm" onClick={() => onOpenStep(node.key)}>
                      Open Step
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        ) : null}

        {groups.warnings.length > 0 ? (
          <section aria-label="Warnings" className="flex flex-col gap-2">
            <h3 className="type-label text-sm text-ink type-muted">Warnings</h3>
            {groups.warnings.map((issue) => (
              <IssueLine
                key={issueKey(issue)}
                issue={issue}
                graph={graph}
                onOpen={() => onOpenIssue(issue)}
              />
            ))}
          </section>
        ) : null}
      </div>

      {completed > 0 ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-t-2 border-outline px-4 py-3">
          <Label htmlFor={`${id}-completed`}>Show completed steps</Label>
          <Toggle
            id={`${id}-completed`}
            checked={showCompleted}
            onCheckedChange={setShowCompleted}
          />
        </div>
      ) : null}
    </div>
  );
}
