import type { GraphNode } from '../graph/schema';
import { TEMPLATES } from '../templates';
import { getDefinition } from './index';
import { PUBLISH_FAILURE_REASON_IDS } from './platforms';
import { matchesTriggerFilters, publishFailureReasonText } from './trigger-filters';

function trigger(type: string, config: Record<string, unknown> = {}): GraphNode {
  const definition = getDefinition(type);
  if (!definition) throw new Error(`No definition for ${type}`);
  return {
    key: 'trig1',
    type,
    typeVersion: definition.typeVersion,
    name: 'Trigger',
    position: { x: 0, y: 0 },
    config: { ...(definition.defaultConfig as Record<string, unknown>), ...config },
  } as GraphNode;
}

const published = { type: 'trigger.postPublished', channelId: 'ch_a', tagIds: ['tag_1'] };
const failed = { type: 'trigger.postFailed', channelId: 'ch_a', reason: 'needs_reconnect' };

describe('matchesTriggerFilters', () => {
  it('needs the same trigger type', () => {
    expect(matchesTriggerFilters(trigger('trigger.postPublished'), failed)).toBe(false);
    expect(matchesTriggerFilters(trigger('trigger.postFailed'), published)).toBe(false);
  });

  it('starts on any post when no filter is set', () => {
    expect(matchesTriggerFilters(trigger('trigger.postPublished'), published)).toBe(true);
    expect(
      matchesTriggerFilters(trigger('trigger.postPublished'), {
        type: 'trigger.postPublished',
        channelId: 'ch_z',
      }),
    ).toBe(true);
    expect(matchesTriggerFilters(trigger('trigger.postFailed'), failed)).toBe(true);
  });

  it('keeps only the chosen channels', () => {
    const node = trigger('trigger.postPublished', { channels: ['ch_a', 'ch_b'] });
    expect(matchesTriggerFilters(node, published)).toBe(true);
    expect(matchesTriggerFilters(node, { ...published, channelId: 'ch_c' })).toBe(false);
    expect(matchesTriggerFilters(node, { type: 'trigger.postPublished' })).toBe(false);
  });

  it('starts when the post has any of the chosen tags', () => {
    const node = trigger('trigger.postPublished', { tags: ['tag_1', 'tag_2'] });
    expect(matchesTriggerFilters(node, { ...published, tagIds: ['tag_9', 'tag_2'] })).toBe(true);
    expect(matchesTriggerFilters(node, { ...published, tagIds: ['tag_9'] })).toBe(false);
    expect(matchesTriggerFilters(node, { ...published, tagIds: [] })).toBe(false);
  });

  it('keeps only the chosen failure reasons, and the channels as well', () => {
    const node = trigger('trigger.postFailed', {
      channels: ['ch_a'],
      reasons: ['needs_reconnect', 'rejected'],
    });
    expect(matchesTriggerFilters(node, failed)).toBe(true);
    expect(matchesTriggerFilters(node, { ...failed, reason: 'retries_exhausted' })).toBe(false);
    expect(matchesTriggerFilters(node, { ...failed, channelId: 'ch_b' })).toBe(false);
    expect(matchesTriggerFilters(node, { ...failed, reason: undefined })).toBe(false);
  });

  it('never starts on settings that do not parse', () => {
    const node = trigger('trigger.postFailed', { reasons: ['rate_limited'] });
    expect(matchesTriggerFilters(node, { ...failed, reason: 'rate_limited' })).toBe(false);
  });

  it('has nothing to filter on for Schedule and Manual', () => {
    expect(matchesTriggerFilters(trigger('trigger.schedule'), { type: 'trigger.schedule' })).toBe(
      true,
    );
    expect(matchesTriggerFilters(trigger('trigger.manual'), { type: 'trigger.manual' })).toBe(true);
  });
});

describe('publishFailureReasonText', () => {
  it('gives the plain words for every reason', () => {
    expect(PUBLISH_FAILURE_REASON_IDS.map(publishFailureReasonText)).toEqual([
      'Channel needs reconnecting',
      'Channel is missing permissions',
      'The platform refused the post',
      'Gave up after several tries',
      'Channel is unavailable',
      'Publishing was interrupted',
      'Something unexpected went wrong',
    ]);
  });

  it('reads an unknown reason as unexpected', () => {
    expect(publishFailureReasonText('rate_limited')).toBe('Something unexpected went wrong');
  });
});

describe('the Failed Post Alert template', () => {
  it('lets every reason through except giving up after several tries', () => {
    const template = TEMPLATES.find((candidate) => candidate.id === 'failed-post-alert');
    const filter = template?.graph.nodes.find((node) => node.type === 'logic.filter');
    expect(filter?.config).toMatchObject({
      condition: {
        rules: [
          { left: '{{ trigger.error.reason }}', operator: 'isNot', right: 'retries_exhausted' },
        ],
      },
    });
  });
});
