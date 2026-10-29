/**
 * Focus-the-field (Module 06, blueprint 6): where an issue lives and how
 * to land on it. A click on an issue (the issues popover, Finish Setup, a
 * `?step=<key>&field=<path>` deep link) selects the step, centres it,
 * opens the step panel on the part that holds the issue's `field`, then
 * scrolls to and focuses the element carrying `data-field-path`.
 *
 * `issuePlace` is pure (no DOM), so every issue code is unit tested to
 * resolve to a place. `findFieldElement` and `focusField` are the DOM half,
 * shared by the docked panel and the Expanded view.
 */
import {
  type AutomationGraph,
  type FieldPlace,
  getDefinition,
  type IssueCode,
  tabForField,
  type ValidationIssue,
} from '@postgear/automation';
import { FIELD_PATH_ATTRIBUTE } from '../fields/contract';

/** What an issue code points at. Typed over every code, so a new one cannot be missed. */
export const ISSUE_TARGETS: Readonly<Record<IssueCode, 'step' | 'line' | 'workflow'>> = {
  'graph.no_trigger': 'workflow',
  'graph.many_triggers': 'step',
  'graph.unreachable': 'step',
  'graph.cycle': 'line',
  'graph.bad_port': 'line',
  'graph.needs_merge': 'step',
  'graph.too_many_nodes': 'workflow',
  'graph.too_many_edges': 'workflow',
  'graph.dead_end_output': 'step',
  'graph.check_failed': 'workflow',
  'node.unknown_type': 'step',
  'node.coming_soon': 'step',
  'node.not_runnable': 'step',
  'node.config_invalid': 'step',
  'node.required_missing': 'step',
  'node.connection_missing': 'step',
  'node.connection_broken': 'step',
  'node.channel_missing': 'step',
  'node.channel_wrong_platform': 'step',
  'node.filter_channel_missing': 'step',
  'node.duplicate_name': 'step',
  'node.disabled_output_used': 'step',
  'token.unknown_node': 'step',
  'token.not_upstream': 'step',
  'token.unknown_field': 'step',
  'token.bad_filter': 'step',
  'token.maybe_empty': 'step',
  'token.too_many': 'step',
  'condition.empty': 'step',
  'condition.missing_value': 'step',
  'condition.type_mismatch': 'step',
  'schedule.too_frequent_for_ai': 'step',
};

export type IssuePlace =
  /** Open the step's panel on `place`, then focus `field` when there is one. */
  | { kind: 'step'; nodeKey: string; place: FieldPlace; field?: string }
  /** Select the line (a loop, an output that is gone) and centre the step it leaves. */
  | { kind: 'line'; edgeId: string; nodeKey?: string }
  /** Nothing to open on the canvas; `addTrigger` opens the Steps panel. */
  | { kind: 'workflow'; action: 'addTrigger' | 'none' };

/** Where the panel lands for a step and a config path (no path: the first tab with fields). */
export function stepPlace(
  graph: AutomationGraph,
  nodeKey: string,
  field: string | undefined,
): IssuePlace | null {
  const node = graph.nodes.find((candidate) => candidate.key === nodeKey);
  if (!node) return null;
  const def = getDefinition(node.type, node.typeVersion);
  const place: FieldPlace = def ? tabForField(def, field) : field === 'name' ? 'name' : 'configure';
  return { kind: 'step', nodeKey, place, ...(field ? { field } : {}) };
}

/** Where to land for an issue; null only when its step is gone. */
export function issuePlace(graph: AutomationGraph, issue: ValidationIssue): IssuePlace | null {
  const target = ISSUE_TARGETS[issue.code] ?? (issue.nodeKey ? 'step' : 'workflow');
  if (target === 'workflow' || !issue.nodeKey) {
    if (target === 'line' && issue.edgeId) return { kind: 'line', edgeId: issue.edgeId };
    return { kind: 'workflow', action: issue.code === 'graph.no_trigger' ? 'addTrigger' : 'none' };
  }
  if (target === 'line' && issue.edgeId) {
    const exists = graph.edges.some((edge) => edge.id === issue.edgeId);
    if (exists) return { kind: 'line', edgeId: issue.edgeId, nodeKey: issue.nodeKey };
  }
  return stepPlace(graph, issue.nodeKey, issue.field);
}

const FOCUSABLE = [
  'input:not([type="hidden"]):not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  'button:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * The element for a config path inside `root`: the exact `data-field-path`,
 * else the nearest one above it (`cases.0.condition.rules.1.left` lands on
 * the cases field when the rule row has no attribute of its own), else the
 * whole-config field (`''`, the schedule builder).
 */
export function findFieldElement(root: ParentNode, path: string): HTMLElement | null {
  const marked = new Map<string, HTMLElement>();
  for (const element of root.querySelectorAll<HTMLElement>(`[${FIELD_PATH_ATTRIBUTE}]`)) {
    const at = element.getAttribute(FIELD_PATH_ATTRIBUTE) ?? '';
    if (!marked.has(at)) marked.set(at, element);
  }
  let current = path;
  while (current) {
    const found = marked.get(current);
    if (found) return found;
    const dot = current.lastIndexOf('.');
    current = dot === -1 ? '' : current.slice(0, dot);
  }
  return marked.get('') ?? null;
}

/** The first thing to type in or press inside `element` (or the element itself). */
export function focusTarget(element: HTMLElement): HTMLElement | null {
  if (element.matches(FOCUSABLE)) return element;
  return element.querySelector<HTMLElement>(FOCUSABLE);
}

/** Scrolls the field for `path` into view and focuses it. False when it is not on screen yet. */
export function focusField(root: ParentNode, path: string): boolean {
  const element = findFieldElement(root, path);
  if (!element) return false;
  const target = focusTarget(element) ?? element;
  element.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  target.focus({ preventScroll: true });
  return true;
}
