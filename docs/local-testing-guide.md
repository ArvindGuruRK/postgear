# Local testing guide (free, no paid API keys)

How to run PostGear on your machine and see what has been built so far, using
only free things. Start at section 1 and stop whenever you have seen enough.
Sections 1 to 5 need no social account or API key at all.

For registering each platform's developer app in full detail, see
[social-platform-setup.md](social-platform-setup.md). This guide is the
shortest path to seeing things work.

---

## 0. What you can test today

PostGear is partway through its build, so some screens are real and some are
placeholders.

| Works in the browser | Not available yet |
|---|---|
| Login with the seeded demo account | |
| Composer: editor, per-platform previews, character counters, threads, media attach | Recurring posts, RSS auto-posting, bulk scheduling |
| Media library: upload, preview, delete | In-app notifications (rows are written; the bell is Sprint 8) |
| Save a draft, "Add to queue", reopen drafts | |
| **Calendar** (Sprint 5): month/week/day, drag a post to reschedule, click a slot to compose | |
| **Queue** (Sprint 5): every post in order, filters, Post now / Reschedule / Retry / Delete | |
| **Scheduled publishing** (Sprint 5): a queued post goes out at its time, retries on rate limits, flags a dead token | |
| **AI Copilot** (Sprint 6): generate a post from a topic (research → hook → copy → image), chat with an assistant that can list channels and draft posts, AI credits | |
| **Analytics** (Sprint 7): per-channel followers, impressions, engagement over 7/30/90 days, cross-channel comparison, top posts, per-post breakdown, CSV export | PDF export, scheduled SEO re-audits, competitor comparison |
| **SEO Analyzer** (Sprint 7): enter any public URL, get a 0–100 score with a grade, four sub-scores, prioritised fixes, and a score trend over time | |
| **Billing** (Sprint 8): plans, a 14-day trial, subscribe / upgrade / downgrade / cancel, in simulation or against Stripe test mode | Coupons, lifetime deals |
| **Notifications** (Sprint 8): the bell with live updates, "Mark all as read", email on a failed post (printed to the API console locally), email preferences | Weekly digest |
| **API keys and the public API** (Sprint 8): create / rotate / revoke keys, `/v1` with Swagger docs at `/api/docs`, per-key rate limiting, the Node SDK | OAuth apps, Zapier/Make connectors |
| **Outbound webhooks** (Sprint 8): signed deliveries on post published / failed, retries, a test send, delivery history | |
| **Design Studio** (Sprints 9 and 9b): brand kits by hand or read from a website, 167 templates in four formats (Classic, Signature and a premium Luxury set, with background art), 52 fonts, an editor with autosave and undo, preview in platform frames, export to Media at 1x or 2x, PDF download, Send To Composer as a draft, share links | AI-written slides, LinkedIn PDF carousels, approvals on share links |
| **Discover** (Sprint 11): what is trending where the audience is (rising searches, local news in the local language, Wikipedia reads, worldwide social topics, videos, festivals), competitors by website, a reader for any story, and Create Post on every item. Runs fully offline with `DISCOVER_SIMULATION="true"` (section 5o) | A country and region picker when the place finder is off, saved items, a Home card |
| Connect a real social account (OAuth) | |
| Channel card, reconnect, "wrong account" guard, disconnect | |

Since Sprint 5 the queue actually publishes: through the **worker** process
(section 3). Locally, with `PUBLISH_SIMULATION="true"` in `.env`, it publishes
to a stand-in so the seeded fake channels work end to end; set it to `"false"`
once you have connected a real account (section 6) and want real posts. The
API's test-post endpoint (section 7) still exists for a one-off manual post.

Since Sprint 6 the AI Copilot works the same way: with `AI_SIMULATION="true"`
in `.env` the model, the web research and the image generator are replaced by
deterministic stand-ins, so every screen, the credit metering and the
tool-calling assistant can be exercised with no API key and at no cost
(section 5c). Set it to `"false"` and fill in `OPENAI_API_KEY` (and optionally
`TAVILY_API_KEY`) for real generations.

### What costs money and what does not

- **X** charges for API use (pay-per-use credits, no free tier for new
  developers). Parked until later, see the appendix.
- **LinkedIn, YouTube, Facebook, Instagram, TikTok and Pinterest** have free APIs.
  The hurdles are app review and, for some, localhost redirects being refused.
- **Free-to-test, ranked:**

  | Platform | Free? | Works on localhost? | Verdict |
  |---|---|---|---|
  | LinkedIn (personal) | Yes | Yes (should) | **Do this one first** |
  | YouTube | Yes | Yes | Second. Connects fine, but a real post needs a video. |
  | Facebook | Yes | Needs a free tunnel | Optional, more setup |
  | Instagram | Yes | Needs a tunnel, plus media | Skip for now |
  | Pinterest | Yes | Usually needs a tunnel, plus media | Skip for now |
  | TikTok | Yes | Needs a tunnel and a verified domain; posts are forced private | Skip |

---

## 1. Start the local services (Docker)

PostGear needs three containers: Postgres (database), Redis, and MinIO (file
storage). They are defined in `docker-compose.yml`.

1. Open **Docker Desktop** and wait until it says *Engine running*.
2. From the project folder:

   ```powershell
   docker compose up -d
   docker ps
   ```

   You should see `postgear_postgres`, `postgear_redis` and `postgear_minio`
   with status `Up`.

> The database is already migrated and seeded. If you ever wipe the volumes, run
> `npm run db:migrate` and then `npm run db:seed`.

---

## 2. Check your `.env`

The `.env` file in the project root drives everything. Make sure these are set
(they are the defaults):

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgear_db?schema=public"
API_URL="http://localhost:3001"
WEB_URL="http://localhost:3000"
NEXT_PUBLIC_API_URL="http://localhost:3001"
STORAGE_PROVIDER="local"
```

**Security keys must be real values, not placeholders.** `.env.example` ships
with descriptive text such as `32-byte-hex-string-for-...`. The API refuses to
start if `ENCRYPTION_KEY_AES256` is not exactly 64 hex characters. If the API
complains about that or about `JWT_SECRET` in the next step:

```powershell
npm run generate:keys -- --write
```

This rewrites those secrets in `.env`. Only run it if the API complained,
because a new encryption key makes any tokens already in the local database
unreadable. (Harmless here: you would just reconnect the channel.)

> The API reads `.env` only when it starts. **Every time you edit `.env`, stop
> the API with Ctrl+C and start it again.**

---

## 3. Start the app

**One command does it all:**

```powershell
npm run dev
```

That brings up the Docker services (`docker compose up -d` runs first, so
Docker Desktop must be open), then starts the API (:3001), the worker and the
website (:3000) together through Turborepo, with each one's log prefixed by
its name. Ctrl+C stops all three; the containers keep running until
`docker compose down`.

If you prefer one process per terminal (for example to restart only the
worker), the three pieces are:

**Terminal 1: API (port 3001)**

```powershell
npm run dev:api
```

Wait for it to say it is listening. Any `.env` problem appears here, with the
variable named.

**Terminal 2: worker (the publisher, Sprint 5)**

```powershell
npm run dev:worker
```

It waits for Temporal (from `docker compose up -d`; the Temporal UI is at
<http://localhost:8233>), bundles its workflows, then says it is polling
`postgear-publishing`. With `PUBLISH_SIMULATION="true"` it warns that posts go
to a stand-in. Without a worker running, nothing publishes: the Calendar and
Queue pages show "No worker running" in their status pill so you can tell.

**Terminal 3: website (port 3000)**

```powershell
npm run dev --workspace=@postgear/web
```

### 3a. Running the e2e suite

The Playwright suite signs in about a dozen times a minute, which is over the
API's normal login limit (10 per minute per address). Run it against the
API's e2e mode instead:

1. In the API's terminal, stop `npm run dev:api` with Ctrl+C. If you started
   everything with `npm run dev`, stop that and run the worker and website on
   their own (Terminals 2 and 3 above).
2. In the same terminal, start the API in e2e mode:

   ```powershell
   npm run dev:api:e2e
   ```

   Same API, reloading on save like `dev:api`, with `LOGIN_RATE_LIMIT_PER_MIN=500`,
   `LOCKOUT_THRESHOLD=50` and `RATE_LIMIT_PER_MIN=3000` set on top of `.env`.
3. From another terminal (the database must be seeded):

   ```powershell
   npm run test:e2e
   ```

4. Afterwards, stop it and start `npm run dev:api` again, so manual testing
   runs with the real limits.

**What a 429 means.** A sign-in that fails with "Too many requests" (HTTP 429)
is the login throttle doing its job, not a broken test: the API was started
with `dev:api`. The suite checks this before the first test and prints a
warning box saying so. Switch to `dev:api:e2e`; the higher limit applies at
once, no waiting needed.

---

## 4. Log in

Open **<http://localhost:3000>** and use the seeded account:

| | |
|---|---|
| Email | `demo@postgear.local` |
| Password | `DemoPassword123!` |

The workspace is `seed-demo-org`. You will see three **fake** channels on the
Channels page (*Acme Marketing*, *Acme on X*, *Acme Studio*). They are seed data
with fake tokens, not real connections.

Other seeded accounts, if you want to test roles: `member@postgear.local` and
`onboarding@postgear.local` (same password).

---

## 5. Test with no social account at all

This covers most of Sprint 4 and costs nothing.

### The composer
Open **<http://localhost:3000/seed-demo-org/composer>**.

1. Pick a channel in the channel picker.
2. Type text and watch the **live preview** and the **character counter**.
   Limits differ by platform. For example X counts every link as 23 characters
   and each emoji as 2, while LinkedIn allows 3,000 and YouTube descriptions 5,000.
3. Go over a platform's limit and see how the editor flags it.
4. Add a second part to make a **thread** and watch the preview change.
5. Attach media. Each platform has its own limits (X: up to 4 images, or 1 GIF,
   or 1 video; LinkedIn: up to 20 images and no video yet).
6. **Save draft**, reload the page, then reopen it from the drafts list. It
   should still be there.
7. **Add to queue** with a time a couple of minutes away. Then open the
   **Queue** page and watch: "Scheduled" becomes "Publishing" at the time, then
   "Published" with a link (to the stand-in's URL when simulating).

### The scheduler (Sprint 5)
Open **<http://localhost:3000/seed-demo-org/calendar>** and
**<http://localhost:3000/seed-demo-org/queue>**. The seed gives you a queued
thread for tomorrow, a published post, a failed one and a draft.

- **Drag** the queued card to another day or hour. The toast confirms and the
  API's time changes; the Temporal UI shows the workflow woken.
- Click a card → **Post now**. Within seconds the LinkedIn channel is
  Published; the X channel fails with "Channel needs reconnecting", because the
  seeded X account is deliberately broken. That is the dead-token branch.
- Write a post whose text contains `[simulate:429x2]` and Post now. The queue
  shows "Retrying, attempt 1 of 5", then attempt 2 after 30 seconds, then
  Published a minute later. `[simulate:400]` fails at once as "Rejected by the
  platform"; `[simulate:429]` (no `x`) gives up after five attempts.
  `[simulate:401]` runs the dead-token branch and leaves that seeded channel
  flagged "Reconnect" until you re-seed, so try it on a post to Acme on X,
  which is seeded broken anyway.
- Stop the worker (Ctrl+C in its terminal) while a post is minutes away, start
  it again after the time has passed: the post publishes once, immediately.
- Hover an empty slot and click **+** to open the composer at that time.

### 5c. The AI Copilot (Sprint 6)

Add this to `.env` and restart the API (`.env` is read only at start):

```env
AI_SIMULATION="true"
```

`.env.example` used to ship `OPENAI_API_KEY="sk-proj-openai-api-key"` and a
similar Tavily placeholder. The API now recognises those exact placeholder
strings and treats them as *unset* (it logs a warning naming the variable), so
you do not have to delete them, but without `AI_SIMULATION="true"` the AI page
will say it is not configured.

Open **<http://localhost:3000/seed-demo-org/ai-copilot>**.

**Generate a post.** Type a topic ("three things we learned launching our
newsletter"), pick a voice (*Personal* writes as "I", *Company* writes as "we"),
a format, optionally the hero image, and at least one channel. The button says
what it costs ("Generate (5 credits)", 15 with an image). Watch the stage
tracker: research → classify → hook → content → image. The result shows the
category, the hook, the parts with their character counts against the strictest
selected platform, the sources it was "backed by" (canned ones in simulation),
and the image. **Open in composer** saves it as a draft for those channels and
opens the composer on it; the image is attached to part 1.

- Pick *Acme on X* and a long format: every part stays under X's 280
  characters, because the pipeline is told the strictest limit.
- Switch the voice and regenerate: the same topic reads as "I…" or "we…".
- Press **Stop** mid-way: the run is cancelled and nothing more is charged.

**Chat with the copilot.** Switch to the *Copilot* tab and ask *"What channels
do I have connected?"*: the assistant calls its `list_channels` tool (you see
the tool activity row) and answers with the three seeded channels. Then try
*"Write a LinkedIn post about our spring sale and save it as a draft"* and
*"Generate an image of a sunrise over a city skyline"*. A drafted post appears
with an **Open in composer** link; a generated image appears in the media
library. Each message costs 1 credit; the tools that generate cost 5 and 10.

**Credits.** The meter at the top shows the cycle's usage (the seed starts the
demo workspace at 23 of 100, the STANDARD tier's monthly allowance) and the
reset date. Use them up, or temporarily lower the allowance in
`apps/api/src/modules/ai/credits/credits.policy.ts`, and the Generate button
disables with an explanation; the API answers **402**. Credits are charged
before a generation and refunded when it fails before producing anything.

Without `AI_SIMULATION`, with a real `OPENAI_API_KEY`: everything above is the
same, except the copy is written by `gpt-4.1-mini` (set `AI_MODEL` to change
it), images by DALL-E 3, and research runs only when `TAVILY_API_KEY` is set,
otherwise the research stage reads "skipped" and the post is written from the
model's own knowledge. A rejected key shows up in the UI as a configuration
problem, not as a user error, and nothing is charged for it.

### 5d. Analytics (Sprint 7)

Nothing to add to `.env`: with `PUBLISH_SIMULATION="true"` the worker also
reads metrics from a stand-in (`ANALYTICS_SIMULATION` follows it unless you
set it yourself), and the seed gives the demo workspace 90 days of numbers.

Open **<http://localhost:3000/seed-demo-org/analytics>**.

- The four cards at the top (Followers, Impressions, Engagements, Engagement
  rate) show the last 30 days with the change against the 30 days before.
  Switch the range to **7** or **90**: the URL follows (`?range=7`), so a
  view can be bookmarked.
- **Trend** draws one line per channel; hover a day, or focus the chart and
  use the arrow keys, to read the values.
- **Channels** compares every channel side by side. *Acme Marketing* and
  *Acme Studio* are synced; *Acme on X* says **Needs reconnect**, because
  the seeded X token is dead and a dead token cannot read metrics either.
  Click a row to filter the whole page to that channel.
- **Top posts** ranks published posts by engagement. Open one to see its
  likes, comments, shares, clicks and impressions next to the channel's
  average, with an up/down arrow for above/below. **Create similar** opens
  the AI Copilot with the post as the topic.
- **Sync now** asks the worker to pull fresh metrics for every channel; the
  status pill on the right says whether a worker is there to do it. With the
  worker running (and `PUBLISH_SIMULATION="true"`), the stand-in returns a
  slightly different series each day, so re-syncing moves the numbers.
  Without one, the pill says so and the seeded numbers stay.
- **Export CSV** downloads the daily metrics and the top posts for the range.

The worker also syncs on its own: once a day per channel, at a minute offset
that depends on the channel, so a fleet never hits a platform at the same
second. Real platform metrics need a connected account on a platform with
a metrics API (X, LinkedIn pages, Facebook pages, Instagram, YouTube) and
`PUBLISH_SIMULATION="false"` (or `ANALYTICS_SIMULATION="false"`); a personal
LinkedIn profile has no metrics API, and the page says **Not supported** for
it rather than showing zeros.

### 5e. The SEO Analyzer (Sprint 7)

Nothing to add to `.env`. The crawler is free: it fetches the page itself,
with a headless Chromium when one is installed (`npx playwright install
chromium`; the e2e suite already installed it) and a plain HTML fetch
otherwise. AI advice uses the same `AI_SIMULATION`/`OPENAI_API_KEY` setting
as the copilot and costs 3 credits per audit; without either, the advice is
the rule-based findings and the page says so.

Open **<http://localhost:3000/seed-demo-org/seo-analyzer>**.

- Type `https://example.com/` and press **Analyze**. Watch the stages:
  validate → crawl → score → advise. Within thirty seconds you get a score
  out of 100 with a letter grade, four sub-scores (on-page 30 %, technical
  30 %, content 25 %, authority 15 %), the crawl facts, and the fixes grouped
  **Critical / Warning / Info**. The **Breakdown** tabs list every check.
