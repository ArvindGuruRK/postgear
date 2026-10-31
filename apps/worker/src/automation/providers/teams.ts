/**
 * Microsoft Teams (`notify.teams`, Module 12): an Adaptive Card 1.2 posted
 * to a Teams Workflows link ("Send webhook alerts to a channel").
 *
 * Office 365 Connectors were switched off in May 2026, so an old
 * `webhook.office.com` link is refused before anything is sent. The whole
 * body stays under 28 KB (the message is cut, with a note, to fit). Any 2xx
 * is success: the Workflows endpoint answers 202 once it accepts the
 * message and runs the flow afterwards, so the output says exactly that,
 * "Teams accepted the message." Messages appear as the Workflows bot.
 */
import { appWords, cutText, previewOf, SHORTENED } from './escape';
import {
  buttonLink,
  failureFor,
  logSimulatedSend,
  missingLink,
  postJson,
  webhookUrlOf,
} from './notify-http';
import type { AutomationProvider, ProviderBuildContext } from './types';

export type TeamsConfig = {
  connectionId: string;
  title?: string;
  message: string;
  includeLink?: string;
};

export interface TeamsOutput {
  sent: true;
  preview: string;
  result: string;
  note?: string;
}

export interface TeamsRequest {
  to: { name: string; hint?: string };
  message: string;
  body: Record<string, unknown>;
  output: TeamsOutput;
}

/** The most a Teams Workflows message may weigh, in bytes. */
export const TEAMS_MAX_BYTES = 28 * 1024;
export const TEAMS_ACCEPTED = 'Teams accepted the message.';
export const TEAMS_OLD_LINK_MESSAGE =
  'That is an old Teams connector link, which Microsoft has switched off. Create a new link with the Teams Workflows app.';
const TITLE_MAX = 200;
const SHORTENED_NOTE = 'The message was longer than Teams allows, so it was shortened.';

/** Office 365 Connectors links, switched off in May 2026. */
export function isOldTeamsLink(link: string): boolean {
  try {
    const host = new URL(link).hostname.toLowerCase();
    return (
      host === 'webhook.office.com' ||
      host.endsWith('.webhook.office.com') ||
      host === 'outlook.office.com'
    );
  } catch {
    return false;
  }
}

function card(title: string, message: string, link: string | null): Record<string, unknown> {
  const body: Record<string, unknown>[] = [];
  if (title) body.push({ type: 'TextBlock', text: title, weight: 'Bolder', wrap: true });
  body.push({ type: 'TextBlock', text: message, wrap: true });
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.2',
          body,
          ...(link
            ? { actions: [{ type: 'Action.OpenUrl', title: 'Open In PostGear', url: link }] }
            : {}),
        },
      },
    ],
  };
}

const bytesOf = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

export function buildTeamsRequest(config: TeamsConfig, ctx: ProviderBuildContext): TeamsRequest {
  const name = ctx.connection?.name ?? 'Microsoft Teams';
  const message = config.message ?? '';
  const title = cutText((config.title ?? '').replace(/\s+/g, ' ').trim(), TITLE_MAX).text;
  const link = buttonLink(config.includeLink);

  let body = card(title, message, link);
  let shortened = false;
  if (bytesOf(body) > TEAMS_MAX_BYTES) {
    // The most characters (by code point, so an emoji is never split) that
    // still fit once "... (shortened)" is added: a binary search, since
    // characters weigh 1 to 4 bytes and JSON escapes weigh more.
    const chars = Array.from(message);
    const fits = (keep: number) =>
      bytesOf(card(title, `${chars.slice(0, keep).join('')}${SHORTENED}`, link)) <= TEAMS_MAX_BYTES;
    let low = 0;
    let high = chars.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (fits(mid)) low = mid;
      else high = mid - 1;
    }
    body = card(title, `${chars.slice(0, low).join('')}${SHORTENED}`, link);
    shortened = true;
  }

  return {
    to: { name, ...(ctx.connection?.hint ? { hint: ctx.connection.hint } : {}) },
    message,
    body,
    output: {
      sent: true,
      preview: previewOf(message, 120),
      result: TEAMS_ACCEPTED,
      ...(shortened ? { note: SHORTENED_NOTE } : {}),
    },
  };
}

/** Teams' own error words from a Workflows answer (`{ error: { code, message } }`). */
function teamsWords(body: string | undefined): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown; code?: unknown } };
    return appWords(parsed.error?.message) ?? appWords(parsed.error?.code);
  } catch {
    return appWords(body, 80);
  }
}

export const teamsProvider: AutomationProvider<TeamsRequest, TeamsConfig> = {
  kind: 'teams',
  build: buildTeamsRequest,
  describe: (req) => `Would post to Teams ${req.to.name}: "${previewOf(req.message, 80)}"`,

  async send(req, credentials, opts) {
    const url = webhookUrlOf(credentials);
    if (!url) return missingLink('Microsoft Teams');
    if (isOldTeamsLink(url)) {
      return {
        ok: false,
        retryable: false,
        connectionBroken: true,
        code: 'old_teams_link',
        message: TEAMS_OLD_LINK_MESSAGE,
      };
    }

    const outcome = await postJson(url, req.body, opts);
    if (outcome.outcome === 'ok') {
      if (outcome.statusCode >= 200 && outcome.statusCode < 300) {
        return { ok: true, output: req.output };
      }
      return {
        ok: false,
        retryable: false,
        code: 'unconfirmed',
        message: 'Teams did not confirm it received the message.',
        details: { status: outcome.statusCode },
      };
    }
    return failureFor('Microsoft Teams', outcome, {
      appSays: teamsWords('body' in outcome ? outcome.body : undefined),
    });
  },

  async simulate(req) {
    logSimulatedSend('teams', req.to, req.message);
    return { ok: true, output: req.output };
  },
};
