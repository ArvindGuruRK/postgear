/**
 * Security sweep, Module 20: "Storage". A delete by prefix reaches one
 * workspace's files and nothing else, and the public and private spaces never
 * share a key.
 *
 * Existing tests this builds on (not repeated here):
 * - clip-keys.test.ts:76 (builders refuse ids, kinds and names that escape),
 *   :94 (key shapes), :120 and :133 (prefix shapes, the root refused), :157
 *   (workspace ids).
 * - private/local-private.storage.test.ts:107 and :149, and
 *   private/s3-private.storage.test.ts:154 (delete by prefix, `clips/` and
 *   `../` refused).
 * - private/private-storage.factory.test.ts:23 (the local binding is refused
 *   in production).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeleteObjectsCommand, type S3Client } from '@aws-sdk/client-s3';
import { clipKeys, isValidClipKey, isValidClipPrefix } from './clip-keys';
import { LocalPrivateStorage } from './private/local-private.storage';
import { S3PrivateStorage } from './private/s3-private.storage';
import { createMediaKey, isValidKey, isValidLibraryKey, libraryKeys } from './storage-keys';

const VIDEO = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const JOB = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';

/** Workspace ids where one is the start of another: the case a prefix must not blur. */
const NEIGHBOURS = [
  ['seed', 'seed-demo-org'],
  ['ab', 'ab-c'],
  ['ab', 'abc'],
  ['3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e', '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e0'],
] as const;

/** Every builder that makes a prefix a delete may take, from a workspace id. */
const PREFIX_BUILDERS: Array<[string, (org: string) => string]> = [
  ['orgPrefix', (org) => clipKeys.orgPrefix(org)],
  ['videoPrefix', (org) => clipKeys.videoPrefix(org, VIDEO)],
  ['exportPrefix', (org) => clipKeys.exportPrefix(org, JOB)],
  ['proofPrefix', (org) => clipKeys.proofPrefix(org, JOB)],
  ['downloadPrefix', (org) => clipKeys.downloadPrefix(org, JOB)],
  ['libraryPrefix', (org) => clipKeys.libraryPrefix(org)],
];

/** One file of each kind a workspace holds. */
function keysOf(org: string): string[] {
  return [
    clipKeys.videoFile(org, VIDEO, 'proxy', 'mp4'),
    clipKeys.exportFile(org, JOB, 'render', 'mp4'),
    clipKeys.proofFile(org, JOB, 'proof', 'mp4'),
    clipKeys.downloadFile(org, JOB, 'file', 'mp4'),
    clipKeys.libraryUpload(org, 'png'),
  ];
}

describe('Clips security: Storage', () => {
  describe('prefix builders', () => {
    const HOSTILE_ORGS = [
      '',
      '..',
      '../other',
      'a/b',
      'a\\b',
      'Seed',
      'seed.',
      'seed-',
      '-seed',
      'seed--org',
      'seed org',
      'seed%2forg',
      'x'.repeat(65),
    ];

    it.each(PREFIX_BUILDERS)(
      '%s refuses a workspace id that could leave its folder',
      (_name, build) => {
        for (const org of HOSTILE_ORGS) {
          expect(() => build(org)).toThrow();
        }
      },
    );

    it.each(PREFIX_BUILDERS)(
      '%s always builds a prefix a delete may take, inside the workspace',
      (_name, build) => {
        for (const [org] of NEIGHBOURS) {
          const prefix = build(org);
          expect(isValidClipPrefix(prefix)).toBe(true);
          expect(prefix.startsWith(`clips/${org}/`)).toBe(true);
        }
      },
    );

    it("never covers a neighbouring workspace's files", () => {
      for (const [short, long] of NEIGHBOURS) {
        for (const [, build] of PREFIX_BUILDERS) {
          const prefix = build(short);
          for (const key of keysOf(long)) {
            expect(key.startsWith(prefix)).toBe(false);
          }
        }
      }
    });

    it('refuses a prefix with no closing slash, which would match a neighbour by its start', () => {
      for (const [short] of NEIGHBOURS) {
        expect(isValidClipPrefix(`clips/${short}`)).toBe(false);
        expect(isValidClipPrefix(`clips/${short}/${VIDEO}`)).toBe(false);
        expect(isValidClipPrefix(`clips/${short}/exports/${JOB}`)).toBe(false);
      }
    });
  });

  describe('a delete by prefix on local disk', () => {
    let root: string;
    let storage: LocalPrivateStorage;

    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), 'postgear-private-sweep-'));
      storage = new LocalPrivateStorage(root, 'http://localhost:3001/', 'x'.repeat(48));
    });

    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it.each(NEIGHBOURS)("removes %s's files and keeps every file of %s", async (short, long) => {
      // Built once: video and library names are random on every call.
      const gone = keysOf(short);
      const kept = keysOf(long);
      for (const key of [...gone, ...kept]) {
        await storage.put(key, Buffer.from('x'), 'application/octet-stream');
      }
      for (const [, build] of PREFIX_BUILDERS) {
        await storage.deletePrefix(build(short));
      }
      for (const key of gone) expect(await storage.exists(key)).toBe(false);
      for (const key of kept) expect(await storage.exists(key)).toBe(true);
    });
  });

  describe('a delete by prefix on S3', () => {
    it('never deletes a key the store answers from outside the prefix', async () => {
      const [short, long] = NEIGHBOURS[0];
      const prefix = clipKeys.videoPrefix(short, VIDEO);
      const own = clipKeys.videoFile(short, VIDEO, 'proxy', 'mp4');
      // A store that answers more than it was asked for (a bug, or another S3-like service).
      const strays = [
        ...keysOf(long),
        `${prefix.slice(0, -1)}x/file.mp4`,
        'library/sounds/ab/abc.m4a',
        '2026/11/0123456789abcdef0123456789abcdef.mp4',
      ];
      const send = jest.fn(async (command: unknown) => {
        if (command instanceof DeleteObjectsCommand) return {};
        return { Contents: [own, ...strays].map((Key) => ({ Key })), IsTruncated: false };
      });
      const storage = new S3PrivateStorage({ send } as unknown as S3Client, 'postgear-clips');

      expect(await storage.deletePrefix(prefix)).toBe(1);
      const deletes = send.mock.calls
        .map(([command]) => command)
        .filter(
          (command): command is DeleteObjectsCommand => command instanceof DeleteObjectsCommand,
        );
      const sent = deletes
        .flatMap((command) => command.input.Delete?.Objects ?? [])
        .map((o) => o.Key);
      expect(sent).toEqual([own]);
    });
  });

  describe('the public and private spaces', () => {
    const hash = 'ab'.padEnd(64, '0');
    const publicKeys = [
      createMediaKey('mp4'),
      libraryKeys.sound(hash),
      libraryKeys.sticker(hash, 'png'),
      libraryKeys.preview(hash),
    ];

    it('never share a key: a private key is refused by the public space, and the other way', () => {
      for (const key of keysOf('seed-demo-org')) {
        expect(isValidClipKey(key)).toBe(true);
        expect(isValidKey(key)).toBe(false);
      }
      for (const key of publicKeys) {
        expect(isValidKey(key)).toBe(true);
        expect(isValidClipKey(key)).toBe(false);
      }
    });

    it("keeps a workspace's own stickers out of the shared library's keys", () => {
      const own = clipKeys.libraryUpload('seed-demo-org', 'png');
      expect(isValidLibraryKey(own)).toBe(false);
      expect(isValidLibraryKey(`library/${own}`)).toBe(false);
    });
  });
});
