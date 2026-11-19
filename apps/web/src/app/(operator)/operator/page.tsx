import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OperatorView } from '@/components/operator/operator-view';
import { requireOperator } from '@/components/operator/require-operator';
import { ApiError, serverApi } from '@/lib/api';
import { getSessionCookieHeader } from '@/lib/session';
import type { OperatorTab, PlansView } from '@/types/operator';

const TABS: readonly OperatorTab[] = ['plans', 'overrides', 'usage', 'changes', 'library'];

export async function generateMetadata(): Promise<Metadata> {
  await requireOperator();
  return { title: 'Operator' };
}

/**
 * `/operator` (Sprint 12, Module 19 Part B): one page with five tabs, Plans,
 * Workspace Overrides, Usage, Change Log and Library. The Plans table is read
 * here on the server so the first paint has it; the other tabs load when
 * opened. A 403 from the API (in production, a superadmin outside
 * `OPERATOR_EMAILS`) is the same 404 as anyone else gets.
 */
export default async function OperatorPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  await requireOperator();

  const cookie = await getSessionCookieHeader();
  let plans: PlansView | null = null;
  try {
    plans = await serverApi<PlansView>('/operator/entitlements/plans', { cookie });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) notFound();
    // The API is down or failed: the tab shows its own sentence and a retry.
    plans = null;
  }

  const raw = (await searchParams).tab;
  const asked = Array.isArray(raw) ? raw[0] : raw;
  const tab = TABS.find((value) => value === asked) ?? 'plans';

  return <OperatorView initialPlans={plans} initialTab={tab} />;
}
