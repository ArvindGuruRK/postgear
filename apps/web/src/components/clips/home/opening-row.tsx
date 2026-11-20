'use client';

/**
 * A video on its way in that opens by itself once it is ready (2026-11-19,
 * `useOpenWhenReady`): its name, what it is waiting for and where it will
 * go, with **Stay Here** to stop the jump. Drawn like an upload row.
 */
import { Button, Spinner } from '@postgear/ui';
import { FileVideo } from 'lucide-react';
import type { Opening } from './use-open-when-ready';

export function openingLine(opening: Opening): string {
  if (opening.target === 'video') return 'Getting it ready. Its video page opens on its own.';
  return 'Getting it ready. The editor opens on its own.';
}

export function OpeningRow({ opening, onStay }: { opening: Opening; onStay: () => void }) {
  return (
    <li
      data-testid="clips-opening-row"
      className="flex animate-fadeIn items-center gap-3 rounded-md border-2 border-outline bg-inset p-3 motion-reduce:animate-none"
    >
      <FileVideo className="h-5 w-5 shrink-0 text-ink" strokeWidth={2.5} aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-sans text-sm font-bold text-ink">{opening.title}</span>
        <span
          className="flex items-center gap-2 font-sans text-xs text-ink type-muted"
          aria-live="polite"
        >
          <Spinner
            size="sm"
            role="presentation"
            aria-hidden="true"
            className="motion-reduce:animate-none"
          />
          {openingLine(opening)}
        </span>
      </div>
      <Button variant="secondary" size="sm" onClick={onStay}>
        Stay Here
      </Button>
    </li>
  );
}
