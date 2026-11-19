'use client';

/**
 * The link card's **Download** (Module 18; blueprint section 3): a
 * `DropdownMenu` (no shadow) of the qualities the link offers, tallest
 * first up to 1080p, then Audio Only: "1080p (412 MB)", "720p", "Audio Only".
 * A size shows only when the platform gave one; an estimate is never shown
 * as a fact. Off until the rights box is ticked, like Import Video.
 */
import { ChevronDownIcon } from '@animateicons/react/lucide/chevron-down-icon';
import { DownloadIcon } from '@animateicons/react/lucide/download-icon';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MotionIcon,
} from '@postgear/ui';
import { downloadableFormats, downloadMenuLabel } from '@postgear/video-engine';
import type { LinkFormat } from '@/types/clips';

export const NO_QUALITIES = 'This video offers no quality we can download.';

export function DownloadMenu({
  formats,
  disabled,
  busy,
  onPick,
}: {
  formats: readonly LinkFormat[];
  disabled: boolean;
  /** A download is being asked for: the button says so. */
  busy: boolean;
  onPick: (format: LinkFormat) => void;
}) {
  const offered = downloadableFormats(formats);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" disabled={disabled || busy}>
          <MotionIcon icon={DownloadIcon} className="h-4 w-4" />
          {busy ? 'Preparing' : 'Download'}
          <MotionIcon icon={ChevronDownIcon} className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" data-testid="clips-download-menu">
        {offered.length === 0 ? (
          <DropdownMenuItem disabled>{NO_QUALITIES}</DropdownMenuItem>
        ) : (
          offered.map((format) => (
            <DropdownMenuItem key={format.id} onSelect={() => onPick(format)}>
              {downloadMenuLabel(format)}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
