/**
 * SEO Analyzer — enter a URL, get a scored audit with prioritised fixes, and
 * keep every run (Sprint 7, Part B).
 *
 * A server component that loads what the island needs in one round of
 * parallel requests: whether the analyzer is available and how (browser,
 * AI advice, its price), the recent history, the credit balance when AI
 * advice is on, and — when the URL names one — the audit to show. Each has
 * a safe fallback so a single failed request degrades one part of the page
 * rather than all of it: no status renders an error with a retry, no
 * history is retried from the browser, no balance leaves the meter saying so, and an
 * audit that cannot be loaded (deleted, another workspace's) is simply not
 * shown.
 */
import type { Metadata } from 'next';
import { SeoAnalyzer } from '@/components/seo/seo-analyzer';
import { serverApi } from '@/lib/api';
import { getSessionCookieHeader } from '@/lib/session';
import type { AiCredits } from '@/types/ai';
import type { SeoAuditDetail, SeoAuditList, SeoStatus } from '@/types/seo';

export const metadata: Metadata = { title: 'SEO Analyzer' };

function single(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export default async function SeoAnalyzerPage({
  searchParams,
}: PageProps<'/[orgId]/seo-analyzer'>) {
  const query = await searchParams;
  const auditId = single(query.audit);
  const cookie = await getSessionCookieHeader();

  const [status, history, credits, audit] = await Promise.all([
    serverApi<{ status: SeoStatus }>('/seo/status', { cookie })
      .then((result) => result.status)
      .catch(() => null),
    // Null, not an empty list: "nothing analysed yet" and "the API did not
    // answer" look the same on screen otherwise, and the island retries the
    // second.
    serverApi<SeoAuditList>('/seo/audits?limit=50', { cookie })
      .then((result) => result.audits)
      .catch(() => null),
    serverApi<{ credits: AiCredits }>('/ai/credits', { cookie })
      .then((result) => result.credits)
      .catch(() => null),
    auditId
      ? serverApi<{ audit: SeoAuditDetail }>(`/seo/audits/${encodeURIComponent(auditId)}`, {
          cookie,
        })
          .then((result) => result.audit)
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  return (
    <SeoAnalyzer
      status={status}
      history={history}
      // The meter only shows when AI advice is on; a balance without it is noise.
      credits={status?.ai ? credits : null}
      audit={audit}
    />
  );
}
