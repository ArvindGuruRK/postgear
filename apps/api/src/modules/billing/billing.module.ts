import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { BILLING_CONFIG, type BillingConfig, readBillingConfig } from './billing.config';
import { BillingController } from './billing.controller';
import { BillingRepository } from './billing.repository';
import { BillingService } from './billing.service';
import { EntitlementsService } from './entitlements.service';
import { StripeWebhookService } from './stripe-webhook.service';
import {
  createEventVerifier,
  createStripeGateway,
  STRIPE_EVENT_VERIFIER,
  STRIPE_GATEWAY,
} from './stripe.client';

/**
 * Billing (Sprint 8, PRD 5.8): plans, the trial, Stripe checkout and portal,
 * the signature-verified idempotent webhook, and the entitlement every other
 * module gates on.
 *
 * ## Three providers behind tokens
 *
 * - `BILLING_CONFIG` — the mode (simulation / stripe / unconfigured), read
 *   from the environment once by `billing.config.ts`.
 * - `STRIPE_EVENT_VERIFIER` — what turns a raw webhook body and signature
 *   into an event, or throws. Built from the config alone.
 * - `STRIPE_GATEWAY` — the calls *to* Stripe. The simulation needs
 *   `StripeWebhookService` so the events it synthesises go through the same
 *   `apply` a real delivery does; the webhook service itself depends only on
 *   the verifier and the repository, so there is no cycle.
 *
 * ## Imports nothing from the feature modules
 *
 * `ChannelsModule`, `OrgModule` and (through them) `AiModule` import this
 * one for `EntitlementsService`, so this module must not import them back.
 * The two numbers it needs from their tables are small queries in its own
 * repository. `MailModule` and `ConfigModule` are global.
 */
@Module({
  controllers: [BillingController],
  providers: [
    BillingRepository,
    EntitlementsService,
    StripeWebhookService,
    BillingService,
    {
      provide: BILLING_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => readBillingConfig(config),
    },
    {
      provide: STRIPE_EVENT_VERIFIER,
      inject: [BILLING_CONFIG],
      useFactory: (config: BillingConfig) => createEventVerifier(config),
    },
    {
      provide: STRIPE_GATEWAY,
      inject: [BILLING_CONFIG, StripeWebhookService],
      useFactory: (config: BillingConfig, webhook: StripeWebhookService) =>
        createStripeGateway(config, webhook, new Logger('Billing')),
    },
  ],
  exports: [EntitlementsService, BILLING_CONFIG],
})
export class BillingModule {}
