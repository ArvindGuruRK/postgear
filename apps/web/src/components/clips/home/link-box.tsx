'use client';

/**
 * The paste box (Module 06; blueprint sections 2 and 3): one `bg-chrome`
 * card with the link field, Find Video, Browse Channels (the saved channels'
 * lists, in a dialog), Upload A Video, Try A Sample and one help line.
 *
 * Typing asks nothing. Enter or Find Video reads the link (`useLinkProbe`,
 * where a newer read always wins), and the answer grows under the field: the
 * card's skeleton with "Reading the link", the link card, or the refusal as a
 * warning alert. Nothing else on the page moves.
 *
 * When the video tools are not running every button that would bring
 * something in is off (the alert above the tabs says why).
 */
import { LinkIcon } from '@animateicons/react/lucide/link-icon';
import { CastIcon } from '@animateicons/react/lucide/cast-icon';
import { SquarePlayIcon } from '@animateicons/react/lucide/square-play-icon';
import { UploadIcon } from '@animateicons/react/lucide/upload-icon';
import { Button, Input, MotionIcon } from '@postgear/ui';
import type { ClipPlatformId } from '@postgear/video-engine';
import { Link2 } from 'lucide-react';
import { type FormEvent, useEffect, useId, useState } from 'react';
import type { ClipImportOutcome, DownloadStarted } from '@/types/clips';
import { linkPlaceholder } from './home-model';
import { LinkCard, LinkCardSkeleton } from './link-card';
import { RefusalAlert } from './refusal-alert';
import type { LinkProbe } from './use-link-probe';

export const READING_THE_LINK = 'Reading the link';

export function LinkBox({
  orgId,
  platforms,
  probe,
  disabled,
  focusRights,
  sampleAvailable,
  sampleBusy,
  uploadHelp,
  onImported,
  onDownloaded,
  onUpload,
  onBrowse,
  onSample,
  children,
}: {
  orgId: string;
  platforms: readonly ClipPlatformId[];
  probe: LinkProbe;
  /** The video tools are not running. */
  disabled: boolean;
  /** The link card came from a channel row: put focus on its tick. */
  focusRights: boolean;
  sampleAvailable: boolean;
  sampleBusy: boolean;
  uploadHelp: string;
  onImported: (outcome: ClipImportOutcome) => void;
  /** Module 18: a download was asked for (absent: the card has no Download). */
  onDownloaded?: (outcome: DownloadStarted) => void;
  onUpload: () => void;
  /** Opens Browse Channels; absent when no platform is switched on. */
  onBrowse?: () => void;
  onSample: () => void;
  /** The upload rows, drawn inside the box under its buttons. */
  children?: React.ReactNode;
}) {
  const fieldId = useId();
  const [url, setUrl] = useState('');
  const { state } = probe;

  // A probe shown from elsewhere (a channel row) puts its link in the field.
  useEffect(() => {
    if (state.kind === 'found' || state.kind === 'looking') setUrl(state.url);
  }, [state]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (disabled) return;
    probe.probe(url);
  };

  return (
    <section
      aria-label="Bring In A Video"
      className="flex flex-col gap-4 rounded-card border-2 border-outline bg-chrome p-5 shadow-surfaceSm"
    >
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor={fieldId} className="sr-only">
          Video link
        </label>
        <div className="flex items-stretch gap-3">
          <div className="relative min-w-0 flex-1">
            <Link2
              className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-ink"
              strokeWidth={2.5}
              aria-hidden="true"
            />
            <Input
              id={fieldId}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              size="lg"
              value={url}
              disabled={disabled}
              placeholder={linkPlaceholder(platforms)}
              onChange={(event) => setUrl(event.target.value)}
              className="ps-12"
            />
          </div>
          <Button
            type="submit"
            size="lg"
            disabled={disabled || url.trim() === '' || state.kind === 'looking'}
          >
            <MotionIcon icon={LinkIcon} className="h-5 w-5" />
            Find Video
          </Button>
        </div>
      </form>

      {state.kind === 'looking' ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          <p className="m-0 font-sans text-sm text-ink type-muted">{READING_THE_LINK}</p>
          <LinkCardSkeleton />
        </div>
      ) : null}
      {state.kind === 'found' ? (
        <LinkCard
          key={state.probe.link.canonicalUrl}
          probe={state.probe}
          orgId={orgId}
          disabled={disabled}
          autoFocusRights={focusRights}
          onImported={onImported}
          onDownloaded={onDownloaded}
          onUpload={onUpload}
        />
      ) : null}
      {state.kind === 'refused' ? (
        <RefusalAlert
          message={state.message}
          code={state.code}
          orgId={orgId}
          onUpload={disabled ? undefined : onUpload}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {onBrowse && platforms.length > 0 ? (
          <Button variant="secondary" size="sm" onClick={onBrowse}>
            <MotionIcon icon={CastIcon} className="h-4 w-4" />
            Browse Channels
          </Button>
        ) : null}
        <Button variant="secondary" size="sm" disabled={disabled} onClick={onUpload}>
          <MotionIcon icon={UploadIcon} className="h-4 w-4" />
          Upload A Video
        </Button>
        {sampleAvailable ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || sampleBusy}
            onClick={onSample}
          >
            <MotionIcon icon={SquarePlayIcon} className="h-4 w-4" />
            {sampleBusy ? 'Bringing In The Sample' : 'Try A Sample'}
          </Button>
        ) : null}
        <span className="font-sans text-xs text-ink type-muted">{uploadHelp}</span>
      </div>

      {children}
    </section>
  );
}
