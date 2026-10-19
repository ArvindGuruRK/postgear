'use client';

import { FileTextIcon } from '@animateicons/react/lucide/file-text-icon';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  MotionIcon,
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
 * Saved posts that are not published yet, where a draft is reopened.
 *
 * Queued posts are listed too. Sprint 5 builds the queue page proper; until
 * then, this is the only way back into a queued post to change it, and
 * leaving it out would make "Add to queue" a one-way door.
 *
 * Fetched when opened rather than rendered with the page, so it always shows
 * the latest saves, including one made seconds ago in this same composer.
 */
export function DraftsSheet({
  orgId,
  open,
  onOpenChange,
  currentGroup,
  onNavigate,
}: {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentGroup: string | null;
  /**
   * Opens a saved post. The composer passes this so its own links stay in
   * the composer (see `navigateTo` in composer.tsx); without it, a plain link.
   */
  onNavigate?: (href: string) => void;
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
              onNavigate={onNavigate}
            />
            <PostList
              title="Queued"
              posts={queued}
              orgId={orgId}
              currentGroup={currentGroup}
              onOpen={() => onOpenChange(false)}
              onNavigate={onNavigate}
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
  onNavigate,
}: {
  title: string;
  posts: PostSummary[];
  orgId: string;
  currentGroup: string | null;
  onOpen: () => void;
  onNavigate?: (href: string) => void;
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
              onClick={(event) => {
                onOpen();
                if (onNavigate) {
                  event.preventDefault();
                  onNavigate(`/${orgId}/composer?group=${post.group}`);
                }
              }}
              aria-current={post.group === currentGroup ? 'page' : undefined}
              className="flex flex-col gap-1 rounded-md border-2 border-outline bg-secondary p-3 text-ink shadow-surfaceSm outline-none hover:bg-actionPrimary/10 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing aria-[current=page]:bg-actionPrimary/10"
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

/**
 * The button that opens the sheet, kept beside it so the two never drift. On
 * a phone the composer's header keeps to icons (Templates sits beside it),
 * named for assistive technology by its label.
 */
export function DraftsButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="secondary" size="sm" onClick={onClick} aria-label="Saved posts">
      <MotionIcon icon={FileTextIcon} className="h-4 w-4" />
      <span className="hidden sm:inline">Saved posts</span>
    </Button>
  );
}
