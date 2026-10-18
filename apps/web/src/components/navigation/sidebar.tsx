'use client';

import { type AnimatedIcon, cn, useIconAnimation } from '@postgear/ui';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

interface SidebarItemBase {
  label: string;
  href: string;
  active?: boolean;
}

/** Either a static lucide glyph or an animated one, never both. */
export type SidebarItem = SidebarItemBase &
  ({ icon: LucideIcon; animatedIcon?: never } | { animatedIcon: AnimatedIcon; icon?: never });

/**
 * One rail entry: the icon above a short label, the reference's menu item.
 *
 * Always labelled, never icon-only: at 64px wide the label still fits on two
 * lines, and a rail of bare glyphs makes people hover to find Analytics.
 * The active entry takes the primary fill and a pressable shadow, the same
 * treatment as a pressed Button, so "where am I" reads from across the room.
 *
 * An animated icon plays from anywhere on the tile and on keyboard focus:
 * see `useIconAnimation`.
 */
function RailItem({
  label,
  href,
  icon: Icon,
  animatedIcon: AnimatedRailIcon,
  active,
}: SidebarItem) {
  const icon = useIconAnimation();

  return (
    <Link
      href={href}
      title={label}
      aria-current={active ? 'page' : undefined}
      {...icon.triggers}
      className={cn(
        'flex w-16 flex-col items-center justify-center gap-1 rounded-xl border-2 px-0.5 py-2',
        'outline-none transition-[transform,box-shadow,background-color] duration-100',
        'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
        active
          ? 'border-outline bg-actionPrimary text-onActionPrimary shadow-brutalSm active:translate-x-[1px] active:translate-y-[1px] active:shadow-brutalPressed'
          : 'border-transparent text-ink hover:border-outline hover:bg-primary',
      )}
    >
      {AnimatedRailIcon ? (
        // The library fixes stroke-width="2" on the svg; CSS outranks the
        // attribute, which keeps the animated set at the lucide set's weight.
        <AnimatedRailIcon
          ref={icon.ref}
          aria-hidden
          size={20}
          className="!block h-5 w-5 shrink-0 [&_svg]:[stroke-width:2.25]"
        />
      ) : Icon ? (
        <Icon className="h-5 w-5 shrink-0" strokeWidth={2.25} />
      ) : null}
      <span className="line-clamp-2 w-full break-words text-center type-ui text-[10px] leading-[1.15]">
        {label}
      </span>
    </Link>
  );
}

/**
 * The app rail (UI revamp, 2026-10-18), after the reference's left menu: a
 * fixed 80px column with the brand mark on top, the product sections under
 * it, and account-level destinations pinned to the bottom.
 *
 * Fixed width on purpose. The expanding sidebar it replaces spent 150px on
 * labels the rail already shows, and the calendar needs that width; the
 * collapsible column moved one level in, to the calendar's channel list.
 */
export function Sidebar({
  items,
  bottomItems = [],
  brand = 'P',
  brandLabel = 'PostGear',
}: {
  items: SidebarItem[];
  /** Pinned to the bottom of the rail (e.g. Billing, Settings). */
  bottomItems?: SidebarItem[];
  /** Monogram shown in the brand tile. */
  brand?: ReactNode;
  /** Accessible name of the brand tile. */
  brandLabel?: string;
}) {
  return (
    <aside
      aria-label="Main"
      className="flex w-20 shrink-0 flex-col items-center gap-6 rounded-2xl border-2 border-outline bg-chrome py-3 shadow-surfaceMd"
    >
      <span
        role="img"
        aria-label={brandLabel}
        title={brandLabel}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-2 border-outline bg-actionPrimary shadow-brutalSm"
      >
        <span className="type-heading text-2xl leading-none text-onActionPrimary">{brand}</span>
      </span>

      <nav
        aria-label="Sections"
        className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto overflow-x-hidden pg-scrollbar pg-scrollbar-chrome"
      >
        {items.map((item) => (
          <RailItem key={item.href} {...item} />
        ))}
      </nav>

      {bottomItems.length > 0 ? (
        <nav aria-label="Account" className="flex w-full flex-col items-center gap-2">
          {bottomItems.map((item) => (
            <RailItem key={item.href} {...item} />
          ))}
        </nav>
      ) : null}
    </aside>
  );
}
