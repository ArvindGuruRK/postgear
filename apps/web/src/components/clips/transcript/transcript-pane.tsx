'use client';

/**
 * The Transcript pane (Sprint 13, Module 04; blueprint section 5): the
 * clip's words beside the stage, the spoken word marked as it plays.
 *
 * - **Loads once, derives the rest.** The words come from
 *   `GET /clips/:clipId/words?source=spoken` (always the words as said,
 *   never a file or a translation: only those have real times to cut by).
 *   Where each word stands (played, cut, outside the clip) and the word
 *   being said are worked out from the document and the playhead.
 * - **Only the words follow the playhead.** The word being said is read in
 *   `SpokenTranscriptText`, so as the clip plays the pane's header and
 *   tools do not draw again, only the text (and in it only the paragraphs
 *   the word moves through).
 * - **Edits are the editor's.** Delete, Restore, Remove Silences and Remove
 *   Filler Words hand a change to `onApply`, which runs it on the latest
 *   document as one undo step and says the result in a toast with Undo.
 *   A word fixed here is the captions' own edit when the captions show
 *   these words (this clip), else a fix for the whole video.
 * - **Not listened to yet**: Listen To This Clip, with its price in AI
 *   minutes and the chip of what is left.
 */
import { XIcon } from '@animateicons/react/lucide/x-icon';
import {
  Alert,
  Button,
  cn,
  Input,
  MotionIcon,
  Progress,
  Skeleton,
  Spinner,
  TooltipHint,
  TranscriptText,
  type TranscriptTextProps,
} from '@postgear/ui';
import {
  type CaptionsTrack,
  type ClipDocument,
  cutForWords,
  healSegments,
  outputDuration,
  removeSourceRange,
  type TranscriptWord,
  toOutput,
  wordPlaces,
} from '@postgear/video-engine';
import { TriangleAlert } from 'lucide-react';
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { ActionLink } from '@/components/home/home-actions';
import { ApiError } from '@/lib/api';
import {
  cancelClipJob,
  fixTranscriptWords,
  getClipWords,
  listenToVideo,
  replaceTranscriptWord,
} from '@/lib/clips-api';
import type { ClipWaveform, TranscriptView } from '@/types/clips';
import type { PlaybackStore } from '../editor/playback';
import { AiMinutesChip } from '../home/clips-meters';
import { pricedLabel, WORD_PLACEHOLDER, withWordEdit } from '../panels/captions-model';
import { usePeaks } from '../timeline/timeline-media';
import { useClipJob } from '../use-clip-job';
import { WaitingNote } from '../waiting-note';
import { queuedOr } from '../waiting-words';
import { type ApplyCut, CleanupTools } from './cleanup-tools';
import { TranscriptDownloadMenu } from './transcript-download-menu';
import {
  clipSpan,
  cutToast,
  LISTEN_HANDLE_MS,
  LISTEN_HELP,
  listenRange,
  manyUnsure,
  NO_WORDS_NOTE,
  PARTLY_HEARD_NOTE,
  spokenWordAt,
  transcriptParagraphs,
  UNSURE_NOTE,
  wordsSpan,
} from './transcript-model';

const NOTE = 'm-0 font-sans text-xs text-ink type-muted';
const ACTION_FAILED = 'That did not work. Check your connection and try again.';
const LISTENING = 'Listening to what is said';

export interface TranscriptPaneProps {
  orgId: string;
  clipId: string;
  videoId: string | null;
  videoDurationMs: number;
  /** The document as edited (with any drag in progress), for what is shown. */
  document: ClipDocument;
  playback: PlaybackStore;
  /** The clip's captions, when it has them: a word fixed here is their edit. */
  captionsTrack: CaptionsTrack | null;
  /** The video's waveform: Remove Silences keeps a pause that is loud (music, laughter, a game). */
  waveform: ClipWaveform | null;
  /** The AI layer is up (null while unknown): listening needs it. */
  aiOn: boolean | null;
  onApply: ApplyCut;
  onEditCaptions: (change: (track: CaptionsTrack) => CaptionsTrack) => void;
  onNotice: (sentence: string) => void;
  onClose: () => void;
}

function sentenceOf(cause: unknown): string {
  return cause instanceof ApiError && cause.status !== 0 ? cause.message : ACTION_FAILED;
}

/** The clip's own source: the one its first part plays. */
export function mainSourceId(doc: Pick<ClipDocument, 'segments'>): string | null {
  return doc.segments[0]?.source ?? null;
}

