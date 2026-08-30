import { ArrowDown, ArrowUp, type LucideIcon } from 'lucide-react';
import { forwardRef } from 'react';
import { cn } from '../lib/utils';
import { Card } from './card';

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  trend?: { value: string; direction: 'up' | 'down' };
}

export const StatCard = forwardRef<HTMLDivElement, StatCardProps>(
  ({ className, label, value, icon: Icon, trend, ...props }, ref) => (
    <Card ref={ref} className={cn('flex flex-col gap-2 p-6', className)} {...props}>
      <div className="flex items-center justify-between">
        <p className="font-display text-xs uppercase tracking-wide text-ink opacity-60">{label}</p>
        {Icon && <Icon className="h-5 w-5 text-ink opacity-60" strokeWidth={2.5} />}
      </div>
      <p className="font-display text-3xl tracking-wide text-ink">{value}</p>
      {trend && (
        <span
          className={cn(
            'inline-flex w-fit items-center gap-1 font-sans text-xs font-semibold',
            trend.direction === 'up' ? 'text-actionSuccess' : 'text-actionDanger',
          )}
        >
          {trend.direction === 'up' ? (
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={3} />
          ) : (
            <ArrowDown className="h-3.5 w-3.5" strokeWidth={3} />
          )}
          {trend.value}
        </span>
      )}
    </Card>
  ),
);
StatCard.displayName = 'StatCard';
