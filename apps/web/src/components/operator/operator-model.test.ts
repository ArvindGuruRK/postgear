/**
 * The operator screens' words and rules (Sprint 12, Module 19 Part B): the
 * spec's exact copy, the Plans drafts and their review lines, inline errors
 * in the registry's own words, the lower-tier warning, the override end date
 * cap, and the query strings the lists send.
 */
import { getDef, KEYS, type Key, seedValue, TIERS, type Tier } from '@postgear/entitlements';
import type { PlanCell, PlansView } from '@/types/operator';
import { type ChangeFilters, changesQuery } from './change-log-tab';
import { emptyItemFilters, itemsQuery } from './library-items';
import {
  adjustAmountLabel,
  adjustmentKey,
  belowZeroProblem,
  CREDIT_GROUP_NAMES,
  categoryName,
  cellId,
  changesWaiting,
  type Drafts,
  draftErrors,
  durationLabel,
  endingSoonSentence,
  ITEM_ACTION_NAMES,
  itemActions,
  LIBRARY_VIEW_NAMES,
  lowerTierWarnings,
  meterAmount,
  OPERATOR_COPY,
  OPERATOR_TAB_NAMES,
  overrideDateBounds,
  overrideEndsAt,
  parseNumberText,
  planWrites,
  publishRunSentence,
  reasonError,
  rejectionsSentence,
  reviewLines,
  savedSentence,
  seedHint,
  usageSentence,
  withDraft,
  withoutDraft,
} from './operator-model';

/** Every tier and key at its seeded value, as `GET /operator/entitlements/plans` reads on a fresh database. */
function seededPlans(): PlansView {
  const cells: PlanCell[] = TIERS.flatMap((tier) =>
    KEYS.map((key) => ({
      tier,
      key,
      value: seedValue(tier, key),
      seed: seedValue(tier, key),
      updatedAt: `${tier}-${key}-at`,
      valid: true,
    })),
  );
  return {
    tiers: [...TIERS],
    keys: KEYS.map((key) => ({
      key,
      label: getDef(key)?.label ?? key,
      group: 'clips',
      description: '',
    })),
    cells,
    endingSoon: [],
  };
}

function cellOf(plans: PlansView, tier: Tier, key: Key): PlanCell {
  const cell = plans.cells.find((item) => item.tier === tier && item.key === key);
  if (!cell) throw new Error(`no cell ${tier} ${key}`);
  return cell;
}

