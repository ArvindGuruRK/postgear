/**
 * The AI routes' logic: generate a post, chat with the copilot, report
 * status and credits.
 *
 * ## Two phases, because a stream cannot change its status code
 *
 * Each streaming route runs in two phases. `prepare*` does everything that
 * can refuse, checking that the engine is configured (503), the channels are
 * the workspace's (422) and the cycle can afford it (402), and *charges*. It throws
 * ordinary HTTP exceptions, which the global filter turns into JSON, because
 * nothing has been written yet. It returns a `PreparedRun`; the controller
 * then opens the stream and runs it. From that point nothing throws: every
 * outcome, including a provider failure or a disconnect, is an event.
 *
 * ## Credits across a run
 *
 * The charge is made in `prepare` (before the work, see `credits.service.ts`).
 * During the run an `image failed` stage event refunds the image's share at
 * once; a rejection refunds whatever has not been refunded yet. The terminal
 * `done` or `error` event carries a fresh credits summary, so the meter in
 * the UI is right without another request.
 *
 * ## What is relayed
 *
 * The engine's events, unchanged, under their own `type` as the event name.
 * The engine's `done` is replaced by this module's, which adds `credits`.
 */
import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  ContentPipeline,
  CopilotAgent,
  CopilotEvent,
  GenerateEvent,
} from '@postgear/ai-engine';
import { securityLogger } from '../../common/logging/security-logger';
import { ChannelsService, type ChannelView } from '../channels/channels.service';
import { PostsService } from '../posts/posts.service';
import { describeFailure, isAbortError } from './ai.errors';
import { AI_MESSAGES } from './ai.messages';
import { AI_CREDIT_COSTS, type AiCredits, generateCost } from './credits/credits.policy';
import { type CreditContext, CreditsService } from './credits/credits.service';
import type { CopilotChatInput, GenerateInput } from './dto/ai.schema';
import { AI_ENGINE, type AiEngine, type AiStatus } from './engine/engine.types';
import { createCopilotTools } from './tools/copilot-tools';

/** What a run writes to. `sse.ts` provides it; a test hands in a recorder. */
export interface StreamSink {
  send(type: string, data: unknown): void;
  readonly signal: AbortSignal;
}

/** A run that has passed every check and been charged. Never rejects. */
export type PreparedRun = (stream: StreamSink) => Promise<void>;

