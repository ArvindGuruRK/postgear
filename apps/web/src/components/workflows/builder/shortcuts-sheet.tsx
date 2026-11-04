'use client';

/** The keyboard shortcuts sheet (blueprint 4.6), opened with "?" or the command palette. */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@postgear/ui';
import { SHORTCUTS } from './builder-shortcuts';
import { ShortcutKeys } from './shortcut-keys';

export function ShortcutsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>Shortcuts never fire while you type in a field.</DialogDescription>
        </DialogHeader>
        <dl className="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2.5">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.keys} className="contents">
              <dt className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {shortcut.keys.split(', ').map((keys) => (
                  <ShortcutKeys key={keys} keys={keys.split('+')} />
                ))}
              </dt>
              <dd className="font-sans text-sm text-ink">{shortcut.label}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
