/**
 * Outbound webhooks (Sprint 8).
 *
 * A server component that loads the hooks and the channels (for the
 * per-channel filter) in parallel, each with a safe fallback: a failed
 * hooks request renders a retry rather than an empty list, and a failed
 * channels request leaves the filter empty rather than breaking the page.
 */
import type { Metadata } from 'next';
import { WebhooksView } from '@/components/webhooks/webhooks-view';
import { serverApi } from '@/lib/api';
import { getSessionCookieHeader } from '@/lib/session';
import type { Channel } from '@/types/channel';
import type { WebhookView } from '@/types/webhooks';

export const metadata: Metadata = { title: 'Webhooks' };

interface WebhooksResponse {
  webhooks: WebhookView[];
  events: string[];
  retryPolicy: { maximumAttempts: number };
}

export default async function WebhooksPage({ params }: PageProps<'/[orgId]/settings/webhooks'>) {
  const { orgId } = await params;
  const cookie = await getSessionCookieHeader();

  const [hooks, channels, me] = await Promise.all([
    serverApi<WebhooksResponse>('/webhooks', { cookie }).catch(() => null),
    serverApi<{ channels: Channel[] }>('/channels', { cookie })
      .then((result) => result.channels)
      .catch(() => [] as Channel[]),
    serverApi<{ organizations: { id: string; role: string }[] }>('/orgs', { cookie })
      .then((result) => result.organizations.find((organization) => organization.id === orgId) ?? null)
      .catch(() => null),
  ]);

  // Whether http:// / private addresses are allowed is a deployment setting
  // the API knows; it is read from the environment the web server shares.
  const allowHttp = process.env.WEBHOOK_ALLOW_PRIVATE_URLS === 'true';

  return (
    <WebhooksView
      initialWebhooks={hooks?.webhooks ?? null}
      channels={channels}
      canManage={me ? me.role !== 'USER' : false}
      allowHttp={allowHttp}
      retryPolicy={hooks?.retryPolicy ?? null}
    />
  );
}
