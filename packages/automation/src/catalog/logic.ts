/**
 * Logic steps: branching, waiting, reshaping data. None of them leaves
 * PostGear. Delay and Manual Review are handled by the run workflow itself
 * (a durable timer and a signal), not by an activity.
 */
import { z } from 'zod';
import { conditionGroupSchema, emptyConditionGroup } from '../conditions/schema';
import { CASE_ID_PATTERN, type PortId } from '../graph/schema';
import { count, isBlank, OUT, templateField } from './fields';
import { defineNode, type OutputField, type PortSpec } from './types';

const LOGIC_BASICS = {
  typeVersion: 1,
  category: 'logic',
  family: 'blue',
  inputs: ['in'],
  sideEffect: 'none',
  retry: 'safe',
  timeoutClass: 'fast',
  canHandleErrors: true,
} as const;

function rulesWords(rules: number, match: 'all' | 'any'): string {
  if (rules === 0) return 'Add a rule';
  if (rules === 1) return 'Checks 1 rule';
  return match === 'all' ? `All of ${rules} rules must match` : `Any of ${rules} rules can match`;
}

const conditionConfig = z.object({ condition: conditionGroupSchema }).strict();

export const ifElse = defineNode({
  ...LOGIC_BASICS,
  type: 'logic.ifElse',
  title: 'If / Else',
  description: 'Goes one way when your rules match and the other way when they do not.',
  keywords: ['if', 'else', 'condition', 'branch', 'when', 'check'],
  icon: 'if-else',
  status: 'ready',
  priority: 'P0',
  outputs: [
    { id: 'true', label: 'True' },
    { id: 'false', label: 'False' },
  ],
  configSchema: conditionConfig,
  defaultConfig: { condition: emptyConditionGroup() },
  outputShape: [{ path: 'result', label: 'Result', type: 'boolean', sample: true }],
  canDisable: false,
  summary: (config) => rulesWords(config.condition.rules.length, config.condition.match),
});

const switchCaseSchema = z
  .object({
    id: z.string().regex(CASE_ID_PATTERN),
    name: z.string().trim().min(1, 'Name this path.').max(40),
    condition: conditionGroupSchema,
  })
  .strict();

const switchConfig = z
  .object({ cases: z.array(switchCaseSchema).min(1).max(10) })
  .strict()
  .superRefine((config, issue) => {
    const ids = new Set<string>();
    config.cases.forEach((pathCase, i) => {
      if (ids.has(pathCase.id)) {
        issue.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cases', i, 'id'],
          message: 'Two paths share the same id.',
        });
      }
      ids.add(pathCase.id);
    });
  });

/** Paths' ports from its raw config: one per case, then Otherwise. */
function switchPorts(config: Record<string, unknown>): PortSpec[] {
  const cases = Array.isArray(config.cases) ? config.cases : [];
  const seen = new Set<string>();
  const ports: PortSpec[] = [];
  for (const entry of cases) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, name } = entry as { id?: unknown; name?: unknown };
    if (typeof id !== 'string' || !CASE_ID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    const label = typeof name === 'string' && name.trim() ? name.trim() : 'Path';
    ports.push({ id: `case:${id}` as PortId, label });
  }
  ports.push({ id: 'fallback', label: 'Otherwise' });
  return ports;
}

export const switchPaths = defineNode({
  ...LOGIC_BASICS,
  type: 'logic.switch',
  title: 'Paths',
  description: 'Sends each run down the first path whose rules match, or Otherwise.',
  keywords: ['switch', 'router', 'route', 'case', 'branch', 'split'],
  icon: 'paths',
  status: 'ready',
  priority: 'P1',
  outputs: switchPorts,
  configSchema: switchConfig,
  defaultConfig: {
    cases: [
      { id: 'a', name: 'Path A', condition: emptyConditionGroup() },
      { id: 'b', name: 'Path B', condition: emptyConditionGroup() },
    ],
  },
  outputShape: [{ path: 'path', label: 'Chosen Path', type: 'text', sample: 'Path A' }],
  canDisable: false,
  summary: (config) => `${count(config.cases.length, 'path')} and Otherwise`,
});

export const filter = defineNode({
  ...LOGIC_BASICS,
  type: 'logic.filter',
  title: 'Filter',
  description: 'Only lets the run continue when your rules match.',
  keywords: ['filter', 'only', 'stop', 'condition', 'continue if'],
  icon: 'filter',
  status: 'ready',
  priority: 'P0',
  outputs: OUT,
  configSchema: conditionConfig,
  defaultConfig: { condition: emptyConditionGroup() },
  outputShape: [{ path: 'passed', label: 'Passed', type: 'boolean', sample: true }],
  canDisable: true,
  summary: (config) => rulesWords(config.condition.rules.length, config.condition.match),
});

const DELAY_MAX = { minutes: 30 * 24 * 60, hours: 30 * 24, days: 30 } as const;

const delayConfig = z
  .object({
    mode: z.enum(['for', 'until']),
    amount: z.number().int().min(1),
    unit: z.enum(['minutes', 'hours', 'days']),
    /** `until` only: a template or an ISO date and time. */
    until: templateField(200),
  })
  .strict()
  .superRefine((config, issue) => {
    if (config.mode === 'for' && config.amount > DELAY_MAX[config.unit]) {
      issue.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amount'],
        message: 'A delay can be at most 30 days.',
      });
    }
  });

