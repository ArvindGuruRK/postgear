/**
 * The billing routes (Sprint 8, contract §5.1).
 *
 * Reads carry `@Roles(ADMIN, USER)`: every member may see the plan and the
 * meters. Writes carry `@Roles(ADMIN)`: only an admin spends the
 * workspace's money. The roles are on each handler rather than the class
 * because one route has none at all — the webhook.
 *
 * ## The webhook
 *
 * `@Public()`: Stripe has no session. `@SkipThrottle()`: Stripe retries,
 * and a replay is already harmless through the idempotency table. It reads
 * `request.rawBody`, which `main.ts` keeps for exactly this route: Stripe
 * signs the bytes it sent, and a re-serialised JSON object would never
 * verify. The handler answers 200 for everything it could verify — a
 * duplicate, an unhandled type, even a handler failure — because a non-2xx
 * only makes Stripe send it again (see `stripe-webhook.service.ts`).
 */
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Role } from '@postgear/db';
import type { Request } from 'express';
import { type ActiveOrg, CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { BillingService } from './billing.service';
import {
  type CancelInput,
  cancelSchema,
  type PlanSelectionInput,
  planSelectionSchema,
} from './dto/billing.schema';
import { StripeWebhookService } from './stripe-webhook.service';

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly webhook: StripeWebhookService,
  ) {}

  @Get('status')
  @Roles(Role.ADMIN, Role.USER)
  status() {
    return { status: this.billing.status() };
  }

  @Get('plans')
  @Roles(Role.ADMIN, Role.USER)
  plans() {
    return this.billing.plans();
  }

  @Get('subscription')
  @Roles(Role.ADMIN, Role.USER)
  subscription(@CurrentOrg() org: ActiveOrg) {
    return this.billing.subscription(org.id);
  }

  @Post('trial')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  trial(@CurrentOrg() org: ActiveOrg) {
    return this.billing.startTrial(org.id);
  }

  @Post('checkout')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  checkout(
    @CurrentOrg() org: ActiveOrg,
    @Body(new ZodBody(planSelectionSchema, 'billing/checkout')) dto: PlanSelectionInput,
  ) {
    return this.billing.checkout(org.id, dto);
  }

  @Post('portal')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  portal(@CurrentOrg() org: ActiveOrg) {
    return this.billing.portal(org.id);
  }

  @Get('change/preview')
  @Roles(Role.ADMIN, Role.USER)
  preview(
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(planSelectionSchema, 'billing/change/preview')) query: PlanSelectionInput,
  ) {
    return this.billing.previewChange(org.id, query);
  }

  @Post('change')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  change(
    @CurrentOrg() org: ActiveOrg,
    @Body(new ZodBody(planSelectionSchema, 'billing/change')) dto: PlanSelectionInput,
  ) {
    return this.billing.change(org.id, dto);
  }

  @Post('cancel')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentOrg() org: ActiveOrg,
    @Body(new ZodBody(cancelSchema, 'billing/cancel')) dto: CancelInput,
  ) {
    return this.billing.cancel(org.id, dto);
  }

  @Post('resume')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  resume(@CurrentOrg() org: ActiveOrg) {
    return this.billing.resume(org.id);
  }

  @Public()
  @SkipThrottle()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  stripeWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    return this.webhook.receive(request.rawBody, signature);
  }
}
