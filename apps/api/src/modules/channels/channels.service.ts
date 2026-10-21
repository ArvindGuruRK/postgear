/**
 * Channel connection lifecycle.
 *
 * The repository owns persistence and encryption; this owns the sequence:
 * starting a handshake, completing it safely, refreshing a token, and
 * disconnecting. Every method takes the caller's `orgId` and re-scopes its own
 * queries, even though `RolesGuard` has already checked membership: the same
 * defence-in-depth convention `org.service.ts` follows.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@postgear/db';
import {
  type ChannelContext,
  IntegrationManager,
  type PostDetails,
  type PostResponse,
  type ProviderEntity,
  ProviderNotConfiguredError,
  RefreshTokenError,
  type SocialProvider,
  supportsEntitySelection,
} from '@postgear/social-core';
import { securityLogger } from '../../common/logging/security-logger';
import { matchesAllTerms } from '../../common/search-terms';
import type { ChannelUsage } from '../billing/billing.types';
import { EntitlementsService } from '../billing/entitlements.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { type ChannelColors, colorOf, loadChannelColors } from './channel-colors';
import { type ChannelHandshake, ChannelOAuthService } from './channel-oauth.service';
import {
  type ChannelSummary,
  ChannelsRepository,
  type ChannelWithCredentials,
} from './channels.repository';

/** What the UI needs to render a channel's state at a glance. */
export type ChannelHealth =
  | 'connected'
  | 'needs_reconnect'
  | 'needs_setup'
  | 'expiring'
  | 'disabled';

/** A channel expiring within this window is worth warning about. */
const EXPIRY_WARNING_MS = 24 * 60 * 60 * 1_000;

export interface ChannelView extends ChannelSummary {
  health: ChannelHealth;
  providerName: string;
  /** The avatar palette slot, 0-based: see `channel-colors.ts`. */
  color: number;
}

/** A channel as a search result shows it (2026-10-21). */
export type ChannelSearchHit = Pick<
  ChannelView,
  'id' | 'name' | 'profile' | 'picture' | 'providerIdentifier' | 'providerName' | 'color' | 'health'
>;

/** What `GET /channels` says about the plan's ceiling (Sprint 8). */
export interface ChannelLimit {
  used: number;
  max: number;
  tier: ChannelUsage['tier'];
}

@Injectable()
export class ChannelsService {
  private readonly manager = new IntegrationManager();

