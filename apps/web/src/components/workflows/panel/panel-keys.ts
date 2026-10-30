/**
 * Keys pressed inside the step panel stay there (blueprint 5.3: "keydown
 * inside fields never deletes the selected canvas step"). The builder
 * listens on the window for its shortcuts; a panel stops a key on its way
 * up unless it is one the builder should still hear: Esc (close the
 * panel) and undo, redo, the command palette and Test Workflow
 * (Ctrl/Cmd+Enter), and only while the person is not typing, since a
 * field keeps its own undo.
 */
import type { KeyboardEvent } from 'react';

function isEditable(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  return Boolean(element.closest('input, textarea, select, [contenteditable="true"]'));
}

/** True when the builder's window listener should still see this key. */
export function keyLeavesPanel(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'target'>,
): boolean {
  if (isEditable(event.target)) return false;
  if (event.key === 'Escape') return true;
  const key = event.key.toLowerCase();
  return (
    (event.ctrlKey || event.metaKey) &&
    (key === 'z' || key === 'y' || key === 'k' || key === 'enter')
  );
}

/** The panel's `onKeyDown`: keeps every other key inside it. */
export function keepKeysInPanel(event: KeyboardEvent): void {
  if (!keyLeavesPanel(event)) event.stopPropagation();
}
