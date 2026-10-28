'use client';

/**
 * The Design tab of the editor's properties panel (Sprint 9, DS-4.5 and
 * DS-2.5; Sprint 9b): what every slide of the design shares.
 *
 * - Theme and Background Art: tiles drawn in the design's own colours, one
 *   collection or group at a time (`theme-tiles.tsx`, `art-tiles.tsx`).
 *   Premium looks a plan does not include show the lock.
 * - Brand kit: apply one, or none. A kit deleted since says so, and the
 *   design keeps its colours and logo; a kit edited since offers Update
 *   Colours, and never changes the design on its own (section 5, DS-2.5).
 * - Custom Colours: the five colours every slide is drawn in, the design's
 *   own from here on, with the way back to its kit's or its theme's.
 * - Fonts: a heading and a body face for the whole design, over the kit's
 *   and the theme's, with every family's licence one click away.
 * - The brand name and the handle every slide shows, typed once.
 * - Format: the design's shape, changed in place (a layout without that
 *   shape says so), or Make A Story Version, a 9:16 copy opened beside it.
 *
 * While the brand kit locks the design's look (`useBrandLookLocked`), Custom
 * Colours and Fonts are left out and one sentence says why; the kit's
 * colours show in the Brand Kit section instead.
 */
import { CopyPlusIcon } from '@animateicons/react/lucide/copy-plus-icon';
import { RefreshCwIcon } from '@animateicons/react/lucide/refresh-cw-icon';
import { RotateCcwIcon } from '@animateicons/react/lucide/rotate-ccw-icon';
import {
  BRAND_COLOR_KEYS,
  type DesignDocument,
  detachBrandKit,
  isFormatId,
  MAX_BRAND_NAME_LENGTH,
  MAX_HANDLE_LENGTH,
  setBrandName,
  setFormat,
  setHandle,
} from '@postgear/design-engine';
import {
  Alert,
  AlertDescription,
  Button,
  FormField,
  FormHelperText,
  FormLabel,
  Input,
  MotionIcon,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
} from '@postgear/ui';
import { useId, useState } from 'react';
import type { BrandKitView, StudioMediaRef } from '@/types/studio';
import { ArtSection } from './art-tiles';
import {
  colorResetOf,
  DESIGN_LOCK_NOTE,
  designColors,
  designFontDefault,
  designFontOf,
  designTextReads,
  formatChoices,
  hasOwnFonts,
  kitSelectValue,
  NO_KIT,
  offersStoryVersion,
  TYPE_FACES,
  withColorReset,
  withDesignColor,
  withDesignFont,
  withKit,
  withKitFonts,
  withKitUpdate,
} from './editor-panel-model';
import type { ApplyChange } from './editor-state';
import { FontLicencesDialog } from './font-licences-dialog';
import { FontSelect } from './font-select';
import { KitSwatches } from './kit-preview';
import {
  COLOR_ROWS,
  CustomColorField,
  GroupLabel,
  NOTE,
  PanelSection,
  useBrandLookLocked,
} from './panel-ui';
import type { StoryVersionResult } from './studio-editor-model';
import { COLOR_LABELS, formatHint, kitNotice } from './studio-view-model';
import { ThemeSection } from './theme-tiles';

export interface DesignPanelProps {
  document: DesignDocument;
  /** The slide on the canvas, which the theme and art tiles draw. */
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
  /** Whether the plan includes premium looks; null while that is not known (nothing is locked). */
  premium: boolean | null;
  /** A locked look was chosen: the editor opens the dialog that says why. */
  onPremiumLocked: () => void;
  /** Saves, has the API copy the design as a story, and opens the copy. */
  onMakeStoryVersion: () => Promise<StoryVersionResult>;
}

