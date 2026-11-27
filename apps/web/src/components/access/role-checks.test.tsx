/**
 * Role checks go through the capability functions (Sprint 13, Module 14).
 *
 * Six screens decided "may manage" with `role !== 'USER'`, which answered yes
 * for an Editor the day the role was added: billing, API keys, webhooks, the
 * workflow builder, the workflow connection picker and the Team page. Each
 * now asks its capability. The renders below check what an Editor gets on the
 * ones that draw cheaply; the guard at the end reads every source file under
 * `apps/web/src` and fails on a role compared with a role name, so a new
 * screen cannot fail open the same way.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { TooltipProvider } from '@postgear/ui';
import { render, screen } from '@testing-library/react';
import { canManageTeam } from '@/components/settings/team-view-model';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { serverApi } from '@/lib/api';
import { getWorkspaceRole } from '@/lib/workspace-role';
import WebhooksPage from '../../app/(dashboard)/[orgId]/settings/webhooks/page';
import { ApiKeysManager } from '../developers/api-keys-manager';
import { ConnectionPicker } from '../workflows/connection-picker';

beforeAll(() => stubBrowserLayout());

let mockRole: string | null = 'EDITOR';

jest.mock('@/components/navigation/workspace-provider', () => ({
  useWorkspace: () => ({ role: mockRole }),
  useOptionalWorkspace: () => (mockRole === null ? null : { role: mockRole }),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/org-1/workflows/abc',
}));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: jest.fn(() => new Promise(() => {})),
  serverApi: jest.fn(),
}));
jest.mock('@/lib/session', () => ({ getSessionCookieHeader: async () => 'pg_session=1' }));
jest.mock('@/lib/workspace-role', () => ({ getWorkspaceRole: jest.fn() }));

const serverApiMock = serverApi as jest.MockedFunction<typeof serverApi>;
const roleMock = getWorkspaceRole as jest.MockedFunction<typeof getWorkspaceRole>;

beforeEach(() => {
  mockRole = 'EDITOR';
});

describe('the six former fail-open sites, for an Editor', () => {
  it('Team: no management', () => {
    expect(canManageTeam('EDITOR')).toBe(false);
    expect(canManageTeam('ADMIN')).toBe(true);
  });

  it('API keys: no Create Key, and the read-only note', () => {
    render(<ApiKeysManager initialKeys={[]} />);
    expect(screen.queryByRole('button', { name: /Create Key/ })).toBeNull();
    expect(screen.getByText(/Only workspace admins can create/)).toBeTruthy();
  });

  it('API keys: an admin still creates', () => {
    mockRole = 'ADMIN';
    render(<ApiKeysManager initialKeys={[]} />);
    expect(screen.getAllByRole('button', { name: /Create Key/ }).length).toBeGreaterThan(0);
  });

  it('workflow connections: no Connect button, a line saying who to ask', () => {
    render(
      <TooltipProvider>
        <ConnectionPicker
          kind="slack"
          value=""
          onChange={jest.fn()}
          returnTo="/org-1/workflows/abc"
          connections={[]}
        />
      </TooltipProvider>,
    );
    expect(screen.queryByRole('button', { name: /Connect/ })).toBeNull();
    expect(screen.getByText(/Ask a workspace admin to connect/)).toBeTruthy();
  });

  it('workflow connections: an admin still connects', () => {
    mockRole = 'ADMIN';
    render(
      <TooltipProvider>
        <ConnectionPicker
          kind="slack"
          value=""
          onChange={jest.fn()}
          returnTo="/org-1/workflows/abc"
          connections={[]}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: /Connect/ })).toBeTruthy();
  });

  it.each([
    ['EDITOR', false],
    ['USER', false],
    ['ADMIN', true],
    [null, false],
  ] as const)('webhooks page: %s manages = %s', async (role, manages) => {
    serverApiMock.mockImplementation((async (path: string) =>
      path === '/webhooks'
        ? { webhooks: [], events: [], retryPolicy: { maximumAttempts: 5 }, allowPrivateUrls: false }
        : { channels: [] }) as typeof serverApi);
    roleMock.mockResolvedValue(role);

    const element = await WebhooksPage({
      params: Promise.resolve({ orgId: 'org-1' }),
    } as Parameters<typeof WebhooksPage>[0]);

    expect((element.props as { canManage: boolean }).canManage).toBe(manages);
  });
});

// --- The guard ---------------------------------------------------------------

const SRC = join(__dirname, '..', '..');

/** Comparing a role with a role name, either way round. */
const ROLE_COMPARISON =
  /\b\w*[rR]ole\??\s*[!=]==?\s*'(?:USER|ADMIN|SUPERADMIN|EDITOR)'|'(?:USER|ADMIN|SUPERADMIN|EDITOR)'\s*[!=]==?\s*\w*[rR]ole\b/;

/**
 * Comparisons that are not about what the viewer may do, by `file :: line
 * text`. Each needs a reason; keep it short.
 */
const ALLOWED: Record<string, string> = {
  "components/settings/team-view-model.ts :: return canManageTeam(viewerRole) && member.role !== 'SUPERADMIN';":
    "The row's own role: a superadmin's membership is a platform flag no picker may change.",
  "components/settings/team-view-model.ts :: return canManageTeam(viewerRole) && !isSelf && member.role !== 'SUPERADMIN';":
    'The same, for Remove.',
};

/** Screens and code the guard does not read: the playground's samples, and other modules' folders. */
const SKIP = ['app/dev/'];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('role checks', () => {
  it('never compare a role with a role name: they ask a capability', () => {
    const offenders: string[] = [];

    for (const file of sources(SRC)) {
      const where = relative(SRC, file).split('\\').join('/');
      if (SKIP.some((prefix) => where.startsWith(prefix))) continue;

      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (!ROLE_COMPARISON.test(line)) return;
          if (ALLOWED[`${where} :: ${line.trim()}`]) return;
          offenders.push(`${where}:${index + 1} ${line.trim()}`);
        });
    }

    expect(offenders).toEqual([]);
  });

  it.each([
    ['components/billing/billing-view.tsx', 'canManageBilling(role)'],
    ['components/developers/api-keys-manager.tsx', 'canManageApiKeys(role)'],
    ['app/(dashboard)/[orgId]/settings/webhooks/page.tsx', 'canManageWebhooks(role)'],
    ['components/workflows/builder/builder-page.tsx', 'canManageWorkflows(workspace?.role)'],
    ['components/workflows/connection-picker.tsx', 'canManageWorkflows(role)'],
    ['components/settings/team-members.tsx', 'canManageTeam(role)'],
  ])('%s asks %s', (file, call) => {
    expect(readFileSync(join(SRC, file), 'utf8')).toContain(call);
  });
});
