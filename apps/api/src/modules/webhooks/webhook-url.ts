/**
 * Judges a webhook URL at save time (Sprint 8).
 *
 * The worker runs the same guard again at send time, so a host that starts
 * resolving privately after it was saved is still refused; this check is
 * the one that tells the person *now*, with a reason, rather than letting
 * them save a hook that can never deliver.
 *
 * Two policies:
 * - **Normal**: `https://` only, through the SEO crawler's SSRF guard, which
 *   refuses localhost, private and link-local addresses, credentials in the
 *   URL and non-default ports, and resolves the host to check every address.
 * - **`WEBHOOK_ALLOW_PRIVATE_URLS=true`** (local testing; refused in
 *   production by the env schema): `http://` or `https://` to anywhere,
 *   including `localhost:4000`. Nothing is resolved.
 */
import { assertSafeUrl, type UrlGuardOptions } from '@postgear/seo-engine';
import { WEBHOOK_MESSAGES } from './webhooks.messages';

export type WebhookUrlVerdict = { ok: true; url: string } | { ok: false; message: string };

export async function judgeWebhookUrl(
  input: string,
  options: { allowPrivate: boolean; resolve?: UrlGuardOptions['resolve'] },
): Promise<WebhookUrlVerdict> {
  if (options.allowPrivate) {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      return { ok: false, message: 'That is not a valid URL.' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, message: WEBHOOK_MESSAGES.URL_SCHEME_LOCAL };
    }
    if (url.username || url.password) {
      return { ok: false, message: 'URLs with a username or password are not allowed.' };
    }
    url.hash = '';
    return { ok: true, url: url.toString() };
  }

  if (!/^https:\/\//i.test(input.trim())) {
    return { ok: false, message: WEBHOOK_MESSAGES.URL_SCHEME };
  }

  const verdict = await assertSafeUrl(input, { resolve: options.resolve });
  if (!verdict.ok) {
    return { ok: false, message: verdict.message.replace('analysed', 'delivered to').replace('the analyzer never fetches', 'webhooks never reach') };
  }

  return { ok: true, url: verdict.url.toString() };
}
