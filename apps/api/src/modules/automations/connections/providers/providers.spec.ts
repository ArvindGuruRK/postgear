/**
 * What each app accepts, in the words the person sees, and that a mask never
 * shows more than the last 4 characters of a secret. DNS is faked: a public
 * address unless the test says otherwise.
 */
import { CONNECTION_KINDS } from '@postgear/automation';
import { CONNECTION_MESSAGES } from '../connections.messages';
import { CONNECTION_PROVIDERS, providerFor } from '.';
import { discordProvider } from './discord.provider';
import { httpProvider } from './http.provider';
import type { JudgeOptions } from './provider.types';
import { slackProvider } from './slack.provider';
import { teamsProvider } from './teams.provider';

const SLACK = 'https://hooks.slack.com/services/T000/B000/abcd1234';
const DISCORD = 'https://discord.com/api/webhooks/123456789/token-AbC_9';
const TEAMS_LOGIC =
  'https://prod-12.westus.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?api-version=2016-06-01&sig=s1g9';
const TEAMS_POWER =
  'https://default1234.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/abc/triggers/manual/paths/invoke?api-version=1&sig=zz77';
const OLD_TEAMS = 'https://contoso.webhook.office.com/webhookb2/abc/IncomingWebhook/def/ghi';

const PUBLIC: JudgeOptions = { allowPrivate: false, resolve: async () => ['52.1.2.3'] };
const PRIVATE_DNS: JudgeOptions = { allowPrivate: false, resolve: async () => ['10.0.0.5'] };

async function refusal(
  provider: typeof slackProvider,
  webhookUrl: unknown,
  options = PUBLIC,
): Promise<string> {
  const verdict = await provider.judge({ webhookUrl }, options);
  if (verdict.ok) throw new Error('expected a refusal');
  return verdict.message;
}