describe('the exact copy', () => {
  it('names the six tabs and the library views in Title Case', () => {
    expect(Object.values(OPERATOR_TAB_NAMES)).toEqual([
      'Plans',
      'Workspace Overrides',
      'Usage',
      'Costs',
      'Change Log',
      'Library',
    ]);
    expect(Object.values(LIBRARY_VIEW_NAMES)).toEqual([
      'Runs',
      'Sounds',
      'Stickers',
      'Deny List',
      'Gaps',
      'Credits',
    ]);
    expect(Object.values(CREDIT_GROUP_NAMES)).toEqual([
      'Attribution Required',
      'Notices',
      'Public Domain And CC0',
      "PostGear's Own",
    ]);
    expect(Object.values(ITEM_ACTION_NAMES)).toEqual([
      'Publish Item',
      'Hide Item',
      'Restore Item',
      'Remove Item',
    ]);
  });

  it('keeps the spec sentences word for word', () => {
    expect(OPERATOR_COPY.plansBanner).toBe(
      'These values apply to every workspace on a plan, within a few seconds of saving. Edits to a plan never delete anything a workspace already has.',
    );
    expect(OPERATOR_COPY.conflict).toBe(
      'Someone else changed these values while you were editing. Reload to see them, then edit again.',
    );
    expect(OPERATOR_COPY.reasonLabel).toBe('Reason for this change');
    expect(OPERATOR_COPY.reasonPlaceholder).toBe('Enter your reason');
    expect(OPERATOR_COPY.reasonHelp).toBe('At least 10 characters. It goes in the Change Log.');
    expect(OPERATOR_COPY.endsOnHelp).toBe('Required. At most 366 days from today.');
    expect(OPERATOR_COPY.removeOverride).toBe(
      'This workspace goes back to the value of its plan, now.',
    );
    expect(OPERATOR_COPY.searchPlaceholder).toBe('Enter your workspace name, id or admin email');
    expect(OPERATOR_COPY.noWorkspace).toBe('No workspace matches that.');
    expect(OPERATOR_COPY.noOverrides).toBe(
      'This workspace has no overrides. It uses the values of its plan.',
    );
    expect(OPERATOR_COPY.noUsage).toBe('No usage this cycle.');
    expect(OPERATOR_COPY.noChanges).toBe('Nothing has been changed yet.');
    expect(OPERATOR_COPY.adjustWarning).toBe(
      'This writes a permanent ledger entry and a Change Log entry. It cannot be edited, only reversed with another adjustment.',
    );
    expect(OPERATOR_COPY.publishTick).toBe('I listened to a sample and checked the licences.');
    expect(OPERATOR_COPY.creditLineMissing).toBe(
      'This source needs a credit line before its items are published.',
    );
  });

  it('counts in sentences, one and many', () => {
    expect(changesWaiting(3)).toBe('3 changes waiting');
    expect(changesWaiting(1)).toBe('1 change waiting');
    expect(savedSentence(3)).toBe('Saved 3 changes. They are live now.');
    expect(savedSentence(1)).toBe('Saved 1 change. It is live now.');
    expect(endingSoonSentence(2)).toBe('2 overrides end within 7 days.');
    expect(endingSoonSentence(1)).toBe('1 override ends within 7 days.');
    expect(publishRunSentence(120)).toBe(
      'Publish 120 items from this run? They become visible to every workspace.',
    );
    expect(usageSentence(4)).toBe('4 clips use this item.');
    expect(usageSentence(1)).toBe('1 clip uses this item.');
    expect(usageSentence(0)).toBe('No clips use this item.');
    expect(
      rejectionsSentence([
        { reason: 'licence_not_allowed', count: 41 },
        { reason: 'brand_name', count: 6 },
      ]),
    ).toBe('licence not allowed 41, brand name 6');
  });

  it('writes no em dash or middle dot anywhere in the copy', () => {
    const banned = new RegExp(`[${String.fromCodePoint(0x2014)}${String.fromCodePoint(0xb7)}]`);
    for (const text of Object.values(OPERATOR_COPY)) expect(text).not.toMatch(banned);
  });
});

