/**
 * Module 13's catalog pieces: the Google Sheets and HTTP Request forms, the
 * Webhook trigger's form and output, the secret-header rule, JSON mode in
 * the resolver, and the two templates that use these steps validating once
 * a (simulated) Google connection is picked.
 */
import { getTemplate } from '../templates';
import { graphOf, line, READY_CONTEXT, step } from '../testing/builders';
import { resolveTemplate } from '../tokens/resolve';
import type { ValidationContext } from '../validate/types';
import { validateGraph } from '../validate/validate-graph';
import { SECRET_HEADER_MESSAGE } from './data';
import { fieldSpecFor, isFieldShown } from './form';
import { getDefinition, outputFieldsOf } from './index';
import type { NodeDefinition } from './types';

const sheets = getDefinition('data.googleSheetsAppendRow') as NodeDefinition;
const http = getDefinition('data.httpRequest') as NodeDefinition;
const webhook = getDefinition('trigger.webhook') as NodeDefinition;

const SIMULATED_GOOGLE: ValidationContext = {
  ...READY_CONTEXT,
  connections: [
    ...READY_CONTEXT.connections,
    { id: 'conn_google', kind: 'google', name: 'Simulated Google', status: 'CONNECTED' },
  ],
};

describe('Google Sheets form', () => {
  it('puts the account, spreadsheet and tab on Setup, the columns on Configure', () => {
    expect(fieldSpecFor(sheets, 'connectionId')).toMatchObject({
      tab: 'setup',
      spec: { kind: 'connection' },
    });
    expect(fieldSpecFor(sheets, 'spreadsheet')).toMatchObject({
      tab: 'setup',
      spec: { kind: 'spreadsheet' },
    });
    expect(fieldSpecFor(sheets, 'sheet')).toMatchObject({
      tab: 'setup',
      spec: { kind: 'sheetTab' },
    });
    expect(fieldSpecFor(sheets, 'columns.3.value')).toMatchObject({
      tab: 'configure',
      spec: { kind: 'sheetColumns', path: 'columns' },
    });
  });

  it('says in plain words which spreadsheets PostGear can open', () => {
    const notes = sheets.form?.notes?.join(' ') ?? '';
    expect(notes).toContain('only open spreadsheets you pick');
    expect(notes).toContain('PostGear created');
    expect(notes).not.toMatch(/drive\.file|scope|payload/i);
  });
});

describe('HTTP Request form', () => {
  it('has every field the step needs', () => {
    expect(fieldSpecFor(http, 'method')?.spec.kind).toBe('select');
    expect(fieldSpecFor(http, 'url')?.spec).toMatchObject({ kind: 'text', acceptsData: true });
    expect(fieldSpecFor(http, 'headers.0.value')?.spec.kind).toBe('keyValue');
    expect(fieldSpecFor(http, 'secretHeadersConnectionId')).toMatchObject({
      tab: 'setup',
      spec: { kind: 'connection' },
    });
    expect(fieldSpecFor(http, 'bodyType')?.spec.kind).toBe('select');
    expect(fieldSpecFor(http, 'responseType')?.spec.kind).toBe('select');
  });

  it('shows the body for every body type except none', () => {
    const bodies = http.form?.tabs.configure.filter((spec) => spec.path === 'body') ?? [];
    for (const bodyType of ['json', 'form', 'text']) {
      const shown = bodies.filter((spec) => isFieldShown(spec, { bodyType }));
      expect(shown).toHaveLength(1);
      expect(shown[0]).toMatchObject({ kind: 'longText', acceptsData: true });
    }
    expect(bodies.filter((spec) => isFieldShown(spec, { bodyType: 'none' }))).toEqual([]);
  });
});

describe('Webhook trigger', () => {
  it('shows its link through a webhookLink field that edits no setting', () => {
    expect(webhook.form?.tabs.configure).toEqual([
      { path: '', kind: 'webhookLink', label: 'Private link' },
    ]);
  });

  it('gives later steps the body, the time and the content type', () => {
    const node = step('hook', 'trigger.webhook');
    const paths = outputFieldsOf(node).map((field) => field.path);
    expect(paths).toEqual(
      expect.arrayContaining(['body', 'receivedAt', 'headers', 'headers.contentType']),
    );
  });
});

