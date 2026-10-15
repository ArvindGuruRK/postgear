/**
 * Worker environment, validated once at boot.
 *
 * The same `.env` as the API (both are started through `dotenv -e ../../.env`),
 * read with the same discipline: a missing value is a startup error naming the
 * fix, not a mystery at the first publish three hours later. Only what the
 * worker itself reads is listed; Prisma reads `DATABASE_URL` on its own.
 */
import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    // Decrypts `Integration.token` before a publish. The same key the API uses
    // to encrypt it — see packages/db/src/crypto.ts.
    ENCRYPTION_KEY_AES256: z
      .string()
      .regex(
        /^[0-9a-fA-F]{64}$/,
        'ENCRYPTION_KEY_AES256 must be 32 bytes as 64 hex characters — run `npm run generate:keys`',
      ),

    TEMPORAL_HOST: z.string().min(1).default('localhost:7233'),
    TEMPORAL_NAMESPACE: z.string().min(1).default('default'),

    // How many posts this process publishes at once. Platforms rate-limit per
    // account, not per worker, so this is a ceiling on load rather than a
    // throughput target; Temporal queues the rest.
    WORKER_MAX_CONCURRENT_PUBLISHES: z.coerce.number().int().positive().default(5),

    // Media URLs are built the same way the API's storage backends build them,
    // from the same variables — see lib/media-url.ts.
    STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
    API_URL: z.string().url().default('http://localhost:3001'),
    S3_PUBLIC_URL: z.string().url().optional(),

    /**
     * Publish to a stand-in instead of real platforms.
     *
     * For local development and the end-to-end suite, where no developer app is
     * registered and the seeded channels hold fake tokens. Every other step —
     * the timer, the retry policy, the status written for the queue, the
     * refresh branch — runs for real; only the final HTTP call is replaced. A
     * message can ask for a failure with `[simulate:429]` and friends; see
     * lib/publisher.ts. Refused in production, so a misconfigured deploy cannot
     * quietly "publish" everything to nowhere.
     */
    PUBLISH_SIMULATION: z.enum(['true', 'false']).default('false'),

    /**
     * Read channel and post metrics from a stand-in instead of the platforms
     * (Sprint 7). Unset means "the same as PUBLISH_SIMULATION": the seeded
     * channels a simulated publisher posts to have no real credentials to
     * read metrics with either. Refused in production for the same reason.
     */
    ANALYTICS_SIMULATION: z
      .preprocess(
        (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
        z.enum(['true', 'false']).optional(),
      )
      .optional(),
  })
  .transform((env) => ({
    ...env,
    ANALYTICS_SIMULATION: (env.ANALYTICS_SIMULATION ?? env.PUBLISH_SIMULATION) as 'true' | 'false',
  }))
  .superRefine((env, context) => {
    if (env.STORAGE_PROVIDER === 's3' && !env.S3_PUBLIC_URL) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['S3_PUBLIC_URL'],
        message: 'S3_PUBLIC_URL is required when STORAGE_PROVIDER=s3',
      });
    }

    if (env.PUBLISH_SIMULATION === 'true' && env.NODE_ENV === 'production') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PUBLISH_SIMULATION'],
        message: 'PUBLISH_SIMULATION cannot be enabled in production',
      });
    }

    if (env.ANALYTICS_SIMULATION === 'true' && env.NODE_ENV === 'production') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ANALYTICS_SIMULATION'],
        message: 'ANALYTICS_SIMULATION cannot be enabled in production',
      });
    }
  });

export type WorkerEnv = z.infer<typeof envSchema>;

export function loadWorkerEnv(raw: Record<string, unknown> = process.env): WorkerEnv {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(`Invalid worker environment:\n${problems}`);
  }

  return result.data;
}
