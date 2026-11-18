/**
 * Worker environment, validated once at boot.
 *
 * The same `.env` as the API (both are started through `dotenv -e ../../.env`),
 * read with the same discipline: a missing value is a startup error naming the
 * fix, not a mystery at the first publish three hours later. Only what the
 * worker itself reads is listed; Prisma reads `DATABASE_URL` on its own.
 */
import { WORKER_ROLES, type WorkerRole } from '@postgear/scheduling';
import { CLIP_PLATFORMS } from '@postgear/video-engine';
import { z } from 'zod';

/** Reads an empty or whitespace-only variable as absent, so a schema default applies. */
function blankAsUnset<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema,
  );
}

/** A comma-separated variable as a list of distinct values, each checked by `item`. */
function commaList<T extends z.ZodTypeAny>(item: T) {
  return z
    .string()
    .transform((raw) =>
      raw
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    )
    .pipe(z.array(item))
    .transform((values) => [...new Set(values)] as Array<z.output<T>>);
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    // Decrypts `Integration.token` before a publish. The same key the API uses
    // to encrypt it: see packages/db/src/crypto.ts.
    ENCRYPTION_KEY_AES256: z
      .string()
      .regex(
        /^[0-9a-fA-F]{64}$/,
        'ENCRYPTION_KEY_AES256 must be 32 bytes as 64 hex characters. Run `npm run generate:keys`',
      ),

    TEMPORAL_HOST: z.string().min(1).default('localhost:7233'),
    TEMPORAL_NAMESPACE: z.string().min(1).default('default'),

    // How many posts this process publishes at once. Platforms rate-limit per
    // account, not per worker, so this is a ceiling on load rather than a
    // throughput target; Temporal queues the rest.
    WORKER_MAX_CONCURRENT_PUBLISHES: z.coerce.number().int().positive().default(5),

    // Media URLs are built the same way the API's storage backends build them,
    // from the same variables: see lib/media-url.ts.
    STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
    API_URL: z.string().url().default('http://localhost:3001'),
    S3_PUBLIC_URL: z.string().url().optional(),
    // The API's public https address (a tunnel, locally). With local storage,
    // media URLs handed to platforms are built from it instead of API_URL, so
    // Instagram and Threads can fetch them. Same variable as the API's.
    CHANNELS_PUBLIC_URL: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z
        .string()
        .url()
        .startsWith('https://', 'CHANNELS_PUBLIC_URL must be an https address')
        .optional(),
    ),

    // The web app, for links in workflow data (Sprint 10, Module 09: a
    // post's PostGear link that a Slack step can send). Same variable as the
    // API's.
    WEB_URL: z.string().url().default('http://localhost:3000'),

    /**
     * Publish to a stand-in instead of real platforms.
     *
     * For local development and the end-to-end suite, where no developer app is
     * registered and the seeded channels hold fake tokens. Every other step
     * (the timer, the retry policy, the status written for the queue, the
     * refresh branch) runs for real; only the final HTTP call is replaced. A
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

    /**
     * Workflow steps that leave PostGear (Slack, Sheets, HTTP) send to a
     * stand-in instead of the outside app (Sprint 10). The stand-in logs what
     * the step would send and answers like the app would; `[simulate:429]`
     * and the other markers of lib/simulation-markers.ts in a step's text
     * force a failure. Test runs stay dry either way unless a step is sent for
     * real. Refused in production.
     */
    AUTOMATION_SIMULATION: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.enum(['true', 'false']).default('false'),
    ),

    /**
     * The key to the API's internal step gateway (Sprint 10, Module 10).
     * Steps that need API services (Create Draft, Add To Queue, Publish, the
     * AI steps, Email) call `${API_URL}/internal/automation/*` with it. The
     * API checks the same variable. Generate it with `npm run generate:keys`.
     */
    AUTOMATION_INTERNAL_TOKEN: z
      .string()
      .regex(
        /^[0-9a-fA-F]{64}$/,
        'AUTOMATION_INTERNAL_TOKEN must be 64 hex characters (the same value as the API). Run `npm run generate:keys`',
      ),

    /**
     * Google Sheets steps refresh their access token here (Module 13). The
     * same client the API's Google connection uses: the automation client,
     * else the sign-in client.
     */
    GOOGLE_AUTOMATION_CLIENT_ID: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().optional(),
    ),
    GOOGLE_AUTOMATION_CLIENT_SECRET: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().optional(),
    ),
    GOOGLE_CLIENT_ID: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().optional(),
    ),
    GOOGLE_CLIENT_SECRET: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().optional(),
    ),

    /**
     * Let outbound webhooks target localhost and private addresses (Sprint 8).
     * The delivery sender runs the same SSRF guard as the SEO crawler on every
     * send, which refuses exactly the receiver a developer runs on their own
     * machine; this is the switch for that case only. Refused in production.
     */
    WEBHOOK_ALLOW_PRIVATE_URLS: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.enum(['true', 'false']).default('false'),
    ),

    // ---- Clips (Sprint 12) -------------------------------------------------

    /**
     * Which task queues this process serves (Module 02): `publishing` (posts,
     * analytics, webhooks, workflows, maintenance), `media` (imports, probes,
     * channel lists, downloads) and `render` (exports, one at a time).
     * Locally all three; in production one role per container, so a render
     * can never delay a scheduled post.
     */
    WORKER_ROLES: blankAsUnset(
      commaList(z.enum(WORKER_ROLES))
        .refine((roles) => roles.length > 0, 'WORKER_ROLES needs at least one role')
        .default('publishing,media,render'),
    ),
    // How many media activities run at once (downloads and FFmpeg imports).
    WORKER_MEDIA_CONCURRENCY: blankAsUnset(z.coerce.number().int().min(1).max(16).default(2)),
    // Renders are CPU bound: one at a time unless the machine is sized for more.
    RENDER_CONCURRENCY: blankAsUnset(z.coerce.number().int().min(1).max(8).default(1)),

    /**
     * Fetch from fixtures instead of YouTube, Twitch and Kick: recorded probe
     * answers, the two generated sample videos, recorded channel lists. No
     * platform is ever contacted. Refused in production.
     */
    CLIPS_SIMULATION: blankAsUnset(z.enum(['true', 'false']).default('false')),
    // The same list as the API's: a paused platform is never fetched from.
    CLIPS_PLATFORMS: blankAsUnset(commaList(z.enum(CLIP_PLATFORMS)).default('youtube,twitch,kick')),
    // The operator's library ingest refuses to start unless this is true.
    CLIPS_LIBRARY_INGEST: blankAsUnset(z.enum(['true', 'false']).default('false')),
    // Openverse and Freesound sound intake (Module 21), each off until that
    // source's written permission; their adapters refuse to run while false.
    CLIPS_INGEST_OPENVERSE_OK: blankAsUnset(z.enum(['true', 'false']).default('false')),
    CLIPS_INGEST_FREESOUND_OK: blankAsUnset(z.enum(['true', 'false']).default('false')),
    // Every job works in `<CLIPS_SCRATCH_DIR>/<jobId>/`, removed when it ends.
    // Unset means `<os temp>/postgear-clips`.
    CLIPS_SCRATCH_DIR: blankAsUnset(z.string().min(1).optional()),
    // The TTF twins and manifest `npm run clips:fonts:build` writes, for text in exports.
    // Unset means `<repo>/.cache/clips-fonts`.
    CLIPS_FONTS_DIR: blankAsUnset(z.string().min(1).optional()),
    // Reading Twitch chat as a highlight signal (Module 16). Off by default.
    CLIPS_TWITCH_CHAT: blankAsUnset(z.enum(['true', 'false']).default('false')),
    TWITCH_CHAT_QUERY: blankAsUnset(z.string().min(1).optional()),

    // The programs Clips starts. A name on PATH or an absolute path.
    FFMPEG_PATH: blankAsUnset(z.string().min(1).default('ffmpeg')),
    FFPROBE_PATH: blankAsUnset(z.string().min(1).default('ffprobe')),
    YTDLP_PATH: blankAsUnset(z.string().min(1).default('yt-dlp')),
    // The JavaScript runtime yt-dlp needs for YouTube; `none` turns it off.
    YTDLP_JS_RUNTIME: blankAsUnset(z.string().min(1).default('deno')),
    YTDLP_PROXY: blankAsUnset(z.string().url().optional()),
    YTDLP_COOKIES_FILE: blankAsUnset(z.string().min(1).optional()),
    YTDLP_EXTRACTOR_ARGS: blankAsUnset(z.string().min(1).optional()),
    YTDLP_SELF_UPDATE: blankAsUnset(z.enum(['true', 'false']).default('false')),

    // Storage, the same variables as the API: the worker writes imported
    // files to the private space and finished exports to the media library.
    UPLOAD_DIRECTORY: blankAsUnset(z.string().min(1).optional()),
    S3_ENDPOINT: blankAsUnset(z.string().url().optional()),
    S3_REGION: blankAsUnset(z.string().min(1).default('us-east-1')),
    S3_BUCKET_NAME: blankAsUnset(z.string().min(1).optional()),
    S3_ACCESS_KEY: blankAsUnset(z.string().min(1).optional()),
    S3_SECRET_KEY: blankAsUnset(z.string().min(1).optional()),
    S3_FORCE_PATH_STYLE: blankAsUnset(z.enum(['true', 'false']).optional()),
    CLIPS_PRIVATE_BUCKET: blankAsUnset(z.string().min(3).default('postgear-clips')),
    CLIPS_URL_SECRET: blankAsUnset(
      z.string().min(32, 'CLIPS_URL_SECRET must be at least 32 characters').optional(),
    ),
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

    if (env.AUTOMATION_SIMULATION === 'true' && env.NODE_ENV === 'production') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTOMATION_SIMULATION'],
        message: 'AUTOMATION_SIMULATION cannot be enabled in production',
      });
    }

    if (env.WEBHOOK_ALLOW_PRIVATE_URLS === 'true' && env.NODE_ENV === 'production') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WEBHOOK_ALLOW_PRIVATE_URLS'],
        message: 'WEBHOOK_ALLOW_PRIVATE_URLS cannot be enabled in production',
      });
    }

    if (env.CLIPS_SIMULATION === 'true' && env.NODE_ENV === 'production') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CLIPS_SIMULATION'],
        message: 'CLIPS_SIMULATION cannot be enabled in production',
      });
    }

    if (env.NODE_ENV === 'production' && !env.CLIPS_URL_SECRET) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CLIPS_URL_SECRET'],
        message: 'CLIPS_URL_SECRET is required when NODE_ENV=production',
      });
    }

    // The worker now writes to storage (imports and exports), so a half-set S3
    // binding must fail at boot, not on the first finished render.
    if (env.STORAGE_PROVIDER === 's3') {
      for (const key of ['S3_BUCKET_NAME', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) {
        if (!env[key]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when STORAGE_PROVIDER=s3`,
          });
        }
      }
    }
  });

/** Whether this process serves `role`'s task queue. */
export function servesRole(env: Pick<WorkerEnv, 'WORKER_ROLES'>, role: WorkerRole): boolean {
  return env.WORKER_ROLES.includes(role);
}

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
