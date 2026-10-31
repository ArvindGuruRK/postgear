/**
 * Slack, Teams and Discord (Module 12): the exact request bodies (escaping,
 * mentions, the card), the cut-and-note at each app's limit, each app's
 * success signal, and how every answer is classified. Sends go to a local
 * HTTP server through `safeHttpRequest` with private addresses allowed, so
 * nothing leaves the machine.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { discordProvider, fakeSnowflake, waitUrl } from './discord';
import { escapeSlack, SHORTENED } from './escape';
import { BUTTON_LINK_MESSAGE, capRetryAfter, UNSAFE_LINK_MESSAGE } from './notify-http';
import { connectionHint } from './provider-executor';
import { SLACK_SECTION_MAX, slackProvider } from './slack';
import { TEAMS_ACCEPTED, TEAMS_MAX_BYTES, TEAMS_OLD_LINK_MESSAGE, teamsProvider } from './teams';
import type { ProviderBuildContext, ProviderSendOptions } from './types';

interface Received {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

let server: Server;
let baseUrl: string;
let received: Received[] = [];
let answer: { status: number; body?: string; headers?: Record<string, string> } = {
  status: 200,
  body: 'ok',
};

beforeAll(async () => {
  server = createServer((req, res: ServerResponse) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      received.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      res.statusCode = answer.status;
      for (const [name, value] of Object.entries(answer.headers ?? {})) res.setHeader(name, value);
      res.end(answer.body ?? '');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  received = [];
  answer = { status: 200, body: 'ok' };
});

const ctx: ProviderBuildContext = {
  run: { id: 'run_1', automationName: 'Failed Post Alert', mode: 'live' },
  node: { key: 'slack1', name: 'Tell The Team', type: 'notify.slack' },
  scope: {},
  timeZone: 'UTC',
  connection: { id: 'conn_1', name: 'Bloom Alerts', hint: 'hooks.slack.com/...a9F2' },
  idempotencyKey: 'run_1:slack1',
};

const opts = (overrides: Partial<ProviderSendOptions> = {}): ProviderSendOptions => ({
  idempotencyKey: 'run_1:slack1',
  signal: new AbortController().signal,
  heartbeat: () => undefined,
  allowPrivate: true,
  ...overrides,
});

const sent = () => JSON.parse(received[0].body) as Record<string, unknown>;

describe('Slack', () => {
  const credentials = () => ({ webhookUrl: `${baseUrl}/services/T1/B1/secret` });

  it('builds blocks with the message escaped, the button and the footer', () => {
    const req = slackProvider.build(
      {
        connectionId: 'conn_1',
        message: 'Hey <!channel> see <https://evil.example|this> & @here',
        includeLink: 'https://app.postgear.local/org/posts/1',
        footer: true,
      },
      ctx,
    );

    expect(req.body).toEqual({
      text: 'Hey &lt;!channel&gt; see &lt;https://evil.example|this&gt; &amp; @here',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Hey &lt;!channel&gt; see &lt;https://evil.example|this&gt; &amp; @here',
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Open In PostGear', emoji: false },
              url: 'https://app.postgear.local/org/posts/1',
            },
          ],
        },
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: 'Sent by the workflow Failed Post Alert' }],
        },
      ],
    });
    expect(JSON.stringify(req.body)).not.toMatch(/<!channel>|<https:/);
    expect(req.output).toEqual({
      sent: true,
      channel: 'Bloom Alerts',
      preview: 'Hey <!channel> see <https://evil.example|this> & @here',
    });
  });

  it('leaves out the button and the footer when not asked for', () => {
    const req = slackProvider.build(
      { connectionId: 'conn_1', message: 'Hi', includeLink: '  ', footer: false },
      ctx,
    );
    expect(req.body.blocks).toEqual([{ type: 'section', text: { type: 'mrkdwn', text: 'Hi' } }]);
  });

  it('escapes the workflow name in the footer too', () => {
    const req = slackProvider.build(
      { connectionId: 'c', message: 'Hi', footer: true },
      { ...ctx, run: { ...ctx.run, automationName: 'A <!here> & B' } },
    );
    expect(req.body.blocks[1]).toEqual({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: 'Sent by the workflow A &lt;!here&gt; &amp; B' }],
    });
  });

  it('refuses a button link that is not a full link', () => {
    expect(() =>
      slackProvider.build(
        { connectionId: 'c', message: 'Hi', includeLink: 'javascript:alert(1)', footer: false },
        ctx,
      ),
    ).toThrow(BUTTON_LINK_MESSAGE);
    expect(() =>
      slackProvider.build(
        { connectionId: 'c', message: 'Hi', includeLink: 'nope', footer: false },
        ctx,
      ),
    ).toThrow(BUTTON_LINK_MESSAGE);
  });

  it('cuts a long message to the section limit, never inside an entity, and notes it', () => {
    const req = slackProvider.build(
      { connectionId: 'c', message: '<'.repeat(SLACK_SECTION_MAX), footer: false },
      ctx,
    );
    const text = (req.body.blocks[0].text as { text: string }).text;
    expect(text.length).toBeLessThanOrEqual(SLACK_SECTION_MAX);
    expect(text.endsWith(SHORTENED)).toBe(true);
    expect(text.slice(0, -SHORTENED.length)).toMatch(/^(&lt;)+$/);
    expect(req.output.note).toBe('The message was longer than Slack allows, so it was shortened.');
  });

  it('describes a dry run without the link', () => {
    const req = slackProvider.build(
      { connectionId: 'c', message: 'Post failed', footer: true },
      ctx,
    );
    expect(slackProvider.describe(req)).toBe('Would send to Slack Bloom Alerts: "Post failed"');
  });

  it('succeeds only on 200 with the body ok', async () => {
    const req = slackProvider.build({ connectionId: 'c', message: 'Hi', footer: false }, ctx);

    await expect(slackProvider.send(req, credentials(), opts())).resolves.toEqual({
      ok: true,
      output: { sent: true, channel: 'Bloom Alerts', preview: 'Hi' },
    });
    expect(received[0]).toMatchObject({ method: 'POST', url: '/services/T1/B1/secret' });
    expect(received[0].headers['content-type']).toBe('application/json');
    expect(sent()).toEqual(req.body);

    answer = { status: 200, body: 'not ok' };
    await expect(slackProvider.send(req, credentials(), opts())).resolves.toMatchObject({
      ok: false,
      retryable: false,
      code: 'unconfirmed',
      message: 'Slack did not confirm it received the message.',
    });

    answer = { status: 204 };
    await expect(slackProvider.send(req, credentials(), opts())).resolves.toMatchObject({
      ok: false,
      code: 'unconfirmed',
    });
  });

  it.each([
    [
      400,
      'invalid_payload',
      'rejected',
      'Slack refused the message: the message was not in a form Slack accepts.',
    ],
    [400, 'no_text', 'rejected', 'Slack refused the message: the message was empty.'],
    [400, 'something_new', 'rejected', 'Slack refused the message: something_new.'],
    [
      403,
      'action_prohibited',
      'connection_refused',
      'Slack is disconnected. Reconnect it in Connections.',
    ],
    [
      404,
      'no_service',
      'connection_refused',
      'Slack is disconnected. Reconnect it in Connections.',
    ],
    [
      404,
      'channel_not_found',
      'connection_refused',
      'Slack is disconnected. Reconnect it in Connections.',
    ],
    [
      410,
      'channel_is_archived',
      'connection_refused',
      'Slack is disconnected. Reconnect it in Connections.',
    ],
    [401, '', 'connection_refused', 'Slack is disconnected. Reconnect it in Connections.'],
  ] as const)('classifies %i %s', async (status, body, code, message) => {
    answer = { status, body };
    const req = slackProvider.build({ connectionId: 'c', message: 'Hi', footer: false }, ctx);
    const result = await slackProvider.send(req, credentials(), opts());
    expect(result).toMatchObject({ ok: false, retryable: false, code, message });
    if (code === 'connection_refused') expect(result).toMatchObject({ connectionBroken: true });
    else expect(result).not.toHaveProperty('connectionBroken');
  });

  it.each([
    [429, 'rate_limited', 'Slack asked PostGear to slow down. PostGear will try again.'],
    [500, 'unavailable', 'Slack is not answering right now. PostGear will try again.'],
    [503, 'unavailable', 'Slack is not answering right now. PostGear will try again.'],
    [408, 'unavailable', 'Slack is not answering right now. PostGear will try again.'],
  ] as const)('retries a %i', async (status, code, message) => {
    answer = { status, body: 'rate_limited' };
    const req = slackProvider.build({ connectionId: 'c', message: 'Hi', footer: false }, ctx);
    await expect(slackProvider.send(req, credentials(), opts())).resolves.toMatchObject({
      ok: false,
      retryable: true,
      code,
      message,
    });
  });

  it('honours Retry-After, capped at 60 s', async () => {
    const req = slackProvider.build({ connectionId: 'c', message: 'Hi', footer: false }, ctx);
    answer = { status: 429, body: 'rate_limited', headers: { 'retry-after': '12' } };
    await expect(slackProvider.send(req, credentials(), opts())).resolves.toMatchObject({
      retryable: true,
      retryAfterMs: 12_000,
    });
    answer = { status: 429, body: 'rate_limited', headers: { 'retry-after': '3600' } };
    await expect(slackProvider.send(req, credentials(), opts())).resolves.toMatchObject({
      retryAfterMs: 60_000,
    });
    expect(capRetryAfter(undefined)).toBeUndefined();
    expect(capRetryAfter(200)).toBe(1_000);
  });

  it('retries a timeout and a refused connection', async () => {
    const req = slackProvider.build({ connectionId: 'c', message: 'Hi', footer: false }, ctx);
    await expect(
      slackProvider.send(req, { webhookUrl: 'http://127.0.0.1:1/services/T/B/x' }, opts()),
    ).resolves.toMatchObject({
      ok: false,
      retryable: true,
      code: 'unreachable',
      message: 'PostGear could not reach Slack. It will try again.',
    });
  });

  it('refuses an unsafe link with a security log line and never sends', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const req = slackProvider.build({ connectionId: 'c', message: 'Hi', footer: false }, ctx);

    const result = await slackProvider.send(
      req,
      { webhookUrl: 'http://169.254.169.254/latest' },
      opts({ allowPrivate: false }),
    );

    expect(result).toMatchObject({
      ok: false,
      retryable: false,
      code: 'unsafe_link',
      message: UNSAFE_LINK_MESSAGE,
    });
    expect(warn).toHaveBeenCalledWith(
      'automation.unsafe_link',
      expect.objectContaining({ app: 'Slack' }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('169.254');
    expect(received).toHaveLength(0);
    warn.mockRestore();
  });

  it('treats a connection without a link as disconnected', async () => {
    const req = slackProvider.build({ connectionId: 'c', message: 'Hi', footer: false }, ctx);
    await expect(slackProvider.send(req, {}, opts())).resolves.toMatchObject({
      connectionBroken: true,
      message: 'Slack is disconnected. Reconnect it in Connections.',
    });
  });

  it('simulates a success with one console line naming the connection and its hint', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const message = `Post failed on Bloom Bakery Instagram: ${'x'.repeat(100)}`;
    const req = slackProvider.build({ connectionId: 'c', message, footer: true }, ctx);

    await expect(slackProvider.simulate(req)).resolves.toEqual({ ok: true, output: req.output });
    expect(log).toHaveBeenCalledWith(
      `[automation:simulate] slack to Bloom Alerts (hooks.slack.com/...a9F2): "${message.slice(0, 80)}"`,
    );
    expect(received).toHaveLength(0);
    log.mockRestore();
  });
});

describe('Microsoft Teams', () => {
  const link = () => `${baseUrl}/workflows/abc/triggers/manual/paths/invoke?sig=s1g9`;
  const teamsCtx = { ...ctx, connection: { id: 'conn_t', name: 'Bakery Team' } };

  it('builds an Adaptive Card 1.2 in a message envelope', () => {
    const req = teamsProvider.build(
      {
        connectionId: 'conn_t',
        title: 'A post failed',
        message: 'Instagram said no',
        includeLink: 'https://app.postgear.local/p/1',
      },
      teamsCtx,
    );
    expect(req.body).toEqual({
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.2',
            body: [
              { type: 'TextBlock', text: 'A post failed', weight: 'Bolder', wrap: true },
              { type: 'TextBlock', text: 'Instagram said no', wrap: true },
            ],
            actions: [
              {
                type: 'Action.OpenUrl',
                title: 'Open In PostGear',
                url: 'https://app.postgear.local/p/1',
              },
            ],
          },
        },
      ],
    });
    expect(req.output).toEqual({
      sent: true,
      preview: 'Instagram said no',
      result: TEAMS_ACCEPTED,
    });
  });

  it('leaves out an empty title and the button', () => {
    const req = teamsProvider.build({ connectionId: 'c', title: ' ', message: 'Hi' }, teamsCtx);
    const content = (req.body.attachments as { content: Record<string, unknown> }[])[0].content;
    expect(content.body).toEqual([{ type: 'TextBlock', text: 'Hi', wrap: true }]);
    expect(content).not.toHaveProperty('actions');
  });

  it('keeps the whole body under 28 KB, cutting the message with a note', () => {
    const req = teamsProvider.build(
      { connectionId: 'c', title: 'T', message: 'é'.repeat(40_000) },
      teamsCtx,
    );
    const bytes = Buffer.byteLength(JSON.stringify(req.body), 'utf8');
    expect(bytes).toBeLessThanOrEqual(TEAMS_MAX_BYTES);
    expect(bytes).toBeGreaterThan(TEAMS_MAX_BYTES - 200);
    const text = JSON.stringify(req.body);
    expect(text).toContain(SHORTENED);
    expect(req.output.note).toBe('The message was longer than Teams allows, so it was shortened.');
  });

  it('accepts any 2xx and says Teams accepted it', async () => {
    const req = teamsProvider.build({ connectionId: 'c', message: 'Hi' }, teamsCtx);
    answer = { status: 202 };
    await expect(teamsProvider.send(req, { webhookUrl: link() }, opts())).resolves.toEqual({
      ok: true,
      output: { sent: true, preview: 'Hi', result: 'Teams accepted the message.' },
    });
    expect(sent()).toEqual(req.body);
    expect(received[0].url).toBe('/workflows/abc/triggers/manual/paths/invoke?sig=s1g9');
  });

  it('refuses an old connector link before sending', async () => {
    const req = teamsProvider.build({ connectionId: 'c', message: 'Hi' }, teamsCtx);
    for (const old of [
      'https://contoso.webhook.office.com/webhookb2/abc',
      'https://outlook.office.com/webhook/abc',
    ]) {
      await expect(teamsProvider.send(req, { webhookUrl: old }, opts())).resolves.toEqual({
        ok: false,
        retryable: false,
        connectionBroken: true,
        code: 'old_teams_link',
        message: TEAMS_OLD_LINK_MESSAGE,
      });
    }
    expect(TEAMS_OLD_LINK_MESSAGE).toBe(
      'That is an old Teams connector link, which Microsoft has switched off. Create a new link with the Teams Workflows app.',
    );
    expect(received).toHaveLength(0);
  });

  it.each([
    [
      400,
      '{"error":{"code":"InvalidRequestContent","message":"The card is not valid."}}',
      'rejected',
      'Microsoft Teams refused the message: The card is not valid.',
      false,
    ],
    [
      401,
      '',
      'connection_refused',
      'Microsoft Teams is disconnected. Reconnect it in Connections.',
      false,
    ],
    [
      403,
      '',
      'connection_refused',
      'Microsoft Teams is disconnected. Reconnect it in Connections.',
      false,
    ],
    [
      404,
      '',
      'connection_refused',
      'Microsoft Teams is disconnected. Reconnect it in Connections.',
      false,
    ],
    [
      429,
      '',
      'rate_limited',
      'Microsoft Teams asked PostGear to slow down. PostGear will try again.',
      true,
    ],
    [
      502,
      '',
      'unavailable',
      'Microsoft Teams is not answering right now. PostGear will try again.',
      true,
    ],
  ] as const)('classifies a %i', async (status, body, code, message, retryable) => {
    answer = { status, body };
    const req = teamsProvider.build({ connectionId: 'c', message: 'Hi' }, teamsCtx);
    await expect(teamsProvider.send(req, { webhookUrl: link() }, opts())).resolves.toMatchObject({
      ok: false,
      retryable,
      code,
      message,
    });
  });

  it('describes a dry run', () => {
    const req = teamsProvider.build({ connectionId: 'c', message: 'Weekly report' }, teamsCtx);
    expect(teamsProvider.describe(req)).toBe('Would post to Teams Bakery Team: "Weekly report"');
  });
});

describe('Discord', () => {
  const link = () => `${baseUrl}/api/webhooks/123/tok-en`;
  const discordCtx = { ...ctx, connection: { id: 'conn_d', name: 'Bakery Discord' } };

  it('sends the content with mentions switched off', () => {
    const req = discordProvider.build(
      { connectionId: 'c', message: '@everyone <@&123> look' },
      discordCtx,
    );
    expect(req.body).toEqual({
      content: '@everyone <@&123> look',
      allowed_mentions: { parse: [] },
    });
  });

  it('cuts content to 2,000 characters with a note', () => {
    const req = discordProvider.build(
      { connectionId: 'c', message: '😀'.repeat(2_500) },
      discordCtx,
    );
    expect(Array.from(req.body.content)).toHaveLength(2_000);
    expect(req.body.content.endsWith(SHORTENED)).toBe(true);
    expect(req.note).toBe('The message was longer than Discord allows, so it was shortened.');
  });

  it('asks Discord to wait and returns the created message ids', async () => {
    answer = {
      status: 200,
      body: JSON.stringify({ id: '1290345678901234567', channel_id: '1190345678901234567' }),
    };
    const req = discordProvider.build({ connectionId: 'c', message: 'Hi' }, discordCtx);

    await expect(discordProvider.send(req, { webhookUrl: link() }, opts())).resolves.toEqual({
      ok: true,
      output: { sent: true, messageId: '1290345678901234567', channelId: '1190345678901234567' },
    });
    expect(received[0].url).toBe('/api/webhooks/123/tok-en?wait=true');
    expect(sent()).toEqual(req.body);
    expect(waitUrl('https://discord.com/api/webhooks/1/x?thread_id=9')).toBe(
      'https://discord.com/api/webhooks/1/x?thread_id=9&wait=true',
    );
  });

  it('carries the shortened note into the output', async () => {
    answer = { status: 200, body: '{"id":"1","channel_id":"2"}' };
    const req = discordProvider.build(
      { connectionId: 'c', message: 'x'.repeat(2_100) },
      discordCtx,
    );
    await expect(discordProvider.send(req, { webhookUrl: link() }, opts())).resolves.toMatchObject({
      output: { note: 'The message was longer than Discord allows, so it was shortened.' },
    });
  });

  it('uses retry_after from the 429 body, capped at 60 s', async () => {
    const req = discordProvider.build({ connectionId: 'c', message: 'Hi' }, discordCtx);
    answer = {
      status: 429,
      body: '{"message":"You are being rate limited.","retry_after":2.5,"global":false}',
      headers: { 'retry-after': '30' },
    };
    await expect(discordProvider.send(req, { webhookUrl: link() }, opts())).resolves.toMatchObject({
      ok: false,
      retryable: true,
      code: 'rate_limited',
      retryAfterMs: 2_500,
    });

    answer = { status: 429, body: '{"retry_after":900}' };
    await expect(discordProvider.send(req, { webhookUrl: link() }, opts())).resolves.toMatchObject({
      retryAfterMs: 60_000,
    });
  });

  it.each([
    [
      404,
      '{"message":"Unknown Webhook","code":10015}',
      'connection_refused',
      'Discord is disconnected. Reconnect it in Connections.',
      false,
    ],
    [
      401,
      '{"message":"Invalid Webhook Token","code":50027}',
      'connection_refused',
      'Discord is disconnected. Reconnect it in Connections.',
      false,
    ],
    [
      400,
      '{"message":"Cannot send an empty message","code":50006}',
      'rejected',
      'Discord refused the message: Cannot send an empty message.',
      false,
    ],
    [503, '', 'unavailable', 'Discord is not answering right now. PostGear will try again.', true],
  ] as const)('classifies a %i', async (status, body, code, message, retryable) => {
    answer = { status, body };
    const req = discordProvider.build({ connectionId: 'c', message: 'Hi' }, discordCtx);
    await expect(discordProvider.send(req, { webhookUrl: link() }, opts())).resolves.toMatchObject({
      ok: false,
      retryable,
      code,
      message,
    });
  });

  it('simulates a success with ids shaped like Discord ones', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const req = discordProvider.build({ connectionId: 'c', message: 'Hi' }, discordCtx);
    const result = await discordProvider.simulate(req);
    expect(result).toMatchObject({ ok: true, output: { sent: true } });
    const output = (result as { output: { messageId: string; channelId: string } }).output;
    expect(output.messageId).toMatch(/^\d{17,20}$/);
    expect(output.channelId).toMatch(/^\d{17,20}$/);
    expect(log).toHaveBeenCalledWith('[automation:simulate] discord to Bakery Discord: "Hi"');
    expect(fakeSnowflake(Date.UTC(2026, 9, 31))).toMatch(/^\d{19}$/);
    log.mockRestore();
  });
});

describe('helpers', () => {
  it('escapes Slack control characters, & first', () => {
    expect(escapeSlack('&lt; <a> & >')).toBe('&amp;lt; &lt;a&gt; &amp; &gt;');
  });

  it('gives a log-safe hint for a webhook connection only', () => {
    expect(connectionHint({ webhookUrl: 'https://hooks.slack.com/services/T/B/abcdA9F2' })).toBe(
      'hooks.slack.com/...A9F2',
    );
    expect(connectionHint({ headers: [] })).toBeUndefined();
    expect(connectionHint(null)).toBeUndefined();
  });
});
