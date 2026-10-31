/**
 * What a Notify step's message preview shows (Module 12, `form.preview`):
 * the step's text fields filled with the data the panel has (pinned, the
 * last test, else the built-in samples). Pure, so it is unit tested.
 *
 * Everything here is plain text. The preview draws it as React text, so a
 * post that says `<script>` or `<!channel>` shows exactly that and nothing
 * runs; a button link is only ever drawn when it is an http or https
 * address, and the preview never shows the connection's own link.
 */
import {
  type MessagePreviewKind,
  type RunScope,
  resolveTemplate,
  toText,
} from '@postgear/automation';

/** Discord's own cap on one message. */
export const DISCORD_LIMIT = 2_000;
/** Where the counter turns red: close enough that the next chip may cross it. */
export const DISCORD_WARN_AT = 1_800;

export interface MessagePreview {
  kind: MessagePreviewKind;
  title: string;
  text: string;
  /** A button's link (http or https only), or null for no button. */
  link: string | null;
  /** Slack: "Sent by the workflow {name}" under the message. */
  footer: string | null;
  /** Email: the resolved addresses. */
  to: string[];
}

/** One template filled with the panel's data, as text. Never throws. */
export function fill(template: unknown, scope: RunScope, timeZone?: string): string {
  if (typeof template !== 'string' || template === '') return '';
  try {
    return toText(resolveTemplate(template, scope, { timeZone }).value);
  } catch {
    return '';
  }
}

/** A link a button may carry: http or https, else nothing. */
export function safeLink(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function buildPreview(
  kind: MessagePreviewKind,
  config: Record<string, unknown>,
  scope: RunScope,
  options: { workflowName?: string; timeZone?: string } = {},
): MessagePreview {
  const read = (path: string) => fill(config[path], scope, options.timeZone);
  const name = options.workflowName?.trim() || 'this workflow';
  const to = Array.isArray(config.to)
    ? config.to.map((entry) => fill(entry, scope, options.timeZone)).filter(Boolean)
    : [];
  return {
    kind,
    title: kind === 'email' ? read('subject') : read('title'),
    text: read('message'),
    link: kind === 'slack' || kind === 'teams' ? safeLink(read('includeLink')) : null,
    footer: kind === 'slack' && config.footer === true ? `Sent by the workflow ${name}` : null,
    to,
  };
}

/** "1,234 / 2,000"; `warn` once it is close to the limit, `over` past it. */
export function discordCount(text: string): { words: string; warn: boolean; over: boolean } {
  const length = [...text].length;
  const format = new Intl.NumberFormat('en');
  return {
    words: `${format.format(length)} / ${format.format(DISCORD_LIMIT)}`,
    warn: length >= DISCORD_WARN_AT,
    over: length > DISCORD_LIMIT,
  };
}
