/**
 * The workflow AI steps (Sprint 10, Module 11), behind the internal step
 * gateway: Generate Text, Generate Image, Generate Hashtags and Rewrite In
 * Brand Voice.
 *
 * Nothing here is a second AI implementation. Each route builds its request
 * the way `AiService.prepareGenerate` does and runs the same engine
 * (`AI_ENGINE`), pays through the same ledger (`CreditsService.tryCharge`
 * and `refund`), and saves images through the same media sink. What it adds
 * is the gateway's two guards: the call is bound to a live run's step
 * (`bind`), and the effect ledger (`runEffect`) makes a retried call return
 * the stored answer instead of generating, and charging, twice.
 *
 * ## Credits
 *
 * Charged before the model runs. Out of credits is a 422 with the code
 * `out_of_credits`, which the worker turns into a run-stopping failure; the
 * cycle's reset date rides in `details.resetsAt` for the failed-run alert.
 * A failure refunds what was charged; Generate Text with an image refunds
 * only the image's share when only the image failed, like `runGenerate`.
 * The answer's `credits` is what stayed charged.
 *
 * Progress (charged, refunded) is saved on the effect row, so an attempt
 * that died mid-way (the process restarted) is refunded by the attempt that
 * takes it over, before that one charges again.
 */
import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { GenerateEvent, Tone } from '@postgear/ai-engine';
import { platformById } from '@postgear/automation';
import type { Prisma } from '@postgear/db';
import { describeFailure } from '../../ai/ai.errors';
import { AI_MESSAGES } from '../../ai/ai.messages';
import { strictestLimit } from '../../ai/ai.service';
import { AI_CREDIT_COSTS, type AiCreditType, generateCost } from '../../ai/credits/credits.policy';
import { type CreditContext, CreditsService } from '../../ai/credits/credits.service';
import { AI_ENGINE, type AiEngine } from '../../ai/engine/engine.types';
import { ChannelsService } from '../../channels/channels.service';
import type { GatewayBinding } from './gateway.schema';
import type {
  GatewayAiHashtagsInput,
  GatewayAiImageInput,
  GatewayAiRewriteInput,
  GatewayAiTextInput,
} from './gateway-ai.schema';
import { type EffectContext, GatewayBindingService } from './gateway-binding.service';

export const AI_STEP_MESSAGES = {
  OUT_OF_CREDITS: 'Not enough AI credits for this step.',
  IMAGES_OFF: 'Image generation is not set up on this PostGear instance.',
} as const;

/** The words a Generate Image style adds in front of the prompt. */
export const IMAGE_STYLE_PROMPTS = {
  photo: 'A realistic photograph.',
  illustration: 'A hand-drawn style illustration.',
  flat: 'A flat vector graphic with simple shapes and solid colours.',
} as const;

const ALT_MAX = 1_000;

/** A Media library item as a step passes it on (`MediaRef` in `@postgear/automation`). */
export type StepImage = {
  kind: 'media';
  id: string;
  url: string;
  type: 'image';
  alt?: string;
};

export type AiTextOutput = {
  text: string;
  parts: string[];
  hook: string;
  category: string;
  sources: { title: string; url: string }[];
  researched: boolean;
  image?: StepImage;
};

export type AiImageOutput = { image: StepImage; url: string; alt: string };
export type AiHashtagsOutput = { hashtags: string[]; line: string; shortened: boolean };
export type AiRewriteOutput = { text: string; shortened: boolean };

/** What a route answers and the effect row stores. */
export type AiStepAnswer<T> = { output: T; credits: number };

/** What an attempt saves on its effect row while it holds it. */
type Progress = { type: AiCreditType; charged: number; refunded: number };

function isProgress(value: Prisma.JsonValue | null): value is Progress & Prisma.JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.type === 'string' &&
    record.type in AI_CREDIT_COSTS &&
    typeof record.charged === 'number' &&
    typeof record.refunded === 'number'
  );
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** One attempt's charge and refunds, kept on the effect row as it goes. */
class StepCharge {
  private refunded = 0;

  constructor(
    private readonly service: { refund(type: AiCreditType, amount: number): Promise<void> },
    private readonly effect: EffectContext,
    readonly type: AiCreditType,
    readonly charged: number,
  ) {}

  get net(): number {
    return this.charged - this.refunded;
  }

  async refund(type: AiCreditType, amount: number): Promise<void> {
    const due = Math.min(amount, this.net);
    if (due <= 0) return;
    this.refunded += due;
    await this.service.refund(type, due);
    await this.save();
  }

  async refundRest(): Promise<void> {
    await this.refund(this.type, this.net);
  }

  async save(): Promise<void> {
    const progress: Progress = { type: this.type, charged: this.charged, refunded: this.refunded };
    await this.effect.save(progress).catch(() => undefined);
  }
}

@Injectable()
export class AutomationAiService {
  private readonly logger = new Logger('AutomationAi');

  constructor(
    @Inject(AI_ENGINE) private readonly engine: AiEngine,
    private readonly credits: CreditsService,
    private readonly channels: ChannelsService,
    private readonly binding: GatewayBindingService,
  ) {}

