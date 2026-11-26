'use client';

/**
 * Add Hook Title and Add Hook Clip (Sprint 13, Module 09; blueprint
 * section 7): two rows of the Effects tab.
 *
 * - **Add Hook Title**: three titles written from the clip's words (free;
 *   a ghost while they come; **Try Again** asks for three more), a field to
 *   type one's own, and the three hook looks drawn like the Text tab's style
 *   tiles. **Add** puts it on the first seconds (`addHookTitle`), one undo
 *   step; a clip keeps one, so Add again changes it.
 * - **Add Hook Clip**: the clip in small (its sound's shape) with a 1 to 5
 *   second range to drag, the suggestion picked first (`suggestHook` on the
 *   loudest second and the spoken words). **Preview** plays the range in the
 *   editor's player, then jumps to the clip's start: nothing is applied.
 *   **Add** (`setHook`), one undo step. With a hook: "Hook: 2.5 s" and
 *   **Remove Hook**.
 */
import { PlayIcon } from '@animateicons/react/lucide/play-icon';
import { RefreshCwIcon } from '@animateicons/react/lucide/refresh-cw-icon';
import { Button, ChoiceTiles, cn, Input, MotionIcon, Skeleton } from '@postgear/ui';
import {
  addHookTitle,
  type ClipDocument,
  canSetHook,
  documentRange,
  HOOK_STYLE_IDS,
  HOOK_TEXT_STYLES,
  type HookRange,
  type HookStyleId,
  hookOf,
  hookTitleOf,
  matchingTextStyle,
  outputDuration,
  peaksFromWaveform,
  placeSegments,
  removeHook,
  setHook,
  suggestHook,
  TEXT_MAX,
} from '@postgear/video-engine';
import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { GroupLabel, NOTE } from '@/components/studio/panel-ui';
import type { ClipWaveform } from '@/types/clips';
import type { PlaybackStore } from '../editor/playback';
import { usePeaks } from '../timeline/timeline-media';
import { Waveform } from '../timeline/waveform';
import {
  defaultHookRange,
  HOOK_ADDED,
  HOOK_PREVIEW_NOTE,
  HOOK_REMOVED,
  HOOK_STEP_MS,
  HOOK_TITLE_ADDED,
  HOOK_TITLE_CHANGED,
  HOOK_TITLE_PLACEHOLDER,
  type HookRangeMove,
  hookLengthText,
  hookRangeText,
  hookRefusalSentence,
  moveHookRange,
  secondsText,
} from './ai-effects-model';
import {
  type AiEffectsDeps,
  type AiEffectsInput,
  type Problem,
  problemOf,
} from './ai-effects-deps';
import { ProblemAlert, type SpokenWords } from './bleep-row';
import { StyleDrawing } from './text-panel';

function isHookStyle(id: string | null): id is HookStyleId {
  return id !== null && (HOOK_STYLE_IDS as readonly string[]).includes(id);
}

// ---------------------------------------------------------------------------
// Add Hook Title
// ---------------------------------------------------------------------------

