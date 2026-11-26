'use client';

import {
  type KeyboardEvent,
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
  /** A double press on a word (fix it in place). */
  onWordOpen?: (id: number) => void;
  /** Enter on the caret's word. */
  onActivate?: (id: number) => void;
  /** Delete or Backspace with words selected: their ids in reading order. */
  onDelete?: (ids: number[]) => void;
  /** Restore on a run of removed words: their ids in reading order. Omit for no Restore. */
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
 * The words of a transcript as flowing text (Sprint 13, Clips): click a word
 * to jump to it, double-click to fix it, drag or Shift and the arrows to
 * select, Delete to cut, Enter to jump the playhead to the caret. Struck
 * through words show Restore on hover; unsure words are underlined; the
 * word being said is marked as the clip plays.
 *
 * A read-and-select surface, not a text field: one tab stop, the caret moves
 * by word (`aria-activedescendant`), and nothing is typed into it. Words
 * outside the edited stretch are context only and cannot be selected.
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

  // Runs of removed words: the first word's place keys the run.
  const runOf = useMemo(() => {
    const runs = new Map<number, number>();
    let start: number | null = null;
    for (const item of placed) {
      if (stateOf(item.word) === 'removed') {
        if (start === null) start = item.place;
        runs.set(item.word.id, start);
      } else {
        start = null;
      }
    }
    return runs;
  }, [placed]);

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
      onActivate?.(selection.focus);
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

  const activeId = selection ? wordDomId(selection.focus) : undefined;

  return (
    <div
      ref={root}
      role="listbox"
      aria-label={label}
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
      {paragraphs.map((paragraph) => (
        <div key={paragraph.key} role="presentation" className="flex gap-3">
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
              const selected =
                span !== null && place >= span.from && place <= span.to && state !== 'outside';
              const spoken = spokenId === word.id;
              const match = matchIds?.has(word.id) ?? false;
              const run = runOf.get(word.id);
              const runStart = run !== undefined && run === place;
              const runIds =
                runStart && onRestore
                  ? placed
                      .slice(place)
                      .filter((other, k) => k === 0 || runOf.get(other.word.id) === place)
                      .map((other) => other.word.id)
                  : [];
              return (
                <span key={word.id} className="relative">
                  {/* biome-ignore lint/a11y/useFocusableInteractive: the listbox holds focus and points at the caret's word with aria-activedescendant */}
                  {/* biome-ignore lint/a11y/useKeyWithClickEvents: the listbox's own keys (arrows, Enter, Delete) do what a click does */}
                  <span
                    id={wordDomId(word.id)}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={state === 'outside' || undefined}
                    aria-current={spoken ? 'true' : undefined}
                    data-word-id={word.id}
                    data-state={state}
                    data-spoken={spoken || undefined}
                    data-match={match || undefined}
                    onPointerDown={(event) => onWordPointerDown(event, item)}
                    onPointerEnter={() => onWordPointerEnter(item)}
                    onMouseEnter={() => setHoverRun(run ?? null)}
                    onMouseLeave={() => setHoverRun(null)}
                    onClick={() => {
                      if (state !== 'outside') onWordPress?.(word.id);
                    }}
                    onDoubleClick={() => {
                      if (state === 'normal') onWordOpen?.(word.id);
                    }}
                    className={cn(
                      'cursor-pointer rounded-sm px-0.5 py-0.5',
                      state === 'outside' && 'cursor-default type-muted opacity-60',
                      state === 'removed' && 'line-through type-muted',
                      word.unsure &&
                        state === 'normal' &&
                        'underline decoration-dotted decoration-2 underline-offset-4',
                      match && 'bg-actionAccent/40',
                      match && currentMatchId === word.id && 'bg-actionAccent text-onActionLight',
                      selected && 'bg-actionPrimary/25',
                      spoken && !selected && 'bg-actionPrimary text-onActionPrimary',
                    )}
                  >
                    {word.text}
                  </span>{' '}
                  {runStart && onRestore && hoverRun === place ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      data-testid="transcript-restore"
                      onMouseEnter={() => setHoverRun(place)}
                      onMouseLeave={() => setHoverRun(null)}
                      onClick={() => onRestore(runIds)}
                      className="absolute -top-6 left-0 z-10 cursor-pointer whitespace-nowrap rounded-sm border-2 border-outline bg-secondary px-1.5 py-0.5 font-sans text-xs leading-4 text-ink shadow-brutalSm type-ui"
                    >
                      Restore
                    </button>
                  ) : null}
                  {renderAfterWord?.(word.id) ?? null}
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
