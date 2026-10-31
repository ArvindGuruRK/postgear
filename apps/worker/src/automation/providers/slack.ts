/**
 * Slack (`notify.slack`, Module 12): a message to a channel through the
 * connection's Incoming Webhook link.
 *
 * Body: `{ text, blocks }`, `text` being the notification fallback and the
 * blocks a mrkdwn section with the message, an "Open In PostGear" button
 * when the step has a button link, and a "Sent by the workflow {name}"
 * line when the footer is on. Every piece of text is escaped (`&`, `<`,
 * `>`), so data in the message can never become a link or a mention.
 *
 * Success is HTTP 200 **and** the body `ok`; Slack's error answers are a
 * bare code (`invalid_payload`, `no_service`, `channel_is_archived`).
 */
import { appWords, escapeSlack, fitSlack, previewOf } from './escape';
import {
  buttonLink,
  failureFor,
  logSimulatedSend,
  missingLink,
  postJson,
  webhookUrlOf,
} from './notify-http';
import type { AutomationProvider, ProviderBuildContext } from './types';

export type SlackConfig = {
  connectionId: string;
  message: string;
  includeLink?: string;
  footer: boolean;
};

export interface SlackOutput {
  sent: true;
  /** The connection's name. */
  channel: string;
  /** The first 120 characters of the message. */
  preview: string;
  /** Set when the message had to be cut to fit. */
  note?: string;
}

export interface SlackRequest {
  to: { name: string; hint?: string };
  /** The message as resolved, for the simulated log line. */
  message: string;
  body: { text: string; blocks: Record<string, unknown>[] };
  output: SlackOutput;
}

/** Slack's limit for one section's text. */
export const SLACK_SECTION_MAX = 3_000;
const BUTTON_TEXT = 'Open In PostGear';
const SHORTENED_NOTE = 'The message was longer than Slack allows, so it was shortened.';

/** Slack answers that mean the link no longer reaches a channel. */
const BROKEN_CODES = new Set([
  'no_service',
  'no_service_id',
  'no_team',
  'team_disabled',
  'invalid_token',
  'channel_not_found',
  'channel_is_archived',
  'action_prohibited',
]);

/** Slack's codes for a refused message, in plain words. */
const REFUSALS: Record<string, string> = {
  invalid_payload: 'the message was not in a form Slack accepts.',
  no_text: 'the message was empty.',
  invalid_blocks: 'the message layout was not accepted.',
  invalid_blocks_format: 'the message layout was not accepted.',
  too_many_attachments: 'the message had too many parts.',
  posting_to_general_channel_denied: 'only admins may post in that channel.',
};

export function buildSlackRequest(config: SlackConfig, ctx: ProviderBuildContext): SlackRequest {
  const name = ctx.connection?.name ?? 'Slack';
  const message = config.message ?? '';
  const fitted = fitSlack(message, SLACK_SECTION_MAX);
  const link = buttonLink(config.includeLink);

  const blocks: Record<string, unknown>[] = [
    { type: 'section', text: { type: 'mrkdwn', text: fitted.text } },
  ];
  if (link) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: BUTTON_TEXT, emoji: false },
          url: link,
        },
      ],
    });
  }
  if (config.footer) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: escapeSlack(`Sent by the workflow ${ctx.run.automationName}`),
        },
      ],
    });
  }

  return {
    to: { name, ...(ctx.connection?.hint ? { hint: ctx.connection.hint } : {}) },
    message,
    body: { text: fitted.text, blocks },
    output: {
      sent: true,
      channel: name,
      preview: previewOf(message, 120),
      ...(fitted.shortened ? { note: SHORTENED_NOTE } : {}),
    },
  };
}

export const slackProvider: AutomationProvider<SlackRequest, SlackConfig> = {
  kind: 'slack',
  build: buildSlackRequest,
  describe: (req) => `Would send to Slack ${req.to.name}: "${previewOf(req.message, 80)}"`,

  async send(req, credentials, opts) {
    const url = webhookUrlOf(credentials);
    if (!url) return missingLink('Slack');

    const outcome = await postJson(url, req.body, opts);
    if (outcome.outcome === 'ok') {
      if (outcome.statusCode === 200 && outcome.body?.trim() === 'ok') {
        return { ok: true, output: req.output };
      }
      return {
        ok: false,
        retryable: false,
        code: 'unconfirmed',
        message: 'Slack did not confirm it received the message.',
        details: { status: outcome.statusCode, app: appWords(outcome.body, 60) },
      };
    }

    const code = appWords('body' in outcome ? outcome.body : undefined, 60);
    return failureFor('Slack', outcome, {
      appSays: code ? (REFUSALS[code] ?? code) : null,
      broken: code !== null && BROKEN_CODES.has(code),
    });
  },

  async simulate(req) {
    logSimulatedSend('slack', req.to, req.message);
    return { ok: true, output: req.output };
  },
};
