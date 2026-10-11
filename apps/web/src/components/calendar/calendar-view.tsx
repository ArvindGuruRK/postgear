'use client';

/**
 * The calendar: month, week and day views of every scheduled post, with
 * drag-to-reschedule.
 *
 * ## What a drop does
 *
 * The card moves at once (optimistic), then `PUT /posts/:group/schedule` is
 * sent. The API's answer replaces the card; a refusal — a queued post dragged
 * into a slot that became "past" during the drag, a post published meanwhile —
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
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  Alert,
  Button,
  buttonVariants,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Stack,
  useToast,
} from '@postgear/ui';
import { CalendarDays, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { PostSummary } from '@/types/post';
import { DeletePostDialog } from '../posts/delete-post-dialog';
import { PostDetailDialog } from '../posts/post-detail-dialog';
import { RescheduleDialog } from '../posts/reschedule-dialog';
import { SchedulerStatusPill } from '../posts/scheduler-status';
import { useMounted } from '../posts/use-mounted';
import { usePostActions } from '../posts/use-post-actions';
import { useCalendar } from './calendar-context';
import { composerTimeFor, droppedAt, isPastSlot } from './calendar-math';
import type { SlotTarget } from './calendar-slot';
import { CalendarToolbar } from './calendar-toolbar';
import { MonthView } from './month-view';
import { PostCard } from './post-card';
import { TimeGridView } from './time-grid-view';

/** Summarises a detail response back into the shape the calendar lists. */
export function toSummary(
  detail: {
    group: string;
    state: PostSummary['state'];
    publishDate: string;
    updatedAt: string;
    channels: PostSummary['channels'];
    shared: { content: unknown }[];
  },
  previous: PostSummary,
): PostSummary {
  return {
    ...previous,
    group: detail.group,
    state: detail.state,
    publishDate: detail.publishDate,
    updatedAt: detail.updatedAt,
    channels: detail.channels.map((channel) => ({
      channelId: channel.channelId,
      name: channel.name,
      providerIdentifier: channel.providerIdentifier,
      picture: channel.picture,
      disconnected: channel.disconnected,
      state: channel.state,
      releaseURL: channel.releaseURL,
      publishStatus: channel.publishStatus,
    })),
  };
}

export function CalendarView() {
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

  const sensors = useSensors(
    // A few pixels of travel, so a click on the grip is not read as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  function onDragStart({ active }: DragStartEvent) {
    const post = (active.data.current as { post?: PostSummary } | undefined)?.post;
    setDragging(post ?? null);
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
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
        description: 'Drop the post on a slot in the future, or use "Post now".',
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
        description: 'Drop the post on a slot in the future, or use "Post now".',
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

  function createAt(target: SlotTarget) {
    const at = composerTimeFor(target, new Date());
    router.push(`/${calendar.orgId}/composer?at=${encodeURIComponent(at.toISOString())}`);
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

  const busy = actions.busy !== null;
  const empty = mounted && !calendar.loading && !calendar.error && calendar.posts.length === 0;

  return (
    <Stack gap="lg">
      <PageHeader
        title="Calendar"
        description="Every scheduled post, where it falls. Drag a card to move it; click a slot to write one."
        actions={
          <>
            <SchedulerStatusPill />
            <Link
              href={`/${calendar.orgId}/composer`}
              className={buttonVariants({ variant: 'primary' })}
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              New post
            </Link>
          </>
        }
      />

      {/* Everything below formats dates in the viewer's locale and time zone,
          which the server does not share — so the server renders a skeleton
          and the browser draws the real thing on mount (see useMounted). */}
      {!mounted ? (
        <Stack gap="md" aria-busy="true" aria-label="Loading calendar">
          <Skeleton className="h-16" />
          <Skeleton className="h-[28rem]" />
        </Stack>
      ) : (
        <CalendarToolbar />
      )}

      {!mounted ? null : calendar.error ? (
        <ErrorState
          title="The calendar didn't load"
          description={calendar.error}
          action={{ label: 'Try again', onClick: calendar.reload }}
        />
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
          onDragCancel={() => setDragging(null)}
        >
          {calendar.view === 'month' ? (
            <MonthView
              anchor={calendar.anchor}
              posts={calendar.posts}
              now={calendar.now}
              onOpen={setOpen}
              onCreate={createAt}
              onShowDay={(day) => calendar.goTo(day, 'day')}
            />
          ) : (
            <TimeGridView
              view={calendar.view}
              anchor={calendar.anchor}
              posts={calendar.posts}
              now={calendar.now}
              onOpen={setOpen}
              onCreate={createAt}
              onShowDay={(day) => calendar.goTo(day, 'day')}
            />
          )}

          <DragOverlay dropAnimation={null}>
            {dragging ? (
              <div className="w-56 rotate-[-1deg]">
                <PostCard post={dragging} now={calendar.now} overlay />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {empty ? (
        calendar.allPosts.length > 0 ? (
          <Alert>
            No posts for the selected channels in this {calendar.view}.{' '}
            <Button
              variant="secondary"
              size="sm"
              className="ms-2"
              onClick={calendar.clearChannelFilter}
            >
              Show all channels
            </Button>
          </Alert>
        ) : (
          <EmptyState
            icon={CalendarDays}
            title={`Nothing scheduled this ${calendar.view}`}
            description="Click a slot above, or open the composer, and the post appears here at its time."
            action={{
              label: 'Write a post',
              onClick: () => router.push(`/${calendar.orgId}/composer`),
            }}
          />
        )
      ) : null}

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
    </Stack>
  );
}
