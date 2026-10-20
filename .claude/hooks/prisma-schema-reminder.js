/**
 * PostToolUse hook: after packages/db/prisma/schema.prisma changes, reminds
 * Claude to migrate and regenerate the client itself. In development those
 * steps are Claude's job, never handed to the user.
 *
 * Prints nothing for any other file. Any failure to parse the input is
 * ignored: a broken hook must never interrupt work.
 */

const SCHEMA = 'packages/db/prisma/schema.prisma';

const REMINDER = [
  'schema.prisma just changed. Finish the database side yourself before using the new fields (development mode, do not ask the user):',
  '1. Write the migration under packages/db/prisma/migrations/<timestamp>_<name>/migration.sql if it does not exist yet.',
  '2. npm run migrate:deploy --workspace=packages/db (never prompts or resets, unlike migrate dev).',
  '3. npm run db:generate. On Windows an EPERM on query_engine-windows.dll.node only means the running servers hold the engine; confirm the new names are in node_modules/.prisma/client/index.js and index.d.ts, and delete the leftover .tmp file next to the DLL.',
  '4. Touch an API source file that imports the changed model so ts-node-dev respawns onto the new client, then check http://localhost:3001/health.',
  '5. Update prisma/seeds and prisma/SCHEMA_NOTES.md if the change affects them.',
].join('\n');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const filePath = String(payload.tool_input?.file_path ?? '').replace(/\\/g, '/');
  if (!filePath.endsWith(SCHEMA)) process.exit(0);

  process.stdout.write(
    JSON.stringify({
      systemMessage: 'Prisma schema changed: Claude will migrate and regenerate the client.',
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: REMINDER },
    }),
  );
  process.exit(0);
});
