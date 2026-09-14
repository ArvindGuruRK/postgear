'use client';

import {
  Button,
  buttonVariants,
  cn,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  SearchInput,
  Skeleton,
  Stack,
  Text,
  useToast,
  ViewSwitcher,
} from '@postgear/ui';
import { Film, Image as ImageIcon, LayoutGrid, PenSquare, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { MediaItem, MediaPage } from '@/types/media';
import { DeleteMediaDialog } from './delete-media-dialog';
import { MediaTile } from './media-tile';
import { MediaUploader } from './media-uploader';
import { type MediaFilter, useMediaList } from './use-media-list';

const FILTERS = [
  { value: 'all', label: 'All media', icon: LayoutGrid },
  { value: 'image', label: 'Images', icon: ImageIcon },
  { value: 'video', label: 'Videos', icon: Film },
];

/**
 * The media library: upload, find, reuse, delete.
 *
 * "Use in a post" opens a new composer with the file already attached — the
 * one-click insert the sprint asks for. The composer's own picker offers the
 * same library from the other direction.
 */
export function MediaLibrary({
  orgId,
  initialPage,
}: {
  orgId: string;
  initialPage: MediaPage | null;
}) {
  const list = useMediaList(initialPage);
  const { toast } = useToast();
  const [deleting, setDeleting] = useState<MediaItem | null>(null);

  const media = list.data?.media ?? [];
  const filtered = list.search.trim() !== '' || list.type !== 'all';

  return (
    <Stack gap="lg">
      <PageHeader
        title="Media"
        description="Every image and video uploaded to this workspace, ready to reuse in any post."
      />

      <MediaUploader
        onUploaded={(item) => {
          list.prepend(item);
          list.reload();
        }}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="sm:max-w-sm sm:flex-1">
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
        {list.data ? (
          <Text size="sm" muted className="sm:ms-auto" aria-live="polite">
            {list.data.total} {list.data.total === 1 ? 'file' : 'files'}
          </Text>
        ) : null}
      </div>

      {list.error ? (
        <ErrorState
          title="Media didn't load"
          description={list.error}
          action={{ label: 'Try again', onClick: list.reload }}
        />
      ) : list.loading && media.length === 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
            <Skeleton key={index} className="aspect-[3/4]" />
          ))}
        </div>
      ) : media.length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title={filtered ? 'Nothing matches' : 'No media yet'}
          description={
            filtered
              ? 'Try a different search or filter.'
              : 'Upload an image or video above and it will be here for every post.'
          }
        />
      ) : (
        <div
          className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
          aria-busy={list.loading}
        >
          {media.map((item) => (
            <MediaTile
              key={item.id}
              item={item}
              actions={
                <>
                  <Link
                    href={`/${orgId}/composer?media=${item.id}`}
                    className={cn(buttonVariants({ size: 'sm' }), 'flex-1 px-2')}
                  >
                    <PenSquare className="h-4 w-4" strokeWidth={2.5} />
                    Use in a post
                  </Link>
                  <Button
                    size="sm"
                    variant="danger"
                    className="w-9 px-0"
                    aria-label={`Delete ${item.name}`}
                    onClick={() => setDeleting(item)}
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={2.5} />
                  </Button>
                </>
              }
            />
          ))}
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

      <DeleteMediaDialog
        item={deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        onDeleted={(item) => {
          setDeleting(null);
          toast({ title: 'Deleted', description: item.name });
          list.reload();
        }}
      />
    </Stack>
  );
}
