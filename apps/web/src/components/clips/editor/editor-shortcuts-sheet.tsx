'use client';

/**
 * The clip editor's Keyboard Shortcuts sheet (Module 09 section 5), in the
 * workflow builder's look, grouped Playback, Editing and Timeline. It lists
 * `CLIP_SHORTCUT_GROUPS`, the same table the keys are read from, so the
 * sheet can never promise a key that does nothing.
 */
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@postgear/ui';
import { ShortcutKeys } from '@/components/workflows/builder/shortcut-keys';
import { CLIP_SHORTCUT_GROUPS, keyCaps } from './editor-shortcuts';

export function EditorShortcutsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="clip-shortcuts-sheet">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription className="sr-only">
            Shortcuts never fire while you type in a field.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 flex flex-col gap-4">
          {CLIP_SHORTCUT_GROUPS.map((group) => (
            <section key={group.name} aria-labelledby={`clip-shortcuts-${group.name}`}>
              <h3
                id={`clip-shortcuts-${group.name}`}
                className="m-0 mb-2 type-label text-xs text-ink muted-tone"
              >
                {group.name}
              </h3>
              <dl className="m-0 grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2.5">
                {group.rows.map((row) => (
                  <div key={row.label} className="contents">
                    <dt className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {row.keys.map((keys) => (
                        <ShortcutKeys key={keys} keys={keyCaps(keys)} />
                      ))}
                    </dt>
                    <dd className="m-0 font-sans text-sm text-ink">{row.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
