'use client';

/**
 * The body of a step's panel (blueprint 5.1), shared by the docked panel
 * and the Expanded view's middle column: the Setup, Configure and Test
 * tabs, then the collapsed Settings (On Error, Retries, Notes, Turn Off).
 *
 * - **Setup and Configure** are the step's `form` drawn by the field kit's
 *   `SchemaForm`. Each edit is one `updateConfig` at its path (folded for
 *   undo like typing). Setup keeps the shared `ConnectionPicker` for a step
 *   that needs a connection when its form does not draw one, so it is
 *   never drawn twice. A step with nothing to set up has no Setup tab.
 * - **Ticks and "!"**: a tab shows a tick once its required fields are
 *   filled (`tabComplete`) and a "!" while one of its fields has an error
 *   (`tabForField` on each issue's field).
 * - **Focus-the-field**: a `focus` request switches to the tab (or opens
 *   Settings) that holds the field, then scrolls to and focuses the element
 *   carrying its `data-field-path`, waiting a few frames for it to draw.
 */
import {
  type AutomationGraph,
  type FieldPlace,
  type FormTab,
  type GraphNode,
  getDefinition,
  isTriggerType,
  type OnErrorPolicy,
  tabComplete,
  tabForField,
  type ValidationIssue,
} from '@postgear/automation';
import {
  Alert,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
  Textarea,
  Toggle,
} from '@postgear/ui';
import { Check, ChevronDown, TriangleAlert } from 'lucide-react';
import { type Dispatch, useEffect, useId, useRef, useState } from 'react';
import type { BuilderAction } from '../builder/builder-state';
import { focusField } from '../builder/issue-focus';
import { ConnectionPicker } from '../connection-picker';
import { FIELD_PATH_ATTRIBUTE, type FieldContext } from '../fields/contract';
import { SchemaForm } from '../fields/schema-form';
import type { PinControls } from './output-pane';
import { sourceLabel } from './panel-view-model';
import { type StepTestControls, TestTab } from './test-tab';

export const ON_ERROR_OPTIONS: readonly { id: OnErrorPolicy['mode']; label: string }[] = [
  { id: 'stop', label: 'Stop The Workflow' },
  { id: 'continue', label: 'Continue' },
  { id: 'branch', label: 'Use The Error Path' },
];

const WAIT_OPTIONS = [5, 15, 30, 60, 300, 600];

function waitWords(seconds: number): string {
  return seconds < 60
    ? `${seconds} seconds`
    : seconds === 60
      ? '1 minute'
      : `${seconds / 60} minutes`;
}

/** Land on a field: bumped `seq` each time, so the same field can be asked for twice. */
export interface FocusRequest {
  place: FieldPlace;
  field?: string;
  seq: number;
}

type PanelTab = FormTab | 'test';

/** How long focus-the-field waits for a field to draw (fields may mount an editor first). */
const FOCUS_FRAMES = 30;

function TabMark({ kind }: { kind: 'error' | 'done' }) {
  return kind === 'error' ? (
    <span
      data-testid="tab-mark-error"
      className="ms-1.5 flex h-4 w-4 items-center justify-center rounded-sm border-2 border-outline bg-actionDanger font-sans text-[10px] leading-none font-bold text-onActionLight"
    >
      <span aria-hidden="true">!</span>
      <span className="sr-only">, needs attention</span>
    </span>
  ) : (
    <span data-testid="tab-mark-done" className="ms-1.5 flex items-center">
      <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={3} />
      <span className="sr-only">, done</span>
    </span>
  );
}

export interface StepTabsProps {
  node: GraphNode;
  graph: AutomationGraph;
  /** This step's issues. */
  issues: readonly ValidationIssue[];
  context: FieldContext;
  dispatch: Dispatch<BuilderAction>;
  pin: PinControls;
  focus?: FocusRequest | null;
  /** A focus request for the step's name: the header that holds it focuses it. */
  onFocusName?: () => void;
  /** Module 08: Test Step, the result and Send For Real In Tests. */
  test?: StepTestControls;
  /** Bumped to show the Test tab (Test Step from a card's hover toolbar). */
  showTest?: number;
  className?: string;
}