export const delay = defineNode({
  ...LOGIC_BASICS,
  type: 'logic.delay',
  title: 'Delay',
  description: 'Waits for a while, or until a date and time, before going on.',
  keywords: ['wait', 'pause', 'sleep', 'later', 'timer'],
  icon: 'delay',
  status: 'ready',
  priority: 'P0',
  outputs: OUT,
  configSchema: delayConfig,
  defaultConfig: { mode: 'for', amount: 1, unit: 'hours', until: '' },
  required: [
    { path: 'until', message: 'Choose when to go on.', when: (config) => config.mode === 'until' },
  ],
  outputShape: [
    { path: 'waitedUntil', label: 'Waited Until', type: 'date', sample: '2026-11-03T10:00:00Z' },
  ],
  retry: 'none',
  blocking: 'delay',
  canDisable: true,
  summary: (config) => {
    if (config.mode === 'until') return 'Waits until a set time';
    const unit = config.unit.slice(0, -1);
    return `Waits ${count(config.amount, unit)}`;
  },
});

const reviewConfig = z
  .object({
    /** What the reviewer reads: a template, usually AI text. */
    text: templateField(),
    /** A template that resolves to media, optional. */
    image: templateField(500),
    instructions: templateField(1_000),
  })
  .strict();

export const manualReview = defineNode({
  ...LOGIC_BASICS,
  type: 'logic.manualReview',
  title: 'Manual Review',
  description: 'Waits for someone to approve or reject before going on.',
  keywords: ['approve', 'approval', 'review', 'human', 'check', 'wait'],
  icon: 'review',
  status: 'ready',
  priority: 'P0',
  outputs: [
    { id: 'approved', label: 'Approved' },
    { id: 'rejected', label: 'Rejected' },
  ],
  configSchema: reviewConfig,
  defaultConfig: { text: '', image: '', instructions: '' },
  required: [
    {
      path: 'text',
      message: 'Choose what the reviewer sees.',
      when: (config) => isBlank(config.image),
    },
  ],
  outputShape: [
    { path: 'decision', label: 'Decision', type: 'text', sample: 'approved' },
    {
      path: 'text',
      label: 'Approved Text',
      type: 'text',
      sample: 'Fresh sourdough, every morning.',
    },
    { path: 'image', label: 'Image', type: 'media' },
    { path: 'reviewedBy', label: 'Reviewed By', type: 'text', sample: 'Demo User' },
    { path: 'reason', label: 'Reject Reason', type: 'text', sample: '' },
  ],
  // It writes an in-app notification for the reviewers.
  sideEffect: 'internal',
  retry: 'none',
  blocking: 'review',
  canDisable: false,
  canHandleErrors: false,
  summary: () => 'Waits for approval, up to 7 days',
});

const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

const setFieldsConfig = z
  .object({
    fields: z
      .array(
        z
          .object({
            /** The data's name in later steps; letters, numbers and _ so chips can point at it. */
            name: z.string().regex(FIELD_NAME, 'Use letters, numbers and _ only.'),
            type: z.enum(['text', 'number', 'boolean', 'list']),
            value: templateField(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict()
  .superRefine((config, issue) => {
    const names = new Set<string>();
    config.fields.forEach((field, i) => {
      const name = field.name.toLowerCase();
      if (names.has(name)) {
        issue.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fields', i, 'name'],
          message: 'Two fields share this name.',
        });
      }
      names.add(name);
    });
  });

export const setFields = defineNode({
  ...LOGIC_BASICS,
  type: 'logic.setFields',
  title: 'Set Fields',
  description: 'Builds the data you want from earlier steps and your own values.',
  keywords: ['set', 'fields', 'map', 'transform', 'edit', 'data', 'variables'],
  icon: 'set-fields',
  status: 'ready',
  priority: 'P0',
  outputs: OUT,
  configSchema: setFieldsConfig,
  defaultConfig: { fields: [] },
  required: [{ path: 'fields', message: 'Add at least one field.' }],
  outputShape: (config) => {
    const fields = Array.isArray(config.fields) ? config.fields : [];
    return fields.flatMap((field): OutputField[] => {
      if (typeof field !== 'object' || field === null) return [];
      const { name, type } = field as { name?: unknown; type?: unknown };
      if (typeof name !== 'string' || !FIELD_NAME.test(name)) return [];
      const fieldType = type === 'number' || type === 'boolean' || type === 'list' ? type : 'text';
      return [{ path: name, label: name, type: fieldType }];
    });
  },
  canDisable: true,
  summary: (config) =>
    config.fields.length ? `Sets ${count(config.fields.length, 'field')}` : 'Add fields',
});

export const merge = defineNode({
  ...LOGIC_BASICS,
  type: 'logic.merge',
  title: 'Merge',
  description: 'Waits for every branch that runs, then goes on as one.',
  keywords: ['join', 'combine', 'wait for all', 'merge'],
  icon: 'merge',
  status: 'ready',
  priority: 'P1',
  outputs: OUT,
  configSchema: z.object({}).strict(),
  defaultConfig: {},
  // The output holds each branch's data by step, so its shape is the graph's, not the config's.
  outputShape: [],
  canDisable: false,
  summary: () => 'Waits for every branch that runs',
});

export const LOGIC_NODES = [ifElse, switchPaths, filter, delay, manualReview, setFields, merge];
