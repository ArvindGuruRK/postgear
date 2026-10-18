'use client';

import { useEffect } from 'react';
import { api } from '@/lib/api';
import {
  type Appearance,
  type AppearanceResponse,
  appearanceRevision,
  currentAppearance,
  readAppearanceCookie,
  syncAppearance,
} from '@/lib/appearance';
import type { SessionAppearance } from '@/lib/session';

/**
 * Brings this browser's `pg_appearance` cookie in line with the account: the
 * first dashboard load on a new device, after signing in as someone else on a
 * shared one, or after a plan lapsed. Mounted in the `[orgId]` layout;
 * renders nothing.
 *
 * ## Why it asks the API instead of trusting the session
 *
 * `session.appearance` (from `/auth/me`) is the *stored* choice, before
 * premium entitlement. Writing it straight to the cookie would show a lapsed
 * plan's premium theme until the next visit to Settings. So:
 *
 * 1. The **mode** carries no entitlement, so it is corrected from the
 *    session at once. That is the visible part (dark versus light), and it
 *    should not wait on a request.
 * 2. The **themes**, light and dark, are then taken from
 *    `GET /users/me/appearance`, which returns the effective ids. One small
 *    request per full page load of the dashboard (this layout stays mounted
 *    across client navigations), which was judged simpler and more honest
 *    than shipping a second copy of the premium list to the web app or adding
 *    a request to every server render.
 *
 * If the person changes the appearance while the request is in flight, the
 * response is dropped (`appearanceRevision`): a late read must never undo a
 * choice just made. A failed request leaves things as they are; the next load
 * tries again.
 */
export function AppearanceSync({ stored }: { stored: SessionAppearance }) {
  useEffect(() => {
    const cookie = readAppearanceCookie();

    if (!cookie || cookie.mode !== stored.mode) {
      syncAppearance({ ...currentAppearance(), mode: stored.mode });
    }

    const revision = appearanceRevision();
    let cancelled = false;

    api<AppearanceResponse>('/users/me/appearance')
      .then(({ appearance }) => {
        if (cancelled || appearanceRevision() !== revision) {
          return;
        }

        const effective: Appearance = {
          mode: appearance.mode,
          lightTheme: appearance.lightTheme,
          darkTheme: appearance.darkTheme,
        };
        const now = readAppearanceCookie();

        if (
          !now ||
          now.mode !== effective.mode ||
          now.lightTheme !== effective.lightTheme ||
          now.darkTheme !== effective.darkTheme
        ) {
          syncAppearance(effective);
        }
      })
      .catch(() => {
        // Not worth an error on every page: the cookie keeps working, and the
        // next full load retries.
      });

    return () => {
      cancelled = true;
    };
  }, [stored.mode]);

  return null;
}
