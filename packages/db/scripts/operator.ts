/**
 * `npm run operator:grant -- --email <address>` and
 * `npm run operator:revoke -- --email <address>` (Sprint 12, Module 19
 * section 7): the only way to change `User.isSuperAdmin`. Writes one JSON
 * log line with the change and who ran it (the machine's user name, since
 * this runs on a shell, not in the app). In production the address must also
 * be in the API's `OPERATOR_EMAILS`; the script says so when it is not.
 */
import { userInfo } from 'node:os';
import { PrismaClient } from '@prisma/client';
import { emailArgument, type OperatorMode, setOperatorAccess } from '../src/operator-access';

const USAGE = 'Usage: npm run operator:grant -- --email <address> (or operator:revoke)';

async function main(): Promise<number> {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode !== 'grant' && mode !== 'revoke') {
    console.error(USAGE);
    return 1;
  }
  const email = emailArgument(rest);
  if (!email) {
    console.error(`An --email address is required. ${USAGE}`);
    return 1;
  }

  const prisma = new PrismaClient();
  try {
    const result = await setOperatorAccess(prisma, mode as OperatorMode, email);
    if (result.outcome === 'no_account') {
      console.error(`No account uses ${email}. The person signs up first.`);
      return 1;
    }
    console.log(
      JSON.stringify({
        event: mode === 'grant' ? 'operator.granted' : 'operator.revoked',
        email: result.email,
        changed: result.outcome === 'changed',
        ranBy: safeUserName(),
        at: new Date().toISOString(),
      }),
    );
    if (result.outcome === 'unchanged') {
      console.log(
        `${result.email} ${result.isSuperAdmin ? 'is already' : 'is not'} an operator. Nothing changed.`,
      );
    } else {
      console.log(
        `${result.email} ${result.isSuperAdmin ? 'is now' : 'is no longer'} an operator.`,
      );
    }
    const allowlist = (process.env.OPERATOR_EMAILS ?? '')
      .split(',')
      .map((one) => one.trim().toLowerCase());
    if (
      mode === 'grant' &&
      process.env.NODE_ENV === 'production' &&
      !allowlist.includes(result.email)
    ) {
      console.log(
        'In production this address must also be in OPERATOR_EMAILS before the screens open.',
      );
    }
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

function safeUserName(): string {
  try {
    return userInfo().username;
  } catch {
    return 'unknown';
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
