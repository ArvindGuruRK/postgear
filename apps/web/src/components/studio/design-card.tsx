'use client';

/**
 * One design in the Recent Designs grid (DS-1.3).
 *
 * The first slide is drawn by the real renderer on a small stage, so a card
 * shows the design as it is now, in its own fonts and colours. Under it the
 * title, the format and status badges, the slide count and when it changed.
 * The card opens the editor (which lands on the slide last edited); the
 * corner menu holds Open, Duplicate, Rename and Delete, a sibling of the
 * link so each is its own tab stop.
 */
import { CopyIcon } from '@animateicons/react/lucide/copy-icon';
import { EllipsisVerticalIcon } from '@animateicons/react/lucide/ellipsis-vertical-icon';
import { PencilIcon } from '@animateicons/react/lucide/pencil-icon';
import { SquarePenIcon } from '@animateicons/react/lucide/square-pen-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import { FORMATS } from '@postgear/design-engine';
import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MotionIcon,
} from '@postgear/ui';
import { ImageOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import type { DesignSummary } from '@/types/studio';
import { SlideFrame } from './slide-frame';
import {
  formatName,
  mediaResolver,
  STATUS_BADGES,
  slideCountLabel,
  updatedLabel,
} from './studio-view-model';

export const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

export function DesignCard({
  orgId,
  design,
  now,
  busy,
  onDuplicate,
  onRename,
  onDelete,
}: {
  orgId: string;
  design: DesignSummary;
  /** One clock for the whole grid, so every card's "Updated" agrees; null while hydrating. */
  now: Date | null;
  /** A duplicate of this design is being made. */
  busy: boolean;
  onDuplicate: (design: DesignSummary) => void;
  onRename: (design: DesignSummary) => void;
  onDelete: (design: DesignSummary) => void;
}) {
  const router = useRouter();
  const href = `/${orgId}/studio/${design.id}`;
  const status = STATUS_BADGES[design.status];
  const resolve = useMemo(() => mediaResolver(design.coverMedia, 'thumbnail'), [design.coverMedia]);

  return (
    <li data-testid="design-card" className="group relative min-w-0">
      <Link
        href={href}
        aria-label={`Open ${design.title}`}
        className={cn(
          'flex h-full flex-col overflow-hidden rounded-card border-2 border-outline bg-secondary shadow-surfaceMd',
          FOCUS,
        )}
      >
        <DesignStage design={design} resolve={resolve} />

        <span className="flex min-w-0 flex-1 flex-col gap-2 p-3">
          <span className="line-clamp-2 break-words type-ui text-sm text-ink" title={design.title}>
            {design.title}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{formatName(design.format)}</Badge>
            <Badge variant={status.variant}>{status.label}</Badge>
          </span>
          <span className="flex flex-wrap gap-x-3 gap-y-0.5 font-sans text-xs text-ink type-muted">
            <span>{slideCountLabel(design.slideCount)}</span>
            {now ? <span>{updatedLabel(design.updatedAt, now)}</span> : null}
          </span>
        </span>
      </Link>

      <span className="absolute end-2 top-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="sm"
              aria-label={`Actions for ${design.title}`}
              className="w-9 shrink-0 px-0"
              disabled={busy}
            >
              <MotionIcon icon={EllipsisVerticalIcon} className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => router.push(href)}>
              <MotionIcon icon={SquarePenIcon} className="h-4 w-4" />
              Open
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDuplicate(design)}>
              <MotionIcon icon={CopyIcon} className="h-4 w-4" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onRename(design)}>
              <MotionIcon icon={PencilIcon} className="h-4 w-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onDelete(design)}>
              <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </li>
  );
}

/**
 * The card's picture: the cover slide on a dotted stage, sized to fit the
 * stage whatever its shape, so a story and a landscape sit in the same grid.
 */
function DesignStage({
  design,
  resolve,
}: {
  design: DesignSummary;
  resolve: (mediaId: string) => string | null;
}) {
  const spec = FORMATS[design.format];
  // Tall slides are narrowed so their height fits the square stage.
  const width = `${Math.min(1, spec.width / spec.height) * 100}%`;

  return (
    <span className="flex aspect-square items-center justify-center border-b-2 border-outline bg-inset bg-halftone p-5">
      {design.cover ? (
        <span className="block border-2 border-outline shadow-brutalSm" style={{ width }}>
          <SlideFrame design={design.cover} resolveMedia={resolve} lazy />
        </span>
      ) : (
        <span className="flex flex-col items-center gap-2 text-center font-sans text-xs text-ink type-muted">
          <ImageOff aria-hidden="true" className="h-6 w-6" strokeWidth={2.5} />
          This design could not be drawn.
        </span>
      )}
    </span>
  );
}
