'use client';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@postgear/ui';
import { CalendarClock, MoreVertical, PenSquare, Send, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { PostSummary } from '@/types/post';
import { hasPublishedChannel } from './post-status';

/** The same four actions as the detail dialog, folded into a row's corner menu. */
export function PostActionsMenu({
  orgId,
  post,
  onPublishNow,
  onReschedule,
  onDelete,
}: {
  orgId: string;
  post: PostSummary;
  onPublishNow: (post: PostSummary) => void;
  onReschedule: (post: PostSummary) => void;
  onDelete: (post: PostSummary) => void;
}) {
  const router = useRouter();
  const canPublishNow = post.state === 'QUEUE' || post.state === 'ERROR';
  // Edit and Delete are refused by the API once any channel has published;
  // Reschedule still moves the channels that have not.
  const locked = hasPublishedChannel(post);
  const canMove = post.state !== 'PUBLISHED';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          aria-label="Post actions"
          className="w-9 shrink-0 px-0"
        >
          <MoreVertical className="h-4 w-4" strokeWidth={2.5} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => router.push(`/${orgId}/composer?group=${post.group}`)}>
          <PenSquare className="h-4 w-4" strokeWidth={2.5} />
          {locked ? 'Open in composer' : 'Edit in composer'}
        </DropdownMenuItem>
        {canPublishNow ? (
          <DropdownMenuItem onSelect={() => onPublishNow(post)}>
            <Send className="h-4 w-4" strokeWidth={2.5} />
            {post.state === 'ERROR' ? 'Retry now' : 'Post now'}
          </DropdownMenuItem>
        ) : null}
        {canMove ? (
          <DropdownMenuItem onSelect={() => onReschedule(post)}>
            <CalendarClock className="h-4 w-4" strokeWidth={2.5} />
            Reschedule
          </DropdownMenuItem>
        ) : null}
        {!locked ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onDelete(post)}>
              <Trash2 className="h-4 w-4" strokeWidth={2.5} />
              Delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
