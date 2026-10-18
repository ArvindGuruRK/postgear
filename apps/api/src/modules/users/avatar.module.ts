import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { AvatarService } from './avatar.service';

/**
 * `AvatarService` on its own module because two places need it: the users
 * module's `AvatarController`, and the auth module, which imports the OAuth
 * provider's photo when it creates an account. Importing `UsersModule` into
 * `AuthModule` instead would drag every users controller's dependencies into
 * auth. The storage backend comes from `MediaModule`'s export, so avatars land
 * wherever media does, configured once.
 */
@Module({
  imports: [MediaModule],
  providers: [AvatarService],
  exports: [AvatarService],
})
export class AvatarModule {}
