/**
 * Signing in to an outside app to connect it (Google in Module 13).
 *
 * Follows `channel-oauth.service.ts`:
 *
 * - **`state` is an opaque random key.** The handshake (workspace, user,
 *   app, the connection being reconnected, where to come back to) sits in
 *   Redis behind it for 10 minutes, so nothing real round-trips through the
 *   app and the address bar, and a tampered state finds nothing.
 * - **Single use.** The state is deleted on first read, and the app named in
 *   the callback must be the one it was minted for.
 * - **`returnTo` is a path under `/[orgId]/workflows`** of the same
 *   workspace, normalised, so the person lands back on the exact step
 *   (`?step=...&tab=setup`) and can never be sent anywhere else.
 * - **The callback re-checks that the user is still an admin** of that
 *   workspace. Reconnecting is a write: a member must never be able to
 *   overwrite a shared connection's tokens (n8n's CVE-2026-45732).
 *
 * Apps plug in through `CONNECTION_OAUTH_PLUGINS`: Google (Module 13,
 * `google/google-oauth.plugin.ts`) when a real Google client is configured.
 * A grant the app gave but PostGear cannot use (no refresh token, file
 * access unticked) lands back with `connectError=failed`; the reason goes to
 * the log, never into the address bar.
 */
import { randomBytes } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConnectionKind } from '@postgear/automation';
import { Role } from '@postgear/db';
import type { Env } from '../../../config/env';
import { RedisService } from '../../redis/redis.service';
import { CONNECTION_MESSAGES, type OAuthErrorCode } from './connections.messages';
import { ConnectionsRepository } from './connections.repository';
import { ConnectionsService, type OAuthGrant } from './connections.service';
import type { OAuthStartQuery } from './dto/connections.schema';

export const CONNECTION_OAUTH_STATE_TTL_SECONDS = 600;

export const CONNECTION_OAUTH_PLUGINS = Symbol('CONNECTION_OAUTH_PLUGINS');

export interface OAuthConnectionPlugin {
  provider: ConnectionKind;
  authorizeUrl(state: string, redirectUri: string): string;
  exchange(code: string, redirectUri: string): Promise<OAuthGrant>;
}

export interface ConnectionHandshake {
  orgId: string;
  userId: string;
  provider: ConnectionKind;
  /** Set when reconnecting. */
  connectionId?: string;
  /** Normalised path under `/[orgId]/workflows`. */
  returnTo: string;
}

/** Any base works: only whether the origin survives parsing matters. */
const BASE = 'https://postgear.invalid';

/**
 * The normalised `returnTo`, or null when it is not a same-origin path
 * under this workspace's workflows.
 */
