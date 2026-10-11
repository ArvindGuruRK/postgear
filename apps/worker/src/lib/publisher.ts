/**
 * Who actually publishes: the real providers, or a stand-in.
 *
 * ## The simulation, and why it exists
 *
 * Nothing about the scheduler can be exercised locally against real platforms:
 * a fresh clone has no developer apps, and the seeded channels hold fake
 * tokens that every platform would reject with a 401. With
 * `PUBLISH_SIMULATION=true` the final HTTP call is replaced by a stand-in that
 * returns a plausible result — and can be *asked* to fail, by a directive in
 * the post text:
 *
 * | Directive              | What the stand-in does                                  |
 * |------------------------|---------------------------------------------------------|
 * | `[simulate:429]`       | Throws `RetryableError` every attempt                   |
 * | `[simulate:429x2]`     | Throws `RetryableError` on attempts 1 and 2, then posts |
 * | `[simulate:401]`       | Throws `RefreshTokenError` (the refresh branch)         |
 * | `[simulate:400]`       | Throws `BadBodyError` (content the platform refuses)    |
 * | `[simulate:403]`       | Throws `NotEnoughScopesError`                            |
 * | `[simulate:slow:5]`    | Takes five seconds, then posts                          |
 *
 * Everything around the call is real: the Temporal timer, the retry policy and
 * its backoff, the status written for the queue, the refresh branch and its
 * `refreshNeeded` flag. That is what makes the sprint's Definition of Done —
 * a visible retry on a 429, "post now" within seconds, a restart losing
 * nothing — verifiable without a single platform credential. The env schema
 * refuses the flag in production.
 *
 * Validation still runs against the **real** provider's rules, so a simulated
 * channel refuses exactly what the real one would.
 */
import { Context } from '@temporalio/activity';
import {
  type AuthTokenDetails,
  BadBodyError,
  type ChannelContext,
  checkAgainstRules,
  IntegrationManager,
  NotEnoughScopesError,
  type PostDetails,
  type PostResponse,
  RefreshTokenError,
  RetryableError,
  type SocialProvider,
} from '@postgear/social-core';
import type { WorkerEnv } from '../config/env';

/** The slice of a provider the publish and refresh activities use. */
export type PublishingProvider = Pick<
  SocialProvider,
  'identifier' | 'name' | 'checkValidity' | 'post' | 'refreshToken'
>;

export interface Publisher {
  /** True when a stand-in is in use rather than the platforms. */
  readonly simulated: boolean;
  /** Throws `ProviderError` for an unknown or unconfigured identifier. */
  resolve(providerIdentifier: string): PublishingProvider;
}

export function createPublisher(env: Pick<WorkerEnv, 'PUBLISH_SIMULATION'>): Publisher {
  const manager = new IntegrationManager();

  if (env.PUBLISH_SIMULATION === 'true') {
    return {
      simulated: true,
      resolve: (identifier) => new SimulatedProvider(identifier, manager.find(identifier)),
    };
  }

  return {
    simulated: false,
    resolve: (identifier) => manager.get(identifier),
  };
}

const DIRECTIVE = /\[simulate:(429|5xx|401|400|403|slow)(?::(\d+)|x(\d+))?\]/i;

export interface SimulationDirective {
  kind: '429' | '5xx' | '401' | '400' | '403' | 'slow';
  /** For failures: fail attempts up to and including this one. Absent means always. */
  untilAttempt?: number;
  /** For `slow`: seconds to wait. */
  seconds?: number;
}

export function parseSimulationDirective(message: string): SimulationDirective | null {
  const match = DIRECTIVE.exec(message);

  if (!match) {
    return null;
  }

  const kind = match[1].toLowerCase() as SimulationDirective['kind'];

  return {
    kind,
    ...(match[3] ? { untilAttempt: Number(match[3]) } : {}),
    ...(kind === 'slow' ? { seconds: match[2] ? Number(match[2]) : 5 } : {}),
  };
}

/** The attempt Temporal is on, or 1 when called outside an activity (tests). */
function currentAttempt(): number {
  try {
    return Context.current().info.attempt;
  } catch {
    return 1;
  }
}

export class SimulatedProvider implements PublishingProvider {
  readonly identifier: string;
  readonly name: string;

  constructor(
    identifier: string,
    private readonly real: SocialProvider | undefined,
  ) {
    this.identifier = identifier;
    this.name = real?.name ?? identifier;
  }

  async checkValidity(posts: PostDetails[]): Promise<string | true> {
    return this.real ? checkAgainstRules(this.real, posts) : true;
  }

  async post(
    channel: ChannelContext,
    _accessToken: string,
    posts: PostDetails[],
  ): Promise<PostResponse[]> {
    const directive = parseSimulationDirective(posts.map((post) => post.message).join('\n'));
    const attempt = currentAttempt();

    if (directive && (directive.untilAttempt === undefined || attempt <= directive.untilAttempt)) {
      switch (directive.kind) {
        case '429':
          throw new RetryableError(
            `${this.name} rate-limited the request (simulated, attempt ${attempt}).`,
            this.identifier,
            'simulated 429',
            429,
          );
        case '5xx':
          throw new RetryableError(
            `${this.name} is temporarily unavailable (simulated, attempt ${attempt}).`,
            this.identifier,
            'simulated 503',
            503,
          );
        case '401':
          throw new RefreshTokenError(
            `Your ${this.name} connection has expired (simulated).`,
            this.identifier,
            'simulated 401',
            401,
          );
        case '400':
          throw new BadBodyError(
            `${this.name} rejected the post (simulated). Change the text and try again.`,
            this.identifier,
            'simulated 400',
            400,
          );
        case '403':
          throw new NotEnoughScopesError(
            this.identifier,
            [],
            `Your ${this.name} account has not granted PostGear permission to post (simulated).`,
          );
        case 'slow':
          await new Promise((resolve) => setTimeout(resolve, (directive.seconds ?? 5) * 1_000));
      }
    }

    const stamp = Date.now().toString(36);

    return posts.map((post, index) => {
      const postId = `sim-${stamp}-${index}`;
      return {
        id: post.id,
        postId,
        releaseURL: `https://simulated.postgear.local/${this.identifier}/${channel.internalId}/${postId}`,
      };
    });
  }

  /** A fake token cannot be refreshed; the branch fails the way a dead token would. */
  async refreshToken(_refreshToken: string): Promise<AuthTokenDetails> {
    return { id: '', accessToken: '', name: '' };
  }
}
