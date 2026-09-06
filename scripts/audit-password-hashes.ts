/**
 * Reports how every stored password is hashed.
 *
 * Run with:
 *
 *     npm run audit:passwords
 *
 * ## Why this exists
 *
 * `PasswordService` upgrades a legacy or under-cost hash to argon2id
 * transparently, on the user's next successful login. That is the right
 * migration strategy — no forced reset, no batch job holding plaintext it
 * cannot have — but it is *lazy*: an account nobody signs into keeps its old
 * hash indefinitely, and nothing surfaces that.
 *
 * This script is the visibility half. It answers "is anything still stored
 * weakly, and how long has it been sitting there" without touching a single
 * password value.
 *
 * ## What it deliberately does not do
 *
 * It does not rehash anything. Rehashing requires the plaintext, which exists
 * only for the instant a user submits it at login. A script that could
 * re-derive a stronger hash from a stored weak one would mean the weak one was
 * reversible — which is the problem, not the solution.
 *
 * For the one format that cannot be verified at all (bcrypt — this repo has no
 * bcrypt dependency, see `password.service.ts`), the report says so explicitly,
 * because those accounts must go through password reset rather than silently
 * failing to log in.
 */
import { prisma } from '@postgear/db';

type Format = 'argon2id' | 'argon2 (other variant)' | 'bcrypt' | 'sha1' | 'md5' | 'plaintext';

/**
 * Mirrors `PasswordService.detectFormat`, with argon2 split by variant so the
 * report can distinguish argon2id from a weaker argon2i/argon2d.
 */
function detectFormat(stored: string): Format {
  if (stored.startsWith('$argon2id$')) return 'argon2id';
  if (stored.startsWith('$argon2')) return 'argon2 (other variant)';
  if (/^\$2[aby]\$\d{2}\$/.test(stored)) return 'bcrypt';
  if (/^[a-f0-9]{40}$/i.test(stored)) return 'sha1';
  if (/^[a-f0-9]{32}$/i.test(stored)) return 'md5';
  return 'plaintext';
}

/** Pulls m/t/p out of an argon2 encoded hash so under-cost rows are visible. */
function argon2Params(stored: string): string | null {
  // Rebuilt from the capture groups rather than sliced out of match[0], which
  // carries the surrounding `$` delimiters and made every row compare unequal
  // to TARGET_PARAMS — reporting the whole table as under-cost.
  const match = /\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(stored);
  return match ? `m=${match[1]},t=${match[2]},p=${match[3]}` : null;
}

const TARGET_PARAMS = 'm=19456,t=2,p=1';

async function main(): Promise<void> {
  const users = await prisma.user.findMany({
    // Only the columns needed. Notably `password` — this script reads hashes,
    // so it must never print one, and it never does: only its *shape*.
    select: { id: true, email: true, password: true, providerName: true, lastOnline: true },
    orderBy: { createdAt: 'asc' },
  });

  const counts = new Map<string, number>();
  const needsAttention: string[] = [];
  let passwordless = 0;

  for (const user of users) {
    if (!user.password) {
      // Expected for OAuth-only accounts: they sign in through a provider and
      // have no password to store. Not a finding.
      passwordless += 1;
      counts.set(
        `none (${user.providerName})`,
        (counts.get(`none (${user.providerName})`) ?? 0) + 1,
      );
      continue;
    }

    const format = detectFormat(user.password);
    const params = format.startsWith('argon2') ? argon2Params(user.password) : null;
    const key = params ? `${format} (${params})` : format;
    counts.set(key, (counts.get(key) ?? 0) + 1);

    if (format === 'bcrypt') {
      needsAttention.push(
        `  ${user.email} — bcrypt. CANNOT be verified by this codebase; this account must reset its password.`,
      );
    } else if (format === 'plaintext' || format === 'md5' || format === 'sha1') {
      needsAttention.push(
        `  ${user.email} — ${format}. Upgrades to argon2id on next successful login (last seen ${user.lastOnline.toISOString().slice(0, 10)}).`,
      );
    } else if (params && params !== TARGET_PARAMS) {
      needsAttention.push(
        `  ${user.email} — argon2 below current cost (${params}). Upgrades on next successful login.`,
      );
    }
  }

  console.log('\nPassword hash audit');
  console.log('===================\n');
  console.log(`Users: ${users.length}  (${passwordless} with no password — OAuth-only)\n`);

  console.log('Format distribution');
  for (const [format, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(5)}  ${format}`);
  }

  if (needsAttention.length === 0) {
    console.log('\nNothing needs attention: every stored password is argon2id at current cost.');
  } else {
    console.log(`\nNeeds attention (${needsAttention.length})`);
    for (const line of needsAttention) {
      console.log(line);
    }
    console.log(
      '\nNothing is rehashed here, by design — that needs the plaintext, which only\n' +
        'exists at login. See the header comment in this file.',
    );
  }

  console.log('');
}

main()
  .catch((error) => {
    console.error('Audit failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
