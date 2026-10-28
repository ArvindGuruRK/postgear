/**
 * `canConnect`: may a line be drawn from one step's output to another
 * step? The canvas calls it on every drag move (so it must stay cheap) and
 * `validateGraph` holds saved graphs to the same rules.
 *
 * Two steps that both run joining without a Merge is deliberately *not*
 * refused here: people draw first and fix after, so it is a validation
 * issue (`graph.needs_merge`) instead.
 */
import { getDefinition, isTriggerType, outputPortsOf } from './catalog';
import { edgeId, type PortId } from './graph/schema';
import { type GraphInput, reaches, toIndex } from './plan/build-index';

export interface ProposedEdge {
  source: string;
  sourcePort: PortId;
  target: string;
  /** Steps have one input; anything else is refused. */
  targetPort?: string;
}

export type ConnectCheck = { ok: true } | { ok: false; reason: string };

export const CONNECT_REASONS = {
  missing: 'This step is not in the workflow any more.',
  self: 'A step cannot connect to itself.',
  intoTrigger: 'A trigger starts the workflow, so nothing can lead into it.',
  badInput: 'Connect to the left side of a step.',
  badOutput: 'This step has no such output.',
  duplicate: 'These steps are already connected.',
  cycle: 'Workflows cannot loop back to an earlier step.',
} as const;

export function canConnect(input: GraphInput, proposed: ProposedEdge): ConnectCheck {
  const index = toIndex(input);
  const source = index.nodes.get(proposed.source);
  const target = index.nodes.get(proposed.target);
  if (!source || !target) return { ok: false, reason: CONNECT_REASONS.missing };
  if (source.key === target.key) return { ok: false, reason: CONNECT_REASONS.self };

  const targetDef = getDefinition(target.type, target.typeVersion);
  if (isTriggerType(target.type) || targetDef?.inputs.length === 0) {
    return { ok: false, reason: CONNECT_REASONS.intoTrigger };
  }
  if ((proposed.targetPort ?? 'in') !== 'in')
    return { ok: false, reason: CONNECT_REASONS.badInput };

  if (!outputPortsOf(source).some((port) => port.id === proposed.sourcePort)) {
    return { ok: false, reason: CONNECT_REASONS.badOutput };
  }
  if (index.edges.has(edgeId(source.key, proposed.sourcePort, target.key))) {
    return { ok: false, reason: CONNECT_REASONS.duplicate };
  }
  if (reaches(index, target.key, source.key)) return { ok: false, reason: CONNECT_REASONS.cycle };

  return { ok: true };
}
