/**
 * Security sweep, the Limits line (Sprint 12, Module 20 section 1): a
 * downgrade below current use deletes nothing.
 *
 * A plan change reaches Clips only as new values from the resolver (the
 * Stripe webhook and the billing service touch the entitlement stamps, no
 * more). What it changes is what new work may do: the limits guard refuses
 * new imports, uploads and wider ranges with `clips_storage_full`
 * (`limits-audit.spec.ts`, "The downgrade rule"), the sweep sends the
 * over-limit notice (`clip-sweep.security.spec.ts`) and a lowered retention
 * never brings a removal date closer than three days.
 *
 * These tests fail if a plan change ever gets a path to a delete: the billing
 * code naming a Clips table, file or the removal, the limits guard writing a
 * row, or the retention rule moving a date inside the notice window.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DAY_MS, NOTICE_BEFORE_MS, nextExpiry } from '../retention/clip-retention.rules';

const MODULES = join(__dirname, '..', '..');

function sources(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      files.push(...sources(full));
    } else if (name.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(name)) {
      files.push(full);
    }
  }
  return files;
}

/** The code with its comments taken out, so a sentence that names Clips is not a finding. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** What a path to a Clips delete would have to name. */
const CLIPS_DELETE_PATHS: Array<[string, RegExp]> = [
  [
    'a Clips table',
    /\b(clipVideo|clipAsset|clipJob|clip|clipDownload|clipLibrarySound|clipLibrarySticker)\s*\.\s*(delete|deleteMany|update|updateMany|upsert)\b/,
  ],
  ['the Clips removal', /\b(removeVideo|deleteFiles|ClipRetentionService|ClipSweepService)\b/],
  ['private storage', /\b(PRIVATE_STORAGE|deletePrefix)\b/],
  ['a Clips module import', /from\s+['"][^'"]*\/clips\/[^'"]*['"]/],
];

describe('a plan change has no path to a Clips delete', () => {
  it.each(['billing', 'entitlements'])(
    'the %s module names no Clips table, file or removal',
    (folder) => {
      const files = sources(join(MODULES, folder));
      expect(files.length).toBeGreaterThan(0);
      const found: string[] = [];
      for (const file of files) {
        const text = code(file);
        for (const [what, pattern] of CLIPS_DELETE_PATHS) {
          if (pattern.test(text)) found.push(`${relative(MODULES, file)}: ${what}`);
        }
      }
      expect(found).toEqual([]);
    },
  );

  it('the limits guard only reads: a refusal for a workspace over its plan writes nothing', () => {
    const text = code(join(__dirname, 'clip-limits.guard.ts'));
    expect(text).toMatch(/prisma\.clipAsset\.aggregate/);
    expect(text).not.toMatch(
      /\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
    );
    expect(text).not.toMatch(/\$executeRaw|\$queryRaw/);
  });

  it('the patterns do catch a delete (the scan is not blind)', () => {
    const planted = code(join(__dirname, 'clip-limits.guard.ts')).concat(
      '\nawait prisma.clipVideo.updateMany({ where: {}, data: { deletedAt: new Date() } });\n',
    );
    expect(CLIPS_DELETE_PATHS.some(([, pattern]) => pattern.test(planted))).toBe(true);
    expect(
      CLIPS_DELETE_PATHS.some(([, pattern]) =>
        pattern.test(
          "import { ClipRetentionService } from '../clips/retention/clip-retention.service';",
        ),
      ),
    ).toBe(true);
  });
});

describe('a lowered retention never removes a video without its three days', () => {
  it('never moves a date closer than three days from now, whatever the new plan says', () => {
    const now = new Date('2026-11-19T12:00:00.000Z');
    for (let currentDays = 0; currentDays <= 60; currentDays += 1) {
      for (let wantedDays = -30; wantedDays <= 60; wantedDays += 3) {
        const current = new Date(now.getTime() + currentDays * DAY_MS);
        const wanted = new Date(now.getTime() + wantedDays * DAY_MS);
        const next = nextExpiry(current, wanted, now);
        // Never sooner than three days out, unless the date was already sooner than that.
        expect(next.getTime()).toBeGreaterThanOrEqual(
          Math.min(current.getTime(), now.getTime() + NOTICE_BEFORE_MS),
        );
        // A longer plan always moves the date out.
        if (wanted.getTime() >= current.getTime()) expect(next).toEqual(wanted);
      }
    }
  });
});
