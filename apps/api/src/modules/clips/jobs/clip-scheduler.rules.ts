/**
 * The rules of the one Clips scheduler (Sprint 13, Module 15), pure so each
 * rule is tested without a database. `ClipSchedulerService` reads the rows
 * and hands them here; nothing in this file reads a plan, a clock or a row.
 *
 * Every Clips job but a Preview Export waits QUEUED until a pass hands it a
 * slot. A job belongs to one **class**, which has its own global slots:
 *
 * - `render`: an export (a RENDER that is not a Preview Export).
 * - `media-py`: TRANSCRIBE, FACES and SPEECH, whose work is the Python
 *   service (`postgear-media-py`).
 * - `media`: every other kind (imports, sharp ranges, Find Clips, downloads,
 *   Auto-Edit, emotes).
 *
 * A **Preview Export** (`input.proof === true`) stays outside (Module 11's
 * decision): the editor waits on it, so it starts at once and holds no slot.
 *
 * The rules, in order:
 *
 * 1. Never more than the class's global slots (`limits.slots`).
 * 2. Per workspace: at most `clips.concurrent_imports` IMPORTs (read through
 *    the resolver by the caller, so an operator edit applies at the next
 *    pass), 2 other media jobs, 1 export and 1 Python job.
 * 3. Highest aged priority first: the job's own `priority` (copied from
 *    `clips.queue_priority` when it was made, never the plan now), one step
 *    higher for every `QUEUE_AGING_MS` it has waited, up to the top.
 * 4. Then the workspace served longest ago in that class (never served
 *    first). Each pick counts as a turn, so one pass already alternates.
 * 5. Then the oldest job, then the id.
 */
import { type ClipJobKind, JOB_PRIORITIES, priorityRank } from '@postgear/video-engine';

export const SCHEDULER_CLASSES = ['media', 'media-py', 'render'] as const;
export type SchedulerClass = (typeof SCHEDULER_CLASSES)[number];

/**
 * The class of each kind. A RENDER is `render` unless it is a Preview Export
 * (`schedulerClassOf` answers null for those). HIGHLIGHTS stays `media`: its
 * own work is FFmpeg and the scoring, and the short Python calls it makes on
 * the way (Look For Action, stills) are activities of the run, not jobs.
 */
