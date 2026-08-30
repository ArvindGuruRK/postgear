import { cn } from '../lib/utils';
import { Progress } from './progress';

export interface UsageMeterProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: number;
  max: number;
  unit?: string;
}

export function UsageMeter({ className, label, value, max, unit = '', ...props }: UsageMeterProps) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const isNearLimit = percent >= 90;

  return (
    <div className={cn('flex flex-col gap-2', className)} {...props}>
      <div className="flex items-center justify-between font-sans text-sm text-ink">
        <span className="font-semibold">{label}</span>
        <span className={cn('opacity-70', isNearLimit && 'font-semibold text-actionDanger opacity-100')}>
          {value.toLocaleString()} / {max.toLocaleString()} {unit}
        </span>
      </div>
      <Progress value={percent} className={isNearLimit ? '[&>div]:bg-actionDanger' : undefined} />
    </div>
  );
}
