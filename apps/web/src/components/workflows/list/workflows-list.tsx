'use client';

/**
 * Workflows (Sprint 10, Module 05; blueprint section 9): the list page.
 *
 * `PageActions` holds the search, the status filter, the way to Connections
 * and **Create Workflow**; then Start From A Template, then the table (Name,
 * Trigger, Status, Last Run, Runs In 30 Days, Updated). Creating, from blank
 * or a template, makes a draft and opens it in the builder; a template opens
 * with the Finish Setup list (`?setup=1`).
 *
 * Search and the filter ask the API (it pages and matches every word), a
 * moment after the last key, so typing does not send a request per letter.
 *
 * Module 09: admins turn a workflow on or off from its row menu. Activate
 * loads the draft and the API's issues for it, then opens the builder's own
 * activation dialog: the issues list (each one opens the builder on its
 * step) when the draft is not ready, the confirm otherwise.
 */
import { PlugIcon } from '@animateicons/react/lucide/plug-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
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
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  MotionIcon,
  PageActions,
  SearchInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  TooltipHint,
  toast,
} from '@postgear/ui';
import { Workflow } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ActionLink } from '@/components/home/home-actions';
import { ApiError, api } from '@/lib/api';
import type {
  AutomationDetail,
  AutomationListItem,
  AutomationStatus,
  TemplateSummary,
} from '@/types/workflows';
import { ActivationDialog } from '../activation/activation-dialog';
import { showsUnpublishedChanges } from '../activation/activation-model';
import { PauseDialog } from '../activation/pause-dialog';
import { AppIcon } from '../app-icon';
import { TemplateGallery } from './template-gallery';
import { WorkflowRowMenu } from './workflow-row-menu';
import {
  ago,
  deleteWorkflowWarning,
  lastRunText,
  NO_MATCHES,
  runsText,
  STATUS_FILTERS,
  triggerText,
  WORKFLOW_STATUS,
} from './workflows-view-model';

const SEARCH_DELAY_MS = 300;

type StatusFilter = AutomationStatus | 'ALL';

function browserZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function toListItem(detail: AutomationDetail): AutomationListItem {
  const {
    draftGraph: _graph,
    draftRevision: _revision,
    pinned: _pinned,
    activeVersion: _version,
    ...rest
  } = detail;
  return { ...rest, runs30d: 0 };
}

function failure(cause: unknown, fallback: string): string {
  return cause instanceof ApiError && cause.status !== 0 ? cause.message : fallback;
}

