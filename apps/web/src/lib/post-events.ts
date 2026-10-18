/**
 * "Posts changed": fired when the composer saves or deletes a post.
 *
 * The composer opens as a modal over other pages (the calendar, the queue),
 * in a separate part of the tree from those pages' own state, so it cannot
 * update them directly. It announces the change instead, and any page that
 * lists posts reloads its list, so the new post is on the calendar the
 * moment the modal closes rather than at the next minute's refresh.
 */
export const POSTS_CHANGED_EVENT = 'postgear:posts-changed';

export function announcePostsChanged(): void {
  window.dispatchEvent(new Event(POSTS_CHANGED_EVENT));
}
