/**
 * Security sweep, Tenancy, over Sprint 13's AI routes and jobs (Module 16,
 * re-running Sprint 12's row).
 *
 * The same harness as `clips-tenancy.spec.ts`: the real services and
 * repositories behind each id route run as workspace B, against a database
 * stand-in that records every query and finds nothing. For every route:
 *
 * - the answer is 404 (never 403, which would say the row exists), or, for a
 *   worker-facing route, nothing done: no model asked, no row written;
 * - every query on a workspace's table carried workspace B's id;
 * - nothing was charged or given back.
 *
 * And every `/internal/clips` route sits behind `InternalTokenGuard`, which
 * refuses no token, a wrong one, and every call when none is configured.
 *
 * Existing tests this builds on (not repeated here): `clips-tenancy.spec.ts`
 * (Sprint 12's 22 id routes), `clips-routes.spec.ts` ("refuses an internal
 * call without the worker token", "reads a transcript for moments only with
 * the worker token", "marks a run to follow the speaker only with the worker
 * token") and `no-free-route.audit.spec.ts` (another workspace's charge does
 * not open a paid step).
 */
import { HttpException, type Type, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DEFAULT_AUTO_EDIT_RECIPE, defaultClipSetup } from '@postgear/video-engine';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { AI_ENGINE } from '../../ai/engine/engine.types';
import {
  INTERNAL_TOKEN_HEADER,
  InternalTokenGuard,
} from '../../automations/gateway/internal-token.guard';
import { UsageService } from '../../entitlements/usage.service';
import { RedisService } from '../../redis/redis.service';
import { ClipAutoEditRepository } from '../auto-edit/clip-auto-edit.repository';
import { ClipAutoEditService } from '../auto-edit/clip-auto-edit.service';
import { ClipCaptionStylesRepository } from '../captions/clip-caption-styles.repository';
import { ClipCaptionStylesService } from '../captions/clip-caption-styles.service';
import { ClipCaptionsService } from '../captions/clip-captions.service';
import { ClipItemService } from '../clip/clip-item.service';
import { ClipFacesService } from '../faces/clip-faces.service';
import { ClipFollowService } from '../faces/clip-follow.service';
import { ClipHighlightsService } from '../highlights/clip-highlights.service';
import { ClipMomentsService } from '../highlights/clip-moments.service';
import { ClipStillsService } from '../highlights/clip-stills.service';
import { ClipHookTitlesService } from '../hook-titles/clip-hook-titles.service';
import { ClipsInternalController } from '../internal/clips-internal.controller';
import { ClipsInternalService } from '../internal/clips-internal.service';
import { ClipJobsRepository } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import { ClipApplyRecipeService } from '../recipes/clip-apply-recipe.service';
import { ClipRecipeApplierService } from '../recipes/clip-recipe-applier.service';
import { ClipRecipesRepository } from '../recipes/clip-recipes.repository';
import { ClipRecipesService } from '../recipes/clip-recipes.service';
import { MediaServiceProbe } from '../status/media-service.probe';
import { MediaVoices } from '../status/media-voices.client';
import { ClipTranscriptStore } from '../transcripts/clip-transcript-store';
import { ClipTranscriptsService } from '../transcripts/clip-transcripts.service';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import { ClipVoiceRepository } from '../voice/clip-voice.repository';
import { ClipVoiceService } from '../voice/clip-voice.service';

interface RecordedQuery {
  model: string;
  op: string;
  args: unknown;
}

const mockQueries: RecordedQuery[] = [];

jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');
  /** What an empty database answers. */
  const empty = (op: string): unknown => {
    if (op === 'findMany' || op === 'groupBy') return [];
    if (op === 'count') return 0;
    if (op.endsWith('Many')) return { count: 0 };
    if (op === 'aggregate') return { _sum: {}, _count: {} };
    return null;
  };
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_target, op: string) => {
          if (op === 'fields') return new Proxy({}, { get: () => ({}) });
          return async (args: unknown) => {
            mockQueries.push({ model: name, op, args });
            return empty(op);
          };
        },
      },
    );
  const client: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_target, name: string) => {
        if (name === 'then') return undefined;
        if (name === '$transaction') {
          return async (work: unknown) =>
            typeof work === 'function' ? work(client) : Promise.all(work as unknown[]);
        }
        if (name === '$queryRaw' || name === '$executeRaw') {
          return async (sql: unknown) => {
            mockQueries.push({ model: name, op: 'raw', args: sql });
            return name === '$queryRaw' ? [] : 0;
          };
        }
        return model(name);
      },
    },
  );
  return { ...actual, prisma: client };
});

const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
/** Workspace A's row, as if workspace B's member pasted its address. */
const ID_FROM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOKEN = 'ab'.repeat(32);

