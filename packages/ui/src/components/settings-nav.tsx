import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';

export interface SettingsNavItem {
  label: string;
  href: string;
  icon?: LucideIcon;
}

export interface SettingsNavProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children'> {
  items: SettingsNavItem[];
  activeHref: string;
  /** Defaults to a plain `<a>` — pass the app's own routing Link (e.g. next/link) to integrate real navigation. */
  linkComponent?: React.ElementType;
}

export function SettingsNav({
  className,
  items,
  activeHref,
  linkComponent: LinkComponent = 'a',
  ...props
}: SettingsNavProps) {
  return (
    <nav className={cn('flex flex-col gap-1', className)} {...props}>
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = item.href === activeHref;
        return (
          <LinkComponent
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-2 rounded-md border-2 px-3 py-2 font-sans text-sm font-medium outline-none transition-colors',
              'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-actionAccent',
              isActive
                ? 'border-outline bg-actionPrimary text-onActionPrimary shadow-brutalSm'
                : 'border-transparent text-ink hover:bg-actionPrimary/10',
            )}
          >
            {Icon && <Icon className="h-4 w-4" strokeWidth={2.5} />}
            {item.label}
          </LinkComponent>
        );
      })}
    </nav>
  );
}
