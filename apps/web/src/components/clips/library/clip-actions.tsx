'use client';

/**
 * What can be done to a clip from a list (Module 07, section 5): Rename in
 * place, Duplicate, Hide or Unhide, and Delete Clip behind a red confirm.
 * The video page's list and the Clips tab use the same menu and the same
 * calls, so they never drift.
 *
 * Every change goes under the clip's revision lock. When someone changed the
 * clip elsewhere first (409), the toast says so and the list is read again
 * so the next try uses the new revision.
 */
import { CopyIcon } from '@animateicons/react/lucide/copy-icon';
import { EllipsisVerticalIcon } from '@animateicons/react/lucide/ellipsis-vertical-icon';
import { EyeIcon } from '@animateicons/react/lucide/eye-icon';
import { EyeOffIcon } from '@animateicons/react/lucide/eye-off-icon';
import { PencilIcon } from '@animateicons/react/lucide/pencil-icon';
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
  toast,
} from '@postgear/ui';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { deleteClip, duplicateClip, updateClip } from '@/lib/clips-api';
import type { ClipSummary, ClipView } from '@/types/clips';

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
}: {
  onChanged: (clip: ClipView) => void;
  /** A duplicate: the new clip, and the one it was copied from (same range). */
  onAdded: (clip: ClipView, source: ClipSummary) => void;
  onRemoved: (clipId: string) => void;
  onStale: () => void;
}): ClipActions {
  const failed = (cause: unknown) => {
    toast({ title: clipErrorSentence(cause), variant: 'danger' });
    if (cause instanceof ApiError && (cause.status === 409 || cause.status === 404)) onStale();
  };
  return {
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
  const hidden = clip.state === 'hidden';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`More for ${clip.title}`}
            className={className}
          >
            <MotionIcon icon={EllipsisVerticalIcon} className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
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
    </>
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
