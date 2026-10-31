/**
 * The PostGear steps (Module 10) through `executeNodeActivity` on the
 * memory store, with a fake step gateway that keeps a ledger like the
 * API's: one post per run and step, the stored answer on a replay.
 */
import { SAMPLE_MEDIA_ID } from '@postgear/automation';
import { AUTOMATION_FAILURE_TYPES } from '@postgear/scheduling';
import { ApplicationFailure } from '@temporalio/activity';
import { StepFailure } from '../failures';
import {
  createGatewayClient,
  GATEWAY_UNAVAILABLE_MESSAGE,
  type GatewayClient,
} from '../gateway-client';
import { graphOf, harness, line, ORG, RUN_ID, step, testOptions } from '../testing';
import {
  BAD_TIME_MESSAGE,
  chosenTime,
  mediaIdsFor,
  preview,
  SAMPLE_MEDIA_NOTE,
  TEST_DRAFT_NOTE,
} from './posts';

const IMAGE_ID = '6f1c2f7e-5d2b-4d0c-9a4e-3b8f0e2a1c11';
const LIBRARY_ID = '7a2d3e4f-5b6c-4d7e-8f90-a1b2c3d4e5f6';
const imageRef = { kind: 'media', id: IMAGE_ID, type: 'image', url: 'https://x/a.jpg' };

/** A gateway with the API's ledger: acts once per run and step, answers replays from it. */
function fakeGateway(answers: Record<string, unknown> = {}) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const ledger = new Map<string, { output: unknown; credits: number }>();
  const effects = { posts: 0, publishSignals: 0 };
  /** Replies to drop after acting, as if the network failed on the way back. */
  const lose = { replies: 0 };
  let refuse: StepFailure | null = null;

  const client: GatewayClient = {
    async call<T>(path: string, body: Record<string, unknown>) {
      calls.push({ path, body });
      if (refuse) throw refuse;
      const key = `${body.runId}:${body.nodeKey}`;
      let stored = ledger.get(key);
      if (!stored) {
        if (path !== '/posts/get') effects.posts += 1;
        if (path === '/posts/publish') effects.publishSignals += 1;
        stored = { output: answers[path] ?? { postGroup: 'grp_1' }, credits: 0 };
        if (path !== '/posts/get') ledger.set(key, stored);
      }
      if (lose.replies > 0) {
        lose.replies -= 1;
        throw new StepFailure('retryable', GATEWAY_UNAVAILABLE_MESSAGE, 'gateway_unreachable');
      }
      return stored as { output: T; credits: number };
    },
  };
  return {
    client,
    calls,
    effects,
    lose,
    refuseWith(failure: StepFailure) {
      refuse = failure;
    },
  };
}

function addChannels(h: ReturnType<typeof harness>) {
  h.store.addChannel({
    id: 'ch_ig',
    organizationId: ORG,
    name: 'Bloom Bakery',
    provider: 'instagram',
    postingTimes: [9 * 60],
    disabled: false,
  });
  h.store.addChannel({
    id: 'ch_li',
    organizationId: ORG,
    name: 'Acme Marketing',
    provider: 'linkedin',
    postingTimes: [17 * 60],
    disabled: false,
  });
}

function single(key: string, type: Parameters<typeof step>[1], config: Record<string, unknown>) {
  return graphOf(
    [step('trig1', 'trigger.manual'), step(key, type, { config })],
    [line('trig1', key)],
  );
}

describe('mediaIdsFor', () => {
  it('takes refs from earlier steps and library picks, once each', () => {
    expect(mediaIdsFor({ media: [imageRef, imageRef], mediaIds: [LIBRARY_ID, IMAGE_ID] })).toEqual({
      ids: [IMAGE_ID, LIBRARY_ID],
      notes: [],
    });
    expect(mediaIdsFor({ media: '', mediaIds: [] })).toEqual({ ids: [], notes: [] });
  });

  it('leaves the sample image out and says so', () => {
    expect(mediaIdsFor({ media: { ...imageRef, id: SAMPLE_MEDIA_ID } })).toEqual({
      ids: [],
      notes: [SAMPLE_MEDIA_NOTE],
    });
  });

  it('refuses text, links and made-up ids in the media field', () => {
    for (const media of ['https://x/a.jpg', { ...imageRef, id: 'img_1' }, 5]) {
      expect(() => mediaIdsFor({ media })).toThrow(
        'The media field needs an image or video from an earlier step.',
      );
    }
  });
});