- Try `http://localhost:3000` or `http://169.254.169.254/`: the analyzer
  refuses before fetching anything; private and internal addresses are
  blocked on purpose (that is the SSRF guard the sprint required), and the
  refusal is logged by the API as `seo.unsafe_url`.
- Analyze the same URL again: the result says how the score moved since
  the last run, and **History** on the right draws the score over time
  (the seed already has three runs of `example.com` and one failed audit
  of `nonexistent.invalid` so the trend is visible before you run anything).
- Click a history row to reopen that audit; **Re-run** fills the form.
- **Authority** is estimated from on-page signals unless
  `OPEN_PAGERANK_API_KEY` is set (a free key from Open PageRank turns it into
  a real backlink-index reading); the tab says which.
- Only one analysis per workspace runs at a time and the API process runs
  at most `SEO_MAX_CONCURRENT_AUDITS` (default 2); a third request answers
  **429 busy** rather than queueing forever.

### 5f. Billing (Sprint 8)

Two lines in `.env`, then restart the API (`.env` is read only at start):

```env
BILLING_SIMULATION="true"
WEBHOOK_ALLOW_PRIVATE_URLS="true"
```

The first replaces Stripe with a stand-in: checkout, plan changes and
cancellation synthesise the Stripe events and run them through the **same
webhook handler** a real Stripe delivery hits, so the plan limits, the
"activating" state and the idempotency table are all real. The old
`.env.example` placeholders (`sk_test_stripe_secret_key`, …) are recognised
and ignored, so you do not have to delete them. The second line is for §5i.

Open **<http://localhost:3000/seed-demo-org/settings/billing>** (Settings in
the sidebar, then **Billing**). The demo workspace is seeded on the
**Standard** plan. Prices on this page are placeholders in
`apps/api/src/modules/billing/plans.ts`: change them there.

- The current-plan card shows the status badge, the next billing date and
  two meters: channels used of the plan's limit, AI credits used this cycle.
- **Change plan → Pro.** A preview says what would be charged today (in
  simulation, the difference pro-rated to the day); confirm, watch
  *Activating…* for a second or two, then the card says **Pro**. The channel
  meter's limit moves from 5 to 15.
- **Change plan → Standard** again: a downgrade is *scheduled* for the end
  of the period and the card says so; the plan stays Pro until then.
- **Cancel.** Pick a reason, type a note; the card shows "ends on <date>" and
  a **Resume** button, and the API console prints the feedback email (it is
  addressed to `SMTP_FROM`). Resume clears it.
- **The channel limit.** On the Channels page the header says "3 of 5
  channels". Connect channels until the limit (or lower a plan's `channels`
  in `plans.ts` and restart): the Connect button disables with a link to
  billing, and the connect route redirects back with the same message.
- **The trial.** Create a new workspace (the organization switcher →
  *Create organization*): it starts on a **14-day Pro trial** with no card,
  the billing page shows the days left, and the AI credits meter shows
  Pro's 500. `BILLING_TRIAL_DAYS` in `.env` changes the length (0 disables).
- **Idempotency.** Every applied event is a row in `BillingEvent`:

  ```powershell
  docker exec postgear_postgres psql -U postgres -d postgear_db -c 'SELECT id, type, outcome FROM "BillingEvent" ORDER BY "createdAt" DESC LIMIT 5;'
  ```

**With real Stripe test-mode keys** (free, no card charged: test mode is a
sandbox). Create a Stripe account, switch the dashboard to **Test mode**,
then:

1. Developers → API keys → copy the **Secret key** (`sk_test_…`) and the
   **Publishable key** (`pk_test_…`).
2. Install the Stripe CLI (`winget install stripe.stripe-cli` or
   <https://stripe.com/docs/stripe-cli>), `stripe login`, then in its own
   terminal:

   ```powershell
   stripe listen --forward-to localhost:3001/billing/webhook
   ```

   It prints a signing secret (`whsec_…`). That is the webhook secret for as
   long as `stripe listen` runs.
3. In `.env`:

   ```env
   BILLING_SIMULATION="false"
   STRIPE_SECRET_KEY="sk_test_…"
   STRIPE_WEBHOOK_SECRET="whsec_…"
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_…"
   ```

   Restart the API. `GET http://localhost:3001/billing/status` now says
   `"mode": "stripe"`.
4. On the billing page choose a plan: you land on Stripe Checkout. Pay with
   the test card `4242 4242 4242 4242`, any future expiry, any CVC. Stripe
   redirects back to the billing page with `?checkout=success`; the page
   shows *Activating…* until `stripe listen` has forwarded
   `checkout.session.completed` and the API has applied it, then the plan
   changes. Nothing was charged: test mode never moves money.
5. **Manage billing** opens the Stripe billing portal (test mode). Plan
   switching inside the portal needs dashboard-defined prices: pin them
   with the `STRIPE_PRICE_*` variables if you want that; the in-app Change
   plan works without them.
6. Replay an event to prove idempotency: `stripe events list --limit 1`,
   then `stripe events resend <evt_id>`; the API answers
   `{ "received": true, "duplicate": true }` and nothing changes.

### 5g. Notifications (Sprint 8)

Nothing to add to `.env`. With `SMTP_HOST` empty, every email is printed to
the API console: that is the local mode, and it is how you see them.

- The bell is in the top bar. It opens live over a server-sent event
  stream; the badge is the unread count for this workspace only.
- Make a post fail: open the composer, write a post whose text contains
  `[simulate:400]`, add it to the queue for *Acme Marketing* a minute away
  (or queue it and **Post now** from the Queue page). Within seconds, no
  reload, the bell shows **Post failed**, and the API console prints the
  email that would have gone to every member who has failure emails on
  (`demo@postgear.local` and `member@postgear.local`), with the channel,
  the reason and a link to the queue.
- A post that publishes writes **Post published** the same way; the email
  goes only to members with success emails on.
- **Mark all as read** zeroes the badge; it is per person and per
  workspace, so switching to *PostGear Second Org* has its own count.
- Settings → **Notifications**: the two email preferences. Turn failure
  emails off and fail another post: the bell still gets it, the console
  prints no email for that user.
- The dispatcher runs every 3 seconds in the API; its log lines say which
  rows it claimed and sent.

### 5h. API keys and the public API (Sprint 8)

Settings → **API keys**. Only admins can manage keys.

- **Create key**, name it: the secret (`pg_…`) is shown once with a Copy
  button and a curl example. Close the dialog and it is gone for good; the
  list shows only the prefix.
- The seed also installs a known key for the demo workspace so the public
  API can be tried without the UI:
  `pg_seedDemoKey00000000000000000000000000000` (prefix `pg_seedDemo`; it
  is re-created, un-revoked, by every `npm run db:seed`). A local-only
  convenience, never seed one on a real deployment.
- Call the API:

  ```powershell
  $key = "pg_seedDemoKey00000000000000000000000000000"
  Invoke-RestMethod http://localhost:3001/v1/me -Headers @{ Authorization = "Bearer $key" }
  Invoke-RestMethod http://localhost:3001/v1/channels -Headers @{ Authorization = "Bearer $key" }
  Invoke-RestMethod http://localhost:3001/v1/posts -Method Post -Headers @{ Authorization = "Bearer $key" } `
    -ContentType "application/json" `
    -Body '{"text":"Hello from the public API","channelIds":["seed-channel-linkedin"],"state":"draft"}'
  ```

  The last one answers `201` with the post; it appears in the composer's
  drafts. Send `"state":"queue"` with a `publishAt` a minute ahead and the
  worker publishes it (to the stand-in, with `PUBLISH_SIMULATION`), and the
  bell and any webhook (§5i) report it. In `text`, a newline is a line break
  and a blank line an empty paragraph, so what you send is what is posted.
  `GET /v1/posts?state=draft` filters (lowercase `draft|queue|published|error`,
  twenty per page, `?page=2`). Unlike the app's own routes, a bad `/v1` body
  names the field that failed: the caller is a program reading a terminal.
- **Swagger**: <http://localhost:3001/api/docs> documents every `/v1` route;
  <http://localhost:3001/api/docs-json> is the OpenAPI file. Paste a key
  into **Authorize** to call routes from the page.
- **Rate limit**: the per-key ceiling is `API_RATE_LIMIT_PER_MIN` (60).
  Loop 70 requests and the tail answers `429` with a `Retry-After` header:

  ```powershell
  1..70 | ForEach-Object { try { Invoke-RestMethod http://localhost:3001/v1/me -Headers @{ Authorization = "Bearer $key" } | Out-Null; "ok" } catch { $_.Exception.Response.StatusCode.value__ } } | Group-Object | Select-Object Name, Count
  ```

- **Rotate** keeps the name and revokes the old key the moment the new one
  exists; **Revoke** makes the key answer `401` at once. Both are confirmed
  in a dialog because live integrations break.
- The SDK: `packages/sdk` (`README.md` has a receiver example). In a script
  inside this repository:

  ```ts
  import { PostGear } from '@postgear/sdk';
  const postgear = new PostGear({ apiKey: 'pg_…' });
  console.log(await postgear.me());
  ```

### 5i. Outbound webhooks (Sprint 8)

Needs the worker running (deliveries are Temporal workflows) and
`WEBHOOK_ALLOW_PRIVATE_URLS="true"` in `.env`, because a receiver on this
machine is exactly what the SSRF guard refuses otherwise. Without the
flag, only public `https://` addresses are accepted, and the guard
resolves the host and refuses private, link-local and loopback answers.

Start a receiver in a fourth terminal (anything that prints requests):

```powershell
npx -y http-echo-server 4000
```

Settings → **Webhooks** → **Add webhook**: name it, URL
`http://localhost:4000/postgear`, keep both events, leave channels empty
(every channel). The **signing secret** (`whsec_…`) is shown once.

- Kebab → **Send test**: the deliveries sheet opens; within a few seconds
  the row says **Delivered (200)**, and the echo server shows a `POST` with
  `X-PostGear-Event: webhook.test`, `X-PostGear-Delivery`,
  `X-PostGear-Timestamp` and `X-PostGear-Signature: v1=…`; the HMAC-SHA256
  of `"<timestamp>.<body>"` under the secret. `packages/sdk` verifies it
  (`verifyWebhookSignature`), and the Playwright test
  `e2e/webhooks.spec.ts` does exactly this against a receiver it hosts.
- Now publish a post (Queue → **Post now** on the seeded queued post, or
  `[simulate:400]` for a failure): the receiver gets `post.published` /
  `post.failed` with the post, the channel and (for a failure) the reason.
- Stop the receiver and send a test: the row says **Pending**, "attempt 1
  failed: Connection refused; retrying", then retries at 30 s, 2 min,
  8 min, 32 min, 2 h. Start the receiver again inside that window and the
  next attempt delivers. After the sixth failure the row is **Failed** and
  the bell gets a **Webhook delivery failed** notification (emailed to
  admins).
- **Rotate secret** shows a new one; the old stops verifying at once.
  **Pause** keeps the hook but delivers nothing; **Delete** removes it.

### 5j. Sentry (Sprint 8)

Without a DSN nothing is sent anywhere: the local default. To see errors
arrive, a free Sentry account is enough (the developer plan has an error
quota that these tests will not dent):

1. <https://sentry.io> → create a project per app, platform **NestJS** for
   the API and **Next.js** for the web app (or one project for both).
2. Copy each project's DSN into `.env`:

   ```env
   SENTRY_DSN="https://…@o…ingest.sentry.io/…"
   NEXT_PUBLIC_SENTRY_DSN="https://…@o…ingest.sentry.io/…"
   ```

   Restart the API and the web app (`NEXT_PUBLIC_*` is inlined at start).
3. API: signed in as the demo admin (a superadmin), open
   <http://localhost:3001/health/sentry-test>. It answers `500` by design
   and the event appears in the API project within a minute.
   <http://localhost:3001/health> says `"sentry": true` when a DSN is set.
4. Web: <http://localhost:3000/dev/sentry-test> has two buttons (one
   throws in the browser, one inside a server function) and says whether
   a DSN is configured.

