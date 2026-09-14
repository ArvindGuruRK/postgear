'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Pagination,
  SearchInput,
  Skeleton,
  Stack,
  ViewSwitcher,
} from '@postgear/ui';
import { Film, Image as ImageIcon, LayoutGrid } from 'lucide-react';
import { useState } from 'react';
import { MediaTile } from '@/components/media/media-tile';
import { MediaUploader } from '@/components/media/media-uploader';
import { type MediaFilter, useMediaList } from '@/components/media/use-media-list';
import type { MediaItem } from '@/types/media';

const FILTERS = [
  { value: 'all', label: 'All media', icon: LayoutGrid },
  { value: 'image', label: 'Images', icon: ImageIcon },
  { value: 'video', label: 'Videos', icon: Film },
];

/**
 * Attach media to one part of a post, from the library or a fresh upload.
 *
 * The same library, grid and uploader as the Media page, so an image uploaded
 * here is in the library afterwards and reusable in any other post — which is
 * the point of a library. A fresh upload is selected automatically: the person
 * uploaded it in order to attach it.
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
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto pg-scrollbar pg-scrollbar-secondary">
        <DialogHeader>
          <DialogTitle>Add media</DialogTitle>
          <DialogDescription>Choose from the library, or upload something new.</DialogDescription>
        </DialogHeader>
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
  const media = list.data?.media ?? [];

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
    <Stack gap="md">
      <MediaUploader
        compact
        onUploaded={(item) => {
          list.prepend(item);
          setSelected((current) => (current.length >= remaining ? current : [...current, item]));
        }}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="sm:flex-1">
          <SearchInput
            value={list.search}
            onChange={(event) => list.setSearch(event.target.value)}
            onClear={() => list.setSearch('')}
            placeholder="Search by file name"
            aria-label="Search media"
          />
        </div>
        <ViewSwitcher
          options={FILTERS}
          value={list.type}
          onValueChange={(value) => list.setType(value as MediaFilter)}
        />
      </div>

      {list.error ? (
        <ErrorState
          title="Media didn't load"
          description={list.error}
          action={{ label: 'Try again', onClick: list.reload }}
        />
      ) : list.loading && media.length === 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
            <Skeleton key={index} className="aspect-[3/4]" />
          ))}
        </div>
      ) : media.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title="The library is empty"
          description="Upload an image or video above to attach it."
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-busy={list.loading}>
          {media.map((item) => {
            const attached = alreadyAttached.includes(item.id);
            return attached ? (
              <div key={item.id} className="opacity-50" title="Already attached to this part">
                <MediaTile item={item} selected />
              </div>
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

      <DialogFooter className="items-center gap-3">
        <span className="me-auto font-sans text-xs font-medium text-ink opacity-70">
          {remaining <= 0
            ? 'This part already has as many attachments as a post can take.'
            : `${selected.length} selected · up to ${remaining} more`}
        </span>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => onAttach(selected)} disabled={selected.length === 0}>
          Attach {selected.length > 0 ? selected.length : ''}
        </Button>
      </DialogFooter>
    </Stack>
  );
}
