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

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Optional. Absent means RedisService falls back to an in-process Map, so
  // the API still boots without `docker compose up`. See redis.service.ts for
  // what that fallback does and does not guarantee.
  REDIS_URL: z.string().optional(),

  JWT_SECRET: z.string().min(MIN_SECRET_LENGTH, `JWT_SECRET must be >= ${MIN_SECRET_LENGTH} chars`),
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
