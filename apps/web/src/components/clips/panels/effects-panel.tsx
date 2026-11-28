'use client';

/**
 * The Effects tab (Module 13 section 5): three cards, each a name and one
 * line that opens its controls in place.
 *
 * - **Zoom**: Add Zoom puts a two second zoom at the playhead and selects
 *   it. The selected zoom's Amount, Ease, From and For, and Remove Zoom; its
 *   focus is the dot on the clip (`zoom-focus-dot.tsx`).
 * - **Speed Control**: the selected part's speed (six keys in two rows), its
 *   new length, and a note when very slow sound may sound rough.
 * - **Looks**: one look for the whole clip, each tile drawn on the picture
 *   at the playhead with the look's own colour matrix (the one the export
 *   uses); Strength, Vignette, Fade In and Fade Out.
 *
 * - **The AI rows** (Sprint 13, Module 09): Bleep Bad Words, Add Hook Title,
 *   Add Hook Clip and, while the API offers it, Text To Speech, in the same
 *   cards (`bleep-row.tsx`, `hook-rows.tsx`, `voice-row.tsx`). They show when
 *   the editor hands the panel `ai`.
 *
 * Like the other tabs, the panel never edits the document itself: each
 * change goes to the editor as one undo step, and a slider passes a coalesce
 * key so its whole drag is one step. A card opens by itself when a zoom or a
 * part is selected on the timeline.
 */
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  ChoiceTiles,
  Slider,
  TimeField,
  Toggle,
} from '@postgear/ui';
import {
  type ClipDocument,
  type Fades,
  type FilmstripMeta,
  type FilmstripTile,
  LOOK_NAMES,
  LOOK_ORDER,
  type LookColour,
  type Looks,
  lookSvgValues,
  outputDuration,
  type Speed,
  tilesInRange,
  ZOOM_MIN_MS,
  ZOOM_SCALE_MAX,
  ZOOM_SCALE_MIN,
  type Zoom,
  zoomEaseName,
} from '@postgear/video-engine';
import {
  AudioLines,
  Clapperboard,
  Gauge,
  Heading,
  type LucideIcon,
  Palette,
  ScanFace,
  VolumeX,
  ZoomIn,
} from 'lucide-react';
import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { GroupLabel, NOTE, PercentSlider, Segmented } from '@/components/studio/panel-ui';
import type { ClipFilmstrip } from '@/types/clips';
import type { EditorSelection } from '../editor/editor-state';
import type { PlaybackStore } from '../editor/playback';
import { forgetSheetWaiter, prepareCanvas, sheetImage } from '../timeline/timeline-media';
import { type AiEffectsInput, DEFAULT_AI_EFFECTS_DEPS, useSpokenWords } from './ai-effects-deps';
import { AI_EFFECT_CARDS, type AiEffectCard } from './ai-effects-model';
import { BleepRow } from './bleep-row';
import { type BlurChange, BlurControls } from './blur-controls';
import {
  amountText,
  EASE_OPTIONS,
  EFFECT_CARDS,
  type EffectCard,
  easeMsOf,
  FADE_DEFAULT_MS,
  FADE_OPTIONS,
  fadeChoice,
  fadeOf,
  SPEED_OPTIONS,
  SPEED_PICK_NOTE,
  SPEED_ROUGH_NOTE,
  sampleTile,
  soundsRough,
  speedLengthLine,
  speedOf,
  ZOOM_GONE_NOTE,
  ZOOM_PICK_NOTE,
  zoomTiming,
} from './effects-model';
import { HookClipRow, HookTitleRow } from './hook-rows';
import { VoiceRow } from './voice-row';

