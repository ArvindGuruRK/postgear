/**
 * Leaving a page that holds unsaved work from a control the page does not
 * own: the top bar's workspace switch, sign-out, menu items, search results
 * and notifications. A page with something to lose (the Studio editor)
 * registers a guard; those controls ask `mayLeave()` before they move.
 *
 * Links are the page's own business (the editor holds their clicks itself).
 * This covers what a link cannot: a move made through the router, and a
 * workspace switch or a sign-out, which change the session first, so a save
 * sent as the page closes would land in another workspace or in none
 * (Sprint 9, DS-6.3).
 *
 * A guard answers whether leaving may go ahead: at once when nothing is
 * unsaved, after saving it, or once the person has chosen. A guard that fails
 * keeps nobody on a page.
 */
export type LeaveGuard = () => Promise<boolean>;

const guards = new Set<LeaveGuard>();

/** Adds a guard for as long as the page holds work; the returned function removes it. */
export function registerLeaveGuard(guard: LeaveGuard): () => void {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

/** True once every guard lets the person go. Guards are asked one at a time; the first "stay" ends it. */
export async function mayLeave(): Promise<boolean> {
  for (const guard of [...guards]) {
    let allowed = true;
    try {
      allowed = await guard();
    } catch {
      // A guard that fails keeps nobody on the page.
    }
    if (!allowed) return false;
  }
  return true;
}

/** Runs `go` once leaving is allowed; nothing happens when the person stays. */
export function leaveThen(go: () => void): void {
  void mayLeave().then((allowed) => {
    if (allowed) go();
  });
}
