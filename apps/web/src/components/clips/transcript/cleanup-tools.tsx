'use client';

/**
 * Remove Silences and Remove Filler Words (Sprint 13, Module 04), at the
 * foot of the Transcript pane. Each opens a popover that says what it found
 * before anything changes: the pauses and how long they add up to (with a
 * slider for the shortest pause), or the filler words with a tick each. The
 * numbers are the real result: the cuts are tried on the document as the
 * slider moves, so "4.2 seconds" is exactly how much shorter the clip gets.
 * **Remove** applies every cut as one undo step.
 *
 * Module 10: the same step records the cleanup on the clip (`meta.cleanup`:
 * the slider's shortest pause, or that fillers went), so Save As Recipe
 * reads it back.
 */
import { AudioLinesIcon } from '@animateicons/react/lucide/audio-lines-icon';
import { EraserIcon } from '@animateicons/react/lucide/eraser-icon';
import {
  Button,
  Checkbox,
  MotionIcon,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Slider,
} from '@postgear/ui';
import {
  type ClipDocument,
  type CutResult,
  clipSourceRanges,
  findFillers,
  findSilences,
  loudFromPeaks,
  type MsRange,
  outputDuration,
  removeSourceRanges,
  SILENCE_DEFAULT_MS,
  SILENCE_MAX_MS,
  SILENCE_MIN_MS,
  type TranscriptWord,
} from '@postgear/video-engine';
import { useId, useMemo, useState } from 'react';
import {
  cleanupToast,
  cutRefusalSentence,
  loudPausesLine,
  NO_FILLERS_LINE,
  noPausesLine,
  pausesLine,
  spokenLength,
  withCleanupNote,
} from './transcript-model';

/** Applies a change made from the latest document; false when it was refused (the sentence is shown). */
export type ApplyCut = (
  make: (doc: ClipDocument) => CutResult,
  describe: (before: ClipDocument, after: ClipDocument) => string | null,
) => boolean;

export interface CleanupToolsProps {
  document: ClipDocument;
  sourceId: string;
  words: readonly TranscriptWord[];
  covered: readonly MsRange[];
  language: string;
  /** The video's waveform peaks (0 to 255, `perSecond` a second), when loaded: loud pauses stay. */
  peaks: { data: ArrayLike<number>; perSecond: number } | null;
  disabled: boolean;
  onApply: ApplyCut;
}

const NOTE = 'm-0 font-sans text-xs text-ink type-muted';

/** What a set of cuts would do to the clip now: the length saved, or why it cannot. */
function tryCuts(doc: ClipDocument, sourceId: string, cuts: readonly MsRange[]) {
  if (cuts.length === 0) return { savedMs: 0, refusal: null };
  const result = removeSourceRanges(doc, sourceId, cuts);
  if (!result.ok) return { savedMs: 0, refusal: cutRefusalSentence(result.code) };
  return { savedMs: outputDuration(doc) - outputDuration(result.doc), refusal: null };
}

export function CleanupTools(props: CleanupToolsProps) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="clip-transcript-cleanup">
      <RemoveSilences {...props} />
      <RemoveFillers {...props} />
    </div>
  );
}

