'use client';

/**
 * The way in (Module 06; redone 2026-11-19 after StreamLadder's home): one
 * centred card that holds every way to bring a video in, in the order people
 * reach for them.
 *
 * 1. **Which platforms work**: their logos and names, so nobody pastes a link
 *    we cannot read.
 * 2. **The link field** and a full-width **Find Clips**. Typing asks nothing;
 *    Enter or Find Clips reads the link (`useLinkProbe`, where a newer read
 *    always wins) and the answer grows under the button: the card's skeleton
 *    with "Reading the link", the link card, or the refusal as a warning
 *    alert. Pressed with an empty field it says what to paste, under the
 *    field, instead of sitting greyed out with no reason.
 * 3. **Upload Your Own Video**: a dashed drop area, full width. A click opens
 *    the file picker; a video dropped on it starts its upload.
 * 4. **Browse** buttons, one per platform switched on, side by side: each
 *    opens that platform's saved channels.
 *
 * Try A Sample sits under the card as a quiet line. When the video tools are
 * not running every way in is off (the alert above says why).
 */
import { SparklesIcon } from '@animateicons/react/lucide/sparkles-icon';
import { UploadIcon } from '@animateicons/react/lucide/upload-icon';
import { Button, cn, Input, MotionIcon, useIconAnimation } from '@postgear/ui';
import { type ClipPlatformId, PLATFORM_NAMES } from '@postgear/video-engine';
import { Link2 } from 'lucide-react';
import { type DragEvent, type FormEvent, useEffect, useId, useState } from 'react';
import { PlatformIcon } from '@/components/platforms/platform-icon';
import type { ClipImportOutcome, DownloadStarted } from '@/types/clips';
import { emptyLinkSentence, linkPlaceholder, orderedPlatforms } from './home-model';
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
  onDropFiles,
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
  /** Opens the file picker. */
  onUpload: () => void;
  /** Videos dropped on the upload area. */
  onDropFiles?: (files: File[]) => void;
  /** Opens one platform's saved channels; absent, no Browse buttons. */
  onBrowse?: (platform: ClipPlatformId) => void;
  onSample: () => void;
  /** The upload rows, drawn inside the card under its buttons. */
  children?: React.ReactNode;
}) {
  const fieldId = useId();
  const errorId = useId();
  const [url, setUrl] = useState('');
  const [empty, setEmpty] = useState(false);
  const { state } = probe;
  const shown = orderedPlatforms(platforms);

  // A probe shown from elsewhere (a channel row) puts its link in the field.
  useEffect(() => {
    if (state.kind === 'found' || state.kind === 'looking') setUrl(state.url);
  }, [state]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (disabled) return;
    if (url.trim() === '') {
      setEmpty(true);
      return;
    }
    probe.probe(url);
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
      <section
        aria-label="Bring In A Video"
        className="flex flex-col gap-4 rounded-2xl border-2 border-outline bg-chrome p-5 shadow-surfaceMd"
      >
        {shown.length > 0 ? (
          <ul
            aria-label="Works with"
            className="m-0 flex list-none flex-wrap items-center justify-center gap-2 p-0"
          >
            {shown.map((one) => (
              <li
                key={one}
                className="flex items-center gap-1.5 rounded-md border-2 border-outline bg-inset px-2 py-1 font-sans text-xs text-ink type-ui"
              >
                <PlatformIcon platform={one} className="h-4 w-4 rounded-[4px]" />
                {PLATFORM_NAMES[one]}
              </li>
            ))}
          </ul>
        ) : null}

        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={fieldId} className="sr-only">
              Video link
            </label>
            <div className="relative">
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
                aria-invalid={empty || undefined}
                aria-describedby={empty ? errorId : undefined}
                onChange={(event) => {
                  setUrl(event.target.value);
                  if (empty) setEmpty(false);
                }}
                className="ps-12"
              />
            </div>
            {empty ? (
              <p
                id={errorId}
                role="alert"
                data-testid="clips-link-empty"
                className="m-0 font-sans text-sm text-dangerInk type-ui"
              >
                {emptyLinkSentence(platforms)}
              </p>
            ) : null}
          </div>
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={disabled || state.kind === 'looking'}
          >
            <MotionIcon icon={SparklesIcon} className="h-5 w-5" />
            {state.kind === 'looking' ? 'Reading The Link' : 'Find Clips'}
          </Button>
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

        <UploadArea
          disabled={disabled}
          help={uploadHelp}
          onUpload={onUpload}
          onDropFiles={onDropFiles}
        />

        {onBrowse && shown.length > 0 ? (
          <div
            className={cn(
              'grid gap-3',
              shown.length === 1
                ? 'grid-cols-1'
                : shown.length === 2
                  ? 'grid-cols-2'
                  : 'grid-cols-3',
            )}
          >
            {shown.map((one) => (
              <Button
                key={one}
                variant="secondary"
                size="lg"
                className="w-full"
                onClick={() => onBrowse(one)}
              >
                <PlatformIcon platform={one} className="h-5 w-5 rounded-[5px]" />
                Browse {PLATFORM_NAMES[one]}
              </Button>
            ))}
          </div>
        ) : null}

        {children}
      </section>

      {sampleAvailable ? (
        <p className="m-0 flex flex-wrap items-center justify-center gap-1 font-sans text-sm text-ink type-muted">
          No video at hand?
          <button
            type="button"
            disabled={disabled || sampleBusy}
            onClick={onSample}
            className={cn(
              'rounded-sm px-0.5 font-sans text-sm text-ink type-ui underline underline-offset-2',
              'hover:text-actionPrimary disabled:pointer-events-none disabled:opacity-50',
              'outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-focusRing',
            )}
          >
            {sampleBusy ? 'Bringing In The Sample' : 'Try A Sample'}
          </button>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Upload Your Own Video: a dashed area the width of the card. A click opens
 * the file picker; a file dragged over it turns the area blue (the Media drop
 * box's cue) and is uploaded when it lands.
 */
function UploadArea({
  disabled,
  help,
  onUpload,
  onDropFiles,
}: {
  disabled: boolean;
  help: string;
  onUpload: () => void;
  onDropFiles?: (files: File[]) => void;
}) {
  const icon = useIconAnimation();
  const [over, setOver] = useState(false);

  const allowDrop = (event: DragEvent) => {
    if (disabled || !onDropFiles || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setOver(true);
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onUpload}
      onDragEnter={allowDrop}
      onDragOver={allowDrop}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        if (disabled || !onDropFiles) return;
        event.preventDefault();
        setOver(false);
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) onDropFiles(files);
      }}
      {...icon.triggers}
      data-testid="clips-upload-area"
      className={cn(
        'flex w-full flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed px-4 py-4',
        'font-sans text-ink outline-none transition-colors duration-100',
        'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
        'disabled:pointer-events-none disabled:opacity-50',
        over
          ? 'border-actionPrimary bg-actionPrimary/10'
          : 'border-outline bg-inset hover:border-actionPrimary hover:bg-actionPrimary/5',
      )}
    >
      <span className="flex items-center gap-2 type-ui text-base">
        <UploadIcon ref={icon.ref} aria-hidden size={20} className="h-5 w-5 shrink-0" />
        Upload Your Own Video
      </span>
      <span className="text-xs type-muted">{over ? 'Drop it here to upload.' : help}</span>
    </button>
  );
}