Traces are off (`SENTRY_TRACES_SAMPLE_RATE=0`); set `0.1` to sample
performance data once there is a quota to spend. The `/dev/*` routes are
excluded from production builds.

### 5k. The Design Studio (Sprint 9)

Nothing to add to `.env`, and nothing here costs money. Templates are code,
not paid assets. Export draws each slide in the same headless Chromium the SEO
analyzer uses (`npx playwright install chromium` once; without it Export says
"Export is not available right now. Please try again later." and the API
console prints that command). Brand extraction only reads a public website.

Open **<http://localhost:3000/seed-demo-org/studio>** (**Studio** on the rail,
after Media). The seed adds a brand kit, **Lotus Flow Yoga**, and two
designs: **5 Morning Stretches** (a five-slide portrait carousel) and
**Saturday Classes Are Back** (a single landscape post).

- **Create Design** walks Brand, Format and Template, one question per
  screen. The step lives in the URL, so a refresh keeps your place.
  - **Brand**: pick Lotus Flow Yoga, make a **New Brand Kit** (name, website,
    a logo up to 5 MB, five colours with a picker and a hex field each), or
    **Skip** to keep the template's own colours. **Extract From Website**
    with a real site fills a review screen, and nothing is saved until
    **Save Brand Kit**. A local or private address (`localhost:3000`,
    `http://[::1]/`, `http://169.254.169.254/`) is refused with "That address
    is not public." (the SSRF guard, logged as `studio.unsafe_url`). Five
    extractions a minute per workspace.
  - **Format**: Square, Portrait, Story and Landscape, drawn at their real
    shapes, each with the platforms it suits.
  - **Template**: 47 templates. Search, filter by category, format and
    style, and star favourites (shared by the whole workspace; with none
    starred, **Favourites** says "No favourites yet"). The thumbnails wear
    the chosen kit's colours (**Show original colours** turns that off).
    **Start From Blank** is the plain layout.
- **The editor** (`/seed-demo-org/studio/<id>`): slides on the left, the
  canvas in the middle, the properties on the right (Element, Slide,
  Design).
  - Click a text on the canvas to type, or use the panel. Drag an element:
    it stops at the edge of its area. Or nudge it with the arrow keys (Shift
    for 5 %).
  - Long text shrinks, then gets a warning ring. A colour that makes text
    hard to read shows a contrast warning with **Fix Contrast**.
  - Add Slide (by layout), Duplicate, Move Up, Move Down, and Delete with
    Undo in the toast (Undo brings the slide back and puts focus on its
    thumbnail), up to 20 slides.
  - Ctrl+Z and Shift+Ctrl+Z (Cmd on a Mac) undo and redo; **Reset** puts a
    slide or the whole design back to its template.
  - The save state reads Saving, then Saved once the API has confirmed.
  - In a narrow window the slides and the properties open as drawers.
- **Two tabs**: open the same design twice and edit in both. The second save
  says "This design changed in another tab." with **Reload** and **Keep This
  Version**.
- **Leave guard**: type, then at once click a rail link. It saves first; if
  the save has not landed within 10 seconds it asks "Leave without saving?"
  (**Stay** or **Leave Anyway**, and Leave Anyway never asks a second time).
  The top bar waits the same way: switching workspace, signing out, Profile,
  Settings, a search result and a notification. A design deleted in another
  tab never asks.
- **Preview** (the eye): Instagram, Facebook, LinkedIn and X frames (only
  the ones that take the format), swipeable slides, no counts, a Preview
  badge. On a phone the arrows sit below the slide, at each end of the dots.
  The caption written here goes to the composer.
- **Export**: JPEG (the default, what Instagram takes) or PNG, with progress
  per slide. The images land in **Media** as `{title} 01.jpg`, `{title}
  02.jpg` and so on. A text still too long is named before you start.
  **Download All** zips them (by keyboard, focus stays on it while it
  works); to save one, open it in **Media** and press **Download**.
- **Send To Composer**: choose channels. It exports first if the design
  changed, creates a draft for the next full hour, and opens the composer
  over the editor with the images in order and the caption. With
  `PUBLISH_SIMULATION="true"` the seeded channels publish to the stand-in as
  usual.
- **Share**: make a link (1 to 30 days, 7 by default). It is shown once, so
  copy it. Open it in a private window: no sign-in, the slides in the
  platform frames, not indexed. Revoke it: the link answers 404 with "This
  link is no longer available."
- **Templates playground**: <http://localhost:3000/dev/studio> draws every
  template in every format (860 slides) and lists any slot whose sample text
  does not fit. Its light and dark theme selects (Lilac included) change only
  that page.

Automated checks:

```powershell
npm test --workspace=@postgear/design-engine     # the engine
npm test --workspace=@postgear/api -- studio      # the API module
# Real Chromium (opt-in): exact sizes, pixels, and every template fitting with the real fonts
$env:SEO_BROWSER_TESTS = "true"; npm test --workspace=@postgear/api -- design-exporter.browser presets.browser; Remove-Item Env:SEO_BROWSER_TESTS
npm run test:e2e -- e2e/studio.spec.ts            # create, edit, export, send, share (API in dev:api:e2e, section 3a)
```

### 5l. The Studio Premium Pack (Sprint 9b)

Nothing to add to `.env`. After pulling, hard-refresh the Studio once
(Ctrl+Shift+R): three font files changed but kept their names (Sora,
JetBrains Mono, Playfair Display), and the API lets a browser keep them for a
week.

- **Templates**: 167 in three collections. **Classic** (59: Sprint 9's 47
  and 12 with a pattern), **Signature** (50 free, the CarouselClick looks,
  and 16 premium ones on the hand-made backgrounds) and **Luxury** (42,
  premium). The gallery adds **Collection**, **Look** (the background art)
  and **Colour** beside Search, Category, Style and Favourites, 24 a page,
  back to page 1 on any change.
- **Premium locks**: the demo workspace is on Standard, so nothing is locked
  there. Switch to **PostGear Second Org** (the top bar's workspace menu; it
  has no plan): Luxury and hand-made cards show a lock, and choosing one
  opens **Premium Templates** with **See Plans**. In a design there, the
  Design tab's luxury themes and art lock the same way. Switch back and they
  open.
