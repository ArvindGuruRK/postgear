/**
 * The OpenAPI 3 document for `/v1` (Sprint 8, contract §5.3).
 *
 * Built by hand rather than from `@nestjs/swagger`'s decorators, for two
 * reasons. First, the decorators describe class-validator DTOs, and this
 * API validates with zod, so the request bodies here are generated from
 * the very schemas the routes enforce (`zod-to-json-schema`), and cannot
 * drift from them. Second, only `/v1` is public; a decorator scan would
 * document the session routes too, and an "internal" tag is not a boundary.
 *
 * The response shapes are written out against `v1.types.ts`. They are the
 * one thing here that could drift, which is why the spec pins them.
 */
import { DocumentBuilder } from '@nestjs/swagger';
import type {
  OpenAPIObject,
  OperationObject,
  ParameterObject,
  ReferenceObject,
  SchemaObject,
} from '@nestjs/swagger';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ANALYTICS_RANGES, DEFAULT_RANGE } from '../../analytics/dto/analytics.schema';
import { API_KEY_SECRET_LENGTH } from '../api-keys/api-key.crypto';
import {
  createPublicPostSchema,
  MAX_PUBLIC_PAGE,
  PUBLIC_STATE_FILTERS,
} from '../v1/dto/v1.schema';

/** The security scheme's name: what every operation's `security` refers to. */
export const OPENAPI_SECURITY_SCHEME = 'apiKey';

export const OPENAPI_UI_PATH = 'api/docs';
export const OPENAPI_JSON_PATH = 'api/docs-json';

const POST_STATES = ['DRAFT', 'QUEUE', 'PUBLISHED', 'ERROR'] as const;
const CHANNEL_HEALTH = [
  'connected',
  'needs_reconnect',
  'needs_setup',
  'expiring',
  'disabled',
] as const;
const PLAN_TIERS = ['FREE', 'STANDARD', 'PRO', 'TEAM', 'ULTIMATE'] as const;

const TAGS = {
  workspace: 'Workspace',
  channels: 'Channels',
  posts: 'Posts',
  analytics: 'Analytics',
} as const;

export interface OpenApiDocumentOptions {
  /** Absolute URL of the API, for the `servers` entry. Omitted in tests. */
  serverUrl?: string;
}

export function buildOpenApiDocument(options: OpenApiDocumentOptions = {}): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('PostGear API')
    .setDescription(
      [
        'The public PostGear API. Every request carries an API key created on the',
        'workspace\'s **Settings → API keys** page, sent as',
        '`Authorization: Bearer pg_…` (or `X-API-Key: pg_…`). A key acts as an',
        'admin of its workspace.',
        '',
        `Every response is JSON. Errors are \`{ "error": string, "statusCode": number }\`.`,
        'Calls are limited per key per minute; a `429` carries `Retry-After` in seconds.',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'pg_…',
        description: `A PostGear API key: \`pg_\` followed by 40 characters (${API_KEY_SECRET_LENGTH} in all).`,
      },
      OPENAPI_SECURITY_SCHEME,
    )
    .addSecurityRequirements(OPENAPI_SECURITY_SCHEME)
    .addTag(TAGS.workspace, 'The workspace a key opens.')
    .addTag(TAGS.channels, 'Connected social channels.')
    .addTag(TAGS.posts, 'Drafts and the queue.')
    .addTag(TAGS.analytics, 'What the daily sync recorded.');

  if (options.serverUrl) {
    builder.addServer(options.serverUrl);
  }

  const base = builder.build();

  return {
    ...base,
    paths: buildPaths(),
    components: { ...base.components, schemas: buildSchemas() },
  };
}

/* ───────────────────────────── paths ───────────────────────────── */

