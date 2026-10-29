import { graphOf, line, step } from '../testing/builders';
import { sampleScope, stepSample, triggerSample } from './index';

describe('sample data', () => {
  it('a published post is a real-looking Instagram post', () => {
    expect(triggerSample(step('t', 'trigger.postPublished'))).toMatchObject({
      post: {
        url: 'https://instagram.com/p/Cx1',
        state: 'PUBLISHED',
        channel: { provider: 'instagram' },
      },
      tags: ['launch', 'bakery'],
    });
  });

  it('a failed post failed because its channel needs reconnecting', () => {
    expect(triggerSample(step('t', 'trigger.postFailed'))).toMatchObject({
      post: { state: 'ERROR' },
      error: { reason: 'needs_reconnect', reasonText: 'Channel needs reconnecting', attempts: 3 },
    });
  });

  it('a schedule tick carries the schedule time zone', () => {
    const tick = step('t', 'trigger.schedule', { config: { timeZone: 'Asia/Kolkata' } });
    expect(triggerSample(tick)).toEqual({
      scheduledFor: '2026-11-03T09:00:00Z',
      timeZone: 'Asia/Kolkata',
    });
  });

  it('a manual run fills in each of its fields', () => {
    const manual = step('t', 'trigger.manual', {
      config: {
        fields: [
          { key: 'topic', label: 'Topic', type: 'text' },
          { key: 'count', label: 'How Many', type: 'number' },
          { key: 'tone', label: 'Tone', type: 'choice', options: ['Friendly', 'Formal'] },
          { nope: true },
        ],
      },
    });
    expect(triggerSample(manual)).toEqual({
      inputs: { topic: 'Sample topic', count: 3, tone: 'Friendly' },
    });
  });

  it('a step without a sample image gets one, and an unknown step gets nothing', () => {
    expect(stepSample(step('i', 'ai.generateImage'))).toMatchObject({
      image: { type: 'image' },
      url: 'https://media.postgear.local/i/1.png',
    });
    expect(stepSample({ type: 'nope.step', typeVersion: 1, config: {} })).toEqual({});
  });

  it('Set Fields samples are built from the samples before them', () => {
    const graph = graphOf(
      [
        step('trig', 'trigger.postPublished'),
        step('set', 'logic.setFields', {
          config: {
            fields: [
              { name: 'where', type: 'text', value: 'On {{ trigger.post.channel.name }}' },
              { name: 'n', type: 'number', value: '{{ trigger.tags | count }}' },
            ],
          },
        }),
        step('off', 'notify.inApp', { disabled: true }),
      ],
      [line('trig', 'set'), line('set', 'off')],
    );
    const scope = sampleScope(graph, 'My Shop');
    expect(scope.nodes?.set?.output).toEqual({ where: 'On Bloom Bakery', n: 2 });
    expect(scope.nodes?.off).toBeUndefined();
    expect(scope.workspace).toEqual({ name: 'My Shop' });
    expect(scope.run).toMatchObject({ id: 'run_sample', mode: 'test' });
  });
});
