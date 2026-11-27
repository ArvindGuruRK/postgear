/**
 * The Team page's Editor pieces (Sprint 13, Module 14): the over-the-cap
 * warning for admins, the Editor option in the role picker's list, and no
 * management for an Editor.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { api } from '@/lib/api';
import type { TeamMember } from '@/types/team';
import { TeamMembers } from './team-members';

beforeAll(() => stubBrowserLayout());

let mockRole = 'ADMIN';

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock('@/components/navigation/workspace-provider', () => ({
  useWorkspace: () => ({
    role: mockRole,
    organizations: [{ id: 'org-1', name: 'Acme', role: mockRole, createdAt: '' }],
  }),
}));
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: jest.fn(),
}));

const apiMock = api as jest.MockedFunction<typeof api>;

const MEMBERS: TeamMember[] = [
  {
    membershipId: 'm1',
    userId: 'u1',
    email: 'admin@example.com',
    name: 'Ada Admin',
    role: 'ADMIN',
    disabled: false,
    joinedAt: '2026-11-01T00:00:00.000Z',
    avatar: null,
  },
  {
    membershipId: 'm2',
    userId: 'u2',
    email: 'editor@example.com',
    name: 'Eddie Editor',
    role: 'EDITOR',
    disabled: false,
    joinedAt: '2026-11-02T00:00:00.000Z',
    avatar: null,
  },
];

function page() {
  return render(<TeamMembers orgId="org-1" initialMembers={MEMBERS} currentUserId="u1" />);
}

beforeEach(() => {
  mockRole = 'ADMIN';
  apiMock.mockReset();
});

describe('TeamMembers', () => {
  it('warns an admin when a downgrade left more editors than the plan allows', async () => {
    apiMock.mockResolvedValue({ editors: { used: 5, limit: 3, remaining: 0 } } as never);
    page();

    expect(await screen.findByTestId('team-editors-over-cap')).toHaveTextContent(
      'You have 5 editors and your plan allows 3. Remove 2 to add more.',
    );
  });

  it('says nothing when the editors fit the plan', async () => {
    apiMock.mockResolvedValue({ editors: { used: 1, limit: 3, remaining: 2 } } as never);
    page();

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/orgs/org-1/seats'));
    expect(screen.queryByTestId('team-editors-over-cap')).toBeNull();
  });

  it('names an Editor in the list', () => {
    // The seat read never answers here: only the list is looked at.
    apiMock.mockReturnValue(new Promise(() => {}));
    page();

    const editorRow = screen
      .getAllByTestId('team-member')
      .find((row) => row.getAttribute('data-role') === 'EDITOR');
    expect(editorRow).toHaveTextContent('Editor');
  });

  it('gives an Editor the list read only: no invite, no pickers, no seat read', () => {
    mockRole = 'EDITOR';
    page();

    expect(screen.queryByTestId('team-invite')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(apiMock).not.toHaveBeenCalled();
  });
});
