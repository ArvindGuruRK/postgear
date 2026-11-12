# 4-Day Staging Plan: Investor Proof Of Concept 🚀

Written on 2026-11-12. Written for: Arvind. Companion documents:
[01 Problems And Solutions](01-problems-and-solutions.md), [03 Env Setup Guide](03-env-setup-guide.md), [04 Security Review](04-security-review.md), [05 Hosting And Costs](05-hosting-and-costs.md).

---

## 1. Goal, Scope And Honest Limits 🎯

**Goal.** A staging site at `postgear-staging.rkay.in` that an investor can open, sign up on, connect real social accounts, create and schedule posts, see them publish for real, use AI, pay with a Stripe test card, and look at Studio, Workflows and SEO. Production is not touched.

**Decisions already made (from you):** staging is the demo, all 7 platforms wanted, Stripe test mode, Resend for email, CarouselClick rights confirmed, Discover Module 10 stays in your other window, API on a sibling subdomain, Railway is the candidate host.

### 1.1 What "All 7 Platforms Live" Can Honestly Mean In 4 Days

Platforms control public access, not us. Here is what is achievable with **your own accounts in each platform's development mode**, based on the research of 2026-11-12 (some points come from secondary sources and are marked):

| Platform | Real connect and publish by Day 3? | What the investor sees | What blocks "public to everyone" |
|---|---|---|---|
| X | Yes | Real tweet on your account | Nothing, but pay-per-use credits cost money (cents). Avoid links in test text ($0.20 each) |
| LinkedIn (personal profile) | Yes | Real post on your profile | Nothing |
| LinkedIn Page | **No, not in 4 days** | Shown as "Pending approval" | Community Management API is for registered organizations only and has no published review time |
| Facebook Page | Yes (your Page, you are app admin) | Real post (public visibility in dev mode is unconfirmed, test on a throwaway Page first) | Meta App Review plus business verification for other people's accounts |
| Instagram | Yes (Business or Creator account linked to your Page) | Real post | Same Meta review |
| YouTube | Yes (testing mode, your test user) | Real upload | Testing tokens expire every 7 days; reconnect before the demo. Public use needs Google verification |
| TikTok | Yes, but **private only** | Post exists but only you can see it | TikTok content audit, no published time |
| Pinterest | Yes, but **visible only to you** (Trial sandbox pins) | A pin you can see in your own account | Standard access review |

**What I will tell investors honestly (suggested wording):** "All seven integrations are built and working on our own accounts. Public rollout for TikTok, Pinterest and LinkedIn Pages follows each platform's app review, which is in progress." That is true, and it is a normal startup position. Do not claim more.

### 1.2 Two Things That Could Break The Schedule

1. **Bundling the API and worker (P0-1).** Confirmed today: plain Node cannot load the shared packages. Until fixed, nothing can run on a server. Budget a full half day.
2. **Stripe in India is invite-only.** If your invite does not arrive, billing cannot run for real on staging, because the API refuses simulation in production mode. See section 6 for the options.

---

## 2. How We Work (Rules For The 4 Days) 📏

1. **Your Discover Module 10 session keeps running.** I will not touch its uncommitted files. To avoid collisions I recommend a **separate git worktree** off the last commit (`c498c4b`) on a new branch `staging-launch`. `apps/api/src/config/env.ts` and several other files are modified in your other window, so editing them in the same folder would collide.
2. **Staging runs with `NODE_ENV=production`.** The code only accepts `development`, `test` or `production`, and every simulation flag is refused in production. So staging needs real keys for everything it shows. This is a feature: staging then behaves exactly like production will.
3. **No production environment is created yet.** In Railway we create the `staging` environment only. The `production` environment is created later, empty.
4. **Secrets never go in git.** All values live in Railway's variables and in your password manager.
5. **I only commit or push when you say so.**
6. **Two tracks run in parallel every day:** Track A is code and deploy work (I do it, you review). Track B is accounts, keys and approvals (only you can do it, I give exact steps).

---

## 3. Day 0: Tonight, About 2 To 3 Hours, Starts The Review Clocks ⏱️

Nothing here needs code. Several approvals take days or weeks, so their clocks must start first.

