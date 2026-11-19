/**
 * The operator's Clips routes (Sprint 12, Module 19 section 5). Platform
 * operators only (`@PlatformAdmin()`), writes throttled and recorded. The
 * video is named in the path; the org cookie is never read.
 */
import { Body, Controller, Delete, HttpCode, HttpStatus, Param } from '@nestjs/common';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../../common/decorators/current-user.decorator';
import { PlatformAdmin } from '../../../common/decorators/platform-admin.decorator';
import { ZodBody } from '../../../common/pipes/zod-validation.pipe';
import { OperatorWrite } from '../operator-write.guard';
import { type RemoveVideoInput, removeVideoSchema } from './operator-clips.schema';
import { OperatorClipsService } from './operator-clips.service';

@Controller('operator/clips')
@PlatformAdmin()
export class OperatorClipsController {
  constructor(private readonly clips: OperatorClipsService) {}

  /** A rights request: removes the video, blocks its link for everyone, tells the workspace. */
  @Delete('videos/:videoId')
  @OperatorWrite()
  @HttpCode(HttpStatus.OK)
  async removeVideo(
    @Param('videoId') videoId: string,
    @Body(new ZodBody(removeVideoSchema, 'operator/clips/remove')) body: RemoveVideoInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return { removed: await this.clips.removeVideo(videoId, body.reason, user) };
  }
}
