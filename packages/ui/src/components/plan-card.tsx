import { Check } from 'lucide-react';
import { cn } from '../lib/utils';
import { Badge } from './badge';
import { Button, type ButtonProps } from './button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './card';

export interface PlanCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  name: string;
  price: string;
  period?: string;
  description?: string;
  features: string[];
  highlighted?: boolean;
  badge?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionVariant?: ButtonProps['variant'];
}

/** Covers both "Upgrade/Plan Card" and "Pricing Card" — same shape, different copy. */
export function PlanCard({
  className,
  name,
  price,
  period = '/mo',
  description,
  features,
  highlighted,
  badge,
  actionLabel = 'Choose plan',
  onAction,
  actionVariant,
  ...props
}: PlanCardProps) {
  return (
    <Card
      className={cn('flex flex-col', highlighted && 'border-actionPrimary shadow-brutalLg', className)}
      {...props}
    >
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between">
          <CardTitle>{name}</CardTitle>
          {badge && <Badge variant={highlighted ? 'primary' : 'outline'}>{badge}</Badge>}
        </div>
        <div className="flex items-baseline gap-1">
          <span className="font-display text-4xl tracking-wide text-ink">{price}</span>
          <span className="font-sans text-sm text-ink opacity-60">{period}</span>
        </div>
        {description && <p className="font-sans text-sm text-ink opacity-70">{description}</p>}
      </CardHeader>
      <CardContent className="flex-1">
        <ul className="flex flex-col gap-2">
          {features.map((feature) => (
            <li key={feature} className="flex items-start gap-2 font-sans text-sm text-ink">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-actionSuccess" strokeWidth={3} />
              {feature}
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter>
        <Button variant={actionVariant ?? (highlighted ? 'primary' : 'secondary')} className="w-full" onClick={onAction}>
          {actionLabel}
        </Button>
      </CardFooter>
    </Card>
  );
}
