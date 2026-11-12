# Environment Setup Guide: Local, Staging, Production 🔧

Written on 2026-11-12. Written for: Arvind. Read together with [02 Plan](02-four-day-staging-plan.md).

**Golden rules**
1. Three separate worlds: **local** (your laptop, simulation allowed), **staging** (Railway, the investor demo, real keys), **production** (not created yet, stays empty).
2. **Never reuse a secret between worlds.** Each world gets its own `JWT_SECRET`, `ENCRYPTION_KEY_AES256`, `AUTOMATION_INTERNAL_TOKEN`, database and bucket.
3. **Staging and production both run with `NODE_ENV=production`.** The code only accepts `development`, `test` or `production`, and in production it refuses every `*_SIMULATION=true`, refuses a missing `AUTOMATION_INTERNAL_TOKEN`, and (after our Day 1 change) refuses placeholder secrets and plain-http URLs.
4. **No secret ever goes into git.** `.env` is ignored, only `.env.example` is tracked. Staging values live only in Railway variables.
5. **`ENCRYPTION_KEY_AES256` cannot be rotated casually.** If it changes or is lost, every connected channel's token becomes unreadable and every user must reconnect. Back it up in two places.

---

## 1. The Three Worlds At A Glance

| | Local | Staging | Production (later) |
|---|---|---|---|
| Where | Your PC, Docker | Railway, environment `staging` | Railway, environment `production` |
| Web URL | `http://localhost:3000` | `https://postgear-staging.rkay.in` | `https://postgear.rkay.in` |
| API URL | `http://localhost:3001` | `https://api.postgear-staging.rkay.in` | `https://api.postgear.rkay.in` |
| `NODE_ENV` | `development` | `production` | `production` |
| Simulation flags | `true` (free, safe) | **all unset or `false`** (refused if `true`) | same as staging |
| Database | Docker Postgres `postgear_db` | Railway Postgres (own) | Railway Postgres (own, later) |
| Media | local disk or MinIO | R2 bucket `postgear-staging-media` | R2 bucket `postgear-media` |
| Stripe | simulation or CLI | **test mode** keys | **live** keys (later) |
| Social apps | one dev app set | **the same dev apps**, callback URLs added | separate apps (later) |
| Email | console print | Resend | Resend (own domain section) |
| Cookie names | `pg_session`, `pg_org` | `pg_session_stg`, `pg_org_stg` | `pg_session`, `pg_org` |
| Cookie domain | none | `postgear-staging.rkay.in` | `postgear.rkay.in` |

Different cookie names for staging mean that even if you browse both worlds in one browser they cannot overwrite each other.

---

## 2. How To Generate Secrets (Do This Once Per World)

The repo has a helper. It prints new values; it does not need a `.env` unless you add `--write`.

```bash
npm run generate:keys
```

It prints `ENCRYPTION_KEY_AES256` (64 hex), `AUTOMATION_INTERNAL_TOKEN` (64 hex), `JWT_SECRET` (base64) and `NEXTAUTH_SECRET` (dead variable, ignore). **Run it separately for staging and keep the printed output out of the repo.** Alternative without the repo:

```bash
openssl rand -hex 32      # ENCRYPTION_KEY_AES256 and AUTOMATION_INTERNAL_TOKEN (run twice)
openssl rand -base64 48   # JWT_SECRET
```

Save all three in your password manager under "PostGear staging". Never use `--write` against your local `.env` for staging values.

---

## 3. Which Service Needs Which Variables (Railway)

Railway lets you define **shared variables** once per environment and reference them from several services (`${{shared.NAME}}`). Use that for anything that API and worker both need.

