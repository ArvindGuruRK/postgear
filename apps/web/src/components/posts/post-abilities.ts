/**
 * What can be done to a post from the calendar and the queue (its card, its
 * row menu and its detail dialog), as one pure rule so the three agree.
 *
 * - **Post Now** (or Retry Now) for a queued or failed post.
 * - **Reschedule** and drag for anything not yet published.
 * - **Delete** until any channel has published (the API then refuses).
 *
 * `draftsOnly` is an Editor (Sprint 13, Module 14; `canSchedule` answers no):
 * the calendar is read only to them. No Post Now, no Reschedule, no drag, and
 * Delete only for a draft, which is the one kind of post they may change.
 * Opening a post in the composer stays: there it is a draft they can edit, or
 * read only. Presentation only; the API refuses the same (`editor_forbidden`).
 */
import type { PostSummary } from '@/types/post';
import { hasPublishedChannel } from './post-status';

export interface PostAbilities {
  publishNow: boolean;
  reschedule: boolean;
  /** Dragging the card to another slot: a reschedule by hand. */
  drag: boolean;
  remove: boolean;
}

export function postAbilities(
  post: Pick<PostSummary, 'state' | 'channels'>,
  draftsOnly = false,
): PostAbilities {
  const moving = !draftsOnly && post.state !== 'PUBLISHED';
  return {
    publishNow: !draftsOnly && (post.state === 'QUEUE' || post.state === 'ERROR'),
    reschedule: moving,
    drag: moving,
    remove: !hasPublishedChannel(post) && (!draftsOnly || post.state === 'DRAFT'),
  };
}
