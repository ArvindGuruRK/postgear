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
| Connect a real social account (OAuth) | |
| Channel card, reconnect, "wrong account" guard, disconnect | |

Since Sprint 5 the queue actually publishes — through the **worker** process
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

If you prefer one process per terminal — for example to restart only the
worker — the three pieces are:

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
to a stand-in. Without a worker running, nothing publishes — the Calendar and
Queue pages show "No worker running" in their status pill so you can tell.

**Terminal 3: website (port 3000)**

```powershell
npm run dev --workspace=@postgear/web
```

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
  shows "Retrying · attempt 1 of 5", then attempt 2 after 30 seconds, then
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
you do not have to delete them — but without `AI_SIMULATION="true"` the AI page
will say it is not configured.

Open **<http://localhost:3000/seed-demo-org/ai-copilot>**.

**Generate a post.** Type a topic ("three things we learned launching our
newsletter"), pick a voice (*Personal* writes as "I", *Company* writes as "we"),
a format, optionally the hero image, and at least one channel. The button says
what it costs ("Generate · 5 credits", 15 with an image). Watch the stage
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
do I have connected?"* — the assistant calls its `list_channels` tool (you see
the tool activity row) and answers with the three seeded channels. Then try
*"Write a LinkedIn post about our spring sale and save it as a draft"* and
*"Generate an image of a sunrise over a city skyline"*. A drafted post appears
with an **Open in composer** link; a generated image appears in the media
library. Each message costs 1 credit; the tools that generate cost 5 and 10.

**Credits.** The meter at the top shows the cycle's usage (the seed starts the
demo workspace at 23 of 100, the STANDARD tier's monthly allowance) and the
reset date. Use them up — or temporarily lower the allowance in
`apps/api/src/modules/ai/credits/credits.policy.ts` — and the Generate button
disables with an explanation; the API answers **402**. Credits are charged
before a generation and refunded when it fails before producing anything.

Without `AI_SIMULATION`, with a real `OPENAI_API_KEY`: everything above is the
same, except the copy is written by `gpt-4.1-mini` (set `AI_MODEL` to change
it), images by DALL-E 3, and research runs only when `TAVILY_API_KEY` is set —
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
  Switch the range to **7** or **90** — the URL follows (`?range=7`), so a
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
chromium` — the e2e suite already installed it) and a plain HTML fetch
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
  refuses before fetching anything — private and internal addresses are
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

### The media library
Open **<http://localhost:3000/seed-demo-org/media>**.

- Upload an image. It should appear as a tile.
- Upload something that is not an image or video. It should be rejected.
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
