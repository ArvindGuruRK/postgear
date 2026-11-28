'use client';

/**
 * The video page's transcript (Sprint 13, Module 04; blueprint section 3).
 *
 * **Transcript** in the page's actions row opens a right-hand sheet with the
 * video's words, the listened parts as paragraphs with their time in the
 * margin and the rest as "Not listened to yet" gaps, each with its own
 * Listen. Clicking a word moves the player there. Find (Ctrl+F while the
 * sheet is open) marks every place the words are said and steps through
 * them. Selecting words and pressing **Create Clip** makes a clip of them,
 * from the first word to the last with a little air.
 *
 * With nothing listened to yet the button reads **Listen To This Video**,
 * with its price in AI minutes for the whole length.
 */
import { ChevronDownIcon } from '@animateicons/react/lucide/chevron-down-icon';
import { ChevronUpIcon } from '@animateicons/react/lucide/chevron-up-icon';
import { ScissorsIcon } from '@animateicons/react/lucide/scissors-icon';
import { ScrollTextIcon } from '@animateicons/react/lucide/scroll-text-icon';
import {
  Alert,
  Button,
  Input,
  MotionIcon,
  Progress,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Spinner,
  TooltipHint,
  TranscriptText,
} from '@postgear/ui';
import { aiMinutesCost, type MsRange } from '@postgear/video-engine';
import { TriangleAlert } from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionLink } from '@/components/home/home-actions';
import { ApiError } from '@/lib/api';
import { getVideoTranscript, listenToVideo } from '@/lib/clips-api';
import type { TranscriptView } from '@/types/clips';
import { pricedLabel } from '../panels/captions-model';
import { useClipJob } from '../use-clip-job';
import { WaitingNote } from '../waiting-note';
import { queuedOr } from '../waiting-words';
import {
  clipRangeForWords,
  findInWords,
  NOT_LISTENED,
  SELECT_TO_CLIP,
  sheetSections,
} from './video-transcript-model';

const NOTE = 'm-0 font-sans text-xs text-ink type-muted';
const ACTION_FAILED = 'That did not work. Check your connection and try again.';

function sentenceOf(cause: unknown): string {
  return cause instanceof ApiError && cause.status !== 0 ? cause.message : ACTION_FAILED;
}

export interface TranscriptSheetProps {
  orgId: string;
  videoId: string;
  durationMs: number;
  /** Moves the page's player. */
  onSeek: (ms: number) => void;
  /** Makes a clip of a stretch of the video; resolves when it is made (or refused). */
  onCreateClip: (range: MsRange) => Promise<void>;
}

