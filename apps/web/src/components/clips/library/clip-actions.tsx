'use client';

/**
 * What can be done to a clip from a list (Module 07, section 5): Rename in
 * place, Duplicate, Hide or Unhide, and Delete Clip behind a red confirm.
 * Module 17 adds Send To Composer (exported clips only) and View Post (one
 * live post opens straight away; several are listed in a small popover).
 * The video page's list and the Clips tab use the same menu and the same
 * calls, so they never drift.
 *
 * Every change goes under the clip's revision lock. When someone changed the
 * clip elsewhere first (409), the toast says so and the list is read again
 * so the next try uses the new revision.
 */
import { CopyIcon } from '@animateicons/react/lucide/copy-icon';
import { DownloadIcon } from '@animateicons/react/lucide/download-icon';
import { EllipsisVerticalIcon } from '@animateicons/react/lucide/ellipsis-vertical-icon';
import { EyeIcon } from '@animateicons/react/lucide/eye-icon';
import { EyeOffIcon } from '@animateicons/react/lucide/eye-off-icon';
import { ExternalLinkIcon } from '@animateicons/react/lucide/external-link-icon';
import { MessageCircleHeartIcon } from '@animateicons/react/lucide/message-circle-heart-icon';
import { PencilIcon } from '@animateicons/react/lucide/pencil-icon';
import { SendIcon } from '@animateicons/react/lucide/send-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  MotionIcon,
  Popover,
  PopoverAnchor,
  PopoverContent,
  toast,
} from '@postgear/ui';
import Link from 'next/link';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { PlatformIcon } from '@/components/platforms/platform-icon';
import { ApiError, downloadFile } from '@/lib/api';
import { deleteClip, duplicateClip, updateClip } from '@/lib/clips-api';
import type { ClipPublishedPost, ClipSummary, ClipView } from '@/types/clips';
import { emoteHrefFromPage } from '../emote/emote-model';

/**
 * Module 14: Make An Emote opens the Emote Maker on the clip's video and
 * range. The workspace (and, on the video page, the video) comes from the
 * page's address: the menu's list mounts only once opened, in the browser,
 * so reading it there never differs from the server's page. A library item
 * names its own video. No address to read (a test) means no item.
 */
function MakeEmoteItem({ clip }: { clip: ClipSummary }) {
  const href = emoteHrefFromPage(typeof window === 'undefined' ? '' : window.location.pathname, {
    clipId: clip.id,
    videoId: 'videoId' in clip && typeof clip.videoId === 'string' ? clip.videoId : null,
    range: clip.range,
  });
  if (!href) return null;
  return (
    <DropdownMenuItem asChild>
      <Link href={href} prefetch={false} data-testid="clip-make-emote">
        <MotionIcon icon={MessageCircleHeartIcon} className="h-4 w-4" />
        Make An Emote
      </Link>
    </DropdownMenuItem>
  );
}

export const MAX_CLIP_TITLE_LENGTH = 200;
export const DELETE_CLIP_SENTENCE =
  'Delete this clip? If it was exported, the file stays in Media.';
const UNREACHABLE = 'That did not go through. Check your connection and try again.';

/** The sentence for a failed clip call: the API's own, or the connection one. */
export function clipErrorSentence(cause: unknown): string {
  return cause instanceof ApiError && cause.status !== 0 ? cause.message : UNREACHABLE;
}

export interface ClipActions {
  rename: (clip: ClipSummary, title: string) => Promise<void>;
  duplicate: (clip: ClipSummary) => Promise<void>;
  toggleHidden: (clip: ClipSummary) => Promise<void>;
  remove: (clip: ClipSummary) => Promise<void>;
  /**
   * Module 17: opens Send To Composer for an exported clip. `from` is the
   * control focus goes back to when the dialog or the composer closes.
   */
  send?: (clip: ClipSummary, from: HTMLElement | null) => void;
}

