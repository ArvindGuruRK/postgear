'use client';

/**
 * The first two steps of Create Design: Brand (DS-2.3, DS-2.4) and Format
 * (DS-3.1). Both show rather than ask (rule 2): each brand kit is a real
 * slide in its colours and logo, and each format is that same slide drawn
 * at its true shape, so the choice is made by looking.
 *
 * Both start on the answer given last time: the format last chosen on this
 * browser, and the kit this workspace last created a design with (Sprint 9b,
 * remembered by the gallery), each marked Last Used.
 */
import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { ArrowRightIcon } from '@animateicons/react/lucide/arrow-right-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import {
  documentFromPreset,
  FORMAT_IDS,
  FORMATS,
  type FormatId,
  presetById,
  presetFormats,
} from '@postgear/design-engine';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  cn,
  MotionIcon,
  pressSm,
  Skeleton,
} from '@postgear/ui';
import { type Ref, useEffect, useMemo, useState } from 'react';
import type { BrandKitView } from '@/types/studio';
import { BrandKitDialog } from './brand-kit-dialog';
import { FOCUS } from './design-card';
import { KIT_PREVIEW_PRESET_ID, KitPreview, KitSwatches } from './kit-preview';
import { SlideFrame } from './slide-frame';
import { INSET } from './studio-ui';
import {
  brandFromKitView,
  formatHint,
  formatName,
  kitLogoResolver,
  preselectedKit,
  readLastKit,
} from './studio-view-model';

/** The ring a chosen tile wears, offset by the panel's own colour. */
export const CHOSEN = 'ring-4 ring-actionPrimary ring-offset-2 ring-offset-chrome';

/** Where the last format chosen is remembered, per browser (DS-3.1). */
const LAST_FORMAT_KEY = 'postgear.studio.lastFormat';

export function readLastFormat(): FormatId | null {
  try {
    const value = window.localStorage.getItem(LAST_FORMAT_KEY);
    return FORMAT_IDS.find((format) => format === value) ?? null;
  } catch {
    return null;
  }
}

export function rememberFormat(format: FormatId): void {
  try {
    window.localStorage.setItem(LAST_FORMAT_KEY, format);
  } catch {
    // Private browsing or storage turned off: the choice is simply not remembered.
  }
}

/** A step's name and one line under it. Focus lands here when the step opens. */
export function StepHeader({
  headingRef,
  id,
  title,
  sub,
  aside,
}: {
  headingRef: Ref<HTMLHeadingElement>;
  id: string;
  title: string;
  sub: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h2
          ref={headingRef}
          id={id}
          tabIndex={-1}
          className="m-0 type-heading text-xl text-ink outline-none"
        >
          {title}
        </h2>
        <p className="m-0 font-sans text-sm text-ink type-muted">{sub}</p>
      </div>
      {aside}
    </div>
  );
}

