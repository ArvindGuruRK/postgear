'use client';

import {
  Children,
  type CSSProperties,
  createContext,
  forwardRef,
  isValidElement,
  type ReactNode,
  useContext,
} from 'react';
import { cn } from '../lib/utils';
import { type AvatarSize, AvatarSizeContext, avatarVariants } from './avatar';
import { TooltipHint } from './tooltip';

/**
 * Avatar group (2026-10-19), after Jira's: a row of avatars that only just
 * overlap, each cut out of the one beside it by a ring of the surface color,
 * with each person's initials in their own palette color (`avatarColor`).
 * Hovering or focusing one lifts it above the row on a hard shadow and names
 * it in a tooltip underneath.
 *
 * The first avatar sits on top and each one after tucks under its neighbour,
 * so whatever is pinned to an avatar's trailing corner (a channel's status
 * dot) is never covered by the next.
 *
 * The ring is `--pg-avatar-ring`, the card surface by default. A group on
 * another ground, or on a row that tints on hover, sets the variable to that
 * color so the ring keeps reading as a gap rather than a halo.
 */

/** How far each avatar tucks under the one before it: a sliver, so initials are never covered. */
const OVERLAP: Record<AvatarSize, string> = {
  xs: '-ms-0.5',
  sm: '-ms-1',
  md: '-ms-1',
  lg: '-ms-1.5',
};

/**
 * The ring, the lift and the focus ring, shared by every avatar and the
 * overflow chip. The lifted shadow spreads by the ring's 2px so it falls
 * past the ring instead of hiding under it.
 */
const ITEM = cn(
  'relative inline-flex shrink-0 rounded-full outline-none',
  'ring-2 ring-[color:var(--pg-avatar-ring,var(--color-secondary))]',
  'transition-[translate,box-shadow] duration-150 ease-out motion-reduce:transition-none',
  'hover:-translate-y-(--brutal-offset-sm) hover:shadow-[var(--brutal-offset-sm)_var(--brutal-offset-sm)_0_2px_var(--color-outline)]',
  'focus-visible:-translate-y-(--brutal-offset-sm) focus-visible:shadow-[var(--brutal-offset-sm)_var(--brutal-offset-sm)_0_2px_var(--color-outline)]',
  'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
);

interface GroupContextValue {
  focusable: boolean;
}

const GroupContext = createContext<GroupContextValue>({ focusable: true });

export interface AvatarGroupProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Truncates to this many avatars and shows a "+N" overflow chip. */
  max?: number;
  /** One size for every avatar in the group (an avatar may still name its own). */
  size?: AvatarSize;
  /**
   * Whether each avatar takes keyboard focus, so its name can be read
   * without a pointer. Set false when the group sits inside a link or button:
   * a focusable element nested in another one is invalid HTML and splits the
   * card into two tab stops. The names still show on hover; the control
   * around the group is what keyboard and screen reader users reach.
   */
  focusable?: boolean;
}

export const AvatarGroup = forwardRef<HTMLSpanElement, AvatarGroupProps>(
  ({ className, max, size = 'md', focusable = true, children, ...props }, ref) => {
    const items = Children.toArray(children);
    const visible = max ? items.slice(0, max) : items;
    const hidden = max ? items.slice(max) : [];
    const hiddenNames = hidden.flatMap((child) =>
      isValidElement<{ name?: unknown }>(child) && typeof child.props.name === 'string'
        ? [child.props.name]
        : [],
    );
    const count = visible.length + (hidden.length > 0 ? 1 : 0);

    // A span, not a div: the group often sits inside a button or link, where
    // only phrasing content is valid.
    return (
      <GroupContext.Provider value={{ focusable }}>
        <AvatarSizeContext.Provider value={size}>
          <span ref={ref} className={cn('isolate flex items-center', className)} {...props}>
            {visible.map((child, index) => (
              <Slot
                key={isValidElement(child) ? child.key : index}
                index={index}
                count={count}
                size={size}
              >
                {child}
              </Slot>
            ))}
            {hidden.length > 0 ? (
              <Slot index={visible.length} count={count} size={size}>
                <OverflowChip count={hidden.length} names={hiddenNames} size={size} />
              </Slot>
            ) : null}
          </span>
        </AvatarSizeContext.Provider>
      </GroupContext.Provider>
    );
  },
);
AvatarGroup.displayName = 'AvatarGroup';

/**
 * One place in the row: the overlap, and the stacking that puts the first on
 * top. The hovered or focused one jumps to the front. `isolate` on the group
 * keeps these z-indexes inside it, so they never rise above a sticky header
 * or a menu elsewhere on the page.
 */
function Slot({
  index,
  count,
  size,
  children,
}: {
  index: number;
  count: number;
  size: AvatarSize;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'relative z-(--pg-avatar-z) flex hover:z-20 focus-within:z-20',
        index > 0 && OVERLAP[size],
      )}
      style={{ '--pg-avatar-z': count - index } as CSSProperties}
    >
      {children}
    </span>
  );
}

export interface AvatarGroupItemProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** The person's or channel's full name: the tooltip and the accessible name. */
  name: string;
  /** Tooltip and accessible name when it should say more than the name, e.g. a channel's status. */
  label?: string;
  /** The `Avatar`, plus anything pinned to it (a status dot). */
  children: ReactNode;
}

/** One avatar in an `AvatarGroup`, with its name on hover and focus. */
export const AvatarGroupItem = forwardRef<HTMLSpanElement, AvatarGroupItemProps>(
  ({ name, label, className, children, ...props }, ref) => {
    const { focusable } = useContext(GroupContext);
    const text = label ?? name;

    return (
      // Not hoverable: the avatars sit flush, so the tooltip closes the
      // moment the pointer moves on rather than covering the next name.
      <TooltipHint label={text} side="bottom" hoverable={false}>
        <span
          ref={ref}
          role="img"
          aria-label={text}
          // Focusable so the name can be read by keyboard too.
          tabIndex={focusable ? 0 : undefined}
          className={cn(ITEM, className)}
          {...props}
        >
          {children}
        </span>
      </TooltipHint>
    );
  },
);
AvatarGroupItem.displayName = 'AvatarGroupItem';

/** The "+N" chip: the hidden avatars' names in its tooltip. */
function OverflowChip({
  count,
  names,
  size,
}: {
  count: number;
  names: string[];
  size: AvatarSize;
}) {
  const { focusable } = useContext(GroupContext);
  const label = names.length > 0 ? `${count} more: ${names.join(', ')}` : `${count} more`;

  return (
    <TooltipHint
      label={names.length > 0 ? names.join(', ') : label}
      side="bottom"
      hoverable={false}
    >
      <span
        role="img"
        aria-label={label}
        // Focusable so the hidden names can be read by keyboard too.
        tabIndex={focusable ? 0 : undefined}
        className={cn(ITEM, avatarVariants({ size }), 'type-ui text-ink')}
      >
        +{count}
      </span>
    </TooltipHint>
  );
}
