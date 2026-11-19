/**
 * What the operator's plan, override, usage and Change Log routes answer with
 * (Sprint 12, Module 19 section 8). The screen's own copy lives in the web
 * app; these are the API's refusals, in the words of the spec's copy table
 * where it has them (the conflict sentence).
 */
export const OPERATOR_ENTITLEMENT_MESSAGES = {
  CONFLICT:
    'Someone else changed these values while you were editing. Reload to see them, then edit again.',
  WORKSPACE_NOT_FOUND: 'This workspace is not here.',
  OVERRIDE_NOT_FOUND: 'This workspace has no override for that setting.',
  NOTHING_CHANGED: 'None of these values is different from what is saved.',
  NOT_A_METER: 'Only a usage meter can be adjusted.',
  ADJUST_BELOW_ZERO:
    'This would take usage below zero. To give more than the plan allows, add an override instead.',
} as const;
