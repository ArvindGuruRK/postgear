'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';

interface SyncActiveWorkspaceProps {
  /** The workspace the URL names. Membership is already verified by the layout. */
  orgId: string;
}

/**
 * Makes the active-workspace cookie agree with the URL.
 *
 * ## The gap this closes
 *
 * The API scopes every workspace-owned request on the `pg_org` cookie, not on
 * the `[orgId]` segment — deliberately, so a path parameter can never be used
 * to read another tenant's data. `OrgSwitcher` keeps the two in step when a
 * user switches through the UI, and its own comment names the failure mode if
 * they drift: "the URL changes while the API is still answering for the old
 * workspace."
 *
 * But switching is not the only way to arrive. A bookmark, a shared link, or
 * simply signing in as someone who belongs to **two** workspaces — where login
 * deliberately picks no default — all land on a URL the cookie does not match.
 * Until Sprint 3 nothing noticed, because no dashboard page fetched
 * workspace-scoped data. The Channels page is the first that does, and it
 * rendered an empty list.
 *
 * So: when the layout sees the two disagree, it mounts this, which performs the
 * same server-side switch the UI switcher does — membership re-verified there,
 * not trusted from here — and re-runs the server components.
 *
 * ## Why a client component
 *
 * Cookies cannot be written while rendering a Server Component. The reconcile
 * has to happen from somewhere that can issue a request, which means the
 * client. The cost is one extra round trip on a mismatched arrival, and a
 * moment where the page renders before its data is scoped — visible only in
 * that case, and preferable to showing the wrong workspace's contents.
 */
export function SyncActiveWorkspace({ orgId }: SyncActiveWorkspaceProps) {
  const router = useRouter();
  // Guards against a re-render re-issuing the switch, and against retrying a
  // switch the server has already refused.
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    if (attempted.current === orgId) {
      return;
    }

    attempted.current = orgId;

    api(`/orgs/${orgId}/switch`, { method: 'POST' })
      .then(() => router.refresh())
      .catch(() => {
        // The layout already confirmed membership, so a refusal here means it
        // changed underneath us. Doing nothing leaves the user on a page whose
        // data simply stays empty, which the next navigation resolves — far
        // better than a redirect loop.
      });
  }, [orgId, router]);

  return null;
}
