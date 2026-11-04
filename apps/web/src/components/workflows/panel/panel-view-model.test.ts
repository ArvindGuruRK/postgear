import {
  type AutomationGraph,
  getTemplate,
  instantiateTemplate,
  resolveValue,
} from '@postgear/automation';
import type { RunStep } from '@/types/workflows';
import {
  buildScope,
  childrenOf,
  connectedSteps,
  checkPinnedShape,
  copyDetailsText,
  dryRunContent,
  humanValue,
  isEmptyValue,
  recordTable,
  inputSourceLine,
  liveEffectSentence,
  locateDataError,
  parsePinnedText,
  receivedWebhookData,
  runsDryInTests,
  type StepRunResult,
  skippedSentence,
  sourceLabel,
  valueTree,
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
    const names = (nodes: { key: string }[]) => nodes.map((node) => node.key);
    const sheet = connectedSteps(graph, 'sheet');
    expect(names(sheet.previous)).toEqual(['fields']);
    expect(names(sheet.next)).toEqual(['slack']);
    expect(connectedSteps(graph, 'published').previous).toEqual([]);
    expect(connectedSteps(graph, 'slack').next).toEqual([]);
    expect(connectedSteps(graph, 'gone')).toEqual({ previous: [], next: [] });
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
});

function result(nodeKey: string, status: RunStep['status'], output: unknown): StepRunResult {
  return {
    runId: 'run-1',
    at: '2026-11-03T14:02:00Z',
    live: false,
    step: {
      id: `${nodeKey}-1`,
      nodeKey,
      nodeType: 'logic.setFields',
      nodeName: nodeKey,
      status,
      attempt: 1,
      attempts: 1,
      input: null,
      output,
      truncated: false,
      error: null,
      ports: ['out'],
      startedAt: '2026-11-03T14:01:59Z',
      finishedAt: '2026-11-03T14:02:00Z',
      durationMs: 900,
      updatedAt: '2026-11-03T14:02:00Z',
    },
  };
}

describe('buildScope with the last test (Module 08)', () => {
  it('uses the last test where nothing is pinned, and pinned data over it', () => {
    const graph = report();
    const lastTest = {
      fields: result('fields', 'SUCCEEDED', { channel: 'From The Test' }),
      published: result('published', 'SUCCEEDED', { post: { url: 'tested' } }),
      sheet: result('sheet', 'FAILED', null),
    };
    const tested = buildScope(graph, [], undefined, lastTest);
    expect(resolveValue('nodes.fields.output.channel', tested.scope)).toBe('From The Test');
    expect(resolveValue('trigger.post.url', tested.scope)).toBe('tested');
    expect(tested.scopeSource.fields).toEqual({ kind: 'lastTest', at: '2026-11-03T14:02:00Z' });
    expect(tested.scopeSource.trigger).toEqual({ kind: 'lastTest', at: '2026-11-03T14:02:00Z' });
    // A failed step hands nothing on: its sample stays.
    expect(tested.scopeSource.sheet).toEqual({ kind: 'sample' });

    const pinned = buildScope(
      graph,
      [{ nodeKey: 'fields', pinnedAt: '2026-11-03T09:00:00Z', output: { channel: 'Pinned' } }],
      undefined,
      lastTest,
    );
    expect(resolveValue('nodes.fields.output.channel', pinned.scope)).toBe('Pinned');
    expect(pinned.scopeSource.fields).toEqual({ kind: 'pinned', at: '2026-11-03T09:00:00Z' });
  });
});

