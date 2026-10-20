---
name: verify-change
description: Check a PostGear change cheaply and correctly before calling it done or committing. Runs lint, typecheck and tests only for the workspaces the change touches (plus their dependants), decides whether Playwright is worth running, and ends with what the user should check by hand. Use for "verify this", "check my change", "run the checks", "is it safe to commit", "did I break anything".
---

# Verify a change

Goal: the same gate CI runs (`npm run validate` = `turbo run lint typecheck test`, see `.github/workflows/ci.yml`), but only where the change can have an effect, and an honest report. Commands below work in both shells; on Windows prefer the PowerShell tool.

## 1. List what changed

```bash
git status --short                 # staged, unstaged and untracked (??) files
git diff --name-only HEAD          # tracked changes since the last commit
git diff --name-only master...HEAD # everything on this branch, when verifying a whole branch
```

Untracked files count: a new test or component must be checked too.

## 2. Map files to workspaces

| Path starts with | Workspace (turbo filter name) |
|---|---|
| `apps/api/` | `@postgear/api` |
| `apps/web/` | `@postgear/web` |
| `apps/worker/` | `@postgear/worker` |
| `packages/db/` | `@postgear/db` |
| `packages/social-core/` | `@postgear/social-core` |
| `packages/scheduling/` | `@postgear/scheduling` |
| `packages/ai-engine/` | `@postgear/ai-engine` |
| `packages/seo-engine/` | `@postgear/seo-engine` |
| `packages/ui/` | `@postgear/ui` |
| `packages/sdk/` | `@postgear/sdk` |
| `packages/config/` | `@postgear/config` (no scripts of its own) |

A changed shared package must also check everything that consumes it. Turbo's `...name` filter selects a package plus its dependants, read from each `package.json`:

- `...@postgear/db` -> db, api, worker
- `...@postgear/social-core` -> social-core, api, web, worker
- `...@postgear/ui` -> ui, web
- `...@postgear/ai-engine`, `...@postgear/seo-engine` -> the package, api, worker

Two gaps in the declared dependencies, so add these by hand:

- **`@postgear/scheduling`**: `apps/api` imports it (through a tsconfig path) but does not list it in `package.json`, so `...@postgear/scheduling` only gives scheduling and worker. Add `--filter=@postgear/api`.
- **`@postgear/config`** (the Jest preset, Tailwind config, tsconfig base) is used by every package, but only `apps/web` declares it. A change there means the full `npm run validate`.

Root files (`package.json`, `package-lock.json`, `turbo.json`, `tsconfig.json`, `biome.json`) also mean the full `npm run validate`. Docs-only changes (`docs/`, `*.md`) need no test run at all; just re-read them.

Shortcut that does the mapping for uncommitted work: `npx turbo run lint typecheck test --filter="...[HEAD]"` (use `...[master]` for the whole branch). Preview the selection first with `--dry=json` if unsure, and still add `@postgear/api` when scheduling changed.

## 3. Prisma first

If `packages/db/prisma/schema.prisma` or a migration changed: the migration must be applied and the client generated before typecheck means anything (packages/db re-exports `@prisma/client` types). Follow the steps the `prisma-schema-reminder` hook prints (`npm run migrate:deploy --workspace=packages/db`, `npm run db:generate`, the Windows EPERM handling), then `npx prisma validate --schema packages/db/prisma/schema.prisma` as CI does.

## 4. Run the checks

```bash
npx turbo run lint typecheck test --filter=@postgear/web --filter=...@postgear/ui --output-logs=errors-only
```

Run it in the background when it covers more than one or two packages (the four-package run takes about 45 s) and wait for the notification. To iterate on one failing file: `npm test --workspace=@postgear/web -- seo-view-model` (Jest pattern match; tests live in `src/**/*.{test,spec}.ts(x)`).

**Formatting**: CI does not gate `format:check` yet (an old backlog of unformatted Sprint 0 files). Do not run `npm run format` over the repo. Check only the files this change added: `npx biome check <new files>`, and fix with `npx biome format --write <new files>`. Leave formatting of untouched lines in old files alone, so the diff stays reviewable.

**Banned characters**: the `block-ai-punctuation` hook already refuses em dashes and middle dots in new writes. When a change pulled text in some other way (a script, a generator), confirm with Grep for `\x{2014}` and `\x{00B7}`.

## 5. Decide about Playwright

- **Skip it** for small UI tweaks (copy, spacing, a colour, one component): the user tests those by hand. Say it was skipped.
- **Run it** for a new or changed flow (sign-in, composer, scheduling, billing, onboarding) or a change many pages share (the shell, navigation, the API client). Run only the matching specs in `e2e/` (for example `e2e/composer.spec.ts`), with the API in e2e mode and a seeded database; the `run-postgear` skill section 7 has the steps. Update a spec when its asserted text changed on purpose (search `e2e/` for the old string first).
- Never call a paid API to verify anything. Keep `PUBLISH_SIMULATION`, `AI_SIMULATION`, `BILLING_SIMULATION` on; a real platform post only when the user asks.

## 6. Report honestly

- Say exactly what ran and what passed: "lint, typecheck and test for @postgear/web and @postgear/ui: 8 of 8 tasks passed".
- On a failure, quote the relevant output (file, line, message), say whether the change caused it, and fix it or ask. Never call a red run green, never skip a failing test to get a pass.
- Name what was not run (Playwright skipped, no real platform call, migration not applied) and why.
- A failure that predates the change (check with `git stash` or on the base commit) is reported as pre-existing, not silently ignored.

## 7. End with the manual check list

Finish every verification with a short, concrete list of what the user should look at in the browser, with the URL (`http://localhost:3000/seed-demo-org/<page>`), the exact text or behaviour that changed, and any edge to try (phone width, dark theme, an empty state). The user tests UI by hand, so this list is required even when every automated check passed.
