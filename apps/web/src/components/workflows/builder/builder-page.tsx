'use client';

/**
 * The workflow builder (Sprint 10, Module 05; blueprint sections 3 and 4).
 *
 * Layout: the PageActions row (name, save state, status, issues, menu),
 * then the work area: the Steps panel on the left (collapsible to an icon
 * strip), the canvas, and the step panel on the right when a step is open.
 * Below `lg` both panels are drawers and an Alert says the builder works
 * best on a wider screen.
 *
 * State lives in one reducer (`builder-state.ts`); the canvas draws it,
 * autosave sends it (`use-builder-autosave.ts`), and the browser checks it
 * with `validateGraph` a moment after each change, for the issue markers,
 * the issues chip and Finish Setup. Handlers read the graph through a ref
 * set right after each render, never through a stale closure.
 *
 * Module 06 adds the step panel's fields (`FieldContext`: the workspace,
 * and sample or pinned data for chips and Insert Data), a resizable panel,
 * the Expanded view, pinned test data, and focus-the-field: an issue, a
 * Finish Setup line or a `?step=<key>&field=<path>` link selects the step,
 * centres it, opens the panel on the right tab and focuses the field.
 *
 * Module 08 adds testing: Test Workflow (or Ctrl/Cmd+Enter) and Test Step
 * run the saved draft (`runs/use-test-run.ts`), the canvas paints the test
 * with the run bar under it until Close or a change to the steps or lines,
 * and the panels show each step's last result. The Editor and Runs switch
 * keeps `?tab=runs&run=<id>` in the address bar without a navigation.
 *
 * Module 09 adds the live controls (status, Activate, Run Now), Versions
 * with a read-only preview, and swaps a changed workflow in without a reload.
 */
