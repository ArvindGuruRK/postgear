'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';

const SIZE = {
  sm: { tile: 'h-10 w-10 text-lg', label: 'text-[9px]', gap: 'gap-1.5' },
  md: { tile: 'h-14 w-14 text-3xl', label: 'text-[10px]', gap: 'gap-2' },
  lg: { tile: 'h-20 w-20 text-5xl', label: 'text-xs', gap: 'gap-3' },
} as const;

export interface CountdownProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Target instant. Accepts a Date or anything `new Date()` parses. */
  to: Date | string | number;
  size?: keyof typeof SIZE;
  /** DAYS / HRS / MIN / SEC captions under each tile. */
  showLabels?: boolean;
  /**
   * Drop the days tile once the target is under 24h away, so a short fuse
   * doesn't render a permanent "00".
   */
  hideEmptyDays?: boolean;
  /** Every tile flips to danger under this many milliseconds remaining. */
  urgentBelowMs?: number;
  /** Fires once when the target passes. */
  onComplete?: () => void;
}

interface Remaining {
  total: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function remainingUntil(target: number): Remaining {
  const total = Math.max(0, target - Date.now());
  const totalSeconds = Math.floor(total / 1000);
  return {
    total,
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

function Tile({
  value,
  label,
  size,
  live,
  urgent,
  showLabel,
}: {
  value: number;
  label: string;
  size: keyof typeof SIZE;
  live?: boolean;
  urgent?: boolean;
  showLabel?: boolean;
}) {
  const digits = pad(value);
  const emphasised = urgent || live;

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={cn(
          'flex items-center justify-center overflow-hidden rounded-md border-2 border-outline shadow-brutalSm',
          'font-display tabular-nums leading-none tracking-wide',
          SIZE[size].tile,
          emphasised ? 'bg-actionDanger text-onActionLight' : 'bg-plate text-onPlate',
        )}
      >
        {/* Keyed on the value so React remounts the span on every change,
            restarting the tick animation — a CSS animation on a persistent
            node only ever plays once. */}
        <span
          key={digits}
          className="animate-digitTick motion-reduce:animate-none"
          suppressHydrationWarning
        >
          {digits}
        </span>
      </div>
      {showLabel && (
        <span
          className={cn(
            'font-display uppercase tracking-wide text-ink opacity-70',
            SIZE[size].label,
          )}
        >
          {label}
        </span>
      )}
    </div>
  );
}

export function Countdown({
  to,
  size = 'md',
  showLabels = true,
  hideEmptyDays = true,
  urgentBelowMs = 60 * 60 * 1000,
  onComplete,
  className,
  ...props
}: CountdownProps) {
  const target = new Date(to).getTime();
  // Seeded synchronously so the first paint shows real digits instead of
  // placeholders. Server and client clocks differ by a beat, which is what
  // suppressHydrationWarning on the digits covers.
  const [remaining, setRemaining] = useState<Remaining>(() => remainingUntil(target));
  const completed = useRef(false);
  // Held in a ref so an inline `onComplete={() => …}` — a new function on every
  // parent render — doesn't land in the effect's deps and restart the timer.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    completed.current = false;
    setRemaining(remainingUntil(target));

    // setInterval drifts and pauses in background tabs; realigning to the next
    // whole second each tick keeps the display on the wall clock.
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const next = remainingUntil(target);
      setRemaining(next);
      if (next.total <= 0) {
        if (!completed.current) {
          completed.current = true;
          onCompleteRef.current?.();
        }
        return;
      }
      timer = setTimeout(tick, 1000 - (Date.now() % 1000));
    };
    timer = setTimeout(tick, 1000 - (Date.now() % 1000));
    return () => clearTimeout(timer);
  }, [target]);

  const urgent = remaining.total > 0 && remaining.total < urgentBelowMs;
  const showDays = !hideEmptyDays || remaining.days > 0;

  const tiles = [
    ...(showDays ? [{ value: remaining.days, label: 'Days' }] : []),
    { value: remaining.hours, label: 'Hrs' },
    { value: remaining.minutes, label: 'Min' },
    { value: remaining.seconds, label: 'Sec' },
  ];

  return (
    <div
      className={cn('flex items-start', SIZE[size].gap, className)}
      // The whole group is one live value; announcing every second would be
      // unusable, so updates are silent and the target is exposed instead.
      role="timer"
      aria-label={`${remaining.days}d ${remaining.hours}h ${remaining.minutes}m ${remaining.seconds}s remaining`}
      {...props}
    >
      {tiles.map((tile, index) => (
        <Tile
          key={tile.label}
          value={tile.value}
          label={tile.label}
          size={size}
          showLabel={showLabels}
          // The seconds tile is the one visibly ticking, so it carries the
          // accent — matching the reference's single red plate.
          live={index === tiles.length - 1}
          urgent={urgent}
        />
      ))}
    </div>
  );
}
