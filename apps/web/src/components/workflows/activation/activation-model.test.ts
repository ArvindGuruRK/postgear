import {
  type AutomationGraph,
  edgeId,
  GRAPH_SCHEMA_VERSION,
  type GraphEdge,
  type GraphNode,
  type PortId,
  type ValidationIssue,
} from '@postgear/automation';
import { ApiError } from '@/lib/api';
import type { CatalogEntry } from '@/types/workflows';
import {
  ADMINS_ONLY,
  activatedToast,
  activateFailure,
  activationContent,
  activationIssues,
  canRunNow,
  canTurnOn,
  creditsText,
  discardFailure,
  manualFields,
  manualPlaceholder,
  NOT_SAVED,
  PAUSE_NO_CATCH_UP,
  PAUSE_RUNS_FINISH,
  pauseFailure,
  pauseLines,
  readManualInputs,
  restoreFailure,
  STALE,
  saveFirstFailure,
  showsUnpublishedChanges,
  statusBadge,
  TURNED_ON,
  versionByline,
} from './activation-model';

function node(key: string, type: string, config: Record<string, unknown> = {}): GraphNode {
  return { key, type, typeVersion: 1, name: key, position: { x: 0, y: 0 }, config };
}

function edge(source: string, target: string, sourcePort: PortId = 'out'): GraphEdge {
  return { id: edgeId(source, sourcePort, target), source, sourcePort, target, targetPort: 'in' };
}

function graphOf(nodes: GraphNode[], edges: GraphEdge[]): AutomationGraph {
  return { schemaVersion: GRAPH_SCHEMA_VERSION, nodes, edges, notes: [] };
}

const NOW = '2026-10-29T12:00:00.000Z';

const notifyOnPublish = graphOf(
  [node('trigger', 'trigger.postPublished'), node('notify', 'notify.inApp', { message: 'Hi' })],
  [edge('trigger', 'notify')],
);

const issue = (severity: ValidationIssue['severity'], nodeKey = 'notify'): ValidationIssue => ({
  severity,
  code: 'node.required_missing',
  message: severity === 'error' ? 'Add a message.' : 'This may be empty.',
  nodeKey,
});