| Variable | api | worker | web | Staging value / where it comes from |
|---|---|---|---|---|
| `NODE_ENV` | yes | yes | yes | `production` |
| `PORT` | auto | no | auto | Railway injects it |
| `DATABASE_URL` | yes | yes | no | Railway Postgres: reference `${{Postgres.DATABASE_URL}}` (private URL) |
| `REDIS_URL` | yes | no | no | Railway Redis: `${{Redis.REDIS_URL}}` |
| `JWT_SECRET` | yes | no | no | Generated (section 2) |
| `ENCRYPTION_KEY_AES256` | yes | yes | no | Generated, backed up |
| `AUTOMATION_INTERNAL_TOKEN` | yes | yes | no | Generated, same value on both |
| `WEB_URL` | yes | yes | no | `https://postgear-staging.rkay.in` |
| `API_URL` | yes | yes | yes (server) | `https://api.postgear-staging.rkay.in` |
| `NEXT_PUBLIC_API_URL` | no | no | **build arg** | Same as `API_URL` |
| `AUTH_COOKIE_NAME`, `ORG_COOKIE_NAME` | yes | no | yes (`ORG_COOKIE_NAME`) | `pg_session_stg`, `pg_org_stg` |
| `COOKIE_DOMAIN` | yes | no | no | `postgear-staging.rkay.in` (new variable we add on Day 1) |
| `TEMPORAL_HOST` | yes | yes | no | Internal address of the Temporal service, e.g. `temporal.railway.internal:7233` |
| `TEMPORAL_NAMESPACE` | yes | yes | no | `default` |
| `STORAGE_PROVIDER` | yes | yes | no | `s3` |
| `S3_ENDPOINT` | yes | no | no | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `S3_REGION` | yes | no | no | `auto` |
| `S3_BUCKET_NAME`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | yes | no | no | From R2 (section 5.3) |
| `S3_PUBLIC_URL` | yes | yes | no | `https://media-staging.rkay.in` |
| `S3_FORCE_PATH_STYLE` | yes | no | no | `true` (research suggests R2 works with it; confirm at first upload) |
| `RESEND_API_KEY` | yes | no | no | Resend (section 5.2). Required in production unless `SMTP_HOST` is set |
| `RESEND_WEBHOOK_SECRET` | yes | no | no | Resend webhook signing secret, `whsec_...` (section 5.2) |
| `SMTP_FROM` | yes | no | no | `PostGear <no-reply@send.rkay.in>`. Required in production (the local default is refused) |
| `OWNER_EMAIL` | yes | no | no | Your own inbox, for cancellation feedback. Required in production |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | yes | no | no | Only if you use SMTP instead of `RESEND_API_KEY`. Leave unset with Resend |
| `OPENAI_API_KEY` | yes | no | no | OpenAI (section 5.4) |
| `TAVILY_API_KEY` | yes | no | no | Tavily |
| `AI_MODEL`, `AI_IMAGE_MODEL` | yes | no | no | Leave blank unless the defaults are retired |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | yes | no | no | Stripe test mode |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | no | no | **build arg** | Stripe test mode |
| `SENTRY_DSN` | yes | optional | no | Sentry |
| `NEXT_PUBLIC_SENTRY_DSN` | no | no | **build arg** | Sentry |
| Social credentials (section 6) | yes | **yes** | no | Each platform portal. The worker publishes and refreshes tokens, so give it the same ones |
| `GOOGLE_CLIENT_ID/SECRET` | yes | yes | no | Google Cloud (login) |
| `FACEBOOK_CLIENT_ID/SECRET` | yes | no | no | Meta login app |
| `SEO_BROWSER`, `SEO_MAX_CONCURRENT_AUDITS` | yes | no | no | `auto`, `2` (set `off` if memory is tight) |
| `OPEN_PAGERANK_API_KEY` | yes | no | no | Open PageRank |
| `YOUTUBE_API_KEY`, `DISCOVER_*` | yes | yes | no | Only if Discover is shown |

**Simulation flags on staging:** leave `AI_SIMULATION`, `PUBLISH_SIMULATION`, `ANALYTICS_SIMULATION`, `BILLING_SIMULATION`, `AUTOMATION_SIMULATION`, `DISCOVER_SIMULATION`, `WEBHOOK_ALLOW_PRIVATE_URLS` **unset**. If any is `true`, the API and worker refuse to boot, which is the intended safety net.

**Build-time variables.** `NEXT_PUBLIC_*` values are baked into the web bundle at build time. Changing them needs a rebuild. In Railway, add them as service variables and mark them to be available at build.

