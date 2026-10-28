'use client';

/**
 * The Design tab's Background Art section (Sprint 9b): None, then the art
 * styles of one group at a time (Patterns, Originals, Luxury), each tile the
 * art in the colours the slide on the canvas would draw it in. A brand kit,
 * a coloured slide and a theme's own art colours all show on the tiles as
 * they would on the slide (`artTileColors`).
 *
 * Cheap on purpose, since the tab is opened often. A tile is an `<img>` of
 * the art's SVG at the format's own size, the same string the slide on the
 * canvas draws, so the engine's cache (`artSvg`) serves both. The grid draws
 * again only when what decides the colours changes (the theme, the brand,
 * that slide's background, the format) or the group does, never as the
 * person types.
 *
 * The originals and the luxury set are premium. In a workspace whose plan
 * does not include them their tiles show the lock and open the dialog that
 * says why (`premium-lock.tsx`); the art the design is on is never locked.
 */
import {
  type ArtKind,
  type DesignBrand,
  type DesignDocument,
  FORMATS,
  type FormatId,
  type SlideBackground,
  setArt,
} from '@postgear/design-engine';
import { cn, pressSm, TooltipHint } from '@postgear/ui';
import { Check } from 'lucide-react';
import { type CSSProperties, memo, useCallback, useDeferredValue, useId, useState } from 'react';
import { FOCUS } from './design-card';
import {
  ART_GROUPS,
  artGroupOf,
  artTileColors,
  artTileGround,
  artTileSource,
} from './editor-panel-model';
import type { ApplyChange } from './editor-state';
import { NOTE, PanelSection, Segmented, type SegmentOption, useChosenRing } from './panel-ui';
import { PREMIUM_LOCK_MESSAGE, PremiumLockMark } from './premium-lock';
import { isLookLocked, lookTileName } from './premium-model';
import { INSET } from './studio-ui';

const GROUP_OPTIONS: readonly SegmentOption<ArtKind>[] = ART_GROUPS.map((group) => ({
  value: group.kind,
  label: group.label,
}));

export function ArtSection({
  document,
  slideId,
  premium,
  onChange,
  onLocked,
}: {
  document: DesignDocument;
  /** The slide on the canvas, whose colours the tiles are drawn in. */
  slideId: string;
  /** Whether the plan includes premium looks; null while that is not known (nothing is locked). */
  premium: boolean | null;
  onChange: ApplyChange;
  /** A locked style was chosen: the editor opens the dialog that says why. */
  onLocked: () => void;
}) {
  const headingId = useId();
  // Opens on the design's own art's group; after that, it stays where the person put it.
  const [kind, setKind] = useState<ArtKind>(() => artGroupOf(document.art));
  const deferred = useDeferredValue(document);
  const slide = deferred.slides.find((entry) => entry.id === slideId);
  const pick = useCallback(
    (id: string | null) => onChange((latest) => setArt(latest, id)),
    [onChange],
  );
  const group = ART_GROUPS.find((entry) => entry.kind === kind) ?? ART_GROUPS[0];

  return (
    <PanelSection title="Background Art" headingId={headingId}>
      {GROUP_OPTIONS.length > 1 && group ? (
        <Segmented
          labelledBy={headingId}
          options={GROUP_OPTIONS}
          value={group.kind}
          onValueChange={setKind}
        />
      ) : null}
      {group ? (
        <ArtGrid
          themeId={deferred.themeId}
          brand={deferred.brand}
          background={slide?.background ?? null}
          format={deferred.format}
          kind={group.kind}
          current={document.art}
          premium={premium}
          onPick={pick}
          onLocked={onLocked}
        />
      ) : null}
      {slide?.background.kind === 'media' ? (
        <p className={NOTE}>Slides with a photo background show no art.</p>
      ) : null}
    </PanelSection>
  );
}

interface ArtGridProps {
  themeId: string;
  brand: DesignBrand;
  /** The background of the slide on the canvas, or null when it has gone. */
  background: SlideBackground | null;
  format: FormatId;
  kind: ArtKind;
  /** The design's art, or null for None. */
  current: string | null;
  premium: boolean | null;
  onPick: (id: string | null) => void;
  onLocked: () => void;
}

/**
 * None and one group's tiles. Memoised on everything it draws from: the
 * brand and the background keep their identity while words are typed, so
 * typing never draws the art again.
 */
const ArtGrid = memo(function ArtGrid({
  themeId,
  brand,
  background,
  format,
  kind,
  current,
  premium,
  onPick,
  onLocked,
}: ArtGridProps) {
  const group = ART_GROUPS.find((entry) => entry.kind === kind);
  if (!group) return null;

  const design = { themeId, brand };
  const slide = background ? { background } : undefined;
  const spec = FORMATS[format];
  const shape: CSSProperties = {
    width: `${Math.min(1, spec.width / spec.height) * 100}%`,
    aspectRatio: `${spec.width} / ${spec.height}`,
    background: artTileGround(design, slide),
  };

  return (
    <ul aria-label={`${group.label} Art`} className="m-0 grid list-none grid-cols-3 gap-2 p-0">
      <li className="min-w-0">
        <ArtTile
          name="None"
          src={null}
          shape={shape}
          current={current === null}
          locked={false}
          onChoose={() => onPick(null)}
        />
      </li>
      {group.arts.map((art) => {
        const chosen = art.id === current;
        const locked = isLookLocked(premium, art, chosen);

        return (
          <li key={art.id} className="min-w-0">
            <ArtTile
              name={art.name}
              src={artTileSource(art, artTileColors(design, slide, art), format)}
              shape={shape}
              current={chosen}
              locked={locked}
              onChoose={() => (locked ? onLocked() : onPick(art.id))}
            />
          </li>
        );
      })}
    </ul>
  );
});

/** One art style (or None) drawn on the slide's ground, with its name. */
function ArtTile({
  name,
  src,
  shape,
  current,
  locked,
  onChoose,
}: {
  name: string;
  /** The drawing as a data URI; null for None, which is the ground alone. */
  src: string | null;
  /** The format's shape, painted the ground the slide is painted. */
  shape: CSSProperties;
  current: boolean;
  locked: boolean;
  onChoose: () => void;
}) {
  const ring = useChosenRing();

  const tile = (
    <button
      type="button"
      aria-current={current ? 'true' : undefined}
      aria-label={locked ? lookTileName(name, true) : undefined}
      data-locked={locked ? 'true' : undefined}
      onClick={onChoose}
      className={cn(
        'flex h-full w-full flex-col gap-1.5 rounded-card border-2 border-outline bg-secondary p-1.5 text-left',
        pressSm,
        FOCUS,
        current && ring,
      )}
    >
      <span
        className={cn(
          INSET,
          'relative flex aspect-square items-center justify-center bg-halftone p-1.5',
        )}
      >
        <span className="block overflow-hidden border-2 border-outline" style={shape}>
          {src ? (
            // biome-ignore lint/performance/noImgElement: an SVG drawn here as a data URI, never Next's optimizer
            <img src={src} alt="" decoding="async" className="block h-full w-full" />
          ) : null}
        </span>
        {locked ? <PremiumLockMark className="absolute start-1 top-1" /> : null}
      </span>
      <span className="flex min-w-0 items-center gap-1">
        {current ? (
          <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={3} />
        ) : null}
        <span className="min-w-0 type-ui text-xs leading-tight text-ink wrap-anywhere">{name}</span>
      </span>
    </button>
  );

  return locked ? <TooltipHint label={PREMIUM_LOCK_MESSAGE}>{tile}</TooltipHint> : tile;
}
