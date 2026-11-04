/**
 * A step's run state as a bare icon: on a card's corner and in the Logs list. Each state has its
 * own shape, so it never rests on colour alone. Whoever shows it says the words too, in a tooltip
 * or for screen readers.
 */
import { cn } from '@postgear/ui';
import {
  Check,
  CircleAlert,
  CircleStop,
  Clock,
  LoaderCircle,
  type LucideIcon,
  Pause,
  SkipForward,
  X,
} from 'lucide-react';
import type { BadgeIcon, BadgeTone } from './step-paint';

const RUN_ICONS: Record<BadgeIcon, LucideIcon> = {
  check: Check,
  cross: X,
  pause: Pause,
  alert: CircleAlert,
  clock: Clock,
  spinner: LoaderCircle,
  skip: SkipForward,
  stop: CircleStop,
};

const RUN_TONE: Record<BadgeTone, string> = {
  success: 'text-successInk',
  danger: 'text-dangerInk',
  accent: 'text-actionAccent',
  primary: 'text-ink',
  neutral: 'text-ink',
};

export function RunGlyph({
  look,
  className,
}: {
  look: { icon: BadgeIcon; tone: BadgeTone };
  className?: string;
}) {
  const Glyph = RUN_ICONS[look.icon];
  return (
    <Glyph
      aria-hidden="true"
      className={cn(
        className,
        RUN_TONE[look.tone],
        look.icon === 'spinner' ? 'animate-spin motion-reduce:animate-none' : '',
      )}
      strokeWidth={2.75}
    />
  );
}
