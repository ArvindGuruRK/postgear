import { CONNECTION_MESSAGES } from '../connections.messages';
import type { ConnectionProvider } from './provider.types';
import { judgeWebhookLink, maskLink, type WebhookCredentials } from './webhook-link';

/**
 * The link the Teams Workflows app gives for "Send webhook alerts to a
 * channel". Messages arrive as posted by the Workflows bot, and the flow
 * belongs to whoever made it (the connect dialog says both).
 *
 * On top of the shared checks (https, a `*.logic.azure.com` or
 * `*.api.powerplatform.com` host, old connector links refused), the link
 * must carry its `sig` value: without it the flow refuses every message,
 * so a link copied without its query is caught here rather than at the
 * first send.
 */
export const teamsProvider: ConnectionProvider<WebhookCredentials> = {
  kind: 'teams',
  check: 'send',
  formEntry: true,
  helpLink:
    'https://support.microsoft.com/en-us/office/create-incoming-webhooks-with-workflows-for-microsoft-teams-8ae491c7-0394-4861-ba59-055e33f75498',
  judge: async (input, options) => {
    const verdict = await judgeWebhookLink('teams', input, options);
    if (!verdict.ok) return verdict;
    const sig = new URL(verdict.credentials.webhookUrl).searchParams.get('sig');
    if (!sig?.trim()) return { ok: false, message: CONNECTION_MESSAGES.LINK_WRONG_APP.teams };
    return verdict;
  },
  mask: (credentials) => maskLink(credentials.webhookUrl),
};
