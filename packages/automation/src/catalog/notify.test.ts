/**
 * Module 12's catalog pieces: the Notify forms, their live previews, the
 * Teams how-to notes and the Email recipient cap.
 */
import { LIMITS } from '../limits';
import { getDefinition } from './index';
import { TEAMS_NOTES } from './notify';
import type { NodeDefinition } from './types';

const def = (type: string) => getDefinition(type) as NodeDefinition;

describe('notify forms', () => {
  it.each([
    ['notify.slack', 'slack'],
    ['notify.teams', 'teams'],
    ['notify.discord', 'discord'],
    ['notify.email', 'email'],
  ])('%s draws the %s preview', (type, preview) => {
    expect(def(type).form?.preview).toBe(preview);
  });

  it('tells how to make the Teams link in two short steps and who posts', () => {
    const notes = def('notify.teams').form?.notes ?? [];
    expect(notes).toEqual(TEAMS_NOTES);
    expect(notes[0]).toContain('Send webhook alerts to a channel');
    expect(notes.some((note) => note.includes('Workflows bot'))).toBe(true);
  });

  it('asks Teams for a title, a message and a button link', () => {
    const configure = def('notify.teams').form?.tabs.configure.map((spec) => spec.path);
    expect(configure).toEqual(['title', 'message', 'includeLink']);
  });

  it('asks Email for recipients, a subject and a message', () => {
    const fields = def('notify.email').form?.tabs.configure ?? [];
    expect(fields.map((spec) => [spec.path, spec.kind])).toEqual([
      ['to', 'recipients'],
      ['subject', 'text'],
      ['message', 'longText'],
    ]);
    expect(fields[0].max).toBe(10);
  });
});

describe('the Email schema', () => {
  const schema = def('notify.email').configSchema;
  const people = (n: number) => Array.from({ length: n }, (_, i) => `p${i}@example.com`);

  it('takes up to 10 recipients and refuses 11', () => {
    expect(LIMITS.maxEmailRecipients).toBe(10);
    expect(schema.safeParse({ to: people(10), subject: 'Hi', message: 'Hello' }).success).toBe(
      true,
    );
    expect(schema.safeParse({ to: people(11), subject: 'Hi', message: 'Hello' }).success).toBe(
      false,
    );
  });

  it('caps workflow emails at 200 a day', () => {
    expect(LIMITS.workflowEmailsPerDay).toBe(200);
  });
});
