import { type GraphInput, toIndex } from './build-index';

/**
 * The order steps run in: every step after the steps it depends on, never
 * by canvas position alone. Ties (two steps ready at once) go by canvas y,
 * then x, then key, so the order is the same on every run and does not
 * depend on how the arrays were saved. Steps in or after a loop are left
 * out; `validateGraph` reports the loop.
 */
export function topologicalOrder(input: GraphInput): string[] {
  return [...toIndex(input).order];
}

/**
 * Every step a step can get data from: all its ancestors, in run order.
 * This is what Insert Data offers (Module 02) and what tokens may point at.
 */
export function upstreamOf(input: GraphInput, key: string): string[] {
  const index = toIndex(input);
  const seen = new Set<string>();
  const stack = (index.incoming.get(key) ?? []).map((edge) => edge.source);
  while (stack.length > 0) {
    const next = stack.pop() as string;
    if (seen.has(next) || next === key) continue;
    seen.add(next);
    for (const edge of index.incoming.get(next) ?? []) stack.push(edge.source);
  }
  return [...index.order, ...index.cyclic].filter((candidate) => seen.has(candidate));
}