import {
  type AutomationGraph,
  type GraphNode,
  getDefinition,
  getTemplate,
  instantiateTemplate,
  isTriggerType,
  type PortId,
  type ValidationIssue,
  validateGraph,
} from '@postgear/automation';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  toast,
} from '@postgear/ui';
import { Panel, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { Plus, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { ApiError, api, pinStepData, unpinStepData } from '@/lib/api';
import { registerLeaveGuard } from '@/lib/leave-guard';
import { getWebhook } from '@/lib/workflows-api';
import type { Channel } from '@/types/channel';
import type {
  AutomationDetail,
  AutomationStatus,
  Connection,
  PinnedStep,
  RunSummary,
  TemplateSummary,
  VersionDetail,
  WorkspaceCatalog,
} from '@/types/workflows';
import { useOptionalWorkspace } from '../../navigation/workspace-provider';
import { WorkflowLiveControls } from '../activation/live-controls';
import { VersionPreviewBanner, VersionsDrawer } from '../activation/versions-drawer';
import { CanvasControls } from '../canvas/canvas-controls';
import { copySteps, pasteSteps, readClipboard } from '../canvas/clipboard';
import { CanvasContextMenu, type MenuItem } from '../canvas/context-menu';
import { type CanvasNode, type FlowEdge, issuesByStep } from '../canvas/flow-model';
import { RunCanvas } from '../canvas/run-canvas';
import { tidyPositions } from '../canvas/tidy-up';
import { WorkflowCanvas } from '../canvas/workflow-canvas';
import type { FieldContext } from '../fields/contract';
import { TemplateGallery } from '../list/template-gallery';
import { ExpandedView } from '../panel/expanded-view';
import type { PinControls } from '../panel/output-pane';
import { buildScope, inputSourceLine, receivedWebhookData } from '../panel/panel-view-model';
import { pinErrorMessage } from '../panel/pinned-data-editor';
import { ResizeHandle } from '../panel/resize-handle';
import { StepPanel } from '../panel/step-panel';
import type { FocusRequest } from '../panel/step-tabs';
import type { StepTestControls } from '../panel/test-tab';
import { PANEL_MAX, PANEL_MIN, PANEL_STEP, usePanelWidth } from '../panel/use-panel-width';
import { type PickerItem, pickerItems, pushRecent, RECENT_LIMIT } from '../picker/picker-search';
import { StepPicker } from '../picker/step-picker';
import { ReviewCard } from '../runs/review-card';
import { RunBar } from '../runs/run-bar';
import { isTerminalRun } from '../runs/run-model';
import { RunsTab } from '../runs/runs-tab';
import { TestControls } from '../runs/test-controls';
import { stepResult, useTestRun } from '../runs/use-test-run';
import {
  type BuilderApi,
  BuilderProvider,
  type ContextTarget,
  type ScreenPoint,
} from './builder-context';
import { isTyping, shortcutFor } from './builder-shortcuts';
import { builderReducer, initialState, type Position, type Selection } from './builder-state';
import { BuilderTopBar } from './builder-top-bar';
import {
  type BuilderTab,
  builderSearch,
  CONFLICT_MESSAGE,
  LOOP_REFUSED,
  NOT_SAVED_YET,
  SMALL_SCREEN_MESSAGE,
  setupItems,
  structureKey,
  summaryContext,
  validationContext,
} from './builder-view-model';
import { CommandPalette, type PaletteCommand } from './command-palette';
import { FinishSetup } from './finish-setup';
import { firstOutput, leaves, startingConfig } from './graph-ops';
import { type IssuePlace, issuePlace, stepPlace } from './issue-focus';
import { ShortcutsSheet } from './shortcuts-sheet';
import { keyMaker, newStepKey } from './step-keys';
import { useBuilderAutosave } from './use-builder-autosave';

const VALIDATE_DELAY_MS = 300;
const WIDE = '(min-width: 1024px)';
const PICKER_WIDTH = 340;
const PICKER_HEIGHT = 440;

export interface BuilderPageProps {
  orgId: string;
  automation: AutomationDetail;
  templates: TemplateSummary[];
  initialCatalog: WorkspaceCatalog | null;
  initialConnections: Connection[] | null;
  initialChannels: Channel[] | null;
  /** `?setup=1`: just made from a template. */
  setup: boolean;
  /** `?step=<key>`: open this step. */
  initialStep: string | null;
  /**
   * Workspace admins turn workflows on and off. Worked out on the server
   * from the member's role; null or left out falls back to the workspace
   * session in the browser.
   */
  canManage?: boolean | null;
  /** `?tab=runs`, or a `?run=` link on its own: open on the Runs tab. */
  initialTab?: BuilderTab;
  /** `?run=<id>`: the run the Runs tab shows. */
  initialRunId?: string | null;
  /** `?review=1`: open that run's waiting review card at once. */
  initialReview?: boolean;
}

type PickerState = {
  placement: 'next' | 'trigger';
  at: ScreenPoint;
  from?: { source: string; sourcePort: PortId };
  edgeId?: string;
  flowAt?: Position;
};

function recentKey(orgId: string): string {
  return `postgear.workflows.recent.${orgId}`;
}

function readRecent(orgId: string): string[] {
  try {
    const raw = window.localStorage.getItem(recentKey(orgId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string').slice(0, RECENT_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function writeRecent(orgId: string, recent: string[]) {
  try {
    window.localStorage.setItem(recentKey(orgId), JSON.stringify(recent));
  } catch {
    // Recent is a convenience; private windows may refuse storage.
  }
}

function useWide(): boolean {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const query = window.matchMedia(WIDE);
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}

function connectionIdsOf(graph: AutomationGraph): string[] {
  const ids: string[] = [];
  for (const node of graph.nodes) {
    const field = getDefinition(node.type, node.typeVersion)?.connection?.field;
    const value = field ? node.config[field] : undefined;
    if (typeof value === 'string' && value) ids.push(value);
  }
  return ids;
}

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

export function BuilderPage(props: BuilderPageProps) {
  return (
    <ReactFlowProvider>
      <Builder {...props} />
    </ReactFlowProvider>
  );
}

function Builder({
  orgId,
  automation,
  templates,
  initialCatalog,
  initialConnections,
  initialChannels,
  setup,
  initialStep,
  canManage: canManageProp = null,
  initialTab = 'editor',
  initialRunId = null,
  initialReview = false,
}: BuilderPageProps) {
  const router = useRouter();
  const flow = useReactFlow<CanvasNode, FlowEdge>();
  const wide = useWide();
  const [state, dispatch] = useReducer(builderReducer, undefined, () =>
    initialState(automation.draftGraph, automation.name),
  );
  const graphRef = useRef<AutomationGraph>(state.graph);
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    graphRef.current = state.graph;
    stateRef.current = state;
  });

  const [catalog, setCatalog] = useState<WorkspaceCatalog | null>(initialCatalog);
  const [connections, setConnections] = useState<Connection[]>(initialConnections ?? []);
  const channels = useMemo(() => initialChannels ?? [], [initialChannels]);
  const [issues, setIssues] = useState<ValidationIssue[]>(() =>
    validateGraph(
      automation.draftGraph,
      validationContext(initialConnections ?? [], initialChannels ?? []),
    ),
  );
  const [panelKey, setPanelKey] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ key: string; request: FocusRequest } | null>(
    null,
  );
  const focusSeq = useRef(0);
  const [panelWidth, setPanelWidth] = usePanelWidth();
  const [pinned, setPinned] = useState<PinnedStep[]>(automation.pinned ?? []);
  // The graph as last checked: samples follow it, so typing does not rebuild them on each key.
  const [checkedGraph, setCheckedGraph] = useState<AutomationGraph>(automation.draftGraph);
  const [renameSignal, setRenameSignal] = useState(0);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [stepsOpen, setStepsOpen] = useState(true);
  const [stepsSheet, setStepsSheet] = useState(false);
  const [locked, setLocked] = useState(false);
  const [tidying, setTidying] = useState(false);
  const [menu, setMenu] = useState<{ target: ContextTarget; at: ScreenPoint } | null>(null);
  const [palette, setPalette] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [showSetup, setShowSetup] = useState(
    () =>
      setup ||
      (automation.templateId !== null && issues.some((issue) => issue.severity === 'error')),
  );
  const [recent, setRecent] = useState<string[]>([]);
  const [unpublished, setUnpublished] = useState(automation.hasUnpublishedChanges);
  // Activate, Pause, Discard and Restore change these; the page swaps them in.
  const [live, setLive] = useState<{ status: AutomationStatus; activeVersion: number | null }>({
    status: automation.status,
    activeVersion: automation.activeVersion,
  });
  const [tab, setTab] = useState<BuilderTab>(initialTab);
  const [runId, setRunId] = useState<string | null>(initialRunId);
  const [review, setReview] = useState(initialReview && initialRunId !== null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [preview, setPreview] = useState<VersionDetail | null>(null);
  const [issuesSignal, setIssuesSignal] = useState(0);
  const [startSignal, setStartSignal] = useState(0);
  // Test Step from a card: that step's panel opens on its Test tab.
  const [showTest, setShowTest] = useState<{ key: string; seq: number } | null>(null);
  // The Expanded view was opened from a result badge: it shows that run.
  const [fromBadge, setFromBadge] = useState(false);
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  // Debug In Editor's step, selected once the Editor is back on screen.
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaveAsk, setLeaveAsk] = useState<((leave: boolean) => void) | null>(null);
  const [narrowDismissed, setNarrowDismissed] = useState(false);
  const canvasBox = useRef<HTMLDivElement>(null);
  const askedConnections = useRef(new Set<string>());

  const autosave = useBuilderAutosave({
    automationId: automation.id,
    initial: {
      graph: automation.draftGraph,
      name: automation.name,
      revision: automation.draftRevision,
    },
    graph: state.graph,
    name: state.name,
    onSaved: (result) => setUnpublished(result.hasUnpublishedChanges),
  });

  // ---- Tests (Module 08) -------------------------------------------------------------

  const currentGraph = useCallback(() => graphRef.current, []);
  const openIssues = useCallback(() => setIssuesSignal((count) => count + 1), []);
  const testRun = useTestRun({
    automationId: automation.id,
    flush: autosave.flush,
    graph: currentGraph,
    onBlocked: openIssues,
  });
  const testRef = useRef(testRun);
  useLayoutEffect(() => {
    testRef.current = testRun;
  });

  // Moving a step keeps the paint; adding, removing or reconnecting one clears it.
  const shape = useMemo(() => structureKey(state.graph), [state.graph]);
  const paintedShape = useRef(shape);
  const { unpaint } = testRun;
  useEffect(() => {
    if (paintedShape.current === shape) return;
    paintedShape.current = shape;
    unpaint();
  }, [shape, unpaint]);

  /** Activate, Run Now and Restore save first, then name the revision the server has. */
  const { flush: flushDraft, revision: savedRevision, reset: resetDraft } = autosave;
  const flushRevision = useCallback(async () => {
    if (!(await flushDraft())) throw new Error(NOT_SAVED_YET);
    return savedRevision();
  }, [flushDraft, savedRevision]);

  /**
   * The workflow changed on the server (activate, pause, discard, restore):
   * swap it in without a reload. A draft that is the same as the one on
   * screen keeps the undo history; a different one starts afresh.
   */
  const adopt = useCallback(
    (detail: AutomationDetail) => {
      resetDraft({ graph: detail.draftGraph, name: detail.name, revision: detail.draftRevision });
      const current = stateRef.current;
      if (
        current.name !== detail.name ||
        JSON.stringify(current.graph) !== JSON.stringify(detail.draftGraph)
      ) {
        dispatch({ type: 'load', graph: detail.draftGraph, name: detail.name });
      }
      setLive({ status: detail.status, activeVersion: detail.activeVersion });
      setUnpublished(detail.hasUnpublishedChanges);
      if (detail.pinned) setPinned(detail.pinned);
      setPreview(null);
    },
    [resetDraft],
  );

  // ---- Tabs: the address bar follows them, without a navigation --------------------

  useEffect(() => {
    const search = builderSearch(window.location.search, { tab, runId, review });
    if (search === window.location.search) return;
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${search}${window.location.hash}`,
    );
  }, [tab, runId, review]);

  // RunsTab's rows skip re-renders only while this stays the same function.
  const selectRun = useCallback((id: string | null) => {
    setRunId(id);
    setReview(false);
  }, []);

  const showRun = useCallback((run: RunSummary) => {
    setPreview(null);
    setRunId(run.id);
    setReview(false);
    setTab('runs');
  }, []);

  /** Debug In Editor: RunsTab saved the pins and said so; swap them in and land on the step. */
  const debugInEditor = useCallback(
    ({ pinned: next, focusKey }: { pinned: PinnedStep[]; focusKey: string | null }) => {
      const replaced = new Set(next.map((pin) => pin.nodeKey));
      setPinned((current) => [...current.filter((pin) => !replaced.has(pin.nodeKey)), ...next]);
      setPreview(null);
      setTab('editor');
      setPendingFocus(focusKey);
    },
    [],
  );

  // ---- Loading what the first paint did not have -----------------------------

  useEffect(() => {
    setRecent(readRecent(orgId));
  }, [orgId]);

  useEffect(() => {
    if (catalog) return;
    api<WorkspaceCatalog>('/automations/catalog')
      .then(setCatalog)
      .catch(() => setCatalog({ steps: [], connectedPlatforms: [] }));
  }, [catalog]);

  // A connection made from a step's panel is new to this page: fetch the list again once.
  useEffect(() => {
    const known = new Set(connections.map((connection) => connection.id));
    const unknown = connectionIdsOf(state.graph).filter(
      (id) => !known.has(id) && !askedConnections.current.has(id),
    );
    if (unknown.length === 0) return;
    for (const id of unknown) askedConnections.current.add(id);
    api<{ connections: Connection[] }>('/automation-connections')
      .then((result) => setConnections(result.connections))
      .catch(() => undefined);
  }, [state.graph, connections]);

  // ---- Live checks -------------------------------------------------------------

  const context = useMemo(() => validationContext(connections, channels), [connections, channels]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setIssues(validateGraph(state.graph, context));
      setCheckedGraph(state.graph);
    }, VALIDATE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state.graph, context]);
  const issuesMap = useMemo(() => issuesByStep(issues), [issues]);
  const summary = useMemo(() => summaryContext(connections, channels), [connections, channels]);
  const setupList = useMemo(() => setupItems(state.graph, issues), [state.graph, issues]);

  // ---- What the step panel's fields see -------------------------------------------

  const workspace = useOptionalWorkspace();
  const workspaceName = workspace?.organizations.find((org) => org.id === orgId)?.name;
  const canManage = canManageProp ?? (workspace ? workspace.role !== 'USER' : false);
  const timeZone = useMemo(browserZone, []);
  // A Webhook trigger's sample is the last data it received (Module 13), as
  // in test runs. Asked again each time a step panel opens, so data that
  // arrived while the builder was open shows up in Insert Data.
  const webhookTrigger = checkedGraph.nodes.some((node) => node.type === 'trigger.webhook');
  const [received, setReceived] = useState<Record<string, unknown> | undefined>(undefined);
  useEffect(() => {
    if (!webhookTrigger || panelKey === null) return;
    let live = true;
    getWebhook(automation.id)
      .then((info) => {
        if (live) setReceived(receivedWebhookData(info));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [webhookTrigger, panelKey, automation.id]);
  // Pinned data first, then each step's last test, then samples.
  const { scope, scopeSource } = useMemo(
    () => buildScope(checkedGraph, pinned, workspaceName, testRun.lastTest, received),
    [checkedGraph, pinned, workspaceName, testRun.lastTest, received],
  );
  const fieldContext = useMemo(
    (): FieldContext => ({
      orgId,
      automationId: automation.id,
      connections,
      channels,
      canManage,
      scope,
      scopeSource,
      timeZone,
      workflowName: state.name,
    }),
    [
      orgId,
      automation.id,
      connections,
      channels,
      canManage,
      scope,
      scopeSource,
      timeZone,
      state.name,
    ],
  );
  const pinnedKeys = useMemo(() => new Set(pinned.map((pin) => pin.nodeKey)), [pinned]);

  // ---- Leaving -------------------------------------------------------------------

  useEffect(
    () =>
      registerLeaveGuard(async () => {
        if (await autosave.flush()) return true;
        if (!autosave.unsaved()) return true;
        return new Promise<boolean>((resolve) => setLeaveAsk(() => resolve));
      }),
    [autosave.flush, autosave.unsaved],
  );

  function answerLeave(leave: boolean) {
    if (leave) autosave.letGo();
    leaveAsk?.(leave);
    setLeaveAsk(null);
  }

  // ---- Helpers -------------------------------------------------------------------

  const keys = useCallback(() => {
    const graph = graphRef.current;
    return keyMaker([
      ...graph.nodes.map((node) => node.key),
      ...graph.notes.map((note) => note.id),
    ]);
  }, []);

  const reveal = useCallback(
    (key: string) => {
      requestAnimationFrame(() => {
        const node = graphRef.current.nodes.find((candidate) => candidate.key === key);
        const box = canvasBox.current?.getBoundingClientRect();
        if (!node || !box) return;
        const topLeft = flow.screenToFlowPosition({ x: box.left + 40, y: box.top + 40 });
        const bottomRight = flow.screenToFlowPosition({ x: box.right - 40, y: box.bottom - 40 });
        const inside =
          node.position.x >= topLeft.x &&
          node.position.y >= topLeft.y &&
          node.position.x + 240 <= bottomRight.x &&
          node.position.y + 76 <= bottomRight.y;
        if (!inside) {
          void flow.setCenter(node.position.x + 120, node.position.y + 38, {
            zoom: flow.getZoom(),
            duration: 200,
          });
        }
      });
    },
    [flow],
  );

  const open = useCallback((key: string) => {
    dispatch({ type: 'select', selection: { nodes: [key], edges: [], notes: [] } });
    setPanelKey(key);
    setPicker(null);
  }, []);

  const expand = useCallback(
    (key: string) => {
      open(key);
      setExpandedKey(key);
      setFromBadge(false);
    },
    [open],
  );

  /** A result badge on the painted canvas: the Expanded view on that run's input and output. */
  const expandRun = useCallback(
    (key: string) => {
      open(key);
      setExpandedKey(key);
      setFromBadge(true);
    },
    [open],
  );

  /** Centres a step, once the panel has opened and the canvas has narrowed. */
  const centre = useCallback(
    (key: string) => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!graphRef.current.nodes.some((node) => node.key === key)) return;
          void flow.fitView({ nodes: [{ id: key }], padding: 0.6, duration: 200, maxZoom: 1 });
        }),
      );
    },
    [flow],
  );

  const showSteps = useCallback(() => {
    if (wide) setStepsOpen(true);
    else setStepsSheet(true);
    requestAnimationFrame(() =>
      document.querySelector<HTMLInputElement>('[data-steps-panel] input[type="search"]')?.focus(),
    );
  }, [wide]);

  /** Focus-the-field: lands on where an issue lives (`issue-focus.ts`). */
  const goTo = useCallback(
    (place: IssuePlace | null) => {
      if (!place) return;
      if (place.kind === 'step') {
        open(place.nodeKey);
        focusSeq.current += 1;
        setFocusRequest({
          key: place.nodeKey,
          request: {
            place: place.place,
            ...(place.field !== undefined ? { field: place.field } : {}),
            seq: focusSeq.current,
          },
        });
        centre(place.nodeKey);
      } else if (place.kind === 'line') {
        dispatch({ type: 'select', selection: { nodes: [], edges: [place.edgeId], notes: [] } });
        setPanelKey(null);
        if (place.nodeKey) centre(place.nodeKey);
      } else if (place.action === 'addTrigger') {
        showSteps();
      }
    },
    [open, centre, showSteps],
  );

  const goToIssue = useCallback(
    (issue: ValidationIssue) => goTo(issuePlace(graphRef.current, issue)),
    [goTo],
  );

  // A focus request is for one opening of one step's panel.
  useEffect(() => {
    if (focusRequest && focusRequest.key !== panelKey) setFocusRequest(null);
  }, [focusRequest, panelKey]);

  // The Expanded view closes with its step (deleted, or undone away).
  useEffect(() => {
    if (expandedKey && !state.graph.nodes.some((node) => node.key === expandedKey))
      setExpandedKey(null);
  }, [expandedKey, state.graph]);

  // Debug In Editor: once the canvas is back, select the step and open its panel.
  useEffect(() => {
    if (tab !== 'editor' || preview || !pendingFocus) return;
    setPendingFocus(null);
    if (!graphRef.current.nodes.some((node) => node.key === pendingFocus)) return;
    open(pendingFocus);
    centre(pendingFocus);
  }, [tab, preview, pendingFocus, open, centre]);

  // ---- Pinned test data ------------------------------------------------------------

  const pinControls = useCallback(
    (key: string): PinControls => ({
      pinned: pinned.find((pin) => pin.nodeKey === key),
      onPin: async (output) => {
        // The API pins steps of the saved draft: save first, so a new step is there.
        await autosave.flush();
        const result = await pinStepData(automation.id, key, output);
        // The stored copy, so a hidden secret shows as hidden, as after a reload.
        setPinned((current) => [...current.filter((pin) => pin.nodeKey !== key), result.pinned]);
      },
      onUnpin: async () => {
        try {
          await unpinStepData(automation.id, key);
        } catch (cause) {
          // Already gone on the server is as good as unpinned.
          if (!(cause instanceof ApiError && cause.status === 404)) {
            toast({ title: pinErrorMessage(cause), variant: 'danger' });
            return;
          }
        }
        setPinned((current) => current.filter((pin) => pin.nodeKey !== key));
      },
    }),
    [pinned, automation.id, autosave.flush],
  );

  const remember = useCallback(
    (itemId: string) => {
      setRecent((current) => {
        const next = pushRecent(current, itemId);
        writeRecent(orgId, next);
        return next;
      });
    },
    [orgId],
  );

  const addItem = useCallback(
    (
      item: PickerItem,
      where: {
        from?: { source: string; sourcePort: PortId };
        edgeId?: string;
        position?: Position;
      } = {},
    ) => {
      if (item.blocked) return;
      const config = startingConfig(item.type, item.config, browserZone());
      const key = newStepKey(
        new Set([
          ...graphRef.current.nodes.map((node) => node.key),
          ...graphRef.current.notes.map((note) => note.id),
        ]),
      );
      if (where.edgeId) {
        dispatch({
          type: 'insertOnEdge',
          edgeId: where.edgeId,
          stepType: item.type,
          key,
          config,
        });
      } else if (where.from || where.position) {
        dispatch({
          type: 'addStep',
          stepType: item.type,
          key,
          config,
          from: where.from,
          position: where.position,
        });
      } else {
        // Clicked in the Steps panel: after the selected step, or the last one.
        const graph = graphRef.current;
        const selected = stateRef.current.selection.nodes.at(-1);
        const anchor: GraphNode | undefined =
          graph.nodes.find((node) => node.key === selected) ?? leaves(graph).at(-1);
        const port = anchor && !isTriggerType(item.type) ? firstOutput(anchor) : null;
        dispatch({
          type: 'addStep',
          stepType: item.type,
          key,
          config,
          from: anchor && port ? { source: anchor.key, sourcePort: port } : undefined,
        });
      }
      remember(item.id);
      setPanelKey(key);
      setPicker(null);
      setStepsSheet(false);
      reveal(key);
    },
    [remember, reveal],
  );

  const copy = useCallback((stepKeys: string[]) => {
    const text = copySteps(graphRef.current, stepKeys);
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => toast({ title: `Copied ${plural(stepKeys.length, 'step', 'steps')}` }))
      .catch(() => toast({ title: 'The browser did not allow copying.', variant: 'danger' }));
  }, []);

  const paste = useCallback(async () => {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      toast({
        title: 'The browser did not allow pasting. Allow clipboard access and try again.',
        variant: 'danger',
      });
      return;
    }
    const data = readClipboard(text);
    if (!data) return;
    const result = pasteSteps(data, graphRef.current, {
      makeKey: keys(),
      connectionIds: new Set(connections.map((connection) => connection.id)),
    });
    if (result.nodes.length > 0)
      dispatch({ type: 'paste', nodes: result.nodes, edges: result.edges });
    if (result.note) toast({ title: result.note });
  }, [connections, keys]);

  const removeItems = useCallback((items: Partial<Selection>) => {
    const selection: Selection = {
      nodes: items.nodes ?? [],
      edges: items.edges ?? [],
      notes: items.notes ?? [],
    };
    dispatch({ type: 'select', selection });
    dispatch({ type: 'deleteSelection' });
    setPanelKey((current) => (current && selection.nodes.includes(current) ? null : current));
  }, []);

  const duplicate = useCallback(
    (stepKeys: string[]) => {
      dispatch({ type: 'select', selection: { nodes: stepKeys, edges: [], notes: [] } });
      dispatch({ type: 'duplicateSelection', makeKey: keys() });
    },
    [keys],
  );

  const addNote = useCallback(
    (at?: Position) => {
      const box = canvasBox.current?.getBoundingClientRect();
      const centre =
        at ??
        (box
          ? flow.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
          : { x: 0, y: 0 });
      dispatch({
        type: 'addNote',
        note: {
          id: keys()(),
          position: { x: Math.round(centre.x - 120), y: Math.round(centre.y - 60) },
          size: { w: 240, h: 120 },
          text: '',
          colour: 'yellow',
        },
      });
    },
    [flow, keys],
  );

  const tidy = useCallback(() => {
    if (graphRef.current.nodes.length === 0) return;
    setTidying(true);
    dispatch({ type: 'tidy', positions: tidyPositions(graphRef.current) });
    setTimeout(() => {
      setTidying(false);
      void flow.fitView({ duration: 200, padding: 0.25, maxZoom: 1 });
    }, 320);
  }, [flow]);

  const fromTemplate = useCallback(
    (templateId: string) => {
      const template = getTemplate(templateId);
      if (!template) return;
      const make = keys();
      let zone: string | undefined;
      try {
        zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        zone = undefined;
      }
      const graph = instantiateTemplate(template, () => make(), { timeZone: zone });
      dispatch({ type: 'paste', nodes: graph.nodes, edges: graph.edges });
      // A paste selects what it added; a template is a fresh start, not a selection.
      dispatch({ type: 'select', selection: { nodes: [], edges: [], notes: [] } });
      if (stateRef.current.name === 'Untitled Workflow')
        dispatch({ type: 'rename', name: template.title });
      setShowSetup(true);
      requestAnimationFrame(() => void flow.fitView({ duration: 200, padding: 0.25, maxZoom: 1 }));
    },
    [flow, keys],
  );

  // ---- The API the cards, lines and notes use ---------------------------------------

  /** Test Step from a card: its panel opens on the Test tab, where the result lands. */
  const testStepFromCard = useCallback(
    (key: string) => {
      open(key);
      setShowTest((current) => ({ key, seq: (current?.seq ?? 0) + 1 }));
      void testRef.current.testStep(key);
    },
    [open],
  );

  const builderApi = useMemo(
    (): BuilderApi => ({
      dispatch,
      graphRef,
      locked,
      open,
      expand,
      pinned: pinnedKeys,
      rename: (key) => {
        open(key);
        setRenameSignal((count) => count + 1);
      },
      pickFrom: (from, at, flowAt) => setPicker({ placement: 'next', at, from, flowAt }),
      pickOnEdge: (edgeId, at) => setPicker({ placement: 'next', at, edgeId }),
      remove: removeItems,
      duplicate,
      copy,
      contextMenu: (target, at) => setMenu({ target, at }),
      liveInTests: testRun.liveInTests,
      testStep: testStepFromCard,
    }),
    [
      locked,
      open,
      expand,
      pinnedKeys,
      removeItems,
      duplicate,
      copy,
      testRun.liveInTests,
      testStepFromCard,
    ],
  );

  // ---- Keyboard ------------------------------------------------------------------------

  // The Runs tab and a version preview have no editor: its shortcuts sleep there.
  const editing = tab === 'editor' && preview === null;

  useEffect(() => {
    if (!editing) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isTyping(event.target)) return;
      const command = shortcutFor(event);
      if (!command) return;
      const current = stateRef.current;
      const graph = current.graph;
      const selectedSteps = current.selection.nodes;
      const single = selectedSteps.length === 1 ? selectedSteps[0] : null;
      const handled = (() => {
        switch (command) {
          case 'openPicker':
            showSteps();
            return true;
          case 'addNote':
            addNote();
            return true;
          case 'openStep':
            // Enter opens the step's panel; Enter again opens the Expanded view.
            if (!single) return false;
            if (panelKey === single) expand(single);
            else open(single);
            return true;
          case 'rename':
            if (!single) return false;
            builderApi.rename(single);
            return true;
          case 'toggleDisabled': {
            const keysToToggle = selectedSteps.filter((key) => {
              const node = graph.nodes.find((candidate) => candidate.key === key);
              return node ? (getDefinition(node.type)?.canDisable ?? false) : false;
            });
            if (keysToToggle.length === 0) return false;
            dispatch({ type: 'toggleDisabled', keys: keysToToggle });
            return true;
          }
          case 'copy':
            if (selectedSteps.length === 0) return false;
            copy(selectedSteps);
            return true;
          case 'paste':
            void paste();
            return true;
          case 'duplicate':
            if (selectedSteps.length === 0) return false;
            duplicate(selectedSteps);
            return true;
          case 'delete': {
            const { nodes, edges, notes } = current.selection;
            if (nodes.length + edges.length + notes.length === 0) return false;
            removeItems(current.selection);
            return true;
          }
          case 'undo':
            dispatch({ type: 'undo' });
            return true;
          case 'redo':
            dispatch({ type: 'redo' });
            return true;
          case 'palette':
            setPalette(true);
            return true;
          case 'fit':
            void flow.fitView({ duration: 200, padding: 0.25, maxZoom: 1 });
            return true;
          case 'resetZoom':
            void flow.zoomTo(1, { duration: 200 });
            return true;
          case 'selectAll':
            dispatch({
              type: 'select',
              selection: { nodes: graph.nodes.map((node) => node.key), edges: [], notes: [] },
            });
            return true;
          case 'next':
          case 'previous': {
            const from = single ?? graph.nodes.find((node) => isTriggerType(node.type))?.key;
            if (!from) return false;
            let target: string | undefined = from;
            if (single) {
              target =
                command === 'next'
                  ? graph.edges.find((edge) => edge.source === from)?.target
                  : graph.edges.find((edge) => edge.target === from)?.source;
            }
            if (!target) return true;
            dispatch({ type: 'select', selection: { nodes: [target], edges: [], notes: [] } });
            reveal(target);
            return true;
          }
          case 'shortcuts':
            setShortcuts(true);
            return true;
          case 'testWorkflow': {
            // The same as the button: Stop while a test runs, else Test Workflow.
            const test = testRef.current;
            if (test.running) {
              if (!test.stopping) void test.stop();
            } else if (!test.busy) setStartSignal((count) => count + 1);
            return true;
          }
          case 'escape':
            if (picker) setPicker(null);
            else if (panelKey) {
              const key = panelKey;
              setPanelKey(null);
              // React Flow blurs a card on Escape: hand the keyboard back to the step's card.
              requestAnimationFrame(() => {
                document
                  .querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(key)}"]`)
                  ?.focus();
              });
            } else dispatch({ type: 'select', selection: { nodes: [], edges: [], notes: [] } });
            return true;
        }
      })();
      if (handled) event.preventDefault();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    editing,
    showSteps,
    addNote,
    open,
    expand,
    builderApi,
    copy,
    paste,
    duplicate,
    removeItems,
    flow,
    reveal,
    picker,
    panelKey,
  ]);

  // ---- Deep link ------------------------------------------------------------------------

  // `?step=<key>` opens the step; `&field=<path>` lands on that field too.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !initialStep) return;
    opened.current = true;
    if (!graphRef.current.nodes.some((node) => node.key === initialStep)) return;
    let field: string | null = null;
    try {
      field = new URLSearchParams(window.location.search).get('field');
    } catch {
      field = null;
    }
    if (field) goTo(stepPlace(graphRef.current, initialStep, field));
    else {
      open(initialStep);
      reveal(initialStep);
    }
  }, [initialStep, open, reveal, goTo]);

  // ---- Workflow actions ------------------------------------------------------------------

  async function duplicateWorkflow() {
    await autosave.flush();
    try {
      const { automation: copyOf } = await api<{ automation: AutomationDetail }>(
        `/automations/${automation.id}/duplicate`,
        { method: 'POST' },
      );
      toast({ title: 'Workflow duplicated' });
      router.push(`/${orgId}/workflows/${copyOf.id}`);
    } catch (cause) {
      toast({
        title:
          cause instanceof ApiError && cause.status !== 0
            ? cause.message
            : 'That did not work. Try again.',
        variant: 'danger',
      });
    }
  }

  async function deleteWorkflow() {
    setBusy(true);
    try {
      await api(`/automations/${automation.id}`, { method: 'DELETE' });
      autosave.letGo();
      toast({ title: 'Workflow deleted' });
      router.push(`/${orgId}/workflows`);
    } catch (cause) {
      setBusy(false);
      toast({
        title:
          cause instanceof ApiError && cause.status !== 0
            ? cause.message
            : 'That did not work. Try again.',
        variant: 'danger',
      });
    }
  }

  function copyChanges() {
    const text = JSON.stringify({ name: state.name, graph: state.graph }, null, 2);
    navigator.clipboard
      .writeText(text)
      .then(() => toast({ title: 'Your changes were copied' }))
      .catch(() => toast({ title: 'The browser did not allow copying.', variant: 'danger' }));
  }

  // ---- Menus ------------------------------------------------------------------------------

  function menuItems(target: ContextTarget): MenuItem[] {
    if (target.kind === 'step') {
      const node = state.graph.nodes.find((candidate) => candidate.key === target.key);
      if (!node) return [];
      const def = getDefinition(node.type, node.typeVersion);
      const items: MenuItem[] = [
        { label: 'Open', shortcut: 'Enter', onSelect: () => open(node.key) },
        { label: 'Expand', onSelect: () => expand(node.key) },
        { label: 'Rename', shortcut: 'F2', onSelect: () => builderApi.rename(node.key) },
      ];
      if (def?.canDisable) {
        items.push({
          label: node.disabled ? 'Turn On' : 'Turn Off',
          shortcut: 'D',
          onSelect: () => dispatch({ type: 'toggleDisabled', keys: [node.key] }),
        });
      }
      if (!isTriggerType(node.type)) {
        items.push({
          label: 'Duplicate',
          shortcut: 'Ctrl+D',
          onSelect: () => duplicate([node.key]),
        });
      }
      items.push({ label: 'Copy', shortcut: 'Ctrl+C', onSelect: () => copy([node.key]) });
      items.push({
        label: 'Delete',
        shortcut: 'Del',
        danger: true,
        separated: true,
        onSelect: () => removeItems({ nodes: [node.key] }),
      });
      return items;
    }
    if (target.kind === 'note') {
      return [
        { label: 'Delete', danger: true, onSelect: () => removeItems({ notes: [target.id] }) },
      ];
    }
    if (target.kind === 'edge') {
      return [
        {
          label: 'Add A Step Here',
          onSelect: () => menu && setPicker({ placement: 'next', at: menu.at, edgeId: target.id }),
        },
        {
          label: 'Delete',
          danger: true,
          onSelect: () => dispatch({ type: 'disconnect', edgeIds: [target.id] }),
        },
      ];
    }
    return [
      {
        label: 'Add Step',
        shortcut: 'N',
        onSelect: () => {
          if (wide) setStepsOpen(true);
          else setStepsSheet(true);
        },
      },
      { label: 'Add Note', shortcut: 'Shift+S', onSelect: () => addNote(target.flowAt) },
      { label: 'Paste', shortcut: 'Ctrl+V', onSelect: () => void paste() },
      { label: 'Tidy Up', onSelect: tidy, disabled: state.graph.nodes.length === 0 || locked },
      {
        label: 'Select All',
        shortcut: 'Ctrl+A',
        onSelect: () =>
          dispatch({
            type: 'select',
            selection: { nodes: state.graph.nodes.map((node) => node.key), edges: [], notes: [] },
          }),
      },
    ];
  }

  function onPalette(command: PaletteCommand) {
    if (command === 'tidy') tidy();
    else if (command === 'addNote') addNote();
    else if (command === 'toggleSteps') {
      if (wide) setStepsOpen((value) => !value);
      else setStepsSheet((value) => !value);
    } else if (command === 'fit') void flow.fitView({ duration: 200, padding: 0.25, maxZoom: 1 });
    else setShortcuts(true);
  }

  // ---- Render ------------------------------------------------------------------------------

  const hasTrigger = state.graph.nodes.some((node) => isTriggerType(node.type));
  const panelNode = panelKey ? state.graph.nodes.find((node) => node.key === panelKey) : undefined;
  const paletteItems = useMemo(
    () =>
      catalog
        ? pickerItems(catalog, { placement: 'panel', hasTrigger }).filter((item) => !item.blocked)
        : [],
    [catalog, hasTrigger],
  );

  const stepsPicker = (
    <StepPicker
      placement="panel"
      catalog={catalog}
      hasTrigger={hasTrigger}
      recent={recent}
      orgId={orgId}
      onPick={(item) => addItem(item)}
      onCollapse={wide ? () => setStepsOpen(false) : undefined}
      onClose={wide ? undefined : () => setStepsSheet(false)}
      autoFocus={false}
      className="h-full"
    />
  );

  /** Test Step, its result and Send For Real In Tests, for a step's Test tab and Output pane. */
  const stepTest = (node: GraphNode): StepTestControls => ({
    result: stepResult(node.key, testRun.model, testRun.lastTest),
    busy: testRun.busy,
    testing: testRun.testingStep === node.key,
    onTestStep: () => void testRun.testStep(node.key),
    liveInTests: testRun.liveInTests.has(node.key),
    onLiveInTestsChange: (on) => testRun.setLiveInTests(node.key, on),
    inputLine: inputSourceLine(state.graph, node.key, scopeSource),
    workflowName: state.name,
  });

  const panel = panelNode ? (
    <StepPanel
      key={panelNode.key}
      node={panelNode}
      graph={state.graph}
      issues={issuesMap.get(panelNode.key) ?? []}
      context={fieldContext}
      dispatch={dispatch}
      pin={pinControls(panelNode.key)}
      onClose={() => setPanelKey(null)}
      onExpand={() => expand(panelNode.key)}
      renameSignal={renameSignal}
      focus={focusRequest?.key === panelNode.key ? focusRequest.request : null}
      test={stepTest(panelNode)}
      showTest={showTest?.key === panelNode.key ? showTest.seq : 0}
    />
  ) : null;
  const expandedNode = expandedKey
    ? state.graph.nodes.find((node) => node.key === expandedKey)
    : undefined;

  const trigger = state.graph.nodes.find((node) => isTriggerType(node.type));
  // The run bar: the painted test, or one still going after an edit cleared the paint.
  const barRun =
    testRun.painted ??
    (testRun.model && !isTerminalRun(testRun.model.runStatus) ? testRun.model : null);
  const barSteps = barRun
    ? testRun.stepTestKey
      ? 1
      : (barRun.graph ?? state.graph).nodes.length
    : 0;
  const reviewStep = reviewKey && testRun.model ? testRun.model.steps[reviewKey] : undefined;

  /** An issue from the top bar or the live controls: back to the Editor, then to its field. */
  function openIssue(issue: ValidationIssue) {
    setPreview(null);
    setTab('editor');
    goToIssue(issue);
  }

  const empty =
    state.graph.nodes.length === 0 ? (
      <div className="flex max-w-3xl flex-col items-center gap-6">
        <button
          type="button"
          data-testid="add-trigger"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            // Over the tile it opened from (the popover sits 8 px right of and 40 px above `at`).
            setPicker({
              placement: 'trigger',
              at: { x: rect.left + rect.width / 2 - PICKER_WIDTH / 2 - 8, y: rect.top + 40 },
            });
          }}
          className="flex w-72 flex-col items-center gap-2 rounded-card border-2 border-dashed border-outline bg-secondary p-6 text-center outline-none hover:bg-actionSecondary hover:text-onActionLight focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-md border-2 border-outline bg-secondary text-ink">
            <Plus aria-hidden="true" className="h-5 w-5" strokeWidth={2.5} />
          </span>
          <span className="type-heading text-lg">Add A Trigger</span>
          <span className="font-sans text-sm">Choose what starts this workflow.</span>
        </button>
        <TemplateGallery
          templates={templates}
          onChoose={fromTemplate}
          busyId={null}
          compact
          limit={3}
        />
      </div>
    ) : null;

  const pickerLeft = picker
    ? Math.max(
        8,
        Math.min(
          picker.at.x + 8,
          (typeof window === 'undefined' ? 1200 : window.innerWidth) - PICKER_WIDTH - 8,
        ),
      )
    : 0;
  const pickerTop = picker
    ? Math.max(
        8,
        Math.min(
          picker.at.y - 40,
          (typeof window === 'undefined' ? 800 : window.innerHeight) - PICKER_HEIGHT - 8,
        ),
      )
    : 0;

  return (
    <BuilderProvider value={builderApi}>
      <div className="flex min-w-0 flex-1 flex-col gap-3" data-testid="workflow-builder">
        <BuilderTopBar
          name={state.name}
          onRename={(name) => dispatch({ type: 'rename', name })}
          status={autosave.status}
          message={autosave.message}
          tab={tab}
          onTabChange={(next) => {
            setPreview(null);
            setTab(next);
          }}
          issues={issues}
          graph={state.graph}
          onOpenIssue={openIssue}
          issuesSignal={issuesSignal}
          testControls={
            editing ? (
              <TestControls
                trigger={trigger}
                hasPinnedTrigger={trigger ? pinnedKeys.has(trigger.key) : false}
                busy={testRun.busy}
                running={testRun.running}
                stopping={testRun.stopping}
                onStart={(options) => void testRun.start(options)}
                onStop={() => void testRun.stop()}
                startSignal={startSignal}
              />
            ) : null
          }
          liveControls={
            <WorkflowLiveControls
              automation={{
                id: automation.id,
                name: state.name,
                status: live.status,
                activeVersion: live.activeVersion,
                hasUnpublishedChanges: unpublished,
              }}
              graph={state.graph}
              issues={issues}
              catalog={catalog}
              canManage={canManage}
              flush={flushRevision}
              onChanged={adopt}
              onOpenIssue={openIssue}
              onRunStarted={showRun}
              summary={summary}
            />
          }
          onVersions={() => setVersionsOpen(true)}
          onDuplicate={() => void duplicateWorkflow()}
          onDelete={() => setDeleting(true)}
          stepsHidden={!wide && preview === null}
          onShowSteps={() => setStepsSheet(true)}
        />

        {autosave.status === 'conflict' ? (
          <Alert variant="danger" className="flex-wrap items-center" data-testid="save-conflict">
            <TriangleAlert aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={2.5} />
            <span className="min-w-0 grow basis-56">{CONFLICT_MESSAGE}</span>
            <Button variant="secondary" size="sm" onClick={copyChanges}>
              Copy My Changes
            </Button>
            <Button
              size="sm"
              onClick={() => {
                autosave.letGo();
                window.location.reload();
              }}
            >
              Reload
            </Button>
          </Alert>
        ) : null}
        {autosave.status === 'failed' ? (
          <Alert variant="danger" className="flex-wrap items-center">
            <TriangleAlert aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={2.5} />
            <span className="min-w-0 grow basis-56">
              {autosave.message ?? 'Your changes were not saved.'}
            </span>
            <Button variant="secondary" size="sm" onClick={autosave.retry}>
              Try Again
            </Button>
          </Alert>
        ) : null}
        {!wide && !narrowDismissed ? (
          <Alert variant="warning" className="flex-wrap items-center">
            <span className="min-w-0 grow basis-40">{SMALL_SCREEN_MESSAGE}</span>
            <Button variant="secondary" size="sm" onClick={() => setNarrowDismissed(true)}>
              Got It
            </Button>
          </Alert>
        ) : null}

        {tab === 'runs' ? (
          <RunsTab
            orgId={orgId}
            automationId={automation.id}
            automationName={state.name}
            catalog={catalog}
            activeVersion={live.activeVersion}
            runId={runId}
            openReview={review}
            onSelectRun={selectRun}
            onDebugInEditor={debugInEditor}
          />
        ) : preview ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="version-preview">
            <VersionPreviewBanner
              automationId={automation.id}
              version={preview}
              flush={flushRevision}
              onRestored={adopt}
              onClose={() => setPreview(null)}
            />
            <div className="flex min-h-0 flex-1 overflow-hidden rounded-card border-2 border-outline shadow-brutalSm">
              <RunCanvas
                key={preview.version}
                graph={preview.graph}
                run={null}
                catalog={catalog}
                className="min-h-0 flex-1"
              />
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-card border-2 border-outline shadow-brutalSm">
            {wide ? (
              stepsOpen ? (
                <div
                  data-steps-panel
                  className="flex w-70 shrink-0 flex-col border-r-2 border-outline bg-chrome"
                >
                  {stepsPicker}
                </div>
              ) : (
                <StepPicker
                  placement="panel"
                  catalog={catalog}
                  hasTrigger={hasTrigger}
                  recent={recent}
                  orgId={orgId}
                  onPick={(item) => addItem(item)}
                  onCollapse={() => setStepsOpen(true)}
                  collapsed
                />
              )
            ) : null}

            <div className="flex min-w-0 flex-1 flex-col">
              <div ref={canvasBox} className="relative min-h-0 min-w-0 flex-1">
                <WorkflowCanvas
                  graph={state.graph}
                  selection={state.selection}
                  issues={issuesMap}
                  summary={summary}
                  tidying={tidying}
                  run={testRun.painted}
                  onRunBadgeClick={expandRun}
                  onConnectRefused={(reason) =>
                    toast({ title: reason || LOOP_REFUSED, variant: 'danger' })
                  }
                  onDropStep={(itemId, at) => {
                    const item = catalog
                      ? pickerItems(catalog, { placement: 'panel', hasTrigger }).find(
                          (entry) => entry.id === itemId,
                        )
                      : undefined;
                    if (item) addItem(item, { position: at });
                  }}
                  onPaneClick={() => {
                    setPanelKey(null);
                    setPicker(null);
                  }}
                  empty={empty}
                >
                  <CanvasControls
                    canUndo={state.past.length > 0}
                    canRedo={state.future.length > 0}
                    onUndo={() => dispatch({ type: 'undo' })}
                    onRedo={() => dispatch({ type: 'redo' })}
                    onTidy={tidy}
                    locked={locked}
                    onLock={() => setLocked((value) => !value)}
                    hasSteps={state.graph.nodes.length > 0}
                  />
                  {showSetup && state.graph.nodes.length > 0 ? (
                    <Panel position="top-left" className="m-3!">
                      <FinishSetup
                        items={setupList}
                        onOpen={(item) => goToIssue(item.issue)}
                        onDismiss={() => setShowSetup(false)}
                      />
                    </Panel>
                  ) : null}
                </WorkflowCanvas>
              </div>
              {barRun ? (
                <RunBar
                  run={barRun}
                  totalSteps={barSteps}
                  stopping={testRun.stopping}
                  onStop={() => void testRun.stop()}
                  onClose={testRun.unpaint}
                  onOpenReview={setReviewKey}
                />
              ) : null}
            </div>

            {wide && panel ? (
              <div
                className="relative flex shrink-0 flex-col border-l-2 border-outline"
                style={{ width: panelWidth }}
                data-testid="step-panel-dock"
              >
                <ResizeHandle
                  label="Resize Step Panel"
                  value={panelWidth}
                  min={PANEL_MIN}
                  max={PANEL_MAX}
                  step={PANEL_STEP}
                  grows="left"
                  valueText={`${panelWidth} pixels wide`}
                  onChange={setPanelWidth}
                  className="absolute inset-y-0 -left-1.5 w-3"
                />
                {panel}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {!wide && editing ? (
        <>
          <Sheet open={stepsSheet} onOpenChange={setStepsSheet}>
            <SheetContent side="left" className="flex w-80 flex-col p-0" data-steps-panel>
              <SheetTitle className="sr-only">Steps</SheetTitle>
              <SheetDescription className="sr-only">
                Choose a step to add to the workflow.
              </SheetDescription>
              {stepsPicker}
            </SheetContent>
          </Sheet>
          <Sheet open={panel !== null} onOpenChange={(value) => !value && setPanelKey(null)}>
            {/* The panel has its own Close; workflow-canvas.css hides the sheet's, which sat on top of it. */}
            <SheetContent
              side="right"
              className="flex w-full max-w-md flex-col p-0"
              data-step-sheet=""
            >
              <SheetTitle className="sr-only">{panelNode?.name ?? 'Step'}</SheetTitle>
              <SheetDescription className="sr-only">Set up this step.</SheetDescription>
              {panel}
            </SheetContent>
          </Sheet>
        </>
      ) : null}

      {picker && editing ? (
        <PickerPopover left={pickerLeft} top={pickerTop} onClose={() => setPicker(null)}>
          <StepPicker
            placement={picker.placement}
            catalog={catalog}
            hasTrigger={hasTrigger}
            recent={recent}
            orgId={orgId}
            onClose={() => setPicker(null)}
            onPick={(item) =>
              addItem(item, {
                from: picker.from,
                edgeId: picker.edgeId,
                position: picker.flowAt
                  ? { x: picker.flowAt.x, y: picker.flowAt.y - 38 }
                  : undefined,
              })
            }
            className="h-full"
          />
        </PickerPopover>
      ) : null}

      <CanvasContextMenu
        at={menu?.at ?? null}
        items={menu ? menuItems(menu.target) : []}
        onClose={() => setMenu(null)}
      />

      <CommandPalette
        open={palette}
        onOpenChange={setPalette}
        items={paletteItems}
        steps={state.graph.nodes}
        onAddStep={(item) => addItem(item)}
        onGoToStep={(key) => {
          open(key);
          reveal(key);
        }}
        onCommand={onPalette}
      />
      <ShortcutsSheet open={shortcuts} onOpenChange={setShortcuts} />
      <VersionsDrawer
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        automationId={automation.id}
        previewing={preview?.version ?? null}
        onPreview={(version) => {
          setPreview(version);
          if (version) setTab('editor');
        }}
      />

      <ExpandedView
        node={expandedNode}
        graph={state.graph}
        issues={expandedNode ? (issuesMap.get(expandedNode.key) ?? []) : []}
        context={fieldContext}
        dispatch={dispatch}
        pin={pinControls(expandedNode?.key ?? '')}
        onClose={() => {
          setExpandedKey(null);
          setFromBadge(false);
        }}
        onNavigate={(key) => {
          open(key);
          setExpandedKey(key);
          reveal(key);
        }}
        test={expandedNode ? stepTest(expandedNode) : undefined}
        runResult={
          fromBadge && expandedNode ? stepResult(expandedNode.key, testRun.model, {}) : null
        }
      />

      <Dialog
        open={reviewStep !== undefined}
        onOpenChange={(value) => !value && setReviewKey(null)}
      >
        {reviewStep && testRun.model ? (
          <DialogContent className="flex max-w-xl flex-col gap-3" data-testid="test-review-dialog">
            <DialogTitle className="type-heading pr-10 text-lg text-ink">Manual Review</DialogTitle>
            <DialogDescription className="sr-only">
              This test waits for an answer before it goes on.
            </DialogDescription>
            <ReviewCard
              runId={testRun.model.runId}
              step={reviewStep}
              autoFocus
              onAnswered={() => {
                testRun.refresh();
                setReviewKey(null);
              }}
              className="border-0 p-0 shadow-none"
            />
          </DialogContent>
        ) : null}
      </Dialog>

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {state.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {live.status === 'ACTIVE'
                ? 'It is on now: it stops at once and its runs are kept. This cannot be undone.'
                : 'Its runs are kept. This cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep It</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              disabled={busy}
              onClick={() => void deleteWorkflow()}
            >
              {busy ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={leaveAsk !== null} onOpenChange={(value) => !value && answerLeave(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave Without Saving?</AlertDialogTitle>
            <AlertDialogDescription>
              Your latest changes are not saved yet. They are lost if you leave now.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => answerLeave(false)}>Stay</AlertDialogCancel>
            <AlertDialogAction variant="danger" onClick={() => answerLeave(true)}>
              Leave Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </BuilderProvider>
  );
}

/** The picker as a floating panel at a point: closes on Esc (the picker) or a click outside. */
function PickerPopover({
  left,
  top,
  onClose,
  children,
}: {
  left: number;
  top: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (box.current && !box.current.contains(event.target as Node)) onClose();
    }
    // Next tick, so the click that opened it does not close it.
    const timer = setTimeout(() => window.addEventListener('pointerdown', onPointerDown), 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [onClose]);
  return (
    <div
      ref={box}
      className="fixed z-50 flex flex-col overflow-hidden rounded-card border-2 border-outline bg-secondary shadow-brutalLg"
      style={{ left, top, width: PICKER_WIDTH, height: PICKER_HEIGHT }}
      data-testid="step-picker-popover"
    >
      {children}
    </div>
  );
}
