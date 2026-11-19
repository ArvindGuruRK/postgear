/**
 * The arguments of `npm run clips:remove` (Sprint 12, Module 19 section 5),
 * read without a library so the script has nothing to install:
 *
 *   npm run clips:remove -- --url <link> --reason "<why>" --by <operator email>
 *
 * Pure, so it is tested on its own.
 */
export interface ClipsRemoveArgs {
  url: string;
  reason: string;
  by: string;
}

export const CLIPS_REMOVE_USAGE =
  'Usage: npm run clips:remove -- --url <video link> --reason "<at least 10 characters>" --by <operator email>';

/** The arguments, or the sentence that says what is missing. */
export function parseClipsRemoveArgs(argv: readonly string[]): ClipsRemoveArgs | { error: string } {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i];
    if (!name?.startsWith('--')) return { error: `Unexpected "${name}". ${CLIPS_REMOVE_USAGE}` };
    const [flag, inline] = name.slice(2).split('=', 2) as [string, string | undefined];
    const value = inline ?? argv[i + 1];
    if (inline === undefined) i += 1;
    if (value === undefined || value.startsWith('--')) {
      return { error: `--${flag} needs a value. ${CLIPS_REMOVE_USAGE}` };
    }
    values.set(flag, value.trim());
  }
  for (const flag of values.keys()) {
    if (!['url', 'reason', 'by'].includes(flag)) {
      return { error: `Unknown option --${flag}. ${CLIPS_REMOVE_USAGE}` };
    }
  }
  const url = values.get('url') ?? '';
  const reason = values.get('reason') ?? '';
  const by = (values.get('by') ?? '').toLowerCase();
  if (!url) return { error: `--url is required. ${CLIPS_REMOVE_USAGE}` };
  if (reason.length < 10)
    return { error: `--reason needs at least 10 characters. ${CLIPS_REMOVE_USAGE}` };
  if (!by.includes('@')) return { error: `--by needs the operator's email. ${CLIPS_REMOVE_USAGE}` };
  return { url, reason, by };
}
