/**
 * The OAuth handshake with a fake app plugged in as Google: single-use and
 * expiring state, `returnTo` kept inside this workspace's workflows, and the
 * callback's admin re-check before any token is exchanged.
 */
import type { ConfigService } from '@nestjs/config';
import { Role } from '@postgear/db';
import type { RedisService } from '../../redis/redis.service';
import {
  CONNECTION_OAUTH_STATE_TTL_SECONDS,
  ConnectionOAuthService,
  type OAuthConnectionPlugin,
  safeReturnTo,
} from './connection-oauth.service';
import type { ConnectionsRepository } from './connections.repository';
import type { ConnectionsService } from './connections.service';

const ORG = 'org-1';
const USER = 'user-1';
const WEB = 'http://localhost:3000';
const RETURN_TO = `/${ORG}/workflows/abc?step=k3f9a1b2c0&tab=setup`;

function fakeRedis() {
  const store = new Map<string, { value: string; ttl: number }>();
  return {
    store,
    get: jest.fn(async (key: string) => store.get(key)?.value ?? null),
    set: jest.fn(async (key: string, value: string, ttl: number) => {
      store.set(key, { value, ttl });
    }),
    delete: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

const fakeGoogle: OAuthConnectionPlugin = {
  provider: 'google',
  authorizeUrl: (state, redirectUri) =>
    `https://accounts.example/auth?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
  exchange: jest.fn(async () => ({
    credentials: { accessToken: 'a', refreshToken: 'r', expiresAt: 1, scope: 'drive.file' },
    meta: { email: 'me@example.com' },
    name: 'me@example.com',
  })),
};

describe('ConnectionOAuthService', () => {
  let redis: ReturnType<typeof fakeRedis>;
  let repository: { find: jest.Mock; membershipRole: jest.Mock };
  let connections: { saveGrant: jest.Mock };
  let service: ConnectionOAuthService;

  beforeEach(() => {
    redis = fakeRedis();
    repository = {
      find: jest.fn(async () => null),
      membershipRole: jest.fn(async () => Role.ADMIN),
    };
    connections = { saveGrant: jest.fn(async () => ({ id: 'conn-1' })) };
    (fakeGoogle.exchange as jest.Mock).mockClear();
    const config = {
      get: (key: string) => (key === 'WEB_URL' ? WEB : 'http://localhost:3001'),
    } as unknown as ConfigService;
    service = new ConnectionOAuthService(
      redis as unknown as RedisService,
      repository as unknown as ConnectionsRepository,
      connections as unknown as ConnectionsService,
      config as never,
      [fakeGoogle],
    );
  });

  async function start(returnTo = RETURN_TO): Promise<string> {
    const url = await service.start(ORG, USER, 'google', { returnTo });
    const state = new URL(url).searchParams.get('state');
    if (!state) throw new Error('no state');
    return state;
  }

  it('stores the handshake behind an opaque state for 10 minutes', async () => {
    const url = await service.start(ORG, USER, 'google', { returnTo: RETURN_TO });
    expect(url).toContain(
      encodeURIComponent('http://localhost:3001/automation-connections/oauth/google/callback'),
    );
    const [entry] = [...redis.store.values()];
    expect(entry.ttl).toBe(CONNECTION_OAUTH_STATE_TTL_SECONDS);
    expect(CONNECTION_OAUTH_STATE_TTL_SECONDS).toBe(600);
    expect(JSON.parse(entry.value)).toEqual({
      orgId: ORG,
      userId: USER,
      provider: 'google',
      returnTo: RETURN_TO,
    });
    // Nothing about the workspace travels in the state itself.
    expect(new URL(url).searchParams.get('state')).not.toContain(ORG);
  });

  it('lands back on the exact step with the new connection selected', async () => {
    const state = await start();
    await expect(service.finish('google', 'code-1', state)).resolves.toBe(
      `${WEB}/${ORG}/workflows/abc?step=k3f9a1b2c0&tab=setup&connection=conn-1`,
    );
    expect(connections.saveGrant).toHaveBeenCalledWith(
      ORG,
      USER,
      'google',
      expect.objectContaining({ name: 'me@example.com' }),
      undefined,
    );
  });

  it('refuses a state the second time', async () => {
    const state = await start();
    await service.finish('google', 'code-1', state);
    await expect(service.finish('google', 'code-1', state)).resolves.toBe(
      `${WEB}/?connectError=expired`,
    );
    expect(fakeGoogle.exchange).toHaveBeenCalledTimes(1);
  });

  it('refuses an expired or unknown state, and one minted for another app', async () => {
    const state = await start();
    redis.store.clear();
    await expect(service.finish('google', 'code-1', state)).resolves.toBe(
      `${WEB}/?connectError=expired`,
    );

    const other = await start();
    await expect(service.finish('slack', 'code-1', other)).resolves.toBe(
      `${WEB}/?connectError=expired`,
    );
    await expect(service.finish('google', 'code-1', undefined)).resolves.toContain('expired');
    expect(fakeGoogle.exchange).not.toHaveBeenCalled();
  });

  it('re-checks that the user is still an admin before exchanging the code', async () => {
    const state = await start();
    repository.membershipRole.mockResolvedValue(Role.USER);
    await expect(service.finish('google', 'code-1', state)).resolves.toContain(
      'connectError=not_admin',
    );
    expect(fakeGoogle.exchange).not.toHaveBeenCalled();
    expect(connections.saveGrant).not.toHaveBeenCalled();
  });

  it('sends a cancelled consent and a failed exchange back with a reason only', async () => {
    const cancelled = await start();
    await expect(service.finish('google', undefined, cancelled)).resolves.toContain(
      'connectError=cancelled',
    );

    const failed = await start();
    (fakeGoogle.exchange as jest.Mock).mockRejectedValueOnce(new Error('invalid_grant: secret'));
    const landing = await service.finish('google', 'code-1', failed);
    expect(landing).toContain('connectError=failed');
    expect(landing).not.toContain('secret');
  });

  it('answers an app without sign-in straight back, and refuses a foreign reconnect', async () => {
    await expect(service.start(ORG, USER, 'slack', { returnTo: RETURN_TO })).resolves.toContain(
      'connectError=unavailable',
    );
    await expect(
      service.start(ORG, USER, 'google', {
        returnTo: RETURN_TO,
        connectionId: '00000000-0000-4000-8000-000000000009',
      }),
    ).resolves.toContain('connectError=failed');
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('refuses a returnTo outside this workspace workflows', async () => {
    for (const returnTo of [
      'https://evil.example/x',
      '//evil.example/org-1/workflows',
      '/org-1/settings',
      '/org-2/workflows/abc',
      '/org-1/workflows/../settings',
      '/org-1/workflowsevil',
      '/org-1/workflows\\..\\x',
      'javascript:alert(1)',
    ]) {
      await expect(service.start(ORG, USER, 'google', { returnTo })).rejects.toMatchObject({
        status: 400,
      });
    }
    expect(safeReturnTo(ORG, `/${ORG}/workflows`)).toBe(`/${ORG}/workflows`);
    expect(safeReturnTo(ORG, `/${ORG}/workflows/connections#x`)).toBe(
      `/${ORG}/workflows/connections`,
    );
  });
});
