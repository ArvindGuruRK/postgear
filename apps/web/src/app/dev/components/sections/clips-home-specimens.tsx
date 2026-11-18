'use client';

/**
 * Module 06's Clips pieces on made-up answers (`clips-fixtures.ts`): the link
 * card in each state, a video card in each state (one with "About 4 minutes
 * left"), the storage meter at 20%, 85% and 100%, the AI minutes chip at
 * plenty, low and none, and My Channels with one row in each state. Nothing
 * here reaches the API: imports, hides and probes answer from memory.
 */
import { toast } from '@postgear/ui';
import { useMemo, useState } from 'react';
import type { ChannelBrowserApi } from '@/components/clips/channels/channel-browser';
import { ChannelBrowser } from '@/components/clips/channels/channel-browser';
import type { ChannelsState } from '@/components/clips/channels/use-channels';
import {
  FIXTURE_CARDS,
  FIXTURE_CHANNEL,
  FIXTURE_STREAMS,
  fixtureProbe,
  fixtureStatus,
} from '@/components/clips/clips-fixtures';
import { AiMinutesChipView, StorageMeter } from '@/components/clips/home/clips-meters';
import { LinkCard, LinkCardSkeleton } from '@/components/clips/home/link-card';
import { RefusalAlert } from '@/components/clips/home/refusal-alert';
import { type VideoCardActions, VideoCard } from '@/components/clips/home/video-card';
import type { ClipImportOutcome } from '@/types/clips';
import { Row, Spec } from '../shared';

const ORG = 'playground';
const GB = 1_000_000_000;
const CYCLE_END = '2026-12-01T00:00:00.000Z';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Import answers after a moment, as the API would. */
async function fakeImport(): Promise<ClipImportOutcome> {
  await wait(600);
  return { video: FIXTURE_CARDS.busy.video, job: FIXTURE_CARDS.busy.job, existing: false };
}

const CARD_ACTIONS: VideoCardActions = {
  onCancel: async () => wait(400),
  onRetry: async () => wait(400),
  onDelete: async () => wait(400),
  onSettled: () => undefined,
};

const BROWSER_API: ChannelBrowserApi = {
  list: async (_channelId, options = {}) => {
    await wait(300);
    const items = options.hidden ? FIXTURE_STREAMS : FIXTURE_STREAMS.filter((item) => !item.hidden);
    return {
      kind: options.kind ?? 'streams',
      sort: options.sort ?? 'newest',
      period: options.period ?? null,
      items: [...items],
      nextCursor: null,
      updatedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
      stale: false,
      capped: false,
      notice: null,
    };
  },
  refresh: async () => {
    await wait(300);
    return { refreshedAt: new Date().toISOString() };
  },
  probe: async () => {
    await wait(500);
    return fixtureProbe();
  },
  hide: async (_channelId, externalId) => ({ externalId, hidden: true }),
  unhide: async (_channelId, externalId) => ({ externalId, hidden: false }),
  remove: async () => ({ message: 'The channel was removed.' }),
  check: async (platform, handle) => {
    await wait(400);
    return { platform, handle, displayName: handle, avatarUrl: null };
  },
  add: async (platform, handle) => {
    await wait(400);
    return { ...FIXTURE_CHANNEL, id: `channel-${handle}`, platform, handle, displayName: handle };
  },
};

function useFixtureChannels(): ChannelsState {
  const [channels, setChannels] = useState([FIXTURE_CHANNEL]);
  return useMemo(
    () => ({
      channels,
      loading: false,
      error: null,
      reload: () => undefined,
      added: (channel) => setChannels((current) => [channel, ...current]),
      removed: (id) => setChannels((current) => current.filter((one) => one.id !== id)),
    }),
    [channels],
  );
}

function meterAt(remaining: number) {
  return { limit: 300, remaining, cycleEnd: CYCLE_END };
}

export function ClipsHomeSpecimens() {
  const channels = useFixtureChannels();

  return (
    <>
      <Row label="LinkCard: found, already here, reading, refused">
        <div className="flex w-full flex-col gap-4">
          <LinkCard
            probe={fixtureProbe()}
            orgId={ORG}
            importFn={fakeImport}
            onImported={() => toast({ title: 'Import started (playground).' })}
          />
          <LinkCard
            probe={fixtureProbe({ existingVideoId: 'video-ready' })}
            orgId={ORG}
            onImported={() => undefined}
          />
          <LinkCardSkeleton />
          <RefusalAlert
            message="Vimeo links are not supported. You can upload the file instead."
            code="link_unsupported"
            orgId={ORG}
            onUpload={() => undefined}
          />
          <RefusalAlert
            message="This workspace has used its import minutes for this month."
            code="clips_import_minutes"
            orgId={ORG}
          />
        </div>
        <Spec>LinkCard bg-inset; RefusalAlert = Alert warning + Upload A Video or See Plans</Spec>
      </Row>

      <Row label="VideoCard: ready, coming in (about 4 minutes left), waiting, failed">
        <ul className="m-0 grid w-full list-none grid-cols-4 gap-4 p-0">
          {(['ready', 'busy', 'waiting', 'failed'] as const).map((state) => (
            <VideoCard
              key={state}
              card={FIXTURE_CARDS[state]}
              orgId={ORG}
              actions={CARD_ACTIONS}
              follow={false}
            />
          ))}
        </ul>
      </Row>

      <Row label="StorageMeter: 20%, 85%, 100%">
        {[0.2, 0.85, 1].map((share) => (
          <StorageMeter
            key={share}
            status={fixtureStatus({
              storage: { usedBytes: share * 20 * GB, limitBytes: 20 * GB },
              usage: { storageBytes: share * 20 * GB },
            })}
          />
        ))}
        <Spec>Progress sm: primary, accent at 80% and up, danger at 90% and up</Spec>
      </Row>

      <Row label="AiMinutesChip: plenty, low, none">
        <AiMinutesChipView meter={meterAt(240)} orgId={ORG} />
        <AiMinutesChipView meter={meterAt(18)} orgId={ORG} />
        <AiMinutesChipView meter={meterAt(0)} orgId={ORG} />
      </Row>

      <Row label="ChannelBrowser: ready, live, processing, imported, hidden (Show Hidden)">
        <div className="w-full rounded-card border-2 border-outline bg-chrome p-5 shadow-surfaceSm">
          <ChannelBrowser
            orgId={ORG}
            platforms={['youtube', 'twitch', 'kick']}
            channelsState={channels}
            api={BROWSER_API}
            onProbed={() => toast({ title: 'The link card would open here.' })}
          />
        </div>
      </Row>
      <Row label="ChannelBrowser: no channel yet">
        <div className="w-full rounded-card border-2 border-outline bg-chrome p-5 shadow-surfaceSm">
          <ChannelBrowser
            orgId={ORG}
            platforms={['youtube', 'twitch', 'kick']}
            channelsState={{
              channels: [],
              loading: false,
              error: null,
              reload: () => undefined,
              added: () => undefined,
              removed: () => undefined,
            }}
            api={BROWSER_API}
            onProbed={() => undefined}
          />
        </div>
      </Row>
    </>
  );
}
