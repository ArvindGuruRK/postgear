'use client';

/**
 * Bleep Bad Words (Sprint 13, Module 09; blueprint section 7): the row in
 * the Effects tab.
 *
 * - A `Toggle`. On: every word found is ticked at once (one undo step), and
 *   the tick list shows each word with its time on the clip (pressing the
 *   word seeks there). Unticking one rewrites the set (one step each).
 * - **Bleep** or **Mute** (`Segmented`) for every bleep.
 * - **My Words** edits the workspace's own list; words it adds to this clip
 *   are bleeped at once while the row is on.
 * - No words heard for the clip's stretch: **Listen To This Clip** with its
 *   price, Module 04's flow (finding the words is free).
 */
import { XIcon } from '@animateicons/react/lucide/x-icon';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormErrorMessage,
  Input,
  MotionIcon,
  Progress,
  Skeleton,
  Spinner,
  Toggle,
} from '@postgear/ui';
import {
  type BleepWord,
  bleepModeOf,
  type ClipDocument,
  clearBleeps,
  setBleeps,
} from '@postgear/video-engine';
import { TriangleAlert } from 'lucide-react';
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ActionLink } from '@/components/home/home-actions';
import { GroupLabel, NOTE, Segmented } from '@/components/studio/panel-ui';
import type { ClipWordsView } from '@/types/clips';
import type { PlaybackStore } from '../editor/playback';
import { AiMinutesChip } from '../home/clips-meters';
import { clipSpan, listenRange } from '../transcript/transcript-model';
import { WaitingNote } from '../waiting-note';
import { queuedOr } from '../waiting-words';
import {
  BLEEP_LISTEN_HELP,
  BLEEP_LISTENING,
  BLEEP_MODE_OPTIONS,
  BLEEP_MUTE_SENTENCE,
  BLEEP_OFF_SENTENCE,
  BLEEP_ON_SENTENCE,
  BLEEP_PARTLY_NOTE,
  BLEEP_TONE_SENTENCE,
  type BleepModeChoice,
  bleepSeekMs,
  bleepTimeText,
  bleepWordSentence,
  cleanListWords,
  clipBleepWords,
  MY_WORD_MAX,
  MY_WORDS_EMPTY,
  MY_WORDS_HELP,
  MY_WORDS_PLACEHOLDER,
  NO_BLEEP_WORDS,
  tickedWords,
  toggleWord,
} from './ai-effects-model';
import {
  type AiEffectsDeps,
  type AiEffectsInput,
  type Problem,
  problemOf,
} from './ai-effects-deps';
import { pricedLabel } from './captions-model';

/** A refusal in the row: its sentence, and See Plans when the month's AI minutes are used. */
export function ProblemAlert({
  problem,
  orgId,
  testId,
}: {
  problem: Problem;
  orgId: string;
  testId?: string;
}) {
  return (
    <Alert variant="danger" className="items-center" data-testid={testId}>
      <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
      <p className="m-0 min-w-0 flex-1">{problem.text}</p>
      {problem.plans ? (
        <ActionLink href={`/${encodeURIComponent(orgId)}/settings/billing`}>See Plans</ActionLink>
      ) : null}
    </Alert>
  );
}

export interface SpokenWords {
  view: ClipWordsView | null;
  loading: boolean;
  problem: Problem | null;
  reload: () => void;
}

