/**
 * Module 12's checks on the three chat apps' links, beyond the shared
 * webhook-link spec: Slack and Discord shapes, the Teams Workflows hosts
 * with their `sig` value, old connector links, and the help links. DNS is
 * faked as a public address.
 */
import { CONNECTION_MESSAGES } from '../connections.messages';
import { discordProvider } from './discord.provider';
import type { JudgeOptions } from './provider.types';
import { slackProvider } from './slack.provider';
import { teamsProvider } from './teams.provider';

const PUBLIC: JudgeOptions = { allowPrivate: false, resolve: async () => ['52.1.2.3'] };

async function verdictOf(provider: typeof slackProvider, webhookUrl: string) {
  return provider.judge({ webhookUrl }, PUBLIC);
}

describe('Slack links', () => {
  it.each([
    'https://hooks.slack.com/services/T0001/B0001/abcDEF123',
    'https://hooks.slack.com/services/T0001/B0001/abcDEF123/',
  ])('accepts %s', async (link) => {
    expect((await verdictOf(slackProvider, link)).ok).toBe(true);
  });

  it.each([
    'https://hooks.slack.com/workflows/T0001/A0001/123/abc',
    'https://hooks.slack.com/services/T0001/B0001',
    'https://slack.com/services/T0001/B0001/abc',
  ])('refuses %s', async (link) => {
    expect(await verdictOf(slackProvider, link)).toEqual({
      ok: false,
      message: CONNECTION_MESSAGES.LINK_WRONG_APP.slack,
    });
  });

  it('links to Slack’s incoming webhooks help', () => {
    expect(slackProvider.helpLink).toBe('https://api.slack.com/messaging/webhooks');
  });
});

describe('Discord links', () => {
  it.each([
    'https://discord.com/api/webhooks/123456789/tok-en_9',
    'https://discordapp.com/api/webhooks/123456789/tok-en_9',
  ])('accepts %s', async (link) => {
    expect((await verdictOf(discordProvider, link)).ok).toBe(true);
  });

  it.each([
    'https://discord.com/api/webhooks/abc/token',
    'https://discord.com/api/webhooks/123',
    'https://discord.gg/api/webhooks/1/x',
  ])('refuses %s', async (link) => {
    expect(await verdictOf(discordProvider, link)).toEqual({
      ok: false,
      message: CONNECTION_MESSAGES.LINK_WRONG_APP.discord,
    });
  });
});

describe('Teams Workflows links', () => {
  const LOGIC =
    'https://prod-12.westus.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?api-version=2016-06-01&sig=s1g9';
  const POWER =
    'https://default1234.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/abc/triggers/manual/paths/invoke?api-version=1&sig=zz77';

  it('accepts both Workflows hosts with their sig', async () => {
    expect((await verdictOf(teamsProvider, LOGIC)).ok).toBe(true);
    expect((await verdictOf(teamsProvider, POWER)).ok).toBe(true);
  });

  it('refuses a Workflows link without its sig value', async () => {
    for (const link of [LOGIC.replace('&sig=s1g9', ''), POWER.replace('sig=zz77', 'sig=')]) {
      expect(await verdictOf(teamsProvider, link)).toEqual({
        ok: false,
        message: CONNECTION_MESSAGES.LINK_WRONG_APP.teams,
      });
    }
  });

  it('refuses old connector links and plain http', async () => {
    for (const link of [
      'https://contoso.webhook.office.com/webhookb2/abc/IncomingWebhook/def/ghi',
      'https://outlook.office.com/webhook/abc',
    ]) {
      expect(await verdictOf(teamsProvider, link)).toEqual({
        ok: false,
        message: CONNECTION_MESSAGES.TEAMS_OLD_LINK,
      });
    }
    expect(await verdictOf(teamsProvider, LOGIC.replace('https', 'http'))).toEqual({
      ok: false,
      message: CONNECTION_MESSAGES.LINK_HTTPS,
    });
  });

  it('links to Microsoft’s Workflows webhook help', () => {
    expect(teamsProvider.helpLink).toContain('create-incoming-webhooks-with-workflows');
  });
});
