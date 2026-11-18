/**
 * `own`: PostGear's own sticker pack, drawn by `npm run clips:stickers:draw`
 * into a folder with a `licences.json` naming every file (Module 12).
 */
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { LibraryError, STICKER_CATEGORIES, type StickerAdapter } from '../types';
import { readInside } from './files';

export const OWN_LICENCE_FILE = 'licences.json';

const packSchema = z.object({
  licence: z.literal('OWN'),
  creator: z.string().min(1),
  items: z
    .array(
      z.object({
        file: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+\.(?:png|webp)$/),
        originId: z.string().min(1).max(120),
        name: z.string().min(1).max(80),
        category: z.enum(STICKER_CATEGORIES),
        tags: z.array(z.string().min(1).max(40)).max(30),
        animated: z.boolean(),
      }),
    )
    .max(5_000),
});

export function ownAdapter(folder: string): StickerAdapter {
  const root = path.resolve(folder);
  return {
    origin: 'own',
    source: {
      code: 'own',
      name: 'PostGear Stickers',
      author: 'PostGear',
      url: 'own://stickers',
      licence: 'OWN',
      licenceUrl: 'own://licence',
      creditLine: null,
      changeNote: null,
      noticeText: null,
      requiresCredit: false,
      creditPerItem: false,
    },
    async candidates() {
      const file = path.join(root, OWN_LICENCE_FILE);
      if (!existsSync(file)) {
        throw new LibraryError(
          `No ${OWN_LICENCE_FILE} in ${root}. Run npm run clips:stickers:draw first.`,
        );
      }
      const parsed = packSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
      if (!parsed.success)
        throw new LibraryError(
          `${OWN_LICENCE_FILE} is not a sticker pack: ${parsed.error.issues[0]?.message}`,
        );
      return parsed.data.items.map((item) => ({
        name: item.name,
        tags: item.tags,
        category: item.category,
        creator: parsed.data.creator,
        creatorUrl: null,
        licenceRaw: 'OWN',
        licenceUrl: null,
        sourceUrl: `own://stickers/${item.originId}`,
        originId: item.originId,
        path: item.file,
        mature: false,
        emojiLike: item.category === 'animated-emoji',
        originalWork: true,
      }));
    },
    async read(candidate, maxBytes) {
      return readInside(root, candidate.path as string, maxBytes);
    },
  };
}