describe('the Test tab words', () => {
  it('says where Test Step takes its input from', () => {
    const graph = report();
    const slack = graph.nodes.find((node) => node.type === 'notify.slack');
    const fields = graph.nodes.find((node) => node.key === 'fields');
    if (!slack || !fields) throw new Error('template changed');
    const parent = graph.edges.find((edge) => edge.target === slack.key)?.source ?? '';
    const parentName = graph.nodes.find((node) => node.key === parent)?.name;

    expect(inputSourceLine(graph, slack.key, {})).toBe(`Using: sample data from ${parentName}.`);
    expect(
      inputSourceLine(graph, slack.key, { [parent]: { kind: 'pinned', at: '2026-11-03' } }),
    ).toBe(`Using: pinned data from ${parentName}.`);
    expect(
      inputSourceLine(graph, slack.key, { [parent]: { kind: 'lastTest', at: '2026-11-03' } }),
    ).toBe(`Using: the last test's data from ${parentName}.`);
    expect(inputSourceLine(graph, 'published', { published: { kind: 'pinned', at: 'x' } })).toBe(
      'Using: the data pinned on this trigger.',
    );
    expect(inputSourceLine(graph, 'missing', {})).toBeNull();
  });

  it('knows which steps run dry and what sending for real does', () => {
    expect(runsDryInTests({ type: 'notify.slack', typeVersion: 1 })).toBe(true);
    expect(runsDryInTests({ type: 'notify.inApp', typeVersion: 1 })).toBe(false);
    expect(runsDryInTests({ type: 'logic.setFields', typeVersion: 1 })).toBe(false);
    expect(liveEffectSentence({ type: 'notify.slack', typeVersion: 1 })).toBe(
      'This test will really send a Slack message.',
    );
    expect(liveEffectSentence({ type: 'data.httpRequest', typeVersion: 1 })).toBe(
      'This test will really send the request.',
    );
  });

  it('reads a dry run and a skip in plain words', () => {
    expect(dryRunContent({ dryRun: true, wouldSend: { text: 'New post', channel: 'x' } })).toEqual({
      text: 'New post',
      data: { text: 'New post', channel: 'x' },
    });
    expect(dryRunContent({ dryRun: true, wouldSend: 'Plain' })).toEqual({
      text: 'Plain',
      data: 'Plain',
    });
    expect(dryRunContent({ dryRun: true, wouldSend: { rows: [1] } }).text).toBeNull();
    expect(skippedSentence({ skipped: 'branchNotTaken' })).toBe(
      'Skipped: its branch was not taken in this run.',
    );
    expect(skippedSentence({ skipped: 'off' })).toBe('Skipped: this step is turned off.');
    expect(skippedSentence(null)).toBe('Skipped in this run.');
  });

  it('copies the details someone needs to get help', () => {
    const failed = result('slack', 'FAILED', null).step;
    expect(
      copyDetailsText({
        workflowName: 'Publishing Report',
        runId: 'run-1',
        step: {
          ...failed,
          nodeName: 'Slack',
          error: { message: 'The link was refused.', code: 'http_404', retryable: false },
        },
      }),
    ).toBe(
      [
        'Workflow: Publishing Report',
        'Run: run-1',
        'Step: Slack',
        'Error code: http_404',
        'Time: 2026-11-03T14:02:00Z',
        'Error: The link was refused.',
      ].join('\n'),
    );
  });
});

describe('buildScope with a Webhook sample (Module 13)', () => {
  function blog(): AutomationGraph {
    const template = getTemplate('blog-to-draft');
    if (!template) throw new Error('missing template');
    return instantiateTemplate(template, (key) => key);
  }

  it('uses the last data received over the built-in sample, as test runs do', () => {
    const received = receivedWebhookData({
      sample: { title: 'Real' },
      sampleAt: '2026-11-03T09:00:00Z',
    });
    expect(received).toEqual({
      body: { title: 'Real' },
      receivedAt: '2026-11-03T09:00:00Z',
      headers: { contentType: 'application/json' },
    });
    const { scope } = buildScope(blog(), [], undefined, {}, received);
    expect(resolveValue('trigger.body.title', scope)).toBe('Real');
    // Pinned data still wins.
    const pinned = buildScope(
      blog(),
      [
        {
          nodeKey: 'blog',
          pinnedAt: '2026-11-03T09:00:00Z',
          output: { body: { title: 'Pinned' } },
        },
      ],
      undefined,
      {},
      received,
    );
    expect(resolveValue('trigger.body.title', pinned.scope)).toBe('Pinned');
  });

  it('ignores nothing received, a list, and other triggers', () => {
    expect(receivedWebhookData({ sample: null, sampleAt: null })).toBeUndefined();
    expect(receivedWebhookData({ sample: [1, 2], sampleAt: null })).toBeUndefined();
    const { scope } = buildScope(report(), [], undefined, {}, { body: { title: 'x' } });
    expect(resolveValue('trigger.body', scope)).toBeUndefined();
  });
});

