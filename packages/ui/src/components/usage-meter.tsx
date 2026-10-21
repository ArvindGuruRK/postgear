import { cn } from '../lib/utils';
import { Progress } from './progress';

/**
 * A labelled quota bar: "AI credits: 950 / 1,000". `tone` (Sprint 6) lets a
 * meter take the colour of the feature it measures (the credits meter on
 * the AI studio is `ai` so it reads as part of that surface), but the
 * ≥ 90% danger takeover is not a tone and can't be opted out of: a nearly
 * exhausted quota has to look the same everywhere, whatever colour the
 * feature wears. `caption` is one quiet line under the bar for the thing
 * the numbers don't say ("Resets 1 Nov, Growth").
 */
export interface UsageMeterProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: number;
  max: number;
  unit?: string;
  /** Fill colour below the limit. Danger still takes over at 90%. */
  tone?: 'primary' | 'ai' | 'accent' | 'success';
  caption?: React.ReactNode;
}

export function UsageMeter({
  className,
  label,
  value,
  max,
  unit = '',
  tone = 'primary',
  caption,
  ...props
}: UsageMeterProps) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const isNearLimit = percent >= 90;

  return (
    <div className={cn('flex flex-col gap-2', className)} {...props}>
      <div className="flex items-center justify-between font-sans text-sm text-ink">
        <span className="font-semibold">{label}</span>
        <span className={isNearLimit ? 'font-semibold text-dangerInk' : 'muted-tone'}>
          {value.toLocaleString()} / {max.toLocaleString()} {unit}
        </span>
      </div>
      <Progress value={percent} tone={isNearLimit ? 'danger' : tone} />
      {caption != null && (
        <span className="font-sans text-xs font-medium text-ink muted-tone">{caption}</span>
      )}
    </div>
  );
}
