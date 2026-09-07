# 🏗️ PostGear — Project Setup & Directory Architecture Blueprint

---

> **Project Name**: **PostGear**  
> **Architecture Pattern**: Modern Turborepo / pnpm Monorepo  
> **Tech Stack**: Next.js (App Router), Node.js/TypeScript (API & Worker), PostgreSQL + Prisma ORM, Redis, Temporal.io, Playwright, LangChain/Mastra, Tailwind CSS.  
> **Document Purpose**: Production-grade folder structure blueprint and step-by-step setup guide for building PostGear from scratch.

---

## 1. High-Level Monorepo Architecture Overview

PostGear is organized as a high-performance **TypeScript Monorepo** powered by **Turborepo** and **pnpm workspaces**. This divides the project into isolated, reusable applications (`apps/`) and internal shared packages (`packages/`).

```
PostGear (Monorepo Root)
├── 📂 apps/
│   ├── 🌐 web/                 # Next.js (App Router) SaaS Dashboard & Web Client
│   ├── ⚡ api/                 # Node.js API Server (Auth, REST, Webhooks, Multi-tenant RBAC)
│   └── ⚙️ worker/              # Temporal.io & BullMQ Worker (Post Orchestration & SEO Crawling)
├── 📂 packages/
│   ├── 🗄️ db/                  # Prisma Schema, Migrations, Database Client & Seeders
│   ├── 🔌 social-core/          # Abstract Social SDKs (X, Instagram, FB, LinkedIn, YouTube)
│   ├── 🔍 seo-engine/           # Playwright Web Crawler & Proprietary SEO Scoring Algorithm
│   ├── 🤖 ai-engine/            # LangChain/Mastra AI Agents, Tavily Search & Prompt Generators
│   ├── 🎨 ui/                   # Shared React Design System & Component Library (Shadcn/UI)
│   └── ⚙️ config/              # Shared TS, ESLint, Prettier & Tailwind Configurations
├── 📂 infra/                    # Docker, Kubernetes, Nginx & Deployment Manifests
├── 📂 scripts/                  # Project Bootstrapping, Seed, & Maintenance Scripts
├── 📄 docker-compose.yml        # Local Dev Stack (PostgreSQL, Redis, Temporal, LocalStack/S3)
├── 📄 turbo.json                # Turborepo Build Cache & Execution Pipeline Config
├── 📄 pnpm-workspace.yaml       # pnpm Workspace Package Definitions
└── 📄 .env.example              # Environment Variable Specification Template
```

---

## 2. Granular Directory Breakdown

### 2.1 Monorepo Root Level
```
PostGear/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml               # Lint, Type-check, Unit & Integration Tests
│   │   └── deploy-staging.yml   # Staging & Production Deployment Pipeline
│   └── PULL_REQUEST_TEMPLATE.md
├── infra/
│   ├── docker/
│   │   ├── Dockerfile.web
│   │   ├── Dockerfile.api
│   │   └── Dockerfile.worker
│   └── k8s/                     # Helm charts / Kubernetes manifests (Production)
├── scripts/
│   ├── bootstrap.sh             # Automatic local environment setup script
│   ├── (db seeding lives in packages/db/prisma/seeds/index.ts)
│   └── generate-keys.ts         # RSA/AES key pair generator for auth & encryption
├── .env.example                 # Comprehensive environment variable definitions
├── .gitignore
├── .prettierrc
├── docker-compose.yml           # Postgres (5432), Redis (6379), Temporal (7233/8233), MinIO/S3 (9000)
├── package.json                 # Monorepo root scripts & devDependencies
├── pnpm-workspace.yaml          # Defines packages: ['apps/*', 'packages/*']
├── README.md
├── tsconfig.json                # Base TypeScript compiler configuration
└── turbo.json                   # Turborepo pipeline tasks setup
```

---

