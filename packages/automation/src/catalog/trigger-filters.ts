/**
 * Whether an event starts a workflow (Module 09): the trigger step's own
 * filters, read from the workflow's **active version**, never the draft, so
 * editing a live workflow changes nothing until its changes are turned on.
 *
 * - Post Published: channels (any of; empty means any channel) and tags
 *   (the post carries any of them; empty means any post).
 * - Post Failed: channels, and failure reasons (empty means any reason).
 * - Schedule, Manual and Webhook have no filters: the type is enough.
 *
 * A trigger whose settings do not parse never starts a run: activation
 * refuses such a graph, so this only guards against a damaged version.
 */
import type { GraphNode } from '../graph/schema';
import { parseNodeConfig } from './index';
import { PUBLISH_FAILURE_REASONS } from './platforms';

/** What happened, in the terms the trigger filters read. */
export interface TriggerEvent {
  /** The trigger type the event fires, like `trigger.postPublished`. */
  type: string;
  /** The channel (`Integration.id`) the post is on. */
  channelId?: string;
  /** Tag ids on the post. */
  tagIds?: readonly string[];
  /** Post Failed: the `PublishFailureReason`. */
  reason?: string;
}

type TriggerLike = Pick<GraphNode, 'type' | 'typeVersion' | 'config'>;

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** Empty means "any"; otherwise the value must be one of them. */
function allows(list: readonly string[], value: string | undefined): boolean {
  return list.length === 0 || (value !== undefined && list.includes(value));
}

export function matchesTriggerFilters(trigger: TriggerLike, event: TriggerEvent): boolean {
  if (trigger.type !== event.type) return false;

  const parsed = parseNodeConfig(trigger);
  if (!parsed?.success) return false;
  const config = parsed.data as Record<string, unknown>;

  switch (trigger.type) {
    case 'trigger.postPublished': {
      if (!allows(stringList(config.channels), event.channelId)) return false;
      const tags = stringList(config.tags);
      return tags.length === 0 || (event.tagIds ?? []).some((tag) => tags.includes(tag));
    }
    case 'trigger.postFailed':
      return (
        allows(stringList(config.channels), event.channelId) &&
        allows(stringList(config.reasons), event.reason)
      );
    default:
      return true;
  }
}

/**
 * The words for a `PublishFailureReason` that filters and messages show
 * ("Gave up after several tries"); an unknown reason reads as unexpected.
 */
export function publishFailureReasonText(reason: string): string {
  const known = PUBLISH_FAILURE_REASONS.find((entry) => entry.id === reason);
  return (known ?? PUBLISH_FAILURE_REASONS[PUBLISH_FAILURE_REASONS.length - 1]).label;
}
