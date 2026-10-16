/**
 * Outbound webhook configuration (Sprint 8, PRD 5.10).
 *
 * `ADMIN` throughout: a webhook sends the workspace's post content to an
 * address of the configurer's choosing, which is a decision for whoever
 * administers the workspace, not for every member. Every handler scopes on
 * `@CurrentOrg()`; the `:id` in a path is only the hook being acted on.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Role } from '@postgear/db';
import { WEBHOOK_DELIVERY_RETRY_POLICY, WEBHOOK_EVENTS } from '@postgear/scheduling';
import { type ActiveOrg, CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import {
  type CreateWebhookInput,
  createWebhookSchema,
  type UpdateWebhookInput,
  updateWebhookSchema,
} from './dto/webhooks.schema';
import { WEBHOOK_MESSAGES } from './webhooks.messages';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
@Roles(Role.ADMIN)
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  async list(@CurrentOrg() org: ActiveOrg) {
    return {
      webhooks: await this.webhooks.list(org.id),
      // What the page describes next to the list, from the one place the
      // worker reads it too.
      events: WEBHOOK_EVENTS,
      retryPolicy: WEBHOOK_DELIVERY_RETRY_POLICY,
      // The URL policy is the API's setting; the page must not guess it from
      // its own process environment.
      allowPrivateUrls: this.webhooks.allowPrivateUrls,
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentOrg() org: ActiveOrg,
    @Body(new ZodBody(createWebhookSchema, 'webhooks/create')) dto: CreateWebhookInput,
  ) {
    const { webhook, secret } = await this.webhooks.create(org.id, dto);
    return { webhook, secret, message: WEBHOOK_MESSAGES.CREATED };
  }

  @Get(':id')
  async get(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return { webhook: await this.webhooks.get(org.id, id) };
  }

  @Patch(':id')
  async update(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Body(new ZodBody(updateWebhookSchema, 'webhooks/update')) dto: UpdateWebhookInput,
  ) {
    return { webhook: await this.webhooks.update(org.id, id, dto), message: WEBHOOK_MESSAGES.UPDATED };
  }

  @Delete(':id')
  async remove(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return { webhook: await this.webhooks.remove(org.id, id), message: WEBHOOK_MESSAGES.DELETED };
  }

  @Post(':id/rotate-secret')
  @HttpCode(HttpStatus.OK)
  async rotateSecret(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    const { webhook, secret } = await this.webhooks.rotateSecret(org.id, id);
    return { webhook, secret, message: WEBHOOK_MESSAGES.SECRET_ROTATED };
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.ACCEPTED)
  async test(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    const { delivery, scheduled } = await this.webhooks.sendTest(org.id, id);
    return {
      delivery,
      scheduled,
      message: scheduled ? WEBHOOK_MESSAGES.TEST_QUEUED : WEBHOOK_MESSAGES.SCHEDULER_UNAVAILABLE,
    };
  }

  @Get(':id/deliveries')
  async deliveries(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return { deliveries: await this.webhooks.deliveries(org.id, id) };
  }
}
