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

    LOGIN_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(10),
    LOCKOUT_THRESHOLD: z.coerce.number().int().positive().default(5),
    LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

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