/** A live post opened in a new tab, with nothing of ours handed to it. */
export function openPost(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** "18 Nov": when a live post went out, for the View Post list. */
export function postedDate(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? ''
    : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * The calls behind the menu. `onChanged` gets the new clip (or null after a
 * delete) so the caller can put it in place; `onStale` reads the list again
 * after a 409 or a 404.
 */
export function clipActions({
  onChanged,
  onAdded,
  onRemoved,
  onStale,
  send,
}: {
  onChanged: (clip: ClipView) => void;
  /** A duplicate: the new clip, and the one it was copied from (same range). */
  onAdded: (clip: ClipView, source: ClipSummary) => void;
  onRemoved: (clipId: string) => void;
  onStale: () => void;
  /** Module 17: Send To Composer, where the list hosts the dialog. */
  send?: ClipActions['send'];
}): ClipActions {
  const failed = (cause: unknown) => {
    toast({ title: clipErrorSentence(cause), variant: 'danger' });
    if (cause instanceof ApiError && (cause.status === 409 || cause.status === 404)) onStale();
  };
  return {
    send,
    rename: async (clip, title) => {
      const clean = title.replace(/\s+/g, ' ').trim().slice(0, MAX_CLIP_TITLE_LENGTH);
      if (clean === '' || clean === clip.title) return;
      try {
        onChanged(await updateClip(clip.id, clip.revision, { title: clean }));
      } catch (cause) {
        failed(cause);
      }
    },
    duplicate: async (clip) => {
      try {
        const copy = await duplicateClip(clip.id);
        onAdded(copy, clip);
        toast({ title: 'Clip duplicated.' });
      } catch (cause) {
        failed(cause);
      }
    },
    toggleHidden: async (clip) => {
      const hide = clip.state !== 'hidden';
      try {
        onChanged(await updateClip(clip.id, clip.revision, { status: hide ? 'HIDDEN' : 'DRAFT' }));
        toast({ title: hide ? 'Clip hidden.' : 'Clip shown again.' });
      } catch (cause) {
        failed(cause);
      }
    },
    remove: async (clip) => {
      try {
        const { message } = await deleteClip(clip.id);
        onRemoved(clip.id);
        toast({ title: message });
      } catch (cause) {
        failed(cause);
      }
    },
  };
}

/** A clip's name as a field: Enter or leaving it saves, Escape puts it back. */
export function RenameField({
  title,
  onSave,
  onDone,
  className,
}: {
  title: string;
  onSave: (title: string) => Promise<void>;
  onDone: () => void;
  className?: string;
}) {
  const [value, setValue] = useState(title);
  const [saving, setSaving] = useState(false);
  const field = useRef<HTMLInputElement | null>(null);
  const finished = useRef(false);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  const save = async () => {
    if (finished.current) return;
    finished.current = true;
    setSaving(true);
    try {
      await onSave(value);
    } finally {
      setSaving(false);
      onDone();
    }
  };

  return (
    <form
      className={cn('min-w-0', className)}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void save();
      }}
    >
      <Input
        ref={field}
        size="sm"
        aria-label="Clip name"
        value={value}
        maxLength={MAX_CLIP_TITLE_LENGTH}
        disabled={saving}
        placeholder="Enter your clip name"
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            finished.current = true;
            onDone();
          }
        }}
      />
    </form>
  );
}

/** The ghost menu beside a clip, and the red confirm its Delete Clip opens. */
/** The clip's last export from Media, named after the clip. */
export function downloadClipFile(mediaId: string, title: string): Promise<void> {
  return downloadFile(`/media/${encodeURIComponent(mediaId)}/download`, `${title}.mp4`);
}

