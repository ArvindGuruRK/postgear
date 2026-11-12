/**
 * Research This Competitor (Sprint 11 Module 10, backlog #16).
 *
 * One structured AI call over the posts Discover already read for a
 * competitor: what they keep posting about, how often and where, and two or
 * three things the workspace could post that they do not cover. It never
 * reads the open web, so every line can be checked against the posts listed
 * under it, and it costs what the SEO advice costs (3 credits).
 *
 * The answer is kept in Redis for a day per competitor and per the posts it
 * was written from: a second look the same day is free and instant, and new
 * posts move the key, so the next look writes a fresh one. Nothing is stored
 * in Postgres.
 *
 * Credits are charged before the call and refunded when it fails, the same as
 * every other AI feature. A workspace with AI switched off gets a 503 with the
 * catalogue's sentence, and the page hides the button when `/discover/status`
 * says so.
 */
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { CompetitorResearchResult } from '@postgear/ai-engine';
import { describeFailure } from '../ai/ai.errors';
import { AI_MESSAGES } from '../ai/ai.messages';
import { AI_CREDIT_COSTS, type AiCredits } from '../ai/credits/credits.policy';
import { CreditsService } from '../ai/credits/credits.service';
import { AI_ENGINE, type AiEngine } from '../ai/engine/engine.types';
import { RedisService } from '../redis/redis.service';
import { COMPETITOR_ENGINE, type CompetitorEngine } from './competitors.engine';
import { CompetitorsService } from './competitors.service';
import { discoverKeys } from './discover.keys';
import { DISCOVER_MESSAGES } from './discover.messages';

/** Fewer than this and there is no pattern to read. */
export const RESEARCH_MIN_POSTS = 3;
const RESEARCH_POSTS = 15;
const RESEARCH_KEEP_SECONDS = 24 * 60 * 60;
const RESEARCH_TIMEOUT_MS = 45_000;

export interface CompetitorResearch extends CompetitorResearchResult {
  /** How many posts it was written from. */
  basedOn: number;
  /** ISO 8601. */
  createdAt: string;
}

export interface CompetitorResearchAnswer {
  research: CompetitorResearch;
  /** True when this is the copy written earlier today, so nothing was charged. */
  cached: boolean;
  /** The workspace's credits after this answer; null when nothing was charged. */
  credits: AiCredits | null;
}

@Injectable()
export class CompetitorResearchService {
  private readonly logger = new Logger(CompetitorResearchService.name);
  private readonly keys: ReturnType<typeof discoverKeys>;

  constructor(
    private readonly competitors: CompetitorsService,
    @Inject(AI_ENGINE) private readonly ai: AiEngine,
    private readonly credits: CreditsService,
    private readonly redis: RedisService,
    @Inject(COMPETITOR_ENGINE) engine: CompetitorEngine,
  ) {
    this.keys = discoverKeys(engine.simulation);
  }

  /** Whether the button can be offered at all on this instance. */
  get available(): boolean {
    return this.ai.mode !== 'unconfigured';
  }

  async research(orgId: string, id: string): Promise<CompetitorResearchAnswer> {
    const [competitor, answer] = await Promise.all([
      this.competitors.view(orgId, id),
      this.competitors.items(orgId, id),
    ]);
    const posts = answer.items.slice(0, RESEARCH_POSTS);
    if (posts.length < RESEARCH_MIN_POSTS) {
      throw new UnprocessableEntityException(DISCOVER_MESSAGES.researchNeedsPosts);
    }

    const key = this.keys.research(id, posts.map((post) => post.id).join(','));
    const kept = await this.readKept(key);
    if (kept) return { research: kept, cached: true, credits: null };

    const writer = this.ai.createSnippetWriter({ orgId });
    if (!writer) throw new ServiceUnavailableException(AI_MESSAGES.NOT_CONFIGURED);

    const context = await this.credits.context(orgId);
    const credits = await this.credits.charge(orgId, 'competitor_research', undefined, context);

    let result: CompetitorResearchResult;
    try {
      result = await writer.research(
        {
          competitor: competitor.name,
          workspaceName: context.workspaceName,
          posts: posts.map((post) => ({
            title: post.title,
            where: post.source.name,
            publishedAt: post.publishedAt ?? null,
          })),
        },
        { signal: AbortSignal.timeout(RESEARCH_TIMEOUT_MS) },
      );
    } catch (error) {
      await this.credits
        .refund(orgId, 'competitor_research', AI_CREDIT_COSTS.competitor_research)
        .catch(() => undefined);
      const failure = describeFailure(error);
      this.logger.warn(
        JSON.stringify({ event: 'discover.competitor.research_failed', kind: failure.kind }),
      );
      throw new HttpException(
        `${failure.message} ${DISCOVER_MESSAGES.researchRefunded}`,
        failure.kind === 'rate_limited' ? HttpStatus.TOO_MANY_REQUESTS : HttpStatus.BAD_GATEWAY,
      );
    }

    const research: CompetitorResearch = {
      ...result,
      basedOn: posts.length,
      createdAt: new Date().toISOString(),
    };
    // A copy that cannot be kept only means the next look is charged again.
    await this.redis
      .set(key, JSON.stringify(research), RESEARCH_KEEP_SECONDS)
      .catch(() => undefined);
    return { research, cached: false, credits };
  }

  /** The copy written earlier, when it is still whole. */
  private async readKept(key: string): Promise<CompetitorResearch | null> {
    const raw = await this.redis.get(key).catch(() => null);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as CompetitorResearch;
      return Array.isArray(value.themes) && Array.isArray(value.openings) ? value : null;
    } catch {
      return null;
    }
  }
}
