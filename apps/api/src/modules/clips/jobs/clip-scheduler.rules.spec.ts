/**
 * The one scheduler's rules (Sprint 13, Module 15), pure: the class slots,
 * the per-workspace counts (the import cap from the plan, 2 other media
 * jobs, 1 export, 1 Python job), priority from the job, aging, turns, and
 * the Preview Export left outside.
 */
import {
  agedRank,
  type HeldJob,
  nextJobs,
  QUEUE_AGING_MS,
  type SchedulerClass,
  type SchedulerJob,
  type SchedulerLimits,
  schedulerClassOf,
  servedKey,
  startOrder,
} from './clip-scheduler.rules';

const T0 = new Date('2026-11-28T10:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const NOW = at(60);

let count = 0;
function job(
  orgId: string,
  kind: SchedulerJob['kind'],
  overrides: Partial<SchedulerJob> & { proof?: boolean } = {},
): SchedulerJob {
  count += 1;
  const { proof, ...rest } = overrides;
  return {
    id: `job-${String(count).padStart(3, '0')}`,
    organizationId: orgId,
    kind,
    priority: 'normal',
    createdAt: at(count),
    input: kind === 'RENDER' ? { proof: proof ?? false } : {},
    ...rest,
  };
}

function held(orgId: string, kind: HeldJob['kind'], proof = false): HeldJob {
  return { organizationId: orgId, kind, input: kind === 'RENDER' ? { proof } : {} };
}

function limits(overrides: Partial<SchedulerLimits> = {}): SchedulerLimits {
  return {
    slots: { media: 10, 'media-py': 10, render: 10 },
    importsPerWorkspace: new Map(),
    lastServed: new Map(),
    ...overrides,
  };
}

function slots(values: Partial<Record<SchedulerClass, number>>) {
  return { media: 0, 'media-py': 0, render: 0, ...values };
}

const ids = (jobs: readonly SchedulerJob[]) => jobs.map((entry) => entry.id);

beforeEach(() => {
  count = 0;
});

describe('the classes', () => {
  it('puts the Python work in media-py, exports in render, everything else in media', () => {
    expect(schedulerClassOf({ kind: 'TRANSCRIBE' })).toBe('media-py');
    expect(schedulerClassOf({ kind: 'FACES' })).toBe('media-py');
    expect(schedulerClassOf({ kind: 'SPEECH' })).toBe('media-py');
    expect(schedulerClassOf({ kind: 'RENDER', input: { proof: false } })).toBe('render');
    expect(schedulerClassOf({ kind: 'IMPORT' })).toBe('media');
    expect(schedulerClassOf({ kind: 'EMOTE' })).toBe('media');
  });

  it('leaves a Preview Export outside the scheduler', () => {
    expect(schedulerClassOf({ kind: 'RENDER', input: { proof: true } })).toBeNull();
  });
});

describe('nextJobs: global slots', () => {
  it('never starts more than a class has free, counting the jobs that hold one', () => {
    const queued = ['org-a', 'org-b', 'org-c', 'org-d'].map((org) => job(org, 'SEGMENT'));
    const picked = nextJobs(
      queued,
      [held('org-x', 'HIGHLIGHTS')],
      limits({ slots: slots({ media: 3 }) }),
      NOW,
    );
    expect(ids(picked)).toEqual(['job-001', 'job-002']);
  });

  it('keeps the classes apart: a full media class never holds back an export or a listen', () => {
    const queued = [job('org-a', 'SEGMENT'), job('org-a', 'RENDER'), job('org-a', 'TRANSCRIBE')];
    const picked = nextJobs(
      queued,
      [held('org-x', 'IMPORT'), held('org-y', 'IMPORT')],
      limits({ slots: { media: 2, 'media-py': 1, render: 1 } }),
      NOW,
    );
    expect(picked.map((entry) => entry.kind)).toEqual(['TRANSCRIBE', 'RENDER']);
  });

  it('reads a missing or broken slot count as none', () => {
    const picked = nextJobs(
      [job('org-a', 'SEGMENT')],
      [],
      limits({ slots: { media: Number.NaN, 'media-py': 1, render: 1 } }),
      NOW,
    );
    expect(picked).toEqual([]);
  });
});

describe('nextJobs: per workspace', () => {
  it('takes the import cap from the limits (the plan value), counting imports already running', () => {
    const queued = [job('org-free', 'IMPORT'), job('org-free', 'IMPORT'), job('org-pro', 'IMPORT')];
    queued.push(job('org-pro', 'IMPORT'), job('org-pro', 'IMPORT'));
    const caps = new Map([
      ['org-free', 1],
      ['org-pro', 2],
    ]);
    const first = nextJobs(queued, [], limits({ importsPerWorkspace: caps }), NOW);
    expect(first.map((entry) => entry.organizationId).sort()).toEqual([
      'org-free',
      'org-pro',
      'org-pro',
    ]);

    const busy = nextJobs(
      queued,
      [held('org-free', 'IMPORT'), held('org-pro', 'IMPORT')],
      limits({ importsPerWorkspace: caps }),
      NOW,
    );
    expect(busy.map((entry) => entry.organizationId)).toEqual(['org-pro']);
  });

  it('starts no import for a workspace whose cap was not read (never more than the plan)', () => {
    expect(nextJobs([job('org-a', 'IMPORT')], [], limits(), NOW)).toEqual([]);
  });

  it('applies an operator edit of the cap at the next pass', () => {
    const queued = [job('org-a', 'IMPORT'), job('org-a', 'IMPORT'), job('org-a', 'IMPORT')];
    const one = new Map([['org-a', 1]]);
    const three = new Map([['org-a', 3]]);
    expect(nextJobs(queued, [], limits({ importsPerWorkspace: one }), NOW)).toHaveLength(1);
    expect(nextJobs(queued, [], limits({ importsPerWorkspace: three }), NOW)).toHaveLength(3);
  });

  it('runs at most 2 other media jobs, apart from its imports', () => {
    const queued = [
      job('org-a', 'SEGMENT'),
      job('org-a', 'HIGHLIGHTS'),
      job('org-a', 'DOWNLOAD'),
      job('org-a', 'IMPORT'),
    ];
    const picked = nextJobs(
      queued,
      [],
      limits({ importsPerWorkspace: new Map([['org-a', 1]]) }),
      NOW,
    );
    expect(picked.map((entry) => entry.kind).sort()).toEqual(['HIGHLIGHTS', 'IMPORT', 'SEGMENT']);
  });

  it('runs at most 1 export and 1 Python job', () => {
    const queued = [
      job('org-a', 'RENDER'),
      job('org-a', 'RENDER'),
      job('org-a', 'TRANSCRIBE'),
      job('org-a', 'FACES'),
    ];
    expect(ids(nextJobs(queued, [], limits(), NOW))).toEqual(['job-003', 'job-001']);
    expect(
      nextJobs(queued, [held('org-a', 'SPEECH'), held('org-a', 'RENDER')], limits(), NOW),
    ).toEqual([]);
  });
});

describe('nextJobs: order', () => {
  it('reads the priority from the job, high first', () => {
    const queued = [
      job('org-a', 'RENDER', { priority: 'low' }),
      job('org-b', 'RENDER', { priority: 'normal' }),
      job('org-c', 'RENDER', { priority: 'high' }),
    ];
    const picked = nextJobs(queued, [], limits({ slots: slots({ render: 3 }) }), NOW);
    expect(picked.map((entry) => entry.organizationId)).toEqual(['org-c', 'org-b', 'org-a']);
  });

  it('ages a waiting job one step every 10 minutes, up to the top', () => {
    const low = job('org-a', 'SEGMENT', { priority: 'low', createdAt: T0 });
    expect(agedRank(low, new Date(T0.getTime() + QUEUE_AGING_MS - 1))).toBe(0);
    expect(agedRank(low, new Date(T0.getTime() + QUEUE_AGING_MS))).toBe(1);
    expect(agedRank(low, new Date(T0.getTime() + 3 * QUEUE_AGING_MS))).toBe(2);
    expect(agedRank(low, new Date(T0.getTime() + 30 * QUEUE_AGING_MS))).toBe(2);
  });

  it('never starves a low job: after 30 minutes it goes before a high job served lately', () => {
    const low = job('org-free', 'TRANSCRIBE', { priority: 'low', createdAt: T0 });
    const early = job('org-paid', 'TRANSCRIBE', { priority: 'high', createdAt: at(290) });
    const late = job('org-paid', 'TRANSCRIBE', { priority: 'high', createdAt: at(1_790) });
    const served = new Map([[servedKey('media-py', 'org-paid'), at(1_700).getTime()]]);
    const one = limits({ slots: slots({ 'media-py': 1 }), lastServed: served });
    // Five minutes in, the paid job goes first.
    expect(nextJobs([low, early], [], one, at(300))[0]?.organizationId).toBe('org-paid');
    // Thirty minutes in, the low job ranks with the highest and was never served lately: it goes.
    expect(nextJobs([low, late], [], one, at(1_800))[0]?.organizationId).toBe('org-free');
  });

  it('gives equal priorities turns: never served first, then the one served longest ago', () => {
    const queued = [job('org-a', 'EMOTE'), job('org-b', 'EMOTE'), job('org-c', 'EMOTE')];
    const served = new Map([
      [servedKey('media', 'org-a'), at(50).getTime()],
      [servedKey('media', 'org-b'), at(10).getTime()],
    ]);
    const picked = nextJobs(queued, [], limits({ lastServed: served }), NOW);
    expect(picked.map((entry) => entry.organizationId)).toEqual(['org-c', 'org-b', 'org-a']);
  });

  it('counts each pick as a turn, so one pass alternates between workspaces', () => {
    const queued = [
      job('org-a', 'SEGMENT'),
      job('org-a', 'SEGMENT'),
      job('org-b', 'SEGMENT'),
      job('org-b', 'SEGMENT'),
    ];
    const picked = nextJobs(queued, [], limits({ slots: slots({ media: 4 }) }), NOW);
    expect(picked.map((entry) => entry.organizationId)).toEqual([
      'org-a',
      'org-b',
      'org-a',
      'org-b',
    ]);
  });

  it('serves turns per class: a workspace served in media still has its turn in render', () => {
    const queued = [job('org-a', 'RENDER'), job('org-b', 'RENDER')];
    const served = new Map([[servedKey('media', 'org-a'), at(59).getTime()]]);
    const picked = nextJobs(
      queued,
      [],
      limits({ slots: slots({ render: 1 }), lastServed: served }),
      NOW,
    );
    expect(picked[0]?.organizationId).toBe('org-a');
  });
});

describe('nextJobs: Preview Export', () => {
  it('never picks one and never counts one as holding a slot', () => {
    const queued = [job('org-a', 'RENDER', { proof: true }), job('org-a', 'RENDER')];
    const picked = nextJobs(
      queued,
      [held('org-a', 'RENDER', true)],
      limits({ slots: slots({ render: 1 }) }),
      NOW,
    );
    expect(ids(picked)).toEqual(['job-002']);
  });
});

describe('startOrder', () => {
  it('orders one class as slots would free one at a time, every pick a turn', () => {
    const queued = [
      job('org-a', 'RENDER'),
      job('org-a', 'RENDER'),
      job('org-a', 'RENDER'),
      job('org-b', 'RENDER'),
      job('org-c', 'SEGMENT'),
    ];
    expect(ids(startOrder(queued, 'render', new Map(), NOW))).toEqual([
      'job-001',
      'job-004',
      'job-002',
      'job-003',
    ]);
    expect(ids(startOrder(queued, 'render', new Map(), NOW, 'job-002'))).toEqual([
      'job-001',
      'job-004',
      'job-002',
    ]);
  });
});
