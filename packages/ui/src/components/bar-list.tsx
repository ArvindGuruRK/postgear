import { forwardRef } from 'react';
import { cn } from '../lib/utils';

/**
 * Rows compared by one number — channels by engagement, keywords by density
 * — each a label, a value and a bar scaled against the largest (Sprint 7).
 *
 * The horizontal-bar equivalent of a comparison table (user story 6.4), in
 * the restrained profile: bars are flat fills inside a bordered track, no
 * stripes, no halftone, body face throughout. `leading` takes an avatar or
 * icon so a row can say *which* channel without a second column.
 */
export type BarTone = 'primary' | 'ai' | 'accent' | 'success' | 'danger' | 'secondary';

const FILL: Record<BarTone, string> = {
  primary: 'bg-actionPrimary',
  ai: 'bg-actionAi',
  accent: 'bg-actionAccent',
  success: 'bg-actionSuccess',
  danger: 'bg-actionDanger',
  secondary: 'bg-actionSecondary',
};

export interface BarListItem {
  id: string;
  label: string;
  value: number;
  /** The value as shown; defaults to `value.toLocaleString()`. */
  display?: string;
  /** One quiet line under the label ("LinkedIn · 12 posts"). */
  hint?: string;
  tone?: BarTone;
  leading?: React.ReactNode;
}

export interface BarListProps extends React.HTMLAttributes<HTMLUListElement> {
  items: BarListItem[];
  /** Scale bars against this rather than the largest item. */
  max?: number;
  emptyMessage?: string;
}

export const BarList = forwardRef<HTMLUListElement, BarListProps>(
  ({ className, items, max, emptyMessage = 'Nothing to compare yet.', ...props }, ref) => {
    const ceiling = max ?? Math.max(0, ...items.map((item) => item.value));

    if (items.length === 0) {
      return (
        <p className={cn('m-0 font-sans text-sm font-medium text-ink opacity-70', className)}>
          {emptyMessage}
        </p>
      );
    }

    return (
      <ul ref={ref} className={cn('m-0 flex list-none flex-col gap-3 p-0', className)} {...props}>
        {items.map((item) => {
          const fraction = ceiling > 0 ? Math.max(0, Math.min(1, item.value / ceiling)) : 0;
          return (
            <li key={item.id} className="flex items-center gap-3" data-testid="bar-list-item">
              {item.leading ? <span className="shrink-0">{item.leading}</span> : null}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3 font-sans text-sm text-ink">
                  <span className="truncate font-bold">{item.label}</span>
                  <span className="shrink-0 tabular-nums">
                    {item.display ?? item.value.toLocaleString()}
                  </span>
                </div>
                <div
                  className="h-3 w-full overflow-hidden rounded-full border-2 border-outline bg-secondary"
                  role="presentation"
                >
                  <div
                    className={cn(
                      'h-full',
                      FILL[item.tone ?? 'primary'],
                      fraction > 0 && fraction < 1 && 'border-r-2 border-outline',
                    )}
                    style={{ width: `${fraction * 100}%` }}
                  />
                </div>
                {item.hint ? (
                  <span className="font-sans text-xs font-medium text-ink opacity-70">
                    {item.hint}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    );
  },
);
BarList.displayName = 'BarList';
