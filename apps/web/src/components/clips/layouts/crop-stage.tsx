'use client';

/**
 * The Video pane of the Layouts tab (Module 10 section 5, blueprint
 * section 6): the whole frame of the video at the playhead, with one crop
 * box per area over it. The Clip pane beside it is the ordinary stage, so
 * every change shows there live.
 *
 * - **The picture** is drawn from the preview engine's own front video each
 *   time it draws (`onPicture`), so the frame and the clip are always the
 *   same moment, without a third video downloading.
 * - **A box** has a 2 px border in its area's colour (four fixed theme
 *   colours by place), a name tag on its top edge with a small menu
 *   (Rename, Remove) and eight handles. Its body moves it; a handle resizes
 *   it around the opposite edge, always keeping the area's shape; it can
 *   never leave the video. The Gameplay and Screen Share camera boxes show
 *   their rounded corner.
 * - **Snapping** (the switch under the pane, on by default and kept in this
 *   browser): to the video's edges and centre lines and to the other boxes'
 *   edges within 8 px, with guide lines. Holding Alt drags freely.
 * - **Keys**: a focused box is selected; the arrows move it 1 percent (Shift:
 *   5), each run of presses one undo step; Delete removes it (the editor's
 *   key table); Escape during a drag puts it back.
 * - **One undo step per drag**: the Clip pane shows the drag as a draft, and
 *   the store gets one change on release (none when it ends where it began).
 *   An undo that lands mid-drag cancels the drag.
 * - Pointer movement is divided by the size the video is drawn at, so a box
 *   follows the hand at any pane size.
 */
import { ChevronDownIcon } from '@animateicons/react/lucide/chevron-down-icon';
import { CropIcon } from '@animateicons/react/lucide/crop-icon';
import { PencilIcon } from '@animateicons/react/lucide/pencil-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MotionIcon,
  Toggle,
  TooltipHint,
} from '@postgear/ui';
import {
  AREA_NAME_MAX,
  addArea,
  areaCropAt,
  type CanvasSize,
  type ClipDocument,
  type LayoutArea,
  MAX_AREAS,
  type Rect,
  removeArea,
  renameArea,
  setAreaCrop,
  toSource,
} from '@postgear/video-engine';
import type { PreviewEngine } from '@postgear/video-preview';
import { MonitorX } from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { EditorSelection } from '@/components/clips/editor/editor-state';
import type { PlaybackStore } from '@/components/clips/editor/playback';
import { readSnapping, writeSnapping } from '@/components/clips/timeline/timeline-model';
import {
  AREA_TONE_CLASSES,
  areaTone,
  CROP_HANDLES,
  CROP_LIMIT_SENTENCE,
  CROP_SNAP_STORAGE_KEY,
  type CropGuides,
  type CropHandle,
  cropBoxRadius,
  cropName,
  nextCropName,
  cropSnapLines,
  cropsMove,
  firstCropOf,
  LAST_CROP_SENTENCE,
  moveCrop,
  NO_GUIDES,
  NO_VIDEO_SENTENCE,
  nudgeCrop,
  type PaneSize,
  resizeCrop,
  type SnapLines,
  sameCrop,
} from './layouts-model';
import type { LayoutEdit } from './layouts-panel';
import { NameDialog } from './name-dialog';

/** Room around the drawn video for the handles and tags, in px. */
const PANE_PADDING_PX = 16;
/** How far the pointer moves before a press becomes a drag, in px. */
const DRAG_START_PX = 3;

const HANDLE_PLACE: Readonly<Record<CropHandle, { left: number; top: number; cursor: string }>> = {
  nw: { left: 0, top: 0, cursor: 'cursor-nwse-resize' },
  n: { left: 0.5, top: 0, cursor: 'cursor-ns-resize' },
  ne: { left: 1, top: 0, cursor: 'cursor-nesw-resize' },
  e: { left: 1, top: 0.5, cursor: 'cursor-ew-resize' },
  se: { left: 1, top: 1, cursor: 'cursor-nwse-resize' },
  s: { left: 0.5, top: 1, cursor: 'cursor-ns-resize' },
  sw: { left: 0, top: 1, cursor: 'cursor-nesw-resize' },
  w: { left: 0, top: 0.5, cursor: 'cursor-ew-resize' },
};

export type CropCommit = (
  start: ClipDocument,
  next: ClipDocument,
  options?: { select?: EditorSelection; coalesceKey?: string },
) => void;