### 2.2 `apps/web` — Next.js SaaS Web Application
```
apps/web/
├── public/
│   ├── favicon.ico
│   ├── logo.svg
│   └── static/
├── src/
│   ├── app/                     # Next.js App Router Pages & Layouts
│   │   ├── (auth)/              # Unauthenticated Auth Route Group
│   │   │   ├── login/page.tsx
│   │   │   ├── register/page.tsx
│   │   │   ├── reset-password/page.tsx
│   │   │   └── layout.tsx
│   │   ├── (dashboard)/         # Authenticated Workspace Dashboard Group
│   │   │   ├── [orgId]/
│   │   │   │   ├── channels/page.tsx      # Social Accounts & OAuth Connections
│   │   │   │   ├── composer/page.tsx      # Multi-platform Post Composer & TipTap
│   │   │   │   ├── calendar/page.tsx      # Visual Interactive Calendar
│   │   │   │   ├── queue/page.tsx         # Post Queue & Status Tracking
│   │   │   │   ├── ai-copilot/page.tsx    # CopilotKit AI Assistant View
│   │   │   │   ├── seo-analyzer/page.tsx  # SEO Score Prediction Engine
│   │   │   │   ├── analytics/page.tsx     # Unified Social & Post Metrics
│   │   │   │   ├── media/page.tsx         # Central Media Library Asset Manager
│   │   │   │   ├── settings/
│   │   │   │   │   ├── billing/page.tsx   # Stripe Subscription & Usage Limits
│   │   │   │   │   ├── team/page.tsx      # Team Members & RBAC Roles
│   │   │   │   │   └── api-keys/page.tsx  # Public API Key Management
│   │   │   │   └── layout.tsx
│   │   │   └── layout.tsx
│   │   ├── api/                 # Next.js Client API Proxies / Edge Handlers
│   │   ├── globals.css          # Design Tokens & Tailwind Base Directives
│   │   └── layout.tsx           # Root Application Shell
│   ├── components/              # App-Specific React Components
│   │   ├── analytics/           # Recharts Social Analytics Widgets
│   │   ├── calendar/            # Interactive Scheduler Grid & Event Cards
│   │   ├── composer/            # TipTap Editor, Multi-Target Selector, Threads
│   │   ├── previews/            # Live Social Preview Cards (X, IG, FB, LI, YT)
│   │   ├── seo/                 # SEO Audit Score Meters & AI Checklist Cards
│   │   └── navigation/          # Org Switcher, Sidebar, Top Bar, User Profile
│   ├── hooks/                   # Custom React Hooks (usePost, useOrg, useSEO)
│   ├── lib/                     # Client Utilities, API Fetcher (Axios/TanStack Query)
│   ├── store/                   # Zustand Global UI State (Composer, Filters)
│   └── types/                   # Frontend TypeScript Type Definitions
├── next.config.mjs
├── package.json
├── tailwind.config.js
└── tsconfig.json
```

---

### 2.3 `apps/api` — Core REST & Webhook Backend Server
```
apps/api/
├── src/
│   ├── modules/                 # Domain Feature Modules
│   │   ├── auth/                # Auth Service, JWT Strategy, OAuth Callbacks
│   │   ├── org/                 # Organization Multi-Tenancy & Workspace Scope
│   │   ├── users/               # Profile Management & Notification Prefs
│   │   ├── channels/            # Social Channel Connections & OAuth Token Handlers
│   │   ├── posts/               # Post CRUD, Drafts, Threads & State Engine
│   │   ├── scheduling/          # Slot Manager & Temporal Trigger Dispatcher
│   │   ├── seo/                 # SEO Analysis Proxy Controller & History API
│   │   ├── analytics/           # Performance Metrics Collector & Aggregator
│   │   ├── billing/             # Stripe Checkout Sessions, Portal & Webhooks
│   │   ├── notifications/       # Real-time WebSocket/SSE & Email Dispatcher
│   │   ├── developers/          # API Key Authentication & Public REST V1 API
│   │   └── admin/               # System Super-Admin Controls & Analytics
│   ├── common/                  # Cross-Cutting Concerns
│   │   ├── middleware/          # Tenant Context Extraction, Rate-Limiting, Audit Logger
│   │   ├── guards/              # Role-Based Access Control (RBAC Policies)
│   │   ├── decorators/          # Custom Nest/Express Parameter Decorators
│   │   ├── filters/             # Global HTTP Exception Filter
│   │   └── interceptors/        # Response Transformer Interceptor
│   ├── config/                  # App Configuration (Env Validation via Zod)
│   └── main.ts                  # Server Entry Point & Swagger Setup
├── package.json
└── tsconfig.json
```

