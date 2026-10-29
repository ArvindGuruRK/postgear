import type { ConnectionProvider } from './provider.types';
import { judgeWebhookLink, maskLink, type WebhookCredentials } from './webhook-link';

/**
 * The link the Teams Workflows app gives for "Send webhook alerts to a
 * channel". Messages arrive as posted by Flow bot, and the flow belongs to
 * whoever made it (the connect dialog says both).
 */
export const teamsProvider: ConnectionProvider<WebhookCredentials> = {
  kind: 'teams',
  check: 'send',
  formEntry: true,
  helpLink:
    'https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook',
  judge: (input, options) => judgeWebhookLink('teams', input, options),
  mask: (credentials) => maskLink(credentials.webhookUrl),
};