**Dead variables to ignore:** `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `GITHUB_CLIENT_*`.

---

## 4. Setting Up Each World

### 4.1 Local (already works)
Keep your current `.env`. Do not paste real staging keys into it. It stays on simulation flags so your daily work costs nothing. For occasional real tests of one service (for example a real OpenAI call), set only that one value and unset its simulation flag, then undo it.

### 4.2 Staging (Railway), In Order
1. Railway: New Project `postgear`. Create environment **staging** (rename the default one).
2. Add services: Postgres (template), Redis (template), then from the GitHub repo: `api`, `worker`, `web` (each with its Dockerfile from `infra/docker`). Add `temporal` from the image `temporalio/auto-setup` with its own variables (below).
3. Create the shared variables for secrets from section 2.
4. Fill service variables from the table in section 3. Paste values only into Railway, never into chat or files.
5. Temporal service variables (self-hosted): `DB=postgres12`, `DB_PORT=5432`, `POSTGRES_USER`, `POSTGRES_PWD`, `POSTGRES_SEEDS` (the Postgres private host). It creates its own `temporal` and `temporal_visibility` databases inside the same Postgres. **Do not give it a public domain.**
6. Set the api service's pre-deploy command to `npx prisma migrate deploy --schema packages/db/prisma/schema.prisma`.
7. Domains: add `postgear-staging.rkay.in` to `web` and `api.postgear-staging.rkay.in` to `api`; create the CNAME records Railway shows (see [05 Hosting](05-hosting-and-costs.md)).
8. Deploy. Check `https://api.postgear-staging.rkay.in/health`.

### 4.3 Production (Later, Not Now)
Create an empty Railway environment named **production** and do nothing else. When the time comes: new secrets (never copy staging's), new Postgres, new R2 bucket, Stripe **live** keys, separate social apps, and a fresh round of the checklist in section 8.

---

## 5. Getting The Values: Step By Step

### 5.1 Domain And DNS (Cloudflare)
1. Cloudflare, Add a site, `rkay.in`, Free plan.
2. Copy every existing DNS record (email, anything live) into Cloudflare, then change the nameservers at your registrar to the two Cloudflare ones.
3. Add records for Railway as Railway instructs. For the API host (two levels deep: `api.postgear-staging.rkay.in`) set the record to **DNS only (grey cloud)**: Cloudflare's free certificate covers only one level of subdomain, and Railway issues its own certificate. The web host may be proxied (orange cloud) later.

### 5.2 Resend (email)
1. resend.com, sign up, Domains, Add domain, use a subdomain such as `send.rkay.in`.
2. Add the DNS records Resend shows (DKIM, SPF, MX, optional DMARC). Do not proxy these in Cloudflare. Wait for "Verified" (usually 15 minutes, up to 72 hours).
3. API Keys, Create key, permission **Sending access**, limited to the `send.rkay.in` domain.
4. Railway **api** variables (the worker sends no mail):
   - `RESEND_API_KEY=<the key, starts with re_>`
   - `SMTP_FROM=PostGear <no-reply@send.rkay.in>` (the From line; must be on the verified domain)
   - `OWNER_EMAIL=<your own inbox>` (where cancellation feedback goes; never the no-reply address)
   - Leave every `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` unset. The API uses Resend's HTTP API when `RESEND_API_KEY` is set, which also works where Railway blocks outbound SMTP ports, and its idempotency key stops a retried send from arriving twice.
5. Webhooks (bounces and spam complaints), after the API has a public URL:
   - Resend, Webhooks, Add endpoint: `https://api.postgear-staging.rkay.in/mail/webhooks/resend`.
   - Events: `email.bounced` and `email.complained` (others are accepted and ignored).
   - Copy the signing secret (`whsec_...`) into the Railway api variable `RESEND_WEBHOOK_SECRET`.
   - What it does: a permanent bounce or a spam complaint puts the address on PostGear's `EmailSuppression` list. Invitations, notifications and workflow emails then skip it. Activation, password reset and lockout mail is always attempted, so nobody is ever stuck out of their account. Without the secret the endpoint answers 503 and nothing is suppressed.
6. What production refuses (the API will not boot, and names the variable): no `RESEND_API_KEY` and no `SMTP_HOST`; `SMTP_FROM` left at the local `@postgear.local` default; no `OWNER_EMAIL`. The console transport (mail printed to the log, links included) only ever runs outside production.
7. Free plan: 3,000 per month, 100 per day, 3 domains. Enough for the demo.
8. Check it: open `/dev/emails` locally to see every email, then sign up on staging with a real inbox and look at the activation mail in the inbox, the spam folder, Gmail's dark mode and a phone. The API log shows one JSON line per send (`mail.sent`, `mail.retry`, `mail.failed`, `mail.suppressed`) with the address masked and never the link.

### 5.3 Cloudflare R2 (media)
1. Cloudflare dashboard, R2, create bucket `postgear-staging-media`.
2. Settings, Custom Domains, connect `media-staging.rkay.in` (domain must be in your Cloudflare account). This also makes objects publicly readable.
3. R2 Overview, Manage API tokens, Create token, permission **Object Read and Write**, limited to this bucket. Copy Access Key ID and Secret (shown once).
4. Railway: `S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com` (account id is on the R2 page), `S3_REGION=auto`, `S3_BUCKET_NAME`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_PUBLIC_URL=https://media-staging.rkay.in`.
5. Test: upload an image in Media, open its URL in a private window.
6. The `r2.dev` address is rate limited and is not for real use. TikTok needs a domain it can verify, so use the custom domain.

### 5.4 OpenAI
1. platform.openai.com, create a project, add billing, set a **monthly spend limit** (start at $10).
2. API keys, create a key for this project only. Put it in `OPENAI_API_KEY`.
3. Check the model names in the model list: the code defaults to `gpt-4.1-mini` and `dall-e-3`. One secondary source says retirements are scheduled; if either is gone, set `AI_MODEL` and `AI_IMAGE_MODEL` to current names and test one generation.
4. A typical text post costs about $0.001, so $10 lasts a very long demo season. Images cost more; watch the usage page.

### 5.5 Tavily, Sentry, Open PageRank
- Tavily: sign up, copy key (1,000 free credits per month, no card).
- Sentry: free plan, create two projects (API, web). Put DSNs in `SENTRY_DSN` and the web build arg `NEXT_PUBLIC_SENTRY_DSN`. After deploy, trigger the test route once to confirm an event arrives.
- Open PageRank: free key, `OPEN_PAGERANK_API_KEY` (optional; improves the SEO authority score).

### 5.6 Stripe
See [02 Plan, section 6](02-four-day-staging-plan.md). The three values: `STRIPE_SECRET_KEY` (`sk_test_`), `STRIPE_WEBHOOK_SECRET` (`whsec_`, from the endpoint you create for the staging API), and the web build arg `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_test_`). The code refuses to boot if only one of the first two is set.

