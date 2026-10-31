import type { Connection } from '@/types/workflows';
import {
  checkNote,
  connectErrorMessage,
  credentialsFrom,
  deleteWarning,
  emptyConnectionForm,
  isSimulated,
  searchConnections,
  usedByText,
  validateConnectionForm,
} from './connections-view-model';

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'c1',
    provider: 'slack',
    name: 'Marketing Slack',
    status: 'CONNECTED',
    maskedHint: 'hooks.slack.com/...1234',
    meta: null,
    lastCheckedAt: null,
    lastError: null,
    createdAt: '2026-10-29T00:00:00.000Z',
    updatedAt: '2026-10-29T00:00:00.000Z',
    usedBy: [],
    ...overrides,
  };
}

describe('connections view model', () => {
  it('never calls a webhook link checked', () => {
    expect(checkNote(connection())).toBe('Saved, not checked');
    expect(checkNote(connection({ provider: 'teams' }))).toBe('Saved, not checked');
    expect(checkNote(connection({ provider: 'http' }))).toBeNull();
    // A broken one shows its status and error instead.
    expect(checkNote(connection({ status: 'NEEDS_RECONNECT' }))).toBeNull();
  });

  it('counts the workflows using it', () => {
    expect(usedByText(0)).toBe('Not used yet');
    expect(usedByText(1)).toBe('Used by 1 workflow');
    expect(usedByText(3)).toBe('Used by 3 workflows');
  });

  it('names the workflows in the delete warning, live ones first', () => {
    expect(deleteWarning(connection())).toBe('No workflow uses it. This cannot be undone.');
    expect(
      deleteWarning(connection({ usedBy: [{ id: 'w1', name: 'Weekly Report', live: false }] })),
    ).toContain('Weekly Report');
    expect(
      deleteWarning(
        connection({
          usedBy: [
            { id: 'w1', name: 'Weekly Report', live: true },
            { id: 'w2', name: 'Draft', live: false },
          ],
        }),
      ),
    ).toBe('It cannot be deleted while these workflows are on: Weekly Report. Pause them first.');
  });

  it('searches by name and app', () => {
    const list = [connection(), connection({ id: 'c2', provider: 'discord', name: 'Community' })];
    expect(searchConnections(list, 'discord').map((c) => c.id)).toEqual(['c2']);
    expect(searchConnections(list, 'marketing slack').map((c) => c.id)).toEqual(['c1']);
    expect(searchConnections(list, '  ')).toHaveLength(2);
  });

  it('catches the obvious form mistakes', () => {
    const empty = emptyConnectionForm();
    expect(validateConnectionForm('slack', empty)).toEqual({
      name: 'Enter a name for this connection.',
      link: 'Enter your Slack link.',
    });
    expect(
      validateConnectionForm('discord', { ...empty, name: 'Community', link: 'http://x' }),
    ).toEqual({ link: 'Use a link that starts with https://.' });
    expect(validateConnectionForm('http', { ...empty, name: 'API', headers: [] })).toEqual({
      headers: 'Add at least one secret header.',
    });
    // The form starts with an Authorization row waiting for its value.
    expect(validateConnectionForm('http', { ...empty, name: 'API' })).toEqual({
      headers: 'Give every header a name and a value.',
    });
    expect(
      validateConnectionForm('http', {
        ...empty,
        name: 'API',
        headers: [{ name: '', value: 'k' }],
      }),
    ).toEqual({ headers: 'Give every header a name and a value.' });
    // A rename checks the name only.
    expect(validateConnectionForm('slack', { ...empty, name: 'New' }, { details: false })).toEqual(
      {},
    );
  });

  it('sends only what the app takes', () => {
    expect(credentialsFrom('slack', { ...emptyConnectionForm(), link: ' https://x ' })).toEqual({
      webhookUrl: 'https://x',
    });
    expect(
      credentialsFrom('http', {
        ...emptyConnectionForm(),
        headers: [
          { name: ' X-Key ', value: 'k ' },
          { name: '', value: '' },
        ],
      }),
    ).toEqual({ headers: [{ name: 'X-Key', value: 'k ' }] });
  });

  it('words the OAuth callback errors', () => {
    expect(connectErrorMessage(null)).toBeNull();
    expect(connectErrorMessage('not_admin')).toBe('Only workspace admins can connect apps.');
    expect(connectErrorMessage('anything')).toBe('The app did not finish connecting. Try again.');
  });
});

describe('isSimulated', () => {
  it('reads the simulated flag a stand-in connection carries', () => {
    expect(isSimulated({ meta: { simulated: true } })).toBe(true);
    expect(isSimulated({ meta: { simulated: 'yes' } })).toBe(false);
    expect(isSimulated({ meta: null })).toBe(false);
  });
});
