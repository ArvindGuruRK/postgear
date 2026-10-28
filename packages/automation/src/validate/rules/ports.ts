import { isTriggerType, outputPortsOf } from '../../catalog';
import type { ValidationIssue, ValidationRule } from '../types';

/**
 * Every line leaves from a port its step has and enters a step that takes
 * input. A Paths case deleted after it was connected is the usual cause.
 * Lines from unknown step types are left to `node.unknown_type`.
 */
export const portsExist: ValidationRule = (_graph, index) => {
  const issues: ValidationIssue[] = [];
  for (const edge of index.edges.values()) {
    const source = index.nodes.get(edge.source);
    const target = index.nodes.get(edge.target);
    if (!source || !target) continue;

    const sourceDef = index.definitions.get(source.key);
    if (sourceDef && !outputPortsOf(source).some((port) => port.id === edge.sourcePort)) {
      issues.push({
        severity: 'error',
        code: 'graph.bad_port',
        message: 'This line starts from an output the step does not have any more.',
        nodeKey: source.key,
        edgeId: edge.id,
      });
    }

    const targetDef = index.definitions.get(target.key);
    if (isTriggerType(target.type) || targetDef?.inputs.length === 0) {
      issues.push({
        severity: 'error',
        code: 'graph.bad_port',
        message: 'A trigger starts the workflow, so nothing can lead into it.',
        nodeKey: target.key,
        edgeId: edge.id,
      });
    }
  }
  return issues;
};
