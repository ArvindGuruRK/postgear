/**
 * The Schedule Maker's one route (Sprint 13, Module 14 section C3).
 *
 * `POST /studio/schedules/fetch` `{ login, timeZone, weekStart }` answers a
 * week of a Twitch schedule as UTC segments. A POST, not a GET, because it
 * is throttled and may reach Twitch; `@HttpCode(200)` because it creates
 * nothing. Every member role that designs may use it, Editors included
 * (`ADMIN, USER, EDITOR`), like the rest of Studio.
 *
 * The design itself is made by the ordinary `POST /studio/designs`, with the
 * rows filled in (`schedule` on the create body).
 */
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Role } from '@postgear/db';
import { type ActiveOrg, CurrentOrg } from '../../../common/decorators/current-org.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ZodBody } from '../../../common/pipes/zod-validation.pipe';
import { type FetchScheduleInput, fetchScheduleSchema } from './dto/schedules.schema';
import { type ScheduleAnswer, SchedulesService } from './schedules.service';

@Controller('studio/schedules')
@Roles(Role.ADMIN, Role.USER, Role.EDITOR)
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Post('fetch')
  @HttpCode(HttpStatus.OK)
  fetch(
    @CurrentOrg() org: ActiveOrg,
    @Body(new ZodBody(fetchScheduleSchema, 'studio.schedules.fetch')) body: FetchScheduleInput,
  ): Promise<ScheduleAnswer> {
    return this.schedules.fetch(org.id, body);
  }
}
