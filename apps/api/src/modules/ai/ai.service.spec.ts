/**
 * The AI service against a fake engine and a fake ledger: the pre-stream
 * refusals (503, 422, 402) and their order relative to the charge, what is
 * relayed, and the refund on every failure path: whole, image-only, abort.
 */
import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import type { GenerateEvent, GenerateResult } from '@postgear/ai-engine';
import type { ChannelsService, ChannelView } from '../channels/channels.service';
import type { PostsService } from '../posts/posts.service';
import { AI_MESSAGES } from './ai.messages';
import { AiService, type StreamSink, summarizeChannels } from './ai.service';
import type { AiCredits } from './credits/credits.policy';
import {
  type CreditContext,
  type CreditsService,
  PaymentRequiredException,
} from './credits/credits.service';
import type { GenerateInput } from './dto/ai.schema';
import type { AiEngine } from './engine/engine.types';

const RESETS_AT = new Date('2026-11-13T00:00:00Z');

function channel(overrides: Partial<ChannelView>): ChannelView {
  return {
    id: 'ch_li',
    internalId: 'acct',
    rootInternalId: 'acct',
    providerIdentifier: 'linkedin',
    name: 'Acme Marketing',
    profile: 'acme-marketing',
    picture: null,
    disabled: false,
    refreshNeeded: false,
    inBetweenSteps: false,
    tokenExpiration: null,
    postingTimes: [],
    additionalSettings: {},
    createdAt: new Date(),
    health: 'connected',
    providerName: 'LinkedIn',
    color: 0,
    ...overrides,
  };
}

function credits(used: number): AiCredits {
  return {
    allowance: 100,
    used,
    remaining: 100 - used,
    resetsAt: RESETS_AT.toISOString(),
    tier: 'STANDARD',
    low: false,
    costs: { generate_post: 5, generate_image: 10, copilot_message: 1, seo_advice: 3 },
  };
}

const context: CreditContext = {
  workspaceName: 'PostGear Demo Org',
  tier: 'STANDARD',
  allowance: 100,
  cycleStart: new Date('2026-10-13T00:00:00Z'),
  resetsAt: RESETS_AT,
};

const result: GenerateResult = {
  tone: 'personal',
  format: 'one_short',
  category: 'Announcement',
  hook: 'Calendars just got a drag handle.',
  parts: [{ text: 'Calendars just got a drag handle.', imagePrompt: null, image: null }],
  sources: [],
  researched: false,
};

const input: GenerateInput = {
  topic: 'Our new calendar',
  tone: 'personal',
  format: 'one_short',
  withImage: true,
  channelIds: ['ch_li', 'ch_x'],
};

function engineError(kind: string, message: string, retryable = true) {
  return Object.assign(new Error(message), { name: 'AiProviderError', kind, retryable });
}

function recorder(): StreamSink & { events: { type: string; data: unknown }[]; abort(): void } {
  const controller = new AbortController();
  const events: { type: string; data: unknown }[] = [];
  return {
    events,
    signal: controller.signal,
    send: (type, data) => {
      events.push({ type, data });
    },
    abort: () => controller.abort(),
  };
}