  /** `POST /internal/automation/ai/text`: Generate Text. */
  async text(input: GatewayAiTextInput, signal?: AbortSignal): Promise<AiStepAnswer<AiTextOutput>> {
    const binding = bindingOf(input);
    await this.binding.bind(binding, ['ai.generateText']);

    return this.binding.runEffect(binding, 'ai.text', async (effect) => {
      const orgId = binding.organizationId;
      const pipeline = this.engine.createPipeline({ orgId }, { research: input.research });
      if (!pipeline) throw notConfigured();

      const context = await this.prepare(orgId, effect);
      const platforms = this.providersOf(input.platform);
      const cost = generateCost(input.withImage);
      const charge = await this.charge(orgId, 'generate_post', cost, context, effect);

      const refunds: Promise<void>[] = [];
      let imageRefunded = false;
      const refundImage = (): void => {
        if (imageRefunded) return;
        imageRefunded = true;
        refunds.push(charge.refund('generate_image', AI_CREDIT_COSTS.generate_image));
      };
      const onEvent = (event: GenerateEvent): void => {
        if (
          input.withImage &&
          event.type === 'stage' &&
          event.stage === 'image' &&
          event.status === 'failed'
        ) {
          refundImage();
        }
      };

      try {
        const result = await pipeline.generate(
          {
            topic: input.prompt,
            tone: input.voice as Tone,
            format: input.format,
            withImage: input.withImage,
            maxCharacters: this.limitOf(platforms),
            platforms,
            workspaceName: context.workspaceName,
          },
          { signal, onEvent },
        );
        const parts = result.parts.map((part) => part.text);
        const saved = result.parts[0]?.image ?? null;
        // An image asked for and not delivered is never charged, failed
        // stage event or not.
        if (input.withImage && !saved) refundImage();
        await Promise.all(refunds);

        const output: AiTextOutput = {
          text: parts.join('\n\n'),
          parts,
          hook: result.hook,
          category: result.category,
          sources: result.sources.map((source) => ({ title: source.title, url: source.url })),
          researched: result.researched,
        };
        if (saved) {
          const alt = result.parts[0]?.imagePrompt?.trim();
          output.image = {
            kind: 'media',
            id: saved.mediaId,
            url: saved.url,
            type: 'image',
            ...(alt ? { alt: clip(alt, ALT_MAX) } : {}),
          };
        }
        return { output, credits: charge.net };
      } catch (error) {
        await Promise.allSettled(refunds);
        await this.refundAfterFailure(charge, orgId);
        throw this.failure('ai.text', orgId, error);
      }
    });
  }

  /** `POST /internal/automation/ai/image`: Generate Image, saved to Media. */
  async image(
    input: GatewayAiImageInput,
    signal?: AbortSignal,
  ): Promise<AiStepAnswer<AiImageOutput>> {
    const binding = bindingOf(input);
    await this.binding.bind(binding, ['ai.generateImage']);

    return this.binding.runEffect(binding, 'ai.image', async (effect) => {
      const orgId = binding.organizationId;
      if (this.engine.mode === 'unconfigured') throw notConfigured();
      if (!this.engine.imagesEnabled) {
        throw new UnprocessableEntityException({
          message: AI_STEP_MESSAGES.IMAGES_OFF,
          code: 'ai_not_configured',
        });
      }

      const context = await this.prepare(orgId, effect);
      const charge = await this.charge(
        orgId,
        'generate_image',
        AI_CREDIT_COSTS.generate_image,
        context,
        effect,
      );
      const prompt = input.style
        ? `${IMAGE_STYLE_PROMPTS[input.style]} ${input.prompt}`
        : input.prompt;

      try {
        // `generateImage` saves through `imageSinkFor`, so the image is an
        // ordinary Media item: listable, deletable, attachable.
        const saved = await this.engine.generateImage({ orgId }, prompt, { signal });
        const alt = clip((saved.revisedPrompt ?? input.prompt).trim(), ALT_MAX);
        const image: StepImage = {
          kind: 'media',
          id: saved.mediaId,
          url: saved.url,
          type: 'image',
          alt,
        };
        return { output: { image, url: saved.url, alt }, credits: charge.net };
      } catch (error) {
        await this.refundAfterFailure(charge, orgId);
        throw this.failure('ai.image', orgId, error);
      }
    });
  }

  /** `POST /internal/automation/ai/hashtags`: Generate Hashtags. */
  async hashtags(
    input: GatewayAiHashtagsInput,
    signal?: AbortSignal,
  ): Promise<AiStepAnswer<AiHashtagsOutput>> {
    const binding = bindingOf(input);
    await this.binding.bind(binding, ['ai.generateHashtags']);

    return this.binding.runEffect(binding, 'ai.hashtags', async (effect) => {
      const orgId = binding.organizationId;
      const writer = this.engine.createSnippetWriter({ orgId });
      if (!writer) throw notConfigured();

      const context = await this.prepare(orgId, effect);
      const charge = await this.charge(
        orgId,
        'generate_snippet',
        AI_CREDIT_COSTS.generate_snippet,
        context,
        effect,
      );

      try {
        const result = await writer.hashtags(
          {
            text: input.text,
            platform: input.platform,
            count: input.count,
            maxCharacters: this.limitOf(this.providersOf(input.platform)),
          },
          { signal },
        );
        return {
          output: { hashtags: result.hashtags, line: result.line, shortened: result.shortened },
          credits: charge.net,
        };
      } catch (error) {
        await this.refundAfterFailure(charge, orgId);
        throw this.failure('ai.hashtags', orgId, error);
      }
    });
  }

