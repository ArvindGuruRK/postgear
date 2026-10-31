/**
 * The workflow AI steps against a fake engine, a ledger that keeps its rows
 * (so "net zero" is a sum, not a mock count) and an effect ledger that
 * behaves like `runEffect`: charge before the model, refund on failure
 * (only the image's share when only the image failed), out of credits as
 * the run-stopping 422, and a replay that returns the stored answer and
 * charges once.
 */
import { HttpException } from '@nestjs/common';
import {
  AiProviderError,
  type GenerateEvent,
  type GenerateRequest,
  type GenerateResult,
  type SnippetWriter,
} from '@postgear/ai-engine';
import { AI_MESSAGES } from '../../ai/ai.messages';
import { type AiCredits, buildCredits } from '../../ai/credits/credits.policy';
import type { CreditContext, CreditsService } from '../../ai/credits/credits.service';
import type { AiEngine } from '../../ai/engine/engine.types';
import type { ChannelsService } from '../../channels/channels.service';
import {
  AI_STEP_MESSAGES,
  AutomationAiService,
  IMAGE_STYLE_PROMPTS,
} from './automation-ai.service';
import type { EffectContext, GatewayBindingService } from './gateway-binding.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';
const RESETS_AT = new Date('2026-12-01T00:00:00Z');

const context: CreditContext = {
  workspaceName: 'Bloom Bakery',
  tier: 'STANDARD',
  allowance: 100,
  cycleStart: new Date('2026-11-01T00:00:00Z'),
  resetsAt: RESETS_AT,
};

const binding = (nodeKey: string) => ({ runId: RUN, nodeKey, organizationId: ORG });

const textInput = (overrides: Record<string, unknown> = {}) => ({
  ...binding('write'),
  prompt: 'Our new sourdough starter',
  platform: 'linkedin' as const,
  voice: 'company' as const,
  format: 'one_short' as const,
  research: false,
  withImage: false,
  ...overrides,
});

const result: GenerateResult = {
  tone: 'company',
  format: 'thread_short',
  category: 'Announcement',
  hook: 'Still warm at 7 am.',
  parts: [
    { text: 'Still warm at 7 am.\nFresh sourdough.', imagePrompt: 'A loaf of bread', image: null },
    { text: 'Come by before nine.', imagePrompt: null, image: null },
  ],
  sources: [{ title: 'Bread report', url: 'https://research.example.com/bread', snippet: 's' }],
  researched: true,
};

/** A ledger that keeps rows, like `credits.repository.ts`. */
function ledger(allowance = 100) {
  const rows: { type: string; credits: number }[] = [];
  const used = () => rows.reduce((sum, row) => sum + row.credits, 0);
  const summary = (): AiCredits =>
    buildCredits({ tier: 'STANDARD', used: used(), resetsAt: RESETS_AT });
  const fake = {
    rows,
    used,
    context: jest.fn(async () => ({ ...context, allowance })),
    tryCharge: jest.fn(async (_org: string, type: string, amount: number) => {
      if (used() + amount > allowance) return { ok: false as const, credits: summary() };
      rows.push({ type, credits: amount });
      return { ok: true as const, credits: summary() };
    }),
    refund: jest.fn(async (_org: string, type: string, amount: number) => {
      if (amount > 0) rows.push({ type: `refund:${type}`, credits: -amount });
    }),
  };
  return fake;
}