describe('chosenTime', () => {
  it('reads a time without a zone in the step’s zone, and one with a zone as given', () => {
    expect(new Date(chosenTime('2026-11-05 09:00', 'America/New_York')).toISOString()).toBe(
      '2026-11-05T14:00:00.000Z',
    );
    expect(
      new Date(chosenTime('2026-11-05T09:00:00+01:00', 'America/New_York')).toISOString(),
    ).toBe('2026-11-05T08:00:00.000Z');
    expect(chosenTime(1_000, 'UTC')).toBe(1_000);
    expect(() => chosenTime('next tuesday', 'UTC')).toThrow(BAD_TIME_MESSAGE);
  });

  it('quotes at most 80 characters on one line', () => {
    expect(preview('Hello\n\nworld')).toBe('Hello world');
    expect(preview('a'.repeat(100))).toBe(`${'a'.repeat(80)}...`);
  });
});

describe('Create Draft', () => {
  it('runs for real in a test run, with media from an earlier step and the library', async () => {
    const gateway = fakeGateway({ '/posts/draft': { postGroup: 'grp_1', mediaCount: 2 } });
    const h = harness(
      single('draft1', 'postgear.createDraft', {
        channels: ['ch_ig'],
        text: 'About {{ trigger.inputs.topic }}\n\nPart two',
        media: '{{ trigger.inputs.image }}',
        mediaIds: [LIBRARY_ID],
        parts: 'splitOnBlankLines',
        tags: ['tag_1'],
      }),
      { triggerPayload: { inputs: { topic: 'Sourdough', image: imageRef } } },
      { gateway: gateway.client },
    );

    const result = await h.activities.executeNodeActivity(h.stepRef('draft1'));

    expect(result.status).toBe('succeeded');
    expect(gateway.calls).toEqual([
      {
        path: '/posts/draft',
        body: {
          runId: RUN_ID,
          nodeKey: 'draft1',
          organizationId: ORG,
          channels: ['ch_ig'],
          text: 'About Sourdough\n\nPart two',
          mediaIds: [IMAGE_ID, LIBRARY_ID],
          tags: ['tag_1'],
          parts: 'splitOnBlankLines',
        },
      },
    ]);
    expect(h.store.latest(RUN_ID, 'draft1')?.output).toEqual({
      postGroup: 'grp_1',
      mediaCount: 2,
      note: TEST_DRAFT_NOTE,
    });
  });

  it('drops the sample image, says so, and still writes the draft', async () => {
    const gateway = fakeGateway();
    const h = harness(
      single('draft1', 'postgear.createDraft', {
        channels: ['ch_ig'],
        text: 'Hi',
        media: '{{ trigger.inputs.image }}',
      }),
      { triggerPayload: { inputs: { image: { ...imageRef, id: SAMPLE_MEDIA_ID } } } },
      { gateway: gateway.client },
    );

    await h.activities.executeNodeActivity(h.stepRef('draft1'));

    expect(gateway.calls[0].body.mediaIds).toEqual([]);
    expect(h.store.latest(RUN_ID, 'draft1')?.output).toMatchObject({
      note: `${TEST_DRAFT_NOTE} ${SAMPLE_MEDIA_NOTE}`,
    });
  });

  it('fails for good on something that is not media, without calling PostGear', async () => {
    const gateway = fakeGateway();
    const h = harness(
      single('draft1', 'postgear.createDraft', {
        channels: ['ch_ig'],
        text: 'Hi',
        media: 'https://example.com/a.jpg',
      }),
      {},
      { gateway: gateway.client },
    );

    const error = await h.activities.executeNodeActivity(h.stepRef('draft1')).catch((e) => e);

    expect(error).toBeInstanceOf(ApplicationFailure);
    expect((error as ApplicationFailure).type).toBe(AUTOMATION_FAILURE_TYPES.permanent);
    expect(h.store.latest(RUN_ID, 'draft1')?.error?.message).toBe(
      'The media field needs an image or video from an earlier step.',
    );
    expect(gateway.calls).toHaveLength(0);
  });

  it('fails for good with the API’s sentence when PostGear refuses the post', async () => {
    const gateway = fakeGateway();
    gateway.refuseWith(
      new StepFailure(
        'permanent',
        'An attachment is no longer in the media library. Remove it and save again.',
        'gateway_400',
      ),
    );
    const h = harness(
      single('draft1', 'postgear.createDraft', { channels: ['ch_ig'], text: 'Hi' }),
      {},
      { gateway: gateway.client },
    );

    const error = await h.activities.executeNodeActivity(h.stepRef('draft1')).catch((e) => e);

    expect((error as ApplicationFailure).type).toBe(AUTOMATION_FAILURE_TYPES.permanent);
    expect(h.store.latest(RUN_ID, 'draft1')?.error?.message).toBe(
      'An attachment is no longer in the media library. Remove it and save again.',
    );
  });
});

