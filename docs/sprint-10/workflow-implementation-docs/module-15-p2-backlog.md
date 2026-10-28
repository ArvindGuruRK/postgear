# Module 15: P2 Backlog (Only When You Decide)

> **Sprint 10, Workflow Builder** | Status: Parked | Size: pick items, one session per item group
> **Depends on**: [Module 14](module-14-hardening-e2e-closeout.md) closed
> **Stories**: WF-11.6 and the extras below

## How To Use This Module

Nothing here is built by default. The user picks items. The session then:

1. reads the picked items below and the code they touch;
2. writes a short plan with order, risks and size, and **waits for the user's go**;
3. builds one group at a time, each ending with `verify-change`, and updates the README.

Kickstart addition: `We are doing Module 15, items: <list>. Plan first and wait for my go.`

## Candidates

### A. Render Design (Studio) step

Fills a Studio preset's slots from upstream AI text and exports the slides into Media, so "AI writes a carousel every Monday" becomes one workflow, PostGear's own combination.

- Config: preset (picker with thumbnails from `packages/design-engine`), brand kit, a mapping of slots to chip inputs (headline, body, list items per slide), format.
- Execution: build the document with `documentFromPreset`, fill slots, run the Studio export path (`apps/api/src/modules/studio/design-exporter.ts`, Playwright browser pool) from the worker. Decide whether the worker renders (needs the browser pool in the worker) or calls an internal API export. Output: ordered media references that Create Draft accepts.
- Overflow: the design engine's "too long" warning fails the step in words ("The headline is too long for this template.").

### B. Describe Your Workflow (AI draft)

Zapier Copilot and Make Maia style, but **drafts only**: the user types "When a post fails, tell #alerts on Slack", the AI returns a graph JSON built from the catalog, the builder shows it as a draft with Finish Setup. Never activates. Uses `packages/ai-engine` with a structured output schema equal to the graph schema; the result is run through `validateGraph` and repaired once if invalid. Charges credits like other AI features.

### C. WhatsApp (WF-11.6)

WhatsApp Cloud API: needs Meta business verification and approved message templates. Steps: connection (phone number id, token), template picker (approved templates from the API), variable mapping to chips. Coming Soon until the user has a verified business.

### D. Excel: Append Row (WF-11.6)

Microsoft Graph OAuth (`Files.ReadWrite` scope, or `Files.ReadWrite.AppFolder` if workable), workbook and table picker, append to a table (`/workbook/tables/{id}/rows/add`). Mirrors the Google Sheets step.

### E. Plan quotas

Map Module 01's limits to plans through `apps/api/src/modules/billing/entitlements.service.ts`: active workflows per plan, runs per month, steps per workflow, history retention. Show a usage meter on the Workflows list (`usage-meter.tsx`) and the "active / limit" count; refuse activation over the limit with an upgrade link.

### F. Version compare

Side by side canvas diff between two versions (added steps green, removed red, changed amber with a field-level list), from the Versions drawer. n8n and Zapier Enterprise have it.

### G. Editing presence

Show who else has the workflow open (avatars in PageActions) through the existing notifications stream or a small Redis presence key; warn before two people edit. Today the revision check already prevents silent overwrites.

### H. List View for accessibility

The ordered-list representation of the graph from the blueprint's section 13, editable through the same step panel.

### I. Approvals in Slack

n8n's Send And Wait: a Manual Review that also posts Approve and Reject buttons to Slack. Needs a Slack app (not just an incoming webhook) with interactivity and a public callback; larger than it looks.

### J. Workflow error handler

A workspace-level setting: "When any workflow fails, run this workflow" (n8n's Error Workflow), with an Error trigger whose data is the failed run.

### K. Loops over lists

An iterator step ("For Each Item") with a defined item limit, for example one Slack message per post in a list. Needs a sub-graph model; do not start without a design session.

## Done When

Each built item has its tests, its own README progress line ("15-A Render Design: Done"), and its Decision Log entries.
