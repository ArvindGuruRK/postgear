/**
 * The Webhook trigger's panel (Module 13): its private link, the secret's
 * last four characters and the last data received (any member), and
 * Create Secret / Regenerate Secret (admins only, since the secret lets
 * another app start the workflow for the whole workspace).
 *
 * The full secret is answered once, by `POST`, and never stored.
 */
import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Role } from '@postgear/db';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { WebhookService } from './webhook.service';

@Controller('automations')
@Roles(Role.ADMIN, Role.USER)
export class WebhookController {
  constructor(private readonly webhooks: WebhookService) {}

  @Get(':id/webhook')
  panel(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return this.webhooks.panel(org.id, id);
  }

  @Post(':id/webhook/secret')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  newSecret(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return this.webhooks.newSecret(org.id, id);
  }
}
