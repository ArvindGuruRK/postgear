import type { PostSummary } from '@/types/post';
import type { SlotTarget } from './calendar-slot';

/** What every calendar view hands to its cells and cards. */
export interface CalendarHandlers {
  /** The composer, opened on a post: where a card's body goes. */
  editHref: (post: PostSummary) => string;
  /** The composer, starting a new post from this one's text and media. */
  onDuplicate: (post: PostSummary) => void;
  onPreview: (post: PostSummary) => void;
  /** Absent for a role that may not read analytics (an Editor, Module 14). */
  onStatistics?: (post: PostSummary) => void;
  onDelete: (post: PostSummary) => void;
  /**
   * An Editor (Module 14): the calendar is read only. No drag, no
   * Reschedule or Post Now, Delete for drafts only; a card still opens the
   * composer, and a free slot still starts a draft there.
   */
  draftsOnly: boolean;
  /** A future slot was clicked: start a post at its time. */
  onCreate: (target: SlotTarget) => void;
  /** A day's header was clicked: open that day in the day view. */
  onShowDay: (day: Date) => void;
}
