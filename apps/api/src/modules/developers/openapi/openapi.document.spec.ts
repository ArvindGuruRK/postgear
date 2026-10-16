/**
 * The published contract, pinned: every `/v1` path is documented, every
 * operation requires the key, the request body is the zod schema, and the
 * document survives a JSON round trip (it is served as JSON).
 */
import type { OperationObject, PathItemObject } from '@nestjs/swagger';
import { createPublicPostSchema } from '../v1/dto/v1.schema';
import { buildOpenApiDocument, OPENAPI_SECURITY_SCHEME } from './openapi.document';

const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

function operations(item: PathItemObject): [string, OperationObject][] {
  return METHODS.flatMap((method) => {
    const operation = item[method];
    return operation ? [[method, operation] as [string, OperationObject]] : [];
  });
}

describe('buildOpenApiDocument', () => {
  const document = buildOpenApiDocument({ serverUrl: 'http://localhost:3001' });

  it('is OpenAPI 3 for the PostGear API, served from the configured URL', () => {
    expect(document.openapi).toMatch(/^3\./);
    expect(document.info.title).toBe('PostGear API');
    expect(document.servers).toEqual([{ url: 'http://localhost:3001' }]);
  });

  it('documents every /v1 path and nothing else', () => {
    expect(Object.keys(document.paths).sort()).toEqual([
      '/v1/analytics/overview',
      '/v1/channels',
      '/v1/me',
      '/v1/posts',
      '/v1/posts/{id}',
    ]);
    expect(document.paths['/v1/posts']).toHaveProperty('get');
    expect(document.paths['/v1/posts']).toHaveProperty('post');
    expect(document.paths['/v1/posts/{id}']).toHaveProperty('get');
    expect(document.paths['/v1/posts/{id}']).toHaveProperty('delete');
  });

  it('declares the bearer scheme and requires it on every operation', () => {
    expect(document.components?.securitySchemes?.[OPENAPI_SECURITY_SCHEME]).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(document.security).toEqual([{ [OPENAPI_SECURITY_SCHEME]: [] }]);

    const all = Object.values(document.paths).flatMap(operations);
    expect(all.length).toBeGreaterThanOrEqual(7);

    for (const [, operation] of all) {
      expect(operation.security).toEqual([{ [OPENAPI_SECURITY_SCHEME]: [] }]);
      expect(operation.responses['401']).toBeDefined();
      expect(operation.responses['429']).toBeDefined();
      expect(operation.operationId).toEqual(expect.any(String));
    }
  });

  it('builds the create-post body from the zod schema, strictly', () => {
    const schema = document.components?.schemas?.CreatePostRequest as {
      type: string;
      required: string[];
      properties: Record<string, unknown>;
      additionalProperties: boolean;
    };

    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['text', 'channelIds']);
    expect(Object.keys(schema.properties).sort()).toEqual(
      Object.keys(createPublicPostSchema.shape).sort(),
    );
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.state).toMatchObject({ enum: ['draft', 'queue'], default: 'queue' });
    expect(schema).not.toHaveProperty('$schema');
  });

  it('resolves every $ref to a declared component', () => {
    const names = new Set(Object.keys(document.components?.schemas ?? {}));
    const refs = JSON.stringify(document).match(/#\/components\/schemas\/([A-Za-z]+)/g) ?? [];

    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(names.has(ref.replace('#/components/schemas/', ''))).toBe(true);
    }
  });

  it('round-trips through JSON unchanged', () => {
    expect(JSON.parse(JSON.stringify(document))).toEqual(document);
  });
});