| # | Task | Why now | Detail |
|---|---|---|---|
| 0.1 | Move `rkay.in` DNS to Cloudflare (free) | R2 custom domain, DNS control, DDoS cover | Add the site, copy every existing record, then change nameservers at your registrar. Check email and any live sites afterwards |
| 0.2 | Create accounts: Railway, Resend, OpenAI (billing + spend cap), Tavily, Sentry, Open PageRank, Cloudflare R2 | All free to open | Use one business-style email (not a personal inbox) for all of them so reviewers see consistency |
| 0.3 | Udyam registration (free, online) | Gives you a registered sole proprietorship. Helps LinkedIn, Meta verification and Stripe India | Names must match exactly across Udyam, Meta, LinkedIn and Stripe |
| 0.4 | Request a Stripe India invite | Longest unknown wait | Do it tonight even if you are unsure |
| 0.5 | Create (not submit) the developer apps: X, Meta, LinkedIn, TikTok, Pinterest, Google Cloud | Gets IDs ready; submission needs the public policy URLs from Day 1 | See [03 Env Guide, section 6](03-env-setup-guide.md) for each |
| 0.6 | LinkedIn: create a LinkedIn Page for the company if you do not have one | A Page is required to create the app | Do it tonight, it can take a day to verify |
| 0.7 | Choose and write down the company name, support email and address you will use everywhere | Reviewers cross-check | One source of truth |

**Rule:** Day 0 ends when you can say "every account exists and I have saved its login in my password manager".

---

## 4. Day 1: Make It Run On A Server 🏗️

### Track A (code and deploy, me)

| Time | Task | Done when |
|---|---|---|
| Morning | Create worktree and branch `staging-launch` from `c498c4b`. Merge sprints 9, 10 and 11 (committed work only) so one branch holds everything | `npm run validate` result recorded. The 4 known failing image tests are fixed or their timeouts raised |
| Morning | **P0-1:** bundle API and worker with `tsup`/`esbuild`, keep native modules external (`argon2`, `sharp`, `playwright`), handle the Discover reader worker file | `node dist/main.js` boots the API against local Docker services |
| Midday | **P0-2:** Dockerfiles for api (Debian slim, Playwright Chromium), worker, web (`output: standalone`, `NEXT_PUBLIC_*` as build args) | All three images build in CI and locally |
| Afternoon | **P0-3:** `COOKIE_DOMAIN` support (session cookie, org cookie, clears on logout) | Login works with web and API on sibling hostnames in a local two-host test |
| Afternoon | **P1-3:** stricter production env checks (https URLs, Redis, S3, not-placeholder `JWT_SECRET`, SMTP) | Booting with the example `.env` in production mode fails with a clear list |
| Afternoon | Railway project: services web, api, worker, Postgres, Redis, Temporal; private networking; staging environment; pre-deploy `prisma migrate deploy` | First deploy succeeds, `/health` returns OK |
| Evening | Seed guard (no seeds without an explicit flag), remove or gate `test-post` endpoint | Confirmed in code |

### Track B (you)

| Task | Detail |
|---|---|
| Domain records | Point `postgear-staging.rkay.in` (web) and `api.postgear-staging.rkay.in` (API) to Railway (see [05 Hosting, section 5](05-hosting-and-costs.md)) |
| Resend | Add sending domain, add the DNS records, wait for "Verified" |
| R2 | Create bucket `postgear-staging-media`, connect custom domain `media-staging.rkay.in` (TikTok needs a domain it can verify), create an API token |
| Google Cloud | Consent screen (External, Testing), web client for login |
| Write 2 pages' content | Privacy Policy and Terms. I draft the pages in code on Day 2; you decide company name and contact details now |

### Day 1 Exit Test
Open `https://postgear-staging.rkay.in`, register, receive a real activation email from Resend, log in, see the empty dashboard. If this works, the foundation is done.

---

## 5. Day 2: Real Services, Security Must-Fixes, Public Pages 🔐

### Track A

