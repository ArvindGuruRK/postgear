import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { isAvatarPresetId } from './avatar.presets';
import { type AvatarUploadInput, AvatarService, MAX_AVATAR_UPLOAD_BYTES } from './avatar.service';

/**
 * The signed-in user's avatar (UI revamp, 2026-10-17).
 *
 * Same conventions as `UsersController`: authentication only, no `@Roles()`;
 * an avatar belongs to the person, not to a workspace, and the onboarding
 * profile step calls these routes before onboarding is marked complete. Every
 * route answers `{ avatar }` in the `SessionAvatar` shape `/auth/me` uses, so
 * the client can swap the preview without refetching the session.
 */
export const avatarPresetSchema = z
  .object({ id: z.string().max(64).refine(isAvatarPresetId, 'unknown preset') })
  .strict();

/**
 * In memory, not on disk like media uploads: the cap is 5 MB, and the image
 * is decoded and shrunk to 256 px straight away, so a temp file would only add
 * a write, a read and a cleanup path.
 */
const UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_AVATAR_UPLOAD_BYTES, files: 1, fields: 0 },
};

@Controller('users')
export class AvatarController {
  constructor(private readonly avatars: AvatarService) {}

  @Put('me/avatar/preset')
  @HttpCode(HttpStatus.OK)
  async setPreset(
    @CurrentUser() current: AuthenticatedUser,
    @Body(new ZodBody(avatarPresetSchema, 'users/avatar-preset')) dto: { id: string },
  ) {
    return { avatar: await this.avatars.setPreset(current.id, dto.id) };
  }

  @Post('me/avatar/upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  async upload(
    @CurrentUser() current: AuthenticatedUser,
    @UploadedFile() file: AvatarUploadInput | undefined,
  ) {
    return { avatar: await this.avatars.upload(current.id, file) };
  }

  @Delete('me/avatar')
  @HttpCode(HttpStatus.OK)
  async clear(@CurrentUser() current: AuthenticatedUser) {
    return { avatar: await this.avatars.clear(current.id) };
  }
}
