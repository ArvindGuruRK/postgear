/**
 * The builder's keyboard (Module 05, blueprint 4.6), in one place: which
 * key does what, and the "is the person typing" guard, so a shortcut never
 * fires inside a field, a dialog or a menu. The builder page listens once
 * and runs the command this returns. The shortcuts sheet reads `SHORTCUTS`.
 */

export type ShortcutCommand =
  | 'openPicker'
  | 'addNote'
  | 'openStep'
  | 'rename'
  | 'toggleDisabled'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'delete'
  | 'undo'
  | 'redo'
  | 'palette'
  | 'fit'
  | 'resetZoom'
  | 'selectAll'
  | 'next'
  | 'previous'
  | 'shortcuts'
  | 'escape';

export interface ShortcutKeys {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/** True when keys belong to what has focus: a field, an editable area, a dialog or a menu. */
export function isTyping(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  if (element.closest('input, textarea, select, [contenteditable="true"]')) return true;
  return Boolean(
    element.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'),
  );
}

/** The command for a key press, or null when it is not a builder shortcut. */
export function shortcutFor(event: ShortcutKeys): ShortcutCommand | null {
  const mod = Boolean(event.ctrlKey || event.metaKey);
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (event.altKey) return null;

  if (mod) {
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
    if (key === 'y') return 'redo';
    if (key === 'c') return 'copy';
    if (key === 'v') return 'paste';
    if (key === 'd') return 'duplicate';
    if (key === 'k') return 'palette';
    if (key === 'a') return 'selectAll';
    return null;
  }

  if (event.shiftKey && key === 's') return 'addNote';
  if (key === '?' || (event.shiftKey && key === '/')) return 'shortcuts';
  if (event.shiftKey) return null;

  switch (key) {
    case 'n':
      return 'openPicker';
    case 'Enter':
      return 'openStep';
    case 'F2':
      return 'rename';
    case 'd':
      return 'toggleDisabled';
    case 'Delete':
    case 'Backspace':
      return 'delete';
    case '1':
      return 'fit';
    case '0':
      return 'resetZoom';
    case 'ArrowRight':
    case 'ArrowDown':
      return 'next';
    case 'ArrowLeft':
    case 'ArrowUp':
      return 'previous';
    case 'Escape':
      return 'escape';
    default:
      return null;
  }
}

/** What the shortcuts sheet lists, in its order. Pin Data and Test arrive with Module 08. */
export const SHORTCUTS: readonly { keys: string; label: string }[] = [
  { keys: 'N', label: 'Open the step picker' },
  { keys: 'Shift+S', label: 'Add a sticky note' },
  { keys: 'Enter', label: 'Open the selected step (again for the Expanded view)' },
  { keys: 'F2', label: 'Rename the selected step' },
  { keys: 'D', label: 'Turn the selected step off or on' },
  { keys: 'Ctrl+C, Ctrl+V, Ctrl+D', label: 'Copy, paste, duplicate' },
  { keys: 'Delete, Backspace', label: 'Delete the selection' },
  { keys: 'Ctrl+Z, Ctrl+Shift+Z', label: 'Undo, redo' },
  { keys: 'Ctrl+A', label: 'Select every step' },
  { keys: 'Ctrl+K', label: 'Open the command palette' },
  { keys: '1, 0', label: 'Fit to screen, reset zoom' },
  { keys: 'Arrow keys', label: 'Move to the next or previous step along the lines' },
  { keys: 'Space+drag', label: 'Pan the canvas' },
  { keys: '?', label: 'Show these shortcuts' },
  { keys: 'Esc', label: 'Close the picker or panel, then clear the selection' },
];
