/**
 * Workflows (Sprint 10, Module 05): the workspace's workflows and the
 * starter templates. The list loads on the server; a failed load is handed
 * down as `null` so the island shows its own retry. Templates are fixed
 * data in `@postgear/automation`, so they need no request.
 *
 * Nothing is fetched while the active-workspace cookie names another
 * workspace (see the Studio page): the list loads once the switch has landed.
 */
import { listTemplates } from '@postgear/automation';
import type { Metadata } from 'next';
import { WorkflowsList } from '@/components/workflows/list/workflows-list';
import { serverApi } from '@/lib/api';
import { getActiveOrgId, getSessionCookieHeader } from '@/lib/session';
import type { AutomationListItem } from '@/types/workflows';

export const metadata: Metadata = { title: 'Workflows' };

export default async function WorkflowsPage({ params }: PageProps<'/[orgId]/workflows'>) {
  const { orgId } = await params;
  const cookie = await getSessionCookieHeader();
  const pending = (await getActiveOrgId()) !== orgId;

  const workflows = pending
    ? null
    : await serverApi<{ automations: AutomationListItem[] }>('/automations', { cookie })
        .then((result) => result.automations)
        .catch(() => null);

  return <WorkflowsList orgId={orgId} initialWorkflows={workflows} templates={listTemplates()} />;
}
