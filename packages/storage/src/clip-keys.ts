/**
 * Private Clips keys (Sprint 12): built here, validated everywhere.
 *
 * Every key sits under its workspace, `clips/<orgId>/`, in one of four shapes:
 *
 * - `clips/<orgId>/<videoId>/<kind>-<hex>.<ext>`: a video's files (original,
 *   proxy, poster, filmstrip, signal tracks such as `track-loudness-<hex>.json.gz`).
 * - `clips/<orgId>/exports/<jobId>/<name>.<ext>`: an export while it runs.
 * - `clips/<orgId>/proofs/<jobId>/<name>.<ext>`: a Preview Export, kept 24 hours.
 * - `clips/<orgId>/downloads/<jobId>/<name>.<ext>`: a prepared download, kept 24 hours.
 * - `clips/<orgId>/library/<hex>.<ext>`: a workspace's own stickers and sounds.
 *
 * One more shape sits outside every workspace: the shared library's licence
 * report, `ops/library-runs/<runId>.json` or `.md` (Module 12), written by
 * the operator's ingest and read by the operator only.
 *
 * Video and job ids are lowercase UUIDs. A workspace id is a lowercase slug of
 * letters, digits and single dashes, at most 64 long: a UUID for every real
 * workspace, and ids such as `seed-demo-org` for the seeded ones. The random
 * part is 128 bits of hex, so a key can
 * never hold `..`, a leading slash, a backslash or any character outside
 * `[a-z0-9-_./]`, and deleting a video's prefix can never reach another video.
 * The check is an allowlist of whole shapes, not a blocklist of bad strings.
 */
import { randomBytes } from 'node:crypto';

/** File extensions the private space stores. No HTML, SVG or script, ever. */
export const CLIP_EXTENSIONS = [
  'mp4',
  'webm',
  'mkv',
  'mov',
  'm4a',
  'mp3',
  'wav',
  'ogg',
  'opus',
  'aac',
  'jpg',
  'png',
  'apng',
  'gif',
  'webp',
  'json',
  'json.gz',
  'ass',
  'vtt',
] as const;

/** One of the allowed private file extensions. */
export type ClipExtension = (typeof CLIP_EXTENSIONS)[number];

/** The job folders under a workspace. */
export const CLIP_JOB_FOLDERS = ['exports', 'proofs', 'downloads'] as const;

/** A job folder: exports, Preview Export proofs, or prepared downloads. */
export type ClipJobFolder = (typeof CLIP_JOB_FOLDERS)[number];

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const HEX = '[0-9a-f]{32}';
const KIND = '[a-z][a-z0-9]*(?:-[a-z0-9]+){0,4}';
const NAME = '[a-z0-9]+(?:[-_][a-z0-9]+){0,7}';
const EXT = `(?:${CLIP_EXTENSIONS.map((ext) => ext.replace('.', '\\.')).join('|')})`;
const JOB_FOLDERS = `(?:${CLIP_JOB_FOLDERS.join('|')})`;

/** A workspace id: a UUID, or a seeded slug such as `seed-demo-org`. Never a dot or a slash. */
const ORG = '[a-z0-9]{1,36}(?:-[a-z0-9]{1,36}){0,7}';
const MAX_ORG_LENGTH = 64;

const UUID_PATTERN = new RegExp(`^${UUID}$`);
const ORG_PATTERN = new RegExp(`^${ORG}$`);
const KIND_PATTERN = new RegExp(`^${KIND}$`);
const NAME_PATTERN = new RegExp(`^${NAME}$`);

const CLIP_KEY_PATTERN = new RegExp(
  `^(?:clips/${ORG}/(?:${UUID}/${KIND}-${HEX}|${JOB_FOLDERS}/${UUID}/${NAME}|library/${HEX})\\.${EXT}|ops/library-runs/${UUID}\\.(?:json|md))$`,
);

/**
 * Prefixes a delete may take: a whole workspace, one video, one job, a job
 * folder or the workspace library. Never `clips/` alone, never a half segment.
 */
const CLIP_PREFIX_PATTERN = new RegExp(
  `^clips/${ORG}/(?:${UUID}/|${JOB_FOLDERS}/(?:${UUID}/)?|library/)?$`,
);

const MAX_KIND_LENGTH = 48;
const MAX_NAME_LENGTH = 64;

/** True for a key one of the builders below could have produced. */
export function isValidClipKey(key: string): boolean {
  return typeof key === 'string' && key.length <= 512 && CLIP_KEY_PATTERN.test(key);
}

/** Throws for any key outside the private shapes. */
export function assertValidClipKey(key: string): void {
  if (!isValidClipKey(key)) {
    throw new Error('Refusing to touch a private key PostGear did not generate');
  }
}

/** True for a prefix `deletePrefix` may remove. Always ends with a slash. */
export function isValidClipPrefix(prefix: string): boolean {
  return typeof prefix === 'string' && CLIP_PREFIX_PATTERN.test(prefix);
}

/** Throws for a prefix that is not one whole workspace, video, job or folder. */
export function assertValidClipPrefix(prefix: string): void {
  if (!isValidClipPrefix(prefix)) {
    throw new Error('Refusing to delete a private prefix PostGear did not generate');
  }
}

function assertUuid(value: string, what: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`A private key needs a lowercase UUID for the ${what}`);
  }
}

function assertOrgId(value: string): void {
  if (typeof value !== 'string' || value.length > MAX_ORG_LENGTH || !ORG_PATTERN.test(value)) {
    throw new Error('A private key needs a workspace id of lowercase letters, digits and dashes');
  }
}

