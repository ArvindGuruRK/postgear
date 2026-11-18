'use client';

/**
 * The link card (Module 06; blueprint section 3): what a probed link is, the
 * rights tick, and Import Video.
 *
 * - **Found**: the picture (through our own signed route, lazy, and simply
 *   left out when it fails, never a grey box), the title, the channel, the
 *   platform `Badge`, the kind in words and the length. A Twitch past stream
 *   adds the muted-parts line. The rights `Checkbox` is never pre-ticked and
 *   the card is keyed by the link where it is used, so a new link always
 *   starts unticked. Import Video and Download are off until it is ticked.
 * - **Already here**: "You already have this video." and Open Video instead
 *   of the tick and Import.
 * - **Importing**: the button says so and nothing can be pressed twice.
 * - A refusal at import (a limit reached since the probe, the tick missing)
 *   shows as the same warning alert as the link box's.
 *
 * Download is drawn but stays off with "Arrives in a later step of this
 * sprint." until Module 18.
 */
import { ChevronDownIcon } from '@animateicons/react/lucide/chevron-down-icon';
import { DownloadIcon } from '@animateicons/react/lucide/download-icon';
import { Badge, Button, Checkbox, cn, MotionIcon, Skeleton, TooltipHint } from '@postgear/ui';
import { formatVideoLength } from '@postgear/video-engine';
import { useId, useState } from 'react';
import { ApiError } from '@/lib/api';
import { importVideo } from '@/lib/clips-api';
import type { ClipImportOutcome, ClipProbe } from '@/types/clips';
import { PrimaryLink } from '../button-link';
import { LATER_STEP_SENTENCE } from '../clips-model';
import { kindWords, PLATFORM_LABELS } from './home-model';
import { RefusalAlert } from './refusal-alert';

export const RIGHTS_LINE = 'This video is mine, or I have permission to use it.';
export const ALREADY_HERE = 'You already have this video.';
export const TWITCH_MUTED_LINE =
  'Twitch may have muted parts of this stream. Clips from muted parts will be silent.';
const IMPORT_UNREACHABLE = 'We could not reach Clips. Check your connection and try again.';

export type ImportFn = (url: string, rightsConfirmed: boolean) => Promise<ClipImportOutcome>;

export function LinkCard({
  probe,
  orgId,
  disabled = false,
  autoFocusRights = false,
  onImported,
  onUpload,
  importFn = importVideo,
  className,
}: {
  probe: ClipProbe;
  orgId: string;
  /** The video tools are not running: nothing new can come in. */
  disabled?: boolean;
  /** Move focus to the tick (a channel row's Import sent the person here). */
  autoFocusRights?: boolean;
  onImported: (outcome: ClipImportOutcome) => void;
  onUpload?: () => void;
  importFn?: ImportFn;
  className?: string;
}) {
  const tickId = useId();
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<{ message: string; code: string | undefined } | null>(
    null,
  );
  const [pictureFailed, setPictureFailed] = useState(false);
  const { info, existingVideoId } = probe;
  const picture = info.thumbnailUrl && !pictureFailed ? info.thumbnailUrl : null;

  const onImport = async () => {
    if (!ticked || busy || disabled) return;
    setBusy(true);
    setRefusal(null);
    try {
      const outcome = await importFn(probe.link.canonicalUrl, true);
      onImported(outcome);
    } catch (cause) {
      setRefusal(
        cause instanceof ApiError && cause.status !== 0
          ? { message: cause.message, code: cause.code }
          : { message: IMPORT_UNREACHABLE, code: undefined },
      );
    } finally {
      setBusy(false);
    }
  };

  const facts = [
    info.channelName,
    kindWords(info.kind),
    info.durationMs > 0 ? formatVideoLength(info.durationMs) : null,
  ].filter((part): part is string => Boolean(part));

  return (
    <div
      data-testid="clips-link-card"
      className={cn(
        'flex animate-fadeIn flex-col gap-4 rounded-card border-2 border-outline bg-inset p-4 sm:flex-row',
        className,
      )}
    >
      {picture ? (
        // biome-ignore lint/performance/noImgElement: our own signed, private picture route; next/image cannot forward the cookies it needs
        <img
          src={picture}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setPictureFailed(true)}
          className="aspect-video w-full shrink-0 rounded-md border-2 border-outline object-cover sm:w-64"
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <h3 className="m-0 line-clamp-2 type-heading text-lg text-ink">{info.title}</h3>
          <div className="flex flex-wrap items-center gap-2 font-sans text-sm text-ink">
            <Badge variant="outline">{PLATFORM_LABELS[info.platform]}</Badge>
            <span className="type-muted">{facts.join(', ')}</span>
          </div>
          {info.platform === 'twitch' && info.kind === 'past_stream' ? (
            <p className="m-0 font-sans text-xs text-ink type-muted">{TWITCH_MUTED_LINE}</p>
          ) : null}
        </div>

        {existingVideoId ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="m-0 font-sans text-sm font-bold text-ink">{ALREADY_HERE}</p>
            <PrimaryLink
              href={`/${encodeURIComponent(orgId)}/clips/video/${encodeURIComponent(existingVideoId)}`}
            >
              Open Video
            </PrimaryLink>
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2">
              <Checkbox
                id={tickId}
                checked={ticked}
                disabled={busy}
                autoFocus={autoFocusRights}
                onCheckedChange={(value) => setTicked(value === true)}
              />
              <label
                htmlFor={tickId}
                className="cursor-pointer font-sans text-sm font-bold text-ink"
              >
                {RIGHTS_LINE}
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" onClick={onImport} disabled={!ticked || busy || disabled}>
                {busy ? 'Importing' : 'Import Video'}
              </Button>
              <TooltipHint label={LATER_STEP_SENTENCE} disabled>
                <Button variant="secondary" size="sm" disabled>
                  <MotionIcon icon={DownloadIcon} className="h-4 w-4" />
                  Download
                  <MotionIcon icon={ChevronDownIcon} className="h-4 w-4" />
                </Button>
              </TooltipHint>
            </div>
          </>
        )}

        {refusal ? (
          <RefusalAlert
            message={refusal.message}
            code={refusal.code}
            orgId={orgId}
            onUpload={onUpload}
          />
        ) : null}
      </div>
    </div>
  );
}

/** The card's footprint while the link is read (blueprint section 3, Looking). */
export function LinkCardSkeleton() {
  return (
    <div
      aria-busy="true"
      data-testid="clips-link-card-skeleton"
      className="flex flex-col gap-4 rounded-card border-2 border-outline bg-inset p-4 sm:flex-row"
    >
      <Skeleton className="aspect-video w-full shrink-0 sm:w-64" />
      <div className="flex flex-1 flex-col gap-3">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-9 w-40" />
      </div>
    </div>
  );
}
