'use client';

/**
 * The Slide tab of the editor's properties panel (Sprint 9, DS-4.5 to
 * DS-4.7): the slide on the canvas as a whole.
 *
 * - Layout: the layout's name and Change Layout, which opens the picker.
 * - Background: the brand's five colours as the slide would be painted,
 *   Custom (a hex of the person's own, one click deeper) and Photo, which
 *   opens the media library. A photo shows its preview and name, Replace and
 *   Remove, and a Darkening slider; below the level white text needs to read
 *   on any photo, the panel says so and offers to darken it. A photo deleted
 *   from the media library says so, with the way to choose another.
 * - A photo's Tint (Sprint 9b): Dark lays the overlay in black under light
 *   text, Light in white under dark text, and the slider and its warning
 *   say Lightening then. Apply To All Slides puts the photo, its overlay
 *   and its tint behind every slide (`slide-panel-model.ts`). Both are
 *   ordinary edits, so Undo takes either back.
 * - Elements: every optional element, ticked when it shows on the slide.
 */
import { ImagePlusIcon } from '@animateicons/react/lucide/image-plus-icon';
import { LayersIcon } from '@animateicons/react/lucide/layers-icon';
import { LayoutGridIcon } from '@animateicons/react/lucide/layout-grid-icon';
import { SunDimIcon } from '@animateicons/react/lucide/sun-dim-icon';
import { SunIcon } from '@animateicons/react/lucide/sun-icon';
import { XIcon } from '@animateicons/react/lucide/x-icon';
import {
  applyPhotoToAllSlides,
  type DesignDocument,
  type DesignSlide,
  normalizeHex,
  photoNeedsDarkening,
  SAFE_PHOTO_OVERLAY,
  type SlideLayout,
} from '@postgear/design-engine';
import { Alert, AlertDescription, Button, Checkbox, Label, MotionIcon } from '@postgear/ui';
import { useId } from 'react';
import type { StudioMediaRef } from '@/types/studio';
import type { MediaPurpose } from './editor-panel';
import {
  backgroundChoiceOf,
  backgroundSwatches,
  findSlide,
  mediaOf,
  optionalSlots,
  overlayPercent,
  PHOTO_BACKGROUND,
  withBackgroundChoice,
  withCustomBackground,
  withOverlay,
  withPhotoRemoved,
  withSafeOverlay,
  withShown,
} from './editor-panel-model';
import type { ApplyChange } from './editor-state';
import {
  CustomColorField,
  GroupLabel,
  NOTE,
  PanelSection,
  PercentSlider,
  PictureMissing,
  PictureRow,
  Segmented,
  type SwatchChoice,
  SwatchPicker,
  useBrandLookLocked,
} from './panel-ui';
import { canApplyPhotoToAll, TINT_OPTIONS, tintOf, tintWords, withTint } from './slide-panel-model';

const ICON = 'h-4 w-4';

export interface SlidePanelProps {
  document: DesignDocument;
  /** The slide on the canvas. */
  slideId: string;
  /** Every picture the design draws, by media id; a missing id is a deleted picture. */
  media: Readonly<Record<string, StudioMediaRef>>;
  onChange: ApplyChange;
  onPickMedia: (purpose: MediaPurpose) => void;
  /** Opens the layout picker for this slide. */
  onChangeLayout: () => void;
}

/** The Slide tab: layout, background and the elements a slide may hide. */
export function SlidePanel({
  document,
  slideId,
  media,
  onChange,
  onPickMedia,
  onChangeLayout,
}: SlidePanelProps) {
  const found = findSlide(document, slideId);
  if (!found) return <p className={NOTE}>This slide is no longer in the design.</p>;

  const { slide, layout } = found;

  return (
    <div className="flex flex-col gap-6">
      <PanelSection title="Layout">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="m-0 min-w-0 type-ui text-sm text-ink">
            {layout?.name ?? 'Layout not available'}
          </p>
          <Button variant="secondary" size="sm" onClick={onChangeLayout}>
            <MotionIcon icon={LayoutGridIcon} className={ICON} />
            Change Layout
          </Button>
        </div>
      </PanelSection>

      <BackgroundSection
        document={document}
        slide={slide}
        media={media}
        onChange={onChange}
        onPickMedia={onPickMedia}
      />

      {layout ? <ElementsSection slide={slide} layout={layout} onChange={onChange} /> : null}
    </div>
  );
}

