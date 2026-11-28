'use client';

import {
  type KeyboardEvent,
  memo,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from '../lib/utils';

/**
 * Where a word stands: `normal`, `removed` (cut out: struck through and
 * dimmed, with Restore on its run), or `outside` (context beyond what is
 * being edited: dimmed, not selectable).
 */
export type TranscriptWordState = 'normal' | 'removed' | 'outside';

export interface TranscriptTextWord {
  /** Stable and unique in the whole text (a transcript word's index). */
  id: number;
  text: string;
  state?: TranscriptWordState;
  /** The words were hard to hear: a dotted underline. */
  unsure?: boolean;
}

export interface TranscriptTextParagraph {
  key: string;
  /** Shown in the margin, usually the paragraph's start time ("0:42"). */
  label: string;
  /** A press on the margin label (jump to the paragraph). */
  labelAction?: () => void;
  words: readonly TranscriptTextWord[];
}

/** A selection by word ids, inclusive, in reading order once sorted by place. */
export interface TranscriptSelection {
  anchor: number;
  focus: number;
}

export interface TranscriptTextProps {
  paragraphs: readonly TranscriptTextParagraph[];
  /** The word being said now: marked in the primary colour. */
  spokenId?: number | null;
  /** Keep the spoken word in view as it moves (until the reader scrolls). */
  followSpoken?: boolean;
  /** Find matches (video page): marked; `currentMatchId` stronger and kept in view. */
  matchIds?: ReadonlySet<number>;
  currentMatchId?: number | null;
  /** Controlled selection; leave out to let the text hold its own. */
  selection?: TranscriptSelection | null;
  onSelectionChange?: (selection: TranscriptSelection | null, ids: number[]) => void;
  /** A single press on a word (jump the playhead). */
  onWordPress?: (id: number) => void;
  /** A double press on a word, or F2 on the caret's word (fix it in place). */
  onWordOpen?: (id: number) => void;
  /** Enter on the caret's word. */
  onActivate?: (id: number) => void;
  /** Delete or Backspace with words selected: their ids in reading order. */
  onDelete?: (ids: number[]) => void;
  /**
   * Restore on a run of removed words (its button, or Enter with the caret on
   * one of them): their ids in reading order. Omit for no Restore.
   */
  onRestore?: (ids: number[]) => void;
  /** Drawn after a word (the small fix field), by id; null for none. */
  renderAfterWord?: (id: number) => ReactNode;
  /** Names the text for a screen reader. */
  label: string;
  className?: string;
}

interface Placed {
  word: TranscriptTextWord;
  place: number;
}

function stateOf(word: TranscriptTextWord): TranscriptWordState {
  return word.state ?? 'normal';
}

/**
 * Read to a screen reader after the text's name: what its keys do, naming
 * only the keys this text answers.
 */
export function transcriptKeysNote(keys: {
  activate: boolean;
  cut: boolean;
  fix: boolean;
}): string {
  const parts = ['Arrow keys move word by word', 'Shift and an arrow selects'];
  if (keys.activate) parts.push('Enter jumps there');
  if (keys.cut) parts.push('Delete cuts');
  if (keys.fix) parts.push('F2 fixes the word');
  return `${parts.join(', ')}.`;
}
/** Read after a cut word, since the strike-through is only seen. */
export const TRANSCRIPT_CUT_NOTE = 'Cut.';
/** Added to the cut note when the text offers Restore. */
export const TRANSCRIPT_RESTORE_NOTE = 'Enter restores it.';
/** Read after a word that was hard to hear, since the dotted line is only seen. */
export const TRANSCRIPT_UNSURE_NOTE = 'Hard to hear.';

/** "3 words selected.": spoken as Shift and an arrow grow the selection past one word. */
export function selectedWordsLine(count: number): string {
  return count > 1 ? `${count} words selected.` : '';
}

/** What a paragraph does with its words: one stable object, so a paragraph can skip drawing. */
interface WordActions {
  pointerDown: (event: PointerEvent<HTMLSpanElement>, item: Placed) => void;
  pointerEnter: (item: Placed) => void;
  hover: (run: number | null) => void;
  press: (id: number) => void;
  open: (id: number) => void;
  restore: (ids: number[]) => void;
}

interface ParagraphProps {
  paragraph: TranscriptTextParagraph;
  placed: readonly Placed[];
  placeOf: ReadonlyMap<number, number>;
  runOf: ReadonlyMap<number, number>;
  runIds: ReadonlyMap<number, number[]>;
  baseId: string;
  /** The selection's places where it reaches this paragraph, otherwise -1 and -1. */
  selFrom: number;
  selTo: number;
  /** Each of these is null unless it falls in this paragraph. */
  spokenId: number | null;
  currentMatchId: number | null;
  restoreRun: number | null;
  matchIds: ReadonlySet<number> | undefined;
  canRestore: boolean;
  after: ReadonlyMap<number, ReactNode> | null;
  actions: WordActions;
}

/**
 * One paragraph. Memoised on purpose: while a clip plays only the spoken word
 * moves, so only the one or two paragraphs it is in draw again, not every
 * word of a long transcript (Module 16 measured a thousand words).
 */
const TranscriptParagraphView = memo(function TranscriptParagraphView({
  paragraph,
  placed,
  placeOf,
  runOf,
  runIds,
  baseId,
  selFrom,
  selTo,
  spokenId,
  currentMatchId,
  restoreRun,
  matchIds,
  canRestore,
  after,
  actions,
}: ParagraphProps) {
  return (
    <div role="presentation" className="flex gap-3">
      {paragraph.labelAction ? (
        <button
          type="button"
          tabIndex={-1}
          onClick={paragraph.labelAction}
          className="w-10 shrink-0 cursor-pointer border-0 bg-transparent p-0 pt-1 text-left font-sans text-xs leading-5 tabular-nums text-ink type-muted hover:underline"
        >
          {paragraph.label}
        </button>
      ) : (
        <span
          aria-hidden="true"
          className="w-10 shrink-0 pt-1 font-sans text-xs leading-5 tabular-nums text-ink type-muted"
        >
          {paragraph.label}
        </span>
      )}
      <div role="presentation" className="m-0 min-w-0 flex-1">
        {paragraph.words.map((word) => {
          const place = placeOf.get(word.id) ?? 0;
          const item = placed[place] as Placed;
          const state = stateOf(word);
          const selected = place >= selFrom && place <= selTo && state !== 'outside';
          const spoken = spokenId === word.id;
          const match = matchIds?.has(word.id) ?? false;
          const run = runOf.get(word.id);
          const runStart = run !== undefined && run === place;
          const unsure = word.unsure === true && state === 'normal';
          const note =
            state === 'removed'
              ? `${baseId}-cut-note`
              : unsure
                ? `${baseId}-unsure-note`
                : undefined;
          return (
            <span key={word.id} className="relative">
              {/* biome-ignore lint/a11y/useFocusableInteractive: the listbox holds focus and points at the caret's word with aria-activedescendant */}
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: the listbox's own keys (arrows, Enter, Delete, F2) do what a click does */}
              <span
                id={`${baseId}-w${word.id}`}
                role="option"
                aria-selected={selected}
                aria-disabled={state === 'outside' || undefined}
                aria-current={spoken ? 'true' : undefined}
                aria-describedby={note}
                data-word-id={word.id}
                data-state={state}
                data-spoken={spoken || undefined}
                data-match={match || undefined}
                onPointerDown={(event) => actions.pointerDown(event, item)}
                onPointerEnter={() => actions.pointerEnter(item)}
                onMouseEnter={() => actions.hover(run ?? null)}
                onMouseLeave={() => actions.hover(null)}
                onClick={() => {
                  if (state !== 'outside') actions.press(word.id);
                }}
                onDoubleClick={() => {
                  if (state === 'normal') actions.open(word.id);
                }}
                className={cn(
                  'cursor-pointer rounded-sm px-0.5 py-0.5',
                  state === 'outside' && 'cursor-default type-muted opacity-60',
                  state === 'removed' && 'line-through type-muted',
                  unsure && 'underline decoration-dotted decoration-2 underline-offset-4',
                  match && 'bg-actionAccent/40',
                  match && currentMatchId === word.id && 'bg-actionAccent text-onActionLight',
                  selected && 'bg-actionPrimary/25',
                  spoken && !selected && 'bg-actionPrimary text-onActionPrimary',
                )}
              >
                {word.text}
              </span>{' '}
              {runStart && canRestore && restoreRun === place ? (
                <button
                  type="button"
                  tabIndex={-1}
                  data-testid="transcript-restore"
                  onMouseEnter={() => actions.hover(place)}
                  onMouseLeave={() => actions.hover(null)}
                  onClick={() => actions.restore(runIds.get(place) ?? [])}
                  className="absolute -top-6 left-0 z-10 cursor-pointer whitespace-nowrap rounded-sm border-2 border-outline bg-secondary px-1.5 py-0.5 font-sans text-xs leading-4 text-ink shadow-brutalSm type-ui"
                >
                  Restore
                </button>
              ) : null}
              {after?.get(word.id) ?? null}
            </span>
          );
        })}
      </div>
    </div>
  );
});

/**
 * The words of a transcript as flowing text (Sprint 13, Clips): click a word
 * to jump to it, double-click (or F2) to fix it, drag or Shift and the arrows
 * to select, Delete to cut, Enter to jump the playhead to the caret, or to
 * restore a cut run when the caret is on it. Struck through words show
 * Restore on hover and under the caret; unsure words are underlined; the word
 * being said is marked as the clip plays.
 *
 * A read-and-select surface, not a text field: one tab stop, the caret moves
 * by word (`aria-activedescendant`), and nothing is typed into it. Words
 * outside the edited stretch are context only and cannot be selected. What
 * is only seen (struck through, dotted) is also read: each such word points
 * at a hidden note, and a polite status says how many words are selected.
 */
export function TranscriptText({
  paragraphs,
  spokenId = null,
  followSpoken = true,
  matchIds,
  currentMatchId = null,
  selection: controlled,
  onSelectionChange,
  onWordPress,
  onWordOpen,
  onActivate,
  onDelete,
  onRestore,
  renderAfterWord,
  label,
  className,
}: TranscriptTextProps) {
  const baseId = useId();
  const [own, setOwn] = useState<TranscriptSelection | null>(null);
  const selection = controlled === undefined ? own : controlled;
  const root = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const [hoverRun, setHoverRun] = useState<number | null>(null);

  // Every word in reading order, and where each id sits.
  const { placed, placeOf } = useMemo(() => {
    const list: Placed[] = [];
    const places = new Map<number, number>();
    for (const paragraph of paragraphs) {
      for (const word of paragraph.words) {
        places.set(word.id, list.length);
        list.push({ word, place: list.length });
      }
    }
    return { placed: list, placeOf: places };
  }, [paragraphs]);

  // Runs of removed words: the first word's place keys the run, with the run's ids.
  const { runOf, runIds } = useMemo(() => {
    const runs = new Map<number, number>();
    const ids = new Map<number, number[]>();
    let start: number | null = null;
    for (const item of placed) {
      if (stateOf(item.word) === 'removed') {
        if (start === null) {
          start = item.place;
          ids.set(start, []);
        }
        runs.set(item.word.id, start);
        ids.get(start)?.push(item.word.id);
      } else {
        start = null;
      }
    }
    return { runOf: runs, runIds: ids };
  }, [placed]);

  // Each paragraph's first and last place, so it is handed only what falls in it.
  const ranges = useMemo(
    () =>
      paragraphs.map((paragraph) => {
        const first = paragraph.words[0];
        const from = first ? (placeOf.get(first.id) ?? 0) : 0;
        return { from, to: from + paragraph.words.length - 1 };
      }),
    [paragraphs, placeOf],
  );

  const span = useMemo(() => {
    if (!selection) return null;
    const a = placeOf.get(selection.anchor);
    const b = placeOf.get(selection.focus);
    if (a === undefined || b === undefined) return null;
    return { from: Math.min(a, b), to: Math.max(a, b), focus: b };
  }, [selection, placeOf]);

  const idsBetween = useCallback(
    (from: number, to: number) =>
      placed
        .slice(from, to + 1)
        .filter((item) => stateOf(item.word) !== 'outside')
        .map((item) => item.word.id),
    [placed],
  );

  const select = useCallback(
    (next: TranscriptSelection | null) => {
      if (controlled === undefined) setOwn(next);
      if (!onSelectionChange) return;
      if (!next) {
        onSelectionChange(null, []);
        return;
      }
      const a = placeOf.get(next.anchor) ?? 0;
      const b = placeOf.get(next.focus) ?? 0;
      onSelectionChange(next, idsBetween(Math.min(a, b), Math.max(a, b)));
    },
    [controlled, onSelectionChange, placeOf, idsBetween],
  );

  const selectable = (place: number) => {
    const item = placed[place];
    return item !== undefined && stateOf(item.word) !== 'outside';
  };

  /** The nearest selectable place from `place` going `step`, or null. */
  const nextSelectable = (place: number, step: -1 | 1): number | null => {
    for (let p = place + step; p >= 0 && p < placed.length; p += step) {
      if (selectable(p)) return p;
    }
    return null;
  };

  const wordDomId = (id: number) => `${baseId}-w${id}`;

  // Keep the spoken word (or the current find match) in view.
  const keepInView = currentMatchId ?? (followSpoken ? spokenId : null);
  useEffect(() => {
    if (keepInView === null) return;
    const el = root.current?.querySelector<HTMLElement>(`[data-word-id="${keepInView}"]`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [keepInView]);

  // The caret's word, and the cut run it stands in (its Restore shows, Enter restores it).
  const caretWord = span ? placed[span.focus]?.word : undefined;
  const caretRun =
    caretWord && stateOf(caretWord) === 'removed' ? (runOf.get(caretWord.id) ?? null) : null;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const focusPlace = span ? span.focus : null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const from = focusPlace ?? (step === 1 ? -1 : placed.length);
      const to = nextSelectable(from, step);
      if (to === null) return;
      event.preventDefault();
      const id = (placed[to] as Placed).word.id;
      select(
        event.shiftKey && selection
          ? { anchor: selection.anchor, focus: id }
          : { anchor: id, focus: id },
      );
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      const to = event.key === 'Home' ? nextSelectable(-1, 1) : nextSelectable(placed.length, -1);
      if (to === null) return;
      event.preventDefault();
      const id = (placed[to] as Placed).word.id;
      select(
        event.shiftKey && selection
          ? { anchor: selection.anchor, focus: id }
          : { anchor: id, focus: id },
      );
      return;
    }
    if (event.key === 'Enter' && selection) {
      event.preventDefault();
      if (caretRun !== null && onRestore) {
        onRestore(runIds.get(caretRun) ?? []);
        return;
      }
      onActivate?.(selection.focus);
      return;
    }
    if (event.key === 'F2' && caretWord && stateOf(caretWord) === 'normal' && onWordOpen) {
      event.preventDefault();
      onWordOpen(caretWord.id);
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && span && onDelete) {
      const ids = idsBetween(span.from, span.to);
      if (ids.length === 0) return;
      event.preventDefault();
      onDelete(ids);
      // The words are gone from play: the caret stays on the last of them, nothing selected.
      select({
        anchor: selection?.focus ?? ids.at(-1) ?? 0,
        focus: selection?.focus ?? ids.at(-1) ?? 0,
      });
      return;
    }
    if (event.key === 'Escape' && selection) {
      event.preventDefault();
      select({ anchor: selection.focus, focus: selection.focus });
    }
  }

  function onWordPointerDown(event: PointerEvent<HTMLSpanElement>, item: Placed) {
    if (event.button !== 0 || !selectable(item.place)) return;
    root.current?.focus();
    if (event.shiftKey && selection) {
      select({ anchor: selection.anchor, focus: item.word.id });
      return;
    }
    dragging.current = item.word.id;
    select({ anchor: item.word.id, focus: item.word.id });
  }

  function onWordPointerEnter(item: Placed) {
    if (dragging.current === null || !selectable(item.place)) return;
    select({ anchor: dragging.current, focus: item.word.id });
  }

  useEffect(() => {
    const stop = () => {
      dragging.current = null;
    };
    window.addEventListener('pointerup', stop);
    return () => window.removeEventListener('pointerup', stop);
  }, []);

  // The paragraphs get one stable set of actions that always calls the latest handlers.
  const latest = useRef<WordActions | null>(null);
  latest.current = {
    pointerDown: onWordPointerDown,
    pointerEnter: onWordPointerEnter,
    hover: setHoverRun,
    press: (id) => onWordPress?.(id),
    open: (id) => onWordOpen?.(id),
    restore: (ids) => onRestore?.(ids),
  };
  const actions = useMemo<WordActions>(
    () => ({
      pointerDown: (event, item) => latest.current?.pointerDown(event, item),
      pointerEnter: (item) => latest.current?.pointerEnter(item),
      hover: (run) => latest.current?.hover(run),
      press: (id) => latest.current?.press(id),
      open: (id) => latest.current?.open(id),
      restore: (ids) => latest.current?.restore(ids),
    }),
    [],
  );

  // What the caller draws after words (the fix field), found once per draw.
  const after = new Map<number, ReactNode>();
  if (renderAfterWord) {
    for (const item of placed) {
      const node = renderAfterWord(item.word.id);
      if (node !== null && node !== undefined && node !== false) after.set(item.word.id, node);
    }
  }
  // The fix field closed while it held focus: the caret's text takes focus back.
  const afterKey = [...after.keys()].join(',');
  const hadAfter = useRef(afterKey);
  useEffect(() => {
    const was = hadAfter.current;
    hadAfter.current = afterKey;
    if (was !== '' && afterKey === '' && document.activeElement === document.body) {
      root.current?.focus();
    }
  }, [afterKey]);

  const restoreRun = hoverRun ?? caretRun;
  const selectedCount = span ? idsBetween(span.from, span.to).length : 0;
  const activeId = selection ? wordDomId(selection.focus) : undefined;
  const inRange = (place: number | null | undefined, from: number, to: number) =>
    place !== null && place !== undefined && place >= from && place <= to;

  return (
    <>
      <div
        ref={root}
        role="listbox"
        aria-label={label}
        aria-describedby={`${baseId}-keys-note`}
        aria-multiselectable="true"
        aria-activedescendant={activeId}
        tabIndex={0}
        onKeyDown={onKeyDown}
        data-testid="transcript-text"
        className={cn(
          'flex select-none flex-col gap-3 rounded-md font-sans text-sm leading-7 text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focusRing',
          className,
        )}
      >
        {paragraphs.map((paragraph, index) => {
          const { from, to } = ranges[index] ?? { from: 0, to: -1 };
          const reached = span !== null && span.from <= to && span.to >= from;
          let paragraphAfter: Map<number, ReactNode> | null = null;
          if (after.size > 0) {
            for (const word of paragraph.words) {
              const node = after.get(word.id);
              if (node === undefined) continue;
              paragraphAfter ??= new Map();
              paragraphAfter.set(word.id, node);
            }
          }
          return (
            <TranscriptParagraphView
              key={paragraph.key}
              paragraph={paragraph}
              placed={placed}
              placeOf={placeOf}
              runOf={runOf}
              runIds={runIds}
              baseId={baseId}
              selFrom={reached && span ? span.from : -1}
              selTo={reached && span ? span.to : -1}
              spokenId={inRange(placeOf.get(spokenId ?? -1), from, to) ? spokenId : null}
              currentMatchId={
                inRange(placeOf.get(currentMatchId ?? -1), from, to) ? currentMatchId : null
              }
              restoreRun={inRange(restoreRun, from, to) ? restoreRun : null}
              matchIds={matchIds}
              canRestore={onRestore !== undefined}
              after={paragraphAfter}
              actions={actions}
            />
          );
        })}
      </div>
      <span id={`${baseId}-keys-note`} hidden>
        {transcriptKeysNote({
          activate: onActivate !== undefined,
          cut: onDelete !== undefined,
          fix: onWordOpen !== undefined,
        })}
      </span>
      <span id={`${baseId}-cut-note`} hidden>
        {onRestore ? `${TRANSCRIPT_CUT_NOTE} ${TRANSCRIPT_RESTORE_NOTE}` : TRANSCRIPT_CUT_NOTE}
      </span>
      <span id={`${baseId}-unsure-note`} hidden>
        {TRANSCRIPT_UNSURE_NOTE}
      </span>
      <span role="status" className="sr-only" data-testid="transcript-selected-count">
        {selectedWordsLine(selectedCount)}
      </span>
    </>
  );
}
