'use client';

/**
 * What the Effects tab's AI rows need from the editor and the network
 * (Sprint 13, Module 09). The network calls sit behind `AiEffectsDeps`, so
 * the rows' tests hand in fakes (the pattern of Module 07's Detect Camera).
 */
import type { ClipDocument } from '@postgear/video-engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  cancelClipJob,
  getClipWords,
  getWordList,
  listenToVideo,
  listVoices,
  makeVoice,
  saveWordList,
  suggestHookTitles,
} from '@/lib/clips-api';
import type {
  ClipJobView,
  ClipsAiStatus,
  ClipVoicesView,
  ClipWaveform,
  ClipWordsView,
  ListenOutcome,
  MakeVoiceOutcome,
} from '@/types/clips';
import { useClipJob } from '../use-clip-job';
import { ACTION_FAILED } from './ai-effects-model';

export interface AiEffectsDeps {
  /** The clip's words as said (`GET /clips/:clipId/words?source=spoken`). */
  spokenWords: (clipId: string, signal: AbortSignal) => Promise<ClipWordsView>;
  listen: (videoId: string, range: { fromMs: number; toMs: number }) => Promise<ListenOutcome>;
  wordList: (signal: AbortSignal) => Promise<string[]>;
  saveWordList: (words: readonly string[]) => Promise<string[]>;
  /** `attempt`: 0 as the row opens, one more on each Try Again. */
  hookTitles: (clipId: string, attempt: number) => Promise<string[]>;
  voices: (signal: AbortSignal) => Promise<ClipVoicesView>;
  makeVoice: (
    clipId: string,
    body: { text: string; voiceId: string; revision: number },
  ) => Promise<MakeVoiceOutcome>;
  cancelJob: (jobId: string) => Promise<unknown>;
  /** Follows a job (a hook: the same function on every render). */
  useJob: (jobId: string | null) => { job: ClipJobView | null };
  /** Plays a voice's sample; returns a stop. */
  playSample: (url: string, onEnd: () => void) => () => void;
}

function playSampleInBrowser(url: string, onEnd: () => void): () => void {
  const audio = new Audio(url);
  audio.addEventListener('ended', onEnd);
  audio.addEventListener('error', onEnd);
  void audio.play().catch(onEnd);
  return () => {
    audio.pause();
    audio.removeEventListener('ended', onEnd);
    audio.removeEventListener('error', onEnd);
  };
}

export const DEFAULT_AI_EFFECTS_DEPS: AiEffectsDeps = {
  spokenWords: (clipId, signal) => getClipWords(clipId, { signal, source: 'spoken' }),
  listen: (videoId, range) => listenToVideo(videoId, range),
  wordList: (signal) => getWordList({ signal }),
  saveWordList: (words) => saveWordList(words),
  hookTitles: (clipId, attempt) => suggestHookTitles(clipId, attempt),
  voices: (signal) => listVoices({ signal }),
  makeVoice: (clipId, body) => makeVoice(clipId, body),
  cancelJob: (jobId) => cancelClipJob(jobId),
  useJob: useClipJob,
  playSample: playSampleInBrowser,
};

/**
 * What the editor hands the AI rows. Each change goes in as one undo step
 * with a toast (`onEdit` answers whether the document changed).
 */
export interface AiEffectsInput {
  orgId: string;
  clipId: string;
  videoId: string | null;
  /** The whole video's length (Listen reaches a little past the clip, never past this). */
  videoDurationMs: number;
  waveform: ClipWaveform | null;
  /** The AI layer's state; null while unknown (read as off). */
  status: ClipsAiStatus | null;
  onEdit: (change: (doc: ClipDocument) => ClipDocument, sentence: string) => boolean;
  /** Saves now; the saved revision, or null when the server does not have everything yet. */
  flushRevision: () => Promise<number | null>;
  deps?: AiEffectsDeps;
}

/** A refusal's sentence, and whether it is the month's AI minutes (See Plans). */
export interface Problem {
  text: string;
  plans: boolean;
}

export function problemOf(cause: unknown, fallback = ACTION_FAILED): Problem {
  if (cause instanceof ApiError && cause.status !== 0) {
    return { text: cause.message, plans: cause.code === 'clips_ai_minutes_used' };
  }
  return { text: fallback, plans: false };
}

/**
 * The clip's spoken words, fetched while `enabled` (a card that needs them
 * is open) and kept after; `reload` reads them again (after a listen).
 */
export function useSpokenWords(
  clipId: string,
  enabled: boolean,
  deps: AiEffectsDeps,
): {
  view: ClipWordsView | null;
  loading: boolean;
  problem: Problem | null;
  reload: () => void;
} {
  const [view, setView] = useState<ClipWordsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [tick, setTick] = useState(0);
  const wanted = useRef(false);
  if (enabled) wanted.current = true;
  const asked = enabled || wanted.current;
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    void tick;
    if (!asked) return;
    const abort = new AbortController();
    setLoading(true);
    depsRef.current
      .spokenWords(clipId, abort.signal)
      .then((next) => {
        if (abort.signal.aborted) return;
        setView(next);
        setProblem(null);
        setLoading(false);
      })
      .catch((cause) => {
        if (abort.signal.aborted) return;
        setLoading(false);
        setProblem(problemOf(cause));
      });
    return () => abort.abort();
  }, [clipId, asked, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { view, loading, problem, reload };
}
