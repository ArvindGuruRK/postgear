/**
 * Environment validation.
 *
 * Parsed once at boot and thrown on immediately if anything is missing or
 * malformed, so a misconfigured deploy dies at startup with a readable list
 * rather than 500ing on the first login attempt an hour later.
 *
 * Zod (not class-validator) because it is already the tool
 * `project_structure.md` names for this job, and because the same library
 * validates request bodies in `common/pipes/zod-validation.pipe.ts` — one
 * validation vocabulary across the app.
 */
import { z } from 'zod';

/** Anything shorter is not a credible HMAC key for HS256. */
const MIN_SECRET_LENGTH = 32;

/** Reads an empty or whitespace-only variable as absent, so a schema default applies. */
function blankAsUnset<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema,
  );
}

/**
 * The `.env.example` placeholders for the Stripe keys. A fresh clone carries
 * them verbatim, and a placeholder must read as "no key" — the same rule the
 * AI module applies to `sk-proj-openai-api-key` — so the billing module
 * reports *unconfigured* rather than failing its first Stripe call.
 */
export const STRIPE_PLACEHOLDERS: readonly string[] = [
  'sk_test_stripe_secret_key',
  'whsec_stripe_webhook_signing_secret',
  'pk_test_stripe_publishable_key',
];

/** Blank or a known placeholder → absent. */
function placeholderAsUnset<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (value) =>
      typeof value === 'string' && (value.trim() === '' || STRIPE_PLACEHOLDERS.includes(value.trim()))
        ? undefined
        : value,
    schema,
  );
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3001),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    // Optional. Absent means RedisService falls back to an in-process Map, so
    // the API still boots without `docker compose up`. See redis.service.ts for
    // what that fallback does and does not guarantee.
    REDIS_URL: z.string().optional(),

    JWT_SECRET: z
      .string()
      .min(MIN_SECRET_LENGTH, `JWT_SECRET must be >= ${MIN_SECRET_LENGTH} chars`),
    JWT_EXPIRES_IN: z.string().default('7d'),

    // Required, not optional. Sprint 1 built `packages/db/src/crypto.ts` around
    // this key and Sprint 3 made it load-bearing: it is what encrypts
    // `Integration.token` / `refreshToken` at the repository boundary. Absent, the
    // API would boot happily and then fail the first time anyone connects a
    // channel — validating it here turns that into a startup error naming the fix.
    // Generate with `npm run generate:keys`.
    ENCRYPTION_KEY_AES256: z
      .string()
      .regex(
        /^[0-9a-fA-F]{64}$/,
        'ENCRYPTION_KEY_AES256 must be 32 bytes as 64 hex characters — run `npm run generate:keys`',
      ),

    AUTH_COOKIE_NAME: z.string().default('pg_session'),
    ORG_COOKIE_NAME: z.string().default('pg_org'),

    WEB_URL: z.string().url().default('http://localhost:3000'),
    API_URL: z.string().url().default('http://localhost:3001'),

    // OAuth. Optional so local development without provider apps still boots;
    // ProvidersManager reports a provider as unconfigured rather than crashing.
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    FACEBOOK_CLIENT_ID: z.string().optional(),
    FACEBOOK_CLIENT_SECRET: z.string().optional(),

    // Social *channel* credentials (Sprint 3). All optional, on the same
    // reasoning as the login providers above: a developer with no platform apps
    // registered still gets a working API, and the connect UI renders those
    // providers disabled with a reason rather than pretending they don't exist.
    //
    // Note FACEBOOK_APP_* is a *different Meta app* from FACEBOOK_CLIENT_* above.
    // Login needs only public_profile/email; publishing needs review-gated scopes
    // like pages_manage_posts. Sharing one app would put sign-in behind Meta's
    // app review, so a rejection there would take down authentication too.
    X_TWITTER_CLIENT_ID: z.string().optional(),
    X_TWITTER_CLIENT_SECRET: z.string().optional(),
    FACEBOOK_APP_ID: z.string().optional(),
    FACEBOOK_APP_SECRET: z.string().optional(),
    LINKEDIN_CLIENT_ID: z.string().optional(),
    LINKEDIN_CLIENT_SECRET: z.string().optional(),
    YOUTUBE_CLIENT_ID: z.string().optional(),
    YOUTUBE_CLIENT_SECRET: z.string().optional(),
    TIKTOK_CLIENT_KEY: z.string().optional(),
    TIKTOK_CLIENT_SECRET: z.string().optional(),
    PINTEREST_APP_ID: z.string().optional(),
    PINTEREST_APP_SECRET: z.string().optional(),

    // Media storage (Sprint 4). One variable picks the backend, which is the
    // factory pattern the sprint document asks for: develop against local disk,
    // deploy against S3 or any S3-compatible store (MinIO, Cloudflare R2) without
    // a code change. See `modules/media/storage/storage.factory.ts`.
    //
    // `local` is the default so a fresh clone uploads with no extra setup. It is
    // not suitable for production publishing: Instagram, Facebook, Pinterest and
    // TikTok fetch media from its URL themselves, and a localhost URL is
    // unreachable to them.
    STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
    // Absent means `apps/api/uploads`, resolved from the API package rather than
    // the working directory — `npm run dev:api` and `npm run dev:api:e2e` start
    // from different directories and would otherwise write to two places.
    UPLOAD_DIRECTORY: z.string().min(1).optional(),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET_NAME: z.string().min(1).optional(),
    S3_ACCESS_KEY: z.string().min(1).optional(),
    S3_SECRET_KEY: z.string().min(1).optional(),
    // Where the bucket's objects are publicly readable. Separate from
    // S3_ENDPOINT because the write endpoint is rarely the public one: R2 serves
    // reads from a custom domain or r2.dev, and a CDN usually fronts S3.
    S3_PUBLIC_URL: z.string().url().optional(),
    // MinIO needs path-style addressing; AWS prefers virtual-hosted. Absent means
    // path-style whenever a custom endpoint is set.
    S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).optional(),

    // The scheduler (Sprint 5). The API only *talks* to Temporal — starting and
    // signalling workflows — and does so best-effort, so an unreachable server
    // degrades to a logged warning rather than a failed save. The worker
    // (`apps/worker`) reads the same two variables.
    TEMPORAL_HOST: z.string().min(1).default('localhost:7233'),
    TEMPORAL_NAMESPACE: z.string().min(1).default('default'),

    // The AI engine (Sprint 6). Both keys optional: without an OpenAI key the
    // `/ai/*` routes answer 503 and the UI explains, rather than the API
    // refusing to boot for a feature a self-hoster may not want. Without a
    // Tavily key, generation runs unresearched and says so.
    //
    // `AI_SIMULATION=true` replaces the model, the research and the image
    // provider with deterministic stand-ins so every screen, credit rule and
    // test runs without a key or a bill — the same idea as the worker's
    // `PUBLISH_SIMULATION`. Refused in production below: a simulated post
    // looks real enough to be published by mistake.
    // See `modules/ai/engine/engine.config.ts` for how the mode is chosen.
    //
    // `.env.example` ships these as empty strings, which dotenv passes through
    // as `""` rather than leaving them unset — so a blank is read as "use the
    // default" here, or a fresh clone would fail to boot on the model name.
    OPENAI_API_KEY: z.string().optional(),
    TAVILY_API_KEY: z.string().optional(),
    AI_MODEL: blankAsUnset(z.string().min(1).default('gpt-4.1-mini')),
    AI_IMAGE_MODEL: blankAsUnset(z.string().min(1).default('dall-e-3')),
    AI_SIMULATION: blankAsUnset(z.enum(['true', 'false']).default('false')),

    // Analytics (Sprint 7). The worker does the syncing and reads the same
    // variable; the API only needs to know so `/analytics/*` can say the
    // numbers are a stand-in's. Blank means "follow PUBLISH_SIMULATION": a
    // deployment publishing to a stand-in has no real metrics to read either.
    // Refused in production below, like the other two simulation flags.
    ANALYTICS_SIMULATION: blankAsUnset(z.enum(['true', 'false']).optional()),
    PUBLISH_SIMULATION: blankAsUnset(z.enum(['true', 'false']).default('false')),

    // The SEO analyzer (Sprint 7). Every value has a safe default so a fresh
    // clone analyses a URL with no setup; see `modules/seo/seo.config.ts`.
    //
    // A crawl is a server-side fetch of a user-supplied URL, so the limits
    // here are load-bearing: the timeout is the sprint's hard 30 s ceiling,
    // the concurrency cap keeps a burst of analyses from exhausting the
    // process, and the user agent identifies the crawler honestly.
    SEO_CRAWL_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(60_000).default(30_000),
    SEO_MAX_CONCURRENT_AUDITS: z.coerce.number().int().min(1).max(10).default(2),
    // `auto` uses a headless browser when one can launch and falls back to a
    // plain HTML fetch; `off` never launches one (a small host without
    // Chromium); `on` fails the crawl rather than silently degrading.
    SEO_BROWSER: blankAsUnset(z.enum(['auto', 'on', 'off']).default('auto')),
    SEO_USER_AGENT: blankAsUnset(
      z.string().min(1).default('Mozilla/5.0 (compatible; PostGearBot/1.0; +https://postgear.rkay.in/bot)'),
    ),
    // Optional. With a key, the authority score comes from Open PageRank's
    // backlink index; without one it is estimated from on-page signals and
    // the UI says so.
    OPEN_PAGERANK_API_KEY: blankAsUnset(z.string().min(1).optional()),

    LOGIN_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
    LOCKOUT_THRESHOLD: z.coerce.number().int().positive().default(5),
    LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

    // Billing (Sprint 8). The mode is chosen like the AI engine's:
    //   BILLING_SIMULATION=true → no Stripe; checkout, plan changes and
    //     cancellation synthesise the Stripe events and run them through the
    //     real webhook handler, so every screen and the idempotency table are
    //     exercised with no account. Refused in production below.
    //   a real STRIPE_SECRET_KEY → Stripe (test-mode keys are free).
    //   neither → unconfigured: /billing/status says so, checkout answers 503.
    // The `.env.example` placeholders are read as unset (see STRIPE_PLACEHOLDERS).
    // See `modules/billing/billing.config.ts` for how the mode is chosen.
    BILLING_SIMULATION: blankAsUnset(z.enum(['true', 'false']).default('false')),
    STRIPE_SECRET_KEY: placeholderAsUnset(z.string().min(1).optional()),
    STRIPE_WEBHOOK_SECRET: placeholderAsUnset(z.string().min(1).optional()),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: placeholderAsUnset(z.string().min(1).optional()),
    // Optional: pin real Stripe price ids instead of the inline `price_data`
    // the plan table builds. Needed only if the Stripe billing portal should
    // offer plan switching, which requires dashboard-defined prices.
    STRIPE_PRICE_STANDARD_MONTHLY: blankAsUnset(z.string().min(1).optional()),
    STRIPE_PRICE_STANDARD_YEARLY: blankAsUnset(z.string().min(1).optional()),
    STRIPE_PRICE_PRO_MONTHLY: blankAsUnset(z.string().min(1).optional()),
    STRIPE_PRICE_PRO_YEARLY: blankAsUnset(z.string().min(1).optional()),
    STRIPE_PRICE_TEAM_MONTHLY: blankAsUnset(z.string().min(1).optional()),
    STRIPE_PRICE_TEAM_YEARLY: blankAsUnset(z.string().min(1).optional()),
    STRIPE_PRICE_ULTIMATE_MONTHLY: blankAsUnset(z.string().min(1).optional()),
    STRIPE_PRICE_ULTIMATE_YEARLY: blankAsUnset(z.string().min(1).optional()),
    // How long the no-card trial lasts. 0 disables trials.
    BILLING_TRIAL_DAYS: blankAsUnset(z.coerce.number().int().min(0).max(90).default(14)),

    // Rate limiting (Sprint 8). Both Redis-backed when REDIS_URL is set and
    // per-process otherwise, like the login throttle. The per-IP ceiling
    // covers every route; the per-key ceiling covers the public API, where a
    // 429 carries Retry-After because the caller is a program.
    RATE_LIMIT_PER_MIN: blankAsUnset(z.coerce.number().int().positive().default(300)),
    API_RATE_LIMIT_PER_MIN: blankAsUnset(z.coerce.number().int().positive().default(60)),

    // Outbound webhooks (Sprint 8). A webhook URL is fetched server-side, so
    // it goes through the same SSRF guard as the SEO crawler. Local testing
    // needs a receiver on localhost, which that guard refuses; this lets it
    // through. Refused in production below.
    WEBHOOK_ALLOW_PRIVATE_URLS: blankAsUnset(z.enum(['true', 'false']).default('false')),

    // Error tracking (Sprint 8). Absent DSN = no Sentry at all, which is the
    // local default; traces stay off unless asked for.
    SENTRY_DSN: blankAsUnset(z.string().url().optional()),
    SENTRY_TRACES_SAMPLE_RATE: blankAsUnset(z.coerce.number().min(0).max(1).default(0)),

    // Absent SMTP_HOST selects the console transport, which prints the mail to
    // stdout. That is the sprint's "stub the send" — a real transport is a
    // config change, not a code change.
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().default('PostGear <no-reply@postgear.local>'),
  })
  .superRefine((env, context) => {
    // Simulated AI output must never reach a real audience. In production the
    // flag is a misconfiguration, and one worth dying for at boot.
    if (env.NODE_ENV === 'production' && env.AI_SIMULATION === 'true') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AI_SIMULATION'],
        message: 'AI_SIMULATION cannot be "true" when NODE_ENV=production',
      });
    }

    // Stand-in metrics on a real deployment would be a dashboard of fiction.
    if (
      env.NODE_ENV === 'production' &&
      (env.ANALYTICS_SIMULATION === 'true' || env.PUBLISH_SIMULATION === 'true')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [env.ANALYTICS_SIMULATION === 'true' ? 'ANALYTICS_SIMULATION' : 'PUBLISH_SIMULATION'],
        message: 'Simulation flags cannot be "true" when NODE_ENV=production',
      });
    }

    // A simulated subscription is a free plan nobody paid for, and a webhook
    // allowed to reach the private network is an SSRF hole; neither belongs on
    // a real deployment (Sprint 8).
    if (env.NODE_ENV === 'production' && env.BILLING_SIMULATION === 'true') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['BILLING_SIMULATION'],
        message: 'BILLING_SIMULATION cannot be "true" when NODE_ENV=production',
      });
    }
    if (env.NODE_ENV === 'production' && env.WEBHOOK_ALLOW_PRIVATE_URLS === 'true') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WEBHOOK_ALLOW_PRIVATE_URLS'],
        message: 'WEBHOOK_ALLOW_PRIVATE_URLS cannot be "true" when NODE_ENV=production',
      });
    }
    // Stripe needs both halves: a secret key to call it and a signing secret
    // to believe what it sends back. One without the other is a deploy that
    // can sell a plan it never activates.
    if (Boolean(env.STRIPE_SECRET_KEY) !== Boolean(env.STRIPE_WEBHOOK_SECRET)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [env.STRIPE_SECRET_KEY ? 'STRIPE_WEBHOOK_SECRET' : 'STRIPE_SECRET_KEY'],
        message: 'STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set together',
      });
    }

    // S3 settings are optional individually but required together. Checked here
    // so a half-configured deploy fails at boot, naming every missing variable,
    // rather than on the first upload.
    if (env.STORAGE_PROVIDER !== 's3') {
      return;
    }

    for (const key of [
      'S3_BUCKET_NAME',
      'S3_ACCESS_KEY',
      'S3_SECRET_KEY',
      'S3_PUBLIC_URL',
    ] as const) {
      if (!env[key]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when STORAGE_PROVIDER=s3`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Whether analytics come from a stand-in. `ANALYTICS_SIMULATION` decides when
 * set; otherwise simulated publishing implies simulated analytics, since the
 * seeded channels a simulated publisher posts to hold no real credentials to
 * read metrics with. The worker applies the same rule (`apps/worker/src/config/env.ts`).
 */
export function analyticsSimulated(
  env: Pick<Env, 'ANALYTICS_SIMULATION' | 'PUBLISH_SIMULATION'>,
): boolean {
  return env.ANALYTICS_SIMULATION === undefined
    ? env.PUBLISH_SIMULATION === 'true'
    : env.ANALYTICS_SIMULATION === 'true';
}

/**
 * Validates `process.env`. Passed to Nest's ConfigModule as its `validate`
 * hook, which calls it during module initialisation.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(`Invalid environment configuration:\n${problems}`);
  }

  return result.data;
}