describe('Plans drafts', () => {
  it('reads each waiting change as "Clips Storage, Pro: 50 GB to 60 GB"', () => {
    const plans = seededPlans();
    const storage = cellOf(plans, 'PRO', 'clips.storage_gb');
    const drafts = withDraft({}, storage, { kind: 'set', value: 60 });
    expect(reviewLines(plans, drafts).map((line) => line.text)).toEqual([
      'Clips Storage, Pro: 50 GB to 60 GB',
    ]);
    expect(changesWaiting(Object.keys(drafts).length)).toBe('1 change waiting');
  });

  it('drops a draft that puts the saved value back, so the count only counts real changes', () => {
    const plans = seededPlans();
    const storage = cellOf(plans, 'PRO', 'clips.storage_gb');
    const once = withDraft({}, storage, { kind: 'set', value: 60 });
    expect(Object.keys(once)).toHaveLength(1);
    expect(withDraft(once, storage, { kind: 'set', value: 50 })).toEqual({});
    expect(withoutDraft(once, storage)).toEqual({});
  });

  it('marks a reset to the seed in the review', () => {
    const plans = seededPlans();
    const minutes = cellOf(plans, 'STANDARD', 'clips.max_video_minutes');
    const stored = {
      ...plans,
      cells: plans.cells.map((cell) => (cell === minutes ? { ...cell, value: 240 } : cell)),
    };
    const drafts: Drafts = { [cellId('STANDARD', 'clips.max_video_minutes')]: { kind: 'reset' } };
    expect(reviewLines(stored, drafts)[0]?.text).toBe(
      'Longest Video, Standard: 240 minutes to 180 minutes (seed)',
    );
    expect(planWrites(stored, drafts)).toEqual([
      {
        tier: 'STANDARD',
        key: 'clips.max_video_minutes',
        reset: true,
        updatedAt: 'STANDARD-clips.max_video_minutes-at',
      },
    ]);
  });

  it('sends each cell with the updatedAt it was read with, and no empty value', () => {
    const plans = seededPlans();
    const drafts: Drafts = {
      [cellId('PRO', 'clips.storage_gb')]: { kind: 'set', value: 60 },
      [cellId('FREE', 'clips.storage_gb')]: { kind: 'set', value: undefined },
    };
    expect(planWrites(plans, drafts)).toEqual([
      { tier: 'PRO', key: 'clips.storage_gb', value: 60, updatedAt: 'PRO-clips.storage_gb-at' },
    ]);
  });

  it('shows the registry sentences inline', () => {
    const plans = seededPlans();
    const errors = draftErrors(plans, {
      [cellId('PRO', 'clips.max_video_minutes')]: { kind: 'set', value: 1441 },
      [cellId('PRO', 'clips.storage_gb')]: { kind: 'set', value: undefined },
      [cellId('PRO', 'clips.export_max_quality')]: { kind: 'set', value: '4k' },
      [cellId('FREE', 'clips.storage_gb')]: { kind: 'reset' },
    });
    expect(errors).toEqual({
      [cellId('PRO', 'clips.max_video_minutes')]: 'Enter a whole number from 1 to 1,440.',
      [cellId('PRO', 'clips.storage_gb')]: 'This plan value cannot be empty.',
      [cellId('PRO', 'clips.export_max_quality')]: '4K is reserved and cannot be saved yet.',
    });
  });

  it('reads number text with commas, and an empty field as no value', () => {
    expect(parseNumberText('1,440')).toBe(1440);
    expect(parseNumberText('  ')).toBeUndefined();
    expect(parseNumberText('abc')).toBeNaN();
  });

  it('hints the seed beside a cell that differs from it', () => {
    expect(seedHint('clips.max_video_minutes', 240, 180)).toBe('Seed 180');
    expect(seedHint('clips.max_video_minutes', 180, 180)).toBeNull();
    expect(seedHint('clips.enabled', false, true)).toBe('Seed On');
    expect(seedHint('clips.import_minutes_per_month', 500, null)).toBe('Seed Unlimited');
  });

  it('warns when a higher tier would have less than the one below it, and never on the seed', () => {
    const plans = seededPlans();
    expect(lowerTierWarnings(plans, {})).toEqual([]);
    const drafts = withDraft({}, cellOf(plans, 'PRO', 'clips.storage_gb'), {
      kind: 'set',
      value: 10,
    });
    expect(lowerTierWarnings(plans, drafts)).toEqual([
      'Pro now has less than Standard for Clips Storage. Check this is on purpose.',
    ]);
  });

  it('leaves a value that cannot be saved to its own inline error, not a tier warning', () => {
    const plans = seededPlans();
    const drafts = withDraft({}, cellOf(plans, 'STANDARD', 'clips.max_video_minutes'), {
      kind: 'set',
      value: 1441,
    });
    expect(lowerTierWarnings(plans, drafts)).toEqual([]);
  });

  it('names a category by its catalogue name', () => {
    expect(categoryName('sticker', 'arrows-shapes')).toBe('Arrows And Shapes');
    expect(categoryName('sound', 'no-such-category')).toBe('no-such-category');
  });
});

