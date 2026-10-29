'use client';

/**
 * What every field of one step's form shares: the graph, the step, its
 * issues and the workspace (`FieldContext`). `SchemaForm` provides it, so a
 * chip input deep inside a condition rule or a key and value row still
 * knows which data is upstream and which of its chips are broken.
 */
import {
  type AutomationGraph,
  isTriggerType,
  tokenSource,
  type ValidationIssue,
} from '@postgear/automation';
import { createContext, useContext } from 'react';
import type { DataSource, FieldContext } from './contract';

export interface FieldEnv {
  graph: AutomationGraph;
  /** The step whose form this is. */
  nodeKey: string;
  issues: readonly ValidationIssue[];
  context: FieldContext;
}

const FieldEnvContext = createContext<FieldEnv | null>(null);

export const FieldEnvProvider = FieldEnvContext.Provider;

/** The form's environment, or null outside a form (a chip input on its own). */
export function useFieldEnv(): FieldEnv | null {
  return useContext(FieldEnvContext);
}

const TIME = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "Pinned", "Last test 14:02" or "Sample": where a value shown in the form came from. */
export function sourceWords(source: DataSource | undefined): string {
  if (!source || source.kind === 'sample') return 'Sample';
  if (source.kind === 'pinned') return 'Pinned';
  const at = Date.parse(source.at);
  return Number.isNaN(at) ? 'Last test' : `Last test ${TIME.format(at)}`;
}

/** Where the data behind a token path came from, by its source step. */
export function sourceOfPath(
  graph: AutomationGraph,
  scopeSource: FieldContext['scopeSource'] | undefined,
  path: string,
): DataSource | undefined {
  if (!scopeSource) return undefined;
  const source = tokenSource(path);
  if (source.root === 'nodes' && source.nodeKey) return scopeSource[source.nodeKey];
  if (source.root === 'trigger') {
    const trigger = graph.nodes.find((node) => isTriggerType(node.type));
    return (trigger && scopeSource[trigger.key]) ?? scopeSource.trigger;
  }
  return undefined;
}
