/**
 * What a competitor posted on Mastodon, from their own instance's public API
 * (research 01, section 3.7): the account is looked up by name, then its newest
 * statuses are read, without replies and without boosts.
 *
 * The instance is whatever a person typed after the `@`, and it becomes the host
 * of two requests. So it is checked for being a plain public host name (no port,
 * no path, no address literal) before anything is asked, the account's id from
 * the first answer is checked before it goes into the second address, and both
 * requests go through the injected fetch, which the API binds to the guarded one.
 */
import type { SourceItem } from '../types';
import {
  type CompetitorSource,
  type CompetitorSourceOptions,
  emptyResult,
  excerpt,
  failedRead,
  isHostName,
  isoDate,
  isRecord,
  newest,
  parseJson,
  readBody,
  unreadable,
} from './competitor';
import { safeHttpUrl, stripHtml } from './html-text';

const NAME = 'Mastodon';
const USER = /^[A-Za-z0-9_]{1,64}$/;
/** Mastodon's ids are digits; other servers that speak its API use letters too. */
const ACCOUNT_ID = /^[A-Za-z0-9]{1,64}$/;

export interface MastodonAccount {
  user: string;
  instance: string;
}

/** `@acme@mastodon.social` or `acme@mastodon.social`, to its two halves. */
export function mastodonAccount(value: string): MastodonAccount | null {
  const match = /^@?([^@\s]+)@([^@\s]+)$/.exec(value.trim());
  if (!match) return null;

  const instance = match[2].toLowerCase();
  return USER.test(match[1]) && isHostName(instance) ? { user: match[1], instance } : null;
}

export function mastodonLookupUrl(account: MastodonAccount): string {
  return `https://${account.instance}/api/v1/accounts/lookup?acct=${account.user}`;
}

export function mastodonStatusesUrl(instance: string, accountId: string): string {
  return `https://${instance}/api/v1/accounts/${accountId}/statuses?limit=10&exclude_replies=true&exclude_reblogs=true`;
}

/** The first picture of a status, when it has one. */
function imageOf(status: Record<string, unknown>): string | undefined {
  const first = Array.isArray(status.media_attachments) ? status.media_attachments[0] : null;
  if (!isRecord(first) || first.type !== 'image') return undefined;
  return typeof first.preview_url === 'string' ? safeHttpUrl(first.preview_url) : undefined;
}

function toItem(status: unknown, profile: string): SourceItem | null {
  // A boost carries the original inside `reblog`. It is not theirs.
  if (!isRecord(status) || (status.reblog !== null && status.reblog !== undefined)) return null;
  if (typeof status.content !== 'string') return null;

  const title = excerpt(stripHtml(status.content));
  if (!title) return null;

  return {
    kind: 'competitor',
    source: { id: 'mastodon', name: NAME, url: profile },
    title,
    url: typeof status.url === 'string' ? safeHttpUrl(status.url) : undefined,
    image: imageOf(status),
    publishedAt: isoDate(status.created_at),
  };
}

export function createMastodonAccountSource(options: CompetitorSourceOptions): CompetitorSource {
  return {
    id: 'mastodon',
    name: NAME,

    read: async (reference, signal) => {
      const account = mastodonAccount(reference);
      if (!account) {
        return emptyResult({ name: NAME }, 'not_found', {
          warnings: ['That is not a Mastodon account.'],
        });
      }

      const profile = `https://${account.instance}/@${account.user}`;
      const attribution = { name: NAME, url: profile };

      const lookup = await readBody(
        options.fetch,
        mastodonLookupUrl(account),
        'application/json',
        signal,
      );
      if (!lookup.ok) return failedRead(attribution, lookup);

      const found = parseJson(lookup.body);
      const id = isRecord(found) && typeof found.id === 'string' ? found.id : null;
      if (!id || !ACCOUNT_ID.test(id)) {
        return unreadable(attribution, 'The instance answered in a shape this cannot read.');
      }

      const statuses = await readBody(
        options.fetch,
        mastodonStatusesUrl(account.instance, id),
        'application/json',
        signal,
      );
      if (!statuses.ok) return failedRead(attribution, statuses);

      const list = parseJson(statuses.body);
      if (!Array.isArray(list)) {
        return unreadable(attribution, 'The instance answered in a shape this cannot read.');
      }

      const items = list.flatMap((status) => toItem(status, profile) ?? []);
      return { items: newest(items, options), attribution, warnings: [] };
    },
  };
}
