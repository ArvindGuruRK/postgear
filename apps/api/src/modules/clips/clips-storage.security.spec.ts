/**
 * Security sweep, Module 20: "Storage", the API and worker side. Every delete
 * by prefix is built by `clipKeys` from the row's own workspace, the Clips
 * routes only read public addresses, only the library ingest and the operator
 * build shared library keys, and production refuses the local private disk.
 *
 * The prefix shapes and the two bindings are proved in
 * packages/storage/src/storage.security.test.ts. Signed addresses are proved
 * in files/clip-files.controller.spec.ts:107 and :174, and that no answer
 * carries a key in clips-messages.security.spec.ts and
 * clip/clip-item.service.spec.ts:224.
 *
 * The call-site checks read the source: they hold for the code as written,
 * and fail the day someone adds a delete that does not follow the pattern.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createPrivateStorage, LOCAL_PRIVATE_REFUSED } from '@postgear/storage';
import { privateStorageConfigFrom } from '../media/media.module';

const REPO = join(__dirname, '..', '..', '..', '..', '..');
const API_SRC = join(REPO, 'apps', 'api', 'src');
const WORKER_SRC = join(REPO, 'apps', 'worker', 'src');

function sources(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist') walk(full);
      } else if (
        entry.name.endsWith('.ts') &&
        !/\.(spec|test)\.ts$/.test(entry.name) &&
        !full.split(sep).includes('testing')
      ) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

const rel = (file: string) => relative(REPO, file).split(sep).join('/');

/** Each `deletePrefix(` call with its argument text and the few lines before it. */
function deletePrefixCalls(files: string[]) {
  return files.flatMap((file) => {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    return lines.flatMap((line, index) => {
      const match = /\.deletePrefix\((.*)\);?\s*$/.exec(line);
      if (!match || /async deletePrefix\(/.test(line)) return [];
      return [
        {
          where: `${rel(file)}:${index + 1}`,
          argument: (match[1] ?? '').replace(/\)\s*$/, ''),
          before: lines.slice(Math.max(0, index - 6), index).join('\n'),
        },
      ];
    });
  });
}

const PREFIX_CALL = /^clipKeys\.(video|download|proof|export|library)Prefix\(([^,()]+),/;
/** Where a prefix's workspace may come from: the route's own org, or the row being cleaned. */
const ORG_SOURCES = new Set(['orgId', 'org', 'job.organizationId', 'row.organizationId']);

/** The calls whose prefix is not built by clipKeys from an allowed workspace id. */
function badCalls(calls: ReturnType<typeof deletePrefixCalls>): string[] {
  const bad: string[] = [];
  for (const call of calls) {
    let built = call.argument.trim();
    if (/^[a-zA-Z]+$/.test(built)) {
      // A named prefix (the sweep): it must be built by clipKeys just above.
      const assigned = new RegExp(`(?:const|let)\\s+${built}\\s*=([\\s\\S]*)$`).exec(call.before);
      built = (assigned?.[1] ?? '').replace(/\s+/g, ' ').trim();
      const branches = built.split(/[?:]/).map((part) => part.trim().replace(/;$/, ''));
      const keyed = branches.filter((part) => part.startsWith('clipKeys.'));
      const ok =
        keyed.length > 0 &&
        keyed.every((part) => ORG_SOURCES.has(PREFIX_CALL.exec(part)?.[2]?.trim() ?? ''));
      if (!ok) bad.push(call.where);
      continue;
    }
    const match = PREFIX_CALL.exec(built);
    if (!match || !ORG_SOURCES.has(match[2]?.trim() ?? '')) bad.push(`${call.where} ${built}`);
  }
  return bad;
}

describe('Clips security: Storage (call sites and wiring)', () => {
  const apiCalls = deletePrefixCalls(sources(API_SRC));
  const workerCalls = deletePrefixCalls(sources(WORKER_SRC));

  it('finds the deletes it checks', () => {
    expect(apiCalls.length).toBeGreaterThanOrEqual(7);
    expect(workerCalls.length).toBeGreaterThanOrEqual(3);
  });

  it('builds every prefix with clipKeys from a workspace id of the row or the route', () => {
    expect(badCalls([...apiCalls, ...workerCalls])).toEqual([]);
  });

  it('would catch a prefix typed by hand, or one built from a request value', () => {
    const call = (argument: string, before = '') => ({ where: argument, argument, before });
    // Source text as the scan reads it: a template literal typed by hand.
    const typed = (name: string) => `\`clips/$\{${name}}/\``;
    expect(
      badCalls([
        call(typed('orgId')),
        call('clipKeys.videoPrefix(body.organizationId, videoId)'),
        call('prefix', `const prefix = ${typed('org')};`),
        call('prefix', 'const prefix = clipKeys.videoPrefix(query.org, id);'),
      ]),
    ).toHaveLength(4);
  });

  it('never deletes a whole workspace from a Clips route', () => {
    const files = sources(API_SRC).filter((file) => !rel(file).includes('/modules/admin/'));
    const offenders = files.filter((file) =>
      /clipKeys\.orgPrefix\(/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it('lets only the library ingest and the operator build shared library keys', () => {
    const files = [...sources(API_SRC), ...sources(WORKER_SRC)];
    const builders = files
      .filter((file) => /\blibraryKeys\b|assertValidLibraryKey/.test(readFileSync(file, 'utf8')))
      .map(rel)
      .filter(
        (path) =>
          !path.startsWith('apps/api/src/modules/admin/') &&
          !path.startsWith('apps/worker/src/clips/library/'),
      );
    expect(builders).toEqual([]);
  });

  it('only reads public addresses from the Clips routes, never writes or deletes public files', () => {
    const clips = sources(join(API_SRC, 'modules', 'clips'));
    const bad: string[] = [];
    for (const file of clips) {
      const text = readFileSync(file, 'utf8');
      const field = /@Inject\(STORAGE_BACKEND\)\s+(?:private\s+)?(?:readonly\s+)?(\w+)/.exec(
        text,
      )?.[1];
      if (!field) continue;
      const calls = [...text.matchAll(new RegExp(`this\\.${field}\\.(\\w+)\\(`, 'g'))].map(
        (match) => match[1],
      );
      for (const method of calls) if (method !== 'publicUrl') bad.push(`${rel(file)} ${method}`);
    }
    expect(bad).toEqual([]);
  });

  it('refuses the local private disk when the API runs in production', () => {
    const values: Record<string, unknown> = {
      STORAGE_PROVIDER: 'local',
      NODE_ENV: 'production',
      UPLOAD_DIRECTORY: './uploads',
      API_URL: 'https://api.example.com',
      CLIPS_URL_SECRET: 'x'.repeat(48),
    };
    const config = { get: (key: string) => values[key] } as never;
    expect(() => createPrivateStorage(privateStorageConfigFrom(config))).toThrow(
      LOCAL_PRIVATE_REFUSED,
    );
  });
});
