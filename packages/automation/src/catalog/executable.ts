import type { NodeType } from './types';

/**
 * The step types the worker can run today. It does not decide what can be
 * added: every `ready` type can be placed on a draft, so the canvas works
 * before the run engine exists. A type missing here is reported as
 * `node.not_runnable` (through `ValidationContext.availableTypes`), which
 * blocks tests and activation but not saving.
 *
 * Each module that ships an executor adds its types here in the same
 * commit; a worker test (Module 07) checks this list and the executor
 * registry match exactly.
 */
export const EXECUTABLE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([]);
