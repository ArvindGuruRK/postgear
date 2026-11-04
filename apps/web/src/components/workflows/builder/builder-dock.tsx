'use client';

/**
 * The right-hand dock (after n8n, 2026-11-03): the step picker, Setup or
 * Versions, one at a time. It pushes the canvas instead of covering it, with
 * no dim, so the workflow stays in view and in reach.
 *
 * It is not a dialog, so what a modal gives for free is done here: focus moves
 * in when it opens, Esc closes it, and keys pressed inside stay inside.
 */
import { type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react';
import { keepKeysInPanel } from '../panel/panel-keys';
import type { PortId } from '@postgear/automation';
import type { Position } from './builder-state';

/** The picker was opened for a place: after a step, on a line, or as the first trigger. */
export type PickerPlace = {
  placement: 'next' | 'trigger';
  from?: { source: string; sourcePort: PortId };
  edgeId?: string;
  flowAt?: Position;
};

export type Dock =
  | { kind: 'picker'; place: PickerPlace | null }
  | { kind: 'setup' }
  | { kind: 'versions' };

const LABELS: Record<Dock['kind'], string> = {
  picker: 'Steps',
  setup: 'Setup',
  versions: 'Versions',
};

function isField(target: EventTarget): boolean {
  return Boolean((target as Element).closest?.('input, textarea, select, [contenteditable="true"]'));
}

export function BuilderDock({
  kind,
  onClose,
  children,
}: {
  kind: Dock['kind'];
  onClose: () => void;
  children: ReactNode;
}) {
  const box = useRef<HTMLElement>(null);

  // The picker focuses its own search.
  useEffect(() => {
    if (kind !== 'picker') box.current?.focus();
  }, [kind]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    // A menu or list inside is portalled out, and handles its own Esc.
    const inside = event.currentTarget.contains(event.target as Node);
    if (
      event.key === 'Escape' &&
      inside &&
      !event.defaultPrevented &&
      !isField(event.target)
    ) {
      event.stopPropagation();
      onClose();
      return;
    }
    keepKeysInPanel(event);
  }

  return (
    <aside
      ref={box}
      tabIndex={-1}
      aria-label={LABELS[kind]}
      data-testid="builder-dock"
      onKeyDown={onKeyDown}
      className="flex w-md min-h-0 shrink-0 flex-col border-l-2 border-outline bg-secondary outline-none"
    >
      {children}
    </aside>
  );
}
