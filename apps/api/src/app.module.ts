import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { validateEnv } from './config/env';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AuthModule } from './modules/auth/auth.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { MailModule } from './modules/mail/mail.module';
import { MediaModule } from './modules/media/media.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { OrgModule } from './modules/org/org.module';
import { PostsModule } from './modules/posts/posts.module';
import { RedisModule } from './modules/redis/redis.module';
import { UsersModule } from './modules/users/users.module';

/**
 * Root module.
 *
 * ## Guard order is a security property, not a style choice
 *
 * `APP_GUARD` providers run in registration order, so `JwtAuthGuard` is listed
 * first: it is what attaches `request.user`, and `RolesGuard` reads that to
 * resolve the active workspace. Swapping them would leave `RolesGuard` looking
 * at an unauthenticated request, where its own defensive check turns every
 * role-guarded route into a 403 — a failure that is at least loud, but the
 * ordering is what makes it correct.
 *
 * Both are **global**, so authentication is the default for every route in
 * every module, present and future. A new controller is protected the moment
 * it exists; opting out takes an explicit `@Public()`.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Zod-validated at boot. A missing JWT_SECRET kills the process here
      // rather than producing unsigned tokens at runtime.
      validate: validateEnv,
      // The API is started through `dotenv -e ../../.env`, keeping the repo
      // root's .env as the single source of truth (the same approach
      // packages/db takes for Prisma). No per-app .env to drift.
      ignoreEnvFile: true,
    }),
    RedisModule,
    MailModule,
    AuthModule,
    UsersModule,
    OrgModule,
    OnboardingModule,
    ChannelsModule,
    MediaModule,
    PostsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
