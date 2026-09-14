'use client';

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Stack,
  Text,
} from '@postgear/ui';
import { FileText } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { PostSummary } from '@/types/post';

/**
 * Saved posts that are not published yet — where a draft is reopened.
 *
 * Queued posts are listed too. Sprint 5 builds the queue page proper; until
 * then, this is the only way back into a queued post to change it, and
 * leaving it out would make "Add to queue" a one-way door.
 *
 * Fetched when opened rather than rendered with the page, so it always shows
 * the latest saves — including one made seconds ago in this same composer.
 */
export function DraftsSheet({
  orgId,
  open,
  onOpenChange,
  currentGroup,
}: {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentGroup: string | null;
}) {
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    setError(null);

    api<{ posts: PostSummary[] }>('/posts')
      .then(
        (result) =>
          !cancelled &&
          setPosts(result.posts.filter((post) => post.state === 'DRAFT' || post.state === 'QUEUE')),
      )
      .catch(
        (cause: unknown) =>
          !cancelled &&
          setError(cause instanceof ApiError ? cause.message : 'Saved posts could not be loaded.'),
      );

    return () => {
      cancelled = true;
    };
  }, [open]);

  const drafts = posts?.filter((post) => post.state === 'DRAFT') ?? [];
  const queued = posts?.filter((post) => post.state === 'QUEUE') ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex flex-col gap-4 overflow-y-auto pg-scrollbar pg-scrollbar-secondary"
      >
        <SheetHeader>
          <SheetTitle>Saved posts</SheetTitle>
          <SheetDescription>Drafts and queued posts, most recently edited first.</SheetDescription>
        </SheetHeader>

        {error ? (
          <ErrorState title="Couldn't load posts" description={error} />
        ) : posts === null ? (
          <Stack gap="sm">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </Stack>
        ) : posts.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No saved posts"
            description="Save a draft and it will wait for you here."
          />
        ) : (
          <>
            <PostList
              title="Drafts"
              posts={drafts}
              orgId={orgId}
              currentGroup={currentGroup}
              onOpen={() => onOpenChange(false)}
            />
            <PostList
              title="Queued"
              posts={queued}
              orgId={orgId}
              currentGroup={currentGroup}
              onOpen={() => onOpenChange(false)}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function PostList({
  title,
  posts,
  orgId,
  currentGroup,
  onOpen,
}: {
  title: string;
  posts: PostSummary[];
  orgId: string;
  currentGroup: string | null;
  onOpen: () => void;
}) {
  if (posts.length === 0) {
    return null;
  }

  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <Text size="sm" weight="bold">
        {title} ({posts.length})
      </Text>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {posts.map((post) => (
          <li key={post.group}>
            <Link
              href={`/${orgId}/composer?group=${post.group}`}
              onClick={onOpen}
              aria-current={post.group === currentGroup ? 'page' : undefined}
              className="flex flex-col gap-1 rounded-md border-2 border-outline bg-secondary p-3 text-ink shadow-brutalSm outline-none hover:bg-actionPrimary/10 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing aria-[current=page]:bg-actionPrimary/10"
            >
              <span className="line-clamp-2 font-sans text-sm font-medium">
                {post.preview || <span className="opacity-60">Empty post</span>}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {post.channels.map((channel) => (
                  <Badge
                    key={channel.channelId}
                    variant="outline"
                    className={channel.disconnected ? 'line-through' : undefined}
                  >
                    {channel.name}
                  </Badge>
                ))}
                {post.parts > 1 ? <Badge variant="secondary">{post.parts} parts</Badge> : null}
              </span>
              <span className="font-sans text-xs opacity-60">
                {post.state === 'QUEUE' ? 'Scheduled for ' : 'Edited '}
                {new Date(
                  post.state === 'QUEUE' ? post.publishDate : post.updatedAt,
                ).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The button that opens the sheet, kept beside it so the two never drift. */
export function DraftsButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="secondary" onClick={onClick}>
      <FileText className="h-4 w-4" strokeWidth={2.5} />
      Saved posts
    </Button>
  );
}