/** A colour role, a hex of the person's own, or a photo behind the slide (DS-4.5, DS-4.6). */
function BackgroundSection({
  document,
  slide,
  media,
  onChange,
  onPickMedia,
}: {
  document: DesignDocument;
  slide: DesignSlide;
  media: Readonly<Record<string, StudioMediaRef>>;
  onChange: ApplyChange;
  onPickMedia: (purpose: MediaPurpose) => void;
}) {
  const headingId = useId();
  const tintId = useId();
  const slideId = slide.id;
  const { background } = slide;
  const photo = background.kind === 'media' ? mediaOf(media, background.mediaId) : null;
  const pickPhoto = () => onPickMedia({ kind: 'background', slideId });
  const tint = tintOf(background);
  const words = tintWords(tint);
  const several = document.slides.length > 1;
  const canApplyToAll = canApplyPhotoToAll(document, slideId);
  // A brand kit with Lock Brand Look keeps grounds to the kit's own colours,
  // as the Design tab does: no custom swatch, no hex field.
  const lookLocked = useBrandLookLocked();

  const options: SwatchChoice[] = [
    ...backgroundSwatches(document, slide, { custom: !lookLocked }),
    {
      value: PHOTO_BACKGROUND,
      label: 'Photo',
      color: null,
      imageUrl: photo ? (photo.thumbnailUrl ?? photo.url) : null,
      icon: ImagePlusIcon,
    },
  ];

  return (
    <PanelSection title="Background" headingId={headingId}>
      <SwatchPicker
        labelledBy={headingId}
        options={options}
        value={backgroundChoiceOf(background)}
        onValueChange={(choice) => {
          if (choice === PHOTO_BACKGROUND) pickPhoto();
          else onChange((latest) => withBackgroundChoice(latest, slideId, choice));
        }}
      />

      {background.kind === 'color' && !lookLocked ? (
        <CustomColorField
          value={normalizeHex(background.hex)}
          onApply={(hex) =>
            onChange((latest) => withCustomBackground(latest, slideId, hex), {
              coalesceKey: `background:${slideId}`,
            })
          }
        />
      ) : null}

      {background.kind === 'media' && !photo ? (
        <PictureMissing>
          <Button variant="secondary" size="sm" onClick={pickPhoto}>
            <MotionIcon icon={ImagePlusIcon} className={ICON} />
            Choose Photo
          </Button>
        </PictureMissing>
      ) : null}

      {background.kind === 'media' && photo ? (
        <div className="flex flex-col gap-4">
          <PictureRow url={photo.thumbnailUrl ?? photo.url} name={photo.name} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={pickPhoto}>
              <MotionIcon icon={ImagePlusIcon} className={ICON} />
              Replace Photo
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onChange((latest) => withPhotoRemoved(latest, slideId))}
            >
              <MotionIcon icon={XIcon} className={ICON} />
              Remove Photo
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            <GroupLabel id={tintId}>Tint</GroupLabel>
            <Segmented
              labelledBy={tintId}
              options={TINT_OPTIONS}
              value={tint}
              onValueChange={(next) => onChange((latest) => withTint(latest, slideId, next))}
            />
          </div>
          <PercentSlider
            label={words.strength}
            value={overlayPercent(background.overlay)}
            onValueChange={(percent) =>
              onChange((latest) => withOverlay(latest, slideId, percent / 100), {
                coalesceKey: `overlay:${slideId}`,
              })
            }
          />
          {photoNeedsDarkening(slide) ? (
            <Alert
              variant="warning"
              role="status"
              className="flex-wrap items-center justify-between"
            >
              <AlertDescription>
                {words.warning(overlayPercent(SAFE_PHOTO_OVERLAY))}
              </AlertDescription>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onChange((latest) => withSafeOverlay(latest, slideId))}
              >
                <MotionIcon icon={tint === 'light' ? SunIcon : SunDimIcon} className={ICON} />
                {words.fix}
              </Button>
            </Alert>
          ) : null}
          {several ? (
            <div className="flex flex-col gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                disabled={!canApplyToAll}
                onClick={() => onChange((latest) => applyPhotoToAllSlides(latest, slideId))}
              >
                <MotionIcon icon={LayersIcon} className={ICON} />
                Apply To All Slides
              </Button>
              {/* Said once it is true, so pressing the button is answered. */}
              <p role="status" className={NOTE}>
                {canApplyToAll ? null : 'Every slide has this photo, with the same tint.'}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </PanelSection>
  );
}

/** The elements a slide may hide, ticked while they show (DS-4.7). */
function ElementsSection({
  slide,
  layout,
  onChange,
}: {
  slide: DesignSlide;
  layout: SlideLayout;
  onChange: ApplyChange;
}) {
  const baseId = useId();
  const slideId = slide.id;
  const optional = optionalSlots(layout);

  return (
    <PanelSection title="Elements">
      {optional.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {optional.map((slot) => {
            const id = `${baseId}-${slot.id}`;
            return (
              <li key={slot.id} className="flex min-w-0 items-center gap-3">
                <Checkbox
                  id={id}
                  checked={!slide.elements[slot.id]?.hidden}
                  onCheckedChange={(checked) =>
                    onChange((latest) => withShown(latest, slideId, slot.id, checked === true))
                  }
                />
                <Label htmlFor={id} className="min-w-0 cursor-pointer">
                  {slot.label}
                </Label>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={NOTE}>Every element on this layout is part of its design.</p>
      )}
    </PanelSection>
  );
}
