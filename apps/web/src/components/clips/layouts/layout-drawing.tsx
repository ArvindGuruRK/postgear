/**
 * A small drawing of a layout, from its data (Module 10 section 4): the
 * clip's shape as an outline, a soft fill when the base is the blurred
 * video, and each area as a box (rounded where the clip's corner is). The
 * preset tiles and the saved layouts both draw from it, so a drawing can
 * never disagree with what the layout does.
 *
 * Decorative: the tile's name says what it is.
 */
import type { LayoutDrawingModel } from './layouts-model';

export function LayoutDrawing({
  drawing,
  size = 40,
}: {
  drawing: LayoutDrawingModel;
  /** The drawing's longest side, in px. */
  size?: number;
}) {
  const { width, height } = drawing;
  const longest = Math.max(width, height);
  const w = Math.max(1, Math.round((width / longest) * size));
  const h = Math.max(1, Math.round((height / longest) * size));
  // Rounded corners scaled from canvas pixels to the outline's own size.
  const corner = longest / size;

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
      className="block overflow-visible"
      data-layout-drawing=""
    >
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        rx={2 * corner}
        fill="currentColor"
        fillOpacity={drawing.base === 'blurred' ? 0.18 : 0}
        stroke="currentColor"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      {drawing.boxes.map((box, index) => (
        <rect
          // The boxes are a fixed list drawn in order; their place is their identity.
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          key={index}
          x={box.rect.x * width}
          y={box.rect.y * height}
          width={box.rect.w * width}
          height={box.rect.h * height}
          rx={box.radius}
          fill="currentColor"
          fillOpacity={0.4}
          stroke="currentColor"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