export function StepTabs({
  node,
  graph,
  issues,
  context,
  dispatch,
  pin,
  focus = null,
  onFocusName,
  test,
  showTest = 0,
  className,
}: StepTabsProps) {
  const ids = useId();
  const def = getDefinition(node.type, node.typeVersion);
  const form = def?.form;
  const setupFields = form?.tabs.setup ?? [];
  const configureFields = form?.tabs.configure ?? [];
  const connection = def?.connection;
  // The form's own connection field wins; otherwise the shared picker stands in.
  const ownPicker =
    connection && !setupFields.some((field) => field.kind === 'connection') ? connection : null;
  const hasSetup = setupFields.length > 0 || ownPicker !== null;
  const config = node.config;

  const errorPlaces = new Set<FieldPlace>();
  for (const issue of issues) {
    if (issue.severity !== 'error' || issue.field === undefined || !def) continue;
    errorPlaces.add(tabForField(def, issue.field));
  }
  const done = (tab: FormTab, hasFields: boolean) =>
    def !== undefined && hasFields && !errorPlaces.has(tab) && tabComplete(def, tab, config);
  const setupDone = done('setup', hasSetup);
  const configureDone = done('configure', configureFields.length > 0);
  // Issues that belong to the step, not a field: shown above the tabs.
  const stepIssues = issues.filter(
    (issue) => issue.field === undefined && issue.code !== 'node.not_runnable',
  );

  const [tab, setTab] = useState<PanelTab>(() =>
    showTest > 0 ? 'test' : hasSetup && !setupDone ? 'setup' : 'configure',
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pending = useRef<FocusRequest | null>(null);
  // The tab can disappear when a step's form changes; fall back to Configure.
  const shownTab: PanelTab = tab === 'setup' && !hasSetup ? 'configure' : tab;

  useEffect(() => {
    if (!focus) return;
    if (focus.place === 'name') {
      onFocusName?.();
      return;
    }
    pending.current = focus;
    if (focus.place === 'settings') setSettingsOpen(true);
    else setTab(focus.place === 'setup' && !hasSetup ? 'configure' : focus.place);
  }, [focus, onFocusName, hasSetup]);

  useEffect(() => {
    if (showTest > 0) setTab('test');
  }, [showTest]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs again once the tab or Settings has opened, when the field is drawn
  useEffect(() => {
    const request = pending.current;
    if (!request) return;
    let frame = 0;
    let tries = 0;
    const attempt = () => {
      const box = root.current;
      if (box && (!request.field || focusField(box, request.field))) {
        if (pending.current === request) pending.current = null;
        return;
      }
      tries += 1;
      if (tries < FOCUS_FRAMES) frame = requestAnimationFrame(attempt);
      else if (pending.current === request) pending.current = null;
    };
    frame = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(frame);
  }, [focus, shownTab, settingsOpen]);

  function update(path: string, value: unknown) {
    dispatch({ type: 'updateConfig', key: node.key, path, value, now: Date.now() });
  }

  function setPolicy(next: OnErrorPolicy | null) {
    dispatch({ type: 'stepSettings', key: node.key, onError: next, now: Date.now() });
  }

  const policy: OnErrorPolicy = node.onError ?? { mode: 'stop' };
  const retries = policy.retries ?? { max: 0, waitSeconds: 30 };
  const connectionValue =
    ownPicker && typeof config[ownPicker.field] === 'string'
      ? (config[ownPicker.field] as string)
      : '';
  const connectionIssue = ownPicker
    ? issues.find((issue) => issue.field === ownPicker.field)
    : undefined;
  const returnTo = `/${context.orgId}/workflows/${context.automationId}?step=${encodeURIComponent(node.key)}`;
  const fieldAttr = (path: string) => ({ [FIELD_PATH_ATTRIBUTE]: path });

  const formProps = def
    ? { definition: def, node, graph, onChange: update, issues, context }
    : null;

  return (
    <div ref={root} className={cn('flex flex-col', className)}>
      {stepIssues.length > 0 ? (
        <div className="mb-4 flex flex-col gap-2">
          {stepIssues.map((issue) => (
            <Alert
              key={`${issue.code}-${issue.edgeId ?? ''}-${issue.message}`}
              variant={issue.severity === 'error' ? 'danger' : 'warning'}
              className="items-center p-3"
            >
              <TriangleAlert aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2.5} />
              <span>{issue.message}</span>
            </Alert>
          ))}
        </div>
      ) : null}

      <Tabs
        value={shownTab}
        onValueChange={(value) => setTab(value as PanelTab)}
        className="flex flex-col gap-4"
      >
        <TabsList className="self-start">
          {hasSetup ? (
            <TabsTrigger value="setup">
              Setup
              {errorPlaces.has('setup') ? (
                <TabMark kind="error" />
              ) : setupDone ? (
                <TabMark kind="done" />
              ) : null}
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="configure">
            Configure
            {errorPlaces.has('configure') ? (
              <TabMark kind="error" />
            ) : configureDone ? (
              <TabMark kind="done" />
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="test">Test</TabsTrigger>
        </TabsList>

        {hasSetup ? (
          <TabsContent value="setup" className="mt-0 flex flex-col gap-4">
            {ownPicker ? (
              <div {...fieldAttr(ownPicker.field)} className="flex flex-col gap-1.5">
                <Label htmlFor={`${ids}-connection`}>Connection</Label>
                <ConnectionPicker
                  kind={ownPicker.kind}
                  value={connectionValue}
                  returnTo={returnTo}
                  canManage={context.canManage}
                  onChange={(connectionId) => update(ownPicker.field, connectionId)}
                />
                {connectionIssue ? (
                  <Text size="sm" className="text-dangerInk">
                    {connectionIssue.message}
                  </Text>
                ) : null}
              </div>
            ) : null}
            {formProps && setupFields.length > 0 ? <SchemaForm {...formProps} tab="setup" /> : null}
          </TabsContent>
        ) : null}

        <TabsContent value="configure" className="mt-0 flex flex-col gap-4">
          {isTriggerType(node.type) ? (
            <Text size="sm" muted>
              {sourceLabel(context.scopeSource[node.key]) === 'Pinned'
                ? 'Tests start from the data pinned on this trigger.'
                : 'Tests start from a built-in sample.'}
            </Text>
          ) : null}
          {formProps && form ? (
            configureFields.length > 0 ? (
              <SchemaForm {...formProps} tab="configure" />
            ) : (
              <Text size="sm" muted>
                This step has nothing to set up.
              </Text>
            )
          ) : (
            <Text size="sm" muted>
              This step cannot be set up here yet.
            </Text>
          )}
        </TabsContent>

        <TabsContent value="test" className="mt-0 flex flex-col gap-4">
          <TestTab node={node} scope={context.scope} pin={pin} test={test} />
        </TabsContent>
      </Tabs>

      <Collapsible
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        className="mt-6 rounded-md border-2 border-outline"
      >
        <CollapsibleTrigger className="group flex w-full items-center justify-between px-3 py-2 type-ui text-sm text-ink">
          <span className="flex items-center">
            Settings
            {errorPlaces.has('settings') ? <TabMark kind="error" /> : null}
          </span>
          <ChevronDown
            aria-hidden="true"
            className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180"
            strokeWidth={2.5}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-4 border-t-2 border-outline p-3">
          {def?.canHandleErrors || node.onError ? (
            <>
              <div {...fieldAttr('onError')} className="flex flex-col gap-1.5">
                <Label htmlFor={`${ids}-on-error`}>On error</Label>
                <Select
                  value={policy.mode}
                  onValueChange={(mode) =>
                    setPolicy(
                      mode === 'stop' && !policy.retries
                        ? null
                        : { ...policy, mode: mode as OnErrorPolicy['mode'] },
                    )
                  }
                >
                  <SelectTrigger id={`${ids}-on-error`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ON_ERROR_OPTIONS.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {issues
                  .filter((issue) => issue.field === 'onError')
                  .map((issue) => (
                    <Text key={issue.message} size="sm" className="text-dangerInk">
                      {issue.message}
                    </Text>
                  ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div {...fieldAttr('onError.retries.max')} className="flex flex-col gap-1.5">
                  <Label htmlFor={`${ids}-retries`}>Retries</Label>
                  <Select
                    value={String(retries.max)}
                    onValueChange={(value) => {
                      const max = Number(value);
                      const next: OnErrorPolicy =
                        max === 0
                          ? { mode: policy.mode }
                          : {
                              mode: policy.mode,
                              retries: { max, waitSeconds: retries.waitSeconds },
                            };
                      setPolicy(next.mode === 'stop' && !next.retries ? null : next);
                    }}
                  >
                    <SelectTrigger id={`${ids}-retries`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[0, 1, 2, 3, 4, 5].map((count) => (
                        <SelectItem key={count} value={String(count)}>
                          {count === 0 ? 'None' : String(count)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div
                  {...fieldAttr('onError.retries.waitSeconds')}
                  className="flex flex-col gap-1.5"
                >
                  <Label htmlFor={`${ids}-wait`}>Wait between</Label>
                  <Select
                    value={String(retries.waitSeconds)}
                    disabled={retries.max === 0}
                    onValueChange={(value) =>
                      setPolicy({
                        mode: policy.mode,
                        retries: { max: retries.max, waitSeconds: Number(value) },
                      })
                    }
                  >
                    <SelectTrigger id={`${ids}-wait`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WAIT_OPTIONS.map((seconds) => (
                        <SelectItem key={seconds} value={String(seconds)}>
                          {waitWords(seconds)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          ) : null}
          <div {...fieldAttr('notes')} className="flex flex-col gap-1.5">
            <Label htmlFor={`${ids}-notes`}>Notes</Label>
            <Textarea
              id={`${ids}-notes`}
              defaultValue={node.notes ?? ''}
              key={`${node.key}-notes`}
              maxLength={280}
              rows={3}
              placeholder="Enter your notes for this step"
              onChange={(event) =>
                dispatch({
                  type: 'stepSettings',
                  key: node.key,
                  notes: event.target.value,
                  now: Date.now(),
                })
              }
            />
          </div>
          {def?.canDisable || node.disabled ? (
            <div {...fieldAttr('disabled')} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor={`${ids}-off`}>Turn off this step</Label>
                <Toggle
                  id={`${ids}-off`}
                  checked={node.disabled === true}
                  onCheckedChange={() => dispatch({ type: 'toggleDisabled', keys: [node.key] })}
                />
              </div>
              {issues
                .filter((issue) => issue.field === 'disabled')
                .map((issue) => (
                  <Text key={issue.message} size="sm" className="text-dangerInk">
                    {issue.message}
                  </Text>
                ))}
            </div>
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