export function safeReturnTo(orgId: string, returnTo: string): string | null {
  if (!returnTo.startsWith('/') || returnTo.startsWith('//')) return null;
  if (/[\\\s\p{Cc}]/u.test(returnTo)) return null;
  let url: URL;
  try {
    url = new URL(returnTo, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  const root = `/${orgId}/workflows`;
  if (url.pathname !== root && !url.pathname.startsWith(`${root}/`)) return null;
  return `${url.pathname}${url.search}`;
}

/** `returnTo` with extra query values, keeping the step deep link it already has. */
export function withQuery(path: string, values: Record<string, string>): string {
  const url = new URL(path, BASE);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

@Injectable()
export class ConnectionOAuthService {
  private readonly logger = new Logger(ConnectionOAuthService.name);
  private readonly apiUrl: string;
  private readonly webUrl: string;

  constructor(
    private readonly redis: RedisService,
    private readonly repository: ConnectionsRepository,
    private readonly connections: ConnectionsService,
    config: ConfigService<Env, true>,
    @Inject(CONNECTION_OAUTH_PLUGINS) private readonly plugins: OAuthConnectionPlugin[],
  ) {
    this.apiUrl = config.get('API_URL', { infer: true });
    this.webUrl = config.get('WEB_URL', { infer: true });
  }

  /**
   * Where to send the browser: the app's consent screen, or straight back
   * with `?connectError=unavailable` when the app has no sign-in here. A
   * `returnTo` outside the workflows pages is a 400, never a redirect.
   */
  async start(
    orgId: string,
    userId: string,
    provider: string,
    query: OAuthStartQuery,
  ): Promise<string> {
    const returnTo = safeReturnTo(orgId, query.returnTo);
    if (!returnTo) throw new BadRequestException(CONNECTION_MESSAGES.RETURN_TO);

    const plugin = this.plugins.find((candidate) => candidate.provider === provider);
    if (!plugin) return this.back(returnTo, { connectError: 'unavailable' });

    if (query.connectionId) {
      const existing = await this.repository.find(orgId, query.connectionId);
      if (!existing || existing.provider !== provider) {
        return this.back(returnTo, { connectError: 'failed' });
      }
    }

    const state = randomBytes(32).toString('base64url');
    const handshake: ConnectionHandshake = {
      orgId,
      userId,
      provider: plugin.provider,
      ...(query.connectionId ? { connectionId: query.connectionId } : {}),
      returnTo,
    };
    await this.redis.set(
      this.key(state),
      JSON.stringify(handshake),
      CONNECTION_OAUTH_STATE_TTL_SECONDS,
    );
    return plugin.authorizeUrl(state, this.redirectUri(plugin.provider));
  }

  /** Finishes the handshake and answers the web address to land on. */
  async finish(
    provider: string,
    code: string | undefined,
    state: string | undefined,
  ): Promise<string> {
    const handshake = await this.consume(provider, state);
    if (!handshake) return `${this.webUrl}/?connectError=${'expired' satisfies OAuthErrorCode}`;
    const fail = (connectError: OAuthErrorCode) => this.back(handshake.returnTo, { connectError });

    if (!code) return fail('cancelled');

    const role = await this.repository.membershipRole(handshake.userId, handshake.orgId);
    if (role !== Role.ADMIN && role !== Role.SUPERADMIN) return fail('not_admin');

    const plugin = this.plugins.find((candidate) => candidate.provider === handshake.provider);
    if (!plugin) return fail('unavailable');

    try {
      const grant = await plugin.exchange(code, this.redirectUri(plugin.provider));
      const saved = await this.connections.saveGrant(
        handshake.orgId,
        handshake.userId,
        plugin.provider,
        grant,
        handshake.connectionId,
      );
      return this.back(handshake.returnTo, { connection: saved.id });
    } catch (error) {
      // The reason may hold the app's own error text; the person gets a
      // plain retry message instead. Only our own refusals are logged by name.
      if (error instanceof Error && error.name === 'OAuthGrantRefused') {
        this.logger.warn(
          JSON.stringify({
            event: 'automation.connection.oauth_refused',
            provider: plugin.provider,
            orgId: handshake.orgId,
            reason: error.message,
          }),
        );
      }
      return fail('failed');
    }
  }

  /** Validates and deletes a state: a second read finds nothing. */
  async consume(provider: string, state: string | undefined): Promise<ConnectionHandshake | null> {
    if (!state) return null;
    const key = this.key(state);
    const stored = await this.redis.get(key);
    await this.redis.delete(key);
    if (!stored) return null;
    try {
      const handshake = JSON.parse(stored) as ConnectionHandshake;
      return handshake.provider === provider ? handshake : null;
    } catch {
      return null;
    }
  }

  private back(returnTo: string, values: Record<string, string>): string {
    return `${this.webUrl}${withQuery(returnTo, values)}`;
  }

  private redirectUri(provider: ConnectionKind): string {
    return `${this.apiUrl}/automation-connections/oauth/${provider}/callback`;
  }

  private key(state: string): string {
    return `automation:connection:oauth:state:${state}`;
  }
}
