'use client';

/**
 * The step form's workspace pickers: a saved connection (Module 04's
 * picker), the workspace's channels (the composer's chips) and its post
 * tags. Each reads the workspace from the form's `FieldContext`.
 */
import { platformById } from '@postgear/automation';
import { Alert, Button, MultiSelect, Text } from '@postgear/ui';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ChannelPicker } from '@/components/composer/channel-picker';
import { ActionLink } from '@/components/home/home-actions';
import { api } from '@/lib/api';
import type { Channel } from '@/types/channel';
import type { Tag } from '@/types/tag';
import { ConnectionPicker } from '../connection-picker';
import { useFieldEnv } from './field-env';
import { asList, asText, type FieldControlProps } from './field-types';
import { getAtPath } from './form-model';

/** "None picked: any channel." under a filter that is empty on purpose. */
function emptyWords(emptyLabel: string | undefined): string | undefined {
  if (!emptyLabel) return undefined;
  return `None picked: ${emptyLabel[0].toLowerCase()}${emptyLabel.slice(1)}.`;
}

export function ConnectionField({
  spec,
  definition,
  node,
  value,
  onChange,
  ids,
}: FieldControlProps) {
  const env = useFieldEnv();
  const kind = definition.connection?.kind;
  if (!kind || !env) {
    return (
      <Text size="sm" muted>
        Connections can be picked inside a workflow.
      </Text>
    );
  }
  const { orgId, automationId, connections, canManage } = env.context;
  return (
    // biome-ignore lint/a11y/useSemanticElements: names Module 04's picker, which takes no id
    <div role="group" aria-labelledby={ids.label} aria-describedby={ids.message}>
      <ConnectionPicker
        kind={kind}
        value={asText(value)}
        onChange={(connectionId) => onChange(spec.path, connectionId)}
        returnTo={`/${orgId}/workflows/${automationId}?step=${encodeURIComponent(node.key)}`}
        connections={[...connections]}
        canManage={canManage}
      />
    </div>
  );
}

/**
 * Channels shown for picking: the workspace's channels, without those that
 * cannot post (unfinished setup, turned off) unless they are already picked.
 */
export function pickableChannels(
  channels: readonly Channel[],
  selected: readonly string[],
): Channel[] {
  return channels.filter(
    (channel) =>
      selected.includes(channel.id) ||
      (channel.health !== 'needs_setup' && channel.health !== 'disabled'),
  );
}

/**
 * The workspace's channels limited to one publish platform (Publish To
 * {Platform}): a LinkedIn card covers profiles and Pages. Channels already
 * picked stay listed, so one of another platform can still be taken off.
 */
export function channelsForPlatform(
  channels: readonly Channel[],
  platformId: string | undefined,
  selected: readonly string[] = [],
): Channel[] {
  if (!platformId) return [...channels];
  const providers = platformById(platformId)?.providers ?? [platformId];
  return channels.filter(
    (channel) => selected.includes(channel.id) || providers.includes(channel.providerIdentifier),
  );
}

export function ChannelsField({ spec, config, value, onChange, ids }: FieldControlProps) {
  const env = useFieldEnv();
  const selected = asList<string>(value).filter((id) => typeof id === 'string');
  const all = env?.context.channels ?? [];
  const known = new Set(all.map((channel) => channel.id));
  const removed = selected.filter((id) => !known.has(id));
  const platformId =
    spec.providerPath !== undefined ? asText(getAtPath(config, spec.providerPath)) : undefined;
  const platform = platformId ? platformById(platformId) : undefined;
  const channels = channelsForPlatform(all, platformId, selected);
  const pickable = pickableChannels(channels, selected);
  const orgId = env?.context.orgId ?? '';
  const write = (next: string[]) => onChange(spec.path, next);
  const toggle = (id: string) =>
    write(selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id]);

  if (platformId && pickable.length === 0) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: names the notice in place of the channel chips
      <div role="group" aria-labelledby={ids.label} aria-describedby={ids.message}>
        <Alert variant="info" className="flex-wrap items-center gap-2 p-3">
          <span className="flex-1">
            No {platform?.title ?? 'channel'} channel is connected to this workspace yet.
          </span>
          <ActionLink href={`/${orgId}/channels`}>Connect A Channel</ActionLink>
        </Alert>
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: names the composer's channel chips
    <div
      role="group"
      aria-labelledby={ids.label}
      aria-describedby={ids.message}
      className="flex flex-col gap-2"
    >
      <ChannelPicker orgId={orgId} channels={pickable} selected={selected} onToggle={toggle} />
      {selected.length === 0 && emptyWords(spec.emptyLabel) ? (
        <Text size="xs" muted>
          {emptyWords(spec.emptyLabel)}
        </Text>
      ) : null}
      {removed.length > 0 ? (
        <Alert variant="warning" className="flex-wrap items-center gap-2 p-3">
          <TriangleAlert aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2.5} />
          <span className="flex-1">
            {removed.length === 1
              ? 'A picked channel was removed from this workspace.'
              : `${removed.length} picked channels were removed from this workspace.`}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => write(selected.filter((id) => known.has(id)))}
          >
            Clear Removed
          </Button>
        </Alert>
      ) : null}
    </div>
  );
}

type TagsState = { status: 'loading' } | { status: 'ready'; tags: Tag[] } | { status: 'failed' };

export function TagsField({ spec, value, onChange, ids }: FieldControlProps) {
  const env = useFieldEnv();
  const orgId = env?.context.orgId;
  const [state, setState] = useState<TagsState>({ status: 'loading' });

  // biome-ignore lint/correctness/useExhaustiveDependencies: the tags belong to the workspace (the org cookie), so another workspace loads its own
  useEffect(() => {
    let live = true;
    // The workspace's tags are not part of `FieldContext`, so the field loads them.
    api<{ tags: Tag[] }>('/tags')
      .then((result) => {
        if (live) setState({ status: 'ready', tags: result.tags });
      })
      .catch(() => {
        if (live) setState({ status: 'failed' });
      });
    return () => {
      live = false;
    };
  }, [orgId]);

  const selected = asList<string>(value).filter((id) => typeof id === 'string');
  const tags = state.status === 'ready' ? state.tags : [];
  const known = new Set(tags.map((tag) => tag.id));
  const options = [
    ...tags.map((tag) => ({ value: tag.id, label: tag.name })),
    // A picked tag that was deleted still shows, so it can be taken off.
    ...(state.status === 'ready'
      ? selected.filter((id) => !known.has(id)).map((id) => ({ value: id, label: 'Removed tag' }))
      : []),
  ];

  return (
    // biome-ignore lint/a11y/useSemanticElements: names the design system's multi select, which takes no id
    <div
      role="group"
      aria-labelledby={ids.label}
      aria-describedby={ids.message}
      className="flex flex-col gap-2"
    >
      <MultiSelect
        options={options}
        value={selected}
        onValueChange={(next) => onChange(spec.path, next)}
        placeholder={state.status === 'loading' ? 'Loading tags' : (spec.emptyLabel ?? 'No tags')}
        searchPlaceholder="Enter your search"
        emptyText={
          state.status === 'ready' && tags.length === 0
            ? 'This workspace has no tags yet.'
            : 'No tag matches your search.'
        }
        disabled={state.status === 'loading'}
      />
      {state.status === 'failed' ? (
        <Text size="xs" className="text-dangerInk">
          Tags could not be loaded. Reopen this step to try again.
        </Text>
      ) : null}
    </div>
  );
}
