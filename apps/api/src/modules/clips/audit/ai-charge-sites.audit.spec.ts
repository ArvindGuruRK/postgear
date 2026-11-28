/**
 * Every AI minutes charge in the API, read from the source (Sprint 13,
 * Module 15 section 4). A new `usage.consume(` on `clips.ai_minutes_per_month`
 * fails this file until it is listed here with its key, and given its block
 * in `ai-routes.audit.spec.ts`; a free step that starts charging fails it too.
 *
 * Keys (the documented `clips.ai:<step>:<id>`):
 * - listen, signals, read, action: `<jobId>` of the job charged.
 * - translate: `<attemptId>`, one per press, as Translate runs in the request
 *   (no job); a double press is one attempt, a stored translation is free.
 * - voice: `<clipId>:<revision>:<hash>`, plus `:<attempt>` after a failure,
 *   plus `:<jobId>` when the key belonged to a job that is gone: the line and
 *   voice decide a repeat, not the job.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  actionChargeKey,
  AI_MINUTES_METER as HIGHLIGHTS_METER,
  readChargeKey,
  signalsChargeKey,
} from '../highlights/clip-highlights.service';
import { AI_MINUTES_METER, listenChargeKey } from '../transcripts/clip-transcripts.service';
import { voiceChargeKey, voiceInputHash } from '../voice/clip-voice.service';

/** The two keys built inline, as their source spells them (read as text, never run). */
// biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of a template literal
const TRANSLATE_KEY_SOURCE = '`clips.ai:translate:${attemptId}`';
// biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of a template literal
const VOICE_RETRY_KEY_SOURCE = '`${baseKey}:${jobId}`';

