'use client';

/**
 * A real slide in a brand's colours and logo, redrawn as they change.
 *
 * "Show, don't ask" (rule 2): the brand kit form and the wizard's brand step
 * show what a kit looks like on a slide rather than five swatches alone. The
 * slide is a template's own, drawn by the same renderer as everything else;
 * its ids are fixed, so typing in a colour field updates the slide in place
 * instead of building a new one. A kit's fonts (Sprint 9b) draw it too, as
 * a design using the kit would.
 */
import {
  BRAND_COLOR_KEYS,
  type BrandColors,
  type DesignFonts,
  documentFromPreset,
  type FormatId,
} from '@postgear/design-engine';
import { cn } from '@postgear/ui';
import { useCallback, useMemo } from 'react';
import { SlideFrame } from './slide-frame';
import { COLOR_LABELS } from './studio-view-model';

/** "5 Simple Steps": a cover with the brand's name, logo and every colour role. */
export const KIT_PREVIEW_PRESET_ID = 'tips-steps-ink';

/** Stands in for the logo's media id: the logo may not be uploaded yet. */
const PREVIEW_LOGO_ID = 'kit-preview-logo';

export function KitPreview({
  name,
  colors,
  logoUrl,
  fonts = null,
  presetId = KIT_PREVIEW_PRESET_ID,
  format = 'square',
  index = 0,
  lazy,
  label,
  className,
}: {
  name: string;
  /** Valid colours only: the caller falls back for a field still being typed. */
  colors: BrandColors;
  logoUrl: string | null;
  /** The kit's heading and body fonts; null, or a null face, keeps the template's. */
  fonts?: DesignFonts | null;
  presetId?: string;
  format?: FormatId;
  index?: number;
  lazy?: boolean;
  label?: string;
  className?: string;
}) {
  const colorKey = BRAND_COLOR_KEYS.map((key) => colors[key]).join(',');
  const brandName = name.trim() || null;
  const hasLogo = logoUrl !== null;
  const heading = fonts?.heading ?? null;
  const body = fonts?.body ?? null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: colorKey stands for colors, which is a new object on every render
  const design = useMemo(() => {
    let next = 0;

    return documentFromPreset({
      presetId,
      format,
      brand: {
        kitId: null,
        kitVersion: null,
        colors: { ...colors },
        logoMediaId: hasLogo ? PREVIEW_LOGO_ID : null,
        name: brandName,
        fonts: heading || body ? { heading, body } : null,
      },
      newId: () => `kit-preview-${next++}`,
    });
  }, [presetId, format, colorKey, hasLogo, brandName, heading, body]);

  const resolveMedia = useCallback(
    (id: string) => (id === PREVIEW_LOGO_ID ? logoUrl : null),
    [logoUrl],
  );

  return (
    <SlideFrame
      design={design}
      index={index}
      resolveMedia={resolveMedia}
      lazy={lazy}
      label={label}
      className={className}
    />
  );
}

/**
 * A kit's five colours as swatches, always in the same order, each named
 * with its hex for screen readers and in its tooltip. The names are not
 * printed: five of them do not fit under swatches this narrow ("Background"
 * came out as "Bac..."). `relative` keeps the hidden names inside a list
 * that scrolls sideways, rather than widening the page.
 */
export function KitSwatches({ colors, className }: { colors: BrandColors; className?: string }) {
  return (
    <ul className={cn('m-0 grid list-none grid-cols-5 gap-2 p-0', className)}>
      {BRAND_COLOR_KEYS.map((key) => (
        <li key={key} className="relative min-w-0" title={`${COLOR_LABELS[key]} ${colors[key]}`}>
          <span
            aria-hidden="true"
            className="block h-8 w-full rounded-md border-2 border-outline"
            style={{ background: colors[key] }}
          />
          <span className="sr-only">
            {COLOR_LABELS[key]} {colors[key]}
          </span>
        </li>
      ))}
    </ul>
  );
}