describe('reasons, dates and adjustments', () => {
  it('wants a reason of at least 10 characters', () => {
    expect(reasonError('too short')).toBe(OPERATOR_COPY.reasonHelp);
    expect(reasonError('  Customer asked for more room  ')).toBeNull();
    expect(reasonError('x'.repeat(501))).toBe('Keep the reason under 500 characters.');
  });

  it('lets an override end from tomorrow to at most 366 days ahead', () => {
    const now = new Date(2026, 10, 19, 15, 30);
    const { min, max } = overrideDateBounds(now);
    expect(min).toEqual(new Date(2026, 10, 20));
    expect(max).toEqual(new Date(2027, 10, 20));
    expect(overrideEndsAt(new Date(2026, 11, 1, 18, 0), now)).toBe(
      new Date(2026, 11, 1).toISOString(),
    );
    // A day past the cap is pulled back to the cap.
    const cap = new Date(now.getTime() + 366 * 24 * 60 * 60 * 1000);
    expect(overrideEndsAt(new Date(2028, 0, 1), now)).toBe(cap.toISOString());
  });

  it('makes a fresh idempotency key each time', () => {
    const first = adjustmentKey();
    expect(first).toMatch(/^adj:[0-9a-f-]{16,}$/);
    expect(adjustmentKey()).not.toBe(first);
  });

  it('names the amount by the meter, and shows fractions of a minute', () => {
    expect(adjustAmountLabel('clips.ai_minutes_per_month')).toBe('Minutes to add or take back');
    expect(meterAmount('clips.ai_minutes_per_month', 12.5)).toBe('12.5 minutes');
    expect(meterAmount('clips.ai_minutes_per_month', 1)).toBe('1 minute');
  });
});

describe('query strings', () => {
  it('sends only the change log filters that are set', () => {
    const all: ChangeFilters = { scope: 'all', key: 'all', orgId: '', actor: '' };
    expect(changesQuery(all, 1)).toBe('');
    const some: ChangeFilters = {
      scope: 'ORG',
      key: 'clips.storage_gb',
      orgId: ' org-1 ',
      actor: 'ops@postgear.local',
    };
    const query = changesQuery(some, 3);
    expect(query.startsWith('?')).toBe(true);
    const params = new URLSearchParams(query);
    expect(params.get('scope')).toBe('ORG');
    expect(params.get('key')).toBe('clips.storage_gb');
    expect(params.get('orgId')).toBe('org-1');
    expect(params.get('actor')).toBe('ops@postgear.local');
    expect(params.get('page')).toBe('3');
  });

  it('opens Review Items on the run, staged only, and sends every set filter', () => {
    const fromRun = emptyItemFilters('7a1c2a8e-8f43-4c55-9a5c-0e3a7f2d6b11');
    expect(fromRun.status).toBe('STAGED');
    expect(itemsQuery('sound', fromRun, 1)).toBe(
      'type=sound&status=STAGED&runId=7a1c2a8e-8f43-4c55-9a5c-0e3a7f2d6b11',
    );
    const searched = { ...emptyItemFilters(), q: '  whoosh ', kind: 'sfx', origin: 'kenney' };
    expect(itemsQuery('sound', searched, 2)).toBe(
      'type=sound&kind=sfx&origin=kenney&q=whoosh&page=2',
    );
  });
});

describe('the library', () => {
  it('offers the actions each status allows', () => {
    expect(itemActions('STAGED')).toEqual(['publish', 'hide', 'remove']);
    expect(itemActions('ACTIVE')).toEqual(['hide', 'remove']);
    expect(itemActions('HIDDEN')).toEqual(['restore', 'remove']);
    expect(itemActions('REMOVED')).toEqual([]);
  });

  it('shows a sound length as minutes and seconds', () => {
    expect(durationLabel(42_000)).toBe('0:42');
    expect(durationLabel(725_000)).toBe('12:05');
    expect(durationLabel(null)).toBe('');
  });
});

describe('belowZeroProblem', () => {
  it('lets an adjustment through that adds use or stays at or above zero', () => {
    expect(belowZeroProblem(10, 0)).toBeNull();
    expect(belowZeroProblem(-12, 12)).toBeNull();
    expect(belowZeroProblem(-3, undefined)).toBeNull();
  });

  it('refuses giving back more than this cycle used, naming the most it can be', () => {
    expect(belowZeroProblem(-13, 12.5)).toBe(
      'This would take usage below zero. Give back at most 12, or add an override to give more.',
    );
    expect(belowZeroProblem(-2_000, 1_500)).toContain('at most 1,500');
    expect(belowZeroProblem(-1, 0)).toBe(
      'Nothing is used this cycle, so there is nothing to give back. To give more, add an override.',
    );
  });
});
