/**
 * Internal step gateway route for Module 12: Email. The worker calls it
 * with the step's resolved recipients, subject and message; no user
 * session (`@Public()`), the internal token instead, and the body is bound
 * to a live run's Email step by `GatewayEmailService`.
 */
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { ZodBody } from '../../../common/pipes/zod-validation.pipe';
import { type GatewayEmailInput, gatewayEmailSchema } from './gateway-email.schema';
import { GatewayEmailService } from './gateway-email.service';
import { InternalTokenGuard } from './internal-token.guard';

@Public()
@UseGuards(InternalTokenGuard)
@Controller('internal/automation')
export class GatewayEmailController {
  constructor(private readonly email: GatewayEmailService) {}

  @Post('email')
  @HttpCode(200)
  send(
    @Body(new ZodBody(gatewayEmailSchema, 'internal/automation/email')) body: GatewayEmailInput,
  ) {
    return this.email.send(body);
  }
}