### 5.7 Google (Login And YouTube)
1. console.cloud.google.com, create project `PostGear Staging`.
2. Google Auth Platform: configure consent screen, **External**, status **Testing**. Add your Google accounts under Test users. Privacy policy and terms URLs go here once published.
3. Clients, Create OAuth client, type Web application. Authorised redirect URIs:
   - `https://api.postgear-staging.rkay.in/auth/google/callback` (confirm the exact login callback path in the code before saving)
   - `https://api.postgear-staging.rkay.in/channels/connect/youtube/callback`
   (Use two separate clients if you want to keep login and YouTube apart. The env has separate variables: `GOOGLE_CLIENT_*` for login, `YOUTUBE_CLIENT_*` for YouTube.)
4. Enable the **YouTube Data API v3** in the library.
5. Login-only scopes (openid, email, profile) never expire in testing mode. YouTube upload authorisations expire every 7 days in testing mode: reconnect before the demo.

### 5.8 Facebook Login (Sign In)
Separate small Meta app of type Consumer/Other with Facebook Login, scopes email and public_profile only. Callback `https://api.postgear-staging.rkay.in/auth/facebook/callback` (confirm path in code). Variables `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`. Do not reuse the publishing app.

---

## 6. Social Platform Apps (Developer Mode For The Demo)

Callback pattern for every one: `https://api.postgear-staging.rkay.in/channels/connect/<provider>/callback`, provider = `x`, `linkedin`, `linkedin-page`, `facebook`, `instagram`, `youtube`, `tiktok`, `pinterest`. Redirect URIs must match byte for byte.

