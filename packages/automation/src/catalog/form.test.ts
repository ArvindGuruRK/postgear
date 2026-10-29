import {
  ZodArray,
  ZodBoolean,
  ZodDefault,
  ZodEffects,
  ZodNullable,
  ZodNumber,
  ZodObject,
  ZodOptional,
  ZodString,
  type ZodTypeAny,
} from 'zod';
import { emptyConditionGroup } from '../conditions/schema';
import type { GraphNode } from '../graph/schema';
import { graphOf, line, step } from '../testing/builders';
import { validateGraph } from '../validate/validate-graph';
import {
  configErrors,
  FIELD_KINDS,
  type FieldSpec,
  FORM_TABS,
  fieldSpecFor,
  isFieldShown,
  tabComplete,
  tabForField,
} from './form';
import { getDefinition, NODE_CATALOG } from './index';
import type { NodeDefinition, NodeType } from './types';

/** The module's P0 table: every one of these has a panel. */
const PANEL_TYPES: NodeType[] = [
  'trigger.postPublished',
  'trigger.postFailed',
  'trigger.schedule',
  'trigger.manual',
  'logic.ifElse',
  'logic.switch',
  'logic.filter',
  'logic.delay',
  'logic.manualReview',
  'logic.setFields',
  'notify.inApp',
  'notify.slack',
  'ai.generateText',
  'postgear.createDraft',
];

function unwrap(schema: ZodTypeAny): ZodTypeAny {
  let current = schema;
  for (;;) {
    if (current instanceof ZodEffects) current = current.innerType();
    else if (current instanceof ZodOptional || current instanceof ZodNullable)
      current = current.unwrap();
    else if (current instanceof ZodDefault) current = current._def.innerType;
    else return current;
  }
}

/** The schema at a dotted config path, walking objects and list items (`fields.0.name`). */
function schemaAt(root: ZodTypeAny, path: string): ZodTypeAny | undefined {
  let current = unwrap(root);
  if (path === '') return current;
  for (const part of path.split('.')) {
    if (current instanceof ZodObject) {
      const next = (current.shape as Record<string, ZodTypeAny>)[part];
      if (!next) return undefined;
      current = unwrap(next);
    } else if (current instanceof ZodArray && /^\d+$/.test(part)) {
      current = unwrap(current.element);
    } else {
      return undefined;
    }
  }
  return current;
}

const withForms = NODE_CATALOG.filter((def) => def.status === 'ready' && def.form);

function specsOf(def: NodeDefinition): { tab: string; spec: FieldSpec }[] {
  if (!def.form) return [];
  return FORM_TABS.flatMap((tab) => def.form?.tabs[tab].map((spec) => ({ tab, spec })) ?? []);
}

