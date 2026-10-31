'use client';

/**
 * Workflows (Sprint 10, Module 05; blueprint section 9): the list page.
 *
 * Laid out as the calendar (Workflows revamp, 2026-10-31): a framed card
 * beside the main sidebar (`workflows-sidebar.tsx`) with Create Workflow,
 * Connections and the templates by title, and beside it, on the page ground,
 * the status filter (All, Active, Paused, Draft, each with its count, set as
 * Queue's tabs are: `workflow-status-tabs.tsx`) over a grid of workflow
 * cards. Each card draws its workflow as a small picture, as Studio's cards
 * draw a design (`workflow-card.tsx`); the table it replaced is gone.
 * Creating, from blank or a template, makes a draft and opens it in the
 * builder, which takes the whole window; a template opens with the Finish
 * Setup list (`?setup=1`).
 *
 * The page scrolls as one. The left card is as tall as its content and sticks
 * while the grid scrolls past, then goes with the grid's last row
 * (`use-release-distance.ts`). It was pinned with GSAP's ScrollTrigger first,
 * which judders inside a scrolling container; the browser's own sticky does
 * not.
 *
 * There is no search here (2026-10-31): the top bar's search is the one
 * search, and a page's own box beside it was a second one. The filter asks
 * the API.
 *
 * Connections open in a modal (`connections/connections-dialog.tsx`); the old
 * `?connections=1` address and an OAuth return open it on arrival.
 *
 * Module 09: admins turn a workflow on or off from its row menu. Activate
 * loads the draft and the API's issues for it, then opens the builder's own
 * activation dialog: the issues list (each one opens the builder on its
 * step) when the draft is not ready, the confirm otherwise.
 */
import type { ValidationIssue } from '@postgear/automation';
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
  EmptyState,
  Skeleton,
  toast,
} from '@postgear/ui';
import { Workflow } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type {
  AutomationDetail,
  AutomationListResponse,
  AutomationListItem,
  AutomationStatusCounts,
  TemplateWithPicture,
} from '@/types/workflows';
import { ActivationDialog } from '../activation/activation-dialog';
import { PauseDialog } from '../activation/pause-dialog';
import { ConnectionsDialog } from '../connections/connections-dialog';
import { useReleaseDistance } from './use-release-distance';
import { WorkflowCard } from './workflow-card';
import { previewFromGraph } from './workflow-preview';
import { type StatusFilter, WorkflowStatusTabs } from './workflow-status-tabs';
import { WorkflowsSidebar } from './workflows-sidebar';
import { deleteWorkflowWarning, NO_MATCHES } from './workflows-view-model';

/** The cards' grid, wide enough for three across beside the left card at 1366px. */
const GRID = 'grid grid-cols-2 gap-4 xl:grid-cols-3 2xl:grid-cols-4';

function browserZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function toListItem(detail: AutomationDetail): AutomationListItem {
  const {
    draftGraph,
    draftRevision: _revision,
    pinned: _pinned,
    activeVersion: _version,
    ...rest
  } = detail;
  return { ...rest, runs30d: 0, preview: previewFromGraph(draftGraph) };
}

function failure(cause: unknown, fallback: string): string {
  return cause instanceof ApiError && cause.status !== 0 ? cause.message : fallback;
}

export interface WorkflowsListProps {
  orgId: string;
  initialWorkflows: AutomationListItem[] | null;
  /** The tab counts that came with the list; null when the server had no list. */
  initialCounts: AutomationStatusCounts | null;
  templates: TemplateWithPicture[];
  /** Workspace admins turn workflows on and off from the row menu. */
  canManage: boolean;
  /** `?connections=1`: open the Connections modal on arrival. */
  connectionsOpen?: boolean;
  /** `?connectError=` from a connection sign-in that did not finish. */
  connectErrorCode?: string | null;
  /** `?connection=` from a connection sign-in that finished. */
  connectedId?: string | null;
}

/** Activate from a row: the draft as saved and the API's issues for it. */
interface Activating {
  item: AutomationListItem;
  detail: AutomationDetail;
  issues: ValidationIssue[];
}

