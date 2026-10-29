import type { ConnectionProvider } from './provider.types';
import { judgeWebhookLink, maskLink, type WebhookCredentials } from './webhook-link';

/** A channel webhook: `https://discord.com/api/webhooks/<id>/<token>` (or `discordapp.com`). */
export const discordProvider: ConnectionProvider<WebhookCredentials> = {
  kind: 'discord',
  check: 'send',
  formEntry: true,
  helpLink: 'https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks',
  judge: (input, options) => judgeWebhookLink('discord', input, options),
  mask: (credentials) => {
    const host = new URL(credentials.webhookUrl).hostname;
    return maskLink(credentials.webhookUrl, `${host}/api/webhooks`);
  },
};
