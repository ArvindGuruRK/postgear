/**
 * Words behind the Webhook trigger's link field (Module 13). The secret
 * itself never passes through here: the example always carries a
 * placeholder, so copying it never copies a real secret.
 */
import { ago } from '../list/workflows-view-model';

/** What the example puts where the secret goes. */
export const SECRET_PLACEHOLDER = '<your secret>';

/** The header another app sends the secret in. */
export const SECRET_HEADER = 'X-PostGear-Secret';

export const SHOWN_ONCE = 'Copy it now. It will not be shown again.';

/** A ready-made request another app (or a terminal) can send. */
export function curlExample(url: string): string {
  return [
    `curl -X POST "${url}" \\`,
    `  -H "${SECRET_HEADER}: ${SECRET_PLACEHOLDER}" \\`,
    '  -H "Content-Type: application/json" \\',
    `  -d '{"title":"Spring Menu","url":"https://example.com/spring"}'`,
  ].join('\n');
}

/** "...a9F2": all that is shown of a saved secret. */
export function maskedSecret(last4: string): string {
  return `...${last4}`;
}

/** "Last received 3 minutes ago", or the sentence for nothing received yet. */
export function lastReceivedWords(sampleAt: string | null, now: number = Date.now()): string {
  if (!sampleAt) return 'Nothing received yet.';
  const when = ago(sampleAt, now);
  return when ? `Last received ${when}` : 'Nothing received yet.';
}