export interface WorkflowsListProps {
  orgId: string;
  initialWorkflows: AutomationListItem[] | null;
  templates: TemplateSummary[];
  /** Workspace admins turn workflows on and off from the row menu. */
  canManage: boolean;
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
  templates,
  canManage,
}: WorkflowsListProps) {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<AutomationListItem[] | null>(initialWorkflows);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [creating, setCreating] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AutomationListItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [activating, setActivating] = useState<Activating | null>(null);
  const [pausing, setPausing] = useState<AutomationListItem | null>(null);
  const first = useRef(true);
  const filtered = search.trim().length > 0 || status !== 'ALL';

  async function load(nextSearch: string, nextStatus: StatusFilter) {
    const query = new URLSearchParams();
    if (nextSearch.trim()) query.set('search', nextSearch.trim());
    if (nextStatus !== 'ALL') query.set('status', nextStatus);
    const suffix = query.size ? `?${query.toString()}` : '';
    try {
      const result = await api<{ automations: AutomationListItem[] }>(`/automations${suffix}`);
      setWorkflows(result.automations);
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
      if (initialWorkflows === null) void load(search, status);
      return;
    }
    const timer = setTimeout(() => void load(search, status), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search, status]);

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
    } catch (cause) {
      toast({ title: failure(cause, 'That did not work. Try again.'), variant: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack gap="lg">
      <PageActions>
        <div className="w-full sm:w-64">
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onClear={() => setSearch('')}
            placeholder="Enter your search"
            aria-label="Search workflows"
          />
        </div>
        <Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((filter) => (
              <SelectItem key={filter.id} value={filter.id}>
                {filter.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ActionLink href={`/${orgId}/workflows/connections`}>
          <MotionIcon icon={PlugIcon} className="h-4 w-4" />
          Connections
        </ActionLink>
        <Button
          onClick={() => void create()}
          disabled={creating !== null}
          data-testid="workflow-create"
        >
          <MotionIcon icon={PlusIcon} className="h-4 w-4" />
          {creating === 'blank' ? 'Creating...' : 'Create Workflow'}
        </Button>
      </PageActions>

      <TemplateGallery
        templates={templates}
        onChoose={(id) => void create(id)}
        busyId={creating && creating !== 'blank' ? creating : null}
      />

      {workflows === null && !failed ? (
        <Skeleton className="h-48" aria-label="Loading workflows" />
      ) : workflows === null ? (
        <Alert variant="danger" className="flex-wrap items-center">
          <span className="min-w-0 grow">The workflows could not be loaded.</span>
          <Button variant="secondary" size="sm" onClick={() => void load(search, status)}>
            Retry
          </Button>
        </Alert>
      ) : workflows.length === 0 ? (
        filtered ? (
          <Text muted>{NO_MATCHES}</Text>
        ) : (
          <EmptyState
            icon={Workflow}
            title="No workflows yet"
            description="Start from a template or build your own."
          />
        )
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Run</TableHead>
                  <TableHead>Runs In 30 Days</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="relative w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workflows.map((workflow) => {
                  const trigger = triggerText(workflow.triggerType);
                  const state = WORKFLOW_STATUS[workflow.status];
                  const run = lastRunText(workflow);
                  const href = `/${orgId}/workflows/${workflow.id}`;
                  return (
                    <TableRow
                      key={workflow.id}
                      data-testid="workflow-row"
                      data-workflow-id={workflow.id}
                    >
                      <TableCell>
                        <Link
                          href={href}
                          className="type-ui text-ink underline-offset-4 hover:underline"
                        >
                          {workflow.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          {trigger.icon ? <AppIcon icon={trigger.icon} /> : null}
                          <Text size="sm" as="span" muted={!trigger.icon}>
                            {trigger.title}
                          </Text>
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant={state.variant}>{state.label}</Badge>
                          {showsUnpublishedChanges(workflow) ? (
                            <Badge variant="accent">Unpublished Changes</Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        {run ? (
                          <span className="flex flex-col items-start gap-1">
                            {workflow.lastRunError ? (
                              <TooltipHint label={workflow.lastRunError}>
                                <Badge variant={run.variant} tabIndex={0}>
                                  {run.label}
                                </Badge>
                              </TooltipHint>
                            ) : (
                              <Badge variant={run.variant}>{run.label}</Badge>
                            )}
                            {workflow.lastRunAt ? (
                              <Text size="xs" muted as="span">
                                {ago(workflow.lastRunAt)}
                              </Text>
                            ) : null}
                          </span>
                        ) : (
                          <Text size="sm" muted as="span">
                            Never run
                          </Text>
                        )}
                      </TableCell>
                      <TableCell>
                        <Text size="sm" as="span">
                          {runsText(workflow.runs30d)}
                        </Text>
                      </TableCell>
                      <TableCell>
                        <Text size="sm" as="span">
                          {ago(workflow.updatedAt)}
                        </Text>
                      </TableCell>
                      <TableCell>
                        <WorkflowRowMenu
                          workflow={workflow}
                          canManage={canManage}
                          busy={preparing === workflow.id}
                          onOpen={() => router.push(href)}
                          onDuplicate={() => void duplicate(workflow)}
                          onActivate={() => void startActivate(workflow)}
                          onPause={() => setPausing(workflow)}
                          onDelete={() => setDeleting(workflow)}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

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
    </Stack>
  );
}
