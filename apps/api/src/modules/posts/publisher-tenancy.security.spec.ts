/**
 * Security sweep, Sprint 13 Module 16: Module 13's publisher fields cannot be
 * set on another workspace's post or channel.
 *
 * - `madeWithAi` reaches a post only through `PostsService.create` and
 *   `update` (the composer, the public API's `POST /v1/posts`, Send To
 *   Composer and Copilot all go through them). Another workspace's channel is
 *   refused before anything is written; another workspace's post answers 404
 *   with its rows untouched; and the repository's own insert connects the
 *   channel scoped to the workspace, so even a caller that skipped the
 *   service could not attach a post to a foreign channel.
 * - The posting window (`postingTimes` entries with `windowMinutes` and
 *   `days`) is written only by `PATCH /channels/:id` through
 *   `ChannelsService.updateSettings`: another workspace's channel answers 404
 *   with its slots untouched, and the body cannot name a workspace.
 *
 * Real `PostsService`, `PostsRepository`, `ChannelsService` and
 * `ChannelsRepository` over an in-memory Prisma that honours each `where`.
 * Existing tests this extends: `channel-next-slot.service.spec.ts` "refuses
 * another workspace's channel and a zone no browser sends",
 * `clip-send.service.spec.ts` "refuses a channel that is not this workspace
 * own, and writes nothing", `posts.repository.spec.ts` "reports a group that
 * is not in this workspace as not found" and "connects each channel scoped to
 * the workspace and alive, not by id alone".
 */
type Row = Record<string, unknown>;

const tables: { integration: Row[]; post: Row[] } = { integration: [], post: [] };
const writes: string[] = [];

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, want]) => {
    const have = row[key];
    if (want === null) return have === null || have === undefined;
    if (want && typeof want === 'object' && !(want instanceof Date)) {
      const condition = want as { in?: unknown[]; not?: unknown };
      if (condition.in) return condition.in.includes(have);
      if ('not' in condition) return have !== condition.not;
      throw new Error(`the fake does not read ${key}: ${JSON.stringify(want)}`);
    }
    return have === want;
  });
}

/** A post as a read that includes its channel and tags sees it. */
function withRelations(row: Row): Row {
  const integration = tables.integration.find((one) => one.id === row.integrationId);
  return { ...row, integration: integration ? { ...integration } : null, tags: [] };
}

function table(name: keyof typeof tables) {
  return {
    findMany: jest.fn(async (args: { where?: Row } = {}) =>
      tables[name]
        .filter((row) => matches(row, args.where))
        .map((row) => (name === 'post' ? withRelations(row) : { ...row })),
    ),
    findFirst: jest.fn(async (args: { where?: Row } = {}) => {
      const row = tables[name].find((one) => matches(one, args.where));
      return row ? { ...row } : null;
    }),
    updateMany: jest.fn(async (args: { where: Row; data: Row }) => {
      const hit = tables[name].filter((row) => matches(row, args.where));
      for (const row of hit) {
        writes.push(`${name}.updateMany:${String(row.id)}`);
        Object.assign(row, args.data);
      }
      return { count: hit.length };
    }),
    update: jest.fn(async (args: { where: Row; data: Row }) => {
      const row = tables[name].find((one) => matches(one, args.where));
      if (!row) throw Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
      writes.push(`${name}.update:${String(row.id)}`);
      Object.assign(row, args.data);
      return { ...row };
    }),
    create: jest.fn(async (args: { data: Row }) => {
      if (name !== 'post') throw new Error('only posts are created here');
      const { integration, organization, parentPost, ...data } = args.data as Row & {
        integration: { connect: Row };
        organization: { connect: { id: string } };
        parentPost?: { connect: { id: string } };
      };
      // Prisma's nested connect: the channel must match the whole unique
      // filter, workspace and liveness included, or the insert fails.
      const channel = tables.integration.find((row) => matches(row, integration.connect));
      if (!channel)
        throw Object.assign(new Error('No Integration found for connect.'), { code: 'P2025' });
      const row: Row = {
        ...data,
        id: `post_${tables.post.length + 1}`,
        organizationId: organization.connect.id,
        integrationId: channel.id,
        parentPostId: parentPost?.connect.id ?? null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      writes.push(`post.create:${String(row.id)}`);
      tables.post.push(row);
      return { id: row.id };
    }),
  };
}

jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');
  const client: Record<string, unknown> = {
    integration: table('integration'),
    post: table('post'),
    tagsPosts: {
      deleteMany: jest.fn(async () => ({ count: 0 })),
      createMany: jest.fn(async () => ({ count: 0 })),
    },
  };
  client.$transaction = jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(client));
  return { ...actual, prisma: client };
});

