/**
 * The one place an S3 client is built, shared by the public and the private
 * space so both talk to the same endpoint with the same addressing rule.
 */
import { S3Client } from '@aws-sdk/client-s3';

/** Connection settings for an S3-compatible store (AWS S3, Cloudflare R2, MinIO). */
export interface S3ConnectionConfig {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Unset means path style whenever an endpoint is set (MinIO needs it). */
  forcePathStyle?: 'true' | 'false';
}

/** Builds an S3 client from validated settings. */
export function createS3Client(config: S3ConnectionConfig): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle:
      config.forcePathStyle === undefined
        ? Boolean(config.endpoint)
        : config.forcePathStyle === 'true',
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
}

/** The parts of an SDK error this package looks at. */
interface S3Failure {
  name?: string;
  Code?: string;
  $metadata?: { httpStatusCode?: number };
}

function asFailure(error: unknown): S3Failure {
  return typeof error === 'object' && error !== null ? (error as S3Failure) : {};
}

/**
 * True when S3 answered "no such object". A missing object is an answer; an
 * unreachable bucket is a fault, and callers must not confuse the two.
 */
export function isS3NotFound(error: unknown): boolean {
  const failure = asFailure(error);
  return (
    failure.name === 'NoSuchKey' ||
    failure.name === 'NotFound' ||
    failure.$metadata?.httpStatusCode === 404
  );
}

/** True when S3 refused a byte range as outside the object. */
export function isS3InvalidRange(error: unknown): boolean {
  const failure = asFailure(error);
  return failure.name === 'InvalidRange' || failure.$metadata?.httpStatusCode === 416;
}

/** True when S3 says a multipart upload is already gone. */
export function isS3NoSuchUpload(error: unknown): boolean {
  const failure = asFailure(error);
  return failure.name === 'NoSuchUpload' || failure.Code === 'NoSuchUpload';
}