const API_SRC = path.join(__dirname, '../../..');
const CLIPS = path.join(API_SRC, 'modules/clips');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'testing' && name !== 'audit') out.push(...sourceFiles(full));
    } else if (name.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const read = (file: string) => readFileSync(file, 'utf8');
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\`]/g, '\\$&');
const rel = (file: string) => path.relative(API_SRC, file).split(path.sep).join('/');

interface Site {
  file: string;
  meter: string;
  key: string;
}

/** Every `usage.consume(org, meter, units, { idempotencyKey: ... })` in the API. */
function consumeSites(): Site[] {
  const sites: Site[] = [];
  for (const file of sourceFiles(API_SRC)) {
    const text = read(file);
    for (const match of text.matchAll(/usage\.consume\(\s*([^,]+),\s*([^,]+),/g)) {
      const after = text.slice(match.index ?? 0, (match.index ?? 0) + 400);
      const key = /idempotencyKey:\s*([^,\n]+),/.exec(after)?.[1]?.trim() ?? '(no key)';
      sites.push({ file: rel(file), meter: (match[2] ?? '').trim(), key });
    }
  }
  return sites.sort((a, b) => `${a.file} ${a.key}`.localeCompare(`${b.file} ${b.key}`));
}

describe('where AI minutes are charged', () => {
  it('lists every AI minutes charge in the API, with its key', () => {
    const ai = consumeSites().filter((site) => site.meter === 'AI_MINUTES_METER');
    expect(ai.map(({ file, key }) => ({ file, key }))).toEqual([
      {
        file: 'modules/clips/captions/clip-captions.service.ts',
        key: TRANSLATE_KEY_SOURCE,
      },
      {
        file: 'modules/clips/highlights/clip-highlights.service.ts',
        key: 'actionChargeKey(jobId)',
      },
      { file: 'modules/clips/highlights/clip-highlights.service.ts', key: 'readChargeKey(jobId)' },
      {
        file: 'modules/clips/highlights/clip-highlights.service.ts',
        key: 'signalsChargeKey(jobId)',
      },
      {
        file: 'modules/clips/highlights/clip-highlights.service.ts',
        key: 'signalsChargeKey(jobId)',
      },
      {
        file: 'modules/clips/transcripts/clip-transcripts.service.ts',
        key: 'listenChargeKey(jobId)',
      },
      { file: 'modules/clips/voice/clip-voice.service.ts', key: VOICE_RETRY_KEY_SOURCE },
      { file: 'modules/clips/voice/clip-voice.service.ts', key: 'baseKey' },
    ]);
  });

  it('charges no other meter from an AI route, and nothing else under an unnamed meter', () => {
    const others = consumeSites().filter((site) => site.meter !== 'AI_MINUTES_METER');
    expect(others.map(({ file, meter }) => `${file} ${meter}`)).toEqual([
      'modules/clips/limits/clip-limits.guard.ts DOWNLOADS_METER',
      'modules/clips/limits/clip-limits.guard.ts IMPORT_METER',
      // Module 17 item 25: a schedule picture is one of the day's downloads, not AI minutes.
      'modules/studio/studio.service.ts SCHEDULE_PICTURE_METER',
    ]);
  });

  it('names the one meter, wherever it is spelled', () => {
    expect(AI_MINUTES_METER).toBe('clips.ai_minutes_per_month');
    expect(HIGHLIGHTS_METER).toBe(AI_MINUTES_METER);
    expect(read(path.join(CLIPS, 'clips-ai-charges.ts'))).toContain(
      "const AI_MINUTES_METER = 'clips.ai_minutes_per_month';",
    );
    // The two that charge it by another route import the listening one.
    for (const file of ['captions/clip-captions.service.ts', 'voice/clip-voice.service.ts']) {
      expect(read(path.join(CLIPS, file))).toMatch(
        /import \{[^}]*AI_MINUTES_METER[^}]*\} from '\.\.\/transcripts\/clip-transcripts\.service'/,
      );
    }
  });

  it('pins each key shape', () => {
    const job = '88888888-8888-4888-8888-000000000001';
    expect(listenChargeKey(job)).toBe(`clips.ai:listen:${job}`);
    expect(signalsChargeKey(job)).toBe(`clips.ai:signals:${job}`);
    expect(readChargeKey(job)).toBe(`clips.ai:read:${job}`);
    expect(actionChargeKey(job)).toBe(`clips.ai:action:${job}`);

    const hash = voiceInputHash('sim-river', 'Wait for it.');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(voiceInputHash('sim-river', 'Wait for it!')).not.toBe(hash);
    expect(voiceInputHash('sim-stone', 'Wait for it.')).not.toBe(hash);
    expect(voiceChargeKey('clip-1', 4, hash)).toBe(`clips.ai:voice:clip-1:4:${hash}`);
    expect(voiceChargeKey('clip-1', 4, hash, 2)).toBe(`clips.ai:voice:clip-1:4:${hash}:2`);

    // Translate builds its key inline from a fresh uuid per press.
    const captions = read(path.join(CLIPS, 'captions/clip-captions.service.ts'));
    expect(captions).toMatch(/const attemptId = randomUUID\(\);/);
    expect(captions).toContain('refId: attemptId,');
  });

  it('charges each key under the job (or attempt) it names, so a failure gives back by refId', () => {
    for (const site of [
      ['transcripts/clip-transcripts.service.ts', 'listenChargeKey(jobId)', 'jobId'],
      ['highlights/clip-highlights.service.ts', 'signalsChargeKey(jobId)', 'jobId'],
      ['highlights/clip-highlights.service.ts', 'readChargeKey(jobId)', 'jobId'],
      ['highlights/clip-highlights.service.ts', 'actionChargeKey(jobId)', 'jobId'],
      ['voice/clip-voice.service.ts', 'baseKey', 'jobId'],
      ['captions/clip-captions.service.ts', TRANSLATE_KEY_SOURCE, 'attemptId'],
    ] as const) {
      const [file, key, refId] = site;
      const pair = new RegExp(`idempotencyKey: ${escaped(key)},\\s*refId: ${refId},`);
      expect(read(path.join(CLIPS, file))).toMatch(pair);
    }
  });
});

describe('the free steps never charge AI minutes', () => {
  /** Follow The Speaker and Detect Camera, hook titles, emotes, schedule pictures, recipes. */
  const FREE = [
    'modules/clips/faces/clip-faces.service.ts',
    'modules/clips/faces/clip-follow.service.ts',
    'modules/clips/hook-titles/clip-hook-titles.service.ts',
    'modules/clips/emotes/clip-emotes.service.ts',
    'modules/clips/recipes/clip-recipe-applier.service.ts',
    'modules/studio/schedules/schedules.service.ts',
  ];

  it.each(FREE)('%s has no charge and no AI minutes meter', (file) => {
    const text = read(path.join(API_SRC, file));
    expect(text).not.toMatch(/\.consume\(/);
    expect(text).not.toContain('AI_MINUTES_METER');
    expect(text).not.toContain('ai_minutes');
    expect(text).not.toContain('clips.ai:');
  });

  it('Upload SRT (`fromFile`) charges nothing, though Translate in the same file does', () => {
    const text = read(path.join(CLIPS, 'captions/clip-captions.service.ts'));
    const start = text.indexOf('async fromFile(');
    expect(start).toBeGreaterThan(-1);
    const next = text.indexOf('\n  async ', start + 1);
    const body = text.slice(start, next === -1 ? undefined : next);
    expect(body).not.toMatch(/\.consume\(|AI_MINUTES_METER|listenChargeKey|transcripts\.ensure/);
  });

  it('the worker never writes the ledger: it asks the API to charge and give back', () => {
    const worker = path.join(API_SRC, '../../worker/src');
    const files = sourceFiles(worker);
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.filter((file) =>
      /usageEntry|UsageService|\.consume\(/.test(read(file)),
    );
    expect(offenders.map((file) => path.relative(worker, file))).toEqual([]);
  });
});
