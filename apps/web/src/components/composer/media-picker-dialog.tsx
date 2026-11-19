'use client';

import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  EmptyState,
  ErrorState,
  MotionIcon,
  Pagination,
  SearchInput,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TooltipHint,
} from '@postgear/ui';
import { Image as ImageIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  IMAGE_ACCEPT,
  preflightImage,
  preflightUpload,
  UPLOAD_ACCEPT,
} from '@/components/media/media-limits';
import { MediaTile } from '@/components/media/media-tile';
import { UploadRows, useMediaUpload } from '@/components/media/media-uploader';
import { useMediaList } from '@/components/media/use-media-list';
import { api } from '@/lib/api';
import type { ClipListItem } from '@/types/clips';
import type { MediaItem } from '@/types/media';
import { ClipPickerPane } from './clip-picker';
import { CLIP_PICKER_ATTACH_FAILED, CLIP_PICKER_TITLE } from './clip-picker-model';

type PickerTab = 'media' | 'clips';

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
 *
 * Studio (Sprint 9) opens the same library to fill a picture or a logo:
 * `single` makes a click replace the choice rather than add to it, and
 * `imagesOnly` lists and accepts images alone, since a slide cannot hold a
 * video.
 *
 * The composer also passes `clips` (Sprint 12, Module 17): a second tab,
 * Select A Clip, lists the workspace's exported clips; picking one attaches
 * its exported file exactly as a Media pick would.
 */
