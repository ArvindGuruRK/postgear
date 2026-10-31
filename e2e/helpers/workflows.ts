import { type APIRequestContext, expect, type Page } from '@playwright/test';

/**
 * What `e2e/workflows.spec.ts` needs around the Workflow Builder (Sprint 10):
 * a sign-in for either seeded account, the workflow, its runs and the Slack
 * connection as the API reports them, a post that fails on purpose, and the
 * cleanup of everything a run made.
 *
 * Everything here talks to the API with the signed-in page's own cookies
 * (`page.request`), like the rest of the suite.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
export const DEMO_ORG = 'seed-demo-org';
export const ADMIN_EMAIL = 'demo@postgear.local';
export const MEMBER_EMAIL = 'member@postgear.local';
const SEED_PASSWORD = 'DemoPassword123!';

/** Every name this spec gives a workflow or a connection starts with this. */
export const NAME_PREFIX = 'E2E Workflows Spec';

/** The login throttle counts sign-ins per address per minute. */
const THROTTLE_WINDOW_MS = 61_000;

/**
 * Signs the page in as a seeded user and makes the demo workspace the active
 * one. A sign-in refused with a 429 (the normal login throttle, or other runs
 * on this machine) is tried once more after the throttle's minute.
 */
export async function signInAs(page: Page, email: string): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.locator('#password').fill(SEED_PASSWORD);

    const answered = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/auth/login',
    );
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    const response = await answered;

    if (response.status() === 429 && attempt === 1) {
      await page.waitForTimeout(THROTTLE_WINDOW_MS);
      continue;
    }

    expect(response.ok(), `sign-in answered HTTP ${response.status()}`).toBe(true);
    break;
  }

  await expect(page).toHaveURL(/\/[^/]+\/(home|calendar|channels)/, { timeout: 30_000 });
  const switched = await page.request.post(`${API_URL}/orgs/${DEMO_ORG}/switch`);
  expect(switched.ok(), `workspace switch answered HTTP ${switched.status()}`).toBe(true);
}

export interface GraphNode {
  key: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
}

export interface WorkflowDetail {
  id: string;
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED';
  activeVersion: number | null;
  hasUnpublishedChanges: boolean;
  draftGraph: { nodes: GraphNode[] };
}

export interface RunSummary {
  id: string;
  mode: 'TEST' | 'LIVE';
  status: string;
}

export interface RunDetail extends RunSummary {
  triggerPayload: { post?: { id?: string } } | null;
  steps: { nodeKey: string; status: string }[];
}

async function json<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(`${API_URL}${path}`);
  expect(response.ok(), `GET ${path} answered HTTP ${response.status()}`).toBe(true);
  return (await response.json()) as T;
}

export async function getWorkflow(request: APIRequestContext, id: string): Promise<WorkflowDetail> {
  const { automation } = await json<{ automation: WorkflowDetail }>(
    request,
    `/automations/${encodeURIComponent(id)}`,
  );
  return automation;
}

/** The Slack step's message in the saved draft. */
export async function savedSlackMessage(request: APIRequestContext, id: string): Promise<string> {
  const workflow = await getWorkflow(request, id);
  const slack = workflow.draftGraph.nodes.find((node) => node.type === 'notify.slack');
  return String(slack?.config.message ?? '');
}

export async function listRuns(request: APIRequestContext, id: string): Promise<RunSummary[]> {
  const { runs } = await json<{ runs: RunSummary[] }>(
    request,
    `/automations/${encodeURIComponent(id)}/runs`,
  );
  return runs;
}

export async function getRun(request: APIRequestContext, runId: string): Promise<RunDetail> {
  const { run } = await json<{ run: RunDetail }>(
    request,
    `/automation-runs/${encodeURIComponent(runId)}`,
  );
  return run;
}

/**
 * The live run this workflow started for the post `group`, if there is one
 * yet. Other people's failed posts in the workspace start live runs of an
 * active Post Failed workflow too, so the run is matched on its trigger data.
 */
export async function liveRunForPost(
  request: APIRequestContext,
  workflowId: string,
  group: string,
): Promise<RunDetail | null> {
  const live = (await listRuns(request, workflowId)).filter((run) => run.mode === 'LIVE');
  for (const run of live) {
    const detail = await getRun(request, run.id);
    if (detail.triggerPayload?.post?.id === group) return detail;
  }
  return null;
}

/**
 * Queues a post on the seeded LinkedIn channel to publish at once. The text
 * carries a PUBLISH_SIMULATION marker (`[simulate:400]`: the platform
 * refuses the content), so the worker fails it for good, with the
 * `rejected` reason, on the first attempt.
 */
export async function publishFailingPost(
  request: APIRequestContext,
  text: string,
): Promise<string> {
  const response = await request.post(`${API_URL}/posts`, {
    data: {
      state: 'QUEUE',
      publishNow: true,
      publishDate: new Date().toISOString(),
      shared: [
        {
          content: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
          },
          media: [],
        },
      ],
      channels: [{ channelId: 'seed-channel-linkedin', customized: false }],
    },
  });
  expect(response.ok(), `create post answered HTTP ${response.status()}`).toBe(true);
  const { post } = (await response.json()) as { post: { group: string } };
  return post.group;
}

export interface Created {
  workflowIds: Set<string>;
  connectionIds: Set<string>;
  postGroups: Set<string>;
}

export function newCreated(): Created {
  return { workflowIds: new Set(), connectionIds: new Set(), postGroups: new Set() };
}

/** `E2E Workflows Spec 1761900000000` and `E2E Workflows Spec Slack 1761900000000`. */
function stampOf(name: string): number | null {
  const match = name.match(/(\d{13})$/);
  return match ? Number(match[1]) : null;
}

/**
 * Adds this spec's leftovers from an earlier run that never reached its
 * cleanup (a killed run) to `created`, so they go too. Only names older than
 * `olderThanMs` are taken, so a run going on at the same time keeps its own.
 */
export async function adoptLeftovers(
  request: APIRequestContext,
  created: Created,
  olderThanMs: number,
): Promise<void> {
  const cutoff = Date.now() - olderThanMs;
  const isOld = (name: string) => {
    if (!name.startsWith(NAME_PREFIX)) return false;
    const stamp = stampOf(name);
    return stamp !== null && stamp < cutoff;
  };

  const { automations } = await json<{ automations: { id: string; name: string }[] }>(
    request,
    `/automations?search=${encodeURIComponent(NAME_PREFIX)}`,
  );
  for (const workflow of automations)
    if (isOld(workflow.name)) created.workflowIds.add(workflow.id);

  const { connections } = await json<{ connections: { id: string; name: string }[] }>(
    request,
    '/automation-connections',
  );
  for (const connection of connections) {
    if (isOld(connection.name)) created.connectionIds.add(connection.id);
  }
}

/**
 * Removes what a run made, in dependency order: the workflows first (a
 * connection an active workflow uses cannot be deleted), then the
 * connections, then the posts. Each answer is logged; a 404 means already gone.
 */
export async function cleanUp(request: APIRequestContext, created: Created): Promise<string[]> {
  const log: string[] = [];
  const remove = async (path: string) => {
    const response = await request.delete(`${API_URL}${path}`).catch(() => null);
    log.push(`DELETE ${path}: ${response ? response.status() : 'no answer'}`);
  };

  for (const id of created.workflowIds) await remove(`/automations/${encodeURIComponent(id)}`);
  for (const id of created.connectionIds) {
    await remove(`/automation-connections/${encodeURIComponent(id)}`);
  }
  for (const group of created.postGroups) await remove(`/posts/${encodeURIComponent(group)}`);
  return log;
}