describe('activation dialog content', () => {
  it('lists the errors instead of the confirm, and ignores warnings', () => {
    const content = activationContent(notifyOnPublish, [issue('warning'), issue('error')], {
      nowIso: NOW,
    });
    expect(content).toEqual({ kind: 'issues', issues: [issue('error')] });
    expect(activationContent(notifyOnPublish, [issue('warning')], { nowIso: NOW }).kind).toBe(
      'confirm',
    );
  });

  it('says what the workflow does, with no credits, schedule or tick for a plain one', () => {
    const content = activationContent(notifyOnPublish, [], { nowIso: NOW });
    expect(content).toEqual({
      kind: 'confirm',
      sentence: 'When a post is published, this workflow will send an in-app notification.',
      credits: null,
      scheduleRuns: [],
      needsTick: false,
    });
  });

  it('shows the AI credits a run can use', () => {
    const graph = graphOf(
      [node('trigger', 'trigger.manual', { fields: [] }), node('image', 'ai.generateImage')],
      [edge('trigger', 'image')],
    );
    const content = activationContent(graph, [], { nowIso: NOW });
    expect(content.kind === 'confirm' && content.credits).toBe('Uses about 10 AI credits per run.');
    expect(creditsText(0)).toBeNull();
    expect(creditsText(1)).toBe('Uses about 1 AI credit per run.');
    expect(creditsText(12)).toContain('Uses about 12 AI credits per run');
  });

  it('lists the next three runs of a schedule in its own zone', () => {
    const graph = graphOf(
      [
        node('trigger', 'trigger.schedule', { frequency: 'daily', time: '09:00', timeZone: 'UTC' }),
        node('notify', 'notify.inApp', { message: 'Hi' }),
      ],
      [edge('trigger', 'notify')],
    );
    const content = activationContent(graph, [], { nowIso: NOW, locale: 'en-GB' });
    if (content.kind !== 'confirm') throw new Error('expected the confirm');
    expect(content.scheduleRuns).toHaveLength(3);
    expect(content.scheduleRuns[0]).toContain('30 October');
    expect(content.scheduleRuns.every((run) => run.includes('09:00'))).toBe(true);
  });

  it('asks for the tick when a post goes out without a review', () => {
    const unreviewed = graphOf(
      [node('trigger', 'trigger.manual', { fields: [] }), node('publish', 'postgear.publish')],
      [edge('trigger', 'publish')],
    );
    const content = activationContent(unreviewed, [], { nowIso: NOW });
    expect(content.kind === 'confirm' && content.needsTick).toBe(true);

    const reviewed = graphOf(
      [
        node('trigger', 'trigger.manual', { fields: [] }),
        node('review', 'logic.manualReview'),
        node('publish', 'postgear.publish'),
      ],
      [edge('trigger', 'review'), edge('review', 'publish', 'approved')],
    );
    const safe = activationContent(reviewed, [], { nowIso: NOW });
    expect(safe.kind === 'confirm' && safe.needsTick).toBe(false);
  });

  it('keeps Turn On disabled until the tick, and while it works', () => {
    expect(canTurnOn(true, false, false)).toBe(false);
    expect(canTurnOn(true, true, false)).toBe(true);
    expect(canTurnOn(false, false, false)).toBe(true);
    expect(canTurnOn(false, false, true)).toBe(false);
  });

  it('adds the steps the worker cannot run yet from the catalog', () => {
    const entry = (type: string, runnable: boolean): CatalogEntry =>
      ({ type, title: 'In-App Notification', runnable, reason: null }) as CatalogEntry;
    const issues = activationIssues(notifyOnPublish, [], {
      steps: [entry('trigger.postPublished', true), entry('notify.inApp', false)],
    });
    expect(issues).toEqual([
      {
        severity: 'error',
        code: 'node.not_runnable',
        message: 'In-App Notification cannot run yet.',
        nodeKey: 'notify',
      },
    ]);
    expect(activationIssues(notifyOnPublish, [issue('warning')], null)).toEqual([issue('warning')]);
  });
});

describe('live state words', () => {
  it('names the live version on the badge', () => {
    expect(statusBadge('ACTIVE', 3)).toEqual({ label: 'Active v3', variant: 'success' });
    expect(statusBadge('DRAFT', null).label).toBe('Draft');
    expect(statusBadge('PAUSED', 2).label).toBe('Paused');
  });

  it('shows Unpublished Changes only once there is a live version', () => {
    expect(showsUnpublishedChanges({ status: 'ACTIVE', hasUnpublishedChanges: true })).toBe(true);
    expect(showsUnpublishedChanges({ status: 'PAUSED', hasUnpublishedChanges: true })).toBe(true);
    expect(showsUnpublishedChanges({ status: 'DRAFT', hasUnpublishedChanges: true })).toBe(false);
    expect(showsUnpublishedChanges({ status: 'ACTIVE', hasUnpublishedChanges: false })).toBe(false);
  });

  it('offers Run Now for an active Manual workflow only', () => {
    const manual = graphOf([node('trigger', 'trigger.manual', { fields: [] })], []);
    expect(canRunNow('ACTIVE', manual)).toBe(true);
    expect(canRunNow('PAUSED', manual)).toBe(false);
    expect(canRunNow('ACTIVE', notifyOnPublish)).toBe(false);
  });

  it('adds the no catch-up sentence to pausing a schedule', () => {
    expect(pauseLines('trigger.schedule')).toEqual([PAUSE_RUNS_FINISH, PAUSE_NO_CATCH_UP]);
    expect(pauseLines('trigger.postPublished')).toEqual([PAUSE_RUNS_FINISH]);
    expect(PAUSE_NO_CATCH_UP).toBe('Missed runs will not be caught up when you turn it back on.');
  });

  it('words the success toast', () => {
    expect(activatedToast(false, 1)).toBe(TURNED_ON);
    expect(TURNED_ON).toBe('Workflow turned on.');
    expect(activatedToast(true, 4)).toBe('Version 4 is live.');
  });

  it('says who turned a version on and when', () => {
    const now = Date.parse(NOW);
    expect(
      versionByline(
        { createdAt: '2026-10-29T10:00:00.000Z', createdBy: { id: 'u1', name: 'Priya' } },
        now,
      ),
    ).toBe('Turned on by Priya, 2 hours ago');
    expect(versionByline({ createdAt: '2026-10-28T12:00:00.000Z', createdBy: null }, now)).toBe(
      'Turned on yesterday',
    );
  });
});

