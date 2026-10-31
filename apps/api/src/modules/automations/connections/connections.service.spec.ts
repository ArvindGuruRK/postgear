/**
 * Connections against an in-memory table that keeps the encrypted column,
 * with the real context service doing the Used By scan:
 *
 * - the stored `credentials` are ciphertext and decrypt back;
 * - no response (list, create, patch, check) holds `credentials` or any
 *   part of the link's token;
 * - another workspace's connection is not found, and a graph naming it is
 *   a missing connection to validation;
 * - delete is refused while a workflow that is on uses it.
 */
import type { ConfigService } from '@nestjs/config';
import {
  type AutomationGraph,
  getTemplate,
  instantiateTemplate,
  validateGraph,
} from '@postgear/automation';
import { AutomationStatus, decrypt } from '@postgear/db';
import { AutomationContextService } from '../automation-context.service';
import type { AutomationsRepository, UsageGraphRow } from '../automations.repository';
import { CONNECTION_MESSAGES } from './connections.messages';
import type {
  ConnectionRow,
  ConnectionsRepository,
  ConnectionWithCredentials,
  ConnectionWrite,
} from './connections.repository';
import { ConnectionsService } from './connections.service';

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const USER = 'user-1';
const TOKEN = 'abcd1234SECRETtoken';
const SLACK = `https://hooks.slack.com/services/T000/B000/${TOKEN}`;

type StoredRow = ConnectionWithCredentials & { organizationId: string; deletedAt: Date | null };

function fakeRepository(rows: StoredRow[]) {
  let next = 1;
  const live = (orgId: string, id: string) =>
    rows.find((row) => row.id === id && row.organizationId === orgId && !row.deletedAt);
  const safe = (row: StoredRow): ConnectionRow => {
    const { credentials: _c, organizationId: _o, deletedAt: _d, ...rest } = row;
    return rest;
  };
  return {
    rows,
    list: jest.fn(async (orgId: string) =>
      rows.filter((row) => row.organizationId === orgId && !row.deletedAt).map(safe),
    ),
    find: jest.fn(async (orgId: string, id: string) => {
      const row = live(orgId, id);
      return row ? safe(row) : null;
    }),
    findWithCredentials: jest.fn(async (orgId: string, id: string) => {
      const row = live(orgId, id);
      return row ? { ...safe(row), credentials: row.credentials } : null;
    }),
    count: jest.fn(
      async (orgId: string) =>
        rows.filter((row) => row.organizationId === orgId && !row.deletedAt).length,
    ),
    nameTaken: jest.fn(async (orgId: string, provider: string, name: string, exceptId?: string) =>
      rows.some(
        (row) =>
          row.organizationId === orgId &&
          row.provider === provider &&
          !row.deletedAt &&
          row.name.toLowerCase() === name.toLowerCase() &&
          row.id !== exceptId,
      ),
    ),
    create: jest.fn(async (data: Record<string, unknown>) => {
      const row = {
        id: `00000000-0000-4000-8000-00000000000${next++}`,
        status: 'CONNECTED',
        lastCheckedAt: null,
        lastError: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        deletedAt: null,
        ...data,
      } as unknown as StoredRow;
      rows.push(row);
      return safe(row);
    }),
    update: jest.fn(
      async (orgId: string, id: string, _user: string | null, data: ConnectionWrite) => {
        const row = live(orgId, id);
        if (!row) return null;
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined) (row as Record<string, unknown>)[key] = value;
        }
        return safe(row);
      },
    ),
    softDelete: jest.fn(async (orgId: string, id: string) => {
      const row = live(orgId, id);
      if (!row) return false;
      row.deletedAt = new Date();
      return true;
    }),
  };
}

function graphUsing(connectionId: string): AutomationGraph {
  const template = getTemplate('publishing-report');
  if (!template) throw new Error('missing template');
  const graph = instantiateTemplate(template, (key) => key);
  const slack = graph.nodes.find((node) => node.type === 'notify.slack');
  if (!slack) throw new Error('missing Slack step');
  slack.config = { ...slack.config, connectionId };
  return graph;
}

