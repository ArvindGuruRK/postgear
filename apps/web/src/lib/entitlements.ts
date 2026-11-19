/**
 * What the active workspace's plan allows, for drawing (Sprint 12).
 *
 * One small store over `GET /entitlements/me`: tiles lock, meters fill and
 * chips read "38 of 300 AI minutes left" from it. It is presentation only:
 * the API re-resolves every limit on every request and never trusts a value
 * sent back, so a stale answer here can only draw a lock wrongly, never
 * grant anything. To keep even that short-lived, the store refetches after
 * 15 seconds of age (the route's own cache time) and right after any 402 a
 * Clips request is refused with, so the lock the person sees next matches
 * the refusal they just got. A screen that stays open (the clip editor can
 * stay open for an hour) checks that age every five seconds while its tab is
 * in view, and again when the tab comes back, so a plan bought meanwhile
 * unlocks its tiles without a reload (Module 20 e2e finding).
 *
 * `useSyncExternalStore` rather than a context: every Clips screen reads the
 * same answer, and a refusal anywhere has to reach all of them.
 */
import { isRefusalCode } from '@postgear/entitlements';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { type ApiError, api, onPaymentRequired } from './api';

/** One meter in display units: `used` rounds up, `limit` and `remaining` down. */
export interface MeterState {
  used: number;
  /** null when the plan has no ceiling. */
  limit: number | null;
  remaining: number | null;
  cycleStart: string;
  cycleEnd: string;
}

/** The body of `GET /entitlements/me`. */
export interface EntitlementSnapshot {
  tier: string;
  status: string;
  trialEndsAt: string | null;
  values: Record<string, unknown>;
  meters: Record<string, MeterState>;
}

export type EntitlementsStatus = 'idle' | 'loading' | 'ready' | 'error';

interface StoreState {
  orgId: string | null;
  status: EntitlementsStatus;
  snapshot: EntitlementSnapshot | null;
  /** When the snapshot arrived (ms since epoch), for the 15 second age. */
  fetchedAt: number;
}

/** The route answers with `Cache-Control: max-age=15`; older than that is refetched. */
const MAX_AGE_MS = 15_000;

/** How often an open screen looks at the answer's age (it asks again only past `MAX_AGE_MS`). */
const AGE_CHECK_MS = 5_000;

let state: StoreState = { orgId: null, status: 'idle', snapshot: null, fetchedAt: 0 };
let inFlight: { orgId: string; promise: Promise<void> } | null = null;
const listeners = new Set<() => void>();

function setState(next: StoreState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const SERVER_STATE: StoreState = { orgId: null, status: 'idle', snapshot: null, fetchedAt: 0 };

/**
 * Loads (or refreshes) the snapshot for `orgId`. Concurrent calls for the same
 * workspace share one request; a call for another workspace drops the old
 * answer first, so one workspace's limits are never drawn on another's page.
 */
export function loadEntitlements(orgId: string, options: { force?: boolean } = {}): Promise<void> {
  if (inFlight && inFlight.orgId === orgId) return inFlight.promise;

  const fresh =
    state.orgId === orgId &&
    state.status === 'ready' &&
    Date.now() - state.fetchedAt < MAX_AGE_MS;
  if (fresh && !options.force) return Promise.resolve();

  if (state.orgId !== orgId) {
    setState({ orgId, status: 'loading', snapshot: null, fetchedAt: 0 });
  } else if (state.status !== 'ready') {
    setState({ ...state, status: 'loading' });
  }

  const promise = api<EntitlementSnapshot>('/entitlements/me')
    .then((snapshot) => {
      // The workspace changed while this was on its way: drop the answer.
      if (state.orgId !== orgId) return;
      setState({ orgId, status: snapshot ? 'ready' : 'error', snapshot, fetchedAt: Date.now() });
    })
    .catch(() => {
      if (state.orgId !== orgId) return;
      // Keep the last good answer to draw with; mark it for a retry.
      setState({ ...state, status: state.snapshot ? 'ready' : 'error', fetchedAt: 0 });
    })
    .finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });

  inFlight = { orgId, promise };
  return promise;
}

if (typeof window !== 'undefined') {
  onPaymentRequired((error: ApiError) => {
    // Only the plan limits' own codes (`clips_minutes_used`, `channel_limit`
    // and the rest from the registry); other 402s say nothing about these values.
    if (isRefusalCode(error.code) && state.orgId) {
      void loadEntitlements(state.orgId, { force: true });
    }
  });
}

/**
 * The plan snapshot of the workspace `orgId`, loading it on first use and
 * when it is older than 15 seconds. `snapshot` is null until the first answer.
 */
export function useEntitlements(orgId: string): {
  snapshot: EntitlementSnapshot | null;
  status: EntitlementsStatus;
  refresh: () => Promise<void>;
} {
  const current = useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_STATE,
  );

  useEffect(() => {
    void loadEntitlements(orgId);
    // Concurrent checks from several screens share one request (`inFlight`),
    // and a fresh answer is never asked again, so this costs one request per
    // 15 seconds per tab at most, and nothing while the tab is hidden.
    const check = () => {
      if (window.document.visibilityState === 'hidden') return;
      void loadEntitlements(orgId);
    };
    const timer = window.setInterval(check, AGE_CHECK_MS);
    window.addEventListener('focus', check);
    window.document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
      window.document.removeEventListener('visibilitychange', check);
    };
  }, [orgId]);

  const refresh = useCallback(() => loadEntitlements(orgId, { force: true }), [orgId]);
  const mine = current.orgId === orgId;

  return {
    snapshot: mine ? current.snapshot : null,
    status: mine ? current.status : 'loading',
    refresh,
  };
}

/** A boolean entitlement, false when unknown (the safe reading for a lock). */
export function allows(snapshot: EntitlementSnapshot | null, key: string): boolean {
  return snapshot?.values[key] === true;
}

/** A number entitlement, or null when unknown or unlimited. */
export function limitOf(snapshot: EntitlementSnapshot | null, key: string): number | null {
  const value = snapshot?.values[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A meter's state, or null when unknown. */
export function meterOf(snapshot: EntitlementSnapshot | null, key: string): MeterState | null {
  return snapshot?.meters[key] ?? null;
}
