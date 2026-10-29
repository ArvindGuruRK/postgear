/**
 * What `SchemaForm` hands every field control. A control edits the config
 * at `spec.path` (and, for a duration, `spec.unitPath`) through
 * `onChange(path, value)` with whole config paths, so the panel turns each
 * edit into one reducer action.
 */
import type { FieldSpec, GraphNode, NodeDefinition } from '@postgear/automation';

export interface FieldIds {
  /** The control's id, for `<label htmlFor>`. */
  control: string;
  /** The visible label's id, for `aria-labelledby`. */
  label: string;
  /** The help or error line's id, for `aria-describedby`. */
  message: string;
}

export interface FieldControlProps {
  spec: FieldSpec;
  definition: NodeDefinition;
  node: GraphNode;
  /** The step's whole config. */
  config: Record<string, unknown>;
  /** The config at `spec.path` ('' is the whole config). */
  value: unknown;
  /** An edit at a whole config path. */
  onChange: (path: string, value: unknown) => void;
  /** Errors inside this field by path relative to it; its own error is under ''. */
  errors: Readonly<Record<string, string>>;
  ids: FieldIds;
}

/** `prefix.rest`, or `rest` alone when the prefix is the whole config. */
export function joinPath(prefix: string, rest: string): string {
  if (!prefix) return rest;
  if (!rest) return prefix;
  return `${prefix}.${rest}`;
}

export function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function asList<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
