/**
 * The clip editor's keyboard (Module 09 section 5), in one place, in the
 * shape of the workflow builder's `builder-shortcuts.ts`: which key does
 * what (`clipShortcutFor`) and what the Keyboard Shortcuts sheet lists
 * (`CLIP_SHORTCUT_GROUPS`).
 *
 * Undo and redo are not here: Studio's `editorShortcut` reads them, because
 * it also knows when a field's own undo should win. Where a key may fire
 * (never while typing, inside a dialog or with one open) is decided by the
 * editor through Studio's `keyPlaceOf`, before this is asked.
 */

export type ClipShortcutCommand =
  | 'toggle'
  | 'frameBack'
  | 'frameForward'
  | 'secondBack'
  | 'secondForward'
  | 'start'
  | 'end'
  | 'split'
  | 'delete'
  | 'duplicate'
  | 'zoomIn'
  | 'zoomOut'
  | 'fit'
  | 'escape'
  | 'shortcuts';

export interface ClipShortcutPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** The command for a key press, or null when it is not one of the editor's keys. */
export function clipShortcutFor(press: ClipShortcutPress): ClipShortcutCommand | null {
  // Alt is snapping's key while dragging; Alt with anything else is the browser's or the system's.
  if (press.altKey) return null;
  const key = press.key.length === 1 ? press.key.toLowerCase() : press.key;

  if (press.ctrlKey || press.metaKey) {
    return key === 'd' && !press.shiftKey ? 'duplicate' : null;
  }

  // The keys that are typed with Shift on many layouts.
  if (key === '?') return 'shortcuts';
  if (key === '+' || key === '=') return 'zoomIn';
  if (key === '-' || key === '_') return 'zoomOut';

  if (press.shiftKey) {
    if (key === 'ArrowLeft') return 'secondBack';
    if (key === 'ArrowRight') return 'secondForward';
    if (key === 'z') return 'fit';
    return null;
  }

  switch (key) {
    case ' ':
    case 'Spacebar':
      return 'toggle';
    case 'ArrowLeft':
      return 'frameBack';
    case 'ArrowRight':
      return 'frameForward';
    case 'Home':
      return 'start';
    case 'End':
      return 'end';
    case 's':
      return 'split';
    case 'Delete':
    case 'Backspace':
      return 'delete';
    case 'Escape':
      return 'escape';
    default:
      return null;
  }
}

/**
 * Commands that a focused button, slider or tab owns for itself (Space
 * presses a button, the arrows move a slider): the editor leaves those keys
 * to it. The rest (split, delete, zoom) work wherever focus is.
 */
export const CONTROL_OWNED: ReadonlySet<ClipShortcutCommand> = new Set([
  'toggle',
  'frameBack',
  'frameForward',
  'secondBack',
  'secondForward',
  'start',
  'end',
]);

export interface ClipShortcutRow {
  /** Each way to press it, as key names joined by "+" ("Ctrl+Shift+Z"). */
  keys: readonly string[];
  label: string;
}

export interface ClipShortcutGroup {
  name: 'Playback' | 'Editing' | 'Timeline';
  rows: readonly ClipShortcutRow[];
}

/** What the Keyboard Shortcuts sheet lists, grouped, in its order. */
export const CLIP_SHORTCUT_GROUPS: readonly ClipShortcutGroup[] = [
  {
    name: 'Playback',
    rows: [
      { keys: ['Space'], label: 'Play or pause' },
      { keys: ['←', '→'], label: 'Back or forward one frame' },
      { keys: ['Shift+←', 'Shift+→'], label: 'Back or forward one second' },
      { keys: ['Home', 'End'], label: 'Go to the start or the end of the clip' },
    ],
  },
  {
    name: 'Editing',
    rows: [
      { keys: ['S'], label: 'Split at the playhead' },
      { keys: ['Delete', 'Backspace'], label: 'Remove the selected part or item' },
      { keys: ['Ctrl+D'], label: 'Duplicate the selected item' },
      { keys: ['Ctrl+Z'], label: 'Undo' },
      { keys: ['Ctrl+Shift+Z', 'Ctrl+Y'], label: 'Redo' },
      { keys: ['Esc'], label: 'Clear the selection' },
    ],
  },
  {
    name: 'Timeline',
    rows: [
      { keys: ['+', '-'], label: 'Zoom the timeline in or out' },
      { keys: ['Shift+Z'], label: 'Fit the whole clip in the timeline' },
      { keys: ['Alt'], label: 'Hold while dragging to turn snapping off' },
      { keys: ['?'], label: 'Show these shortcuts' },
    ],
  },
];

/** A key name split into caps: "Ctrl+Shift+Z" is three, "+" alone is one. */
export function keyCaps(keys: string): string[] {
  return keys === '+' ? ['+'] : keys.split('+');
}