import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EntitlementsService } from '../billing/entitlements.service';
import type { ChannelOAuthService } from '../channels/channel-oauth.service';
import { ChannelsRepository } from '../channels/channels.repository';
import { ChannelsService } from '../channels/channels.service';
import { updateChannelSchema } from '../channels/dto/channels.schema';
import type { MediaService } from '../media/media.service';
import type { SchedulingService } from '../scheduling/scheduling.service';
import type { TagsService } from '../tags/tags.service';
import { createPostSchema, updatePostSchema } from './dto/posts.schema';
import { POST_MESSAGES } from './posts.messages';
import { PostsRepository } from './posts.repository';
import { PostsService } from './posts.service';

const OURS = 'org_ours';
const THEIRS = 'org_theirs';
const THEIR_CHANNEL = 'ch_theirs';
const OUR_CHANNEL = 'ch_ours';
const THEIR_GROUP = '7b0a3c9e-2f4d-4e1a-9c6b-5d8e7f6a1b2c';
const STORED_AT = new Date('2026-11-20T10:00:00.000Z');
const THEIR_SLOTS = JSON.stringify([{ time: 540, windowMinutes: 0, days: [1, 2, 3, 4, 5, 6, 7] }]);

function channelRow(id: string, organizationId: string): Row {
  return {
    id,
    organizationId,
    internalId: `${id}-internal`,
    rootInternalId: null,
    providerIdentifier: 'linkedin',
    name: `Channel ${id}`,
    profile: null,
    picture: null,
    disabled: false,
    refreshNeeded: false,
    inBetweenSteps: false,
    tokenExpiration: null,
    postingTimes: THEIR_SLOTS,
    additionalSettings: '{}',
    createdAt: STORED_AT,
    deletedAt: null,
    position: 0,
    color: 1,
    token: 'sealed-token',
    refreshToken: null,
  };
}

function seed(): void {
  writes.length = 0;
  tables.integration = [channelRow(THEIR_CHANNEL, THEIRS), channelRow(OUR_CHANNEL, OURS)];
  tables.post = [
    {
      id: 'post_theirs',
      organizationId: THEIRS,
      integrationId: THEIR_CHANNEL,
      group: THEIR_GROUP,
      parentPostId: null,
      state: 'DRAFT',
      content: '{"type":"doc"}',
      image: '[]',
      settings: '{}',
      publishDate: STORED_AT,
      intervalInDays: null,
      madeWithAi: false,
      deletedAt: null,
      createdAt: STORED_AT,
      updatedAt: STORED_AT,
    },
  ];
}

const snapshot = () => JSON.stringify(tables);

function services() {
  const channelsRepository = new ChannelsRepository();
  const channels = new ChannelsService(
    channelsRepository,
    {} as unknown as ChannelOAuthService,
    { get: () => undefined } as unknown as ConfigService,
    {} as unknown as SchedulingService,
    {} as unknown as EntitlementsService,
  );
  // Any scheduling call is recorded; none may happen for a refused write.
  const scheduled: string[] = [];
  const scheduling = new Proxy(
    {},
    { get: (_target, method) => jest.fn(async () => scheduled.push(String(method))) },
  );
  const posts = new PostsService(
    new PostsRepository(),
    channels,
    { findViews: jest.fn(async () => new Map()) } as unknown as MediaService,
    scheduling as unknown as SchedulingService,
    { findLive: jest.fn(async () => new Set()) } as unknown as TagsService,
  );
  return { posts, channels, scheduled };
}

const doc = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }],
};

function createBody(channelId: string) {
  return createPostSchema.parse({
    state: 'DRAFT',
    publishDate: '2026-12-01T09:00:00.000Z',
    madeWithAi: true,
    shared: [{ content: doc, media: [] }],
    channels: [{ channelId, customized: false }],
  });
}

beforeEach(seed);