---

### 2.4 `apps/worker` — Background Job & Temporal Worker Engine
```
apps/worker/
├── src/
│   ├── workflows/               # Temporal Workflow Definitions
│   │   ├── post-publish.workflow.ts    # Fault-tolerant scheduled post execution
│   │   ├── token-refresh.workflow.ts   # Auto OAuth token refresh before expiry
│   │   ├── seo-crawler.workflow.ts     # Asynchronous deep URL web crawling
│   │   └── analytics-sync.workflow.ts  # Daily social metrics synchronization
│   ├── activities/              # Temporal Activity Implementations
│   │   ├── social-publisher.activities.ts  # Calls `packages/social-core`
│   │   ├── crawler.activities.ts           # Calls `packages/seo-engine`
│   │   ├── token-refresh.activities.ts     # Updates DB credentials
│   │   └── notification.activities.ts      # Sends failure email alerts
│   ├── queues/                  # BullMQ Local Queue Processors (Fast Tasks)
│   └── index.ts                 # Worker Process Initialization & Health Check
├── package.json
└── tsconfig.json
```

---

### 2.5 `packages/db` — Prisma Schema & Database Layer
```
packages/db/
├── prisma/
│   ├── schema.prisma            # Core PostgreSQL Entity Models & Enums
│   ├── migrations/              # Database Migration History
│   └── seeds/                   # System Default Plan Tiers & Initial Data
├── src/
│   ├── client.ts                # Instantiated Prisma Client with Extensions
│   ├── types.ts                 # Re-exported Prisma Schema Types
│   └── index.ts                 # Package Exports
├── package.json
└── tsconfig.json
```

---

### 2.6 `packages/social-core` — Modular Social Media Integrations
```
packages/social-core/
├── src/
│   ├── abstract/
│   │   └── social.abstract.ts   # Base TypeScript Abstract Interface Class
│   ├── providers/               # Social Network Implementation Modules
│   │   ├── twitter/             # X (Twitter) API v2 Integration (OAuth2 PKCE)
│   │   ├── instagram/           # Instagram Business Graph API
│   │   ├── facebook/            # Facebook Pages API
│   │   ├── linkedin/            # LinkedIn v2 Share & Assets API
│   │   ├── youtube/             # YouTube Data API v3
│   │   ├── tiktok/              # TikTok Content Posting API (v1)
│   │   └── pinterest/           # Pinterest API v5
│   ├── manager/
│   │   └── integration.manager.ts # Integration Registry & Token Cryptography
│   └── index.ts                 # Package Entry Point
├── package.json
└── tsconfig.json
```

---

### 2.7 `packages/seo-engine` — Web Crawler & SEO Prediction Engine
```
packages/seo-engine/
├── src/
│   ├── crawler/                 # Playwright Headless Web Crawler
│   │   ├── browser.pool.ts      # Browser instance pooling & proxy rotators
│   │   └── html.parser.ts       # Meta, OpenGraph, Headings & DOM Extractor
│   ├── scoring/                 # Proprietary Multi-Factor Scoring Engine
│   │   ├── on-page.evaluator.ts   # Title, Meta description, H1-H6 structure
│   │   ├── technical.evaluator.ts # Speed metrics, SSL, Robots.txt, Sitemap
│   │   ├── content.evaluator.ts   # Readability index, Keyword density math
│   │   └── score.calculator.ts    # Weighted algorithm (0-100 composite)
│   └── index.ts
├── package.json
└── tsconfig.json
```

---

