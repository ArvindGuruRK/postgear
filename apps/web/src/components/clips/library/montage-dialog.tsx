'use client';

/**
 * Create Montage (Module 11, section 4; blueprint section 9).
 *
 * - The ticked clips as a sortable list (dnd-kit, as the Studio's slides
 *   rail; Move Up and Move Down for the keyboard), each with its length, and
 *   Take Out. The total sits at the foot: with Fade it is 0.3 s shorter per
 *   join.
 * - **Between Clips** (`Segmented`: Cut, Fade), an optional opening title,
 *   and **Shape** only when the clips' shapes differ.
 * - The snapshot line, then **Create**, which says why it is off (2 to 15
 *   clips, 20 minutes at most, a shape to pick). The server's refusal shows
 *   in an `Alert`. Once made, the editor opens on the montage.
 */
import { ArrowDownIcon } from '@animateicons/react/lucide/arrow-down-icon';
import { ArrowUpIcon } from '@animateicons/react/lucide/arrow-up-icon';
import { GripVerticalIcon } from '@animateicons/react/lucide/grip-vertical-icon';
import { XIcon } from '@animateicons/react/lucide/x-icon';
import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  type Modifier,
  PointerSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Alert,
  Button,
  ChoiceTiles,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  MotionIcon,
  Segmented,
  TooltipHint,
} from '@postgear/ui';
import { formatClipLength, type Ratio } from '@postgear/video-engine';
import { TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { GroupLabel, NOTE } from '@/components/studio/panel-ui';
import { ApiError } from '@/lib/api';
import { createMontage } from '@/lib/clips-bulk-api';
import type { ClipListItem } from '@/types/clips';
import type { MontageTransition } from '@/types/clips-batch';
import { ShapeDrawing } from '../editor/shape-dialog';
import { LAYOUT_SHAPES, layoutShapeName } from '../layouts/layouts-model';
import { clipEditHref } from '../video/video-clip-list';
import {
  cleanTitleCard,
  MONTAGE_SNAPSHOT_LINE,
  MONTAGE_TITLE_MAX,
  MONTAGE_UNREACHABLE,
  montageProblem,
  montageShapes,
  montageTotalMs,
  moveClip,
} from './montage-model';

const VERTICAL_ONLY: Modifier = ({ transform }) => ({ ...transform, x: 0 });

export function MontageDialog({
  orgId,
  open,
  clips: ticked,
  onOpenChange,
  onCreated,
}: {
  orgId: string;
  open: boolean;
  /** The ticked clips, in the list's order (the starting order). */
  clips: ClipListItem[];
  onOpenChange: (open: boolean) => void;
  /** The montage was made (the editor opens on it next). */
  onCreated?: (clipId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="clips-montage-dialog">
        {open ? (
          <MontageForm
            orgId={orgId}
            ticked={ticked}
            onCancel={() => onOpenChange(false)}
            onCreated={onCreated}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MontageForm({
  orgId,
  ticked,
  onCancel,
  onCreated,
}: {
  orgId: string;
  ticked: ClipListItem[];
  onCancel: () => void;
  onCreated?: (clipId: string) => void;
}) {
  const router = useRouter();
  const dndId = useId();
  const listId = useId();
  const betweenId = useId();
  const shapeId = useId();
  const titleId = useId();
  const [clips, setClips] = useState<ClipListItem[]>(ticked);
  const [transition, setTransition] = useState<MontageTransition>('cut');
  const [title, setTitle] = useState('');
  const [shape, setShape] = useState<Ratio | null>(null);
  // The server can still say the shapes differ (a clip changed shape elsewhere).
  const [askShape, setAskShape] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const needsShape = askShape || montageShapes(clips).length > 1;
  const total = montageTotalMs(clips, transition);
  const off = montageProblem({ clips, transition, needsShape, shape });

  const position = (id: UniqueIdentifier) => clips.findIndex((clip) => clip.id === id) + 1;
  const named = (id: UniqueIdentifier) => clips.find((clip) => clip.id === id)?.title ?? 'The clip';
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${named(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${named(active.id)} is over position ${position(over.id)}.`
        : `${named(active.id)} is not over a position.`,
    onDragEnd: ({ active, over }) =>
      over && over.id !== active.id
        ? `${named(active.id)} moved to position ${position(over.id)}.`
        : `${named(active.id)} stayed in place.`,
    onDragCancel: ({ active }) => `${named(active.id)} stayed in place.`,
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setClips((current) =>
      moveClip(
        current,
        current.findIndex((clip) => clip.id === active.id),
        current.findIndex((clip) => clip.id === over.id),
      ),
    );
  };

  const create = async () => {
    if (off) return;
    setBusy(true);
    setProblem(null);
    try {
      const { clip } = await createMontage({
        clipIds: clips.map((one) => one.id),
        transition,
        titleCard: cleanTitleCard(title),
        ...(needsShape && shape ? { ratio: shape } : {}),
      });
      onCreated?.(clip.id);
      router.push(clipEditHref(orgId, clip.id));
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'montage_shapes_differ') setAskShape(true);
      setProblem(
        cause instanceof ApiError && cause.status !== 0 ? cause.message : MONTAGE_UNREACHABLE,
      );
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create Montage</DialogTitle>
        <DialogDescription>Drag the clips into the order they play in.</DialogDescription>
      </DialogHeader>
      <div className="mt-4 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <GroupLabel id={listId}>Clips</GroupLabel>
          <DndContext
            id={dndId}
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[VERTICAL_ONLY]}
            accessibility={{ announcements }}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={clips.map((clip) => clip.id)}
              strategy={verticalListSortingStrategy}
            >
              <ol
                aria-labelledby={listId}
                data-testid="clips-montage-list"
                className="m-0 flex max-h-72 list-none flex-col gap-1.5 overflow-y-auto p-1 pg-scrollbar"
              >
                {clips.map((clip, index) => (
                  <MontageRow
                    key={clip.id}
                    clip={clip}
                    index={index}
                    count={clips.length}
                    disabled={busy}
                    onMove={(by) => setClips((current) => moveClip(current, index, index + by))}
                    onTakeOut={() =>
                      setClips((current) => current.filter((one) => one.id !== clip.id))
                    }
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
          <p
            className="m-0 flex items-center justify-between gap-3 px-1 font-sans text-sm text-ink"
            data-testid="clips-montage-total"
          >
            <span className="type-ui">Total</span>
            <span className="tabular-nums">{formatClipLength(total)}</span>
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <GroupLabel id={betweenId}>Between Clips</GroupLabel>
          <Segmented<MontageTransition>
            labelledBy={betweenId}
            value={transition}
            onValueChange={setTransition}
            disabled={busy}
            options={[
              { value: 'cut', label: 'Cut' },
              { value: 'fade', label: 'Fade' },
            ]}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor={titleId} className="font-sans text-sm font-bold text-ink">
            Opening title (optional)
          </label>
          <Input
            id={titleId}
            value={title}
            maxLength={MONTAGE_TITLE_MAX}
            placeholder="Enter your title"
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>

        {needsShape ? (
          <div className="flex flex-col gap-2" data-testid="clips-montage-shape">
            <GroupLabel id={shapeId}>Shape</GroupLabel>
            <ChoiceTiles<Ratio>
              labelledBy={shapeId}
              columns={4}
              value={shape ?? ('' as Ratio)}
              disabled={busy}
              onValueChange={setShape}
              options={LAYOUT_SHAPES.map((ratio) => ({
                value: ratio,
                label: layoutShapeName(ratio),
                short: ratio,
                drawing: <ShapeDrawing ratio={ratio} />,
              }))}
            />
          </div>
        ) : null}

        <p className={NOTE}>{MONTAGE_SNAPSHOT_LINE}</p>

        {problem ? (
          <Alert variant="danger" className="items-center" data-testid="clips-montage-problem">
            <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <p className="m-0 min-w-0 flex-1">{problem}</p>
          </Alert>
        ) : null}
      </div>
      <DialogFooter className="mt-5 items-center gap-2">
        {off ? (
          <p
            className="m-0 mr-auto font-sans text-sm text-ink type-muted"
            data-testid="clips-montage-why"
          >
            {off}
          </p>
        ) : null}
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <TooltipHint label={off ?? ''} hidden={off === null} disabled={off !== null}>
          <Button
            size="sm"
            onClick={() => void create()}
            disabled={busy || off !== null}
            data-testid="clips-montage-create"
          >
            {busy ? 'Creating' : 'Create'}
          </Button>
        </TooltipHint>
      </DialogFooter>
    </>
  );
}

function MontageRow({
  clip,
  index,
  count,
  disabled,
  onMove,
  onTakeOut,
}: {
  clip: ClipListItem;
  index: number;
  count: number;
  disabled: boolean;
  onMove: (by: -1 | 1) => void;
  onTakeOut: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: clip.id, disabled });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid="clips-montage-row"
      className={cn(
        'flex items-center gap-2 rounded-md border-2 border-outline bg-inset px-2 py-1.5',
        isDragging && 'relative z-10',
      )}
    >
      <Button
        ref={setActivatorNodeRef}
        variant="ghost"
        size="sm"
        className="h-7 w-7 shrink-0 cursor-grab px-0"
        aria-label={`Drag ${clip.title}`}
        {...attributes}
        {...listeners}
      >
        <MotionIcon icon={GripVerticalIcon} className="h-4 w-4" />
      </Button>
      <span className="w-5 shrink-0 text-right font-sans text-xs text-ink tabular-nums type-muted">
        {index + 1}
      </span>
      <span
        className="min-w-0 flex-1 truncate font-sans text-sm text-ink type-ui"
        title={clip.title}
      >
        {clip.title}
      </span>
      <span className="shrink-0 font-sans text-xs text-ink tabular-nums type-muted">
        {formatClipLength(clip.durationMs)}, {clip.ratio}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 shrink-0 px-0"
        aria-label={`Move ${clip.title} Up`}
        disabled={disabled || index === 0}
        onClick={() => onMove(-1)}
      >
        <MotionIcon icon={ArrowUpIcon} className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 shrink-0 px-0"
        aria-label={`Move ${clip.title} Down`}
        disabled={disabled || index === count - 1}
        onClick={() => onMove(1)}
      >
        <MotionIcon icon={ArrowDownIcon} className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 shrink-0 px-0"
        aria-label={`Take Out ${clip.title}`}
        disabled={disabled}
        onClick={onTakeOut}
      >
        <MotionIcon icon={XIcon} className="h-4 w-4" />
      </Button>
    </li>
  );
}
