/**
 * Workflows (Sprint 10, Module 05): the workspace's workflows and the
 * starter templates. The list loads on the server; a failed load is handed
 * down as `null` so the island shows its own retry. Templates are fixed
 * data in `@postgear/automation`, so they need no request.
 *
 * Nothing is fetched while the active-workspace cookie names another
 * workspace (see the Studio page): the list loads once the switch has landed.
 *
 * `?connections=1` opens the Connections modal on arrival (the old
 * Connections address and an OAuth return both land here).
 *
 * The viewer's role comes along (Module 09): only workspace admins turn
 * workflows on and off, so members get no Activate or Pause in the row menu.
 * The API's guard is the real check; this only avoids offering a 403.
 */
import { getTemplate, listTemplates } from '@postgear/automation';
import type { Metadata } from 'next';
import { previewFromGraph } from '@/components/workflows/list/workflow-preview';
import { WorkflowsList } from '@/components/workflows/list/workflows-list';
import { serverApi } from '@/lib/api';
import { getActiveOrgId, getSessionCookieHeader } from '@/lib/session';
import type { AutomationListResponse, TemplateWithPicture } from '@/types/workflows';

const EMPTY_PICTURE = { nodes: [], edges: [], stepCount: 0 };

/** Each template with its steps, shown in the side preview. Fixed data, so no request. */
function templatesWithPictures(): TemplateWithPicture[] {
  return listTemplates().map((template) => {
    const graph = getTemplate(template.id)?.graph;
    return { ...template, preview: graph ? previewFromGraph(graph) : EMPTY_PICTURE };
  });
}

export const metadata: Metadata = { title: 'Workflows' };

export default async function WorkflowsPage({
  params,
  searchParams,
}: PageProps<'/[orgId]/workflows'>) {
  const { orgId } = await params;
  const { connections, connectError, connection } = await searchParams;
  const cookie = await getSessionCookieHeader();
  const pending = (await getActiveOrgId()) !== orgId;

  const [list, me] = await Promise.all([
    pending
      ? null
      : serverApi<AutomationListResponse>('/automations', { cookie }).catch(() => null),
    serverApi<{ organizations: { id: string; role: string }[] }>('/orgs', { cookie })
      .then(
        (result) => result.organizations.find((organization) => organization.id === orgId) ?? null,
      )
      .catch(() => null),
  ]);
  const canManage = me?.role === 'ADMIN' || me?.role === 'SUPERADMIN';

  return (
    <WorkflowsList
      orgId={orgId}
      initialWorkflows={list?.automations ?? null}
      initialCounts={list?.counts ?? null}
      templates={templatesWithPictures()}
      canManage={canManage}
      connectionsOpen={connections === '1'}
      connectErrorCode={typeof connectError === 'string' ? connectError : null}
      connectedId={typeof connection === 'string' && connection ? connection : null}
    />
  );
}
