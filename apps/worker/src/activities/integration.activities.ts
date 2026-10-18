/**
 * The activities behind `tokenRefreshWorkflow`, shared with the publish
 * workflow's refresh branch.
 *
 * ## A second encryption boundary, deliberately small
 *
 * `apps/api/src/modules/channels/channels.repository.ts` is where credentials
 * are encrypted on the way in and decrypted on the way out, and it has been the
 * only such place since Sprint 3. The worker cannot call it (it is a Nest
 * provider in another process) and refreshing a token is unavoidably a write
 * of a new ciphertext. So this file is the second place that hands ciphertext
 * to Prisma, and it follows the same rules: every `where` carries the
 * organization and `deletedAt: null`; a refresh writes only the three
 * credential columns (never the name, never the handle: the reference's
 * refresh bug); siblings of one grant share the new token; and a failure flips
 * `refreshNeeded`, which is the flag the UI reads to offer "Reconnect".
 */
import { decryptNullable, encrypt, NotificationEmailStatus, prisma } from '@postgear/db';
import type { TokenRefreshInput } from '@postgear/scheduling';
import { ProviderError, RetryableError } from '@postgear/social-core';
import type { ActivityDeps } from './deps';

/** Refresh this long before the token expires. */
export const REFRESH_LEAD_MS = 30 * 60_000;

export type IntegrationSchedule =
  | { status: 'active'; refreshAt: string; expiresAt: string }
  | {
      status: 'skip';
      reason: 'gone' | 'needs_reconnect' | 'not_set_up' | 'no_refresh_token' | 'no_expiry';
    };

export function createIntegrationActivities(deps: ActivityDeps) {
  return {
    /** When this channel's token should next be refreshed, or why never. */
    async loadIntegrationSchedule(input: TokenRefreshInput): Promise<IntegrationSchedule> {
      const row = await prisma.integration.findFirst({
        where: { id: input.integrationId, organizationId: input.organizationId },
        select: {
          deletedAt: true,
          refreshNeeded: true,
          inBetweenSteps: true,
          refreshToken: true,
          tokenExpiration: true,
        },
      });

      if (!row || row.deletedAt) {
        return { status: 'skip', reason: 'gone' };
      }
      if (row.refreshNeeded) {
        return { status: 'skip', reason: 'needs_reconnect' };
      }
      if (row.inBetweenSteps) {
        return { status: 'skip', reason: 'not_set_up' };
      }
      if (!row.refreshToken) {
        return { status: 'skip', reason: 'no_refresh_token' };
      }
      if (!row.tokenExpiration) {
        return { status: 'skip', reason: 'no_expiry' };
      }

      return {
        status: 'active',
        refreshAt: new Date(row.tokenExpiration.getTime() - REFRESH_LEAD_MS).toISOString(),
        expiresAt: row.tokenExpiration.toISOString(),
      };
    },

    /**
     * Exchanges the refresh token for new credentials and stores them.
     *
     * Returns false, and flags the channel, when the platform *refuses*: no
     * provider, a provider that cannot refresh, a revoked grant. A platform
     * that is merely unreachable throws instead, so Temporal's activity retry
     * tries again in a minute rather than demanding a re-authorisation for a
     * thirty-second blip. The caller never retries a refresh that returned
     * false; the person has to reconnect.
     */
    async refreshChannelToken(input: TokenRefreshInput): Promise<boolean> {
      const row = await prisma.integration.findFirst({
        where: { id: input.integrationId, organizationId: input.organizationId, deletedAt: null },
        select: {
          id: true,
          internalId: true,
          rootInternalId: true,
          providerIdentifier: true,
          refreshToken: true,
        },
      });

      if (!row) {
        return false;
      }

      const refreshToken = row.refreshToken ? decryptNullable(row.refreshToken) : null;

      try {
        const provider = deps.publisher.resolve(row.providerIdentifier);
        const refreshed = await provider.refreshToken(refreshToken ?? '');

        if (!refreshed.accessToken) {
          await markRefreshNeeded(input);
          return false;
        }

        const credentials = {
          token: encrypt(refreshed.accessToken),
          ...(refreshed.refreshToken ? { refreshToken: encrypt(refreshed.refreshToken) } : {}),
          ...(refreshed.expiresIn
            ? { tokenExpiration: new Date(Date.now() + refreshed.expiresIn * 1_000) }
            : {}),
          refreshNeeded: false,
        };

        await prisma.$transaction([
          prisma.integration.updateMany({
            where: { id: row.id, organizationId: input.organizationId, deletedAt: null },
            data: credentials,
          }),
          // One grant can cover several channels (a LinkedIn member plus the
          // pages they administer), which share a rootInternalId and would
          // otherwise keep a superseded token.
          prisma.integration.updateMany({
            where: {
              organizationId: input.organizationId,
              rootInternalId: row.rootInternalId ?? row.internalId,
              id: { not: row.id },
              deletedAt: null,
            },
            data: credentials,
          }),
        ]);

        return true;
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: 'channel.refresh.failed',
            orgId: input.organizationId,
            channelId: input.integrationId,
            provider: row.providerIdentifier,
            reason: error instanceof Error ? error.name : 'unknown',
          }),
        );

        // Transient (rate limit, 5xx, network) or unclassified: not the token's
        // fault. Rethrown so the activity is retried by its policy.
        if (error instanceof RetryableError || !(error instanceof ProviderError)) {
          throw error;
        }

        await markRefreshNeeded(input);
        return false;
      }
    },
  };
}

