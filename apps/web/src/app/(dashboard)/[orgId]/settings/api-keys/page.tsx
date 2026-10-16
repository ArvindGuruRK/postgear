/**
 * Settings → API keys (Sprint 8).
 *
 * A server component that loads the list once and hands it to the island.
 * The list route is admin-only, so for a `USER` member the request answers
 * 403 and the island receives `null` — which it reads, together with the
 * role from the workspace provider, as "nothing to manage here" rather than
 * as an error. An API that is genuinely away produces the same `null`, and
 * for an admin the island shows a retry.
 */
import type { Metadata } from 'next';
import { ApiKeysManager } from '@/components/developers/api-keys-manager';
import { serverApi } from '@/lib/api';
import { getSessionCookieHeader } from '@/lib/session';
import type { ApiKeyView } from '@/types/developers';

export const metadata: Metadata = { title: 'API keys' };

export default async function ApiKeysPage(_props: PageProps<'/[orgId]/settings/api-keys'>) {
  const cookie = await getSessionCookieHeader();

  const keys = await serverApi<{ keys: ApiKeyView[] }>('/developers/api-keys', { cookie })
    .then((response) => response.keys)
    .catch(() => null);

  return <ApiKeysManager initialKeys={keys} />;
}
