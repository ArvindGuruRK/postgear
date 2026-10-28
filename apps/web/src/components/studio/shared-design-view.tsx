'use client';

/**
 * The live parts of the public share page (Sprint 9, DS-9.2), for someone
 * who is not signed in, most likely on a phone.
 *
 * - `SharedDesignPreview` is Preview's own frame (`PlatformPreview`):
 *   the platform switch, the slides to swipe through, the caption read-only,
 *   and the workspace's name as the account, with the Preview badge on it.
 *   No sign-in, no comments, no approve buttons: approvals are for later.
 * - `ShareExpiry` says when the link stops working, by the reader's own
 *   calendar once the page has reached their browser.
 * - `SharedDesignFailure` is what shows when the design could not be
 *   fetched (the API away or failing), with Try Again, which asks the server
 *   for the page again. A dead link is not a failure: the page says so in
 *   its own one sentence.
 */
import { Alert, AlertDescription, Button, Spinner } from '@postgear/ui';
import { useRouter } from 'next/navigation';
import { useMemo, useSyncExternalStore, useTransition } from 'react';
import type { SharedDesignView } from '@/types/studio';
import { PlatformPreview, type PreviewAccount } from './platform-frame';
import { expiryLine, SHARE_FAILED } from './preview-model';

export function SharedDesignPreview({ view }: { view: SharedDesignView }) {
  const account = useMemo<PreviewAccount>(
    () => ({ name: view.workspaceName }),
    [view.workspaceName],
  );

  return (
    <PlatformPreview
      design={view.document}
      caption={view.caption}
      media={view.media}
      platforms={view.platforms}
      account={account}
    />
  );
}

/** The reader's time zone does not change while the page is open: nothing to listen to. */
function subscribeToNothing(): () => void {
  return () => {};
}

/**
 * "This link expires on 3 November 2026." The server can only write the UTC
 * date, so that is what the page arrives with; once it has hydrated, the
 * reader's own date takes its place (`useSyncExternalStore` swaps it in
 * without a hydration mismatch). Otherwise a link that stops at 5 pm in
 * California on the 3rd would be promised for the 4th.
 */
export function ShareExpiry({ expiresAt }: { expiresAt: string }) {
  const line = useSyncExternalStore(
    subscribeToNothing,
    () => expiryLine(expiresAt),
    () => expiryLine(expiresAt, 'UTC'),
  );

  return line ? <p className="m-0">{line}</p> : null;
}

export function SharedDesignFailure() {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();

  return (
    <Alert variant="danger" className="flex-wrap items-center justify-between">
      <AlertDescription>{SHARE_FAILED}</AlertDescription>
      {/* Marked unavailable rather than disabled while it works, so a keyboard
          user's focus stays on it when the page comes back with the same failure. */}
      <Button
        variant="secondary"
        size="sm"
        aria-disabled={retrying || undefined}
        onClick={() => {
          if (!retrying) startRetry(() => router.refresh());
        }}
      >
        {retrying ? (
          <Spinner
            size="sm"
            role="presentation"
            aria-hidden="true"
            className="motion-reduce:animate-none"
          />
        ) : null}
        Try Again
      </Button>
    </Alert>
  );
}