export function MediaPickerDialog({
  open,
  onOpenChange,
  alreadyAttached = [],
  remaining = 1,
  onAttach,
  single = false,
  imagesOnly = false,
  title = 'Media Library',
  description = 'Choose media from the library to add to this part of the post, or upload new files.',
  confirmLabel = 'Add Selected Media',
  clips,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ids already on the part, shown as selected and not attached twice. */
  alreadyAttached?: string[];
  /** How many more attachments the part can take. */
  remaining?: number;
  onAttach: (media: MediaItem[]) => void;
  /** One item at most: choosing another replaces the choice. */
  single?: boolean;
  imagesOnly?: boolean;
  title?: string;
  /** Read by screen readers only. */
  description?: string;
  confirmLabel?: string;
  /** The Clips tab (the composer only): the workspace whose exported clips it lists. */
  clips?: { orgId: string };
}) {
  const [tab, setTab] = useState<PickerTab>('media');
  // Each opening starts on the library.
  useEffect(() => {
    if (open) setTab('media');
  }, [open]);
  const onClips = clips !== undefined && tab === 'clips';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-5xl flex-col gap-0 p-0">
        <div className="flex flex-col gap-1 px-6 pt-6 pb-4 pe-14">
          <DialogTitle>{onClips ? CLIP_PICKER_TITLE : title}</DialogTitle>
          <DialogDescription className="sr-only">
            {onClips
              ? 'Choose an exported clip to add its video to this part of the post.'
              : description}
          </DialogDescription>
        </div>
        {/* Mounted only while open, so each opening starts from a fresh library page and selection. */}
        {open ? (
          <PickerBody
            alreadyAttached={alreadyAttached}
            remaining={single ? 1 : remaining}
            single={single}
            imagesOnly={imagesOnly}
            confirmLabel={confirmLabel}
            clipsOrgId={clips?.orgId ?? null}
            tab={tab}
            onTab={setTab}
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
  single,
  imagesOnly,
  confirmLabel,
  clipsOrgId,
  tab,
  onTab,
  onCancel,
  onAttach,
}: {
  alreadyAttached: string[];
  remaining: number;
  single: boolean;
  imagesOnly: boolean;
  confirmLabel: string;
  clipsOrgId: string | null;
  tab: PickerTab;
  onTab: (tab: PickerTab) => void;
  onCancel: () => void;
  onAttach: (media: MediaItem[]) => void;
}) {
  const list = useMediaList(null, '', imagesOnly ? 'image' : 'all');
  const [selected, setSelected] = useState<MediaItem[]>([]);
  // Module 17: clips picked on the Clips tab, attached as their exported files.
  const [selectedClips, setSelectedClips] = useState<ClipListItem[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const media = list.data?.media ?? [];
  const chosen = selected.length + selectedClips.length;

  const { rows, upload } = useMediaUpload(
    (item) => {
      // The server decides what a file is; one that turned out to be a video
      // is in the library, but has no place in an images-only list.
      if (imagesOnly && item.type !== 'image') return;
      list.prepend(item);
      if (single) setSelectedClips([]);
      setSelected((current) =>
        single
          ? [item]
          : current.length + selectedClips.length >= remaining
            ? current
            : [...current, item],
      );
    },
    imagesOnly ? preflightImage : preflightUpload,
  );

  function toggle(item: MediaItem) {
    if (single) setSelectedClips([]);
    setSelected((current) =>
      current.some((entry) => entry.id === item.id)
        ? current.filter((entry) => entry.id !== item.id)
        : single
          ? [item]
          : current.length + selectedClips.length >= remaining
            ? current
            : [...current, item],
    );
  }

  function toggleClip(clip: ClipListItem) {
    if (single) setSelected([]);
    setAttachError(null);
    setSelectedClips((current) =>
      current.some((entry) => entry.id === clip.id)
        ? current.filter((entry) => entry.id !== clip.id)
        : single
          ? [clip]
          : current.length + selected.length >= remaining
            ? current
            : [...current, clip],
    );
  }

  // A picked clip is its exported Media row, read whole so the composer's
  // rules and previews see it exactly as a library pick.
  async function attach() {
    if (selectedClips.length === 0) {
      onAttach(selected);
      return;
    }
    setAttaching(true);
    setAttachError(null);
    try {
      const files = await Promise.all(
        selectedClips.map(async (clip) => {
          if (!clip.exportedMediaId) throw new Error('no export');
          const answer = await api<{ media: MediaItem }>(
            `/media/${encodeURIComponent(clip.exportedMediaId)}`,
          );
          return answer.media;
        }),
      );
      onAttach([...selected, ...files]);
    } catch {
      setAttachError(CLIP_PICKER_ATTACH_FAILED);
      setAttaching(false);
    }
  }

  const footerLine = attachError
    ? attachError
    : single
      ? selected[0]
        ? `${selected[0].name} selected`
        : selectedClips[0]
          ? `${selectedClips[0].title} selected`
          : imagesOnly
            ? 'Select an image'
            : 'Select one item'
      : remaining <= 0
        ? 'This part already has as many attachments as a post can take.'
        : chosen > 0
          ? `${chosen} selected, up to ${remaining}`
          : `Select up to ${remaining}`;

  const library = (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6 pg-scrollbar pg-scrollbar-secondary">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <SearchInput
            value={list.search}
            onChange={(event) => list.setSearch(event.target.value)}
            onClear={() => list.setSearch('')}
            placeholder="Enter your search"
            aria-label="Search media"
          />
        </div>
        <TooltipHint
          label={
            imagesOnly
              ? 'Images up to 20 MB. They are resized and compressed.'
              : 'Images up to 20 MB, video up to 250 MB. Images are resized and compressed.'
          }
          side="bottom"
          align="end"
        >
          <Button variant="secondary" onClick={() => fileInput.current?.click()}>
            <MotionIcon icon={PlusIcon} className="h-4 w-4" />
            Upload
          </Button>
        </TooltipHint>
        <input
          ref={fileInput}
          type="file"
          accept={imagesOnly ? IMAGE_ACCEPT : UPLOAD_ACCEPT}
          multiple={!single}
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
          action={{ label: 'Try Again', onClick: list.reload }}
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
          title={
            list.search
              ? 'Nothing matches that name'
              : imagesOnly
                ? 'The library has no images yet'
                : 'The library is empty'
          }
          description={
            list.search
              ? 'Try another file name.'
              : imagesOnly
                ? 'Upload an image to use it here.'
                : 'Upload an image or video to attach it.'
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
  );

  return (
    <>
      {clipsOrgId ? (
        <Tabs
          value={tab}
          onValueChange={(value) => onTab(value === 'clips' ? 'clips' : 'media')}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="px-6 pb-4">
            <TabsList aria-label="Where From">
              <TabsTrigger value="media">Media Library</TabsTrigger>
              <TabsTrigger value="clips">Clips</TabsTrigger>
            </TabsList>
          </div>
          {/* Both stay mounted, so each keeps its page, search and choice across a switch. */}
          <TabsContent
            value="media"
            forceMount
            className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
          >
            {library}
          </TabsContent>
          <TabsContent
            value="clips"
            forceMount
            className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6 pg-scrollbar pg-scrollbar-secondary">
              <ClipPickerPane
                orgId={clipsOrgId}
                imagesOnly={imagesOnly}
                attached={alreadyAttached}
                selected={selectedClips}
                onToggle={toggleClip}
              />
            </div>
          </TabsContent>
        </Tabs>
      ) : (
        library
      )}

      <div className="flex shrink-0 flex-wrap items-center gap-3 border-t-2 border-outline px-6 py-4">
        <span
          className="me-auto min-w-0 truncate font-sans text-xs text-ink opacity-70"
          role={attachError ? 'alert' : undefined}
        >
          {footerLine}
        </span>
        <Button variant="secondary" onClick={onCancel} disabled={attaching}>
          Cancel
        </Button>
        <Button onClick={() => void attach()} disabled={chosen === 0 || attaching}>
          {attaching ? 'Adding' : confirmLabel}
        </Button>
      </div>
    </>
  );
}
