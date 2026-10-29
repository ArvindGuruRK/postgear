import { LIMITS } from '../../limits';
import { scheduleIntervalMinutes } from '../../schedule/next-runs';
import { scheduleConfigSchema } from '../../schedule/schema';
import type { ValidationRule } from '../types';

function howOften(minutes: number): string {
  if (minutes === 60) return 'once an hour';
  if (minutes % 60 === 0) return `once every ${minutes / 60} hours`;
  return `once every ${minutes} minutes`;
}

/**
 * AI steps cost credits on every run, so a Schedule may not run them more
 * often than `minMinutes` apart. Today's fastest schedule is hourly, so
 * with the default 60 minutes this guards any faster option added later.
 */
export function aiScheduleLimit(minMinutes: number): ValidationRule {
  return (graph, index) => {
    const trigger = index.triggers[0];
    if (trigger?.type !== 'trigger.schedule') return [];
    const hasAi = graph.nodes.some((node) => !node.disabled && node.type.startsWith('ai.'));
    if (!hasAi) return [];
    const parsed = scheduleConfigSchema.safeParse(trigger.config);
    if (!parsed.success || scheduleIntervalMinutes(parsed.data) >= minMinutes) return [];
    return [
      {
        severity: 'error',
        code: 'schedule.too_frequent_for_ai',
        message: `Workflows with AI steps can run at most ${howOften(minMinutes)}.`,
        nodeKey: trigger.key,
        field: parsed.data.frequency === 'hourly' ? 'everyHours' : 'frequency',
      },
    ];
  };
}

export const scheduleFitsAi = aiScheduleLimit(LIMITS.minScheduleMinutesWithAi);
