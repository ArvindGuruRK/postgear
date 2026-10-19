'use client';

/**
 * The header's "Templates" (2026-10-19, after Buffer's composer header): the
 * same starter templates as Home's row (`lib/post-templates.ts`), picked
 * without leaving the post. The composer decides where the words go
 * (`onPick`): they fill an empty editor, or go in at the cursor.
 */
import { NotebookPenIcon } from '@animateicons/react/lucide/notebook-pen-icon';
import { Button, cn, MotionIcon, Popover, PopoverContent, PopoverTrigger } from '@postgear/ui';
import { useState } from 'react';
import { POST_TEMPLATES } from '@/lib/post-templates';
import { useAfterClose } from './editor-inserts';

const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

export function TemplatesButton({
  onPick,
  disabled = false,
}: {
  onPick: (text: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // The words go in once the popover has let go of focus: see `useAfterClose`.
  const afterClose = useAfterClose();

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" disabled={disabled} aria-label="Templates">
          <MotionIcon icon={NotebookPenIcon} className="h-4 w-4" />
          {/* Phones keep the header to icons, as `DraftsButton` does. */}
          <span className="hidden sm:inline">Templates</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        aria-label="Templates"
        className="flex max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-2rem)] flex-col p-0"
        onCloseAutoFocus={afterClose.onCloseAutoFocus}
      >
        <ul className="m-0 flex min-h-0 list-none flex-col gap-1 overflow-y-auto p-2 pg-scrollbar pg-scrollbar-secondary">
          {POST_TEMPLATES.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                onClick={() => {
                  afterClose.later(() => onPick(template.text));
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-start text-ink hover:bg-actionPrimary/10',
                  FOCUS,
                )}
              >
                <span className="type-ui text-sm">{template.title}</span>
                <span className="line-clamp-2 font-sans text-xs opacity-75">
                  {template.description}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
