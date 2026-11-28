/**
 * Test rows for Send To Composer (Module 17): channels and the providers'
 * video rules, with the values the real providers carry (YouTube 15 min,
 * Instagram 3 s to 15 min and 1920 px wide, TikTok 10 min, LinkedIn no video).
 */
import type { MediaRules } from '@postgear/social-core/composer';
import type { Channel, ProviderSummary } from '@/types/channel';
import type { ClipExportView, ClipJobView } from '@/types/clips';

const MINUTE = 60_000;

export function sendChannel(
  id: string,
  providerIdentifier: string,
  name: string,
  overrides: Partial<Channel> = {},
): Channel {
  return {
    id,
    providerIdentifier,
    providerName: providerIdentifier,
    name,
    profile: null,
    picture: null,
    health: 'connected',
    disabled: false,
    refreshNeeded: false,
    inBetweenSteps: false,
    tokenExpiration: null,
    postingTimes: [],
    createdAt: '2026-11-01T10:00:00.000Z',
    color: 0,
    ...overrides,
  };
}

function provider(identifier: string, name: string, media: Partial<MediaRules>): ProviderSummary {
  return {
    identifier,
    name,
    configured: true,
    requiresEntitySelection: false,
    rules: {
      maxLength: 2200,
      lengthMethod: 'utf16',
      thread: 'none',
      followUpMedia: false,
      media: {
        required: false,
        maxItems: 1,
        maxImages: 1,
        maxVideos: 1,
        allowMixed: false,
        ...media,
      },
    },
  } as ProviderSummary;
}

export const SEND_PROVIDERS: ProviderSummary[] = [
  provider('youtube', 'YouTube', { required: true, maxImages: 0, videoMaxMs: 15 * MINUTE }),
  provider('instagram-standalone', 'Instagram', {
    required: true,
    maxItems: 10,
    maxImages: 10,
    videoMinMs: 3_000,
    videoMaxMs: 15 * MINUTE,
    videoMaxWidth: 1920,
  }),
  provider('tiktok', 'TikTok', { required: true, videoMaxMs: 10 * MINUTE }),
  provider('linkedin', 'LinkedIn', { maxItems: 9, maxImages: 9, maxVideos: 0 }),
];

export function sendJob(id: string, status: ClipJobView['status']): ClipJobView {
  return {
    id,
    kind: 'RENDER',
    status,
    stage: null,
    stageLabel: status === 'RUNNING' ? 'Drawing the frames' : status === 'DONE' ? 'Done' : 'Failed',
    progress: status === 'DONE' ? 100 : 42,
    etaSeconds: status === 'RUNNING' ? 60 : null,
    videoId: 'video-1',
    clipId: 'clip-1',
    error: null,
    result: null,
    createdAt: '2026-11-19T10:00:00.000Z',
    startedAt: '2026-11-19T10:00:01.000Z',
    finishedAt: status === 'RUNNING' ? null : '2026-11-19T10:02:00.000Z',
    waiting: null,
  };
}

export function sendExport(
  id: string,
  media: { id: string; durationMs?: number; width?: number; height?: number; bytes?: number },
  quality: ClipExportView['quality'] = '1080p',
): ClipExportView {
  return {
    job: sendJob(`job-${id}`, 'DONE'),
    quality,
    fingerprint: null,
    loudness: null,
    media: {
      id: media.id,
      url: `/media/${media.id}/file`,
      posterUrl: null,
      name: 'Team Talk.mp4',
      bytes: media.bytes ?? 26 * 1024 * 1024,
      width: media.width ?? 1080,
      height: media.height ?? 1920,
      durationMs: media.durationMs ?? 42_000,
    },
  };
}
