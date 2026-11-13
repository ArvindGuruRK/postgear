# PostGear Deployment Guide: Platforms, Costs And Step-By-Step Setup ☁️

Written on 2026-11-12, from the codebase on branch `sprint-11-discover` and web research done the same day.
Written for: Arvind, who will choose a host for the investor proof of concept (staging) and later for production.

This is the long, detailed version of [05 Hosting And Costs](launch-readiness/05-hosting-and-costs.md). Where the two disagree, this one is newer and shows its working.

---

## 0. How To Read This Document 🙂

- **Section 1** is the short answer. Read it first.
- **Sections 2 and 3** explain what PostGear needs from a host, in plain words.
- **Section 4** is the price comparison with the maths shown.
- **Section 5** is the work every platform needs before anything can deploy.
- **Sections 6 to 16** are the step-by-step guides, one per platform, best fit first.
- **Section 17** covers the extra services (database, storage, email, Temporal).
- **Sections 18 to 20** cover staging vs production, demo-day safety, and the sources.

**Honesty labels used below:**

| Label | Meaning |
|---|---|
| ✅ Official | I read the number on the provider's own page or docs today |
| 🔎 Third party | The official page did not show it (or hid it), so the number comes from pricing trackers or reviews. Check it at checkout |
| 🧮 My estimate | Maths I did from official rates plus my guess of how much memory and CPU PostGear uses |
| ❓ Unverified | I could not confirm it. Treat it as a hint only |

**Money assumptions:** prices are in US dollars and **before tax**. For rupees I use **1 USD = 88 INR** and **1 EUR = 1.15 USD** (my assumptions, not live rates). Indian cards paying foreign providers may also see 18% GST and a bank forex markup on top, so keep about 20% headroom on every number. Prices change often: the checkout screen always wins.

---

## 1. The Short Answer 🎯

| Your goal | My pick | Monthly cost (staging) | Effort |
|---|---|---|---|
| **Investor demo, fastest and least stress** | **Railway (Hobby plan)**, Singapore region | **about $35 to $45** (about ₹3,100 to ₹4,000) | Low |
| **Cheapest that is still dependable** | **Hetzner CX33 server + Coolify** (Germany or Finland), pay monthly | **about $12 to $14** (about ₹1,100 to ₹1,250) | Medium to high |
| **Cheapest with servers in India** | **Hostinger VPS KVM 2 + Coolify template** (Mumbai) | **₹1,533 for the first month, no commitment** (₹1,299 plus GST, seen in the real cart); or ₹779 per month on a 24-month prepaid plan (₹18,696 upfront) | Medium to high |
| Free, if you accept real risk | Oracle Cloud Always Free (Mumbai or Hyderabad) | $0 | High, and it can break |
| Easy but costly | Render | about $95 to $115 | Low |
| Middle ground | Fly.io | about $40 to $75 | Medium |
| Not for this project now | Vercel or Netlify alone, AWS, Azure, Google Cloud, Koyeb | see section 4 | |

**My honest recommendation:**

1. **Use Railway Hobby for the investor demo.** It runs all six PostGear pieces in one project, it has a Singapore region (close to India), private networking between services, and it is the least work for a 3 to 4 day deadline. The bill is small next to the value of your time.
2. **Keep a single cheap server (VPS) with Coolify as the written backup**, and consider it as your cheaper long-term home once the demo is done. It costs about a quarter to a third of Railway for the same stack, but you become the system administrator. Two good choices:
   - **Hostinger KVM 2 (Mumbai)**. A 1-month plan is ₹1,533 with GST (renews at ₹2,099 plus GST, so switch off auto-renew), or ₹779 per month if you prepay 2 years (₹18,696 before GST). It is the cheapest per month, the servers are in India, Coolify comes pre-installed, and there is a 30-day money-back guarantee.
   - **Hetzner CX33 (EU)** if you want to pay month by month and cancel any time. It has twice the CPU cores, but the servers are in Europe.
3. **Do not use Hostinger's normal web hosting (shared or "Cloud" hosting plans) for PostGear.** Only the Hostinger **VPS** works. The web hosting plans cannot run background workers, Docker or Redis (section 8 explains why).
4. **Do not split the app across Vercel plus something else** for the demo. Vercel or Netlify can only host the web part. You would still need a second platform for the other five pieces, which adds cost, a second dashboard and cookie headaches, and saves almost nothing.

**One honest warning before any platform:** today PostGear **cannot deploy anywhere**. The three Dockerfiles in `infra/docker/` are empty stubs and the API/worker build has a probable packaging blocker. Section 5 lists that work. It is the same work for every platform, so the choice of host does not change it.

---

## 2. What PostGear Is, From A Hosting Point Of View 🏗️

PostGear is a social media management and SEO SaaS. It is a monorepo (npm workspaces + Turborepo) with three apps and many shared packages:

| Part | Code | What it does | Runs as |
|---|---|---|---|
| **web** | `apps/web` (Next.js 16) | The dashboard people use in the browser | Always-on Node server, public |
| **api** | `apps/api` (NestJS 11) | All business logic, auth cookies, SSE streams, SEO crawls with a real Chromium browser, Studio exports | Always-on Node server, public |
| **worker** | `apps/worker` (Temporal worker) | Publishes posts, refreshes tokens, syncs analytics, delivers webhooks, runs workflows | Always-on, **no public port** |
| **Temporal server** | Docker image `temporalio/auto-setup:1.28.1` | The durable scheduler behind every queued post | Always-on, **private only** |
| **Postgres 15** | | Main database, plus two Temporal databases | Always-on, private |
| **Redis 7** | | Rate limits, login lockout, OAuth state, run events, Discover caches | Always-on, private |
| **File storage** | S3-compatible (MinIO locally) | Media uploads that social platforms fetch by public URL | External: Cloudflare R2 |

Shared packages (`db`, `social-core`, `ai-engine`, `seo-engine`, `discover-engine`, `design-engine`, `automation`, `scheduling`, `ui`, `sdk`, `config`) are compiled into the apps, so they never deploy on their own.

**Why this shape matters for choosing a host:**

