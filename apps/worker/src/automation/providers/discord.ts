/**
 * Discord (`notify.discord`, Module 12): a message to a channel through the
 * connection's webhook link.
 *
 * Sent to `...?wait=true`, so Discord answers 200 with the created message
 * (its id and channel id become the step's output) instead of a bare 204.
 * `allowed_mentions: { parse: [] }` means nothing in the message, typed or
 * from data, can ping `@everyone`, `@here`, a role or a person. Content is
 * at most 2,000 characters (cut with a note). A 429 carries `retry_after`
 * (seconds) in its JSON body, used before the `Retry-After` header; an
 * Unknown Webhook (404, code 10015) means the link was deleted.
 */
import { appWords, cutText, previewOf } from './escape';
import { failureFor, logSimulatedSend, missingLink, postJson, webhookUrlOf } from './notify-http';
import type { AutomationProvider, ProviderBuildContext } from './types';

export type DiscordConfig = {
  connectionId: string;
  message: string;
};

export interface DiscordOutput {
  sent: true;
  messageId: string | null;
  channelId: string | null;
  note?: string;
}

export interface DiscordRequest {
  to: { name: string; hint?: string };
  connectionId: string | null;
  message: string;
  body: { content: string; allowed_mentions: { parse: string[] } };
  note?: string;
}

/** Discord's limit for a message's content. */
export const DISCORD_CONTENT_MAX = 2_000;
const SHORTENED_NOTE = 'The message was longer than Discord allows, so it was shortened.';
/** Discord's epoch (2015-01-01), for made-up ids that look like real ones. */
const DISCORD_EPOCH = 1_420_070_400_000n;

export function buildDiscordRequest(
  config: DiscordConfig,
  ctx: ProviderBuildContext,
): DiscordRequest {
  const message = config.message ?? '';
  const content = cutText(message, DISCORD_CONTENT_MAX);
  return {
    to: {
      name: ctx.connection?.name ?? 'Discord',
      ...(ctx.connection?.hint ? { hint: ctx.connection.hint } : {}),
    },
    connectionId: ctx.connection?.id ?? null,
    message,
    body: { content: content.text, allowed_mentions: { parse: [] } },
    ...(content.shortened ? { note: SHORTENED_NOTE } : {}),
  };
}

/** The link with `wait=true`, keeping anything else it carries (a `thread_id`). */
export function waitUrl(link: string): string {
  const url = new URL(link);
  url.searchParams.set('wait', 'true');
  return url.toString();
}

function parse(body: string | undefined): Record<string, unknown> | null {
  if (!body) return null;
  try {
    const value: unknown = JSON.parse(body);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const idOf = (value: unknown) =>
  typeof value === 'string' && /^\d{1,25}$/.test(value) ? value : null;

/** A snowflake-shaped id for the simulation: the time part is real, the rest made up. */
export function fakeSnowflake(now = Date.now(), salt = 0): string {
  const time = BigInt(now) - DISCORD_EPOCH;
  return ((time << 22n) | BigInt(salt & 0x3fffff)).toString();
}

function saltOf(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) & 0x3fffff;
  return hash;
}

function output(req: DiscordRequest, messageId: string | null, channelId: string | null) {
  const result: DiscordOutput = { sent: true, messageId, channelId };
  if (req.note) result.note = req.note;
  return result;
}

export const discordProvider: AutomationProvider<DiscordRequest, DiscordConfig> = {
  kind: 'discord',
  build: buildDiscordRequest,
  describe: (req) => `Would send to Discord ${req.to.name}: "${previewOf(req.message, 80)}"`,

  async send(req, credentials, opts) {
    const link = webhookUrlOf(credentials);
    if (!link) return missingLink('Discord');
    let url: string;
    try {
      url = waitUrl(link);
    } catch {
      return missingLink('Discord');
    }

    const outcome = await postJson(url, req.body, opts);
    if (outcome.outcome === 'ok') {
      if (outcome.statusCode >= 200 && outcome.statusCode < 300) {
        const answer = parse(outcome.body);
        return {
          ok: true,
          output: output(req, idOf(answer?.id), idOf(answer?.channel_id)),
        };
      }
      return {
        ok: false,
        retryable: false,
        code: 'unconfirmed',
        message: 'Discord did not confirm it received the message.',
        details: { status: outcome.statusCode },
      };
    }

    const answer = parse('body' in outcome ? outcome.body : undefined);
    const retryAfter = answer?.retry_after;
    return failureFor('Discord', outcome, {
      appSays: appWords(answer?.message),
      // 10015 Unknown Webhook: deleted in Discord, whatever the status says.
      broken: answer?.code === 10015,
      ...(typeof retryAfter === 'number' && retryAfter >= 0
        ? { retryAfterMs: Math.round(retryAfter * 1000) }
        : {}),
    });
  },

  async simulate(req) {
    logSimulatedSend('discord', req.to, req.message);
    const now = Date.now();
    return {
      ok: true,
      output: output(
        req,
        fakeSnowflake(now, saltOf(req.message)),
        fakeSnowflake(Date.UTC(2024, 0, 1), saltOf(req.connectionId ?? req.to.name)),
      ),
    };
  },
};
