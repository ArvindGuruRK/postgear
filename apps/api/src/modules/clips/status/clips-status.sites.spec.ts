/**
 * `sites` in `GET /clips/status` (Sprint 13, Module 12): every site of the
 * table with its name and whether `CLIPS_PLATFORMS` switches it on, for the
 * link box's help line. `platforms` stays the ids that are on.
 */
import { SITES } from '@postgear/video-engine';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import type { ClipPrivacyService } from '../privacy/clip-privacy.service';
import type { ClipDrive } from '../videos/clip-drive';
import type { ClipSampleLink } from '../videos/clip-sample';
import { ClipsStatusService } from './clips-status.service';
import { type MediaServiceProbe, NO_HOSTED_LANE } from './media-service.probe';
import type { MediaVoices } from './media-voices.client';

const privacy = { speechStaysHere: jest.fn(async () => false) };

function status(platforms: string[]) {
  const meter = { used: 0, limit: 10, remaining: 10, cycleEnd: new Date('2026-12-25') };
  const config = {
    get: (key: string) => ({ CLIPS_TTS: 'false', CLIPS_PLATFORMS: platforms })[key] ?? 'false',
  };
  return new ClipsStatusService(
    {
      runClipQuery: jest.fn(async () => ({ outcome: 'timed_out' })),
    } as unknown as SchedulingService,
    {
      getMany: jest.fn(async () => ({})),
      meter: jest.fn(async () => meter),
    } as unknown as EntitlementResolver,
    {
      storageByKind: jest.fn(async () => ({ videos: 0, downloads: 0, library: 0 })),
    } as unknown as ClipLimitsGuard,
    config as never,
    { url: null } as unknown as ClipSampleLink,
    {
      state: jest.fn(async () => 'off'),
      hostedLane: jest.fn(async () => NO_HOSTED_LANE),
    } as unknown as MediaServiceProbe,
    { list: jest.fn() } as unknown as MediaVoices,
    { status: () => ({ available: false }) } as unknown as ClipDrive,
    privacy as unknown as ClipPrivacyService,
  );
}

describe('ClipsStatusService sites', () => {
  it('lists every site in the table order, with its name and whether it is on', async () => {
    const answer = await status(['twitch', 'vimeo', 'reddit']).status('org-1');
    expect(answer.sites.map((site) => site.id)).toEqual(SITES.map((site) => site.id));
    expect(answer.sites.filter((site) => site.on).map((site) => site.name)).toEqual([
      'Twitch',
      'Vimeo',
      'Reddit',
    ]);
    expect(answer.sites.find((site) => site.id === 'tiktok')).toEqual({
      id: 'tiktok',
      name: 'TikTok',
      on: false,
    });
    expect(answer.platforms).toEqual(['twitch', 'vimeo', 'reddit']);
  });
});
