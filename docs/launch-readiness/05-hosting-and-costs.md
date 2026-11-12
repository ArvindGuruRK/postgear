# Hosting Options And Costs ☁️

Written on 2026-11-12 from web research the same day. Written for: Arvind.
Prices are USD. "Unverified" marks anything I could not confirm on an official page. Prices change often: check the checkout screen before paying. Source URLs are listed at the end.

---

## 1. First, A Correction About Railway Pricing 💡

You said Railway Pro is $5. It is not.
- **Hobby plan: $5 per month**, includes $5 of usage credit.
- **Pro plan: $20 per month**, includes $20 of usage credit.
- Whether Pro is charged per seat or per workspace is unclear: Railway's own page says per workspace, some third-party trackers say per seat. The checkout screen settles it.

Railway also bills usage by the minute: about $10 per GB of RAM per month, $20 per vCPU per month, $0.05 per GB egress, $0.15 per GB volume. You pay for what runs, not what is reserved.

**Recommendation: start on Hobby.** For this load the monthly bill is about the same on both plans. Upgrade to Pro when you need more than 3 team members, higher resource caps, or before production.

---

## 2. What We Need To Run

| Service | Memory (guess) | Notes |
|---|---|---|
| web (Next.js) | about 0.5 GB | |
| api (NestJS) | about 0.8 GB, 1.5 to 2 GB during SEO audits or PDF export | Chromium for SEO audit, brand extraction, Studio PDF |
| worker (Temporal worker) | about 0.3 GB | Always on, no inbound port |
| Postgres | about 0.4 GB plus a 2 GB disk | Temporal needs two extra databases in it |
| Redis | about 0.1 GB | |
| Temporal server | about 0.7 GB | Self-hosted container |
| Object storage | none | Cloudflare R2 |

---

## 3. Railway Estimate For This Stack

| Case | Monthly usage | Notes |
|---|---|---|
| Low | about $22 | Nobody uses it |
| **Likely (demo)** | **about $35 to $45** | Light traffic, a few audits |
| High | about $70 to $90 | Chromium running for hours, heavy egress |

With the Hobby plan fee, the likely bill is about $38 to $45 (about 3,300 to 4,000 INR at 88 INR per USD, my assumption). Skipping the self-hosted Temporal server saves about $9.