function buildPaths(): OpenAPIObject['paths'] {
  return {
    '/v1/me': {
      get: operation({
        tags: [TAGS.workspace],
        operationId: 'getMe',
        summary: 'The workspace, key and plan behind this request',
        description: 'The first call to make: confirms the key works and names what it opens.',
        responses: { '200': jsonResponse('The caller', ref('Me')) },
      }),
    },
    '/v1/channels': {
      get: operation({
        tags: [TAGS.channels],
        operationId: 'listChannels',
        summary: 'List connected channels',
        description:
          'Every channel connected to the workspace. Use a channel\'s `id` in `channelIds` when creating a post; a channel whose `health` is not `connected` may not publish.',
        responses: { '200': jsonResponse('The channels', ref('ChannelList')) },
      }),
    },
    '/v1/posts': {
      get: operation({
        tags: [TAGS.posts],
        operationId: 'listPosts',
        summary: 'List posts',
        description: 'The queue, newest first, twenty posts to a page.',
        parameters: [
          {
            name: 'state',
            in: 'query',
            required: false,
            description: 'Only posts in this state.',
            schema: { type: 'string', enum: [...PUBLIC_STATE_FILTERS] },
          },
          {
            name: 'page',
            in: 'query',
            required: false,
            description: 'Page number, from 1.',
            schema: { type: 'integer', minimum: 1, maximum: MAX_PUBLIC_PAGE, default: 1 },
          },
        ],
        responses: {
          '200': jsonResponse('One page of posts', ref('PostPage')),
          '400': errorResponse('The query was malformed'),
        },
      }),
      post: operation({
        tags: [TAGS.posts],
        operationId: 'createPost',
        summary: 'Create a post',
        description: [
          'Creates one post for one or more channels. `text` is plain text: a blank line starts a',
          'new paragraph and a single newline is a line break. With `state: "queue"` (the default)',
          'the post is scheduled for `publishAt`, which defaults to five minutes from now and must',
          'be in the future; a queued post is also checked against every platform rule of its',
          'channels, and the first rule it breaks is returned as a `422`. A `draft` is saved as is.',
        ].join(' '),
        requestBody: {
          required: true,
          content: { 'application/json': { schema: ref('CreatePostRequest') } },
        },
        responses: {
          '201': jsonResponse('The created post', ref('PostEnvelope')),
          '400': errorResponse(
            'The body was malformed, or named a channel or media item outside the workspace',
          ),
          '422': errorResponse('A queued post is in the past, or breaks a platform rule'),
        },
      }),
    },
    '/v1/posts/{id}': {
      parameters: [postIdParameter()],
      get: operation({
        tags: [TAGS.posts],
        operationId: 'getPost',
        summary: 'Read a post',
        description: 'The post with its parts as plain text and its media.',
        responses: {
          '200': jsonResponse('The post', ref('PostEnvelope')),
          '404': errorResponse('No such post in this workspace'),
        },
      }),
      delete: operation({
        tags: [TAGS.posts],
        operationId: 'deletePost',
        summary: 'Delete a post',
        description: 'Removes the post for every channel and cancels its schedule.',
        responses: {
          '200': jsonResponse('Deleted', {
            type: 'object',
            required: ['deleted'],
            properties: { deleted: { type: 'boolean', enum: [true] } },
          }),
          '404': errorResponse('No such post in this workspace'),
          '409': errorResponse('The post has already been published and cannot be changed'),
        },
      }),
    },
    '/v1/analytics/overview': {
      get: operation({
        tags: [TAGS.analytics],
        operationId: 'getAnalyticsOverview',
        summary: 'The analytics overview',
        description:
          'Totals, per-channel figures and the top posts for the last 7, 30 or 90 days: the same overview the Analytics page shows.',
        parameters: [
          {
            name: 'range',
            in: 'query',
            required: false,
            description: 'Days to cover.',
            schema: { type: 'integer', enum: [...ANALYTICS_RANGES], default: DEFAULT_RANGE },
          },
          {
            name: 'channelId',
            in: 'query',
            required: false,
            description: 'Restrict the overview to one channel.',
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': jsonResponse('The overview', ref('AnalyticsOverviewEnvelope')),
          '400': errorResponse('The query was malformed'),
          '422': errorResponse('`channelId` is not a channel of this workspace'),
        },
      }),
    },
  };
}

/**
 * Every operation declares the key as its security requirement and the two
 * answers every route can give: 401 for a bad key, 429 past the ceiling.
 */
function operation(
  spec: Omit<OperationObject, 'security' | 'responses'> & { responses: OperationObject['responses'] },
): OperationObject {
  return {
    ...spec,
    security: [{ [OPENAPI_SECURITY_SCHEME]: [] }],
    responses: {
      ...spec.responses,
      '401': errorResponse('The API key is missing, unknown or revoked'),
      '429': {
        description: 'The key\'s per-minute limit was reached. `Retry-After` says when to try again, in seconds.',
        headers: {
          'Retry-After': { schema: { type: 'integer' }, description: 'Seconds until the window resets.' },
        },
        content: { 'application/json': { schema: ref('Error') } },
      },
    },
  };
}

function postIdParameter(): ParameterObject {
  return {
    name: 'id',
    in: 'path',
    required: true,
    description: 'The post id, as returned by `POST /v1/posts` or the list.',
    schema: { type: 'string', format: 'uuid' },
  };
}

function jsonResponse(description: string, schema: SchemaObject | ReferenceObject) {
  return { description, content: { 'application/json': { schema } } };
}

function errorResponse(description: string) {
  return jsonResponse(description, ref('Error'));
}

function ref(name: string): ReferenceObject {
  return { $ref: `#/components/schemas/${name}` };
}

/* ─────────────────────────── schemas ─────────────────────────── */

function buildSchemas(): Record<string, SchemaObject> {
  const nullableString: SchemaObject = { type: 'string', nullable: true };
  const isoDate: SchemaObject = { type: 'string', format: 'date-time' };

  const postChannel: SchemaObject = {
    type: 'object',
    required: ['channelId', 'name', 'provider', 'state', 'url'],
    properties: {
      channelId: { type: 'string' },
      name: { type: 'string' },
      provider: { type: 'string', description: 'The provider identifier: `linkedin`, `x`, …' },
      state: { type: 'string', enum: [...POST_STATES] },
      url: { ...nullableString, description: 'The platform permalink once published.' },
    },
  };

  const postSummaryProperties: Record<string, SchemaObject | ReferenceObject> = {
    id: { type: 'string', format: 'uuid' },
    state: { type: 'string', enum: [...POST_STATES] },
    publishAt: isoDate,
    updatedAt: isoDate,
    preview: { type: 'string', description: 'The first 160 characters of the first part.' },
    channels: { type: 'array', items: postChannel },
  };
  const postSummaryRequired = ['id', 'state', 'publishAt', 'updatedAt', 'preview', 'channels'];

  return {
    Error: {
      type: 'object',
      required: ['error', 'statusCode'],
      properties: { error: { type: 'string' }, statusCode: { type: 'integer' } },
    },
    Me: {
      type: 'object',
      required: ['workspace', 'key', 'plan'],
      properties: {
        workspace: {
          type: 'object',
          required: ['id', 'name'],
          properties: { id: { type: 'string' }, name: { type: 'string' } },
        },
        key: {
          type: 'object',
          required: ['id', 'name', 'prefix'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            prefix: { type: 'string', description: 'The first 11 characters of the secret.' },
          },
        },
        plan: {
          type: 'object',
          required: ['tier'],
          properties: { tier: { type: 'string', enum: [...PLAN_TIERS] } },
        },
      },
    },
    Channel: {
      type: 'object',
      required: ['id', 'provider', 'providerName', 'name', 'profile', 'picture', 'health', 'disabled'],
      properties: {
        id: { type: 'string' },
        provider: { type: 'string', description: 'The provider identifier: `linkedin`, `x`, …' },
        providerName: { type: 'string', description: 'The provider\'s display name.' },
        name: { type: 'string' },
        profile: { ...nullableString, description: 'The account handle on the platform.' },
        picture: { ...nullableString, description: 'The account\'s avatar URL.' },
        health: { type: 'string', enum: [...CHANNEL_HEALTH] },
        disabled: { type: 'boolean' },
      },
    },
    ChannelList: {
      type: 'object',
      required: ['channels'],
      properties: { channels: { type: 'array', items: ref('Channel') } },
    },
    PostChannel: postChannel,
    PostSummary: {
      type: 'object',
      required: postSummaryRequired,
      properties: postSummaryProperties,
    },
    PostPart: {
      type: 'object',
      required: ['text', 'media'],
      properties: {
        text: { type: 'string', description: 'The part as plain text.' },
        media: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'url'],
            properties: { id: { type: 'string', format: 'uuid' }, url: { type: 'string' } },
          },
        },
      },
    },
    Post: {
      type: 'object',
      required: [...postSummaryRequired, 'parts'],
      properties: {
        ...postSummaryProperties,
        parts: {
          type: 'array',
          items: ref('PostPart'),
          description: 'The parts of the post in order; a thread has several.',
        },
      },
    },
    PostEnvelope: {
      type: 'object',
      required: ['post'],
      properties: { post: ref('Post') },
    },
    PostPage: {
      type: 'object',
      required: ['posts', 'page', 'pageCount', 'total'],
      properties: {
        posts: { type: 'array', items: ref('PostSummary') },
        page: { type: 'integer' },
        pageCount: { type: 'integer' },
        total: { type: 'integer' },
      },
    },
    CreatePostRequest: requestSchema(createPublicPostSchema),
    AnalyticsOverviewEnvelope: {
      type: 'object',
      required: ['overview'],
      properties: {
        overview: {
          type: 'object',
          description:
            'The overview as the Analytics page receives it: `range`, `from`, `to`, `generatedAt`, `simulated`, `totals`, `channels` (one entry per channel with its metric series) and `topPosts`.',
          required: ['range', 'from', 'to', 'generatedAt', 'simulated', 'totals', 'channels', 'topPosts'],
          properties: {
            range: { type: 'integer', enum: [...ANALYTICS_RANGES] },
            from: { type: 'string', format: 'date', description: 'First day covered, inclusive.' },
            to: { type: 'string', format: 'date', description: 'Last day covered, inclusive.' },
            generatedAt: isoDate,
            simulated: {
              type: 'boolean',
              description: 'True when the numbers come from a stand-in, not the platforms.',
            },
            totals: { type: 'object', additionalProperties: true },
            channels: { type: 'array', items: { type: 'object', additionalProperties: true } },
            topPosts: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
      },
    },
  };
}

/**
 * A zod schema as an OpenAPI 3 schema object. `$refStrategy: 'none'` inlines
 * everything, so the result stands alone under `components.schemas`.
 *
 * The cast on the way in is deliberate: `zod-to-json-schema` types its
 * parameter against zod's `v3` entry point, and a `.strict().refine()`
 * object from the app's own `zod` import fails to unify with it at the type
 * level while being the very same class at runtime.
 */
function requestSchema(schema: ZodTypeAny): SchemaObject {
  const { $schema: _ignored, ...rest } = zodToJsonSchema(
    schema as unknown as Parameters<typeof zodToJsonSchema>[0],
    { target: 'openApi3', $refStrategy: 'none' },
  ) as SchemaObject & { $schema?: string };

  return rest;
}
