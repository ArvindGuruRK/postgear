# 🚀 PostGear

> AI-Powered Social Media Management & SEO Platform

PostGear is a modern, full-stack SaaS application for managing social media content across multiple platforms, with built-in AI assistance and SEO analysis capabilities.

## Tech Stack

- **Frontend**: Next.js (App Router), React, Tailwind CSS, Shadcn/UI
- **Backend**: Node.js, TypeScript, REST API
- **Database**: PostgreSQL + Prisma ORM
- **Caching**: Redis
- **Workers**: Temporal.io & BullMQ
- **AI**: LangChain / Mastra, OpenAI, Tavily Search
- **SEO**: Playwright Web Crawler, Proprietary Scoring Engine
- **Payments**: Stripe
- **Storage**: S3-compatible (MinIO for local dev)
- **Build**: Turborepo + npm Workspaces

## Getting Started

<!-- TODO: Add detailed setup instructions -->

### Prerequisites

- Node.js >= 20.0.0
- Docker & Docker Compose
- npm >= 10.0.0

### Installation

```bash
# Clone the repository
git clone <repo-url> postgear
cd postgear

# Install dependencies
npm install

# Start local services (PostgreSQL, Redis, MinIO)
docker-compose up -d

# Setup the database
npm run db:generate
npm run db:migrate
npm run db:seed

# Start development
npm run dev
```

## Project Structure

```
PostGear/
├── apps/
│   ├── web/          # Next.js SaaS Dashboard
│   ├── api/          # REST API Server
│   └── worker/       # Background Job Worker
├── packages/
│   ├── db/           # Prisma Schema & Database Client
│   ├── social-core/  # Social Media Platform SDKs
│   ├── seo-engine/   # Web Crawler & SEO Scoring
│   ├── ai-engine/    # AI Agents & Prompt Pipelines
│   ├── ui/           # Shared Design System
│   └── config/       # Shared Configurations
├── infra/            # Docker & Kubernetes Manifests
└── scripts/          # Bootstrap & Maintenance Scripts
```

## License

<!-- TODO: Add license -->