export function TranscriptPane({
  orgId,
  clipId,
  videoId,
  videoDurationMs,
  document,
  playback,
  captionsTrack,
  waveform,
  aiOn,
  onApply,
  onEditCaptions,
  onNotice,
  onClose,
}: TranscriptPaneProps) {
  const sourceId = mainSourceId(document);
  const peakData = usePeaks(waveform?.url ?? null);
  const peaks = useMemo(
    () => (peakData && waveform ? { data: peakData, perSecond: waveform.meta.perSecond } : null),
    [peakData, waveform],
  );
  const [transcript, setTranscript] = useState<TranscriptView | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<{ text: string; plans: boolean } | null>(null);
  const [reload, setReload] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [follow, setFollow] = useState(true);

  // The words, once (and again after a listen, a fix, or a trim past what was read).
  const segments = document.segments;
  const span = useMemo(() => clipSpan({ segments }, sourceId), [segments, sourceId]);
  const outsideRead =
    transcript !== null &&
    span !== null &&
    transcript.covered.length > 0 &&
    (span.fromMs < (transcript.covered[0]?.fromMs ?? 0) - LISTEN_HANDLE_MS ||
      span.toMs > (transcript.covered.at(-1)?.toMs ?? 0) + LISTEN_HANDLE_MS);
  // A trim past what was read asks for the words again, once.
  useEffect(() => {
    if (outsideRead) setReload((value) => value + 1);
  }, [outsideRead]);
  useEffect(() => {
    void reload;
    const abort = new AbortController();
    setLoading(true);
    getClipWords(clipId, { signal: abort.signal, source: 'spoken' })
      .then((view) => {
        if (abort.signal.aborted) return;
        setTranscript(view.transcript);
        setPrice(view.price);
        setLoading(false);
      })
      .catch((cause) => {
        if (abort.signal.aborted) return;
        setLoading(false);
        setProblem({ text: sentenceOf(cause), plans: false });
      });
    return () => abort.abort();
  }, [clipId, reload]);

  // Listening: follow the job, read the words again when it ends.
  const { job } = useClipJob(jobId);
  const jobStatus = job?.id === jobId ? job.status : null;
  const jobError = job?.error?.message ?? null;
  useEffect(() => {
    if (jobId === null || jobStatus === null) return;
    if (jobStatus === 'DONE' || jobStatus === 'CANCELLED') {
      setJobId(null);
      setReload((value) => value + 1);
    } else if (jobStatus === 'FAILED') {
      setJobId(null);
      setProblem({ text: jobError ?? ACTION_FAILED, plans: false });
    }
  }, [jobId, jobStatus, jobError]);

  const listen = useCallback(async () => {
    if (!videoId || !span) return;
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await listenToVideo(videoId, listenRange(span, videoDurationMs));
      if (outcome.covered) setReload((value) => value + 1);
      else setJobId(outcome.job.id);
    } catch (cause) {
      setProblem({
        text: sentenceOf(cause),
        plans: cause instanceof ApiError && cause.code === 'clips_ai_minutes_used',
      });
    } finally {
      setBusy(false);
    }
  }, [videoId, span, videoDurationMs]);

  // The words as this clip shows them: its captions' own changes on, when they show these words.
  const words = useMemo<TranscriptWord[]>(() => {
    if (!transcript) return [];
    const edits = captionsTrack?.transcriptAssetId === transcript.id ? captionsTrack.edits : null;
    if (!edits) return transcript.words;
    return transcript.words.map((word) => {
      const edit = Object.hasOwn(edits, String(word.i)) ? edits[String(word.i)] : undefined;
      return edit?.text ? { ...word, text: edit.text, sure: 1 } : word;
    });
  }, [transcript, captionsTrack]);
  const places = useMemo(
    () => (sourceId ? wordPlaces(document, { words }, sourceId) : new Map()),
    [document, words, sourceId],
  );
  const paragraphs = useMemo(
    () => (sourceId ? transcriptParagraphs(words, places, document, sourceId) : []),
    [words, places, document, sourceId],
  );

  // The word being said: read by the text alone, which draws again only when it changes.
  const readSpoken = useCallback(
    () => (sourceId ? spokenWordAt(document, words, sourceId, playback.getCurrentMs()) : null),
    [document, words, sourceId, playback],
  );
  const playing = playback.usePlaying();
  useEffect(() => {
    if (playing) setFollow(true);
  }, [playing]);

  const seekTo = useCallback(
    (id: number) => {
      const word = words.find((candidate) => candidate.i === id);
      if (!word || !sourceId) return;
      const at = toOutput(document, sourceId, word.start);
      if (at !== null) playback.seekMs(at);
    },
    [words, sourceId, document, playback],
  );

  const cut = useCallback(
    (ids: number[]) => {
      if (!sourceId || !transcript) return;
      const played = ids.filter((id) => places.get(id) === 'played');
      const first = played[0];
      const last = played.at(-1);
      if (first === undefined || last === undefined) return;
      const range = cutForWords({ words }, first, last);
      if (!range) return;
      onApply(
        (doc) => removeSourceRange(doc, sourceId, range.fromMs, range.toMs),
        (before, after) => cutToast(played.length, outputDuration(before) - outputDuration(after)),
      );
    },
    [sourceId, transcript, places, words, onApply],
  );

  const restore = useCallback(
    (ids: number[]) => {
      const range = wordsSpan(words, ids);
      if (!range || !sourceId) return;
      onApply(
        (doc) => healSegments(doc, sourceId, range.fromMs, range.toMs),
        () => null,
      );
    },
    [words, sourceId, onApply],
  );

  const saveWord = useCallback(
    async (index: number, text: string) => {
      const word = transcript?.words.find((candidate) => candidate.i === index);
      if (!word || !transcript) return;
      if (captionsTrack && captionsTrack.transcriptAssetId === transcript.id) {
        // This clip's captions show these words: the fix is theirs, one undo step.
        if (!withWordEdit(captionsTrack, word, { text })) return;
        onEditCaptions((track) => withWordEdit(track, word, { text }) ?? track);
        return;
      }
      if (!videoId) return;
      try {
        await fixTranscriptWords(videoId, [{ index, text }]);
        setReload((value) => value + 1);
      } catch (cause) {
        onNotice(sentenceOf(cause));
      }
    },
    [transcript, captionsTrack, onEditCaptions, videoId, onNotice],
  );

  const replaceEverywhere = useCallback(
    async (from: string, to: string): Promise<number | null> => {
      if (!videoId) return null;
      try {
        const result = await replaceTranscriptWord(videoId, from, to);
        setReload((value) => value + 1);
        return result.changed;
      } catch (cause) {
        onNotice(sentenceOf(cause));
        return null;
      }
    },
    [videoId, onNotice],
  );

  const heard = transcript !== null && transcript.words.length > 0;
  /** Part of the clip (with its handles) was never listened to: Listen is offered, with its price. */
  const unheard = transcript === null || (price ?? 0) > 0;
  const listenButton = (
    <>
      <Button
        variant="highlight"
        className="w-full"
        disabled={busy || aiOn !== true || !videoId}
        onClick={() => void listen()}
        data-testid="clip-transcript-listen-button"
      >
        {busy ? <Spinner /> : null}
        {pricedLabel('Listen To This Clip', price ?? 0)}
      </Button>
      <AiMinutesChip orgId={orgId} fallback={null} />
    </>
  );
  const serviceOff =
    aiOn === false ? (
      <Alert variant="warning" className="items-center">
        <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
        <p className="m-0 min-w-0 flex-1">
          Captions are not available right now. Everything else still works.
        </p>
      </Alert>
    ) : null;
  const noneInClip = heard && ![...places.values()].some((place) => place === 'played');
  const listening = jobId !== null;

  let body: ReactNode;
  if (loading && !transcript) {
    body = (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  } else if (listening) {
    body = (
      <div className="flex flex-col gap-2" data-testid="clip-transcript-listening">
        <Progress tone="ai" value={job?.progress ?? 0} aria-label="Listening to this clip" />
        <p className={NOTE} role="status">
          {queuedOr(job, LISTENING)}
        </p>
        <WaitingNote job={job} className={NOTE} />
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => {
            if (jobId) cancelClipJob(jobId).catch((cause) => onNotice(sentenceOf(cause)));
          }}
        >
          Cancel
        </Button>
      </div>
    );
  } else if (!heard) {
    body = (
      <div className="flex flex-col gap-3" data-testid="clip-transcript-listen">
        {serviceOff ?? <p className={NOTE}>{unheard ? LISTEN_HELP : NO_WORDS_NOTE}</p>}
        {unheard ? listenButton : null}
      </div>
    );
  } else {
    body = (
      <div className="flex min-h-0 flex-col gap-3">
        {unheard ? (
          <div className="flex flex-col gap-2" data-testid="clip-transcript-partly">
            {serviceOff ?? <p className={NOTE}>{PARTLY_HEARD_NOTE}</p>}
            {listenButton}
          </div>
        ) : null}
        {manyUnsure(words, places) ? <p className={NOTE}>{UNSURE_NOTE}</p> : null}
        {noneInClip ? <p className={NOTE}>{NO_WORDS_NOTE}</p> : null}
        <div className="min-h-0 flex-1 overflow-y-auto pr-1" onWheel={() => setFollow(false)}>
          <SpokenTranscriptText
            subscribe={playback.subscribe}
            readSpoken={readSpoken}
            label="Transcript"
            paragraphs={paragraphs}
            followSpoken={follow}
            onWordPress={seekTo}
            onActivate={seekTo}
            onWordOpen={setEditing}
            onDelete={cut}
            onRestore={restore}
            renderAfterWord={(id) =>
              id === editing ? (
                <WordFix
                  key={id}
                  word={words.find((candidate) => candidate.i === id) ?? null}
                  heard={transcript?.words.find((candidate) => candidate.i === id) ?? null}
                  canReplaceEverywhere={videoId !== null}
                  onSave={(text) => void saveWord(id, text)}
                  onReplaceEverywhere={replaceEverywhere}
                  onClose={() => setEditing(null)}
                />
              ) : null
            }
          />
        </div>
      </div>
    );
  }

  return (
    <section
      aria-label="Transcript"
      data-transcript-pane=""
      data-testid="clip-transcript-pane"
      className="flex w-80 shrink-0 flex-col gap-3 rounded-lg border-2 border-outline bg-chrome p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 type-heading text-lg text-ink">Transcript</h2>
        <div className="flex items-center gap-1">
          {heard && !listening ? (
            <TranscriptDownloadMenu
              path={`/clips/${encodeURIComponent(clipId)}/transcript/download`}
              title="Transcript"
              onError={onNotice}
            />
          ) : null}
          <TooltipHint label="Close Transcript" side="bottom" shortcut={['T']}>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Close Transcript"
              className="h-9 w-9 px-0"
              onClick={onClose}
            >
              <MotionIcon icon={XIcon} className="h-4 w-4" />
            </Button>
          </TooltipHint>
        </div>
      </div>
      {problem ? (
        <Alert variant="danger" className="items-center" data-testid="clip-transcript-problem">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{problem.text}</p>
          {problem.plans ? (
            <ActionLink href={`/${encodeURIComponent(orgId)}/settings/billing`}>
              See Plans
            </ActionLink>
          ) : null}
        </Alert>
      ) : null}
      <div className={cn('flex min-h-0 flex-1 flex-col')}>{body}</div>
      {heard && sourceId && !listening ? (
        <CleanupTools
          document={document}
          sourceId={sourceId}
          words={words}
          covered={transcript?.covered ?? []}
          language={transcript?.language ?? 'en'}
          peaks={peaks}
          disabled={false}
          onApply={onApply}
        />
      ) : null}
    </section>
  );
}

