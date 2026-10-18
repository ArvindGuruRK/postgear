'use client';

import { CalendarClockIcon } from '@animateicons/react/lucide/calendar-clock-icon';
import { EllipsisVerticalIcon } from '@animateicons/react/lucide/ellipsis-vertical-icon';
import { SendIcon } from '@animateicons/react/lucide/send-icon';
import { SquarePenIcon } from '@animateicons/react/lucide/square-pen-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MotionIcon,
} from '@postgear/ui';
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
          <MotionIcon icon={EllipsisVerticalIcon} className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => router.push(`/${orgId}/composer?group=${post.group}`)}>
          <MotionIcon icon={SquarePenIcon} className="h-4 w-4" />
          {locked ? 'Open in composer' : 'Edit in composer'}
        </DropdownMenuItem>
        {canPublishNow ? (
          <DropdownMenuItem onSelect={() => onPublishNow(post)}>
            <MotionIcon icon={SendIcon} className="h-4 w-4" />
            {post.state === 'ERROR' ? 'Retry now' : 'Post now'}
          </DropdownMenuItem>
        ) : null}
        {canMove ? (
          <DropdownMenuItem onSelect={() => onReschedule(post)}>
            <MotionIcon icon={CalendarClockIcon} className="h-4 w-4" />
            Reschedule
          </DropdownMenuItem>
        ) : null}
        {!locked ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onDelete(post)}>
              <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
