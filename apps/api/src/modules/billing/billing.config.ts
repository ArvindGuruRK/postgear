/**
 * Which billing mode to run, decided from the environment — and nothing else.
 *
 * Separate from the module's wiring so the decision is a pure function with
 * a test, as `ai/engine/engine.config.ts` is for the AI engine.
 *
 * ## Precedence
 *
 * `BILLING_SIMULATION=true` wins over any key: a developer who turns
 * simulation on wants no Stripe call, even with a real key in the same file.
 * Then a real secret key means `stripe`; otherwise `unconfigured`, where
 * `/billing/status` says so, checkout answers 503 and the page explains.
 *
 * ## Placeholders count as unset — checked here too
 *
 * `config/env.ts` turns the `.env.example` placeholders into `undefined`
 * and refuses a secret key without a webhook secret. But Nest's
 * `ConfigService.get` falls back to the raw `process.env` value when the
 * validated one is `undefined`, so a placeholder would reach this file
 * anyway — and select Stripe mode with a key that cannot work. The same
 * list is applied again here, the way `ai/engine/engine.config.ts` keeps
 * its own, and each ignored variable is named once in the boot log.
 */
import type { ConfigService } from '@nestjs/config';
import type { Period, SubscriptionTier } from '@postgear/db';
import { type Env, STRIPE_PLACEHOLDERS } from '../../config/env';

export type BillingMode = 'simulation' | 'stripe' | 'unconfigured';

/** `STRIPE_PRICE_<TIER>_<PERIOD>`, as a lookup key. */
export type PriceKey = `${SubscriptionTier}_${Period}`;

export interface BillingConfig {
  mode: BillingMode;
  /** Present only in `stripe` mode. */
  secretKey: string | null;
  webhookSecret: string | null;
  publishableKey: string | null;
  trialDays: number;
  /** Dashboard price ids that pin a plan instead of inline `price_data`. */
  priceIds: Partial<Record<PriceKey, string>>;
  webUrl: string;
  /** One line per ignored variable, for the boot log. */
  warnings: string[];
}

export type BillingEnv = Pick<
  Env,
  | 'BILLING_SIMULATION'
  | 'STRIPE_SECRET_KEY'
  | 'STRIPE_WEBHOOK_SECRET'
  | 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'
  | 'BILLING_TRIAL_DAYS'
  | 'WEB_URL'
  | 'STRIPE_PRICE_STANDARD_MONTHLY'
  | 'STRIPE_PRICE_STANDARD_YEARLY'
  | 'STRIPE_PRICE_PRO_MONTHLY'
  | 'STRIPE_PRICE_PRO_YEARLY'
  | 'STRIPE_PRICE_TEAM_MONTHLY'
  | 'STRIPE_PRICE_TEAM_YEARLY'
  | 'STRIPE_PRICE_ULTIMATE_MONTHLY'
  | 'STRIPE_PRICE_ULTIMATE_YEARLY'
>;

const PRICE_KEYS: PriceKey[] = [
  'STANDARD_MONTHLY',
  'STANDARD_YEARLY',
  'PRO_MONTHLY',
  'PRO_YEARLY',
  'TEAM_MONTHLY',
  'TEAM_YEARLY',
  'ULTIMATE_MONTHLY',
  'ULTIMATE_YEARLY',
];

export function priceKeyFor(tier: SubscriptionTier, period: Period): PriceKey {
  return `${tier}_${period}`;
}