function RemoveSilences({
  document,
  sourceId,
  words,
  covered,
  peaks,
  disabled,
  onApply,
}: CleanupToolsProps) {
  const labelId = useId();
  const [open, setOpen] = useState(false);
  const [minMs, setMinMs] = useState(SILENCE_DEFAULT_MS);
  const found = useMemo(() => {
    if (!open) return null;
    const windows = clipSourceRanges(document, sourceId);
    const isLoud = peaks ? loudFromPeaks(peaks.data, peaks.perSecond) : undefined;
    const silences = findSilences({ words: [...words], covered: [...covered] }, windows, {
      minMs,
      ...(isLoud ? { isLoud } : {}),
    });
    return {
      cuts: silences.cuts,
      loudKept: silences.loudKept,
      ...tryCuts(document, sourceId, silences.cuts),
    };
  }, [open, document, sourceId, words, covered, minMs, peaks]);

  const remove = () => {
    if (!found || found.cuts.length === 0) return;
    const count = found.cuts.length;
    const applied = onApply(
      (doc) =>
        withCleanupNote(removeSourceRanges(doc, sourceId, found.cuts), { silencesMinMs: minMs }),
      (before, after) =>
        cleanupToast('pauses', count, outputDuration(before) - outputDuration(after)),
    );
    if (applied) setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          data-testid="clip-remove-silences"
        >
          <MotionIcon icon={AudioLinesIcon} className="h-4 w-4" />
          Remove Silences
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-72 flex-col gap-3"
        data-testid="clip-silences-popover"
      >
        {found ? (
          <>
            <p
              className="m-0 font-sans text-sm text-ink"
              role="status"
              data-testid="clip-silences-found"
            >
              {found.cuts.length > 0
                ? pausesLine(found.cuts.length, found.savedMs)
                : noPausesLine(minMs)}
            </p>
            {found.loudKept > 0 ? (
              <p className={NOTE} data-testid="clip-silences-loud">
                {loudPausesLine(found.loudKept)}
              </p>
            ) : null}
            <div className="flex flex-col gap-2">
              <span id={labelId} className="font-sans text-sm font-bold text-ink">
                Shortest pause to remove
              </span>
              <Slider
                value={[minMs]}
                min={SILENCE_MIN_MS}
                max={SILENCE_MAX_MS}
                step={100}
                thumbs={[{ 'aria-labelledby': labelId, 'aria-valuetext': spokenLength(minMs) }]}
                onValueChange={([next]) => {
                  if (next !== undefined) setMinMs(next);
                }}
              />
              <p className={NOTE}>{spokenLength(minMs)}</p>
            </div>
            {found.refusal ? (
              <p className="m-0 font-sans text-xs text-danger" role="alert">
                {found.refusal}
              </p>
            ) : null}
            <Button
              size="sm"
              disabled={found.cuts.length === 0 || found.refusal !== null}
              onClick={remove}
              data-testid="clip-silences-remove"
            >
              Remove
            </Button>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function RemoveFillers({
  document,
  sourceId,
  words,
  language,
  disabled,
  onApply,
}: CleanupToolsProps) {
  const [open, setOpen] = useState(false);
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const groups = useMemo(
    () =>
      open
        ? findFillers({ words: [...words] }, language, clipSourceRanges(document, sourceId))
        : [],
    [open, words, language, document, sourceId],
  );
  const { cuts, count } = useMemo(() => {
    const chosen = groups.filter((group) => !unticked.has(group.key));
    return {
      cuts: chosen.flatMap((group) => group.cuts),
      count: chosen.reduce((sum, group) => sum + group.count, 0),
    };
  }, [groups, unticked]);
  const tried = useMemo(() => tryCuts(document, sourceId, cuts), [document, sourceId, cuts]);

  const remove = () => {
    if (cuts.length === 0) return;
    const applied = onApply(
      (doc) => withCleanupNote(removeSourceRanges(doc, sourceId, cuts), { fillers: true }),
      (before, after) =>
        cleanupToast('fillers', count, outputDuration(before) - outputDuration(after)),
    );
    if (applied) setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setUnticked(new Set());
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" disabled={disabled} data-testid="clip-remove-fillers">
          <MotionIcon icon={EraserIcon} className="h-4 w-4" />
          Remove Filler Words
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-72 flex-col gap-3"
        data-testid="clip-fillers-popover"
      >
        {groups.length === 0 ? (
          <p className="m-0 font-sans text-sm text-ink" role="status">
            {NO_FILLERS_LINE}
          </p>
        ) : (
          <>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {groups.map((group) => (
                <FillerRow
                  key={group.key}
                  name={group.key}
                  count={group.count}
                  ticked={!unticked.has(group.key)}
                  onTicked={(ticked) =>
                    setUnticked((current) => {
                      const next = new Set(current);
                      if (ticked) next.delete(group.key);
                      else next.add(group.key);
                      return next;
                    })
                  }
                />
              ))}
            </ul>
            {count > 0 && tried.refusal === null ? (
              <p className={NOTE} role="status">
                {`${count} ${count === 1 ? 'word' : 'words'}, ${spokenLength(tried.savedMs)}`}
              </p>
            ) : null}
            {tried.refusal ? (
              <p className="m-0 font-sans text-xs text-danger" role="alert">
                {tried.refusal}
              </p>
            ) : null}
            <Button
              size="sm"
              disabled={cuts.length === 0 || tried.refusal !== null}
              onClick={remove}
              data-testid="clip-fillers-remove"
            >
              Remove
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function FillerRow({
  name,
  count,
  ticked,
  onTicked,
}: {
  name: string;
  count: number;
  ticked: boolean;
  onTicked: (ticked: boolean) => void;
}) {
  const id = useId();
  return (
    <li className="flex items-center gap-2">
      <Checkbox id={id} checked={ticked} onCheckedChange={(value) => onTicked(value === true)} />
      <label
        htmlFor={id}
        className="flex-1 font-sans text-sm text-ink"
        data-testid="clip-filler-row"
      >
        {`"${name}"`}
      </label>
      <span className="font-sans text-xs tabular-nums text-ink type-muted">{`${count}x`}</span>
    </li>
  );
}
