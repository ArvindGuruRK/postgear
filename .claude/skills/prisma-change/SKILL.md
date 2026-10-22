---
name: prisma-change
description: Change the PostGear database schema end to end (Prisma model, migration SQL, migrate, generate, seeds, notes, mirrored types). Use when the user says "add a field", "add a column", "new table", "new model", "new enum value", "change the schema", "rename a column", "make this nullable", or any change to packages/db/prisma/schema.prisma.
---

# Prisma schema change

In development Claude does every step here itself, including migrate and generate. Never hand those steps to the user. The `.claude/hooks/prisma-schema-reminder.js` hook repeats the run steps after each `schema.prisma` edit.

## Hard rules

- **Never edit a migration folder that already exists.** They are applied to the dev database (and later staging and prod). A fix is always a new migration.
- **Never run `npm run db:reset` / `migrate:reset` or `prisma migrate reset` without asking.** It wipes every local row.
- **Do not use `prisma migrate dev` here.** It prompts interactively, and a hung prompt can leave a Postgres advisory lock (`P1002`); see `docs/sprint-documents/sprint-01-foundation-and-data-model.md` for the cleanup.
- **Resist renaming inherited fields** (`Integration` means channel, `token`/`refreshToken`). Add a comment in `schema.prisma` instead. `prisma/SCHEMA_NOTES.md` ("Changing this schema later") explains why.
- Keep code that reads the new fields out of loaded modules until steps 4 and 5 are done. The API respawns on every save, so a query using a field the client does not know yet breaks live requests.

## 1. Edit the schema

File: `packages/db/prisma/schema.prisma`.

- Prefer additive changes: a new nullable column, or `NOT NULL` with a `@default`, so existing rows stay valid.
- New enum values are additive too (see `20261020120000_onboarding_role_eight_options` and `20261020130000_onboarding_goal_drive_sales`).
- Removing an enum value Prisma's way recreates the type and casts the column (see `20260907170606_replace_github_with_facebook_provider`). That cast fails if any row still holds the removed value, so map those rows first with an `UPDATE`, and ask the user before dropping stored data.

## 2. Write the migration

Folder: `packages/db/prisma/migrations/<YYYYMMDDHHMMSS>_<snake_case_name>/migration.sql`.

- The timestamp must sort after the newest existing folder. Recent ones use a readable time such as `20261020130000`.
- The name says what changed, e.g. `ui_revamp_channel_order`, `sprint8_billing_notifications_api`.
- Get the SQL from Prisma rather than hand-writing the DDL. From `packages/db`, this compares the live dev database with the edited schema without touching either:

  ```bash
  npx dotenv -e ../../.env -- prisma migrate diff \
    --from-schema-datasource prisma/schema.prisma \
    --to-schema-datamodel prisma/schema.prisma \
    --script
  ```

  It is only correct when the dev database is already up to date with every existing migration, so run `npm run migrate:deploy --workspace=packages/db` first if unsure.
- Then shape the file the way the existing ones look:
  - A short `--` header saying why the change exists and whether it is additive (read `20261019180000_ui_revamp_channel_order/migration.sql`).
  - Prisma's own section comments (`-- AlterTable`, `-- CreateEnum`) kept as generated.
  - A `-- Backfill` section with an `UPDATE` when existing rows need a value, as in the channel order migration.
- Never use the em dash or the middle dot in comments (a project hook blocks them).

## 3. Apply it

```bash
npm run migrate:deploy --workspace=packages/db
```

`migrate deploy` never prompts and never resets. If it fails, fix the SQL in the new folder (it has not been recorded as applied) and run it again.

## 4. Regenerate the client

```bash
npm run db:generate
```

On Windows, while `npm run dev` is running, this can fail with `EPERM` renaming `query_engine-windows.dll.node`, because the running servers hold the engine open. That is expected and harmless for a schema edit:

1. Confirm the new model, field or enum names appear in `node_modules/.prisma/client/index.js` and `node_modules/.prisma/client/index.d.ts`. The JS client is written before the error.
2. Delete the leftover `.tmp*` file next to the DLL in `node_modules/.prisma/client/`.

## 5. Make the running API pick it up

`apps/api` runs under `ts-node-dev --respawn`, which ignores `node_modules`, so a new client alone does not restart it.

1. Touch (save) an API source file that imports the changed model, so it respawns onto the new client.
2. Check `http://localhost:3001/health` answers.

Only now wire code to the new fields.

## 6. Update everything that mirrors the model

- **Type re-exports:** a new model or enum must be added to `packages/db/src/types.ts`. The rest of the monorepo imports from `@postgear/db`, never from `@prisma/client`.
- **API selects:** repositories select explicit columns (e.g. `summarySelect()` in `apps/api/src/modules/channels/channels.repository.ts`). A new field is invisible until it is added to the select, and a credential column must never be added.
- **Request bodies:** each module validates with a strict Zod schema (e.g. `apps/api/src/modules/posts/dto/posts.schema.ts`). Add new writable fields there, or they are rejected.
- **Web types:** `apps/web/src/types/*.ts` hand-mirror what the API returns, because `@prisma/client` must never reach a browser bundle. Update the matching file (`channel.ts`, `post.ts`, `workspace.ts`, ...).
- **Worker:** if `apps/worker/src/activities` reads the model, check its selects too.
- **e2e helpers:** `e2e/helpers/users.ts` and `e2e/helpers/media.ts` talk to Postgres directly; check them when touching `User`, `Organization` or `Media`.

## 7. Seeds and notes

- **Seeds:** `packages/db/prisma/seeds/index.ts` (plus `analytics.seed.ts`, `seo.seed.ts`). They are idempotent: fixed ids such as `seed-demo-org` and `upsert`. Give new required fields a value there, then run `npm run db:seed`.
- **`packages/db/prisma/SCHEMA_NOTES.md`:** update the model status tables, and add a short note for anything non-obvious (it has per-sprint sections such as "Sprint 8 additions").
- **Read-only role:** a new column or table that holds a secret (a token, hash, key or password) must still be added to the hidden list in `infra/postgres/readonly-role.sql`. The Postgres MCP server is currently removed, so running `npm run db:readonly-role` after a migration only matters if it is added back.

## 8. Verify

```bash
npm run typecheck
npm test --workspace=@postgear/db
npm test --workspace=@postgear/api -- <the changed module>
npx dotenv -e .env -- prisma validate --schema packages/db/prisma/schema.prisma
```

CI runs `db:generate` and `prisma validate` before `npm run validate`, so both must pass.
