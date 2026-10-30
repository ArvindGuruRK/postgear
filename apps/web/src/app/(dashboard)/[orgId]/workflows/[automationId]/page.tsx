/**
 * The workflow builder (Sprint 10, Module 05; blueprint sections 3 and 4).
 *
 * The server loads the workflow with the workspace's step catalog, its
 * connections and its channels, so the canvas, the issue markers and the
 * Steps panel are there on first paint. A workflow that is not there, or is
 * another workspace's, is the not-found page: the API answers both alike.
 * Any other failure is handed down as `null` and the island asks again.
 *
 * `?setup=1` (just made from a template) shows Finish Setup; `?step=<key>`
 * opens that step. `?tab=runs` opens the Runs tab, `?run=<id>` that run
 * (on its own it means the Runs tab too) and `&review=1` its waiting review.
 * Nothing is fetched while the active-workspace cookie names another
 * workspace (see the Studio page).
 *
 * Whether the member may turn the workflow on and off comes from their
 * role here, as on the Channels page: admins and the workspace owner.
 */
import { listTemplates } from '@postgear/automation';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BuilderRoute } from '@/components/workflows/builder/builder-route';
import { initialTab } from '@/components/workflows/builder/builder-view-model';
import { ApiError, serverApi } from '@/lib/api';
import { getActiveOrgId, getSessionCookieHeader } from '@/lib/session';
import type { Channel } from '@/types/channel';
import type { AutomationDetail, Connection, WorkspaceCatalog } from '@/types/workflows';
import type { Organization } from '@/types/workspace';

export const metadata: Metadata = { title: 'Edit Workflow' };

type Loaded =
  | { kind: 'ready'; automation: AutomationDetail }
  | { kind: 'missing' }
  | { kind: 'failed' };

async function loadAutomation(id: string, cookie: string): Promise<Loaded> {
  try {
    const { automation } = await serverApi<{ automation: AutomationDetail }>(
      `/automations/${encodeURIComponent(id)}`,
      { cookie },
    );
    return { kind: 'ready', automation };
  } catch (cause) {
    return cause instanceof ApiError && cause.status === 404
      ? { kind: 'missing' }
      : { kind: 'failed' };
  }
}

export default async function WorkflowBuilderPage({
  params,
  searchParams,
}: PageProps<'/[orgId]/workflows/[automationId]'>) {
  const { orgId, automationId } = await params;
  const { setup, step, tab, run, review } = await searchParams;
  const runId = typeof run === 'string' && run ? run : null;
  const cookie = await getSessionCookieHeader();
  const pending = (await getActiveOrgId()) !== orgId;

  const [loaded, catalog, connections, channels, organizations] = pending
    ? [null, null, null, null, null]
    : await Promise.all([
        loadAutomation(automationId, cookie),
        serverApi<WorkspaceCatalog>('/automations/catalog', { cookie }).catch(() => null),
        serverApi<{ connections: Connection[] }>('/automation-connections', { cookie })
          .then((result) => result.connections)
          .catch(() => null),
        serverApi<{ channels: Channel[] }>('/channels', { cookie })
          .then((result) => result.channels)
          .catch(() => null),
        serverApi<{ organizations: Organization[] }>('/orgs', { cookie })
          .then((result) => result.organizations)
          .catch(() => null),
      ]);

  // Outside any try: `notFound()` works by throwing.
  if (loaded?.kind === 'missing') notFound();

  // Unknown (the request failed): the builder falls back to the session in the browser.
  const role = organizations?.find((organization) => organization.id === orgId)?.role;
  const canManage = role ? role === 'ADMIN' || role === 'SUPERADMIN' : null;

  return (
    <BuilderRoute
      key={automationId}
      orgId={orgId}
      automationId={automationId}
      automation={loaded?.kind === 'ready' ? loaded.automation : null}
      templates={listTemplates()}
      initialCatalog={catalog}
      initialConnections={connections}
      initialChannels={channels}
      setup={setup === '1'}
      initialStep={typeof step === 'string' ? step : null}
      canManage={canManage}
      initialTab={initialTab(typeof tab === 'string' ? tab : null, runId)}
      initialRunId={runId}
      initialReview={review === '1'}
    />
  );
}
