'use client';

import { XIcon } from '@animateicons/react/lucide/x-icon';
import { cn } from '../lib/utils';
import { MotionIcon } from './motion-icon';

export interface BulkActionBarProps extends React.HTMLAttributes<HTMLDivElement> {
  count: number;
  onClear: () => void;
  actions?: React.ReactNode;
}

/** A floating bar meant to appear once `count > 0` (e.g. rendered fixed/sticky above a data table). */
export function BulkActionBar({
  className,
  count,
  onClear,
  actions,
  ...props
}: BulkActionBarProps) {
  if (count === 0) return null;
  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-md border-2 border-outline bg-secondary px-4 py-3 shadow-surfaceLg',
        className,
      )}
      {...props}
    >
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-md border-2 border-outline bg-secondary outline-none',
          'hover:opacity-80 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
        )}
      >
        <MotionIcon icon={XIcon} size={14} className="h-3.5 w-3.5" strokeWidth={3} />
      </button>
      <span className="type-label text-sm text-ink">{count} selected</span>
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}
