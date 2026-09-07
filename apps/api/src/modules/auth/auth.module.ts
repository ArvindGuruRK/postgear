import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LockoutService } from './lockout.service';
import { PasswordService } from './password.service';
import { FacebookAuthProvider } from './providers/facebook.provider';
import { GoogleAuthProvider } from './providers/google.provider';
import { ProvidersManager } from './providers/providers.manager';
import { TokenService } from './token.service';

@Module({
  imports: [
    // Registered async so the secret comes from the validated config rather
    // than a raw `process.env` read that would silently sign with `undefined`
    // if the variable were missing.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          // Cast because @nestjs/jwt types this as ms's `StringValue` template
          // literal union ('7d' | '1h' | ...), which a runtime config value
          // cannot satisfy statically. Zod has already validated it is a
          // non-empty string; an unparseable duration fails loudly at boot.
          expiresIn: config.get<string>('JWT_EXPIRES_IN', '7d') as `${number}d`,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    LockoutService,
    GoogleAuthProvider,
    FacebookAuthProvider,
    ProvidersManager,
  ],
  // JwtModule is re-exported so JwtAuthGuard — registered globally in
  // AppModule — can inject JwtService without re-configuring the secret.
  exports: [AuthService, PasswordService, JwtModule],
})
export class AuthModule {}