/** Tables that belong to no workspace (the shared library, the deny list). */
const SHARED_TABLES = new Set([
  'clipSticker',
  'clipSound',
  'clipLibrarySource',
  'clipBlockedVideo',
]);
/**
 * The writes that make a row: none may run for another workspace's id. A
 * scoped `updateMany` or `deleteMany` (its filter carries workspace B, which
 * the check above proves) can only touch B's own rows, so it matches nothing.
 */
const WRITES = /^(create|createMany|upsert)$/;

/** True when the query names workspace B anywhere in its filter (or raw SQL values). */
function carriesOrg(value: unknown, orgId: string, depth = 0): boolean {
  if (depth > 8 || value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.organizationId === orgId || record.orgId === orgId) return true;
  if (Array.isArray(record.values) && record.values.includes(orgId)) return true;
  return Object.values(record).some((inner) => carriesOrg(inner, orgId, depth + 1));
}

/** Anything outside the database answers "nothing" quietly. */
function quietStub(): unknown {
  const fn = async () => undefined;
  return new Proxy(fn, {
    get: (_target, key) => (key === 'then' ? undefined : quietStub()),
    apply: async () => undefined,
  });
}

const SETTINGS: Record<string, unknown> = {
  CLIPS_SIMULATION: true,
  CLIPS_PLATFORMS: ['youtube', 'twitch', 'kick'],
  AI_SIMULATION: true,
  CLIPS_TTS: 'true',
  CLIPS_ACTION_VISION: 'true',
  NODE_ENV: 'test',
};

/** Every charge or give-back, to prove none happens for another workspace's row. */
const usage = {
  consume: jest.fn(async () => {
    throw new Error('charged');
  }),
  reverse: jest.fn(async () => ({ entryId: 'x', duplicate: false })),
  reverseAllFor: jest.fn(async () => 0),
};
/** Every model call, to prove no model is asked for another workspace's row. */
const modelCalls: string[] = [];
const ai = new Proxy(
  {},
  {
    get: (_target, key) =>
      key === 'then'
        ? undefined
        : () => {
            modelCalls.push(String(key));
            return quietStub();
          },
  },
);

let get: <T>(type: Type<T>) => T;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    providers: [
      ClipTranscriptsService,
      ClipCaptionsService,
      ClipCaptionStylesService,
      ClipHighlightsService,
      ClipAutoEditService,
      ClipFacesService,
      ClipFollowService,
      ClipVoiceService,
      ClipHookTitlesService,
      ClipRecipesService,
      ClipRecipeApplierService,
      ClipApplyRecipeService,
      ClipMomentsService,
      ClipStillsService,
      ClipsInternalService,
      ClipItemService,
      ClipJobsService,
      ClipTranscriptStore,
      ClipVideosRepository,
      ClipJobsRepository,
      ClipAutoEditRepository,
      ClipCaptionStylesRepository,
      ClipRecipesRepository,
      ClipVoiceRepository,
      { provide: ConfigService, useValue: { get: (key: string) => SETTINGS[key] } },
      { provide: UsageService, useValue: usage },
      { provide: AI_ENGINE, useValue: ai },
      // The media service is up and can speak, so each route reaches its own lookup.
      { provide: MediaServiceProbe, useValue: { state: async () => 'ok' } },
      {
        provide: MediaVoices,
        useValue: {
          list: async () => ({
            speaker: 'simulation',
            voices: [{ id: 'sim-meadow', languages: ['en'] }],
          }),
        },
      },
      {
        provide: RedisService,
        useValue: {
          incrementWithTtl: async () => 1,
          setIfAbsent: async () => true,
          get: async () => null,
          set: async () => undefined,
          delete: async () => undefined,
        },
      },
    ],
  })
    .useMocker(() => quietStub())
    .compile();
  get = <T>(type: Type<T>) => moduleRef.get(type);
});

beforeEach(() => {
  mockQueries.length = 0;
  modelCalls.length = 0;
  jest.clearAllMocks();
});

async function outcomeOf(call: () => Promise<unknown>): Promise<number | string> {
  try {
    await call();
    return 'answered';
  } catch (error) {
    return error instanceof HttpException ? error.getStatus() : String(error);
  }
}

function expectScopedAndUntouched(): void {
  expect(mockQueries.length).toBeGreaterThan(0);
  const unscoped = mockQueries.filter(
    (query) => !SHARED_TABLES.has(query.model) && !carriesOrg(query.args, ORG_B),
  );
  expect(unscoped).toEqual([]);
  expect(mockQueries.filter((query) => WRITES.test(query.op))).toEqual([]);
  expect(usage.consume).not.toHaveBeenCalled();
  expect(usage.reverse).not.toHaveBeenCalled();
  expect(modelCalls).toEqual([]);
}

