import { emailArgument, type OperatorAccessClient, setOperatorAccess } from './operator-access';

function client(rows: Array<{ id: string; email: string; isSuperAdmin: boolean }>) {
  const updateMany = jest.fn(
    async ({
      where,
      data,
    }: {
      where: { email: string; isSuperAdmin: boolean };
      data: { isSuperAdmin: boolean };
    }) => {
      const hit = rows.filter(
        (one) => one.email === where.email && one.isSuperAdmin === where.isSuperAdmin,
      );
      for (const row of hit) row.isSuperAdmin = data.isSuperAdmin;
      return { count: hit.length };
    },
  );
  const fake: OperatorAccessClient = {
    user: {
      findMany: async ({ where }) => rows.filter((one) => one.email === where.email),
      updateMany,
    },
  };
  return { fake, updateMany, rows };
}

describe('emailArgument', () => {
  it('reads --email spaced or with =, lower-cased', () => {
    expect(emailArgument(['grant', '--email', 'Demo@PostGear.local'])).toBe('demo@postgear.local');
    expect(emailArgument(['--email=ops@rkay.in'])).toBe('ops@rkay.in');
  });

  it('answers null for a missing or malformed address', () => {
    expect(emailArgument(['grant'])).toBeNull();
    expect(emailArgument(['--email'])).toBeNull();
    expect(emailArgument(['--email', 'not-an-email'])).toBeNull();
  });
});

describe('setOperatorAccess', () => {
  it('grants and revokes the flag', async () => {
    const { fake, rows } = client([
      { id: 'u1', email: 'member@postgear.local', isSuperAdmin: false },
    ]);
    expect(await setOperatorAccess(fake, 'grant', 'member@postgear.local')).toEqual({
      outcome: 'changed',
      email: 'member@postgear.local',
      isSuperAdmin: true,
      accounts: 1,
    });
    expect(rows[0]?.isSuperAdmin).toBe(true);
    expect((await setOperatorAccess(fake, 'revoke', 'member@postgear.local')).outcome).toBe(
      'changed',
    );
    expect(rows[0]?.isSuperAdmin).toBe(false);
  });

  it('writes nothing when the flag is already as asked', async () => {
    const { fake, rows } = client([{ id: 'u1', email: 'demo@postgear.local', isSuperAdmin: true }]);
    expect((await setOperatorAccess(fake, 'grant', 'demo@postgear.local')).outcome).toBe(
      'unchanged',
    );
    expect(rows[0]?.isSuperAdmin).toBe(true);
  });

  it('sets the flag on every account with the address (password and Google)', async () => {
    const { fake, rows } = client([
      { id: 'u1', email: 'ops@rkay.in', isSuperAdmin: false },
      { id: 'u2', email: 'ops@rkay.in', isSuperAdmin: false },
      { id: 'u3', email: 'other@rkay.in', isSuperAdmin: false },
    ]);
    expect(await setOperatorAccess(fake, 'grant', 'ops@rkay.in')).toMatchObject({ accounts: 2 });
    expect(rows.map((one) => one.isSuperAdmin)).toEqual([true, true, false]);
  });

  it('says when no account uses the address', async () => {
    const { fake } = client([]);
    expect(await setOperatorAccess(fake, 'grant', 'nobody@postgear.local')).toEqual({
      outcome: 'no_account',
      email: 'nobody@postgear.local',
    });
  });
});
