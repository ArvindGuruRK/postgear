/**
 * PostGear API — server entry point.
 *
 * Runs on :3001 alongside the Next.js app on :3000. They are separate origins
 * but the *same host*, and cookies are scoped by host rather than by port —
 * which is what lets the httpOnly session cookie set here be sent back by a
 * browser on :3000 without any proxying.
 */
import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Standard security headers. `contentSecurityPolicy` is off because this
  // process serves JSON only — the CSP that matters belongs on the Next app,
  // and one here would only apply to error pages nobody renders.
  app.use(helmet({ contentSecurityPolicy: false }));

  // Required by JwtAuthGuard and RolesGuard, both of which read cookies.
  app.use(cookieParser());

  // Makes `request.ip` the left-most untrusted hop instead of the proxy's own
  // address. Without it, every request behind a load balancer shares one IP
  // and the per-IP rate limit throttles the entire user base as a single
  // client. `1` — trust exactly one hop — rather than `true`, which would let
  // any client spoof its address with an X-Forwarded-For header and bypass
  // the throttle entirely.
  app.set('trust proxy', 1);

  app.enableCors({
    origin: config.get<string>('WEB_URL', 'http://localhost:3000'),
    // Without this the browser drops the Set-Cookie on every auth response,
    // and login appears to succeed while leaving the user signed out.
    credentials: true,
  });

  // No global ValidationPipe. Nest's built-in one requires class-validator,
  // which this app does not use — every route body is validated by an explicit
  // `ZodBody` pipe instead, and every one of those schemas is `.strict()`, so
  // unknown properties are rejected rather than merely stripped. Installing
  // class-validator purely to register a pipe that would never fire would be a
  // second validation vocabulary for no gain.

  const port = config.get<number>('PORT', 3001);
  await app.listen(port);

  logger.log(`API listening on http://localhost:${port}`);
}

void bootstrap();