const SETUP = defaultClipSetup(120_000);
const SRT = Buffer.from('1\n00:00:00,000 --> 00:00:01,000\nHello\n');

/** One row per AI id route a member calls: the label, then the call as workspace B. */
const ROUTES: Array<[string, () => Promise<unknown>]> = [
  [
    'POST /clips/videos/:videoId/transcript',
    () => get(ClipTranscriptsService).ensure(ORG_B, USER_B, ID_FROM_A, {}),
  ],
  [
    'POST /clips/videos/:videoId/transcript/quote',
    () => get(ClipTranscriptsService).quote(ORG_B, ID_FROM_A, {}),
  ],
  [
    'GET /clips/videos/:videoId/transcript',
    () => get(ClipTranscriptsService).read(ORG_B, ID_FROM_A, {}),
  ],
  [
    'PATCH /clips/videos/:videoId/transcript/words',
    () =>
      get(ClipTranscriptsService).fix(ORG_B, ID_FROM_A, { fixes: [{ index: 0, text: 'Mine' }] }),
  ],
  [
    'POST /clips/:clipId/captions',
    () => get(ClipCaptionsService).add(ORG_B, USER_B, ID_FROM_A, {}),
  ],
  [
    'POST /clips/:clipId/captions/from-file',
    () =>
      get(ClipCaptionsService).fromFile(
        ORG_B,
        ID_FROM_A,
        { buffer: SRT, size: SRT.length, originalname: 'a.srt', mimetype: 'text/plain' } as never,
        {},
      ),
  ],
  [
    'GET /clips/:clipId/words (captions)',
    () => get(ClipCaptionsService).words(ORG_B, ID_FROM_A, 'captions'),
  ],
  [
    'GET /clips/:clipId/words (spoken)',
    () => get(ClipCaptionsService).words(ORG_B, ID_FROM_A, 'spoken'),
  ],
  [
    'POST /clips/:clipId/captions/translate',
    () => get(ClipCaptionsService).translate(ORG_B, USER_B, ID_FROM_A, { language: 'ta' }),
  ],
  [
    'POST /clips/videos/:videoId/highlights (with a setup)',
    () => get(ClipHighlightsService).start(ORG_B, USER_B, ID_FROM_A, SETUP),
  ],
  [
    'POST /clips/videos/:videoId/setup/price',
    () => get(ClipHighlightsService).price(ORG_B, ID_FROM_A, SETUP),
  ],
  [
    'POST /clips/videos/:videoId/auto-edit/price',
    () => get(ClipAutoEditService).price(ORG_B, ID_FROM_A, { recipeId: DEFAULT_AUTO_EDIT_RECIPE }),
  ],
  [
    'POST /clips/videos/:videoId/auto-edit',
    () =>
      get(ClipAutoEditService).start(ORG_B, USER_B, ID_FROM_A, {
        recipeId: DEFAULT_AUTO_EDIT_RECIPE,
      }),
  ],
  ['POST /clips/:clipId/faces', () => get(ClipFacesService).ensure(ORG_B, USER_B, ID_FROM_A)],
  [
    'GET /clips/:clipId/faces',
    () => get(ClipFacesService).read(ORG_B, ID_FROM_A, { follow: true }),
  ],
  [
    'POST /clips/:clipId/voice',
    () =>
      get(ClipVoiceService).make(ORG_B, USER_B, ID_FROM_A, {
        text: 'Wait for it',
        voiceId: 'sim-meadow',
        revision: 1,
      }),
  ],
  [
    'POST /clips/:clipId/hook-titles',
    () => get(ClipHookTitlesService).suggest(ORG_B, USER_B, ID_FROM_A, 0),
  ],
  [
    'PATCH /clips/recipes/:id',
    () => get(ClipRecipesService).update(ORG_B, ID_FROM_A, { name: 'Mine now' }),
  ],
  ['DELETE /clips/recipes/:id', () => get(ClipRecipesService).remove(ORG_B, ID_FROM_A)],
  [
    'POST /clips/recipes/:id/duplicate',
    () => get(ClipRecipesService).duplicate(ORG_B, USER_B, ID_FROM_A),
  ],
  [
    'POST /clips/:clipId/apply-recipe',
    () => get(ClipApplyRecipeService).prepare(ORG_B, USER_B, ID_FROM_A, DEFAULT_AUTO_EDIT_RECIPE),
  ],
];

describe('Clips AI tenancy: another workspace gets "not found" (Sprint 13)', () => {
  it.each(ROUTES)('%s', async (_label, call) => {
    expect(await outcomeOf(call)).toBe(404);
    expectScopedAndUntouched();
  });
});

