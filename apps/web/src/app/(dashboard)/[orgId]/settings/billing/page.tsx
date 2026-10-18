/**
 * Billing: the plan, its limits, and what the workspace has used
 * (Sprint 8).
 *
 * A server component that loads what the island needs in one round of
 * parallel requests: whether billing is configured at all, the plan table,
 * and the subscription with its two meters. Each has a safe fallback so one
 * failed request degrades one part of the page rather than all of it: no
 * status renders an error with a retry, no plans leaves the grid empty, no
 * subscription makes the island fetch it once more itself.
 *
 * `useSearchParams` in the island reads the `?checkout=` / `?portal=` query
 * the API sends the browser back with, and Next requires a Suspense
 * boundary around a client component that uses it.
 */
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BillingView } from '@/components/billing/billing-view';
import { serverApi } from '@/lib/api';
import { getSessionCookieHeader } from '@/lib/session';
import type {
  BillingStatus,
  Plan,
  PlansResponse,
  SubscriptionResponse,
} from '@/types/billing';

export const metadata: Metadata = { title: 'Billing' };

export default async function BillingPage({ params }: PageProps<'/[orgId]/settings/billing'>) {
  const { orgId } = await params;
  const cookie = await getSessionCookieHeader();

  const [status, plans, subscription] = await Promise.all([
    serverApi<{ status: BillingStatus }>('/billing/status', { cookie })
      .then((result) => result.status)
      .catch(() => null),
    serverApi<PlansResponse>('/billing/plans', { cookie })
      .then((result) => result.plans)
      .catch(() => [] as Plan[]),
    serverApi<SubscriptionResponse>('/billing/subscription', { cookie }).catch(() => null),
  ]);

  return (
    <Suspense>
      <BillingView orgId={orgId} status={status} plans={plans} initial={subscription} />
    </Suspense>
  );
}