- **Design tab**: **Theme** by collection, **Background Art** (None,
  Patterns, Originals, Luxury, drawn in the design's colours), **Fonts**
  (Heading and Body, with **Font Licences**), **Custom Colours** (with Use
  Kit Colours or Use Theme Colours), **Format**, and **Make A Story
  Version**, which opens a 9:16 copy.
- **Element tab**: **Font**, with "Design Font" first.
- **Slide tab**: a photo's **Tint** (Dark or Light) and **Apply To All
  Slides**.
- **Canvas**: **Zoom Out**, **Zoom In** and **Fit** (also +, - and 0 while
  not typing). Escape cancels typing (Undo brings the words back); Ctrl or
  Cmd plus Enter keeps it. A **Changed** marker sits on an element that
  differs from its template, and the rail reads "1. Cover".
- **Brand kits**: **Fonts**, **CTA text** and **Link** (written into a new
  design's closing slide), **Lock Brand Look**, **From One Colour**, and
  **Duplicate** on a kit card. With Lock Brand Look, the editor hides
  custom colours, fonts and the logo's Choose From Media; applying the kit
  takes the design's own fonts out, and a design that still has some
  offers **Use Kit Fonts**.
- **Export**: **Size** 1x or 2x; **Download PDF** (one page per slide, from
  the last export); **Download All** adds `captions.txt` when there is a
  caption.
- **Search**: the top bar has a **Designs** group.
- **Templates playground**: <http://localhost:3000/dev/studio> now pages at
  6, 12 or 24 with the gallery's filters, and keeps the page and size in the
  URL.

Automated checks:

```powershell
npm test --workspace=@postgear/design-engine
npm test --workspace=@postgear/api -- studio search
npm test --workspace=@postgear/web -- studio search playground
# Real Chromium (opt-in): every template in every format, overflow and pixel contrast
$env:SEO_BROWSER_TESTS = "true"; $env:PRESET_AT_ONCE = "6"; npm test --workspace=@postgear/api -- presets.browser; Remove-Item Env:SEO_BROWSER_TESTS, Env:PRESET_AT_ONCE
# A few templates, or one check: PRESET_IDS takes ids or prefixes ending in *, PRESET_CHECKS takes overflow, contrast or both
$env:SEO_BROWSER_TESTS = "true"; $env:PRESET_IDS = "luxury-*"; $env:PRESET_CHECKS = "contrast"; npm test --workspace=@postgear/api -- presets.browser; Remove-Item Env:SEO_BROWSER_TESTS, Env:PRESET_IDS, Env:PRESET_CHECKS
```

The whole library took 31 minutes with `PRESET_AT_ONCE=6` on 2026-10-28
(overflow 12.5, contrast 18); two named templates take under a minute. The
default of 2 pages at once leaves room for the app running beside it.

### 5m. Workflows: Google Sheets, HTTP Request and Webhook (Sprint 10, Module 13)

All three can be tried with no Google project and no outside service. Set
`AUTOMATION_SIMULATION="true"` in the root `.env` (refused when
`NODE_ENV=production`) and restart the API and the worker.

**A simulated Google account (no Google project needed).** With simulation
on, the Connections page (**Workflows > Connections**) can add a simulated
Google account. It is labelled "Simulated", reads as a spreadsheet called
"Social Report" with a tab "Posts" (Date, Channel, Text, Link), and a
spreadsheet "created" from the step keeps its name and headers until the
API restarts. In a run, the Sheets step writes nothing: it answers with the
next row number (2, 3, 4 and so on per account) and `simulated: true`. The
Google Picker needs a real account, so it is refused for a simulated one.

**A real Google account (testing mode, free).**

1. In Google Cloud Console, create a project (or reuse the sign-in one) and
   enable the **Google Sheets API**, **Google Drive API** and **Google
   Picker API**.
2. **OAuth consent screen**: user type External, publishing status
   **Testing**. Add the scopes `.../auth/drive.file`, `openid` and `email`
   (no sensitive scope, so no Google review is needed). Under **Test users**
   add every Google address you will connect with: in testing mode **only
   listed test users can connect**; anyone else sees "Access blocked".
3. **Credentials > OAuth client ID** (Web application). Add the redirect URI
   `http://localhost:3001/automation-connections/oauth/google/callback`
   (that is `${API_URL}/automation-connections/oauth/google/callback`; add
   the staging and production API hosts the same way later).
4. **Credentials > API key**, restricted to the Picker API, and note the
   project **number** (Project settings), which the Picker calls the app id.
5. In the root `.env`:

   ```env
   GOOGLE_AUTOMATION_CLIENT_ID="...apps.googleusercontent.com"
   GOOGLE_AUTOMATION_CLIENT_SECRET="..."
   GOOGLE_PICKER_API_KEY="..."
   GOOGLE_CLOUD_APP_ID="123456789012"
   ```

   Left empty, the sign-in app's `GOOGLE_CLIENT_ID` and `_SECRET` are used
   instead (then add the redirect URI above to that client). The
   placeholders `google-client-id` and `google-client-secret` count as not
   set: the Sheets step then says "Ask a workspace admin to set up Google."
   until a simulated or real account is connected.
6. Restart the API and the worker (both read these), then connect as an
   admin.

Things to know in testing mode:

- **Refresh tokens expire after 7 days** for an app in Testing. After that
  the next run fails with "Google Sheets is disconnected. Reconnect it in
  Connections." and the connection shows **Needs Reconnect**: reconnect it
  (admin only). Publishing the app (In Production) removes the 7-day limit.
- PostGear asks for `drive.file` only, so it sees just the spreadsheets you
  pick with the Picker or that PostGear created. Any other spreadsheet is
  invisible until you pick it in the step.
- Consent always asks again (`prompt=consent`) so Google returns a refresh
  token; a grant without one is refused and lands back with a failed
  connect.

**HTTP Request.** To call a server on your own machine set
`WEBHOOK_ALLOW_PRIVATE_URLS="true"` (local only; otherwise the address must
be https and public). Put an `Authorization` or `X-Api-Key` header in a
**Secret Headers** connection: typed into the step itself, validation
refuses it with "Put this header in a connection so it stays secret." A
test run that does not send for real shows "Would send POST to ... with 3
fields." and the body with secrets hidden. POST and PATCH carry
`Idempotency-Key: <runId>:<step>`.

**Webhook trigger.** Add a workflow that starts with **Webhook**, then make
its secret (admins only; it is shown once) from the trigger, or with
`POST /automations/<id>/webhook/secret`. Call the private link from
PowerShell:

```powershell
$id = "<workflow id from the URL>"; $secret = "<the secret>"
Invoke-RestMethod -Method Post -Uri "http://localhost:3001/v1/automations/$id/hook" `
  -Headers @{ "X-PostGear-Secret" = $secret; "Idempotency-Key" = "test-1" } `
  -ContentType "application/json" -Body '{"title":"Hello","password":"x"}'
```

- While the workflow is off this answers 409 "This workflow is not turned
  on." but still keeps the data (`GET /automations/<id>/webhook` shows it,
  with `password` as `[hidden]`), and test runs now start from it.
- Turned on, it answers 202 `{ runId }`; the same `Idempotency-Key` again
  answers 200 with the same run id and starts nothing.
- A missing or wrong secret is a bare 401; more than 256 KB is 413; anything
  but a JSON object is 415; more than 60 calls a minute to one workflow is
  429.

Automated checks:

```powershell
npm test --workspace=@postgear/automation -- data form resolve
npm test --workspace=@postgear/worker -- sheets http data
npm test --workspace=@postgear/api -- google webhook connections automation-catalog webhook-sample
```

### 5n. Workflows: templates, schedules and sending for real (Sprint 10)

**Set up once.** In the root `.env`:

```env
AUTOMATION_SIMULATION="true"   # Slack, Teams, Discord, Sheets, HTTP: stand-ins, nothing leaves the machine
PUBLISH_SIMULATION="true"      # posting steps publish to the stand-in
AI_SIMULATION="true"           # AI steps write template text, still charge credits
AUTOMATION_INTERNAL_TOKEN="..." # npm run generate:keys; the API and the worker must share it
```

Restart the API and the worker. Without `AUTOMATION_INTERNAL_TOKEN` every
posting, AI and Email step fails with "This step cannot run because the
worker is not set up to reach PostGear. Ask your admin to set
AUTOMATION_INTERNAL_TOKEN." Open **Workflows** in the sidebar
(**<http://localhost:3000/seed-demo-org/workflows>**).

**Connections under simulation.** On **Workflows > Connections**: Slack,
Teams and Discord accept any well-formed link (for Slack
`https://hooks.slack.com/services/T000/B000/anything`); Google adds a
simulated account (see 5m). Nothing is sent, the run log line names the
app and the link's last four characters.

**Each template.** Pick it under **Create Workflow**, follow **Finish
Setup**, then **Test Workflow** with the built-in sample. Steps that would
reach outside show the Dry Run sticker; tick **Send For Real In Tests** on a
step to run its stand-in (or the real app when simulation is off).

| Template | Needs | How to see a live run |
|---|---|---|
| Publishing Report | simulated Google, Slack | Turn it on, publish any post from the composer: a Live run appears in the Runs tab |
| AI Weekly Post | a channel | Test it: Generate Text (5 credits) and Generate Image (10) run for real even in tests, the review waits in the run bar (Approve), then a draft lands in **Drafts** |
| Failed Post Alert | Slack | Turn it on, publish a post whose text contains `[simulate:400]`: the post fails, the Slack step runs |
| Repurpose For X | a channel | Turn it on, publish a LinkedIn post: Rewrite In Brand Voice (2 credits), review, then a draft for X |
| Blog To Draft | a channel | Turn it on, call its link (5m, Webhook trigger): a draft and a bell notification |

**Forcing failures.** Put a marker in a Slack, Teams, Discord, Sheets or
HTTP step's message (stand-ins read them under `AUTOMATION_SIMULATION`):
`[simulate:429x1]` fails once then works ("Succeeded after 2 attempts");
`[simulate:429x2]` works on attempt 3; `[simulate:401]` marks the connection
**Needs Reconnect**; `[simulate:400]` fails at once; `[simulate:slow:20]`
takes 20 seconds. To see out of credits, use up the month's AI credits
(`/ai/credits` shows what is left) and run an AI step: the run stops at it
with the reset date in the alert.

**A schedule, quickly.** Add a Schedule trigger, Daily, at a time two or
three minutes from now in your own time zone, then turn the workflow on.
Temporal UI (**<http://localhost:8233>**, Schedules) lists
`automation-schedule:<id>`; at the minute a Live run appears in the Runs tab.
Pause deletes the schedule, and turning it back on never runs the missed
times. More often than hourly is refused when the workflow has AI steps.

**A review that waits.** Add Manual Review, test, and stop the worker while
the run waits: start it again and the review is still there; Approve
finishes the run. An unanswered review times out after 7 days.

**Sending for real.** One flag per area, all local only:

- `AUTOMATION_SIMULATION="false"`: Slack, Teams, Discord, Google Sheets and
  HTTP Request call the real services (a real webhook link or Google
  account, see 5m). Email goes out through SMTP when `SMTP_HOST` is set,
  else it is printed in the API console either way.
- `PUBLISH_SIMULATION="false"`: posting steps publish to the real channels.
- `AI_SIMULATION="false"`: AI steps call OpenAI (costs money).

Restart the API and the worker after changing any of them.

Automated checks:

```powershell
npm test --workspace=@postgear/automation
npm test --workspace=@postgear/worker -- automation
npm test --workspace=@postgear/api -- automations
npm run test:e2e -- e2e/workflows.spec.ts   # needs dev:api:e2e, see the top of playwright.config.ts
```

### 5o. Discover (Sprint 11)

**Set up once.** In the root `.env`:

```env
DISCOVER_SIMULATION="true"   # recorded feeds, a stand-in place finder, sample competitor and sample articles: nothing leaves the machine
AI_SIMULATION="true"         # Create Post drafts with the stand-in model, and still charges credits
DISCOVER_GEOCODER="nominatim"  # "off" turns finding places off, to see that state
DISCOVER_LINK_DECODE="true"    # "false" takes Read off Google News stories, to see that sentence
# YOUTUBE_API_KEY=""           # leave empty: the Videos tab then says it is not set up
```

Apply the two Sprint 11 migrations (`npm run migrate:deploy --workspace=packages/db`)
and restart the API. Its boot log prints one line, `discover.boot`, that says
which world it is in (`"simulation":true`) and who it says it is. Open
**<http://localhost:3000/seed-demo-org/discover>** as `demo@postgear.local`.
The page wears a **Simulated** sticker at the top right while the flag is on.

**What simulation knows.** Three places: Chennai (Tamil and English), San
Francisco (English) and Paris (French). Any other position or city answers
Worldwide. One competitor: an invented company at `acme.example`. Four sample
pages for the reader, and any other address answers the English sample
article, so no real site is ever fetched.

**The place.**

- The seeded demo workspace starts on **Chennai, Tamil Nadu** with a
  Workspace badge, in Tamil. A workspace with no saved place (switch to
  **PostGear Second Org**) starts on a guess from the browser's time zone,
  with a Guess badge.
- Click the place chip. **Use My Location** asks the browser once; under
  simulation any position near Chennai, San Francisco or Paris finds that
  city. The sentence under the button says what is kept (the city, not the
  position).
- Block location in the browser and press it again: "Location is blocked in
  your browser. Search for your city instead." with the search field focused.
- Type `paris` and press Enter (search only runs on Enter): pick Paris,
  France. Reload: the page remembers it.
- **Worldwide** shows the world group; Videos and Festivals then say they
  need a place.
- As the admin, **Save For This Workspace** makes the place the default for
  everyone. As `member@postgear.local` the button is disabled with "Only
  workspace admins can change the workspace place."
- Switch the language chip between Tamil and English: News follows it.

**The tabs.**

- **Trending**: Rising Searches In Tamil Nadu (cards with related
  headlines), What People Are Reading On Tamil Wikipedia (ranked rows), and
  Worldwide On Bluesky And Mastodon (chips that link out).
- **News**: Chennai Stories and Top Stories In India, in the chip's
  language. Pick a topic from the select; **Read A Page** opens the reader
  on any address you paste.
- **Videos**: "Trending videos are not set up for this PostGear." with no
  key. With `YOUTUBE_API_KEY` set to anything, simulation shows five sample
  videos.
- **Festivals**: the next 30 days in sections by week, with Public Holiday
  and Observance badges and **Plan A Post**.
- **Competitors**: empty at first. Press **Add Competitor**, name it `Acme`,
  enter `acme.example` and press **Find Feeds**: Blog (RSS) and Changelog
  (Atom) appear ticked. Add the YouTube channel id
  `UCacmeSampleChannel00000`, the Bluesky handle `acme.example` and the
  Mastodon account `acme@mastodon.example`, and save. The group shows rows
  with Blog, YouTube, Bluesky, Mastodon and News badges. Try
  `http://127.0.0.1:3000` as a website: "This address is private or on your
  own network." Edit from the group menu; Remove is an admin's (red, asked
  first).

**Create Post.**

- **Create Post** on any card opens a sheet with the brief, the language
  (the chip's), your channels, Tone and Format. **Draft With AI** costs 5
  credits; **Open In Composer** saves a draft and opens it.
- **Plan A Post** on a festival dates the draft: the evening before a public
  holiday, the morning of an observance.
- A competitor's brief ends with "Write our own take on this topic for our
  audience, not a summary of theirs."
- The demo workspace's monthly allowance is 100 credits. At 0 the sheet shows
  the out-of-credits message with the reset date; `npm run db:seed` resets
  the ledger (it also resets notifications and billing events).

**The reader.**

- **Read** on a Trending card opens the sample article in a side sheet: site,
  byline, date, reading time, the text. **Create Post From This** opens the
  Create Post sheet with the article as the brief.
- **Read** on a News story shows "Opening the story..." and then the Tamil
  sample (the link is resolved through the sample pages).
- **Read A Page** with `http://10.0.0.1/`: "This page is private or on your
  own network." With `https://reader.example/`: "This page is not an
  article." With `https://reader.example/missing`: "We could not read this
  page. Open it in a new tab instead." Open stays on every failure.
- Set `DISCOVER_LINK_DECODE="false"`, restart the API, press Read on a News
  story: "We could not open this story here. Open it in a new tab instead."
- More than ten reads in a minute: "Try again in a moment."

**Settings.** Open **Settings**, then **Discover**: Workspace Place,
Languages (the first is the default), News Topics and Sources. Turn Videos
off and the Videos tab says "Videos are turned off for this workspace." for
everyone in it. A member sees the page read-only.

**What is kept, and where.** Nothing from a feed, a competitor or a page is
written to Postgres: it lives in Redis for a limited time
(`docker exec postgear_redis redis-cli --scan --pattern 'discover:*'`;
simulated copies sit under `discover:sim:`). Postgres holds two tables only:
`DiscoverSettings` (a place, never a position) and `Competitor`. To start
clean, delete the Redis keys:

```powershell
docker exec postgear_redis sh -c "redis-cli --scan --pattern 'discover:*' | xargs -r redis-cli del"
```

**The real feeds (only with the owner's yes).** Everything above is free to
run for real, and belongs to someone else: Google's feeds are unofficial, and
OpenStreetMap's place finder allows one request a second and asks to be
identified. So this is a one-time check, never a loop:

1. Set `DISCOVER_SIMULATION="false"` and restart the API. The boot line now
   says `"simulation":false` and the sticker is gone.
2. Open Discover on Chennai: Trending, News and Festivals come from the live
   feeds. Press **Use My Location** once (one request to OpenStreetMap).
3. Press **Read** on one Trending card. Many publishers refuse automated
   readers, so "We could not read this page." with Open is a normal answer.
4. Set the flag back to `"true"` and restart.

No step here costs money, and no key is needed except the optional YouTube
one (a free Data API key from the Google Cloud project you already have).

Automated checks:

```powershell
npm test --workspace=@postgear/discover-engine
npm test --workspace=@postgear/api -- discover
npm test --workspace=@postgear/web -- discover
npm run test:e2e -- e2e/discover.spec.ts   # needs dev:api:e2e and both simulations, section 3a
```

### 5p. Clips (Sprint 12)

Clips turns a long video (a YouTube, Twitch or Kick link, or an upload) into short clips: by hand, or with Find Clips. It is desktop only (1366 px and up). Locally everything runs in simulation: **nothing is ever fetched from YouTube, Twitch or Kick**, and no paid service is called.

**What to install.** FFmpeg with libass (it draws the exports and measures sound for Find Clips, so simulation needs it too). yt-dlp and Deno are needed only for real links, which you do not need locally. Then:

```powershell
npm run clips:doctor        # checks FFmpeg (libass, harfbuzz, x264), ffprobe, yt-dlp, Deno
npm run clips:samples       # makes the two sample videos simulation serves (a 3 minute talk, a 10 minute stream)
npm run clips:fonts:build   # the fonts exports draw text with (needs Python with fontTools)
```

**The `.env` block** (every variable is explained in `.env.example`, block "CLIPS"):

```
CLIPS_SIMULATION="true"
AI_SIMULATION="true"
BILLING_SIMULATION="true"
WORKER_ROLES="publishing,media,render"
```

`npm run dev` then runs the API, the web app and one worker that serves all four queues. Open **<http://localhost:3000/seed-demo-org/clips>** as `demo@postgear.local`. The **Simulated** badge beside the tabs says simulation is on. **Try A Sample** imports the 3 minute talk sample with no link at all.

**Simulation links** (paste them in the Create tab; they live in `packages/media-tools/fixtures/simulation/links.json`):

| Link | What happens |
|---|---|
| `https://www.twitch.tv/videos/900000001` | A 10 minute past stream: imports and works everywhere |
| `https://www.youtube.com/watch?v=simtalk0001` | A 3 minute talk: imports and works everywhere |
| `https://kick.com/simstreamer/videos/00000000-0000-4000-8000-000000000001` | The stream sample on Kick |
| `https://www.twitch.tv/videos/900000002` | Subscribers only: "This video is private or needs a login, so we cannot read it." |
| `https://www.twitch.tv/videos/900000003` | Still live: "This stream is still live. Come back when it has ended." |
| `https://www.twitch.tv/videos/900000004` | Gone: "We could not find a video at this link." |
| `https://www.twitch.tv/videos/900000005` | The platform is not answering (429) |
| `https://www.twitch.tv/videos/900000006` | A 30 hour marathon: longer than the plan allows, with See Plans |
| `https://www.twitch.tv/videos/900000007` | Imports; Find Clips then fails and gives the AI minutes back |
| `https://www.twitch.tv/videos/900000008` | Imports; Find Clips holds 30 seconds at scoring (to see the steps and Cancel) |
| `https://www.youtube.com/watch?v=simprivate1`, `simlivenow1`, `simmissing1`, `simresting1`, `simtoolong1` | The same cases on YouTube (`simresting1` is YouTube asking for a sign-in) |
| `https://www.twitch.tv/videos/900000009` | Imports; fetching the sharp range then fails, so the clip exports at 720p with the "sharp video is gone" sentence (no recorded chat) |
| `https://www.twitch.tv/videos/900000010` | The import stops at 45% with "Something went wrong on our side. Try again in a little while." and Try Again |
| `https://www.twitch.tv/videos/900000011` | Imports; every download quality then answers "format gone" (no recorded chat, so Find Clips uses sound and picture only) |

Channels: on the Streams tab, **Add A Channel** with Twitch and `simstreamer` (or `acme`) lists recorded streams.

**Forcing switches** (Module 20; each works only with `CLIPS_SIMULATION=true`, and with it off the names go to the real bindings like any other):

| Switch | What it forces |
|---|---|
| `[simulate:render-fail]` in a clip's name | The export fails at 10% before FFmpeg starts: "We could not export this clip. Nothing was charged. Try again." in the panel and the bell |
| `[simulate:preview-fail]` in a clip's name | Only Preview Export fails ("We could not make the preview. Try again."), with no bell |
| Add A Channel `simempty` (YouTube `@simempty`, Twitch, Kick) | An empty list: "This channel has no public videos yet." |
| Add A Channel `@simquota` (YouTube) | Today's YouTube list allowance is used: "We have reached today's limit for YouTube lists. Try again tomorrow, or paste a video link." |
| Add A Channel `simflaky` (all three) | The first list works, every later one fails: press Refresh (30 s apart) to see the old list with "This channel's list is not available right now. Try again in a few minutes." and "Updated N ago". The memory lives in the API process, so a restart resets it |

Cases with no switch: a platform switched off (take it out of `CLIPS_PLATFORMS`); plan limits (the Free "PostGear Second Org", or an override or a usage adjustment on `/operator`, with an end date a minute away to see an override end); a video with no sound (upload one made with `ffmpeg -f lavfi -i testsrc=duration=20:size=1280x720:rate=30 -an silent.mp4`); a dropped connection (DevTools offline during an upload or an edit); two people on one clip (two tabs); a window under 1366 px.

**The ledger under load** (Module 20): twenty imports charged at once against a throwaway Free workspace with room for three, on the real local Postgres. It makes the workspace and deletes it again, and is skipped unless asked for:

```bash
CLIPS_LEDGER_DB_TEST=1 npx dotenv -e .env -- npx jest --config apps/api/jest.config.js usage.load
```

**The worker image** (Module 20): stop the local worker, then `docker compose --profile worker-image up -d --build worker`. The container forces every simulation flag on whatever .env says, and is ready when `docker logs postgear_worker` shows four `polling "postgear-..."` lines and `docker inspect -f '{{.State.Health.Status}}' postgear_worker` says `healthy`. Import a link and export a clip as usual, then `docker compose --profile worker-image rm -sf worker` and start the local worker again. Never run `docker compose config` without `--quiet`: it prints the .env secrets.

**Retention by hand.** A video's removal date is "last used plus the plan's days" (14 on the demo plan), and the sweep puts back any date that disagrees, so move `lastUsedAt` too:

```powershell
# "Removed in 3 days" on the card and a bell notice (the date is held 3 days out):
docker exec postgear_postgres psql -U postgres -d postgear_db -c "update \"ClipVideo\" set \"lastUsedAt\" = now() - interval '60 days', \"expiresAt\" = now() + interval '2 days', \"expiryNoticeAt\" = null where id = '<video id>';"
# Removed on the next pass (it was told 4 days ago):
docker exec postgear_postgres psql -U postgres -d postgear_db -c "update \"ClipVideo\" set \"lastUsedAt\" = now() - interval '60 days', \"expiresAt\" = now() - interval '1 day', \"expiryNoticeAt\" = now() - interval '4 days' where id = '<video id>';"
```

The sweep runs every 15 minutes in the worker's maintenance pass. To run it now (Git Bash; the token is `AUTOMATION_INTERNAL_TOKEN` from `.env`, `daily` also runs the once-a-day parts):

```bash
curl -s -X POST http://localhost:3001/internal/clips/sweep -H "x-postgear-internal: <token>" -H "Content-Type: application/json" -d '{"daily":true}'
```

It answers what it did (`noticed`, `expired`, `downloads`, `orphans`, ...).

**Rights requests.** The question mark beside "This video is mine, or I have permission to use it." opens `/legal/copyright`. An operator removes a video everywhere and blocks its link with `npm run clips:remove -- --url <link> --reason "<10+ characters>" --by demo@postgear.local` (it only reads the link, never fetches it). Paste that link again: "This video was removed after a request from its owner."

**The operator screen.** The seed makes `demo@postgear.local` an operator; for anyone else run `npm run operator:grant -- --email <address>` (and `operator:revoke`). Open the account menu, **Operator**, or **<http://localhost:3000/operator>**: Plans, Workspace Overrides, Usage, Change Log and Library. `member@postgear.local` gets the ordinary "not found" page there. Saves mail `OWNER_EMAIL` only in production; locally the mail is printed in the API console as `operator.mail_not_sent`. To test a lower plan, use the second workspace (Free) or give the demo workspace an override with an end date.

**The library.** `CLIPS_LIBRARY_INGEST=true npm run clips:library:seed` draws the small sticker and sound fixtures and ingests them; publish a run from the operator Library tab. Never point an ingest at an outside source locally.

**Where the files are.** With `STORAGE_PROVIDER="local"`, private files sit in a folder next to the upload folder with `-private` added to its name (for example `uploads-private`), under `clips/<workspace id>/`, and the browser reaches them only through signed `/clips/files/<token>` links that expire. With MinIO, open **<http://localhost:9001>** (`minioadmin` / `minioadmin`) and look in the `postgear-clips` bucket.

**Limits you may hit while testing.** Each person can start 30 imports, exports, previews or downloads a minute (then "You are going very quickly. Wait a minute, then try again."), and the whole app refuses new work past `CLIPS_QUEUE_CEILING` waiting jobs.

**Real keys** (Twitch and YouTube channel lists) are only for the real test plan: see `docs/sprint-12/clips-keys-guide.md` and `docs/sprint-12/real-test-plan.md`.

Automated checks:

```powershell
npm test --workspace=@postgear/video-engine
npm test --workspace=@postgear/api -- clips
npm test --workspace=@postgear/worker -- clips
npm test --workspace=@postgear/web -- clips
npm run test:e2e -- e2e/clips.spec.ts e2e/operator.spec.ts   # needs dev:api:e2e, a seeded database and the worker, section 3a
```

### 5q. Clips AI (Sprint 13)

Clips AI adds a second service: **`apps/media`**, a small Python program that does the sound and picture work (speech to text, faces, motion). The TypeScript worker still decides the order of every step; Python only answers. Locally it runs in simulation, so **no AI model is ever downloaded** and nothing is paid for.

**What to install.** [uv](https://docs.astral.sh/uv/) (it installs the right Python, 3.13, by itself). Then, once:

```bash
uv --version                     # any recent version
cd apps/media && uv sync         # base and dev packages: all simulation, lint, types and tests need
# uv sync --group ml             # the model libraries, only for a real run you have agreed to
```

**The `.env` block** (explained in `.env.example`, block "CLIPS AI"):

```
MEDIA_SIMULATION="true"          # unset, it follows CLIPS_SIMULATION
MEDIA_URL="http://localhost:8100"
MEDIA_INTERNAL_TOKEN="<64 hex characters>"   # npm run generate:keys prints one
```

`npm run dev` now starts four things: the API, the worker, the web app and the Python service. Its log says `worker.serving queue=postgear-media-py`. Without uv it prints one line and steps aside: Clips works as before and every AI button shows as off. `npm run dev:media` starts it alone.

**Check it by hand.**

1. Open <http://localhost:8100/health>: `{"status":"ok"}`.
2. Open the Clips page and look at `GET /clips/status` in the network tab: `ai.service` is `ok`.
3. Stop the Python service and reload within about 10 seconds: `ai.service` is `off`, and the Clips page and the editor work as before.

**Listening (Module 02).** With everything running, as the demo admin (the session cookie from the browser, or `curl` with a cookie jar):

| Call | What you should see |
|---|---|
| `POST /clips/videos/<stream sample id>/transcript` `{ "fromMs": 60000, "toMs": 180000 }` | 202, `price: 2`, a job at "Listening to what is said", then DONE; the AI minutes meter went up by 2 |
| `GET /clips/videos/<id>/transcript?fromMs=60000&toMs=180000` | The words of that stretch, each with a start and an end inside it |
| The same `POST` again | 200 `{ "covered": true }`: no job, no charge |
| `POST` with `0` to `240000` | Only the two new minutes are listened to and charged |
| `PATCH /clips/videos/<id>/transcript/words` `{ "fixes": [{ "index": 0, "text": "Fixed" }] }` | The `GET` reads the fixed word from then on |
| The 3 minute talk sample, `120000` to `150000` | DONE with `noSpeech`, and the 2 AI minutes come back |
| `https://www.twitch.tv/videos/900000012` (title holds `[simulate:listen-fail]`) | The job fails with "We could not finish listening to this video. Your AI minutes were given back." |
| `https://www.twitch.tv/videos/900000013` (`[simulate:listen-slow]`) | Listening holds for about 10 seconds, long enough to press Cancel |

A video with no recorded transcript (any upload) gets stand-in speech under simulation: plain test sentences at a steady pace, so captions can be tried on any file. An upload whose name holds `verideck` reads the Verideck sample's recorded words. `npm run clips:listen-benchmark -- --wav <16 kHz mono wav> --model small --model-root .cache/media-models` times real listening (it needs the `ml` group, and downloads the model the first time).

**The shared contract.** Every shape that crosses between Node and Python is written once, in `packages/media-contract`. After changing one:

```bash
npm run contract:export          # writes packages/media-contract/schema/contract.json
npm run contract:python          # regenerates apps/media/src/postgear_media/contract/generated.py
```

A Jest test and a pytest test fail when either file is stale, and both sides parse the same fixture files.

**The AI model for text** (reading a transcript for moments, titles, still pictures) is the existing AI engine. Locally `AI_SIMULATION="true"` answers from recorded files. For a real run set `OPENAI_API_KEY`, or `OPENROUTER_API_KEY` to use any OpenRouter model (then `AI_MODEL` is OpenRouter's `vendor/model` id; with both keys, `AI_PROVIDER` picks).

**Your own sample video.** `npm run clips:samples` also copies `out/Verideck_60s_3D.mp4` (or the file named in `CLIPS_OWN_SAMPLE`) into the samples folder as the `verideck` sample, a real 60 second video for testing every Clips screen. Its simulation link is `https://www.youtube.com/watch?v=simverideck`. The file itself is never committed.

**Captions (Module 03).** Open any clip in the editor (the 10 minute stream sample has recorded speech) and press **Captions** in the rail.

| Do this | What you should see |
|---|---|
| Press **Add Captions** | On a stretch already listened to it is free and the words appear at once; else the button shows its price in AI minutes, a listening bar runs, then the words appear |
| Press a style tile (Bold Pop, Marker, Karaoke, Clean, Boxed, Typewriter) | The page on the clip changes look; one Undo puts the old style back |
| Move Size and Words At Once, pick Letters, change the colour | The clip follows; each is one undo step |
| Turn on **Safe Area Guide** | Three striped strips where the apps put their own buttons |
| Press a word in the list, type a new one, **Save** | The word is bold in the list and changed on the clip, for this clip only; **Replace Everywhere** changes it wherever it was heard in the video |
| **Hide Word** | The word is struck through in the list and gone from the clip |
| **Create A Style**, name it, **Save Style** | A new tile of your own; other clips in the workspace can pick it |
| **Translate** to Tamil or Hindi | 1 AI minute for a short clip; the words change language and are marked by page; the same request again is free; Undo shows the words as said |
| Upload an `.srt` or `.vtt` file with the file button | No AI minutes used; lines outside the clip are skipped with one sentence; a file with no lines is refused |
| **Preview Export**, then **Export Clip** | The file has the same pages at the same moments as the editor |
| Stop the Python service, reload | The tab says captions are not available right now; captions already on the clip still draw and export, and the file upload still works |

**Transcript editing (Module 04).** Open a clip of the 10 minute stream sample in the editor and press **T** (or **Transcript** in the top bar).

| Do this | What you should see |
|---|---|
| Press **T** | The Transcript pane opens beside the stage and the panel folds to its rail; **T** again closes it; opening the panel closes it too. It opens again where you left it after a reload |
| Play the clip | The word being said is marked and the pane follows it (scroll the pane yourself and it stops following until you play again) |
| Click a word far down | The playhead jumps to it |
| Drag across a sentence (or Shift and the arrows), press **Delete** | The words are struck through, the clip is shorter, the captions close up, and a toast says "Cut 6 words. The clip is 4.2 seconds shorter." with **Undo** |
| Hover the struck-through words | **Restore** puts them back; one Undo also does |
| Select almost all of a short clip, press **Delete** | "A clip needs at least 3 seconds." and nothing changes |
| **Remove Silences** | The popover says how many pauses and how long they add up to before anything changes; the slider changes the count. On the generated samples it finds none and says the pauses have sound under them (their sound is a steady test tone); try a recording of yourself talking to see pauses go |
| **Remove Filler Words** | Each filler with a count and a tick; untick one, **Remove**: one undo step and a toast |
| Double-click a word, type, **Save** | The word changes (the captions' own edit when the clip has captions of these words, else for the whole video); **Replace Everywhere** changes it wherever it was heard |
| A clip only partly listened to (the talk sample around its silent block) | **Listen To This Clip (2 AI Minutes)** with the minutes chip; the words appear when it finishes |
| **Preview Export** and listen at the cuts | No click at any cut (each cut fades the sound 15 ms each side) |
| Video page, **Transcript** | A sheet with the words; **Ctrl+F** finds ("1 of 42"), Enter steps and the player jumps; select some words and **Create Clip**; a stretch not heard yet shows **Listen** with its price |

`npx jest --config packages/media-tools/jest.config.js cuts-parity` (with `FFMPEG_PATH` and `FFPROBE_PATH` from `.env`, Docker up) proves on the real FFmpeg that twenty cuts export frame-exact and never click.

**Clip Setup and Find Clips with AI (Module 05).** On the 10 minute stream sample's video page:

| Do this | What you should see |
|---|---|
| Press **Find Clips** | Clip Setup opens: Spoken Language, Genre, the Range slider, What should we look for?, Clip Length, Shape, Captions, and the Summary with one price line per step and the total on the button, for example "Find Clips (8 AI Minutes)". Nothing is charged |
| Drag the range to half | The price drops (about half); Listening reads "free" for any part already listened to, and Sound And Picture is free whenever the run listens |
| Type "the tunnel jump", pick Gaming, 30 To 60 Seconds, Vertical, press **Find Clips** | Back on the video page the run's steps show in words (sound, picture, chat, then "Listening to what is said" and "Reading for the best moments" when it listens), then titled clips with a score and reasons; the one about the tunnel jump is first with "Matches what you asked for", and the note reads "AI listened to what was said and looked at sound and picture." |
| Open a clip | Vertical, 30 to 60 seconds, starting on a sentence; with Captions on in the setup it opens captioned in the style picked |
| Clip Setup again on the same stretch | Listening reads "free" |
| A request nothing in the video matches | The note "Nothing matched what you asked for. Here are the best moments we found instead." |
| The menu beside Find Clips, **Quick Find** | Sprint 12's one-press run at its own price ("Quick Find (3 AI Minutes)") |
| A month with too few AI minutes left | The button is off and the card says how many the run needs and how many are left, with **See Plans** |

Under simulation the moment picker answers from the transcript, the request and the genre, so Gaming and Podcast pick differently and the same setup gives the same clips every time; titles are the moment's first words.

**Look For Action (Module 06).** Needs the Python worker (`MEDIA_SIMULATION=true`) as well as the Node worker. On the same stream sample:

| Do this | What you should see |
|---|---|
| Open Clip Setup | A **Look For Action** card with its price beside it before it is on ("+5 AI Minutes" for the whole 10 minutes) and "Finds sudden action in the picture. It does not know the rules of your game." |
| Turn it on | A "Looking For Action" line joins the Summary and the total rises by that much; the Summary lists "Looking for action" |
| Press **Find Clips** | The steps include "Watching for action"; some clips carry "Sudden movement on screen" among their reasons; the note reads "AI listened to what was said and watched for action." |
| Set `CLIPS_ACTION_VISION="true"` in `.env`, restart the API, run again | The card adds "We also look at a few still pictures of each burst."; clips the stills check found something in read "Something unexpected happens" and carry one sentence under their reasons about what is on screen (under simulation a fixed sentence per moment, picked from the burst's time; bursts with no sound rise are "nothing notable" and dropped) |
| Look in the private bucket under the video's folder (MinIO console, `postgear-clips`) | No `still-*`, `motion-*` or `watch-state-*` file is left after any run, finished, failed or cancelled |
| Rename the video to hold `[simulate:action-fail]`, run again | The run still finishes, without action clips; the Looking For Action minutes come back (the meter shows it) |
| Rename it to hold `[simulate:action-slow]` | The motion step holds about 10 seconds, long enough to press Cancel; nothing is kept and every AI minute comes back |
| Rename it to hold `[simulate:stills-fail]` (vision on) | The run finishes; the action clips keep "Sudden movement on screen" with no sentence |

With `CLIPS_ACTION_VISION` off (the default) no picture ever leaves the system: the stills are not even cut. Under simulation the motion values are recorded per sample (the stream has a cut spike plus action after it and three quiet bursts; the talk samples are calm), and the stills are one test pattern, never a real frame.

**Detect Camera (Module 07).** Free (no AI minutes). Needs the Python worker (`MEDIA_SIMULATION=true`) as well as the Node worker. Under simulation the face boxes are recorded per sample: the stream has one small still face in the bottom right corner (the picture itself draws no marker there, the recorded boxes stand in for a face camera), `two-speakers` has its two face markers, and the talk sample and any upload have no face.

| Do this | What you should see |
|---|---|
| Open a Vertical clip of the stream sample, **Layouts**, pick **Split** | A **Detect Camera** button under the layout tiles (none on Fullscreen or Blurred) |
| Press **Detect Camera** | A violet bar with "Finding faces" for a moment, then the Camera box jumps to the bottom right corner of the video, touching the edges, and is selected |
| Press Ctrl+Z | The Camera box goes back where it was, in one step |
| Make a second clip from the same minutes and press **Detect Camera** there | It answers at once: the face file is reused and no new job shows in the jobs list |
| Do the same on a clip of the talk sample | "We could not find a face camera. Drag the box yourself." and nothing moves |
| Rename the video to hold `[simulate:faces-fail]` (new clip, new stretch), press it | "We could not finish looking for faces. Try again." and nothing moves |
| Rename it to hold `[simulate:faces-slow]` | "Finding faces" holds about 10 seconds |
| Delete a video that has a face file | Its folder in `postgear-clips` (MinIO, or `apps/api/uploads-private` locally) is gone, `faces-*.json.gz` with it |

**Follow The Speaker (Module 08).** Free (no AI minutes). Needs the Python service and the Node worker, like Detect Camera. Import the `two-speakers` sample (`https://www.youtube.com/watch?v=simtwospkr1`, a local copy under simulation): its recorded boxes are two faces that take turns (the speaker's box moves while they talk) and the left speaker is gone from 60 to 63 s. Speech comes from the transcript, so a clip that was never listened to follows the largest face. If you run a stand-alone `python -m postgear_media.worker` beside `npm run dev:media`, restart it after any change under `apps/media` (it does not reload; the one inside the service does).

| Do this | What you should see |
|---|---|
| Video page, **Find Clips**, Vertical, switch on **Follow The Speaker**, run | The card says "Free" and the total does not change; each clip made is marked to follow, and the top three get face files during the run (FACES jobs in the jobs list) |
| Open one of those clips (answer the shape question if asked) | Following is on by itself: in **Layouts** the switch is on, the Video pane shows a dashed frame you cannot drag with "The frame follows the speaker. Turn it off to move it yourself.", and a **Speaker** strip sits under the Video row (one colour per person) |
| Play across a turn (the clip from about 59 s has one at 70.5 s) | The tall frame cuts to the other face within half a second, it does not slide |
| Click the hatched stretch on the strip (1 to 3 s into that clip) | "We lost the speaker for 3 seconds here." and **Fix By Hand** |
| **Fix By Hand**, drag the box, **Done** | The stretch is drawn plain with a hand mark; **Clear Fix** removes it; each is one Ctrl+Z |
| Switch on **Show Both** | Split: two stacked frames, Top and Bottom, one per person; Ctrl+Z goes back to one frame with your fix |
| Pick a layout tile while following | Following turns off first and the tile applies to your own boxes, one undo step |
| Switch **Follow The Speaker** off | "Your own layout is back." and the boxes you had; Ctrl+Z follows again |
| **Export**, **Preview Export**, then a 720p export | The frame moves in the file as in the editor (stills at 0.5 s, 2 s and 15 s show left speaker, your fix, right speaker) |
| A clip of the talk sample | "We could not find anyone to follow in this clip." and the switch stays off |

The face file (`faces-<job>.json.gz`) holds boxes and times only: no landmarks, no picture of a face, never who. The real detector (MediaPipe, short-range model) is wired but never runs here: its model file is not downloaded by any code.

**AI Effects (Module 09).** Four new cards at the bottom of the editor's **Effects** tab. Bleep Bad Words and Add Hook Clip are free, Add Hook Title is free (at most 10 asks a minute per workspace), Text To Speech costs AI minutes and is hidden unless `CLIPS_TTS=true` is set for the API (default off; restart the API after changing it). Text To Speech also needs the Python service and the Node worker. For the real Kokoro voice: `npm run clips:voice:setup`, put `kokoro-v1.0.onnx` and `voices-v1.0.bin` in `.cache/media-models/kokoro` (sizes and checksums in `apps/media/voice-program/README.md`), set `MEDIA_SPEAKER="kokoro"` (it speaks for real even under simulation) and restart the media service; without it, under simulation the voice is a beep pattern. The `talk` sample's recording has two planted words for this: "bullshit" at 15.5 s and "shitty" at 100.6 s of the video. A talk transcript made before this module still has the old words there, so make a fresh clip over a stretch that was never listened to (for example 5 s to 40 s) and listen to it.

| Do this | What you should see |
|---|---|
| A clip of the talk sample from 5 s to 40 s, **Effects**, open **Bleep Bad Words** | "Part of this clip has not been listened to yet." and **Listen To This Clip** with its price; after it, a **Bleep Words** switch |
| Switch on **Bleep Words** | "bullshit" at 0:10 is listed and ticked, **Bleep** is picked; "Bad words bleeped." with Undo |
| Click the word (not the box) | The playhead jumps to it; with captions on, the caption shows "b*******" (first letter and stars); the transcript keeps the word |
| Play over it | A short 1 kHz tone replaces the word, with no click at its edges |
| Pick **Mute**, then untick the word | Silence instead of the tone; unticking says "Word no longer bleeped." and the word plays again; each is one Ctrl+Z |
| **My Words**, type a word that is in the clip, **Save** | It joins the list and is bleeped at once; a word with a space or over 40 letters is refused with a sentence |
| Open **Add Hook Title** | Three titles made from the clip's own words; **Try Again** gives three others |
| Pick a title, pick a look (Hook Bold, Hook Box, Hook Pop), **Add** | A large line in the top third for the first 3 seconds, an ordinary text item you can move and edit; adding again changes its words and look ("Hook title changed.") |
| Open **Add Hook Clip** | A small strip of the clip's sound with a 2.5 s range on its loudest moment; **Preview** plays the range, then the clip from its start |
| **Add** | The clip grows by the hook's length, the first bar on the timeline says **Hook** with its own delete, captions show on the hook, and the hook title stays at 0 |
| Delete the hook (the bar's delete or **Remove Hook**) | The clip is exactly as before; Ctrl+Z brings the hook back |
| With `CLIPS_TTS=true`: open **Text To Speech** | With Kokoro, ten voices (Heart, Bella, Sarah, Michael, Fenrir, Puck, Emma (British), George (British), Alpha (Hindi), Omega (Hindi)), each with a play button for a short sample; under simulation, River, Meadow and Stone with no sample |
| Type a line, pick a voice, **Make The Voice (1 AI Minute)** | A SPEECH job runs (about 15 s with Kokoro on a laptop CPU); the spoken line lands on the sound row at the playhead and shows in your uploaded sounds as "AI Voice"; the same line and voice again costs nothing |
| A Hindi line (Devanagari) with **Alpha (Hindi)**; the same line with **Heart** | Alpha speaks it (an English word inside it is fine); Heart answers "This voice cannot read this language. Pick another voice." |
| **Make The Voice**, then **Cancel** at once | The job stops within a few seconds and the AI minute comes back |
| **Export**, **Preview Export**, then a 720p export | The tone (or silence) sits on the word in the file, the captions show the stars, the hook plays first |

The word lists are PostGear's own short lists (strong swear words in English and Hindi, none yet for Tamil); mild words go in My Words. No speech text, title or voice line is written to any log. The real voice is Kokoro, run as its own small program (`apps/media/voice-program`, GPL-3.0-or-later, because its phonemiser espeak-ng is GPL); the media service only calls it with a file in and a file out.

**Recipes And Brand Kit (Module 10).** The Clips page has a **Recipes And Brand Kit** link. Recipes and brand kits are free; Auto-Edit Video costs AI minutes only for the part of the video not listened to yet. Restart the Node worker once after pulling this module (it adds `clipAutoEditWorkflow`).

| Do this | What you should see |
|---|---|
| **Recipes And Brand Kit**, **Recipes** | Five **Starter Recipes** on top (Clean Up Recording, Auto-Edit Talking Video, Captions Only, Reframe, Social Edit), each with a **Built In** badge, its line and what it sets; only **Duplicate**, no Rename or Delete |
| **Duplicate** a starter | "Clean Up Recording Copy" under **My Recipes** with **Rename** and **Delete Recipe**; the count reads "1 of 50 recipes" |
| In a clip, set Vertical and Blurred, the editor's **...** menu, **Save As Recipe**, type a name | The dialog lists what it saves ("Shape: Vertical", "Layout: Blurred", "Export at 1080p"); **Save Recipe** adds it to My Recipes |
| Another clip, **...**, **Apply A Recipe**, **Apply** on yours | "<name> applied." with **Undo**; Ctrl+Z takes the whole recipe back in one step |
| A recipe whose caption style was deleted, applied | "This recipe's caption style was deleted. We used Clean instead." |
| **Brand Kit** tab | One card per Studio brand kit: Logo On Video (a corner, greyed with a sentence when the kit has no logo), Caption Style, Intro (**Upload Video**, at most 5 s), Outro (**Card** with a closing line, or **Video**) |
| Upload a 3 s video as the intro | "Getting your video ready", then its name, "3 seconds" and **Remove**; a video over 5 s is refused with a sentence |
| In a clip, **Layouts**, **Brand Kit**, pick the kit | **Intro** and **Outro** switches; the timeline's first bar says **Intro** and plays the intro video; "The closing card shows in Preview Export." |
| Switch **Intro** off | The Intro bar goes; one Ctrl+Z; the kit and the closing card stay |
| **Clip Setup**: pick **Social Edit** and a brand kit, **Find Clips** | The summary reads the recipe back; every clip opens with captions, a hook title, the silences cut, the intro first and the closing card; a Split or Gameplay recipe moves the Camera box to the face on first open |
| Change a control the recipe set (Horizontal) | **Save As Recipe** appears under the tiles, and the summary shows your change |
| A video page, **Auto-Edit Video** | The recipe Select (Auto-Edit Talking Video first) and the price ("Auto-Edit Video (2 AI Minutes)", or "No AI minutes needed" when the video was listened to) |
| Press it | "Listening to what is said", "Applying your recipe", "Your clip is ready.", then the editor opens on one clip of the whole video, cleaned and captioned; the same again needs no AI minutes |
| **Auto-Edit Video** on "Listening Fails [simulate:listen-fail]" | The job fails with "We could not finish listening to this video. Your AI minutes were given back.", the sentence stays in the dialog, no clip is made, and the charge is reversed in the ledger |

A recipe holds settings only (no words, no pictures). Starters have fixed ids (`starter-...`) and no database row. A brand kit's intro or outro plays its own video's light copy, so it is never "more of the video" for the clip. Cards (the closing card) sit outside the clip's own time: the stored clip length includes them, the editor's preview does not draw them, Preview Export does.

**Montage And Batch Export (Module 11).** The Clips tab gains tick boxes and a bulk bar. Restart the API and the Node worker after pulling this module (a migration adds the `MONTAGE` clip type; run `npm run migrate:deploy --workspace=packages/db` and `npm run db:generate` first). `CLIPS_RENDER_SLOTS` (default 2) is how many exports run at once across all workspaces.

| Do this | What you should see |
|---|---|
| Clips tab, hover a card | A tick box top left; once one is ticked they all show |
| Tick one, Shift-click a third | The two and the one between are ticked; the bar says "3 Selected" with Export All, Create Montage, Hide, Delete |
| **Export All**, pick 720p, **Export** | The list: one clip "Rendering", the others "Waiting for its turn" (one export per workspace at a time) |
| Close the dialog | An "Exporting 3 Clips" chip in the page's top row; it reopens the list and survives a reload |
| Wait for the end | The bell has ONE notice, "3 clips are ready." (no notice per clip); a failed one reads "2 clips are ready, 1 could not be exported." |
| Export All with a quality the plan does not allow | That clip says which quality it will use instead; a clip already exported at that quality says so and makes no job |
| Tick two clips of different shapes, **Create Montage** | The list (drag or the arrow buttons to order, the length of each and the total), Between Clips (Cut, Fade), an optional title, Shape, "Changes you make to these clips later will not change the montage." |
| Pick a shape, Fade, a title, **Create** | The editor opens on one clip: the timeline shows each original clip's name at its first part and a mark at each fade; the total is 0.3 s shorter per fade |
| Play across a join | The picture mixes for 0.3 s; captions hand over at the middle |
| Pick a part of the second clip, **Layouts**, Blurred | Only that clip's parts change ("These layouts change ..."); Ctrl+Z puts it back |
| **Captions** tab on a montage | "A montage keeps the captions of its clips. Change them in a clip, then make the montage again." (style, size and place still work) |
| Export the montage at 720p | The file opens with the title card (2 s), then the clips; at a fade both pictures show mixed; it is 0.3 s shorter per fade |
| Tick two clips, **Hide**; on Hidden tick them, **Unhide** | They move to Hidden and back |
| Tick two clips, **Delete** | "Delete 2 Clips?" in red; exported files stay in Media |
| Remove a video a montage plays (Module 19's removal) | An unexported montage goes with it; an exported one stays exported but cannot be opened: "One of the videos in this montage was removed." |

A montage is a snapshot: it copies the clips' parts, layouts, text, sounds, bleeps and captions when it is made. Preview Export never waits in the queue.

```bash
npx jest --config packages/media-tools/jest.config.js montage-parity   # cut and fade montages on the real FFmpeg
```

**More Sources And Platforms (Module 12).** The link box now reads sites beyond YouTube, Twitch and Kick. Run `npm run migrate:deploy --workspace=packages/db` and `npm run db:generate` (a migration adds the new sites to `ClipPlatform`), then restart the API and the Node worker. Every new site answers from recorded fixtures under `CLIPS_SIMULATION`; no real site is ever fetched.

`CLIPS_PLATFORMS` (unset) switches on twelve sites: YouTube, Twitch, Kick, Vimeo, Rumble, Dailymotion, Loom, X, Facebook, LinkedIn, Reddit and Pinterest. TikTok, Instagram, Zoom, Dropbox and Threads are built but off (Threads has no yt-dlp reader yet, so it may be listed only with `CLIPS_SIMULATION=true`). To try an off site, list it, for example `CLIPS_PLATFORMS="youtube,twitch,kick,tiktok"`, and restart the API.

The simulation links (paste them in the link box):

| Link | Answers |
|---|---|
| `https://vimeo.com/900000101` | A Vimeo card (the talk sample) |
| `https://vimeo.com/900000102` | "This video is private or needs a login..." (a password) |
| `https://rumble.com/v5sim01-postgear-sample-talk.html` | A Rumble card |
| `https://www.dailymotion.com/video/x9sim01` | A Dailymotion card |
| `https://www.loom.com/share/5151515151515151515151515151515a` | A Loom card (the two speakers, 4 minutes) |
| `https://x.com/postgear/status/1900000000000000001` | An X card |
| `https://x.com/postgear/status/1900000000000000002` | "This post has more than one video. Paste a link to a post with just one." |
| `https://x.com/postgear/status/1900000000000000003` | Not found (no video in the post) |
| `https://www.facebook.com/watch/?v=9000000000000001` | A Facebook card |
| `https://www.facebook.com/watch/?v=9000000000000002` | Private (registered users only) |
| `https://www.facebook.com/reel/9000000000000003` | A Facebook card, kind Short |
| `https://www.linkedin.com/posts/postgear-samples_a-sample-video-activity-7200000000000000001-SimA` | A LinkedIn card |
| `https://www.reddit.com/r/postgear/comments/1simvd1/a_sample/` | A Reddit card (the 10 minute stream sample) |
| `https://www.reddit.com/r/postgear/comments/1simvd2/a_sample/` | Private (an over 18 post) |
| `https://www.reddit.com/r/postgear/comments/1simvd3/a_sample/` | More than one video (a gallery) |
| `https://www.pinterest.com/pin/900000000000000001/` | A Pinterest card |
| `https://www.threads.com/@postgearsamples/post/SimThread01` | Paused while Threads is off; a Threads card once listed (simulation only) |
| `https://zoom.us/rec/share/SimZoomRecording0001` | Paused while Zoom is off; a Zoom card once listed |
| `https://www.tiktok.com/@postgearsamples/video/7300000000000000001` | "TikTok links are paused for now. You can upload the file instead."; a TikTok card once listed |
| `https://www.instagram.com/reel/SimReel0001/` | Paused while Instagram is off; a card once listed |
| `https://www.dropbox.com/scl/fi/simdropbox0001/talk.mp4?rlkey=simkey000000001&dl=0` | Paused while Dropbox is off; a card once listed |
| `https://riverside.fm/studio/anything` (or `streamyard.com`) | "Riverside links cannot be read. Download the recording and upload it instead." |
| `https://www.bilibili.com/video/BV1xx` | "We cannot read links from this site yet. You can upload the file instead." |

The help line under the field names the first five sites that are on and "and more"; the whole list is in its tooltip. Browse buttons stay YouTube, Twitch and Kick (the only sites with channels).

**Google Drive.** Under `CLIPS_SIMULATION` the home shows **Pick From Google Drive** under the drop area. It opens a stand-in picker with four made-up files (no Google address is reached): Sample Talk and Sample Stream come in like uploads (copied from the local samples); Not Shared With You answers "Google Drive did not let us read this file. Pick it again from Google Drive."; A Google Doc answers the not-a-video sentence. The token is sealed in the job and wiped as soon as the file is stored (and when the job ends). Check in the database that it is gone:

```bash
docker exec postgear_postgres psql -U postgres -d postgear_db -c "select id, input->'origin'->'drive' from \"ClipJob\" where input->'origin' ? 'drive' order by \"createdAt\" desc limit 3;"
```

For the real picker see `docs/sprint-12/clips-keys-guide.md`, Recipe 3 (`GOOGLE_DRIVE_PICKER_KEY`, `GOOGLE_DRIVE_APP_ID`, with `CLIPS_SIMULATION="false"`). Without the keys the button is absent.

```bash
npx jest --config packages/video-engine/jest.config.js sites            # every link shape and canonical address
npx jest --config packages/media-tools/jest.config.js sites drive       # the probe and error mappers, args, Drive
```

**Publisher Upgrades (Module 13).** Posting times became posting slots, the composer gained Next Available and Pick A Random Time, and a post with a video can be marked Made With AI. Run `npm run migrate:deploy --workspace=packages/db` and `npm run db:generate` (a migration adds a window and weekdays to every existing posting time, and `Post.madeWithAi`), then restart the API and the Node worker. Keep `PUBLISH_SIMULATION=true` (exported for the host worker too): nothing is posted for real.

- **Posting slots.** Channels, a channel's menu, **Edit Posting Times** opens **Manage Posting Time Slots**: each row is a time, a window (Exact, Within 5, 15 or 30 Minutes) and seven weekday chips (the last one on stays on). **Add Another Time** adds a row. The card under the channel name says how many posts a week the slots make. Every existing channel reads as before (every day, exact).
- **Shuffle Times.** In the same dialog: the slider asks how many posts a week (1 to 35, "21 a week"), the preview lists the suggested slots ("around 6:05 PM, Every day"), **Shuffle Again** gives another set, **Use These Times** fills the rows (still to be saved). 10 a week is one slot every day plus one on Tuesday, Wednesday and Thursday. **Back To Suggested Times** reopens it where you left it.
- **Next Available.** In the composer footer, beside the date. It sets the time to the first chosen channel's next free slot, at a natural minute inside the slot's window (never on a five-minute mark), on a weekday the slot runs. Save one post, open a new one, press it again: the second gets the next slot, a different minute. A channel with no posting times leaves the button off with "Set posting times for this channel first." and an Open Channels link. If the slot is taken between the press and the save, the save moves the post and says "That slot was just taken".
- **Pick A Random Time.** Open the date, the **Pick A Random Time** tab: Morning (6:00 to 11:59), Noon (12:00 to 13:59), Afternoon (14:00 to 17:59), Evening (18:00 to 21:59) each pick a random minute on the chosen day; pressing again gives another. "Scheduled On This Day" lists the first channel's posts that day, and a part already past today says so.
- **Made With AI.** Attach a video and the footer shows **Made With AI**. Its switch carries the help line, and one line for each chosen platform with no label ("LinkedIn has no label for AI. Say it in your caption if you need to."). YouTube and both Instagrams have a label; X, LinkedIn, Threads, Facebook (its Page video, not a Reel), TikTok and Pinterest do not. A clip with a made-up voice sent to the composer starts with it on (the Send dialog says why). Post Now to Instagram with it on, then:

```bash
docker exec postgear_postgres psql -U postgres -d postgear_db -c "select \"madeWithAi\", \"releaseURL\" from \"Post\" where \"madeWithAi\" order by \"createdAt\" desc limit 3;"
```

The stand-in publisher ends the link with `?ai=label` where the real platform would get its label (YouTube `status.containsSyntheticMedia`, Instagram `is_ai_generated`).

`GET /channels/next-slot?channelIds=a,b&timeZone=Europe/London&seed=x` answers the first channel's slot, each channel's own, and `windowMinutes`; a channel with no times answers `at: null`. `POST /v1/posts` takes `madeWithAi` too; `GET /v1/channels` still carries no posting times.

```bash
npx jest --config packages/automation/jest.config.js posting-slots      # slots, jitter, weekdays, Shuffle, random time
npx jest --config apps/api/jest.config.js channel-next-slot channels.schema posts.schema
npx jest --config packages/social-core/jest.config.js ai-label          # each provider's label field
npx jest --config apps/web/jest.config.js posting-slots publisher-upgrades
```

Simulated translation writes stand-in words in the chosen language; a line that holds `[simulate:translate-short]` makes the model answer one line short, which is refused and the AI minute given back.

```bash
npm run clips:regression                              # every version 1 clip still exports as recorded (real FFmpeg)
npm run clips:captions:stills -- --out caption-stills # one still per style in English, Tamil and Hindi, to look at
npx jest --config packages/media-tools/jest.config.js caption-parity   # pixel checks on the real FFmpeg
```

On a machine with no FFmpeg of its own, point `FFMPEG_PATH` and `FFPROBE_PATH` at `infra/docker/worker/bin/ffmpeg` and `ffprobe` first.

Automated checks:

```bash
npm run test --workspace=@postgear/media             # pytest
npm run lint --workspace=@postgear/media             # Ruff
npm run typecheck --workspace=@postgear/media        # mypy, strict
npm test --workspace=@postgear/media-contract        # the contract: drift, fixtures, keys
MEDIA_PY_LIVE_TEST=1 npx jest --config apps/worker/jest.config.js media-py.live   # a TypeScript workflow calls Python (needs Docker and dev:media)
```

### The media library
Open **<http://localhost:3000/seed-demo-org/media>**.

- Upload an image. It should appear as a tile.
- Upload something that is not an image or video. It should be rejected.
- Open an image and press **Download**: it saves under its library name, with
  the extension of what is stored (an uploaded `.webp` saves as `.jpg`).
  Videos have no Download; their player's menu saves them. Pressed by
  keyboard, the button keeps focus while it downloads.
- Delete one.
- With `STORAGE_PROVIDER="local"`, files are stored in `apps/api/uploads/`.

---

## 6. Connect LinkedIn (recommended first real test)

Free, usually instant, and it exercises the real connect flow end to end.

### 6a. Create the LinkedIn developer app

1. **LinkedIn Page.** The app must be associated with a LinkedIn Page that you
   administer. If you have none, create a free one at
   linkedin.com/company/setup/new (any name will do).
2. Go to **<https://www.linkedin.com/developers>** and click **Create app**.
   Name it `postgear-local`, choose your Page, upload any logo, and accept the
   terms.
3. Open the **Auth** tab. Under **Authorized redirect URLs for your app**, add
   this exactly (no trailing slash, `localhost` not `127.0.0.1`):

   ```
   http://localhost:3001/channels/connect/linkedin/callback
   ```

4. Open the **Products** tab and request:
   - **Sign In with LinkedIn using OpenID Connect** (gives `openid`, `profile`)
   - **Share on LinkedIn** (gives `w_member_social`)

   Both are normally self-serve and approve immediately.

   *Skip "Community Management API". That is only for company pages
   (`linkedin-page`), needs approval, and is not required for personal posting.*
5. Back on the **Auth** tab, copy the **Client ID** and the **Primary Client
   Secret**.

### 6b. Add the keys

In `.env`:

```env
LINKEDIN_CLIENT_ID="your-client-id"
LINKEDIN_CLIENT_SECRET="your-client-secret"
```

Restart the API (Ctrl+C, then `npm run dev:api`).

### 6c. Connect in the browser

1. Open **<http://localhost:3000/seed-demo-org/channels>**.
2. Click **Connect a channel**. **LinkedIn** should be a normal button. If it is
   greyed out with a "not configured" reason, the API did not pick up the keys.
3. Click **LinkedIn**, review the consent screen and click **Allow**.
4. You come back to PostGear with a green banner, **"<your name> is connected."**,
   and a new LinkedIn card with your name and avatar.

   (The dialog also lists **LinkedIn Page**. Ignore it, since it needs the
   approval skipped above.)

### 6d. Things to try once connected

- **Reconnect with a different account.** Kebab (⋮) → **Reconnect**, then sign
  in as a *different* LinkedIn user. PostGear must refuse with *"That is a
  different account…"* and keep the original. Doing it again with the same
  account should say *Channel reconnected*.
- **The composer with LinkedIn selected.** Check the LinkedIn preview and the
  3,000-character limit.
- **Publish one real post** (section 7).

> **LinkedIn token note.** Without Marketing Developer Platform approval,
> LinkedIn tokens last about 60 days with no refresh. PostGear then shows the
> channel as expiring and asks you to reconnect. That is expected, not a bug.

### If it goes wrong

| What you see | Cause |
|---|---|
| LinkedIn greyed out | Keys missing, or the API was not restarted after editing `.env` |
| LinkedIn error about the redirect URL | The URL in the LinkedIn Auth tab does not match exactly |
| "Couldn't connect" banner back in PostGear | Check the API terminal for the reason. Often the **Share on LinkedIn** or **Sign In** product is not approved yet. |
| `unauthorized_scope_error` on LinkedIn | A required product was not added in the Products tab |

---

## 7. Publish one real test post (API only)

The UI cannot publish yet, but the API can. This posts **publicly to the
connected account**, so use a test account or delete the post afterwards.

Open a **third** PowerShell window:

```powershell
$base = "http://localhost:3001"
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession

Invoke-RestMethod "$base/auth/login" -Method Post -WebSession $s `
  -ContentType "application/json" `
  -Body '{"email":"demo@postgear.local","password":"DemoPassword123!"}' | Out-Null
Invoke-RestMethod "$base/orgs/seed-demo-org/switch" -Method Post -WebSession $s | Out-Null

# list channels and find the id of your REAL LinkedIn one (the seeded ones are fake)
Invoke-RestMethod "$base/channels" -WebSession $s | ConvertTo-Json -Depth 5
```

Copy your LinkedIn channel's `id`, then:

```powershell
$id = "paste-the-channel-id-here"
Invoke-RestMethod "$base/channels/$id/test-post" -Method Post -WebSession $s `
  -ContentType "application/json" `
  -Body '{"message":"Hello from PostGear, testing locally"}'
```

The response should contain a link to the post. Open it to see it on LinkedIn.

**Check the token is stored encrypted:**

```powershell
docker exec postgear_postgres psql -U postgres -d postgear_db -c 'SELECT "providerIdentifier", left(token, 30) FROM "Integration";'
```

Your real row should show unreadable ciphertext, never a readable access token.

---

## 8. Optional: YouTube (free, connect flow only)

Google accepts localhost, so no tunnel is needed.

1. Go to **<https://console.cloud.google.com>**, create a project, and enable
   **YouTube Data API v3** (APIs & Services → Library).
2. **OAuth consent screen**: choose **External**, leave it in **Testing**, and
   add your own Google account under **Test users**.
3. **Credentials → Create credentials → OAuth client ID → Web application.**
   Add this under *Authorized redirect URIs*:

   ```
   http://localhost:3001/channels/connect/youtube/callback
   ```

4. Put the keys in `.env` and restart the API:

   ```env
   YOUTUBE_CLIENT_ID="....apps.googleusercontent.com"
   YOUTUBE_CLIENT_SECRET="..."
   ```

5. Connect it from the Channels page. You will see an **"unverified app"**
   warning. That is normal in Testing mode, so click through it.
6. After authorising, YouTube asks you to **finish setup** by picking the
   channel. Your Google account must own a YouTube channel, or PostGear says so.

A real upload needs a video and is not worth testing from the UI yet.

---

## 9. Troubleshooting cheat-sheet

| Symptom | Likely cause |
|---|---|
| `docker compose up` errors about the engine | Docker Desktop is not running yet |
| Port 5432, 6379 or 9000 already in use | Another Postgres, Redis or MinIO is running |
| API will not start | Read the first error. It names the bad `.env` variable. See section 2. |
| Website loads but login fails | The API is not running on 3001 |
| Platform greyed out in the connect dialog | Keys not read. Restart the API. |
| Redirect or callback error on the platform | The registered URL must exactly equal `<API_URL>/channels/connect/<provider>/callback` |
| "Your connection has expired" | Token invalid. Use **Reconnect**. |
| AI page says "not configured" | Neither `AI_SIMULATION="true"` nor a real `OPENAI_API_KEY` is set (the `.env.example` placeholder does not count). Restart the API after editing. |
| AI page says you are out of credits | The demo workspace's monthly allowance (100) is used up; re-seed with `npm run db:seed` to reset the ledger. |
| Billing page says "not configured" | Neither `BILLING_SIMULATION="true"` nor a real `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` pair is set (the placeholders do not count). Restart the API after editing. |
| Checkout stays on "Activating…" | In Stripe mode, `stripe listen` is not running or forwards to the wrong port; the API never received the event. In simulation, the API log says what the synthetic event did. |
| A webhook URL is refused as private | `WEBHOOK_ALLOW_PRIVATE_URLS` is not `"true"`: the guard refuses localhost on purpose. Set it and restart the API **and** the worker. |
| Webhook deliveries stay Pending | The worker is not running (deliveries are Temporal workflows). Start it; the maintenance reconcile picks up anything older than a minute. |
| `npm run test:e2e` sign-ins fail with "Too many requests" (429) | The API was started with `npm run dev:api` or `npm run dev`. Use `npm run dev:api:e2e`: section 3a. |
| `/v1` answers 429 | The per-key ceiling (`API_RATE_LIMIT_PER_MIN`, 60/min) or the per-address one (`RATE_LIMIT_PER_MIN`, 300/min). Wait for `Retry-After`. |
| No notification email in the console | The member's preference is off (Settings → Notifications), or `SMTP_HOST` is set and mail went to a real server. The dispatcher's log line names the row and the outcome. |
| Studio Export says "Export is not available right now" | Playwright's Chromium is not installed where the API runs. `npx playwright install chromium`, then export again; the API console prints the same hint once. |
| Extract From Website says "That address is not public." | The address is localhost, a private network or a cloud metadata address, refused on purpose. Use a public website. |
| Extract From Website says "That is a lot of websites at once." | Five extractions a minute per workspace. Wait a minute. |
| Studio text still looks like the old Sora or Playfair | The browser kept Sprint 9's font files (cached for a week). Hard-refresh the page (Ctrl+Shift+R). |
| No premium lock anywhere in the Studio | The demo workspace is on a paid plan. Switch to **PostGear Second Org**, which has none. |
| Use My Location does nothing, or says location is blocked | Browsers only offer a position on HTTPS or on `localhost`. On a LAN address use the city search instead. If it says blocked, allow location for the site in the browser's address bar. |
| Discover says "Try again in a moment." when finding a place | Five place lookups a minute per workspace, and OpenStreetMap allows one request a second for the whole deployment (it answers 429 past that). Wait a minute. |
| Discover says "Finding places is turned off on this PostGear." | `DISCOVER_GEOCODER="off"`. Set it to `"nominatim"` and restart the API. |
| The Videos tab says "Trending videos are not set up for this PostGear." | `YOUTUBE_API_KEY` is empty. It is optional and free (a Data API key, not the OAuth client used for publishing). |
| Discover shows no Simulated sticker, or shows real headlines | `DISCOVER_SIMULATION` is not `"true"` in the root `.env`, or the API was not restarted. The `discover.boot` log line says which. |
| Read says "We could not open this story here." on every News story | `DISCOVER_LINK_DECODE="false"`, or (for real) Google changed the page the link decoder reads. Open still works. |
| Read says "Try again in a moment." | Ten reads a minute per workspace, two pages at a time, and a page that took the article finder too long uses up that workspace's minute. Wait a minute. |
| Download PDF says "Export this design first, then download it." | PDF and Download All use the last export. Export, then download. |

---

## 10. Clean up

```powershell
# stop the API and website with Ctrl+C in their terminals, then:
docker compose stop        # keeps your data
# docker compose down -v   # also deletes ALL local data (migrate and seed again afterwards)
```

To revoke PostGear's access to your LinkedIn account, use **Disconnect** on the
channel card. It revokes the token where the platform supports it.

---

## Appendix: X (parked until you can pay)

X is pay-per-use, so it is left out of the free path. When you are ready, the
setup is:

- Create the app at <https://developer.x.com>. Under *User authentication
  settings* choose **OAuth 2.0**, **Read and write**, and type **Web App,
  Automated App or Bot**.
- Callback URL: `http://localhost:3001/channels/connect/x/callback`.
- Use the **OAuth 2.0 Client ID and Client Secret** (not the API Key or Bearer
  Token) in `X_TWITTER_CLIENT_ID` and `X_TWITTER_CLIENT_SECRET`.
- Add a small credit balance in the console's Billing section. Check
  [X's pricing page](https://docs.x.com/x-api/getting-started/pricing) for the
  current rates and any new-developer credit offers.

Full details are in section 3 of [social-platform-setup.md](social-platform-setup.md).
