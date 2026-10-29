/**
 * What counts as a secret. One list, used both to hide secrets in run
 * data (`redact`) and to refuse them in a saved graph
 * (`findSecretLikeValues`), so the two never disagree.
 */

/** A field name that holds a secret: `apiKey`, `Authorization`, `client_secret`. */
export const SECRET_KEY_PATTERN =
  /token|secret|password|passwd|authorization|api[-_]?key|cookie|signature|client[-_]?secret/i;

/**
 * Short query keys that carry a secret in a link. `sig` always does (Teams
 * and Azure links); `key`, `code` and `auth` usually do, so run data hides
 * them, but saving does not refuse a link for them (`?key=summer-sale`).
 */
const SECRET_QUERY_KEYS = new Set(['sig']);
const LIKELY_SECRET_QUERY_KEYS = new Set(['key', 'code', 'auth']);

/** `secretHeadersConnectionId` names an id, not a secret. */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key) && !/connectionid$/i.test(key);
}

export function isSecretQueryKey(key: string, generous = true): boolean {
  const lower = key.toLowerCase();
  return (
    SECRET_KEY_PATTERN.test(key) ||
    SECRET_QUERY_KEYS.has(lower) ||
    (generous && LIKELY_SECRET_QUERY_KEYS.has(lower))
  );
}

/**
 * Values that are secrets by their shape alone, whatever field they sit
 * in. Each has a plain name for the error message.
 */
export const SECRET_VALUE_PATTERNS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'a sign-in token', pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]{16,}=*/i },
  { name: 'a sign-in token', pattern: /\bBasic\s+[A-Za-z0-9+/]{16,}={0,2}/ },
  {
    name: 'a Slack webhook link',
    pattern:
      /https:\/\/hooks\.slack(?:-gov)?\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9/_-]{8,}/i,
  },
  {
    name: 'a Discord webhook link',
    pattern:
      /https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{8,}/i,
  },
  {
    name: 'a Microsoft Teams workflow link',
    pattern:
      /https:\/\/[A-Za-z0-9.-]+\.(?:logic\.azure\.com|powerplatform\.com)[^\s"']*[?&]sig=[^\s&"']+/i,
  },
  { name: 'an API key', pattern: /\bsk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{20,}/ },
  { name: 'an API key', pattern: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/ },
  { name: 'a Slack token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  {
    name: 'a GitHub token',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/,
  },
  { name: 'a Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'an AWS key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    name: 'a sign-in token',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
];

/** A link whose query string carries a secret (`?api_key=...`, `&sig=...`). */
const LINK = /\bhttps?:\/\/([^\s/?#"'<>]+)[^\s?#"'<>]*\?([^\s#"'<>]*)/gi;

/**
 * The links in `text` whose query string names a secret, with their scheme
 * and host. `generous` also counts `key`, `code` and `auth` (run data).
 */
export function secretLinks(text: string, generous = true): { link: string; origin: string }[] {
  const found: { link: string; origin: string }[] = [];
  for (const match of text.matchAll(LINK)) {
    const keys = match[2].split('&').map((pair) => decodeKey(pair.split('=')[0]));
    if (keys.some((key) => isSecretQueryKey(key, generous))) {
      const scheme = match[0].slice(0, match[0].indexOf(':'));
      found.push({ link: match[0], origin: `${scheme}://${match[1]}` });
    }
  }
  return found;
}

function decodeKey(key: string): string {
  try {
    return decodeURIComponent(key.replace(/\+/g, ' '));
  } catch {
    return key;
  }
}

/** The first secret shape found in `text`, by its plain name (the strict list, for saving). */
export function secretShapeIn(text: string): string | undefined {
  for (const { name, pattern } of SECRET_VALUE_PATTERNS) {
    if (pattern.test(text)) return name;
  }
  return secretLinks(text, false).length ? 'a link with a secret in it' : undefined;
}
