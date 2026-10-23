'use client';

/**
 * The Media page's viewer (2026-10-23): one file large, with everything the
 * grid leaves out, and the arrow keys to walk the page.
 *
 * The file sits on the halftone stage, whole (`object-contain`), so a tall
 * story and a wide banner both show uncropped; a video plays with its own
 * controls. Beside it: the name, the details, where the file is used (asked
 * of the API each time, the same count the delete dialog states) and the
 * actions. Left and right step through the files on this page, and the
 * buttons on the stage do the same for a pointer.
 */
import { ChevronLeftIcon } from '@animateicons/react/lucide/chevron-left-icon';
import { ChevronRightIcon } from '@animateicons/react/lucide/chevron-right-icon';
import { CopyIcon } from '@animateicons/react/lucide/copy-icon';
import { ExternalLinkIcon } from '@animateicons/react/lucide/external-link-icon';
import { SquarePenIcon } from '@animateicons/react/lucide/square-pen-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import {
  Button,
  buttonVariants,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  MotionIcon,
  useToast,
} from '@postgear/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { MediaItem } from '@/types/media';
import { detailsOf, usageLine } from './media-details';

const STAGE_BUTTON =
  'absolute top-1/2 h-10 w-10 -translate-y-1/2 px-0 disabled:opacity-0 disabled:shadow-none';

export function MediaViewer({
  orgId,
  items,
  index,
  onIndexChange,
  onClose,
  onDelete,
}: {
  orgId: string;
  /** The files on this page, in grid order. */
  items: MediaItem[];
  /** The open file's place in `items`, or null when the viewer is closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onDelete: (item: MediaItem) => void;
}) {
  const { toast } = useToast();
  const item = index === null ? null : (items[index] ?? null);
  const id = item?.id ?? null;
  const [usage, setUsage] = useState<number | null>(null);

  useEffect(() => {
    setUsage(null);
    if (!id) return;

    let cancelled = false;
    api<{ posts: number }>(`/media/${id}/usage`)
      .then((result) => !cancelled && setUsage(result.posts))
      // The line is a nicety; without it the viewer still works.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [id]);

  const hasPrevious = index !== null && index > 0;
  const hasNext = index !== null && index < items.length - 1;

  function step(by: -1 | 1) {
    if (index === null) return;
    const next = index + by;
    if (next >= 0 && next < items.length) onIndexChange(next);
  }

  async function copyLink() {
    if (!item) return;
    try {
      await navigator.clipboard.writeText(item.url);
      toast({ title: 'Link copied', description: item.name });
    } catch {
      toast({ title: 'The link could not be copied', variant: 'danger' });
    }
  }

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0 md:grid md:grid-cols-[minmax(0,1fr)_20rem]"
        onKeyDown={(event) => {
          // Not while a video has focus: there the arrows seek.
          if (event.target instanceof HTMLVideoElement) return;
          if (event.key === 'ArrowLeft') step(-1);
          if (event.key === 'ArrowRight') step(1);
        }}
      >
        {item ? (
          <>
            <div className="relative flex min-h-64 items-center justify-center border-b-2 border-outline bg-halftone p-4 md:min-h-[min(70vh,40rem)] md:border-e-2 md:border-b-0 md:p-14">
              {item.type === 'image' ? (
                // biome-ignore lint/performance/noImgElement: media is served from the API's own origin or a bucket, not through Next's image optimizer
                <img
                  key={item.id}
                  src={item.url}
                  alt={item.name}
                  className="max-h-[45vh] max-w-full rounded-md border-2 border-outline object-contain shadow-surfaceMd md:max-h-[calc(100dvh-10rem)]"
                />
              ) : (
                // biome-ignore lint/a11y/useMediaCaption: user uploads carry no caption track
                <video
                  key={item.id}
                  src={item.url}
                  controls
                  playsInline
                  className="max-h-[45vh] max-w-full rounded-md border-2 border-outline bg-outline shadow-surfaceMd md:max-h-[calc(100dvh-10rem)]"
                />
              )}

              <Button
                variant="secondary"
                className={cn(STAGE_BUTTON, 'start-3')}
                onClick={() => step(-1)}
                disabled={!hasPrevious}
                aria-label="Previous File"
              >
                <MotionIcon icon={ChevronLeftIcon} className="h-5 w-5" />
              </Button>
              <Button
                variant="secondary"
                className={cn(STAGE_BUTTON, 'end-3')}
                onClick={() => step(1)}
                disabled={!hasNext}
                aria-label="Next File"
              >
                <MotionIcon icon={ChevronRightIcon} className="h-5 w-5" />
              </Button>
            </div>

            <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-5 pg-scrollbar pg-scrollbar-secondary md:p-6">
              <div className="flex flex-col gap-1.5 pe-8">
                <DialogTitle className="break-words text-xl">{item.name}</DialogTitle>
                <DialogDescription>
                  {index !== null ? `${index + 1} of ${items.length} on this page` : null}
                </DialogDescription>
              </div>

              <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 font-sans text-sm text-ink">
                {detailsOf(item).map((row) => (
                  <div key={row.label} className="contents">
                    <dt className="type-muted">{row.label}</dt>
                    <dd className="m-0 font-bold tabular-nums">{row.value}</dd>
                  </div>
                ))}
              </dl>

              <p className="m-0 rounded-md border-2 border-outline bg-chrome px-3 py-2 font-sans text-sm text-ink">
                {usage === null ? 'Checking where it is used…' : usageLine(usage)}
              </p>

              <div className="mt-auto flex flex-col gap-2">
                <Link
                  href={`/${orgId}/composer?media=${item.id}`}
                  className={cn(buttonVariants({ variant: 'primary' }), 'w-full')}
                >
                  <MotionIcon icon={SquarePenIcon} className="h-4 w-4" />
                  Use In A Post
                </Link>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" size="sm" onClick={() => void copyLink()}>
                    <MotionIcon icon={CopyIcon} className="h-4 w-4" />
                    Copy Link
                  </Button>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                  >
                    <MotionIcon icon={ExternalLinkIcon} className="h-4 w-4" />
                    Open Original
                  </a>
                </div>
                <Button variant="danger" size="sm" onClick={() => onDelete(item)}>
                  <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
                  Delete
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
