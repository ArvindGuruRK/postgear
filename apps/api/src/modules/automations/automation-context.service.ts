/**
 * What `validateGraph` cannot know on its own, read from the database: the
 * workspace's connections, its channels and which step types the worker can
 * run.
 *
 * Its own small service because Modules 04 (connections), 07 (the run
 * engine) and 09 (activation) build the same context.
 *
 * - **Connections** are an empty list until Module 04 adds the table, so
 *   every step that needs one reads as Needs A Connection.
 * - **Channels** are every channel that is not deleted. A turned-off one is
 *   kept (validation names it rather than calling it missing), and one that
 *   needs reconnecting, or is still half connected, is `needsReconnect`.
 * - **Runnable types** are `EXECUTABLE_TYPES`, empty until the worker ships
 *   executors.
 */
import { Injectable } from '@nestjs/common';
import { type ChannelState, EXECUTABLE_TYPES, type ValidationContext } from '@postgear/automation';
import { AutomationsRepository, type ChannelRow } from './automations.repository';

@Injectable()
export class AutomationContextService {
  constructor(private readonly repository: AutomationsRepository) {}

  async forOrg(orgId: string): Promise<ValidationContext> {
    const channels = await this.repository.channels(orgId);
    return {
      connections: [],
      channels: channels.map(toChannelState),
      availableTypes: EXECUTABLE_TYPES,
    };
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
