'use client';

/**
 * The queue: every post in publish order, filtered and paged.
 *
 * The calendar answers "when"; this answers "what, in what order, and did it
 * work". Rows are grouped under day headings, and the filters (state tabs,
 * channel, date range, direction) live in the URL so a view of "failed posts
 * this week" can be bookmarked.
 */
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import {
  Alert,
  Button,
  buttonVariants,
  EmptyState,
  ErrorState,
  Input,
  Label,
  MotionIcon,
  PageActions,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Stack,
  Tabs,
  TabsList,
  TabsTrigger,
  Text,
} from '@postgear/ui';
import { ArrowDownNarrowWide, ArrowUpNarrowWide, ListOrdered } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toSummary } from '@/components/calendar/calendar-view';
import type { Channel } from '@/types/channel';
import type { PostSummary, QueuePage } from '@/types/post';
import { DeletePostDialog } from '../posts/delete-post-dialog';
import { PostDetailDialog } from '../posts/post-detail-dialog';
import { RescheduleDialog } from '../posts/reschedule-dialog';
import { useMounted } from '../posts/use-mounted';
import { usePostActions } from '../posts/use-post-actions';
import { isFiltered, type QueueStateFilter, STATE_TABS } from './queue-filters';
import { QueueRow } from './queue-row';
import { useQueue } from './use-queue';

const ALL_CHANNELS = '__all__';

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
  const filtered = isFiltered(queue.filters);

  // Rows under the day they publish on, in the list's own order.
  const days = useMemo(() => {
    const groups = new Map<string, { label: string; posts: PostSummary[] }>();

    for (const post of posts) {
      const date = new Date(post.publishDate);
      const key = date.toDateString();
      const entry = groups.get(key) ?? { label: dayLabel(date, queue.now), posts: [] };
      entry.posts.push(post);
      groups.set(key, entry);
    }

    return [...groups.values()];
  }, [posts, queue.now]);

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
    }
  }

  return (
    <Stack gap="lg">
      <PageActions>
        <Link href={`/${orgId}/composer`} className={buttonVariants({ variant: 'primary' })}>
          <MotionIcon icon={PlusIcon} className="h-4 w-4" />
          New post
        </Link>
      </PageActions>

      <Tabs
        value={queue.filters.state}
        onValueChange={(value) => queue.setFilters({ state: value as QueueStateFilter })}
      >
        <TabsList className="flex-wrap" aria-label="Filter by state">
          {STATE_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-3 rounded-md border-2 border-outline bg-secondary p-3 shadow-surfaceSm md:flex-row md:flex-wrap md:items-end">
        <div className="flex flex-col gap-1.5 md:w-56">
          <Label htmlFor="queue-channel">Channel</Label>
          <Select
            value={queue.filters.channelId ?? ALL_CHANNELS}
            onValueChange={(value) =>
              queue.setFilters({ channelId: value === ALL_CHANNELS ? null : value })
            }
          >
            <SelectTrigger id="queue-channel" className="h-9 text-xs">
              <SelectValue placeholder="All channels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CHANNELS}>All channels</SelectItem>
              {channels.map((channel) => (
                <SelectItem key={channel.id} value={channel.id}>
                  {channel.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="queue-from">From</Label>
          <Input
            id="queue-from"
            type="date"
            size="sm"
            value={queue.filters.from ?? ''}
            onChange={(event) => queue.setFilters({ from: event.target.value || null })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="queue-to">To</Label>
          <Input
            id="queue-to"
            type="date"
            size="sm"
            value={queue.filters.to ?? ''}
            onChange={(event) => queue.setFilters({ to: event.target.value || null })}
          />
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => queue.setFilters({ sort: queue.filters.sort === 'asc' ? 'desc' : 'asc' })}
          aria-label={queue.filters.sort === 'asc' ? 'Sorted soonest first' : 'Sorted latest first'}
        >
          {queue.filters.sort === 'asc' ? (
            <ArrowUpNarrowWide className="h-4 w-4" strokeWidth={2.5} />
          ) : (
            <ArrowDownNarrowWide className="h-4 w-4" strokeWidth={2.5} />
          )}
          {queue.filters.sort === 'asc' ? 'Soonest first' : 'Latest first'}
        </Button>

        {filtered ? (
          <Button variant="secondary" size="sm" onClick={queue.reset}>
            Clear filters
          </Button>
        ) : null}

        {queue.data ? (
          <Text size="sm" muted className="md:ms-auto" aria-live="polite">
            {queue.data.total} {queue.data.total === 1 ? 'post' : 'posts'}
          </Text>
        ) : null}
      </div>

      {queue.error ? (
        <ErrorState
          title="The queue didn't load"
          description={queue.error}
          action={{ label: 'Try again', onClick: queue.reload }}
        />
      ) : !mounted || (queue.loading && posts.length === 0) ? (
        // Rows format times in the viewer's locale, which the server does not
        // share; the server renders this skeleton and the browser the rows.
        <Stack gap="sm" aria-busy="true" aria-label="Loading queue">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </Stack>
      ) : posts.length === 0 ? (
        filtered ? (
          <Alert>
            Nothing matches these filters.
            <Button variant="secondary" size="sm" className="ms-3" onClick={queue.reset}>
              Clear filters
            </Button>
          </Alert>
        ) : (
          <EmptyState
            icon={ListOrdered}
            title="The queue is empty"
            description="Add a post to the queue from the composer and it lines up here."
            action={{ label: 'Write a post', onClick: () => router.push(`/${orgId}/composer`) }}
          />
        )
      ) : (
        <div className="flex flex-col gap-6" aria-busy={queue.loading}>
          {days.map((day) => (
            <section key={day.label} aria-label={day.label} className="flex flex-col gap-2">
              <h2 className="type-label text-sm text-ink opacity-70">{day.label}</h2>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
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
              </ul>
            </section>
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

/** "Today · Sat 11 Oct", "Tomorrow · …", or just the date. */
function dayLabel(date: Date, now: Date): string {
  const formatted = date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return `Today · ${formatted}`;
  if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow · ${formatted}`;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday · ${formatted}`;
  return formatted;
}