/** The word without the punctuation around it: what Replace Everywhere looks for. */
/** The text with the word being said: the only part of the pane that draws as the clip plays. */
function SpokenTranscriptText({
  subscribe,
  readSpoken,
  ...props
}: Omit<TranscriptTextProps, 'spokenId'> & {
  subscribe: (listener: () => void) => () => void;
  readSpoken: () => number | null;
}) {
  const spokenId = useSyncExternalStore(subscribe, readSpoken, () => null);
  return <TranscriptText {...props} spokenId={spokenId} />;
}

function bareWord(text: string): string {
  return text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** Fixing one word in place: Enter saves; Replace Everywhere fixes it in the whole video. */
function WordFix({
  word,
  heard,
  canReplaceEverywhere,
  onSave,
  onReplaceEverywhere,
  onClose,
}: {
  word: TranscriptWord | null;
  heard: TranscriptWord | null;
  canReplaceEverywhere: boolean;
  onSave: (text: string) => void;
  onReplaceEverywhere: (from: string, to: string) => Promise<number | null>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(word?.text ?? '');
  const [said, setSaid] = useState<string | null>(null);
  const typed = value.replace(/\s+/g, ' ').trim();
  const from = bareWord(heard?.text ?? '');
  const to = bareWord(typed);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (typed.length === 0) return;
    onSave(typed);
    onClose();
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(event) => event.stopPropagation()}
      className="my-1 flex w-full flex-col gap-2 rounded-md border-2 border-outline bg-inset p-2"
      data-testid="clip-transcript-word-fix"
    >
      <label className="sr-only" htmlFor="clip-transcript-word">
        The word shown
      </label>
      <Input
        id="clip-transcript-word"
        value={value}
        maxLength={80}
        placeholder={WORD_PLACEHOLDER}
        onChange={(event) => setValue(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
        autoFocus
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={typed.length === 0}>
          Save
        </Button>
        {canReplaceEverywhere ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={from.length === 0 || to.length === 0 || from === to}
            onClick={async () => {
              const changed = await onReplaceEverywhere(from, to);
              if (changed !== null) {
                setSaid(
                  changed === 1
                    ? 'Changed 1 word in this video.'
                    : `Changed ${changed} words in this video.`,
                );
              }
            }}
          >
            Replace Everywhere
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
      {said ? (
        <p role="status" className={NOTE}>
          {said}
        </p>
      ) : null}
    </form>
  );
}
