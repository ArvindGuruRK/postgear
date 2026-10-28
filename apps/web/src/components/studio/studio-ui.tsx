'use client';

/**
 * Pieces Studio's screens share: the frame-colour panel each section sits in
 * (the one Analytics and SEO use), the inset box set into it, and one
 * ticking clock for "Updated 2 minutes ago".
 */
import { useMemo, useSyncExternalStore } from 'react';

export { AnalyticsPanel as StudioPanel, PanelHeader } from '../analytics/analytics-ui';

/** A box set into its panel (the inset layer). */
export const INSET = 'rounded-lg border-2 border-outline bg-inset';

const MINUTE = 60_000;

function subscribe(onChange: () => void): () => void {
  const timer = setInterval(onChange, MINUTE / 2);
  return () => clearInterval(timer);
}

function currentMinute(): number {
  return Math.floor(Date.now() / MINUTE);
}

/**
 * The current minute, kept current, or null while the page hydrates. The
 * server's clock and time zone are not the browser's, so a relative time is
 * written only once the browser has taken over: it can then never disagree
 * with the HTML the server sent.
 */
export function useNow(): Date | null {
  const minute = useSyncExternalStore(subscribe, currentMinute, () => null);
  return useMemo(() => (minute === null ? null : new Date(minute * MINUTE)), [minute]);
}
