'use client';

/**
 * The Layouts tab (Module 10 section 4, blueprint section 8):
 *
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
import { GroupLabel, NOTE } from '@/components/studio/panel-ui';
import type { SavedLayoutView } from '@/types/clips';
import { LayoutDrawing } from './layout-drawing';
import {
  CUSTOM_SENTENCE,
  chosenLayout,
  FIT_CROP_CHOICES,
  LAYOUT_SHAPES,
  layoutChoices,
  layoutShapeName,
  presetDrawing,
  SHAPE_READBACK,
} from './layouts-model';
import { SavedLayouts } from './saved-layouts';

/**
 * One layout change as one undo step: the change, the sentence a screen
 * reader hears after it, and whether the area it added becomes the
 * selection (Add Crop).
 */
export type LayoutEdit = (
  change: (doc: ClipDocument) => ClipDocument,
  spoken: string,
  options?: { selectArea?: 'last' },
) => void;

export function LayoutsPanel({
  document,
  videoSize,
  labelledBy,
  onEdit,
}: {
  document: ClipDocument;
  videoSize: CanvasSize;
  /** The panel heading's id, which names the layout tiles. */
  labelledBy: string;
  /** One undo step: the change, and the sentence a screen reader hears after it. */
  onEdit: LayoutEdit;
}) {
  const shapeId = useId();
  const fitId = useId();
  const ratio = document.canvas.ratio;
  const kind = document.layout.kind;
  const chosen = chosenLayout(kind);

  const chooseShape = (next: Ratio) =>
    onEdit(
      (doc) => setCanvasRatio(doc, next, videoSize),
      `Shape changed to ${layoutShapeName(next)}.`,
    );
  const chooseLayout = (next: PresetKind) =>
    onEdit((doc) => applyLayout(doc, next, videoSize), `${PRESET_LABELS[next]} layout.`);
  const chooseFit = (next: FitCrop) =>
    onEdit(
      (doc) => setFitCrop(doc, next, videoSize),
      `Crop ratio ${next === 'original' ? 'Original' : next}.`,
    );
  const applySaved = (saved: SavedLayoutView) => {
    if (saved.ratio !== ratio) return;
    onEdit((doc) => applySavedLayout(doc, saved.layout, videoSize), `${saved.name} applied.`);
  };

  return (
    <div className="flex flex-col gap-6 pt-1" data-testid="clip-layouts-panel">
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
        <p className={NOTE} data-testid="clip-shape-readback">
          {SHAPE_READBACK[ratio]}
        </p>
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
        {kind === 'custom' ? (
          <p className={NOTE} data-testid="clip-layout-custom">
            {CUSTOM_SENTENCE}
          </p>
        ) : null}
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
      </div>

      <SavedLayouts ratio={ratio} layout={document.layout} onApply={applySaved} />
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
