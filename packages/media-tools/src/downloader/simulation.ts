/**
 * What each simulation link answers (README Names table, Module 03).
 *
 * A link is known when it is in `fixtures/simulation/links.json` (the three
 * sample links and a private, live, missing, resting and too-long link per
 * platform) or is an item of the simulated channel. Known links answer from
 * a recorded yt-dlp probe (with a few fields overridden) or a recorded
 * yt-dlp error line, so the fixture binding runs the same probe mapper and
 * error mapper as the real one. Anything else is "not found". A few links
 * (Module 20) answer the probe and then fail one kind of fetch
 * (`fetchErrors`), to force a state a hand check could not reach otherwise.
 */
import type { ClipPlatformId, LinkRef } from '@postgear/video-engine';
import { z } from 'zod';
import kickStream from '../../fixtures/ytdlp/probe-kick-stream.json';
import twitchStream from '../../fixtures/ytdlp/probe-twitch-stream.json';
import youtubeTalk from '../../fixtures/ytdlp/probe-youtube-talk.json';
import linksJson from '../../fixtures/simulation/links.json';
import { findSimulatedItem, type SimulatedItem } from '../channels/simulation-fixture';
import { SAMPLE_NAMES, type SampleName, sampleDurationMs } from './samples';

/** The recorded probes, by the name the links file uses. */
const PROBES: Readonly<Record<string, unknown>> = Object.freeze({
  'youtube-talk': youtubeTalk,
  'twitch-stream': twitchStream,
  'kick-stream': kickStream,
});

/**
 * Module 20's forcing switches: a link whose probe answers, but one kind of
 * fetch then fails with a recorded yt-dlp error line (read by the real error
 * mapper). `proxy` fails the import half way, `range` fails the sharp range
 * (the clip exports at 720p from the light copy), `format` fails a download.
 */
const fetchErrorsSchema = z
  .object({
    proxy: z.string().min(1).optional(),
    range: z.string().min(1).optional(),
    format: z.string().min(1).optional(),
  })
  .strict();

export type SimulationFetchErrors = z.infer<typeof fetchErrorsSchema>;

const linkEntrySchema = z.object({
  platform: z.enum(['youtube', 'twitch', 'kick']),
  externalId: z.string().min(1),
  url: z.string().url(),
  probe: z.string().optional(),
  sample: z.enum(SAMPLE_NAMES).optional(),
  stderr: z.string().optional(),
  overrides: z.record(z.unknown()).optional(),
  fetchErrors: fetchErrorsSchema.optional(),
});

const linksSchema = z.object({
  version: z.number().int(),
  links: z.array(linkEntrySchema),
});

export type SimulationLinkEntry = z.infer<typeof linkEntrySchema>;

/** A simulation link answers with a video or with a recorded failure. */
export type SimulationAnswer =
  | { type: 'error'; stderr: string }
  | {
      type: 'video';
      /** yt-dlp-shaped probe JSON, overrides applied. */
      probeJson: unknown;
      sample: SampleName;
      /** How much of the sample this video is, from its start. */
      takeMs: number;
      /** The fetches this link is forced to fail (Module 20); absent for every ordinary link. */
      fetchErrors?: SimulationFetchErrors;
    };

let linksCache: SimulationLinkEntry[] | null = null;

/** Every entry of the links file, checked once. */
export function simulationLinks(): SimulationLinkEntry[] {
  linksCache ??= linksSchema.parse(linksJson).links;
  return linksCache;
}

function withOverrides(base: unknown, overrides: Record<string, unknown>): unknown {
  if (typeof base !== 'object' || base === null) return base;
  return { ...(structuredClone(base) as Record<string, unknown>), ...overrides };
}

function probeFor(name: string): unknown {
  const probe = PROBES[name];
  if (probe === undefined) throw new Error(`No recorded probe named ${name}.`);
  return probe;
}

function fromEntry(entry: SimulationLinkEntry): SimulationAnswer {
  if (entry.stderr !== undefined) return { type: 'error', stderr: entry.stderr };
  const sample = entry.sample ?? 'stream';
  return {
    type: 'video',
    probeJson: withOverrides(probeFor(entry.probe ?? 'twitch-stream'), entry.overrides ?? {}),
    sample,
    takeMs: sampleDurationMs(sample),
    ...(entry.fetchErrors ? { fetchErrors: entry.fetchErrors } : {}),
  };
}

/** The sample and base probe a listed item of the simulated channel imports from. */
function fromChannelItem(platform: ClipPlatformId, item: SimulatedItem): SimulationAnswer {
  const talk = platform === 'youtube' && (item.kind === 'upload' || item.kind === 'short');
  const sample: SampleName = talk ? 'talk' : 'stream';
  const base =
    platform === 'youtube'
      ? 'youtube-talk'
      : platform === 'twitch'
        ? 'twitch-stream'
        : 'kick-stream';
  const sampleMs = sampleDurationMs(sample);
  const takeMs =
    item.durationSec === null ? sampleMs : Math.min(sampleMs, Math.round(item.durationSec * 1000));
  const live = item.state !== 'ready';
  const liveStatus =
    item.state === 'live'
      ? 'is_live'
      : item.state === 'upcoming'
        ? 'is_upcoming'
        : item.state === 'processing'
          ? 'post_live'
          : 'not_live';
  const extractor =
    platform === 'youtube'
      ? 'youtube'
      : item.kind === 'clip'
        ? platform === 'twitch'
          ? 'twitch:clips'
          : 'kick:clip'
        : platform === 'twitch'
          ? 'twitch:vod'
          : 'kick:vod';
  return {
    type: 'video',
    probeJson: withOverrides(probeFor(base), {
      id: item.externalId,
      extractor,
      title: item.title,
      duration: live && item.state !== 'processing' ? null : takeMs / 1000,
      is_live: item.state === 'live',
      live_status: liveStatus,
      heatmap: null,
    }),
    sample,
    takeMs,
  };
}

/**
 * The answer for a link, or null when the simulation does not know it.
 * Matched on platform and id, so every canonical form of a link works.
 */
export function resolveSimulationLink(link: LinkRef): SimulationAnswer | null {
  const entry = simulationLinks().find(
    (candidate) => candidate.platform === link.platform && candidate.externalId === link.externalId,
  );
  if (entry) return fromEntry(entry);
  const item = findSimulatedItem(link.platform, link.externalId);
  if (item) return fromChannelItem(link.platform, item);
  return null;
}
