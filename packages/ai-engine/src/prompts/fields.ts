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