export function ClipMenu({
  clip,
  actions,
  onStartRename,
  className,
}: {
  clip: ClipSummary;
  actions: ClipActions;
  onStartRename: () => void;
  className?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // Rename opens the name field once the menu has closed: while it is open its
  // focus trap pulls focus out of anything new, and on closing it would hand
  // focus back to its own button, so the field sat there unfocused (or blurred
  // and closed). Radix calls `onCloseAutoFocus` after the trap is gone, as the
  // composer's inserts use it.
  const renamePicked = useRef(false);
  // Send To Composer and View Post open their dialog or popover the same way,
  // once the menu has closed and focus is back on the menu's button.
  const nextPicked = useRef<'send' | 'posts' | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [postsOpen, setPostsOpen] = useState(false);
  const hidden = clip.state === 'hidden';
  const posts = clip.posts ?? [];
  const send = clip.exportedMediaId ? actions.send : undefined;

  return (
    <Popover open={postsOpen} onOpenChange={setPostsOpen}>
      <DropdownMenu>
        <PopoverAnchor asChild>
          <DropdownMenuTrigger asChild>
            <Button
              ref={trigger}
              variant="ghost"
              size="sm"
              aria-label={`More for ${clip.title}`}
              className={className}
            >
              <MotionIcon icon={EllipsisVerticalIcon} className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
        </PopoverAnchor>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            const next = nextPicked.current;
            nextPicked.current = null;
            if (next) {
              event.preventDefault();
              trigger.current?.focus({ preventScroll: true });
              if (next === 'send') send?.(clip, trigger.current);
              else setPostsOpen(true);
              return;
            }
            if (!renamePicked.current) return;
            renamePicked.current = false;
            event.preventDefault();
            onStartRename();
          }}
        >
          <DropdownMenuItem
            onSelect={() => {
              renamePicked.current = true;
            }}
          >
            <MotionIcon icon={PencilIcon} className="h-4 w-4" />
            Rename
          </DropdownMenuItem>
          {send ? (
            <DropdownMenuItem
              onSelect={() => {
                nextPicked.current = 'send';
              }}
            >
              <MotionIcon icon={SendIcon} className="h-4 w-4" />
              Send To Composer
            </DropdownMenuItem>
          ) : null}
          {posts.length > 0 ? (
            <DropdownMenuItem
              onSelect={() => {
                const only = posts.length === 1 ? posts[0] : undefined;
                if (only) openPost(only.url);
                else nextPicked.current = 'posts';
              }}
            >
              <MotionIcon icon={ExternalLinkIcon} className="h-4 w-4" />
              View Post
            </DropdownMenuItem>
          ) : null}
          {clip.exportedMediaId ? (
            <DropdownMenuItem
              onSelect={() => {
                const mediaId = clip.exportedMediaId;
                if (mediaId) void downloadClipFile(mediaId, clip.title).catch(() => undefined);
              }}
            >
              <MotionIcon icon={DownloadIcon} className="h-4 w-4" />
              Download
            </DropdownMenuItem>
          ) : null}
          <MakeEmoteItem clip={clip} />
          <DropdownMenuItem onSelect={() => void actions.duplicate(clip)}>
            <MotionIcon icon={CopyIcon} className="h-4 w-4" />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void actions.toggleHidden(clip)}>
            <MotionIcon icon={hidden ? EyeIcon : EyeOffIcon} className="h-4 w-4" />
            {hidden ? 'Unhide' : 'Hide'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfirming(true)}>
            <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
            Delete Clip
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <PopoverContent align="end" className="w-72 p-2" data-testid="clip-posts">
        <PostList posts={posts} onPicked={() => setPostsOpen(false)} />
      </PopoverContent>

      <AlertDialog open={confirming} onOpenChange={(open) => !busy && setConfirming(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Clip</AlertDialogTitle>
            <AlertDialogDescription>{DELETE_CLIP_SENTENCE}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                setBusy(true);
                void actions.remove(clip).finally(() => {
                  setBusy(false);
                  setConfirming(false);
                });
              }}
            >
              {busy ? 'Deleting' : 'Delete Clip'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Popover>
  );
}

/** The live posts of a clip sent more than once: each opens in a new tab. */
function PostList({
  posts,
  onPicked,
}: {
  posts: readonly ClipPublishedPost[];
  onPicked: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="m-0 px-2 pt-1 pb-1.5 font-sans text-xs text-ink type-label">Posts</p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {posts.map((post) => (
          <li key={post.url}>
            <a
              href={post.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onPicked}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 font-sans text-sm text-ink type-ui hover:bg-inset focus-visible:outline-2 focus-visible:outline-actionPrimary"
            >
              <PlatformIcon platform={post.providerIdentifier} className="h-4 w-4" />
              <span className="min-w-0 flex-1 truncate">{post.channelName}</span>
              <span className="shrink-0 text-xs type-muted">{postedDate(post.publishedAt)}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The state as a badge: New, Draft, Exported, Scheduled, Hidden. */
export const CLIP_STATE_NAMES: Readonly<Record<ClipSummary['state'], string>> = Object.freeze({
  new: 'New',
  draft: 'Draft',
  exported: 'Exported',
  scheduled: 'Scheduled',
  hidden: 'Hidden',
});

export const CLIP_STATE_BADGE: Readonly<
  Record<ClipSummary['state'], 'primary' | 'secondary' | 'success' | 'accent' | 'outline'>
> = Object.freeze({
  new: 'primary',
  draft: 'secondary',
  exported: 'success',
  scheduled: 'accent',
  hidden: 'outline',
});
