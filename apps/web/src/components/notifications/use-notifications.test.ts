/**
 * The bell waits for the workspace scope before asking the API anything.
 *
 * The regression: a user with two workspaces signs in with no `pg_org`
 * cookie, the layout mounts `SyncActiveWorkspace`, and the bell's first page
 * and stream went out in the same commit as the switch, so both were refused
 * with a 403 (or, with a stale cookie, answered for the other workspace).
 * Rendered with the real provider and the real `SyncActiveWorkspace`; only
 * the network is faked.
 */
import { act, render } from '@testing-library/react';
import { type ComponentProps, createElement, type ReactElement } from 'react';
import { SyncActiveWorkspace } from '../navigation/sync-active-workspace';
import { createWorkspaceScope, WorkspaceProvider } from '../navigation/workspace-provider';
import { useNotifications } from './use-notifications';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

jest.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  }
  return { api: jest.fn(), ApiError, BROWSER_API_URL: 'http://api.test' };
});

jest.mock('./event-stream', () => ({
  openEventStream: jest.fn(() => new Promise(() => undefined)),
  isAbortError: () => false,
}));

const { api } = jest.requireMock('@/lib/api') as { api: jest.Mock };
const { openEventStream } = jest.requireMock('./event-stream') as { openEventStream: jest.Mock };

const EMPTY_PAGE = { notifications: [], unread: 2, lastReadAt: null, nextCursor: null };

function Bell() {
  useNotifications();
  return null;
}

// `createElement` would want `children` among the props; they are passed as
// arguments instead, as JSX does.
const Provider = WorkspaceProvider as (
  props: Omit<ComponentProps<typeof WorkspaceProvider>, 'children'>,
) => ReactElement;

function renderShell({ syncing }: { syncing: boolean }) {
  return render(
    createElement(
      Provider,
      {
        organizations: [],
        activeOrgId: 'org-b',
        role: 'ADMIN',
        user: { name: 'Demo', email: 'demo@example.com', avatar: null },
      },
      // The layout's order: the sync before the shell that holds the bell.
      syncing ? createElement(SyncActiveWorkspace, { orgId: 'org-b' }) : null,
      createElement(Bell),
    ),
  );
}

function calledPaths(): string[] {
  return api.mock.calls.map(([path]) => path as string);
}

describe('useNotifications and the workspace scope', () => {
  beforeEach(() => {
    api.mockReset();
    openEventStream.mockClear();
  });

  it('asks for nothing until the switch has set the cookie', async () => {
    let finishSwitch: () => void = () => undefined;
    api.mockImplementation((path: string) =>
      path.endsWith('/switch')
        ? new Promise<void>((resolve) => {
            finishSwitch = resolve;
          })
        : Promise.resolve(EMPTY_PAGE),
    );

    renderShell({ syncing: true });
    await act(async () => undefined);

    expect(calledPaths()).toEqual(['/orgs/org-b/switch']);
    expect(openEventStream).not.toHaveBeenCalled();

    await act(async () => {
      finishSwitch();
    });

    expect(calledPaths()).toEqual(['/orgs/org-b/switch', '/notifications?limit=20']);
    expect(openEventStream).toHaveBeenCalledTimes(1);
    expect(openEventStream.mock.calls[0][0]).toBe('/notifications/stream');
  });

  it('loads at once when the cookie already names the workspace', async () => {
    api.mockResolvedValue(EMPTY_PAGE);

    renderShell({ syncing: false });
    await act(async () => undefined);

    expect(calledPaths()).toEqual(['/notifications?limit=20']);
    expect(openEventStream).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when the switch is refused', async () => {
    api.mockImplementation((path: string) =>
      path.endsWith('/switch') ? Promise.reject(new Error('refused')) : Promise.resolve(EMPTY_PAGE),
    );

    renderShell({ syncing: true });
    await act(async () => undefined);

    // The cookie still names another workspace (or none): anything sent now
    // would be a 403 or someone else's feed.
    expect(calledPaths()).toEqual(['/orgs/org-b/switch']);
    expect(openEventStream).not.toHaveBeenCalled();
  });
});

describe('createWorkspaceScope', () => {
  it('is ready by default, switching while a switch is in flight, then ready or failed', () => {
    const scope = createWorkspaceScope();
    const listener = jest.fn();
    const unsubscribe = scope.subscribe(listener);

    expect(scope.status('org-a')).toBe('ready');

    scope.begin('org-a');
    expect(scope.status('org-a')).toBe('switching');
    // Only the workspace being switched to waits.
    expect(scope.status('org-b')).toBe('ready');

    scope.settle('org-a', true);
    expect(scope.status('org-a')).toBe('ready');

    scope.begin('org-b');
    scope.settle('org-b', false);
    expect(scope.status('org-b')).toBe('failed');
    expect(listener).toHaveBeenCalledTimes(4);

    unsubscribe();
    scope.begin('org-a');
    expect(listener).toHaveBeenCalledTimes(4);
  });
});