describe('step forms', () => {
  it('give every step of the P0 table a panel', () => {
    for (const type of PANEL_TYPES) expect(getDefinition(type)?.form).toBeDefined();
    expect(withForms.map((def) => def.type).sort()).toEqual([...PANEL_TYPES].sort());
  });

  describe.each(withForms.map((def) => [def.type, def] as const))('%s', (_type, def) => {
    const fields = specsOf(def);
    const schema = def.configSchema as unknown as ZodTypeAny;

    it('only names config paths its schema has', () => {
      for (const { spec } of fields) {
        expect(FIELD_KINDS).toContain(spec.kind);
        expect({ path: spec.path, found: schemaAt(schema, spec.path) !== undefined }).toEqual({
          path: spec.path,
          found: true,
        });
        if (spec.showIf) expect(schemaAt(schema, spec.showIf.path)).toBeDefined();
        if (spec.unitPath) expect(schemaAt(schema, spec.unitPath)).toBeDefined();
        if (spec.row) {
          for (const part of [spec.row.key, spec.row.value, spec.row.type]) {
            if (part) expect(schemaAt(schema, `${spec.path}.0.${part}`)).toBeDefined();
          }
        }
      }
    });

    it('uses a control that fits each field', () => {
      for (const { spec } of fields) {
        const at = schemaAt(schema, spec.path) as ZodTypeAny;
        switch (spec.kind) {
          case 'text':
          case 'longText':
          case 'connection':
            expect(at).toBeInstanceOf(ZodString);
            break;
          case 'toggle':
            expect(at).toBeInstanceOf(ZodBoolean);
            break;
          case 'number':
          case 'duration':
            expect(at).toBeInstanceOf(ZodNumber);
            break;
          case 'channels':
          case 'tags':
          case 'multiSelect':
          case 'keyValue':
          case 'recipients':
          case 'manualInputs':
          case 'cases':
            expect(at).toBeInstanceOf(ZodArray);
            break;
          case 'condition':
            expect(at.safeParse(emptyConditionGroup()).success).toBe(true);
            break;
          case 'schedule':
            expect(spec.path).toBe('');
            break;
          case 'select':
            break;
        }
      }
    });

    it('offers only choices the schema accepts', () => {
      for (const { spec } of fields) {
        if (!spec.options) continue;
        const target =
          spec.kind === 'multiSelect'
            ? schemaAt(schema, `${spec.path}.0`)
            : spec.kind === 'keyValue' && spec.row?.type
              ? schemaAt(schema, `${spec.path}.0.${spec.row.type}`)
              : spec.kind === 'duration' && spec.unitPath
                ? schemaAt(schema, spec.unitPath)
                : schemaAt(schema, spec.path);
        expect(target).toBeDefined();
        for (const option of spec.options) {
          expect({ value: option.value, ok: target?.safeParse(option.value).success }).toEqual({
            value: option.value,
            ok: true,
          });
        }
      }
    });

    it('has a field for every required path and for its connection', () => {
      for (const required of def.required ?? []) {
        expect({ path: required.path, found: fieldSpecFor(def, required.path) }).toEqual({
          path: required.path,
          found: expect.anything(),
        });
      }
      if (def.connection) {
        expect(fieldSpecFor(def, def.connection.field)?.tab).toBe('setup');
        expect(tabForField(def, def.connection.field)).toBe('setup');
      }
    });

    it('writes labels in sentence case and placeholders as "Enter your ..."', () => {
      for (const { spec } of fields) {
        expect(spec.label[0]).toBe(spec.label[0].toUpperCase());
        // Sentence case: no word after the first starts with a capital, names aside.
        const later = spec.label.split(' ').slice(1);
        for (const word of later) {
          if (['Slack', 'True', 'Run', 'Now'].includes(word)) continue;
          expect({ label: spec.label, word, lower: word === word.toLowerCase() }).toEqual({
            label: spec.label,
            word,
            lower: true,
          });
        }
        if (spec.placeholder) expect(spec.placeholder.startsWith('Enter your ')).toBe(true);
      }
    });
  });
});

describe('tabForField', () => {
  const slack = getDefinition('notify.slack') as NodeDefinition;
  const paths = getDefinition('logic.switch') as NodeDefinition;
  const draft = getDefinition('postgear.createDraft') as NodeDefinition;
  const schedule = getDefinition('trigger.schedule') as NodeDefinition;

  it('finds the tab of a field and of anything inside it', () => {
    expect(tabForField(slack, 'connectionId')).toBe('setup');
    expect(tabForField(slack, 'message')).toBe('configure');
    expect(tabForField(paths, 'cases.1.condition.rules.0.left')).toBe('configure');
    expect(fieldSpecFor(paths, 'cases.1.condition.rules.0.left')?.spec.path).toBe('cases');
    expect(tabForField(draft, 'channels')).toBe('setup');
    expect(tabForField(draft, 'text')).toBe('configure');
    expect(fieldSpecFor(schedule, 'everyHours')?.spec.kind).toBe('schedule');
  });

  it('sends step settings and the name to their own places', () => {
    expect(tabForField(slack, 'onError')).toBe('settings');
    expect(tabForField(slack, 'disabled')).toBe('settings');
    expect(tabForField(slack, 'name')).toBe('name');
  });

  it('falls back sensibly for steps without a form', () => {
    const teams = getDefinition('notify.teams') as NodeDefinition;
    const publish = getDefinition('postgear.publish') as NodeDefinition;
    expect(teams.form).toBeUndefined();
    expect(tabForField(teams, 'connectionId')).toBe('setup');
    expect(tabForField(teams, 'message')).toBe('configure');
    expect(tabForField(publish, 'channels')).toBe('setup');
    expect(tabForField(publish, undefined)).toBe('configure');
    expect(tabForField(slack, undefined)).toBe('setup');
  });
});