export function HookTitleRow({
  input,
  deps,
  document,
}: {
  input: AiEffectsInput;
  deps: AiEffectsDeps;
  document: ClipDocument;
}) {
  const suggestionsId = useId();
  const lookId = useId();
  const fieldId = useId();
  const existing = hookTitleOf(document);
  const existingLook = existing ? matchingTextStyle(existing.style) : null;
  const [text, setText] = useState(existing?.text ?? '');
  const [look, setLook] = useState<HookStyleId>(
    isHookStyle(existingLook) ? existingLook : 'hook-bold',
  );
  const [titles, setTitles] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const asking = useRef(0);
  // Try Again counts up, so each ask answers three new titles.
  const attempts = useRef(0);
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const { clipId } = input;

  const ask = useCallback(
    async (attempt: number) => {
      asking.current += 1;
      const mine = asking.current;
      setLoading(true);
      setProblem(null);
      try {
        const next = await depsRef.current.hookTitles(clipId, attempt);
        if (mine === asking.current) setTitles(next.slice(0, 3));
      } catch (cause) {
        if (mine === asking.current) setProblem(problemOf(cause));
      } finally {
        if (mine === asking.current) setLoading(false);
      }
    },
    [clipId],
  );

  // Three titles as the row opens.
  useEffect(() => {
    attempts.current = 0;
    void ask(0);
    return () => {
      asking.current += 1;
    };
  }, [ask]);
  const askAgain = () => {
    attempts.current += 1;
    void ask(attempts.current);
  };

  const words = text.replace(/\s+/g, ' ').trim();
  const add = () => {
    if (words.length === 0) return;
    input.onEdit(
      (doc) => addHookTitle(doc, words, look),
      existing ? HOOK_TITLE_CHANGED : HOOK_TITLE_ADDED,
    );
  };

  return (
    <div className="flex flex-col gap-4" data-testid="clip-hook-title">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <GroupLabel id={suggestionsId}>Suggestions</GroupLabel>
          <Button
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={askAgain}
            data-testid="clip-hook-title-again"
          >
            <MotionIcon icon={RefreshCwIcon} className="h-4 w-4" />
            Try Again
          </Button>
        </div>
        {problem ? <ProblemAlert problem={problem} orgId={input.orgId} /> : null}
        {loading ? (
          <div
            className="flex flex-col gap-2"
            aria-busy="true"
            data-testid="clip-hook-title-loading"
          >
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : titles && titles.length > 0 ? (
          <ul
            aria-labelledby={suggestionsId}
            className="m-0 flex list-none flex-col gap-2 p-0"
            data-testid="clip-hook-title-tiles"
          >
            {titles.map((title) => (
              <li key={title}>
                <Button
                  variant="secondary"
                  className="h-auto min-h-11 w-full justify-start whitespace-normal py-2 text-left"
                  aria-pressed={words === title}
                  onClick={() => setText(title)}
                  data-testid="clip-hook-title-tile"
                >
                  {title}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <GroupLabel id={fieldId}>Title</GroupLabel>
        <Input
          aria-labelledby={fieldId}
          placeholder={HOOK_TITLE_PLACEHOLDER}
          value={text}
          maxLength={TEXT_MAX}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add();
          }}
          data-testid="clip-hook-title-input"
        />
      </div>

      <div className="flex flex-col gap-2">
        <GroupLabel id={lookId}>Look</GroupLabel>
        <ChoiceTiles<HookStyleId>
          labelledBy={lookId}
          columns={3}
          value={look}
          onValueChange={setLook}
          options={HOOK_TEXT_STYLES.map((preset) => ({
            value: preset.id as HookStyleId,
            label: preset.name,
            drawing: <StyleDrawing style={preset.style} />,
          }))}
        />
      </div>

      <Button
        className="w-full"
        disabled={words.length === 0}
        onClick={add}
        data-testid="clip-hook-title-add"
      >
        Add
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Hook Clip
// ---------------------------------------------------------------------------

export function HookClipRow({
  input,
  document,
  playback,
  spoken,
  waveform,
}: {
  input: AiEffectsInput;
  document: ClipDocument;
  playback: PlaybackStore;
  spoken: SpokenWords;
  waveform: ClipWaveform | null;
}) {
  const hook = hookOf(document);
  if (hook) {
    return (
      <div className="flex flex-col gap-3" data-testid="clip-hook-clip">
        <p className="m-0 font-sans text-sm tabular-nums text-ink" data-testid="clip-hook-length">
          {hookLengthText(hook.durationMs)}
        </p>
        <Button
          variant="danger"
          className="w-full"
          onClick={() => input.onEdit(removeHook, HOOK_REMOVED)}
          data-testid="clip-hook-remove"
        >
          Remove Hook
        </Button>
      </div>
    );
  }
  return (
    <HookPicker
      input={input}
      document={document}
      playback={playback}
      spoken={spoken}
      waveform={waveform}
    />
  );
}

function HookPicker({
  input,
  document,
  playback,
  spoken,
  waveform,
}: {
  input: AiEffectsInput;
  document: ClipDocument;
  playback: PlaybackStore;
  spoken: SpokenWords;
  waveform: ClipWaveform | null;
}) {
  const totalMs = outputDuration(document);
  const peaks = usePeaks(waveform?.url ?? null);
  const perSecond = waveform?.meta.perSecond ?? 0;
  const words = spoken.view?.transcript?.words ?? null;
  const suggestion = useMemo(() => {
    const range = documentRange(document) ?? undefined;
    const signals =
      peaks && perSecond > 0 ? { peaks: peaksFromWaveform(peaks, perSecond, range) } : null;
    return suggestHook(document, signals, words);
  }, [document, peaks, perSecond, words]);

  // The suggestion stays picked until the range is moved by hand.
  const [picked, setPicked] = useState<HookRange | null>(null);
  const range = moveHookRange(
    picked ?? suggestion ?? defaultHookRange(totalMs),
    'move',
    0,
    totalMs,
  );
  const [refusal, setRefusal] = useState<string | null>(null);

  // ---- Preview: the range in the editor's player, then the clip from its start --------
  const stopPreview = useRef<(() => void) | null>(null);
  useEffect(() => () => stopPreview.current?.(), []);
  const preview = () => {
    stopPreview.current?.();
    const { fromOutputMs, toOutputMs } = range;
    let started = false;
    const stop = () => {
      unsubscribe();
      if (stopPreview.current === stop) stopPreview.current = null;
    };
    const unsubscribe = playback.subscribe(() => {
      const playing = playback.isPlaying();
      if (playing) started = true;
      // Paused, or moved away by hand: the preview lets go.
      if (started && !playing) return stop();
      const at = playback.getCurrentMs();
      if (at < fromOutputMs - 250) return stop();
      if (at >= toOutputMs) {
        stop();
        playback.seekMs(0);
      }
    });
    stopPreview.current = stop;
    playback.seekMs(fromOutputMs);
    playback.play();
  };

  const add = () => {
    const code = canSetHook(document, range);
    if (code !== null) {
      setRefusal(hookRefusalSentence(code));
      return;
    }
    setRefusal(null);
    stopPreview.current?.();
    input.onEdit((doc) => setHook(doc, range), HOOK_ADDED);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="clip-hook-clip">
      <HookRangePicker
        document={document}
        waveform={waveform}
        range={range}
        totalMs={totalMs}
        onChange={(next) => {
          setRefusal(null);
          setPicked(next);
        }}
      />
      <p className="m-0 font-sans text-sm tabular-nums text-ink" data-testid="clip-hook-range">
        {hookRangeText(range)}
      </p>
      {refusal ? (
        <ProblemAlert problem={{ text: refusal, plans: false }} orgId={input.orgId} />
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={preview} data-testid="clip-hook-preview">
          <MotionIcon icon={PlayIcon} className="h-4 w-4" />
          Preview
        </Button>
        <Button onClick={add} data-testid="clip-hook-add">
          Add
        </Button>
      </div>
      <p className={NOTE}>{HOOK_PREVIEW_NOTE}</p>
    </div>
  );
}

const STRIP_H = 40;
const EDGE = 'absolute inset-y-0 w-2 cursor-col-resize bg-actionPrimary';
const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-focusRing';

/**
 * The clip in small with the hook's range over it: drag the range to move
 * it, drag an edge to change its length (1 to 5 seconds); the start, the
 * range and the end are sliders the arrows move too (Shift for a second).
 */
export function HookRangePicker({
  document,
  waveform,
  range,
  totalMs,
  onChange,
}: {
  document: ClipDocument;
  waveform: ClipWaveform | null;
  range: HookRange;
  totalMs: number;
  onChange: (range: HookRange) => void;
}) {
  const strip = useRef<HTMLDivElement | null>(null);
  const [widthPx, setWidthPx] = useState(0);
  useLayoutEffect(() => {
    const node = strip.current;
    if (!node) return;
    const measure = () => setWidthPx(node.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const parts = useMemo(() => placeSegments(document), [document]);
  const total = Math.max(1, totalMs);
  const pct = (ms: number) => `${(Math.max(0, Math.min(total, ms)) / total) * 100}%`;
  const drag = useRef<{ mode: HookRangeMove; x: number; start: HookRange } | null>(null);

  const begin = (mode: HookRangeMove) => (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { mode, x: event.clientX, start: range };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    const width = strip.current?.getBoundingClientRect().width ?? 0;
    if (!current || !(width > 0)) return;
    const deltaMs = ((event.clientX - current.x) / width) * total;
    onChange(moveHookRange(current.start, current.mode, deltaMs, totalMs));
  };
  const end = () => {
    drag.current = null;
  };

  const keys = (mode: HookRangeMove) => (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? HOOK_STEP_MS * 10 : HOOK_STEP_MS;
    const delta =
      event.key === 'ArrowLeft' || event.key === 'ArrowDown'
        ? -step
        : event.key === 'ArrowRight' || event.key === 'ArrowUp'
          ? step
          : null;
    if (delta === null) return;
    event.preventDefault();
    onChange(moveHookRange(range, mode, delta, totalMs));
  };

  const lengthMs = range.toOutputMs - range.fromOutputMs;
  const slider = (mode: HookRangeMove, label: string, now: number, text: string) => ({
    role: 'slider' as const,
    tabIndex: 0,
    'aria-label': label,
    'aria-valuemin': 0,
    'aria-valuemax': totalMs,
    'aria-valuenow': Math.round(now),
    'aria-valuetext': text,
    onKeyDown: keys(mode),
    onPointerDown: begin(mode),
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: end,
  });

  return (
    <div
      ref={strip}
      className="relative w-full touch-none select-none overflow-hidden rounded-md border-2 border-outline bg-inset"
      style={{ height: STRIP_H + 4 }}
      data-testid="clip-hook-picker"
    >
      {widthPx > 0
        ? parts.map(({ segment, outStart, outEnd }) => {
            const left = (outStart / total) * widthPx;
            const width = Math.max(1, Math.round(((outEnd - outStart) / total) * widthPx));
            return (
              <Waveform
                key={segment.id}
                waveform={waveform}
                fromMs={segment.sourceIn}
                toMs={segment.sourceOut}
                pxPerMs={width / Math.max(1, segment.sourceOut - segment.sourceIn)}
                widthPx={width}
                heightPx={STRIP_H}
                className="pointer-events-none absolute top-0.5 text-ink/50"
                style={{ left }}
              />
            );
          })
        : null}
      <div
        {...slider('move', 'Hook Position', range.fromOutputMs, hookRangeText(range))}
        data-testid="clip-hook-range-body"
        className={cn(
          'absolute inset-y-0 cursor-grab rounded-sm border-2 border-actionPrimary bg-actionPrimary/25',
          FOCUS,
        )}
        style={{ left: pct(range.fromOutputMs), width: pct(lengthMs) }}
      />
      <div
        {...slider('start', 'Hook Start', range.fromOutputMs, secondsText(range.fromOutputMs))}
        data-testid="clip-hook-range-start"
        className={cn(EDGE, FOCUS)}
        style={{ left: pct(range.fromOutputMs) }}
      />
      <div
        {...slider('end', 'Hook End', range.toOutputMs, secondsText(range.toOutputMs))}
        data-testid="clip-hook-range-end"
        className={cn(EDGE, '-translate-x-full', FOCUS)}
        style={{ left: pct(range.toOutputMs) }}
      />
    </div>
  );
}