- 🟢 **Two always-on background pieces (worker and Temporal).** "Serverless" hosts that sleep when nobody visits (Vercel, Netlify, Cloud Run by default, Render's free tier) are a bad fit for them. A post scheduled for 9:00 must publish at 9:00 even if nobody has the app open.
- 🟢 **A real Chromium browser inside the API** (SEO audits, brand extraction, Studio PDF). That needs about 1 to 2 GB of memory and a normal Linux base image (Debian, not Alpine).
- 🟢 **Private networking** between api, worker, Temporal, Postgres and Redis. Hosts that give every service a private address make this easy (Railway, Render, Fly, a single VPS).
- 🟢 **Long-lived connections** (SSE streams for AI and SEO). Serverless functions with short time limits fight this.
- 🟢 **Session cookie shared by two hostnames** (`postgear-staging.rkay.in` and `api.postgear-staging.rkay.in`). Any host works if you can attach your own domain, which all of them allow.

**Simple rule:** PostGear wants "a few small always-on containers that can talk privately", not "serverless functions". That rules some popular platforms out, and it is the main reason for my pick.

---

## 3. How Much Computer PostGear Needs 📏

These are my estimates for a quiet demo (a handful of users). They drive every cost in section 4. 🧮

| Service | Memory | CPU (average) | Disk |
|---|---|---|---|
| web | about 0.5 GB | very low | none |
| api | about 1 GB, up to 2 GB during an SEO audit or PDF export | low, bursts during audits | none |
| worker | about 0.3 GB | very low | none |
| Temporal server | about 0.7 GB | low (it polls the database all the time) | none (data lives in Postgres) |
| Postgres | about 0.4 GB | low | 2 to 5 GB |
| Redis | about 0.1 GB | very low | under 1 GB |
| **Total** | **about 3 GB normal, 4 GB at peak** | **about 0.3 vCPU average** | **about 5 GB** |

**What this means:** one server with **8 GB of memory** runs everything with room to spare. A **4 GB** server runs it, but tightly (an SEO audit could push it into trouble). On usage-billed platforms, you pay for roughly **3 GB of memory around the clock**.

---

## 4. Price Comparison For The Whole PostGear Stack 💰

All numbers are **monthly, for staging, always on, light traffic**. Storage (R2), email (Resend) and DNS (Cloudflare) are free tiers on every option (section 17), so they are not repeated here.

### 4.1 The Summary Table

| # | Platform | Monthly (USD) | Monthly (INR) | Hosts all 6 pieces? | Setup effort | Price source |
|---|---|---|---|---|---|---|
| 1 | **Railway Hobby** | **$35 to $45** | ₹3,100 to ₹4,000 | Yes | Low | 🧮 from ✅ rates |
| 2 | **Hetzner CX33 + Coolify** | **$12 to $14** | ₹1,100 to ₹1,250 | Yes (one server) | Medium to high | 🧮 from 🔎/✅ |
| 2b | **Hostinger VPS KVM 2 + Coolify** (Mumbai), 1-month plan | **about $17.40** (₹1,533 with GST, first month) | **₹1,533** first month, then ₹2,099 plus GST if renewed | Yes (one server) | Medium to high | ✅ (real cart) |
| 2c | Hostinger VPS KVM 2, 24-month plan | about $8.85 | ₹779 (₹18,696 upfront, ₹1,199 after renewal) | Yes (one server) | Medium to high | ✅ |
| 3 | Oracle Always Free | $0 | ₹0 | Yes, if capacity exists | High | ✅ with ❓ cuts |
| 4 | Fly.io (self-run Postgres) | $40 to $50 | ₹3,500 to ₹4,400 | Yes | Medium | 🧮 |
| 4b | Fly.io (Managed Postgres) | $70 to $80 | ₹6,200 to ₹7,000 | Yes | Medium | 🧮 |
| 5 | AWS Lightsail 8 GB (one server) | $44 | ₹3,870 | Yes (one server) | Medium to high | ✅ |
| 6 | DigitalOcean Droplet 8 GB (one server) | $48 | ₹4,220 | Yes (one server) | Medium to high | ✅ |
| 7 | Render | $95 to $115 | ₹8,400 to ₹10,100 | Yes | Low | 🔎 |
| 8 | Northflank | $50 to $90 | ₹4,400 to ₹7,900 | Yes | Medium | 🧮 ❓ |
| 9 | DigitalOcean App Platform + Managed DB | $100+ | ₹8,800+ | Mostly | Low to medium | 🧮 ❓ |
| 10 | Azure (Container Apps + Postgres) | $90 to $150 | ₹7,900 to ₹13,200 | Yes | High | 🧮 ❓ |
| 11 | Google Cloud (Cloud Run + Cloud SQL) | $80 to $150 | ₹7,000 to ₹13,200 | Awkward | High | ❓ |
| 12 | AWS full (ECS Fargate + RDS + ElastiCache) | $120 to $200 | ₹10,600 to ₹17,600 | Yes | Very high | ❓ |
| 13 | Vercel Pro (web only) | $20 + another host for the rest | | **No** | Low for web | ✅ |
| 14 | Netlify (web only) | $0 to $20 + another host | | **No** | Low for web | ✅ |
| 15 | Koyeb | not recommended | | | | 🔎 |
| 16 | Hostinger web or Cloud hosting (Node.js apps, not VPS) | cannot run PostGear | | **No** | | ✅ |

### 4.2 The Maths For Each Option 🧮

#### Railway

Official rates ✅: memory **$10 per GB per month**, CPU **$20 per vCPU per month**, both billed by the minute. Volumes $0.15 per GB per month. Hobby plan **$5 per month, which includes $5 of usage**. Pro plan **$20 per month per workspace, includes $20 of usage, unlimited seats** (Railway's own blog once said "per seat"; the pricing page says per workspace, so trust the pricing page).

| Item | Amount | Cost |
|---|---|---|
| Memory | 3 GB around the clock | $30.00 |
| CPU | 0.3 vCPU average | $6.00 |
| Volumes (Postgres, Redis) | about 3 GB | $0.45 |
| Network egress | about 10 GB at $0.05 | $0.50 |
| **Usage total** | | **about $37** |
| Hobby fee | $5, but it counts toward usage | $0 extra |
| **Bill** | | **about $37 (range $30 to $50)** |

The range covers busy days (many SEO audits keep Chromium in memory) and quiet days. Pro would be about the same bill for this load (its $20 fee is also usage credit), so start on Hobby.

**Free trial:** new accounts get a one-time **$5 credit for 30 days**, no card needed, but each service is capped at **1 GB of memory** and the trial allows only **5 services**. PostGear needs 6 services and an API that can exceed 1 GB, so the trial is only good for a first experiment (for example with `SEO_BROWSER=off`). Plan on Hobby for the real staging. ✅

#### Hetzner CX33 + Coolify

Official ✅ (Hetzner raised prices for new orders on 2026-06-15): **CX33 = 4 vCPU, 8 GB RAM, 80 GB disk, €8.49 per month** before VAT and before the public IPv4 address. Arm alternative CAX21 (4 vCPU, 8 GB) is €10.49. Coolify itself is free when you host it yourself.

| Item | Cost |
|---|---|
| CX33 server | €8.49 |
| Public IPv4 address | small, under about €1 ❓ |
| Hetzner backups (20% of server price) | about €1.70 |
| **Total** | **about €10.70 to €11.20, about $12 to $13** |

Notes:
- CX servers are offered in the **EU (Germany, Finland)**. From India that is roughly 130 to 180 ms away ❓. Fine for a dashboard, a little slower than Singapore.
- Some reviewers report CX types being temporarily unavailable at times. 🔎 If CX33 is sold out, CAX21 (Arm) works but needs Arm-compatible images (section 10 covers it).
- Hetzner may ask new customers for ID verification before the first server. ❓ Leave a day for it.

#### Hostinger VPS

Official ✅ (read on Hostinger's own US and India VPS pages today). Both pages were running a sale ("Black Friday" in USD, "Sale Season" in INR), so the first-term prices can change after the sale.

| Plan | vCPU | RAM | NVMe disk | Bandwidth | First term (USD) | First term (INR) | Renewal (USD / INR) |
|---|---|---|---|---|---|---|---|
| KVM 1 | 1 | 4 GB | 50 GB | 4 TB | $6.49 per month | ₹599 per month | $11.99 / ₹999 |
| **KVM 2** | **2** | **8 GB** | **100 GB** | **8 TB** | **$8.79 per month** | **₹779 per month** | **$14.99 / ₹1,199** |
| KVM 4 | 4 | 16 GB | 200 GB | 16 TB | $12.99 per month | ₹1,099 per month | $28.99 / ₹2,399 |
| KVM 8 | 8 | 32 GB | 400 GB | 32 TB | $25.99 per month | ₹2,199 per month | $49.99 / ₹4,399 |

**The catch with these prices: they need a 24-month plan paid upfront.** Hostinger's page says: "All plans are paid upfront. The monthly rate reflects the total plan price divided by the number of months in your plan."

| KVM 2 cost | USD | INR |
|---|---|---|
| Paid on day one (24 months) | $210.96 | ₹18,696 |
| Plus 18% GST, if charged ❓ (the page does not say whether prices include tax; coupon sites say INR prices exclude GST 🔎) | | about ₹22,060 |
| Effective per month | $8.79 | ₹779 (about ₹919 with GST) |
| Per month after 2 years (renewal) | $14.99 | ₹1,199 |

Other official facts ✅:
- **Mumbai data center** exists (Tier 3). You pick the location at setup. Moving it later means reinstalling, which deletes all data, backups and snapshots.
- **Coolify and Dokploy come as ready-made OS templates** ("Ubuntu 24.04 with Coolify"). There is also a built-in **Docker Manager** for Docker Compose projects.
- **Free weekly backups**, restorable from the dashboard. I found no price for daily backups, so do daily database backups yourself with Coolify (section 8).
- **30-day money-back guarantee.**
- ⚠️ Hostinger's limits page says VPS **CPU use can drop to 20% of your share when "CPU credits" run out**. Normal PostGear use is light, but many SEO audits in a row (Chromium) could hit this. KVM 2 also has 2 cores where Hetzner's CX33 has 4.
- **A 1-month plan exists** (confirmed in a real cart on 2026-11-14, see the table below).

**The real 1-month cart for KVM 2 (seen in India, 2026-11-14)** ✅

| Line in the cart | Amount |
|---|---|
| KVM 2 plan, 1-month period (crossed out price ₹2,099) | ₹1,299 |
| Free domain for 1 year (normally ₹6,199) | ₹0 |
| Domain privacy protection | ₹0 |
| Taxes (18% GST) | ₹233.82 |
| **Total to pay today** | **₹1,532.82** |
| Optional "Daily auto-backup" (not ticked by default) | +₹589 per month |
| Renewal after 1 month | **₹2,099 per month** (plus GST), "cancel anytime" |

What this means:
- **Prices exclude GST.** The 18% tax is added at checkout, so the 24-month price from the earlier table would also get 18% on top.
- **It is a fixed price, not pay-per-use.** Using the server a lot or a little costs the same. There are no credits to top up, and you are not billed for CPU, RAM or traffic (8 TB of bandwidth is included).
- **Auto-renew is the only surprise to watch.** If you forget to switch it off, the next month is ₹2,099 plus GST (about ₹2,477), not ₹1,299.
- **Daily auto-backup (₹589 a month) is optional.** Skip it. Coolify can do daily Postgres backups to Cloudflare R2 for free.
- The cart also gives a **free domain for 1 year**. You already own `rkay.in`, so you do not need it.
- The **30-day money-back guarantee** is shown in the cart. Read Hostinger's refund terms before relying on it.

**Which size for PostGear:** **KVM 2 (8 GB)** is the right fit (section 3 says 8 GB gives room to spare). KVM 1 (4 GB) works only with the SEO browser off. KVM 4 (16 GB) is for production later or if you want staging and production on separate servers that both fit comfortably.

**Hostinger web hosting is a different product and cannot run PostGear** ✅. Its "Node.js web apps" feature on the Business/Unlimited and Cloud plans:
- does not support **always-running background workers** (they "stop when the app is deployed or restarted"), so the PostGear worker and Temporal cannot run,
- cannot run **Docker, Redis** or listen on **custom ports**,
- cannot accept **inbound WebSockets**,
- stops any request after **120 seconds**, which would cut long AI and SEO streams.

So when buying, make sure you are on the **VPS** page, not "Web Hosting" or "Cloud Hosting".

#### Oracle Cloud Always Free

Official ✅: Always Free Arm (Ampere A1) instances, documented as **up to 4 OCPU and 24 GB** of memory in total, free forever. Oracle has regions in **Mumbai and Hyderabad**.

The catches (all real):
- 🔎 Two secondary sources say Oracle **cut the free Arm allowance to 2 OCPU and 12 GB on 2026-06-15**. I could not confirm this on Oracle's page, which still shows 4 and 24. Even 2 and 12 is enough for PostGear.
- ✅ **Idle instances can be reclaimed.** A 2026 blog quotes the rule as CPU (95th percentile) under 20% over 7 days (and for Arm, memory and network too). A quiet demo server could match that.
- 🔎 "Out of capacity" errors are common when creating free Arm servers in popular regions. You may wait days.
- Your home region is fixed at sign-up and cannot be changed later.

**Verdict:** great for learning, risky for an investor demo on a fixed date.

#### Fly.io

Official ✅: a shared-cpu-1x machine with **1 GB costs $6.70 per month**, volumes $0.15 per GB, outbound data $0.02 per GB (North America and Europe). **Managed Postgres Basic (shared-2x, 1 GB) is $38 per month** plus storage at $0.28 per GB. Fly has a **Mumbai (`bom`) region** for apps; Managed Postgres is not offered in Mumbai, but is in Singapore (`sin`).

| Item | Cost |
|---|---|
| web, 1 GB machine | $6.70 |
| api, 2 GB machine | about $11 to $13 ❓ (exact 2 GB price not confirmed) |
| worker, 512 MB machine | about $3.50 ❓ |
| Temporal, 1 GB machine | $6.70 |
| Redis | $0 with Upstash free tier (section 17), or about $2 on a tiny machine |
| Postgres, self-run on a 1 GB machine + 5 GB volume | about $7.50 |
| **Total (self-run Postgres)** | **about $36 to $40, I say $40 to $50 with headroom** |
| Swap self-run Postgres for Managed Postgres Basic + 10 GB | about +$33, **total about $70 to $80** |

#### AWS Lightsail (one server)

Official ✅: Linux with public IPv4, **4 GB / 2 vCPU / 80 GB SSD / 4 TB transfer = $24**, **8 GB / 2 vCPU / 160 GB SSD / 5 TB transfer = $44** per month. Billed hourly, capped at the monthly price. A Mumbai region exists.

Run everything with Docker Compose on the 8 GB plan: **$44**. The 4 GB plan works only if you turn the SEO browser off or move Postgres out.

**Free credits:** brand-new AWS accounts (opened after 2025-07-15) get **$100 at sign-up plus up to $100 more** for trying services, on a 6-month Free plan. ✅ Whether those credits pay for Lightsail is ❓; check the credit's "eligible services" list before you count on it.

#### DigitalOcean Droplet (one server)

Official ✅: Basic Droplets **4 GiB / 2 vCPU = $24**, **8 GiB / 4 vCPU = $48** per month, per-second billing since 2026-01-01. Bangalore region exists. Managed PostgreSQL starts at **$15 per month** (1 GiB, single node).

- Everything on one 8 GiB Droplet: **$48**.
- Or a 4 GiB Droplet ($24) plus Managed PostgreSQL ($15) = **$39**, with backups of the database handled for you.

#### Render

Render's pricing page loads its prices in a way my tools could not read, so these come from pricing trackers 🔎. Render's docs ✅ confirm the plan sizes and that compute plans were renamed in August 2026 **without price changes**.

| Item | Plan (size) | Cost 🔎 |
|---|---|---|
| web | Starter (0.5 CPU, 512 MB), or Standard (1 CPU, 2 GB) if 512 MB is too small | $7 or $25 |
| api | Standard (1 CPU, 2 GB) | $25 |
| worker | Starter background worker (512 MB) | $7 |
| Temporal | Private service, Standard (2 GB; 512 MB is too small) | $25 |
| Postgres | basic-1gb + about 5 GB storage at $0.30 | $19 + $1.50 |
| Key Value (Redis) | 256 MB Starter | $10 |
| Workspace | Hobby | $0 |
| **Total** | | **about $95 to $115** |

Free tier notes ✅: free web services sleep after 15 minutes without traffic (about a minute to wake up), free Postgres is deleted 30 days after creation (plus a 14-day grace period), free Key Value has no persistence. None of that is suitable for the worker or Temporal. Render **does** have a Singapore region ✅.

#### Northflank

Official-ish (Northflank's own pages) 🔎: free Sandbox tier with **2 services, 1 database, 2 cron jobs**, always on. That is not enough for PostGear's 6 pieces. Paid compute is per second: **$0.01667 per vCPU-hour (about $12 per vCPU-month)** and **$0.00833 per GB-hour (about $6 per GB-month)**.

My estimate 🧮 ❓: 3 to 4 GB memory ($18 to $24) plus 2 to 3 reserved vCPU across services ($24 to $36) plus a database add-on = **$50 to $90**. The exact number depends on Northflank's fixed plan shapes, which I could not see.

#### DigitalOcean App Platform

Official ✅: dedicated plans start at **$49 per month (1 vCPU, 4 GiB)**; worker and job components start at $5 on legacy shared plans. With a Managed PostgreSQL ($15) and a Redis (Managed Valkey, price ❓), PostGear lands at **$100 or more** 🧮 ❓. It works, but you pay more for less than a Droplet.

#### Azure

- Container Apps (Consumption plan) ✅ gives a **free monthly grant of 180,000 vCPU-seconds, 360,000 GiB-seconds and 2 million requests**. 🔎 Active CPU is about **$0.000024 per vCPU-second**, which is about **$62 per vCPU per month** if a container is always busy. Idle containers bill at a lower idle rate.
- Azure Database for PostgreSQL Flexible Server, Burstable **B1ms**: 🔎 about **$12 per month** (US East, compute only, storage extra). **Free for 12 months** on a new Azure free account (750 hours, 32 GB storage) ✅.
- New Azure free accounts get **$200 credit for the first 30 days** ✅.
- App Service Linux B1 (1 core, 1.75 GB) 🔎 about **$13 per month**, good for the web app only.

My estimate for all six pieces: **$90 to $150** 🧮 ❓ after the first free month. Azure is strong for enterprise, but slow to set up and easy to overspend on.

#### Google Cloud

- Cloud Run ✅ free tier (instance-based billing): 240,000 vCPU-seconds and 450,000 GiB-seconds per month. Paid: about $0.000018 per vCPU-second and $0.000002 per GiB-second.
- Always-on services need "min instances", which bill all the time. Google's newer **"Cloud Run instances"** product says a 1 vCPU / 1 GiB instance running 30 days costs **$5.70** 🔎 (from Google's announcement blog; check it is available in your region).
- Temporal (a gRPC server that must never sleep) and the worker fit Cloud Run poorly. Cloud SQL for Postgres adds a separate bill ❓.

Estimate **$80 to $150** ❓. Not recommended for the POC.

#### AWS (full managed stack)

ECS on Fargate + RDS Postgres + ElastiCache Redis + a load balancer: **$120 to $200 per month** ❓ for always-on services, and days of setup (VPC, IAM, security groups). Note ✅: **AWS App Runner, the simple option, closed to new customers on 2026-04-30**; AWS points new users to ECS Express Mode instead. Too heavy for a 4-day deadline.

#### Vercel and Netlify (web only)

- **Vercel** ✅: Hobby is free but **restricted to non-commercial personal use**. An investor demo of a SaaS is commercial, so you need **Pro at $20 per month** (includes $20 of usage). It is the best home for Next.js, but it hosts **only `apps/web`**.
- **Netlify** ✅: credit-based plans. Free (300 credits per month, projects pause when credits run out), Personal **$9** (1,000 credits), Pro **$20** (3,000 credits, unlimited seats). Also web only.

Either way you still need Railway, a VPS or similar for api, worker, Temporal, Postgres and Redis. On Railway the web service costs only about $5 to $7 a month, so moving it to Vercel saves nothing and adds a second platform.

#### Koyeb

🔎 Koyeb agreed to join **Mistral AI** (announced 2026-02-17) and said its free Starter plan will be removed; paid plans reportedly start at $29 per month plus compute. Too much change underway to bet a demo on it.

### 4.3 The Whole POC Budget (Hosting Plus Everything Else)

| Line | Railway route | Hetzner route | Hostinger route |
|---|---|---|---|
| Hosting | $35 to $45 | $12 to $14 | about $8.85 (₹779), paid 24 months upfront |
| Cloudflare DNS + R2 storage | $0 | $0 | $0 |
| Resend email (free: 3,000 per month, 100 per day) | $0 | $0 | $0 |
| Sentry (free tier) | $0 | $0 | $0 |
| Temporal | $0 (self-hosted) | $0 (self-hosted) | $0 (self-hosted) |
| OpenAI (pay as you go, with a spend cap) | $5 to $10 | $5 to $10 | $5 to $10 |
| X API credits (pay per use) | $5 | $5 | $5 |
| Stripe | $0 (test mode) | $0 (test mode) | $0 (test mode) |
| Domain `rkay.in` | already owned | already owned | already owned |
| **Total per month** | **about $45 to $60 (₹4,000 to ₹5,300)** | **about $22 to $30 (₹1,900 to ₹2,600)** | **about $19 to $24 (₹1,700 to ₹2,100)** |
| Paid upfront | nothing | nothing | ₹18,696 (plus GST if charged) |

**Hostinger on a 1-month plan instead:** the hosting line becomes **₹1,533 once** (₹1,299 plus GST, real cart), which is about $17.40. Month one total is then about ₹1,533 plus whatever you spend on OpenAI and X credits (₹0 if you skip real calls). Nothing is charged again unless auto-renew stays on (₹2,099 plus GST).

---

## 5. Work Every Platform Needs First 🧰

None of these depend on the host. They come from [01 Problems And Solutions](launch-readiness/01-problems-and-solutions.md) and [02 Four Day Staging Plan](launch-readiness/02-four-day-staging-plan.md).

| # | Task | Why | Done when |
|---|---|---|---|
| 1 | **Fix the API and worker build** (bundle with `tsup` or `esbuild`, keep `argon2`, `sharp`, `playwright` external) | `tsc` output today probably cannot find the shared packages at runtime | `node dist/...` boots against local Docker services |
| 2 | **Write the three Dockerfiles** in `infra/docker/` (api on Debian slim with Chromium, worker, web with Next `output: 'standalone'` and `NEXT_PUBLIC_*` as build args) | The current files are 6-line stubs | All three images build locally |
| 3 | **A small Temporal image** (`FROM temporalio/auto-setup:1.28.1` plus `COPY infra/temporal/dynamicconfig`) | Hosted platforms cannot mount a local folder like Docker Compose does | The image starts and creates its two databases |
| 4 | **Add `COOKIE_DOMAIN`** to the API so the session cookie works for both hostnames | Web and API live on different subdomains | Login works across both |
| 5 | **Merge the sprint branches** into one deploy branch | Hosts deploy from one branch | Clean branch, `npm run validate` green |
| 6 | **Create the free accounts**: Cloudflare (move `rkay.in` DNS), R2 bucket, Resend, Sentry, OpenAI with a spend cap | Every option uses them | Keys stored in a password manager |
| 7 | **Generate fresh secrets** (`npm run generate:keys`) for staging. Never reuse local ones | Security | Stored in the password manager |
| 8 | **Turn every simulation flag off** in staging | Staging runs with `NODE_ENV=production`, which refuses simulation flags | Real keys in place |

Environment variables per environment are in [03 Env Setup Guide](launch-readiness/03-env-setup-guide.md).

**One rule that affects every platform:** `NEXT_PUBLIC_API_URL` (and other `NEXT_PUBLIC_*` values) are **baked into the web app at build time**. Changing them in a dashboard does nothing until you rebuild the web service.

---

## 6. Step By Step: Railway (Recommended For The Demo) 🚂

**Time:** about half a day after section 5 is done.
**Result:** six services in one Railway project, in Singapore, with your own domains.

### 6.1 Account And Safety Limits
1. Sign up at railway.com with GitHub (an older, active GitHub account avoids a "limited trial").
2. Choose the **Hobby** plan and add a card.
3. In workspace **Usage** settings, set a **usage alert** (for example $40) and a **hard limit** (for example $60). This stops a runaway job from surprising you.
4. In **Account Settings**, set the preferred region to **Southeast Asia (Singapore)**.

### 6.2 Project And Environment
5. Create a project named `postgear`.
6. Railway starts every project with an environment called `production`. Create a new environment named **`staging`** and work only there. Leave `production` empty until the product is ready (doc 02 rule).

### 6.3 Databases
7. **+ New → Database → PostgreSQL.** Railway exposes variables such as `DATABASE_URL`, `PGHOST`, `PGUSER`, `PGPASSWORD`.
8. **+ New → Database → Redis.** Railway exposes `REDIS_URL`.
9. Turn on **backups** for the Postgres volume (Railway takes volume snapshots).

### 6.4 Temporal
10. **+ New → GitHub Repo**, pick the repo, name the service `temporal`, and point it at the Temporal Dockerfile from section 5 (set the variable `RAILWAY_DOCKERFILE_PATH=infra/docker/Dockerfile.temporal`).
11. Variables for `temporal` (Railway's `${{ }}` syntax copies values from another service):
    ```
    DB=postgres12
    DB_PORT=5432
    POSTGRES_USER=${{Postgres.PGUSER}}
    POSTGRES_PWD=${{Postgres.PGPASSWORD}}
    POSTGRES_SEEDS=${{Postgres.PGHOST}}
    DYNAMIC_CONFIG_FILE_PATH=config/dynamicconfig/development-sql.yaml
    ```
12. **Do not** give `temporal` a public domain. Only the worker and api talk to it, over the private network at `temporal.railway.internal:7233`.
13. Known gotcha to check ❓: if the worker cannot connect, Temporal may be listening on the wrong network address. Set `BIND_ON_IP=0.0.0.0` (or `::` if the private network is IPv6 only) on the `temporal` service.

### 6.5 api, worker, web
14. Add three more services from the same GitHub repo: `api`, `worker`, `web`, each with its own `RAILWAY_DOCKERFILE_PATH` (`infra/docker/Dockerfile.api`, `.worker`, `.web`).
15. Shared variables (set on api and worker):
    ```
    NODE_ENV=production
    DATABASE_URL=${{Postgres.DATABASE_URL}}
    REDIS_URL=${{Redis.REDIS_URL}}
    TEMPORAL_HOST=temporal.railway.internal:7233
    TEMPORAL_NAMESPACE=default
    ```
    plus every secret and key from doc 03 (JWT, encryption key, OAuth apps, OpenAI, Stripe test keys, R2, SMTP for Resend, Sentry).
16. On **api**:
    - Health check path: `/health`.
    - **Pre-deploy command:** `npx prisma migrate deploy --schema packages/db/prisma/schema.prisma` (runs migrations before each new version goes live).
    - Generate a Railway domain first to test, then add the custom domain `api.postgear-staging.rkay.in`.
17. On **web**: add `NEXT_PUBLIC_API_URL=https://api.postgear-staging.rkay.in` and the other `NEXT_PUBLIC_*` values. The Dockerfile must declare them as `ARG` so Railway passes them in at build time. Add the custom domain `postgear-staging.rkay.in`.
18. On **worker**: no domain, no port. It only needs the variables.

### 6.6 Domains In Cloudflare
19. For each custom domain, Railway shows a CNAME target. In Cloudflare DNS add:
    - `postgear-staging` → CNAME to the web target.
    - `api.postgear-staging` → CNAME to the api target, **DNS only (grey cloud)**, because Cloudflare's free certificate covers only one level of subdomain.
20. Wait for Railway to show the certificate as issued.

### 6.7 First Checks
21. `https://api.postgear-staging.rkay.in/health` returns OK.
22. Register a real account, get the activation email from Resend, log in, connect LinkedIn, schedule a post 5 minutes ahead, watch it publish.
23. Run one SEO audit and watch the api's memory graph in Railway. If it nears the limit, raise it or set `SEO_MAX_CONCURRENT_AUDITS=1`.
24. Take a Postgres backup snapshot once everything works.

**About demo data:** `npm run db:seed` creates accounts with **known passwords** (`DemoPassword123!`). On a public staging site, either do not seed, or change those passwords right after.

### 6.8 Railway: Good And Bad

| Good 👍 | Bad 👎 |
|---|---|
| Least work; one dashboard for all six pieces | Usage billing: set the hard limit |
| Singapore region, private network, environments built in | 2026 had several incidents (see doc 05). Keep a recorded demo as backup |
| Deploys on every git push; easy rollbacks | Databases are templates, not fully managed. You own their upkeep |
| Pro plan is per workspace with unlimited seats | Chromium memory behaviour inside Railway is untested ❓. Test early |

---

## 7. Step By Step: Hetzner + Coolify (Cheapest Dependable) 🖥️

**Time:** 1 to 2 days the first time.
**Result:** one 8 GB server running everything with Docker, with automatic HTTPS, a web dashboard and git deploys, for about $12 to $14 a month.

**What Coolify is:** free, open-source software (Apache 2.0) you install on your own server. It gives you a Railway-like dashboard (deploy from GitHub, env vars, domains, HTTPS, database backups) without the monthly platform fee. Dokploy is a similar tool; its core is also free, with some enterprise features under a paid licence.

### 7.1 Server
1. Create a Hetzner Cloud account (allow time for possible ID verification ❓).
2. Upload your SSH public key in the console.
3. Create a server: **CX33**, location **Falkenstein, Nuremberg or Helsinki**, image **Ubuntu 24.04**, with your SSH key, IPv4 on, **Backups on** (+20%).
4. Create a **Hetzner Firewall**: allow inbound **22** (SSH, ideally only from your IP), **80**, **443**, and **8000** only for the first setup (Coolify's dashboard). Attach it to the server.

### 7.2 Harden The Server (10 Minutes)
5. SSH in: `ssh root@<server-ip>`.
6. Update: `apt update && apt upgrade -y`.
7. Turn on automatic security updates: `apt install -y unattended-upgrades` then `dpkg-reconfigure -plow unattended-upgrades`.
8. Add 4 GB of swap (a safety net for Chromium peaks):
   ```
   fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
   echo '/swapfile none swap sw 0 0' >> /etc/fstab
   ```

### 7.3 Install Coolify
9. Run Coolify's official installer:
   ```
   curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
   ```
10. Open `http://<server-ip>:8000`, create the admin account straight away (the first visitor becomes admin).
11. In Cloudflare DNS, add `coolify.rkay.in` → A record to the server IP. In Coolify settings, set that as its own domain so the dashboard gets HTTPS. Then remove port 8000 from the firewall.

### 7.4 Deploy PostGear
12. In Coolify, connect GitHub (GitHub App), then **New Resource → Docker Compose** from the repo.
13. Use a `docker-compose.prod.yml` (to write in section 5 work) that defines: `web`, `api`, `worker`, `temporal`, `postgres`, `redis`. It is the local `docker-compose.yml` plus the three app images, with **no published database ports** and volumes for Postgres and Redis.
14. Set environment variables in Coolify (same list as Railway, with `DATABASE_URL` pointing at `postgres:5432` and `TEMPORAL_HOST=temporal:7233`, the Compose service names).
15. Assign domains in Coolify: `postgear-staging.rkay.in` → web (port 3000), `api.postgear-staging.rkay.in` → api (port 3001). Coolify's proxy gets Let's Encrypt certificates automatically.
16. In Cloudflare, add A records for both hostnames to the server IP (**DNS only** at first, so the certificate can be issued).
17. Run migrations once from Coolify's terminal on the api container: `npx prisma migrate deploy --schema packages/db/prisma/schema.prisma`. (Add it to the api start command later so it runs on every deploy.)
18. Turn on **automatic deploy on push** for the deploy branch.

### 7.5 Backups
19. In Coolify, add an **S3 destination** pointing at a private Cloudflare R2 bucket, and schedule **daily Postgres backups** to it.
20. Hetzner's own server backups (step 3) are the second layer.
21. **Test a restore once** into a throwaway database. A backup you never restored is a hope, not a backup.

### 7.6 Hetzner + Coolify: Good And Bad

| Good 👍 | Bad 👎 |
|---|---|
| About one third of Railway's price for twice the memory | You are the admin: updates, disk space, security |
| Fixed monthly price, no usage surprises | One machine: if it dies, everything is down until restored |
| Runs Chromium and Temporal comfortably | EU only for the cheap CX line, so a bit slower from India |
| Same setup can become production later (on a second server) | First setup takes 1 to 2 days, a risk on a 4-day deadline |

---

## 8. Step By Step: Hostinger VPS + Coolify (Cheapest In India) 🇮🇳

**Time:** about 1 day the first time (less than Hetzner, because Coolify comes pre-installed).
**Result:** one 8 GB server in Mumbai running all of PostGear with Docker, automatic HTTPS and git deploys.

This is the same recipe as Hetzner (section 7). Only the buying and server setup steps differ.

### 8.1 Buy The Right Product
1. Go to Hostinger's **VPS Hosting** page (hostinger.in for rupee prices). **Not** "Web Hosting" and **not** "Cloud Hosting": those cannot run PostGear (section 4.2).
2. Pick **KVM 2** (2 vCPU, 8 GB RAM, 100 GB NVMe).
3. In the cart, choose the term:
   - **1 month:** ₹1,299, plus 18% GST = **₹1,532.82 total** (seen in a real cart). It renews at ₹2,099 per month, so **turn off auto-renew** if you only want one month. Best for a short demo.
   - **24 months:** ₹779 per month, ₹18,696 upfront, plus GST. Best only once the product is real.
   - Leave the optional "Daily auto-backup" (₹589 per month) **unticked**.
4. Pay. Note the date: you have a **30-day money-back guarantee** if it does not work out.

### 8.2 Set Up The Server In hPanel
5. In Hostinger's dashboard (hPanel), start the VPS setup.
6. **Location: India (Mumbai).** This cannot be changed later without wiping the server.
7. **Operating system:** open the **"OS with Panel"** tab and choose **"Ubuntu 24.04 with Coolify"**. (Dokploy is also offered; this guide uses Coolify, like section 7.)
8. Set a strong **root password** and add your **SSH public key**.
9. Wait for the server to finish installing. Note its **IP address**.

### 8.3 Lock It Down
10. Firewall: allow only **22** (SSH, ideally only your IP), **80**, **443**, and **8000** for the first Coolify login. Use hPanel's VPS firewall if your plan shows one ❓, otherwise the cloud firewall of your choice. Do **not** open database ports (5432, 6379, 7233) to the internet.
11. SSH in (`ssh root@<server-ip>`) and do the same hardening as **section 7.2**: updates, automatic security updates, and a 4 GB swap file.

### 8.4 Coolify And PostGear
12. Open `http://<server-ip>:8000` **straight away** and create the admin account (the first visitor becomes admin).
13. Point `coolify.rkay.in` at the server in Cloudflare, set it as Coolify's domain, then close port 8000.
14. Follow **section 7.4** exactly (connect GitHub, deploy `docker-compose.prod.yml`, environment variables, domains, migrations, auto deploy).
15. Follow **section 7.5** for backups. This matters more here: Hostinger's built-in backups are **weekly**, so set Coolify to back up Postgres to R2 **every day**.

**Alternative to Coolify:** Hostinger's own **Docker Manager** can run a Docker Compose project from the dashboard. It is simpler, but you would handle git deploys and HTTPS yourself, so Coolify is still my pick.

### 8.5 After It Runs
16. Run one SEO audit and watch **CPU usage in hPanel**. If CPU gets throttled (the CPU credits rule), set `SEO_MAX_CONCURRENT_AUDITS=1` or move up to KVM 4.
17. Put a reminder in your calendar **one month before the 24-month renewal**, when the price goes from ₹779 to ₹1,199 per month.

### 8.6 Hostinger VPS: Good And Bad

| Good 👍 | Bad 👎 |
|---|---|
| Cheapest per month in this guide for 8 GB (₹779) | 24 months paid upfront for that price (₹18,696, plus GST if charged) |
| Servers in Mumbai, closest to you and Indian users | Only 2 vCPU, and CPU can be throttled to 20% when credits run out |
| Coolify or Dokploy pre-installed as a template | Weekly backups only (do daily database backups yourself) |
| Rupee pricing, 30-day money-back guarantee | You are the admin, like any single server |
| 8 TB of bandwidth included | Renewal price is about 1.5 times the first-term price |

---

## 9. Step By Step: Fly.io 🎈

**Time:** about a day. Fly is driven mostly from the command line.

1. Install the CLI (`flyctl`) and run `fly auth login`. Add a card (Fly bills from day one ❓ check for any trial).
2. Create one Fly app per service: `postgear-web`, `postgear-api`, `postgear-worker`, `postgear-temporal` (and `postgear-db` if you run Postgres yourself). Choose region **`bom` (Mumbai)**, or **`sin` (Singapore)** if you want Managed Postgres in the same region.
3. For each app, write a `fly.toml` that points at its Dockerfile, and run `fly deploy` from the repo root.
4. **Machines must stay on** for worker and Temporal: do not add an `[http_service]` to them, and turn off auto stop. For web and api, set `min_machines_running = 1` so they never sleep.
5. Database:
   - Cheaper: run Postgres yourself as a Fly app with a volume (`fly volumes create`). You own its backups.
   - Easier: **Managed Postgres** ($38 per month Basic) in `sin`, with backups and high availability included.
6. Redis: `fly redis create` (Upstash Redis through Fly) or the Upstash free tier directly.
7. Secrets: `fly secrets set KEY=value -a postgear-api` (repeat per app).
8. Private networking: apps reach each other at `<app-name>.internal`. Fly's private network is **IPv6**, so Temporal must listen on `::` (set `BIND_ON_IP=::`) and clients must connect over IPv6. ❓ Test this first; it is the most likely snag.
9. Run migrations with a `release_command` in the api's `fly.toml` (`npx prisma migrate deploy ...`).
10. Domains: `fly certs add postgear-staging.rkay.in -a postgear-web` (and the api), then add the DNS records Fly prints into Cloudflare.

| Good 👍 | Bad 👎 |
|---|---|
| Mumbai region (closest to you) | Most work of the PaaS options; config files per app |
| Pay only for small machines | IPv6 private network needs care for Temporal |
| Managed Postgres available | Managed Postgres alone costs $38+ |

---

## 10. Step By Step: Oracle Cloud Always Free 🆓

**Time:** 1 to 3 days (capacity waits are common).

1. Sign up at oracle.com/cloud/free. **Choose the home region carefully: Mumbai or Hyderabad.** It cannot be changed. A card is needed for identity checks.
2. Create a compute instance: shape **VM.Standard.A1.Flex** (Arm), as many OCPU and GB as your free allowance allows (2 OCPU / 12 GB is enough), image **Ubuntu 24.04**. If you see "Out of capacity", try another availability domain or try again later.
3. In the instance's **VCN security list**, open ports 80 and 443 (and 22 for SSH). Ubuntu images on Oracle also have their own `iptables` rules: open 80 and 443 there too, or traffic will not arrive.
4. Then follow **section 7.2 to 7.5** (harden, Coolify, deploy, backups). It is the same recipe on a different server.
5. **Arm check:** every image must support `linux/arm64`. Postgres, Redis, Temporal and Node images do. Build PostGear's own images for Arm (Coolify builds on the server, so this happens naturally). Playwright's Chromium supports Linux Arm64, but test an SEO audit early ❓.
6. To reduce the idle-reclaim risk, some people upgrade to a Pay As You Go account (still free within limits). That is community advice ❓, not an Oracle promise.

**Use it to learn or as a free spare, not as the only home of a scheduled investor demo.**

---

## 11. Step By Step: AWS Lightsail (One Server) 🟧

1. Create an AWS account (new accounts get the 6-month Free plan with $100 to $200 in credits ✅; check if Lightsail is eligible ❓).
2. Turn on **MFA for the root user** and create a **billing alarm** first.
3. Open Lightsail, create an instance in **Mumbai (ap-south-1)**, platform Linux, blueprint **OS only → Ubuntu 24.04**, plan **8 GB ($44)**.
4. Attach a **static IP** (free while attached to a running instance).
5. In the instance **Networking** tab, allow HTTP (80) and HTTPS (443).
6. Turn on **automatic snapshots**.
7. Follow **section 7.2 to 7.5** (harden, Coolify or plain Docker Compose, deploy, backups to R2).

Difference from Hetzner: about 3.5 times the price, but an AWS-backed server in Mumbai with 5 TB of transfer included.

---

## 12. Step By Step: DigitalOcean 🌊

**Option A, one Droplet (recommended within DigitalOcean):**
1. Create an account, add a card, turn on 2FA.
2. Create a Droplet: **Ubuntu 24.04**, region **Bangalore (BLR1)**, **Basic 8 GiB / 4 vCPU ($48)**, SSH key, backups on.
3. Add a **Cloud Firewall**: 22 (your IP), 80, 443.
4. Follow **section 7.2 to 7.5**.

**Option B, Droplet + Managed PostgreSQL ($39 total):**
1. Create a 4 GiB Droplet ($24) and a Managed PostgreSQL cluster ($15) in the same region.
2. Add the Droplet as a **trusted source** on the database.
3. Run everything except Postgres on the Droplet. Point `DATABASE_URL` at the managed cluster. Temporal also needs its two databases there: create users and databases with the cluster's admin user, or let `auto-setup` create them.

**Option C, App Platform:** works (web and api as services, worker and Temporal as workers, managed databases), but costs $100+ for this stack. Not worth it here.

---

## 13. Step By Step: Render 🎨

**Time:** half a day. Render is about as easy as Railway, but roughly 2.5 times the price for this stack.

1. Sign up with GitHub. Stay on the free **Hobby workspace** (you pay only for compute).
2. Write a `render.yaml` **Blueprint** at the repo root describing everything in region **singapore**:
   - `web` (type web, runtime docker, `dockerfilePath: ./infra/docker/Dockerfile.web`, plan starter or standard)
   - `api` (type web, runtime docker, plan standard, `healthCheckPath: /health`, `preDeployCommand: npx prisma migrate deploy --schema packages/db/prisma/schema.prisma`)
   - `worker` (type worker, runtime docker, plan starter)
   - `temporal` (type pserv, a private service, from the Temporal Dockerfile, plan standard)
   - a Postgres database (basic-1gb) and a Key Value instance (256 MB)
   (Check field names against Render's Blueprint spec when writing it ❓.)
3. In Render, **New → Blueprint**, pick the repo. Render creates every service.
4. Put secrets in an **Environment Group** named `staging` and link it to api and worker.
5. Private networking: services in the **same region** reach each other by their internal hostname (shown on each service page). Use it for `TEMPORAL_HOST`.
6. Add custom domains on web and api; add the CNAMEs in Cloudflare (api as DNS only).
7. Do **not** use free instances for anything here: free web services sleep after 15 minutes and free Postgres is deleted after 30 days.

---

## 14. Step By Step: Northflank (Brief) 🧭

1. Sign up; the free Sandbox covers 2 services and 1 database, so plan for pay-as-you-go.
2. Create a project in the nearest region offered.
3. Add an **addon** for Postgres and one for Redis.
4. Create **combined services** (build + deploy) for web and api from GitHub with their Dockerfiles, a **deployment service** for worker, and one for Temporal (internal port only).
5. Put secrets in a **secret group** linked to the project.
6. Add domains and DNS records in Cloudflare.

Reasonable option, but I could not verify its exact plan shapes, so its price is the least certain in this guide.

---

## 15. Step By Step: The Big Clouds (Azure, Google Cloud, Full AWS) 🏢

Short versions, because I do **not** recommend them for this POC. They are listed so you know what each involves.

**Azure (Container Apps):**
1. Create a free account ($200 for 30 days, 12 months of some free services ✅). Turn on a **budget alert** first.
2. Create a resource group in **Central India**, a **Container Apps environment**, and an **Azure Container Registry** (or use GitHub Container Registry).
3. Create **Azure Database for PostgreSQL Flexible Server, Burstable B1ms** (free 12 months on the free account). Allow access from the Container Apps environment.
4. Create container apps: web and api with external ingress, worker with no ingress and **min replicas 1**, Temporal with internal TCP ingress on 7233 and min replicas 1, Redis as a container app (cheaper than Azure Cache for Redis ❓).
5. Store secrets as Container Apps secrets; add custom domains with managed certificates.
Watch out: always-on containers use up the free grant fast; after that, about $62 per busy vCPU per month.

**Google Cloud (Cloud Run):**
1. New accounts usually get a free trial credit ❓ (check the current amount). Set a **budget alert**.
2. Cloud Run services for web and api (region **asia-south1, Mumbai**); worker and Temporal need **always-on instances** (min instances with instance-based billing, or the newer Cloud Run instances).
3. Cloud SQL for Postgres, Memorystore or a container for Redis, a **Serverless VPC connector** or Direct VPC egress so services can talk privately.
Temporal's gRPC server and an always-on worker fight Cloud Run's request-driven model. Expect friction.

**Full AWS (ECS):**
1. VPC with public and private subnets, an Application Load Balancer, ECR for images.
2. ECS cluster on Fargate: services for web, api, worker, Temporal (desired count 1 each). App Runner is **closed to new customers since 2026-04-30** ✅; AWS suggests ECS Express Mode as the simple path.
3. RDS Postgres (db.t4g.micro class), ElastiCache Redis, Secrets Manager, ACM certificates, Route 53 or Cloudflare DNS.
Days of work and $120 to $200 a month ❓. Worth it only at real production scale.

---

## 16. Step By Step: Vercel Or Netlify For The Web App Only ▲

Only if, later, you want the web app on a Next.js-specialised host and the rest elsewhere.

**Vercel:**
1. Sign up, choose **Pro ($20)** (Hobby is non-commercial only ✅).
2. **Add New → Project**, import the repo, set **Root Directory** to `apps/web`. Vercel detects Next.js and the Turborepo monorepo.
3. Add environment variables (`NEXT_PUBLIC_API_URL=https://api.postgear-staging.rkay.in` and the rest).
4. Add the domain `postgear-staging.rkay.in`; add the DNS record Vercel shows in Cloudflare.
5. Keep api, worker, Temporal, Postgres and Redis on Railway or a VPS.

**Netlify:** same idea. Import the repo, base directory `apps/web`, Netlify's Next.js adapter is applied automatically; pick Personal ($9) or Pro ($20) based on credits needed.

**Things that can bite:** server components call the API with `serverApi()`, which forwards cookies, so web and API must keep the shared `COOKIE_DOMAIN`. Vercel functions have time limits (300 seconds default ✅), which is fine for pages but is one more thing to think about. Because of these, I would only do this after the demo.

---

## 17. The Extra Services Every Option Uses 🧩

| Need | Recommended | Free tier (✅ official) | Paid after | Notes |
|---|---|---|---|---|
| DNS, DDoS cover | **Cloudflare** | Free plan | | Move `rkay.in` DNS here first |
| Media storage | **Cloudflare R2** | 10 GB storage, 1M writes, 10M reads per month, **no egress fees** | $0.015 per GB-month | Social platforms fetch media by public URL, so use a custom domain like `media-staging.rkay.in` |
| Email | **Resend** | 3,000 per month, 100 per day | $20 for 50,000 | Set up SPF, DKIM records in Cloudflare (DNS only) |
| Errors | **Sentry** | Free developer tier | | Already wired in |
| Temporal | **Self-host** (as above) | $0 | | See below |
| Postgres (if not on the host) | Neon or Supabase, see below | | | Not recommended for this stack |
| Redis (if not on the host) | **Upstash** | 500K commands per month, 250 MB | $0.20 per 100K commands | Fine for a quiet demo |

**Temporal Cloud instead of self-hosting?** Recent official pages (September 2026) say Temporal Cloud is now **pay-as-you-go with no monthly base fee**, from **$50 per million actions** ✅. Some older plan pages still show an Essentials plan "from $100 per month", so check the live page. PostGear's code connects to Temporal with a plain address only, with **no TLS or API key support yet**, so Temporal Cloud needs code changes in `apps/worker/src/lib/temporal.ts` and the API's scheduling service. Keep self-hosting for the demo; revisit for production.

**Why not Neon or Supabase for Postgres?** Both are good, but:
- **Neon free** ✅ gives 100 compute-hours per project per month and suspends the database when that is used up. Temporal queries its database all the time, so the database never sleeps: 24 hours × 30 days = 720 hours, far above 100. It would be suspended mid-month.
- **Supabase free** ✅ pauses projects after a week of low activity and has 500 MB of storage. Supabase Pro is $25 per month.
- Keeping Postgres next to the app (same platform, private network) is simpler and faster.

**Why Upstash is only "fine for a quiet demo":** PostGear's rate limiter touches Redis on most API requests, plus login lockout, OAuth state and live run events. 500K commands a month is about 16,000 a day, enough for a few demo users but not for real traffic. On Railway, Redis costs about $1 to $2 a month anyway, so just use Railway's.

---

## 18. Staging Now, Production Later 🔀

| Rule | Why |
|---|---|
| **Separate databases, separate secrets, separate encryption keys** for staging and production | A staging mistake must never touch real customer data or tokens |
| **Separate OAuth redirect URIs** registered in every social platform portal for each environment | Callbacks are `<API_URL>/channels/connect/<provider>/callback` per environment |
| Staging: `postgear-staging.rkay.in` + `api.postgear-staging.rkay.in` | Already decided |
| Production: `postgear.rkay.in` + `api.postgear.rkay.in` | Different cookie domain, so the two can never share a session |
| Production gets **real backups with a tested restore**, uptime monitoring and alerts | Investors forgive a demo hiccup; customers do not forgive lost data |

**How each platform separates them:**
- **Railway:** a second environment (`production`) in the same project, or a separate project. Variables are per environment.
- **Hetzner + Coolify:** a **second server** for production (Coolify can manage both from one dashboard). Do not run staging and production on the same machine.
- **Hostinger VPS + Coolify:** the same rule: a second VPS for production (KVM 2 or KVM 4), added to the same Coolify dashboard.
- **Render / Fly / Northflank:** a separate set of services with an environment group or app prefix (`postgear-prod-*`).

**Suggested path:** Railway for staging now. After the demo, decide production on real numbers: stay on Railway Pro (simplest), or move to a VPS with Coolify (cheapest: Hostinger in Mumbai if you accept prepaying, Hetzner if you want monthly billing), with Temporal Cloud once publishing volume grows.

---

## 19. Demo-Day Safety Checklist ✅

1. ☐ Deploy freezes **48 hours before** the demo. No pushes to the deploy branch.
2. ☐ Fresh Postgres backup the evening before, stored in R2.
3. ☐ A **screen recording** of the full demo flow, in case the host has an outage that day (every host in this guide has had outages in 2026).
4. ☐ Usage alert and hard limit set on the host; OpenAI spend cap set.
5. ☐ Every simulation flag is off; real keys in place; the seeded demo passwords changed.
6. ☐ One real post published to each demo platform the day before.
7. ☐ Check the provider's status page on the morning of the demo.
8. ☐ All secrets (especially `ENCRYPTION_KEY_AES256`, which unlocks every connected channel) saved in the password manager and one other safe place.

---

## 20. Sources (All Opened Or Searched On 2026-11-12) 🔗

**Railway**
- Pricing and plans: https://railway.com/pricing and https://docs.railway.com/pricing
- Free trial: https://docs.railway.com/pricing/free-trial
- Regions: https://docs.railway.com/deployments/regions

**Render**
- Pricing (prices not machine-readable): https://render.com/pricing
- Compute plans (sizes, August 2026 rename, no price change): https://render.com/docs/compute-plans
- Free tier limits: https://render.com/docs/free
- Regions: https://render.com/docs/regions
- Price trackers used for dollar amounts: https://pricingsaas.com/companies/render, https://staxly.dev/platforms/render

**Fly.io**
- Pricing: https://docs.fly.io/about/pricing and https://fly.io/pricing/
- Managed Postgres: https://fly.io/docs/mpg/
- Regions: https://fly.io/docs/reference/regions/

**Hetzner, Coolify, Dokploy**
- Hetzner price adjustment (2026-06-15): https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
- Price table summary: https://northflank.com/blog/hetzner-cloud-server-price-increases
- Coolify: https://coolify.io/pricing and https://coolify.io/docs/quickstart
- Dokploy licensing review: https://isitreallyfoss.com/projects/dokploy/

**Hostinger** (all official pages)
- VPS plans and prices (USD): https://www.hostinger.com/vps-hosting
- VPS plans and prices (INR): https://www.hostinger.com/in/vps-hosting
- India VPS: https://www.hostinger.com/vps/servers/india
- Mumbai data center: https://www.hostinger.com/blog/hostinger-newly-launched-data-center-location-in-india
- Coolify template: https://www.hostinger.com/vps/coolify-hosting
- Dokploy template: https://www.hostinger.com/in/vps/dokploy-hosting
- Plan limits, including VPS CPU credits: https://www.hostinger.com/support/6976044-parameters-and-limits-of-hosting-plans-in-hostinger/
- Node.js web hosting limits: https://www.hostinger.com/support/hostinger-node-js-limits-for-web-and-cloud-plans/
- GST note (coupon site, not official): https://zoutons.com/news/hostinger-vps-hosting-price-india-2026

**Oracle**
- Always Free resources: https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm
- Reported 2026 cut (unconfirmed): https://braindetox.kr/en/posts/oracle_always_free_tier_reduced_2026.html

**AWS**
- Lightsail pricing: https://aws.amazon.com/lightsail/pricing/
- Free plan and credits: https://aws.amazon.com/free/free-tier-faqs/
- App Runner availability change: https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html

**DigitalOcean**
- Droplets: https://www.digitalocean.com/pricing/droplets
- App Platform: https://docs.digitalocean.com/products/app-platform/details/pricing/
- Managed PostgreSQL: https://docs.digitalocean.com/products/databases/postgresql/details/pricing/

**Azure**
- Container Apps billing: https://learn.microsoft.com/en-us/azure/container-apps/billing
- Free account: https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account
- PostgreSQL B1ms price (third party): https://www.bytebase.com/dbcost/azure-flexible/instance/B1ms/
- Container Apps rate (third party): https://www.devzero.io/blog/azure-container-apps-pricing
- App Service B1 (third party): https://www.usage.ai/blogs/azure/app-service-pricing/

**Google Cloud**
- Cloud Run pricing: https://cloud.google.com/run/pricing
- Cloud Run instances: https://cloud.google.com/blog/products/serverless/introducing-cloud-run-instances

**Vercel and Netlify**
- Vercel pricing: https://vercel.com/pricing; Hobby limits: https://vercel.com/docs/plans/hobby; function limits: https://vercel.com/docs/functions/limitations
- Netlify plans: https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/ and https://www.netlify.com/changelog/2026-07-14-pro-plan-credit-tiers/

**Northflank, Koyeb**
- Northflank rates: https://northflank.com/blog/best-cloud-hosting-platforms
- Koyeb joining Mistral: https://koyeb.com/blog/koyeb-is-joining-mistral-ai-to-build-the-future-of-ai-infrastructure

**Extra services**
- Cloudflare R2: https://developers.cloudflare.com/r2/pricing/
- Neon: https://neon.com/docs/introduction/plans
- Supabase: https://supabase.com/pricing and https://supabase.com/kb/faqs/platform/free-project-pausing
- Upstash: https://upstash.com/pricing/redis
- Temporal Cloud: https://temporal.io/pricing
- Resend: https://resend.com/pricing (from doc 05, same day)
