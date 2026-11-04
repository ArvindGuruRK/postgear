/**
 * The Raw view's lines: formatted data split into typed pieces, so it can be
 * coloured and indented without a code editor. `rawText` is always
 * `JSON.stringify(value, null, 2)`, which puts one key or value on each line.
 */
export type RawTokenKind =
  | 'key'
  | 'string'
  | 'number'
  | 'literal'
  | 'null'
  | 'punctuation'
  | 'bracket';

export interface RawToken {
  kind: RawTokenKind;
  text: string;
  /** A bracket's nesting, for its colour; a pair shares one. */
  depth?: number;
}

export interface RawLine {
  /** How many levels in the line sits. */
  level: number;
  tokens: RawToken[];
}

const STRING = '"(?:[^"\\\\]|\\\\.)*"';
const LINE = new RegExp(`^( *)(?:(${STRING})(:\\s*))?(.*?)(,?)$`);
const IS_STRING = new RegExp(`^${STRING}$`);
const IS_NUMBER = /^-?\d/;
const OPENS = new Set(['{', '[']);
const CLOSES = new Set(['}', ']']);
const EMPTY = new Set(['{}', '[]']);

function valueToken(text: string): RawToken {
  if (IS_STRING.test(text)) return { kind: 'string', text };
  if (text === 'null') return { kind: 'null', text };
  if (text === 'true' || text === 'false') return { kind: 'literal', text };
  if (IS_NUMBER.test(text)) return { kind: 'number', text };
  return { kind: 'punctuation', text };
}

/** The name on the view's tab, as a file would be called: `generate-text-result.json`. */
export function rawFileName(label: string): string {
  const name = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${name || 'data'}.json`;
}

export function rawLines(text: string): RawLine[] {
  if (!text) return [];
  let depth = 0;
  const bracket = (value: string): RawToken | null => {
    if (OPENS.has(value)) {
      depth += 1;
      return { kind: 'bracket', text: value, depth: depth - 1 };
    }
    if (CLOSES.has(value)) {
      depth = Math.max(0, depth - 1);
      return { kind: 'bracket', text: value, depth };
    }
    return EMPTY.has(value) ? { kind: 'bracket', text: value, depth } : null;
  };
  return text.split('\n').map((line) => {
    const match = LINE.exec(line);
    if (!match) return { level: 0, tokens: [{ kind: 'punctuation', text: line }] };
    const [, spaces, key, colon, value, comma] = match;
    const tokens: RawToken[] = [];
    if (key) {
      tokens.push({ kind: 'key', text: key }, { kind: 'punctuation', text: colon });
    }
    if (value) tokens.push(bracket(value) ?? valueToken(value));
    if (comma) tokens.push({ kind: 'punctuation', text: comma });
    return { level: spaces.length / 2, tokens };
  });
}
