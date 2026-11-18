/**
 * The probe answer's picture, served by us (Module 03, section 4).
 *
 * `linkFor` turns the platform's picture address into our own signed link;
 * `fetch` checks the token and fetches the picture through the guarded
 * binary fetch (`fetchBinarySafely`: public addresses only, the address each
 * redirect hop resolves to pinned and re-checked, a 2 MB cap, a timeout).
 * The bytes must sniff as JPEG, PNG, GIF or WebP; the content type we send
 * comes from that sniff, never from the platform, and SVG is never served
 * (it can carry script). The browser never talks to the platform.
 */
import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fetchBinarySafely, SeoCrawlError } from '@postgear/seo-engine';
import type { Env } from '../../../config/env';
import { ClipErrorException } from '../clip-error.exception';
import { CLIP_LINKS_MESSAGES } from './clip-links.messages';
import { ThumbnailSigner } from './thumbnail-signer';

export const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
const THUMBNAIL_TIMEOUT_MS = 8_000;
const THUMBNAIL_MAX_REDIRECTS = 3;

/** What `fetch` needs from the guarded fetch: injected so the specs never touch the network. */
export type ThumbnailFetch = (
  url: string,
  options: {
    timeoutMs: number;
    maxBytes: number;
    maxRedirects: number;
    accept: string;
    verifyCertificate: boolean;
  },
) => Promise<{ body: Buffer; https: boolean }>;

export const THUMBNAIL_FETCH = Symbol('THUMBNAIL_FETCH');

export interface ThumbnailImage {
  body: Buffer;
  contentType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
}

@Injectable()
export class ClipThumbnailsService {
  private readonly logger = new Logger(ClipThumbnailsService.name);
  private readonly signer: ThumbnailSigner;
  private readonly apiUrl: string;
  private readonly fetchImage: ThumbnailFetch;

  constructor(
    config: ConfigService<Env, true>,
    @Optional() @Inject(THUMBNAIL_FETCH) fetchImage?: ThumbnailFetch,
  ) {
    this.signer = new ThumbnailSigner(config.get('CLIPS_URL_SECRET', { infer: true }));
    this.apiUrl = config.get('API_URL', { infer: true }).replace(/\/+$/, '');
    this.fetchImage = fetchImage ?? fetchBinarySafely;
  }

  /** Our link for a platform picture, or null when there is none or it is not an https address. */
  linkFor(address: string | null): string | null {
    if (address === null) return null;
    const token = this.signer.sign(address);
    return token === null ? null : `${this.apiUrl}/clips/links/thumbnail?u=${token}`;
  }

  /**
   * The picture a token names. 403 `thumbnail_link_invalid` for a token that
   * is not ours or has expired (forged and expired read alike); 404 when the
   * platform no longer has it; 502 `thumbnail_unavailable` for anything else.
   */
  async fetch(token: unknown): Promise<ThumbnailImage> {
    const checked = this.signer.verify(token);
    if (!checked.ok) {
      throw new ClipErrorException(HttpStatus.FORBIDDEN, 'thumbnail_link_invalid', {
        message: CLIP_LINKS_MESSAGES.THUMBNAIL_LINK_INVALID,
      });
    }

    let response: { body: Buffer; https: boolean };
    try {
      response = await this.fetchImage(checked.url, {
        timeoutMs: THUMBNAIL_TIMEOUT_MS,
        maxBytes: THUMBNAIL_MAX_BYTES,
        maxRedirects: THUMBNAIL_MAX_REDIRECTS,
        accept: 'image/webp,image/jpeg,image/png,image/gif;q=0.9',
        verifyCertificate: true,
      });
    } catch (error) {
      const gone =
        error instanceof SeoCrawlError &&
        error.kind === 'bad_status' &&
        (error.statusCode === 404 || error.statusCode === 410);
      this.logger.warn(
        JSON.stringify({
          event: 'clips.thumbnail.fetch_failed',
          kind: error instanceof SeoCrawlError ? error.kind : 'unknown',
          host: hostOf(checked.url),
        }),
      );
      throw this.unavailable(gone ? HttpStatus.NOT_FOUND : HttpStatus.BAD_GATEWAY);
    }

    const contentType = sniffImage(response.body);
    if (!response.https || contentType === null) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.thumbnail.refused',
          reason: response.https ? 'not_an_image' : 'not_https',
          host: hostOf(checked.url),
        }),
      );
      throw this.unavailable(HttpStatus.BAD_GATEWAY);
    }
    return { body: response.body, contentType };
  }

  private unavailable(status: HttpStatus): ClipErrorException {
    return new ClipErrorException(status, 'thumbnail_unavailable', {
      message: CLIP_LINKS_MESSAGES.THUMBNAIL_UNAVAILABLE,
    });
  }
}

/** The picture type from its first bytes, or null when it is not one we serve. */
export function sniffImage(body: Buffer): ThumbnailImage['contentType'] | null {
  if (body.length < 12) return null;
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
  if (body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  const head = body.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  if (
    body.subarray(0, 4).toString('latin1') === 'RIFF' &&
    body.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function hostOf(address: string): string {
  try {
    return new URL(address).hostname;
  } catch {
    return 'invalid';
  }
}
