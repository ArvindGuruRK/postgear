'use client';

/**
 * The editor's slide rail (Sprint 9, DS-5.1 and DS-5.2): every slide in
 * order, drawn by the real renderer, with its name: its number and what its
 * layout makes of it, "1. Cover" (Sprint 9b, `slideName`).
 *
 * - A click shows the slide on the canvas. The rail is one stop for the Tab
 *   key: the arrow keys (and Home, End) move through the slides, showing each.
 * - Dragging a thumbnail with a mouse reorders the slides; on a touch screen
 *   the grip beside it does, so a swipe over the thumbnails still scrolls.
 *   By keyboard, each slide's menu has Move Up and Move Down.
 * - The menu also holds Duplicate and Delete. The last slide cannot go, and
 *   a deleted one comes back from the toast's Undo (see `useSlideDeletion`)
 *   or with the editor's own Undo.
 * - A slide with something to fix (text too long for its space, a picture
 *   that was deleted, hard-to-read text) carries a warning mark that says
 *   what, in the sentences the export dialog uses.
 * - Add Slide opens the layout picker; at the limit it is disabled and says why.
 *
 * The thumbnails are the costly part, so each one redraws only when its own
 * slide, its number or the design's look changes: typing on the canvas
 * redraws one thumbnail, and dragging redraws none.
 */