describe('Add To Queue', () => {
  it('only says what it would queue in a test run, at the next posting time', async () => {
    const gateway = fakeGateway();
    const h = harness(
      single('queue1', 'postgear.addToQueue', {
        channels: ['ch_ig'],
        text: 'Fresh sourdough is out of the oven.',
        when: 'nextSlot',
        timeZone: 'UTC',
      }),
      {},
      { gateway: gateway.client },
    );
    addChannels(h);

    const result = await h.activities.executeNodeActivity(h.stepRef('queue1'));

    // The harness clock is Tue 3 Nov 09:00 UTC, so 09:00 is too close: Wednesday's.
    expect(result.status).toBe('dryRun');
    expect(h.store.latest(RUN_ID, 'queue1')).toMatchObject({
      status: 'DRY_RUN',
      output: {
        dryRun: true,
        wouldSend:
          'Would add to the queue for Instagram (Bloom Bakery) on Wed 4 Nov at 09:00: Fresh sourdough is out of the oven.',
      },
    });
    expect(gateway.calls).toHaveLength(0);
  });

  it('says the chosen time in the step’s zone', async () => {
    const gateway = fakeGateway();
    const h = harness(
      single('queue1', 'postgear.addToQueue', {
        channels: ['ch_ig', 'ch_li'],
        text: 'Hi',
        when: 'at',
        at: '2026-11-05 14:30',
        timeZone: 'Europe/London',
      }),
      {},
      { gateway: gateway.client },
    );
    addChannels(h);

    await h.activities.executeNodeActivity(h.stepRef('queue1'));

    expect(h.store.latest(RUN_ID, 'queue1')?.output).toMatchObject({
      wouldSend:
        'Would add to the queue for Instagram (Bloom Bakery) and LinkedIn (Acme Marketing) on Thu 5 Nov at 14:30: Hi',
    });
    expect(gateway.calls).toHaveLength(0);
  });

  it('sent for real, passes the chosen time as an instant read in the zone', async () => {
    const gateway = fakeGateway({
      '/posts/queue': { postGroup: 'grp_1', scheduledFor: '2026-11-05T14:00:00.000Z' },
    });
    const h = harness(
      single('queue1', 'postgear.addToQueue', {
        channels: ['ch_ig'],
        text: 'Hi',
        when: 'at',
        at: '2026-11-05 09:00',
        timeZone: 'America/New_York',
      }),
      { options: testOptions({ sendForReal: ['queue1'] }) },
      { gateway: gateway.client },
    );

    await h.activities.executeNodeActivity(h.stepRef('queue1'));

    expect(gateway.calls[0]).toMatchObject({
      path: '/posts/queue',
      body: { when: 'at', at: '2026-11-05T14:00:00.000Z', timeZone: 'America/New_York' },
    });
    expect(h.store.latest(RUN_ID, 'queue1')?.status).toBe('SUCCEEDED');
  });

  it('a platform rule failure fails the step for good, with no retry', async () => {
    const gateway = fakeGateway();
    gateway.refuseWith(
      new StepFailure('permanent', 'Bloom Bakery: Add at least one image.', 'gateway_422'),
    );
    const h = harness(
      single('queue1', 'postgear.addToQueue', {
        channels: ['ch_ig'],
        text: 'Hi',
        when: 'nextSlot',
        timeZone: 'UTC',
      }),
      { mode: 'LIVE' },
      { gateway: gateway.client },
    );

    const error = await h.activities.executeNodeActivity(h.stepRef('queue1')).catch((e) => e);

    expect(error).toBeInstanceOf(ApplicationFailure);
    expect((error as ApplicationFailure).nonRetryable).toBe(true);
    expect(h.store.latest(RUN_ID, 'queue1')?.error?.message).toBe(
      'Bloom Bakery: Add at least one image.',
    );
  });
});