/** The Design tab: theme, art, brand kit, colours, fonts, brand name and handle, format. */
export function DesignPanel({
  document,
  slideId,
  media,
  kits,
  kitsError,
  onReloadKits,
  onChange,
  onKitApplied,
  premium,
  onPremiumLocked,
  onMakeStoryVersion,
}: DesignPanelProps) {
  const locked = useBrandLookLocked();

  return (
    <div className="flex flex-col gap-6">
      <ThemeSection
        document={document}
        slideId={slideId}
        media={media}
        premium={premium}
        onChange={onChange}
        onLocked={onPremiumLocked}
      />
      <ArtSection
        document={document}
        slideId={slideId}
        premium={premium}
        onChange={onChange}
        onLocked={onPremiumLocked}
      />
      <BrandKitSection
        document={document}
        kits={kits}
        kitsError={kitsError}
        locked={locked}
        onReloadKits={onReloadKits}
        onChange={onChange}
        onKitApplied={onKitApplied}
      />
      {locked ? null : <ColorsSection document={document} kits={kits} onChange={onChange} />}
      {locked ? null : <FontsSection document={document} onChange={onChange} />}
      <NameSection document={document} onChange={onChange} />
      <FormatSection
        document={document}
        onChange={onChange}
        onMakeStoryVersion={onMakeStoryVersion}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Brand kit
// ---------------------------------------------------------------------------

/**
 * Apply a brand kit, or none (DS-2.5). The design keeps a copy of the kit's
 * colours, logo and fonts, so a kit deleted or edited since never changes it
 * on its own: the panel says what happened and, for an edit, offers Update
 * From Kit, which takes the kit's fonts along. Under a kit that locks the
 * look, a design that still has fonts of its own (chosen before the kit was
 * locked) is offered Use Kit Fonts.
 */
function BrandKitSection({
  document,
  kits,
  kitsError,
  locked,
  onReloadKits,
  onChange,
  onKitApplied,
}: {
  document: DesignDocument;
  kits: BrandKitView[] | null;
  kitsError: string | null;
  /** The kit locks the design's look: say so, and show its colours here. */
  locked: boolean;
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
    onChange((latest) => withKit(latest, kit));
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
            onClick={() => onChange((latest) => withKitUpdate(latest, newer))}
          >
            <MotionIcon icon={RefreshCwIcon} className="h-4 w-4" />
            Update From Kit
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

      {/* Unlocked, Custom Colours shows the five and changes them. */}
      {locked ? <p className={NOTE}>{DESIGN_LOCK_NOTE}</p> : null}
      {locked && hasOwnFonts(document) ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={NOTE}>This design still has fonts of its own.</p>
          <Button variant="secondary" size="sm" onClick={() => onChange(withKitFonts)}>
            <MotionIcon icon={RotateCcwIcon} className="h-4 w-4" />
            Use Kit Fonts
          </Button>
        </div>
      ) : null}
      {locked && colors ? (
        <div className="flex flex-col gap-2">
          <GroupLabel>Brand Colours</GroupLabel>
          <KitSwatches colors={colors} />
        </div>
      ) : null}
    </PanelSection>
  );
}

// ---------------------------------------------------------------------------
// Custom Colours
// ---------------------------------------------------------------------------

/**
 * The five colours every slide is drawn in. A change makes them the design's
 * own: on a kit it stays on that kit (and Update From Kit still offers the
 * kit's newer ones), with Use Kit Colours to go back; on no kit, Use Theme
 * Colours goes back to the theme's. Typing in one field is one undo step per
 * burst, as everywhere in the editor.
 */
function ColorsSection({
  document,
  kits,
  onChange,
}: {
  document: DesignDocument;
  kits: BrandKitView[] | null;
  onChange: ApplyChange;
}) {
  const colors = designColors(document);
  const reset = colorResetOf(document.brand, kits);

  return (
    <PanelSection
      title="Custom Colours"
      aside={
        reset ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onChange((latest) => withColorReset(latest, reset))}
          >
            <MotionIcon icon={RotateCcwIcon} className="h-4 w-4" />
            {reset.kind === 'kit' ? 'Use Kit Colours' : 'Use Theme Colours'}
          </Button>
        ) : null
      }
    >
      <div className={COLOR_ROWS}>
        {BRAND_COLOR_KEYS.map((key) => (
          <CustomColorField
            key={key}
            label={COLOR_LABELS[key]}
            labelBeside
            value={colors[key]}
            onApply={(hex) =>
              onChange((latest) => withDesignColor(latest, key, hex), {
                coalesceKey: `designColor:${key}`,
              })
            }
          />
        ))}
      </div>
      {designTextReads(colors) ? null : (
        <Alert variant="warning" role="status">
          <AlertDescription>
            This text colour is hard to read on this background, so the slides use a readable one
            instead.
          </AlertDescription>
        </Alert>
      )}
    </PanelSection>
  );
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

