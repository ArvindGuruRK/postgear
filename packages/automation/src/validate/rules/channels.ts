import { withArticle } from '../../catalog/fields';
import { platformById } from '../../catalog/platforms';
import { asRecord } from '../config-paths';
import type { ValidationIssue, ValidationRule } from '../types';

/**
 * Channels a step posts to (`channels: 'act'`) must exist and be
 * connected, and a Publish step's channels must be on its platform.
 * Channels a trigger only filters on (`channels: 'filter'`) may need
 * reconnecting (alerting on exactly that is the point of Post Failed); a
 * removed one is a warning, since it simply never matches.
 */
export const channelsReady: ValidationRule = (graph, index, ctx) => {
  const issues: ValidationIssue[] = [];
  for (const node of graph.nodes) {
    const def = index.definitions.get(node.key);
    if (!def?.channels || node.disabled) continue;

    const config = asRecord(node.config);
    const ids = Array.isArray(config.channels)
      ? config.channels.filter((id): id is string => typeof id === 'string')
      : [];
    const platform =
      def.type === 'postgear.publish' && typeof config.provider === 'string'
        ? platformById(config.provider)
        : undefined;
    const issue = (
      code: ValidationIssue['code'],
      message: string,
      severity: ValidationIssue['severity'] = 'error',
    ): ValidationIssue => ({ severity, code, message, nodeKey: node.key, field: 'channels' });

    for (const id of ids) {
      const channel = ctx.channels.find((c) => c.id === id);
      if (def.channels === 'filter') {
        if (!channel) {
          issues.push(
            issue(
              'node.filter_channel_missing',
              'A channel in this filter was removed. Take it out of the filter.',
              'warning',
            ),
          );
        }
        continue;
      }

      if (!channel) {
        issues.push(issue('node.channel_missing', 'A channel in this step was removed.'));
      } else if (channel.status !== 'active') {
        issues.push(
          issue(
            'node.channel_missing',
            `${channel.name} is disconnected. Reconnect it on the Channels page.`,
          ),
        );
      } else if (platform && !platform.providers.includes(channel.provider)) {
        issues.push(
          issue(
            'node.channel_wrong_platform',
            `${channel.name} is not ${withArticle(platform.title)} channel.`,
          ),
        );
      }
    }
  }
  return issues;
};
