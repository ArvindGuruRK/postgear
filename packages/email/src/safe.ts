/**
 * Making text from outside (workspace names, channel names, provider errors,
 * a workflow's message) safe to put in an email.
 *
 * Escaping is React's job: every template writes user text as a child or an
 * attribute, never through raw HTML, so it cannot become markup. What React
 * cannot do is keep it short and on one line, which is what these are for.
 * The few strings that do go into raw HTML (the Outlook button, the head)
 * pass through `escapeHtml` first.
 */

/** Control characters other than tab and newline, plus the bidi overrides. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
const UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g;

/** Cuts to `max` characters (by code point, so no emoji is split), with "..." when cut. */
export function truncate(value: string, max: number): string {
  const chars = Array.from(value);
  if (chars.length <= max) return value;
  return `${chars
    .slice(0, Math.max(0, max - 3))
    .join('')
    .trimEnd()}...`;
}

/** One line: no control characters, no line breaks, single spaces, capped. */
export function oneLine(value: unknown, max = 200): string {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  return truncate(text.replace(UNSAFE, '').replace(/\s+/g, ' ').trim(), max);
}

/** Several lines kept as lines (for a message body), each cleaned, the whole capped. */
export function multiLine(value: unknown, max = 5_000): string {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  const lines = text
    .replace(/\r\n?/g, '\n')
    .replace(UNSAFE, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd());
  return truncate(lines.join('\n').trim(), max);
}

/** For the few strings written into raw HTML by hand. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Only http(s) links are ever put behind a button or an anchor. Anything else
 * (`javascript:`, `data:`) is refused, and the template shows no button.
 */
export function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Shared limits, so every template caps the same field the same way. */
export const LIMITS = {
  name: 80,
  subject: 200,
  fact: 300,
  preview: 140,
  bullet: 200,
  paragraph: 1_000,
  quote: 2_000,
  message: 20_000,
} as const;