/** Configs that make the validators complain about as many fields as they can. */
function brokenConfigs(type: NodeType): Record<string, unknown>[] {
  const def = getDefinition(type) as NodeDefinition;
  const defaults = JSON.parse(JSON.stringify(def.defaultConfig)) as Record<string, unknown>;
  // Every field of the wrong kind, one at a time, and an unknown chip in every text.
  const wrongType = Object.keys(defaults).map((key) => ({ ...defaults, [key]: { wrong: true } }));
  const unknownChips = Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [
      key,
      typeof value === 'string' ? '{{ nodes.gone.output.text }}' : value,
    ]),
  );
  const rules = {
    match: 'all',
    rules: [
      { id: 'a', left: '', operator: 'is', right: 'x' },
      { id: 'b', left: '{{ trigger.post.url }}', operator: 'is', right: '' },
      { id: 'c', left: '{{ trigger.post.url }}', operator: 'greaterThan', right: 'ten' },
      { id: 'd', left: '{{ trigger.publishedAt }}', operator: 'before', right: 'soon' },
      { id: 'e', left: '{{ nodes.gone.output.x }}', operator: 'isEmpty' },
      { id: 'f', left: '{{ trigger.tags }}', operator: 'hasMoreThan', right: 'x' },
    ],
  };
  const extra: Record<string, unknown>[] = [];
  switch (type) {
    case 'logic.ifElse':
    case 'logic.filter':
      extra.push({ condition: rules }, { condition: { match: 'all', rules: [] } });
      break;
    case 'logic.switch':
      extra.push({
        cases: [
          { id: 'a', name: '', condition: rules },
          { id: 'a', name: 'Two', condition: { match: 'any', rules: [] } },
        ],
      });
      break;
    case 'logic.setFields':
      extra.push({
        fields: [
          { name: '1bad', type: 'text', value: '{{ nodes.gone.output.x }}' },
          { name: 'same', type: 'text', value: '' },
          { name: 'same', type: 'oops', value: '' },
        ],
      });
      break;
    case 'trigger.manual':
      extra.push({
        fields: [
          { key: 'Bad Key', label: '', type: 'text' },
          { key: 'pick', label: 'Pick', type: 'choice' },
          { key: 'pick', label: 'Again', type: 'text' },
        ],
      });
      break;
    case 'logic.delay':
      extra.push(
        { ...defaults, amount: 99, unit: 'days' },
        { ...defaults, amount: 0 },
        { ...defaults, mode: 'until', until: '' },
      );
      break;
    case 'trigger.schedule':
      extra.push(
        { frequency: 'hourly', timeZone: 'UTC' },
        { frequency: 'hourly', everyHours: 5, timeZone: 'UTC' },
        { frequency: 'weekly', days: [], timeZone: 'Bad zone' },
        { frequency: 'monthly', time: '25:00', timeZone: 'UTC' },
        { frequency: 'monthly', dayOfMonth: 40, time: '09:00', timeZone: 'UTC' },
      );
      break;
    case 'trigger.postFailed':
      extra.push({ channels: ['gone'], reasons: ['nope'] });
      break;
    case 'trigger.postPublished':
      extra.push({ channels: ['gone'], tags: [''] });
      break;
    case 'notify.slack':
      extra.push({ ...defaults, connectionId: 'conn_gone' });
      break;
    case 'postgear.createDraft':
      extra.push({ ...defaults, channels: ['gone'], parts: 'many' });
      break;
  }
  return [defaults, ...wrongType, unknownChips, ...extra];
}

/** A one-step graph (a trigger) or the trigger followed by the step. */
function graphWith(node: GraphNode) {
  if (node.type.startsWith('trigger.')) return graphOf([node]);
  const trigger = step('start', 'trigger.postPublished');
  return graphOf([trigger, node], [line('start', node.key)]);
}

