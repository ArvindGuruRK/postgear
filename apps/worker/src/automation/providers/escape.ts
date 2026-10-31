/**
 * Text helpers the Notify providers share (Module 12): Slack's mrkdwn
 * escaping, cutting a message to an app's limit with a visible note, and
 * short previews. Pure, so the request bodies can be snapshot tested.
 */

/** What a cut message ends with, so the reader knows text is missing. */
export const SHORTENED = '... (shortened)';

/**
 * Slack's mrkdwn control characters as entities. Slack turns `<...>` into
 * links and mentions (`<!channel>`, `<@U123>`, `<https://evil|Click>`), so
 * escaping `<` and `>` makes data in a message inert, and `&` goes first so
 * an existing entity is shown as typed. Plain `@channel` text does not ping
 * in a webhook message (only the `<!channel>` form does), so this is the
 * whole of mention safety.
 */
export function escapeSlack(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const SLACK_ENTITY: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

/**
 * `text` escaped for Slack and cut so the escaped form fits `max`
 * characters, never in the middle of an entity. `shortened` says whether
 * anything was cut (the step output notes it).
 */
export function fitSlack(text: string, max: number): { text: string; shortened: boolean } {
  const escaped = escapeSlack(text);
  if (escaped.length <= max) return { text: escaped, shortened: false };
  const room = max - SHORTENED.length;
  let out = '';
  for (const char of text) {
    const piece = SLACK_ENTITY[char] ?? char;
    if (out.length + piece.length > room) break;
    out += piece;
  }
  return { text: `${out}${SHORTENED}`, shortened: true };
}

/**
 * The first `max` characters of `text`, counted by code point (an emoji is
 * never split), with `SHORTENED` at the end when it had to cut.
 */
export function cutText(text: string, max: number): { text: string; shortened: boolean } {
  const chars = Array.from(text);
  if (chars.length <= max) return { text, shortened: false };
  return {
    text: `${chars.slice(0, Math.max(0, max - SHORTENED.length)).join('')}${SHORTENED}`,
    shortened: true,
  };
}

/** The first `max` characters on one line, for summaries and step outputs. */
export function previewOf(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(line);
  return chars.length <= max ? line : `${chars.slice(0, max - 3).join('')}...`;
}

/**
 * An app's own error words, safe to show and store: control characters
 * dropped, spaces collapsed, at most `max` characters. Null when empty.
 */
export function appWords(raw: unknown, max = 120): string | null {
  if (typeof raw !== 'string') return null;
  const printable = Array.from(raw, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f ? ' ' : char;
  }).join('');
  const clean = printable.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return previewOf(clean, max);
}
