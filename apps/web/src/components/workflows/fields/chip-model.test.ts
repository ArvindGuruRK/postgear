import {
  type AutomationGraph,
  getTemplate,
  instantiateTemplate,
  parseTemplate,
} from '@postgear/automation';
import { Editor, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  CHIP_NODE,
  chipInfo,
  chipName,
  chipValue,
  docToSegments,
  docToTemplate,
  filterWords,
  previewText,
  templateToDoc,
} from './chip-model';

/** Module 02's tricky strings and a few more: every one must come back byte for byte. */
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
  '\n\nblank lines first\n\n{{ run.mode }}\n\n',
  'tabs\tand  double  spaces {{ workspace.name }}  ',
  '{{ nodes.gone.output.text | default: "line\\nbreak" }}',
  '{{ trigger.tags | join: " | " | upper }} {{ trigger.tags | first }}',
  'Windows\r\nline ending {{ run.id }}',
];

/** A headless editor with the same schema as the chip input (the node view is React's job). */
function makeEditor(): Editor {
  const Chip = Node.create({
    name: CHIP_NODE,
    group: 'inline',
    inline: true,
    atom: true,
    addAttributes: () => ({
      raw: { default: '' },
      path: { default: '' },
      filters: { default: [] },
    }),
    parseHTML: () => [{ tag: 'span[data-data-chip]' }],
    renderHTML: ({ HTMLAttributes }) => ['span', { 'data-data-chip': '', ...HTMLAttributes }],
  });
  return new Editor({
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bold: false,
        bulletList: false,
        code: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        italic: false,
        listItem: false,
        listKeymap: false,
        link: false,
        orderedList: false,
        strike: false,
        underline: false,
        trailingNode: false,
      }),
      Chip,
    ],
  });
}

describe('chip round trip', () => {
  it('has at least 30 tricky strings', () => {
    expect(TRICKY.length).toBeGreaterThanOrEqual(30);
  });

  it.each(TRICKY)('gives back %j exactly through the document', (text) => {
    expect(docToTemplate(templateToDoc(text), text)).toBe(text);
  });

  it.each(TRICKY)('gives back %j exactly through a real editor', (text) => {
    const editor = makeEditor();
    editor.commands.setContent(templateToDoc(text));
    expect(docToTemplate(editor.getJSON(), text)).toBe(text);
    editor.destroy();
  });

  it.each(TRICKY)('writes %j safely when nothing is known about the old text', (text) => {
    const written = docToTemplate(templateToDoc(text));
    expect(docToSegments(templateToDoc(written))).toEqual(docToSegments(templateToDoc(text)));
  });

  it('writes an edited field safely, keeping pieces that did not change', () => {
    const before = '{{trigger.post.url}} and {{ not a token }}';
    const doc = templateToDoc(before);
    // Add a mark at the end, as typing would: the braces typed as text stay text.
    doc.content?.[0].content?.push({ type: 'text', text: '!' });
    expect(docToTemplate(doc, before)).toBe('{{ trigger.post.url }} and \\{{ not a token }}!');

    // A chip added after untouched text keeps the text and the old chip as they were.
    const added = templateToDoc('Hi {{trigger.post.url}} ');
    added.content?.[0].content?.push({
      type: CHIP_NODE,
      attrs: { path: 'run.id', filters: [], raw: '{{ run.id }}' },
    });
    expect(docToTemplate(added, 'Hi {{trigger.post.url}} ')).toBe(
      'Hi {{trigger.post.url}} {{ run.id }}',
    );
  });

  it('turns new lines into breaks and paragraphs back into lines', () => {
    expect(templateToDoc('a\nb').content?.[0].content?.map((node) => node.type)).toEqual([
      'text',
      'hardBreak',
      'text',
    ]);
    const twoBlocks = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
      ],
    };
    expect(docToTemplate(twoBlocks)).toBe('one\ntwo');
  });
});

describe('chip words', () => {
  const graph = instantiateTemplate(
    getTemplate('publishing-report') as NonNullable<ReturnType<typeof getTemplate>>,
    (() => {
      let n = 0;
      return () => `k${(n++).toString().padStart(9, '0')}`;
    })(),
  ) as AutomationGraph;
  const trigger = graph.nodes[0];
  const fields = graph.nodes.find((node) => node.type === 'logic.setFields');
  const slack = graph.nodes.find((node) => node.type === 'notify.slack');

  it('names the source step and the field', () => {
    const info = chipInfo(graph, slack?.key, 'trigger.post.url');
    expect(info).toMatchObject({ source: trigger.name, field: 'Post Link', available: true });
    expect(chipName(info)).toBe(`data: ${trigger.name}, Post Link`);
    expect(chipInfo(graph, slack?.key, 'run.id')).toMatchObject({ source: 'Run', field: 'Run Id' });
    expect(chipInfo(graph, slack?.key, 'workspace.name').available).toBe(true);
  });

  it('marks data that is gone or comes later', () => {
    expect(chipInfo(graph, slack?.key, 'nodes.gone123456.output.text')).toMatchObject({
      available: false,
      problem: 'This data is no longer available.',
    });
    expect(chipInfo(graph, slack?.key, `nodes.${fields?.key}.output.nothere`).available).toBe(
      false,
    );
    expect(chipInfo(graph, fields?.key, `nodes.${slack?.key}.output.sent`)).toMatchObject({
      available: false,
      problem: 'This data comes from a step that runs later.',
    });
  });

  it('shows a sample with its formats applied', () => {
    const scope = { trigger: { post: { preview: 'Fresh sourdough is out of the oven.' } } };
    expect(chipValue('trigger.post.preview', [{ name: 'truncate', arg: 6 }], scope)).toBe('Fresh…');
    expect(chipValue('trigger.post.preview', [{ name: 'upper' }], undefined)).toBeUndefined();
    expect(previewText('')).toBe('(empty)');
    expect(previewText(['a', 'b'])).toBe('a, b');
  });

  it('says every format in plain words', () => {
    expect(filterWords({ name: 'truncate', arg: 200 })).toBe('Shorten to 200 characters');
    expect(filterWords({ name: 'date', arg: 'yyyy-MM-dd' })).toBe('Date as 2026-11-03');
    expect(filterWords({ name: 'default', arg: 'n/a' })).toBe('If empty use "n/a"');
    expect(filterWords({ name: 'join', arg: ', ' })).toBe('Join a list with commas');
    expect(filterWords({ name: 'upper' })).toBe('Upper case');
    for (const word of ['upper', 'lower', 'trim', 'json', 'first', 'count', 'urlencode']) {
      expect(filterWords({ name: word })).not.toMatch(/json|cron|payload/i);
    }
  });

  it('reads tokens the way Module 02 does', () => {
    expect(docToSegments(templateToDoc('Hi {{ run.id }}'))).toEqual(
      parseTemplate('Hi {{ run.id }}').map((segment) =>
        segment.kind === 'text' ? { kind: 'text', value: segment.value } : segment,
      ),
    );
  });
});