interface CropDrag {
  areaId: string;
  mode: 'move' | CropHandle;
  startDoc: ClipDocument;
  startRect: Rect;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lines: SnapLines;
  pane: PaneSize;
  started: boolean;
  next: ClipDocument | null;
  rect: Rect;
  stop: () => void;
}

const subscribeNever = () => () => undefined;

/** The crop each area shows now: at the playhead when crops change over time, else the one crop. */
function useCropReader(shown: ClipDocument, playback: PlaybackStore) {
  const moving = cropsMove(shown);
  const outputMs = useSyncExternalStore(
    moving ? playback.subscribe : subscribeNever,
    () => (moving ? playback.getCurrentMs() : 0),
    () => 0,
  );
  const sourceMs = moving ? (toSource(shown, outputMs)?.sourceMs ?? 0) : 0;
  return useCallback(
    (area: LayoutArea): Rect => (moving ? areaCropAt(area, sourceMs) : firstCropOf(area)),
    [moving, sourceMs],
  );
}

export function CropStage({
  engine,
  playback,
  document,
  shown,
  videoSize,
  hasVideo,
  selection,
  onSelect,
  onCommit,
  onDraft,
  onEdit,
  onAnnounce,
}: {
  engine: PreviewEngine | null;
  playback: PlaybackStore;
  /** The store's document: every drag starts from it and is applied onto it. */
  document: ClipDocument;
  /** What is shown: a drag's draft while it lasts, else the document. */
  shown: ClipDocument;
  videoSize: CanvasSize;
  /** There is a video to draw (the light copy has an address). */
  hasVideo: boolean;
  selection: EditorSelection;
  onSelect: (selection: EditorSelection) => void;
  onCommit: CropCommit;
  onDraft: (draft: { doc: ClipDocument; seekMs: number | null } | null) => void;
  onEdit: LayoutEdit;
  onAnnounce: (sentence: string) => void;
}) {
  const labelId = useId();
  const switchId = useId();
  const box = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState<PaneSize>({ width: 0, height: 0 });
  const aspect =
    videoSize.width > 0 && videoSize.height > 0 ? videoSize.width / videoSize.height : 16 / 9;

  // ---- The pane's size: the video fitted inside, never scrolling ---------------------

  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    const measure = () => {
      const roomW = Math.max(0, node.clientWidth - PANE_PADDING_PX * 2);
      const roomH = Math.max(0, node.clientHeight - PANE_PADDING_PX * 2);
      const width = Math.floor(Math.min(roomW, roomH * aspect));
      const height = Math.floor(width / aspect);
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [aspect]);

  // ---- The picture: the engine's own frame, each time it draws -----------------------

  useEffect(() => {
    const node = canvas.current;
    if (!engine || !node || size.width === 0 || size.height === 0) return;
    const ratio = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    node.width = Math.max(1, Math.round(size.width * ratio));
    node.height = Math.max(1, Math.round(size.height * ratio));
    let context: CanvasRenderingContext2D | null | undefined;
    return engine.onPicture((video) => {
      if (context === undefined) context = node.getContext('2d');
      if (!context) return;
      context.drawImage(video, 0, 0, node.width, node.height);
    });
  }, [engine, size.width, size.height]);

  // ---- Snapping ------------------------------------------------------------------------

  const [snapping, setSnapping] = useState(true);
  useEffect(() => setSnapping(readSnapping(CROP_SNAP_STORAGE_KEY)), []);
  const changeSnapping = (on: boolean) => {
    setSnapping(on);
    writeSnapping(on, CROP_SNAP_STORAGE_KEY);
  };

  // ---- Drags ---------------------------------------------------------------------------

  const cropOf = useCropReader(shown, playback);
  const [guides, setGuides] = useState<CropGuides>(NO_GUIDES);
  const [dragging, setDragging] = useState<string | null>(null);
  const drag = useRef<CropDrag | null>(null);
  const latest = useRef({ document, snapping, videoSize, cropOf, onCommit, onDraft, onAnnounce });
  latest.current = { document, snapping, videoSize, cropOf, onCommit, onDraft, onAnnounce };

  const endDrag = useCallback((commit: boolean) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    current.stop();
    setGuides(NO_GUIDES);
    setDragging(null);
    const { onDraft: draft, onCommit: apply, onAnnounce: announce } = latest.current;
    draft(null);
    if (!commit || !current.started || !current.next || sameCrop(current.rect, current.startRect)) {
      return;
    }
    const area = current.startDoc.layout.areas.find((a) => a.id === current.areaId);
    apply(current.startDoc, current.next, { select: { kind: 'area', id: current.areaId } });
    if (area) announce(`${cropName(area)} ${current.mode === 'move' ? 'moved' : 'resized'}.`);
  }, []);

  const moveDrag = useCallback((clientX: number, clientY: number, alt: boolean) => {
    const current = drag.current;
    if (!current) return;
    current.lastX = clientX;
    current.lastY = clientY;
    if (
      !current.started &&
      Math.hypot(clientX - current.startX, clientY - current.startY) < DRAG_START_PX
    ) {
      return;
    }
    current.started = true;
    const { width, height } = current.pane;
    if (width <= 0 || height <= 0) return;
    const dx = (clientX - current.startX) / width;
    const dy = (clientY - current.startY) / height;
    const snap =
      latest.current.snapping && !alt ? { lines: current.lines, pane: current.pane } : undefined;
    const result =
      current.mode === 'move'
        ? moveCrop(current.startRect, dx, dy, snap)
        : resizeCrop(current.startRect, current.mode, dx, dy, snap);
    current.rect = result.rect;
    current.next = setAreaCrop(
      current.startDoc,
      current.areaId,
      result.rect,
      latest.current.videoSize,
    );
    setGuides(result.guides);
    latest.current.onDraft({ doc: current.next, seekMs: null });
  }, []);

  const beginDrag = (
    event: ReactPointerEvent<HTMLElement>,
    area: LayoutArea,
    mode: 'move' | CropHandle,
  ) => {
    if (event.button !== 0 || drag.current) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect({ kind: 'area', id: area.id });
    const startDoc = latest.current.document;
    const startArea = startDoc.layout.areas.find((a) => a.id === area.id);
    if (!startArea) return;
    const read = latest.current.cropOf;
    const others = startDoc.layout.areas.filter((a) => a.id !== area.id).map((a) => read(a));

    const onMove = (e: PointerEvent) => moveDrag(e.clientX, e.clientY, e.altKey);
    const onUp = () => endDrag(true);
    const onCancel = () => endDrag(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        endDrag(false);
      } else if (e.key === 'Alt') {
        e.preventDefault();
        const current = drag.current;
        if (current?.started) moveDrag(current.lastX, current.lastY, e.type === 'keydown');
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', onCancel);
    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('blur', onCancel);
    };

    const startRect = read(startArea);
    drag.current = {
      areaId: area.id,
      mode,
      startDoc,
      startRect,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lines: cropSnapLines(others),
      pane: size,
      started: false,
      next: null,
      rect: startRect,
      stop,
    };
    setDragging(area.id);
  };

  // An undo, a redo or a reload under a drag: the drag no longer applies.
  useEffect(() => {
    if (drag.current && drag.current.startDoc !== document) endDrag(false);
  }, [document, endDrag]);
  useEffect(() => () => endDrag(false), [endDrag]);

  // ---- Keys on a focused box -------------------------------------------------------------

  const onBoxKey = (event: ReactKeyboardEvent<HTMLDivElement>, area: LayoutArea) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const doc = latest.current.document;
    const current = doc.layout.areas.find((a) => a.id === area.id);
    if (!current) return;
    const start = latest.current.cropOf(current);
    const rect = nudgeCrop(start, event.key, event.shiftKey);
    if (!rect) return;
    // The arrows are this box's: the playhead does not step.
    event.preventDefault();
    if (sameCrop(rect, start)) return;
    onCommit(doc, setAreaCrop(doc, area.id, rect, latest.current.videoSize), {
      select: { kind: 'area', id: area.id },
      coalesceKey: `crop:${area.id}`,
    });
  };

  // ---- Add, rename, remove -------------------------------------------------------------------

  const areas = shown.layout.areas;
  const full = document.layout.areas.length >= MAX_AREAS;
  const [renaming, setRenaming] = useState<LayoutArea | null>(null);

  const addCrop = () =>
    onEdit((doc) => addArea(doc, videoSize, nextCropName(doc.layout.areas)), 'Crop added.', {
      selectArea: 'last',
    });
  const removeCrop = (area: LayoutArea) =>
    onEdit((doc) => removeArea(doc, area.id, videoSize), `${cropName(area)} removed.`);
  const renameCrop = async (draft: string): Promise<string | null> => {
    const target = renaming;
    if (!target) return null;
    const name = draft.replace(/\s+/g, ' ').trim();
    if (name === '') return 'Enter a name for the crop.';
    if (name !== target.name) {
      onEdit((doc) => renameArea(doc, target.id, name), `Crop renamed to ${name}.`);
    }
    return null;
  };

  const selectedArea = selection?.kind === 'area' ? selection.id : null;

  return (
    <section
      aria-labelledby={labelId}
      data-testid="clip-video-pane"
      className="flex min-h-0 min-w-0 flex-[3] flex-col gap-2"
    >
      <p id={labelId} className="m-0 shrink-0 type-label text-sm text-ink">
        Video
      </p>
      <div
        ref={box}
        data-testid="clip-crop-room"
        className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden"
      >
        <div
          className={cn(
            'relative shrink-0 border-2 border-outline bg-inset',
            size.width === 0 && 'invisible',
          )}
          style={{ width: size.width + 4, height: size.height + 4 }}
        >
          <div
            className="absolute inset-0"
            data-testid="clip-crop-surface"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget && selectedArea) onSelect(null);
            }}
          >
            <span aria-hidden="true" className="contents">
              <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" />
            </span>
            {hasVideo ? (
              <CropDim
                pane={size}
                holes={areas.map((area) => {
                  const rect = cropOf(area);
                  return { rect, radius: cropBoxRadius(area, rect, size, shown.canvas.width) };
                })}
              />
            ) : (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
                <MonitorX className="h-6 w-6 text-ink" strokeWidth={2} aria-hidden="true" />
                <p className="m-0 font-sans text-sm text-ink">{NO_VIDEO_SENTENCE}</p>
              </div>
            )}

            {areas.map((area, index) => (
              <CropBox
                key={area.id}
                area={area}
                index={index}
                rect={cropOf(area)}
                pane={size}
                canvasWidth={shown.canvas.width}
                selected={selectedArea === area.id}
                dragging={dragging === area.id}
                removable={document.layout.areas.length > 1}
                onPointerDown={(event, mode) => beginDrag(event, area, mode)}
                onKeyDown={(event) => onBoxKey(event, area)}
                onFocus={() => selectedArea !== area.id && onSelect({ kind: 'area', id: area.id })}
                onRename={() => setRenaming(area)}
                onRemove={() => removeCrop(area)}
              />
            ))}

            {guides.x.map((x) => (
              <span
                key={`x${x}`}
                aria-hidden="true"
                data-testid="clip-crop-guide"
                className="pointer-events-none absolute top-0 bottom-0 z-20 w-px -translate-x-1/2 bg-actionPrimary"
                style={{ left: `${x * 100}%` }}
              />
            ))}
            {guides.y.map((y) => (
              <span
                key={`y${y}`}
                aria-hidden="true"
                data-testid="clip-crop-guide"
                className="pointer-events-none absolute right-0 left-0 z-20 h-px -translate-y-1/2 bg-actionPrimary"
                style={{ top: `${y * 100}%` }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3">
        <TooltipHint label={CROP_LIMIT_SENTENCE} hidden={!full}>
          <span className="inline-flex">
            <Button
              variant="secondary"
              size="sm"
              disabled={full}
              onClick={addCrop}
              data-testid="clip-add-crop"
            >
              <MotionIcon icon={CropIcon} className="h-4 w-4" />
              Add Crop
            </Button>
          </span>
        </TooltipHint>
        <div className="flex items-center gap-2">
          <label htmlFor={switchId} className="font-sans text-sm text-ink">
            Enable snapping
          </label>
          <Toggle
            id={switchId}
            checked={snapping}
            onCheckedChange={changeSnapping}
            data-testid="clip-crop-snapping"
          />
        </div>
      </div>

      <NameDialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        title="Rename Crop"
        description="The name shows on the crop's tag."
        label="Crop name"
        placeholder="Enter your crop name"
        initial={renaming?.name ?? ''}
        maxLength={AREA_NAME_MAX}
        submitLabel="Save"
        busyLabel="Saving"
        onSubmit={renameCrop}
        testId="clip-rename-crop-dialog"
      />
    </section>
  );
}

/**
 * Shades the video outside every crop, so the bright part is what lands in
 * the clip, whatever the picture. One mask with a hole per crop (rounded like
 * the crop's box), drawn in the pane's own pixels so a corner stays round.
 * Decorative and click-through: a press still reaches the bare video.
 */
function CropDim({ pane, holes }: { pane: PaneSize; holes: { rect: Rect; radius: number }[] }) {
  const maskId = `crop-dim-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  if (pane.width === 0 || pane.height === 0) return null;
  return (
    <svg
      aria-hidden="true"
      data-testid="clip-crop-dim"
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${pane.width} ${pane.height}`}
      preserveAspectRatio="none"
    >
      <mask id={maskId}>
        <rect width={pane.width} height={pane.height} fill="white" />
        {holes.map(({ rect, radius }, index) => (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: holes follow the crops' order and carry no identity of their own
            key={index}
            x={rect.x * pane.width}
            y={rect.y * pane.height}
            width={rect.w * pane.width}
            height={rect.h * pane.height}
            rx={radius}
            fill="black"
          />
        ))}
      </mask>
      <rect
        width={pane.width}
        height={pane.height}
        fill="black"
        fillOpacity={0.55}
        mask={`url(#${maskId})`}
      />
    </svg>
  );
}

