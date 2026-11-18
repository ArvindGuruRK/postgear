'use client';

/**
 * Module 11's design-system pieces, checked here before the clip editor uses
 * them: the colour picker (swatches, recent colours, a shade square, a hue
 * strip, a hex field and opacity) and the frame drawn around a selected item
 * on the clip (corners and sides, the turning handle above).
 */
import { ColorPicker, pushRecent, TransformBox, type TransformPart } from '@postgear/ui';
import { useState } from 'react';
import { Row, Spec } from '../shared';

export function ClipsCanvasSpecimens() {
  const [colour, setColour] = useState('#FFD400');
  const [box, setBox] = useState('#111111');
  const [boxOpacity, setBoxOpacity] = useState(0.8);
  const [recent, setRecent] = useState<string[]>(['#2F80ED', '#FFFFFF']);
  const [pressed, setPressed] = useState<TransformPart | null>(null);
  const [rotation, setRotation] = useState(0);
  const remember = (hex: string) => setRecent((current) => pushRecent(current, hex));

  return (
    <>
      <Row label="Colour picker (arrows move in the shade square and the hue strip)">
        <ColorPicker
          label="Text Colour"
          value={colour}
          onChange={setColour}
          onCommit={remember}
          recent={recent}
        />
        <ColorPicker
          label="Box Colour"
          value={box}
          onChange={setBox}
          onCommit={remember}
          opacity={boxOpacity}
          onOpacityChange={setBoxOpacity}
          recent={recent}
        />
        <ColorPicker label="Disabled Colour" value="#7B61FF" onChange={() => undefined} disabled />
        <Spec>{`ColorPicker: flat trigger, Popover, onChange while dragging, onCommit at the end (${colour}, ${box} at ${Math.round(boxOpacity * 100)}%)`}</Spec>
      </Row>

      <Row label="Transform box (a text: corners and sides; a sticker: corners only)">
        <div className="relative h-56 w-full max-w-xl rounded-md border-2 border-outline bg-inset">
          <span
            className="absolute type-heading text-2xl text-ink"
            style={{
              left: 60,
              top: 70,
              width: 220,
              textAlign: 'center',
              transform: `rotate(${rotation}deg)`,
            }}
          >
            Your text here
          </span>
          <TransformBox
            x={170}
            y={88}
            width={220}
            height={40}
            rotation={rotation}
            handles={['nw', 'ne', 'se', 'sw', 'e', 'w']}
            onPartPointerDown={(part) => {
              setPressed(part);
              if (part === 'rotate') setRotation((r) => (r + 15) % 360);
            }}
          />
          <TransformBox
            x={420}
            y={120}
            width={96}
            height={96}
            rotation={-12}
            handles={['nw', 'ne', 'se', 'sw']}
            onPartPointerDown={setPressed}
          />
        </div>
        <Spec>{`TransformBox: 2 px primary border, square handles, round turning handle; pressed ${pressed ?? 'nothing'} (the turning handle adds 15 degrees here)`}</Spec>
      </Row>
    </>
  );
}
