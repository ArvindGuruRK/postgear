import { changeRoleSchema, inviteMemberSchema } from './org.schema';

describe('the invite and role bodies (Module 14)', () => {
  it('takes an Editor invite only with an address, even for a copied link', () => {
    expect(inviteMemberSchema.safeParse({ role: 'EDITOR', sendEmail: false }).success).toBe(false);
    expect(
      inviteMemberSchema.safeParse({ role: 'EDITOR', sendEmail: false, email: '' }).success,
    ).toBe(false);
    expect(
      inviteMemberSchema.safeParse({ role: 'EDITOR', sendEmail: false, email: 'ed@example.com' })
        .success,
    ).toBe(true);
  });

  it('keeps the address optional for a copied member or admin link', () => {
    expect(inviteMemberSchema.safeParse({ role: 'USER', sendEmail: false }).success).toBe(true);
    expect(inviteMemberSchema.safeParse({ role: 'ADMIN', sendEmail: false }).success).toBe(true);
  });

  it('never invites or promotes to superadmin', () => {
    expect(
      inviteMemberSchema.safeParse({ role: 'SUPERADMIN', sendEmail: false, email: 'a@b.co' })
        .success,
    ).toBe(false);
    expect(changeRoleSchema.safeParse({ role: 'SUPERADMIN' }).success).toBe(false);
    expect(changeRoleSchema.safeParse({ role: 'EDITOR' }).success).toBe(true);
  });
});
