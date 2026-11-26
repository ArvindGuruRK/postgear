'use client';

import { Hand } from 'lucide-react';
import type { HTMLAttributes } from 'react';
import { cn } from '../lib/utils';
import { TIMELINE_LABEL_WIDTH_PX } from './timeline-row';

/**
 * A person's colour on the strip, by their place (the first person seen is
 * 0). Four theme colours, the same four the crop boxes use; violet is AI's
 * and red reads as a fault, so neither is a person.
 */
export const SPEAKER_STRIP_TONES = [
  'bg-actionPrimary',
  'bg-actionSuccess',
  'bg-actionAccent',
  'bg-actionSecondary',
] as const;

export function speakerStripTone(person: number): string {
  const n = SPEAKER_STRIP_TONES.length;
  return SPEAKER_STRIP_TONES[((person % n) + n) % n] as string;
}

/**
 * One stretch on the strip:
 * - `person`: someone is followed here, in their colour;
 * - `lost`: nobody to follow (hatched), which can be selected;
 * - `fixed`: a lost stretch placed by hand (a small hand mark), which can be selected.
 */
export interface SpeakerStripStretch {
  key: string;
  kind: 'person' | 'lost' | 'fixed';
  /** The person's place, for their colour (`person` stretches). */
  person?: number | null;
  /** Where it sits and how long it is, in px from the track's left edge. */
  leftPx: number;
  widthPx: number;
  /** What a screen reader hears, e.g. "Person 1" or "We lost the speaker for 3 seconds here." */
  label: string;
  selected?: boolean;
}

export interface SpeakerStripProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onSelect'> {
  stretches: readonly SpeakerStripStretch[];
  /** The strip's name in the label column. */
  label?: string;
  /** The label column's width in px (the timeline rows'); 0 hides it. */
  labelWidthPx?: number;
  /** The track's width in px (the timeline's full length at this zoom). Fills the row when left out. */
  widthPx?: number;
  /** A lost or fixed stretch was pressed. */
  onSelect?: (key: string) => void;
}

/**
 * The Speaker strip (Sprint 13, Clips, Module 08): a thin row under a
 * timeline's Video row showing who the frame follows, stretch by stretch, and
 * where it lost them. Presentational: the parent places every stretch in px.
 * People's stretches are marks; lost and fixed ones are buttons, so the
 * keyboard reaches them.
 */
export function SpeakerStrip({
  stretches,
  label = 'Speaker',
  labelWidthPx = TIMELINE_LABEL_WIDTH_PX,
  widthPx,
  onSelect,
  className,
  ...props
}: SpeakerStripProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset is for form fields; this names a row of marks.
    <div role="group" aria-label={label} className={cn('flex items-stretch', className)} {...props}>
      {labelWidthPx > 0 ? (
        <div
          aria-hidden
          className="sticky left-0 z-10 flex shrink-0 items-center bg-inherit pr-2"
          style={{ width: labelWidthPx }}
        >
          <span className="truncate type-label text-xs text-ink">{label}</span>
        </div>
      ) : null}
      <div
        className={cn(
          'relative h-5 shrink-0 overflow-hidden rounded-sm border-2 border-outline bg-inset',
          widthPx === undefined && 'flex-1',
        )}
        style={widthPx === undefined ? undefined : { width: widthPx }}
      >
        {stretches.map((stretch) => {
          const place = { left: stretch.leftPx, width: Math.max(2, stretch.widthPx) };
          if (stretch.kind === 'person') {
            return (
              <span
                key={stretch.key}
                role="img"
                aria-label={stretch.label}
                title={stretch.label}
                data-kind="person"
                data-person={stretch.person ?? 0}
                className={cn(
                  'absolute inset-y-0 border-r-2 border-outline',
                  speakerStripTone(stretch.person ?? 0),
                )}
                style={place}
              />
            );
          }
          const fixed = stretch.kind === 'fixed';
          return (
            <button
              key={stretch.key}
              type="button"
              aria-label={stretch.label}
              aria-pressed={stretch.selected ?? false}
              title={stretch.label}
              data-kind={stretch.kind}
              onClick={() => onSelect?.(stretch.key)}
              className={cn(
                'absolute inset-y-0 z-[1] flex cursor-pointer items-center justify-center border-x-2 border-dashed border-outline',
                fixed ? 'bg-secondary' : 'bg-stripes bg-inset',
                'outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focusRing',
                stretch.selected && 'ring-2 ring-inset ring-actionPrimary',
              )}
              style={place}
            >
              {fixed ? (
                <Hand
                  aria-hidden="true"
                  data-mark="hand"
                  className="h-3 w-3 shrink-0 text-ink"
                  strokeWidth={2.5}
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
