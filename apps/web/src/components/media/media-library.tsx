'use client';

/**
 * The media library: upload, find, look closer, reuse, delete (revamped
 * 2026-10-23).
 *
 * The drop box opens the page, blue and plain ("Drop Files To Upload", and
 * a click picks files too), and the whole page takes a drop (`usePageDrop`):
 * while files are dragged anywhere over it, the box's border turns solid.
 * Then the search with the icon switch for the type, and the grid.
 * A tile opens the viewer (`MediaViewer`), which the arrow keys walk through.
 *
 * "Use In A Post" opens a new composer with the file already attached; the
 * composer's own picker offers the same library from the other direction.
 */
import { ImageIcon as AnimatedImageIcon } from '@animateicons/react/lucide/image-icon';
import { LayoutGridIcon } from '@animateicons/react/lucide/layout-grid-icon';
import { VideoIcon } from '@animateicons/react/lucide/video-icon';
import {
  Button,
  cn,
  EmptyState,
  ErrorState,
  FileUpload,
  Pagination,
  SearchInput,
  Skeleton,
  Stack,
  Text,
  useToast,
  ViewSwitcher,
} from '@postgear/ui';
import { ImagePlus, Search } from 'lucide-react';
import { useState } from 'react';
import type { MediaItem, MediaPage } from '@/types/media';
import { DeleteMediaDialog } from './delete-media-dialog';
import { LibraryTile } from './library-tile';
import { UPLOAD_ACCEPT } from './media-limits';
import { UploadRows, useMediaUpload } from './media-uploader';
import { MediaViewer } from './media-viewer';
import { type MediaFilter, useMediaList } from './use-media-list';
import { usePageDrop } from './use-page-drop';

const FILTERS = [
  { value: 'all', label: 'All Media', animatedIcon: LayoutGridIcon },
  { value: 'image', label: 'Images', animatedIcon: AnimatedImageIcon },
  { value: 'video', label: 'Videos', animatedIcon: VideoIcon },
];

const GRID = 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6';

export function MediaLibrary({
  orgId,
  initialPage,
  initialSearch = '',
}: {
  orgId: string;
  initialPage: MediaPage | null;
  /** The word the page was opened with (`?search=`, from the top bar's search). */
  initialSearch?: string;
}) {
  const list = useMediaList(initialPage, initialSearch);
  const { toast } = useToast();
  const [deleting, setDeleting] = useState<MediaItem | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);

  const { rows, upload, clear } = useMediaUpload((item) => {
    list.prepend(item);
    list.reload();
  });
  const dragging = usePageDrop((files) => void upload(files));

  const media = list.data?.media ?? [];
  const filtered = list.search.trim() !== '' || list.type !== 'all';
  const finished = rows.some((row) => row.status === 'done' || row.status === 'failed');

  return (
    <Stack gap="lg">
      <FileUpload
        accept={UPLOAD_ACCEPT}
        multiple
        onFilesSelected={(files) => void upload(files)}
        active={dragging}
        label="Drop Files To Upload"
        helperText="or click to upload"
      />

      {rows.length > 0 ? (
        <section aria-label="Uploads" className="flex flex-col gap-2">
          {finished ? (
            <div className="flex justify-end">
              <Button variant="secondary" size="sm" onClick={clear}>
                Clear Finished
              </Button>
            </div>
          ) : null}
          <div className="[&>ul]:grid [&>ul]:gap-2 sm:[&>ul]:grid-cols-2 xl:[&>ul]:grid-cols-3">
            <UploadRows rows={rows} />
          </div>
        </section>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="sm:max-w-sm sm:flex-1">
          <SearchInput
            value={list.search}
            onChange={(event) => list.setSearch(event.target.value)}
            onClear={() => list.setSearch('')}
            placeholder="Enter your search"
            aria-label="Search media"
            className="shadow-none"
          />
        </div>
        <ViewSwitcher
          options={FILTERS}
          value={list.type}
          onValueChange={(value) => list.setType(value as MediaFilter)}
          className="shadow-none"
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
          action={{ label: 'Try Again', onClick: list.reload }}
        />
      ) : list.loading && media.length === 0 ? (
        <div role="status" className={GRID} aria-busy="true" aria-label="Loading media">
          {Array.from({ length: 10 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
            <Skeleton key={index} className="aspect-[4/5]" />
          ))}
        </div>
      ) : media.length === 0 ? (
        <EmptyState
          icon={filtered ? Search : ImagePlus}
          title={filtered ? 'Nothing matches' : 'No media yet'}
          description={
            filtered
              ? 'Try a different search or filter.'
              : 'Upload an image or video above and it is ready for every post.'
          }
        />
      ) : (
        <ul className={cn(GRID, 'm-0 list-none p-0')} aria-busy={list.loading}>
          {media.map((item, index) => (
            <LibraryTile
              key={item.id}
              orgId={orgId}
              item={item}
              onOpen={() => setViewing(index)}
              onDelete={setDeleting}
            />
          ))}
        </ul>
      )}

      {list.data && list.data.pageCount > 1 ? (
        <Pagination
          page={list.page}
          pageCount={list.data.pageCount}
          onPageChange={list.setPage}
          className="justify-center"
        />
      ) : null}

      <MediaViewer
        orgId={orgId}
        items={media}
        index={viewing}
        onIndexChange={setViewing}
        onClose={() => setViewing(null)}
        onDelete={setDeleting}
      />

      <DeleteMediaDialog
        item={deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        onDeleted={(item) => {
          setDeleting(null);
          setViewing(null);
          list.remove(item);
          toast({ title: 'Deleted', description: item.name });
          list.reload();
        }}
      />
    </Stack>
  );
}