describe('connection providers', () => {
  it('covers the same apps as CONNECTION_KINDS in @postgear/automation', () => {
    expect(Object.keys(CONNECTION_PROVIDERS).sort()).toEqual(
      CONNECTION_KINDS.map((info) => info.kind).sort(),
    );
    expect(providerFor('toString')).toBeNull();
    expect(providerFor('constructor')).toBeNull();
  });

  describe('webhook links', () => {
    it('accepts each app its own link, normalised', async () => {
      await expect(slackProvider.judge({ webhookUrl: ` ${SLACK} ` }, PUBLIC)).resolves.toEqual({
        ok: true,
        credentials: { webhookUrl: SLACK },
      });
      await expect(discordProvider.judge({ webhookUrl: DISCORD }, PUBLIC)).resolves.toMatchObject({
        ok: true,
      });
      await expect(
        discordProvider.judge(
          { webhookUrl: 'https://discordapp.com/api/v10/webhooks/1/x' },
          PUBLIC,
        ),
      ).resolves.toMatchObject({ ok: true });
      for (const link of [TEAMS_LOGIC, TEAMS_POWER]) {
        const verdict = await teamsProvider.judge({ webhookUrl: link }, PUBLIC);
        expect(verdict.ok).toBe(true);
        // The default port is dropped, so the stored link is the canonical one.
        if (verdict.ok) expect(verdict.credentials.webhookUrl).not.toContain(':443');
      }
    });

    it('refuses a link that is not https', async () => {
      expect(await refusal(slackProvider, SLACK.replace('https', 'http'))).toBe(
        CONNECTION_MESSAGES.LINK_HTTPS,
      );
    });

    it('refuses localhost and private addresses', async () => {
      expect(await refusal(slackProvider, 'https://localhost/services/T/B/x')).toBe(
        CONNECTION_MESSAGES.LINK_WRONG_APP.slack,
      );
      expect(await refusal(discordProvider, 'https://10.0.0.5/api/webhooks/1/x')).toBe(
        CONNECTION_MESSAGES.LINK_WRONG_APP.discord,
      );
      // The right host, but it resolves inside the network.
      expect(await refusal(slackProvider, SLACK, PRIVATE_DNS)).toMatch(/private or internal/);
    });

    it('refuses an old Teams connector link with the Workflows instruction', async () => {
      expect(await refusal(teamsProvider, OLD_TEAMS)).toBe(CONNECTION_MESSAGES.TEAMS_OLD_LINK);
      expect(await refusal(slackProvider, OLD_TEAMS)).toBe(CONNECTION_MESSAGES.TEAMS_OLD_LINK);
    });

    it('names the right app when a link is pasted into the wrong form', async () => {
      expect(await refusal(discordProvider, SLACK)).toBe(
        CONNECTION_MESSAGES.LINK_OTHER_APP('Slack'),
      );
      expect(await refusal(slackProvider, TEAMS_LOGIC)).toBe(
        CONNECTION_MESSAGES.LINK_OTHER_APP('Microsoft Teams'),
      );
      expect(await refusal(teamsProvider, 'https://example.com/hook')).toBe(
        CONNECTION_MESSAGES.LINK_WRONG_APP.teams,
      );
    });

    it('refuses empty, invalid, too long, credentialed and extra-key input', async () => {
      expect(await refusal(slackProvider, '  ')).toBe(CONNECTION_MESSAGES.LINK_MISSING('Slack'));
      expect(await refusal(slackProvider, 42)).toBe(CONNECTION_MESSAGES.LINK_MISSING('Slack'));
      expect(await refusal(slackProvider, 'not a link')).toBe(CONNECTION_MESSAGES.LINK_INVALID);
      expect(await refusal(slackProvider, `${SLACK}/${'a'.repeat(2048)}`)).toBe(
        CONNECTION_MESSAGES.LINK_TOO_LONG,
      );
      expect(await refusal(slackProvider, 'https://me:pw@hooks.slack.com/services/T/B/x')).toBe(
        CONNECTION_MESSAGES.LINK_CREDENTIALS,
      );
      const extra = await slackProvider.judge({ webhookUrl: SLACK, channel: '#general' }, PUBLIC);
      expect(extra).toEqual({ ok: false, message: CONNECTION_MESSAGES.LINK_MISSING('Slack') });
    });

    it('masks to the host and the last 4 characters', () => {
      expect(slackProvider.mask({ webhookUrl: SLACK }, null)).toBe('hooks.slack.com/...1234');
      expect(discordProvider.mask({ webhookUrl: DISCORD }, null)).toBe(
        'discord.com/api/webhooks/...bC_9',
      );
      expect(teamsProvider.mask({ webhookUrl: TEAMS_POWER }, null)).toBe(
        'default1234.environment.api.powerplatform.com/...zz77',
      );
      expect(slackProvider.mask({ webhookUrl: SLACK }, null)).not.toContain('abcd');
    });
  });

  describe('secret headers', () => {
    const judge = (headers: unknown) => httpProvider.judge({ headers }, PUBLIC);

    it('accepts up to 10 headers and masks names only', async () => {
      const verdict = await judge([
        { name: ' Authorization ', value: 'Bearer sk_live_123' },
        { name: 'X-Api-Key', value: 'k-999' },
      ]);
      expect(verdict).toEqual({
        ok: true,
        credentials: {
          headers: [
            { name: 'Authorization', value: 'Bearer sk_live_123' },
            { name: 'X-Api-Key', value: 'k-999' },
          ],
        },
      });
      if (!verdict.ok) return;
      const mask = httpProvider.mask(verdict.credentials, null);
      expect(mask).toBe('2 secret headers: Authorization, X-Api-Key');
      expect(mask).not.toMatch(/sk_live|k-999/);
      expect(httpProvider.mask({ headers: [{ name: 'Authorization', value: 'x' }] }, null)).toBe(
        '1 secret header: Authorization',
      );
    });

    it('refuses none, too many, bad names, repeats, reserved names and bad values', async () => {
      const header = (name: string, value = 'v') => ({ name, value });
      await expect(judge([])).resolves.toEqual({
        ok: false,
        message: CONNECTION_MESSAGES.HEADERS_NONE,
      });
      await expect(
        judge(Array.from({ length: 11 }, (_, i) => header(`X-${i}`))),
      ).resolves.toMatchObject({ message: CONNECTION_MESSAGES.HEADERS_TOO_MANY(10) });
      await expect(judge([header('Bad Name')])).resolves.toMatchObject({
        message: CONNECTION_MESSAGES.HEADER_NAME_INVALID,
      });
      await expect(judge([header('X-Key'), header('x-key')])).resolves.toMatchObject({
        message: CONNECTION_MESSAGES.HEADER_TWICE('x-key'),
      });
      await expect(judge([header('Host')])).resolves.toMatchObject({
        message: CONNECTION_MESSAGES.HEADER_RESERVED('Host'),
      });
      await expect(judge([header('X-Key', '  ')])).resolves.toMatchObject({
        message: CONNECTION_MESSAGES.HEADER_VALUE_MISSING('X-Key'),
      });
      await expect(judge([header('X-Key', 'a\r\nInjected: 1')])).resolves.toMatchObject({
        message: CONNECTION_MESSAGES.HEADER_VALUE_INVALID('X-Key'),
      });
      await expect(judge([{ name: 'X', value: 'v', secret: true }])).resolves.toMatchObject({
        message: CONNECTION_MESSAGES.HEADERS_INVALID,
      });
    });
  });
});
