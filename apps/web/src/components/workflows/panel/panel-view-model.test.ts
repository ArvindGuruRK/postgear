import {
  type AutomationGraph,
  getTemplate,
  instantiateTemplate,
  resolveValue,
} from '@postgear/automation';
import {
  buildScope,
  checkPinnedShape,
  flattenFields,
  locateDataError,
  neighbours,
  parsePinnedText,
  sourceLabel,
  valueWords,
  walkOrder,
} from './panel-view-model';

function report(): AutomationGraph {
  const template = getTemplate('publishing-report');
  if (!template) throw new Error('missing template');
  return instantiateTemplate(template, (key) => key);
}

describe('parsePinnedText', () => {
  it('reads valid data', () => {
    expect(parsePinnedText('{ "sent": true }')).toEqual({ ok: true, value: { sent: true } });
    expect(parsePinnedText('[1, 2]')).toEqual({ ok: true, value: [1, 2] });
  });

  it('names the line of a missing comma', () => {
    const text = '{\n  "sent": true\n  "title": "Hi"\n}';
    const parsed = parsePinnedText(text);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.line).toBe(3);
    expect(parsed.message).toBe(
      'Line 3 has something unexpected. Check for a missing comma, quote or bracket.',
    );
  });

  it('says when the data ends too early, and where', () => {
    const parsed = parsePinnedText('{\n  "sent": true,\n  "list": [1, 2');
    expect(parsed).toEqual({
      ok: false,
      line: 3,
      message: 'The data ends too early on line 3. Check for a missing } or ].',
    });
  });

  it('catches a trailing comma, a single quote and words without quotes', () => {
    expect(parsePinnedText('{ "a": 1, }')).toMatchObject({ ok: false, line: 1 });
    expect(parsePinnedText("{\n'a': 1 }")).toMatchObject({ ok: false, line: 2 });
    expect(parsePinnedText('{\n\n  "a": yes\n}')).toMatchObject({ ok: false, line: 3 });
  });

  it('asks for something when the editor is empty', () => {
    expect(parsePinnedText('  ')).toEqual({
      ok: false,
      line: null,
      message: 'Enter the data to pin.',
    });
  });

  it('agrees with JSON.parse on valid text', () => {
    for (const text of ['{}', '[]', '"x"', '-1.5e3', 'null', '{"a":[{"b":"c\\"d"}]}']) {
      expect(locateDataError(text)).toBeNull();
    }
  });
});

describe('checkPinnedShape', () => {
  const slack = report().nodes.find((node) => node.key === 'slack');
  if (!slack) throw new Error('missing slack');

  it('refuses data that is not a set of fields', () => {
    expect(checkPinnedShape(slack, [1, 2]).error).toMatch(/set of named fields/);
    expect(checkPinnedShape(slack, 'sent').error).not.toBeNull();
  });

  it('warns about fields left out or of another kind, without refusing', () => {
    const result = checkPinnedShape(slack, { sent: 'yes', channel: 'Marketing' });
    expect(result.error).toBeNull();
    expect(result.warnings).toEqual([
      'Steps after this one will find Message Preview empty.',
      'Sent should be true or false.',
    ]);
    expect(
      checkPinnedShape(slack, { sent: true, channel: 'Marketing', preview: 'Hi' }).warnings,
    ).toEqual([]);
  });
});

describe('the Expanded view walk', () => {
  it('steps through the workflow in run order', () => {
    const graph = report();
    expect(walkOrder(graph)).toEqual(['published', 'fields', 'sheet', 'slack']);
    expect(neighbours(graph, 'published')).toEqual({ previous: null, next: 'fields' });
    expect(neighbours(graph, 'sheet')).toEqual({ previous: 'fields', next: 'slack' });
    expect(neighbours(graph, 'slack')).toEqual({ previous: 'sheet', next: null });
    expect(neighbours(graph, 'gone')).toEqual({ previous: null, next: null });
  });

  it('follows run order, not where the cards sit', () => {
    const graph = report();
    // Move the last step to the far left: it still comes last.
    graph.nodes = graph.nodes.map((node) =>
      node.key === 'slack' ? { ...node, position: { x: -2000, y: -2000 } } : node,
    );
    expect(walkOrder(graph).at(-1)).toBe('slack');
  });

  it('keeps steps that are not connected, after the connected ones', () => {
    const graph = report();
    graph.edges = graph.edges.filter((edge) => edge.target !== 'slack');
    expect(walkOrder(graph)).toHaveLength(4);
  });
});

describe('buildScope', () => {
  it('uses samples, then pinned data where the browser has it', () => {
    const graph = report();
    const plain = buildScope(graph, []);
    expect(plain.scopeSource.fields).toEqual({ kind: 'sample' });
    expect(resolveValue('trigger.post.url', plain.scope)).toBeDefined();

    const pinned = buildScope(graph, [
      { nodeKey: 'fields', pinnedAt: '2026-11-03T09:00:00Z', output: { channel: 'Pinned Place' } },
      { nodeKey: 'published', pinnedAt: '2026-11-03T09:00:00Z', output: { post: { url: 'x' } } },
      { nodeKey: 'sheet', pinnedAt: '2026-11-03T09:00:00Z' },
    ]);
    expect(resolveValue('nodes.fields.output.channel', pinned.scope)).toBe('Pinned Place');
    expect(resolveValue('trigger.post.url', pinned.scope)).toBe('x');
    expect(pinned.scopeSource.fields).toEqual({ kind: 'pinned', at: '2026-11-03T09:00:00Z' });
    expect(pinned.scopeSource.trigger).toEqual({ kind: 'pinned', at: '2026-11-03T09:00:00Z' });
    // Pinned on the server only: the browser has no data for it, so the sample stays.
    expect(pinned.scopeSource.sheet).toEqual({ kind: 'sample' });
  });
});

describe('words', () => {
  it('labels the source of the data', () => {
    expect(sourceLabel({ kind: 'sample' })).toBe('Sample');
    expect(sourceLabel({ kind: 'pinned', at: '2026-11-03T09:00:00Z' })).toBe('Pinned');
    expect(sourceLabel({ kind: 'lastTest', at: '2026-11-03T14:02:00Z' })).toMatch(/^Last Test /);
  });

  it('says values in plain words, never braces', () => {
    expect(valueWords(true)).toBe('Yes');
    expect(valueWords('')).toBe('Empty');
    expect(valueWords([1, 2, 3])).toBe('3 items');
    expect(valueWords({ a: 1 })).toBe('1 field');
    expect(valueWords('x'.repeat(100), 10)).toHaveLength(10);
  });

  it('flattens a field tree parents first', () => {
    const rows = flattenFields([
      {
        path: 'trigger.post',
        label: 'Post',
        type: 'object',
        children: [
          { path: 'trigger.post.url', label: 'Post Link', type: 'text', sample: 'x', children: [] },
        ],
      },
    ]);
    expect(rows.map((row) => [row.label, row.depth])).toEqual([
      ['Post', 0],
      ['Post Link', 1],
    ]);
  });
});
