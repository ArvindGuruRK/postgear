'use client';

/**
 * A clip's captions, for the editor (Sprint 13, Module 03): the words, the
 * caption styles, and the three ways words arrive (listening, a file, a
 * translation).
 *
 * - **The document is the editor's.** Nothing here writes it: when words
 *   arrive the hook hands the captions `track` to `onTrack`, and the editor
 *   commits it as one undo step and saves it as it saves everything.
 * - **Words by transcript id.** Every answer that carries a transcript is
 *   kept by its id, so Undo back to an earlier transcript (the original after
 *   a translation) shows its words at once. A transcript not held yet is
 *   fetched (`GET /clips/:clipId/words` reads the saved clip, so it is asked
 *   again a few times while the autosave catches up).
 * - **Listening** runs as a job: the hook follows it (`useClipJob`) and asks
 *   for the track again when it ends, which is free.
 * - One action at a time; each refusal is one sentence from the API.
 */
import type { CaptionLook, CaptionsTrack } from '@postgear/video-engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  addCaptions,
  cancelClipJob,
  createCaptionStyle,
  deleteCaptionStyle,
  getClipsStatus,
  getClipWords,
  listCaptionStyles,
  replaceTranscriptWord,
  translateCaptions,
  updateCaptionStyle,
  uploadCaptionsFile,
} from '@/lib/clips-api';
import type {
  CaptionStylesView,
  CaptionStyleView,
  ClipJobView,
  ClipsAiStatus,
  TranscriptView,
} from '@/types/clips';
import { useClipJob } from '../use-clip-job';
import { CAPTIONS_LOAD_FAILED } from './captions-model';

const ACTION_FAILED = 'That did not work. Check your connection and try again.';
/** How often the words are asked for again while the autosave catches up. */
const RETRY_MS = 1500;
const RETRIES = 4;

export type CaptionsBusy = 'add' | 'file' | 'translate' | 'replace' | 'style' | null;

export interface CaptionsState {
  /** The words of the transcript the clip's captions show; null while unknown. */
  transcript: TranscriptView | null;
  /** The words are being fetched. */
  loading: boolean;
  /** The clip's captions name a transcript that is gone. */
  missing: boolean;
  /** What Add Captions costs right now, in AI minutes; null until known. */
  price: number | null;
  styles: readonly CaptionStyleView[];
  stylesInfo: Pick<CaptionStylesView, 'own' | 'limit'> | null;
  /** The AI layer's state, or null until known (read as off). */
  ai: ClipsAiStatus | null;
  busy: CaptionsBusy;
  /** The listening job, while it runs. */
  job: ClipJobView | null;
  /** One sentence about the last thing that went wrong. */
  problem: string | null;
  /** One sentence worth saying after something worked ("We skipped 2 lines..."). */
  note: string | null;
  dismiss: () => void;
  add: (options: { styleId: string; language: string }) => void;
  cancelListening: () => void;
  upload: (file: File, options: { styleId: string; language: string }) => void;
  translate: (language: string) => void;
  /** Fixes a word everywhere in the video; resolves to how many changed, or null on a refusal. */
  replaceEverywhere: (from: string, to: string) => Promise<number | null>;
  saveStyle: (name: string, look: CaptionLook) => Promise<CaptionStyleView | string>;
  renameStyle: (styleId: string, name: string) => Promise<string | null>;
  removeStyle: (styleId: string) => Promise<string | null>;
}

function sentenceOf(cause: unknown, fallback = ACTION_FAILED): string {
  return cause instanceof ApiError && cause.status !== 0 ? cause.message : fallback;
}