| Platform | Portal | Variables | Do this | Honest notes |
|---|---|---|---|---|
| X | console.x.com | `X_TWITTER_CLIENT_ID`, `X_TWITTER_CLIENT_SECRET` | New App. User authentication settings: OAuth 2.0, type **Web App, Automated App or Bot**, permissions **Read and write**. Use the OAuth 2.0 Client ID and Secret, not the API Key/Secret | Pay-per-use prepaid credits (about $0.015 per post, $0.20 for a post that contains a URL). The old free tier looks closed to new accounts |
| LinkedIn | linkedin.com/developers | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | Needs a LinkedIn Page to create the app. Products: Sign In with LinkedIn using OpenID Connect, Share on LinkedIn. Register both callbacks (`linkedin` and `linkedin-page`) | Personal posting is self-serve. Tokens last 60 days, no refresh for normal apps. **Page posting needs Community Management API: only for registered organizations, separate new app, business email, no published review time** |
| Facebook and Instagram | developers.facebook.com | `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | Business app. Add Facebook Login. Callbacks for `facebook` and `instagram`. Add yourself as admin. Instagram must be Business or Creator and linked to a Page you manage | Dev mode works for role users without review. Business verification is needed only for other people. Confirm on a throwaway Page that dev-mode posts are visible |
| YouTube | Google Cloud (5.7) | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | As 5.7 | Testing mode: 100 test users, 7 day tokens. Google changed policy on 2026-11-02: uploads from unverified projects are no longer forced private, but verification is still advised |
| TikTok | developers.tiktok.com | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | Create app, add Login Kit and Content Posting API, verify the media domain `media-staging.rkay.in`, add sandbox target account(s) you own | Unaudited apps can only post privately. The TikTok docs host refused automated reads during research, so confirm each step in the portal |
| Pinterest | developers.pinterest.com | `PINTEREST_APP_ID`, `PINTEREST_APP_SECRET` | Create app, Trial access (about a few days) | Trial pins are sandbox pins visible only to you. Standard access needs a video of the OAuth flow plus a public privacy policy |

**Review submissions (Day 2 and Day 4):** all of them want a public Privacy Policy URL, Terms URL and data-deletion information, and a screen recording of login, the consent screen, and the feature in use. We record on Day 3.

---

## 7. Copy-Paste Checklist Per World

### Staging "ready to boot" checklist
- [ ] `NODE_ENV=production`
- [ ] `DATABASE_URL`, `REDIS_URL` from Railway references
- [ ] `JWT_SECRET` (64+ random chars, not the example), `ENCRYPTION_KEY_AES256` (64 hex), `AUTOMATION_INTERNAL_TOKEN` (64 hex, same on api and worker)
- [ ] `WEB_URL`, `API_URL`, `COOKIE_DOMAIN`, cookie names, all `https`
- [ ] `TEMPORAL_HOST` points at the private Temporal service
- [ ] `STORAGE_PROVIDER=s3` plus the 5 S3 values
- [ ] Mail: `RESEND_API_KEY`, `SMTP_FROM` on `send.rkay.in`, `OWNER_EMAIL`, `RESEND_WEBHOOK_SECRET`
- [ ] `OPENAI_API_KEY`
- [ ] Stripe pair set together
- [ ] Sentry DSNs
- [ ] No simulation flag is `true`
- [ ] Build args set on web: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SENTRY_DSN`
- [ ] Social credentials added to **both** api and worker

### Staging "ready for investors" checklist
- [ ] Fresh activation email arrives (inbox, not spam), looks right in Gmail dark mode and on a phone, and the link works
- [ ] Resend dashboard shows the webhook endpoint with a green test delivery
- [ ] Image upload shows a working public URL
- [ ] One real publish per platform listed in the plan
- [ ] Stripe test payment flips the plan
- [ ] Sentry test error arrives
- [ ] Postgres snapshot exists, manual dump stored in R2
- [ ] `ENCRYPTION_KEY_AES256` copied to two safe places
- [ ] Reconnected YouTube this morning

---

## 8. Production Later (Do Not Do Now)
Create the empty environment. When ready: new secrets, new database, new bucket, Stripe live (needs registered business, export opt-in and invite), separate social apps with their reviews approved, separate Sentry projects, backups tested by a real restore, `npm audit` clean, and a written rollback plan.

---

## 9. Mistakes That Waste Hours (Learned From The Audit) 🧯
1. A redirect URI with a trailing slash or `127.0.0.1` instead of `localhost` is rejected with unhelpful errors.
2. Placeholder values pass silently in some places (the old `.env.example` JWT secret is long enough to pass validation). We add a check on Day 1; until then, be careful.
3. A missing `REDIS_URL` or S3 setting does not stop the boot in the current code. Mail now does: in production the API refuses to start without `RESEND_API_KEY` (or `SMTP_HOST`), a real `SMTP_FROM` and `OWNER_EMAIL`.
4. `NEXT_PUBLIC_API_URL` unset at build time silently points browsers at localhost.
5. Putting the API behind a different parent domain than the web app breaks login. Keep the sibling layout.
6. Cloudflare proxy (orange cloud) on the two-level API hostname can fail to get a certificate. Keep that record grey.
7. Seeding staging with the dev seed installs known demo accounts and a known API key. Never run it there.
