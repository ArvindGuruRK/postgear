import { rawFileName, rawLines } from './raw-lines';
import { rawText } from './panel-view-model';

const kinds = (text: string) => rawLines(text).map((line) => line.tokens.map((t) => t.kind));

describe('rawLines', () => {
  it('splits a line into its key, value and comma, and keeps every character', () => {
    const lines = rawLines('{\n  "name": "poda",\n  "count": 3\n}');
    expect(lines.map((line) => line.level)).toEqual([0, 1, 1, 0]);
    expect(lines[1].tokens).toEqual([
      { kind: 'key', text: '"name"' },
      { kind: 'punctuation', text: ': ' },
      { kind: 'string', text: '"poda"' },
      { kind: 'punctuation', text: ',' },
    ]);
    expect(lines[2].tokens.at(-1)).toEqual({ kind: 'number', text: '3' });
  });

  it('tells yes or no, nothing and negative numbers apart', () => {
    expect(kinds('[\n  true,\n  null,\n  -1.5\n]')).toEqual([
      ['bracket'],
      ['literal', 'punctuation'],
      ['null', 'punctuation'],
      ['number'],
      ['bracket'],
    ]);
  });

  it('is not fooled by colons, quotes or commas inside a string', () => {
    const line = rawLines('  "a:b": "say \\"hi\\", ok",')[0];
    expect(line.tokens.map((t) => t.text)).toEqual(['"a:b"', ': ', '"say \\"hi\\", ok"', ',']);
    expect(line.tokens[2].kind).toBe('string');
  });

  it('opens a nested value on the key line', () => {
    expect(rawLines('  "image": {')[0].tokens.map((t) => t.kind)).toEqual([
      'key',
      'punctuation',
      'bracket',
    ]);
  });

  it('gives back the same text it was given, for real data', () => {
    const text = rawText({ a: [1, { b: 'x, y: z', c: null }], d: true, e: '' });
    const joined = rawLines(text)
      .map((line) => '  '.repeat(line.level) + line.tokens.map((t) => t.text).join(''))
      .join('\n');
    expect(joined).toBe(text);
  });

  it('gives each bracket pair one depth, for its colour', () => {
    const brackets = rawLines(rawText({ a: [{ b: 1 }], c: {} }))
      .flatMap((line) => line.tokens)
      .filter((token) => token.kind === 'bracket')
      .map((token) => [token.text, token.depth]);
    expect(brackets).toEqual([
      ['{', 0],
      ['[', 1],
      ['{', 2],
      ['}', 2],
      [']', 1],
      ['{}', 1],
      ['}', 0],
    ]);
  });

  it('has no lines for no data', () => {
    expect(rawLines('')).toEqual([]);
  });
});

describe('rawFileName', () => {
  it('names the tab as a file would be called', () => {
    expect(rawFileName('Generate Text result')).toBe('generate-text-result.json');
    expect(rawFileName('In-App Notification input')).toBe('in-app-notification-input.json');
    expect(rawFileName('!!!')).toBe('data.json');
  });
});
