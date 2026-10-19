/**
 * Settings > Signatures (2026-10-19, after the reference's signatures).
 *
 * A server component that loads the list once and hands it to the island.
 * Reading is open to every member, so a failed request (the API away) is the
 * only way to get `null`, which the island answers with a retry rather than
 * an empty list that would look like "none saved".
 */
import type { Metadata } from 'next';
import { SignaturesView } from '@/components/settings/signatures-view';
import { serverApi } from '@/lib/api';
import { getSessionCookieHeader } from '@/lib/session';
import type { Signature } from '@/types/signature';

export const metadata: Metadata = { title: 'Signatures' };

export default async function SignaturesPage(_props: PageProps<'/[orgId]/settings/signatures'>) {
  const cookie = await getSessionCookieHeader();

  const signatures = await serverApi<{ signatures: Signature[] }>('/signatures', { cookie })
    .then((response) => response.signatures)
    .catch(() => null);

  return <SignaturesView initialSignatures={signatures} />;
}
