import { type AutomationGraph, getTemplate, instantiateTemplate } from '@postgear/automation';
import { ApiError } from '@/lib/api';
import type { RunStep } from '@/types/workflows';
import { DEBUG_NO_TRIGGER, debugErrorMessage, pinRunData, planDebug } from './debug-in-editor';
import { makeStep } from './run-test-fixtures';

function report(): AutomationGraph {
  const template = getTemplate('publishing-report');
  if (!template) throw new Error('missing template');
  return instantiateTemplate(template, (key) => key);
}

const graph = report();

function stepsOf(list: RunStep[]): Record<string, RunStep> {
  return Object.fromEntries(list.map((step) => [step.nodeKey, step]));
}

const steps = stepsOf([
  makeStep({
    nodeKey: 'published',
    nodeType: 'trigger.postPublished',
    output: { post: { id: 'p1' } },
  }),
  makeStep({ nodeKey: 'fields', nodeType: 'logic.setFields', output: { title: 'Hi' } }),
  makeStep({ nodeKey: 'sheet', nodeType: 'data.googleSheetsAppendRow', status: 'DRY_RUN' }),
  makeStep({ nodeKey: 'slack', status: 'FAILED', output: null }),
]);

describe('planDebug', () => {
  it('pins the trigger output alone by default and focuses the failed step', () => {
    const plan = planDebug({ graph, steps }, undefined, false);
    expect(plan).toEqual({
      pins: [{ nodeKey: 'published', output: { post: { id: 'p1' } } }],
      focusKey: 'slack',
    });
  });

  it('adds every succeeded step when asked, never dry runs or cut data', () => {
    const cut = { ...steps, fields: { ...steps.fields, truncated: true } };
    expect(planDebug({ graph, steps }, undefined, true)).toMatchObject({
      pins: [
        { nodeKey: 'published', output: { post: { id: 'p1' } } },
        { nodeKey: 'fields', output: { title: 'Hi' } },
      ],
    });
    expect(planDebug({ graph, steps: cut }, undefined, true)).toMatchObject({
      pins: [{ nodeKey: 'published' }],
    });
  });

  it('uses the run trigger data when the trigger has no output row', () => {
    const { published: _trigger, ...rest } = steps;
    expect(planDebug({ graph, steps: rest }, { from: 'payload' }, false)).toMatchObject({
      pins: [{ nodeKey: 'published', output: { from: 'payload' } }],
    });
    expect(planDebug({ graph, steps: rest }, null, false)).toEqual({ error: DEBUG_NO_TRIGGER });
  });
});

describe('pinRunData', () => {
  it('saves each pin and skips a later step the API refuses', async () => {
    const pin = jest.fn(async (_id: string, nodeKey: string, output: unknown) => {
      if (nodeKey === 'fields') throw new ApiError('Not in the draft', 404);
      return { pinned: { nodeKey, pinnedAt: '2026-10-29T10:00:00.000Z', output } };
    });
    const result = await pinRunData(
      'wf-1',
      {
        pins: [
          { nodeKey: 'published', output: 1 },
          { nodeKey: 'fields', output: 2 },
          { nodeKey: 'sheet', output: 3 },
        ],
        focusKey: null,
      },
      pin,
    );
    expect(pin).toHaveBeenCalledTimes(3);
    expect(result.pinned.map((item) => item.nodeKey)).toEqual(['published', 'sheet']);
    expect(result.skipped).toEqual(['fields']);
  });

  it('stops when the trigger cannot be pinned', async () => {
    const pin = jest.fn(async () => {
      throw new ApiError('Too big', 422, 'pinned_too_large');
    });
    await expect(
      pinRunData('wf-1', { pins: [{ nodeKey: 'published', output: 1 }], focusKey: null }, pin),
    ).rejects.toBeInstanceOf(ApiError);
    expect(debugErrorMessage(new ApiError('Too big', 422, 'pinned_too_large'))).toMatch(/64 KB/);
  });
});
