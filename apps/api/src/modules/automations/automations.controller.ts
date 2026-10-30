/**
 * Workflows (Sprint 10). The UI says Workflow; the routes and code say
 * automation.
 *
 * `@Roles(ADMIN, USER)`: any member builds and edits workflows, as any member
 * writes posts, and may Discard Changes or Restore As Draft (they only
 * touch the draft). Turning one on or off is admin only, because a live
 * workflow acts for the whole workspace (it publishes, messages, spends
 * credits); deleting an active one is too (checked in the service, since a
 * member may delete a draft through the same route).
 * Every handler scopes on `@CurrentOrg()`; the `:id` in a path is only the
 * workflow being acted on.
 *
 * The fixed paths (`catalog`, `templates`) are declared before `:id`, so
 * they are never read as an id.
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
  Put,
  Query,
} from '@nestjs/common';
import { Role } from '@postgear/db';
import { type ActiveOrg, CurrentOrg } from '../../common/decorators/current-org.decorator';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodBody, ZodQuery } from '../../common/pipes/zod-validation.pipe';
import { AUTOMATION_MESSAGES } from './automations.messages';
import { AutomationsService } from './automations.service';
import {
  type ActivateAutomationInput,
  activateAutomationSchema,
  type CreateAutomationInput,
  createAutomationSchema,
  type ListAutomationsQuery,
  listAutomationsQuerySchema,
  type PinDataInput,
  pinDataSchema,
  type RestoreVersionInput,
  restoreVersionSchema,
  type UpdateAutomationInput,
  updateAutomationSchema,
} from './dto/automations.schema';

@Controller('automations')
@Roles(Role.ADMIN, Role.USER)
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  @Get()
  list(
    @CurrentOrg() org: ActiveOrg,
    @Query(new ZodQuery(listAutomationsQuerySchema, 'automations/list'))
    query: ListAutomationsQuery,
  ) {
    return this.automations.list(org.id, query);
  }

  /** Every step with its state in this workspace: Ready, Needs A Connection or Coming Soon. */
  @Get('catalog')
  catalog(@CurrentOrg() org: ActiveOrg) {
    return this.automations.catalog(org.id);
  }

  /** Starter template details, without their graphs. */
  @Get('templates')
  templates() {
    return { templates: this.automations.templates() };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBody(createAutomationSchema, 'automations/create')) dto: CreateAutomationInput,
  ) {
    return { automation: await this.automations.create(org.id, user.id, dto) };
  }

  @Get(':id')
  async get(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return { automation: await this.automations.get(org.id, id) };
  }

  /** Autosave. A stale `draftRevision` is a 409 with `details.currentRevision`. */
  @Patch(':id')
  async update(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodBody(updateAutomationSchema, 'automations/update')) dto: UpdateAutomationInput,
  ) {
    return { automation: await this.automations.update(org.id, user.id, id, dto) };
  }

  /** Members delete drafts and paused workflows; an active one is admin only (403). */
  @Delete(':id')
  async remove(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    await this.automations.remove(org.id, org.role, id);
    return { message: AUTOMATION_MESSAGES.DELETED };
  }

  @Post(':id/duplicate')
  @HttpCode(HttpStatus.CREATED)
  async duplicate(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return { automation: await this.automations.duplicate(org.id, user.id, id) };
  }

  @Post(':id/validate')
  @HttpCode(HttpStatus.OK)
  validate(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return this.automations.validate(org.id, id);
  }

  @Put(':id/pinned/:nodeKey')
  async pin(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('nodeKey') nodeKey: string,
    @Body(new ZodBody(pinDataSchema, 'automations/pin')) dto: PinDataInput,
  ) {
    return { pinned: await this.automations.pin(org.id, user.id, id, nodeKey, dto.output) };
  }

  @Delete(':id/pinned/:nodeKey')
  async unpin(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Param('nodeKey') nodeKey: string,
  ) {
    await this.automations.unpin(org.id, id, nodeKey);
    return { message: AUTOMATION_MESSAGES.UNPINNED };
  }

  /**
   * Turn On, or Activate Changes (Module 09). 409 `automation_conflict` on a
   * stale revision; 422 `activation_blocked`, `confirm_automatic_posting` or
   * `schedule_too_frequent`. 200 with `warnings` when the schedule could not
   * be set up yet.
   */
  @Post(':id/activate')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  activate(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodBody(activateAutomationSchema, 'automations/activate'))
    dto: ActivateAutomationInput,
  ) {
    return this.automations.activate(org.id, user.id, id, dto);
  }

  /** Turn Off: deletes the schedule; runs in progress finish. */
  @Post(':id/pause')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async pause(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return { automation: await this.automations.pause(org.id, id) };
  }

  /** Discard Changes: the draft becomes the live version. 409 `no_active_version`. */
  @Post(':id/discard')
  @HttpCode(HttpStatus.OK)
  async discard(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return { automation: await this.automations.discard(org.id, user.id, id) };
  }

  /** Versions are read here and never changed: no route updates or deletes one. */
  @Get(':id/versions')
  async versions(@CurrentOrg() org: ActiveOrg, @Param('id') id: string) {
    return { versions: await this.automations.versions(org.id, id) };
  }

  @Get(':id/versions/:version')
  async version(
    @CurrentOrg() org: ActiveOrg,
    @Param('id') id: string,
    @Param('version') version: string,
  ) {
    return { version: await this.automations.version(org.id, id, version) };
  }

  /** Restore As Draft: writes the draft only (revision checked); what is live never changes. */
  @Post(':id/versions/:version/restore')
  @HttpCode(HttpStatus.OK)
  async restore(
    @CurrentOrg() org: ActiveOrg,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('version') version: string,
    @Body(new ZodBody(restoreVersionSchema, 'automations/restore')) dto: RestoreVersionInput,
  ) {
    return { automation: await this.automations.restore(org.id, user.id, id, version, dto) };
  }
}
