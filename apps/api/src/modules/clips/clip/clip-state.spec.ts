/**
 * A clip's library state (Module 07 section 4): each rule on its own, and
 * the query form of the rules (`stateWhere`) agreeing with the row form
 * (`clipStateOf`) on every combination, so a card's badge always matches
 * the tab it is listed under.
 */
import type { ClipStatus } from '@postgear/db';
import { fieldRef, matches } from '../testing/fake-clip-db';
import {
  CLIP_STATES,
  CLIP_STATUS_FILTERS,
  clipStateOf,
  type RevisionField,
  stateWhere,
} from './clip-state';

const REVISION = fieldRef('revision') as unknown as RevisionField;

describe('clipStateOf', () => {
  const row = (status: ClipStatus, revision: number, lastExportedRevision: number | null) => ({
    status,
    revision,
    lastExportedRevision,
  });

  it('reads hidden first, whatever else is true', () => {
    expect(clipStateOf(row('HIDDEN', 2, 2), true)).toBe('hidden');
  });

  it('reads scheduled before exported', () => {
    expect(clipStateOf(row('DRAFT', 2, 2), true)).toBe('scheduled');
  });

  it('reads exported only when the export drew this very revision', () => {
    expect(clipStateOf(row('DRAFT', 2, 2), false)).toBe('exported');
    expect(clipStateOf(row('DRAFT', 3, 2), false)).toBe('draft');
  });

  it('reads new and draft from the status', () => {
    expect(clipStateOf(row('NEW', 1, null), false)).toBe('new');
    expect(clipStateOf(row('DRAFT', 1, null), false)).toBe('draft');
  });
});

describe('stateWhere', () => {
  const statuses: ClipStatus[] = ['NEW', 'DRAFT', 'HIDDEN'];
  const exports: Array<number | null> = [null, 1, 2];
  const cases = statuses.flatMap((status) =>
    exports.flatMap((lastExportedRevision) =>
      [false, true].map((scheduled) => ({ status, lastExportedRevision, scheduled })),
    ),
  );

  it.each(CLIP_STATUS_FILTERS)('selects exactly the clips whose state is %s', (filter) => {
    const where = stateWhere(filter, ['waiting-group'], REVISION);
    for (const facts of cases) {
      const clip = {
        status: facts.status,
        revision: 2,
        lastExportedRevision: facts.lastExportedRevision,
      };
      const posts = facts.scheduled
        ? [{ postGroup: 'waiting-group' }, { postGroup: 'sent-group' }]
        : [{ postGroup: 'sent-group' }];
      const selected = matches(clip, where, (_row, key) => (key === 'posts' ? posts : undefined));
      const state = clipStateOf(clip, facts.scheduled);
      const expected = filter === 'all' ? state !== 'hidden' : state === filter;
      expect({ facts, selected }).toEqual({ facts, selected: expected });
    }
  });

  it('lists every state the web can filter on', () => {
    expect(CLIP_STATUS_FILTERS).toEqual(['all', ...CLIP_STATES]);
  });

  it('writes "never exported" out loud, since NOT (NULL = n) is not true in SQL', () => {
    expect(stateWhere('draft', [], REVISION)).toMatchObject({
      OR: [{ lastExportedRevision: null }, { NOT: { lastExportedRevision: { equals: REVISION } } }],
    });
  });
});