export interface EffectsPanelProps {
  document: ClipDocument;
  selection: EditorSelection;
  fps: number;
  playback: PlaybackStore;
  /** The pictures the look tiles are drawn on (null: a plain sample instead). */
  filmstrip: ClipFilmstrip | null;
  onAddZoom: () => void;
  onZoom: (
    zoomId: string,
    change: Partial<Pick<Zoom, 'scale' | 'ease'>>,
    coalesceKey?: string,
  ) => void;
  /** From moves the zoom (`length`); For moves its end (`from`). */
  onZoomTiming: (
    zoomId: string,
    startMs: number,
    durationMs: number,
    keep: 'length' | 'from',
  ) => void;
  onRemoveZoom: (zoomId: string) => void;
  onSpeed: (segmentId: string, speed: Speed) => void;
  onLooks: (change: Partial<Looks>, coalesceKey?: string) => void;
  onFades: (change: Partial<Fades>) => void;
  /** Module 17 item 18: a change to the blurred boxes, one undo step. */
  onBlur: BlurChange;
  /** Sprint 13, Module 09: the AI rows' needs; left out, the rows do not show. */
  ai?: AiEffectsInput | null;
}

const CARD_ICONS: Readonly<Record<EffectCard | AiEffectCard, LucideIcon>> = {
  zoom: ZoomIn,
  speed: Gauge,
  looks: Palette,
  blur: ScanFace,
  bleep: VolumeX,
  'hook-title': Heading,
  'hook-clip': Clapperboard,
  voice: AudioLines,
};

/** The card a selection opens, if any. */
function cardFor(selection: EditorSelection): EffectCard | null {
  if (selection?.kind === 'zoom') return 'zoom';
  if (selection?.kind === 'segment') return 'speed';
  return null;
}

