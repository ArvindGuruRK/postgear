/**
 * The operator's library commands (Modules 12 and 14). They live in the worker
 * because the worker image holds FFmpeg and runs beside the production
 * database and bucket. No API route accepts a source address, and no user
 * can start any of this.
 *
 *   npm run clips:library:ingest -- --kind sticker --source own|kenney|openpeeps|noto
 *        [--path <folder or api.json>] [--files <folder>] [--limit 200] [--category <slug>]
 *        [--dry-run] [--auto-publish] [--brands <file>] [--pack-url <url>] [--pack-name <name>]
 *   npm run clips:library:ingest -- --kind sound --source own|kenney|opengameart|openverse|freesound
 *        [--path <folder, list.json or saved API answer>] [--files <folder>] [--limit 200]
 *        [--category <slug>] [--dry-run] [--auto-publish] [--brands <file>] [--pack-url <url>]
 *        [--pack-name <name>]
 *   npm run clips:library:publish -- --run <runId>
 *   npm run clips:library:hide    -- --id <id> --reason "..."     (a sticker or a sound)
 *   npm run clips:library:remove  -- --id <id> --reason "..."     (a sticker or a sound)
 *   npm run clips:library:seed      (the own stickers and sounds with --auto-publish, then
 *                                    Kenney and Noto from CLIPS_LIBRARY_BUNDLE_DIR when it
 *                                    holds them)
 *
 * Openverse and Freesound refuse to run unless `CLIPS_INGEST_OPENVERSE_OK` or
 * `CLIPS_INGEST_FREESOUND_OK` is true (Module 21, after their written OK).
 *
 * Every command refuses to start unless `CLIPS_LIBRARY_INGEST=true` is set in
 * the shell that runs it; the repo's `.env` is read only after that check.
 */
import { existsSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { createRunTool, toolPaths } from '@postgear/media-tools';
import { fetchBinarySafely } from '@postgear/seo-engine';
import { createPrivateStorage, createStorage } from '@postgear/storage';
import { loadWorkerEnv } from '../../config/env';
import { privateStorageConfigFrom, publicStorageConfigFrom, scratchRootFrom } from '../config';
import { kenneyAdapter } from './adapters/kenney';
import { kenneySoundsAdapter } from './adapters/kenney-sounds';
import { notoAdapter } from './adapters/noto';
import { openGameArtAdapter } from './adapters/opengameart';
import { openPeepsAdapter } from './adapters/openpeeps';
import { freesoundSoundsAdapter, openverseSoundsAdapter } from './adapters/openverse-sounds';
import { ownAdapter } from './adapters/own';
import { ownSoundsAdapter } from './adapters/own-sounds';
import { loadBrands } from './brands';
import { type IngestDeps, ingestStickers } from './ingest';
import { ingestSounds, type SoundIngestDeps } from './ingest-sounds';
import { hideLibraryItem, publishLibraryRun, removeLibraryItem } from './status';
import { prismaLibraryStore } from './store';
import { isStickerCategory } from './taxonomy';
import {
  type FetchBinary,
  isSoundCategory,
  LibraryError,
  type SoundAdapter,
  type StickerAdapter,
} from './types';

/** A plain User-Agent for the ingest's downloads (research 10: generic, one request at a time). */
const INGEST_USER_AGENT = 'Mozilla/5.0 (compatible; LibraryIngest/1.0)';

export const INGEST_REFUSAL =
  'The library commands only run with CLIPS_LIBRARY_INGEST=true set in this shell (they are for the operator).';

/** The folder holding `turbo.json`, walking up from here. */
function repoRoot(): string {
  let dir = path.resolve(__dirname);
  for (;;) {
    if (existsSync(path.join(dir, 'turbo.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new LibraryError('Run the library commands from inside the repo');
    dir = parent;
  }
}

export function parseFlags(argv: readonly string[]): Map<string, string | true> {
  const flags = new Map<string, string | true>();
  for (let k = 0; k < argv.length; k += 1) {
    const arg = argv[k] as string;
    if (!arg.startsWith('--')) throw new LibraryError(`Unexpected ${arg}`);
    const next = argv[k + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(arg.slice(2), next);
      k += 1;
    } else {
      flags.set(arg.slice(2), true);
    }
  }
  return flags;
}

function text(flags: Map<string, string | true>, name: string): string | undefined {
  const value = flags.get(name);
  if (value === true) throw new LibraryError(`--${name} needs a value`);
  return value;
}

function required(flags: Map<string, string | true>, name: string): string {
  const value = text(flags, name);
  if (!value) throw new LibraryError(`--${name} is required`);
  return value;
}

/** The safe fetch for an outside source: no private addresses, a size cap and a timeout. */
const safeFetch: FetchBinary = async (url, options) => {
  const response = await fetchBinarySafely(url, {
    maxBytes: options.maxBytes,
    timeoutMs: options.timeoutMs,
    userAgent: INGEST_USER_AGENT,
    accept:
      'image/webp,image/apng,image/png,image/gif,audio/ogg,audio/mpeg,audio/wav,audio/flac,audio/mp4,application/json',
  });
  return response.body;
};

export function ownPackDir(root: string = repoRoot()): string {
  return path.resolve(
    process.env.CLIPS_STICKERS_OWN_DIR || path.join(root, '.cache', 'clips-stickers-own'),
  );
}

export function ownSoundsDir(root: string = repoRoot()): string {
  return path.resolve(
    process.env.CLIPS_SOUNDS_OWN_DIR || path.join(root, '.cache', 'clips-sounds-own'),
  );
}

/** The kind the command is about: `sticker` (the default) or `sound`. */
export function kindOf(flags: Map<string, string | true>): 'sticker' | 'sound' {
  const kind = text(flags, 'kind') ?? 'sticker';
  if (kind !== 'sticker' && kind !== 'sound') throw new LibraryError('--kind is sticker or sound');
  return kind;
}

export function soundAdapterFor(
  flags: Map<string, string | true>,
  env: Record<string, string | undefined> = process.env,
): SoundAdapter {
  const source = required(flags, 'source');
  const folder = text(flags, 'path');
  switch (source) {
    case 'own':
      return ownSoundsAdapter(folder ?? ownSoundsDir());
    case 'kenney':
      if (!folder) throw new LibraryError('--path must point at the unzipped Kenney audio pack');
      return kenneySoundsAdapter(folder, {
        packUrl: text(flags, 'pack-url'),
        packName: text(flags, 'pack-name'),
        category: text(flags, 'category'),
      });
    case 'opengameart':
      if (!folder) throw new LibraryError('--path must point at the OpenGameArt list (JSON)');
      return openGameArtAdapter({ listFile: folder, filesDir: text(flags, 'files'), fetch: safeFetch });
    case 'openverse':
      if (!folder) throw new LibraryError('--path must point at the saved Openverse answer (JSON)');
      return openverseSoundsAdapter({
        enabled: env.CLIPS_INGEST_OPENVERSE_OK === 'true',
        answerFile: folder,
        fetch: safeFetch,
      });
    case 'freesound':
      if (!folder) throw new LibraryError('--path must point at the saved Freesound answer (JSON)');
      return freesoundSoundsAdapter({
        enabled: env.CLIPS_INGEST_FREESOUND_OK === 'true',
        answerFile: folder,
        fetch: safeFetch,
      });
    default:
      throw new LibraryError(
        `No sound source called ${source}. Use own, kenney, opengameart, openverse or freesound.`,
      );
  }
}

function adapterFor(flags: Map<string, string | true>): StickerAdapter {
  const source = required(flags, 'source');
  const folder = text(flags, 'path');
  switch (source) {
    case 'own':
      return ownAdapter(folder ?? ownPackDir());
    case 'kenney':
      if (!folder) throw new LibraryError('--path must point at the unzipped Kenney pack');
      return kenneyAdapter(folder, {
        packUrl: text(flags, 'pack-url'),
        packName: text(flags, 'pack-name'),
        category: text(flags, 'category'),
      });
    case 'openpeeps':
      if (!folder) throw new LibraryError('--path must point at the unzipped Open Peeps download');
      return openPeepsAdapter(folder);
    case 'noto':
      return notoAdapter({ fetch: safeFetch, indexFile: folder, filesDir: text(flags, 'files') });
    default:
      throw new LibraryError(`No source called ${source}. Use own, kenney, openpeeps or noto.`);
  }
}

type BothDeps = IngestDeps & SoundIngestDeps & { store: ReturnType<typeof prismaLibraryStore> };

function buildDeps(flags: Map<string, string | true>): BothDeps {
  const env = loadWorkerEnv(process.env);
  return {
    store: prismaLibraryStore(),
    storage: createStorage(publicStorageConfigFrom(env)),
    privateStorage: createPrivateStorage(privateStorageConfigFrom(env)),
    runTool: createRunTool(toolPaths(env as unknown as Record<string, string | undefined>)),
    scratchRoot: scratchRootFrom(env),
    brands: loadBrands(text(flags, 'brands') ?? process.env.CLIPS_LIBRARY_BRANDS_FILE ?? null),
    log: (line) => console.log(line),
  };
}

/** The `--limit` flag, checked. */
function limitOf(flags: Map<string, string | true>): number | undefined {
  const limitText = text(flags, 'limit');
  const limit = limitText === undefined ? undefined : Number(limitText);
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0))
    throw new LibraryError('--limit is a whole number above 0');
  return limit;
}

async function ingestSoundsCommand(
  flags: Map<string, string | true>,
  adapter: SoundAdapter,
  deps: SoundIngestDeps,
): Promise<void> {
  const category = text(flags, 'category');
  if (category !== undefined && !isSoundCategory(category))
    throw new LibraryError(`No sound category called ${category}`);
  const limit = limitOf(flags);
  console.log(`Ingesting ${adapter.source.name}${flags.has('dry-run') ? ' (dry run)' : ''}...`);
  const result = await ingestSounds(adapter, deps, {
    limit,
    category,
    dryRun: flags.has('dry-run'),
    autoPublish: flags.has('auto-publish'),
    args: Object.fromEntries(flags),
  });
  const { report } = result;
  const byCategory: Record<string, number> = {};
  for (const item of report.accepted) byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
  console.log(
    `Run ${result.runId}: ${report.accepted.length} accepted ${JSON.stringify(byCategory)}, ${report.rejected.length} rejected ${JSON.stringify(report.rejectionsByReason)}.`,
  );
  console.log(
    result.reportKey ? `Report: ${result.reportKey} in the private bucket.` : result.markdown,
  );
}

async function ingest(
  flags: Map<string, string | true>,
  adapter: StickerAdapter,
  deps: IngestDeps,
): Promise<void> {
  if (kindOf(flags) !== 'sticker') throw new LibraryError('This source is for stickers');
  const category = text(flags, 'category');
  if (category !== undefined && !isStickerCategory(category))
    throw new LibraryError(`No category called ${category}`);
  const limit = limitOf(flags);
  console.log(`Ingesting ${adapter.source.name}${flags.has('dry-run') ? ' (dry run)' : ''}...`);
  const result = await ingestStickers(adapter, deps, {
    limit,
    category: category as never,
    dryRun: flags.has('dry-run'),
    autoPublish: flags.has('auto-publish'),
    args: Object.fromEntries(flags),
  });
  const { report } = result;
  console.log(
    `Run ${result.runId}: ${report.accepted.length} accepted, ${report.rejected.length} rejected ${JSON.stringify(report.rejectionsByReason)}.`,
  );
  console.log(
    result.reportKey ? `Report: ${result.reportKey} in the private bucket.` : result.markdown,
  );
}

export async function main(argv: readonly string[]): Promise<void> {
  if (process.env.CLIPS_LIBRARY_INGEST !== 'true') throw new LibraryError(INGEST_REFUSAL);
  const root = repoRoot();
  const envFile = path.join(root, '.env');
  // Values already set in the shell win over the file.
  if (existsSync(envFile) && typeof process.loadEnvFile === 'function')
    process.loadEnvFile(envFile);

  const [command, ...rest] = argv;
  const flags = parseFlags(rest);
  switch (command) {
    case 'ingest': {
      if (kindOf(flags) === 'sound') {
        const adapter = soundAdapterFor(flags);
        await ingestSoundsCommand(flags, adapter, buildDeps(flags));
        return;
      }
      const adapter = adapterFor(flags);
      await ingest(flags, adapter, buildDeps(flags));
      return;
    }
    case 'publish': {
      const count = await publishLibraryRun(prismaLibraryStore(), required(flags, 'run'));
      console.log(`Published ${count} items.`);
      return;
    }
    case 'hide': {
      const kind = await hideLibraryItem(
        prismaLibraryStore(),
        required(flags, 'id'),
        required(flags, 'reason'),
      );
      console.log(`Hidden (a ${kind}). Clips that use it keep working.`);
      return;
    }
    case 'remove': {
      const env = loadWorkerEnv(process.env);
      const kind = await removeLibraryItem(
        prismaLibraryStore(),
        createStorage(publicStorageConfigFrom(env)),
        required(flags, 'id'),
        required(flags, 'reason'),
      );
      console.log(`Removed (a ${kind}), its files deleted, and it can never come back.`);
      return;
    }
    case 'seed': {
      const deps = buildDeps(flags);
      await ingest(new Map([['auto-publish', true]]), ownAdapter(ownPackDir(root)), deps);
      const bundle = process.env.CLIPS_LIBRARY_BUNDLE_DIR;
      const kenney = bundle ? path.join(bundle, 'kenney-emotes') : null;
      const noto = bundle ? path.join(bundle, 'noto') : null;
      if (kenney && existsSync(kenney)) {
        await ingest(new Map([['auto-publish', true]]), kenneyAdapter(kenney), deps);
      }
      if (noto && existsSync(path.join(noto, 'api.json'))) {
        const adapter = notoAdapter({
          fetch: async () => {
            throw new LibraryError('The seed reads the bundle only');
          },
          indexFile: path.join(noto, 'api.json'),
          filesDir: path.join(noto, 'files'),
        });
        await ingest(new Map([['auto-publish', true]]), adapter, deps);
      }
      if (!kenney || !existsSync(kenney) || !noto || !existsSync(path.join(noto, 'api.json'))) {
        console.log(
          'Kenney and Noto were not seeded: CLIPS_LIBRARY_BUNDLE_DIR has no kenney-emotes or noto/api.json.',
        );
      }

      // Sounds (Module 14): our own, then each Kenney audio pack in the bundle.
      const publish = new Map<string, string | true>([
        ['kind', 'sound'],
        ['auto-publish', true],
      ]);
      await ingestSoundsCommand(publish, ownSoundsAdapter(ownSoundsDir(root)), deps);
      const packs = bundle ? path.join(bundle, 'kenney-sounds') : null;
      const packFolders =
        packs && existsSync(packs)
          ? readdirSync(packs, { withFileTypes: true })
              .filter((entry) => entry.isDirectory())
              .map((entry) => path.join(packs, entry.name))
          : [];
      for (const pack of packFolders) {
        await ingestSoundsCommand(publish, kenneySoundsAdapter(pack), deps);
      }
      if (packFolders.length === 0) {
        console.log(
          'Kenney sounds were not seeded: CLIPS_LIBRARY_BUNDLE_DIR has no kenney-sounds/<pack>/ folders.',
        );
      }
      return;
    }
    default:
      throw new LibraryError('Use ingest, publish, hide, remove or seed.');
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(error instanceof LibraryError ? error.message : error);
      process.exit(1);
    });
}