export function BleepRow({
  input,
  deps,
  document,
  playback,
  spoken,
}: {
  input: AiEffectsInput;
  deps: AiEffectsDeps;
  document: ClipDocument;
  playback: PlaybackStore;
  spoken: SpokenWords;
}) {
  const toggleId = useId();
  const modeId = useId();
  const sourceId = document.segments[0]?.source ?? null;
  const transcript = spoken.view?.transcript ?? null;
  const price = spoken.view?.price ?? 0;
  const heard = transcript !== null && transcript.words.length > 0;
  const unheard = transcript === null || price > 0;

  // My Words: read once while the row is open.
  const [myWords, setMyWords] = useState<string[]>([]);
  const depsRef = useRef(deps);
  depsRef.current = deps;
  useEffect(() => {
    const abort = new AbortController();
    depsRef.current
      .wordList(abort.signal)
      .then((words) => {
        if (!abort.signal.aborted) setMyWords(words);
      })
      .catch(() => {
        // The language's own list still finds words; My Words shows the list once it loads.
      });
    return () => abort.abort();
  }, []);

  const found = useMemo(
    () =>
      transcript && sourceId
        ? clipBleepWords(document, transcript.words, sourceId, transcript.language, myWords)
        : [],
    [document, transcript, sourceId, myWords],
  );
  const ticked = sourceId ? tickedWords(document, sourceId, found) : [];
  const [chosenOn, setChosenOn] = useState(false);
  const on = chosenOn || document.bleeps.length > 0;
  const [chosenMode, setChosenMode] = useState<BleepModeChoice>('bleep');
  const mode = bleepModeOf(document) ?? chosenMode;
  const [dialogOpen, setDialogOpen] = useState(false);

  const turn = (next: boolean) => {
    setChosenOn(next);
    if (!sourceId) return;
    if (next) {
      if (found.length > 0) {
        input.onEdit((doc) => setBleeps(doc, found, mode, sourceId), BLEEP_ON_SENTENCE);
      }
    } else if (document.bleeps.length > 0) {
      input.onEdit(clearBleeps, BLEEP_OFF_SENTENCE);
    }
  };

  const tick = (word: BleepWord, checked: boolean) => {
    if (!sourceId) return;
    const next = toggleWord(ticked, word, checked);
    input.onEdit((doc) => setBleeps(doc, next, mode, sourceId), bleepWordSentence(checked));
  };

  const changeMode = (next: BleepModeChoice) => {
    setChosenMode(next);
    if (!sourceId || ticked.length === 0) return;
    input.onEdit(
      (doc) => setBleeps(doc, ticked, next, sourceId),
      next === 'mute' ? BLEEP_MUTE_SENTENCE : BLEEP_TONE_SENTENCE,
    );
  };

  /** My Words saved: words they add to this clip are bleeped at once while the row is on. */
  const wordsSaved = (words: string[]) => {
    setMyWords(words);
    if (!on || !transcript || !sourceId) return;
    const after = clipBleepWords(document, transcript.words, sourceId, transcript.language, words);
    const known = new Set(found.map((word) => word.wordIndex));
    const added = after.filter((word) => !known.has(word.wordIndex));
    if (added.length === 0) return;
    const next = [...ticked, ...added].sort((a, b) => a.from - b.from);
    input.onEdit((doc) => setBleeps(doc, next, mode, sourceId), BLEEP_ON_SENTENCE);
  };

  const listening = (
    <Listen
      input={input}
      deps={deps}
      document={document}
      price={price}
      sourceId={sourceId}
      onHeard={spoken.reload}
    />
  );

  let body: React.ReactNode;
  if (spoken.loading && !spoken.view) {
    body = (
      <div className="flex flex-col gap-2" aria-busy="true" data-testid="clip-bleep-loading">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  } else if (!heard) {
    body = unheard ? (
      <div className="flex flex-col gap-3" data-testid="clip-bleep-listen">
        <p className={NOTE}>{BLEEP_LISTEN_HELP}</p>
        {listening}
      </div>
    ) : (
      <p className={NOTE} data-testid="clip-bleep-none">
        {NO_BLEEP_WORDS}
      </p>
    );
  } else {
    body = (
      <>
        {unheard ? (
          <div className="flex flex-col gap-2" data-testid="clip-bleep-partly">
            <p className={NOTE}>{BLEEP_PARTLY_NOTE}</p>
            {listening}
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <GroupLabel id={toggleId}>Bleep Words</GroupLabel>
          <Toggle
            aria-labelledby={toggleId}
            checked={on}
            onCheckedChange={turn}
            data-testid="clip-bleep-toggle"
          />
        </div>
        {on ? (
          <>
            {found.length === 0 ? (
              <p className={NOTE} data-testid="clip-bleep-none">
                {NO_BLEEP_WORDS}
              </p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="clip-bleep-words">
                {found.map((word) => (
                  <BleepWordRow
                    key={word.wordIndex}
                    word={word}
                    checked={ticked.some((other) => other.wordIndex === word.wordIndex)}
                    time={sourceId ? bleepTimeText(document, sourceId, word) : null}
                    onTick={(checked) => tick(word, checked)}
                    onSeek={() => {
                      const at = sourceId ? bleepSeekMs(document, sourceId, word) : null;
                      if (at !== null) playback.seekMs(at);
                    }}
                  />
                ))}
              </ul>
            )}
            <div className="flex flex-col gap-1">
              <GroupLabel id={modeId}>Sound</GroupLabel>
              <Segmented
                labelledBy={modeId}
                value={mode}
                onValueChange={(value) => changeMode(value as BleepModeChoice)}
                options={BLEEP_MODE_OPTIONS}
              />
            </div>
          </>
        ) : null}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="clip-bleep">
      {spoken.problem ? <ProblemAlert problem={spoken.problem} orgId={input.orgId} /> : null}
      {body}
      <Button
        variant="secondary"
        className="w-full"
        onClick={() => setDialogOpen(true)}
        data-testid="clip-bleep-my-words"
      >
        My Words
      </Button>
      <MyWordsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={myWords}
        save={deps.saveWordList}
        onSaved={wordsSaved}
      />
    </div>
  );
}

function BleepWordRow({
  word,
  checked,
  time,
  onTick,
  onSeek,
}: {
  word: BleepWord;
  checked: boolean;
  time: string | null;
  onTick: (checked: boolean) => void;
  onSeek: () => void;
}) {
  return (
    <li
      className="flex items-center gap-2 rounded-md border-2 border-outline bg-inset px-2 py-1"
      data-testid="clip-bleep-word"
    >
      <Checkbox
        checked={checked}
        aria-label={`Bleep ${word.text}`}
        onCheckedChange={(value) => onTick(value === true)}
      />
      <button
        type="button"
        onClick={onSeek}
        className="flex min-w-0 flex-1 items-baseline justify-between gap-2 rounded-sm text-left outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-focusRing"
        aria-label={time ? `Go to ${word.text} at ${time}` : `Go to ${word.text}`}
      >
        <span className="min-w-0 truncate font-sans text-sm text-ink">{word.text}</span>
        {time ? (
          <span className="shrink-0 font-sans text-xs tabular-nums text-ink type-muted">
            {time}
          </span>
        ) : null}
      </button>
    </li>
  );
}

/** Listen To This Clip (Module 04's flow): the price, the job's progress, Cancel. */
function Listen({
  input,
  deps,
  document,
  price,
  sourceId,
  onHeard,
}: {
  input: AiEffectsInput;
  deps: AiEffectsDeps;
  document: ClipDocument;
  price: number;
  sourceId: string | null;
  onHeard: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const { job } = deps.useJob(jobId);
  const jobStatus = job?.id === jobId ? job.status : null;
  const jobError = job?.error?.message ?? null;
  const onHeardRef = useRef(onHeard);
  onHeardRef.current = onHeard;

  useEffect(() => {
    if (jobId === null || jobStatus === null) return;
    if (jobStatus === 'DONE' || jobStatus === 'CANCELLED') {
      setJobId(null);
      onHeardRef.current();
    } else if (jobStatus === 'FAILED') {
      setJobId(null);
      setProblem({ text: jobError ?? problemOf(null).text, plans: false });
    }
  }, [jobId, jobStatus, jobError]);

  const aiOn = input.status?.captions === true;
  const span = clipSpan(document, sourceId);
  const { videoId } = input;

  const listen = async () => {
    if (!videoId || !span) return;
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await deps.listen(videoId, listenRange(span, input.videoDurationMs));
      if (outcome.covered) onHeardRef.current();
      else setJobId(outcome.job.id);
    } catch (cause) {
      setProblem(problemOf(cause));
    } finally {
      setBusy(false);
    }
  };

  if (jobId !== null) {
    return (
      <div className="flex flex-col gap-2" data-testid="clip-bleep-listening">
        <Progress tone="ai" value={job?.progress ?? 0} aria-label="Listening to this clip" />
        <p className={NOTE} role="status">
          {queuedOr(job, BLEEP_LISTENING)}
        </p>
        <WaitingNote job={job} className={NOTE} />
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => {
            deps.cancelJob(jobId).catch((cause) => setProblem(problemOf(cause)));
          }}
        >
          Cancel
        </Button>
      </div>
    );
  }
  return (
    <>
      {problem ? <ProblemAlert problem={problem} orgId={input.orgId} /> : null}
      <Button
        variant="highlight"
        className="w-full"
        disabled={busy || !aiOn || !videoId || !span}
        onClick={() => void listen()}
        data-testid="clip-bleep-listen-button"
      >
        {busy ? <Spinner /> : null}
        {pricedLabel('Listen To This Clip', price)}
      </Button>
      <AiMinutesChip orgId={input.orgId} fallback={null} />
    </>
  );
}

/** My Words: the workspace's own bleep words. Nothing is saved until Save. */
export function MyWordsDialog({
  open,
  onOpenChange,
  initial,
  save,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: readonly string[];
  save: (words: readonly string[]) => Promise<string[]>;
  onSaved: (words: string[]) => void;
}) {
  const [words, setWords] = useState<string[]>([...initial]);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // Opening starts from the saved list.
  const initialKey = initial.join('\n');
  useEffect(() => {
    if (!open) return;
    setWords(initialKey ? initialKey.split('\n') : []);
    setTyped('');
    setError(null);
  }, [open, initialKey]);

  const add = (event: FormEvent) => {
    event.preventDefault();
    const added = cleanListWords(typed);
    if (added.length === 0) return;
    setWords((current) => [...new Set([...current, ...added])]);
    setTyped('');
    setError(null);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await save(words);
      if (!live.current) return;
      onSaved(saved);
      onOpenChange(false);
    } catch (cause) {
      if (live.current) setError(problemOf(cause).text);
    } finally {
      if (live.current) setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent data-testid="clip-my-words-dialog">
        <DialogHeader>
          <DialogTitle>My Words</DialogTitle>
          <DialogDescription>{MY_WORDS_HELP}</DialogDescription>
        </DialogHeader>
        <form onSubmit={add} className="flex items-center gap-2">
          <Input
            aria-label="Word"
            placeholder={MY_WORDS_PLACEHOLDER}
            value={typed}
            maxLength={MY_WORD_MAX}
            onChange={(event) => setTyped(event.target.value)}
            className="min-w-0 flex-1"
            data-testid="clip-my-words-input"
          />
          <Button type="submit" variant="secondary" disabled={cleanListWords(typed).length === 0}>
            Add
          </Button>
        </form>
        {words.length === 0 ? (
          <p className={NOTE}>{MY_WORDS_EMPTY}</p>
        ) : (
          <ul
            className="m-0 flex max-h-60 list-none flex-wrap gap-2 overflow-y-auto p-0 pg-scrollbar"
            data-testid="clip-my-words-list"
          >
            {words.map((word) => (
              <li
                key={word}
                className="flex items-center gap-1 rounded-md border-2 border-outline bg-inset py-0.5 pl-2"
              >
                <span className="font-sans text-sm text-ink">{word}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 px-0"
                  aria-label={`Remove ${word}`}
                  onClick={() => setWords((current) => current.filter((other) => other !== word))}
                >
                  <MotionIcon icon={XIcon} className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            data-testid="clip-my-words-save"
          >
            {busy ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
