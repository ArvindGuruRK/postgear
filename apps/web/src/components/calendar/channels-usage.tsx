'use client';

/**
 * The foot of the calendar's channel card (UI revamp, 2026-10-19), after
 * Buffer's sidebar: its "Connect channels" row of platform icons and its
 * "0/3 channels connected" card, folded into the channel card because the
 * rail here is too narrow to hold them.
 *
 * - **Quick connect** (admins, while the plan has room): one icon per
 *   platform this deployment can connect that the workspace has no channel
 *   on yet, most used first. A click starts that platform's handshake
 *   directly, the same navigation the Add Channel dialog's tile makes.
 * - **Usage**: "2 of 5 channels" over a meter with one segment per channel
 *   the plan allows (a plain bar past `MAX_SEGMENTS`, where segments would
 *   be slivers). It turns danger at 90%, as `UsageMeter` does everywhere, and
 *   at the limit an admin gets the way to billing. Hidden without a limit
 *   (no workspace) or with one so large it never binds.
 */
import { cn, pressSm, TooltipHint } from '@postgear/ui';
import Link from 'next/link';
import { byPopularity } from '@/components/channels/connect-channel-dialog';
import { PlatformIcon } from '@/components/platforms/platform-icon';
import { channelConnectUrl } from '@/lib/api';
import type { Channel, ChannelLimit, ProviderSummary } from '@/types/channel';

/** More segments than this and each would be too thin to read: a plain bar instead. */
const MAX_SEGMENTS = 15;

/** A ceiling this high (a hand-granted entitlement) never binds: no meter. */
const EFFECTIVELY_UNLIMITED = 1_000;

const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

export function ChannelsUsage({
  orgId,
  channels,
  providers,
  limit,
  canManage,
  className,
}: {
  orgId: string;
  channels: Channel[];
  providers: ProviderSummary[];
  limit: ChannelLimit | null;
  canManage: boolean;
  className?: string;
}) {
  const metered = limit !== null && limit.max > 0 && limit.max < EFFECTIVELY_UNLIMITED;
  const atLimit = limit !== null && limit.used >= limit.max;

  const connected = new Set(channels.map((channel) => channel.providerIdentifier));
  const unconnected =
    canManage && !atLimit
      ? byPopularity(providers).filter(
          (provider) => provider.configured && !connected.has(provider.identifier),
        )
      : [];

  if (!metered && unconnected.length === 0) {
    return null;
  }

  return (
    <div data-testid="channels-usage" className={cn('flex shrink-0 flex-col gap-3', className)}>
      {unconnected.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="type-label text-xs text-ink muted-tone">Connect channels</span>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {unconnected.map((provider) => (
              <li key={provider.identifier}>
                <TooltipHint label={`Connect ${provider.name}`} side="top">
                  <button
                    type="button"
                    aria-label={`Connect ${provider.name}`}
                    data-testid="quick-connect"
                    data-provider={provider.identifier}
                    onClick={() => {
                      // A full navigation: the consent screen is the
                      // platform's page, as from the Add Channel dialog.
                      window.location.href = channelConnectUrl(provider.identifier);
                    }}
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-md border-2 border-outline bg-secondary',
                      pressSm,
                      FOCUS,
                    )}
                  >
                    <PlatformIcon platform={provider.identifier} className="h-5 w-5" />
                  </button>
                </TooltipHint>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {metered && limit ? <UsageLine orgId={orgId} limit={limit} canManage={canManage} /> : null}
    </div>
  );
}

function UsageLine({
  orgId,
  limit,
  canManage,
}: {
  orgId: string;
  limit: ChannelLimit;
  canManage: boolean;
}) {
  const atLimit = limit.used >= limit.max;
  const nearLimit = limit.used / limit.max >= 0.9;
  const fill = nearLimit ? 'bg-actionDanger' : 'bg-actionPrimary';

  return (
    <div
      className="flex flex-col gap-2"
      data-testid="channels-usage-line"
      data-used={limit.used}
      data-max={limit.max}
    >
      <div className="flex items-baseline justify-between gap-2 font-sans text-xs text-ink">
        <span className={cn(nearLimit ? 'text-dangerInk' : 'type-muted')}>
          {limit.used} of {limit.max} {limit.max === 1 ? 'channel' : 'channels'}
        </span>
        {atLimit && canManage ? (
          <Link
            href={`/${orgId}/settings/billing`}
            className={cn('rounded-sm type-ui underline underline-offset-2', FOCUS)}
          >
            Upgrade
          </Link>
        ) : null}
      </div>
      {/* The numbers are written above it, so the meter is not read out. */}
      {limit.max <= MAX_SEGMENTS ? (
        <div aria-hidden="true" className="flex gap-1">
          {Array.from({ length: limit.max }, (_, index) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: the segments are positions, nothing reorders them
              key={index}
              className={cn('h-1.5 flex-1 rounded-full', index < limit.used ? fill : 'bg-ink/15')}
            />
          ))}
        </div>
      ) : (
        <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-ink/15">
          <div
            className={cn('h-full rounded-full', fill)}
            style={{ width: `${Math.min(100, (limit.used / limit.max) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
