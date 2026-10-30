import { listTemplates } from '@postgear/automation';
import {
  ago,
  deleteWorkflowWarning,
  lastRunText,
  ROW_ACTION_LABELS,
  rowActions,
  runsText,
  triggerText,
  usesText,
} from './workflows-view-model';

describe('workflows view model', () => {
  it('names the trigger, or says there is none yet', () => {
    expect(triggerText('trigger.postPublished')).toEqual({
      title: 'Post Published',
      icon: 'post-published',
    });
    expect(triggerText(null).title).toBe('No trigger yet');
    expect(triggerText('trigger.gone').title).toBe('Unknown trigger');
  });

  it('words the last run and the run count', () => {
    expect(lastRunText({ lastRunStatus: null })).toBeNull();
    expect(lastRunText({ lastRunStatus: 'FAILED' })).toEqual({
      label: 'Failed',
      variant: 'danger',
    });
    expect(runsText(0)).toBe('No runs');
    expect(runsText(1)).toBe('1 run');
    expect(runsText(14)).toBe('14 runs');
  });

  it('lists what each template uses', () => {
    const report = listTemplates().find((template) => template.id === 'publishing-report');
    expect(usesText(report ?? { needs: [] })).toBe('Uses: Google Sheets, Slack');
    expect(usesText({ needs: [] })).toBeNull();
  });

  it('warns before deleting a workflow that is on', () => {
    expect(deleteWorkflowWarning({ status: 'ACTIVE' })).toContain('It is on now');
    expect(deleteWorkflowWarning({ status: 'DRAFT' })).toBe(
      'Its runs are kept. This cannot be undone.',
    );
  });

  it('offers Activate or Pause in the row menu to admins only', () => {
    expect(rowActions({ status: 'DRAFT' }, true)).toEqual([
      'open',
      'duplicate',
      'activate',
      'delete',
    ]);
    expect(rowActions({ status: 'PAUSED' }, true)).toContain('activate');
    expect(rowActions({ status: 'ACTIVE' }, true)).toEqual([
      'open',
      'duplicate',
      'pause',
      'delete',
    ]);
    for (const status of ['DRAFT', 'ACTIVE', 'PAUSED'] as const) {
      expect(rowActions({ status }, false)).toEqual(['open', 'duplicate', 'delete']);
    }
    expect(
      rowActions({ status: 'ACTIVE' }, true).map((action) => ROW_ACTION_LABELS[action]),
    ).toEqual(['Open', 'Duplicate', 'Pause', 'Delete']);
  });

  it('says how long ago', () => {
    const now = Date.parse('2026-10-29T12:00:00.000Z');
    expect(ago('2026-10-29T11:59:30.000Z', now)).toBe('just now');
    expect(ago('2026-10-29T11:55:00.000Z', now)).toBe('5 minutes ago');
    expect(ago('2026-10-28T12:00:00.000Z', now)).toBe('yesterday');
  });
});
