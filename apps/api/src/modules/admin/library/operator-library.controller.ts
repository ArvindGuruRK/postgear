/**
 * The operator's Library routes (Sprint 12, Module 19 section 9). Platform
 * operators only; every write is throttled, needs a reason (the run publish
 * needs the review tick instead) and is recorded. **No route here takes a
 * source address and nothing fetches anything**: ingest is a script.
 *
 * | Route | What |
 * |---|---|
 * | `GET /operator/library/runs` | The newest ingest runs, their counts and rejections |
 * | `GET /operator/library/runs/:id` | One run, its report's signed address, what would publish |
 * | `POST /operator/library/runs/:id/publish` | `{ reviewed: true }`: its staged items go live, the guard holding back any it refuses |
 * | `GET /operator/library/items` | Items in any status, filtered and searched |
 * | `GET /operator/library/items/:type/:id` | One item and how many clips use it |
 * | `POST /operator/library/items/:type/:id/publish`, `hide`, `restore`, `remove` | `{ reason }` |
 * | `GET /operator/library/deny` | The deny list, read only |
 * | `GET /operator/library/misses` | The top 50 searches with no result |
 * | `GET /operator/library/sources`, `PATCH .../sources/:id` | The credit sources; only their words change |
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { LibraryItemType } from '@postgear/video-engine';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { PlatformAdmin } from '../../../common/decorators/platform-admin.decorator';
import { ZodBody, ZodQuery } from '../../../common/pipes/zod-validation.pipe';
import { OperatorWrite } from '../operator-write.guard';
import { OPERATOR_LIBRARY_MESSAGES } from './operator-library.messages';
import {
  LIBRARY_ITEM_TYPES,
  type LibraryItemsQuery,
  type LibraryReasonInput,
  libraryItemsQuerySchema,
  libraryReasonSchema,
  type PatchSourceInput,
  patchSourceSchema,
  publishRunSchema,
} from './operator-library.schema';
import { OperatorLibraryService } from './operator-library.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The path's `:type`, or the item's 404 (an unknown type is not an item). */
function itemType(value: string): LibraryItemType {
  if ((LIBRARY_ITEM_TYPES as readonly string[]).includes(value)) return value as LibraryItemType;
  throw new NotFoundException(OPERATOR_LIBRARY_MESSAGES.ITEM_NOT_FOUND);
}

function runId(value: string): string {
  if (UUID.test(value)) return value;
  throw new NotFoundException(OPERATOR_LIBRARY_MESSAGES.RUN_NOT_FOUND);
}

function sourceId(value: string): string {
  if (UUID.test(value)) return value;
  throw new NotFoundException(OPERATOR_LIBRARY_MESSAGES.SOURCE_NOT_FOUND);
}

@Controller('operator/library')
@PlatformAdmin()
export class OperatorLibraryController {
  constructor(private readonly library: OperatorLibraryService) {}

  @Get('runs')
  runs() {
    return this.library.runs();
  }

  @Get('runs/:id')
  run(@Param('id') id: string) {
    return this.library.run(runId(id));
  }

  /** `{ published, heldBack, run }`; 409 `nothing_staged`, 422 when the guard refuses every item. */
  @Post('runs/:id/publish')
  @OperatorWrite()
  @HttpCode(HttpStatus.OK)
  publishRun(
    @Param('id') id: string,
    @Body(new ZodBody(publishRunSchema, 'operator/library/runs/publish')) _body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.library.publishRun(runId(id), user);
  }

  @Get('items')
  items(
    @Query(new ZodQuery(libraryItemsQuerySchema, 'operator/library/items'))
    query: LibraryItemsQuery,
  ) {
    return this.library.items(query);
  }

  @Get('items/:type/:id')
  item(@Param('type') type: string, @Param('id') id: string) {
    return this.library.item(itemType(type), id);
  }

  @Post('items/:type/:id/publish')
  @OperatorWrite()
  @HttpCode(HttpStatus.OK)
  publishItem(
    @Param('type') type: string,
    @Param('id') id: string,
    @Body(new ZodBody(libraryReasonSchema, 'operator/library/items/publish'))
    body: LibraryReasonInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.library.publishItem(itemType(type), id, body.reason, user);
  }

  @Post('items/:type/:id/hide')
  @OperatorWrite()
  @HttpCode(HttpStatus.OK)
  hideItem(
    @Param('type') type: string,
    @Param('id') id: string,
    @Body(new ZodBody(libraryReasonSchema, 'operator/library/items/hide')) body: LibraryReasonInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.library.hideItem(itemType(type), id, body.reason, user);
  }

  @Post('items/:type/:id/restore')
  @OperatorWrite()
  @HttpCode(HttpStatus.OK)
  restoreItem(
    @Param('type') type: string,
    @Param('id') id: string,
    @Body(new ZodBody(libraryReasonSchema, 'operator/library/items/restore'))
    body: LibraryReasonInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.library.restoreItem(itemType(type), id, body.reason, user);
  }

  @Post('items/:type/:id/remove')
  @OperatorWrite()
  @HttpCode(HttpStatus.OK)
  removeItem(
    @Param('type') type: string,
    @Param('id') id: string,
    @Body(new ZodBody(libraryReasonSchema, 'operator/library/items/remove'))
    body: LibraryReasonInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.library.removeItem(itemType(type), id, body.reason, user);
  }

  @Get('deny')
  deny() {
    return this.library.deny();
  }

  @Get('misses')
  misses() {
    return this.library.misses();
  }

  @Get('sources')
  sources() {
    return this.library.sources();
  }

  @Patch('sources/:id')
  @OperatorWrite()
  updateSource(
    @Param('id') id: string,
    @Body(new ZodBody(patchSourceSchema, 'operator/library/sources/patch')) body: PatchSourceInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.library.updateSource(sourceId(id), body, user);
  }
}
