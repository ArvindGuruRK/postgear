/**
 * The checks every incoming-webhook app shares (Slack, Discord, Teams).
 *
 * In order, so the person hears the most useful reason first: a link at
 * all, its length, `https://`, no username or password, an old Teams
 * connector link, the right app (a Slack link pasted into the Discord form
 * says so), and last the public-address guard from `webhook-url.ts`, which
 * resolves the host and refuses private and internal addresses.
 */
import type { ConnectionKind } from '@postgear/automation';
import { connectionKindInfo } from '@postgear/automation';
import { z } from 'zod';
import { judgeWebhookUrl } from '../../../webhooks/webhook-url';
import { CONNECTION_MESSAGES } from '../connections.messages';
import type { CredentialsVerdict, JudgeOptions } from './provider.types';

export const MAX_LINK_LENGTH = 2048;

export interface WebhookCredentials {
  webhookUrl: string;
}

export const webhookCredentialsSchema = z.object({ webhookUrl: z.string() }).strict();

const DISCORD_HOSTS = new Set(['discord.com', 'discordapp.com']);

export function isSlackLink(url: URL): boolean {
  return (
    url.hostname === 'hooks.slack.com' &&
    /^\/services\/[a-z0-9]+\/[a-z0-9]+\/[a-z0-9]+\/?$/i.test(url.pathname)
  );
}

export function isDiscordLink(url: URL): boolean {
  return (
    DISCORD_HOSTS.has(url.hostname) &&
    /^\/api(\/v\d+)?\/webhooks\/\d+\/[\w-]+\/?$/.test(url.pathname)
  );
}

/**
 * The hosts the Teams Workflows app hands out, checked on 2026-10-29 against
 * Microsoft's "Send messages in Teams using incoming webhooks" page:
 * `prod-NN.<region>.logic.azure.com` and
 * `<env>.environment.api.powerplatform.com`.
 */
export function isTeamsLink(url: URL): boolean {
  const host = url.hostname;
  return (
    (host.endsWith('.logic.azure.com') || host.endsWith('.api.powerplatform.com')) &&
    url.pathname.length > 1
  );
}

/** Office 365 Connectors links, switched off in May 2026. */
export function isOldTeamsLink(url: URL): boolean {
  const host = url.hostname;
  return host.endsWith('.webhook.office.com') || host === 'outlook.office.com';
}

const MATCHERS: Record<'slack' | 'discord' | 'teams', (url: URL) => boolean> = {
  slack: isSlackLink,
  discord: isDiscordLink,
  teams: isTeamsLink,
};

/** Which app a link belongs to, to name the right form when it is pasted into the wrong one. */
function appOf(url: URL): ConnectionKind | null {
  for (const [kind, matches] of Object.entries(MATCHERS)) {
    if (matches(url)) return kind as ConnectionKind;
  }
  return null;
}

export async function judgeWebhookLink(
  kind: 'slack' | 'discord' | 'teams',
  input: unknown,
  options: JudgeOptions,
): Promise<CredentialsVerdict<WebhookCredentials>> {
  const app = connectionKindInfo(kind).title;
  const parsed = webhookCredentialsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: CONNECTION_MESSAGES.LINK_MISSING(app) };

  const raw = parsed.data.webhookUrl.trim();
  if (!raw) return { ok: false, message: CONNECTION_MESSAGES.LINK_MISSING(app) };
  if (raw.length > MAX_LINK_LENGTH)
    return { ok: false, message: CONNECTION_MESSAGES.LINK_TOO_LONG };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, message: CONNECTION_MESSAGES.LINK_INVALID };
  }
  if (url.protocol !== 'https:') return { ok: false, message: CONNECTION_MESSAGES.LINK_HTTPS };
  if (url.username || url.password) {
    return { ok: false, message: CONNECTION_MESSAGES.LINK_CREDENTIALS };
  }
  if (isOldTeamsLink(url)) return { ok: false, message: CONNECTION_MESSAGES.TEAMS_OLD_LINK };

  if (!MATCHERS[kind](url)) {
    const other = appOf(url);
    return {
      ok: false,
      message: other
        ? CONNECTION_MESSAGES.LINK_OTHER_APP(connectionKindInfo(other).title)
        : CONNECTION_MESSAGES.LINK_WRONG_APP[kind],
    };
  }

  url.hash = '';
  const verdict = await judgeWebhookUrl(url.toString(), options);
  if (!verdict.ok) return verdict;
  return { ok: true, credentials: { webhookUrl: verdict.url } };
}

/** `hooks.slack.com/...1234`: the host and the last 4 characters, nothing between. */
export function maskLink(link: string, prefix?: string): string {
  let host = '';
  try {
    host = new URL(link).hostname;
  } catch {
    // A stored link always parses; fall back to the tail alone.
  }
  return `${prefix ?? host}/...${link.slice(-4)}`;
}
