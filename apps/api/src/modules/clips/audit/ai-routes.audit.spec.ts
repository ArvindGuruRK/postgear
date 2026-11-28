/**
 * The AI Minutes audit, one block per AI route (Sprint 13, Module 15
 * section 4). The one place that lists them all, each proving, in the
 * audit's own words:
 *
 * 1. **Shown is charged**: the number the preview (or the button's own sum)
 *    shows before the press is what `UsageService.consume` charged.
 * 2. **The key**: `clips.ai:<step>:<id>`, as each route documents it.
 * 3. **A repeat press charges once.**
 * 4. **A failure before any output gives everything back**, once.
 * 5. **A partial run gives back the unused share**, where the route has one.
 * 6. **A stretch already listened to charges nothing for listening.**
 * 7. **Too few minutes refuses before anything starts**, with the numbers.
 *
 * Every route runs as written, on the bench's real ledger (`ai-audit-bench`).
 * The routes' own specs go deeper; this file is the table, kept whole.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import {
  aiMinutesCost,
  builtInCaptionStyle,
  type ClipDocument,
  createCaptionsTrack,
  createClipDocument,
  DEFAULT_AUTO_EDIT_RECIPE,
  outputDuration,
  withCaptionsTrack,
} from '@postgear/video-engine';
import type { AiEngine } from '../../ai/engine/engine.types';
import { ClipAutoEditService } from '../auto-edit/clip-auto-edit.service';
import type { ClipAutoEditRepository } from '../auto-edit/clip-auto-edit.repository';
import { ClipCaptionStylesRepository } from '../captions/clip-caption-styles.repository';
import { ClipCaptionStylesService } from '../captions/clip-caption-styles.service';
import { ClipCaptionsService } from '../captions/clip-captions.service';
import { ClipItemService } from '../clip/clip-item.service';
import { ClipMomentsService } from '../highlights/clip-moments.service';
import type { ClipRecipeApplierService } from '../recipes/clip-recipe-applier.service';
import type { MediaVoices } from '../status/media-voices.client';
import { clipRow } from '../testing/fake-clip-db';
import { TEST_ORG, TEST_USER } from '../testing/rows';
import type { ClipTranscriptStore } from '../transcripts/clip-transcript-store';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import { ClipVoiceRepository } from '../voice/clip-voice.repository';
import { ClipVoiceService, voiceInputHash } from '../voice/clip-voice.service';
import {
  AI_METER,
  type AiBench,
  aiBench,
  type BenchOptions,
  HEARD_ID,
  highlightsOf,
  refusal,
  setupOf,
  TEN_MINUTES,
  VIDEO,
} from './ai-audit-bench';

let mockDb: unknown;
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');
  return {
    ...actual,
    prisma: new Proxy(
      {},
      { get: (_target, key) => (mockDb as Record<string | symbol, unknown>)[key] },
    ),
  };
});

const CLIP = clipRow().id;
const LIMIT = 300;
const LINE = 'Wait for it. This is the best part.';

beforeEach(() => {
  for (const level of ['log', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
  }
});
afterEach(() => jest.restoreAllMocks());

function bench(options: BenchOptions = {}): AiBench {
  const made = aiBench(options);
  mockDb = made.db;
  return made;
}

/** The reading step's model: answers nothing, so only whether it was asked matters here. */
function readingModel() {
  const writer = {
    pickMoments: jest.fn(async () => ({ picks: [], windows: 1, failed: 0 })),
    writeTitles: jest.fn(async () => []),
  };
  const ai = { createSnippetWriter: jest.fn(() => writer) };
  return { writer, ai: ai as unknown as AiEngine };
}

function momentsOf(b: AiBench, ai: AiEngine): ClipMomentsService {
  return new ClipMomentsService(b.transcripts, new ClipVideosRepository(), b.usage, ai);
}

const jobOf = (b: AiBench, kind: string) => {
  const job = b.tables.jobs.find((row) => row.kind === kind);
  if (!job) throw new Error(`no ${kind} job`);
  return job;
};

/** The 402 the meter answers, read as the web reads it. */
async function shortOf(promise: Promise<unknown>) {
  const { status, body } = await refusal(promise);
  return {
    status,
    code: body.code,
    message: String(body.message),
    details: body.details as Record<string, number>,
  };
}

