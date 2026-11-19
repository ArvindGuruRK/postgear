/**
 * Granting and revoking platform operator access (Sprint 12, Module 19
 * section 7). `User.isSuperAdmin` is the only flag; nothing in the app sets
 * it, only `npm run operator:grant` and `npm run operator:revoke` (in
 * `packages/db/scripts/operator.ts`), each writing one log line with who ran
 * it. In production the flag counts only for addresses in the API's
 * `OPERATOR_EMAILS` as well, so granting is not enough there on its own.
 *
 * Kept here (not in the script) so it is tested; not exported from the
 * package index, since no app may change the flag.
 */
export type OperatorMode = 'grant' | 'revoke';

export interface OperatorAccessClient {
  user: {
    findMany(args: {
      where: { email: string };
      select: { id: true; isSuperAdmin: true };
    }): Promise<Array<{ id: string; isSuperAdmin: boolean }>>;
    updateMany(args: {
      where: { email: string; isSuperAdmin: boolean };
      data: { isSuperAdmin: boolean };
    }): Promise<{ count: number }>;
  };
}

/**
 * An address can hold more than one account (a password one and a Google
 * one: `User` is unique on email and provider), and each signs in on its
 * own, so the flag is set on every account with the address.
 */
export type OperatorAccessResult =
  | { outcome: 'changed'; email: string; isSuperAdmin: boolean; accounts: number }
  | { outcome: 'unchanged'; email: string; isSuperAdmin: boolean; accounts: number }
  | { outcome: 'no_account'; email: string };

/** Reads `--email <address>` (or `--email=<address>`) from the script's arguments. */
export function emailArgument(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--email') return normalise(argv[i + 1]);
    if (arg.startsWith('--email=')) return normalise(arg.slice('--email='.length));
  }
  return null;
}

function normalise(value: string | undefined): string | null {
  const email = value?.trim().toLowerCase() ?? '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export async function setOperatorAccess(
  client: OperatorAccessClient,
  mode: OperatorMode,
  email: string,
): Promise<OperatorAccessResult> {
  const accounts = await client.user.findMany({
    where: { email },
    select: { id: true, isSuperAdmin: true },
  });
  if (accounts.length === 0) return { outcome: 'no_account', email };
  const wanted = mode === 'grant';
  const { count } = await client.user.updateMany({
    where: { email, isSuperAdmin: !wanted },
    data: { isSuperAdmin: wanted },
  });
  return {
    outcome: count > 0 ? 'changed' : 'unchanged',
    email,
    isSuperAdmin: wanted,
    accounts: accounts.length,
  };
}
