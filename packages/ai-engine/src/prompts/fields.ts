/**
 * The labelled-field format every prompt in this package uses for its inputs.
 *
 * Prompts carry their parameters as `Label: value` lines and fenced blocks
 * (`<<<brief … >>>`), not prose. Two readers depend on that shape: a real
 * model, which follows explicit labels more reliably than instructions buried
 * in a paragraph, and the simulated model client, which has no understanding
 * at all and *parses* the prompt to learn the tone, format and limits it must
 * respect. Keeping the writer and the reader in one file is what keeps them
 * in step.
 */

export function field(label: string, value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === '') return `${label}: (none)`;
  return `${label}: ${String(value)}`;
}

/** A multi-line value in a fence the reader can find without guessing. */
export function block(label: string, value: string): string {
  const body = value.trim().length > 0 ? value.trim() : '(none)';
  return `<<<${label}\n${body}\n>>>`;
}

/**
 * Text quoted from a video or a person (a transcript row, a caption line, a
 * request), made safe to place inside a prompt: one line, no control
 * characters, and no fence marks, so it can neither start a `Label:` line of
 * its own nor close the `<<<` block it sits in and speak outside it.
 */
export function quotedLine(text: string): string {
  return text
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/<{3,}/g, '<<')
    .replace(/>{3,}/g, '>>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A model's short answer (a title) with its markup taken off: HTML or XML
 * tags, subtitle override blocks (`{\b1}`), Markdown links (kept as their
 * words), emphasis and code marks, and any angle bracket or brace left over.
 */
export function stripMarkup(text: string): string {
  return text
    .replace(/<[^<>]{0,200}>/g, ' ')
    .replace(/\{[^{}]{0,200}\}/g, ' ')
    .replace(/!?\[([^\]]{0,200})\]\([^)]{0,500}\)/g, '$1')
    .replace(/(\*{1,3}|_{2,3}|~{2}|`+)/g, '')
    .replace(/[<>{}[\]\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The value of a `Label: value` line, or null when absent or `(none)`. */
export function readField(text: string, label: string): string | null {
  const pattern = new RegExp(`^${escapeRegExp(label)}:[ \\t]*(.*)$`, 'm');
  const match = pattern.exec(text);
  if (!match) return null;
  const value = match[1].trim();
  return value === '' || value === '(none)' ? null : value;
}

/** The body of a `<<<Label … >>>` fence, or null when absent or `(none)`. */
export function readBlock(text: string, label: string): string | null {
  const pattern = new RegExp(`<<<${escapeRegExp(label)}\\n([\\s\\S]*?)\\n>>>`);
  const match = pattern.exec(text);
  if (!match) return null;
  const value = match[1].trim();
  return value === '' || value === '(none)' ? null : value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
