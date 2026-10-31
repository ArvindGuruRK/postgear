/**
 * Test runs of a Webhook workflow start from the last data the link
 * received (Module 13), and fall back to the catalog sample before any.
 */
import { type GraphNode, triggerSample } from '@postgear/automation';
import { sampleTriggerOutput } from './automation-runs.service';

function node(type: string): GraphNode {
  return {
    key: 'trig',
    type,
    name: 'Trigger',
    config: {},
    position: { x: 0, y: 0 },
  } as unknown as GraphNode;
}

describe('sampleTriggerOutput', () => {
  it('uses the last received data for the Webhook trigger', () => {
    const at = new Date('2026-11-02T09:30:00.000Z');
    expect(
      sampleTriggerOutput(
        { webhookSample: { order: 42, password: '[hidden]' }, webhookSampleAt: at },
        node('trigger.webhook'),
      ),
    ).toEqual({
      body: { order: 42, password: '[hidden]' },
      receivedAt: at.toISOString(),
      headers: { contentType: 'application/json' },
    });
  });

  it('uses the catalog sample before anything was received, and for other triggers', () => {
    const webhook = node('trigger.webhook');
    expect(sampleTriggerOutput({ webhookSample: null, webhookSampleAt: null }, webhook)).toEqual(
      triggerSample(webhook),
    );
    const manual = node('trigger.manual');
    expect(
      sampleTriggerOutput({ webhookSample: { order: 1 }, webhookSampleAt: new Date() }, manual),
    ).toEqual(triggerSample(manual));
  });
});
