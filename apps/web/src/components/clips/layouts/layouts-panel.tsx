'use client';

/**
 * The Layouts tab (Module 10 section 4, blueprint section 8):
 *
 * - **Brand Kit** (Sprint 13, Module 10): on top, the kit the clip wears and
 *   a switch for its logo, intro and outro (`brand-kit-section.tsx`).
 * - **Shape**: Vertical, Horizontal, Square and Portrait (4:5) as
 *   `ChoiceTiles`, each a small drawing of the shape over its ratio (the
 *   names are the tooltips and what a screen reader hears; four names in
 *   words do not fit the panel), with a line under it naming the shape in
 *   full. Tiles, not a toggle bar, since the shape is the point of the tab
 *   (2026-11-19).
 * - **The layouts**: `ChoiceTiles` in three columns, each with a drawing
 *   made from the layout's own data. Horizontal offers Fullscreen and
 *   Blurred only. A quiet line says when the layout is Custom.
 * - **Crop Ratio** (Blurred only): Original, 4:3, 1:1, as tiles too.
 * - **Detect Camera** (Sprint 13, Module 07): under the tiles when the
 *   layout has a Camera area (`detect-camera.tsx`).
 * - **Follow The Speaker** (Sprint 13, Module 08): under it, for Vertical,
 *   Portrait and Square clips (`follow-speaker.tsx`). While it is on, any
 *   layout change here turns it off first, in the same undo step, so the
 *   person's own layout (`follow.saved`) is what the change starts from.
 * - **My Layouts**: the workspace's saved layouts for this shape.
 *
 * Every choice is one undo step and goes through the store's `apply`, which
 * checks the result against the document schema, so a refused change never
 * reaches the server. The crop boxes themselves are on the Video pane
 * (`crop-stage.tsx`).
 */
import { ChoiceTiles } from '@postgear/ui';
import {
  applyLayout,
  applySavedLayout,
  type CanvasSize,
  type ClipDocument,
  type FitCrop,
  PRESET_LABELS,
  type PresetKind,
  type Ratio,
  setCanvasRatio,
  setFitCrop,
} from '@postgear/video-engine';
import { useId } from 'react';
import { GroupLabel } from '@/components/studio/panel-ui';
import type { SavedLayoutView } from '@/types/clips';
import { BrandKitSection } from './brand-kit-section';
import { DetectCamera } from './detect-camera';
import { FollowSpeaker, type GrabPicture } from './follow-speaker';
import { unfollowFirst } from './follow-model';
import { LayoutDrawing } from './layout-drawing';
import {
  chosenLayout,
  FIT_CROP_CHOICES,
  LAYOUT_SHAPES,
  layoutChoices,
  layoutShapeName,
  presetDrawing,
} from './layouts-model';
import { SavedLayouts } from './saved-layouts';
import type { FollowSpeakerController } from './use-follow-speaker';

/**
 * One layout change as one undo step: the change, the sentence a screen
 * reader hears after it, and whether the area it added becomes the
 * selection (Add Crop).
 */
export type LayoutEdit = (
  change: (doc: ClipDocument) => ClipDocument,
  spoken: string,
  options?: { selectArea?: 'last' | 'camera' },
) => void;