### 2.8 `packages/ai-engine` — LangChain / Mastra AI Pipeline
```
packages/ai-engine/
├── src/
│   ├── agents/                  # Mastra / LangChain Autonomous Agents
│   │   ├── content.agent.ts     # Research + Hook + Post Generator Agent
│   │   ├── seo-advisor.agent.ts # Actionable SEO Fix Recommendation Agent
│   │   └── copilot.agent.ts     # Conversational Assistant Agent
│   ├── tools/                   # Agent Execution Tools
│   │   ├── tavily-search.tool.ts # Web Search Integration
│   │   └── dalle-image.tool.ts   # DALL-E 3 Image Generation Tool
│   ├── prompts/                 # Standardized System Prompts & Tone Specs
│   └── index.ts
├── package.json
└── tsconfig.json
```

---

### 2.9 `packages/ui` — Shared Design System Component Library
```
packages/ui/
├── src/
│   ├── components/              # Primitive Shadcn / Radix UI Components
│   │   ├── button.tsx
│   │   ├── dialog.tsx
│   │   ├── dropdown-menu.tsx
│   │   ├── input.tsx
│   │   ├── select.tsx
│   │   ├── badge.tsx
│   │   ├── toast.tsx
│   │   └── avatar.tsx
│   ├── icons/                   # Custom SVG Brand Icons
│   └── index.ts
├── package.json
└── tsconfig.json
```

---

## 3. Database Schema Models Reference (`schema.prisma`)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum Role {
  SUPERADMIN
  ADMIN
  USER
}

enum PostStatus {
  DRAFT
  QUEUED
  PUBLISHED
  FAILED
}

model User {
  id            String       @id @default(cuid())
  email         String       @unique
  passwordHash  String?
  name          String
  avatarUrl     String?
  timezone      String       @default("UTC")
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt
  memberships   Member[]
  accounts      Account[]
}

model Organization {
  id            String       @id @default(cuid())
  name          String
  slug          String       @unique
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt
  members       Member[]
  channels      Channel[]
  posts         Post[]
  seoAudits     SEOAudit[]
  subscription  Subscription?
  apiKeys       ApiKey[]
}

model Member {
  id             String       @id @default(cuid())
  role           Role         @default(USER)
  userId         String
  organizationId String
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([userId, organizationId])
}

model Channel {
  id             String       @id @default(cuid())
  provider       String       // "twitter", "instagram", "linkedin", etc.
  accountName    String
  accountHandle  String
  avatarUrl      String?
  accessToken    String       // Encrypted AES-256
  refreshToken   String?      // Encrypted AES-256
  expiresAt      DateTime?
  postingSlots   Json?        // Target daily time slots
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  posts          PostItem[]
}

model Post {
  id             String       @id @default(cuid())
  content        String
  status         PostStatus   @default(DRAFT)
  scheduledAt    DateTime?
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  items          PostItem[]
  media          MediaAsset[]
  createdAt      DateTime     @default(now())
}

model PostItem {
  id             String       @id @default(cuid())
  postId         String
  channelId      String
  publishedId    String?      // External platform ID returned upon publishing
  status         PostStatus   @default(QUEUED)
  errorMessage   String?
  post           Post         @relation(fields: [postId], references: [id], onDelete: Cascade)
  channel        Channel      @relation(fields: [channelId], references: [id], onDelete: Cascade)
}

model SEOAudit {
  id             String       @id @default(cuid())
  targetUrl      String
  overallScore   Int
  grade          String
  onPageScore    Int
  technicalScore Int
  contentScore   Int
  backlinkScore  Int
  auditData      Json         // Full break-down JSON
  aiAdvice       Json         // Prioritized AI checklist
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  createdAt      DateTime     @default(now())
}

model MediaAsset {
  id             String       @id @default(cuid())
  url            String
  fileType       String
  fileSize       Int
  postId         String?
  post           Post?        @relation(fields: [postId], references: [id], onDelete: SetNull)
  createdAt      DateTime     @default(now())
}

model Subscription {
  id             String       @id @default(cuid())
  stripeCustId   String       @unique
  stripeSubId    String       @unique
  planTier       String       // "FREE", "PRO", "AGENCY"
  status         String
  currentPeriodEnd DateTime
  organizationId String       @unique
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
}

