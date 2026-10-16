/**
 * Serves the `/v1` reference: Swagger UI at `/api/docs`, the document at
 * `/api/docs-json` (Sprint 8).
 *
 * Both are public by construction, not by `@Public()`: `SwaggerModule.setup`
 * registers them on the Express adapter directly, before Nest's router, so
 * no guard — session or key — ever sees them. There is nothing in the
 * document a caller could not learn by reading this repository, and an
 * integrator reads it before they have a key.
 *
 * Called from `main.ts` right before `app.listen`.
 */
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import type { Env } from '../../../config/env';
import { buildOpenApiDocument, OPENAPI_JSON_PATH, OPENAPI_UI_PATH } from './openapi.document';

export function setupOpenApi(app: INestApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const document = buildOpenApiDocument({ serverUrl: config.get('API_URL', { infer: true }) });

  SwaggerModule.setup(OPENAPI_UI_PATH, app, document, {
    jsonDocumentUrl: OPENAPI_JSON_PATH,
    // JSON only. The default also serves a YAML copy at a path nothing
    // documents, and one more public route is one more thing to explain.
    raw: ['json'],
    customSiteTitle: 'PostGear API',
    swaggerOptions: {
      // The key outlives a page reload, so a developer trying calls from the
      // UI does not paste it back in after every edit of the document.
      persistAuthorization: true,
    },
  });
}