import { ArrowDownIcon } from '@animateicons/react/lucide/arrow-down-icon';
import { ArrowUpIcon } from '@animateicons/react/lucide/arrow-up-icon';
import { CopyIcon } from '@animateicons/react/lucide/copy-icon';
import { EllipsisVerticalIcon } from '@animateicons/react/lucide/ellipsis-vertical-icon';
import { GripVerticalIcon } from '@animateicons/react/lucide/grip-vertical-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
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
  type DesignDocument,
  type DesignSlide,
  duplicateSlide,
  FORMATS,
  MAX_SLIDES,
  moveSlide,
  slideId as newSlideId,
  removeSlide,
  type SlotId,
} from '@postgear/design-engine';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MotionIcon,
  pressSm,
  ToastAction,
  TooltipHint,
  toast,
} from '@postgear/ui';
import { TriangleAlert } from 'lucide-react';
import {
  type KeyboardEvent,
  memo,
  type PointerEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { FOCUS } from './design-card';
import { type ApplyChange, restoreSlide } from './editor-state';
import { slideName } from './rail-model';
import { SlideFrame } from './slide-frame';
import { StudioPanel } from './studio-ui';
import { SLIDE_LIMIT_MESSAGE } from './studio-view-model';
import { CHOSEN } from './wizard-steps';

/** A thumbnail's height at most, in rem: tall formats are narrowed to it. */
const THUMBNAIL_REM = 10;

const NO_ISSUES: readonly string[] = [];

/** Slides move up and down the rail only. */
const VERTICAL_ONLY: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/** A slide's thumbnail button in the rail. */
function thumbnailOf(rail: HTMLElement | null, slideId: string): HTMLElement | undefined {
  return Array.from(rail?.querySelectorAll<HTMLElement>('[data-rail-thumbnail]') ?? []).find(
    (button) => button.dataset.railThumbnail === slideId,
  );
}

const SMALL_ICON =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 border-transparent text-ink hover:border-outline hover:bg-secondary';

export interface SlidesRailProps {
  document: DesignDocument;
  /** The slide on the canvas. */
  activeId: string;
  /** What to fix on each slide, by slide id (`issuesBySlide`). */
  issues: ReadonlyMap<string, readonly string[]>;
  /** Pictures at thumbnail size. */
  resolveMedia: (mediaId: string) => string | null;
  onShow: (slideId: string) => void;
  onChange: ApplyChange;
  /** Deletes a slide and offers it back: `useSlideDeletion`. */
  onDelete: (slide: DesignSlide, index: number) => void;
  /** Each thumbnail's report of the text on it still too long at its smallest size. */
  onOverflow: (slideId: string, slots: SlotId[]) => void;
  /** Opens the layout picker for a new slide after the one on the canvas. */
  onAddSlide: () => void;
  /** Inside a drawer, which brings its own surface: no panel around the rail. */
  bare?: boolean;
  className?: string;
}

export function SlidesRail({
  document,
  activeId,
  issues,
  resolveMedia,
  onShow,
  onChange,
  onDelete,
  onOverflow,
  onAddSlide,
  bare = false,
  className,
}: SlidesRailProps) {
  // dnd-kit numbers its ids from a module-level counter, which differs between
  // the server render and the browser; a React id is the same on both sides.
  const dndId = useId();
  const headingId = useId();
  const list = useRef<HTMLOListElement>(null);
  const sensors = useSensors(
    // A few pixels first, so a click on a thumbnail stays a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const slides = document.slides;
  const count = slides.length;
  const full = count >= MAX_SLIDES;

  // The slide ids as last drawn, for the callbacks below, which stay the same
  // functions from one render to the next so the thumbnails need not redraw.
  const ids = useRef<string[]>([]);
  useLayoutEffect(() => {
    ids.current = slides.map((slide) => slide.id);
  });

  // Keeps the slide on the canvas in view when it changes from elsewhere:
  // the canvas's arrows, an undo, a slide just added.
  useEffect(() => {
    const item = Array.from(list.current?.children ?? []).find(
      (child) => child instanceof HTMLElement && child.dataset.slideId === activeId,
    );
    item?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const position = (id: UniqueIdentifier) => ids.current.indexOf(String(id)) + 1;
  // The slide by the name the rail shows it under, as it was when the drag began.
  const named = (id: UniqueIdentifier) => {
    const slide = slides.find((entry) => entry.id === String(id));
    return slide ? slideName(slide, position(id) - 1) : 'The slide';
  };

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

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;

    const moving = String(active.id);
    const target = String(over.id);
    onChange((latest) =>
      moveSlide(
        latest,
        latest.slides.findIndex((slide) => slide.id === moving),
        latest.slides.findIndex((slide) => slide.id === target),
      ),
    );
  }

  // After Duplicate or Delete in a slide's menu, focus goes to the slide then
  // on the canvas (the copy, or the one that took the deleted slide's place),
  // as the arrow keys move it. The menu would give it back to its own button,
  // the old slide's (`RailSlide` stops that), or drop it to the page along
  // with the deleted slide.
  // A count, so the effect runs after each one, in the same render as the
  // change that put the slide on the canvas.
  const [refocus, setRefocus] = useState(0);

  useEffect(() => {
    if (refocus === 0) return;

    // Once the menu has gone, which Radix finishes in a timeout of its own.
    const timer = setTimeout(() => {
      const rail = list.current;
      if (!rail) return;

      // Unless focus has moved on, out of the rail, since.
      const active = rail.ownerDocument.activeElement;
      if (active && !active.contains(rail) && !rail.contains(active)) return;
      rail.querySelector<HTMLElement>('[data-rail-thumbnail][aria-current="true"]')?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [refocus]);

  const duplicate = useCallback(
    (id: string) => {
      // Named before the change, so the copy can be shown once it exists.
      const copy = newSlideId();
      onChange((latest) => duplicateSlide(latest, id, () => copy), { showSlide: copy });
      setRefocus((count) => count + 1);
    },
    [onChange],
  );

  const remove = useCallback(
    (slide: DesignSlide, index: number) => {
      onDelete(slide, index);
      setRefocus((count) => count + 1);
    },
    [onDelete],
  );

  const move = useCallback(
    (id: string, by: -1 | 1) => {
      onChange((latest) => {
        const from = latest.slides.findIndex((slide) => slide.id === id);
        return from === -1 ? latest : moveSlide(latest, from, from + by);
      });
    },
    [onChange],
  );

  const navigate = useCallback(
    (index: number) => {
      const id = ids.current[index];
      if (!id) return;

      onShow(id);
      thumbnailOf(list.current, id)?.focus();
    },
    [onShow],
  );

  const Frame = bare ? 'div' : StudioPanel;

  return (
    <Frame className={cn('flex min-h-0 flex-col gap-3', !bare && 'p-3', className)}>
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 id={headingId} className="m-0 type-heading text-base text-ink">
          Slides
        </h2>
        <span className="font-sans text-xs tabular-nums text-ink type-muted">
          {count} of {MAX_SLIDES}
        </span>
      </div>

      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[VERTICAL_ONLY]}
        accessibility={{ announcements }}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={slides.map((slide) => slide.id)}
          strategy={verticalListSortingStrategy}
        >
          <ol
            ref={list}
            aria-labelledby={headingId}
            // Room for the chosen ring, which the scrolling would otherwise clip.
            className="m-0 flex min-h-0 flex-1 list-none flex-col gap-3 overflow-y-auto overscroll-contain p-2"
          >
            {slides.map((slide, index) => (
              <RailSlide
                key={slide.id}
                document={document}
                slide={slide}
                index={index}
                count={count}
                active={slide.id === activeId}
                issues={issues.get(slide.id) ?? NO_ISSUES}
                resolveMedia={resolveMedia}
                onShow={onShow}
                onNavigate={navigate}
                onOverflow={onOverflow}
                onDuplicate={duplicate}
                onMove={move}
                onDelete={remove}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      <TooltipHint
        label={SLIDE_LIMIT_MESSAGE}
        hidden={!full}
        disabled={full}
        side="top"
        triggerClassName="w-full"
      >
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          disabled={full}
          onClick={onAddSlide}
        >
          <MotionIcon icon={PlusIcon} className="h-4 w-4" />
          Add Slide
        </Button>
      </TooltipHint>
    </Frame>
  );
}

interface RailSlideProps {
  document: DesignDocument;
  slide: DesignSlide;
  index: number;
  count: number;
  active: boolean;
  issues: readonly string[];
  resolveMedia: (mediaId: string) => string | null;
  onShow: (slideId: string) => void;
  onNavigate: (index: number) => void;
  onOverflow: (slideId: string, slots: SlotId[]) => void;
  onDuplicate: (slideId: string) => void;
  onMove: (slideId: string, by: -1 | 1) => void;
  onDelete: (slide: DesignSlide, index: number) => void;
}

function RailSlide({
  document,
  slide,
  index,
  count,
  active,
  issues,
  resolveMedia,
  onShow,
  onNavigate,
  onOverflow,
  onDuplicate,
  onMove,
  onDelete,
}: RailSlideProps) {
  const { listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: slide.id });
  const issuesId = useId();
  // Set by Duplicate and Delete, after which the rail focuses another slide,
  // so the menu does not hand focus back to its button as it closes.
  const movesFocus = useRef(false);
  const label = slideName(slide, index);
  const spec = FORMATS[document.format];
  const fit = useCallback((slots: SlotId[]) => onOverflow(slide.id, slots), [onOverflow, slide.id]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const next =
      event.key === 'ArrowUp'
        ? index - 1
        : event.key === 'ArrowDown'
          ? index + 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? count - 1
              : null;
    if (next === null || next < 0 || next >= count || next === index) return;

    event.preventDefault();
    onNavigate(next);
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    // A mouse drags the thumbnail itself; a finger scrolls the rail and
    // drags by the grip, which is the only way iOS lets go of a scroll.
    if (event.pointerType === 'mouse') listeners?.onPointerDown?.(event);
  }

  return (
    <li
      ref={setNodeRef}
      data-slide-id={slide.id}
      data-testid="rail-slide"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex items-start gap-2', isDragging && 'relative z-10')}
    >
      <div className="min-w-0 flex-1">
        <div
          className="relative mx-auto"
          style={{ maxWidth: `${Math.min(1, spec.width / spec.height) * THUMBNAIL_REM}rem` }}
        >
          <button
            type="button"
            data-rail-thumbnail={slide.id}
            aria-label={label}
            aria-current={active ? 'true' : undefined}
            aria-describedby={issues.length > 0 ? issuesId : undefined}
            // One stop for the Tab key: the slide on the canvas; arrows do the rest.
            tabIndex={active ? 0 : -1}
            onClick={() => onShow(slide.id)}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            className={cn(
              'block w-full cursor-pointer border-2 border-outline bg-secondary',
              pressSm,
              active && CHOSEN,
              // Lifted while it moves, not pressed flat under the pointer.
              isDragging &&
                'shadow-brutalMd hover:translate-x-0 hover:translate-y-0 hover:shadow-brutalMd',
              FOCUS,
            )}
          >
            <Thumbnail design={document} index={index} resolveMedia={resolveMedia} onFit={fit} />
          </button>

          {issues.length > 0 ? (
            <>
              <TooltipHint label={issues.join(' ')} side="right">
                <span className="absolute -end-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-outline bg-actionAccent text-onActionLight">
                  <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.5} />
                </span>
              </TooltipHint>
              <span id={issuesId} className="sr-only">
                {issues.join(' ')}
              </span>
            </>
          ) : null}

          {/* The thumbnail's own name says it to a screen reader. */}
          <span
            aria-hidden="true"
            className={cn(
              'mt-1.5 block truncate font-sans text-xs font-bold tabular-nums',
              active ? 'text-ink' : 'text-ink type-muted',
            )}
          >
            {label}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Actions for ${label}`}
              tabIndex={active ? 0 : -1}
              className={cn(SMALL_ICON, !active && 'opacity-60 hover:opacity-100', FOCUS)}
            >
              <MotionIcon icon={EllipsisVerticalIcon} className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="right"
            onCloseAutoFocus={(event) => {
              // The rail is moving focus to the slide now on the canvas.
              if (!movesFocus.current) return;
              movesFocus.current = false;
              event.preventDefault();
            }}
          >
            <DropdownMenuItem
              disabled={count >= MAX_SLIDES}
              onSelect={() => {
                movesFocus.current = true;
                onDuplicate(slide.id);
              }}
            >
              <MotionIcon icon={CopyIcon} className="h-4 w-4" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(slide.id, -1)}>
              <MotionIcon icon={ArrowUpIcon} className="h-4 w-4" />
              Move Up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === count - 1} onSelect={() => onMove(slide.id, 1)}>
              <MotionIcon icon={ArrowDownIcon} className="h-4 w-4" />
              Move Down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={count <= 1}
              onSelect={() => {
                if (count <= 1) return;
                movesFocus.current = true;
                onDelete(slide, index);
              }}
            >
              <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
              Delete
            </DropdownMenuItem>
            {count >= MAX_SLIDES ? (
              <DropdownMenuLabel className="max-w-52 font-sans text-xs font-normal text-ink type-muted">
                {SLIDE_LIMIT_MESSAGE}
              </DropdownMenuLabel>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>

        <TooltipHint label="Drag To Reorder" side="right">
          <span
            ref={setActivatorNodeRef}
            aria-hidden="true"
            data-testid="rail-grip"
            onPointerDown={(event) => listeners?.onPointerDown?.(event)}
            className={cn(
              SMALL_ICON,
              'cursor-grab touch-none opacity-60 hover:opacity-100 active:cursor-grabbing',
            )}
          >
            <MotionIcon icon={GripVerticalIcon} className="h-4 w-4" />
          </span>
        </TooltipHint>
      </div>
    </li>
  );
}

interface ThumbnailProps {
  design: DesignDocument;
  index: number;
  resolveMedia: (mediaId: string) => string | null;
  onFit: (slots: SlotId[]) => void;
}

/**
 * The slide itself, which redraws only when what it shows changes: its own
 * slide, its number, or the theme, brand, handle or format every slide
 * shares. Nothing else in the design is drawn.
 */
const Thumbnail = memo(
  function Thumbnail({ design, index, resolveMedia, onFit }: ThumbnailProps) {
    return <SlideFrame design={design} index={index} resolveMedia={resolveMedia} onFit={onFit} />;
  },
  (before, after) =>
    before.index === after.index &&
    before.design.slides[before.index] === after.design.slides[after.index] &&
    before.design.slides.length === after.design.slides.length &&
    before.design.themeId === after.design.themeId &&
    before.design.format === after.design.format &&
    before.design.handle === after.design.handle &&
    before.design.brand === after.design.brand &&
    before.resolveMedia === after.resolveMedia &&
    before.onFit === after.onFit,
);

/**
 * Deleting a slide, with a toast that brings it back (DS-5.2). Its Undo puts
 * that slide back where it was, even after other edits; the editor's own
 * Undo works as well. The toasts close with the editor, so no Undo is left
 * on screen for a design that is no longer open.
 */
export function useSlideDeletion(onChange: ApplyChange) {
  const open = useRef(new Set<() => void>());

  useEffect(() => {
    const toasts = open.current;
    return () => {
      for (const dismiss of toasts) dismiss();
      toasts.clear();
    };
  }, []);

  return useCallback(
    (slide: DesignSlide, index: number) => {
      onChange((latest) => removeSlide(latest, slide.id));

      const { dismiss } = toast({
        title: 'Slide deleted',
        description: `Slide ${index + 1} was removed.`,
        action: (
          <ToastAction
            altText="Undo deleting the slide"
            onClick={(event) => {
              const toasts = event.currentTarget.closest('ol');
              onChange((latest) => restoreSlide(latest, slide, index), { showSlide: slide.id });
              // The toast goes with this button: focus goes to the slide that
              // came back, not to the empty list of toasts, unless it has
              // moved on elsewhere since.
              setTimeout(() => {
                const active = window.document.activeElement;
                if (active && active !== window.document.body && !toasts?.contains(active)) return;
                thumbnailOf(window.document.body, slide.id)?.focus();
              }, 0);
            }}
          >
            Undo
          </ToastAction>
        ),
      });
      open.current.add(dismiss);
    },
    [onChange],
  );
}