/** The worker-facing routes, with a job id of workspace A and workspace B in the body. */
const INTERNAL: Array<[string, () => Promise<unknown>]> = [
  [
    'POST /internal/clips/jobs/:jobId/pick-moments',
    () => get(ClipMomentsService).pick(ID_FROM_A, ORG_B),
  ],
  [
    'POST /internal/clips/jobs/:jobId/check-stills',
    () =>
      get(ClipStillsService).check(ID_FROM_A, {
        organizationId: ORG_B,
        bursts: [
          {
            stillKeys: [`clips/${ORG_B}/${ID_FROM_A}/still-0.jpg`],
            momentSec: 10,
            spanSec: 4,
            withSound: true,
          },
        ],
      }),
  ],
  [
    'POST /internal/clips/jobs/:jobId/follow-speaker',
    () => get(ClipFollowService).forRun(ID_FROM_A, ORG_B),
  ],
  [
    'POST /internal/clips/jobs/:jobId/auto-edit',
    () => get(ClipsInternalService).autoEdit(ID_FROM_A, { organizationId: ORG_B }),
  ],
  [
    'POST /internal/clips/jobs/:jobId/apply-recipe',
    () => get(ClipsInternalService).applyRecipe(ID_FROM_A, { organizationId: ORG_B }),
  ],
  [
    'POST /internal/clips/jobs/:jobId/reverse (Look For Action only)',
    () =>
      get(ClipsInternalService).reverseCharges(ID_FROM_A, {
        organizationId: ORG_B,
        step: 'action',
      }),
  ],
];

describe("Clips AI tenancy: a worker-facing route does nothing for another workspace's job", () => {
  it.each(INTERNAL)('%s', async (_label, call) => {
    const outcome = await outcomeOf(call);
    // A missing job is 404, or an answer that did nothing: never another status, never a crash.
    expect([404, 'answered']).toContain(outcome);
    expectScopedAndUntouched();
  });
});

describe('the give-back route', () => {
  it("gives back only workspace B's charges for the job, so A's are never touched", async () => {
    usage.reverseAllFor.mockResolvedValue(0);
    const answer = await get(ClipsInternalService).reverseCharges(ID_FROM_A, {
      organizationId: ORG_B,
    });
    expect(answer).toEqual({ reversed: 0 });
    // The ledger's own look-up is per workspace: entitlements/usage.service.security.spec.ts,
    // "cannot refund another workspace's charge, by entry or by job".
    expect(usage.reverseAllFor.mock.calls).toEqual([[ORG_B, ID_FROM_A]]);
  });
});

describe('every /internal/clips route needs the worker token', () => {
  const proto = ClipsInternalController.prototype as unknown as Record<string, object>;
  const handlers = Object.getOwnPropertyNames(proto).filter(
    (name) =>
      name !== 'constructor' && Reflect.getMetadata(PATH_METADATA, proto[name]) !== undefined,
  );

  it('finds every handler, the AI ones among them', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ClipsInternalController)).toBe('internal/clips');
    expect(handlers.length).toBeGreaterThanOrEqual(12);
    for (const name of ['pickMoments', 'checkStills', 'followSpeaker', 'autoEdit', 'applyRecipe']) {
      expect(handlers.some((handler) => handler.toLowerCase() === name.toLowerCase())).toBe(true);
    }
  });

  it.each(handlers)('%s sits behind InternalTokenGuard', (handler) => {
    const guards = [
      ...(Reflect.getMetadata(GUARDS_METADATA, ClipsInternalController) ?? []),
      ...(Reflect.getMetadata(GUARDS_METADATA, proto[handler]) ?? []),
    ];
    expect(guards).toContain(InternalTokenGuard);
    // Public only skips the session check; the token guard still runs.
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, ClipsInternalController)).toBe(true);
  });

  it('refuses no token, a wrong one, and every call when none is set', () => {
    const callTo = (headers: Record<string, string>) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({ headers, path: '/internal/clips/jobs/x/check-stills' }),
        }),
      }) as never;
    const guard = (token: string | undefined) =>
      new InternalTokenGuard({ get: () => token } as never);
    expect(() => guard(TOKEN).canActivate(callTo({}))).toThrow(UnauthorizedException);
    expect(() =>
      guard(TOKEN).canActivate(callTo({ [INTERNAL_TOKEN_HEADER]: 'cd'.repeat(32) })),
    ).toThrow(UnauthorizedException);
    expect(() => guard(undefined).canActivate(callTo({ [INTERNAL_TOKEN_HEADER]: TOKEN }))).toThrow(
      UnauthorizedException,
    );
    expect(guard(TOKEN).canActivate(callTo({ [INTERNAL_TOKEN_HEADER]: TOKEN }))).toBe(true);
  });
});