export function useCaptions(input: {
  clipId: string;
  videoId: string | null;
  /** The transcript the document's captions point at, or null for no captions. */
  transcriptId: string | null;
  /** New words arrived: put this track in the document. */
  onTrack: (track: CaptionsTrack) => void;
}): CaptionsState {
  const { clipId, videoId, transcriptId, onTrack } = input;
  const [held, setHeld] = useState<ReadonlyMap<string, TranscriptView>>(new Map());
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState(false);
  const [price, setPrice] = useState<number | null>(null);
  const [styles, setStyles] = useState<CaptionStylesView | null>(null);
  const [ai, setAi] = useState<ClipsAiStatus | null>(null);
  const [busy, setBusy] = useState<CaptionsBusy>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const wanted = useRef<{ styleId: string; language: string } | null>(null);
  const live = useRef(true);
  const onTrackRef = useRef(onTrack);
  onTrackRef.current = onTrack;

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const keep = useCallback((transcript: TranscriptView) => {
    setHeld((current) => new Map(current).set(transcript.id, transcript));
    setMissing(false);
  }, []);

  // The styles and the AI layer's state, once.
  useEffect(() => {
    const abort = new AbortController();
    listCaptionStyles({ signal: abort.signal })
      .then((view) => setStyles(view))
      .catch(() => {
        // The built-in styles still draw: the panel lists them from the engine.
      });
    getClipsStatus({ signal: abort.signal })
      .then((status) => setAi(status.ai ?? null))
      .catch(() => setAi(null));
    return () => abort.abort();
  }, []);

  // The words: whenever the document shows a transcript that is not held yet.
  const known = transcriptId !== null && held.has(transcriptId);
  useEffect(() => {
    // `reload` only asks to look again (after Replace Everywhere).
    void reload;
    if (known) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let tries = 0;
    setLoading(true);
    const look = () => {
      getClipWords(clipId, { signal: abort.signal })
        .then((view) => {
          if (abort.signal.aborted) return;
          setPrice(view.price);
          if (view.transcript) keep(view.transcript);
          const found = transcriptId === null || view.transcript?.id === transcriptId;
          if (!found && tries < RETRIES) {
            // The saved clip still shows another transcript: the autosave has not landed yet.
            tries += 1;
            timer = setTimeout(look, RETRY_MS);
            return;
          }
          setMissing(transcriptId !== null && !found);
          setLoading(false);
        })
        .catch((cause) => {
          if (abort.signal.aborted) return;
          setLoading(false);
          setProblem(sentenceOf(cause, CAPTIONS_LOAD_FAILED));
        });
    };
    look();
    return () => {
      abort.abort();
      if (timer) clearTimeout(timer);
    };
  }, [clipId, transcriptId, known, keep, reload]);

  const run = useCallback(
    async <T>(kind: NonNullable<CaptionsBusy>, work: () => Promise<T>): Promise<T | null> => {
      setBusy(kind);
      setProblem(null);
      setNote(null);
      try {
        return await work();
      } catch (cause) {
        if (live.current) setProblem(sentenceOf(cause));
        return null;
      } finally {
        if (live.current) setBusy(null);
      }
    },
    [],
  );

  const add = useCallback(
    (options: { styleId: string; language: string }) => {
      wanted.current = options;
      void run('add', async () => {
        const outcome = await addCaptions(clipId, {
          styleId: options.styleId,
          ...(options.language !== 'auto' ? { language: options.language } : {}),
        });
        if (!live.current) return;
        if (outcome.covered) {
          keep(outcome.transcript);
          setPrice(0);
          onTrackRef.current(outcome.track);
        } else {
          setJobId(outcome.job.id);
        }
      });
    },
    [clipId, keep, run],
  );

  // The listening job: when it ends well, the track is asked for again (free).
  const { job } = useClipJob(jobId);
  const jobStatus = job?.id === jobId ? job.status : null;
  const jobError = job?.error?.message ?? null;
  useEffect(() => {
    if (jobId === null || jobStatus === null) return;
    if (jobStatus === 'DONE') {
      setJobId(null);
      if (wanted.current) add(wanted.current);
    } else if (jobStatus === 'FAILED') {
      setJobId(null);
      setProblem(jobError ?? ACTION_FAILED);
    } else if (jobStatus === 'CANCELLED') {
      setJobId(null);
    }
  }, [jobId, jobStatus, jobError, add]);

  const cancelListening = useCallback(() => {
    if (jobId === null) return;
    cancelClipJob(jobId).catch((cause) => {
      if (live.current) setProblem(sentenceOf(cause));
    });
  }, [jobId]);

  const upload = useCallback(
    (file: File, options: { styleId: string; language: string }) => {
      void run('file', async () => {
        const outcome = await uploadCaptionsFile(clipId, file, {
          styleId: options.styleId,
          ...(options.language !== 'auto' ? { language: options.language } : {}),
        });
        if (!live.current) return;
        keep(outcome.transcript);
        setNote(outcome.note);
        onTrackRef.current(outcome.track);
      });
    },
    [clipId, keep, run],
  );

  const translate = useCallback(
    (language: string) => {
      void run('translate', async () => {
        const outcome = await translateCaptions(clipId, language);
        if (!live.current) return;
        keep(outcome.transcript);
        onTrackRef.current(outcome.track);
      });
    },
    [clipId, run, keep],
  );

  const replaceEverywhere = useCallback(
    async (from: string, to: string): Promise<number | null> => {
      if (!videoId) return null;
      const result = await run('replace', () => replaceTranscriptWord(videoId, from, to));
      if (!result) return null;
      if (live.current && transcriptId !== null) {
        // The video's words changed: forget what is held and read them again.
        setHeld((current) => {
          const next = new Map(current);
          next.delete(transcriptId);
          return next;
        });
        setReload((value) => value + 1);
      }
      return result.changed;
    },
    [run, transcriptId, videoId],
  );

  const refreshStyles = useCallback(async () => {
    try {
      const view = await listCaptionStyles();
      if (live.current) setStyles(view);
    } catch {
      // The list shown stays; the next change asks again.
    }
  }, []);

  const saveStyle = useCallback(
    async (name: string, look: CaptionLook): Promise<CaptionStyleView | string> => {
      try {
        const style = await createCaptionStyle({ name, look });
        await refreshStyles();
        return style;
      } catch (cause) {
        return sentenceOf(cause);
      }
    },
    [refreshStyles],
  );

  const renameStyle = useCallback(
    async (styleId: string, name: string): Promise<string | null> => {
      try {
        await updateCaptionStyle(styleId, { name });
        await refreshStyles();
        return null;
      } catch (cause) {
        return sentenceOf(cause);
      }
    },
    [refreshStyles],
  );

  const removeStyle = useCallback(
    async (styleId: string): Promise<string | null> => {
      try {
        await deleteCaptionStyle(styleId);
        await refreshStyles();
        return null;
      } catch (cause) {
        return sentenceOf(cause);
      }
    },
    [refreshStyles],
  );

  const dismiss = useCallback(() => {
    setProblem(null);
    setNote(null);
  }, []);

  return {
    transcript: transcriptId !== null ? (held.get(transcriptId) ?? null) : null,
    loading: loading && !known,
    missing,
    price,
    styles: styles?.styles ?? [],
    stylesInfo: styles ? { own: styles.own, limit: styles.limit } : null,
    ai,
    busy,
    job: jobId !== null && job?.id === jobId ? job : null,
    problem,
    note,
    dismiss,
    add,
    cancelListening,
    upload,
    translate,
    replaceEverywhere,
    saveStyle,
    renameStyle,
    removeStyle,
  };
}
