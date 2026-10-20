---
name: sprint-closeout
description: Close out a finished PostGear sprint or work batch by writing its completion checklist and test guide in the house format (docs/sprint-completion-checklists/), verifying every item of the sprint document against the code, and recording deviations, known gaps and what remains. Use for "close the sprint", "write the completion checklist", "sprint wrap-up", "what's left in sprint N".
---

# Sprint close-out

Output: `docs/sprint-completion-checklists/sprint-NN-completion-checklist.md` (two-digit number: `sprint-09-completion-checklist.md`), the companion of `docs/sprint-documents/sprint-NN-<slug>.md`. For work that is not a numbered sprint (a UI revamp batch, a fix-up pass), ask the user for the file name before inventing one.

Read two recent examples first to copy tone and density: `sprint-08-completion-checklist.md` (the fullest) and `sprint-05-completion-checklist.md`. Never write an em dash or a middle dot (the hook blocks them).

## 1. Gather the facts (before writing anything)

1. The sprint document: its Goal, Task Breakdown / Implementation Plan, every **Definition of Done** checkbox, and any existing "Deviations from this document" section. Sprint 8 also has a build contract (`sprint-08-contract.md`); check for one.
2. The branch and its base: `git branch --show-current`, `git log --oneline <base>..HEAD`, `git diff --stat <base>...HEAD`. Note whether it is merged or pushed (`git status -sb`).
3. What existed before the sprint (stubs, `.gitkeep` folders, `return null` pages) so the intro can say what the sprint started from: `git show <base>:<path>` on the key files.
4. Test evidence: run the unit tests for the touched workspaces (see the `verify-change` skill) and record the real pass counts. Run the matching e2e specs if the stack can run (see `run-postgear`); otherwise say they were not run.

## 2. Verify every item against the code

Walk the sprint document line by line. For each task and each DoD item, open the code that implements it and confirm it exists and does what the line says. Status is earned by evidence, never by the plan:

- `✅ [New]`: built in this sprint and verified (test, live probe or read-through).
- `✅ [Pre-existing]` (or `✅ [Pre-existing: Sprint N]`): already there from an earlier sprint; say which, do not re-test it.
- A caveat goes after the marker in the same cell, bold where it matters: `✅ [New]; real client **not run**`, `✅ [New]; **no real event sent**`.
- Not built or not working: no tick. Write plainly what is missing (for example `Not built`) and add it to Known gaps.
- Ran only against a simulation (`PUBLISH_SIMULATION`, `AI_SIMULATION`, `ANALYTICS_SIMULATION`, `BILLING_SIMULATION`): say "in simulation" explicitly. Never claim a real platform, Stripe, OpenAI or Sentry call that did not happen.

## 3. File structure

Follow this order; drop a section only when it would be empty.

```markdown
# Sprint N: Completion Checklist & Test Guide

Companion to [sprint-NN-<slug>.md](../sprint-documents/sprint-NN-<slug>.md).
Status as of **YYYY-MM-DD**. Branch `<branch>`, cut from `<base>`; not merged, not pushed.

<What the sprint started from: the stubs and empty folders, in one paragraph.>

The **[Pre-existing]** things worth not re-testing: <list with the sprint each came from>.

**<One bold sentence on the DoD outcome>**, then what has not run for real and why.

---

## Prerequisites
<bash block: docker compose up -d, npm install (name new deps), npm run db:generate,
npm run db:migrate (name the new migration folder), npm run db:seed (what it seeds now)>
<table | Variable | Default | Meaning | for every new or changed .env variable;
mark the local value in bold, e.g. **Set `true` locally**>

## 1. <Area>: `<main path>`

| # | Item | Status |
|---|---|---|
| 1.1 | `<file>`: what it does, with the key names and behaviour | ✅ [New] |

### 1.4: why <design choice>
<short prose: the reason behind a non-obvious decision, referenced as §1.4 elsewhere>

<a bash block with the exact test command, then "Expect **N passed**: ..." describing what the tests cover>

## 2. ... (one numbered section per area: engine/package, API, worker, screens, SDK)

---

## Definition of Done: evidence

| DoD item | Evidence |
|---|---|
| <the DoD text from the sprint doc> | <§ reference, spec name with pass count, live probe with real numbers and date; or **In simulation.** / **Partly.** / **Not met.** first> |

---

## Deviations from the sprint document, and why

| The document said | What shipped | Why |
|---|---|---|

## Review findings fixed before closing (YYYY-MM-DD)

| Finding | Fix |
|---|---|

## Known gaps
1. **<Gap in bold>.** Why, and what would close it.

## N. What remains for you
1. Concrete steps for the user: real-account runs, owner decisions (prices, copy), the manual walk-through with the testing-guide section numbers.

---

## Files changed in this pass
**Added: <area>**
- paths, brace-grouped: `src/modules/x/{a,b,c}.ts` (+ N specs)

**Modified**
- `apps/api`: files and what changed in a few words
```

Section numbers inside the item tables (1.1, 1.2, ...) are what `§1.4` references point to, so keep them stable. Use `§` references between sections and to the testing guide.

## 4. Update the sibling documents

- Tick the sprint document's DoD checkboxes that are met (`- [x]`) and append the evidence in one sentence (`**Verified live**: ...`, or `**Built ... but in simulation**`). Leave unmet ones unticked with the reason.
- If the sprint changed how to run or test anything, update `docs/local-testing-guide.md` (its section 0 table, the relevant section 5 subsection, and the section 9 cheat-sheet).
- Do not commit unless the user asks.

## 5. Report back

Tell the user, simply: the file path, how many DoD items are met (and which only in simulation), the top known gaps, and the short list of things they must do or test by hand.
