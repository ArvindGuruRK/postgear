/**
 * The AI step executors (Module 11) on the memory store, with the real
 * gateway client in front of a fake API: what each step sends, that test
 * runs really run them (never dry), that the credits join the run's total,
 * and that out of credits is the permanent, run-stopping failure with the
 * exact sentence, and the live alert says when credits reset.
 */
import type { NodeType } from '@postgear/automation';
import {
  AUTOMATION_FAILURE_TYPES,
  AUTOMATION_NOTIFICATION_TYPES,
  RUN_STOPPING_AUTOMATION_FAILURES,
} from '@postgear/scheduling';
import { ApplicationFailure } from '@temporalio/common';
import { classifyStepFailure } from '../../workflows/automation-run.options';
import { creditsResetSentence } from '../alerts';
import { createGatewayClient, GATEWAY_AI_TIMEOUT_MS, type GatewayClient } from '../gateway-client';
import { AUTOMATION_ID, graphOf, harness, line, ORG, RUN_ID, step } from '../testing';
import { AI_EXECUTORS, AI_PROMPT_MAX, generateTextExecutor } from './ai';
import type { ExecContext } from './types';

const OUT_OF_CREDITS = 'Not enough AI credits for this step.';
const silent = { info: () => undefined, warn: () => undefined };

