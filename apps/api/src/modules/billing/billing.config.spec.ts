/**
 * Mode selection from the environment: simulation beats a key, a key needs
 * its webhook secret, and pinned price ids are read only when they can be
 * used.
 */
import { type BillingEnv, describeBillingMode, priceKeyFor, resolveBillingConfig } from './billing.config';

function env(overrides: Partial<BillingEnv> = {}): BillingEnv {
  return {
    BILLING_SIMULATION: 'false',
    STRIPE_SECRET_KEY: undefined,
    STRIPE_WEBHOOK_SECRET: undefined,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: undefined,
    BILLING_TRIAL_DAYS: 14,
    WEB_URL: 'http://localhost:3000',
    STRIPE_PRICE_STANDARD_MONTHLY: undefined,
    STRIPE_PRICE_STANDARD_YEARLY: undefined,
    STRIPE_PRICE_PRO_MONTHLY: undefined,
    STRIPE_PRICE_PRO_YEARLY: undefined,
    STRIPE_PRICE_TEAM_MONTHLY: undefined,
    STRIPE_PRICE_TEAM_YEARLY: undefined,
    STRIPE_PRICE_ULTIMATE_MONTHLY: undefined,
    STRIPE_PRICE_ULTIMATE_YEARLY: undefined,
    ...overrides,
  };
}

describe('resolveBillingConfig', () => {
  it('is unconfigured with no key at all', () => {
    expect(resolveBillingConfig(env())).toMatchObject({
      mode: 'unconfigured',
      secretKey: null,
      webhookSecret: null,
      publishableKey: null,
      trialDays: 14,
      warnings: [],
    });
  });

  it('selects Stripe when both halves of the key pair are set', () => {
    const resolved = resolveBillingConfig(
      env({
        STRIPE_SECRET_KEY: 'sk_test_1',
        STRIPE_WEBHOOK_SECRET: 'whsec_1',
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_1',
        STRIPE_PRICE_PRO_MONTHLY: ' price_pro ',
      }),
    );

    expect(resolved).toMatchObject({
      mode: 'stripe',
      secretKey: 'sk_test_1',
      webhookSecret: 'whsec_1',
      publishableKey: 'pk_test_1',
      priceIds: { PRO_MONTHLY: 'price_pro' },
    });
    expect(describeBillingMode(resolved)).toContain('test keys, 1 pinned price id');
  });

  it('lets simulation win over a real key, and says so', () => {
    const resolved = resolveBillingConfig(
      env({ BILLING_SIMULATION: 'true', STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_WEBHOOK_SECRET: 'w' }),
    );

    expect(resolved.mode).toBe('simulation');
    expect(resolved.secretKey).toBeNull();
    expect(resolved.warnings).toEqual([
      'STRIPE_SECRET_KEY is set but BILLING_SIMULATION=true wins, so Stripe is not called.',
    ]);
    expect(describeBillingMode(resolved)).toContain('Not for production');
  });

  it('treats the .env.example placeholders as unset, and says so', () => {
    const resolved = resolveBillingConfig(
      env({
        STRIPE_SECRET_KEY: 'sk_test_stripe_secret_key',
        STRIPE_WEBHOOK_SECRET: 'whsec_stripe_webhook_signing_secret',
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: ' pk_test_stripe_publishable_key ',
      }),
    );

    expect(resolved.mode).toBe('unconfigured');
    expect(resolved.publishableKey).toBeNull();
    expect(resolved.warnings).toEqual([
      'STRIPE_SECRET_KEY holds the .env.example placeholder and is being ignored.',
      'STRIPE_WEBHOOK_SECRET holds the .env.example placeholder and is being ignored.',
      'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY holds the .env.example placeholder and is being ignored.',
    ]);
  });

  it('keeps billing off with only half of the key pair', () => {
    const resolved = resolveBillingConfig(env({ STRIPE_SECRET_KEY: 'sk_test_1' }));

    expect(resolved.mode).toBe('unconfigured');
    expect(resolved.warnings).toEqual([
      'STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are needed together, so billing stays off.',
    ]);
  });

  it('warns about pinned prices nothing can use', () => {
    const resolved = resolveBillingConfig(env({ STRIPE_PRICE_TEAM_YEARLY: 'price_team' }));

    expect(resolved.mode).toBe('unconfigured');
    expect(resolved.warnings[0]).toMatch(/STRIPE_PRICE_\* ids are set/);
  });

  it('builds the price key the way the env variables are named', () => {
    expect(priceKeyFor('ULTIMATE', 'YEARLY')).toBe('ULTIMATE_YEARLY');
  });
});
