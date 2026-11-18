/**
 * The video page's keyboard (Module 07, section 3), in one table: Space,
 * J, K, L, the arrows (one second, five with Shift), I, O, Enter, + and -.
 * The page listens once and runs the command this returns. Nothing fires
 * while a field, a dialog or a menu has the keys (`isTyping`, shared with the
 * workflow builder so every page agrees on what typing is).
 */
import { isTyping } from '@/components/workflows/builder/builder-shortcuts';

export { isTyping };

export type VideoCommand =
  | 'togglePlay'
  | 'back'
  | 'pause'
  | 'forward'
  | 'stepBack'
  | 'stepForward'
  | 'stepBackLarge'
  | 'stepForwardLarge'
  | 'markIn'
  | 'markOut'
  | 'createClip'
  | 'zoomIn'
  | 'zoomOut';

export interface VideoShortcutKeys {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/** What the shortcuts sheet and the tooltips show. */
export const VIDEO_SHORTCUTS: ReadonlyArray<{ keys: readonly string[]; label: string }> = [
  { keys: ['Space'], label: 'Play or pause' },
  { keys: ['J'], label: 'Back 5 seconds' },
  { keys: ['K'], label: 'Pause' },
  { keys: ['L'], label: 'Forward 5 seconds' },
  { keys: ['Left'], label: 'Back 1 second (Shift for 5)' },
  { keys: ['Right'], label: 'Forward 1 second (Shift for 5)' },
  { keys: ['I'], label: 'Mark the start' },
  { keys: ['O'], label: 'Mark the end' },
  { keys: ['Enter'], label: 'Create the clip' },
  { keys: ['+'], label: 'Zoom in' },
  { keys: ['-'], label: 'Zoom out' },
];

/** The command for a key press, or null when it is not a video page shortcut. */
export function videoShortcutFor(event: VideoShortcutKeys): VideoCommand | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  switch (key) {
    case ' ':
    case 'Spacebar':
      return 'togglePlay';
    case 'j':
      return 'back';
    case 'k':
      return 'pause';
    case 'l':
      return 'forward';
    case 'ArrowLeft':
      return event.shiftKey ? 'stepBackLarge' : 'stepBack';
    case 'ArrowRight':
      return event.shiftKey ? 'stepForwardLarge' : 'stepForward';
    case 'i':
      return 'markIn';
    case 'o':
      return 'markOut';
    case 'Enter':
      return event.shiftKey ? null : 'createClip';
    case '+':
    case '=':
      return 'zoomIn';
    case '-':
    case '_':
      return 'zoomOut';
    default:
      return null;
  }
}
