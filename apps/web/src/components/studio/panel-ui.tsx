'use client';

/**
 * Small controls the properties panel's tabs share (Sprint 9, Screen 4).
 *
 * - `Segmented`: one choice from a few (S, M, L; left, centre, right; where
 *   a logo sits), as pressed buttons in a group, built like the design
 *   system's view switcher.
 * - `SwatchPicker`: one colour from a grid of swatches, each named under its
 *   colour. The chosen one is ringed and ticked, so the choice is never told
 *   by colour alone.
 * - `CustomColorField`: the hex field behind Custom, which applies a colour
 *   as soon as what is typed is one.
 * - `PercentSlider`: a 0 to 100% slider with its name and value.
 * - `PanelSection`, `GroupLabel`, `PictureRow` and `PictureMissing`: a
 *   section's name, a group's label, a picture with its name, and the
 *   warning for a picture that was deleted from the library.
 *
 * The panel sits on the frame colour beside the canvas and on the card
 * colour inside a drawer; `PanelSurface` says which, so a chosen tile's ring
 * is offset by the colour actually behind it.
 */
import type { AnimatedIcon } from '@postgear/ui';
import {
  Alert,
  AlertDescription,
  cn,
  MotionIcon,
  pressSm,
  Slider,
  TooltipHint,
} from '@postgear/ui';
import { Check, ImageOff } from 'lucide-react';
import { createContext, type ReactNode, useContext, useId, useState } from 'react';
import { ColorField } from './color-field';
import { FOCUS } from './design-card';
import { INSET } from './studio-ui';
import { HEX_ERROR, hexFromInput } from './studio-view-model';
import { CHOSEN } from './wizard-steps';

/** A sentence in the panel: an explanation, an empty state, a hint. */
export const NOTE = 'm-0 font-sans text-sm text-ink type-muted';

/** The panel's warning for a picture deleted from the media library (section 5). */
export const PICTURE_DELETED = 'This image was deleted. Choose another.';

// ---------------------------------------------------------------------------
// The surface behind the panel
// ---------------------------------------------------------------------------

/** What the panel sits on: its own frame-colour panel, or a drawer's card colour. */
export type PanelSurfaceKind = 'chrome' | 'secondary';

const SurfaceContext = createContext<PanelSurfaceKind>('chrome');

/** Tells the controls inside which colour the panel sits on. */
export function PanelSurface({
  surface,
  children,
}: {
  surface: PanelSurfaceKind;
  children: ReactNode;
}) {
  return <SurfaceContext.Provider value={surface}>{children}</SurfaceContext.Provider>;
}

/** The ring a chosen tile wears, offset by the colour behind the panel. */
export function useChosenRing(): string {
  return useContext(SurfaceContext) === 'secondary' ? cn(CHOSEN, 'ring-offset-secondary') : CHOSEN;
}

// ---------------------------------------------------------------------------
// Sections and labels
// ---------------------------------------------------------------------------