/** `runEffect` as the effect table behaves: DONE replays, FAILED and stale run again. */
function effects() {
  const rows = new Map<string, { status: string; result: unknown }>();
  const fake = {
    rows,
    bind: jest.fn(async () => ({})),
    runEffect: jest.fn(
      async (
        bound: { runId: string; nodeKey: string },
        _kind: string,
        work: (effect: EffectContext) => Promise<unknown>,
      ) => {
        const key = `${bound.runId}:${bound.nodeKey}`;
        const existing = rows.get(key);
        if (existing?.status === 'DONE') return existing.result;
        const row = { status: 'PENDING', result: existing?.result ?? null };
        rows.set(key, row);
        try {
          const answer = await work({
            previous: row.result as EffectContext['previous'],
            save: async (progress) => {
              row.result = progress;
            },
          });
          rows.set(key, { status: 'DONE', result: answer });
          return answer;
        } catch (error) {
          row.status = 'FAILED';
          throw error;
        }
      },
    ),
  };
  return fake;
}

type PipelineScript = {
  imageFails?: boolean;
  throws?: unknown;
};

function pipelineWith(script: PipelineScript = {}) {
  return {
    generate: jest.fn(
      async (request: GenerateRequest, options?: { onEvent?: (event: GenerateEvent) => void }) => {
        const emit = (event: GenerateEvent) => options?.onEvent?.(event);
        emit({ type: 'stage', stage: 'research', status: 'skipped' });
        if (script.throws) throw script.throws;
        let first = result.parts[0];
        if (request.withImage) {
          if (script.imageFails) {
            emit({ type: 'stage', stage: 'image', status: 'failed', detail: 'boom' });
          } else {
            first = {
              ...first,
              image: { mediaId: 'media_1', url: 'https://media.local/1.png', thumbnailUrl: null },
            };
          }
        }
        return { ...result, parts: [first, ...result.parts.slice(1)] };
      },
    ),
  };
}

function setup(
  options: { allowance?: number; script?: PipelineScript; snippets?: Partial<SnippetWriter> } = {},
) {
  const credits = ledger(options.allowance);
  const gateway = effects();
  const pipeline = pipelineWith(options.script);
  const writer: SnippetWriter = {
    hashtags: jest.fn(async () => ({
      hashtags: ['#bread', '#bakery', '#sourdough'],
      line: '#bread #bakery #sourdough',
      shortened: false,
    })),
    rewrite: jest.fn(async () => ({ text: 'We bake every morning.', shortened: false })),
    ...options.snippets,
  };
  const engine = {
    mode: 'simulation',
    modelName: 'simulation',
    researchEnabled: true,
    imagesEnabled: true,
    createPipeline: jest.fn(() => pipeline),
    createCopilot: jest.fn(),
    createSeoAdvisor: jest.fn(),
    createSnippetWriter: jest.fn(() => writer),
    generateImage: jest.fn(async (_scope: unknown, prompt: string) => ({
      mediaId: 'media_9',
      url: 'https://media.local/9.png',
      thumbnailUrl: null,
      revisedPrompt: `${prompt} (revised)`,
    })),
  } as unknown as AiEngine & {
    createPipeline: jest.Mock;
    createSnippetWriter: jest.Mock;
    generateImage: jest.Mock;
  };
  const channels = {
    listProviders: () => [
      { identifier: 'linkedin', rules: { maxLength: 3000 } },
      { identifier: 'linkedin-page', rules: { maxLength: 2800 } },
      { identifier: 'x', rules: { maxLength: 280 } },
    ],
  };
  const service = new AutomationAiService(
    engine,
    credits as unknown as CreditsService,
    channels as unknown as ChannelsService,
    gateway as unknown as GatewayBindingService,
  );
  return { service, credits, gateway, pipeline, engine, writer };
}

async function httpError(
  promise: Promise<unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return { status: error.getStatus(), body: error.getResponse() as Record<string, unknown> };
    }
    throw error;
  }
  throw new Error('Expected the call to fail.');
}

