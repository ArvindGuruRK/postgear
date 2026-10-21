'use client';

/**
 * The calendar page's body (UI revamp, 2026-10-18), laid out as the
 * reference's: the channel card on the left, and beside it the toolbar over
 * the day, week or month grid, open on the page ground.
 *
 * ## What a drop does
 *
 * The card moves at once (optimistic), then `PUT /posts/:group/schedule` is
 * sent. The API's answer replaces the card; a refusal (a queued post dragged
 * into a slot that became "past" during the drag, a post published meanwhile)
 * puts the card back where it was and says why. The workflow behind the post
 * is woken by the API, so the new time is also the time it actually publishes.
 *
 * ## Why one DndContext over the whole grid
 *
 * Cards are draggables and slots are droppables in the same context, so a card
 * can be dragged from Tuesday to Friday, or from 9:00 to 14:00, with the
 * collision detection picking the slot under the pointer. The overlay renders
 * a copy of the card while the original fades, so the grid never reflows
 * mid-drag.
 */
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { ErrorState, Skeleton, useToast } from '@postgear/ui';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useState } from 'react';
import type { ChannelLimit, ProviderSummary } from '@/types/channel';
import type { PostSummary } from '@/types/post';
import { PostAnalyticsDialog } from '../analytics/post-analytics-dialog';
import { DeletePostDialog } from '../posts/delete-post-dialog';
import { PostDetailDialog } from '../posts/post-detail-dialog';
import { RescheduleDialog } from '../posts/reschedule-dialog';
import { useMounted } from '../posts/use-mounted';
import { usePostActions } from '../posts/use-post-actions';
import { useCalendar } from './calendar-context';
import type { CalendarHandlers } from './calendar-handlers';
import { composerTimeFor, droppedAt, isPastSlot } from './calendar-math';
import type { SlotTarget } from './calendar-slot';
import { CalendarToolbar } from './calendar-toolbar';
import { ChannelsColumn } from './channels-column';
import { ChannelsSheet } from './channels-sheet';
import { DayView } from './day-view';
import { MonthView } from './month-view';
import { PostCard } from './post-card';
import { WeekView } from './week-view';

/** Summarises a detail response back into the shape the calendar lists. */
export function toSummary(
  detail: {
    group: string;
    state: PostSummary['state'];
    publishDate: string;
    updatedAt: string;
    channels: PostSummary['channels'];
    shared: { content: unknown }[];
    tags?: PostSummary['tags'];
    intervalInDays?: PostSummary['intervalInDays'];
  },
  previous: PostSummary,
): PostSummary {
  return {
    ...previous,
    group: detail.group,
    state: detail.state,
    publishDate: detail.publishDate,
    updatedAt: detail.updatedAt,
    // Optional: a detail from an API older than tags carries neither.
    tags: detail.tags ?? previous.tags,
    intervalInDays:
      detail.intervalInDays === undefined ? previous.intervalInDays : detail.intervalInDays,
    channels: detail.channels.map((channel) => ({
      channelId: channel.channelId,
      name: channel.name,
      providerIdentifier: channel.providerIdentifier,
      picture: channel.picture,
      color: channel.color,
      disconnected: channel.disconnected,
      state: channel.state,
      releaseURL: channel.releaseURL,
      publishStatus: channel.publishStatus,
    })),
  };
}

/**
 * Swallows the click a drag can leave behind. A finger that long-presses a
 * card and lets go where it started is still a tap to the browser, which then
 * clicks the card's link. dnd-kit stops that click's propagation, so Next's
 * Link never handles it, but not its default, so the browser would follow the
 * href with a full page load. A window capture listener runs before dnd-kit's
 * document one; the click follows the touchend at once, well inside 100ms.
 */
function swallowClickAfterDrag() {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener('click', swallow, true);
  setTimeout(() => window.removeEventListener('click', swallow, true), 100);
}

