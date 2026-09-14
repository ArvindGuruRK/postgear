import type { APIRequestContext, Page } from '@playwright/test';
import sharp from 'sharp';

/**
 * Fixture media, generated rather than committed.
 *
 * A photo has to be genuinely large for "the upload was compressed" to mean
 * anything, and a multi-megabyte binary in the repository is a poor trade for
 * three lines of `sharp`. Gaussian noise defeats compression the way real
 * camera detail does, so the before-and-after sizes are honest.
 */
export async function noisyPhoto(width = 3000, height = 2000): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: '#808080',
      noise: { type: 'gaussian', mean: 128, sigma: 40 },
    },
  })
    .jpeg({ quality: 95 })
    .toBuffer();
}

/** A unique, searchable file name, so parallel tests never find each other's uploads. */
export function uniqueName(label: string): string {
  return `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Removes what a test created, through the API, with the signed-in page's session.
 *
 * Through the API rather than the database so a deleted media item's files are
 * removed from storage too — deleting rows alone would leave uploads behind in
 * `apps/api/uploads` after every run.
 */
export async function cleanUp(
  request: APIRequestContext | Page['request'],
  created: { groups: string[]; mediaNames: string[] },
): Promise<void> {
  for (const group of created.groups) {
    await request.delete(`${API_URL}/posts/${group}`).catch(() => undefined);
  }

  for (const name of created.mediaNames) {
    const response = await request.get(`${API_URL}/media?search=${encodeURIComponent(name)}`);

    if (!response.ok()) {
      continue;
    }

    const { media } = (await response.json()) as { media: { id: string; name: string }[] };

    for (const item of media.filter((entry) => entry.name === name)) {
      await request.delete(`${API_URL}/media/${item.id}`).catch(() => undefined);
    }
  }
}
