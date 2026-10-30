/**
 * Debug In Editor (Module 08, n8n's feature of the same name): a past run's
 * trigger data becomes the trigger's pinned data, and, when asked, every
 * step that worked keeps its result as pinned data too, so the next test
 * starts exactly where that run was. The pins are saved through the API one
 * by one; the page swaps them in and opens the failed step.
 */
import { isTriggerType, topologicalOrder } from '@postgear/automation';
import { ApiError, pinStepData } from '@/lib/api';
import type { PinnedStep } from '@/types/workflows';
import type { RunModel } from './run-model';

export const DEBUG_PINNED = 'Run data pinned. Fix the step, then test again.';
export const DEBUG_NO_TRIGGER = 'This run has no trigger data to pin.';

export interface DebugPlan {
  /** The trigger first, then the steps that worked, in run order. */
  pins: { nodeKey: string; output: unknown }[];
  /** The step to open in the Editor: the first that failed. */
  focusKey: string | null;
}

/**
 * What to pin. The trigger's output is its step row's, else the run's
 * trigger data. Steps that were cut to 64 KB are left out: half the data
 * would make tests lie.
 */
export function planDebug(
  model: Pick<RunModel, 'graph' | 'steps'>,
  triggerPayload: unknown,
  alsoSteps: boolean,
): DebugPlan | { error: string } {
  const graph = model.graph;
  const trigger = graph?.nodes.find((node) => isTriggerType(node.type));
  if (!graph || !trigger) return { error: DEBUG_NO_TRIGGER };

  const triggerStep = model.steps[trigger.key];
  const triggerOutput =
    triggerStep && triggerStep.output !== undefined && triggerStep.output !== null
      ? triggerStep.output
      : triggerPayload;
  if (triggerOutput === undefined || triggerOutput === null) return { error: DEBUG_NO_TRIGGER };

  const order = topologicalOrder(graph);
  const pins: DebugPlan['pins'] = [{ nodeKey: trigger.key, output: triggerOutput }];
  if (alsoSteps) {
    for (const key of order) {
      const step = model.steps[key];
      if (key === trigger.key || !step) continue;
      if (step.status !== 'SUCCEEDED' || step.truncated) continue;
      if (step.output === undefined || step.output === null) continue;
      pins.push({ nodeKey: key, output: step.output });
    }
  }

  const failed = order.find((key) => model.steps[key]?.status === 'FAILED');
  return { pins, focusKey: failed ?? null };
}

export interface PinResult {
  pinned: PinnedStep[];
  /** Step keys the API refused (not in the draft any more, too large). */
  skipped: string[];
}

type PinFn = typeof pinStepData;

/**
 * Saves each pin in turn. The trigger must succeed (its refusal is thrown);
 * a later step the API refuses is skipped, so one removed step does not
 * spoil the rest.
 */
export async function pinRunData(
  automationId: string,
  plan: DebugPlan,
  pin: PinFn = pinStepData,
): Promise<PinResult> {
  const pinned: PinnedStep[] = [];
  const skipped: string[] = [];
  for (const [index, item] of plan.pins.entries()) {
    try {
      const result = await pin(automationId, item.nodeKey, item.output);
      pinned.push(result.pinned);
    } catch (error) {
      if (index === 0) throw error;
      skipped.push(item.nodeKey);
    }
  }
  return { pinned, skipped };
}

/** The refusal of the trigger's pin, in a sentence. */
export function debugErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return 'The trigger of this run is no longer in the workflow, so its data cannot be pinned.';
    }
    if (error.code === 'pinned_too_large') {
      return 'The trigger data of this run is more than 64 KB, so it cannot be pinned.';
    }
    return error.message;
  }
  return 'The run data could not be pinned. Try again in a moment.';
}

export function skippedText(count: number): string | undefined {
  if (count === 0) return undefined;
  return count === 1
    ? '1 step could not be pinned: it is no longer in the workflow or its data is too large.'
    : `${count} steps could not be pinned: they are no longer in the workflow or their data is too large.`;
}