**Railway weaknesses (honest):**
- Usage-based, so a runaway job can spike the bill. Set usage alerts and a hard limit.
- 2026 incident history: wrongful abuse termination of about 3% of services in February, network disruption in February, a roughly 2 hour single-zone outage in July, a 5 minute domain routing failure in September, storage trouble in October, and a long outage in May (Google suspended Railway's cloud account, about 8 to 9.5 hours). For a demo on a fixed day this matters: keep a recording and a snapshot.
- Databases are templates, not fully managed. Backups are volume snapshots. If you change the template's image or start command, the database becomes your responsibility.
- I found no evidence on how Chromium behaves inside Railway containers (shared memory). Unverified: test early.

---

## 4. All Options Compared

| Option | Monthly cost for this stack | Setup effort | Good | Bad |
|---|---|---|---|---|
| **Railway** (Hobby or Pro) | $38 to $45 likely | Low | One project, private network, fast deploys, GitHub integration, environments | Usage bills, incident history, DB not fully managed |
| **One VPS: Hetzner + Coolify or Dokploy** | about $10 to $25 (Hetzner prices rose on 2026-06-15; CX plans have been reported unavailable at times) | High: 1 to 2 days, then hours per month | Cheapest, full control, runs Chromium and Temporal easily, backups to R2 | Single machine, you patch and secure it, restore must be tested |
| **Lightsail 4 GB instance** | about $24 | High | AWS brand, simple pricing, 4 TB transfer | Same VPS chores; managed DB $30 to $60 extra |
| **Render** | about $95 to $115 (+ $25 workspace on Pro) | Low to medium | Managed Postgres with backups, simple UI | 512 MB plans too small for the API; costlier |
| **Fly.io** | about $55 to $65 self-run DB, $85 to $100 managed | Medium (CLI and config files) | Machines fit workers, global | More ops; managed Postgres starts at $38 |
| **DigitalOcean App Platform** | about $90 to $120 (DB prices unverified) | Low | Familiar | Pricey for always-on workers |
| **Northflank** | about $65 to $90 | Medium | No seat fees, handles workers | Smaller community |
| **AWS ECS + RDS + ElastiCache** | about $120 to $200 (unverified) | Very high | Enterprise standard | Too heavy for a 4 day deadline |
| **Google Cloud Run** | $100+ (unverified) | High | | Poor fit for an always-on worker |
| **Vercel (web only)** | $20 per seat on Pro | Low | Great for Next.js | Does not host the other five services; Hobby is non-commercial |
| Koyeb, Zeabur | not recommended | | | Unclear pricing and ownership changes |

---

## 5. Recommendation 🧭

| Goal | Pick | All-in monthly |
|---|---|---|
| **Fastest, for the 4 day deadline (my pick)** | **Railway Hobby**, self-hosted Temporal, R2, Resend free, Cloudflare DNS | about $40 to $50 total with OpenAI and X credits |
| Cheapest | One Hetzner VPS + Coolify/Dokploy, R2, Resend free, Cloudflare DNS | about $12 to $25 |
| Best for real production later | Railway Pro or Render/Fly with managed Postgres and backups; Temporal Cloud when volume grows | about $95 to $130 |

**Why Railway for the demo.** It is the least work and the project already assumes a platform with private networking. The cost is small compared to your time. **Keep the VPS option as the written fallback** (a Docker Compose file I can prepare after the demo plan is done), because it protects you from a platform outage and may become your cheaper long-term home.

**Temporal choices.**
- *Self-host on Railway (recommended for the demo):* free, about $5 to $10 per month of usage, private network only, you own upgrades and backups of its databases.
- *Temporal Cloud:* pay-as-you-go, no minimum; new accounts get $150 credit valid 90 days, which would cover the demo. Needs code changes to add TLS and API key support (not present today). Reconsider after the demo. A startup credit programme exists but eligibility for you is unverified.
- *`temporal server start-dev`:* not recommended; state is lost on restart unless you add a volume, and it is not for production.

---

## 6. Other Services And Their Costs

| Service | Plan | Cost | Notes |
|---|---|---|---|
| Cloudflare DNS | Free | $0 | Also gives a WAF, DDoS cover and free-plan rate limiting (1 rule) |
| Cloudflare R2 | Free tier | $0 | 10 GB storage, 1M writes, 10M reads per month, no egress fees |
| Resend | Free | $0 | 3,000 emails per month, 100 per day, 3 domains. Pro is $20 for 50,000 |
| Sentry | Free | $0 | About 5,000 errors per month (sources conflict), hard cap |
| Tavily | Free | $0 | 1,000 credits per month |
| OpenAI | Pay as you go | a few dollars | Text posts about $0.001 each; set a spend cap |
| X API | Prepaid credits | a few dollars | About $0.015 per post, $0.20 for a post containing a URL |
| Stripe | Test mode | $0 | India live accounts are invite-only |

---

## 7. DNS And Domain Layout (Staging)

| Hostname | Points to | Cloudflare mode |
|---|---|---|
| `postgear-staging.rkay.in` | Railway web service (CNAME target shown by Railway) | Proxied is fine after the first certificate issues |
| `api.postgear-staging.rkay.in` | Railway api service | **DNS only (grey)**: Cloudflare's free certificate covers only one subdomain level |
| `media-staging.rkay.in` | R2 custom domain | Managed by R2 |
| `send.rkay.in` | Resend records | **DNS only**, never proxy mail records |

Cookie domain: `postgear-staging.rkay.in`, so the session cookie set by the API is also sent with requests to the web host. Production later: `postgear.rkay.in` and `api.postgear.rkay.in`, a different domain, so staging and production can never share a cookie.

---

## 8. Backups And Recovery (Minimum For The Demo)
1. Railway Postgres: enable snapshot backups; take one the evening before the demo.
2. A manual `pg_dump` to R2 on Day 4 (and a tested restore into a throwaway database).
3. Copy `ENCRYPTION_KEY_AES256` and all other secrets to the password manager.
4. R2 objects are durable; versioning is optional.
5. Fallback plan on paper: if Railway is down on demo day, show the recorded walkthrough and say so honestly.

---

## 9. Sources (opened on 2026-11-12 unless noted)
- Railway: docs.railway.com/pricing/plans, railway.com/pricing, docs.railway.com/guides/postgresql; incident write-up on ilert.com for the May 2026 outage
- Render: render.com/pricing.md
- Fly.io: docs.fly.io/about/pricing
- DigitalOcean: digitalocean.com/pricing/app-platform
- AWS Lightsail: aws.amazon.com/lightsail/pricing
- Hetzner increases: northflank.com/blog/hetzner-cloud-server-price-increases (official Hetzner page did not load)
- Coolify vs Dokploy: getdeploying.com/guides/coolify-vs-dokploy
- Northflank: northflank.com/pricing
- Koyeb: koyeb.com/docs/faqs/pricing
- Temporal: temporal.io/pricing, temporal.io/startups, docs.temporal.io/cli/server
- Cloudflare R2: developers.cloudflare.com/r2/pricing, /r2/buckets/public-buckets, /r2/api/s3/api
- Cloudflare rate limiting: developers.cloudflare.com/waf/rate-limiting-rules
- Resend: resend.com/pricing, resend.com/docs/dashboard/domains/introduction
- Vercel: vercel.com/pricing