export function BrandStep({
  headingRef,
  orgId,
  kits,
  error,
  onRetry,
  chosenId,
  presetId,
  onChoose,
  onSkip,
  onKitSaved,
}: {
  headingRef: Ref<HTMLHeadingElement>;
  /** Whose remembered kit to start on: kits belong to a workspace. */
  orgId: string;
  kits: BrandKitView[] | null;
  error: string | null;
  onRetry: () => void;
  chosenId: string | null;
  /** The template already chosen, drawn in each kit; the house sample otherwise. */
  presetId: string | null;
  onChoose: (kit: BrandKitView) => void;
  onSkip: () => void;
  onKitSaved: (kit: BrandKitView) => void;
}) {
  const [dialog, setDialog] = useState(0);
  const [creating, setCreating] = useState(false);
  // Read after hydration: the server cannot know what this browser remembers.
  const [lastKitId, setLastKitId] = useState<string | null>(null);
  useEffect(() => setLastKitId(readLastKit(orgId)), [orgId]);

  // The kit in the URL, else the one last used here (if it still exists).
  const preselected = preselectedKit(kits, chosenId, lastKitId);
  const chosen = preselected?.kit ?? null;

  return (
    <section aria-labelledby="wizard-brand" className="flex flex-col gap-5">
      <StepHeader
        headingRef={headingRef}
        id="wizard-brand"
        title="Choose A Brand"
        sub="Its colours and logo go into every template. You can change them in the editor."
      />

      {error && !kits ? (
        <Alert variant="danger" className="flex-wrap items-center justify-between">
          <AlertDescription>{error}</AlertDescription>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try Again
          </Button>
        </Alert>
      ) : null}

      <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {kits === null && !error
          ? [0, 1, 2].map((index) => (
              <li key={index}>
                <Skeleton className="aspect-[4/5] w-full" />
              </li>
            ))
          : null}

        {(kits ?? []).map((kit) => (
          <li key={kit.id} className="min-w-0">
            <button
              type="button"
              data-testid="wizard-kit"
              aria-label={`Use ${kit.name}`}
              // The label hides the badge, so the kit Continue would use says so here.
              aria-current={kit.id === chosen?.id ? 'true' : undefined}
              onClick={() => onChoose(kit)}
              className={cn(
                'flex w-full flex-col gap-3 rounded-card border-2 border-outline bg-secondary p-3 text-left',
                pressSm,
                FOCUS,
                kit.id === chosen?.id && CHOSEN,
              )}
            >
              <span className={cn(INSET, 'block bg-halftone p-4')}>
                <span className="block border-2 border-outline shadow-brutalSm">
                  <KitPreview
                    name={kit.name}
                    colors={kit.colors}
                    logoUrl={kit.logoUrl}
                    presetId={presetId ?? KIT_PREVIEW_PRESET_ID}
                    lazy
                  />
                </span>
              </span>
              <span className="flex min-w-0 items-center justify-between gap-2">
                <span
                  className="line-clamp-2 break-words type-ui text-sm text-ink"
                  title={kit.name}
                >
                  {kit.name}
                </span>
                {kit.id === chosen?.id ? (
                  <Badge variant="primary">
                    {preselected?.remembered ? 'Last Used' : 'Chosen'}
                  </Badge>
                ) : null}
              </span>
              <KitSwatches colors={kit.colors} />
            </button>
          </li>
        ))}

        <li className="min-w-0">
          <button
            type="button"
            onClick={() => {
              setDialog((count) => count + 1);
              setCreating(true);
            }}
            className={cn(
              'flex h-full min-h-48 w-full flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed border-outline bg-inset p-6 text-center',
              FOCUS,
            )}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-outline bg-actionPrimary text-onActionPrimary">
              <MotionIcon icon={PlusIcon} className="h-5 w-5" />
            </span>
            <span className="type-ui text-sm text-ink">New Brand Kit</span>
            <span className="max-w-56 font-sans text-xs text-ink type-muted">
              Your name, logo and colours, typed in or read from your website.
            </span>
          </button>
        </li>
      </ul>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button variant="secondary" onClick={onSkip}>
          Skip For Now
        </Button>
        {chosen ? (
          <Button onClick={() => onChoose(chosen)}>
            Continue
            <MotionIcon icon={ArrowRightIcon} className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {creating ? (
        <BrandKitDialog
          key={dialog}
          kit={null}
          onClose={() => setCreating(false)}
          onSaved={(kit) => {
            setCreating(false);
            onKitSaved(kit);
          }}
        />
      ) : null}
    </section>
  );
}

export function FormatStep({
  headingRef,
  kit,
  presetId,
  chosen,
  onChoose,
  onBack,
}: {
  headingRef: Ref<HTMLHeadingElement>;
  kit: BrandKitView | null;
  presetId: string | null;
  /** The format in the URL, when the user came back to this step. */
  chosen: FormatId | null;
  onChoose: (format: FormatId) => void;
  onBack: () => void;
}) {
  // Read after hydration: the server cannot know what this browser remembers.
  const [lastUsed, setLastUsed] = useState<FormatId | null>(null);
  useEffect(() => setLastUsed(readLastFormat()), []);

  const preset = presetId ? presetById(presetId) : null;
  const allowed: readonly FormatId[] = preset ? presetFormats(preset) : FORMAT_IDS;
  const preselected = chosen ?? (lastUsed && allowed.includes(lastUsed) ? lastUsed : null);
  const resolve = useMemo(() => kitLogoResolver(kit), [kit]);

  const designs = useMemo(() => {
    const brand = kit ? brandFromKitView(kit) : null;

    return FORMAT_IDS.map((format) => {
      let next = 0;
      return documentFromPreset({
        presetId: preset?.id ?? KIT_PREVIEW_PRESET_ID,
        format,
        brand,
        newId: () => `format-${format}-${next++}`,
      });
    });
  }, [kit, preset]);

  function choose(format: FormatId) {
    rememberFormat(format);
    onChoose(format);
  }

  return (
    <section aria-labelledby="wizard-format" className="flex flex-col gap-5">
      <StepHeader
        headingRef={headingRef}
        id="wizard-format"
        title="Choose A Format"
        sub="The shape of your post. Each one is drawn at its real size and shape."
      />

      <ul className="m-0 grid list-none grid-cols-2 gap-4 p-0 lg:grid-cols-4">
        {FORMAT_IDS.map((format, index) => {
          const spec = FORMATS[format];
          const disabled = !allowed.includes(format);
          const hintId = `wizard-format-${format}-hint`;
          const design = designs[index];

          return (
            <li key={format} className="min-w-0">
              <button
                type="button"
                data-testid="wizard-format"
                disabled={disabled}
                aria-describedby={hintId}
                onClick={() => choose(format)}
                className={cn(
                  'group flex h-full w-full flex-col gap-3 rounded-card border-2 border-outline bg-secondary p-3 text-left',
                  pressSm,
                  FOCUS,
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  format === preselected && CHOSEN,
                )}
              >
                <span
                  className={cn(
                    INSET,
                    'flex aspect-square items-center justify-center bg-halftone p-4',
                  )}
                >
                  <span
                    className="block border-2 border-outline shadow-brutalSm"
                    style={{ width: `${Math.min(1, spec.width / spec.height) * 100}%` }}
                  >
                    {design ? <SlideFrame design={design} resolveMedia={resolve} /> : null}
                  </span>
                </span>
                <span className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <span className="type-ui text-sm text-ink">{formatName(format)}</span>
                  {format === preselected ? (
                    <Badge variant="primary">{chosen ? 'Chosen' : 'Last Used'}</Badge>
                  ) : null}
                </span>
                <span id={hintId} className="font-sans text-xs text-ink type-muted">
                  {disabled
                    ? `${preset?.name ?? 'This template'} is not available in this format.`
                    : formatHint(format)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" onClick={onBack}>
          <MotionIcon icon={ArrowLeftIcon} className="h-4 w-4" />
          Back
        </Button>
        {preselected ? (
          <Button onClick={() => choose(preselected)}>
            Continue
            <MotionIcon icon={ArrowRightIcon} className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </section>
  );
}