/** A fake API behind the real gateway client: records each call, answers `reply`. */
function api(
  reply: (path: string, body: Record<string, unknown>) => { status: number; body: unknown },
) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const client = createGatewayClient({
    apiUrl: 'http://api',
    token: 'internal-token',
    log: silent,
    fetch: async (url, init) => {
      const path = url.replace('http://api/internal/automation', '');
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push({ path, body });
      const answer = reply(path, body);
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  return { client, calls };
}

const outOfCredits = () => ({
  status: 422,
  body: {
    message: OUT_OF_CREDITS,
    code: 'out_of_credits',
    details: { resetsAt: '2026-12-01T00:00:00.000Z' },
  },
});

/** Manual, then `write` (Generate Text, On Error as given), then `after`; `alert` hangs off its error port. */
function aiGraph(
  onError: 'continue' | 'branch' = 'continue',
  config: Record<string, unknown> = {},
) {
  return graphOf(
    [
      step('trigger', 'trigger.manual'),
      step('write', 'ai.generateText', {
        name: 'Write Post',
        onError: { mode: onError },
        config: { prompt: 'Weekly bread news', platform: 'linkedin', research: true, ...config },
      }),
      step('after', 'notify.inApp', { config: { title: 'Done', message: 'Done' } }),
      step('alert', 'notify.inApp', { config: { title: 'Failed', message: 'Failed' } }),
    ],
    [line('trigger', 'write'), line('write', 'after'), line('write', 'alert', 'error')],
  );
}

describe('AI executors', () => {
  it('cover the four ready AI steps', () => {
    expect(AI_EXECUTORS.map((executor) => executor.type).sort()).toEqual(
      [
        'ai.generateHashtags',
        'ai.generateImage',
        'ai.generateText',
        'ai.rewriteInBrandVoice',
      ].sort(),
    );
  });

  it.each<[NodeType, string, Record<string, unknown>, Record<string, unknown>]>([
    [
      'ai.generateText',
      '/ai/text',
      {
        prompt: 'Weekly bread news',
        platform: 'x',
        voice: 'personal',
        format: 'thread_short',
        research: true,
        withImage: true,
      },
      {
        prompt: 'Weekly bread news',
        platform: 'x',
        voice: 'personal',
        format: 'thread_short',
        research: true,
        withImage: true,
      },
    ],
    [
      'ai.generateImage',
      '/ai/image',
      { prompt: 'A loaf', style: 'flat' },
      { prompt: 'A loaf', style: 'flat' },
    ],
    [
      'ai.generateHashtags',
      '/ai/hashtags',
      { text: 'Fresh bread', platform: 'instagram', count: 7 },
      { text: 'Fresh bread', platform: 'instagram', count: 7 },
    ],
    [
      'ai.rewriteInBrandVoice',
      '/ai/rewrite',
      { text: 'I bake.', platform: 'generic', voice: 'company' },
      { text: 'I bake.', platform: 'generic', voice: 'company' },
    ],
  ])(
    '%s calls %s with the binding and its settings, on the long timeout',
    async (type, path, config, sent) => {
      const call = jest.fn(async () => ({ output: { ok: true }, credits: 2 }));
      const gateway: GatewayClient = { call } as unknown as GatewayClient;
      const h = harness(
        graphOf(
          [step('trigger', 'trigger.manual'), step('aiStep', type, { config })],
          [line('trigger', 'aiStep')],
        ),
        {},
        { gateway },
      );

      const result = await h.activities.executeNodeActivity(h.stepRef('aiStep'));

      expect(result).toMatchObject({ status: 'succeeded', ports: ['out'] });
      expect(call).toHaveBeenCalledWith(
        path,
        { runId: RUN_ID, nodeKey: 'aiStep', organizationId: ORG, ...sent },
        expect.objectContaining({ timeoutMs: GATEWAY_AI_TIMEOUT_MS }),
      );
      expect(h.store.latest(RUN_ID, 'aiStep')).toMatchObject({
        status: 'SUCCEEDED',
        output: { ok: true },
      });
      expect(h.store.creditsUsed.get(RUN_ID)).toBe(2);
    },
  );

  it('runs for real in a test run (never a dry run) and adds its credits to the run', async () => {
    const { client, calls } = api(() => ({
      status: 200,
      body: { output: { text: 'Fresh bread.', parts: ['Fresh bread.'] }, credits: 15 },
    }));
    const h = harness(aiGraph('continue', { withImage: true }), {}, { gateway: client });

    await h.activities.executeNodeActivity(h.stepRef('write'));

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/ai/text');
    expect(h.store.latest(RUN_ID, 'write')).toMatchObject({
      status: 'SUCCEEDED',
      output: { text: 'Fresh bread.', parts: ['Fresh bread.'] },
    });
    expect(h.store.creditsUsed.get(RUN_ID)).toBe(15);
  });

  it('clips long filled-in text to what the gateway accepts, and refuses empty text', async () => {
    const call = jest.fn(async () => ({ output: {}, credits: 5 }));
    const ctx = (config: Record<string, unknown>) =>
      ({
        run: { id: RUN_ID, organizationId: ORG },
        node: { key: 'write' },
        config,
        signal: new AbortController().signal,
        heartbeat: () => undefined,
        deps: { gateway: { call } },
      }) as unknown as ExecContext;

    await generateTextExecutor.run(ctx({ prompt: 'x'.repeat(AI_PROMPT_MAX + 50) }));
    const body = (call.mock.calls[0] as unknown[])[1] as { prompt: string };
    expect(body.prompt).toHaveLength(AI_PROMPT_MAX);

    await expect(generateTextExecutor.run(ctx({ prompt: '  ' }))).rejects.toMatchObject({
      kind: 'permanent',
      message: 'Write what the post should be about.',
    });
  });

  it('fails permanently with the exact sentence when credits run out, stopping the run whatever On Error says', async () => {
    const { client } = api(outOfCredits);
    const h = harness(aiGraph('continue'), {}, { gateway: client });

    const error = await h.activities
      .executeNodeActivity(h.stepRef('write'))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApplicationFailure);
    const failure = error as ApplicationFailure;
    expect(failure.type).toBe(AUTOMATION_FAILURE_TYPES.outOfCredits);
    expect(failure.nonRetryable).toBe(true);
    expect(failure.message).toBe(OUT_OF_CREDITS);
    expect(RUN_STOPPING_AUTOMATION_FAILURES).toContain(failure.type);
    // What the workflow reads after the last attempt: the run stops, so
    // neither On Error continue nor an error branch applies.
    expect(classifyStepFailure(failure)).toEqual({
      failureType: AUTOMATION_FAILURE_TYPES.outOfCredits,
      message: OUT_OF_CREDITS,
      timedOut: false,
      stopsRun: true,
    });

    expect(h.store.latest(RUN_ID, 'write')).toMatchObject({
      status: 'FAILED',
      error: {
        message: OUT_OF_CREDITS,
        code: 'out_of_credits',
        retryable: false,
        details: { resetsAt: '2026-12-01T00:00:00.000Z' },
      },
    });
    expect(h.store.creditsUsed.get(RUN_ID)).toBeUndefined();
  });

  it('tells the workspace when credits reset after a live run stops for them', async () => {
    const { client } = api(outOfCredits);
    const h = harness(aiGraph('continue'), { mode: 'LIVE' }, { gateway: client });

    await h.activities.executeNodeActivity(h.stepRef('write')).catch(() => undefined);
    await h.activities.finishRun({ ...h.ref, outcome: 'failed', stepCount: 2 });

    const alerts = h.store.notifications.filter(
      (n) => n.type === AUTOMATION_NOTIFICATION_TYPES.failed,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].content).toBe(
      `Publishing Report failed at Write Post: ${OUT_OF_CREDITS} Credits reset on 1 December.`,
    );
    expect(alerts[0].link).toContain(AUTOMATION_ID);
  });
});

describe('creditsResetSentence', () => {
  it('only speaks for out of credits with a readable date', () => {
    const error = (code: string, details?: unknown) => ({
      message: 'm',
      code,
      retryable: false,
      details,
    });
    expect(
      creditsResetSentence(error('out_of_credits', { resetsAt: '2027-01-31T00:00:00.000Z' })),
    ).toBe('Credits reset on 31 January.');
    expect(creditsResetSentence(error('out_of_credits', { resetsAt: 'soon' }))).toBeNull();
    expect(creditsResetSentence(error('out_of_credits'))).toBeNull();
    expect(
      creditsResetSentence(error('permanent', { resetsAt: '2027-01-31T00:00:00.000Z' })),
    ).toBeNull();
    expect(creditsResetSentence(null)).toBeNull();
  });
});
