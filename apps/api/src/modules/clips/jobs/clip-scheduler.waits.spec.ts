/**
 * No deadlock between the scheduler's classes (Sprint 13, Module 15). A job
 * that waits on another job holds its slot while it waits, so a wait on a
 * job of the SAME class could fill the class with waiters and nothing to
 * wait for. This pins the class of every kind and every known wait, and
 * scans the worker for code that waits on another job's row, so a new wait
 * fails here until it is listed in `KNOWN_JOB_WAITS` (and fails again if it
 * is same-class or circular).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ClipJobKind as PrismaJobKind } from '@postgear/db';
import { CLIP_JOB_KINDS } from '@postgear/video-engine';
import {
  CLASS_KINDS,
  JOB_CLASSES,
  KNOWN_JOB_WAITS,
  SCHEDULER_CLASSES,
  type SchedulerClass,
} from './clip-scheduler.rules';

const WORKER_SRC = resolve(__dirname, '../../../../../worker/src');

describe('the class of every kind', () => {
  it('is pinned', () => {
    expect(JOB_CLASSES).toEqual({
      IMPORT: 'media',
      SEGMENT: 'media',
      HIGHLIGHTS: 'media',
      RENDER: 'render',
      DOWNLOAD: 'media',
      TRANSCRIBE: 'media-py',
      FACES: 'media-py',
      TRANSLATE: 'media',
      SPEECH: 'media-py',
      AUTO_EDIT: 'media',
      EMOTE: 'media',
    });
  });

  it('covers every kind the engine and the database know', () => {
    for (const kind of CLIP_JOB_KINDS) expect(JOB_CLASSES[kind]).toBeDefined();
    for (const kind of Object.values(PrismaJobKind)) {
      expect(JOB_CLASSES[kind as keyof typeof JOB_CLASSES]).toBeDefined();
    }
  });

  it('lists each kind under exactly its own class', () => {
    const listed = SCHEDULER_CLASSES.flatMap((cls) => CLASS_KINDS[cls]);
    expect([...listed].sort()).toEqual([...CLIP_JOB_KINDS].sort());
    for (const cls of SCHEDULER_CLASSES) {
      for (const kind of CLASS_KINDS[cls]) expect(JOB_CLASSES[kind]).toBe(cls);
    }
  });
});

describe('the known waits', () => {
  it('are the three the worker has', () => {
    expect(KNOWN_JOB_WAITS.map((wait) => `${wait.waiter}>${wait.waitsOn}`)).toEqual([
      'HIGHLIGHTS>TRANSCRIBE',
      'AUTO_EDIT>TRANSCRIBE',
      'RENDER>SEGMENT',
    ]);
  });

  it('never wait on a job of their own class', () => {
    for (const wait of KNOWN_JOB_WAITS) {
      expect(JOB_CLASSES[wait.waitsOn]).not.toBe(JOB_CLASSES[wait.waiter]);
    }
  });

  it('go one way between classes (render to media to media-py), so no circle can form', () => {
    const edges = new Map<SchedulerClass, Set<SchedulerClass>>();
    for (const wait of KNOWN_JOB_WAITS) {
      const from = JOB_CLASSES[wait.waiter];
      const to = JOB_CLASSES[wait.waitsOn];
      edges.set(from, (edges.get(from) ?? new Set()).add(to));
    }
    expect(Object.fromEntries([...edges].map(([from, to]) => [from, [...to].sort()]))).toEqual({
      media: ['media-py'],
      render: ['media'],
    });

    const reaches = (
      from: SchedulerClass,
      seen = new Set<SchedulerClass>(),
    ): Set<SchedulerClass> => {
      for (const next of edges.get(from) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          reaches(next, seen);
        }
      }
      return seen;
    };
    for (const cls of SCHEDULER_CLASSES) expect(reaches(cls).has(cls)).toBe(false);
  });
});

/** Every non-test TypeScript file of the worker. */
function workerFiles(dir: string = WORKER_SRC): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'testing' && name !== 'node_modules') files.push(...workerFiles(path));
    } else if (name.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(name)) {
      files.push(path);
    }
  }
  return files;
}

describe('the worker waits only where the list says', () => {
  it('reads another job of the workspace (a wait) only in the listed places', () => {
    const found: string[] = [];
    for (const file of workerFiles()) {
      const source = readFileSync(file, 'utf8');
      const where = relative(WORKER_SRC, file);
      // Another job's row by id: `rows.job(org, listenJobId)`; one's own is `x.jobId`.
      for (const match of source.matchAll(/rows\.job\(\s*[\w.]+,\s*([\w.]+)\s*\)/g)) {
        if (!/(^|\.)jobId$/.test(match[1] as string)) found.push(`${where}: job ${match[1]}`);
      }
      // Another kind's open jobs: `rows.openClipJobs(org, clipId, 'SEGMENT')`.
      for (const match of source.matchAll(/rows\.openClipJobs\([^)]*'([A-Z_]+)'\s*\)/g)) {
        found.push(`${where}: open ${match[1]}`);
      }
    }
    expect(found.sort()).toEqual([
      'clips/activities/jobs.activities.ts: open SEGMENT',
      'clips/auto-edit/auto-edit.run.ts: job listenJobId',
      'clips/highlights/highlights.run.ts: job listenJobId',
    ]);
  });
});
