/**
 * PreToolUse hook: refuses any write that adds an em dash (U+2014) or a middle
 * dot (U+00B7) to the project. Both read as AI-written, so PostGear uses
 * neither anywhere: UI copy, code, comments, docs, commit messages or PRs.
 *
 * Checks the text a tool is about to write (Write, Edit, MultiEdit,
 * NotebookEdit) and the command text of `git commit` / `gh pr` / `gh issue`
 * runs. Characters are written as escapes so this file passes its own check.
 * Any failure to parse the input lets the call through: a broken hook must
 * never block work.
 */

const BANNED = [
  { char: '—', name: 'em dash (U+2014)' },
  { char: '·', name: 'middle dot (U+00B7)' },
];

/** The text a tool call would add to the project, or null when there is none to check. */
function textToCheck(toolName, input) {
  switch (toolName) {
    case 'Write':
      return input.content ?? '';
    case 'Edit':
      return input.new_string ?? '';
    case 'MultiEdit':
      return (input.edits ?? []).map((edit) => edit.new_string ?? '').join('\n');
    case 'NotebookEdit':
      return input.new_source ?? '';
    case 'Bash':
    case 'PowerShell': {
      const command = input.command ?? '';
      return /\bgit\b[\s\S]*\bcommit\b|\bgh\s+(pr|issue)\b/.test(command) ? command : null;
    }
    default:
      return null;
  }
}

function findings(text) {
  const lines = text.split(/\r?\n/);
  const found = [];
  for (const { char, name } of BANNED) {
    const lineNumbers = [];
    lines.forEach((line, index) => {
      if (line.includes(char)) lineNumbers.push(index + 1);
    });
    if (lineNumbers.length > 0) {
      const shown = lineNumbers.slice(0, 10).join(', ') + (lineNumbers.length > 10 ? ', ...' : '');
      found.push(`${name} on line ${shown} of the new text`);
    }
  }
  return found;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const text = textToCheck(payload.tool_name, payload.tool_input ?? {});
  if (!text) process.exit(0);

  const found = findings(text);
  if (found.length === 0) process.exit(0);

  const target =
    payload.tool_input?.file_path ?? payload.tool_input?.notebook_path ?? 'the command';
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `Blocked write to ${target}: it contains ${found.join(' and ')}. ` +
          'PostGear never uses the em dash or the middle dot because they read as AI-written. ' +
          'Rewrite with a comma, colon, parentheses, a full stop or a plain hyphen, then retry.',
      },
    }),
  );
  process.exit(0);
});
