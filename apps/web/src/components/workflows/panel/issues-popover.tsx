'use client';

/**
 * The issues chip and its list (blueprint 3 and 6), in the builder's
 * PageActions row. The chip reads "No issues found", or the errors in red
 * ("2 Issues": they block a test and turning on) beside the warnings in
 * amber ("1 Warning": they do not). The list shows each issue with its
 * step's icon and name and the sentence; choosing one closes the list and
 * lands on the field (focus-the-field, `builder/issue-focus.ts`).
 */
import { type AutomationGraph, getDefinition, type ValidationIssue } from '@postgear/automation';
import { Button, cn, Popover, PopoverContent, PopoverTrigger } from '@postgear/ui';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { useRef, useState } from 'react';
import { AppIcon } from '../app-icon';
import { issuesChip } from '../builder/builder-view-model';

export function issueKey(issue: ValidationIssue): string {
  return [issue.code, issue.nodeKey, issue.field, issue.token, issue.edgeId, issue.message]
    .map((part) => part ?? '')
    .join('|');
}

export function IssuesPopover({
  issues,
  graph,
  onOpenIssue,
}: {
  issues: readonly ValidationIssue[];
  graph: AutomationGraph;
  onOpenIssue: (issue: ValidationIssue) => void;
}) {
  const [open, setOpen] = useState(false);
  // Set when an issue was chosen: focus belongs to its field, not back on the chip.
  const picked = useRef(false);
  const chip = issuesChip(issues);
  // Errors first, then warnings, each in the order the checks found them.
  const groups = [
    { title: 'Issues', items: issues.filter((issue) => issue.severity === 'error') },
    { title: 'Warnings', items: issues.filter((issue) => issue.severity !== 'error') },
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          disabled={issues.length === 0}
          data-testid="issues-chip"
          aria-label={issues.length === 0 ? chip.label : `${chip.label}. Show the list.`}
          className="gap-1.5"
        >
          {issues.length === 0 ? (
            <>
              <CircleCheck aria-hidden="true" className="h-4 w-4" strokeWidth={2.5} />
              {chip.label}
            </>
          ) : (
            <>
              {chip.errorLabel ? (
                <span
                  data-testid="issues-chip-errors"
                  className="flex items-center gap-1 rounded-md border-2 border-outline bg-actionDanger px-1.5 py-0.5 text-onActionLight"
                >
                  <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.5} />
                  {chip.errorLabel}
                </span>
              ) : null}
              {chip.warningLabel ? (
                <span
                  data-testid="issues-chip-warnings"
                  className="flex items-center gap-1 rounded-md border-2 border-outline bg-actionAccent px-1.5 py-0.5 text-onActionLight"
                >
                  {chip.errorLabel ? null : (
                    <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.5} />
                  )}
                  {chip.warningLabel}
                </span>
              ) : null}
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 p-2"
        data-testid="issues-list"
        onCloseAutoFocus={(event) => {
          if (!picked.current) return;
          picked.current = false;
          event.preventDefault();
        }}
      >
        <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
          {groups.map((group) =>
            group.items.length === 0 ? null : (
              <section key={group.title} aria-label={group.title} className="flex flex-col gap-1">
                {groups[0].items.length > 0 && groups[1].items.length > 0 ? (
                  <h3 className="type-label px-1.5 text-xs text-ink type-muted">{group.title}</h3>
                ) : null}
                <ul className="flex flex-col gap-1">
                  {group.items.map((issue) => (
                    <IssueRow
                      key={issueKey(issue)}
                      issue={issue}
                      graph={graph}
                      onOpen={() => {
                        picked.current = true;
                        setOpen(false);
                        onOpenIssue(issue);
                      }}
                    />
                  ))}
                </ul>
              </section>
            ),
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function IssueRow({
  issue,
  graph,
  onOpen,
}: {
  issue: ValidationIssue;
  graph: AutomationGraph;
  onOpen: () => void;
}) {
  const step = issue.nodeKey ? graph.nodes.find((node) => node.key === issue.nodeKey) : undefined;
  const icon = step ? getDefinition(step.type, step.typeVersion)?.icon : undefined;
  const error = issue.severity === 'error';
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-2 rounded-md border-2 border-transparent p-1.5 text-left outline-none hover:border-outline focus-visible:border-outline focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-focusRing"
      >
        <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-secondary text-ink">
          {icon ? (
            <AppIcon icon={icon} className="h-3.5 w-3.5" />
          ) : (
            <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.5} />
          )}
          <span
            aria-hidden="true"
            className={cn(
              'absolute -right-1.5 -bottom-1.5 h-3 w-3 rounded-sm border-2 border-outline',
              error ? 'bg-actionDanger' : 'bg-actionAccent',
            )}
          />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="type-ui truncate text-xs text-ink">{step?.name ?? 'Workflow'}</span>
          <span className="font-sans text-xs text-ink">
            <span className="sr-only">{error ? 'Error: ' : 'Warning: '}</span>
            {issue.message}
          </span>
        </span>
      </button>
    </li>
  );
}
