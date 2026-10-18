/**
 * The AI routes.
 *
 * `@Roles(ADMIN, USER)` makes an active membership mandatory while leaving
 * every member free to generate, as the posts and media controllers do.
 *
 * ## The streaming handlers
 *
 * `POST /ai/generate` and `POST /ai/copilot/chat` answer with server-sent
 * events. Each runs the service's two phases in order: `prepare*` first,
 * which may throw and so still produces an ordinary JSON error through the
 * global filter; then the stream is opened and the run writes to it. Taking
 * `@Res()` hands the response to the handler, so Nest sends nothing itself:
 * `stream.close()` ends it, whatever happened inside. `@HttpCode(200)` is
 * stated because a `@Post()` would otherwise be a 201, which these are not.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { Role } from '@postgear/db';
import type { Request, Response } from 'express';
import { type ActiveOrg, CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { openSseStream } from '../../common/sse';
import { AiService } from './ai.service';
import {
  type CopilotChatInput,
  copilotChatSchema,
  type GenerateInput,
  generateSchema,
} from './dto/ai.schema';

@Controller('ai')
@Roles(Role.ADMIN, Role.USER)
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('status')
  status() {
    return { status: this.ai.status() };
  }

  @Get('credits')
  async credits(@CurrentOrg() org: ActiveOrg) {
    return { credits: await this.ai.creditsSummary(org.id) };
  }

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generate(
    @CurrentOrg() org: ActiveOrg,
    @Body(new ZodBody(generateSchema, 'ai/generate')) dto: GenerateInput,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const run = await this.ai.prepareGenerate(org.id, dto);
    const stream = openSseStream(request, response);

    try {
      await run(stream);
    } finally {
      stream.close();
    }
  }

  @Post('copilot/chat')
  @HttpCode(HttpStatus.OK)
  async chat(
    @CurrentOrg() org: ActiveOrg,
    @Body(new ZodBody(copilotChatSchema, 'ai/copilot/chat')) dto: CopilotChatInput,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const run = await this.ai.prepareChat(org.id, dto);
    const stream = openSseStream(request, response);

    try {
      await run(stream);
    } finally {
      stream.close();
    }
  }
}