model ApiKey {
  id             String       @id @default(cuid())
  keyHash        String       @unique
  name           String
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  createdAt      DateTime     @default(now())
}
```

---

## 4. Environment Variables Blueprint (`.env.example`)

```env
# -----------------------------------------------------------------------------
# DATABASE & REDIS CONFIGURATION
# -----------------------------------------------------------------------------
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgear_db?schema=public"
REDIS_URL="redis://localhost:6379"

# -----------------------------------------------------------------------------
# AUTHENTICATION & SECURITY
# -----------------------------------------------------------------------------
JWT_SECRET="super-secret-jwt-token-key-change-in-production-min-32-chars"
ENCRYPTION_KEY_AES256="32-byte-hex-string-for-encrypting-oauth-tokens-at-rest"
NEXTAUTH_SECRET="next-auth-secret-key"
NEXTAUTH_URL="http://localhost:3000"

# OAUTH AUTHENTICATION PROVIDERS
GOOGLE_CLIENT_ID="google-client-id"
GOOGLE_CLIENT_SECRET="google-client-secret"
FACEBOOK_CLIENT_ID="facebook-client-id"
FACEBOOK_CLIENT_SECRET="facebook-client-secret"

# -----------------------------------------------------------------------------
# SOCIAL PLATFORM OAUTH & API KEYS
# -----------------------------------------------------------------------------
X_TWITTER_CLIENT_ID="x-client-id"
X_TWITTER_CLIENT_SECRET="x-client-secret"
FACEBOOK_APP_ID="meta-app-id"
FACEBOOK_APP_SECRET="meta-app-secret"
LINKEDIN_CLIENT_ID="linkedin-client-id"
LINKEDIN_CLIENT_SECRET="linkedin-client-secret"
YOUTUBE_CLIENT_ID="youtube-client-id"
YOUTUBE_CLIENT_SECRET="youtube-client-secret"

# -----------------------------------------------------------------------------
# AI ENGINE & SEARCH APIS
# -----------------------------------------------------------------------------
OPENAI_API_KEY="sk-proj-openai-api-key"
ANTHROPIC_API_KEY="sk-ant-anthropic-api-key"
TAVILY_API_KEY="tvly-tavily-web-search-api-key"

# -----------------------------------------------------------------------------
# STRIPE MONETIZATION
# -----------------------------------------------------------------------------
STRIPE_SECRET_KEY="sk_test_stripe_secret_key"
STRIPE_WEBHOOK_SECRET="whsec_stripe_webhook_signing_secret"
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_stripe_publishable_key"

# -----------------------------------------------------------------------------
# STORAGE & SERVICES
# -----------------------------------------------------------------------------
S3_ENDPOINT="http://localhost:9000"
S3_BUCKET_NAME="postgear-media"
S3_ACCESS_KEY="minioadmin"
S3_SECRET_KEY="minioadmin"
TEMPORAL_HOST="localhost:7233"
```

---

## 5. Step-by-Step Project Initialization Script

To quickly create this exact directory tree locally from scratch, run the shell commands below:

```bash
# 1. Create root directory
mkdir postgear-app && cd postgear-app

# 2. Initialize pnpm & Turborepo
pnpm init
pnpm add -D turbo typescript prettier eslint

# 3. Create monorepo folder hierarchy
mkdir -p apps/web apps/api apps/worker
mkdir -p packages/db packages/social-core packages/seo-engine packages/ai-engine packages/ui packages/config
mkdir -p infra/docker infra/k8s scripts

# 4. Configure pnpm workspace
cat << 'EOF' > pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'packages/*'
EOF

# 5. Create root turbo.json
cat << 'EOF' > turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**"]
    },
    "lint": {},
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
EOF

# 6. Create root docker-compose.yml for local services
cat << 'EOF' > docker-compose.yml
version: '3.8'
services:
  postgres:
    image: postgres:15-alpine
    container_name: postgear_postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: postgear_db
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    container_name: postgear_redis
    ports:
      - "6379:6379"

  minio:
    image: minio/minio
    container_name: postgear_minio
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    command: server /data --console-address ":9001"
EOF

echo "✅ PostGear monorepo structure initialized successfully!"
```

---
*End of PostGear Blueprint Document.*