export function CalendarView({
  providers,
  limit,
}: {
  providers: ProviderSummary[];
  limit: ChannelLimit | null;
}) {
  const calendar = useCalendar();
  const router = useRouter();
  const { toast } = useToast();
  const actions = usePostActions();
  const dndId = useId();
  const mounted = useMounted();

  const [dragging, setDragging] = useState<PostSummary | null>(null);
  const [open, setOpen] = useState<PostSummary | null>(null);
  const [rescheduling, setRescheduling] = useState<PostSummary | null>(null);
  const [deleting, setDeleting] = useState<PostSummary | null>(null);
  const [statistics, setStatistics] = useState<string | null>(null);

  const sensors = useSensors(
    // Mouse and touch as separate sensors, as dnd-kit advises when the two
    // need different activation. The mouse drags the grip after a few pixels
    // of travel, so a click on it is not read as a drag. A finger long-presses
    // anywhere on the card (PostCard): still for 250ms, within 5px, so a
    // swipe over the grid still scrolls it and a tap still opens the post.
    // One PointerSensor for both would claim a touch's pointerdown, and the
    // browser would turn the finger's movement into a scroll and cancel it.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );

  function onDragStart({ active }: DragStartEvent) {
    const post = (active.data.current as { post?: PostSummary } | undefined)?.post;
    setDragging(post ?? null);
  }

  function onDragCancel() {
    swallowClickAfterDrag();
    setDragging(null);
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    swallowClickAfterDrag();
    setDragging(null);

    const post = (active.data.current as { post?: PostSummary } | undefined)?.post;
    const target = over?.data.current as SlotTarget | undefined;

    if (!post || !target) {
      return;
    }

    const now = new Date();

    if (isPastSlot(target, now)) {
      toast({
        variant: 'danger',
        title: 'That time has passed',
        description: 'Drop the post on a slot in the future, or use "Post Now".',
      });
      return;
    }

    const current = new Date(post.publishDate);
    const next = droppedAt(current, target);

    if (next.getTime() === current.getTime()) {
      return;
    }

    if (post.state !== 'DRAFT' && next.getTime() <= now.getTime()) {
      toast({
        variant: 'danger',
        title: 'That time has passed',
        description: 'Drop the post on a slot in the future, or use "Post Now".',
      });
      return;
    }

    calendar.movePostLocally(post.group, next);
    const detail = await actions.reschedule(post.group, next, { quiet: true });

    if (detail) {
      calendar.replacePost(toSummary(detail, post));
      toast({
        title: 'Rescheduled',
        description: next.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
      });
    } else {
      calendar.movePostLocally(post.group, current);
    }
  }

  async function publishNow(post: PostSummary) {
    const detail = await actions.publishNow(post.group);
    if (detail) {
      calendar.replacePost(toSummary(detail, post));
      setOpen((current) => (current?.group === post.group ? toSummary(detail, post) : current));
    }
  }

  async function reschedule(publishDate: Date) {
    if (!rescheduling) {
      return;
    }
    const detail = await actions.reschedule(rescheduling.group, publishDate);
    if (detail) {
      calendar.replacePost(toSummary(detail, rescheduling));
      setRescheduling(null);
      setOpen(null);
    }
  }

  async function remove() {
    if (!deleting) {
      return;
    }
    const removed = await actions.remove(deleting.group);
    if (removed) {
      calendar.removePostLocally(deleting.group);
      setDeleting(null);
      setOpen(null);
    }
  }

  const { orgId, goTo } = calendar;
  const handlers = useMemo<CalendarHandlers>(
    () => ({
      editHref: (post) => `/${orgId}/composer?group=${post.group}`,
      // The reference's Duplicate: a new post from the original's text and
      // media, no channel picked, at the default time (the composer reads
      // `?duplicate=`).
      onDuplicate: (post) =>
        router.push(`/${orgId}/composer?duplicate=${encodeURIComponent(post.group)}`),
      onPreview: setOpen,
      onStatistics: (post) => setStatistics(post.group),
      onDelete: setDeleting,
      onCreate: (target) => {
        const at = composerTimeFor(target, new Date());
        router.push(`/${orgId}/composer?at=${encodeURIComponent(at.toISOString())}`);
      },
      onShowDay: (day) => goTo(day, 'day'),
    }),
    [orgId, goTo, router],
  );

  // The day view's rows come from the channels in view that can post.
  const dayChannels = calendar.channels.filter(
    (channel) =>
      !channel.disabled &&
      (calendar.channelFilter.length === 0 || calendar.channelFilter.includes(channel.id)),
  );

  const busy = actions.busy !== null;

  return (
    <>
      {/* On a phone the card would leave the grid no width: it moves into a
          sheet behind a row above the toolbar (ChannelsSheet). */}
      <div className="flex min-w-0 flex-1 flex-col gap-3 md:flex-row md:gap-5">
        <ChannelsColumn providers={providers} limit={limit} className="hidden md:flex" />
        <ChannelsSheet providers={providers} limit={limit} className="md:hidden" />

        <section
          aria-label="Calendar"
          aria-busy={calendar.loading}
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-3"
        >
          {/* Everything below formats dates in the viewer's locale and time
              zone, which the server does not share, so the server renders a
              skeleton and the browser draws the real thing on mount. */}
          {!mounted ? (
            <div className="flex flex-1 flex-col gap-3" role="status" aria-label="Loading calendar">
              <Skeleton className="h-10" />
              <Skeleton className="flex-1" />
            </div>
          ) : (
            <>
              <CalendarToolbar />
              {calendar.error ? (
                <div className="flex flex-1 items-center justify-center">
                  <ErrorState
                    title="The calendar didn't load"
                    description={calendar.error}
                    action={{ label: 'Try Again', onClick: calendar.reload }}
                  />
                </div>
              ) : (
                <DndContext
                  id={dndId}
                  sensors={sensors}
                  collisionDetection={(args) => {
                    // The pointer's own slot first; the nearest overlapping one for keyboard drags.
                    const within = pointerWithin(args);
                    return within.length > 0 ? within : rectIntersection(args);
                  }}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onDragCancel={onDragCancel}
                >
                  {calendar.view === 'month' ? (
                    <MonthView
                      anchor={calendar.anchor}
                      posts={calendar.posts}
                      now={calendar.now}
                      handlers={handlers}
                    />
                  ) : calendar.view === 'week' ? (
                    <WeekView
                      anchor={calendar.anchor}
                      posts={calendar.posts}
                      now={calendar.now}
                      handlers={handlers}
                    />
                  ) : (
                    <DayView
                      anchor={calendar.anchor}
                      posts={calendar.posts}
                      channels={dayChannels}
                      now={calendar.now}
                      handlers={handlers}
                    />
                  )}

                  {/* dnd-kit sizes the overlay to the card being dragged, so the
                      copy fills it: a fixed width made it wider than a week
                      column's card on a phone. */}
                  <DragOverlay dropAnimation={null}>
                    {dragging ? (
                      <div className="w-full rotate-[-1deg]">
                        <PostCard post={dragging} now={calendar.now} overlay />
                      </div>
                    ) : null}
                  </DragOverlay>
                </DndContext>
              )}
            </>
          )}
        </section>
      </div>

      <PostDetailDialog
        orgId={calendar.orgId}
        post={open}
        now={calendar.now}
        busy={busy}
        onOpenChange={(isOpen) => !isOpen && setOpen(null)}
        onPublishNow={(post) => void publishNow(post)}
        onReschedule={setRescheduling}
        onDelete={setDeleting}
      />

      <RescheduleDialog
        post={rescheduling}
        channels={calendar.channels}
        busy={actions.busy?.kind === 'reschedule'}
        onOpenChange={(isOpen) => !isOpen && setRescheduling(null)}
        onConfirm={(publishDate) => void reschedule(publishDate)}
      />

      <DeletePostDialog
        post={deleting}
        busy={actions.busy?.kind === 'delete'}
        onOpenChange={(isOpen) => !isOpen && setDeleting(null)}
        onConfirm={() => void remove()}
      />

      <PostAnalyticsDialog
        group={statistics}
        now={calendar.now}
        onOpenChange={(isOpen) => !isOpen && setStatistics(null)}
      />
    </>
  );
}