export function WorkflowsList({
  orgId,
  initialWorkflows,
  initialCounts,
  templates,
  canManage,
  connectionsOpen = false,
  connectErrorCode = null,
  connectedId = null,
}: WorkflowsListProps) {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<AutomationListItem[] | null>(initialWorkflows);
  const [counts, setCounts] = useState<AutomationStatusCounts | null>(initialCounts);
  const [connecting, setConnecting] = useState(connectionsOpen);
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [creating, setCreating] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AutomationListItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [activating, setActivating] = useState<Activating | null>(null);
  const [pausing, setPausing] = useState<AutomationListItem | null>(null);
  // One clock for every card's "Updated". The server cannot share it, so it
  // starts empty and the browser sets it on mount (no hydration mismatch).
  const [now, setNow] = useState<number | null>(null);
  const first = useRef(true);
  const sidebar = useRef<HTMLDivElement>(null);
  const results = useRef<HTMLElement>(null);
  // How far above the grid's bottom the sticky left card is let go.
  const release = useReleaseDistance(results, sidebar);
  const filtered = status !== 'ALL';

  useEffect(() => {
    setNow(Date.now());
  }, []);

  async function load(nextStatus: StatusFilter) {
    const query = new URLSearchParams();
    if (nextStatus !== 'ALL') query.set('status', nextStatus);
    const suffix = query.size ? `?${query.toString()}` : '';
    try {
      const result = await api<AutomationListResponse>(`/automations${suffix}`);
      setWorkflows(result.automations);
      setCounts(result.counts);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: `load` reads only its arguments, and the server's list is read once
  useEffect(() => {
    if (first.current) {
      first.current = false;
      // The server had nothing (a workspace switch, or a failed load): ask here.
      if (initialWorkflows === null) void load(status);
      return;
    }
    void load(status);
  }, [status]);

  async function create(templateId?: string) {
    setCreating(templateId ?? 'blank');
    try {
      const body = templateId ? { templateId, timeZone: browserZone() } : {};
      const { automation } = await api<{ automation: AutomationDetail }>('/automations', {
        method: 'POST',
        body,
      });
      router.push(`/${orgId}/workflows/${automation.id}${templateId ? '?setup=1' : ''}`);
    } catch (cause) {
      setCreating(null);
      toast({
        title: failure(cause, 'The workflow was not created. Try again.'),
        variant: 'danger',
      });
    }
  }

  async function duplicate(workflow: AutomationListItem) {
    try {
      const { automation } = await api<{ automation: AutomationDetail }>(
        `/automations/${workflow.id}/duplicate`,
        { method: 'POST' },
      );
      setWorkflows((current) => [toListItem(automation), ...(current ?? [])]);
      toast({ title: 'Workflow duplicated' });
      void load(status);
    } catch (cause) {
      toast({ title: failure(cause, 'That did not work. Try again.'), variant: 'danger' });
    }
  }

  /** Swaps in what activate or pause answered, keeping the row's run count. */
  function replaceRow(detail: AutomationDetail) {
    setWorkflows((current) =>
      (current ?? []).map((entry) =>
        entry.id === detail.id ? { ...toListItem(detail), runs30d: entry.runs30d } : entry,
      ),
    );
    // The tab counts, and a filtered list the row no longer belongs in.
    void load(status);
  }

  async function startActivate(workflow: AutomationListItem) {
    setPreparing(workflow.id);
    const path = `/automations/${encodeURIComponent(workflow.id)}`;
    try {
      const [{ automation }, { issues }] = await Promise.all([
        api<{ automation: AutomationDetail }>(path),
        api<{ issues: ValidationIssue[] }>(`${path}/validate`, { method: 'POST' }),
      ]);
      setActivating({ item: workflow, detail: automation, issues });
    } catch (cause) {
      toast({ title: failure(cause, 'That did not work. Try again.'), variant: 'danger' });
    } finally {
      setPreparing(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/automations/${deleting.id}`, { method: 'DELETE' });
      setWorkflows((current) => (current ?? []).filter((entry) => entry.id !== deleting.id));
      toast({ title: 'Workflow deleted' });
      setDeleting(null);
      void load(status);
    } catch (cause) {
      toast({ title: failure(cause, 'That did not work. Try again.'), variant: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 md:flex-row md:gap-5">
      {/* A column as tall as the grid less its last row; the card sticks inside it,
          so it stays in view and leaves with that last row (use-release-distance.ts). */}
      <div
        className="md:mb-[var(--release)] md:shrink-0"
        style={{ '--release': `${release}px` } as CSSProperties}
      >
        <WorkflowsSidebar
          ref={sidebar}
          // Top 0: a sticky box already sits inside the page's own top padding.
          // Above the grid, so the template preview opens over its first cards.
          className="md:sticky md:top-0 md:z-20"
          templates={templates}
          creating={creating}
          onCreate={() => void create()}
          onChooseTemplate={(id) => void create(id)}
          onOpenConnections={() => setConnecting(true)}
        />
      </div>

      <section ref={results} aria-label="Workflows" className="flex min-w-0 flex-1 flex-col gap-3">
        <WorkflowStatusTabs value={status} counts={counts} onChange={setStatus} />

        {/* The page scrolls as one; the left card sticks beside it. */}
        <div className="pb-2">
          {workflows === null && !failed ? (
            <div role="status" aria-busy="true" aria-label="Loading workflows" className={GRID}>
              {Array.from({ length: 6 }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
                <Skeleton key={index} className="aspect-[4/5]" />
              ))}
            </div>
          ) : workflows === null ? (
            <Alert variant="danger" className="flex-wrap items-center">
              <span className="min-w-0 grow">The workflows could not be loaded.</span>
              <Button variant="secondary" size="sm" onClick={() => void load(status)}>
                Retry
              </Button>
            </Alert>
          ) : workflows.length === 0 ? (
            filtered ? (
              <EmptyState icon={Workflow} title={NO_MATCHES} />
            ) : (
              <EmptyState
                icon={Workflow}
                title="No workflows yet"
                description="Start from a template or build your own."
                action={{ label: 'Create Workflow', onClick: () => void create() }}
              />
            )
          ) : (
            <ul className={`${GRID} m-0 list-none p-0`}>
              {workflows.map((workflow) => {
                const href = `/${orgId}/workflows/${workflow.id}`;
                return (
                  <WorkflowCard
                    key={workflow.id}
                    workflow={workflow}
                    href={href}
                    now={now}
                    canManage={canManage}
                    busy={preparing === workflow.id}
                    onOpen={() => router.push(href)}
                    onDuplicate={() => void duplicate(workflow)}
                    onActivate={() => void startActivate(workflow)}
                    onPause={() => setPausing(workflow)}
                    onDelete={() => setDeleting(workflow)}
                  />
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <ConnectionsDialog
        orgId={orgId}
        open={connecting}
        onOpenChange={setConnecting}
        canManage={canManage}
        connectErrorCode={connectErrorCode}
        connectedId={connectedId}
      />

      {activating ? (
        <ActivationDialog
          open
          onOpenChange={(open) => {
            if (!open) setActivating(null);
          }}
          automationId={activating.item.id}
          mode="turnOn"
          graph={activating.detail.draftGraph}
          issues={activating.issues}
          // Nothing is unsaved here: the list activates the draft as stored.
          flush={async () => activating.detail.draftRevision}
          onActivated={(result) => replaceRow(result.automation)}
          onOpenIssue={(issue) => {
            const step = issue.nodeKey ? `?step=${encodeURIComponent(issue.nodeKey)}` : '';
            router.push(`/${orgId}/workflows/${activating.item.id}${step}`);
          }}
        />
      ) : null}

      {pausing ? (
        <PauseDialog
          open
          onOpenChange={(open) => {
            if (!open) setPausing(null);
          }}
          automationId={pausing.id}
          triggerType={pausing.triggerType}
          onPaused={replaceRow}
        />
      ) : null}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting ? deleteWorkflowWarning(deleting) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep It</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              onClick={() => void confirmDelete()}
              disabled={busy}
              data-testid="workflow-delete-confirm"
            >
              {busy ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