describe('AiService', () => {
  let pipeline: { generate: jest.Mock };
  let agent: { run: jest.Mock };
  let engine: AiEngine;
  let ledger: jest.Mocked<
    Pick<CreditsService, 'context' | 'summary' | 'summaryFor' | 'charge' | 'tryCharge' | 'refund'>
  >;
  let channels: { list: jest.Mock; listProviders: jest.Mock };
  let posts: { create: jest.Mock };
  let service: AiService;

  beforeEach(() => {
    pipeline = {
      generate: jest.fn(async (_request, options) => {
        const emit = (event: GenerateEvent) => options.onEvent?.(event);
        emit({
          type: 'stage',
          stage: 'research',
          status: 'skipped',
          detail: 'No research provider',
        });
        emit({ type: 'category', category: 'Announcement' });
        emit({ type: 'hook', hook: result.hook });
        emit({ type: 'content', parts: result.parts });
        emit({ type: 'done', result });
        return result;
      }),
    };
    agent = {
      run: jest.fn(async (_messages, options) => {
        options.onEvent?.({ type: 'token', text: 'You have ' });
        options.onEvent?.({ type: 'token', text: 'two channels.' });
        options.onEvent?.({ type: 'done', message: 'You have two channels.', toolCalls: 1 });
        return { message: 'You have two channels.', toolCalls: 1 };
      }),
    };
    engine = {
      mode: 'simulation',
      modelName: 'simulation',
      researchEnabled: true,
      imagesEnabled: true,
      createPipeline: jest.fn().mockReturnValue(pipeline),
      createCopilot: jest.fn().mockReturnValue(agent),
      createSeoAdvisor: jest.fn().mockReturnValue(null),
      generateImage: jest.fn(),
    };
    ledger = {
      context: jest.fn().mockResolvedValue(context),
      summary: jest.fn().mockResolvedValue(credits(23)),
      summaryFor: jest.fn().mockResolvedValue(credits(38)),
      charge: jest.fn().mockResolvedValue(credits(38)),
      tryCharge: jest.fn(),
      refund: jest.fn().mockResolvedValue(undefined),
    };
    channels = {
      list: jest.fn().mockResolvedValue([
        channel({}),
        channel({
          id: 'ch_x',
          providerIdentifier: 'x',
          providerName: 'X',
          name: 'Acme on X',
          health: 'needs_reconnect',
        }),
      ]),
      listProviders: jest.fn().mockReturnValue([
        { identifier: 'x', rules: { maxLength: 280 } },
        { identifier: 'linkedin', rules: { maxLength: 3000 } },
      ]),
    };
    posts = { create: jest.fn() };
    service = new AiService(
      engine,
      ledger as unknown as CreditsService,
      channels as unknown as ChannelsService,
      posts as unknown as PostsService,
    );
  });

  it('reports the engine’s mode and capabilities', () => {
    expect(service.status()).toEqual({
      configured: true,
      mode: 'simulation',
      model: 'simulation',
      research: true,
      images: true,
    });
  });

  describe('generate', () => {
    it('answers 503 before charging when the engine is unconfigured', async () => {
      (engine.createPipeline as jest.Mock).mockReturnValue(null);

      await expect(service.prepareGenerate('org_1', input)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(ledger.charge).not.toHaveBeenCalled();
    });

    it('answers 422 before charging for a channel that is not this workspace’s', async () => {
      await expect(
        service.prepareGenerate('org_1', { ...input, channelIds: ['ch_li', 'other-org'] }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(ledger.charge).not.toHaveBeenCalled();
    });

    it('lets the 402 through when the cycle is spent', async () => {
      ledger.charge.mockRejectedValue(
        new PaymentRequiredException(AI_MESSAGES.outOfCredits(RESETS_AT)),
      );

      await expect(service.prepareGenerate('org_1', input)).rejects.toBeInstanceOf(
        PaymentRequiredException,
      );
      expect(pipeline.generate).not.toHaveBeenCalled();
    });

    it('charges before generating, targets the platforms at their strictest limit, relays events and ends with credits', async () => {
      const run = await service.prepareGenerate('org_1', input);
      expect(ledger.charge).toHaveBeenCalledWith('org_1', 'generate_post', 15, context);
      expect(pipeline.generate).not.toHaveBeenCalled();

      const stream = recorder();
      await run(stream);

      expect(pipeline.generate).toHaveBeenCalledWith(
        {
          topic: 'Our new calendar',
          tone: 'personal',
          format: 'one_short',
          withImage: true,
          maxCharacters: 280,
          platforms: ['linkedin', 'x'],
          workspaceName: 'PostGear Demo Org',
        },
        expect.objectContaining({ signal: stream.signal }),
      );
      expect(stream.events.map((event) => event.type)).toEqual([
        'stage',
        'category',
        'hook',
        'content',
        'done',
      ]);
      expect(stream.events[0].data).toEqual({
        type: 'stage',
        stage: 'research',
        status: 'skipped',
        detail: 'No research provider',
      });
      expect(stream.events[4].data).toEqual({ type: 'done', result, credits: credits(38) });
      expect(ledger.refund).not.toHaveBeenCalled();
    });

    it('leaves the limit null when no selected platform declares one', async () => {
      channels.listProviders.mockReturnValue([]);

      await (await service.prepareGenerate('org_1', input))(recorder());

      expect(pipeline.generate.mock.calls[0][0].maxCharacters).toBeNull();
    });

    it('refunds the whole charge and sends a safe error event when the pipeline fails', async () => {
      pipeline.generate.mockRejectedValue(
        engineError('rate_limited', '429 from api.openai.com with key sk-live-1 in the body'),
      );
      ledger.summaryFor.mockResolvedValue(credits(23));

      const stream = recorder();
      await (await service.prepareGenerate('org_1', input))(stream);

      expect(ledger.refund).toHaveBeenCalledTimes(1);
      expect(ledger.refund).toHaveBeenCalledWith('org_1', 'generate_post', 15);
      expect(stream.events).toEqual([
        {
          type: 'error',
          data: {
            type: 'error',
            kind: 'rate_limited',
            message: AI_MESSAGES.RATE_LIMITED,
            retryable: true,
            credits: credits(23),
          },
        },
      ]);
      expect(JSON.stringify(stream.events)).not.toContain('sk-live');
    });

    it('refunds only the image share when the image stage fails and the copy is delivered', async () => {
      pipeline.generate.mockImplementation(async (_request, options) => {
        options.onEvent({ type: 'content', parts: result.parts });
        options.onEvent({
          type: 'stage',
          stage: 'image',
          status: 'failed',
          detail: 'DALL-E refused',
        });
        return result;
      });

      const stream = recorder();
      await (await service.prepareGenerate('org_1', input))(stream);

      expect(ledger.refund).toHaveBeenCalledTimes(1);
      expect(ledger.refund).toHaveBeenCalledWith('org_1', 'generate_image', 10);
      expect(stream.events.map((event) => event.type)).toEqual(['content', 'stage', 'done']);
    });

    it('does not refund an image that was never charged for', async () => {
      pipeline.generate.mockImplementation(async (_request, options) => {
        options.onEvent({ type: 'stage', stage: 'image', status: 'failed' });
        return result;
      });

      await (await service.prepareGenerate('org_1', { ...input, withImage: false }))(recorder());

      expect(ledger.refund).not.toHaveBeenCalled();
    });

    it('stops the engine on disconnect, refunds, and reports a quiet abort', async () => {
      pipeline.generate.mockImplementation(
        (_request, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted', 'AbortError')),
            );
          }),
      );

      const stream = recorder();
      const running = (await service.prepareGenerate('org_1', input))(stream);
      stream.abort();
      await running;

      expect(ledger.refund).toHaveBeenCalledWith('org_1', 'generate_post', 15);
      expect(stream.events[0].data).toMatchObject({
        type: 'error',
        kind: 'aborted',
        message: AI_MESSAGES.ABORTED,
        retryable: false,
      });
    });

    it('classifies an unknown failure as unexpected without quoting it', async () => {
      pipeline.generate.mockRejectedValue(new TypeError('Cannot read properties of undefined'));

      const stream = recorder();
      await (await service.prepareGenerate('org_1', input))(stream);

      expect(stream.events[0].data).toMatchObject({
        kind: 'unexpected',
        message: AI_MESSAGES.UNEXPECTED,
        retryable: true,
      });
    });

    it('still ends the stream with the last known credits when the ledger cannot be re-read', async () => {
      ledger.summaryFor.mockRejectedValue(new Error('db down'));

      const stream = recorder();
      await (await service.prepareGenerate('org_1', input))(stream);

      expect(stream.events[stream.events.length - 1].data).toMatchObject({
        type: 'done',
        credits: credits(38),
      });
    });
  });

  describe('copilot chat', () => {
    const chat = { messages: [{ role: 'user' as const, content: 'What channels do I have?' }] };

    it('answers 503 before charging when unconfigured', async () => {
      engine = { ...engine, mode: 'unconfigured' };
      service = new AiService(
        engine,
        ledger as unknown as CreditsService,
        channels as unknown as ChannelsService,
        posts as unknown as PostsService,
      );

      await expect(service.prepareChat('org_1', chat)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(ledger.charge).not.toHaveBeenCalled();
    });

    it('charges one credit, hands the agent the tools and the workspace, relays and ends with credits', async () => {
      const run = await service.prepareChat('org_1', chat);

      expect(ledger.charge).toHaveBeenCalledWith('org_1', 'copilot_message', undefined, context);
      const [scope, tools, agentContext] = (engine.createCopilot as jest.Mock).mock.calls[0];
      expect(scope).toEqual({ orgId: 'org_1' });
      expect(tools.map((tool: { name: string }) => tool.name)).toEqual([
        'list_channels',
        'generate_post',
        'draft_post',
        'generate_image',
      ]);
      expect(agentContext).toEqual({
        workspaceName: 'PostGear Demo Org',
        today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        channelSummary: 'Acme Marketing (LinkedIn, connected)\nAcme on X (X, needs reconnecting)',
      });

      const stream = recorder();
      await run(stream);

      expect(agent.run).toHaveBeenCalledWith(
        chat.messages,
        expect.objectContaining({ signal: stream.signal }),
      );
      expect(stream.events).toEqual([
        { type: 'token', data: { type: 'token', text: 'You have ' } },
        { type: 'token', data: { type: 'token', text: 'two channels.' } },
        {
          type: 'done',
          data: {
            type: 'done',
            message: 'You have two channels.',
            toolCalls: 1,
            credits: credits(38),
          },
        },
      ]);
      expect(ledger.refund).not.toHaveBeenCalled();
    });

    it('refunds the message when the agent fails before producing anything', async () => {
      agent.run.mockRejectedValue(engineError('unavailable', 'ECONNRESET'));

      const stream = recorder();
      await (await service.prepareChat('org_1', chat))(stream);

      expect(ledger.refund).toHaveBeenCalledWith('org_1', 'copilot_message', 1);
      expect(stream.events[0].data).toMatchObject({
        type: 'error',
        kind: 'unavailable',
        message: AI_MESSAGES.UNAVAILABLE,
      });
    });

    it('keeps the charge when a reply was cut off after it began', async () => {
      agent.run.mockImplementation(async (_messages, options) => {
        options.onEvent({ type: 'token', text: 'You ' });
        throw engineError('timeout', 'deadline', true);
      });

      const stream = recorder();
      await (await service.prepareChat('org_1', chat))(stream);

      expect(ledger.refund).not.toHaveBeenCalled();
      expect(stream.events.map((event) => event.type)).toEqual(['token', 'error']);
    });
  });
});

describe('summarizeChannels', () => {
  it('says so when nothing is connected', () => {
    expect(summarizeChannels([])).toBe('No channels are connected yet.');
  });
});