/**
 * A heading and a body face for the whole design. Each picker's first option
 * is what the design falls back to: the brand kit's face where the kit sets
 * one, else the theme's. An element's own font (Element tab) wins over both.
 */
function FontsSection({ document, onChange }: { document: DesignDocument; onChange: ApplyChange }) {
  const baseId = useId();

  return (
    <PanelSection title="Fonts" aside={<FontLicencesDialog />}>
      {TYPE_FACES.map(({ face, label }) => {
        const id = `${baseId}-${face}`;

        return (
          <FormField key={face}>
            <FormLabel htmlFor={id}>{label}</FormLabel>
            <FontSelect
              id={id}
              value={designFontOf(document, face)}
              defaultLabel={designFontDefault(document.brand, face)}
              onChange={(font) => onChange((latest) => withDesignFont(latest, face, font))}
            />
          </FormField>
        );
      })}
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

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

/**
 * The design's shape, changed in place and undone like any edit. A format a
 * slide's layout cannot be drawn in is offered disabled, with the reason.
 * Make A Story Version keeps this design as it is: the API copies it as a
 * story and the editor opens the copy, or says inline why it could not.
 */
function FormatSection({
  document,
  onChange,
  onMakeStoryVersion,
}: {
  document: DesignDocument;
  onChange: ApplyChange;
  onMakeStoryVersion: () => Promise<StoryVersionResult>;
}) {
  const selectId = useId();
  const hintId = useId();
  const [making, setMaking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function makeStoryVersion() {
    if (making) return;
    setMaking(true);
    setProblem(null);

    const result = await onMakeStoryVersion();
    // On its way to the copy: the button stays busy until the editor goes.
    if (result.opening) return;
    setMaking(false);
    setProblem(result.problem);
  }

  return (
    <PanelSection title="Format">
      <FormField>
        <FormLabel htmlFor={selectId}>Change the format</FormLabel>
        <Select
          value={document.format}
          onValueChange={(next) => {
            if (isFormatId(next)) onChange((latest) => setFormat(latest, next));
          }}
        >
          <SelectTrigger id={selectId} aria-describedby={hintId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {formatChoices(document).map((choice) => (
              <SelectItem
                key={choice.format}
                value={choice.format}
                disabled={choice.reason !== null}
              >
                {choice.reason ? (
                  <span className="flex flex-col">
                    <span>{choice.label}</span>
                    <span className="font-sans text-xs">{choice.reason}</span>
                  </span>
                ) : (
                  choice.label
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FormHelperText id={hintId}>{formatHint(document.format)}</FormHelperText>
      </FormField>

      {offersStoryVersion(document.format) ? (
        <div className="flex flex-col gap-2">
          <p className={NOTE}>Makes a 9:16 copy and opens it. This design stays as it is.</p>
          <Button
            variant="secondary"
            size="sm"
            disabled={making}
            onClick={makeStoryVersion}
            className="self-start"
          >
            {making ? (
              <Spinner
                size="sm"
                role="presentation"
                aria-hidden="true"
                className="motion-reduce:animate-none"
              />
            ) : (
              <MotionIcon icon={CopyPlusIcon} className="h-4 w-4" />
            )}
            Make A Story Version
          </Button>
          {problem ? (
            <Alert variant="danger" role="alert">
              <AlertDescription>{problem}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : null}
    </PanelSection>
  );
}
