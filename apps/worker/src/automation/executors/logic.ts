/**
 * Logic steps that run as activities: If / Else, Paths, Filter, Set Fields
 * and Merge. None leaves PostGear. (Delay and Manual Review are handled by
 * the run workflow itself, through `prepareDelay` and `openReview`.)
 *
 * Conditions are evaluated on the settings as saved (`rawConfig`), because
 * `evaluateCondition` resolves each rule's tokens itself and keeps the
 * resolved sides in its details for the run inspector.
 */
import {
  type ConditionGroup,
  evaluateCondition,
  type GraphNode,
  isEmptyValue,
  outputPortsOf,
  type PortId,
  toNumber,
  toText,
} from '@postgear/automation';
import { permanent } from '../failures';
import type { PriorOutput } from '../run-store';
import type { Executor } from './types';

export const FILTER_STOPPED_MESSAGE = 'The rules did not match, so this branch stopped here.';

export const ifElseExecutor: Executor = {
  type: 'logic.ifElse',
  async run(ctx) {
    const condition = ctx.rawConfig.condition as ConditionGroup;
    const { result, details } = evaluateCondition(condition, ctx.scope, {
      timeZone: ctx.timeZone,
    });
    return { output: { result, details }, ports: [result ? 'true' : 'false'] };
  },
};

interface PathCase {
  id: string;
  name: string;
  condition: ConditionGroup;
}

export const switchExecutor: Executor = {
  type: 'logic.switch',
  async run(ctx) {
    // The ports come from the definition, so a case and its line always agree.
    const ports = outputPortsOf(ctx.node);
    const cases = (ctx.rawConfig.cases ?? []) as PathCase[];
    const checked: { caseId: string; name: string; result: boolean; details: unknown }[] = [];

    for (const pathCase of cases) {
      const port = ports.find((candidate) => candidate.id === `case:${pathCase.id}`);
      if (!port) continue;
      const { result, details } = evaluateCondition(pathCase.condition, ctx.scope, {
        timeZone: ctx.timeZone,
      });
      checked.push({ caseId: pathCase.id, name: pathCase.name, result, details });
      if (result) {
        return { output: { path: port.label, caseId: pathCase.id, checked }, ports: [port.id] };
      }
    }

    const fallback = ports.find((candidate) => candidate.id === 'fallback');
    return {
      output: { path: fallback?.label ?? 'Otherwise', caseId: null, checked },
      ports: ['fallback'],
    };
  },
};

export const filterExecutor: Executor = {
  type: 'logic.filter',
  async run(ctx) {
    const condition = ctx.rawConfig.condition as ConditionGroup;
    const { result, details } = evaluateCondition(condition, ctx.scope, {
      timeZone: ctx.timeZone,
    });
    if (result) {
      return { output: { passed: true, details }, ports: ['out'] };
    }
    // Not a failure: the branch ends and the steps after it are skipped.
    return {
      output: { passed: false, stopped: true, message: FILTER_STOPPED_MESSAGE, details },
      ports: [],
    };
  },
};

const TRUE_WORDS = new Set(['true', 'yes', '1', 'on']);
const FALSE_WORDS = new Set(['false', 'no', '0', 'off']);

function preview(value: unknown): string {
  const text = toText(value).trim();
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/**
 * A Set Fields value as its chosen type. Empty data stays empty (`null`,
 * `[]` or `''`), so a missing optional value does not fail the step; data
 * that clearly is not the type does, with a sentence naming the field.
 */
export function coerceField(name: string, type: string, value: unknown): unknown {
  switch (type) {
    case 'number': {
      if (isEmptyValue(value)) return null;
      const number = toNumber(value);
      if (Number.isNaN(number)) {
        throw permanent(
          `'${name}' should be a number, but it was "${preview(value)}".`,
          'bad_data',
          {
            field: name,
          },
        );
      }
      return number;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (isEmptyValue(value)) return null;
      if (typeof value === 'number') return value !== 0;
      const word = toText(value).trim().toLowerCase();
      if (TRUE_WORDS.has(word)) return true;
      if (FALSE_WORDS.has(word)) return false;
      throw permanent(
        `'${name}' should be yes or no, but it was "${preview(value)}".`,
        'bad_data',
        {
          field: name,
        },
      );
    }
    case 'list': {
      if (Array.isArray(value)) return value;
      if (isEmptyValue(value)) return [];
      if (typeof value === 'string') {
        const text = value.trim();
        if (text.startsWith('[')) {
          try {
            const parsed: unknown = JSON.parse(text);
            if (Array.isArray(parsed)) return parsed;
          } catch {
            // Not JSON: read it as a comma list below.
          }
        }
        return text
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item !== '');
      }
      return [value];
    }
    default:
      return toText(value);
  }
}

interface FieldSetting {
  name: string;
  type: string;
  value: unknown;
}

export const setFieldsExecutor: Executor = {
  type: 'logic.setFields',
  async run(ctx) {
    const fields = (ctx.config.fields ?? []) as FieldSetting[];
    const output: Record<string, unknown> = {};
    for (const field of fields) {
      output[field.name] = coerceField(field.name, field.type, field.value);
    }
    return { output };
  },
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Which outputs a finished step left through, read back from its stored
 * result (the ports themselves live only in the workflow's state).
 */
export function portsTaken(node: GraphNode, prior: PriorOutput): PortId[] {
  if (prior.status === 'HANDLED_ERROR') {
    return [node.onError?.mode === 'branch' ? 'error' : 'out'];
  }
  const output = record(prior.output);
  switch (node.type) {
    case 'logic.ifElse':
      return [output.result === true ? 'true' : 'false'];
    case 'logic.switch':
      return [typeof output.caseId === 'string' ? `case:${output.caseId}` : 'fallback'];
    case 'logic.filter':
      return output.passed === false ? [] : ['out'];
    case 'logic.manualReview':
      return [output.decision === 'rejected' ? 'rejected' : 'approved'];
    default:
      return ['out'];
  }
}

export const mergeExecutor: Executor = {
  type: 'logic.merge',
  async run(ctx) {
    const output: Record<string, unknown> = {};
    for (const edge of ctx.graph.edges) {
      if (edge.target !== ctx.node.key) continue;
      const prior = ctx.priors[edge.source];
      const source = ctx.graph.nodes.find((node) => node.key === edge.source);
      if (!prior || !source) continue;
      // Only branches whose line into the Merge actually carried the run.
      if (!portsTaken(source, prior).includes(edge.sourcePort)) continue;
      output[source.name] = prior.output;
    }
    return { output };
  },
};

export const LOGIC_EXECUTORS: Executor[] = [
  ifElseExecutor,
  switchExecutor,
  filterExecutor,
  setFieldsExecutor,
  mergeExecutor,
];
