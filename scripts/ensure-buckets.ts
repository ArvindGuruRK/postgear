/**
 * Creates the two local storage buckets in MinIO, over the S3 API.
 *
 * Usage (from the repo root; `npm run dev` runs it for you after the Docker
 * services start):
 *   npm run storage:buckets
 *
 * What it sets up (the same rules the old `minio-setup` container applied):
 * - S3_BUCKET_NAME (postgear-media): the public space. Anonymous GetObject on
 *   its objects only (no anonymous listing, so a key stays unguessable), plus an
 *   empty `library/.keep` so the Clips catalogue prefix shows in the console.
 * - CLIPS_PRIVATE_BUCKET (postgear-clips): the private Clips space. No anonymous
 *   access at all; browsers reach it only through presigned URLs that expire.
 * - CORS on both for the web app at http://localhost:3000. The community MinIO
 *   build refuses bucket CORS ("not implemented") and answers CORS server-wide
 *   instead, so that step is best effort here; R2 and AWS S3 take the same rule
 *   as a bucket CORS setting in production.
 *
 * It is safe to run again: buckets that exist are left alone and the rules are
 * written again to the same values. It does nothing when S3_ENDPOINT is unset
 * (files then live on local disk) and refuses to run in production, because it
 * makes a bucket publicly readable.
 */
import {
  CreateBucketCommand,
  DeleteBucketPolicyCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const WEB_ORIGIN = 'http://localhost:3000';
const WAIT_SECONDS = 60;

interface SdkFailure {
  name?: string;
  $metadata?: { httpStatusCode?: number };
}

function statusOf(error: unknown): number | undefined {
  return (error as SdkFailure | null)?.$metadata?.httpStatusCode;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function log(message: string): void {
  console.log(`storage:buckets: ${message}`);
}

/** Waits until MinIO answers, so this can run right after `docker compose up -d`. */
async function waitForStore(client: S3Client, bucket: string): Promise<void> {
  for (let attempt = 1; attempt <= WAIT_SECONDS; attempt += 1) {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      return;
    } catch (error) {
      // 404 and 403 are answers too: the store is up, the bucket is just not there yet.
      if (statusOf(error) !== undefined) return;
      if (attempt === WAIT_SECONDS) {
        throw new Error(`MinIO did not answer within ${WAIT_SECONDS} seconds`);
      }
      await sleep(1000);
    }
  }
}

async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    log(`${bucket} already exists`);
  } catch (error) {
    if (statusOf(error) !== 404) throw error;
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    log(`created ${bucket}`);
  }
}

function publicReadPolicy(bucket: string): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  });
}

async function setCors(client: S3Client, bucket: string): Promise<boolean> {
  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: [WEB_ORIGIN],
              AllowedMethods: ['GET', 'HEAD', 'PUT'],
              AllowedHeaders: ['*'],
              ExposeHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'ETag'],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('refusing to run in production: it makes a bucket publicly readable');
  }
  const endpoint = process.env.S3_ENDPOINT;
  if (!endpoint) {
    log('S3_ENDPOINT is not set, files live on local disk, nothing to do');
    return;
  }

  const publicBucket = process.env.S3_BUCKET_NAME || 'postgear-media';
  const privateBucket = process.env.CLIPS_PRIVATE_BUCKET || 'postgear-clips';

  const client = new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
      secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
    },
  });

  await waitForStore(client, publicBucket);

  await ensureBucket(client, publicBucket);
  await ensureBucket(client, privateBucket);

  await client.send(
    new PutBucketPolicyCommand({ Bucket: publicBucket, Policy: publicReadPolicy(publicBucket) }),
  );
  // The private bucket must have no anonymous access: drop any policy it carries.
  try {
    await client.send(new DeleteBucketPolicyCommand({ Bucket: privateBucket }));
  } catch (error) {
    if (statusOf(error) !== 404) throw error;
  }

  const corsPublic = await setCors(client, publicBucket);
  const corsPrivate = await setCors(client, privateBucket);
  log(
    corsPublic && corsPrivate
      ? `bucket CORS set for ${WEB_ORIGIN}`
      : `this MinIO has no bucket CORS; its server-wide CORS (api cors_allow_origin, * by default) already covers ${WEB_ORIGIN}`,
  );

  try {
    await client.send(new HeadObjectCommand({ Bucket: publicBucket, Key: 'library/.keep' }));
  } catch (error) {
    if (statusOf(error) !== 404) throw error;
    await client.send(
      new PutObjectCommand({
        Bucket: publicBucket,
        Key: 'library/.keep',
        Body: new Uint8Array(0),
        ContentLength: 0,
      }),
    );
  }

  log(`${publicBucket} (public read) and ${privateBucket} (private) are ready`);
}

main().catch((error: unknown) => {
  console.error(
    `storage:buckets: failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
