import { cn } from './utils';

/**
 * A key: one small tile of a set you choose from, with no frame around the set.
 * The time picker's look (2026-10-19), and `ChoiceTiles` since 2026-11-04. The
 * chosen one is the primary fill, as on the calendar's grid. The caller adds the
 * size and the type.
 */
export const keyTile = (active: boolean) =>
  cn(
    'rounded-md border-2 border-outline outline-none transition-[transform,background-color] duration-100',
    'active:translate-x-[1px] active:translate-y-[1px]',
    'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-focusRing',
    active
      ? 'bg-actionPrimary text-onActionPrimary'
      : 'bg-primary text-ink hover:bg-actionPrimary/20',
  );
