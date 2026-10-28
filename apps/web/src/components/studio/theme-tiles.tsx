'use client';

/**
 * The Design tab's Theme section (DS-4.5, Sprint 9b): the themes one
 * collection at a time (Classic, Signature, Luxury, as the gallery's
 * Collection filter names them), each a tile drawing the slide on the canvas
 * in that theme.
 *
 * A tile is a whole slide drawn by the real renderer, so only one
 * collection's tiles are drawn at once, and they follow the design a beat
 * behind (`useDeferredValue`): React draws them once the typing that changed
 * the design has been shown, and drops a drawing the next keystroke
 * overtook. Each tile redraws only when what it shows changes.
 *
 * In a workspace whose plan does not include the Luxury collection, its tiles
 * still show, with the lock (`premium-lock.tsx`), and choosing one opens the
 * dialog that says why instead of applying it. The theme the design is on is
 * never locked, so a design made before a plan lapsed keeps its look.
 */
import {
  applyTheme,
  type DesignDocument,
  FORMATS,
  type PresetCollection,
  themeCollection,
} from '@postgear/design-engine';
import { cn, pressSm, TooltipHint } from '@postgear/ui';
import { Check } from 'lucide-react';
import { memo, useCallback, useDeferredValue, useId, useMemo, useState } from 'react';
import type { StudioMediaRef } from '@/types/studio';
import { FOCUS } from './design-card';
import { THEME_GROUPS } from './editor-panel-model';
import type { ApplyChange } from './editor-state';
import { PanelSection, Segmented, type SegmentOption, useChosenRing } from './panel-ui';
import { PREMIUM_LOCK_MESSAGE, PremiumLockMark } from './premium-lock';
import { isLookLocked, lookTileName } from './premium-model';
import { SlideFrame } from './slide-frame';
import { INSET } from './studio-ui';
import { mediaResolver } from './studio-view-model';

const COLLECTION_OPTIONS: readonly SegmentOption<PresetCollection>[] = THEME_GROUPS.map(
  (group) => ({ value: group.collection, label: group.label }),
);

export function ThemeSection({
  document,
  slideId,
  media,
  premium,
  onChange,
  onLocked,
}: {
  document: DesignDocument;
  /** The slide on the canvas, which the tiles draw. */
  slideId: string;
  media: Readonly<Record<string, StudioMediaRef>>;
  /** Whether the plan includes premium looks; null while that is not known (nothing is locked). */
  premium: boolean | null;
  onChange: ApplyChange;
  /** A locked theme was chosen: the editor opens the dialog that says why. */
  onLocked: () => void;
}) {
  const headingId = useId();
  // Opens on the design's own collection; after that, it stays where the person put it.
  const [collection, setCollection] = useState<PresetCollection>(() =>
    themeCollection(document.themeId),
  );
  const deferred = useDeferredValue(document);
  const resolveMedia = useMemo(() => mediaResolver(media, 'thumbnail'), [media]);
  const index = Math.max(
    0,
    deferred.slides.findIndex((slide) => slide.id === slideId),
  );
  const pick = useCallback(
    (themeId: string) => onChange((latest) => applyTheme(latest, themeId)),
    [onChange],
  );
  const group = THEME_GROUPS.find((entry) => entry.collection === collection) ?? THEME_GROUPS[0];

  return (
    <PanelSection title="Theme" headingId={headingId}>
      {COLLECTION_OPTIONS.length > 1 && group ? (
        <Segmented
          labelledBy={headingId}
          options={COLLECTION_OPTIONS}
          value={group.collection}
          onValueChange={setCollection}
        />
      ) : null}
      {group ? (
        <ul
          aria-label={`${group.label} Themes`}
          className="m-0 grid list-none grid-cols-2 gap-3 p-0"
        >
          {group.themes.map((theme) => {
            const current = theme.id === document.themeId;

            return (
              <li key={theme.id} className="min-w-0">
                <ThemeTile
                  design={deferred}
                  index={index}
                  themeId={theme.id}
                  name={theme.name}
                  current={current}
                  locked={isLookLocked(premium, theme, current)}
                  resolveMedia={resolveMedia}
                  onPick={pick}
                  onLocked={onLocked}
                />
              </li>
            );
          })}
        </ul>
      ) : null}
    </PanelSection>
  );
}

interface ThemeTileProps {
  design: DesignDocument;
  index: number;
  themeId: string;
  name: string;
  current: boolean;
  locked: boolean;
  resolveMedia: (mediaId: string) => string | null;
  onPick: (themeId: string) => void;
  onLocked: () => void;
}

/**
 * One theme, drawn on the slide by the real renderer. It redraws only when
 * what it shows changes: that slide, its number, or what every slide shares
 * (the brand, the handle, the format, the background art and the design's
 * fonts). The design's own theme is not among them, since the tile draws its
 * own.
 */
const ThemeTile = memo(
  function ThemeTile({
    design,
    index,
    themeId,
    name,
    current,
    locked,
    resolveMedia,
    onPick,
    onLocked,
  }: ThemeTileProps) {
    const ring = useChosenRing();
    const preview = useMemo(() => applyTheme(design, themeId), [design, themeId]);
    const spec = FORMATS[design.format];

    const tile = (
      <button
        type="button"
        aria-current={current ? 'true' : undefined}
        aria-label={locked ? lookTileName(name, true) : undefined}
        data-locked={locked ? 'true' : undefined}
        onClick={() => (locked ? onLocked() : onPick(themeId))}
        className={cn(
          'flex h-full w-full flex-col gap-2 rounded-card border-2 border-outline bg-secondary p-2 text-left',
          pressSm,
          FOCUS,
          current && ring,
        )}
      >
        <span
          className={cn(
            INSET,
            'relative flex aspect-square items-center justify-center bg-halftone p-2',
          )}
        >
          <span
            className="block border-2 border-outline shadow-brutalSm"
            style={{ width: `${Math.min(1, spec.width / spec.height) * 100}%` }}
          >
            <SlideFrame design={preview} index={index} resolveMedia={resolveMedia} lazy />
          </span>
          {locked ? <PremiumLockMark className="absolute start-1.5 top-1.5" /> : null}
        </span>
        <span className="flex min-w-0 items-center gap-1">
          {current ? (
            <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={3} />
          ) : null}
          <span className="min-w-0 type-ui text-xs text-ink wrap-anywhere">{name}</span>
        </span>
      </button>
    );

    return locked ? <TooltipHint label={PREMIUM_LOCK_MESSAGE}>{tile}</TooltipHint> : tile;
  },
  (before, after) =>
    before.index === after.index &&
    before.themeId === after.themeId &&
    before.name === after.name &&
    before.current === after.current &&
    before.locked === after.locked &&
    before.resolveMedia === after.resolveMedia &&
    before.onPick === after.onPick &&
    before.onLocked === after.onLocked &&
    before.design.slides[before.index] === after.design.slides[after.index] &&
    before.design.slides.length === after.design.slides.length &&
    before.design.format === after.design.format &&
    before.design.handle === after.design.handle &&
    before.design.brand === after.design.brand &&
    before.design.art === after.design.art &&
    before.design.fonts === after.design.fonts,
);
