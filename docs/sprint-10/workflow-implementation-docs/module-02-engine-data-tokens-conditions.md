# Module 02: Engine Data, Tokens, Conditions, Schedules And Templates

> **Sprint 10, Workflow Builder** | Status: Done (2026-10-29, see the README decision log for the calls made) | Size: L (one session)
> **Depends on**: [Module 01](module-01-engine-graph-and-catalog.md)
> **Stories**: WF-1.2, WF-3.2, WF-3.3, WF-5.1, WF-6.1, WF-7.3, WF-5.3 (redaction)
> **Next**: [Module 03](module-03-data-model-and-api.md)

## Goal

Finish `packages/automation` so it can answer every "what does this data mean" question the same way in the browser, the API and the worker:

- parse and resolve data tokens (the thing behind **Insert Data** chips), typed, single pass, no `eval`;
- know which data each node may use (upstream only) and flag broken chips;
- evaluate conditions with clear, tested semantics (no TriForms surprises);
- describe a schedule in plain words and list its next runs in a time zone;
- redact secrets and cap sizes for step input and output;
- write the plain-words activation sentence ("When a post is published, this workflow will ...");
- ship the starter templates as graph JSON that validate clean.

## Read First

1. [`README.md`](README.md), then Module 01's "Design" (this module plugs rules into its `validateGraph`).
2. Sprint doc: "Data Tokens", "Activation", "Starter Templates".
3. User stories: WF-3.2, WF-3.3, WF-7.3, and section 4 rules 2 and 4 (plain words, pick don't type).
4. [`00-ux-blueprint.md`](00-ux-blueprint.md) section 6 (data mapping) so the segment model fits the chip editor.

## Design

### Tokens (`src/tokens/*`)

**Syntax** (stored in config strings; users never type it, the chip editor writes it):

| Token | Meaning |
|---|---|
| `{{ trigger.post.url }}` | trigger output (every trigger's output root is `trigger`) |
| `{{ trigger.inputs.topic }}` | Manual trigger input field |
| `{{ nodes.k3f9a1b2c0.output.text }}` | a node's output by **stable key**, never by name |
| `{{ run.startedAt }}`, `{{ run.id }}`, `{{ run.mode }}` | run metadata |
| `{{ workspace.name }}` | workspace metadata (small fixed list) |

**Filters** (fixed list, chained with `|`): `truncate: 200`, `upper`, `lower`, `trim`, `date: "yyyy-MM-dd"`, `default: "n/a"`, `json`, `join: ", "`, `first`, `count`, `urlencode`. Unknown filter = validation error. No user functions, no expressions, no math. **Never `eval`, `new Function`, `vm`, or a JS sandbox.**

**API**:

```ts
parseTemplate(text): Segment[]               // { kind: 'text', value } | { kind: 'token', path, filters, raw }
serializeSegments(segments): string          // inverse; round-trips exactly
resolveTemplate(text, scope, opts): Resolved // scope = { trigger, nodes: { [key]: { output } }, run, workspace }
resolveValue(path, scope): unknown
```

**Rules that fix TriForms' bugs by design**:

1. **Single pass.** Resolved values are inserted as data and never parsed again. A post text containing `{{ nodes.x }}` stays literal text (TriForms' template injection bug).
2. **Typed.** A field whose whole value is one token keeps the value's type (number, list, object, image reference). A token mixed with text is stringified: lists joined with ", ", objects as compact JSON, dates as ISO unless a `date` filter is used.
3. **Missing data is explicit.** An unresolved path resolves to empty and is reported in `Resolved.missing[]`. The executor decides: optional field = carry on and note it in the step; required field = the step fails with "'{Field label}' was empty because {Step name} had no '{Field label}'."
4. **Escaping**: `\{{` writes literal braces. Max 50 tokens per field, max path depth 8.

### Data catalogue for Insert Data (`src/tokens/available.ts`)

```ts
availableData(graph, nodeKey, ctx): DataGroup[]
// [{ source: 'trigger' | nodeKey, title: 'Post Published', icon, fields: [{ path, label, type, sample }] }]
```

- Only upstream nodes (`upstreamOf` from Module 01), plus `run` and `workspace`.
- Field labels come from each definition's `outputShape`, in plain words ("Post Link", not `url`).
- Nested fields (a list of media, the post's channel) are a tree, n8n schema-view style, at most 3 levels shown.
- Disabled upstream nodes are listed but greyed with "This step is turned off."
- A node that is upstream only through a branch that may not run (for example the True side when this node is after a rejoin) is marked "May be empty", not hidden.

### Token validation rules (added to `validateGraph`)

| Code | Severity | Message |
|---|---|---|
| `token.unknown_node` | error | "This data is no longer available." (the step was deleted) |
| `token.not_upstream` | error | "This data comes from a step that runs later." |
| `token.unknown_field` | error | "{Step} has no '{field}'." |
| `token.bad_filter` | error | "This format option is not recognised." |
| `token.maybe_empty` | warning | "This data may be empty when the other branch runs." |

Each issue carries `nodeKey` and `field` so the UI can paint the exact chip red.

### Conditions (`src/conditions/*`)

Shared by If / Else, Filter, Paths cases and trigger filters.

```ts
ConditionGroup = { match: 'all' | 'any', rules: ConditionRule[] }   // 1..10 rules
ConditionRule  = { id, left: string /* template, usually one token */, operator, right?: string, matchCase?: boolean }
evaluateCondition(group, scope): { result: boolean, details: RuleResult[] }   // details feed the run inspector
```

The operator list depends on the **type of the left side** (from `outputShape`, or text when unknown):

| Type | Operators (UI words) | Semantics |
|---|---|---|
| Text | is, is not, contains, does not contain, starts with, ends with, is empty, is not empty | trims both sides; case-insensitive unless Match Case is on |
| Number | equals, does not equal, is greater than, is at least, is less than, is at most, is empty, is not empty | parsed with a strict number parser; **empty or non-numeric is never 0**: every comparison with it is false (TriForms' `"" < 5` bug) |
| Yes/No | is true, is false | |
| Date | is before, is after, is within the last {n} days, is empty | parsed as ISO; unparseable is false |
| List | contains, does not contain, is empty, is not empty, has more than {n} | contains compares items as text with the case rule above |

No regex operator in v1 (no ReDoS surface). `describeCondition(group)` returns the sentence the node summary shows: "Channel is Instagram and Text contains 'launch'".

Condition rules add validation codes: `condition.empty` ("Add at least one rule."), `condition.missing_value`, `condition.type_mismatch` (warning: "This compares a number with text.").

### Schedules (`src/schedule/*`)

The UI never says "cron". Config:

```ts
ScheduleConfig = {
  frequency: 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'monthly',
  everyHours?: 1..12,          // hourly only
  time?: 'HH:mm',              // not for hourly
  days?: Weekday[],            // weekly, 1..7 days
  dayOfMonth?: 1..31 | 'last', // monthly; 29 to 31 run on the last day in short months, and the panel says so
  timeZone: string,            // IANA, e.g. 'Asia/Kolkata'
}
```

- **Time zone**: PostGear has no workspace time zone column today (only `User.timezone` as an Int offset). Store an IANA zone on the Schedule node, defaulted from the browser (`Intl.DateTimeFormat().resolvedOptions().timeZone`) and editable. Record this in the decision log; a workspace-level zone can come later.
- `nextRuns(config, fromIso, count)`: pure, DST-correct. Use `@date-fns/tz` (pure, small) or hand-rolled `Intl` offsets; whichever you pick, test a DST change (Europe/London in March and October) and a half-hour zone (Asia/Kolkata).
- `describeSchedule(config)`: "Every Monday at 08:00 (Asia/Kolkata)", "Every 2 hours", "On the last day of every month at 18:00".
- `toTemporalScheduleSpec(config)`: returns a plain object shaped like Temporal's `ScheduleSpec` calendars plus `timezone` (no Temporal import; Module 09 passes it straight to the client).
- Rule `schedule.too_frequent_for_ai`: a Schedule faster than every 60 minutes in a graph containing an `ai.*` node is an error: "Workflows with AI steps can run at most once an hour."

### Redaction and size caps (`src/redact/*`)

`redact(value, { connectionValues })` returns a deep copy where:

- any key matching `/token|secret|password|passwd|authorization|api[-_]?key|cookie|signature|client[-_]?secret/i` becomes `"[hidden]"`;
- any string equal to, or containing, a known connection value (webhook URL, OAuth token) becomes `"[hidden]"`;
- URLs keep scheme and host only when they contain a query string with a key above;
- the result is capped at `LIMITS.stepIoCapBytes` (64 KB): large strings are cut with `"... (cut, 812 KB in total)"`, and `{ truncated: true }` is set on the step.

Used by the worker before writing any `AutomationRunStep`, and by the API before returning any run detail (defence in depth).

### Plain-words summaries (`src/describe/*`)

- `describeWorkflow(graph, ctx)`: the activation sentence. Built from the trigger's phrase ("When a post is published", "Every Monday at 08:00", "When you click Run Now") plus each side-effect node's phrase ("add a row to Social Report 2026", "send a Slack message", "publish to 2 channels"), joined naturally. Max 3 phrases, then "and 2 more steps".
- `riskSummary(graph)`: `{ external: NodeRef[], publishes: NodeRef[], publishesWithoutReview: boolean, aiCreditsPerRun: number }`. `publishesWithoutReview` is true when any `postgear.publish` node has a path from the trigger that does not pass a Manual Review. Drives the extra tick in the activation dialog.
- Each catalog `summary()` (Module 01) uses these helpers.

### Sample data (`src/samples/*`)

- Every trigger has a built-in sample payload (a realistic post on Instagram, a failed post with reason "Channel needs reconnecting", a schedule tick, a manual run with its inputs).
- `sampleScope(graph)`: a full scope built from samples, so Insert Data hover previews and Test Step work before any real run.

### Starter templates (`src/templates/*`)

Graph JSON plus metadata `{ id, title, description, apps: IconKey[], category, needs: string[] }`:

| Template | Graph | Priority |
|---|---|---|
| Publishing Report | Post Published, Set Fields (date, channel, link, preview), Google Sheets: Append Row, Slack | P0 |
| AI Weekly Post | Schedule (Monday 09:00), Generate Text, Generate Image, Manual Review, Create Draft, In-App Notification | P0 |
| Failed Post Alert | Post Failed, Filter (reason is not "Gave up after several tries", the `retries_exhausted` reason; PostGear has no separate rate-limited reason, see Module 09's reason table), Slack, In-App Notification | P0 |
| Repurpose For X | Post Published (LinkedIn), Rewrite In Brand Voice (X), Manual Review, Create Draft | P1, addition |
| Blog To Draft | Webhook, Generate Text, Create Draft, In-App Notification | P1, addition |
| Daily Approval Digest | Schedule (daily 17:00), Manual Review, Slack | P2, idea only |

Templates are positioned left to right on a 280 px column grid so they open tidy. `instantiateTemplate(template, makeKey)` re-keys every node (keys must be fresh per workflow) and rewrites token paths to the new keys.

## Tasks

- [x] `tokens/` (parse, serialize, resolve, filters, available data) and its validation rules.
- [x] `conditions/` with the operator table, `evaluateCondition`, `describeCondition`, rules.
- [x] `schedule/` with `nextRuns`, `describeSchedule`, `toTemporalScheduleSpec`, the AI frequency rule. Add the date dependency only if it is pure.
- [x] `redact/`.
- [x] `describe/` with `describeWorkflow`, `riskSummary`, and each catalog `summary()` filled in.
- [x] `samples/`.
- [x] `templates/` with `instantiateTemplate`.
- [x] Export everything from `src/index.ts`; keep the surface documented.

## Tests

- Tokens: round trip `serialize(parse(x)) === x` for 30 tricky strings (braces in text, escapes, unicode, emoji); typed single-token resolution; mixed text stringification; missing paths; **injection**: a resolved value containing `{{ ... }}` is not resolved again; every filter; unknown filter.
- Available data: upstream only; branch "may be empty"; disabled upstream greyed.
- Conditions: the full operator by type matrix, empty and non-numeric numbers, case toggle, all versus any, `describeCondition` sentences.
- Schedules: next runs across DST in Europe/London and America/New_York, Asia/Kolkata, monthly 31st in February, last day, weekdays, hourly; AI frequency rule.
- Redaction: nested keys, arrays, connection values inside longer strings, the 64 KB cap.
- `describeWorkflow` and `riskSummary`: the three P0 templates and a publish-without-review graph.
- Templates: each one, after filling its connections in a test `ctx`, has zero `error` issues; `instantiateTemplate` gives fresh keys and working tokens.

## Done When

- `npm run validate` passes. Coverage of tokens, conditions, schedule and redact aims for 95% lines.
- No use of `eval`, `Function(`, or `vm` anywhere in the package (add a test that greps the source, as a guard).

## Hand Check

Read the test names for conditions and schedules: each should read as a sentence a user would agree with. Nothing visual yet.

## Handoff

Update [`README.md`](README.md): progress row, the chosen date library and the time zone decision in the decision log, and the final filter list.
