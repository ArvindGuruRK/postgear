'use client';

/**
 * One row of a channel's list (Module 06, section 6): the platform's own
 * picture, the title, "21 Nov, 3 h 42 min, 12,408 views", the expiry line of
 * a Twitch past stream, and what can be done with it.
 *
 * - **Ready**: **Import** (primary, small; "Checking" while the link goes to
 *   the probe) and a ghost hide icon.
 * - **Already imported**: **Open** instead of Import.
 * - **Live**, **Coming up** or **Still processing**: a badge in place of
 *   Import, with the reason in a tooltip.
 * - **Hidden** (Show Hidden is on): the row is muted and offers **Show Again**.
 *
 * The picture is decorative (the title says what it is); a picture that fails
 * to load leaves the same footprint with a film mark, so rows stay aligned.
 */
import { EyeOffIcon } from '@animateicons/react/lucide/eye-off-icon';
import { Badge, Button, cn, MotionIcon, Skeleton, TooltipHint } from '@postgear/ui';
import type { ClipPlatformId } from '@postgear/video-engine';
import { Film } from 'lucide-react';
import { useState } from 'react';
import type { ClipStreamItem } from '@/types/clips';
import { PrimaryLink } from '../button-link';
import { RefusalAlert } from '../home/refusal-alert';
import { expiryLine, importable, LIVE_TOOLTIP, streamFacts } from './channels-model';

export const UPCOMING_TOOLTIP = 'Come back once the stream has started and ended.';
export const PROCESSING_TOOLTIP =
  'The platform is still preparing this video. Come back in a little while.';

function StateBadge({ item }: { item: ClipStreamItem }) {
  const view =
    item.state === 'live'
      ? { label: 'Live Now', tip: LIVE_TOOLTIP, variant: 'danger' as const }
      : item.state === 'upcoming'
        ? { label: 'Coming Up', tip: UPCOMING_TOOLTIP, variant: 'secondary' as const }
        : { label: 'Still Processing', tip: PROCESSING_TOOLTIP, variant: 'secondary' as const };
  return (
    <TooltipHint label={view.tip}>
      <span
        // biome-ignore lint/a11y/noNoninteractiveTabindex: lets the reason be reached by keyboard
        tabIndex={0}
        className="inline-flex rounded-md outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
      >
        <Badge variant={view.variant}>{view.label}</Badge>
      </span>
    </TooltipHint>
  );
}

export function StreamRow({
  item,
  platform,
  orgId,
  now,
  checking,
  busy,
  disabled,
  refusal,
  onImport,
  onHide,
  onShowAgain,
}: {
  item: ClipStreamItem;
  platform: ClipPlatformId;
  orgId: string;
  now: Date;
  /** This row's link is with the probe. */
  checking: boolean;
  /** Another row's link is with the probe: one at a time. */
  busy: boolean;
  /** The video tools are not running. */
  disabled: boolean;
  /** Why this row's Import was refused, shown under it. */
  refusal: { message: string; code: string | undefined } | null;
  onImport: (item: ClipStreamItem) => void;
  onHide: (item: ClipStreamItem) => void;
  onShowAgain: (item: ClipStreamItem) => void;
}) {
  const [pictureFailed, setPictureFailed] = useState(false);
  const facts = streamFacts(item);
  const expiry = platform === 'twitch' ? expiryLine(item.expiresAt, now) : null;
  const picture = item.thumbnailUrl && !pictureFailed ? item.thumbnailUrl : null;

  return (
    <li className="flex flex-col gap-2">
      <div
        className={cn(
          'flex items-center gap-4 rounded-md border-2 border-outline bg-inset p-3',
          item.hidden && 'border-dashed',
        )}
        data-state={item.state}
        data-hidden={item.hidden || undefined}
      >
        <div
          className={cn(
            'relative flex aspect-video w-40 shrink-0 items-center justify-center overflow-hidden rounded-sm border-2 border-outline bg-secondary',
            item.hidden && 'opacity-60',
          )}
        >
          {picture ? (
            // biome-ignore lint/performance/noImgElement: the platform's own address, never optimised through our server
            <img
              src={picture}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
              onError={() => setPictureFailed(true)}
            />
          ) : (
            <Film className="h-6 w-6 text-ink" strokeWidth={2.5} aria-hidden="true" />
          )}
        </div>

        <div className={cn('flex min-w-0 flex-1 flex-col gap-1', item.hidden && 'opacity-60')}>
          <p className="m-0 line-clamp-2 font-sans text-base text-ink type-ui" title={item.title}>
            {item.title}
          </p>
          {facts ? <p className="m-0 font-sans text-sm text-ink type-muted">{facts}</p> : null}
          {expiry ? <p className="m-0 font-sans text-xs text-ink type-muted">{expiry}</p> : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {item.hidden ? (
            <Button variant="secondary" size="sm" onClick={() => onShowAgain(item)}>
              Show Again
            </Button>
          ) : (
            <>
              {item.imported && item.videoId ? (
                <PrimaryLink
                  href={`/${encodeURIComponent(orgId)}/clips/video/${encodeURIComponent(item.videoId)}`}
                >
                  Open
                </PrimaryLink>
              ) : importable(item) ? (
                <Button
                  size="sm"
                  disabled={disabled || checking || busy}
                  aria-label={`Import ${item.title}`}
                  onClick={() => onImport(item)}
                >
                  {checking ? 'Checking' : 'Import'}
                </Button>
              ) : (
                <StateBadge item={item} />
              )}
              <TooltipHint label="Hide From List">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Hide ${item.title} from the list`}
                  onClick={() => onHide(item)}
                >
                  <MotionIcon icon={EyeOffIcon} className="h-4 w-4" />
                </Button>
              </TooltipHint>
            </>
          )}
        </div>
      </div>
      {refusal ? (
        <RefusalAlert message={refusal.message} code={refusal.code} orgId={orgId} />
      ) : null}
    </li>
  );
}

/** Row footprints while a list loads: never a spinner over old rows. */
export function StreamRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholders
          key={index}
          className="flex items-center gap-4 rounded-md border-2 border-outline bg-inset p-3"
        >
          <Skeleton className="aspect-video w-40 shrink-0" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-8 w-20" />
        </li>
      ))}
    </ul>
  );
}
