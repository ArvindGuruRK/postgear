/**
 * The thumbnail link and route: a token names one https address for six
 * hours, a forged or expired one reads the same (403), and only real picture
 * bytes are served, typed by their sniffed format. The fetch is a fake; no
 * network.
 */
import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SeoCrawlError } from '@postgear/seo-engine';
import { ClipThumbnailsService, sniffImage, type ThumbnailFetch } from './clip-thumbnails.service';
import { THUMBNAIL_LINK_TTL_MS, ThumbnailSigner } from './thumbnail-signer';

const SECRET = 'a-test-secret-that-is-at-least-32-characters-long';
const PICTURE = 'https://static-cdn.example/cf_vods/abc/thumb0-320x180.jpg';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);

function service(fetchImage: ThumbnailFetch) {
  const values: Record<string, unknown> = {
    CLIPS_URL_SECRET: SECRET,
    API_URL: 'http://localhost:3001/',
  };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService;
  return new ClipThumbnailsService(config as never, fetchImage);
}

function tokenOf(link: string | null): string {
  return new URL(String(link)).searchParams.get('u') as string;
}

async function statusOf(promise: Promise<unknown>): Promise<{ status: number; code: unknown }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return { status: error.getStatus(), code: (error.getResponse() as { code?: unknown }).code };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('ThumbnailSigner', () => {
  it('signs an https address and verifies it back', () => {
    const signer = new ThumbnailSigner(SECRET);
    const token = signer.sign(PICTURE) as string;
    expect(signer.verify(token)).toEqual({ ok: true, url: PICTURE });
  });

  it('refuses to sign what it would never fetch', () => {
    const signer = new ThumbnailSigner(SECRET);
    expect(signer.sign('http://static-cdn.example/a.jpg')).toBeNull();
    expect(signer.sign('https://user:pass@static-cdn.example/a.jpg')).toBeNull();
    expect(signer.sign('https://static-cdn.example:8443/a.jpg')).toBeNull();
    expect(signer.sign('not a link')).toBeNull();
  });

  it('refuses a token signed with another secret, a changed one, and an expired one', () => {
    const signer = new ThumbnailSigner(SECRET);
    const token = signer.sign(PICTURE) as string;
    expect(new ThumbnailSigner(`${SECRET}-other`).verify(token)).toEqual({ ok: false });

    const [payload, mac] = token.split('.');
    const swapped = Buffer.from(
      JSON.stringify({ u: 'https://evil.example/x.jpg', e: 9_999_999_999 }),
    ).toString('base64url');
    expect(signer.verify(`${swapped}.${mac}`)).toEqual({ ok: false });
    // Change a whole byte of the MAC. (Swapping the last letter is not enough:
    // it may already be that letter, or differ only in bits decoding drops.)
    const macBytes = Buffer.from(mac, 'base64url');
    macBytes[0] ^= 0xff;
    expect(signer.verify(`${payload}.${macBytes.toString('base64url')}`)).toEqual({ ok: false });

    let now = Date.now();
    const clocked = new ThumbnailSigner(SECRET, () => now);
    const fresh = clocked.sign(PICTURE) as string;
    now += THUMBNAIL_LINK_TTL_MS + 1_000;
    expect(clocked.verify(fresh)).toEqual({ ok: false });
  });

  it('refuses anything that is not a token', () => {
    const signer = new ThumbnailSigner(SECRET);
    for (const value of [undefined, 42, '', 'a.b', '../../etc/passwd', 'x'.repeat(5_000)]) {
      expect(signer.verify(value)).toEqual({ ok: false });
    }
  });
});

describe('ClipThumbnailsService', () => {
  it('links through our own route and serves the sniffed picture', async () => {
    const fetchImage = jest.fn<ReturnType<ThumbnailFetch>, Parameters<ThumbnailFetch>>(
      async () => ({
        body: JPEG,
        https: true,
      }),
    );
    const thumbnails = service(fetchImage);
    const link = thumbnails.linkFor(PICTURE);
    expect(link).toMatch(/^http:\/\/localhost:3001\/clips\/links\/thumbnail\?u=/);
    expect(link).not.toContain('static-cdn');

    const image = await thumbnails.fetch(tokenOf(link));
    expect(image.contentType).toBe('image/jpeg');
    expect(fetchImage).toHaveBeenCalledWith(
      PICTURE,
      expect.objectContaining({ maxBytes: 2 * 1024 * 1024 }),
    );
    expect(thumbnails.linkFor(null)).toBeNull();
  });

  it('answers 403 for a bad token without fetching anything', async () => {
    const fetchImage = jest.fn<ReturnType<ThumbnailFetch>, Parameters<ThumbnailFetch>>();
    expect(await statusOf(service(fetchImage).fetch('forged.token'))).toEqual({
      status: 403,
      code: 'thumbnail_link_invalid',
    });
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it('refuses bytes that are not a picture, and a redirect away from https', async () => {
    const svg = service(async () => ({
      body: Buffer.from('<svg onload="alert(1)"></svg>'),
      https: true,
    }));
    expect(await statusOf(svg.fetch(tokenOf(svg.linkFor(PICTURE))))).toEqual({
      status: 502,
      code: 'thumbnail_unavailable',
    });
    const plain = service(async () => ({ body: JPEG, https: false }));
    expect((await statusOf(plain.fetch(tokenOf(plain.linkFor(PICTURE))))).status).toBe(502);
  });

  it('answers 404 when the platform no longer has the picture, 502 for anything else', async () => {
    const gone = service(async () => {
      throw new SeoCrawlError('bad_status', 'gone', false, { statusCode: 404 });
    });
    expect((await statusOf(gone.fetch(tokenOf(gone.linkFor(PICTURE))))).status).toBe(404);
    const blocked = service(async () => {
      throw new SeoCrawlError('unsafe_url', 'private address', false);
    });
    expect((await statusOf(blocked.fetch(tokenOf(blocked.linkFor(PICTURE))))).status).toBe(502);
  });
});

describe('sniffImage', () => {
  it('knows JPEG, PNG, GIF and WebP, and nothing else', () => {
    expect(sniffImage(JPEG)).toBe('image/jpeg');
    expect(
      sniffImage(
        Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.alloc(8),
        ]),
      ),
    ).toBe('image/png');
    expect(sniffImage(Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(8)]))).toBe('image/gif');
    expect(
      sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])),
    ).toBe('image/webp');
    expect(sniffImage(Buffer.from('<html><body>hello</body></html>'))).toBeNull();
    expect(sniffImage(Buffer.alloc(4))).toBeNull();
  });
});
