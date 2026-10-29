import { cn } from '@postgear/ui';
import { PlatformIcon } from '../platforms/platform-icon';
import { iconSource } from './icons';

/**
 * A step's or app's icon by its `IconKey`: the platform logo for social
 * steps, a lucide glyph for the rest. Decorative unless `title` is given.
 */
export function AppIcon({
  icon,
  className,
  title,
}: {
  icon: string;
  className?: string;
  title?: string;
}) {
  const source = iconSource(icon);
  if ('platform' in source) {
    return <PlatformIcon platform={source.platform} className={className} title={title} />;
  }
  const Glyph = source.glyph;
  return title ? (
    <Glyph
      className={cn('h-4 w-4 shrink-0 text-ink', className)}
      strokeWidth={2.5}
      role="img"
      aria-label={title}
    />
  ) : (
    <Glyph
      className={cn('h-4 w-4 shrink-0 text-ink', className)}
      strokeWidth={2.5}
      aria-hidden="true"
    />
  );
}