  constructor(
    private readonly repository: ChannelsRepository,
    private readonly oauth: ChannelOAuthService,
    private readonly config: ConfigService,
    private readonly scheduling: SchedulingService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** Every provider, with whether it can actually be connected right now. */
  listProviders() {
    return this.manager.list();
  }

  /** Connected channels against the plan's limit, for the page's "n of m channels". */
  async limit(orgId: string): Promise<ChannelLimit> {
    const usage = await this.entitlements.channelUsage(orgId);
    return { used: usage.used, max: usage.limit, tier: usage.tier };
  }

  async list(orgId: string): Promise<ChannelView[]> {
    const [channels, colors] = await Promise.all([
      this.repository.listForOrg(orgId),
      this.colors(orgId),
    ]);

    return channels.map((channel) => ({
      ...channel,
      health: this.healthOf(channel),
      providerName:
        this.manager.find(channel.providerIdentifier)?.name ?? channel.providerIdentifier,
      color: colorOf(colors, channel.id),
    }));
  }

  /**
   * Channels whose name, handle or platform contains every search term
   * (2026-10-21), in the workspace's order but with names that start with the
   * search first.
   *
   * Filtered in memory from `list`: a workspace's channels are capped by its
   * plan, so a query would save nothing, and this way a search sees exactly the
   * channels (and health) the rest of the app does. Only what a result row
   * shows is returned; nothing here is a credential.
   */
  async search(
    orgId: string,
    terms: string[],
    limit: number,
  ): Promise<{ channels: ChannelSearchHit[]; more: boolean }> {
    const matches = (await this.list(orgId)).filter((channel) =>
      matchesAllTerms(
        [
          channel.name,
          channel.profile ?? '',
          channel.providerName,
          channel.providerIdentifier,
        ].join('\n'),
        terms,
      ),
    );

    const startsWith = (channel: ChannelView) => channel.name.toLowerCase().startsWith(terms[0]);
    // `sort` is stable, so channels in each group keep the workspace's order.
    const ranked = [...matches].sort((a, b) => Number(startsWith(b)) - Number(startsWith(a)));

    return {
      channels: ranked.slice(0, limit).map((channel) => ({
        id: channel.id,
        name: channel.name,
        profile: channel.profile,
        picture: channel.picture,
        providerIdentifier: channel.providerIdentifier,
        providerName: channel.providerName,
        color: channel.color,
        health: channel.health,
      })),
      more: ranked.length > limit,
    };
  }

  /**
   * Every channel's avatar colour, disconnected ones included, for payloads
   * that carry channels from post rows rather than from `list`.
   */
  colors(orgId: string): Promise<ChannelColors> {
    return loadChannelColors(orgId);
  }

  /**
   * Starts a handshake and returns the URL to redirect the browser to.
   *
   * The workspace is captured here, from the authenticated request, and carried
   * server-side: the callback is public and must not trust anything the
   * browser hands back.
   */
  async beginConnect(params: {
    provider: string;
    orgId: string;
    userId: string;
    reconnectChannelId?: string;
  }): Promise<string> {
    const provider = this.manager.get(params.provider);

    if (params.reconnectChannelId) {
      // Confirm the channel being reconnected belongs to this workspace before
      // recording it in the handshake, so a foreign id cannot be smuggled
      // through to the callback.
      const existing = await this.repository.findById(params.orgId, params.reconnectChannelId);

      if (!existing) {
        throw new NotFoundException('Channel not found');
      }
    } else {
      // The plan's ceiling (Sprint 8). Checked before the consent screen so a
      // person is told now, not after signing in to a platform for nothing. A
      // reconnect never adds a channel, so it is never refused here.
      await this.entitlements.assertCanConnect(params.orgId);
    }

    const redirectUri = this.redirectUriFor(provider.identifier);
    const generated = await provider.generateAuthUrl(redirectUri);

    const handshake: ChannelHandshake = {
      provider: provider.identifier,
      orgId: params.orgId,
      userId: params.userId,
      codeVerifier: generated.codeVerifier,
      reconnectChannelId: params.reconnectChannelId,
      returnPath: `/${params.orgId}/channels`,
    };

    const state = await this.oauth.begin(handshake);

    // The provider minted its own state for the URL it built; replace it with
    // ours, which is the one backed by server-side storage.
    const url = new URL(generated.url);
    url.searchParams.set('state', state);

    return url.toString();
  }

  /**
   * Completes a handshake.
   *
   * Returns the path to send the browser to. Never throws to the controller:
   * an OAuth callback always ends in a redirect, because the user arrived by
   * navigation and has nowhere to read an error body.
   */
  async completeConnect(params: {
    provider: string;
    code: string | undefined;
    state: string | undefined;
  }): Promise<{ path: string }> {
    const handshake = await this.oauth.consume(params.provider, params.state);

    if (!handshake || !params.code) {
      securityLogger.warn('channel.oauth.state_mismatch', { provider: params.provider });
      return { path: '/?error=channel_oauth' };
    }

    // The state proves the handshake started here, but membership can have been
    // revoked inside its lifetime. Re-check before writing anything.
    const membership = await prisma.userOrganization.findFirst({
      where: {
        userId: handshake.userId,
        organizationId: handshake.orgId,
        disabled: false,
      },
      select: { id: true },
    });

    if (!membership) {
      securityLogger.warn('channel.oauth.membership_revoked', {
        provider: params.provider,
        orgId: handshake.orgId,
      });
      return { path: '/?error=channel_oauth' };
    }

    try {
      const provider = this.manager.get(handshake.provider);
      const details = await provider.authenticate({
        code: params.code,
        codeVerifier: handshake.codeVerifier,
        redirectUri: this.redirectUriFor(provider.identifier),
      });

      if (!details.id || !details.accessToken) {
        throw new Error('Provider returned an incomplete authentication result');
      }

      if (handshake.reconnectChannelId) {
        const existing = await this.repository.findById(
          handshake.orgId,
          handshake.reconnectChannelId,
        );

        // The reconnect identity guard. Without it, a user who was signed into
        // the wrong account in the consent popup silently swaps that account's
        // credentials into this channel, and every scheduled post afterwards
        // goes somewhere they did not intend.
        if (existing && String(details.id) !== String(existing.rootInternalId)) {
          securityLogger.warn('channel.oauth.reconnect_mismatch', {
            orgId: handshake.orgId,
            channelId: existing.id,
          });
          return {
            path: `${handshake.returnPath}?error=wrong_account&provider=${provider.identifier}`,
          };
        }
      } else if (!(await this.hasRowFor(handshake.orgId, details.id))) {
        // Re-checked here because the limit can have been reached between the
        // handshake starting and the platform calling back: another admin
        // connecting at the same time, or a plan that ended meanwhile. Only a
        // genuinely new row counts: re-authorising an account that already
        // has a row (live, or disconnected and about to be resurrected by
        // the upsert) is a reconnect in all but name.
        const { allowed } = await this.entitlements.checkConnect(handshake.orgId);

        if (!allowed) {
          return { path: `${handshake.returnPath}?error=channel_limit` };
        }
      }

      const channel = await this.repository.upsertFromAuth({
        orgId: handshake.orgId,
        providerIdentifier: provider.identifier,
        internalId: details.id,
        rootInternalId: details.id,
        name: this.nameFor(details.name, details.username, details.id),
        token: details.accessToken,
        refreshToken: details.refreshToken ?? null,
        expiresIn: details.expiresIn,
        profile: details.username ?? null,
        picture: details.picture ?? null,
        inBetweenSteps: details.requiresEntitySelection ?? false,
        isReconnect: Boolean(handshake.reconnectChannelId),
      });

      // A fresh token comes with a fresh expiry; the refresh loop (Sprint 5)
      // is started, or woken to read the new date.
      await this.scheduling.ensureTokenRefresh(channel.id, handshake.orgId);

      const query = channel.inBetweenSteps
        ? `?setup=${channel.id}`
        : `?connected=${encodeURIComponent(channel.name)}`;

      return { path: `${handshake.returnPath}${query}` };
    } catch (error) {
      securityLogger.warn('channel.oauth.failed', {
        provider: params.provider,
        orgId: handshake.orgId,
        // The provider's own message, never its response body: that can echo
        // back the client secret.
        reason: error instanceof Error ? error.name : 'unknown',
      });

      return { path: `${handshake.returnPath}?error=channel_oauth` };
    }
  }

  /** The pages / channels / boards a half-connected channel can be pointed at. */
  async listEntities(orgId: string, channelId: string): Promise<ProviderEntity[]> {
    const channel = await this.requireCredentials(orgId, channelId);
    const provider = this.manager.get(channel.providerIdentifier);

    if (!supportsEntitySelection(provider)) {
      return [];
    }

    return provider.listEntities(channel.token);
  }

  /** Commits the user's choice and makes the channel publishable. */
  async selectEntity(orgId: string, channelId: string, entityId: string): Promise<ChannelSummary> {
    const channel = await this.requireCredentials(orgId, channelId);
    const provider = this.manager.get(channel.providerIdentifier);

    if (!supportsEntitySelection(provider)) {
      throw new NotFoundException('Channel not found');
    }

    const entity = await provider.selectEntity(channel.token, entityId);

    const completed = await this.repository.completeEntitySelection({
      orgId,
      id: channelId,
      entityId: entity.id,
      name: entity.name,
      picture: entity.picture ?? null,
      profile: entity.username ?? null,
      // Where the platform issues a scoped token (Facebook Pages, Instagram via
      // its Page), it replaces the user token: that is what the publishing
      // endpoints actually accept.
      token: entity.accessToken,
    });

    await this.scheduling.ensureTokenRefresh(completed.id, orgId);

    return completed;
  }

  async updateSettings(params: {
    orgId: string;
    id: string;
    name?: string;
    postingTimes?: { time: number }[];
    color?: number;
    disabled?: boolean;
  }): Promise<ChannelSummary> {
    const updated = await this.repository.updateSettings(params);

    if (!updated) {
      throw new NotFoundException('Channel not found');
    }

    return updated;
  }

  /**
   * The workspace's channel order, after an admin's drag (UI revamp,
   * 2026-10-19). `ids` lead in that order and any live channel left out
   * keeps its place after them; an id that is not one of the workspace's
   * live channels refuses the whole list. Returns the list in its new order.
   */
  async reorder(orgId: string, ids: string[]): Promise<ChannelView[]> {
    const applied = await this.repository.setOrder(orgId, ids);

    if (!applied) {
      throw new BadRequestException('One of those channels is not in this workspace');
    }

    return this.list(orgId);
  }

  /** How many queued posts a disconnect would send back to drafts. */
  async previewDisconnect(orgId: string, id: string): Promise<{ queuedPosts: number }> {
    const channel = await this.repository.findById(orgId, id);

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    return { queuedPosts: await this.repository.countQueuedPosts(orgId, id) };
  }

  /**
   * Disconnects a channel: revoke remotely, then clear and soft-delete.
   *
   * Revocation is best-effort by design. A user asking to disconnect gets
   * disconnected whether or not the platform cooperates: failing the request
   * because a third party is down would leave them stuck with a channel they
   * have asked to remove.
   */
  async disconnect(orgId: string, id: string): Promise<{ draftedPosts: number }> {
    const channel = await this.repository.getWithCredentials(orgId, id);

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    const provider = this.manager.find(channel.providerIdentifier);

    if (provider?.revoke && channel.token) {
      try {
        await provider.revoke(channel.token);
      } catch (error) {
        securityLogger.warn('channel.revoke.failed', {
          orgId,
          channelId: id,
          provider: channel.providerIdentifier,
          reason: error instanceof Error ? error.name : 'unknown',
        });
      }
    }

    const result = await this.repository.disconnect(orgId, id);

    // Their rows are drafts now; the workflows waiting on them have nothing
    // to publish and are told so rather than left to discover it.
    await this.scheduling.cancelPublish(result.draftedRootIds);

    return { draftedPosts: result.draftedPosts };
  }

  /**
   * Refreshes a channel's access token.
   *
   * Shared by the on-demand path here and, from Sprint 5, the scheduled refresh
   * workflow. A provider that cannot refresh returns an empty access token
   * rather than throwing, so "no refresh support" and "refresh failed" land in
   * the same branch: the channel is flagged, and the user is asked to reconnect.
   */
  async refresh(orgId: string, id: string): Promise<boolean> {
    const channel = await this.repository.getWithCredentials(orgId, id);

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    const provider = this.manager.find(channel.providerIdentifier);

    if (!provider) {
      return false;
    }

    try {
      const refreshed = await provider.refreshToken(channel.refreshToken ?? '');

      if (!refreshed.accessToken) {
        await this.repository.markRefreshNeeded(orgId, id);
        return false;
      }

      await this.repository.applyRefreshedToken({
        orgId,
        id,
        token: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresIn: refreshed.expiresIn,
      });

      // One grant can cover several channels: a LinkedIn member plus the
      // pages they administer. Siblings share a `rootInternalId` and would
      // otherwise keep holding the superseded token.
      if (channel.rootInternalId !== channel.internalId || refreshed.refreshToken) {
        await this.repository.propagateTokenToSiblings({
          orgId,
          rootInternalId: channel.rootInternalId,
          exceptId: id,
          token: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          expiresIn: refreshed.expiresIn,
        });
      }

      // The scheduled refresh loop re-reads the new expiry.
      await this.scheduling.ensureTokenRefresh(id, orgId);

      return true;
    } catch (error) {
      securityLogger.warn('channel.refresh.failed', {
        orgId,
        channelId: id,
        provider: channel.providerIdentifier,
        reason: error instanceof Error ? error.name : 'unknown',
      });

      await this.repository.markRefreshNeeded(orgId, id);
      return false;
    }
  }

  /**
   * Publishes through a channel.
   *
   * Sprint 4 owns the composer and Sprint 5 the scheduler; this exists so the
   * provider `post()` implementations are reachable and the sprint's "publish a
   * test post" requirement is checkable without either of them.
   */
  async publish(orgId: string, id: string, posts: PostDetails[]): Promise<PostResponse[]> {
    const channel = await this.requireCredentials(orgId, id);
    const provider = this.manager.get(channel.providerIdentifier);

    const invalid = await provider.checkValidity(posts);

    if (invalid !== true) {
      throw new ForbiddenException(invalid);
    }

    try {
      return await provider.post(this.toContext(channel), channel.token, posts);
    } catch (error) {
      // A dead credential discovered at publish time is the signal that drives
      // the "Reconnect" affordance in the UI. Sprint 5 additionally retries the
      // post once a refresh succeeds.
      if (error instanceof RefreshTokenError) {
        await this.repository.markRefreshNeeded(orgId, id);
      }
      throw error;
    }
  }

  /**
   * A channel that is usable: exists, is configured, and has credentials.
   *
   * `inBetweenSteps` is deliberately allowed here: the entity-selection calls
   * need the user token precisely while the channel is half-configured.
   */
  private async requireCredentials(orgId: string, id: string): Promise<ChannelWithCredentials> {
    const channel = await this.repository.getWithCredentials(orgId, id);

    if (!channel?.token) {
      throw new NotFoundException('Channel not found');
    }

    return channel;
  }

  private toContext(channel: ChannelWithCredentials): ChannelContext {
    return {
      id: channel.id,
      internalId: channel.internalId,
      rootInternalId: channel.rootInternalId,
      providerIdentifier: channel.providerIdentifier,
      name: channel.name,
      profile: channel.profile,
      additionalSettings: channel.additionalSettings,
    };
  }

  /**
   * Whether a row, live or soft-deleted, already holds this platform id for
   * the workspace. The upsert in `completeConnect` keys on exactly this pair,
   * so "a row exists" is "no new channel will be created".
   */
  private async hasRowFor(orgId: string, internalId: string): Promise<boolean> {
    const row = await prisma.integration.findFirst({
      where: { organizationId: orgId, internalId: String(internalId) },
      select: { id: true },
    });

    return row !== null;
  }

  /**
   * The callback URL, built the same way in `generateAuthUrl` and
   * `authenticate`: platforms compare the two and reject a mismatch.
   */
  private redirectUriFor(providerIdentifier: string): string {
    const apiUrl = this.config.get<string>('API_URL', 'http://localhost:3001');
    return `${apiUrl}/channels/connect/${providerIdentifier}/callback`;
  }

  /**
   * Providers do return blank names. A list of unnamed rows is worse than one
   * ugly generated label.
   */
  private nameFor(name: string | undefined, username: string | undefined, id: string): string {
    return name?.trim() || username?.trim() || `Channel ${id.slice(0, 8)}`;
  }

  private healthOf(channel: ChannelSummary): ChannelHealth {
    // Order matters: a channel can satisfy several of these, and this is the
    // priority the user needs. "Finish setup" outranks everything because
    // nothing else can be true of a channel with no target yet.
    if (channel.inBetweenSteps) {
      return 'needs_setup';
    }
    if (channel.refreshNeeded) {
      return 'needs_reconnect';
    }
    if (channel.disabled) {
      return 'disabled';
    }
    if (
      channel.tokenExpiration &&
      channel.tokenExpiration.getTime() - Date.now() < EXPIRY_WARNING_MS
    ) {
      return 'expiring';
    }
    return 'connected';
  }

  /** True when the failure was a missing client id rather than a user error. */
  static isNotConfigured(error: unknown): boolean {
    return error instanceof ProviderNotConfiguredError;
  }

  /** Exposed for the module's own typing convenience. */
  getProvider(identifier: string): SocialProvider {
    return this.manager.get(identifier);
  }
}