describe('Publish To', () => {
  const config = {
    provider: 'linkedin',
    channels: ['ch_li'],
    text: `Big news from the bakery: ${'we are opening a second shop '.repeat(4)}`,
  };

  it('only says what it would publish in a test run', async () => {
    const gateway = fakeGateway();
    const h = harness(single('pub1', 'postgear.publish', config), {}, { gateway: gateway.client });
    addChannels(h);

    const result = await h.activities.executeNodeActivity(h.stepRef('pub1'));

    expect(result.status).toBe('dryRun');
    const output = h.store.latest(RUN_ID, 'pub1')?.output as { wouldSend: string };
    expect(output.wouldSend).toBe(
      `Would publish to LinkedIn (Acme Marketing) now: ${preview(config.text)}`,
    );
    expect(output.wouldSend.endsWith('...')).toBe(true);
    expect(gateway.calls).toHaveLength(0);
  });

  it('creates one post and one publish when the activity is retried after success', async () => {
    const gateway = fakeGateway({
      '/posts/publish': { postGroup: 'grp_1', channels: [], status: 'publishing' },
    });
    const h = harness(
      single('pub1', 'postgear.publish', { ...config, settings: { visibility: 'PUBLIC' } }),
      { mode: 'LIVE' },
      { gateway: gateway.client },
    );
    // The first attempt reaches PostGear, which publishes, but the answer is lost.
    gateway.lose.replies = 1;

    const first = await h.activities.executeNodeActivity(h.stepRef('pub1')).catch((e) => e);
    expect((first as ApplicationFailure).type).toBe(AUTOMATION_FAILURE_TYPES.retryable);

    h.attempt.value = 2;
    const second = await h.activities.executeNodeActivity(h.stepRef('pub1'));
    expect(second.status).toBe('succeeded');

    // Temporal delivers the activity once more after it already succeeded.
    h.attempt.value = 3;
    const third = await h.activities.executeNodeActivity(h.stepRef('pub1'));
    expect(third).toMatchObject({ status: 'succeeded', attempt: 2 });

    expect(gateway.effects).toEqual({ posts: 1, publishSignals: 1 });
    expect(gateway.calls).toHaveLength(2);
    expect(gateway.calls[1].body).toMatchObject({
      provider: 'linkedin',
      settings: { visibility: 'PUBLIC' },
    });
    expect(h.store.latest(RUN_ID, 'pub1')?.output).toEqual({
      postGroup: 'grp_1',
      channels: [],
      status: 'publishing',
    });
  });

  it('fails a live run for good with the API’s words when a channel was disconnected', async () => {
    // The API's posts service refuses a channel that is no longer live with
    // a 400 (Nest's BadRequestException body); the real gateway client reads it.
    const disconnected =
      'One of the selected channels is no longer connected. Remove it and save again.';
    const paths: string[] = [];
    const client = createGatewayClient({
      apiUrl: 'http://api',
      token: 'internal-token',
      log: { info: () => undefined, warn: () => undefined },
      fetch: async (url) => {
        paths.push(url);
        return new Response(
          JSON.stringify({ statusCode: 400, message: disconnected, error: 'Bad Request' }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        );
      },
    });
    const h = harness(
      single('pub1', 'postgear.publish', config),
      { mode: 'LIVE' },
      { gateway: client },
    );

    const error = await h.activities.executeNodeActivity(h.stepRef('pub1')).catch((e) => e);

    expect(error).toBeInstanceOf(ApplicationFailure);
    expect(error).toMatchObject({
      type: AUTOMATION_FAILURE_TYPES.permanent,
      nonRetryable: true,
      message: disconnected,
    });
    expect(paths).toEqual(['http://api/internal/automation/posts/publish']);
    expect(h.store.latest(RUN_ID, 'pub1')).toMatchObject({
      status: 'FAILED',
      error: { message: disconnected, code: 'gateway_400', retryable: false },
    });
  });
});

describe('Get Post', () => {
  it('reads the post even in a test run', async () => {
    const summary = { id: 'pst_1', group: 'grp_1', text: 'Hi', mediaCount: 0 };
    const gateway = fakeGateway({ '/posts/get': summary });
    const h = harness(
      single('get1', 'postgear.getPost', { post: '{{ trigger.inputs.post }}' }),
      { triggerPayload: { inputs: { post: ' grp_1 ' } } },
      { gateway: gateway.client },
    );

    const result = await h.activities.executeNodeActivity(h.stepRef('get1'));

    expect(result.status).toBe('succeeded');
    expect(gateway.calls[0]).toMatchObject({ path: '/posts/get', body: { post: 'grp_1' } });
    expect(h.store.latest(RUN_ID, 'get1')?.output).toEqual(summary);
  });
});