export const JOB_CLASSES: Readonly<Record<ClipJobKind, SchedulerClass>> = Object.freeze({
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

/** The kinds of each class, for the queries that read one class. */
export const CLASS_KINDS: Readonly<Record<SchedulerClass, readonly ClipJobKind[]>> = Object.freeze({
  media: kindsOf('media'),
  'media-py': kindsOf('media-py'),
  render: kindsOf('render'),
});

function kindsOf(cls: SchedulerClass): readonly ClipJobKind[] {
  return Object.freeze(
    (Object.keys(JOB_CLASSES) as ClipJobKind[]).filter((kind) => JOB_CLASSES[kind] === cls),
  );
}

/**
 * Every place one job waits on another job's end, and the class of each
 * side. **No job waits on a job of its own class**: the waits go render to
 * media and media to media-py, and a media-py job waits on nothing, so a
 * class full of waiting jobs can always be emptied by the class below it.
 * `clip-scheduler.waits.spec.ts` pins this list against the worker's code:
 * a new wait fails that test until it is added here, and a same-class or
 * circular wait fails it then.
 */
export const KNOWN_JOB_WAITS: ReadonlyArray<{
  waiter: ClipJobKind;
  waitsOn: ClipJobKind;
  why: string;
}> = Object.freeze([
  {
    waiter: 'HIGHLIGHTS',
    waitsOn: 'TRANSCRIBE',
    why: 'A Find Clips run with a setup waits for its listening (Module 02).',
  },
  {
    waiter: 'AUTO_EDIT',
    waitsOn: 'TRANSCRIBE',
    why: 'Auto-Edit Video waits for the video to be listened to (Module 10).',
  },
  {
    waiter: 'RENDER',
    waitsOn: 'SEGMENT',
    why: 'An export waits up to 15 minutes for its sharp range (Sprint 12, Module 05).',
  },
]);

/**
 * The kinds whose own job is charged AI minutes at the press (listening,
 * Find Clips, a made voice; Module 15 section 4). A pass never starts one
 * whose charge is not standing: some routes write the row a moment before
 * their charge lands, and a refused charge can leave a row behind. Such a
 * job keeps waiting, and the reconcile fails it once it is old with still
 * no charge. AUTO_EDIT pays through its own listening job; FACES is free.
 */
export const PAID_AI_KINDS: ReadonlySet<ClipJobKind> = new Set<ClipJobKind>([
  'TRANSCRIBE',
  'HIGHLIGHTS',
  'SPEECH',
]);

/** Exports, media and Python jobs running (or handed to Temporal) at once, unless configured. */
export const DEFAULT_SLOTS: Readonly<Record<SchedulerClass, number>> = Object.freeze({
  media: 4,
  'media-py': 2,
  render: 2,
});

/**
 * Per workspace, for every kind but IMPORT (whose number is the plan's
 * `clips.concurrent_imports`, passed in `limits`). Queue constants, not plan
 * values: the queue's shape, the same on every plan.
 */
export const PER_WORKSPACE_SLOTS: Readonly<Record<SchedulerClass, number>> = Object.freeze({
  media: 2,
  'media-py': 1,
  render: 1,
});

/**
 * A job waiting this long counts as one priority step higher, up to the top
 * (Module 11's `RENDER_AGING_MS`, now for every class). A `low` job is
 * `normal` after 10 minutes and ranks with `high` after 20, then wins on
 * turns when its workspace was served longest ago: stronger than the
 * module doc's "a low job waiting 30 minutes is treated as normal", so a
 * busy paid queue never starves a Free workspace.
 */
export const QUEUE_AGING_MS = 10 * 60_000;

const TOP_PRIORITY_RANK = priorityRank(JOB_PRIORITIES[JOB_PRIORITIES.length - 1] as string);

/** A job of any kind the scheduler might start. `input` matters only for a RENDER. */
export interface SchedulerJob {
  id: string;
  organizationId: string;
  kind: ClipJobKind;
  priority: string;
  createdAt: Date;
  input?: unknown;
}

/** A job holding a slot: RUNNING, or QUEUED and already claimed by a pass. */
export interface HeldJob {
  organizationId: string;
  kind: ClipJobKind;
  input?: unknown;
}

export interface SchedulerLimits {
  /** Global slots per class (`CLIPS_MEDIA_SLOTS`, `CLIPS_MEDIA_PY_SLOTS`, `CLIPS_RENDER_SLOTS`). */
  slots: Readonly<Record<SchedulerClass, number>>;
  /**
   * `clips.concurrent_imports` per workspace with a waiting IMPORT. A
   * workspace missing here starts no import (never more than the plan).
   */
  importsPerWorkspace: ReadonlyMap<string, number>;
  /** When each workspace was last served in each class (`servedKey`), in ms; missing is never. */
  lastServed: ReadonlyMap<string, number>;
}

/** A Preview Export: a RENDER whose input says `proof: true`. */
export function isPreviewExport(job: { kind: string; input?: unknown }): boolean {
  if (job.kind !== 'RENDER') return false;
  const input = job.input;
  return Boolean(
    input && typeof input === 'object' && (input as { proof?: unknown }).proof === true,
  );
}

/** The job's class, or null for a Preview Export (it starts at once, outside the scheduler). */
export function schedulerClassOf(job: {
  kind: ClipJobKind;
  input?: unknown;
}): SchedulerClass | null {
  if (isPreviewExport(job)) return null;
  return JOB_CLASSES[job.kind] ?? 'media';
}

/** The per-workspace count a job takes: its class, with IMPORT counted apart from other media. */
type Bucket = SchedulerClass | 'import';

function bucketOf(job: { kind: ClipJobKind }, cls: SchedulerClass): Bucket {
  return job.kind === 'IMPORT' ? 'import' : cls;
}

function bucketKey(orgId: string, bucket: Bucket): string {
  return `${bucket}:${orgId}`;
}

/** The key of `limits.lastServed`. */
export function servedKey(cls: SchedulerClass, orgId: string): string {
  return `${cls}:${orgId}`;
}

/** The job's priority rank after aging. */
export function agedRank(job: { priority: string; createdAt: Date }, now: Date): number {
  const waited = Math.max(0, now.getTime() - job.createdAt.getTime());
  return Math.min(
    TOP_PRIORITY_RANK,
    priorityRank(job.priority) + Math.floor(waited / QUEUE_AGING_MS),
  );
}

/** Negative when `a` goes first: aged priority, then turns, then age, then id. */
function compareTurns(
  a: SchedulerJob,
  b: SchedulerJob,
  cls: SchedulerClass,
  served: ReadonlyMap<string, number>,
  now: Date,
): number {
  const rank = agedRank(b, now) - agedRank(a, now);
  if (rank !== 0) return rank;
  const x = served.get(servedKey(cls, a.organizationId)) ?? Number.NEGATIVE_INFINITY;
  const y = served.get(servedKey(cls, b.organizationId)) ?? Number.NEGATIVE_INFINITY;
  if (x !== y) return x < y ? -1 : 1;
  return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}

function capOf(
  job: SchedulerJob,
  cls: SchedulerClass,
  limits: Pick<SchedulerLimits, 'importsPerWorkspace'>,
): number {
  if (job.kind !== 'IMPORT') return PER_WORKSPACE_SLOTS[cls];
  const cap = Number(limits.importsPerWorkspace.get(job.organizationId) ?? 0);
  return Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : 0;
}

/**
 * The jobs a pass starts now, in the order it hands them out. `queued` are
 * the jobs waiting (QUEUED, not claimed), `running` the ones holding a slot.
 * Preview Exports in either list are ignored.
 */
export function nextJobs<T extends SchedulerJob>(
  queued: readonly T[],
  running: readonly HeldJob[],
  limits: SchedulerLimits,
  now: Date,
): T[] {
  const held = new Map<string, number>();
  const bump = (key: string) => held.set(key, (held.get(key) ?? 0) + 1);
  for (const job of running) {
    const cls = schedulerClassOf(job);
    if (!cls) continue;
    bump(cls);
    bump(bucketKey(job.organizationId, bucketOf(job, cls)));
  }

  const served = new Map(limits.lastServed);
  const taken = new Set<string>();
  const picked: T[] = [];
  let turn = 0;

  for (const cls of SCHEDULER_CLASSES) {
    const slots = Number(limits.slots[cls]);
    let free = Math.max(0, (Number.isFinite(slots) ? Math.floor(slots) : 0) - (held.get(cls) ?? 0));
    const candidates = queued.filter((job) => schedulerClassOf(job) === cls);

    while (free > 0) {
      let best: T | null = null;
      for (const job of candidates) {
        if (taken.has(job.id)) continue;
        const key = bucketKey(job.organizationId, bucketOf(job, cls));
        if ((held.get(key) ?? 0) >= capOf(job, cls, limits)) continue;
        if (!best || compareTurns(job, best, cls, served, now) < 0) best = job;
      }
      if (!best) break;
      taken.add(best.id);
      picked.push(best);
      bump(bucketKey(best.organizationId, bucketOf(best, cls)));
      free -= 1;
      // The workspace just had its turn: later picks in this pass prefer the others.
      turn += 1;
      served.set(servedKey(cls, best.organizationId), now.getTime() + turn);
    }
  }
  return picked;
}

/**
 * The order the waiting jobs of one class would start in if slots freed one
 * at a time: the same comparison as `nextJobs`, every pick a turn, and the
 * per-workspace caps left out (a workspace's next job simply waits for its
 * next turn). The estimate counts the jobs before `stopAt` in it.
 */
export function startOrder<T extends SchedulerJob>(
  queued: readonly T[],
  cls: SchedulerClass,
  lastServed: ReadonlyMap<string, number>,
  now: Date,
  stopAt?: string,
): T[] {
  const served = new Map(lastServed);
  const left = queued.filter((job) => schedulerClassOf(job) === cls);
  const order: T[] = [];
  let turn = 0;
  while (left.length > 0) {
    let bestIndex = 0;
    for (let index = 1; index < left.length; index += 1) {
      if (compareTurns(left[index] as T, left[bestIndex] as T, cls, served, now) < 0) {
        bestIndex = index;
      }
    }
    const [best] = left.splice(bestIndex, 1) as [T];
    order.push(best);
    if (best.id === stopAt) break;
    turn += 1;
    served.set(servedKey(cls, best.organizationId), now.getTime() + turn);
  }
  return order;
}
