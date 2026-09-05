/**
 * Generates the local development secrets that `.env` needs.
 *
 * Usage (from the repo root):
 *   npm run generate:keys           # print the values, copy them yourself
 *   npm run generate:keys -- --write  # rewrite the keys in .env in place
 *
 * The values in `.env.example` are descriptive placeholders, not real keys —
 * `ENCRYPTION_KEY_AES256` in particular is prose, and packages/db/src/crypto.ts
 * rejects it outright rather than silently deriving a weak key from it.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ENV_PATH = join(__dirname, '..', '.env');

/**
 * `ENCRYPTION_KEY_AES256` must be exactly 32 bytes as 64 hex characters —
 * crypto.ts validates that shape, so anything else fails fast at first use.
 */
const GENERATORS: Record<string, () => string> = {
  ENCRYPTION_KEY_AES256: () => randomBytes(32).toString('hex'),
  // base64 rather than hex for the JWT/NextAuth secrets: they are opaque
  // strings with no length contract, and base64 packs more entropy per char.
  JWT_SECRET: () => randomBytes(48).toString('base64'),
  NEXTAUTH_SECRET: () => randomBytes(48).toString('base64'),
};

function generate(): Record<string, string> {
  return Object.fromEntries(Object.entries(GENERATORS).map(([name, make]) => [name, make()]));
}

/**
 * Replaces each key's line in .env, leaving every other line — comments,
 * ordering, unrelated vars — byte-for-byte untouched. A regex rewrite rather
 * than a parse-and-serialize round trip, precisely to avoid reformatting a
 * file the developer hand-maintains.
 */
function writeToEnv(keys: Record<string, string>): void {
  if (!existsSync(ENV_PATH)) {
    console.error(
      'No .env found at the repo root. Run `cp .env.example .env` first, then re-run with --write.',
    );
    process.exit(1);
  }

  let contents = readFileSync(ENV_PATH, 'utf8');
  const updated: string[] = [];
  const missing: string[] = [];

  for (const [name, value] of Object.entries(keys)) {
    const pattern = new RegExp(`^${name}=.*$`, 'm');
    if (pattern.test(contents)) {
      contents = contents.replace(pattern, `${name}="${value}"`);
      updated.push(name);
    } else {
      missing.push(name);
    }
  }

  writeFileSync(ENV_PATH, contents, 'utf8');

  console.log(`Updated ${updated.length} key(s) in .env: ${updated.join(', ')}`);

  if (missing.length > 0) {
    console.log(
      `\nNot present in .env, so not written — add these lines yourself:\n` +
        missing.map((name) => `${name}="${keys[name]}"`).join('\n'),
    );
  }

  console.log(
    '\nRestart any running dev server: process.env is read at startup.\n' +
      "These are local-only secrets. Production keys belong in your host's secret store, never in git.",
  );
}

function printToStdout(keys: Record<string, string>): void {
  console.log('# PostGear local development secrets — paste into .env\n');
  for (const [name, value] of Object.entries(keys)) {
    console.log(`${name}="${value}"`);
  }
  console.log(
    '\n# Re-run with `--write` to patch these into .env automatically.\n' +
      '# Rotating ENCRYPTION_KEY_AES256 makes every already-encrypted\n' +
      '# Integration.token unreadable — re-connect those channels afterward.',
  );
}

function main(): void {
  const keys = generate();

  if (process.argv.includes('--write')) {
    writeToEnv(keys);
  } else {
    printToStdout(keys);
  }
}

main();
