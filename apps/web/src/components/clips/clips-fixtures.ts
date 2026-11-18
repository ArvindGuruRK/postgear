/**
 * Made-up Clips answers for the `/dev/components` playground and the web
 * tests: every shape is the real API type, so a change to a type breaks here
 * first. Nothing in this file is shipped to a real page.
 */
import type {
  ClipChannelView,
  ClipJobView,
  ClipProbe,
  ClipsStatus,
  ClipStreamItem,
  ClipVideoCard,
  ClipVideoView,
} from '@/types/clips';

const NOW = '2026-11-18T10:00:00.000Z';

export function fixtureVideo(overrides: Partial<ClipVideoView> = {}): ClipVideoView {
  return {
    id: 'video-ready',
    platform: 'twitch',
    kind: 'past_stream',
    title: 'Friday Night Speedrun, Any Percent Attempts',
    channelName: 'simstreamer',
    link: 'https://www.twitch.tv/videos/1000000001',
    durationMs: 13_320_000,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
    status: 'READY',
    error: null,
    hdAvailable: true,
    posterUrl: null,
    expiresAt: '2026-11-28T10:00:00.000Z',
    lastUsedAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

export function fixtureJob(overrides: Partial<ClipJobView> = {}): ClipJobView {
  return {
    id: 'job-1',
    kind: 'IMPORT',
    status: 'RUNNING',
    stage: 'fetch',
    stageLabel: 'Getting the video',
    progress: 42,
    etaSeconds: 230,
    videoId: 'video-busy',
    clipId: null,
    error: null,
    result: null,
    createdAt: NOW,
    startedAt: NOW,
    finishedAt: null,
    ...overrides,
  };
}

export const FIXTURE_CARDS: Readonly<
  Record<'ready' | 'busy' | 'waiting' | 'failed', ClipVideoCard>
> = {
  ready: { video: fixtureVideo(), job: null, clipCount: 12 },
  busy: {
    video: fixtureVideo({
      id: 'video-busy',
      status: 'IMPORTING',
      title: 'Building A Cabin In The Woods, Part 3',
      platform: 'youtube',
      kind: 'video',
      expiresAt: null,
    }),
    job: fixtureJob(),
    clipCount: 0,
  },
  waiting: {
    video: fixtureVideo({
      id: 'video-waiting',
      status: 'IMPORTING',
      title: 'Kick Highlights Night',
    }),
    job: fixtureJob({
      id: 'job-2',
      status: 'QUEUED',
      stage: null,
      stageLabel: 'Waiting for its turn',
      progress: 0,
      etaSeconds: null,
      videoId: 'video-waiting',
    }),
    clipCount: 0,
  },
  failed: {
    video: fixtureVideo({
      id: 'video-failed',
      status: 'FAILED',
      title: 'Members Only Q And A',
      error: {
        code: 'link_private',
        message: 'This video is private or needs a login, so we cannot read it.',
      },
    }),
    job: null,
    clipCount: 0,
  },
};

export function fixtureProbe(overrides: Partial<ClipProbe> = {}): ClipProbe {
  return {
    link: {
      platform: 'twitch',
      kind: 'past_stream',
      externalId: '1000000001',
      canonicalUrl: 'https://www.twitch.tv/videos/1000000001',
    },
    info: {
      platform: 'twitch',
      kind: 'past_stream',
      externalId: '1000000001',
      canonicalUrl: 'https://www.twitch.tv/videos/1000000001',
      title: 'Friday Night Speedrun, Any Percent Attempts',
      channelName: 'simstreamer',
      durationMs: 600_000,
      live: false,
      thumbnailUrl: null,
      formats: [],
    },
    existingVideoId: null,
    ...overrides,
  };
}

export function fixtureStatus(overrides: Partial<ClipsStatus> = {}): ClipsStatus {
  return {
    tools: { state: 'ok', message: null, checks: [], checkedAt: NOW },
    simulation: true,
    platforms: ['youtube', 'twitch', 'kick'],
    storage: { usedBytes: 3_400_000_000, limitBytes: 20_000_000_000 },
    limits: {
      'clips.enabled': true,
      'clips.max_video_minutes': 240,
      'clips.upload_max_gb': 2,
      'clips.storage_gb': 20,
      'clips.retention_days': 10,
      'clips.concurrent_imports': 2,
      'clips.export_max_quality': '1080p',
      'clips.export_watermark': false,
      'clips.queue_priority': 'normal',
      'clips.browse_channels': 3,
      'clips.downloads_per_day': 10,
    },
    meters: {
      importMinutes: {
        used: 780,
        limit: 900,
        remaining: 120,
        cycleEnd: '2026-12-01T00:00:00.000Z',
      },
      aiMinutes: { used: 262, limit: 300, remaining: 38, cycleEnd: '2026-12-01T00:00:00.000Z' },
    },
    usage: { storageBytes: 3_400_000_000 },
    sample: { available: true },
    ...overrides,
  };
}

export const FIXTURE_CHANNEL: ClipChannelView = {
  id: 'channel-1',
  platform: 'twitch',
  handle: 'simstreamer',
  displayName: 'SimStreamer',
  avatarUrl: null,
  broadcasterType: 'affiliate',
  lastSyncedAt: NOW,
  error: null,
  createdAt: NOW,
  paused: false,
  lists: [
    { kind: 'streams', sorts: ['newest', 'views'], periods: [] },
    { kind: 'clips', sorts: ['views', 'newest'], periods: ['all', 'day', 'week', 'month'] },
  ],
};

export function fixtureStream(overrides: Partial<ClipStreamItem> = {}): ClipStreamItem {
  return {
    externalId: '1000000001',
    kind: 'vod',
    title: 'Friday Night Speedrun, Any Percent Attempts',
    publishedAt: '2026-11-14T19:00:00.000Z',
    durationSec: 13_320,
    viewCount: 12_408,
    thumbnailUrl: null,
    state: 'ready',
    expiresAt: '2026-11-21T19:00:00.000Z',
    hidden: false,
    imported: false,
    videoId: null,
    ...overrides,
  };
}

/** One row in each state the list can show. */
export const FIXTURE_STREAMS: readonly ClipStreamItem[] = [
  fixtureStream(),
  fixtureStream({
    externalId: '1000000002',
    title: 'Live: Late Night Chill Stream',
    state: 'live',
    durationSec: null,
    viewCount: 312,
    expiresAt: undefined,
  }),
  fixtureStream({
    externalId: '1000000003',
    title: 'Tuesday Practice Session',
    state: 'processing',
    viewCount: 0,
  }),
  fixtureStream({
    externalId: '1000000004',
    title: 'World Record Attempt Night',
    imported: true,
    videoId: 'video-ready',
  }),
  fixtureStream({ externalId: '1000000005', title: 'Old Charity Marathon', hidden: true }),
];
