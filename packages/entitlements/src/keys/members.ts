/**
 * The member keys (Sprint 13, Module 14): seats a workspace may fill.
 *
 * Only Editor seats are counted. `members.max` from research 10 stays
 * unenforced, so it is not a key. The values per plan are `PlanEntitlement`
 * rows seeded by the migration `20261128140100_sprint13_editor_seats_seed`
 * and mirrored in `seed.ts`; a test keeps the three in step.
 */
import type { EntitlementDef } from '../registry';

/** Every member key, in the order the operator's table shows them. */
export const MEMBERS_ENTITLEMENTS = {
  'members.editors_max': {
    key: 'members.editors_max',
    group: 'members',
    label: 'Editor Seats',
    description: 'Editors the workspace can have at once. Admins and members are not counted.',
    type: 'number',
    unit: 'count',
    default: 0,
    min: 0,
    max: 1000,
    integer: true,
    noun: { one: 'editor seat', other: 'editor seats' },
    scope: 'both',
    editors: 'operator',
    refusalCode: 'members_editor_seats_full',
  },
} as const satisfies Record<string, EntitlementDef>;
