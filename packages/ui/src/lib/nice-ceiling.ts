/**
 * A "nice" ceiling for a chart's y axis: 0 → 10, 37 → 40, 1,204 → 1,400,
 * 85,000 → 90,000.
 *
 * On its own, free of React and the components, so code that only draws
 * (the analytics PDF) can import it as `@postgear/ui/lib/nice-ceiling`
 * without pulling in the whole design system. `TrendChart` re-exports it.
 */
export function niceCeiling(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalised = max / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  const unit = (magnitude * step) / 5;
  return Math.ceil(max / unit) * unit;
}