describe('humanValue', () => {
  it('writes a date the way a person would, not as a timestamp', () => {
    const words = humanValue('2026-11-03T12:30:00.000Z');
    expect(words).toMatch(/Nov/);
    expect(words).not.toContain('T12');
    expect(words).not.toContain('Z');
  });

  it('leaves a string that only starts like a date, or is not one, alone', () => {
    expect(humanValue('2026-13-45T99:99:00')).toBe('2026-13-45T99:99:00');
    expect(humanValue('Fresh sourdough')).toBe('Fresh sourdough');
  });

  it('separates big numbers but not years or small counts', () => {
    expect(humanValue(2026)).toBe('2026');
    expect(humanValue(7)).toBe('7');
    expect(humanValue(1250000)).toBe((1250000).toLocaleString());
  });

  it('spells out a short list of plain values and counts anything longer', () => {
    expect(humanValue(['a', 'b', 'c'])).toBe('a, b, c');
    expect(humanValue(['a', 'b', 'c', 'd'])).toBe('4 items');
    expect(humanValue([{ a: 1 }])).toBe('1 item');
    expect(humanValue([])).toBe('0 items');
  });

  it('keeps the words valueWords uses for the rest', () => {
    expect(humanValue(true)).toBe('Yes');
    expect(humanValue(null)).toBe('Empty');
    expect(humanValue({ a: 1, b: 2 })).toBe('2 fields');
  });

  it('knows what counts as empty', () => {
    expect(isEmptyValue('')).toBe(true);
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue(false)).toBe(false);
  });
});

describe('childrenOf', () => {
  const field = (type: 'object' | 'media' | 'list' | 'text', sample: unknown) => ({
    path: 'trigger.image',
    label: 'Image',
    type,
    sample,
    children: [],
  });

  it('opens a group that declares no children from what its value holds', () => {
    const children = childrenOf(field('media', { url: 'https://a.test', alt: 'Bread' }));
    expect(children.map((child) => [child.path, child.label])).toEqual([
      ['trigger.image.url', 'URL'],
      ['trigger.image.alt', 'Alt'],
    ]);
  });

  it('prefers the children a step declares', () => {
    const declared = { ...field('text', 'x'), path: 'trigger.image.url', label: 'Link' };
    expect(childrenOf({ ...field('object', { url: 'x' }), children: [declared] })).toEqual([
      declared,
    ]);
  });

  it('leaves a plain value and an empty group closed', () => {
    expect(childrenOf(field('text', 'Bread'))).toEqual([]);
    expect(childrenOf(field('object', {}))).toEqual([]);
    expect(childrenOf(field('list', []))).toEqual([]);
  });
});

describe('recordTable', () => {
  it('turns a list of records into columns, in first-seen order', () => {
    const table = recordTable(
      valueTree(
        [
          { title: 'One', post_url: 'https://a.test' },
          { title: 'Two', extra: 3 },
        ],
        [],
      ),
    );
    expect(table?.columns).toEqual([
      { key: 'title', label: 'Title' },
      { key: 'post_url', label: 'Post URL' },
      { key: 'extra', label: 'Extra' },
    ]);
    expect(table?.rows.map((row) => row.cells.title)).toEqual(['One', 'Two']);
    expect(table?.rows[1].cells.post_url).toBeUndefined();
  });

  it('finds a list nested inside a record', () => {
    const [rows] = valueTree({ rows: [{ a: 1 }, { a: 2 }] }, []);
    expect(recordTable(rows.children)?.rows).toHaveLength(2);
  });

  it('leaves a single record, a list of plain values and mixed lists as rows', () => {
    expect(recordTable(valueTree({ a: 1, b: 2 }, []))).toBeNull();
    expect(recordTable(valueTree(['a', 'b'], []))).toBeNull();
    expect(recordTable(valueTree([{ a: 1 }, 'b'], []))).toBeNull();
    expect(recordTable(valueTree([{}], []))).toBeNull();
    expect(recordTable([])).toBeNull();
  });
});
