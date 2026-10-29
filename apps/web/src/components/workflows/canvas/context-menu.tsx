'use client';

/**
 * The canvas's right-click menu (blueprint 4.5), opened at the pointer. The
 * builder decides the items for what was clicked (a step, a note, a line or
 * the canvas); this only draws them, with their shortcuts.
 */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@postgear/ui';
import type { ScreenPoint } from '../builder/builder-context';

export interface MenuItem {
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  /** A line above this item. */
  separated?: boolean;
  onSelect: () => void;
}

export function CanvasContextMenu({
  at,
  items,
  onClose,
}: {
  at: ScreenPoint | null;
  items: MenuItem[];
  onClose: () => void;
}) {
  return (
    <DropdownMenu
      open={at !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      modal={false}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed h-px w-px"
          style={{ left: at?.x ?? 0, top: at?.y ?? 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={2} className="min-w-52">
        {items.map((item) => (
          <div key={item.label}>
            {item.separated ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              disabled={item.disabled}
              className={item.danger ? 'text-dangerInk' : undefined}
              onSelect={item.onSelect}
            >
              {item.label}
              {item.shortcut ? (
                <span className="ms-auto ps-4 font-sans text-xs text-ink type-muted">
                  {item.shortcut}
                </span>
              ) : null}
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
