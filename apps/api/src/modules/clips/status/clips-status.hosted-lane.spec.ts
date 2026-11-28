/**
 * `ai.hostedLane` in `GET /clips/status` (Sprint 13, Module 15): whether long
 * speech is sent to a hosted listener, which one, and above how many minutes.
 * It comes from the media service's own `/ready` answer, so the privacy text
 * can name the provider only while sound can leave our servers.
 */
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import type { ClipPrivacyService } from '../privacy/clip-privacy.service';
import type { ClipDrive } from '../videos/clip-drive';
import type { ClipSampleLink } from '../videos/clip-sample';
import { ClipsStatusService } from './clips-status.service';
import {
  type AiServiceState,
  type HostedLaneState,
  hostedLaneFrom,
  type MediaServiceProbe,
  NO_HOSTED_LANE,
} from './media-service.probe';
import type { MediaVoices } from './media-voices.client';

const privacy = { speechStaysHere: jest.fn(async () => false) };

const GROQ: HostedLaneState = {
  on: true,
  provider: 'groq',
  providerName: 'Groq',
  aboveMinutes: 55,
};

function status(service: AiServiceState, lane: HostedLaneState) {
  const meter = { used: 0, limit: 10, remaining: 10, cycleEnd: new Date('2026-12-25') };
  const config = {
    get: (key: string) => ({ CLIPS_PLATFORMS: [] })[key] ?? 'false',
  };
  const probe = {
    state: jest.fn(async () => service),
    hostedLane: jest.fn(async () => lane),
  };
  const statusService = new ClipsStatusService(
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
    probe as unknown as MediaServiceProbe,
    { list: jest.fn(async () => ({ speaker: null, voices: [] })) } as unknown as MediaVoices,
    { status: () => ({ available: false }) } as unknown as ClipDrive,
    privacy as unknown as ClipPrivacyService,
  );
  return { statusService, probe };
}

describe('ClipsStatusService ai.hostedLane', () => {
  it('names the provider and the threshold while the service sends long speech there', async () => {
    const { statusService } = status('ok', GROQ);
    expect((await statusService.status('org-1')).ai.hostedLane).toEqual(GROQ);
  });

  it('is off when the service keeps all speech on our own machine', async () => {
    const { statusService } = status('ok', NO_HOSTED_LANE);
    expect((await statusService.status('org-1')).ai.hostedLane).toEqual({
      on: false,
      provider: null,
      providerName: null,
      aboveMinutes: null,
    });
  });

  it('is off while the media service is off, whatever was last heard', async () => {
    const { statusService } = status('off', GROQ);
    expect((await statusService.status('org-1')).ai.hostedLane).toEqual(NO_HOSTED_LANE);
  });
});

describe('ClipsStatusService ai.speechStaysHere (Module 17 item 26)', () => {
  it('carries the workspace switch beside the lane', async () => {
    const { statusService } = status('ok', GROQ);
    privacy.speechStaysHere.mockResolvedValueOnce(true);
    const ai = (await statusService.status('org-1')).ai;
    expect(ai.speechStaysHere).toBe(true);
    expect(ai.hostedLane).toEqual(GROQ);
    expect(privacy.speechStaysHere).toHaveBeenLastCalledWith('org-1');
  });
});

describe('hostedLaneFrom (the `/ready` answer)', () => {
  it('reads the provider and the threshold', () => {
    expect(
      hostedLaneFrom({
        ready: true,
        checks: { worker: 'running' },
        hostedLane: { provider: 'groq', aboveMinutes: 55 },
      }),
    ).toEqual(GROQ);
  });

  it('says every job for a threshold of 0 (TRANSCRIBER=groq)', () => {
    expect(hostedLaneFrom({ hostedLane: { provider: 'groq', aboveMinutes: 0 } }).aboveMinutes).toBe(
      0,
    );
  });

  it('names an unknown provider by its id rather than hiding it', () => {
    expect(hostedLaneFrom({ hostedLane: { provider: 'deepgram', aboveMinutes: 10 } })).toEqual({
      on: true,
      provider: 'deepgram',
      providerName: 'deepgram',
      aboveMinutes: 10,
    });
  });

  it('is no lane for null, an older service without the field, or anything odd', () => {
    for (const body of [
      { hostedLane: null },
      { ready: true, checks: {} },
      null,
      'ready',
      { hostedLane: { provider: 'Groq Cloud', aboveMinutes: 55 } },
      { hostedLane: { provider: 'groq', aboveMinutes: -1 } },
      { hostedLane: { provider: 'groq', aboveMinutes: 55, key: 'x' } },
    ]) {
      expect(hostedLaneFrom(body)).toEqual(NO_HOSTED_LANE);
    }
  });
});