export function EffectsPanel({
  document,
  selection,
  fps,
  playback,
  filmstrip,
  onAddZoom,
  onZoom,
  onZoomTiming,
  onRemoveZoom,
  onSpeed,
  onLooks,
  onFades,
  onBlur,
  ai = null,
}: EffectsPanelProps) {
  const [open, setOpen] = useState<string[]>(() => {
    const card = cardFor(selection);
    return card ? [card] : [];
  });

  // Selecting a zoom or a part on the timeline opens its card (and leaves the others as they are).
  const selectedCard = cardFor(selection);
  const selectedId = selection?.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new selection of the same kind opens the card again
  useEffect(() => {
    if (!selectedCard) return;
    setOpen((current) => (current.includes(selectedCard) ? current : [...current, selectedCard]));
  }, [selectedCard, selectedId]);

  const zoom =
    selection?.kind === 'zoom' ? (document.zooms.find((z) => z.id === selection.id) ?? null) : null;
  const segment =
    selection?.kind === 'segment'
      ? (document.segments.find((s) => s.id === selection.id) ?? null)
      : null;

  const aiDeps = ai?.deps ?? DEFAULT_AI_EFFECTS_DEPS;
  const spoken = useSpokenWords(
    ai?.clipId ?? '',
    ai !== null && (open.includes('bleep') || open.includes('hook-clip')),
    aiDeps,
  );
  const aiCards = ai
    ? AI_EFFECT_CARDS.filter((card) => card.value !== 'voice' || ai.status?.voice === true)
    : [];
  const cards: ReadonlyArray<{ value: EffectCard | AiEffectCard; name: string; line: string }> = [
    ...EFFECT_CARDS,
    ...aiCards,
  ];

  const bodies: Record<EffectCard | AiEffectCard, ReactNode> = {
    zoom: (
      <ZoomControls
        document={document}
        zoom={zoom}
        fps={fps}
        onAddZoom={onAddZoom}
        onZoom={onZoom}
        onZoomTiming={onZoomTiming}
        onRemoveZoom={onRemoveZoom}
      />
    ),
    speed: <SpeedControls segment={segment} onSpeed={onSpeed} />,
    blur: <BlurControls document={document} onBlur={onBlur} />,
    looks: (
      <LookControls
        document={document}
        playback={playback}
        filmstrip={filmstrip}
        onLooks={onLooks}
        onFades={onFades}
      />
    ),
    bleep: ai ? (
      <BleepRow input={ai} deps={aiDeps} document={document} playback={playback} spoken={spoken} />
    ) : null,
    'hook-title': ai ? <HookTitleRow input={ai} deps={aiDeps} document={document} /> : null,
    'hook-clip': ai ? (
      <HookClipRow
        input={ai}
        document={document}
        playback={playback}
        spoken={spoken}
        waveform={ai.waveform}
      />
    ) : null,
    voice: ai ? <VoiceRow input={ai} deps={aiDeps} playback={playback} /> : null,
  };

  return (
    <div className="pt-1" data-testid="clip-effects-panel">
      <Accordion
        type="multiple"
        value={open}
        onValueChange={setOpen}
        className="flex flex-col gap-3"
      >
        {cards.map((card) => {
          const Icon = CARD_ICONS[card.value];
          return (
            <AccordionItem
              key={card.value}
              value={card.value}
              data-testid={`clip-effect-${card.value}`}
            >
              <AccordionTrigger className="px-3">
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border-2 border-outline bg-inset"
                  >
                    <Icon className="h-4 w-4" strokeWidth={2.5} />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="type-heading text-sm text-ink">{card.name}</span>
                    <span className="font-sans text-xs text-ink type-muted">{card.line}</span>
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="flex flex-col gap-4 px-3 py-4 opacity-100">
                {bodies[card.value]}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

function ZoomControls({
  document,
  zoom,
  fps,
  onAddZoom,
  onZoom,
  onZoomTiming,
  onRemoveZoom,
}: {
  document: ClipDocument;
  zoom: Zoom | null;
  fps: number;
  onAddZoom: () => void;
  onZoom: EffectsPanelProps['onZoom'];
  onZoomTiming: EffectsPanelProps['onZoomTiming'];
  onRemoveZoom: (zoomId: string) => void;
}) {
  const amountId = useId();
  const easeId = useId();
  const totalMs = outputDuration(document);
  const timing = zoom ? zoomTiming(document, zoom.id) : null;

  return (
    <>
      <Button className="w-full" onClick={onAddZoom}>
        Add Zoom
      </Button>
      {!zoom ? (
        document.zooms.length > 0 ? (
          <p className={NOTE}>{ZOOM_PICK_NOTE}</p>
        ) : null
      ) : (
        <div className="flex flex-col gap-4" data-testid="clip-selected-zoom">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <GroupLabel id={amountId}>Amount</GroupLabel>
              <span
                aria-hidden="true"
                className="font-sans text-xs tabular-nums text-ink type-muted"
              >
                {amountText(zoom.scale)}
              </span>
            </div>
            <Slider
              value={[zoom.scale]}
              min={ZOOM_SCALE_MIN}
              max={ZOOM_SCALE_MAX}
              step={0.1}
              thumbs={[{ 'aria-labelledby': amountId, 'aria-valuetext': amountText(zoom.scale) }]}
              onValueChange={([scale]) => {
                if (scale !== undefined) onZoom(zoom.id, { scale }, `zoom-amount:${zoom.id}`);
              }}
            />
          </div>

          <div className="flex flex-col gap-1">
            <GroupLabel id={easeId}>Ease</GroupLabel>
            <Segmented
              labelledBy={easeId}
              value={zoomEaseName(zoom.ease)}
              onValueChange={(name) => onZoom(zoom.id, { ease: easeMsOf(name) })}
              options={EASE_OPTIONS}
            />
          </div>

          {timing ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <GroupLabel>From</GroupLabel>
                <TimeField
                  aria-label="From"
                  valueMs={timing.startMs}
                  min={0}
                  max={Math.max(0, totalMs - ZOOM_MIN_MS)}
                  fps={fps}
                  onChange={(start) => onZoomTiming(zoom.id, start, timing.durationMs, 'length')}
                />
              </div>
              <div className="flex flex-col gap-1">
                <GroupLabel>For</GroupLabel>
                <TimeField
                  aria-label="For"
                  valueMs={timing.durationMs}
                  min={ZOOM_MIN_MS}
                  max={Math.max(ZOOM_MIN_MS, totalMs - timing.startMs)}
                  fps={fps}
                  onChange={(duration) => onZoomTiming(zoom.id, timing.startMs, duration, 'from')}
                />
              </div>
            </div>
          ) : (
            <p className={NOTE}>{ZOOM_GONE_NOTE}</p>
          )}

          <Button variant="danger" className="w-full" onClick={() => onRemoveZoom(zoom.id)}>
            Remove Zoom
          </Button>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Speed
// ---------------------------------------------------------------------------

function SpeedControls({
  segment,
  onSpeed,
}: {
  segment: ClipDocument['segments'][number] | null;
  onSpeed: (segmentId: string, speed: Speed) => void;
}) {
  const speedId = useId();
  if (!segment) {
    return (
      <p className={NOTE} data-testid="clip-speed-none">
        {SPEED_PICK_NOTE}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="clip-speed">
      <GroupLabel id={speedId}>Speed</GroupLabel>
      {/* Six keys in two rows: one toggle bar of six does not fit the panel's width. */}
      <ChoiceTiles
        labelledBy={speedId}
        columns={3}
        value={`${segment.speed}` as `${Speed}`}
        onValueChange={(value) => {
          const speed = speedOf(value);
          if (speed !== null) onSpeed(segment.id, speed);
        }}
        options={SPEED_OPTIONS}
      />
      <p className="m-0 font-sans text-sm tabular-nums text-ink" data-testid="clip-speed-length">
        {speedLengthLine(segment)}
      </p>
      {soundsRough(segment.speed) ? <p className={NOTE}>{SPEED_ROUGH_NOTE}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Looks
// ---------------------------------------------------------------------------

/** The sample picture's size on a tile, in CSS pixels. */
const SAMPLE_W = 96;
const SAMPLE_H = 54;

/** Shown when the video has no small pictures yet: skin, sky and leaf tones, so every look shows. */
const PLAIN_SAMPLE =
  'linear-gradient(135deg, #d9a07a 0%, #d9a07a 30%, #6090c0 30%, #6090c0 65%, #5f9a52 65%, #5f9a52 100%)';

let filterSerial = 0;

function LookControls({
  document,
  playback,
  filmstrip,
  onLooks,
  onFades,
}: {
  document: ClipDocument;
  playback: PlaybackStore;
  filmstrip: ClipFilmstrip | null;
  onLooks: EffectsPanelProps['onLooks'];
  onFades: EffectsPanelProps['onFades'];
}) {
  const lookId = useId();
  const [prefix] = useState(() => {
    filterSerial += 1;
    return `pg-look-tile-${filterSerial}`;
  });
  const { looks, fades } = document;
  const tile = useSampleTile(playback, document, filmstrip?.meta ?? null);

  const options = LOOK_ORDER.map((colour) => ({
    value: colour,
    label: LOOK_NAMES[colour],
    drawing: (
      <LookSample
        strip={filmstrip}
        tile={tile}
        filter={colour === 'none' ? null : `url(#${prefix}-${colour})`}
      />
    ),
  }));

  return (
    <>
      {/* The tiles' colour matrices: each look at full strength, as the export writes it. */}
      <svg aria-hidden="true" width="0" height="0" className="absolute h-0 w-0 overflow-hidden">
        <defs>
          {LOOK_ORDER.filter((colour) => colour !== 'none').map((colour) => (
            <filter
              key={colour}
              id={`${prefix}-${colour}`}
              colorInterpolationFilters="sRGB"
              x="0"
              y="0"
              width="1"
              height="1"
            >
              <feColorMatrix
                type="matrix"
                values={lookSvgValues({ colour, strength: 1 }) ?? undefined}
              />
            </filter>
          ))}
        </defs>
      </svg>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <GroupLabel id={lookId}>Look</GroupLabel>
          <span className="font-sans text-xs text-ink type-muted" data-testid="clip-look-name">
            {LOOK_NAMES[looks.colour]}
          </span>
        </div>
        <ChoiceTiles<LookColour>
          labelledBy={lookId}
          columns={2}
          value={looks.colour}
          onValueChange={(colour) =>
            onLooks(
              colour !== 'none' && looks.strength === 0 ? { colour, strength: 1 } : { colour },
            )
          }
          options={options}
          className="[&_button]:px-2 [&_button]:py-2"
        />
      </div>

      {looks.colour !== 'none' ? (
        <PercentSlider
          label="Strength"
          value={Math.round(looks.strength * 100)}
          onValueChange={(percent) => onLooks({ strength: percent / 100 }, 'look-strength')}
        />
      ) : null}
      <PercentSlider
        label="Vignette"
        value={Math.round(looks.vignette * 100)}
        onValueChange={(percent) => onLooks({ vignette: percent / 100 }, 'look-vignette')}
      />

      <FadeRow label="Fade In" ms={fades.inMs} onChange={(inMs) => onFades({ inMs })} />
      <FadeRow label="Fade Out" ms={fades.outMs} onChange={(outMs) => onFades({ outMs })} />
    </>
  );
}

function FadeRow({
  label,
  ms,
  onChange,
}: {
  label: string;
  ms: number;
  onChange: (ms: number) => void;
}) {
  const id = useId();
  const on = ms > 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <GroupLabel id={id}>{label}</GroupLabel>
        <Toggle
          aria-labelledby={id}
          checked={on}
          onCheckedChange={(checked) => onChange(checked ? FADE_DEFAULT_MS : 0)}
        />
      </div>
      {on ? (
        <Segmented
          labelledBy={id}
          value={`${fadeChoice(ms)}`}
          onValueChange={(value) => {
            const length = fadeOf(value);
            if (length !== null) onChange(length);
          }}
          options={FADE_OPTIONS}
        />
      ) : null}
    </div>
  );
}

/**
 * The filmstrip picture of the moment at the playhead; re-renders only when
 * the playhead reaches another picture, not on every frame.
 */
function useSampleTile(
  playback: PlaybackStore,
  document: ClipDocument,
  meta: FilmstripMeta | null,
): FilmstripTile | null {
  const index = useSyncExternalStore(
    playback.subscribe,
    () => sampleTile(document, meta, playback.getCurrentMs())?.index ?? -1,
    () => -1,
  );
  return useMemo(() => {
    if (!meta || index < 0) return null;
    const atMs = index * meta.intervalMs;
    return tilesInRange(meta, atMs, atMs + 1)[0] ?? null;
  }, [meta, index]);
}

/** One tile's picture: the sample, cut to fill, with the look's matrix over it. */
function LookSample({
  strip,
  tile,
  filter,
}: {
  strip: ClipFilmstrip | null;
  tile: FilmstripTile | null;
  filter: string | null;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const url = strip && tile ? (strip.sheets[tile.sheet] ?? null) : null;

  useEffect(() => {
    const node = canvas.current;
    if (!node || !strip || !tile || !url) return;
    let live = true;
    const draw = () => {
      if (!live) return;
      const image = sheetImage(url, draw);
      if (!image) return;
      const context = prepareCanvas(node, SAMPLE_W, SAMPLE_H);
      if (!context) return;
      const { tileWidth, tileHeight } = strip.meta;
      const fit = Math.max(SAMPLE_W / tileWidth, SAMPLE_H / tileHeight);
      const width = SAMPLE_W / fit;
      const height = SAMPLE_H / fit;
      context.drawImage(
        image,
        tile.x + (tileWidth - width) / 2,
        tile.y + (tileHeight - height) / 2,
        width,
        height,
        0,
        0,
        SAMPLE_W,
        SAMPLE_H,
      );
    };
    draw();
    return () => {
      live = false;
      forgetSheetWaiter(url, draw);
    };
  }, [strip, tile, url]);

  return (
    <span
      className="block overflow-hidden rounded-sm border-2 border-outline"
      style={{ width: SAMPLE_W + 4, height: SAMPLE_H + 4 }}
    >
      {url ? (
        <canvas
          ref={canvas}
          className="block"
          style={{ width: SAMPLE_W, height: SAMPLE_H, filter: filter ?? undefined }}
        />
      ) : (
        <span
          className="block"
          style={{
            width: SAMPLE_W,
            height: SAMPLE_H,
            background: PLAIN_SAMPLE,
            filter: filter ?? undefined,
          }}
        />
      )}
    </span>
  );
}
