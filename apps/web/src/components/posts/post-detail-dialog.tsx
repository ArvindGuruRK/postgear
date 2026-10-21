'use client';

/**
 * A post at a glance, with everything that can be done to it.
 *
 * Opened from a calendar card or a queue row. Shows the post's text, when it
 * goes (or went) out, and one line per channel with that channel's own
 * standing: a thread that published to X but is retrying on LinkedIn is
 * exactly the case this exists for. Actions: edit in the composer, publish
 * now, reschedule, delete; each only when the state allows it.
 */
import { CalendarClockIcon } from '@animateicons/react/lucide/calendar-clock-icon';
import { ExternalLinkIcon } from '@animateicons/react/lucide/external-link-icon';
import { SendIcon } from '@animateicons/react/lucide/send-icon';
import { SquarePenIcon } from '@animateicons/react/lucide/square-pen-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  buttonVariants,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  MotionIcon,
  Text,
} from '@postgear/ui';
import Link from 'next/link';
import { PlatformIcon, platformLabel } from '@/components/platforms/platform-icon';
import type { PostSummary } from '@/types/post';
import {
  describeChannel,
  describePost,
  formatRelative,
  formatWhen,
  hasPublishedChannel,
  isFailure,
  isRetrying,
} from './post-status';

export function PostDetailDialog({
  orgId,
  post,
  now,
  busy,
  onOpenChange,
  onPublishNow,
  onReschedule,
  onDelete,
}: {
  orgId: string;
  post: PostSummary | null;
  now: Date;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onPublishNow: (post: PostSummary) => void;
  onReschedule: (post: PostSummary) => void;
  onDelete: (post: PostSummary) => void;
}) {
  if (!post) {
    return <Dialog open={false} onOpenChange={onOpenChange} />;
  }

  const shown = describePost(post, now);
  const when = new Date(post.publishDate);
  const canPublishNow = post.state === 'QUEUE' || post.state === 'ERROR';
  const canMove = post.state !== 'PUBLISHED';
  // Once any channel has published, the post can be read and its pending
  // channels moved or retried, but not edited or deleted: the API locks it.
  const locked = hasPublishedChannel(post);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-testid="post-detail">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={shown.variant}>{shown.label}</Badge>
            {post.parts > 1 ? <Badge variant="outline">{post.parts} parts</Badge> : null}
          </div>
          <DialogTitle className="mt-1">{formatWhen(when)}</DialogTitle>
          <DialogDescription>
            {formatRelative(when, now)}
            {shown.detail ? `. ${shown.detail}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 flex flex-col gap-4">
          <blockquote className="m-0 whitespace-pre-wrap break-words rounded-md border-2 border-outline bg-secondary p-4 font-sans text-sm font-medium text-ink shadow-surfaceSm">
            {post.preview || <span className="opacity-60">Empty post</span>}
          </blockquote>

          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Channels">
            {post.channels.map((channel) => {
              const standing = describeChannel(channel, post.publishDate, now);
              const status = channel.publishStatus;

              return (
                <li
                  key={channel.channelId}
                  className="flex items-start gap-3 rounded-md border-2 border-outline bg-secondary p-3"
                >
                  <Avatar size="sm">
                    {channel.picture ? <AvatarImage src={channel.picture} alt="" /> : null}
                    <AvatarFallback
                      colorSeed={channel.color ?? channel.channelId}
                      className="text-[10px]"
                    >
                      {channel.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <PlatformIcon
                        platform={channel.providerIdentifier}
                        title={platformLabel(channel.providerIdentifier)}
                      />
                      <Text size="sm" weight="bold" as="span" className="truncate">
                        {channel.name}
                      </Text>
                      <Badge variant={standing.variant}>{standing.label}</Badge>
                      {channel.disconnected ? <Badge variant="outline">Disconnected</Badge> : null}
                    </div>
                    {isRetrying(status) ? (
                      <Text size="xs" muted>
                        Attempt {status.attempt} of {status.maxAttempts} failed: {status.message}
                      </Text>
                    ) : isFailure(status) ? (
                      <Text size="xs" muted>
                        {status.message}
                      </Text>
                    ) : null}
                    {channel.releaseURL ? (
                      <a
                        href={channel.releaseURL}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex w-fit items-center gap-1 font-sans text-xs font-bold text-ink underline underline-offset-2 outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
                      >
                        <MotionIcon
                          icon={ExternalLinkIcon}
                          size={12}
                          strokeWidth={3}
                          className="h-3 w-3"
                        />
                        View on {channel.name}
                      </a>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Link
              href={`/${orgId}/composer?group=${post.group}`}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              <MotionIcon icon={SquarePenIcon} className="h-4 w-4" />
              {locked ? 'Open' : 'Edit'}
            </Link>
            {canMove ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onReschedule(post)}
                disabled={busy}
              >
                <MotionIcon icon={CalendarClockIcon} className="h-4 w-4" />
                Reschedule
              </Button>
            ) : null}
            {canPublishNow ? (
              <Button size="sm" onClick={() => onPublishNow(post)} disabled={busy}>
                <MotionIcon icon={SendIcon} className="h-4 w-4" />
                {post.state === 'ERROR' ? 'Retry Now' : 'Post Now'}
              </Button>
            ) : null}
            {!locked ? (
              <Button
                size="sm"
                variant="danger"
                className="ms-auto"
                onClick={() => onDelete(post)}
                disabled={busy}
                aria-label="Delete Post"
              >
                <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
