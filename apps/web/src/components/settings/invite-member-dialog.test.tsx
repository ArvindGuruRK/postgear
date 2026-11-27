/**
 * The invite dialog's Editor choice (Sprint 13, Module 14): the role tiles,
 * the line under Editor, the seat line and its full state, the address it
 * requires, and the API's seat refusal.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { stubBrowserLayout } from '@/components/workflows/fields/test-dom';
import { ApiError, api } from '@/lib/api';
import { InviteMemberDialog } from './invite-member-dialog';
import { EDITOR_EMAIL_REQUIRED, EDITOR_ROLE_LINE, EDITOR_SEATS_FULL } from './team-view-model';

beforeAll(() => stubBrowserLayout());

jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  api: jest.fn(),
}));

const apiMock = api as jest.MockedFunction<typeof api>;

function seats(used: number, limit: number) {
  return { editors: { used, limit, remaining: Math.max(0, limit - used) } };
}

/** Answers the seat read with `seatAnswer` and the invite with `invite`. */
function answer(seatAnswer: unknown, invite: () => Promise<unknown> = () => Promise.resolve({})) {
  apiMock.mockImplementation(((path: string) =>
    path.endsWith('/seats') ? Promise.resolve(seatAnswer) : invite()) as typeof api);
}

function open() {
  return render(
    <InviteMemberDialog open orgId="org-1" workspaceName="Acme" onOpenChange={jest.fn()} />,
  );
}

beforeEach(() => apiMock.mockReset());

describe('InviteMemberDialog', () => {
  it('offers Member, Admin and Editor as tiles, Member first', async () => {
    answer(seats(0, 1));
    open();
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/orgs/org-1/seats'));

    const tiles = screen.getByRole('group', { name: 'Role' });
    const names = Array.from(tiles.querySelectorAll('button')).map((tile) => tile.textContent);
    expect(names).toEqual(['Member', 'Admin', 'Editor']);
    expect(screen.getByRole('button', { name: 'Member' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.queryByText(EDITOR_ROLE_LINE)).toBeNull();
  });

  it('under Editor, says what an Editor may do and how many seats are used', async () => {
    answer(seats(2, 3));
    open();
    await waitFor(() => expect(apiMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Editor' }));

    expect(screen.getByText(EDITOR_ROLE_LINE)).toBeTruthy();
    expect(await screen.findByText('2 of 3 editor seats used')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Send Invitation' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('says "editor seat" for a plan of one', async () => {
    answer(seats(0, 1));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Editor' }));
    expect(await screen.findByText('0 of 1 editor seat used')).toBeTruthy();
  });

  it('blocks sending when no editor seat is left, and says why', async () => {
    answer(seats(1, 1));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Editor' }));

    expect(await screen.findByText(EDITOR_SEATS_FULL)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Send Invitation' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    // Back to Member: the seats do not apply.
    fireEvent.click(screen.getByRole('button', { name: 'Member' }));
    expect(screen.queryByText(EDITOR_SEATS_FULL)).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Send Invitation' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('requires the address for an Editor even when only copying the link', async () => {
    answer(seats(0, 3));
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Editor' }));
    await screen.findByText('0 of 3 editor seats used');
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy Link' }));

    expect(await screen.findByText(EDITOR_EMAIL_REQUIRED)).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalledWith('/orgs/org-1/invites', expect.anything());
  });

  it("shows the API's seat refusal when it refuses anyway", async () => {
    answer(seats(0, 1), () =>
      Promise.reject(new ApiError('No editor seats left.', 402, 'members_editor_seats_full')),
    );
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Editor' }));
    await screen.findByText('0 of 1 editor seat used');
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'ada@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send Invitation' }));

    expect(await screen.findByText(EDITOR_SEATS_FULL)).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith('/orgs/org-1/invites', {
      method: 'POST',
      body: { role: 'EDITOR', sendEmail: true, email: 'ada@example.com' },
    });
  });

  it('asks for the address with a placeholder, not a sample value', () => {
    apiMock.mockReturnValue(new Promise(() => {}));
    open();
    expect(screen.getByLabelText(/Email/).getAttribute('placeholder')).toBe(
      "Enter your teammate's email",
    );
  });
});