export function TranscriptSheet({
  orgId,
  videoId,
  durationMs,
  onSeek,
  onCreateClip,
}: TranscriptSheetProps) {
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptView | null>(null);
  /** Whether the video has any words yet: unknown until the first small read. */
  const [has, setHas] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [problem, setProblem] = useState<{ text: string; plans: boolean } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [listenBusy, setListenBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [creating, setCreating] = useState(false);
  const findField = useRef<HTMLInputElement>(null);

  // Whether there is a transcript at all: one small read, for the button's name.
  useEffect(() => {
    void reload;
    const abort = new AbortController();
    getVideoTranscript(
      videoId,
      { fromMs: 0, toMs: Math.max(1, Math.min(durationMs, 1_000)) },
      { signal: abort.signal },
    )
      .then((view) => {
        if (!abort.signal.aborted) setHas(view.transcript !== null);
      })
      .catch(() => {
        if (!abort.signal.aborted) setHas(false);
      });
    return () => abort.abort();
  }, [videoId, durationMs, reload]);

  // The whole transcript, when the sheet opens (and again after a listen).
  useEffect(() => {
    if (!open) return;
    void reload;
    const abort = new AbortController();
    setLoading(true);
    getVideoTranscript(videoId, {}, { signal: abort.signal })
      .then((view) => {
        if (abort.signal.aborted) return;
        setTranscript(view.transcript);
        setLoading(false);
      })
      .catch((cause) => {
        if (abort.signal.aborted) return;
        setLoading(false);
        setProblem({ text: sentenceOf(cause), plans: false });
      });
    return () => abort.abort();
  }, [open, videoId, reload]);

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

  const listen = useCallback(
    async (range: MsRange | null) => {
      setListenBusy(true);
      setProblem(null);
      setOpen(true);
      try {
        const outcome = await listenToVideo(videoId, range ?? {});
        if (outcome.covered) setReload((value) => value + 1);
        else setJobId(outcome.job.id);
      } catch (cause) {
        setProblem({
          text: sentenceOf(cause),
          plans: cause instanceof ApiError && cause.code === 'clips_ai_minutes_used',
        });
      } finally {
        setListenBusy(false);
      }
    },
    [videoId],
  );

  const words = transcript?.words ?? [];
  const sections = useMemo(
    () => (transcript ? sheetSections(transcript.words, transcript.covered, durationMs) : []),
    [transcript, durationMs],
  );
  const matches = useMemo(() => findInWords(words, query), [words, query]);
  const matchIds = useMemo(() => new Set(matches.flat()), [matches]);
  const currentMatch = matches.length > 0 ? matches[Math.min(current, matches.length - 1)] : null;
  // A new search starts at its first match.
  useEffect(() => {
    void query;
    setCurrent(0);
  }, [query]);

  const step = (by: 1 | -1) => {
    if (matches.length === 0) return;
    const next = (current + by + matches.length) % matches.length;
    setCurrent(next);
    const first = matches[next]?.[0];
    const word = words.find((candidate) => candidate.i === first);
    if (word) onSeek(word.start);
  };

  const seekWord = (id: number) => {
    const word = words.find((candidate) => candidate.i === id);
    if (word) onSeek(word.start);
  };

  const clipRange = clipRangeForWords(words, selected, durationMs);
  const create = async () => {
    if (!clipRange.ok || creating) return;
    setCreating(true);
    try {
      await onCreateClip({ fromMs: clipRange.fromMs, toMs: clipRange.toMs });
    } finally {
      setCreating(false);
    }
  };

  const onSheetKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      findField.current?.focus();
      findField.current?.select();
    }
  };

  const price = aiMinutesCost('listen', durationMs);
  const button =
    has === false && !open ? (
      <Button
        variant="highlight"
        size="sm"
        disabled={listenBusy || durationMs <= 0}
        onClick={() => void listen(null)}
        data-testid="clip-video-listen"
      >
        {listenBusy ? <Spinner /> : <MotionIcon icon={ScrollTextIcon} className="h-4 w-4" />}
        {pricedLabel('Listen To This Video', price)}
      </Button>
    ) : (
      <Button
        variant="secondary"
        size="sm"
        disabled={has === null}
        onClick={() => setOpen(true)}
        data-testid="clip-video-transcript"
      >
        <MotionIcon icon={ScrollTextIcon} className="h-4 w-4" />
        Transcript
      </Button>
    );

  return (
    <>
      {button}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="flex w-[30rem] max-w-[92vw] flex-col gap-4 bg-chrome"
          onKeyDown={onSheetKey}
          data-testid="clip-video-transcript-sheet"
        >
          <SheetHeader>
            <SheetTitle>Transcript</SheetTitle>
            <SheetDescription>
              Click a word to jump there. Select words to make a clip.
            </SheetDescription>
          </SheetHeader>

          <div className="flex items-center gap-2">
            <label htmlFor="clip-transcript-find" className="sr-only">
              Find in the transcript
            </label>
            <Input
              ref={findField}
              id="clip-transcript-find"
              value={query}
              placeholder="Enter your words"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  step(event.shiftKey ? -1 : 1);
                }
              }}
              className="flex-1"
            />
            <span
              className="min-w-14 text-right font-sans text-xs tabular-nums text-ink type-muted"
              role="status"
            >
              {query.trim() === ''
                ? ''
                : matches.length === 0
                  ? 'None'
                  : `${Math.min(current, matches.length - 1) + 1} of ${matches.length}`}
            </span>
            <TooltipHint label="Previous Match" side="bottom">
              <Button
                variant="ghost"
                size="sm"
                aria-label="Previous Match"
                className="h-9 w-9 px-0"
                disabled={matches.length === 0}
                onClick={() => step(-1)}
              >
                <MotionIcon icon={ChevronUpIcon} className="h-4 w-4" />
              </Button>
            </TooltipHint>
            <TooltipHint label="Next Match" side="bottom">
              <Button
                variant="ghost"
                size="sm"
                aria-label="Next Match"
                className="h-9 w-9 px-0"
                disabled={matches.length === 0}
                onClick={() => step(1)}
              >
                <MotionIcon icon={ChevronDownIcon} className="h-4 w-4" />
              </Button>
            </TooltipHint>
          </div>

          {problem ? (
            <Alert variant="danger" className="items-center">
              <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              <p className="m-0 min-w-0 flex-1">{problem.text}</p>
              {problem.plans ? (
                <ActionLink href={`/${encodeURIComponent(orgId)}/settings/billing`}>
                  See Plans
                </ActionLink>
              ) : null}
            </Alert>
          ) : null}

          {jobId !== null ? (
            <div className="flex flex-col gap-2" data-testid="clip-video-listening">
              <Progress tone="ai" value={job?.progress ?? 0} aria-label="Listening to this video" />
              <p className={NOTE} role="status">
                {queuedOr(job, 'Listening to what is said')}
              </p>
              <WaitingNote job={job} className={NOTE} />
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {loading && !transcript ? (
              <div className="flex flex-col gap-2" aria-busy="true">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {sections.map((section) =>
                  section.kind === 'gap' ? (
                    <div
                      key={section.key}
                      className="flex items-center gap-2 rounded-md bg-inset px-3 py-2"
                      data-testid="clip-transcript-gap"
                    >
                      <p className={`${NOTE} flex-1`}>{NOT_LISTENED}</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={listenBusy || jobId !== null}
                        onClick={() => void listen(section.range)}
                      >
                        {pricedLabel(
                          'Listen',
                          aiMinutesCost('listen', section.range.toMs - section.range.fromMs),
                        )}
                      </Button>
                    </div>
                  ) : (
                    <TranscriptText
                      key={section.key}
                      label="Transcript"
                      paragraphs={section.paragraphs}
                      matchIds={matchIds}
                      currentMatchId={currentMatch?.[0] ?? null}
                      followSpoken={false}
                      onWordPress={seekWord}
                      onActivate={seekWord}
                      onSelectionChange={(_, ids) => setSelected(ids)}
                    />
                  ),
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 border-t-2 border-outline pt-3">
            <p className={`${NOTE} flex-1`}>
              {clipRange.ok
                ? `${selected.length} words selected.`
                : selected.length > 1
                  ? clipRange.sentence
                  : SELECT_TO_CLIP}
            </p>
            <Button
              size="sm"
              disabled={!clipRange.ok || creating}
              onClick={() => void create()}
              data-testid="clip-transcript-create"
            >
              {creating ? <Spinner /> : <MotionIcon icon={ScissorsIcon} className="h-4 w-4" />}
              Create Clip
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