describe('refusals', () => {
  it('words each activate refusal', () => {
    expect(activateFailure(new ApiError('Forbidden', 403))).toEqual({
      message: ADMINS_ONLY,
      needsTick: false,
    });
    expect(activateFailure(new ApiError('Stale', 409, 'automation_conflict')).message).toBe(STALE);
    expect(
      activateFailure(new ApiError('Fix 2 issues first.', 422, 'activation_blocked')).message,
    ).toBe('Fix 2 issues first.');
    expect(
      activateFailure(
        new ApiError(
          'Confirm that posts will go out automatically.',
          422,
          'confirm_automatic_posting',
        ),
      ),
    ).toEqual({ message: 'Confirm that posts will go out automatically.', needsTick: true });
    expect(
      activateFailure(new ApiError('Every 30 minutes is too often.', 422, 'schedule_too_frequent'))
        .message,
    ).toBe('Every 30 minutes is too often.');
    expect(activateFailure(new TypeError('Failed to fetch')).message).toBe(
      'The workflow was not turned on. Try again.',
    );
  });

  it('words the other refusals', () => {
    expect(saveFirstFailure(new ApiError('Conflict', 409))).toBe(STALE);
    expect(saveFirstFailure(new Error('offline'))).toBe(NOT_SAVED);
    expect(pauseFailure(new ApiError('Forbidden', 403))).toBe(
      'Only workspace admins can pause workflows.',
    );
    expect(discardFailure(new ApiError('', 409, 'no_active_version'))).toBe(
      'There is no live version to go back to.',
    );
    expect(restoreFailure(new ApiError('Conflict', 409, 'automation_conflict'))).toBe(STALE);
  });
});

describe('manual trigger fields', () => {
  const trigger = node('trigger', 'trigger.manual', {
    fields: [
      { key: 'topic', label: 'Topic', type: 'text', required: true },
      { key: 'count', label: 'Count', type: 'number' },
      { key: 'tone', label: 'Tone', type: 'choice', options: ['Warm', 'Bold'], required: true },
      { label: 'No key' },
    ],
  });

  it('reads the fields, skipping broken ones', () => {
    expect(manualFields(trigger)).toEqual([
      { key: 'topic', label: 'Topic', type: 'text', required: true, options: [] },
      { key: 'count', label: 'Count', type: 'number', required: false, options: [] },
      { key: 'tone', label: 'Tone', type: 'choice', required: true, options: ['Warm', 'Bold'] },
    ]);
    expect(manualFields(node('trigger', 'trigger.schedule'))).toEqual([]);
    expect(manualPlaceholder({ label: 'Topic' })).toBe('Enter your topic');
  });

  it('checks required fields and numbers, and sends numbers as numbers', () => {
    const fields = manualFields(trigger);
    expect(readManualInputs(fields, { count: 'many' })).toEqual({
      ok: false,
      errors: { topic: 'Fill in topic.', count: 'Enter a number.', tone: 'Fill in tone.' },
    });
    expect(readManualInputs(fields, { topic: ' Launch ', tone: 'Bold', count: '3' })).toEqual({
      ok: true,
      inputs: { topic: 'Launch', tone: 'Bold', count: 3 },
    });
    expect(readManualInputs(fields, { topic: 'Launch', tone: 'Warm', count: '' })).toEqual({
      ok: true,
      inputs: { topic: 'Launch', tone: 'Warm' },
    });
  });
});
