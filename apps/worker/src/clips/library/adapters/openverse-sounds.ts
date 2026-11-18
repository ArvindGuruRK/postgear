/**
 * `openverse` and `freesound` for sounds: built, and off (Module 14; their
 * intake is Module 21's). Both sites' terms ask for written permission
 * before commercial use, so each adapter refuses to run unless its own
 * switch is on (`CLIPS_INGEST_OPENVERSE_OK`, `CLIPS_INGEST_FREESOUND_OK`),
 * and neither may ever use `--auto-publish`.
 *
 * Neither calls the site's API itself: the operator saves one API answer as
 * a JSON file and points `--path` at it, and the files come through the
 * injected safe fetch from the site's own hosts only. Only CC0 and the
 * Public Domain Mark pass the sound guard.
 */
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { type FetchBinary, LibraryError, type LibraryCandidate, type SoundAdapter } from '../types';

const CC0_URL = 'https://creativecommons.org/publicdomain/zero/1.0/';
const PDM_URL = 'https://creativecommons.org/publicdomain/mark/1.0/';

export const OPENVERSE_REFUSAL =
  'Openverse is off: set CLIPS_INGEST_OPENVERSE_OK=true only after its written permission (Module 21).';
export const FREESOUND_REFUSAL =
  'Freesound is off: set CLIPS_INGEST_FREESOUND_OK=true only after its written permission (Module 21).';

export interface AnswerFileOptions {
  /** Whether the source's switch is on. */
  enabled: boolean;
  /** The saved API answer (`--path`). */
  answerFile: string;
  fetch: FetchBinary;
}

function readAnswer<S extends z.ZodTypeAny>(file: string, schema: S, what: string): z.infer<S> {
  if (!existsSync(file)) throw new LibraryError(`No ${what} answer at ${file}`);
  const parsed = schema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.success) {
    throw new LibraryError(`${file} is not a ${what} answer: ${parsed.error.issues[0]?.message}`);
  }
  return parsed.data;
}

// --- Openverse --------------------------------------------------------------------

const openverseAnswer = z.object({
  results: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().nullable().default(null),
      foreign_landing_url: z.string().url(),
      url: z.string().url(),
      creator: z.string().nullable().default(null),
      creator_url: z.string().url().nullable().default(null),
      license: z.string(),
      license_version: z.string().nullable().default(null),
      license_url: z.string().url().nullable().default(null),
      tags: z
        .array(z.object({ name: z.string() }))
        .nullable()
        .default([]),
      mature: z.boolean().default(false),
      category: z.string().nullable().default(null),
      genres: z.array(z.string()).nullable().default([]),
      bit_rate: z.number().nullable().optional(),
    }),
  ),
});

/** An Openverse licence code and version as the words the guard reads. */
export function openverseLicence(code: string, version: string | null): string {
  if (code === 'cc0') return 'CC0 1.0';
  if (code === 'pdm') return 'Public Domain Mark 1.0';
  return `CC ${code.toUpperCase()} ${version ?? ''}`.trim();
}