export function LayoutsPanel({
  clipId,
  document,
  videoSize,
  labelledBy,
  facesAvailable,
  onEdit,
  follow,
  grabPicture,
}: {
  clipId: string;
  document: ClipDocument;
  videoSize: CanvasSize;
  /** The panel heading's id, which names the layout tiles. */
  labelledBy: string;
  /** Module 07: `ai.faces` from the status (Detect Camera is off without the media service). */
  facesAvailable: boolean;
  /** One undo step: the change, and the sentence a screen reader hears after it. */
  onEdit: LayoutEdit;
  /** Module 08: Follow The Speaker's state (the editor holds it); left out, the row is not shown. */
  follow?: FollowSpeakerController;
  /** Module 08: the editor's video, for the many-faces picker's thumbnails. */
  grabPicture?: GrabPicture;
}) {
  const shapeId = useId();
  const fitId = useId();
  const ratio = document.canvas.ratio;
  const kind = document.layout.kind;
  const chosen = chosenLayout(kind);

  const chooseShape = (next: Ratio) =>
    onEdit(
      unfollowFirst((doc) => setCanvasRatio(doc, next, videoSize)),
      `Shape changed to ${layoutShapeName(next)}.`,
    );
  const chooseLayout = (next: PresetKind) =>
    onEdit(
      unfollowFirst((doc) => applyLayout(doc, next, videoSize)),
      `${PRESET_LABELS[next]} layout.`,
    );
  const chooseFit = (next: FitCrop) =>
    onEdit(
      unfollowFirst((doc) => setFitCrop(doc, next, videoSize)),
      `Crop ratio ${next === 'original' ? 'Original' : next}.`,
    );
  const applySaved = (saved: SavedLayoutView) => {
    if (saved.ratio !== ratio) return;
    onEdit(
      unfollowFirst((doc) => applySavedLayout(doc, saved.layout, videoSize)),
      `${saved.name} applied.`,
    );
  };

  return (
    <div className="flex flex-col gap-6 pt-1" data-testid="clip-layouts-panel">
      <BrandKitSection document={document} onEdit={onEdit} />

      <div className="flex flex-col gap-2">
        <GroupLabel id={shapeId}>Shape</GroupLabel>
        <ChoiceTiles<Ratio>
          labelledBy={shapeId}
          columns={4}
          value={ratio}
          onValueChange={chooseShape}
          options={LAYOUT_SHAPES.map((shape) => ({
            value: shape,
            label: layoutShapeName(shape),
            short: shape,
            drawing: <ShapeDrawing ratio={shape} />,
          }))}
        />
      </div>

      <div className="flex flex-col gap-3">
        <ChoiceTiles<PresetKind | 'custom'>
          labelledBy={labelledBy}
          columns={3}
          value={chosen ?? 'custom'}
          onValueChange={(next) => next !== 'custom' && chooseLayout(next)}
          options={layoutChoices(ratio).map(({ kind: preset, label }) => {
            const drawing = presetDrawing(preset, ratio);
            return {
              value: preset,
              label,
              drawing: drawing ? <LayoutDrawing drawing={drawing} /> : undefined,
            };
          })}
        />
        {kind === 'blurred' ? (
          <div className="flex flex-col gap-2" data-testid="clip-crop-ratio">
            <GroupLabel id={fitId}>Crop Ratio</GroupLabel>
            <ChoiceTiles<FitCrop>
              labelledBy={fitId}
              value={document.layout.fitCrop ?? 'original'}
              onValueChange={chooseFit}
              options={FIT_CROP_CHOICES}
            />
          </div>
        ) : null}
        <DetectCamera
          clipId={clipId}
          document={document}
          videoSize={videoSize}
          available={facesAvailable}
          onEdit={onEdit}
        />
        {follow ? <FollowSpeaker follow={follow} grabPicture={grabPicture} /> : null}
      </div>

      {/* Save Layout keeps the person's own layout, never a followed one. */}
      <SavedLayouts
        ratio={ratio}
        layout={document.layout.follow?.saved ?? document.layout}
        onApply={applySaved}
      />
    </div>
  );
}

/** The outline of a shape, 32 px on its long side (decorative: the tile names it). */
const SHAPE_BOX: Readonly<Record<Ratio, string>> = {
  '9:16': 'h-8 w-[18px]',
  '16:9': 'h-[18px] w-8',
  '1:1': 'h-[26px] w-[26px]',
  '4:5': 'h-8 w-[26px]',
};

function ShapeDrawing({ ratio }: { ratio: Ratio }) {
  return (
    <span className="flex h-8 w-8 items-center justify-center">
      <span className={`${SHAPE_BOX[ratio]} rounded-[3px] border-2 border-current`} />
    </span>
  );
}
