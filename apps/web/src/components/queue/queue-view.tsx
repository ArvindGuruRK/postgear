'use client';

import { ArrowUp01Icon } from '@animateicons/react/lucide/arrow-up-0-1-icon';
import { ArrowUp10Icon } from '@animateicons/react/lucide/arrow-up-1-0-icon';
/**
 * The queue: every post in publish order, filtered and paged.
 *
 * The calendar answers "when"; this answers "what, in what order, and did it
 * work". Revamped 2026-10-23 as a timeline: it opens on the queued posts, and
 * each day is a date tile beside one card of rows (`queue-timeline.ts`); the
 * violet tile is today. The state tabs
 * carry their counts, so "4 failed" is visible before anyone clicks. Filters
 * live in the URL so a view such as "failed posts this week" can be bookmarked.
 */
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { XIcon } from '@animateicons/react/lucide/x-icon';
import {
  Alert,
  Badge,
  Button,
  buttonVariants,
  cn,
  DatePicker,
  EmptyState,
  ErrorState,
  localDayValue,
  MotionIcon,
  PageActions,
  Pagination,
  Stack,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@postgear/ui';
import { CircleCheck, FilePen, ListOrdered, type LucideIcon, Send } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { SEGMENTED_LIST, SEGMENTED_TRIGGER } from '@/components/analytics/analytics-ui';
import { toSummary } from '@/components/calendar/calendar-view';
import { ChannelSelect } from '@/components/channels/channel-select';
import type { Channel } from '@/types/channel';
import type { PostSummary, QueuePage } from '@/types/post';
import { DeletePostDialog } from '../posts/delete-post-dialog';
import { PostDetailDialog } from '../posts/post-detail-dialog';
import { RescheduleDialog } from '../posts/reschedule-dialog';
import { useMounted } from '../posts/use-mounted';
import { usePostActions } from '../posts/use-post-actions';
import { QueueDay, QueueSkeleton } from './queue-day';
import { isNarrowed, type QueueStateFilter, STATE_TABS } from './queue-filters';
import { QueueRow } from './queue-row';
import { buildTimeline, emptyCopy } from './queue-timeline';
import { useQueue } from './use-queue';

/** The toolbar's fields: the Analytics toolbar's look, so the two pages read as one. */
const FIELD = 'h-10 rounded-lg bg-chrome text-sm shadow-none';

const EMPTY_ICONS: Record<QueueStateFilter, LucideIcon> = {
  QUEUE: ListOrdered,
  ERROR: CircleCheck,
  DRAFT: FilePen,
  PUBLISHED: Send,
  all: ListOrdered,
};

export function QueueView({
  orgId,
  channels,
  initialPage,
  initialParams,
}: {
  orgId: string;
  channels: Channel[];
  initialPage: QueuePage | null;
  initialParams: string;
}) {
  const router = useRouter();
  const queue = useQueue(initialPage, new URLSearchParams(initialParams));
  const actions = usePostActions();
  const mounted = useMounted();

  const [open, setOpen] = useState<PostSummary | null>(null);
  const [rescheduling, setRescheduling] = useState<PostSummary | null>(null);
  const [deleting, setDeleting] = useState<PostSummary | null>(null);

  const posts = queue.data?.posts ?? [];
  const narrowed = isNarrowed(queue.filters);
  const counts = queue.data?.counts ?? null;

  const days = useMemo(() => buildTimeline(posts, queue.now), [posts, queue.now]);

  async function publishNow(post: PostSummary) {
    const detail = await actions.publishNow(post.group);
    if (detail) {
      const summary = toSummary(detail, post);
      queue.replacePost(summary);
      setOpen((current) => (current?.group === post.group ? summary : current));
    }
  }

  async function reschedule(publishDate: Date) {
    if (!rescheduling) {
      return;
    }
    const detail = await actions.reschedule(rescheduling.group, publishDate);
    if (detail) {
      queue.replacePost(toSummary(detail, rescheduling));
      setRescheduling(null);
      setOpen(null);
      // The row may now belong on another page or under another day.
      queue.reload();
    }
  }

  async function remove() {
    if (!deleting) {
      return;
    }
    const removed = await actions.remove(deleting.group);
    if (removed) {
      queue.removePost(deleting.group);
      setDeleting(null);
      setOpen(null);
      // The tab counts are the server's; a reload brings them in line.
      queue.reload();
    }
  }

  const empty = emptyCopy(queue.filters.state);
  const ascending = queue.filters.sort === 'asc';

  return (
    <Stack gap="lg">
      <div className="flex flex-col gap-3">
        <PageActions className="justify-between">
          {/* One row, always: anything narrower than the five tabs scrolls
              inside the list rather than widening the page. On a phone the
              tabs drop under the New Post button. */}
          <Tabs
            className="order-last w-full min-w-0 md:order-none md:w-auto"
            value={queue.filters.state}
            onValueChange={(value) => queue.setState(value as QueueStateFilter)}
          >
            <TabsList
              aria-label="Filter by state"
              className={cn(
                SEGMENTED_LIST,
                'flex w-full max-w-full overflow-x-auto pg-scrollbar pg-scrollbar-primary md:inline-flex md:w-auto',
              )}
            >
              {STATE_TABS.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className={cn(
                    SEGMENTED_TRIGGER,
                    'group flex-1 gap-2 px-2.5 sm:px-3 md:flex-none',
                  )}
                >
                  {tab.label}
                  {counts ? <CountBadge state={tab.value} count={counts[tab.value]} /> : null}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <Link
            href={`/${orgId}/composer`}
            className={cn(buttonVariants({ variant: 'primary', size: 'sm' }), 'ms-auto h-10')}
          >
            <MotionIcon icon={PlusIcon} className="h-4 w-4" />
            New Post
          </Link>
        </PageActions>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <ChannelSelect
            id="queue-channel"
            channels={channels}
            value={queue.filters.channelId}
            onValueChange={(channelId) => queue.setFilters({ channelId })}
            className={cn(FIELD, 'col-span-2 w-full sm:w-60')}
          />

          {/* Two pickers rather than one range: either end may stay open ("from
              today on"), as the URL allows. Each greys out the days that would
              put the range the wrong way round. */}
          <DatePicker
            id="queue-from"
            label="From"
            placeholder="From any day"
            value={filterDay(queue.filters.from)}
            onValueChange={(date) => queue.setFilters({ from: date ? localDayValue(date) : null })}
            maxDate={filterDay(queue.filters.to)}
            className={cn(FIELD, 'sm:w-52')}
          />
          <DatePicker
            id="queue-to"
            label="To"
            placeholder="To any day"
            value={filterDay(queue.filters.to)}
            onValueChange={(date) => queue.setFilters({ to: date ? localDayValue(date) : null })}
            minDate={filterDay(queue.filters.from)}
            className={cn(FIELD, 'sm:w-52')}
          />

          {/* A full row of their own on a phone, so a lone button never sits
              in half of one; from sm they join the line. */}
          <div className="col-span-2 flex gap-2 sm:contents">
            <Button
              variant="secondary"
              size="sm"
              className="h-10 flex-1 sm:flex-none"
              onClick={() => queue.setFilters({ sort: ascending ? 'desc' : 'asc' })}
              aria-label={ascending ? 'Sorted soonest first' : 'Sorted newest first'}
            >
              <MotionIcon icon={ascending ? ArrowUp01Icon : ArrowUp10Icon} className="h-4 w-4" />
              {ascending ? 'Soonest First' : 'Newest First'}
            </Button>

            {narrowed ? (
              <Button
                variant="secondary"
                size="sm"
                className="h-10 flex-1 sm:flex-none"
                onClick={queue.reset}
              >
                <MotionIcon icon={XIcon} className="h-4 w-4" />
                Clear Filters
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {queue.data ? (
        <span className="sr-only" aria-live="polite">
          {queue.data.total} {queue.data.total === 1 ? 'post' : 'posts'}
        </span>
      ) : null}

      {queue.error ? (
        <ErrorState
          title="The queue didn't load"
          description={queue.error}
          action={{ label: 'Try Again', onClick: queue.reload }}
        />
      ) : !mounted || (queue.loading && posts.length === 0) ? (
        // Rows format times in the viewer's locale, which the server does not
        // share; the server renders this skeleton and the browser the rows.
        <QueueSkeleton />
      ) : posts.length === 0 ? (
        narrowed ? (
          <Alert>
            Nothing on this tab matches the channel and dates you picked.
            <Button variant="secondary" size="sm" className="ms-3" onClick={queue.reset}>
              Clear Filters
            </Button>
          </Alert>
        ) : (
          <EmptyState
            icon={EMPTY_ICONS[queue.filters.state]}
            title={empty.title}
            description={empty.description}
            action={
              empty.create
                ? { label: 'Create Post', onClick: () => router.push(`/${orgId}/composer`) }
                : undefined
            }
          />
        )
      ) : (
        <div className="flex flex-col gap-6" aria-busy={queue.loading}>
          {days.map((day) => (
            <QueueDay key={day.key} day={day}>
              {day.posts.map((post) => (
                <QueueRow
                  key={post.group}
                  orgId={orgId}
                  post={post}
                  now={queue.now}
                  onOpen={setOpen}
                  onPublishNow={(target) => void publishNow(target)}
                  onReschedule={setRescheduling}
                  onDelete={setDeleting}
                />
              ))}
            </QueueDay>
          ))}

          {queue.data && queue.data.pageCount > 1 ? (
            <Pagination
              page={queue.data.page}
              pageCount={queue.data.pageCount}
              onPageChange={(page) => queue.setFilters({ page })}
              className="justify-center"
            />
          ) : null}
        </div>
      )}

      <PostDetailDialog
        orgId={orgId}
        post={open}
        now={queue.now}
        busy={actions.busy !== null}
        onOpenChange={(isOpen) => !isOpen && setOpen(null)}
        onPublishNow={(post) => void publishNow(post)}
        onReschedule={setRescheduling}
        onDelete={setDeleting}
      />

      <RescheduleDialog
        post={rescheduling}
        channels={channels}
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

/**
 * A tab's count, in the colour of the posts it counts: published is the
 * success green of the row badge, failed the danger red (only while there is
 * something to fix; a 0 stays an outline), and the rest the primary blue. On
 * the chosen tab, which is itself blue, the badge turns to the card surface
 * so it never disappears into the fill.
 */
const COUNT_VARIANT: Record<QueueStateFilter, 'primary' | 'success' | 'danger'> = {
  QUEUE: 'primary',
  DRAFT: 'primary',
  all: 'primary',
  PUBLISHED: 'success',
  ERROR: 'danger',
};

function CountBadge({ state, count }: { state: QueueStateFilter; count: number }) {
  const variant = state === 'ERROR' && count === 0 ? 'outline' : COUNT_VARIANT[state];

  return (
    <>
      <Badge
        aria-hidden="true"
        variant={variant}
        className={cn(
          'min-w-6 justify-center px-1.5 py-0.5 leading-none tabular-nums',
          variant === 'primary' &&
            'group-data-[state=active]:bg-secondary group-data-[state=active]:text-ink',
        )}
      >
        {count}
      </Badge>
      {/* Read as "Failed 4 posts" rather than "Failed 4". The tab adds the
          space between its children, so none is written here. */}
      <span className="sr-only">
        {count} {count === 1 ? 'post' : 'posts'}
      </span>
    </>
  );
}

/** A filter's `YYYY-MM-DD` as that local day, for the date pickers. */
function filterDay(value: string | null): Date | undefined {
  if (!value) {
    return undefined;
  }
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}
