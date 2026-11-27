/**
 * `ai.voice` in `GET /clips/status` (Sprint 13, Module 09): true only with
 * `CLIPS_TTS` on, the media service up and its speaker offering voices.
 */
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import type { ClipDrive } from '../videos/clip-drive';
import type { ClipSampleLink } from '../videos/clip-sample';
import { ClipsStatusService } from './clips-status.service';
import type { AiServiceState, MediaServiceProbe } from './media-service.probe';
import type { MediaVoices, SpeakerVoices } from './media-voices.client';

const HEART = { id: 'kokoro-heart', name: 'Heart', languages: ['en'] };

function status(options: { tts: boolean; service: AiServiceState; voices: SpeakerVoices }) {
  const meter = { used: 0, limit: 10, remaining: 10, cycleEnd: new Date('2026-12-25') };
  const config = {
    get: (key: string) =>
      ({ CLIPS_TTS: options.tts ? 'true' : 'false', CLIPS_PLATFORMS: [] })[key] ?? 'false',
  };
  const list = jest.fn(async () => options.voices);
  const service = new ClipsStatusService(
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
    { state: jest.fn(async () => options.service) } as unknown as MediaServiceProbe,
    { list } as unknown as MediaVoices,
    { status: () => ({ available: false }) } as unknown as ClipDrive,
  );
  return { service, list };
}

describe('ClipsStatusService ai.voice', () => {
  it('is true with CLIPS_TTS on, the media service up and at least one voice', async () => {
    const { service } = status({
      tts: true,
      service: 'ok',
      voices: { speaker: 'kokoro', voices: [HEART] },
    });
    expect((await service.status('org-1')).ai.voice).toBe(true);
  });

  it('is false while the speaker offers no voices', async () => {
    const { service } = status({
      tts: true,
      service: 'ok',
      voices: { speaker: 'kokoro', voices: [] },
    });
    expect((await service.status('org-1')).ai.voice).toBe(false);
  });

  it('is false, without asking for voices, when CLIPS_TTS is off or the service is down', async () => {
    for (const options of [
      { tts: false, service: 'ok' as const },
      { tts: true, service: 'off' as const },
    ]) {
      const { service, list } = status({
        ...options,
        voices: { speaker: 'kokoro', voices: [HEART] },
      });
      expect((await service.status('org-1')).ai.voice).toBe(false);
      expect(list).not.toHaveBeenCalled();
    }
  });
});
