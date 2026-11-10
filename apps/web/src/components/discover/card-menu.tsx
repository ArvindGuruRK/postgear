'use client';

/**
 * A card's overflow menu (blueprint section 11: an icon-only ghost button on
 * the card's own surface, opening a `DropdownMenu`). Today it holds one
 * thing, Draft In Copilot (story DC-4.5): the AI page with the brief already
 * in its topic, for someone who wants the full studio rather than the sheet.
 * It is a real link, so it opens in a new tab like any other.
 */
import { EllipsisVerticalIcon } from '@animateicons/react/lucide/ellipsis-vertical-icon';
import { SparklesIcon } from '@animateicons/react/lucide/sparkles-icon';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MotionIcon,
} from '@postgear/ui';
import Link from 'next/link';
import type { DiscoverItem } from '@/types/discover';
import { copilotHref } from './discover-model';

export function CardMenu({ orgId, item }: { orgId: string; item: DiscoverItem }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="ms-auto w-9 px-0"
          aria-label={`More actions for ${item.title}`}
        >
          <MotionIcon icon={EllipsisVerticalIcon} className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={copilotHref(orgId, item)} prefetch={false}>
            <MotionIcon icon={SparklesIcon} className="h-4 w-4" />
            Draft In Copilot
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
