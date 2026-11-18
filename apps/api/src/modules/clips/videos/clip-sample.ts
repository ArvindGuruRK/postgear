/**
 * Try A Sample (Sprint 12, Module 06, story CL-2.5): which link the sample
 * import reads. The server picks it; the browser only says `{ sample: true }`.
 *
 * - Under `CLIPS_SIMULATION=true`: the 3 minute "talk" sample, a YouTube
 *   link the simulated probe and downloader answer from fixtures (no
 *   platform is contacted).
 * - Otherwise: `CLIPS_SAMPLE_LINK`, a link to a video the operator owns,
 *   checked at boot (`config/env.ts`). Unset means there is no sample, and
 *   the page hides the button (`GET /clips/status` `sample.available`).
 *
 * A link whose platform this deployment has switched off
 * (`CLIPS_PLATFORMS`) counts as no sample, so the button is never offered
 * only to be refused with "paused".
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ClipPlatformId, recogniseLink } from '@postgear/video-engine';
import type { Env } from '../../../config/env';

/** The simulation's talk sample (`npm run clips:samples` makes its file). */
export const SIMULATION_SAMPLE_LINK = 'https://www.youtube.com/watch?v=simtalk0001';

/** The sample's link for these settings, or null when there is none. */
export function sampleLinkFor(settings: {
  simulation: boolean;
  configured: string | undefined;
  platforms: readonly ClipPlatformId[];
}): string | null {
  const link = settings.simulation ? SIMULATION_SAMPLE_LINK : settings.configured;
  if (!link) return null;
  const ref = recogniseLink(link);
  if (!('platform' in ref) || !settings.platforms.includes(ref.platform)) return null;
  return ref.canonicalUrl;
}

@Injectable()
export class ClipSampleLink {
  private readonly link: string | null;

  constructor(config: ConfigService<Env, true>) {
    this.link = sampleLinkFor({
      simulation: config.get('CLIPS_SIMULATION', { infer: true }) === 'true',
      configured: config.get('CLIPS_SAMPLE_LINK', { infer: true }),
      platforms: config.get('CLIPS_PLATFORMS', { infer: true }),
    });
  }

  /** The link the sample import probes, or null when this deployment has no sample. */
  get url(): string | null {
    return this.link;
  }
}
