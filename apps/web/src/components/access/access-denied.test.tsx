/**
 * The denied page and its server gate (Sprint 13, Module 14).
 */
import { canViewAnalytics, PAGE_DENIED_SENTENCE } from '@postgear/entitlements';
import { render, screen } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { getWorkspaceRole } from '@/lib/workspace-role';
import { AccessDenied } from './access-denied';
import { RoleGate } from './role-gate';

beforeAll(() => stubBrowserLayout());

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
jest.mock('@/lib/workspace-role', () => ({ getWorkspaceRole: jest.fn() }));

const roleMock = getWorkspaceRole as jest.MockedFunction<typeof getWorkspaceRole>;

describe('AccessDenied', () => {
  it('says the page is closed in a warning alert and sends an Editor back to Clips', () => {
    render(<AccessDenied orgId="org-1" workspaceRole="EDITOR" />);

    expect(screen.getByRole('alert')).toHaveTextContent(PAGE_DENIED_SENTENCE);
    expect(screen.getByRole('link', { name: 'Go To Clips' }).getAttribute('href')).toBe(
      '/org-1/clips',
    );
  });

  it('sends anyone else back to Home', () => {
    render(<AccessDenied orgId="org-1" workspaceRole="USER" />);

    expect(screen.getByRole('link', { name: 'Go To Home' }).getAttribute('href')).toBe(
      '/org-1/home',
    );
  });
});

describe('RoleGate', () => {
  async function gate(role: Awaited<ReturnType<typeof getWorkspaceRole>>) {
    roleMock.mockResolvedValue(role);
    const element = await RoleGate({
      orgId: 'org-1',
      allow: canViewAnalytics,
      children: <p>The analytics page</p>,
    });
    return render(<div>{element}</div>);
  }

  it('shows the denied page, not the page, to an Editor', async () => {
    await gate('EDITOR');

    expect(screen.getByText(PAGE_DENIED_SENTENCE)).toBeTruthy();
    expect(screen.queryByText('The analytics page')).toBeNull();
    expect(roleMock).toHaveBeenCalledWith('org-1');
  });

  it('fails closed when the role could not be read', async () => {
    await gate(null);

    expect(screen.getByText(PAGE_DENIED_SENTENCE)).toBeTruthy();
  });

  it.each(['ADMIN', 'USER'] as const)('lets %s through to the page', async (role) => {
    await gate(role);

    expect(screen.getByText('The analytics page')).toBeTruthy();
    expect(screen.queryByText(PAGE_DENIED_SENTENCE)).toBeNull();
  });
});