describe('focus-the-field', () => {
  const context = { connections: [], channels: [] };

  it.each(PANEL_TYPES)('resolves every issue field %s can have', (type) => {
    const def = getDefinition(type) as NodeDefinition;
    const seen = new Set<string>();
    for (const config of brokenConfigs(type)) {
      const node = step('target', type, { config });
      const issues = validateGraph(graphWith(node), context).filter(
        (issue) => issue.nodeKey === 'target' && issue.field !== undefined,
      );
      for (const issue of issues) {
        const field = issue.field as string;
        seen.add(`${issue.code} ${field}`);
        const place = tabForField(def, field);
        if (place === 'settings' || place === 'name') continue;
        expect({ code: issue.code, field, spec: fieldSpecFor(def, field) !== undefined }).toEqual({
          code: issue.code,
          field,
          spec: true,
        });
      }
    }
    // The broken configs really did reach the validators.
    expect(seen.size).toBeGreaterThan(0);
  });

  it('covers the AI schedule rule and duplicate names', () => {
    const schedule = getDefinition('trigger.schedule') as NodeDefinition;
    const graph = graphOf(
      [
        step('tick', 'trigger.schedule', {
          config: { frequency: 'hourly', everyHours: 1, timeZone: 'UTC' },
        }),
        step('a', 'ai.generateText', { name: 'Same', config: { prompt: 'Hi' } }),
        step('b', 'notify.inApp', { name: 'Same', config: { title: 'Hi' } }),
      ],
      [line('tick', 'a'), line('a', 'b')],
    );
    const issues = validateGraph(graph, context);
    for (const issue of issues) {
      if (!issue.field || !issue.nodeKey) continue;
      const node = graph.nodes.find((candidate) => candidate.key === issue.nodeKey);
      const def = getDefinition(node?.type ?? '') as NodeDefinition;
      const place = tabForField(def, issue.field);
      if (place === 'name' || place === 'settings') continue;
      expect(fieldSpecFor(def, issue.field)).toBeDefined();
    }
    expect(tabForField(schedule, 'everyHours')).toBe('configure');
  });
});

describe('form helpers', () => {
  const delay = getDefinition('logic.delay') as NodeDefinition;
  const slack = getDefinition('notify.slack') as NodeDefinition;
  const until = delay.form?.tabs.configure.find((spec) => spec.path === 'until') as FieldSpec;

  it('shows a field only while its showIf holds', () => {
    expect(isFieldShown(until, { mode: 'for' })).toBe(false);
    expect(isFieldShown(until, { mode: 'until' })).toBe(true);
    expect(isFieldShown({ path: 'x', kind: 'text', label: 'X' }, {})).toBe(true);
  });

  it('ticks a tab once its required fields are filled', () => {
    expect(tabComplete(slack, 'setup', { connectionId: '' })).toBe(false);
    expect(tabComplete(slack, 'setup', { connectionId: 'conn_1' })).toBe(true);
    expect(tabComplete(slack, 'configure', { message: '' })).toBe(false);
    expect(tabComplete(slack, 'configure', { message: 'Hi' })).toBe(true);
    expect(tabComplete(delay, 'configure', { mode: 'for', until: '' })).toBe(true);
    expect(tabComplete(delay, 'configure', { mode: 'until', until: '' })).toBe(false);
  });

  it('gives schema problems in plain words, by path', () => {
    expect(configErrors(delay, delay.defaultConfig)).toEqual({});
    expect(configErrors(delay, { ...delay.defaultConfig, amount: 40, unit: 'days' })).toEqual({
      amount: 'A delay can be at most 30 days.',
    });
    const manual = getDefinition('trigger.manual') as NodeDefinition;
    expect(configErrors(manual, { fields: [{ key: 'Bad', label: 'A', type: 'text' }] })).toEqual({
      'fields.0.key': 'Use letters, numbers and _ only.',
    });
    expect(configErrors(slack, { ...slack.defaultConfig, message: 5 })).toEqual({
      message: 'This value is not valid here.',
    });
  });
});
