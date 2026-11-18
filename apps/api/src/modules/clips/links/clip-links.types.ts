/**
 * The link probe's contract inside the API (Module 03), shared by the probe
 * route and the video import (Module 04), which probes again on the server
 * and never trusts a `LinkInfo` sent by the browser.
 */
import type { LinkInfo, LinkRef } from '@postgear/video-engine';

export interface ClipProbeResult {
  /** Recognised and rebuilt from the id: the only link yt-dlp is ever given. */
  link: LinkRef;
  info: LinkInfo;
  /** This workspace already has this video (same platform and external id, not deleted). */
  existingVideoId: string | null;
}

/**
 * What `ClipLinksService` offers the rest of the Clips module. `probe` runs
 * every check (recognise, platform switch, breaker, throttle, cache, the
 * worker's probe, the plan's longest video) and throws `ClipErrorException`
 * (or the 402 refusal) with our code on any refusal.
 */
export interface ClipLinkProber {
  probe(orgId: string, url: string): Promise<ClipProbeResult>;
}

/** Nest token for `ClipLinkProber`, so the videos module depends on the contract, not the class. */
export const CLIP_LINK_PROBER = Symbol('CLIP_LINK_PROBER');