export function resolveBillingConfig(env: BillingEnv): BillingConfig {
  const warnings: string[] = [];
  const priceIds: Partial<Record<PriceKey, string>> = {};
  const secretKey = usableKey('STRIPE_SECRET_KEY', env.STRIPE_SECRET_KEY, warnings);
  const webhookSecret = usableKey('STRIPE_WEBHOOK_SECRET', env.STRIPE_WEBHOOK_SECRET, warnings);
  const publishableKey = usableKey(
    'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
    env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    warnings,
  );

  for (const key of PRICE_KEYS) {
    const value = env[`STRIPE_PRICE_${key}`]?.trim();
    if (value) {
      priceIds[key] = value;
    }
  }

  const base = {
    publishableKey,
    trialDays: env.BILLING_TRIAL_DAYS,
    priceIds,
    webUrl: env.WEB_URL,
    warnings,
  };

  if (env.BILLING_SIMULATION === 'true') {
    if (secretKey) {
      warnings.push('STRIPE_SECRET_KEY is set but BILLING_SIMULATION=true wins — Stripe is not called.');
    }

    return { ...base, mode: 'simulation', secretKey: null, webhookSecret: null };
  }

  if (!secretKey || !webhookSecret) {
    if (secretKey || webhookSecret) {
      warnings.push(
        'STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are needed together — billing stays off.',
      );
    }
    if (Object.keys(priceIds).length > 0) {
      warnings.push('STRIPE_PRICE_* ids are set but no STRIPE_SECRET_KEY is — they are ignored.');
    }

    return { ...base, mode: 'unconfigured', secretKey: null, webhookSecret: null };
  }

  return { ...base, mode: 'stripe', secretKey, webhookSecret };
}

/** A key worth using: set, non-blank, and not a `.env.example` placeholder. */
function usableKey(name: string, value: string | undefined, warnings: string[]): string | null {
  const trimmed = value?.trim() ?? '';

  if (trimmed === '') {
    return null;
  }

  if (STRIPE_PLACEHOLDERS.includes(trimmed)) {
    warnings.push(`${name} holds the .env.example placeholder and is being ignored.`);
    return null;
  }

  return trimmed;
}

export function readBillingConfig(config: ConfigService<Env, true>): BillingConfig {
  return resolveBillingConfig({
    BILLING_SIMULATION: config.get('BILLING_SIMULATION', { infer: true }),
    STRIPE_SECRET_KEY: config.get('STRIPE_SECRET_KEY', { infer: true }),
    STRIPE_WEBHOOK_SECRET: config.get('STRIPE_WEBHOOK_SECRET', { infer: true }),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: config.get('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', {
      infer: true,
    }),
    BILLING_TRIAL_DAYS: config.get('BILLING_TRIAL_DAYS', { infer: true }),
    WEB_URL: config.get('WEB_URL', { infer: true }),
    STRIPE_PRICE_STANDARD_MONTHLY: config.get('STRIPE_PRICE_STANDARD_MONTHLY', { infer: true }),
    STRIPE_PRICE_STANDARD_YEARLY: config.get('STRIPE_PRICE_STANDARD_YEARLY', { infer: true }),
    STRIPE_PRICE_PRO_MONTHLY: config.get('STRIPE_PRICE_PRO_MONTHLY', { infer: true }),
    STRIPE_PRICE_PRO_YEARLY: config.get('STRIPE_PRICE_PRO_YEARLY', { infer: true }),
    STRIPE_PRICE_TEAM_MONTHLY: config.get('STRIPE_PRICE_TEAM_MONTHLY', { infer: true }),
    STRIPE_PRICE_TEAM_YEARLY: config.get('STRIPE_PRICE_TEAM_YEARLY', { infer: true }),
    STRIPE_PRICE_ULTIMATE_MONTHLY: config.get('STRIPE_PRICE_ULTIMATE_MONTHLY', { infer: true }),
    STRIPE_PRICE_ULTIMATE_YEARLY: config.get('STRIPE_PRICE_ULTIMATE_YEARLY', { infer: true }),
  });
}

/** The one boot log line that says which mode billing is in, and what that means. */
export function describeBillingMode(config: BillingConfig): string {
  switch (config.mode) {
    case 'simulation':
      return (
        'BILLING_SIMULATION=true — Stripe is simulated: checkout, plan changes and cancellation ' +
        'synthesise the events and run them through the real webhook handler. Not for production.'
      );
    case 'stripe':
      return `Billing through Stripe (${config.secretKey?.startsWith('sk_live') ? 'LIVE' : 'test'} keys, ${
        Object.keys(config.priceIds).length
      } pinned price ids).`;
    case 'unconfigured':
      return (
        'Neither STRIPE_SECRET_KEY nor BILLING_SIMULATION=true is set — billing is off. ' +
        'Checkout and the portal answer 503 until one of them is.'
      );
  }
}

/** Nest injection token for the resolved configuration. */
export const BILLING_CONFIG = Symbol('BILLING_CONFIG');
