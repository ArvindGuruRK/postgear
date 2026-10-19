import {
  avatarSeed,
  canChangeRole,
  canManageTeam,
  canRemove,
  displayName,
  inviteEmailProblem,
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
});