export function openverseSoundsAdapter(options: AnswerFileOptions): SoundAdapter {
  if (!options.enabled) throw new LibraryError(OPENVERSE_REFUSAL);
  return {
    origin: 'openverse',
    source: {
      code: 'openverse-audio',
      name: 'Openverse (CC0 And Public Domain)',
      author: 'Openverse contributors',
      url: 'https://openverse.org',
      licence: 'CC0-1.0',
      licenceUrl: CC0_URL,
      creditLine: null,
      changeNote: 'Trimmed, levelled and converted to AAC',
      noticeText: null,
      requiresCredit: false,
      creditPerItem: false,
    },
    async candidates() {
      if (!options.enabled) throw new LibraryError(OPENVERSE_REFUSAL);
      const answer = readAnswer(options.answerFile, openverseAnswer, 'Openverse');
      return answer.results.map(
        (item): LibraryCandidate => ({
          name: item.title ?? '',
          tags: (item.tags ?? []).map((tag) => tag.name),
          categoryWords: [...(item.genres ?? []), item.category ?? ''].filter(Boolean),
          kindHint:
            item.category === 'music'
              ? 'music'
              : item.category === 'sound_effect'
                ? 'sfx'
                : undefined,
          creator: item.creator ?? '',
          creatorUrl: item.creator_url,
          licenceRaw: openverseLicence(item.license, item.license_version),
          licenceUrl:
            item.license_url ??
            (item.license === 'cc0' ? CC0_URL : item.license === 'pdm' ? PDM_URL : null),
          sourceUrl: item.foreign_landing_url,
          originId: item.id,
          downloadUrl: item.url,
          mature: item.mature,
          // No original-work flag in Openverse: a named creator with a page is the least it needs.
          originalWork: !!item.creator?.trim() && !!item.creator_url,
        }),
      );
    },
    async read(candidate, maxBytes) {
      if (!options.enabled) throw new LibraryError(OPENVERSE_REFUSAL);
      return options.fetch(candidate.downloadUrl as string, { maxBytes, timeoutMs: 30_000 });
    },
  };
}

// --- Freesound --------------------------------------------------------------------

const freesoundAnswer = z.object({
  results: z.array(
    z.object({
      id: z.number().int(),
      name: z.string(),
      url: z.string().url(),
      username: z.string().nullable().default(null),
      license: z.string(),
      tags: z.array(z.string()).default([]),
      description: z.string().default(''),
      previews: z.record(z.string(), z.string().url()).default({}),
    }),
  ),
});

/** A Freesound licence address as the words the guard reads (only CC0 is useful to us). */
export function freesoundLicence(url: string): { raw: string; url: string | null } {
  if (/creativecommons\.org\/publicdomain\/zero\/1\.0/.test(url)) return { raw: 'CC0 1.0', url };
  return { raw: url, url };
}

const FREESOUND_FILE = /^https:\/\/(?:cdn\.)?freesound\.org\//;

export function freesoundSoundsAdapter(options: AnswerFileOptions): SoundAdapter {
  if (!options.enabled) throw new LibraryError(FREESOUND_REFUSAL);
  return {
    origin: 'freesound',
    source: {
      code: 'freesound-cc0',
      name: 'Freesound (CC0)',
      author: 'Freesound contributors',
      url: 'https://freesound.org',
      licence: 'CC0-1.0',
      licenceUrl: CC0_URL,
      creditLine: null,
      changeNote: 'Trimmed, levelled and converted to AAC',
      noticeText: null,
      requiresCredit: false,
      creditPerItem: false,
    },
    async candidates() {
      if (!options.enabled) throw new LibraryError(FREESOUND_REFUSAL);
      const answer = readAnswer(options.answerFile, freesoundAnswer, 'Freesound');
      return answer.results.map((item): LibraryCandidate => {
        const licence = freesoundLicence(item.license);
        return {
          name: item.name.replace(/\.(?:wav|mp3|ogg|flac|aiff?)$/i, ''),
          tags: item.tags,
          categoryWords: [],
          description: item.description,
          creator: item.username ?? '',
          creatorUrl: item.username ? `https://freesound.org/people/${item.username}/` : null,
          licenceRaw: licence.raw,
          licenceUrl: licence.url,
          sourceUrl: item.url,
          originId: String(item.id),
          downloadUrl: item.previews['preview-hq-mp3'] ?? item.previews['preview-hq-ogg'],
          mature: false,
          // Freesound is for people's own recordings; a named account is required.
          originalWork: !!item.username,
        };
      });
    },
    async read(candidate, maxBytes) {
      if (!options.enabled) throw new LibraryError(FREESOUND_REFUSAL);
      const url = candidate.downloadUrl as string;
      if (!FREESOUND_FILE.test(url))
        throw new LibraryError('Only files on freesound.org are fetched');
      return options.fetch(url, { maxBytes, timeoutMs: 30_000 });
    },
  };
}
