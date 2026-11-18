/**
 * `opengameart`: hand-picked OpenGameArt sounds and music (Module 14). The
 * operator writes a JSON list, one entry per file, after reading the licence
 * line on each page by hand; the site is never crawled. Only CC0 gets in
 * (the sound guard refuses CC-BY, CC-BY-SA, GPL and OGA-BY), and the source
 * never uses `--auto-publish`.
 *
 * The original-work rule: an entry is an original work only when its creator
 * is a named individual account (an `opengameart.org/users/<name>` page) and
 * the text has no derivative signal (the guard checks the text). Anything
 * else is reported as `needs_review` and not added.
 *
 * Files come through the injected safe fetch, from opengameart.org only, or
 * from a folder the operator points at (`--files`, a release bundle).
 */
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { type FetchBinary, LibraryError, type SoundAdapter } from '../types';
import { readInside } from './files';

const entrySchema = z.object({
  /** The item's page, `https://opengameart.org/content/<slug>`. */
  page: z.string().regex(/^https:\/\/opengameart\.org\/content\/[a-z0-9-]+$/),
  title: z.string().min(1).max(120),
  author: z.string().min(1).max(120),
  /** The author's page, `https://opengameart.org/users/<name>`. */
  authorUrl: z.string().url().nullable().default(null),
  /** The licence line exactly as the page shows it. */
  licence: z.string().min(1).max(80),
  licenceUrl: z.string().url().nullable().default(null),
  /** The file's address on opengameart.org, or its name inside `--files`. */
  file: z.string().min(1).max(400),
  tags: z.array(z.string().min(1).max(40)).max(30).default([]),
  description: z.string().max(4_000).default(''),
  kind: z.enum(['sfx', 'music']).optional(),
  category: z.string().max(40).optional(),
  bpm: z.number().int().min(20).max(300).nullable().default(null),
});

const listSchema = z.array(entrySchema).max(2_000);

const AUTHOR_PAGE = /^https:\/\/opengameart\.org\/users\/[A-Za-z0-9._-]+\/?$/;
const FILE_URL = /^https:\/\/opengameart\.org\/sites\/default\/files\/[^?#]+$/;
const GENERIC_AUTHORS = new Set(['anonymous', 'unknown', 'various', 'n a', 'na', 'none', 'admin']);

/** The page's last part, `content/<slug>`. */
function pageSlug(page: string): string {
  return page.replace(/\/+$/, '').split('/').pop() as string;
}

export interface OpenGameArtOptions {
  /** The operator's list (`--path`). */
  listFile: string;
  /** A folder holding the files by name (`--files`); otherwise they are fetched. */
  filesDir?: string;
  fetch: FetchBinary;
}

export function openGameArtAdapter(options: OpenGameArtOptions): SoundAdapter {
  return {
    origin: 'opengameart',
    source: {
      code: 'opengameart-cc0',
      name: 'OpenGameArt (CC0)',
      author: 'OpenGameArt contributors',
      url: 'https://opengameart.org',
      licence: 'CC0-1.0',
      licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      creditLine: null,
      changeNote: 'Trimmed, levelled and converted to AAC',
      noticeText: null,
      requiresCredit: false,
      creditPerItem: false,
    },
    async candidates() {
      if (!existsSync(options.listFile)) {
        throw new LibraryError(`No list at ${options.listFile}`);
      }
      const parsed = listSchema.safeParse(JSON.parse(readFileSync(options.listFile, 'utf8')));
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new LibraryError(
          `The OpenGameArt list is not valid at ${issue?.path.join('.')}: ${issue?.message}`,
        );
      }
      return parsed.data.map((entry) => {
        const named =
          !!entry.authorUrl &&
          AUTHOR_PAGE.test(entry.authorUrl) &&
          !GENERIC_AUTHORS.has(entry.author.trim().toLowerCase());
        const fileName = entry.file.split('/').pop() ?? entry.file;
        const local = !!options.filesDir;
        return {
          name: entry.title,
          tags: entry.tags,
          category: entry.category,
          categoryWords: [],
          kindHint: entry.kind,
          bpm: entry.bpm,
          description: entry.description,
          creator: entry.author,
          creatorUrl: entry.authorUrl,
          licenceRaw: entry.licence,
          licenceUrl: entry.licenceUrl,
          sourceUrl: entry.page,
          originId: `${pageSlug(entry.page)}/${fileName}`,
          downloadUrl: local ? undefined : entry.file,
          path: local ? fileName : undefined,
          mature: false,
          // A named account's own upload, and for music a creator page (the same page here).
          originalWork: named,
        };
      });
    },
    async read(candidate, maxBytes) {
      if (options.filesDir) return readInside(options.filesDir, candidate.path as string, maxBytes);
      const url = candidate.downloadUrl as string;
      if (!FILE_URL.test(url)) {
        throw new LibraryError('Only files on opengameart.org are fetched');
      }
      return options.fetch(url, { maxBytes, timeoutMs: 30_000 });
    },
  };
}
