'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { niceCeiling } from '../lib/nice-ceiling';
import { cn } from '../lib/utils';

/**
 * A line chart for metrics over time (Sprint 7: the analytics dashboard and
 * the SEO score history), drawn as plain SVG from the design tokens.
 *
 * ## Why not a charting library
 *
 * Every chart library ships its own colours, soft shadows, eased curves and
 * gradient fills: the SaaS look Sprint 0 rejected. A dashboard built on one
 * would either fight it on every option or quietly drift. The charts
 * PostGear needs are lines over days; that is forty lines of SVG, and the
 * tokens do the rest: thick flat strokes, square points, hard grid lines,
 * no gradient (a flat 15% fill under the line is the area), text in the
 * body face at the sizes the rules give.
 *
 * ## Restrained by rule
 *
 * This is a dense data surface (design-system-rules.md §15): no brutal
 * shadow on the plot itself, no halftone. The chrome around it (the card,
 * the toolbar, the range tabs) carries the treatment.
 *
 * ## Accessible by construction
 *
 * The plot is one focusable region; arrow keys move a reading cursor across
 * the days and the tooltip doubles as a live region, so a screen reader hears
 * "14 Oct: Impressions 1,204" rather than nothing. A `<table>` is not
 * generated: callers that need the numbers tabular show them next to the
 * chart, which the analytics page does.
 */
export type TrendTone = 'primary' | 'ai' | 'accent' | 'success' | 'danger' | 'secondary';

export interface TrendPoint {
  /** The category on the x axis: a `YYYY-MM-DD` day, or any label. */
  x: string;
  /** Null draws a gap. */
  y: number | null;
}

export interface TrendSeries {
  id: string;
  label: string;
  points: TrendPoint[];
  tone?: TrendTone;
}

const STROKE: Record<TrendTone, string> = {
  primary: 'stroke-actionPrimary',
  ai: 'stroke-actionAi',
  accent: 'stroke-actionAccent',
  success: 'stroke-actionSuccess',
  danger: 'stroke-actionDanger',
  secondary: 'stroke-actionSecondary',
};

const FILL: Record<TrendTone, string> = {
  primary: 'fill-actionPrimary',
  ai: 'fill-actionAi',
  accent: 'fill-actionAccent',
  success: 'fill-actionSuccess',
  danger: 'fill-actionDanger',
  secondary: 'fill-actionSecondary',
};

const BG: Record<TrendTone, string> = {
  primary: 'bg-actionPrimary',
  ai: 'bg-actionAi',
  accent: 'bg-actionAccent',
  success: 'bg-actionSuccess',
  danger: 'bg-actionDanger',
  secondary: 'bg-actionSecondary',
};

const PADDING = { top: 12, right: 12, bottom: 28, left: 44 };
const DEFAULT_WIDTH = 640;

export { niceCeiling };

const defaultFormatValue = (value: number): string =>
  Math.abs(value) >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
    : Math.abs(value) >= 10_000
      ? `${(value / 1_000).toFixed(0)}k`
      : Math.abs(value) >= 1_000
        ? `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`
        : value.toLocaleString();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Deliberately not `toLocaleDateString`: this chart is server-rendered, and
 * a label that depends on the locale ("15 Sept" on one machine, "Sep 15" on
 * another) is a hydration mismatch that makes React throw the server markup
 * away, and with it the body's theme class. A caller that wants the
 * viewer's locale passes `formatX` and renders the chart after mount.
 */
