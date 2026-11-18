/**
 * The two generated sample videos the simulation fetches from, what is in
 * them, and the recorded chat for the stream sample.
 *
 * The videos themselves are made by `npm run clips:samples` into a
 * git-ignored folder; the plan and the chat are committed fixtures, so
 * Module 16 can predict the highlights without generating anything.
 */
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import planJson from '../../fixtures/samples/plan.json';
import chatJson from '../../fixtures/samples/stream-chat.json';

export type SampleName = 'talk' | 'stream';

const spanSchema = z.object({ startSec: z.number().nonnegative(), endSec: z.number().positive() });

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

/** The file name of a sample inside the samples folder. */
export function sampleFileName(name: SampleName): string {
  return samplePlan()[name].file;
}

/** A sample's length in ms. */
export function sampleDurationMs(name: SampleName): number {
  return Math.round(samplePlan()[name].durationSec * 1000);
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
