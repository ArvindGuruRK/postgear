/**
 * The sample videos the simulation fetches from, what is in them, and the
 * recorded chat for the stream sample.
 *
 * - **Generated** (`talk`, `stream`, and Sprint 13's `two-speakers`): made by
 *   `npm run clips:samples` from FFmpeg's own test sources into a git-ignored
 *   folder. The plan and the chat are committed fixtures, so the highlights,
 *   the speaker turns and the recorded answers are predictable without
 *   generating anything.
 * - **Own** (`verideck`): a real video a developer supplies, for testing every
 *   Clips screen on real pictures and sound. `npm run clips:samples` copies it
 *   from the first path in its `sources` that exists (or from the file its
 *   `envVar` names). It is never generated and never committed; when it is
 *   missing, its simulation link answers "run npm run clips:samples".
 */
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import planJson from '../../fixtures/samples/plan.json';
import chatJson from '../../fixtures/samples/stream-chat.json';

/** The samples FFmpeg generates. */
export const GENERATED_SAMPLES = ['talk', 'stream', 'two-speakers'] as const;
export type GeneratedSampleName = (typeof GENERATED_SAMPLES)[number];

/** Real videos a developer supplies (copied, never generated, never committed). */
export const OWN_SAMPLES = ['verideck'] as const;
export type OwnSampleName = (typeof OWN_SAMPLES)[number];

export const SAMPLE_NAMES = [...GENERATED_SAMPLES, ...OWN_SAMPLES] as const;
export type SampleName = (typeof SAMPLE_NAMES)[number];

const spanSchema = z.object({ startSec: z.number().nonnegative(), endSec: z.number().positive() });

const speakerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  toneHz: z.number().positive(),
  /** FFmpeg colour, `0xRRGGBB`. */
  colour: z.string().regex(/^0x[0-9a-fA-F]{6}$/),
  /** The face marker's centre and size, fractions of the picture. */
  centreX: z.number().min(0).max(1),
  centreY: z.number().min(0).max(1),
  faceWidth: z.number().positive().max(1),
  faceHeight: z.number().positive().max(1),
});

const ownSampleSchema = z.object({
  file: z.string(),
  durationSec: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  title: z.string().min(1),
  /** Repo-relative paths tried in order by `npm run clips:samples`. */
  sources: z.array(z.string().min(1)).min(1),
  /** An environment variable that may name the file instead. */
  envVar: z.string().min(1),
});

const samplePlanSchema = z.object({
  version: z.number().int(),
  talk: z.object({
    file: z.string(),
    durationSec: z.number().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().int().positive(),
    bedToneHz: z.number().positive(),
    burstToneHz: z.number().positive(),
    toneBursts: z.array(spanSchema),
  }),
  stream: z.object({
    file: z.string(),
    durationSec: z.number().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().int().positive(),
    bedToneHz: z.number().positive(),
    scenes: z.array(
      z.object({
        startSec: z.number().nonnegative(),
        source: z.enum(['testsrc2', 'smptehdbars', 'life', 'rgbtestsrc']),
      }),
    ),
    loudBursts: z.array(spanSchema),
    chat: z.object({
      fixture: z.string(),
      lagSec: z.number().nonnegative(),
      burstLengthSec: z.number().positive(),
      burstPerSecond: z.number().positive(),
      baselineEverySec: z.number().positive(),
    }),
  }),
  /** Sprint 13: two face-like markers taking turns, one tone per speaker. */
  twoSpeakers: z.object({
    file: z.string(),
    durationSec: z.number().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().int().positive(),
    bedToneHz: z.number().positive(),
    speakers: z.array(speakerSchema).length(2),
    turns: z.array(spanSchema.extend({ speaker: z.string().min(1) })).min(2),
  }),
  /** Sprint 13: real videos a developer supplies. */
  own: z.object({ verideck: ownSampleSchema }),
});

/** What `npm run clips:samples` makes and where each moment is. Seconds of the sample. */
export type SamplePlan = z.infer<typeof samplePlanSchema>;

const sampleChatSchema = z.object({
  version: z.number().int(),
  videoExternalIds: z.array(z.string()),
  durationSec: z.number().positive(),
  messageCount: z.number().int().nonnegative(),
  messageOffsetsMs: z.array(z.number().int().nonnegative()),
});

/** Chat for the stream sample: message times only, no names and no text. */
export type SampleChat = z.infer<typeof sampleChatSchema>;

let planCache: SamplePlan | null = null;
let chatCache: SampleChat | null = null;

/** The committed sample plan, checked once. */
export function samplePlan(): SamplePlan {
  planCache ??= samplePlanSchema.parse(planJson);
  return planCache;
}

/** The recorded chat for the stream sample, checked once. */
export function sampleChat(): SampleChat {
  chatCache ??= sampleChatSchema.parse(chatJson);
  return chatCache;
}

/** What every sample has, whichever kind it is. */
export interface SampleSpec {
  file: string;
  durationSec: number;
  width: number;
  height: number;
}

/** One sample's file, length and size from the plan. */
export function sampleSpec(name: SampleName): SampleSpec {
  const plan = samplePlan();
  switch (name) {
    case 'talk':
      return plan.talk;
    case 'stream':
      return plan.stream;
    case 'two-speakers':
      return plan.twoSpeakers;
    case 'verideck':
      return plan.own.verideck;
  }
}

/** True for a real video a developer supplies (it may be missing on a fresh machine). */
export function isOwnSample(name: SampleName): name is OwnSampleName {
  return (OWN_SAMPLES as readonly string[]).includes(name);
}

/** The file name of a sample inside the samples folder. */
export function sampleFileName(name: SampleName): string {
  return sampleSpec(name).file;
}

/** A sample's length in ms. */
export function sampleDurationMs(name: SampleName): number {
  return Math.round(sampleSpec(name).durationSec * 1000);
}

/** The folder `npm run clips:samples` writes to: `packages/media-tools/samples`. */
export const SAMPLES_FOLDER = path.join('packages', 'media-tools', 'samples');

/**
 * Finds `packages/media-tools/samples` by walking up from this file to the
 * repository root, so it works from source, from a compiled worker and from
 * the scripts alike. The worker may pass its own folder instead.
 */
export function defaultSamplesDir(from: string = __dirname): string {
  let dir = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(dir, 'packages', 'media-tools', 'package.json'))) {
      return path.join(dir, SAMPLES_FOLDER);
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return path.resolve(__dirname, '..', '..', 'samples');
    }
    dir = parent;
  }
}