describe('AutomationAiService', () => {
  describe('Generate Text', () => {
    it('binds the step, charges before the model, and builds the request like the AI page', async () => {
      const { service, credits, gateway, pipeline, engine } = setup();

      const answer = await service.text(textInput({ research: true }));

      expect(gateway.bind).toHaveBeenCalledWith(binding('write'), ['ai.generateText']);
      expect(gateway.runEffect).toHaveBeenCalledWith(
        binding('write'),
        'ai.text',
        expect.any(Function),
      );
      expect(engine.createPipeline).toHaveBeenCalledWith({ orgId: ORG }, { research: true });
      expect(credits.tryCharge).toHaveBeenCalledWith(
        ORG,
        'generate_post',
        5,
        expect.objectContaining({ workspaceName: 'Bloom Bakery' }),
      );
      expect(credits.tryCharge.mock.invocationCallOrder[0]).toBeLessThan(
        pipeline.generate.mock.invocationCallOrder[0],
      );
      expect(pipeline.generate.mock.calls[0][0]).toEqual({
        topic: 'Our new sourdough starter',
        tone: 'company',
        format: 'one_short',
        withImage: false,
        // LinkedIn covers profiles and Pages: the strictest of the two.
        maxCharacters: 2800,
        platforms: ['linkedin', 'linkedin-page'],
        workspaceName: 'Bloom Bakery',
      });
      expect(answer).toEqual({
        output: {
          text: 'Still warm at 7 am.\nFresh sourdough.\n\nCome by before nine.',
          parts: ['Still warm at 7 am.\nFresh sourdough.', 'Come by before nine.'],
          hook: 'Still warm at 7 am.',
          category: 'Announcement',
          sources: [{ title: 'Bread report', url: 'https://research.example.com/bread' }],
          researched: true,
        },
        credits: 5,
      });
      expect(credits.used()).toBe(5);
    });

    it('writes for any platform without a length limit', async () => {
      const { service, pipeline } = setup();
      await service.text(textInput({ platform: 'generic' }));
      expect(pipeline.generate.mock.calls[0][0]).toMatchObject({
        maxCharacters: null,
        platforms: [],
      });
    });

    it('charges 15 with an image and passes the image on as Media', async () => {
      const { service, credits } = setup();

      const answer = await service.text(textInput({ withImage: true }));

      expect(credits.tryCharge).toHaveBeenCalledWith(ORG, 'generate_post', 15, expect.anything());
      expect(answer.credits).toBe(15);
      expect(answer.output.image).toEqual({
        kind: 'media',
        id: 'media_1',
        url: 'https://media.local/1.png',
        type: 'image',
        alt: 'A loaf of bread',
      });
      expect(credits.used()).toBe(15);
    });

    it('refunds only the image share when the text succeeds and the image fails', async () => {
      const { service, credits } = setup({ script: { imageFails: true } });

      const answer = await service.text(textInput({ withImage: true }));

      expect(answer.credits).toBe(5);
      expect(answer.output.image).toBeUndefined();
      expect(credits.refund).toHaveBeenCalledTimes(1);
      expect(credits.refund).toHaveBeenCalledWith(ORG, 'generate_image', 10);
      expect(credits.used()).toBe(5);
    });

    it('refunds everything when the model fails, leaving the ledger net zero', async () => {
      const { service, credits, gateway } = setup({
        script: { throws: new AiProviderError('unavailable', 'provider said no', true) },
      });

      const failure = await httpError(service.text(textInput({ withImage: true })));

      expect(failure.status).toBe(503);
      expect(failure.body).toEqual({ message: AI_MESSAGES.UNAVAILABLE, code: 'ai_unavailable' });
      expect(credits.rows).toEqual([
        { type: 'generate_post', credits: 15 },
        { type: 'refund:generate_post', credits: -15 },
      ]);
      expect(credits.used()).toBe(0);
      expect(gateway.rows.get(`${RUN}:write`)?.status).toBe('FAILED');
    });

    it('fails permanently, in the AI module’s words, when a retry cannot help', async () => {
      const { service, credits } = setup({
        script: { throws: new AiProviderError('content_policy', 'raw provider text', false) },
      });

      const failure = await httpError(service.text(textInput()));

      expect(failure.status).toBe(422);
      expect(failure.body).toEqual({
        message: AI_MESSAGES.CONTENT_POLICY,
        code: 'ai_content_policy',
      });
      expect(credits.used()).toBe(0);
    });

    it('stops with the out of credits sentence and the reset date, without calling the model', async () => {
      const { service, credits, pipeline } = setup({ allowance: 4 });

      const failure = await httpError(service.text(textInput()));

      expect(failure.status).toBe(422);
      expect(failure.body).toEqual({
        message: 'Not enough AI credits for this step.',
        code: 'out_of_credits',
        details: { resetsAt: RESETS_AT.toISOString() },
      });
      expect(AI_STEP_MESSAGES.OUT_OF_CREDITS).toBe('Not enough AI credits for this step.');
      expect(pipeline.generate).not.toHaveBeenCalled();
      expect(credits.rows).toEqual([]);
    });

    it('returns the stored answer on a replay and charges once', async () => {
      const { service, credits, pipeline } = setup();

      const first = await service.text(textInput());
      const again = await service.text(textInput());

      expect(again).toEqual(first);
      expect(credits.tryCharge).toHaveBeenCalledTimes(1);
      expect(pipeline.generate).toHaveBeenCalledTimes(1);
      expect(credits.used()).toBe(5);
    });

    it('charges again after a failed attempt, which was refunded', async () => {
      const { service, credits, pipeline } = setup();
      pipeline.generate.mockRejectedValueOnce(new AiProviderError('timeout', 't', true));

      await httpError(service.text(textInput()));
      const answer = await service.text(textInput());

      expect(answer.credits).toBe(5);
      expect(credits.tryCharge).toHaveBeenCalledTimes(2);
      expect(credits.used()).toBe(5);
    });

    it('refunds what an attempt that died mid-way charged before charging again', async () => {
      const { service, credits, gateway } = setup();
      // An attempt that charged and then lost its process: PENDING gone stale.
      gateway.rows.set(`${RUN}:write`, {
        status: 'FAILED',
        result: { type: 'generate_post', charged: 15, refunded: 0 },
      });
      credits.rows.push({ type: 'generate_post', credits: 15 });

      const answer = await service.text(textInput());

      expect(credits.refund).toHaveBeenCalledWith(ORG, 'generate_post', 15);
      expect(answer.credits).toBe(5);
      expect(credits.used()).toBe(5);
    });

    it('charges nothing when the step is not bound to a live run', async () => {
      const { service, credits, gateway } = setup();
      gateway.bind.mockRejectedValueOnce(
        new HttpException('This step could not be authorised.', 404),
      );

      expect((await httpError(service.text(textInput()))).status).toBe(404);
      expect(credits.tryCharge).not.toHaveBeenCalled();
    });

    it('refuses plainly, before charging, when AI is not set up', async () => {
      const { service, credits, engine } = setup();
      engine.createPipeline.mockReturnValueOnce(null);

      const failure = await httpError(service.text(textInput()));

      expect(failure.status).toBe(422);
      expect(failure.body).toMatchObject({ code: 'ai_not_configured' });
      expect(credits.tryCharge).not.toHaveBeenCalled();
    });
  });

  describe('Generate Image', () => {
    const imageInput = (overrides: Record<string, unknown> = {}) => ({
      ...binding('picture'),
      prompt: 'A loaf of sourdough',
      ...overrides,
    });

    it('charges 10, puts the style into the prompt and answers with a Media item', async () => {
      const { service, credits, engine, gateway } = setup();

      const answer = await service.image(imageInput({ style: 'illustration' }));

      expect(gateway.bind).toHaveBeenCalledWith(binding('picture'), ['ai.generateImage']);
      expect(credits.tryCharge).toHaveBeenCalledWith(ORG, 'generate_image', 10, expect.anything());
      const prompt = `${IMAGE_STYLE_PROMPTS.illustration} A loaf of sourdough`;
      expect(engine.generateImage).toHaveBeenCalledWith({ orgId: ORG }, prompt, expect.anything());
      expect(answer).toEqual({
        output: {
          image: {
            kind: 'media',
            id: 'media_9',
            url: 'https://media.local/9.png',
            type: 'image',
            alt: `${prompt} (revised)`,
          },
          url: 'https://media.local/9.png',
          alt: `${prompt} (revised)`,
        },
        credits: 10,
      });
    });

    it('refunds when the image fails', async () => {
      const { service, credits, engine } = setup();
      engine.generateImage.mockRejectedValueOnce(new AiProviderError('bad_output', 'x', false));

      expect((await httpError(service.image(imageInput()))).status).toBe(422);
      expect(credits.used()).toBe(0);
    });

    it('refuses before charging when images are off', async () => {
      const { service, credits, engine } = setup();
      (engine as { imagesEnabled: boolean }).imagesEnabled = false;

      const failure = await httpError(service.image(imageInput()));

      expect(failure.body).toEqual({
        message: AI_STEP_MESSAGES.IMAGES_OFF,
        code: 'ai_not_configured',
      });
      expect(credits.tryCharge).not.toHaveBeenCalled();
    });
  });

  describe('Generate Hashtags and Rewrite In Brand Voice', () => {
    it('charges 2 snippet credits for hashtags and holds them to the platform', async () => {
      const { service, credits, writer, gateway } = setup();

      const answer = await service.hashtags({
        ...binding('tags'),
        text: 'Fresh bread',
        platform: 'x',
        count: 3,
      });

      expect(gateway.bind).toHaveBeenCalledWith(binding('tags'), ['ai.generateHashtags']);
      expect(credits.tryCharge).toHaveBeenCalledWith(ORG, 'generate_snippet', 2, expect.anything());
      expect(writer.hashtags).toHaveBeenCalledWith(
        { text: 'Fresh bread', platform: 'x', count: 3, maxCharacters: 280 },
        expect.anything(),
      );
      expect(answer).toEqual({
        output: {
          hashtags: ['#bread', '#bakery', '#sourdough'],
          line: '#bread #bakery #sourdough',
          shortened: false,
        },
        credits: 2,
      });
    });

    it('rewrites in the voice with the workspace as the brand', async () => {
      const { service, credits, writer } = setup();

      const answer = await service.rewrite({
        ...binding('voice'),
        text: 'I bake.',
        platform: 'generic',
        voice: 'company',
      });

      expect(writer.rewrite).toHaveBeenCalledWith(
        {
          text: 'I bake.',
          platform: 'generic',
          voice: 'company',
          maxCharacters: null,
          workspaceName: 'Bloom Bakery',
        },
        expect.anything(),
      );
      expect(answer).toEqual({
        output: { text: 'We bake every morning.', shortened: false },
        credits: 2,
      });
      expect(credits.used()).toBe(2);
    });

    it('refunds a failed rewrite and stops when out of credits', async () => {
      const failing = setup({
        snippets: {
          rewrite: jest.fn().mockRejectedValue(new AiProviderError('rate_limited', 'r', true)),
        },
      });
      const failure = await httpError(
        failing.service.rewrite({
          ...binding('voice'),
          text: 'I bake.',
          platform: 'x',
          voice: 'company',
        }),
      );
      expect(failure.status).toBe(503);
      expect(failing.credits.used()).toBe(0);

      const broke = setup({ allowance: 1 });
      const refused = await httpError(
        broke.service.hashtags({ ...binding('tags'), text: 'Bread', platform: 'x', count: 3 }),
      );
      expect(refused.body).toMatchObject({
        code: 'out_of_credits',
        message: AI_STEP_MESSAGES.OUT_OF_CREDITS,
      });
      expect(broke.writer.hashtags).not.toHaveBeenCalled();
    });
  });
});