/** The targets of a generation, resolved from channel ids. */
interface GenerateTargets {
  platforms: string[];
  maxCharacters: number | null;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @Inject(AI_ENGINE) private readonly engine: AiEngine,
    private readonly credits: CreditsService,
    private readonly channels: ChannelsService,
    private readonly posts: PostsService,
  ) {}

  /** `GET /ai/status`. */
  status(): AiStatus {
    return {
      configured: this.engine.mode !== 'unconfigured',
      mode: this.engine.mode,
      model: this.engine.modelName,
      research: this.engine.researchEnabled,
      images: this.engine.imagesEnabled,
    };
  }

  /** `GET /ai/credits`. */
  async creditsSummary(orgId: string): Promise<AiCredits> {
    return this.credits.summary(orgId);
  }

  /**
   * `POST /ai/generate`, phase one: checks, resolves the channels, charges.
   *
   * The checks run in the order a person would want to hear about them: a
   * missing engine is the deployment's problem, a foreign channel is the
   * request's, and the credits are charged last so a refused request never
   * costs anything.
   */
  async prepareGenerate(orgId: string, input: GenerateInput): Promise<PreparedRun> {
    const pipeline = this.engine.createPipeline({ orgId });

    if (!pipeline) {
      throw new ServiceUnavailableException(AI_MESSAGES.NOT_CONFIGURED);
    }

    const context = await this.credits.context(orgId);
    const targets = await this.resolveTargets(orgId, input.channelIds);
    const cost = generateCost(input.withImage);
    const charged = await this.credits.charge(orgId, 'generate_post', cost, context);

    return (stream) =>
      this.runGenerate({ orgId, input, pipeline, context, targets, cost, charged, stream });
  }

  private async runGenerate(params: {
    orgId: string;
    input: GenerateInput;
    pipeline: ContentPipeline;
    context: CreditContext;
    targets: GenerateTargets;
    cost: number;
    charged: AiCredits;
    stream: StreamSink;
  }): Promise<void> {
    const { orgId, input, pipeline, context, targets, cost, stream } = params;
    let refunded = 0;
    const refunds: Promise<void>[] = [];
    const refund = (type: 'generate_post' | 'generate_image', amount: number): void => {
      if (amount <= 0) {
        return;
      }
      refunded += amount;
      refunds.push(
        this.credits.refund(orgId, type, amount).catch((error: unknown) => {
          this.logger.error(
            `Could not refund ${amount} ${type} credits for ${orgId}: ${reasonOf(error)}`,
          );
        }),
      );
    };

    const onEvent = (event: GenerateEvent): void => {
      if (event.type === 'done') {
        // Replaced below by a `done` that carries the credits.
        return;
      }

      if (
        input.withImage &&
        event.type === 'stage' &&
        event.stage === 'image' &&
        event.status === 'failed'
      ) {
        refund('generate_image', AI_CREDIT_COSTS.generate_image);
      }

      stream.send(event.type, event);
    };

    try {
      const result = await pipeline.generate(
        {
          topic: input.topic,
          tone: input.tone,
          format: input.format,
          withImage: input.withImage,
          maxCharacters: targets.maxCharacters,
          platforms: targets.platforms,
          workspaceName: context.workspaceName,
        },
        { signal: stream.signal, onEvent },
      );

      await Promise.all(refunds);
      stream.send('done', {
        type: 'done',
        result,
        credits: await this.freshCredits(orgId, context, params.charged),
      });
    } catch (error) {
      refund('generate_post', cost - refunded);
      await Promise.all(refunds);

      const failure = describeFailure(error);
      this.logFailure('ai.generate_failed', orgId, failure.kind, error);
      stream.send('error', {
        type: 'error',
        ...failure,
        credits: await this.freshCredits(orgId, context, params.charged),
      });
    }
  }

  /** `POST /ai/copilot/chat`, phase one: configured, charged, tools built. */
  async prepareChat(orgId: string, input: CopilotChatInput): Promise<PreparedRun> {
    if (this.engine.mode === 'unconfigured') {
      throw new ServiceUnavailableException(AI_MESSAGES.NOT_CONFIGURED);
    }

    const context = await this.credits.context(orgId);
    const channels = await this.channels.list(orgId);
    const charged = await this.credits.charge(orgId, 'copilot_message', undefined, context);

    const tools = createCopilotTools({
      orgId,
      workspaceName: context.workspaceName,
      engine: this.engine,
      credits: this.credits,
      creditContext: context,
      channels: this.channels,
      posts: this.posts,
    });
    const agent = this.engine.createCopilot({ orgId }, tools, {
      workspaceName: context.workspaceName,
      today: new Date().toISOString().slice(0, 10),
      channelSummary: summarizeChannels(channels),
    });

    if (!agent) {
      await this.credits.refund(orgId, 'copilot_message', AI_CREDIT_COSTS.copilot_message);
      throw new ServiceUnavailableException(AI_MESSAGES.NOT_CONFIGURED);
    }

    return (stream) => this.runChat({ orgId, input, agent, context, charged, stream });
  }

  private async runChat(params: {
    orgId: string;
    input: CopilotChatInput;
    agent: CopilotAgent;
    context: CreditContext;
    charged: AiCredits;
    stream: StreamSink;
  }): Promise<void> {
    const { orgId, input, agent, context, stream } = params;
    let produced = false;

    const onEvent = (event: CopilotEvent): void => {
      if (event.type === 'done') {
        return;
      }
      produced = true;
      stream.send(event.type, event);
    };

    try {
      const result = await agent.run(input.messages, { signal: stream.signal, onEvent });

      stream.send('done', {
        type: 'done',
        message: result.message,
        toolCalls: result.toolCalls,
        credits: await this.freshCredits(orgId, context, params.charged),
      });
    } catch (error) {
      // The message's own credit comes back only when nothing was produced;
      // a reply that was cut off mid-way still did its work (and any tool it
      // ran charged and refunded itself).
      if (!produced) {
        await this.credits
          .refund(orgId, 'copilot_message', AI_CREDIT_COSTS.copilot_message)
          .catch((refundError: unknown) => {
            this.logger.error(
              `Could not refund a copilot message for ${orgId}: ${reasonOf(refundError)}`,
            );
          });
      }

      const failure = describeFailure(error);
      this.logFailure('ai.chat_failed', orgId, failure.kind, error);
      stream.send('error', {
        type: 'error',
        ...failure,
        credits: await this.freshCredits(orgId, context, params.charged),
      });
    }
  }

  /**
   * The channels a generation targets, as platforms and the strictest limit.
   *
   * A channel id that is not this workspace's, or was disconnected since
   * the page loaded, is refused before anything is charged.
   */
  private async resolveTargets(orgId: string, channelIds: string[]): Promise<GenerateTargets> {
    const available = new Map(
      (await this.channels.list(orgId)).map((channel) => [channel.id, channel]),
    );
    const chosen: ChannelView[] = [];

    for (const id of channelIds) {
      const channel = available.get(id);

      if (!channel) {
        securityLogger.warn('ai.foreign_reference', { orgId, kind: 'channel' });
        throw new UnprocessableEntityException(AI_MESSAGES.CHANNEL_UNAVAILABLE);
      }

      chosen.push(channel);
    }

    const limits = new Map(
      this.channels
        .listProviders()
        .map((provider) => [provider.identifier, provider.rules.maxLength]),
    );
    const platforms = [...new Set(chosen.map((channel) => channel.providerIdentifier))];
    const known = platforms.flatMap((platform) => {
      const limit = limits.get(platform);
      return limit === undefined ? [] : [limit];
    });

    return { platforms, maxCharacters: known.length > 0 ? Math.min(...known) : null };
  }

  /**
   * The credits for a terminal event. Read fresh so refunds are reflected;
   * falls back to the post-charge snapshot if the read fails, because a
   * stream that has already delivered a result must still end properly.
   */
  private async freshCredits(
    orgId: string,
    context: CreditContext,
    fallback: AiCredits,
  ): Promise<AiCredits> {
    try {
      return await this.credits.summaryFor(orgId, context);
    } catch (error) {
      this.logger.warn(`Could not re-read credits for ${orgId}: ${reasonOf(error)}`);
      return fallback;
    }
  }

  private logFailure(event: string, orgId: string, kind: string, error: unknown): void {
    const line = JSON.stringify({ event, orgId, kind, reason: reasonOf(error) });

    // A stopped generation is a person changing their mind, not a fault.
    if (isAbortError(error) || kind === 'aborted') {
      this.logger.log(line);
    } else {
      this.logger.warn(line);
    }
  }
}

/** One line per channel, for the copilot's system prompt. */
export function summarizeChannels(channels: ChannelView[]): string {
  if (channels.length === 0) {
    return 'No channels are connected yet.';
  }

  return channels
    .map((channel) => `${channel.name} (${channel.providerName}, ${HEALTH_LABELS[channel.health]})`)
    .join('\n');
}

const HEALTH_LABELS: Record<ChannelView['health'], string> = {
  connected: 'connected',
  needs_reconnect: 'needs reconnecting',
  needs_setup: 'not finished setting up',
  expiring: 'connected, token expiring soon',
  disabled: 'disabled',
};

/** The name and message only, never a provider response body. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