describe('ConnectionsService', () => {
  let repository: ReturnType<typeof fakeRepository>;
  let graphs: UsageGraphRow[];
  let context: AutomationContextService;
  let service: ConnectionsService;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY_AES256 = 'b'.repeat(64);
  });

  beforeEach(() => {
    repository = fakeRepository([]);
    graphs = [];
    const automations = {
      usageGraphs: jest.fn(async () => graphs),
      channels: jest.fn(async () => []),
    } as unknown as AutomationsRepository;
    context = new AutomationContextService(
      automations,
      repository as unknown as ConnectionsRepository,
    );
    const config = { get: () => 'true' } as unknown as ConfigService;
    service = new ConnectionsService(
      repository as unknown as ConnectionsRepository,
      context,
      config as never,
    );
  });

  async function addSlack(name = 'Marketing Slack') {
    return service.create(ORG, USER, {
      provider: 'slack',
      name,
      credentials: { webhookUrl: SLACK },
    });
  }

  function expectNoSecret(response: unknown) {
    const json = JSON.stringify(response);
    expect(json).not.toContain('credentials');
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain(TOKEN.slice(0, 8));
    expect(json).not.toContain('/services/T000');
  }

  it('stores the credentials encrypted, and they decrypt back', async () => {
    await addSlack();
    const stored = repository.rows[0];
    expect(stored.credentials).not.toContain(TOKEN);
    expect(stored.credentials).not.toContain('hooks.slack.com');
    expect(JSON.parse(decrypt(stored.credentials))).toEqual({ webhookUrl: SLACK });
    expect(stored.maskedHint).toBe('hooks.slack.com/...oken');
  });

  it('never answers with the credentials or the token', async () => {
    const created = await addSlack();
    expectNoSecret(created);
    expectNoSecret(await service.list(ORG));
    expectNoSecret(await service.update(ORG, USER, created.id, { name: 'Team Slack' }));
    expectNoSecret(
      await service.update(ORG, USER, created.id, { credentials: { webhookUrl: SLACK } }),
    );
    expectNoSecret(await service.check(ORG, USER, created.id));
  });

  it('never answers with a Google refresh token or a secret header value (Module 13)', async () => {
    const REFRESH = 'google-refresh-token-0123456789';
    const BEARER = 'sk_live_header_secret_9f2c';
    const google = await service.saveGrant(ORG, USER, 'google', {
      credentials: {
        accessToken: 'google-access-token-abc',
        refreshToken: REFRESH,
        expiresAt: Date.now() + 3_600_000,
        scope: 'https://www.googleapis.com/auth/drive.file',
        email: 'kim@gmail.com',
      },
      meta: { email: 'kim@gmail.com' },
      name: 'kim@gmail.com',
    });
    const http = await service.create(ORG, USER, {
      provider: 'http',
      name: 'Zapier Secret',
      credentials: { headers: [{ name: 'Authorization', value: `Bearer ${BEARER}` }] },
    });
    expect(google.maskedHint).toBe('k***@gmail.com');
    expect(http.maskedHint).toBe('Authorization: Bearer ...9f2c');

    const responses = [
      google,
      http,
      await service.list(ORG),
      await service.check(ORG, USER, google.id),
      await service.check(ORG, USER, http.id),
    ];
    for (const response of responses) {
      const json = JSON.stringify(response);
      expect(json).not.toContain('credentials');
      expect(json).not.toContain(REFRESH);
      expect(json).not.toContain('google-access-token-abc');
      expect(json).not.toContain(BEARER);
    }
  });

  it('refuses a name already used for that app, in any case', async () => {
    await addSlack();
    await expect(addSlack('marketing slack')).rejects.toMatchObject({
      status: 409,
      message: CONNECTION_MESSAGES.NAME_TAKEN('Slack', 'marketing slack'),
    });
  });

  it('refuses a refused link with its sentence', async () => {
    await expect(
      service.create(ORG, USER, {
        provider: 'discord',
        name: 'Community',
        credentials: { webhookUrl: SLACK },
      }),
    ).rejects.toMatchObject({ status: 400, message: CONNECTION_MESSAGES.LINK_OTHER_APP('Slack') });
    expect(repository.rows).toHaveLength(0);
  });

  it('keeps Google to the sign-in flow', async () => {
    await expect(
      service.create(ORG, USER, {
        provider: 'google',
        name: 'Sheets',
        credentials: { accessToken: 'a', refreshToken: 'r', expiresAt: 1, scope: '' },
      }),
    ).rejects.toMatchObject({
      status: 422,
      response: { message: CONNECTION_MESSAGES.OAUTH_ONLY('Google'), code: 'google_needs_oauth' },
    });
    expect(repository.rows).toHaveLength(0);
  });

  it('adds a simulated Google account under AUTOMATION_SIMULATION (Module 13)', async () => {
    const created = await service.create(ORG, USER, {
      provider: 'google',
      name: 'Simulated Sheets',
      credentials: { simulated: true },
    });
    expect(created).toMatchObject({ provider: 'google', maskedHint: 'Simulated' });
    expect(repository.rows[0].meta).toEqual({ simulated: true, email: 'simulated@postgear.local' });
    expect(JSON.parse(decrypt(repository.rows[0].credentials))).toEqual({ simulated: true });
  });

  it('refuses a simulated Google account when simulation is off', async () => {
    const off = new ConnectionsService(repository as unknown as ConnectionsRepository, context, {
      get: () => 'false',
    } as never);
    await expect(
      off.create(ORG, USER, {
        provider: 'google',
        name: 'Simulated Sheets',
        credentials: { simulated: true },
      }),
    ).rejects.toMatchObject({ status: 422, response: { code: 'google_needs_oauth' } });
  });

  it('reconnects with new details and a clean status', async () => {
    const created = await addSlack();
    repository.rows[0].status = 'NEEDS_RECONNECT';
    repository.rows[0].lastError = 'Slack refused the link.';
    const newLink = 'https://hooks.slack.com/services/T111/B111/zzzz9999';

    const updated = await service.update(ORG, USER, created.id, {
      credentials: { webhookUrl: newLink },
    });

    expect(updated).toMatchObject({
      status: 'CONNECTED',
      lastError: null,
      maskedHint: 'hooks.slack.com/...9999',
    });
    expect(JSON.parse(decrypt(repository.rows[0].credentials))).toEqual({ webhookUrl: newLink });
  });

  it('checks a webhook link honestly: never verified, only ever marked broken', async () => {
    const created = await addSlack();
    const ok = await service.check(ORG, USER, created.id);
    expect(ok.message).toBe(CONNECTION_MESSAGES.CHECK_SEND('Slack'));
    expect(ok.connection.status).toBe('CONNECTED');
    expect(ok.connection.lastCheckedAt).toBeNull();

    // A stored link that would be refused today (an old Teams link).
    repository.rows[0].credentials = (await import('@postgear/db')).encrypt(
      JSON.stringify({ webhookUrl: 'https://x.webhook.office.com/webhookb2/a' }),
    );
    const broken = await service.check(ORG, USER, created.id);
    expect(broken.message).toBe(CONNECTION_MESSAGES.TEAMS_OLD_LINK);
    expect(broken.connection).toMatchObject({
      status: 'ERROR',
      lastError: CONNECTION_MESSAGES.TEAMS_OLD_LINK,
    });
  });

  it('says secret headers have nothing to check', async () => {
    const created = await service.create(ORG, USER, {
      provider: 'http',
      name: 'Analytics API',
      credentials: { headers: [{ name: 'Authorization', value: 'Bearer k' }] },
    });
    const result = await service.check(ORG, USER, created.id);
    expect(result.message).toBe(CONNECTION_MESSAGES.CHECK_NONE);
    expect(result.connection.status).toBe('CONNECTED');
  });

  it('treats another workspace connection as not there, everywhere', async () => {
    const created = await addSlack();
    await expect(
      service.update(OTHER_ORG, USER, created.id, { name: 'Mine' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.remove(OTHER_ORG, created.id)).rejects.toMatchObject({ status: 404 });
    await expect(service.check(OTHER_ORG, USER, created.id)).rejects.toMatchObject({
      status: 404,
    });
    expect(await service.list(OTHER_ORG)).toEqual([]);

    // A graph in the other workspace naming this id is a missing connection.
    const slackIssues = async (orgId: string) =>
      validateGraph(graphUsing(created.id), await context.forOrg(orgId))
        .filter((issue) => issue.nodeKey === 'slack')
        .map((issue) => issue.code);
    expect(await slackIssues(OTHER_ORG)).toContain('node.connection_missing');
    expect(await slackIssues(ORG)).not.toContain('node.connection_missing');
  });

  it('lists the workflows using a connection, live ones marked', async () => {
    const created = await addSlack();
    graphs = [
      {
        id: 'w1',
        name: 'Weekly Report',
        status: AutomationStatus.ACTIVE,
        draftGraph: graphUsing('') as never,
        activeVersion: { graph: graphUsing(created.id) as never },
      },
      {
        id: 'w2',
        name: 'Draft Idea',
        status: AutomationStatus.DRAFT,
        draftGraph: graphUsing(created.id) as never,
        activeVersion: null,
      },
    ];
    const [listed] = await service.list(ORG);
    expect(listed.usedBy).toEqual([
      { id: 'w1', name: 'Weekly Report', live: true },
      { id: 'w2', name: 'Draft Idea', live: false },
    ]);
  });

  it('refuses delete while a workflow that is on uses it, and allows it for drafts', async () => {
    const created = await addSlack();
    graphs = [
      {
        id: 'w1',
        name: 'Weekly Report',
        status: AutomationStatus.ACTIVE,
        draftGraph: graphUsing(created.id) as never,
        activeVersion: { graph: graphUsing(created.id) as never },
      },
    ];
    await expect(service.remove(ORG, created.id)).rejects.toMatchObject({
      status: 409,
      response: {
        message: CONNECTION_MESSAGES.IN_USE('Weekly Report'),
        code: 'connection_in_use',
      },
    });

    // Paused: the running version is not running, so only validation cares.
    graphs[0].status = AutomationStatus.PAUSED;
    await expect(service.remove(ORG, created.id)).resolves.toBeUndefined();
    expect(repository.rows[0].deletedAt).not.toBeNull();
  });
});