const defaultFormatX = (x: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(x);
  if (!match) return x;
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? match[2]}`;
};

export interface TrendChartProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  series: TrendSeries[];
  /** Plot height in pixels. Width follows the container. */
  height?: number;
  /** Flat fill under each line. On by default for one series, off for several. */
  area?: boolean;
  /** Formats y values for the axis and the tooltip. */
  formatValue?: (value: number) => string;
  /** Formats x categories for the axis and the tooltip. Days are formatted "14 Oct" by default. */
  formatX?: (x: string) => string;
  /** Formats the tooltip heading; defaults to `formatX`. */
  formatXLong?: (x: string) => string;
  showLegend?: boolean;
  emptyMessage?: string;
}

interface Scales {
  width: number;
  height: number;
  xs: string[];
  xFor: (index: number) => number;
  yFor: (value: number) => number;
  ceiling: number;
}

function useContainerWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next && next > 0) setWidth(next);
    });
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width || DEFAULT_WIDTH);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

export function TrendChart({
  className,
  series,
  height = 220,
  area,
  formatValue = defaultFormatValue,
  formatX = defaultFormatX,
  formatXLong,
  showLegend = true,
  emptyMessage = 'No data for this range yet.',
  'aria-label': ariaLabel = 'Trend',
  ...props
}: TrendChartProps) {
  const id = useId();
  const [containerRef, width] = useContainerWidth<HTMLDivElement>();
  const [cursor, setCursor] = useState<number | null>(null);
  const fillArea = area ?? series.length === 1;
  const longX = formatXLong ?? formatX;

  const scales = useMemo<Scales>(() => {
    const seen = new Set<string>();
    const xs: string[] = [];
    let max = 0;
    for (const line of series) {
      for (const point of line.points) {
        if (!seen.has(point.x)) {
          seen.add(point.x);
          xs.push(point.x);
        }
        if (point.y !== null && point.y > max) max = point.y;
      }
    }
    const ceiling = niceCeiling(max);
    const plotWidth = Math.max(1, width - PADDING.left - PADDING.right);
    const plotHeight = Math.max(1, height - PADDING.top - PADDING.bottom);
    return {
      width,
      height,
      xs,
      ceiling,
      xFor: (index) =>
        PADDING.left + (xs.length <= 1 ? plotWidth / 2 : (index / (xs.length - 1)) * plotWidth),
      yFor: (value) => PADDING.top + plotHeight - (value / ceiling) * plotHeight,
    };
  }, [series, width, height]);

  const hasData = series.some((line) => line.points.some((point) => point.y !== null));
  const indexByX = useMemo(() => new Map(scales.xs.map((x, index) => [x, index])), [scales.xs]);

  const paths = useMemo(
    () =>
      series.map((line) => {
        const segments: string[] = [];
        const areaSegments: string[] = [];
        let open = false;
        let segmentStart: number | null = null;
        let lastX = 0;
        for (const point of line.points) {
          const index = indexByX.get(point.x);
          if (index === undefined) continue;
          if (point.y === null) {
            if (open) {
              areaSegments.push(`L ${lastX} ${scales.yFor(0)} Z`);
              open = false;
            }
            continue;
          }
          const x = scales.xFor(index);
          const y = scales.yFor(point.y);
          if (!open) {
            segments.push(`M ${x} ${y}`);
            areaSegments.push(`M ${x} ${scales.yFor(0)} L ${x} ${y}`);
            segmentStart = x;
            open = true;
          } else {
            segments.push(`L ${x} ${y}`);
            areaSegments.push(`L ${x} ${y}`);
          }
          lastX = x;
        }
        if (open && segmentStart !== null) areaSegments.push(`L ${lastX} ${scales.yFor(0)} Z`);
        return { line: segments.join(' '), area: areaSegments.join(' ') };
      }),
    [series, scales, indexByX],
  );

  const ticks = useMemo(() => {
    const steps = 4;
    return Array.from({ length: steps + 1 }, (_, step) => (scales.ceiling / steps) * step);
  }, [scales.ceiling]);

  const xLabels = useMemo(() => {
    const count = scales.xs.length;
    if (count === 0) return [];
    const slots = Math.max(2, Math.min(count, Math.floor(scales.width / 90)));
    const chosen = new Set<number>([0, count - 1]);
    for (let slot = 1; slot < slots - 1; slot += 1) {
      chosen.add(Math.round((slot / (slots - 1)) * (count - 1)));
    }
    return [...chosen].sort((a, b) => a - b);
  }, [scales.xs.length, scales.width]);

  const readings = useMemo(() => {
    if (cursor === null) return null;
    const x = scales.xs[cursor];
    if (x === undefined) return null;
    return {
      x,
      values: series.map((line) => ({
        id: line.id,
        label: line.label,
        tone: line.tone ?? 'primary',
        y: line.points.find((point) => point.x === x)?.y ?? null,
      })),
    };
  }, [cursor, scales.xs, series]);

  const nearestIndex = (clientX: number, element: SVGSVGElement): number => {
    const rect = element.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * scales.width;
    const plotWidth = scales.width - PADDING.left - PADDING.right;
    const fraction = (px - PADDING.left) / plotWidth;
    return Math.max(
      0,
      Math.min(scales.xs.length - 1, Math.round(fraction * (scales.xs.length - 1))),
    );
  };

  const tooltipLeft =
    cursor === null
      ? 0
      : Math.min(Math.max(scales.xFor(cursor), 80), Math.max(80, scales.width - 80));

  return (
    <div ref={containerRef} className={cn('relative w-full', className)} {...props}>
      {showLegend && series.length > 0 ? (
        <ul className="m-0 mb-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
          {series.map((line) => (
            <li
              key={line.id}
              className="inline-flex items-center gap-1.5 font-sans text-xs font-bold text-ink"
            >
              <span
                className={cn('h-2.5 w-2.5 border-2 border-outline', BG[line.tone ?? 'primary'])}
                aria-hidden="true"
              />
              {line.label}
            </li>
          ))}
        </ul>
      ) : null}

      <svg
        role="img"
        aria-label={ariaLabel}
        aria-describedby={`${id}-reading`}
        tabIndex={hasData ? 0 : -1}
        width="100%"
        height={height}
        viewBox={`0 0 ${scales.width} ${scales.height}`}
        preserveAspectRatio="none"
        className="block select-none overflow-visible rounded-md border-2 border-outline bg-inset outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
        onPointerMove={(event) =>
          hasData && setCursor(nearestIndex(event.clientX, event.currentTarget))
        }
        onPointerLeave={() => setCursor(null)}
        onKeyDown={(event) => {
          if (!hasData) return;
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            setCursor((current) => Math.min(scales.xs.length - 1, (current ?? -1) + 1));
          } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            setCursor((current) => Math.max(0, (current ?? scales.xs.length) - 1));
          } else if (event.key === 'Home') {
            event.preventDefault();
            setCursor(0);
          } else if (event.key === 'End') {
            event.preventDefault();
            setCursor(scales.xs.length - 1);
          } else if (event.key === 'Escape') {
            setCursor(null);
          }
        }}
        onBlur={() => setCursor(null)}
      >
        <title>{ariaLabel}</title>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PADDING.left}
              x2={scales.width - PADDING.right}
              y1={scales.yFor(tick)}
              y2={scales.yFor(tick)}
              // Ink rather than outline, so the grid survives dark mode (outline stays near-black there).
              className="stroke-ink"
              strokeWidth={tick === 0 ? 2 : 1}
              strokeOpacity={tick === 0 ? 0.7 : 0.18}
              strokeDasharray={tick === 0 ? undefined : '3 4'}
            />
            <text
              x={PADDING.left - 8}
              y={scales.yFor(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-ink font-sans text-[10px] font-medium muted-tone"
            >
              {formatValue(tick)}
            </text>
          </g>
        ))}

        {xLabels.map((index) => (
          <text
            key={scales.xs[index]}
            x={scales.xFor(index)}
            y={scales.height - 8}
            textAnchor={index === 0 ? 'start' : index === scales.xs.length - 1 ? 'end' : 'middle'}
            className="fill-ink font-sans text-[10px] font-medium muted-tone"
          >
            {formatX(scales.xs[index])}
          </text>
        ))}

        {hasData
          ? series.map((line, lineIndex) => {
              const tone = line.tone ?? 'primary';
              return (
                <g key={line.id}>
                  {fillArea ? (
                    <path
                      d={paths[lineIndex].area}
                      className={cn(FILL[tone], 'opacity-15')}
                      stroke="none"
                    />
                  ) : null}
                  <path
                    d={paths[lineIndex].line}
                    fill="none"
                    strokeWidth={3}
                    strokeLinejoin="miter"
                    strokeLinecap="butt"
                    className={STROKE[tone]}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })
          : null}

        {readings ? (
          <g>
            <line
              x1={scales.xFor(cursor ?? 0)}
              x2={scales.xFor(cursor ?? 0)}
              y1={PADDING.top}
              y2={scales.height - PADDING.bottom}
              className="stroke-outline"
              strokeWidth={2}
              strokeDasharray="4 3"
            />
            {readings.values.map((value) =>
              value.y === null ? null : (
                <rect
                  key={value.id}
                  x={scales.xFor(cursor ?? 0) - 5}
                  y={scales.yFor(value.y) - 5}
                  width={10}
                  height={10}
                  className={cn(FILL[value.tone], 'stroke-outline')}
                  strokeWidth={2}
                />
              ),
            )}
          </g>
        ) : null}

        {!hasData ? (
          <text
            x={scales.width / 2}
            y={scales.height / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-ink font-sans text-sm font-medium opacity-60"
          >
            {emptyMessage}
          </text>
        ) : null}
      </svg>

      {/* The tooltip is also the live reading for assistive tech. */}
      <div
        id={`${id}-reading`}
        role="status"
        aria-live="polite"
        className={cn(
          'pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border-2 border-outline bg-secondary px-3 py-2 font-sans text-xs text-ink shadow-surfaceSm',
          readings ? 'opacity-100' : 'sr-only',
        )}
        style={
          readings ? { left: tooltipLeft, top: PADDING.top + (showLegend ? 24 : 0) } : undefined
        }
      >
        {readings ? (
          <>
            <div className="font-bold">{longX(readings.x)}</div>
            <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
              {readings.values.map((value) => (
                <li key={value.id} className="flex items-center gap-1.5 whitespace-nowrap">
                  <span
                    className={cn('h-2 w-2 border border-outline', BG[value.tone])}
                    aria-hidden="true"
                  />
                  <span className="muted-tone">{value.label}</span>
                  <span className="font-bold">{value.y === null ? '–' : formatValue(value.y)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}

export interface SparklineProps extends Omit<React.SVGAttributes<SVGSVGElement>, 'points'> {
  points: (number | null)[];
  tone?: TrendTone;
  width?: number;
  height?: number;
  /** The flat 15% fill under the line, as `TrendChart` draws its area. */
  area?: boolean;
  /**
   * Stretch to the container's width (a stat card's footer) instead of
   * `width` pixels; `width` then only sets the drawing's proportions and the
   * stroke keeps its thickness however wide the card is.
   */
  fluid?: boolean;
  /**
   * Scale between the lowest and highest value instead of from zero. For a
   * level such as a follower count, which moves a little on a large number
   * and is a flat line from zero. Draws no area: a fill down to an arbitrary
   * floor would exaggerate the change.
   */
  fitRange?: boolean;
}

/**
 * A line in a table cell or under a stat: the shape of a metric over the
 * range, no axes. Decorative: callers put the numbers next to it.
 */
export function Sparkline({
  points,
  tone = 'primary',
  width = 96,
  height = 28,
  area = false,
  fluid = false,
  fitRange = false,
  className,
  ...props
}: SparklineProps) {
  const values = points.filter((value): value is number => value !== null);
  const low = values.length > 0 ? Math.min(...values) : 0;
  const high = values.length > 0 ? Math.max(...values) : 0;
  // Fitted, a range with no spread is a level line through the middle.
  const floor = fitRange ? (high === low ? low - 1 : low) : 0;
  const scale = fitRange ? (high === low ? 2 : high - low) : niceCeiling(high);
  const step = points.length > 1 ? (width - 4) / (points.length - 1) : 0;
  const base = height - 2;
  let d = '';
  let fill = '';
  let open = false;
  let lastX = 0;
  points.forEach((value, index) => {
    const x = 2 + index * step;
    if (value === null) {
      if (open) fill += ` L ${lastX.toFixed(1)} ${base} Z`;
      open = false;
      return;
    }
    const y = height - 2 - ((value - floor) / scale) * (height - 4);
    d += `${open ? ' L' : ' M'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    fill += open
      ? ` L ${x.toFixed(1)} ${y.toFixed(1)}`
      : ` M ${x.toFixed(1)} ${base} L ${x.toFixed(1)} ${y.toFixed(1)}`;
    open = true;
    lastX = x;
  });
  if (open) fill += ` L ${lastX.toFixed(1)} ${base} Z`;

  return (
    <svg
      width={fluid ? '100%' : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={fluid ? 'none' : undefined}
      aria-hidden="true"
      className={cn('block overflow-visible', className)}
      {...props}
    >
      {d && area && !fitRange ? (
        <path d={fill.trim()} className={cn(FILL[tone], 'opacity-15')} stroke="none" />
      ) : null}
      {d ? (
        <path
          d={d.trim()}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="miter"
          className={STROKE[tone]}
          vectorEffect={fluid ? 'non-scaling-stroke' : undefined}
        />
      ) : (
        <line
          x1={2}
          x2={width - 2}
          y1={height / 2}
          y2={height / 2}
          className="stroke-ink"
          strokeOpacity={0.3}
          strokeWidth={2}
          strokeDasharray="3 3"
          vectorEffect={fluid ? 'non-scaling-stroke' : undefined}
        />
      )}
    </svg>
  );
}
