'use client';

/**
 * The channel card's list of channels, and dragging them into order
 * (UI revamp, 2026-10-19).
 *
 * The reference has no reordering; PostGear lets an admin drag a channel by
 * its grip to where they want it, and the order is the workspace's
 * (`PUT /channels/order`, then every channel list in the app follows it).
 *
 * - **The grip is the only handle.** The row itself filters the calendar and
 *   the ⋮ opens the menu, so a drag that started anywhere else would fight
 *   both. The grip takes `touch-action: none`, so on a phone a finger on it
 *   drags rather than scrolls the sheet, while a finger anywhere else still
 *   scrolls.
 * - **Keyboard first-class.** The grip is a button: Space or Enter picks the
 *   channel up, the arrow keys move it, Space or Enter drops it and Escape
 *   puts it back, with each step announced by name.
 * - **Optimistic.** The new order shows at once; the request follows, and a
 *   refusal puts the old order back and says so. Saves run one after another,
 *   so two quick drags reach the API in the order they were made.
 * - Members see no grip: reordering is an admin's change to the workspace.
 */
import { GripVerticalIcon } from '@animateicons/react/lucide/grip-vertical-icon';
import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  type Modifier,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn, MotionIcon, TooltipHint, toast } from '@postgear/ui';
import { type ReactNode, useId, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Channel } from '@/types/channel';
import { useCalendar } from './calendar-context';

const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

/** A channel only moves up and down its list. */
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/**
 * Set on the list while a channel is being moved, so the phone's sheet can
 * leave Escape to the drag (cancel the move) instead of closing.
 */
export const CHANNEL_DRAGGING_ATTRIBUTE = 'data-channel-dragging';

const INSTRUCTIONS =
  'To move a channel, press Space or Enter on its grip, use the up and down arrow keys, then press Space or Enter to drop it, or Escape to put it back.';

/**
 * The list, sortable when `canReorder`. `renderRow` draws each channel's row
 * content; the list owns the `li`, its drag transform and the grip.
 */
export function SortableChannelList({
  canReorder,
  renderRow,
}: {
  canReorder: boolean;
  renderRow: (channel: Channel, grip: ReactNode) => ReactNode;
}) {
  const { channels, orderChannelsLocally } = useCalendar();
  const dndId = useId();
  const [dragging, setDragging] = useState(false);
  // One save at a time, in the order the drags happened.
  const saving = useRef<Promise<unknown>>(Promise.resolve());

  const sensors = useSensors(
    // A few pixels of travel first, so pressing the grip is not a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const nameOf = (id: string | number) =>
    channels.find((channel) => channel.id === id)?.name ?? 'The channel';
  const positionOf = (id: string | number) =>
    channels.findIndex((channel) => channel.id === id) + 1;

  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${nameOf(active.id)}, position ${positionOf(active.id)} of ${channels.length}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${nameOf(active.id)} is at position ${positionOf(over.id)} of ${channels.length}.`
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${nameOf(active.id)} dropped at position ${positionOf(over.id)} of ${channels.length}.`
        : `${nameOf(active.id)} dropped.`,
    onDragCancel: ({ active }) => `Moving ${nameOf(active.id)} was cancelled.`,
  };

  function onDragEnd({ active, over }: DragEndEvent) {
    setDragging(false);

    if (!over || active.id === over.id) {
      return;
    }

    const previous = channels.map((channel) => channel.id);
    const from = previous.indexOf(String(active.id));
    const to = previous.indexOf(String(over.id));

    if (from === -1 || to === -1) {
      return;
    }

    const next = arrayMove(previous, from, to);
    orderChannelsLocally(next);

    saving.current = saving.current.then(() =>
      api('/channels/order', { method: 'PUT', body: { ids: next } }).catch((cause: unknown) => {
        orderChannelsLocally(previous);
        toast({
          title:
            cause instanceof ApiError ? cause.message : 'The new channel order could not be saved.',
          variant: 'danger',
        });
      }),
    );
  }

  if (!canReorder) {
    return (
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {channels.map((channel) => (
          <li
            key={channel.id}
            data-testid="channel-row"
            data-channel-id={channel.id}
            className={cn(
              'group/row relative flex items-center gap-1 rounded-lg',
              channel.disabled && 'opacity-50',
            )}
          >
            {renderRow(channel, null)}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[verticalOnly]}
      accessibility={{ announcements, screenReaderInstructions: { draggable: INSTRUCTIONS } }}
      onDragStart={() => setDragging(true)}
      onDragCancel={() => setDragging(false)}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={channels.map((channel) => channel.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul
          className="m-0 flex list-none flex-col gap-3 p-0"
          {...{ [CHANNEL_DRAGGING_ATTRIBUTE]: dragging ? 'true' : undefined }}
        >
          {channels.map((channel) => (
            <SortableChannelRow key={channel.id} channel={channel} renderRow={renderRow} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableChannelRow({
  channel,
  renderRow,
}: {
  channel: Channel;
  renderRow: (channel: Channel, grip: ReactNode) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: channel.id });

  const grip = (
    <TooltipHint label="Drag To Reorder" side="top" hoverable={false}>
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${channel.name}`}
        data-testid="channel-grip"
        className={cn(
          'flex h-8 w-4 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-ink',
          'opacity-40 transition-opacity hover:opacity-100 group-hover/row:opacity-70 active:cursor-grabbing',
          'focus-visible:opacity-100',
          FOCUS,
        )}
      >
        <MotionIcon icon={GripVerticalIcon} size={14} className="h-3.5 w-3.5" />
      </button>
    </TooltipHint>
  );

  return (
    <li
      ref={setNodeRef}
      data-testid="channel-row"
      data-channel-id={channel.id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group/row relative flex items-center gap-1 rounded-lg',
        // The row being moved lifts over the others, on the card's own fill.
        isDragging && 'z-10 bg-chrome shadow-surfaceMd',
        channel.disabled && 'opacity-50',
      )}
    >
      {renderRow(channel, grip)}
    </li>
  );
}
