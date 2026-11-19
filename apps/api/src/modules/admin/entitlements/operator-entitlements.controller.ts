/**
 * The operator's plan, workspace and Change Log routes (Sprint 12, Module 19
 * section 8). Platform operators only (`@PlatformAdmin()` on each class);
 * every write is throttled (`@OperatorWrite()`), needs a reason, and is
 * recorded. The workspace is the path's `:orgId`: the org cookie is never
 * read, so an operator never acts on whichever workspace another tab had
 * open.
 *
 * | Route | What |
 * |---|---|
 * | `GET /operator/entitlements/plans` | Every key and tier, stored values with their `updatedAt`, the seed, overrides ending within 7 days |
 * | `PUT /operator/entitlements/plans` | Save the edited cells: one transaction, one Change Log row a cell, 409 on a stale `updatedAt` |
 * | `GET /operator/workspaces?q=` | Search by name, id or an admin's address |
 * | `GET /operator/workspaces/:orgId/entitlements` | Tier, status, values and where each came from, the overrides |
 * | `PUT` and `DELETE /operator/workspaces/:orgId/overrides/:key` | Add or change, and remove, one override |
 * | `GET /operator/workspaces/:orgId/usage` | The meters this cycle and the last 50 ledger entries |
 * | `POST /operator/workspaces/:orgId/usage/adjust` | A ledger ADJUSTMENT and its Change Log row |
 * | `GET /operator/changes` | The Change Log, filtered. There is no route to edit or delete a row |
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { PlatformAdmin } from '../../../common/decorators/platform-admin.decorator';
import { ZodBody, ZodQuery } from '../../../common/pipes/zod-validation.pipe';
import { OperatorWrite } from '../operator-write.guard';
import {
  type AdjustUsageInput,
  adjustUsageSchema,
  type ChangesQuery,
  changesQuerySchema,
  type DeleteOverrideInput,
  deleteOverrideSchema,
  type PutOverrideInput,
  putOverrideSchema,
  type SavePlansInput,
  type SearchWorkspacesQuery,
  savePlansSchema,
  searchWorkspacesQuerySchema,
} from './operator-entitlements.schema';
import { OperatorEntitlementsService } from './operator-entitlements.service';

@Controller('operator/entitlements')
@PlatformAdmin()
export class OperatorPlansController {
  constructor(private readonly entitlements: OperatorEntitlementsService) {}

  @Get('plans')
  plans() {
    return this.entitlements.plans();
  }

  /** `{ saved, plans }`; 409 `operator_conflict`, 422 `invalid_value`. */
  @Put('plans')
  @OperatorWrite()
  save(
    @Body(new ZodBody(savePlansSchema, 'operator/plans/save')) body: SavePlansInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.entitlements.savePlans(body, user);
  }
}

@Controller('operator/workspaces')
@PlatformAdmin()
export class OperatorWorkspacesController {
  constructor(private readonly entitlements: OperatorEntitlementsService) {}

  @Get()
  search(
    @Query(new ZodQuery(searchWorkspacesQuerySchema, 'operator/workspaces'))
    query: SearchWorkspacesQuery,
  ) {
    return this.entitlements.searchWorkspaces(query.q);
  }

  @Get(':orgId/entitlements')
  entitlementsOf(@Param('orgId') orgId: string) {
    return this.entitlements.workspaceEntitlements(orgId);
  }

  /** Answers the workspace's entitlements again, with the change in them. */
  @Put(':orgId/overrides/:key')
  @OperatorWrite()
  putOverride(
    @Param('orgId') orgId: string,
    @Param('key') key: string,
    @Body(new ZodBody(putOverrideSchema, 'operator/overrides/put')) body: PutOverrideInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.entitlements.putOverride(orgId, key, body, user);
  }

  @Delete(':orgId/overrides/:key')
  @OperatorWrite()
  @HttpCode(HttpStatus.OK)
  removeOverride(
    @Param('orgId') orgId: string,
    @Param('key') key: string,
    @Body(new ZodBody(deleteOverrideSchema, 'operator/overrides/delete')) body: DeleteOverrideInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.entitlements.removeOverride(orgId, key, body, user);
  }

  @Get(':orgId/usage')
  usage(@Param('orgId') orgId: string) {
    return this.entitlements.usageOf(orgId);
  }

  /** `{ duplicate, usage }`: a repeat of the same dialog's key writes nothing. */
  @Post(':orgId/usage/adjust')
  @OperatorWrite()
  @HttpCode(HttpStatus.OK)
  adjust(
    @Param('orgId') orgId: string,
    @Body(new ZodBody(adjustUsageSchema, 'operator/usage/adjust')) body: AdjustUsageInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.entitlements.adjustUsage(orgId, body, user);
  }
}

/** Append only: a GET and nothing else, so no route can edit or delete a row. */
@Controller('operator/changes')
@PlatformAdmin()
export class OperatorChangesController {
  constructor(private readonly entitlements: OperatorEntitlementsService) {}

  @Get()
  changes(@Query(new ZodQuery(changesQuerySchema, 'operator/changes')) query: ChangesQuery) {
    return this.entitlements.changes(query);
  }
}
