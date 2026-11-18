'use client';

/**
 * The Uploaded tab (Module 12 section 5): the workspace's own stickers.
 *
 * Upload A Sticker sends a PNG, GIF or WebP; it shows as Checking at once
 * and becomes a tile when ready. A file we cannot use is refused with one
 * sentence. Pressing a ready one adds it at the playhead; its menu has
 * Delete Sticker, which asks first and is refused (with the sentence) while
 * a clip uses it.
 */
import { EllipsisIcon } from '@animateicons/react/lucide/ellipsis-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import { UploadIcon } from '@animateicons/react/lucide/upload-icon';
import {
  Alert,
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
  DropdownMenuTrigger,
  EmptyState,
  MotionIcon,
  Spinner,
} from '@postgear/ui';
import type { StickerUploadView } from '@postgear/video-engine';
import { ImageUp, TriangleAlert } from 'lucide-react';
import { useRef, useState } from 'react';
import { NOTE } from '@/components/studio/panel-ui';
import { CHECKING, UPLOAD_NOTE, UPLOADS_EMPTY } from './elements-model';
import { CHECKER, TilePicture } from './sticker-tiles';
import type { StickerUploads } from './use-sticker-library';

export const DELETE_STICKER_SENTENCE =
  'It leaves your workspace for good. A clip that still uses it has to drop it first.';

const ACCEPT = 'image/png,image/gif,image/webp';

export function UploadedStickers({
  uploads,
  onAdd,
}: {
  uploads: StickerUploads;
  onAdd: (sticker: StickerUploadView) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<StickerUploadView | null>(null);
  const [busy, setBusy] = useState(false);
  const empty = !uploads.loading && uploads.stickers.length === 0 && uploads.sending.length === 0;

  return (
    <div className="flex flex-col gap-3" data-testid="clip-uploaded-stickers">
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        data-testid="clip-sticker-file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void uploads.upload(file);
        }}
      />
      <Button variant="secondary" className="w-full" onClick={() => input.current?.click()}>
        <MotionIcon icon={UploadIcon} className="h-4 w-4" />
        Upload A Sticker
      </Button>
      <p className={NOTE}>{UPLOAD_NOTE}</p>

      {uploads.error ? (
        <Alert variant="danger" className="items-center" data-testid="clip-sticker-refused">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{uploads.error}</p>
        </Alert>
      ) : null}

      {empty ? <EmptyState icon={ImageUp} title={UPLOADS_EMPTY} /> : null}
      {uploads.loading && uploads.stickers.length === 0 ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : null}

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {uploads.sending.map((row) => (
          <li
            key={row.id}
            className="flex items-center gap-3 rounded-md border-2 border-outline bg-inset p-2"
          >
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm"
              style={CHECKER}
            >
              <Spinner size="sm" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-sans text-sm text-ink type-ui">{row.name}</span>
              <span className="font-sans text-xs text-ink type-muted">{CHECKING}</span>
            </span>
          </li>
        ))}
        {uploads.stickers.map((sticker) => {
          const ready = sticker.status === 'ready' && sticker.fileUrl;
          const picture = sticker.previewUrl ?? sticker.fileUrl;
          return (
            <li
              key={sticker.id}
              className="flex items-center gap-1 rounded-md border-2 border-outline bg-inset p-1"
              data-testid="clip-uploaded-row"
            >
              <button
                type="button"
                disabled={!ready}
                aria-label={ready ? `Add ${sticker.name}` : undefined}
                onClick={() => ready && onAdd(sticker)}
                className={cn(
                  'flex min-w-0 flex-1 items-center gap-3 rounded-sm p-1 text-left',
                  'outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-focusRing',
                  ready ? 'hover:bg-secondary' : 'cursor-default',
                )}
              >
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-sm"
                  style={CHECKER}
                >
                  {sticker.status === 'checking' ? (
                    <Spinner size="sm" />
                  ) : picture ? (
                    <TilePicture
                      src={picture}
                      animated={sticker.kind === 'animated'}
                      playing={false}
                    />
                  ) : null}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-sans text-sm text-ink type-ui">
                    {sticker.name}
                  </span>
                  {sticker.status === 'checking' ? (
                    <span className="font-sans text-xs text-ink type-muted">{CHECKING}</span>
                  ) : sticker.status === 'failed' ? (
                    <span className="font-sans text-xs text-dangerInk">{sticker.error}</span>
                  ) : null}
                </span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-9 shrink-0 px-0"
                    aria-label={`More For ${sticker.name}`}
                  >
                    <MotionIcon icon={EllipsisIcon} className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setDeleting(sticker)}>
                    <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
                    Delete Sticker
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ul>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !busy && !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Sticker</AlertDialogTitle>
            <AlertDialogDescription>{DELETE_STICKER_SENTENCE}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                const target = deleting;
                if (!target) return;
                setBusy(true);
                void uploads.remove(target.id).finally(() => {
                  setBusy(false);
                  setDeleting(null);
                });
              }}
            >
              {busy ? 'Deleting' : 'Delete Sticker'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