// ---------------------------------------------------------------------------

describe('Find Clips (Quick Find, Sprint 12): clips.ai:signals:<jobId>', () => {
  it('charges the price the video page showed, once, under its key', async () => {
    const b = bench();
    const service = highlightsOf(b);
    const shown = (await service.latest(TEST_ORG, VIDEO)).price;
    expect(shown).toBe(aiMinutesCost('signals', TEN_MINUTES));

    const started = await service.start(TEST_ORG, TEST_USER, VIDEO);
    const jobId = started.job.id;
    expect(b.charges()).toEqual([{ key: `clips.ai:signals:${jobId}`, units: shown, refId: jobId }]);
    expect(started.meter.remaining).toBe(LIMIT - shown);
  });

  it('a repeat press charges once', async () => {
    const b = bench();
    const service = highlightsOf(b);
    const started = await service.start(TEST_ORG, TEST_USER, VIDEO);
    const again = await refusal(service.start(TEST_ORG, TEST_USER, VIDEO));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('highlights_running');
    // The same key replayed (a retried request) answers the first charge.
    const replay = await b.usage.consume(TEST_ORG, AI_METER, 3, {
      idempotencyKey: `clips.ai:signals:${started.job.id}`,
      refId: started.job.id,
    });
    expect(replay.duplicate).toBe(true);
    expect(b.charges()).toHaveLength(1);
    expect(b.net()).toBe(3);
  });

  it('a failure before any output gives every minute back, and never twice', async () => {
    const b = bench();
    const started = await highlightsOf(b).start(TEST_ORG, TEST_USER, VIDEO);
    expect(await b.workerFails(started.job.id)).toEqual({ reversed: 1 });
    expect(b.net()).toBe(0);
    expect(await b.workerFails(started.job.id)).toEqual({ reversed: 0 });
    expect(b.reversals()).toHaveLength(1);
  });

  it('has no partial share: a run that finds nothing keeps its price (it was for looking)', async () => {
    const b = bench();
    const started = await highlightsOf(b).start(TEST_ORG, TEST_USER, VIDEO);
    const answer = await b.internal.reverseCharges(started.job.id, {
      organizationId: TEST_ORG,
      step: 'action',
    });
    expect(answer).toEqual({ reversed: 0 });
    expect(b.net()).toBe(3);
  });

  it('too few minutes refuses before anything starts, with the numbers', async () => {
    const b = bench({ limit: 2 });
    const short = await shortOf(highlightsOf(b).start(TEST_ORG, TEST_USER, VIDEO));
    expect(short.status).toBe(402);
    expect(short.code).toBe('clips_ai_minutes_used');
    expect(short.details).toMatchObject({ needed: 3, remaining: 2 });
    expect(short.message).toContain('This needs 3 AI minutes and you have 2 left.');
    expect(b.tables.jobs).toHaveLength(0);
    expect(b.tables.runs).toHaveLength(0);
    expect(b.scheduling.startClipJob).not.toHaveBeenCalled();
    expect(b.charges()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('Clip Setup (Find Clips with a setup): clips.ai:read, clips.ai:listen, clips.ai:signals', () => {
  it('the Summary total is what the run charges: reading under the run, listening under its job', async () => {
    const b = bench();
    const service = highlightsOf(b);
    const price = await service.price(TEST_ORG, VIDEO, setupOf());
    expect(price.lines).toEqual([
      { step: 'listen', aiMinutes: aiMinutesCost('listen', TEN_MINUTES) },
      { step: 'read', aiMinutes: aiMinutesCost('read', TEN_MINUTES) },
      { step: 'signals', aiMinutes: 0 },
    ]);
    expect(price.total).toBe(13);
    expect(price.remaining).toBe(LIMIT);

    const started = await service.start(TEST_ORG, TEST_USER, VIDEO, setupOf());
    const run = started.job.id;
    const listen = jobOf(b, 'TRANSCRIBE').id;
    expect(b.charges()).toEqual([
      { key: `clips.ai:read:${run}`, units: 3, refId: run },
      { key: `clips.ai:listen:${listen}`, units: 10, refId: listen },
    ]);
    expect(b.net()).toBe(price.total);
    expect(started.meter.remaining).toBe(LIMIT - price.total);
  });

  it('a stretch already listened to charges nothing for listening (Sound And Picture instead)', async () => {
    const b = bench({ heard: [0, 600] });
    const service = highlightsOf(b);
    const price = await service.price(TEST_ORG, VIDEO, setupOf());
    expect(price.lines).toEqual([
      { step: 'listen', aiMinutes: 0 },
      { step: 'read', aiMinutes: 3 },
      { step: 'signals', aiMinutes: aiMinutesCost('signals', TEN_MINUTES) },
    ]);
    const started = await service.start(TEST_ORG, TEST_USER, VIDEO, setupOf());
    const run = started.job.id;
    expect(b.charges()).toEqual([
      { key: `clips.ai:read:${run}`, units: 3, refId: run },
      { key: `clips.ai:signals:${run}`, units: 3, refId: run },
    ]);
    expect(b.tables.jobs.filter((job) => job.kind === 'TRANSCRIBE')).toHaveLength(0);
    expect(b.net()).toBe(price.total);
  });

  it('half listened to: only the other half is charged for listening', async () => {
    const b = bench({ heard: [0, 300] });
    const service = highlightsOf(b);
    const price = await service.price(TEST_ORG, VIDEO, setupOf());
    expect(price.lines[0]).toEqual({ step: 'listen', aiMinutes: 5 });
    await service.start(TEST_ORG, TEST_USER, VIDEO, setupOf());
    const listen = jobOf(b, 'TRANSCRIBE').id;
    expect(b.charges().find((charge) => charge.refId === listen)?.units).toBe(5);
    expect(b.net()).toBe(price.total);
  });

  it('a repeat press charges once', async () => {
    const b = bench();
    const service = highlightsOf(b);
    await service.start(TEST_ORG, TEST_USER, VIDEO, setupOf());
    const again = await refusal(service.start(TEST_ORG, TEST_USER, VIDEO, setupOf()));
    expect(again.body.code).toBe('highlights_running');
    expect(b.charges()).toHaveLength(2);
    expect(b.tables.jobs.filter((job) => job.kind === 'TRANSCRIBE')).toHaveLength(1);
  });

  it('a failure before any output gives every minute back: the run and its listening', async () => {
    const b = bench();
    const started = await highlightsOf(b).start(TEST_ORG, TEST_USER, VIDEO, setupOf());
    await b.workerFails(jobOf(b, 'TRANSCRIBE').id);
    await b.workerFails(started.job.id);
    expect(b.net()).toBe(0);
    expect(b.reversals()).toHaveLength(2);
  });

  it('a partial run gives back the unused share: no speech returns listening and reading', async () => {
    const b = bench();
    const { ai, writer } = readingModel();
    const started = await highlightsOf(b).start(TEST_ORG, TEST_USER, VIDEO, setupOf());
    // The listen heard nothing: the worker gives its minutes back; reading then finds no rows.
    await b.workerListened(jobOf(b, 'TRANSCRIBE').id, 0, 600, true);
    const answer = await momentsOf(b, ai).pick(started.job.id, TEST_ORG);
    expect(answer.noSpeech).toBe(true);
    expect(writer.pickMoments).not.toHaveBeenCalled();
    expect(b.net()).toBe(0);
  });

  it('too few minutes refuses before anything starts, with the numbers', async () => {
    const b = bench({ limit: 12 });
    const short = await shortOf(highlightsOf(b).start(TEST_ORG, TEST_USER, VIDEO, setupOf()));
    expect(short.status).toBe(402);
    expect(short.code).toBe('clips_ai_minutes_used');
    expect(short.details).toMatchObject({ needed: 13, remaining: 12 });
    expect(short.message).toContain('This needs 13 AI minutes and you have 12 left.');
    expect(b.tables.jobs).toHaveLength(0);
    expect(b.scheduling.startClipJob).not.toHaveBeenCalled();
    expect(b.charges()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('Look For Action (Module 06): clips.ai:action:<jobId>', () => {
  it('charges the line Clip Setup showed for it, under its own key', async () => {
    const b = bench();
    const service = highlightsOf(b);
    const half = setupOf({ action: true, range: { fromMs: 0, toMs: 300_000 } });
    const price = await service.price(TEST_ORG, VIDEO, half);
    const line = price.lines.find((one) => one.step === 'action');
    expect(line?.aiMinutes).toBe(aiMinutesCost('action', 300_000));
    const started = await service.start(TEST_ORG, TEST_USER, VIDEO, half);
    expect(b.charges()).toContainEqual({
      key: `clips.ai:action:${started.job.id}`,
      units: line?.aiMinutes,
      refId: started.job.id,
    });
    expect(b.net()).toBe(price.total);
  });

  it('costs the same with the still check on or off', async () => {
    const off = bench();
    const offPrice = await highlightsOf(off, false).price(
      TEST_ORG,
      VIDEO,
      setupOf({ action: true }),
    );
    const on = bench();
    const onPrice = await highlightsOf(on, true).price(TEST_ORG, VIDEO, setupOf({ action: true }));
    expect(onPrice.total).toBe(offPrice.total);
  });

  it('a repeat press charges once', async () => {
    const b = bench();
    const service = highlightsOf(b);
    await service.start(TEST_ORG, TEST_USER, VIDEO, setupOf({ action: true }));
    await refusal(service.start(TEST_ORG, TEST_USER, VIDEO, setupOf({ action: true })));
    expect(b.charges().filter((charge) => charge.key.startsWith('clips.ai:action:'))).toHaveLength(
      1,
    );
  });

  it('a failure before any output gives it back with the run', async () => {
    const b = bench({ heard: [0, 600] });
    const started = await highlightsOf(b).start(
      TEST_ORG,
      TEST_USER,
      VIDEO,
      setupOf({ action: true }),
    );
    await b.workerFails(started.job.id);
    expect(b.net()).toBe(0);
  });

  it('a partial run gives back only its share: the motion measure failed, the rest ran', async () => {
    const b = bench();
    const started = await highlightsOf(b).start(
      TEST_ORG,
      TEST_USER,
      VIDEO,
      setupOf({ action: true }),
    );
    const body = { organizationId: TEST_ORG, step: 'action' as const };
    expect(await b.internal.reverseCharges(started.job.id, body)).toEqual({ reversed: 1 });
    // Reading and listening were done: they stay. Asked again, nothing more comes back.
    expect(b.net()).toBe(13);
    expect(await b.internal.reverseCharges(started.job.id, body)).toEqual({ reversed: 0 });
    expect(b.net()).toBe(13);
  });

  it('too few minutes for the run with it refuses the whole run, with the numbers', async () => {
    const b = bench({ limit: 15 });
    const service = highlightsOf(b);
    const short = await shortOf(
      service.start(TEST_ORG, TEST_USER, VIDEO, setupOf({ action: true })),
    );
    expect(short.details).toMatchObject({ needed: 18, remaining: 15 });
    expect(b.charges()).toEqual([]);
    // Without it the same run fits.
    await service.start(TEST_ORG, TEST_USER, VIDEO, setupOf());
    expect(b.net()).toBe(13);
  });
});

// ---------------------------------------------------------------------------

/** The clip plays 120 s to 150 s of the video; `captions` puts a track on the video's transcript. */
function clipDocument(captions = false): ClipDocument {
  const doc = createClipDocument({ videoId: VIDEO, fromMs: 120_000, toMs: 150_000, ratio: '9:16' });
  if (!captions) return doc;
  const look = builtInCaptionStyle('clean')?.look;
  if (!look) throw new Error('no clean style');
  return withCaptionsTrack(
    doc,
    createCaptionsTrack({ transcriptAssetId: HEARD_ID, language: 'en', styleId: 'clean', look }),
  );
}

function captionsOf(b: AiBench, ai: AiEngine, document: ClipDocument): ClipCaptionsService {
  b.tables.clips.push(clipRow({ document: document as never }));
  return new ClipCaptionsService(
    Object.create(ClipItemService.prototype) as ClipItemService,
    new ClipVideosRepository(),
    b.transcripts,
    new ClipCaptionStylesService(new ClipCaptionStylesRepository()),
    b.store as unknown as ClipTranscriptStore,
    b.usage,
    b.limits as never,
    ai,
  );
}

const NO_AI = { createSnippetWriter: jest.fn(() => null) } as unknown as AiEngine;

describe('Add Captions and Listen (Modules 02 to 04): clips.ai:listen:<jobId>', () => {
  it('the quote is what listening charges, under the listening job', async () => {
    const b = bench();
    const quote = await b.transcripts.quote(TEST_ORG, VIDEO, { fromMs: 0, toMs: 120_000 });
    expect(quote).toEqual({ price: aiMinutesCost('listen', 120_000), ms: 120_000, covered: false });
    const outcome = await b.transcripts.ensure(TEST_ORG, TEST_USER, VIDEO, {
      fromMs: 0,
      toMs: 120_000,
    });
    if (outcome.covered || outcome.joined) throw new Error('expected a new listening job');
    expect(outcome.price).toBe(quote.price);
    expect(b.charges()).toEqual([
      { key: `clips.ai:listen:${outcome.job.id}`, units: quote.price, refId: outcome.job.id },
    ]);
  });

  it("Add Captions charges the number its button showed (the words route's price)", async () => {
    const b = bench();
    const captions = captionsOf(b, NO_AI, clipDocument());
    const shown = (await captions.words(TEST_ORG, CLIP)).price;
    expect(shown).toBeGreaterThan(0);
    const added = await captions.add(TEST_ORG, TEST_USER, CLIP, {});
    if (added.covered) throw new Error('expected listening');
    expect(added.price).toBe(shown);
    expect(b.charges()).toEqual([
      { key: `clips.ai:listen:${added.job.id}`, units: shown, refId: added.job.id },
    ]);
  });

  it('a repeat press charges once: the open job is joined, then the words are free', async () => {
    const b = bench();
    const first = await b.transcripts.ensure(TEST_ORG, TEST_USER, VIDEO, {
      fromMs: 0,
      toMs: 120_000,
    });
    if (first.covered) throw new Error('expected a job');
    const second = await b.transcripts.ensure(TEST_ORG, TEST_USER, VIDEO, {
      fromMs: 0,
      toMs: 120_000,
    });
    expect(second).toMatchObject({ covered: false, joined: true, price: 0 });
    await b.workerListened(first.job.id, 0, 120);
    const third = await b.transcripts.ensure(TEST_ORG, TEST_USER, VIDEO, {
      fromMs: 0,
      toMs: 120_000,
    });
    expect(third).toEqual({ covered: true, language: 'en', price: 0 });
    expect(b.charges()).toHaveLength(1);
    expect(b.tables.jobs.filter((job) => job.kind === 'TRANSCRIBE')).toHaveLength(1);
  });

  it('a failure before any output gives it all back, and never twice', async () => {
    const b = bench();
    const outcome = await b.transcripts.ensure(TEST_ORG, TEST_USER, VIDEO, {});
    if (outcome.covered) throw new Error('expected a job');
    expect(await b.workerFails(outcome.job.id)).toEqual({ reversed: 1 });
    expect(await b.workerFails(outcome.job.id)).toEqual({ reversed: 0 });
    expect(b.net()).toBe(0);
  });

  it('hearing no speech gives it all back', async () => {
    const b = bench();
    const outcome = await b.transcripts.ensure(TEST_ORG, TEST_USER, VIDEO, {
      fromMs: 0,
      toMs: 60_000,
    });
    if (outcome.covered) throw new Error('expected a job');
    await b.workerListened(outcome.job.id, 0, 60, true);
    expect(b.net()).toBe(0);
  });

  it('a stretch already listened to charges nothing; only the gap is priced', async () => {
    const b = bench({ heard: [0, 300] });
    expect(await b.transcripts.quote(TEST_ORG, VIDEO, { fromMs: 0, toMs: 300_000 })).toEqual({
      price: 0,
      ms: 0,
      covered: true,
    });
    expect(
      await b.transcripts.ensure(TEST_ORG, TEST_USER, VIDEO, { fromMs: 0, toMs: 300_000 }),
    ).toEqual({ covered: true, language: 'en', price: 0 });
    // One more minute: that minute only, at the listening minimum.
    expect(await b.transcripts.quote(TEST_ORG, VIDEO, { fromMs: 0, toMs: 360_000 })).toEqual({
      price: 2,
      ms: 60_000,
      covered: false,
    });
    expect(b.charges()).toEqual([]);
    expect(b.tables.jobs).toHaveLength(0);
  });

  it('too few minutes refuses before anything starts, with the numbers', async () => {
    const b = bench({ limit: 1 });
    const short = await shortOf(b.transcripts.ensure(TEST_ORG, TEST_USER, VIDEO, { toMs: 60_000 }));
    expect(short.status).toBe(402);
    expect(short.code).toBe('clips_ai_minutes_used');
    expect(short.details).toMatchObject({ needed: 2, remaining: 1 });
    expect(short.message).toContain('This needs 2 AI minutes and you have 1 left.');
    expect(b.tables.jobs).toHaveLength(0);
    expect(b.scheduling.startClipJob).not.toHaveBeenCalled();
    expect(b.charges()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('Translate Captions (Module 03): clips.ai:translate:<attemptId>', () => {
  function translating(b: AiBench, options: { fail?: boolean; gate?: Promise<void> } = {}) {
    const translate = jest.fn(async (request: { lines: string[] }) => {
      if (options.gate) await options.gate;
      if (options.fail) throw Object.assign(new Error('provider down'), { kind: 'unavailable' });
      return { lines: request.lines.map((line) => `ta ${line}`) };
    });
    const ai = {
      modelName: 'simulation',
      createSnippetWriter: jest.fn(() => ({ translate })),
    } as unknown as AiEngine;
    const document = clipDocument(true);
    return { service: captionsOf(b, ai, document), translate, document };
  }

  it('charges what the Translate button showed, under a key of its own attempt', async () => {
    const b = bench({ heard: [0, 300] });
    const { service, document } = translating(b);
    // The editor's label: `aiMinutesCost('translate', outputDuration(document))`.
    const shown = aiMinutesCost('translate', outputDuration(document));
    const answer = await service.translate(TEST_ORG, TEST_USER, CLIP, { language: 'ta' });
    expect(answer).toMatchObject({ price: shown, reused: false });
    const [charge] = b.charges();
    expect(charge?.units).toBe(shown);
    expect(charge?.key).toMatch(/^clips\.ai:translate:[0-9a-f-]{36}$/);
    expect(charge?.key).toBe(`clips.ai:translate:${charge?.refId}`);
  });

  it('a repeat press charges once: a double press is one call, the same request again is free', async () => {
    const b = bench({ heard: [0, 300] });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service, translate } = translating(b, { gate });
    const first = service.translate(TEST_ORG, TEST_USER, CLIP, { language: 'ta' });
    const second = service.translate(TEST_ORG, TEST_USER, CLIP, { language: 'ta' });
    for (let tick = 0; tick < 20; tick += 1) await new Promise((done) => setImmediate(done));
    release();
    const [one, two] = await Promise.all([first, second]);
    expect(two).toEqual(one);
    expect(translate).toHaveBeenCalledTimes(1);
    const later = await service.translate(TEST_ORG, TEST_USER, CLIP, { language: 'ta' });
    expect(later).toMatchObject({ price: 0, reused: true });
    expect(b.charges()).toHaveLength(1);
  });

  it('a failure before any output gives it all back', async () => {
    const b = bench({ heard: [0, 300] });
    const { service } = translating(b, { fail: true });
    const failed = await refusal(service.translate(TEST_ORG, TEST_USER, CLIP, { language: 'ta' }));
    expect(failed.status).toBe(502);
    expect(failed.body.code).toBe('translate_failed');
    expect(b.charges()).toHaveLength(1);
    expect(b.net()).toBe(0);
  });

  it('too few minutes refuses before the model is asked, with the numbers', async () => {
    const b = bench({ heard: [0, 300], limit: 0 });
    const { service, translate } = translating(b);
    const short = await shortOf(service.translate(TEST_ORG, TEST_USER, CLIP, { language: 'ta' }));
    expect(short.status).toBe(402);
    expect(short.code).toBe('clips_ai_minutes_used');
    expect(short.details).toMatchObject({ needed: 1, remaining: 0 });
    expect(translate).not.toHaveBeenCalled();
    expect(b.charges()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

/** The media service's voices under simulation: the shared fixture Python answers. */
const VOICES = JSON.parse(
  readFileSync(
    path.join(
      __dirname,
      '../../../../../../packages/media-contract/fixtures/voices/simulated.json',
    ),
    'utf8',
  ),
) as { speaker: { name: string }; voices: unknown[] };

function voiceOf(b: AiBench): ClipVoiceService {
  b.tables.clips.push(clipRow({ id: CLIP }));
  return new ClipVoiceService(
    Object.create(ClipItemService.prototype) as ClipItemService,
    b.jobs,
    b.jobsRepository,
    new ClipVoiceRepository(),
    b.limits as never,
    b.usage,
    { state: jest.fn(async () => 'ok') } as never,
    {
      list: jest.fn(async () => ({ speaker: VOICES.speaker.name, voices: VOICES.voices })),
    } as unknown as MediaVoices,
    { get: jest.fn(() => 'true') } as never,
  );
}

const voiceBody = { text: LINE, voiceId: 'sim-river', revision: 4 };

describe('Make The Voice (Module 09): clips.ai:voice:<clipId>:<revision>:<hash>', () => {
  it('charges what Make The Voice showed, under its key, for its job', async () => {
    const b = bench();
    // The panel's label: `aiMinutesCost('voice', characters)`.
    const shown = aiMinutesCost('voice', LINE.length);
    const made = await voiceOf(b).make(TEST_ORG, TEST_USER, CLIP, voiceBody);
    expect(made).toMatchObject({ price: shown, reused: false });
    expect(b.charges()).toEqual([
      {
        key: `clips.ai:voice:${CLIP}:4:${voiceInputHash('sim-river', LINE)}`,
        units: shown,
        refId: made.job.id,
      },
    ]);
  });

  it('a repeat press charges once', async () => {
    const b = bench();
    const service = voiceOf(b);
    const first = await service.make(TEST_ORG, TEST_USER, CLIP, voiceBody);
    const second = await service.make(TEST_ORG, TEST_USER, CLIP, voiceBody);
    expect(second).toMatchObject({ price: 0, reused: true });
    expect(second.job.id).toBe(first.job.id);
    expect(b.charges()).toHaveLength(1);
    expect(b.tables.jobs.filter((job) => job.kind === 'SPEECH')).toHaveLength(1);
  });

  it('a failure before any output gives it all back; making it again pays as a new attempt', async () => {
    const b = bench();
    const service = voiceOf(b);
    const first = await service.make(TEST_ORG, TEST_USER, CLIP, voiceBody);
    expect(await b.workerFails(first.job.id)).toEqual({ reversed: 1 });
    expect(b.net()).toBe(0);
    const retry = await service.make(TEST_ORG, TEST_USER, CLIP, voiceBody);
    expect(retry).toMatchObject({ price: 1, reused: false });
    expect(b.charges()[1]?.key).toBe(
      `clips.ai:voice:${CLIP}:4:${voiceInputHash('sim-river', LINE)}:1`,
    );
    expect(b.net()).toBe(1);
  });

  it('too few minutes refuses before anything starts, with the numbers', async () => {
    const b = bench({ limit: 0 });
    const short = await shortOf(voiceOf(b).make(TEST_ORG, TEST_USER, CLIP, voiceBody));
    expect(short.status).toBe(402);
    expect(short.code).toBe('clips_ai_minutes_used');
    expect(short.details).toMatchObject({ needed: 1, remaining: 0 });
    // The row written first is taken back: nothing waits to run.
    expect(b.tables.jobs).toHaveLength(0);
    expect(b.scheduling.startClipJob).not.toHaveBeenCalled();
    expect(b.charges()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

function autoEditOf(b: AiBench) {
  const applier = {
    createAutoEditClip: jest.fn(
      async (_org: string, _user: string | null, request: { clipId: string }) => ({
        clipId: request.clipId,
        skipped: [],
        noSpeech: false,
      }),
    ),
  };
  const service = new ClipAutoEditService(
    new ClipVideosRepository(),
    b.jobs,
    b.jobsRepository,
    b.limits as never,
    b.usage,
    b.resolver as never,
    b.transcripts,
    applier as unknown as ClipRecipeApplierService,
    { findRecipe: jest.fn(async () => null) } as unknown as ClipAutoEditRepository,
  );
  return { service, applier };
}

const talking = { recipeId: DEFAULT_AUTO_EDIT_RECIPE };

describe('Auto-Edit Video (Module 10): its listening, clips.ai:listen:<listenJobId>', () => {
  it('charges what the dialog showed, under the listening job, and nothing under its own', async () => {
    const b = bench();
    const { service } = autoEditOf(b);
    const shown = await service.price(TEST_ORG, VIDEO, talking);
    expect(shown.aiMinutes).toBe(aiMinutesCost('listen', TEN_MINUTES));
    const started = await service.start(TEST_ORG, TEST_USER, VIDEO, talking);
    expect(started.aiMinutes).toBe(shown.aiMinutes);
    const listen = jobOf(b, 'TRANSCRIBE').id;
    expect(b.charges()).toEqual([
      { key: `clips.ai:listen:${listen}`, units: shown.aiMinutes, refId: listen },
    ]);
    expect(b.net(started.job?.id)).toBe(0);
  });

  it('a stretch already listened to, or a recipe that needs no words, costs nothing', async () => {
    const heard = bench({ heard: [0, 600] });
    const listened = autoEditOf(heard);
    expect((await listened.service.price(TEST_ORG, VIDEO, talking)).aiMinutes).toBe(0);
    const made = await listened.service.start(TEST_ORG, TEST_USER, VIDEO, talking);
    expect(made).toMatchObject({ job: null, aiMinutes: 0 });
    expect(heard.charges()).toEqual([]);

    const fresh = bench();
    const reframe = { recipeId: 'starter-reframe' as const };
    expect((await autoEditOf(fresh).service.price(TEST_ORG, VIDEO, reframe)).aiMinutes).toBe(0);
    expect(fresh.charges()).toEqual([]);
  });

  it('a repeat press charges once', async () => {
    const b = bench();
    const { service } = autoEditOf(b);
    await service.start(TEST_ORG, TEST_USER, VIDEO, talking);
    const again = await refusal(service.start(TEST_ORG, TEST_USER, VIDEO, talking));
    expect(again.body.code).toBe('auto_edit_running');
    expect(b.charges()).toHaveLength(1);
  });

  it('a failure before any output gives it all back: listening failed', async () => {
    const b = bench();
    await autoEditOf(b).service.start(TEST_ORG, TEST_USER, VIDEO, talking);
    await b.workerFails(jobOf(b, 'TRANSCRIBE').id);
    expect(b.net()).toBe(0);
  });

  it('a failure before any output gives it all back: the job row never landed', async () => {
    const b = bench();
    const { service } = autoEditOf(b);
    const create = b.jobsRepository.create.bind(b.jobsRepository);
    jest
      .spyOn(b.jobsRepository, 'create')
      .mockImplementation((job, tx) =>
        job.kind === 'AUTO_EDIT' ? Promise.reject(new Error('database down')) : create(job, tx),
      );
    await expect(service.start(TEST_ORG, TEST_USER, VIDEO, talking)).rejects.toThrow(
      'database down',
    );
    expect(jobOf(b, 'TRANSCRIBE').status).toBe('CANCELLED');
    expect(b.net()).toBe(0);
  });

  it('too few minutes refuses before anything starts, with the numbers', async () => {
    const b = bench({ limit: 9 });
    const short = await shortOf(autoEditOf(b).service.start(TEST_ORG, TEST_USER, VIDEO, talking));
    expect(short.status).toBe(402);
    expect(short.code).toBe('clips_ai_minutes_used');
    expect(short.details).toMatchObject({ needed: 10, remaining: 9 });
    expect(short.message).toContain('This needs 10 AI minutes and you have 9 left.');
    expect(b.tables.jobs).toHaveLength(0);
    expect(b.charges()).toEqual([]);
  });
});
