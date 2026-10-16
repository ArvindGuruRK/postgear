'use client';

import { Alert, Button, EmptyState, Grid, Link as UiLink, PageHeader, Stack, Text } from '@postgear/ui';
import { Radio } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { type MouseEvent, useMemo, useState } from 'react';
import { channelConnectUrl } from '@/lib/api';
import type { Channel, ChannelLimit, ProviderSummary } from '@/types/channel';
import { ChannelCard } from './channel-card';
import { isBroken } from './channel-health';
import { ConnectChannelDialog } from './connect-channel-dialog';
import { DisconnectDialog } from './disconnect-dialog';
import { FinishSetupDialog } from './finish-setup-dialog';
import { PostingTimesDialog } from './posting-times-dialog';

interface ChannelsViewProps {
  orgId: string;
  initialChannels: Channel[];
  providers: ProviderSummary[];
  canManage: boolean;
  /** The plan's ceiling (Sprint 8); null only when no workspace is active. */
  limit: ChannelLimit | null;
}

/** Copy for the `?error=` codes the API's callback can redirect back with. */
const ERROR_MESSAGES: Record<string, string> = {
  channel_oauth: 'We could not connect that account. Please try again.',
  wrong_account:
    'That is a different account from the one this channel uses. Sign in to the original account and try again.',
  unknown_provider: 'PostGear does not support that platform.',
  no_workspace: 'Select a workspace before connecting a channel.',
  channel_limit:
    'This workspace has reached its plan’s channel limit. Upgrade the plan to connect more channels.',
};

export function ChannelsView({ orgId, initialChannels, providers, canManage, limit }: ChannelsViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const billingHref = `/${orgId}/settings/billing`;
  // The plan's ceiling (Sprint 8). Enforced by the API where a channel is
  // connected; reflected here so the button does not offer what would only
  // bounce back with `?error=channel_limit`.
  const atLimit = limit !== null && limit.used >= limit.max;

  // The design system's `Link` is a plain anchor; routing through Next keeps
  // the navigation client-side without copying its classes onto a NextLink.
  function goToBilling(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    router.push(billingHref);
  }

  const [connectOpen, setConnectOpen] = useState(false);
  const [setupChannel, setSetupChannel] = useState<Channel | null>(null);
  const [timesChannel, setTimesChannel] = useState<Channel | null>(null);
  const [disconnectChannel, setDisconnectChannel] = useState<Channel | null>(null);

  const errorCode = searchParams.get('error');
  const connectedName = searchParams.get('connected');
  const setupId = searchParams.get('setup');

  // A channel that came back from OAuth needing an account chosen opens the
  // picker straight away — the user is already in that flow, and making them
  // find the button again is a step for nothing.
  const pendingSetup = useMemo(
    () => (setupId ? (initialChannels.find((c) => c.id === setupId) ?? null) : null),
    [setupId, initialChannels],
  );

  const activeSetup = setupChannel ?? pendingSetup;

  /**
   * How many channels currently cannot publish.
   *
   * Surfaced as a page-level count rather than only as a badge on each card:
   * a broken channel silently stops everything scheduled to it, and a small
   * indicator on an avatar is easy to never notice.
   */
  const brokenCount = initialChannels.filter((channel) => isBroken(channel.health)).length;

  function refresh() {
    setSetupChannel(null);
    setTimesChannel(null);
    setDisconnectChannel(null);
    // Clears the ?connected / ?setup / ?error params so a reload does not
    // replay the same banner or reopen the dialog.
    router.replace(window.location.pathname);
    router.refresh();
  }

  return (
    <Stack gap="lg">
      <PageHeader
        title="Channels"
        description="The social accounts PostGear can publish to."
        actions={
          canManage ? (
            <Button onClick={() => setConnectOpen(true)} disabled={atLimit}>
              Connect a channel
            </Button>
          ) : undefined
        }
      />

      {limit ? (
        <Text
          size="sm"
          muted={!atLimit}
          data-testid="channels-limit"
          data-used={limit.used}
          data-max={limit.max}
          data-tier={limit.tier}
        >
          {limit.used} of {limit.max} {limit.max === 1 ? 'channel' : 'channels'} on the{' '}
          {limit.tier === 'FREE' ? 'Free' : limit.tier.charAt(0) + limit.tier.slice(1).toLowerCase()}{' '}
          plan.
          {atLimit ? (
            <>
              {' '}
              <UiLink href={billingHref} onClick={goToBilling}>
                Upgrade the plan
              </UiLink>{' '}
              to connect more.
            </>
          ) : null}
        </Text>
      ) : null}

      {errorCode ? (
        <Alert variant="danger" className="flex-wrap">
          <span>{ERROR_MESSAGES[errorCode] ?? 'Something went wrong. Please try again.'}</span>
          {errorCode === 'channel_limit' ? (
            // The alert is filled, so the link takes the fill's text colour
            // rather than the primary blue it would wear on a plain surface.
            <UiLink href={billingHref} onClick={goToBilling} className="text-onActionLight">
              Go to billing
            </UiLink>
          ) : null}
        </Alert>
      ) : null}

      {connectedName ? <Alert variant="success">{connectedName} is connected.</Alert> : null}

      {brokenCount > 0 ? (
        <Alert variant="warning">
          {brokenCount} {brokenCount === 1 ? 'channel needs' : 'channels need'} attention. Nothing
          will publish to {brokenCount === 1 ? 'it' : 'them'} until fixed.
        </Alert>
      ) : null}

      {initialChannels.length === 0 ? (
        <EmptyState
          icon={Radio}
          title="No channels yet"
          description="Connect a social account and PostGear can start publishing to it."
          {...(canManage
            ? { action: { label: 'Connect a channel', onClick: () => setConnectOpen(true) } }
            : {})}
        />
      ) : (
        <Grid cols={2} gap="md">
          {initialChannels.map((channel) => (
            <ChannelCard
              key={channel.id}
              channel={channel}
              canManage={canManage}
              onReconnect={(target) => {
                // Reconnect restarts the handshake for this specific channel,
                // passing PostGear's own id so the API can verify the same
                // account is re-authorized rather than a different one.
                window.location.href = channelConnectUrl(target.providerIdentifier, target.id);
              }}
              onFinishSetup={setSetupChannel}
              onEditTimes={setTimesChannel}
              onDisconnect={setDisconnectChannel}
            />
          ))}
        </Grid>
      )}

      {!canManage ? (
        <Text size="sm" muted>
          Only workspace admins can connect or remove channels.
        </Text>
      ) : null}

      <ConnectChannelDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        providers={providers}
      />

      <FinishSetupDialog
        channel={activeSetup}
        onOpenChange={(open) => {
          if (!open) {
            setSetupChannel(null);
            if (pendingSetup) {
              router.replace(window.location.pathname);
            }
          }
        }}
        onDone={refresh}
      />

      <PostingTimesDialog
        channel={timesChannel}
        onOpenChange={(open) => !open && setTimesChannel(null)}
        onDone={refresh}
      />

      <DisconnectDialog
        channel={disconnectChannel}
        onOpenChange={(open) => !open && setDisconnectChannel(null)}
        onDone={refresh}
      />
    </Stack>
  );
}
