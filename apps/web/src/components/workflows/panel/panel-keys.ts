/**
 * Keys pressed inside the step panel stay there (blueprint 5.3: "keydown
 * inside fields never deletes the selected canvas step"). The builder
 * listens on the window for its shortcuts; a panel stops a key on its way
 * up unless it is one the builder should still hear: Esc (close the
 * panel) and undo, redo and Test Workflow (Ctrl/Cmd+Enter), only while the
 * person is not typing, since a field keeps its own undo; and the command
 * palette (Ctrl/Cmd+K) always, which no field wants and the browser would take.
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
  const key = event.key.toLowerCase();
  const mod = event.ctrlKey || event.metaKey;
  if (mod && key === 'k') return true;
  if (isEditable(event.target)) return false;
  if (event.key === 'Escape') return true;
  return mod && (key === 'z' || key === 'y' || key === 'enter');
}

/** The panel's `onKeyDown`: keeps every other key inside it. */
export function keepKeysInPanel(event: KeyboardEvent): void {
  if (!keyLeavesPanel(event)) event.stopPropagation();
}