function assertExtension(ext: string): asserts ext is ClipExtension {
  if (!(CLIP_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error('A private key needs an allowed file extension');
  }
}

/**
 * Turns an asset kind into its key segment: `ANALYSIS_AUDIO` becomes
 * `analysis-audio`, `track-loudness` stays as it is.
 */
export function clipKindSegment(kind: string): string {
  const segment = kind.toLowerCase().replace(/_/g, '-');

  if (segment.length > MAX_KIND_LENGTH || !KIND_PATTERN.test(segment)) {
    throw new Error('A private key needs a short kind made of letters, digits and dashes');
  }

  return segment;
}

function fileName(name: string): string {
  if (name.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(name)) {
    throw new Error(
      'A private file name may hold only lowercase letters, digits, dashes and underscores',
    );
  }

  return name;
}

function randomHex(): string {
  return randomBytes(16).toString('hex');
}

function checked(key: string): string {
  assertValidClipKey(key);
  return key;
}

function jobFile(
  folder: ClipJobFolder,
  orgId: string,
  jobId: string,
  name: string,
  ext: ClipExtension,
): string {
  assertOrgId(orgId);
  assertUuid(jobId, 'job');
  assertExtension(ext);
  return checked(`clips/${orgId}/${folder}/${jobId}/${fileName(name)}.${ext}`);
}

function jobPrefix(folder: ClipJobFolder, orgId: string, jobId: string): string {
  assertOrgId(orgId);
  assertUuid(jobId, 'job');
  return `clips/${orgId}/${folder}/${jobId}/`;
}

/**
 * Builders for every private key and prefix. Each one validates what it
 * builds, so a caller cannot smuggle a separator in through an id.
 */
export const clipKeys = {
  /** Everything a workspace holds; used when a workspace is deleted. */
  orgPrefix(orgId: string): string {
    assertOrgId(orgId);
    return `clips/${orgId}/`;
  },

  /** A new random key for one of a video's files. */
  videoFile(orgId: string, videoId: string, kind: string, ext: ClipExtension): string {
    assertOrgId(orgId);
    assertUuid(videoId, 'video');
    assertExtension(ext);
    return checked(`clips/${orgId}/${videoId}/${clipKindSegment(kind)}-${randomHex()}.${ext}`);
  },

  /** All of one video's files; deleting a video deletes this. */
  videoPrefix(orgId: string, videoId: string): string {
    assertOrgId(orgId);
    assertUuid(videoId, 'video');
    return `clips/${orgId}/${videoId}/`;
  },

  /** A file an export writes, such as `render.mp4`. */
  exportFile(orgId: string, jobId: string, name: string, ext: ClipExtension): string {
    return jobFile('exports', orgId, jobId, name, ext);
  },

  /** Everything one export wrote. */
  exportPrefix(orgId: string, jobId: string): string {
    return jobPrefix('exports', orgId, jobId);
  },

  /** A Preview Export file, removed after 24 hours. */
  proofFile(orgId: string, jobId: string, name: string, ext: ClipExtension): string {
    return jobFile('proofs', orgId, jobId, name, ext);
  },

  /** Everything one Preview Export wrote. */
  proofPrefix(orgId: string, jobId: string): string {
    return jobPrefix('proofs', orgId, jobId);
  },

  /** A prepared download, kept 24 hours behind a signed address. */
  downloadFile(orgId: string, jobId: string, name: string, ext: ClipExtension): string {
    return jobFile('downloads', orgId, jobId, name, ext);
  },

  /** Everything one download job wrote. */
  downloadPrefix(orgId: string, jobId: string): string {
    return jobPrefix('downloads', orgId, jobId);
  },

  /** A new random key for a workspace's own sticker or sound. */
  libraryUpload(orgId: string, ext: ClipExtension): string {
    assertOrgId(orgId);
    assertExtension(ext);
    return checked(`clips/${orgId}/library/${randomHex()}.${ext}`);
  },

  /** All of a workspace's own stickers and sounds. */
  libraryPrefix(orgId: string): string {
    assertOrgId(orgId);
    return `clips/${orgId}/library/`;
  },

  /** The shared library's licence report for one ingest run (operator only, never a workspace's). */
  libraryReport(runId: string, ext: 'json' | 'md'): string {
    assertUuid(runId, 'run');
    if (ext !== 'json' && ext !== 'md') throw new Error('A licence report is JSON or Markdown');
    return checked(`ops/library-runs/${runId}.${ext}`);
  },
} as const;

const CLIP_CONTENT_TYPES: Record<ClipExtension, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  aac: 'audio/aac',
  jpg: 'image/jpeg',
  png: 'image/png',
  apng: 'image/apng',
  gif: 'image/gif',
  webp: 'image/webp',
  json: 'application/json',
  'json.gz': 'application/gzip',
  ass: 'text/plain; charset=utf-8',
  vtt: 'text/vtt; charset=utf-8',
};

/** The content type a private file is served with, from its extension. */
export function contentTypeForClipKey(key: string): string {
  assertValidClipKey(key);

  if (key.endsWith('.json.gz')) return 'application/gzip';
  if (key.endsWith('.md')) return 'text/markdown; charset=utf-8';

  const ext = key.slice(key.lastIndexOf('.') + 1) as ClipExtension;
  return CLIP_CONTENT_TYPES[ext];
}