export type IntegrationActivities = ReturnType<typeof createIntegrationActivities>;

async function markRefreshNeeded(input: TokenRefreshInput): Promise<void> {
  await prisma.integration.updateMany({
    where: { id: input.integrationId, organizationId: input.organizationId, deletedAt: null },
    data: { refreshNeeded: true },
  });

  try {
    await notifyReconnectNeeded(input);
  } catch (error) {
    // The flag is the write that matters; a missed notification is logged, not thrown.
    console.warn(
      JSON.stringify({
        event: 'channel.reconnect_notification.failed',
        orgId: input.organizationId,
        channelId: input.integrationId,
        reason: error instanceof Error ? error.message : 'unknown',
      }),
    );
  }
}

/** A refresh loop re-runs on every wake-up; one reconnect prompt a day per channel is enough. */
const RECONNECT_NOTICE_WINDOW_MS = 24 * 60 * 60_000;

/**
 * Tells the workspace a channel needs reconnecting (Sprint 8): a
 * `channel.needs_reconnect` row the API's dispatcher emails to members with
 * failure emails on, written at most once per channel per day.
 */
async function notifyReconnectNeeded(input: TokenRefreshInput): Promise<void> {
  const channel = await prisma.integration.findFirst({
    where: { id: input.integrationId, organizationId: input.organizationId },
    select: { name: true, providerIdentifier: true },
  });

  if (!channel) {
    return;
  }

  const content = `${channel.name} needs reconnecting before PostGear can publish to it.`;
  const link = `/${input.organizationId}/channels`;

  const recent = await prisma.notifications.findFirst({
    where: {
      organizationId: input.organizationId,
      type: 'channel.needs_reconnect',
      link,
      content,
      deletedAt: null,
      createdAt: { gt: new Date(Date.now() - RECONNECT_NOTICE_WINDOW_MS) },
    },
    select: { id: true },
  });

  if (recent) {
    return;
  }

  await prisma.notifications.create({
    data: {
      organizationId: input.organizationId,
      type: 'channel.needs_reconnect',
      title: 'Channel needs reconnecting',
      content,
      link,
      emailStatus: NotificationEmailStatus.PENDING,
      meta: {
        channelId: input.integrationId,
        channelName: channel.name,
        provider: channel.providerIdentifier,
      },
    },
  });
}
