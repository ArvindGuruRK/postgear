/**
 * `noto`: Noto Emoji Animation by Google, CC BY 4.0. The collection's own
 * `api.json` index lists every emoji with its codepoint, categories and
 * tags; each file is on Google's CDN as `<codepoint>/512.webp` (research 10,
 * verified 2026-11-17). Noto comes in as WebP, not GIF: a GIF's alpha is
 * one bit.
 *
 * The index's exact field names were read from the research notes, not from
 * the live file, so the parser takes the likely shapes and refuses an entry
 * it cannot read; the first real run confirms. The index and the files are
 * read through the injected fetch only, or the index from a local file.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  type FetchBinary,
  type LibraryCandidate,
  LibraryError,
  type StickerAdapter,
} from '../types';
import { readInside } from './files';

export const NOTO_INDEX_URL = 'https://googlefonts.github.io/noto-emoji-animation/data/api.json';
export const NOTO_PAGE_URL = 'https://googlefonts.github.io/noto-emoji-animation/';
const CC_BY_URL = 'https://creativecommons.org/licenses/by/4.0/';
const CODEPOINT = /^[0-9a-f]{4,6}(?:_[0-9a-f]{4,6}){0,9}$/;

/** The CDN address of one emoji's 512 px animated WebP. */
export function notoFileUrl(codepoint: string): string {
  if (!CODEPOINT.test(codepoint)) throw new LibraryError(`Not a codepoint: ${codepoint}`);
  return `https://fonts.gstatic.com/s/e/notoemoji/latest/${codepoint}/512.webp`;
}

const entrySchema = z
  .object({
    codepoint: z.string(),
    name: z.string().optional(),
    categories: z.array(z.string()).optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .passthrough();

const indexSchema = z.union([
  z.object({ icons: z.array(z.unknown()) }).passthrough(),
  z.array(z.unknown()),
]);

function titleCase(text: string): string {
  return text
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/** Turns the index into candidates; entries it cannot read are skipped and counted. */
export function notoCandidates(json: unknown): {
  candidates: LibraryCandidate[];
  unreadable: number;
} {
  const parsed = indexSchema.safeParse(json);
  if (!parsed.success) throw new LibraryError('The Noto index is not a list of emoji');
  const entries = Array.isArray(parsed.data) ? parsed.data : parsed.data.icons;
  const candidates: LibraryCandidate[] = [];
  let unreadable = 0;
  for (const raw of entries) {
    const entry = entrySchema.safeParse(raw);
    const codepoint = entry.success ? entry.data.codepoint.toLowerCase().replace(/^u\+?/, '') : '';
    if (!entry.success || !CODEPOINT.test(codepoint)) {
      unreadable += 1;
      continue;
    }
    const tags = (entry.data.tags ?? [])
      .map((tag) => tag.replace(/:/g, '').replace(/[-_]+/g, ' ').trim())
      .filter(Boolean);
    const name = titleCase(entry.data.name ?? tags[0] ?? '');
    const categories = entry.data.categories ?? (entry.data.category ? [entry.data.category] : []);
    candidates.push({
      name,
      tags: [
        ...new Set([
          ...tags.map((tag) => tag.toLowerCase()),
          ...categories.map((category) => category.toLowerCase()),
        ]),
      ],
      category: 'animated-emoji',
      categoryWords: categories,
      creator: 'Google',
      creatorUrl: NOTO_PAGE_URL,
      licenceRaw: 'CC BY 4.0',
      licenceUrl: CC_BY_URL,
      sourceUrl: `${NOTO_PAGE_URL}?icon=${codepoint}`,
      originId: codepoint,
      downloadUrl: notoFileUrl(codepoint),
      mature: false,
      emojiLike: true,
      originalWork: true,
    });
  }
  return { candidates, unreadable };
}

export interface NotoOptions {
  fetch: FetchBinary;
  /** A local copy of `api.json`; otherwise it is read from `NOTO_INDEX_URL` through `fetch`. */
  indexFile?: string;
  /** A release bundle's folder of `<codepoint>.webp` files; when set, nothing is fetched for the files. */
  filesDir?: string;
}

export function notoAdapter(options: NotoOptions): StickerAdapter {
  return {
    origin: 'noto',
    source: {
      code: 'noto-animated',
      name: 'Noto Emoji Animation',
      author: 'Google',
      url: NOTO_PAGE_URL,
      licence: 'CC-BY-4.0',
      licenceUrl: CC_BY_URL,
      creditLine:
        'Animated emoji: Noto Emoji Animation by Google, CC BY 4.0, resized and converted to APNG.',
      changeNote: 'Resized and converted to APNG',
      noticeText: null,
      requiresCredit: true,
      creditPerItem: false,
    },
    async candidates() {
      const text = options.indexFile
        ? readFileSync(options.indexFile, 'utf8')
        : (
            await options.fetch(NOTO_INDEX_URL, { maxBytes: 8 * 1024 * 1024, timeoutMs: 30_000 })
          ).toString('utf8');
      return notoCandidates(JSON.parse(text)).candidates;
    },
    async read(candidate, maxBytes) {
      if (options.filesDir)
        return readInside(options.filesDir, `${candidate.originId}.webp`, maxBytes);
      return options.fetch(candidate.downloadUrl as string, { maxBytes, timeoutMs: 30_000 });
    },
  };
}
