import { Module } from '@nestjs/common';
import { AppearanceController } from './appearance.controller';
import { AvatarController } from './avatar.controller';
import { AvatarModule } from './avatar.module';
import { UsersController } from './users.controller';

@Module({
  imports: [AvatarModule],
  controllers: [UsersController, AppearanceController, AvatarController],
})
export class UsersModule {}
