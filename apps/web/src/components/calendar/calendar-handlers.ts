import type { PostSummary } from '@/types/post';
import type { SlotTarget } from './calendar-slot';

/** What every calendar view hands to its cells and cards. */
export interface CalendarHandlers {
  /** The composer, opened on a post: where a card's body goes. */
  editHref: (post: PostSummary) => string;
  /** The composer, starting a new post from this one's text and media. */
  onDuplicate: (post: PostSummary) => void;
  onPreview: (post: PostSummary) => void;
  onStatistics: (post: PostSummary) => void;
  onDelete: (post: PostSummary) => void;
  /** A future slot was clicked: start a post at its time. */
  onCreate: (target: SlotTarget) => void;
  /** A day's header was clicked: open that day in the day view. */
  onShowDay: (day: Date) => void;
}
