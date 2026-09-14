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
import type { Env } from './config/env';
import { storageConfigFrom } from './modules/media/media.module';
import { UPLOADS_ROUTE } from './modules/media/storage/local.storage';
import { resolveUploadDirectory } from './modules/media/storage/storage.factory';

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

  // A post is sent whole: every part of a thread, for every channel that has
  // been customized, as structured documents. Express's 100 KB default is
  // reached by an ordinary customized thread; 1 MB is roomy for any real post
  // and still a hard cap. Every document inside is bounded again by its schema.
  app.useBodyParser('json', { limit: '1mb' });

  // Local-disk media (Sprint 4), served at /uploads when that backend is active.
  //
  // Public, like an S3 object: platforms fetch media without a session, and
  // the random key is the access control. Registered as middleware, so it is
  // answered before any guard runs — which is the point, not an oversight.
  //
  // Two headers are overridden for this route only:
  // - `Cross-Origin-Resource-Policy: cross-origin`. Helmet's default,
  //   `same-origin`, makes the browser refuse to render these images inside
  //   the web app, which is a different origin (port 3000 vs 3001).
  // - A `sandbox` CSP. Only sniffed images and video are ever stored here, but
  //   if anything else were, it still could not run script on this origin.
  const storage = storageConfigFrom(app.get<ConfigService<Env, true>>(ConfigService));

  if (storage.provider === 'local') {
    app.useStaticAssets(resolveUploadDirectory(storage.uploadDirectory), {
      prefix: `${UPLOADS_ROUTE}/`,
      index: false,
      dotfiles: 'deny',
      // Keys are never reused, so a cached copy can never be stale.
      immutable: true,
      maxAge: '365d',
      setHeaders: (response) => {
        response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      },
    });
  }

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
