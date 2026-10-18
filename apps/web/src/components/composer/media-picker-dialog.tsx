'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  EmptyState,
  ErrorState,
  Pagination,
  SearchInput,
  Skeleton,
  TooltipHint,
} from '@postgear/ui';
import { Image as ImageIcon, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { UPLOAD_ACCEPT } from '@/components/media/media-limits';
import { MediaTile } from '@/components/media/media-tile';
import { UploadRows, useMediaUpload } from '@/components/media/media-uploader';
import { useMediaList } from '@/components/media/use-media-list';
import type { MediaItem } from '@/types/media';

/**
 * The Media Library, opened from a post part's "Insert Media" (UI revamp,
 * 2026-10-19, after the reference's media modal): search by file name with
 * Upload beside it, the library as a grid, and Cancel / "Add selected media"
 * at the foot.
 *
 * The same library as the Media page, so an image uploaded here is in the
 * library afterwards and reusable in any other post, which is the point of a
 * library. A fresh upload is selected automatically: the person uploaded it in
 * order to attach it.
 */
export function MediaPickerDialog({
  open,
  onOpenChange,
  alreadyAttached,
  remaining,
  onAttach,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ids already on the part, shown as selected and not attached twice. */
  alreadyAttached: string[];
  /** How many more attachments the part can take. */
  remaining: number;
  onAttach: (media: MediaItem[]) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-5xl flex-col gap-0 p-0">
        <div className="flex flex-col gap-1 px-6 pt-6 pb-4 pe-14">
          <DialogTitle>Media Library</DialogTitle>
          <DialogDescription className="sr-only">
            Choose media from the library to add to this part of the post, or upload new files.
          </DialogDescription>
        </div>
        {/* Mounted only while open, so each opening starts from a fresh library page and selection. */}
        {open ? (
          <PickerBody
            alreadyAttached={alreadyAttached}
            remaining={remaining}
            onCancel={() => onOpenChange(false)}
            onAttach={(media) => {
              onAttach(media);
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PickerBody({
  alreadyAttached,
  remaining,
  onCancel,
  onAttach,
}: {
  alreadyAttached: string[];
  remaining: number;
  onCancel: () => void;
  onAttach: (media: MediaItem[]) => void;
}) {
  const list = useMediaList();
  const [selected, setSelected] = useState<MediaItem[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const media = list.data?.media ?? [];

  const { rows, upload } = useMediaUpload((item) => {
    list.prepend(item);
    setSelected((current) => (current.length >= remaining ? current : [...current, item]));
  });

  function toggle(item: MediaItem) {
    setSelected((current) =>
      current.some((entry) => entry.id === item.id)
        ? current.filter((entry) => entry.id !== item.id)
        : current.length >= remaining
          ? current
          : [...current, item],
    );
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6 pg-scrollbar pg-scrollbar-secondary">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <SearchInput
              value={list.search}
              onChange={(event) => list.setSearch(event.target.value)}
              onClear={() => list.setSearch('')}
              placeholder="Search by file name"
              aria-label="Search media"
            />
          </div>
          <TooltipHint
            label="Images up to 20 MB, video up to 250 MB. Images are resized and compressed."
            side="bottom"
            align="end"
          >
            <Button variant="secondary" onClick={() => fileInput.current?.click()}>
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              Upload
            </Button>
          </TooltipHint>
          <input
            ref={fileInput}
            type="file"
            accept={UPLOAD_ACCEPT}
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-label="Upload files"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              // Cleared, so choosing the same file again still uploads it.
              event.target.value = '';
              if (files.length > 0) {
                void upload(files);
              }
            }}
          />
        </div>

        <UploadRows rows={rows} />

        {list.error ? (
          <ErrorState
            title="Media didn't load"
            description={list.error}
            action={{ label: 'Try again', onClick: list.reload }}
          />
        ) : list.loading && media.length === 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
              <Skeleton key={index} className="aspect-[3/4]" />
            ))}
          </div>
        ) : media.length === 0 ? (
          <EmptyState
            icon={ImageIcon}
            title={list.search ? 'Nothing matches that name' : 'The library is empty'}
            description={
              list.search ? 'Try another file name.' : 'Upload an image or video to attach it.'
            }
          />
        ) : (
          <div
            className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
            aria-busy={list.loading}
          >
            {media.map((item) => {
              const attached = alreadyAttached.includes(item.id);
              return attached ? (
                <TooltipHint key={item.id} label="Already attached to this part">
                  <div className="opacity-50">
                    <MediaTile item={item} selected />
                  </div>
                </TooltipHint>
              ) : (
                <MediaTile
                  key={item.id}
                  item={item}
                  selected={selected.some((entry) => entry.id === item.id)}
                  onToggle={toggle}
                />
              );
            })}
          </div>
        )}

        {list.data && list.data.pageCount > 1 ? (
          <Pagination
            page={list.page}
            pageCount={list.data.pageCount}
            onPageChange={list.setPage}
            className="justify-center"
          />
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3 border-t-2 border-outline px-6 py-4">
        <span className="me-auto font-sans text-xs text-ink opacity-70">
          {remaining <= 0
            ? 'This part already has as many attachments as a post can take.'
            : selected.length > 0
              ? `${selected.length} selected, up to ${remaining}`
              : `Select up to ${remaining}`}
        </span>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => onAttach(selected)} disabled={selected.length === 0}>
          Add selected media
        </Button>
      </div>
    </>
  );
}
