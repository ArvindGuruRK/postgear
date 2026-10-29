import {
  formatToken,
  parseTemplate,
  type Segment,
  sameSegments,
  serializeSegments,
  singleToken,
  tokenSource,
  tokensIn,
} from './parse';

const TRICKY = [
  '',
  'plain text',
  '{{ trigger.post.url }}',
  'Link: {{ trigger.post.url }}!',
  '{{trigger.post.url}}',
  '{{   nodes.k3f9a1.output.text   |  truncate:200|upper }}',
  'a {{ b',
  'a }} b',
  '{{ }}',
  '{{ not a token }}',
  '\\{{ trigger.post.url }}',
  '\\\\{{ trigger.post.url }}',
  '\\\\\\{{ trigger.post.url }}',
  'C:\\path\\to\\file',
  'emoji \u{1F389} {{ trigger.post.preview }} \u{1F680}',
  'unicode \u00FCn\u00EFc\u00F6d\u00E9 {{ run.id }} \u65E5\u672C\u8A9E',
  '{{{ trigger.post.url }}}',
  '{{ x | default: "a \\"quoted\\" }} value" }}',
  '{"json": "{{ trigger.body.title }}"}',
  '{{ x | default: "n/a" }} and {{ y }}',
  '{{ a }}{{ b }}',
  '{{ trigger.publishedAt | date: "d MMM yyyy" }}',
  '{{ x | truncate: -5 }}',
  '{{ x | 1bad }}',
  'line1\nline2 {{ x }}\n',
  '{{ x | }}',
  '{{ x | join: ", " }}',
  '\\',
  'ends with a backslash \\',
  '{{ x }}\\',
  'nested {{ {{ x }} }}',
  '\\{{',
  '{{',
  '}}',
  '{{ x }} \\{{ y }} {{ z }}',
];

/** The same segments without their source text, as the chip editor would hand them back. */
function withoutRaw(segments: Segment[]): Segment[] {
  return segments.map((segment) =>
    segment.kind === 'text'
      ? { kind: 'text', value: segment.value }
      : { kind: 'token', path: segment.path, filters: segment.filters },
  );
}

describe('parseTemplate and serializeSegments', () => {
  it.each(TRICKY)('gives back exactly %j', (text) => {
    expect(serializeSegments(parseTemplate(text))).toBe(text);
  });

  it.each(TRICKY)('writes %j safely when the editor rebuilds it', (text) => {
    const segments = parseTemplate(text);
    const rebuilt = serializeSegments(withoutRaw(segments));
    expect(sameSegments(parseTemplate(rebuilt), segments)).toBe(true);
  });

  it('reads a token with its path and formats', () => {
    expect(
      parseTemplate('Hi {{ nodes.k3f9.output.text | truncate: 20 | default: "n/a" }}!'),
    ).toEqual([
      { kind: 'text', value: 'Hi ', raw: 'Hi ' },
      {
        kind: 'token',
        path: 'nodes.k3f9.output.text',
        filters: [
          { name: 'truncate', arg: 20 },
          { name: 'default', arg: 'n/a' },
        ],
        raw: '{{ nodes.k3f9.output.text | truncate: 20 | default: "n/a" }}',
      },
      { kind: 'text', value: '!', raw: '!' },
    ]);
  });

  it('keeps braces that are not a token as text', () => {
    expect(parseTemplate('{{ not a token }}')).toEqual([
      { kind: 'text', value: '{{ not a token }}', raw: '{{ not a token }}' },
    ]);
    expect(tokensIn('a {{ b')).toEqual([]);
  });

  it('treats \\{{ as literal braces and halves backslashes before braces', () => {
    expect(parseTemplate('\\{{ trigger.post.url }}')[0]).toMatchObject({
      kind: 'text',
      value: '{{ trigger.post.url }}',
    });
    const [first, second] = parseTemplate('\\\\{{ trigger.post.url }}');
    expect(first).toMatchObject({ kind: 'text', value: '\\' });
    expect(second).toMatchObject({ kind: 'token', path: 'trigger.post.url' });
    expect(parseTemplate('C:\\path')[0]).toMatchObject({ value: 'C:\\path' });
  });

  it('finds a chip inside a brace that is not one', () => {
    const segments = parseTemplate('{{{ trigger.post.url }}}');
    expect(segments.map((s) => (s.kind === 'text' ? s.value : `<${s.path}>`))).toEqual([
      '{',
      '<trigger.post.url>',
      '}',
    ]);
  });

  it('escapes typed braces so they never become a chip', () => {
    const text = serializeSegments([{ kind: 'text', value: 'Use {{ trigger.post.url }} here' }]);
    expect(text).toBe('Use \\{{ trigger.post.url }} here');
    expect(tokensIn(text)).toEqual([]);
  });

  it('keeps a backslash right before a chip', () => {
    const text = serializeSegments([
      { kind: 'text', value: 'path\\' },
      { kind: 'token', path: 'trigger.post.id', filters: [] },
    ]);
    expect(text).toBe('path\\\\{{ trigger.post.id }}');
    expect(parseTemplate(text).map((s) => s.kind)).toEqual(['text', 'token']);
  });

  it('writes a canonical token with quoted text arguments', () => {
    expect(
      formatToken({
        path: 'trigger.post.preview',
        filters: [{ name: 'default', arg: 'say "hi"' }, { name: 'upper' }],
      }),
    ).toBe('{{ trigger.post.preview | default: "say \\"hi\\"" | upper }}');
  });

  it('treats one token with spaces around it as a single value', () => {
    expect(singleToken(parseTemplate('  {{ trigger.post.url }} '))?.path).toBe('trigger.post.url');
    expect(singleToken(parseTemplate('Link {{ trigger.post.url }}'))).toBeUndefined();
    expect(singleToken(parseTemplate('{{ a }}{{ b }}'))).toBeUndefined();
  });

  it('splits a token path into its source and field', () => {
    expect(tokenSource('nodes.k3f9.output.post.url')).toEqual({
      root: 'nodes',
      nodeKey: 'k3f9',
      field: 'post.url',
      wellFormed: true,
    });
    expect(tokenSource('nodes.k3f9.text').wellFormed).toBe(false);
    expect(tokenSource('trigger.post.url')).toEqual({
      root: 'trigger',
      field: 'post.url',
      wellFormed: true,
    });
  });
});
