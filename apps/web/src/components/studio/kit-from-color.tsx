'use client';

/**
 * From One Colour (Sprint 9b): the brand kit dialog's way to fill all five
 * colours from the one a person has. It opens under the Colours fields with
 * the kit's own primary to start from, shows the five it would make, and
 * changes nothing until Use These Colours; the fields can still be changed
 * one by one afterwards. The colour maths is `kit-palette-model.ts`.
 */
import type { BrandColors } from '@postgear/design-engine';
import { Button } from '@postgear/ui';
import { useId, useState } from 'react';
import { ColorField } from './color-field';
import { GROUND_OPTIONS, type KitGround, paletteFromColor } from './kit-palette-model';
import { KitSwatches } from './kit-preview';
import { Segmented } from './panel-ui';
import { HEX_ERROR } from './studio-view-model';

export function KitFromColor({
  id,
  start,
  startGround,
  disabled,
  onUse,
  onCancel,
}: {
  /** The panel's id, for the button that opens it (`aria-controls`). */
  id: string;
  /** The colour the field starts with: the kit's primary. */
  start: string;
  startGround: KitGround;
  disabled: boolean;
  onUse: (colors: BrandColors) => void;
  onCancel: () => void;
}) {
  const groundId = useId();
  const [seed, setSeed] = useState(start);
  const [ground, setGround] = useState<KitGround>(startGround);
  const [touched, setTouched] = useState(false);
  const palette = paletteFromColor(seed, ground);

  return (
    <div
      id={id}
      className="flex flex-col gap-4 rounded-lg border-2 border-outline bg-inset p-3 shadow-surfaceSm"
    >
      <ColorField
        label="Your main colour"
        value={seed}
        error={touched && !palette ? HEX_ERROR : null}
        onChange={setSeed}
        onBlur={() => setTouched(true)}
      />

      <div className="flex flex-col gap-2">
        <p id={groundId} className="m-0 font-sans text-sm font-bold text-ink">
          Background
        </p>
        <Segmented
          labelledBy={groundId}
          options={GROUND_OPTIONS}
          value={ground}
          onValueChange={setGround}
        />
      </div>

      {palette ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 font-sans text-xs text-ink type-muted">
            The five colours this makes, with text that reads on the background:
          </p>
          <KitSwatches colors={palette} />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={disabled || !palette}
          onClick={() => {
            if (palette) onUse(palette);
          }}
        >
          Use These Colours
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