/** One part of a tab: its name as a heading, then its controls. */
export function PanelSection({
  title,
  headingId,
  aside,
  children,
  className,
}: {
  /** Title Case, like every name. */
  title: string;
  /** For a control inside that the heading names (`aria-labelledby`). */
  headingId?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const fallbackId = useId();
  const id = headingId ?? fallbackId;

  return (
    <section aria-labelledby={id} className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={id} className="m-0 type-heading text-base text-ink">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** The name over a group of controls, which the group points to as its own name. */
export function GroupLabel({
  id,
  children,
  className,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p id={id} className={cn('m-0 type-label text-sm text-ink', className)}>
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// One choice from a few
// ---------------------------------------------------------------------------

export interface SegmentOption<T extends string> {
  value: T;
  /** The option's name: its text, or, with a short form or an icon, its tooltip and spoken name. */
  label: string;
  /** Shown in place of the label, such as S for Small. */
  short?: string;
  /** Shown in place of any text. */
  icon?: AnimatedIcon;
}

const SEGMENT = cn(
  'flex h-8 min-w-8 items-center justify-center rounded-md px-2.5 type-ui text-xs',
  'outline-none transition-colors motion-reduce:transition-none',
  'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
);

/**
 * One choice from a few, as pressed buttons: the design system's view
 * switcher, with text as well as icons. A choice shown as a letter or an icon
 * names itself on hover and keyboard focus, and to a screen reader always.
 */
export function Segmented<T extends string>({
  labelledBy,
  options,
  value,
  onValueChange,
  className,
}: {
  /** The id of the text that names the group. */
  labelledBy: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a div[role=group] of pressed buttons is the ARIA pattern for one choice of a few, as in the design system's view switcher
    <div
      role="group"
      aria-labelledby={labelledBy}
      className={cn(
        'inline-flex max-w-full flex-wrap items-center gap-1 self-start rounded-md border-2 border-outline bg-secondary p-1 shadow-brutalSm',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        const compact = option.icon !== undefined || option.short !== undefined;
        const button = (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-label={compact ? option.label : undefined}
            onClick={() => {
              if (!active) onValueChange(option.value);
            }}
            className={cn(
              SEGMENT,
              active
                ? 'bg-actionPrimary text-onActionPrimary'
                : 'text-ink hover:bg-actionPrimary/10',
            )}
          >
            {option.icon ? (
              <MotionIcon icon={option.icon} className="h-4 w-4" />
            ) : (
              (option.short ?? option.label)
            )}
          </button>
        );

        // Flush buttons: the tooltip closes as the pointer leaves, so it never
        // covers the next one (see ViewSwitcher).
        return compact ? (
          <TooltipHint
            key={option.value}
            label={option.label}
            side="top"
            sideOffset={10}
            hoverable={false}
          >
            {button}
          </TooltipHint>
        ) : (
          button
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Swatches
// ---------------------------------------------------------------------------

export interface SwatchChoice {
  value: string;
  /** Title Case: "Primary", "Light Text", "Custom". */
  label: string;
  /** The colour shown; null for a choice with no colour of its own yet. */
  color: string | null;
  /** A picture shown in place of a colour, such as the photo behind a slide. */
  imageUrl?: string | null;
  /** Shown on a swatch with neither, such as Photo before there is one. */
  icon?: AnimatedIcon;
}

/**
 * One colour from a grid of swatches, each a pressed button named under its
 * colour (and its hex, for a screen reader). Pressing the chosen one again
 * does nothing; the choice's own controls sit below the grid.
 *
 * A name wraps between words only. The columns are wide enough for the
 * longest one ("Background") whole, in the panel beside the canvas and in
 * the phone's drawer alike, and the chosen one's tick sits on its swatch
 * rather than beside its name, where it would take that room.
 */
export function SwatchPicker({
  labelledBy,
  options,
  value,
  onValueChange,
  className,
}: {
  /** The id of the text that names the group. */
  labelledBy: string;
  options: readonly SwatchChoice[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}) {
  const ring = useChosenRing();

  return (
    // biome-ignore lint/a11y/useSemanticElements: a div[role=group] of pressed buttons, like Segmented
    <div
      role="group"
      aria-labelledby={labelledBy}
      className={cn('grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-3', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        const painted = option.color !== null && !option.imageUrl;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => {
              if (!active) onValueChange(option.value);
            }}
            className={cn(
              'flex min-w-0 flex-col gap-1.5 rounded-md border-2 border-outline bg-secondary px-1 py-1.5 text-left',
              pressSm,
              FOCUS,
              active && ring,
            )}
          >
            <span
              aria-hidden="true"
              className="relative flex h-7 w-full items-center justify-center overflow-hidden rounded-sm border-2 border-outline bg-inset bg-halftone text-ink"
              style={painted ? { background: option.color ?? undefined } : undefined}
            >
              {option.imageUrl ? (
                // biome-ignore lint/performance/noImgElement: the media library's own thumbnail, never Next's optimizer
                <img src={option.imageUrl} alt="" className="h-full w-full object-cover" />
              ) : !painted && option.icon ? (
                <MotionIcon icon={option.icon} className="h-4 w-4" />
              ) : null}
              {active ? (
                // A sticker on the swatch, readable on any colour or picture.
                <span className="absolute inset-0 m-auto flex h-4 w-4 items-center justify-center rounded-full border-2 border-outline bg-secondary text-ink">
                  <Check className="h-2.5 w-2.5" strokeWidth={4} />
                </span>
              ) : null}
            </span>
            <span className="min-w-0 type-ui text-xs leading-tight text-ink break-words">
              {option.label}
            </span>
            {option.color ? <span className="sr-only">{` ${option.color}`}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The hex field behind Custom. What is typed is applied as soon as it is a
 * colour; until then it stays in the field only, and leaving the field with
 * something that is not a colour says how to write one. When the colour
 * changes elsewhere (Undo, Fix Contrast, the picker), the field follows.
 */
export function CustomColorField({
  value,
  onApply,
  label = 'Custom',
  className,
}: {
  /** The hex in use, or null when there is none yet. */
  value: string | null;
  onApply: (hex: string) => void;
  /** Read, not shown: the swatch above already says Custom. */
  label?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const [synced, setSynced] = useState(value);
  const [left, setLeft] = useState(false);

  // Adjusting state while rendering, React's pattern for following a prop:
  // a colour from elsewhere replaces the field, unless the field already
  // says that colour in a shorter way (#ABC while #AABBCC is applied).
  if (value !== synced) {
    setSynced(value);
    if (value && hexFromInput(draft) !== value) setDraft(value);
  }

  return (
    <ColorField
      label={label}
      hideLabel
      value={draft}
      onChange={(next) => {
        setDraft(next);
        const hex = hexFromInput(next);
        if (hex) onApply(hex);
      }}
      onBlur={() => setLeft(true)}
      error={left && !hexFromInput(draft) ? HEX_ERROR : null}
      className={className}
    />
  );
}

// ---------------------------------------------------------------------------
// A percentage
// ---------------------------------------------------------------------------

/**
 * A 0 to 100% slider with its name and value shown. The design system's
 * Slider gives its thumb (the part a screen reader lands on) no name of its
 * own, so the name and the spoken value are set on the thumb here.
 */
export function PercentSlider({
  label,
  value,
  onValueChange,
  step = 5,
}: {
  label: string;
  /** 0 to 100. */
  value: number;
  onValueChange: (value: number) => void;
  step?: number;
}) {
  const id = useId();

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <GroupLabel id={id}>{label}</GroupLabel>
        <span aria-hidden="true" className="font-sans text-xs tabular-nums text-ink type-muted">
          {value}%
        </span>
      </div>
      <Slider
        value={[value]}
        min={0}
        max={100}
        step={step}
        thumbs={[{ 'aria-labelledby': id, 'aria-valuetext': `${value}%` }]}
        onValueChange={([next]) => {
          if (next !== undefined) onValueChange(next);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

/** A picture the design uses: a small preview and its name from the media library. */
export function PictureRow({
  url,
  name,
  fit = 'cover',
  note,
}: {
  url: string | null;
  name: string;
  /** A logo is shown whole; a photo fills its box. */
  fit?: 'cover' | 'contain';
  /** A line under the name, such as "Your brand logo". */
  note?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        className={cn(
          INSET,
          'flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden bg-halftone',
          fit === 'contain' && 'p-1.5',
        )}
      >
        {url ? (
          // biome-ignore lint/performance/noImgElement: the media library's own thumbnail, never Next's optimizer
          <img
            src={url}
            alt=""
            className={cn('h-full w-full', fit === 'cover' ? 'object-cover' : 'object-contain')}
          />
        ) : (
          <ImageOff aria-hidden="true" className="h-5 w-5 text-ink" strokeWidth={2.5} />
        )}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="line-clamp-2 type-ui text-sm text-ink wrap-anywhere">{name}</span>
        {note ? <span className="font-sans text-xs text-ink type-muted">{note}</span> : null}
      </span>
    </div>
  );
}

/**
 * A picture the design still names but the media library no longer has: the
 * slide shows an empty space, and this says so with the way to choose another.
 */
export function PictureMissing({ children }: { children: ReactNode }) {
  return (
    <Alert variant="warning" role="status" className="flex-wrap items-center justify-between">
      <AlertDescription>{PICTURE_DELETED}</AlertDescription>
      {children}
    </Alert>
  );
}
