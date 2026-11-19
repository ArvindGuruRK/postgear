/**
 * The highlight signal producers (Module 16 section 3): each measures one
 * track of a video, or answers null when it has nothing to give. The scorer
 * itself is pure and lives in `@postgear/video-engine`.
 *
 * Loudness and scene run FFmpeg in both worlds (the simulation's samples are
 * local files we made, so measuring them for real is safe and gives real
 * timings); only the chat source differs: the Twitch pager behind
 * `CLIPS_TWITCH_CHAT`, the sample's recorded chat under `CLIPS_SIMULATION`,
 * or none.
 */
import type { SignalTrack } from '@postgear/video-engine';
import type { RunTool } from '../run/types';
import { type ChatRequest, type ChatSource, produceChat } from './chat';
import { produceLoudness } from './loudness';
import { produceScene } from './scene';

export * from './chat';
export * from './file-io';
export * from './loudness';
export * from './metadata';
export * from './scene';

interface ProduceCommon {
  /** The job's scratch folder (absolute); print files are written here. */
  cwd: string;
  durationMs: number;
  signal?: AbortSignal;
  /** 0 to 100. */
  onProgress?: (percent: number) => void;
}

/** The three measuring steps a highlights run calls, in its stage order. */
export interface SignalProducers {
  /** Null for a video with no sound (no analysis file). */
  loudness(input: ProduceCommon & { audioFile: string | null }): Promise<SignalTrack | null>;
  /** Null when the pass ran over its time budget. */
  scene(
    input: ProduceCommon & { videoFile: string; budgetMs?: number },
  ): Promise<SignalTrack | null>;
  /** Null when there is no chat to read (not Twitch, switched off, refused, empty). */
  chat(request: ChatRequest): Promise<SignalTrack | null>;
  /** Whether a chat source is bound at all (for the run's notes and logs). */
  readonly chatEnabled: boolean;
}

export function createSignalProducers(options: {
  runTool: RunTool;
  chat: ChatSource | null;
}): SignalProducers {
  const { runTool, chat } = options;
  return {
    loudness: (input) => produceLoudness({ ...input, runTool }),
    scene: (input) => produceScene({ ...input, runTool }),
    chat: (request) => produceChat(chat, request),
    chatEnabled: chat !== null,
  };
}
