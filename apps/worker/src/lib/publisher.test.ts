import { BadBodyError, RefreshTokenError, RetryableError } from '@postgear/social-core';
import { createPublisher, parseSimulationDirective, SimulatedProvider } from './publisher';

const channel = {
  id: 'ch',
  internalId: 'acct',
  rootInternalId: 'acct',
  providerIdentifier: 'linkedin',
  name: 'Acme',
};

const post = (message: string) => [{ id: 'row-1', message, media: [] }];

describe('parseSimulationDirective', () => {
  it('reads the failure kind and optional attempt bound', () => {
    expect(parseSimulationDirective('Hello [simulate:429]')).toEqual({ kind: '429' });
    expect(parseSimulationDirective('Hello [simulate:429x2] there')).toEqual({
      kind: '429',
      untilAttempt: 2,
    });
    expect(parseSimulationDirective('[simulate:slow:3]')).toEqual({ kind: 'slow', seconds: 3 });
    expect(parseSimulationDirective('[simulate:slow]')).toEqual({ kind: 'slow', seconds: 5 });
    expect(parseSimulationDirective('plain text')).toBeNull();
  });
});

describe('SimulatedProvider', () => {
  const provider = new SimulatedProvider('linkedin', undefined);

  it('publishes an ordinary post with a plausible result', async () => {
    const [result] = await provider.post(channel, 'token', post('Hello'));

    expect(result.id).toBe('row-1');
    expect(result.postId).toMatch(/^sim-/);
    expect(result.releaseURL).toContain('/linkedin/acct/');
  });

  it('throws the requested error class', async () => {
    await expect(provider.post(channel, 't', post('[simulate:429]'))).rejects.toBeInstanceOf(
      RetryableError,
    );
    await expect(provider.post(channel, 't', post('[simulate:401]'))).rejects.toBeInstanceOf(
      RefreshTokenError,
    );
    await expect(provider.post(channel, 't', post('[simulate:400]'))).rejects.toBeInstanceOf(
      BadBodyError,
    );
  });

  it('stops failing after the bounded attempt, outside an activity attempt 1 is assumed', async () => {
    // Attempt 1 is within the bound, so it fails …
    await expect(provider.post(channel, 't', post('[simulate:429x1]'))).rejects.toBeInstanceOf(
      RetryableError,
    );
    // … and a bound of zero means never fail.
    await expect(provider.post(channel, 't', post('[simulate:429x0]'))).resolves.toHaveLength(1);
  });

  it('validates against the real provider rules when the platform is known', async () => {
    const publisher = createPublisher({ PUBLISH_SIMULATION: 'true' });
    const linkedin = publisher.resolve('linkedin');

    expect(publisher.simulated).toBe(true);
    expect(await linkedin.checkValidity(post('Fine'))).toBe(true);
    expect(await linkedin.checkValidity(post('x'.repeat(3_001)))).toMatch(/3,000 characters/);
  });

  it('cannot refresh a fake token', async () => {
    await expect(provider.refreshToken('fake')).resolves.toMatchObject({ accessToken: '' });
  });
});
