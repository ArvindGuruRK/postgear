import {
  avatarSeed,
  canChangeRole,
  canManageTeam,
  canRemove,
  displayName,
  EDITOR_EMAIL_REQUIRED,
  EDITOR_SEATS_FULL,
  editorSeatLine,
  editorSeatsFull,
  editorsOverCap,
  INVITE_ROLES,
  invitedAsSentence,
  inviteEmailProblem,
  refusalMessage,
  roleLabel,
  roleWithArticle,
} from './team-view-model';

describe('team view model', () => {
  it('calls USER a member', () => {
    expect(roleLabel('USER')).toBe('Member');
    expect(roleLabel('ADMIN')).toBe('Admin');
    expect(roleWithArticle('USER')).toBe('a member');
    expect(roleWithArticle('ADMIN')).toBe('an admin');
  });

  it('names a person by name, else by the start of their address', () => {
    expect(displayName({ name: 'Ada Lovelace', email: 'ada@example.com' })).toBe('Ada Lovelace');
    expect(displayName({ name: null, email: 'grace.hopper@example.com' })).toBe('grace.hopper');
    expect(displayName({ name: '  ', email: 'bob@example.com' })).toBe('bob');
  });

  it('seeds the avatar like the account menu does: name, else the whole address', () => {
    expect(avatarSeed({ name: 'Ada', email: 'ada@example.com' })).toBe('Ada');
    expect(avatarSeed({ name: null, email: 'ada@example.com' })).toBe('ada@example.com');
  });

  it('lets admins manage and members only read', () => {
    expect(canManageTeam('ADMIN')).toBe(true);
    expect(canManageTeam('SUPERADMIN')).toBe(true);
    expect(canManageTeam('USER')).toBe(false);

    expect(canChangeRole('ADMIN', { role: 'USER' })).toBe(true);
    expect(canChangeRole('USER', { role: 'USER' })).toBe(false);
    expect(canChangeRole('ADMIN', { role: 'SUPERADMIN' })).toBe(false);
  });

  it('never offers to remove yourself', () => {
    expect(canRemove('ADMIN', { role: 'USER' }, false)).toBe(true);
    expect(canRemove('ADMIN', { role: 'ADMIN' }, true)).toBe(false);
    expect(canRemove('USER', { role: 'USER' }, false)).toBe(false);
  });

  it('needs an address to send to, but not for a copied link', () => {
    expect(inviteEmailProblem('', true)).toMatch(/Enter the email/);
    expect(inviteEmailProblem('', false)).toBeNull();
    expect(inviteEmailProblem('ada@example.com', true)).toBeNull();
    expect(inviteEmailProblem('not-an-address', false)).toMatch(/valid email/);
  });

  // --- Editors (Sprint 13, Module 14) ----------------------------------------

  it('names the Editor role and offers it last among the invite roles', () => {
    expect(roleLabel('EDITOR')).toBe('Editor');
    expect(roleWithArticle('EDITOR')).toBe('an editor');
    expect(roleWithArticle('SUPERADMIN')).toBe('a super admin');
    expect(INVITE_ROLES.map((option) => option.label)).toEqual(['Member', 'Admin', 'Editor']);
  });

  it('gives an Editor no team management: the former fail-open check', () => {
    // `viewerRole !== 'USER'` answered yes for an Editor; the capability says no.
    expect(canManageTeam('EDITOR')).toBe(false);
    expect(canChangeRole('EDITOR', { role: 'USER' })).toBe(false);
    expect(canRemove('EDITOR', { role: 'USER' }, false)).toBe(false);
    expect(canChangeRole('ADMIN', { role: 'EDITOR' })).toBe(true);
  });

  it('needs an address for an Editor invite, even as a copied link', () => {
    expect(inviteEmailProblem('', false, 'EDITOR')).toBe(EDITOR_EMAIL_REQUIRED);
    expect(inviteEmailProblem('', false, 'USER')).toBeNull();
    expect(inviteEmailProblem('ada@example.com', false, 'EDITOR')).toBeNull();
  });

  it('says how many editor seats are used, singular for a plan of one', () => {
    expect(editorSeatLine({ used: 2, limit: 3 })).toBe('2 of 3 editor seats used');
    expect(editorSeatLine({ used: 0, limit: 1 })).toBe('0 of 1 editor seat used');
    expect(editorSeatLine({ used: 1, limit: 1 })).toBe('1 of 1 editor seat used');
    expect(editorSeatLine({ used: 0, limit: 0 })).toBe('0 of 0 editor seats used');
  });

  it('blocks an Editor invite only when no seat is left', () => {
    const full = { used: 3, limit: 3, remaining: 0 };
    expect(editorSeatsFull('EDITOR', full)).toBe(true);
    expect(editorSeatsFull('USER', full)).toBe(false);
    expect(editorSeatsFull('EDITOR', { used: 2, limit: 3, remaining: 1 })).toBe(false);
    // Seats not read yet: the API decides.
    expect(editorSeatsFull('EDITOR', null)).toBe(false);
  });

  it('says how far over the cap a downgraded workspace is, with real numbers', () => {
    expect(editorsOverCap({ used: 5, limit: 3 })).toBe(
      'You have 5 editors and your plan allows 3. Remove 2 to add more.',
    );
    expect(editorsOverCap({ used: 1, limit: 0 })).toBe(
      'You have 1 editor and your plan allows 0. Remove 1 to add more.',
    );
    expect(editorsOverCap({ used: 3, limit: 3 })).toBeNull();
    expect(editorsOverCap({ used: 0, limit: 3 })).toBeNull();
  });

  it('shows the seat refusal in its own words and anything else as written', () => {
    expect(refusalMessage({ code: 'members_editor_seats_full', message: 'x' })).toBe(
      EDITOR_SEATS_FULL,
    );
    expect(refusalMessage({ message: 'You cannot demote the last admin.' })).toBe(
      'You cannot demote the last admin.',
    );
  });

  it('tells an invited Editor the workspace and the role in one sentence', () => {
    expect(invitedAsSentence('Acme', 'EDITOR')).toBe(
      'You have been invited to join Acme as an editor.',
    );
    expect(invitedAsSentence('Acme', 'USER')).toBe("You've been invited as a member.");
  });
});
