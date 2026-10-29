import type { ConnectionProvider } from './provider.types';
import { judgeWebhookLink, maskLink, type WebhookCredentials } from './webhook-link';

/** A Slack app's Incoming Webhook: `https://hooks.slack.com/services/T.../B.../...`. */
export const slackProvider: ConnectionProvider<WebhookCredentials> = {
  kind: 'slack',
  check: 'send',
  formEntry: true,
  helpLink: 'https://api.slack.com/messaging/webhooks',
  judge: (input, options) => judgeWebhookLink('slack', input, options),
  mask: (credentials) => maskLink(credentials.webhookUrl),
};