  /** `POST /internal/automation/ai/rewrite`: Rewrite In Brand Voice. */
  async rewrite(
    input: GatewayAiRewriteInput,
    signal?: AbortSignal,
  ): Promise<AiStepAnswer<AiRewriteOutput>> {
    const binding = bindingOf(input);
    await this.binding.bind(binding, ['ai.rewriteInBrandVoice']);

    return this.binding.runEffect(binding, 'ai.rewrite', async (effect) => {
      const orgId = binding.organizationId;
      const writer = this.engine.createSnippetWriter({ orgId });
      if (!writer) throw notConfigured();

      const context = await this.prepare(orgId, effect);
      const charge = await this.charge(
        orgId,
        'generate_snippet',
        AI_CREDIT_COSTS.generate_snippet,
        context,
        effect,
      );

      try {
        const result = await writer.rewrite(
          {
            text: input.text,
            platform: input.platform,
            voice: input.voice as Tone,
            maxCharacters: this.limitOf(this.providersOf(input.platform)),
            workspaceName: context.workspaceName,
          },
          { signal },
        );
        return { output: { text: result.text, shortened: result.shortened }, credits: charge.net };
      } catch (error) {
        await this.refundAfterFailure(charge, orgId);
        throw this.failure('ai.rewrite', orgId, error);
      }
    });
  }

  /**
   * Refunds what an earlier attempt of this step charged and never settled
   * (it died before refunding), then reads the cycle.
   */
  private async prepare(orgId: string, effect: EffectContext): Promise<CreditContext> {
    const previous = effect.previous;
    if (isProgress(previous) && previous.charged > previous.refunded) {
      const due = previous.charged - previous.refunded;
      await this.credits.refund(orgId, previous.type, due);
      const settled: Progress = { type: previous.type, charged: 0, refunded: 0 };
      await effect.save(settled).catch(() => undefined);
    }
    return this.credits.context(orgId);
  }

  /** `tryCharge`, the one charging path; out of credits stops the run. */
  private async charge(
    orgId: string,
    type: AiCreditType,
    amount: number,
    context: CreditContext,
    effect: EffectContext,
  ): Promise<StepCharge> {
    const result = await this.credits.tryCharge(orgId, type, amount, context);
    if (!result.ok) {
      throw new UnprocessableEntityException({
        message: AI_STEP_MESSAGES.OUT_OF_CREDITS,
        code: 'out_of_credits',
        details: { resetsAt: result.credits.resetsAt },
      });
    }
    const charge = new StepCharge(
      { refund: (refundType, due) => this.credits.refund(orgId, refundType, due) },
      effect,
      type,
      amount,
    );
    await charge.save();
    return charge;
  }

  private async refundAfterFailure(charge: StepCharge, orgId: string): Promise<void> {
    await charge.refundRest().catch((error: unknown) => {
      this.logger.error(
        `Could not refund ${charge.net} ${charge.type} credits for ${orgId}: ${reasonOf(error)}`,
      );
    });
  }

  /** social-core provider identifiers of a step's platform; none for "Any platform". */
  private providersOf(platform: string): string[] {
    return platform === 'generic' ? [] : [...(platformById(platform)?.providers ?? [])];
  }

  private limitOf(providers: string[]): number | null {
    return providers.length > 0 ? strictestLimit(this.channels.listProviders(), providers) : null;
  }

  /**
   * The answer for a failure: a provider hiccup (or a cut-off call) is a 503
   * the worker retries; anything a retry cannot fix is a 422 with the AI
   * module's own sentence, never the provider's text.
   */
  private failure(kind: string, orgId: string, error: unknown): HttpException {
    if (error instanceof HttpException) return error;
    const failure = describeFailure(error);
    this.logger.warn(
      JSON.stringify({
        event: 'automation.ai_failed',
        step: kind,
        orgId,
        kind: failure.kind,
        reason: reasonOf(error),
      }),
    );
    if (failure.kind === 'aborted' || failure.retryable) {
      return new ServiceUnavailableException({ message: failure.message, code: 'ai_unavailable' });
    }
    return new UnprocessableEntityException({
      message: failure.message,
      code: `ai_${failure.kind}`,
    });
  }
}

function bindingOf(input: GatewayBinding): GatewayBinding {
  return { runId: input.runId, nodeKey: input.nodeKey, organizationId: input.organizationId };
}

function notConfigured(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    message: AI_MESSAGES.NOT_CONFIGURED,
    code: 'ai_not_configured',
  });
}

/** The name and message only, never a provider response body. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
