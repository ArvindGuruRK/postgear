'use client';

/**
 * Blur A Region (Sprint 13, Module 17 item 18): the Effects panel's Blur
 * card. Each box is a part of the video blurred for the whole clip, placed
 * with four sliders as a share of the video's picture. Every change is one
 * undo step (slider drags coalesce). A clip of several videos blurs boxes on
 * its first video only.
 */
import { Button } from '@postgear/ui';
import {
  addBlur,
  type BlurEditResult,
  type BlurRect,
  blursOf,
  type ClipDocument,
  MAX_BLURS,
  removeBlur,
  updateBlur,
} from '@postgear/video-engine';
import { NOTE, PercentSlider } from '@/components/studio/panel-ui';

export const BLUR_NOTE =
  'A box stays on the same spot of the video for the whole clip. It does not follow someone who moves.';
export const BLUR_LIMIT_SENTENCE = `A clip can have at most ${MAX_BLURS} blurred boxes.`;

export type BlurChange = (
  make: (doc: ClipDocument) => BlurEditResult,
  coalesceKey?: string,
) => void;

const SIDES: ReadonlyArray<{ key: keyof BlurRect; label: string }> = [
  { key: 'x', label: 'From The Left' },
  { key: 'y', label: 'From The Top' },
  { key: 'w', label: 'Width' },
  { key: 'h', label: 'Height' },
];

export function BlurControls({ document, onBlur }: { document: ClipDocument; onBlur: BlurChange }) {
  const sourceId = document.sources[0]?.id ?? '';
  const boxes = blursOf(document, sourceId);
  const full = (document.blurs ?? []).length >= MAX_BLURS;

  return (
    <div className="flex flex-col gap-4" data-testid="clip-blur-controls">
      <p className={NOTE}>{BLUR_NOTE}</p>
      {boxes.map((box, k) => (
        <div
          key={box.id}
          className="flex flex-col gap-3 rounded-md border-2 border-outline bg-inset p-3"
          data-testid="clip-blur-box"
        >
          <span className="font-sans text-sm text-ink type-heading">{`Box ${k + 1}`}</span>
          {SIDES.map((side) => (
            <PercentSlider
              key={side.key}
              label={side.label}
              max={100}
              value={Math.round(box[side.key] * 100)}
              onValueChange={(percent) =>
                onBlur(
                  (doc) => updateBlur(doc, box.id, { [side.key]: percent / 100 }),
                  `blur:${box.id}:${side.key}`,
                )
              }
            />
          ))}
          <Button
            variant="danger"
            size="sm"
            onClick={() => onBlur((doc) => removeBlur(doc, box.id))}
            data-testid="clip-blur-remove"
          >
            Remove Box
          </Button>
        </div>
      ))}
      {full ? <p className={NOTE}>{BLUR_LIMIT_SENTENCE}</p> : null}
      <Button
        variant="secondary"
        size="sm"
        disabled={full || sourceId === ''}
        onClick={() => onBlur((doc) => addBlur(doc, sourceId))}
        data-testid="clip-blur-add"
      >
        Add Blur Box
      </Button>
    </div>
  );
}
