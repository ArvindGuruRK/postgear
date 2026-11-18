/**
 * `own` for sounds: PostGear's own effects and loops, made in code from
 * FFmpeg `lavfi` graphs by `npm run clips:sounds:make` into a folder with a
 * `licences.json` naming every file (Module 14). No recording is used, so
 * every sound is an original work by construction.
 */
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { LibraryError, SOUND_CATEGORIES, type SoundAdapter } from '../types';
import { readInside } from './files';

export const OWN_SOUND_LICENCE_FILE = 'licences.json';

const packSchema = z.object({
  licence: z.literal('OWN'),
  creator: z.string().min(1),
  items: z
    .array(
      z.object({
        file: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+\.wav$/),
        originId: z.string().regex(/^sounds\/[a-z0-9-]+$/),
        name: z.string().min(1).max(80),
        category: z.enum(SOUND_CATEGORIES),
        kind: z.enum(['sfx', 'music']),
        tags: z.array(z.string().min(1).max(40)).max(30),
        bpm: z.number().int().min(20).max(300).nullable(),
      }),
    )
    .max(2_000),
});

export function ownSoundsAdapter(folder: string): SoundAdapter {
  const root = path.resolve(folder);
  return {
    origin: 'own',
    source: {
      code: 'own-sounds',
      name: 'PostGear Sounds',
      author: 'PostGear',
      url: 'own://sounds',
      licence: 'OWN',
      licenceUrl: 'own://licence',
      creditLine: null,
      changeNote: null,
      noticeText: null,
      requiresCredit: false,
      creditPerItem: false,
    },
    async candidates() {
      const file = path.join(root, OWN_SOUND_LICENCE_FILE);
      if (!existsSync(file)) {
        throw new LibraryError(
          `No ${OWN_SOUND_LICENCE_FILE} in ${root}. Run npm run clips:sounds:make first.`,
        );
      }
      const parsed = packSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
      if (!parsed.success)
        throw new LibraryError(
          `${OWN_SOUND_LICENCE_FILE} is not a sound pack: ${parsed.error.issues[0]?.message}`,
        );
      return parsed.data.items.map((item) => ({
        name: item.name,
        tags: item.tags,
        category: item.category,
        kindHint: item.kind,
        bpm: item.bpm,
        creator: parsed.data.creator,
        creatorUrl: null,
        licenceRaw: 'OWN',
        licenceUrl: null,
        sourceUrl: `own://${item.originId}`,
        originId: item.originId,
        path: item.file,
        mature: false,
        originalWork: true,
      }));
    },
    async read(candidate, maxBytes) {
      return readInside(root, candidate.path as string, maxBytes);
    },
  };
}