describe('secret-looking plain headers', () => {
  function issuesFor(headers: { name: string; value: string }[]) {
    const graph = graphOf(
      [
        step('start', 'trigger.manual'),
        step('call', 'data.httpRequest', {
          config: { url: 'https://api.example.com/hooks', headers },
        }),
      ],
      [line('start', 'call')],
    );
    return validateGraph(graph, READY_CONTEXT).filter((issue) => issue.nodeKey === 'call');
  }

  it.each(['Authorization', 'X-Api-Key', 'api-key', 'X-Auth-Token', 'Cookie'])(
    'refuses %s as a plain header, with the field to fix',
    (name) => {
      expect(issuesFor([{ name, value: '{{ trigger.inputs.key }}' }])).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          code: 'node.config_invalid',
          field: 'headers.0.name',
          message: SECRET_HEADER_MESSAGE,
        }),
      );
    },
  );

  it('accepts ordinary headers', () => {
    const issues = issuesFor([
      { name: 'X-Request-Source', value: 'PostGear' },
      { name: 'Accept', value: 'application/json' },
    ]);
    expect(issues.filter((issue) => issue.code === 'node.config_invalid')).toEqual([]);
  });

  it('points the issue at the Headers field', () => {
    expect(fieldSpecFor(http, 'headers.0.name')?.spec.path).toBe('headers');
  });
});

describe('JSON mode', () => {
  const scope = {
    trigger: {
      body: {
        title: 'Say "hello" \\ goodbye\nnow',
        count: 3,
        tags: ['a', 'b'],
        nested: { ok: true },
      },
    },
  };

  it('escapes a chip inside a JSON string, so quotes keep the body valid', () => {
    const { value } = resolveTemplate('{"title": "New: {{ trigger.body.title }}"}', scope, {
      json: true,
    });
    expect(JSON.parse(value as string)).toEqual({
      title: 'New: Say "hello" \\ goodbye\nnow',
    });
  });

  it('writes a chip outside a string as a JSON value', () => {
    const { value } = resolveTemplate(
      '{"count": {{ trigger.body.count }}, "tags": {{ trigger.body.tags }}, "nested": {{ trigger.body.nested }}, "title": {{ trigger.body.title }}}',
      scope,
      { json: true },
    );
    expect(JSON.parse(value as string)).toEqual({
      count: 3,
      tags: ['a', 'b'],
      nested: { ok: true },
      title: 'Say "hello" \\ goodbye\nnow',
    });
  });

  it('keeps escaped quotes in the typed text from confusing it', () => {
    const { value } = resolveTemplate('{"a": "x\\"y", "b": "{{ trigger.body.title }}"}', scope, {
      json: true,
    });
    expect(JSON.parse(value as string).b).toBe('Say "hello" \\ goodbye\nnow');
  });

  it('a whole-body chip is the value as JSON, and missing data is listed', () => {
    expect(resolveTemplate('{{ trigger.body }}', scope, { json: true }).value).toBe(
      JSON.stringify(scope.trigger.body),
    );
    const missing = resolveTemplate('{"x": "{{ trigger.gone }}"}', scope, { json: true });
    expect(missing.value).toBe('{"x": ""}');
    expect(missing.missing).toEqual(['trigger.gone']);
  });

  it('leaves text mode as it was', () => {
    expect(resolveTemplate('{{ trigger.body.count }}', scope).value).toBe(3);
  });
});

describe('templates with a simulated Google connection', () => {
  it('Publishing Report validates once the simulated account and a sheet are picked', () => {
    const template = getTemplate('publishing-report');
    if (!template) throw new Error('missing template');
    const graph = {
      ...template.graph,
      nodes: template.graph.nodes.map((node) => {
        if (node.type === 'data.googleSheetsAppendRow') {
          return {
            ...node,
            config: {
              ...node.config,
              connectionId: 'conn_google',
              spreadsheet: { id: 'simulated-social-report', name: 'Social Report' },
              sheet: { id: 0, title: 'Posts' },
            },
          };
        }
        if (node.type === 'notify.slack') {
          return { ...node, config: { ...node.config, connectionId: 'conn_slack' } };
        }
        return node;
      }),
    };
    expect(validateGraph(graph, SIMULATED_GOOGLE)).toEqual([]);
  });

  it('Blog To Draft validates once a channel is picked', () => {
    const template = getTemplate('blog-to-draft');
    if (!template) throw new Error('missing template');
    const graph = {
      ...template.graph,
      nodes: template.graph.nodes.map((node) =>
        node.type === 'postgear.createDraft'
          ? { ...node, config: { ...node.config, channels: ['ch_ig'] } }
          : node,
      ),
    };
    expect(validateGraph(graph, SIMULATED_GOOGLE)).toEqual([]);
  });
});
