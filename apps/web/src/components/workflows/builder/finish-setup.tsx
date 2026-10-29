'use client';

/**
 * Finish Setup (Module 05, blueprint section 9; Zapier's and Make's
 * template setup): a small floating checklist on the canvas with what is
 * left before the workflow can be tested, one line per step. Choosing a
 * line opens that step on the field to fix (focus-the-field). It ticks off live as issues clear; once empty it
 * says "Ready to test." and can be closed.
 */
import { XIcon } from '@animateicons/react/lucide/x-icon';
import { Button, MotionIcon } from '@postgear/ui';
import { CircleCheck } from 'lucide-react';
import { AppIcon } from '../app-icon';
import { SETUP_DONE, type SetupItem } from './builder-view-model';

export function FinishSetup({
  items,
  onOpen,
  onDismiss,
}: {
  items: SetupItem[];
  onOpen: (item: SetupItem) => void;
  onDismiss: () => void;
}) {
  return (
    <section
      aria-label="Finish Setup"
      data-testid="finish-setup"
      className="w-72 rounded-card border-2 border-outline bg-secondary p-3 shadow-brutalMd"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="type-heading text-base text-ink">Finish Setup</h2>
        <Button
          variant="secondary"
          size="sm"
          className="h-8 w-8 px-0"
          aria-label="Close Finish Setup"
          onClick={onDismiss}
        >
          <MotionIcon icon={XIcon} className="h-4 w-4" />
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="flex items-center gap-2 font-sans text-sm text-ink" role="status">
          <CircleCheck
            aria-hidden="true"
            className="h-4 w-4 text-actionSuccess"
            strokeWidth={2.5}
          />
          {SETUP_DONE}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={`${item.nodeKey ?? 'workflow'}-${item.message}`}>
              <button
                type="button"
                disabled={!item.nodeKey}
                onClick={() => item.nodeKey && onOpen(item)}
                className="flex w-full items-start gap-2 rounded-md border-2 border-transparent p-1.5 text-left hover:border-outline disabled:cursor-default disabled:hover:border-transparent"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-secondary">
                  {item.icon ? <AppIcon icon={item.icon} className="h-3.5 w-3.5" /> : null}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="type-ui truncate text-xs text-ink">{item.stepName}</span>
                  <span className="font-sans text-xs text-ink type-muted">{item.message}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
