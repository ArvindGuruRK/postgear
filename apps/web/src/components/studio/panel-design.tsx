'use client';

/**
 * The Design tab of the editor's properties panel (Sprint 9, DS-4.5 and
 * DS-2.5): what every slide of the design shares.
 *
 * - Theme: every theme as a tile drawing the slide on the canvas in it. The
 *   tiles follow the design a beat behind (`useDeferredValue`) and each one
 *   redraws only when what it shows changes, so typing stays smooth.
 * - Brand kit: apply one, or none. A kit deleted since says so, and the
 *   design keeps its colours and logo; a kit edited since offers Update
 *   Colours, and never changes the design on its own (section 5, DS-2.5).
 * - The brand name and the handle every slide shows, typed once.
 * - The format, for information (its name, ratio and export size): it is
 *   chosen when a design is created.
 */
import { RefreshCwIcon } from '@animateicons/react/lucide/refresh-cw-icon';
import {
  applyBrandKit,
  applyTheme,
  type DesignDocument,
  detachBrandKit,
  FORMATS,
  MAX_BRAND_NAME_LENGTH,
  MAX_HANDLE_LENGTH,
  setBrandName,
  setHandle,
  THEMES,
  updateBrandColors,
} from '@postgear/design-engine';
import {
  Alert,
  AlertDescription,
  Button,
  cn,
  FormField,
  FormHelperText,
  FormLabel,
  Input,
  MotionIcon,
  pressSm,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@postgear/ui';
import { Check } from 'lucide-react';
import { memo, useCallback, useDeferredValue, useId, useMemo } from 'react';
import type { BrandKitView, StudioMediaRef } from '@/types/studio';
import { FOCUS } from './design-card';
import { kitSelectValue, NO_KIT } from './editor-panel-model';
import type { ApplyChange } from './editor-state';
import { KitSwatches } from './kit-preview';
import { GroupLabel, NOTE, PanelSection, useChosenRing } from './panel-ui';
import { SlideFrame } from './slide-frame';
import { INSET } from './studio-ui';
import {
  brandFromKitView,
  formatHint,
  formatName,
  kitNotice,
  mediaResolver,
} from './studio-view-model';

export interface DesignPanelProps {
  document: DesignDocument;
  /** The slide on the canvas, which the theme tiles draw. */
  slideId: string;
  /** Every picture the design draws, by media id. */
  media: Readonly<Record<string, StudioMediaRef>>;
  /** Null while loading or after a failed load. */
  kits: BrandKitView[] | null;
  kitsError: string | null;
  onReloadKits: () => void;
  onChange: ApplyChange;
  /** A kit was applied: the editor adds its logo to the pictures it knows. */
  onKitApplied: (kit: BrandKitView) => void;
}

/** The Design tab: theme, brand kit, brand name and handle, format. */
export function DesignPanel({
  document,
  slideId,
  media,
  kits,
  kitsError,
  onReloadKits,
  onChange,
  onKitApplied,
}: DesignPanelProps) {
  return (
    <div className="flex flex-col gap-6">
      <ThemeSection document={document} slideId={slideId} media={media} onChange={onChange} />
      <BrandKitSection
        document={document}
        kits={kits}
        kitsError={kitsError}
        onReloadKits={onReloadKits}
        onChange={onChange}
        onKitApplied={onKitApplied}
      />
      <NameSection document={document} onChange={onChange} />
      <PanelSection title="Format">
        <p className="m-0 type-ui text-sm text-ink">{formatName(document.format)}</p>
        <p className={NOTE}>{formatHint(document.format)}</p>
        <p className={NOTE}>The format is chosen when a design is created.</p>
      </PanelSection>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

/** Every theme, each drawn on the slide on the canvas (DS-4.5). */
function ThemeSection({
  document,
  slideId,
  media,
  onChange,
}: {
  document: DesignDocument;
  slideId: string;
  media: Readonly<Record<string, StudioMediaRef>>;
  onChange: ApplyChange;
}) {
  const headingId = useId();
  // The tiles draw this, a beat behind the design: React draws them when the
  // typing that changed it has been shown, and drops a drawing overtaken by
  // the next keystroke.
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

  return (
    <PanelSection title="Theme" headingId={headingId}>
      <ul aria-labelledby={headingId} className="m-0 grid list-none grid-cols-2 gap-3 p-0">
        {THEMES.map((theme) => (
          <li key={theme.id} className="min-w-0">
            <ThemeTile
              design={deferred}
              index={index}
              themeId={theme.id}
              name={theme.name}
              current={theme.id === document.themeId}
              resolveMedia={resolveMedia}
              onPick={pick}
            />
          </li>
        ))}
      </ul>
    </PanelSection>
  );
}

interface ThemeTileProps {
  design: DesignDocument;
  index: number;
  themeId: string;
  name: string;
  current: boolean;
  resolveMedia: (mediaId: string) => string | null;
  onPick: (themeId: string) => void;
}

/**
 * One theme, drawn on the slide by the real renderer. It redraws only when
 * what it shows changes: that slide, its number, or the brand, handle or
 * format every slide shares. The design's own theme is not among them, since
 * the tile draws its own.
 */
const ThemeTile = memo(
  function ThemeTile({
    design,
    index,
    themeId,
    name,
    current,
    resolveMedia,
    onPick,
  }: ThemeTileProps) {
    const ring = useChosenRing();
    const preview = useMemo(() => applyTheme(design, themeId), [design, themeId]);
    const spec = FORMATS[design.format];

    return (
      <button
        type="button"
        aria-current={current ? 'true' : undefined}
        onClick={() => onPick(themeId)}
        className={cn(
          'flex w-full flex-col gap-2 rounded-card border-2 border-outline bg-secondary p-2 text-left',
          pressSm,
          FOCUS,
          current && ring,
        )}
      >
        <span
          className={cn(INSET, 'flex aspect-square items-center justify-center bg-halftone p-2')}
        >
          <span
            className="block border-2 border-outline shadow-brutalSm"
            style={{ width: `${Math.min(1, spec.width / spec.height) * 100}%` }}
          >
            <SlideFrame design={preview} index={index} resolveMedia={resolveMedia} lazy />
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1">
          {current ? (
            <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={3} />
          ) : null}
          <span className="min-w-0 type-ui text-xs text-ink wrap-anywhere">{name}</span>
        </span>
      </button>
    );
  },
  (before, after) =>
    before.index === after.index &&
    before.themeId === after.themeId &&
    before.name === after.name &&
    before.current === after.current &&
    before.resolveMedia === after.resolveMedia &&
    before.onPick === after.onPick &&
    before.design.slides[before.index] === after.design.slides[after.index] &&
    before.design.slides.length === after.design.slides.length &&
    before.design.format === after.design.format &&
    before.design.handle === after.design.handle &&
    before.design.brand === after.design.brand,
);

// ---------------------------------------------------------------------------
// Brand kit
// ---------------------------------------------------------------------------

/**
 * Apply a brand kit, or none (DS-2.5). The design keeps a copy of the kit's
 * colours and logo, so a kit deleted or edited since never changes it on its
 * own: the panel says what happened and, for an edit, offers Update Colours.
 */
function BrandKitSection({
  document,
  kits,
  kitsError,
  onReloadKits,
  onChange,
  onKitApplied,
}: {
  document: DesignDocument;
  kits: BrandKitView[] | null;
  kitsError: string | null;
  onReloadKits: () => void;
  onChange: ApplyChange;
  onKitApplied: (kit: BrandKitView) => void;
}) {
  const selectId = useId();
  const notice = kitNotice(document.brand, kits);
  const newer = notice?.kind === 'newer' ? notice.kit : null;
  const colors = document.brand.colors;

  const choose = (value: string) => {
    if (value === NO_KIT) {
      onChange(detachBrandKit);
      return;
    }
    const kit = kits?.find((entry) => entry.id === value);
    if (!kit) return;

    onKitApplied(kit);
    onChange((latest) => applyBrandKit(latest, brandFromKitView(kit)));
  };

  return (
    <PanelSection title="Brand Kit">
      {notice?.kind === 'deleted' ? (
        <Alert variant="info" role="status" className="flex-col gap-1">
          <AlertDescription>This brand kit was deleted.</AlertDescription>
          <AlertDescription>The design keeps its colours and logo.</AlertDescription>
        </Alert>
      ) : null}

      {newer ? (
        <Alert variant="info" role="status" className="flex-wrap items-center justify-between">
          <AlertDescription>A newer version of this brand kit is available.</AlertDescription>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              onChange((latest) =>
                latest.brand.kitId === newer.id
                  ? updateBrandColors(latest, newer.colors, newer.updatedAt)
                  : latest,
              )
            }
          >
            <MotionIcon icon={RefreshCwIcon} className="h-4 w-4" />
            Update Colours
          </Button>
        </Alert>
      ) : null}

      {kitsError ? (
        <Alert variant="danger" className="flex-wrap items-center justify-between">
          <AlertDescription>{kitsError}</AlertDescription>
          <Button variant="secondary" size="sm" onClick={onReloadKits}>
            Try Again
          </Button>
        </Alert>
      ) : kits === null ? (
        <div role="status" aria-label="Loading brand kits" className="flex flex-col gap-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : (
        <>
          {kits.length === 0 ? (
            <p className={NOTE}>
              No brand kits yet. Create one on the Studio page to use your logo and colours here.
            </p>
          ) : null}
          {/* A design still on a deleted kit keeps the picker, so No Brand Kit stays in reach. */}
          {kits.length > 0 || document.brand.kitId ? (
            <FormField>
              <FormLabel htmlFor={selectId}>Apply a brand kit</FormLabel>
              <Select value={kitSelectValue(document.brand, kits)} onValueChange={choose}>
                <SelectTrigger id={selectId}>
                  <SelectValue placeholder="Choose a brand kit" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_KIT}>No Brand Kit</SelectItem>
                  {kits.map((kit) => (
                    <SelectItem key={kit.id} value={kit.id}>
                      {kit.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          ) : null}
        </>
      )}

      {colors ? (
        <div className="flex flex-col gap-2">
          <GroupLabel>Brand Colours</GroupLabel>
          <KitSwatches colors={colors} />
        </div>
      ) : null}
    </PanelSection>
  );
}

// ---------------------------------------------------------------------------
// Brand name and handle
// ---------------------------------------------------------------------------

/** The brand name and handle every slide shows, typed once for the whole design. */
function NameSection({ document, onChange }: { document: DesignDocument; onChange: ApplyChange }) {
  const nameId = useId();
  const handleId = useId();
  const hintId = useId();

  return (
    <PanelSection title="Name And Handle">
      <FormField>
        <FormLabel htmlFor={nameId}>Brand name</FormLabel>
        <Input
          id={nameId}
          value={document.brand.name ?? ''}
          maxLength={MAX_BRAND_NAME_LENGTH}
          placeholder="Enter your brand name"
          autoComplete="off"
          aria-describedby={hintId}
          onChange={(event) => {
            const name = event.target.value;
            onChange((latest) => setBrandName(latest, name), { coalesceKey: 'brandName' });
          }}
        />
      </FormField>
      <FormField>
        <FormLabel htmlFor={handleId}>Handle</FormLabel>
        <Input
          id={handleId}
          value={document.handle}
          maxLength={MAX_HANDLE_LENGTH}
          placeholder="Enter your handle"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={hintId}
          onChange={(event) => {
            const handle = event.target.value;
            onChange((latest) => setHandle(latest, handle), { coalesceKey: 'handle' });
          }}
        />
      </FormField>
      <FormHelperText id={hintId}>
        Every slide that shows a brand name or a handle uses these.
      </FormHelperText>
    </PanelSection>
  );
}
