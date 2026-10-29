/**
 * What `validateGraph` cannot know on its own, read from the database: the
 * workspace's connections, its channels and which step types the worker can
 * run.
 *
 * Its own small service because Modules 04 (connections), 07 (the run
 * engine) and 09 (activation) build the same context.
 *
 * - **Connections** are this workspace's rows that are not deleted, as
 *   `{ id, kind, name, status }`, never their credentials. A graph that
 *   names another workspace's connection id finds nothing here, so
 *   validation reports it as missing.
 * - **Channels** are every channel that is not deleted. A turned-off one is
 *   kept (validation names it rather than calling it missing), and one that
 *   needs reconnecting, or is still half connected, is `needsReconnect`.
 * - **Runnable types** are `EXECUTABLE_TYPES`, empty until the worker ships
 *   executors.
 *
 * `connectionUsage` is the Used By scan: each workflow's draft, and the
 * running version of each active one, searched for connection ids. Scanned
 * rather than stored because the builder autosaves every few seconds, and a
 * join table rewritten that often is where drift comes from.
 */
import { Injectable } from '@nestjs/common';
import {
  type ChannelState,
  type ConnectionState,
  EXECUTABLE_TYPES,
  getDefinition,
  type ValidationContext,
} from '@postgear/automation';
import type { AutomationStatus } from '@postgear/db';
import { AutomationsRepository, type ChannelRow } from './automations.repository';
import { ConnectionsRepository } from './connections/connections.repository';
import { providerFor } from './connections/providers';

export interface AutomationRef {
  id: string;
  name: string;
  status: AutomationStatus;
}

/** `live`: workflows that are on and whose running version uses the connection. */
export interface ConnectionUsage {
  draft: AutomationRef[];
  live: AutomationRef[];
}

@Injectable()
export class AutomationContextService {
  constructor(
    private readonly repository: AutomationsRepository,
    private readonly connections: ConnectionsRepository,
  ) {}

  async forOrg(orgId: string): Promise<ValidationContext> {
    const [channels, connections] = await Promise.all([
      this.repository.channels(orgId),
      this.connections.list(orgId),
    ]);
    return {
      connections: connections.flatMap((row): ConnectionState[] =>
        providerFor(row.provider)
          ? [
              {
                id: row.id,
                kind: row.provider as ConnectionState['kind'],
                name: row.name,
                status: row.status,
              },
            ]
          : [],
      ),
      channels: channels.map(toChannelState),
      availableTypes: EXECUTABLE_TYPES,
    };
  }

  async connectionUsage(orgId: string): Promise<Record<string, ConnectionUsage>> {
    const rows = await this.repository.usageGraphs(orgId);
    const usage: Record<string, ConnectionUsage> = {};
    const entry = (id: string) => {
      usage[id] ??= { draft: [], live: [] };
      return usage[id];
    };

    for (const row of rows) {
      const ref: AutomationRef = { id: row.id, name: row.name, status: row.status };
      for (const id of connectionIdsIn(row.draftGraph)) entry(id).draft.push(ref);
      if (row.status === 'ACTIVE' && row.activeVersion) {
        for (const id of connectionIdsIn(row.activeVersion.graph)) entry(id).live.push(ref);
      }
    }
    return usage;
  }
}

export function toChannelState(row: ChannelRow): ChannelState {
  const status: ChannelState['status'] = row.disabled
    ? 'disabled'
    : row.refreshNeeded || row.inBetweenSteps
      ? 'needsReconnect'
      : 'active';
  return { id: row.id, provider: row.providerIdentifier, name: row.name, status };
}

/**
 * The connection ids a stored graph names, read from each step's declared
 * connection field. A stored graph was validated on write, but it is read
 * defensively here: an old shape just yields nothing.
 */
export function connectionIdsIn(graph: unknown): Set<string> {
  const ids = new Set<string>();
  const nodes = isRecord(graph) && Array.isArray(graph.nodes) ? graph.nodes : [];
  for (const node of nodes) {
    if (!isRecord(node) || typeof node.type !== 'string') continue;
    const field = getDefinition(node.type)?.connection?.field;
    const value = field && isRecord(node.config) ? node.config[field] : undefined;
    if (typeof value === 'string' && value.trim()) ids.add(value.trim());
  }
  return ids;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
