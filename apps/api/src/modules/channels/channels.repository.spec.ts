/**
 * The encryption boundary, asserted rather than assumed.
 *
 * This suite exists because "tokens are encrypted at rest" is a claim that is
 * easy to believe and easy to get subtly wrong — one `create` that forgets to
 * wrap a value, one `select` that returns the whole row, and plaintext
 * credentials are in the database with nothing failing. So these tests inspect
 * what is actually handed to Prisma, not what the repository returns.
 *
 * They also pin the four lifecycle behaviours the reference implementation got
 * wrong: reconnect folding into the existing row, not clobbering user intent on
 * a machine-driven write, org scoping on the sibling fan-out, and clearing
 * credentials on disconnect.
 */
// The fake client is built inside the factory, not referenced from an outer
// `const`: `jest.mock` is hoisted above every declaration in the file, so a
// factory closing over one would read it before initialization.
//
// `requireActual` keeps the real crypto helpers — the point of this suite is to
// verify the genuine AES-256-GCM round trip, not a stub of it.
jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: {
    integration: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    post: {
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

import { decrypt, isEncrypted, prisma } from '@postgear/db';
import { ChannelsRepository } from './channels.repository';

type PrismaMock = {
  integration: Record<'findMany' | 'findFirst' | 'upsert' | 'update' | 'updateMany', jest.Mock>;
  post: Record<'updateMany' | 'count', jest.Mock>;
  $transaction: jest.Mock;
};

const prismaMock = prisma as unknown as PrismaMock;

/** The 64 hex characters `crypto.ts` requires. Test-only, never a real key. */
const TEST_KEY = 'a'.repeat(64);

describe('ChannelsRepository', () => {
  let repository: ChannelsRepository;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY_AES256 = TEST_KEY;
    repository = new ChannelsRepository();
    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaMock),
    );
  });

  function baseRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'ch_1',
      internalId: 'acct_1',
      rootInternalId: 'acct_1',
      providerIdentifier: 'x',
      name: 'Demo',
      profile: 'demo',
      picture: null,
      disabled: false,
      refreshNeeded: false,
      inBetweenSteps: false,
      tokenExpiration: null,
      postingTimes: '[{"time":120}]',
      additionalSettings: '[]',
      createdAt: new Date('2026-01-01'),
      ...overrides,
    };
  }

  describe('encryption boundary', () => {
    it('writes ciphertext, never the plaintext token', async () => {
      prismaMock.integration.upsert.mockResolvedValue(baseRow());

      await repository.upsertFromAuth({
        orgId: 'org_1',
        providerIdentifier: 'x',
        internalId: 'acct_1',
        rootInternalId: 'acct_1',
        name: 'Demo',
        token: 'super-secret-access-token',
        refreshToken: 'super-secret-refresh-token',
      });

      const { create, update } = prismaMock.integration.upsert.mock.calls[0][0];

      for (const branch of [create, update]) {
        expect(branch.token).not.toContain('super-secret-access-token');
        expect(branch.refreshToken).not.toContain('super-secret-refresh-token');
        expect(isEncrypted(branch.token)).toBe(true);
        expect(isEncrypted(branch.refreshToken)).toBe(true);
        // Round-trips back to the original — encrypted, not merely mangled.
        expect(decrypt(branch.token)).toBe('super-secret-access-token');
        expect(decrypt(branch.refreshToken)).toBe('super-secret-refresh-token');
      }
    });

    it('produces different ciphertext for the same token each time', async () => {
      prismaMock.integration.upsert.mockResolvedValue(baseRow());

      const input = {
        orgId: 'org_1',
        providerIdentifier: 'x' as const,
        internalId: 'acct_1',
        rootInternalId: 'acct_1',
        name: 'Demo',
        token: 'identical-token',
      };

      await repository.upsertFromAuth(input);
      await repository.upsertFromAuth(input);

      const first = prismaMock.integration.upsert.mock.calls[0][0].create.token;
      const second = prismaMock.integration.upsert.mock.calls[1][0].create.token;

      // A random IV per call is what makes reusing the helper safe — and is
      // also why an encrypted column can never be queried by equality.
      expect(first).not.toEqual(second);
      expect(decrypt(first)).toBe(decrypt(second));
    });

    it('never selects the token columns when listing', async () => {
      prismaMock.integration.findMany.mockResolvedValue([baseRow()]);

      const channels = await repository.listForOrg('org_1');

      const { select } = prismaMock.integration.findMany.mock.calls[0][0];
      expect(select).not.toHaveProperty('token');
      expect(select).not.toHaveProperty('refreshToken');
      expect(channels[0]).not.toHaveProperty('token');
      expect(channels[0]).not.toHaveProperty('refreshToken');
    });

    it('decrypts only on the credentials path', async () => {
      const { encrypt } = jest.requireActual('@postgear/db');

      prismaMock.integration.findFirst.mockResolvedValue({
        ...baseRow(),
        token: encrypt('plaintext-token'),
        refreshToken: encrypt('plaintext-refresh'),
      });

      const channel = await repository.getWithCredentials('org_1', 'ch_1');

      expect(channel?.token).toBe('plaintext-token');
      expect(channel?.refreshToken).toBe('plaintext-refresh');
    });

    it('reads an emptied credential as empty rather than throwing', async () => {
      // Disconnect writes '' because the column is NOT NULL, and `decrypt`
      // rejects an empty string — so this path has to be handled explicitly.
      prismaMock.integration.findFirst.mockResolvedValue({
        ...baseRow(),
        token: '',
        refreshToken: null,
      });

      const channel = await repository.getWithCredentials('org_1', 'ch_1');

      expect(channel?.token).toBe('');
      expect(channel?.refreshToken).toBeNull();
    });
  });

  describe('tenant scoping and soft delete', () => {
    it('filters every read on deletedAt: null and the org', async () => {
      prismaMock.integration.findMany.mockResolvedValue([]);
      prismaMock.integration.findFirst.mockResolvedValue(null);

      await repository.listForOrg('org_1');
      await repository.findById('org_1', 'ch_1');
      await repository.getWithCredentials('org_1', 'ch_1');

      const wheres = [
        prismaMock.integration.findMany.mock.calls[0][0].where,
        prismaMock.integration.findFirst.mock.calls[0][0].where,
        prismaMock.integration.findFirst.mock.calls[1][0].where,
      ];

      for (const where of wheres) {
        expect(where.deletedAt).toBeNull();
        expect(where.organizationId).toBe('org_1');
      }
    });

    it('scopes the sibling token fan-out to one organization', async () => {
      prismaMock.integration.updateMany.mockResolvedValue({ count: 0 });

      await repository.propagateTokenToSiblings({
        orgId: 'org_1',
        rootInternalId: 'acct_1',
        exceptId: 'ch_1',
        token: 'fresh-token',
      });

      const { where } = prismaMock.integration.updateMany.mock.calls[0][0];

      // Without organizationId, refreshing in one workspace would rewrite
      // another workspace's credentials for the same connected account.
      expect(where.organizationId).toBe('org_1');
      expect(where.rootInternalId).toBe('acct_1');
      expect(where.id).toEqual({ not: 'ch_1' });
    });
  });

  describe('reconnect semantics', () => {
    it('clears deletedAt and refreshNeeded so a disconnected channel resurrects', async () => {
      prismaMock.integration.upsert.mockResolvedValue(baseRow());

      await repository.upsertFromAuth({
        orgId: 'org_1',
        providerIdentifier: 'x',
        internalId: 'acct_1',
        rootInternalId: 'acct_1',
        name: 'Demo',
        token: 'token',
      });

      const { where, update } = prismaMock.integration.upsert.mock.calls[0][0];

      expect(where.organizationId_internalId).toEqual({
        organizationId: 'org_1',
        internalId: 'acct_1',
      });
      expect(update.deletedAt).toBeNull();
      expect(update.refreshNeeded).toBe(false);
    });

    it('does not overwrite the user-owned name or disabled flag on update', async () => {
      prismaMock.integration.upsert.mockResolvedValue(baseRow());

      await repository.upsertFromAuth({
        orgId: 'org_1',
        providerIdentifier: 'x',
        internalId: 'acct_1',
        rootInternalId: 'acct_1',
        name: 'Name From Provider',
        token: 'token',
      });

      const { create, update } = prismaMock.integration.upsert.mock.calls[0][0];

      // A user's rename and a plan-driven disable both survive a reconnect.
      expect(create.name).toBe('Name From Provider');
      expect(update).not.toHaveProperty('name');
      expect(update).not.toHaveProperty('disabled');
      expect(update).not.toHaveProperty('postingTimes');
    });

    it('does not send a reconnect back into the entity picker', async () => {
      prismaMock.integration.upsert.mockResolvedValue(baseRow());

      await repository.upsertFromAuth({
        orgId: 'org_1',
        providerIdentifier: 'facebook',
        internalId: 'acct_1',
        rootInternalId: 'acct_1',
        name: 'Demo',
        token: 'token',
        inBetweenSteps: true,
        isReconnect: true,
      });

      const { update } = prismaMock.integration.upsert.mock.calls[0][0];
      expect(update).not.toHaveProperty('inBetweenSteps');
    });

    it('leaves the stored expiry alone when a refresh does not report one', async () => {
      prismaMock.integration.updateMany.mockResolvedValue({ count: 1 });

      await repository.applyRefreshedToken({
        orgId: 'org_1',
        id: 'ch_1',
        token: 'fresh',
      });

      const { data } = prismaMock.integration.updateMany.mock.calls[0][0];

      // Writing `tokenExpiration: undefined` unconditionally is how a refresh
      // path silently nulls columns it knows nothing about.
      expect(data).not.toHaveProperty('tokenExpiration');
      expect(data).not.toHaveProperty('profile');
      expect(data.refreshNeeded).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('clears credentials, soft-deletes, and drafts queued posts', async () => {
      prismaMock.post.updateMany.mockResolvedValue({ count: 3 });
      prismaMock.integration.updateMany.mockResolvedValue({ count: 1 });

      const result = await repository.disconnect('org_1', 'ch_1');

      expect(result.draftedPosts).toBe(3);

      const postUpdate = prismaMock.post.updateMany.mock.calls[0][0];
      expect(postUpdate.where.state).toBe('QUEUE');
      expect(postUpdate.data.state).toBe('DRAFT');

      const { data } = prismaMock.integration.updateMany.mock.calls[0][0];
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(data.disabled).toBe(true);
      // Cleared, not merely orphaned: a soft-deleted row must not keep a live
      // credential, and reconnecting re-authorizes from scratch anyway.
      expect(data.token).toBe('');
      expect(data.refreshToken).toBeNull();
    });

    it('keeps internalId intact so the row can be resurrected', async () => {
      prismaMock.post.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.integration.updateMany.mockResolvedValue({ count: 1 });

      await repository.disconnect('org_1', 'ch_1');

      const { data } = prismaMock.integration.updateMany.mock.calls[0][0];
      expect(data).not.toHaveProperty('internalId');
    });
  });

  describe('JSON-in-String columns', () => {
    it('falls back to defaults rather than throwing on malformed JSON', async () => {
      prismaMock.integration.findMany.mockResolvedValue([
        baseRow({ postingTimes: 'not json at all', additionalSettings: '{oops' }),
      ]);

      // One bad row must not take down the whole channel list, which is exactly
      // what an unguarded JSON.parse in a controller does.
      const [channel] = await repository.listForOrg('org_1');

      expect(channel.postingTimes).toEqual([{ time: 120 }, { time: 400 }, { time: 700 }]);
      expect(channel.additionalSettings).toEqual({});
    });

    it('parses valid posting times and drops malformed entries', async () => {
      prismaMock.integration.findMany.mockResolvedValue([
        baseRow({ postingTimes: '[{"time":540},{"nope":1},{"time":1080}]' }),
      ]);

      const [channel] = await repository.listForOrg('org_1');

      expect(channel.postingTimes).toEqual([{ time: 540 }, { time: 1080 }]);
    });

    it('serializes posting times on write', async () => {
      prismaMock.integration.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.integration.findFirst.mockResolvedValue(baseRow());

      await repository.updateSettings({
        orgId: 'org_1',
        id: 'ch_1',
        postingTimes: [{ time: 540 }],
      });

      const { data } = prismaMock.integration.updateMany.mock.calls[0][0];
      expect(data.postingTimes).toBe('[{"time":540}]');
    });
  });

  describe('entity selection', () => {
    it('refuses to finalize a channel that is not awaiting selection', async () => {
      prismaMock.integration.findFirst.mockResolvedValue(baseRow({ inBetweenSteps: false }));

      // The replay guard: a finalize must not be able to re-point a channel
      // that has already been configured.
      await expect(
        repository.completeEntitySelection({
          orgId: 'org_1',
          id: 'ch_1',
          entityId: 'page_1',
          name: 'Page',
        }),
      ).rejects.toThrow('not awaiting selection');
    });

    it('flips internalId to the entity and clears inBetweenSteps', async () => {
      prismaMock.integration.findFirst
        .mockResolvedValueOnce(baseRow({ inBetweenSteps: true }))
        // No live row already holds the target id.
        .mockResolvedValueOnce(null);
      prismaMock.integration.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.integration.update.mockResolvedValue(
        baseRow({ internalId: 'page_1', inBetweenSteps: false }),
      );

      await repository.completeEntitySelection({
        orgId: 'org_1',
        id: 'ch_1',
        entityId: 'page_1',
        name: 'My Page',
        token: 'page-scoped-token',
      });

      const { data } = prismaMock.integration.update.mock.calls[0][0];

      expect(data.internalId).toBe('page_1');
      expect(data.inBetweenSteps).toBe(false);
      expect(isEncrypted(data.token)).toBe(true);
      expect(decrypt(data.token)).toBe('page-scoped-token');
    });

    it('redirects the write to an existing live row so its posts survive', async () => {
      prismaMock.integration.findFirst
        .mockResolvedValueOnce(baseRow({ id: 'ch_new', inBetweenSteps: true }))
        // A channel already represents this page — it holds the history.
        .mockResolvedValueOnce({ id: 'ch_original' });
      prismaMock.integration.updateMany.mockResolvedValue({ count: 0 });
      prismaMock.integration.update.mockResolvedValue(baseRow({ id: 'ch_original' }));

      await repository.completeEntitySelection({
        orgId: 'org_1',
        id: 'ch_new',
        entityId: 'page_1',
        name: 'My Page',
      });

      const [discard, keep] = prismaMock.integration.update.mock.calls;

      // The temporary row is tombstoned...
      expect(discard[0].where.id).toBe('ch_new');
      expect(discard[0].data.deletedAt).toBeInstanceOf(Date);
      expect(discard[0].data.token).toBe('');
      // ...and the original keeps its primary key, so scheduled posts and
      // webhooks pointing at it stay valid.
      expect(keep[0].where.id).toBe('ch_original');
    });
  });
});
