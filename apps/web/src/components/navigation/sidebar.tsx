'use client';

import { EllipsisIcon } from '@animateicons/react/lucide/ellipsis-icon';
import {
  type AnimatedIcon,
  cn,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  useIconAnimation,
} from '@postgear/ui';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { BrandMark } from '@/components/brand/brand-mark';

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
  className,
}: SidebarItem & { className?: string }) {
  const icon = useIconAnimation();

  return (
    <Link
      href={href}
      title={label}
      aria-current={active ? 'page' : undefined}
      {...icon.triggers}
      className={cn(TILE(active), className)}
    >
      {AnimatedRailIcon ? (
        // The library fixes stroke-width="2" on the svg; CSS outranks the
        // attribute, which keeps the animated set at the lucide set's weight.
        <AnimatedRailIcon ref={icon.ref} aria-hidden size={20} className={ANIMATED_TILE_ICON} />
      ) : Icon ? (
        <Icon className="h-5 w-5 shrink-0" strokeWidth={2.25} />
      ) : null}
      <span className={TILE_LABEL}>{label}</span>
    </Link>
  );
}

/** A rail tile's frame; the tab bar's tiles are the same tile, sized to share the row. */
const TILE = (active?: boolean) =>
  cn(
    'flex w-16 flex-col items-center justify-center gap-1 rounded-xl border-2 px-0.5 py-2',
    'outline-none transition-[transform,box-shadow,background-color] duration-100',
    'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
    active
      ? 'border-outline bg-actionPrimary text-onActionPrimary shadow-brutalSm active:translate-x-[1px] active:translate-y-[1px] active:shadow-brutalPressed'
      : 'border-transparent text-ink hover:border-outline hover:bg-primary',
  );

const ANIMATED_TILE_ICON = '!block h-5 w-5 shrink-0 [&_svg]:[stroke-width:2.25]';

const TILE_LABEL = 'line-clamp-2 w-full break-words text-center type-ui text-[10px] leading-[1.15]';

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
  brandLabel = 'PostGear',
  className,
}: {
  items: SidebarItem[];
  /** Pinned to the bottom of the rail (e.g. Billing, Settings). */
  bottomItems?: SidebarItem[];
  /** Accessible name of the brand mark. */
  brandLabel?: string;
  className?: string;
}) {
  return (
    <aside
      aria-label="Main"
      className={cn(
        'flex w-20 shrink-0 flex-col items-center gap-4 rounded-2xl border-2 border-outline bg-chrome pt-1 pb-3 shadow-surfaceMd',
        className,
      )}
    >
      {/* The logo's Cog Badge in place of the old "P" tile. It carries its own
          outline, so no tile border or shadow around it. 64px, as wide as the
          nav tiles (w-16), the owner's pick (2026-10-27, down from 68px).
          The gear's teeth stop about as far from the top edge (pt-1 plus the
          mark's own margin) as from the sides. */}
      <span title={brandLabel} className="flex h-16 w-16 shrink-0 items-center justify-center">
        <BrandMark label={brandLabel} className="h-16 w-16" />
      </span>

      <nav
        aria-label="Sections"
        className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto overflow-x-hidden pg-scrollbar-hidden"
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

/** Tiles a phone's bar holds before the rest move behind More. */
const TAB_SLOTS = 5;

/**
 * The rail on a phone (below `md`): the same tiles in a bar along the bottom,
 * the pattern of most mobile SaaS apps, framed and inset like the rail.
 *
 * A bottom bar rather than a menu button: every main destination stays one
 * tap away and within a thumb's reach, where a menu would hide all of them
 * behind a tap at the top of the screen. Nine entries do not fit five 70px
 * slots, so the first four sections stay (Home, Calendar, Copilot, Queue)
 * and the rest (Analytics, Media, Studio, SEO, Settings)
 * open from More in a sheet; More takes the active fill while one of those is
 * the current page. Its bottom margin is at least the safe-area inset, so the
 * bar clears the home indicator now that the page reaches under it
 * (`viewport-fit=cover`, root layout); the More sheet's bottom edge does the
 * same inside Sheet.
 */
export function TabBar({
  items,
  bottomItems = [],
  className,
}: {
  items: SidebarItem[];
  bottomItems?: SidebarItem[];
  className?: string;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreIcon = useIconAnimation();
  const all = [...items, ...bottomItems];
  const fits = all.length <= TAB_SLOTS;
  const shown = fits ? all : all.slice(0, TAB_SLOTS - 1);
  const overflow = fits ? [] : all.slice(TAB_SLOTS - 1);
  const overflowActive = overflow.some((item) => item.active);

  return (
    <nav
      aria-label="Main"
      className={cn(
        'mx-3 mb-[max(0.75rem,env(safe-area-inset-bottom))] flex shrink-0 gap-1 rounded-2xl border-2 border-outline bg-chrome p-1.5 shadow-surfaceMd',
        className,
      )}
    >
      {shown.map((item) => (
        <RailItem key={item.href} {...item} className="w-auto min-w-0 flex-1" />
      ))}

      {overflow.length > 0 ? (
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger
            title="More"
            {...moreIcon.triggers}
            className={cn(TILE(overflowActive), 'w-auto min-w-0 flex-1')}
          >
            <EllipsisIcon ref={moreIcon.ref} aria-hidden size={20} className={ANIMATED_TILE_ICON} />
            <span className={TILE_LABEL}>More</span>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            aria-describedby={undefined}
            // A tile's click closes the sheet as the page changes beneath it.
            onClickCapture={(event) => {
              if ((event.target as Element).closest('a')) setMoreOpen(false);
            }}
            className="rounded-t-2xl"
          >
            <SheetTitle className="text-xl">More</SheetTitle>
            <div className="flex flex-wrap gap-2">
              {overflow.map((item) => (
                <RailItem key={item.href} {...item} className="w-20" />
              ))}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </nav>
  );
}