| Task | Detail |
|---|---|
| **Security must-fixes** | H-1 session revocation, H-2 OAuth pre-hijack, M-1 dependency upgrades (Next.js, express stack, multer, nodemailer, sharp, zod), M-2 web security headers, M-5 production `JWT_SECRET` check. Details in [04](04-security-review.md) |
| Public pages | Landing, Pricing (reads the real plan table), Terms, Privacy, Data Deletion, Contact; `robots.txt`, `sitemap`, Open Graph metadata, `noindex` on app routes; link the sign-up terms checkbox |
| Wire real services | OpenAI + Tavily, Resend (SMTP), R2 storage, Sentry. Then switch the staging env to real values and redeploy |
| AI model check | Confirm `gpt-4.1-mini` and the image model in `env.ts` still exist at OpenAI (one secondary source says they are being retired; verify on OpenAI's page). Change the default if needed |
| Trial limits | P1-4: one trial per user, max workspaces per user |
| Customer-friendly wording | P1-5: remove env-variable names from user-facing cards |

### Track B

| Task | Detail |
|---|---|
| Submit review requests that need the public URLs | LinkedIn Community Management (Development tier), Meta business verification. Public Privacy and Terms URLs now exist |
| Stripe | If invite arrived: test keys, webhook, steps in section 6 |
| Connect first real platforms | X and LinkedIn personal (quickest). Register redirect URIs `https://api.postgear-staging.rkay.in/channels/connect/<provider>/callback` |

### Day 2 Exit Test
A real AI post is generated (credits deducted), a real tweet and a real LinkedIn post publish from the staging calendar, and `npm audit` shows no Critical.

---

## 6. Stripe Test Mode: Step By Step (Finish Inside 2 Days) 💳

**Facts to know first (researched 2026-11-12):** In India, Stripe is invite-only for live accounts, and a business must be a registered entity (sole proprietorship counts) to go live. Whether test mode works before the invite arrives is unconfirmed. Our code uses inline `price_data`, so **no products or prices need to exist in the Stripe dashboard**.

**Steps once you can open the dashboard:**
1. Stripe Dashboard, switch to **Test mode** (toggle top right).
2. Developers, API keys: copy `pk_test_...` and `sk_test_...`.
3. Developers, Webhooks, Add endpoint:
   - URL: `https://api.postgear-staging.rkay.in/billing/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`
   - Copy the signing secret `whsec_...`.
4. Settings, Billing, Customer portal: configure and save in test mode (so "Manage billing" works).
5. In Railway (staging api service) set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; in the web service set the build arg `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` and rebuild.
6. Test: pick a plan, pay with `4242 4242 4242 4242`, any future date, any CVC. Check the workspace plan flips and a `BillingEvent` row appears.
7. Also test `4000 0025 0000 3155` (needs 3D Secure) and `4000 0000 0000 9995` (declined).
8. Renewals and trial ending cannot be tested with Checkout alone; use Stripe **test clocks** if you want to show them.
9. Local development: install the Stripe CLI, run `stripe login`, then `stripe listen --forward-to localhost:3001/billing/webhook`. It prints a different `whsec_` for local use.

**If your invite does not arrive in time (you decide):**
- **Option A (recommended):** show billing screens with a clearly labelled "test checkout unavailable" state and demo the plan limits through a seeded Pro workspace. No fake claims.
- **Option B:** use a Stripe account opened by a trusted person or entity in a country with open sign-up, test keys only. No money moves in test mode.
- **Option C (not recommended):** relax the production guard for `BILLING_SIMULATION` on staging. This weakens a safety check that exists for a reason.

### Pricing Advice (my opinion, your decision) 💡
The current placeholders (29 / 49 / 99 / 199) are higher than the market for a young product. Benchmarks seen in secondary sources: Buffer about $6 per channel, Publer about $4 per account, Metricool from about $20, SocialBee $29, Hootsuite $99 per user.
AI cost is tiny: a typical post costs about $0.001, an image a few cents. So price on **channels and features**, and cap image credits.
For the pitch I suggest showing four tiers: **Free $0, Standard $15, Pro $35, Team $79**, with Ultimate hidden. Change `monthlyPriceCents` in `plans.ts`; yearly stays 10 months. These are opinions, not facts. Since no one pays during the demo, numbers matter only for how investors read your model.

---

## 7. Day 3: Connect Everything, Publish For Real, Fix What Breaks 🌐

This is the day we find the bugs that mock tests could not, because no provider has ever run live.

### Track A: In This Order

| # | Platform | Test | Notes |
|---|---|---|---|
| 1 | X | Text, then image, then thread | Credentials from Day 2 |
| 2 | LinkedIn personal | Text, then image | Already likely working |
| 3 | Facebook Page | Text, photo, video | Your Page, you are app admin |
| 4 | Instagram | Image, then carousel | Needs the R2 public media URL |
| 5 | YouTube | Short video upload | Use a test user. Re-authorise weekly |
| 6 | TikTok | Video, private | Domain `media-staging.rkay.in` must be verified in TikTok portal |
| 7 | Pinterest | Image pin to a board | Trial sandbox: visible only to you |

For each: connect, publish now, scheduled publish, check analytics sync, disconnect and reconnect. Record real API responses as test fixtures. Fix response-shape bugs as they appear. I expect 1 to 3 per provider.

### Other Day 3 Work
- **Security:** H-3 short-term Chromium mitigations (block WebSockets, no downloads, refuse `SEO_NO_SANDBOX` in production), M-3 gate test-post, M-4 robots matcher fix, M-7 OAuth connect binding, L-1 `email_verified` required.
- **Backups:** Railway Postgres snapshot schedule plus a manual dump to R2.
- **Demo workspace:** build a clean, believable workspace: sample brand, 20 scheduled posts, one published history, Studio designs, two workflows, an SEO audit. No seed accounts.
- **Discover decision:** see section 8.

### Track B
- Run each OAuth connect from the real UI with me watching the logs.
- Add yourself as the test user everywhere (Google, TikTok sandbox target, Meta roles).
- Start screen recordings of each flow (needed for Meta, TikTok, Pinterest and LinkedIn reviews).

### Day 3 Exit Test
A list on paper: for each of the 7 platforms, "published for real from staging: yes/no", with a link.

---

## 8. Discover In The Demo 🔭

You have not seen it locally yet, so the decision is open. My recommendation:
1. **Day 3 evening:** you spend 20 minutes in your local copy, Trends and News tabs only.
2. If it feels good: show **Trends and News only**, hide Read (it needs the packaging fix and the reader worker), and keep `DISCOVER_SIMULATION=false` (real free Google feeds; the code refuses simulation in production anyway).
3. If it feels unfinished: hide the Discover menu item behind a flag for staging. Nothing is lost.
4. The Google feeds say "personal, non-commercial use" in their own text. For an investor demo this is acceptable with attribution; for paid production it needs a decision (see doc 01, section 8).

---

## 9. Day 4: Harden, Rehearse, Freeze 🧊

| Task | Detail |
|---|---|
| Re-run `npm audit`, secret scan (gitleaks), `npm run validate`, Playwright e2e against staging | Zero Critical, no failing tests that we cannot explain |
| Remaining security items | L-2 to L-9 that are quick; document the rest as backlog |
| Cloudflare | Proxy the web host (orange cloud), a rate-limit rule on `/auth/*`, bot fight mode. API host stays DNS-only (two-level hostname certificate issue, see doc 05) |
| Monitoring | Sentry receives a test error; uptime check (free UptimeRobot) on `/health` and the web root; Railway usage alert and hard limit |
| Rehearsal | Walk the full demo script twice, timed |
| Fallback | Screen recording of the full flow, database snapshot, and the Hetzner Docker Compose fallback documented |
| Submit reviews | Meta App Review, TikTok audit, Pinterest Standard, LinkedIn Standard (when allowed), with the recordings from Day 3 |
| Freeze | No new features after Day 4 noon |

### Demo Script (about 10 minutes)
1. Landing page, pricing, sign up, activation email, onboarding.
2. Connect two platforms live (X and LinkedIn).
3. Composer with AI: generate post with image, preview per platform.
4. Schedule, show calendar and queue, publish now, show the real post.
5. Studio: carousel from template, send to composer.
6. Workflows: a published-post trigger sends a notification.
7. SEO analyzer on a real site.
8. Analytics page (real data only if synced; otherwise skip).
9. Billing: upgrade with the test card.
10. Close on the roadmap slide, with honest review statuses.

---

## 10. Cost For The Four Days And The Month After 💰

| Item | Cost |
|---|---|
| Railway (Hobby plan plus usage) | about $38 to $45 per month, up to about $90 if Chromium is heavily used |
| Cloudflare DNS, R2 | $0 at this size |
| Resend | $0 (3,000 emails per month, 100 per day) |
| OpenAI | a few dollars with a spend cap |
| Tavily, Sentry, Open PageRank | $0 (free tiers) |
| X API credits | a few dollars of prepaid credit |
| Stripe test mode | $0 |
| Udyam registration | $0 |
| **Likely total** | **about $45 to $60 for the first month** |

---

## 11. Risks And Mitigations ⚠️

| Risk | Likelihood | Mitigation |
|---|---|---|
| Bundling takes longer than a day | Medium | Do it first; fall back to `ts-node --transpile-only` as an emergency stopgap (slower, works) |
| Provider response-shape bugs on Day 3 | High | Time-box each provider to 90 minutes; drop TikTok and Pinterest to "connected, publishing private" if needed |
| Meta dev-mode posts not publicly visible | Medium | Test on a throwaway Page on Day 2 |
| Stripe invite not arriving | Medium | Options in section 6 |
| Railway outage on demo day (they had several in 2026, including an 8 hour one in May) | Low to medium | Recording, snapshot, VPS fallback |
| YouTube test token expires (7 days) | Certain | Reconnect the morning of the demo |
| Running out of time | Medium | Day 4 is a buffer; cut order: Pinterest, TikTok, Discover, Workflows polish |
| Your other window changes shared files | Medium | Separate worktree and branch; merge Discover Module 10 after the demo |

---

## 12. What I Need From You Before Day 1 Starts ✅

1. A "go" on the worktree and `staging-launch` branch approach.
2. Company name, support email and postal address for Privacy and Terms.
3. Confirmation that `rkay.in` DNS can move to Cloudflare (and where it is hosted today).
4. The Day 0 accounts created.
5. A decision on pricing tiers (or "keep placeholders for now").