describe('madeWithAi on another workspace', () => {
  it('is refused on a post to their channel, before anything is written', async () => {
    const { posts, scheduled } = services();
    const before = snapshot();
    const error = await posts.create(OURS, createBody(THEIR_CHANNEL)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toBe(POST_MESSAGES.CHANNEL_UNAVAILABLE);
    expect(writes).toEqual([]);
    expect(snapshot()).toBe(before);
    expect(scheduled).toEqual([]);
  });

  it('is written on our own channel, so the refusal above is the workspace', async () => {
    const { posts } = services();
    await posts.create(OURS, createBody(OUR_CHANNEL));
    const made = tables.post.filter((row) => row.organizationId === OURS);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ madeWithAi: true, integrationId: OUR_CHANNEL });
  });

  it('is refused on their post: 404, their rows untouched, their flag still off', async () => {
    const { posts, scheduled } = services();
    const before = snapshot();
    const body = updatePostSchema.parse({
      ...createBody(OUR_CHANNEL),
      expectedUpdatedAt: STORED_AT.toISOString(),
    });
    const error = await posts.update(OURS, THEIR_GROUP, body).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect(writes).toEqual([]);
    expect(snapshot()).toBe(before);
    expect(tables.post[0]?.madeWithAi).toBe(false);
    expect(scheduled).toEqual([]);
  });

  it('is refused on their post even when the save names their own channel', async () => {
    const { posts } = services();
    const before = snapshot();
    const body = updatePostSchema.parse({
      ...createBody(THEIR_CHANNEL),
      expectedUpdatedAt: STORED_AT.toISOString(),
    });
    const error = await posts.update(OURS, THEIR_GROUP, body).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).message).toBe(POST_MESSAGES.CHANNEL_UNAVAILABLE);
    expect(snapshot()).toBe(before);
  });

  it('cannot reach their channel through the repository either: the insert connects it in our workspace', async () => {
    const before = snapshot();
    const error = await new PostsRepository()
      .createGroup({
        orgId: OURS,
        group: '0c1d2e3f-4a5b-4c6d-8e7f-901a2b3c4d5e',
        state: 'DRAFT',
        publishDate: new Date('2026-12-01T09:00:00.000Z'),
        intervalInDays: null,
        madeWithAi: true,
        tagIds: [],
        channels: [
          {
            integrationId: THEIR_CHANNEL,
            customized: false,
            settings: {},
            parts: [{ content: '{}', image: '[]' }],
          },
        ],
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(snapshot()).toBe(before);
  });

  it('cannot be named with a workspace or a row in the body', () => {
    for (const extra of [{ organizationId: THEIRS }, { orgId: THEIRS }, { group: THEIR_GROUP }]) {
      expect(createPostSchema.safeParse({ ...createBody(OUR_CHANNEL), ...extra }).success).toBe(
        false,
      );
    }
  });
});

describe('the posting window on another workspace', () => {
  const slots = updateChannelSchema.parse({
    postingTimes: [{ time: 600, windowMinutes: 30, days: [2, 4] }],
  });

  it('is refused on their channel: 404 and their slots untouched', async () => {
    const { channels } = services();
    const before = snapshot();
    const error = await channels
      .updateSettings({ orgId: OURS, id: THEIR_CHANNEL, postingTimes: slots.postingTimes })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundException);
    expect(writes).toEqual([]);
    expect(snapshot()).toBe(before);
    expect(tables.integration.find((row) => row.id === THEIR_CHANNEL)?.postingTimes).toBe(
      THEIR_SLOTS,
    );
  });

  it('is written on our own channel, so the refusal above is the workspace', async () => {
    const { channels } = services();
    const updated = await channels.updateSettings({
      orgId: OURS,
      id: OUR_CHANNEL,
      postingTimes: slots.postingTimes,
    });
    expect(updated.postingTimes).toEqual([{ time: 600, windowMinutes: 30, days: [2, 4] }]);
    expect(writes).toEqual([`integration.updateMany:${OUR_CHANNEL}`]);
  });

  it('cannot be named with a workspace or another channel in the body', () => {
    for (const extra of [
      { organizationId: THEIRS },
      { id: THEIR_CHANNEL },
      { integrationId: THEIR_CHANNEL },
    ]) {
      expect(updateChannelSchema.safeParse({ ...slots, ...extra }).success).toBe(false);
    }
    expect(
      updateChannelSchema.safeParse({
        postingTimes: [{ time: 600, windowMinutes: 30, days: [2], organizationId: THEIRS }],
      }).success,
    ).toBe(false);
  });
});