function CropBox({
  area,
  index,
  rect,
  pane,
  canvasWidth,
  selected,
  dragging,
  removable,
  onPointerDown,
  onKeyDown,
  onFocus,
  onRename,
  onRemove,
}: {
  area: LayoutArea;
  index: number;
  rect: Rect;
  pane: PaneSize;
  canvasWidth: number;
  selected: boolean;
  dragging: boolean;
  removable: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, mode: 'move' | CropHandle) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onFocus: () => void;
  onRename: () => void;
  onRemove: () => void;
}) {
  const tone = AREA_TONE_CLASSES[areaTone(index)];
  const hintId = useId();
  const name = cropName(area);
  const radius = cropBoxRadius(area, rect, pane, canvasWidth);

  return (
    // biome-ignore lint/a11y/useSemanticElements: a box with handles and a menu inside cannot be a <button>
    <div
      role="button"
      tabIndex={0}
      aria-label={name}
      aria-pressed={selected}
      aria-describedby={hintId}
      data-testid="clip-crop-box"
      data-area-id={area.id}
      onPointerDown={(event) => onPointerDown(event, 'move')}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      className={cn(
        // The thin dark edge keeps the tone's border visible on a picture of
        // the same colour (a green crop over a green wall).
        'absolute touch-none border-2 shadow-[0_0_0_1px_rgb(0_0_0/0.6)] outline-none',
        tone.border,
        selected
          ? cn(tone.tint, 'z-10 outline-2 outline-offset-2 outline-solid', tone.ring)
          : 'z-0',
        dragging ? 'cursor-grabbing' : 'cursor-grab',
        'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-focusRing',
      )}
      style={{
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.w * 100}%`,
        height: `${rect.h * 100}%`,
        borderRadius: radius > 0 ? radius : undefined,
      }}
    >
      <span id={hintId} className="sr-only">
        Drag to move. Arrow keys move it, with Shift further.
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`More for ${name}`}
            data-testid="clip-crop-tag"
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            className={cn(
              'absolute top-1.5 left-1.5 z-10 inline-flex h-6 max-w-[calc(100%-0.75rem)] items-center gap-1 rounded px-1.5 type-ui text-xs',
              'outline-none focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-focusRing',
              tone.fill,
              tone.on,
            )}
          >
            <span className="min-w-0 truncate">{area.name}</span>
            <MotionIcon icon={ChevronDownIcon} className="h-3.5 w-3.5 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={onRename}>
            <MotionIcon icon={PencilIcon} className="h-4 w-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onRemove} disabled={!removable}>
            <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
            Remove
          </DropdownMenuItem>
          {removable ? null : (
            <p className="m-0 max-w-56 px-2 pt-1 pb-1.5 font-sans text-xs text-ink type-muted">
              {LAST_CROP_SENTENCE}
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {CROP_HANDLES.map((handle) => {
        const place = HANDLE_PLACE[handle];
        return (
          <span
            key={handle}
            aria-hidden="true"
            data-handle={handle}
            onPointerDown={(event) => onPointerDown(event, handle)}
            className={cn(
              'absolute z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 touch-none border-2 border-outline',
              tone.fill,
              place.cursor,
            )}
            style={{ left: `${place.left * 100}%`, top: `${place.top * 100}%` }}
          />
        );
      })}
    </div>
  );
}
