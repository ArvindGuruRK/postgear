/**
 * The posts gateway (Module 10) end to end inside the API: the real binding
 * and effect ledger on an in-memory table, the real `PostsService` (so the
 * composer's checks and the platform rules are the real ones) on an
 * in-memory post store, and fakes for channels, media, tags and the
 * scheduler.
 */
import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { State } from '@postgear/db';
import { parseDocument, renderPlainText } from '@postgear/social-core';
import { EFFECT_STALE_MS } from './gateway-binding.service';
import { FakeGatewayDb, graphWith, ORG, OTHER_ORG, RUN } from './testing/fake-gateway-db';

const db = new FakeGatewayDb();

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  get prisma() {
    return db.prisma;
  },
}));

import type { ChannelsService, ChannelView } from '../../channels/channels.service';
import type { MediaService, MediaView } from '../../media/media.service';
import { POST_MESSAGES } from '../../posts/posts.messages';
import type { GroupWrite, PostRow, PostsRepository } from '../../posts/posts.repository';
import { PostsService } from '../../posts/posts.service';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import type { TagsService } from '../../tags/tags.service';
import { GatewayBindingService } from './gateway-binding.service';
import {
  automationGroupId,
  GatewayPostsService,
  POST_GATEWAY_MESSAGES,
  splitParts,
  uuidV5,
} from './gateway-posts.service';

const WEB_URL = 'https://postgear.rkay.in';
const IMAGE_ID = '6f1c2f7e-5d2b-4d0c-9a4e-3b8f0e2a1c11';
const FOREIGN_IMAGE_ID = '7a2d3e4f-5b6c-4d7e-8f90-a1b2c3d4e5f6';
const TAG_ID = '9e8d7c6b-5a49-4382-9716-0f1e2d3c4b5a';

function channel(overrides: Partial<ChannelView>): ChannelView {
  return {
    id: 'ch_x',
    internalId: 'acct',
    rootInternalId: 'acct',
    providerIdentifier: 'x',
    name: 'Acme on X',
    profile: 'acme',
    picture: null,
    disabled: false,
    refreshNeeded: false,
    inBetweenSteps: false,
    tokenExpiration: null,
    postingTimes: [{ time: 9 * 60 }],
    additionalSettings: {},
    createdAt: new Date(),
    health: 'connected',
    providerName: 'X',
    color: 0,
    ...overrides,
  };
}

const CHANNELS: ChannelView[] = [
  channel({}),
  channel({
    id: 'ch_li',
    providerIdentifier: 'linkedin',
    name: 'Acme Marketing',
    providerName: 'LinkedIn',
    postingTimes: [{ time: 10 * 60 }],
  }),
  channel({
    id: 'ch_lp',
    providerIdentifier: 'linkedin-page',
    name: 'Acme Page',
    providerName: 'LinkedIn Page',
  }),
  channel({ id: 'ch_ig', providerIdentifier: 'instagram', name: 'Bloom Bakery' }),
];

const IMAGE: MediaView = {
  id: IMAGE_ID,
  name: 'photo.jpg',
  type: 'image',
  mimeType: 'image/jpeg',
  fileSize: 200_000,
  width: 1080,
  height: 1080,
  url: 'http://localhost:3001/uploads/a.jpg',
  thumbnailUrl: null,
  createdAt: new Date(),
};

/** Posts as rows, with the few behaviours the service needs from the real repository. */
class MemoryPosts {
  rows: (PostRow & { organizationId: string; creationMethod: string })[] = [];
  writes: GroupWrite[] = [];
  private next = 0;

  createGroup = jest.fn(async (write: GroupWrite) => {
    this.writes.push(write);
    for (const entry of write.channels) {
      const view = CHANNELS.find((candidate) => candidate.id === entry.integrationId);
      if (!view) throw new Error('unknown channel');
      let parent: string | null = null;
      for (const part of entry.parts) {
        this.next += 1;
        const id = `post${String(this.next).padStart(4, '0')}`;
        this.rows.push({
          id,
          organizationId: write.orgId,
          creationMethod: write.creationMethod ?? 'WEB',
          group: write.group,
          integrationId: view.id,
          parentPostId: parent,
          state: write.state as State,
          publishDate: write.publishDate,
          content: part.content,
          image: part.image,
          settings: JSON.stringify({ customized: entry.customized, ...entry.settings }),
          releaseId: null,
          releaseURL: null,
          error: null,
          intervalInDays: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          tags:
            parent === null
              ? write.tagIds.map((tagId) => ({ tag: { id: tagId, name: 'launch', color: 'teal' } }))
              : [],
          integration: {
            id: view.id,
            name: view.name,
            providerIdentifier: view.providerIdentifier,
            picture: null,
            profile: null,
            deletedAt: null,
          },
        });
        parent = id;
      }
    }
  });

  findGroup = jest.fn(async (orgId: string, group: string) =>
    this.rows.filter((row) => row.organizationId === orgId && row.group === group),
  );

  findRoots = jest.fn(async (orgId: string, group: string) =>
    this.rows
      .filter((row) => row.organizationId === orgId && row.group === group && !row.parentPostId)
      .map((row) => ({ id: row.id, integrationId: row.integrationId, state: row.state })),
  );

  publishNow = jest.fn(async ({ orgId, group }: { orgId: string; group: string }) => {
    const rows = this.rows.filter((row) => row.organizationId === orgId && row.group === group);
    if (rows.length === 0) return { outcome: 'not_found' as const };
    for (const row of rows) row.publishDate = new Date();
    return {
      outcome: 'saved' as const,
      roots: rows
        .filter((row) => !row.parentPostId)
        .map((row) => ({ id: row.id, integrationId: row.integrationId, state: State.QUEUE })),
    };
  });

  findPostRef = jest.fn(async (orgId: string, value: string) => {
    const row = this.rows.find(
      (candidate) =>
        candidate.organizationId === orgId && (candidate.id === value || candidate.group === value),
    );
    if (!row) return null;
    const root = this.rows.find(
      (candidate) => candidate.group === row.group && !candidate.parentPostId,
    );
    return { group: row.group, rootId: root?.id ?? row.id };
  });

  listQueuedTimes = jest.fn(
    async (params: { orgId: string; integrationIds: string[]; from: Date }) =>
      this.rows
        .filter(
          (row) =>
            row.organizationId === params.orgId &&
            params.integrationIds.includes(row.integrationId) &&
            !row.parentPostId &&
            row.state === State.QUEUE &&
            row.publishDate >= params.from,
        )
        .map((row) => row.publishDate),
  );

  /** A post already in the queue (someone else's), to take a slot. */
  seedQueued(integrationId: string, publishDate: Date): void {
    const view = CHANNELS.find((candidate) => candidate.id === integrationId) as ChannelView;
    this.rows.push({
      ...this.rows[0],
      id: `seed_${publishDate.getTime()}`,
      organizationId: ORG,
      creationMethod: 'WEB',
      group: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      integrationId,
      parentPostId: null,
      state: State.QUEUE,
      publishDate,
      content: '{"type":"doc","content":[{"type":"paragraph"}]}',
      image: '[]',
      settings: null,
      releaseId: null,
      releaseURL: null,
      error: null,
      intervalInDays: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      tags: [],
      integration: {
        id: view.id,
        name: view.name,
        providerIdentifier: view.providerIdentifier,
        picture: null,
        profile: null,
        deletedAt: null,
      },
    });
  }
}

describe('GatewayPostsService', () => {
  let posts: MemoryPosts;
  let scheduling: { schedulePublish: jest.Mock; cancelPublish: jest.Mock; publishNow: jest.Mock };
  let media: { findViews: jest.Mock };
  let service: GatewayPostsService;

  const bind = (nodeKey: string) => ({ runId: RUN, nodeKey, organizationId: ORG });
  const content = { channels: ['ch_x'], text: 'Fresh sourdough is out.', mediaIds: [] as string[] };

  beforeEach(() => {
    db.runs = [];
    db.effects = [];
    db.now = () => new Date();
    db.addRun({
      graph: graphWith({
        draft01: 'postgear.createDraft',
        queue01: 'postgear.addToQueue',
        pub01: 'postgear.publish',
        get01: 'postgear.getPost',
      }),
    });
    posts = new MemoryPosts();
    scheduling = {
      schedulePublish: jest.fn().mockResolvedValue(true),
      cancelPublish: jest.fn().mockResolvedValue(true),
      publishNow: jest.fn().mockResolvedValue(true),
    };
    media = {
      findViews: jest.fn(
        async (_orgId: string, ids: string[]) =>
          new Map(ids.filter((id) => id === IMAGE_ID).map((id) => [id, IMAGE])),
      ),
    };
    const channels = {
      list: jest.fn().mockResolvedValue(CHANNELS),
      colors: jest.fn().mockResolvedValue(new Map()),
    };
    const tags = {
      findLive: jest.fn(
        async (_orgId: string, ids: string[]) =>
          new Map(
            ids
              .filter((id) => id === TAG_ID)
              .map((id) => [id, { id, name: 'launch', color: 'teal' }]),
          ),
      ),
    };
    const postsService = new PostsService(
      posts as unknown as PostsRepository,
      channels as unknown as ChannelsService,
      media as unknown as MediaService,
      scheduling as unknown as SchedulingService,
      tags as unknown as TagsService,
    );
    const config = { get: () => WEB_URL } as unknown as ConfigService<never, true>;
    service = new GatewayPostsService(
      new GatewayBindingService(),
      postsService,
      channels as unknown as ChannelsService,
      config as never,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('the deterministic group', () => {
    it('is a UUID v5 of the run and step, the same every time', () => {
      // RFC 9562's own example: "www.example.com" in the DNS namespace.
      expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
        '2ed6657d-e927-568b-95e1-2665a8aea6a2',
      );
      const group = automationGroupId(RUN, 'draft01');
      expect(group).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(automationGroupId(RUN, 'draft01')).toBe(group);
      expect(automationGroupId(RUN, 'draft02')).not.toBe(group);
    });

    it('splits a thread on blank lines, and keeps one part otherwise', () => {
      expect(splitParts('One\n\nTwo\n  \nThree', 'splitOnBlankLines')).toEqual([
        'One',
        'Two',
        'Three',
      ]);
      expect(splitParts('One\nstill one\r\n\r\nTwo', 'splitOnBlankLines')).toEqual([
        'One\nstill one',
        'Two',
      ]);
      expect(splitParts('  \n\n ', 'splitOnBlankLines')).toEqual(['']);
      expect(splitParts('One\n\nTwo')).toEqual(['One\n\nTwo']);
    });
  });

  describe('Create Draft', () => {
    it('makes a thread from blank lines, as a workflow’s draft under the step’s group', async () => {
      const before = Date.now();
      const { output, credits } = await service.draft({
        ...bind('draft01'),
        ...content,
        channels: ['ch_x', 'ch_li'],
        text: 'Part one.\n\nPart two.\n\nPart three.',
        parts: 'splitOnBlankLines',
        tags: [TAG_ID],
      });

      const group = automationGroupId(RUN, 'draft01');
      expect(credits).toBe(0);
      expect(output).toEqual({
        postGroup: group,
        link: `${WEB_URL}/${ORG}/composer?group=${group}`,
        channels: [
          { id: 'ch_x', name: 'Acme on X', provider: 'x' },
          { id: 'ch_li', name: 'Acme Marketing', provider: 'linkedin' },
        ],
        text: 'Part one.\n\nPart two.\n\nPart three.',
        mediaCount: 0,
      });
      const [write] = posts.writes;
      expect(write).toMatchObject({ state: 'DRAFT', creationMethod: 'AUTOMATION', group });
      expect(
        write.channels[0].parts.map((part) => renderPlainText(parseDocument(part.content))),
      ).toEqual(['Part one.', 'Part two.', 'Part three.']);
      // The copilot's time: the next full hour.
      expect(write.publishDate.getUTCMinutes()).toBe(0);
      expect(write.publishDate.getTime()).toBeGreaterThan(before);
      expect(write.tagIds).toEqual([TAG_ID]);
      expect(posts.rows.every((row) => row.creationMethod === 'AUTOMATION')).toBe(true);
    });

    it('attaches media from an earlier step to the first part only, by id', async () => {
      const { output } = await service.draft({
        ...bind('draft01'),
        ...content,
        text: 'One\n\nTwo',
        parts: 'splitOnBlankLines',
        mediaIds: [IMAGE_ID],
      });
      expect(output.mediaCount).toBe(1);
      const parts = posts.writes[0].channels[0].parts;
      expect(parts.map((part) => part.image)).toEqual([JSON.stringify([{ id: IMAGE_ID }]), '[]']);
    });

    it('refuses media that is not in this workspace’s library, in the posts words', async () => {
      const refused = await service
        .draft({ ...bind('draft01'), ...content, mediaIds: [FOREIGN_IMAGE_ID] })
        .catch((error) => error);
      expect(refused).toBeInstanceOf(BadRequestException);
      expect(refused.message).toBe(POST_MESSAGES.MEDIA_UNAVAILABLE);
      expect(posts.createGroup).not.toHaveBeenCalled();
      expect(db.effect(`${RUN}:draft01`)?.status).toBe('FAILED');
    });

    it('answers a replay with the first answer and writes one post', async () => {
      const first = await service.draft({ ...bind('draft01'), ...content });
      const second = await service.draft({ ...bind('draft01'), ...content, text: 'Changed' });

      expect(second).toEqual(first);
      expect(posts.createGroup).toHaveBeenCalledTimes(1);
    });

    it('re-runs a crashed attempt (stale PENDING) and finds the post it already wrote', async () => {
      const first = await service.draft({ ...bind('draft01'), ...content });
      // As if the API died after writing the post but before recording DONE.
      const effect = db.effect(`${RUN}:draft01`);
      if (!effect) throw new Error('no effect');
      const old = new Date(Date.now() - EFFECT_STALE_MS - 1_000);
      Object.assign(effect, { status: 'PENDING', result: null, updatedAt: old });

      const again = await service.draft({ ...bind('draft01'), ...content });

      expect(again.output.postGroup).toBe(first.output.postGroup);
      expect(posts.createGroup).toHaveBeenCalledTimes(1);
      expect(new Set(posts.rows.map((row) => row.group)).size).toBe(1);
      expect(db.effect(`${RUN}:draft01`)?.status).toBe('DONE');
    });

    it('refuses a call for a step of another type, or another workspace', async () => {
      await expect(service.draft({ ...bind('queue01'), ...content })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.draft({ ...bind('draft01'), organizationId: OTHER_ORG, ...content }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(posts.createGroup).not.toHaveBeenCalled();
    });
  });

  describe('Add To Queue', () => {
    const NOW = Date.parse('2026-11-03T07:00:00.000Z');
    const queue = { ...content, when: 'nextSlot' as const, timeZone: 'UTC' };

    beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(NOW));

    it('queues at the first posting time free on every chosen channel', async () => {
      // X's 09:00 is taken, so LinkedIn's 10:00 is the first time free on both.
      posts.seedQueued('ch_x', new Date('2026-11-03T09:00:00.000Z'));

      const { output } = await service.queue({
        ...bind('queue01'),
        ...queue,
        channels: ['ch_x', 'ch_li'],
      });

      expect(output.scheduledFor).toBe('2026-11-03T10:00:00.000Z');
      expect(posts.writes[0]).toMatchObject({ state: 'QUEUE', creationMethod: 'AUTOMATION' });
      expect(scheduling.schedulePublish).toHaveBeenCalledTimes(1);
      expect(posts.listQueuedTimes.mock.calls[0][0].integrationIds).toEqual(['ch_x', 'ch_li']);
    });

    it('reads posting times in the step’s time zone', async () => {
      const { output } = await service.queue({
        ...bind('queue01'),
        ...queue,
        timeZone: 'Asia/Kolkata',
      });
      // 09:00 in Kolkata is 03:30 UTC, already past, so tomorrow's.
      expect(output.scheduledFor).toBe('2026-11-04T03:30:00.000Z');
    });

    it('queues at a chosen time', async () => {
      const { output } = await service.queue({
        ...bind('queue01'),
        ...queue,
        when: 'at',
        at: '2026-11-05T12:30:00.000Z',
      });
      expect(output.scheduledFor).toBe('2026-11-05T12:30:00.000Z');
    });

    it('fails for good on a platform rule, with the API’s own sentence', async () => {
      const refused = await service
        .queue({ ...bind('queue01'), ...queue, text: 'a'.repeat(400) })
        .catch((error) => error);
      expect(refused).toBeInstanceOf(UnprocessableEntityException);
      expect(refused.getStatus()).toBe(422);
      expect(refused.message).toMatch(/^Acme on X: /);
      expect(posts.createGroup).not.toHaveBeenCalled();
    });

    it('refuses a chosen time in the past and an unknown time zone', async () => {
      await expect(
        service.queue({ ...bind('queue01'), ...queue, when: 'at', at: '2026-11-01T09:00:00Z' }),
      ).rejects.toThrow(POST_MESSAGES.PUBLISH_DATE_PAST);
      db.effects = [];
      await expect(
        service.queue({ ...bind('queue01'), ...queue, timeZone: 'Mars/Olympus' }),
      ).rejects.toThrow(POST_GATEWAY_MESSAGES.BAD_TIME_ZONE);
    });
  });

  describe('Publish To', () => {
    const publish = { ...content, provider: 'linkedin' as const, channels: ['ch_li', 'ch_lp'] };

    it('queues now and hands every channel to the publisher once', async () => {
      const { output } = await service.publish({ ...bind('pub01'), ...publish });

      expect(output).toEqual({
        postGroup: automationGroupId(RUN, 'pub01'),
        channels: [
          { id: 'ch_li', name: 'Acme Marketing', provider: 'linkedin' },
          { id: 'ch_lp', name: 'Acme Page', provider: 'linkedin-page' },
        ],
        status: 'publishing',
      });
      expect(posts.writes[0]).toMatchObject({ state: 'QUEUE', creationMethod: 'AUTOMATION' });
      expect(scheduling.publishNow).toHaveBeenCalledTimes(1);
      expect(scheduling.publishNow.mock.calls[0][0]).toHaveLength(2);
    });

    it('never publishes twice when the step is replayed', async () => {
      await service.publish({ ...bind('pub01'), ...publish });
      await service.publish({ ...bind('pub01'), ...publish });

      expect(posts.createGroup).toHaveBeenCalledTimes(1);
      expect(scheduling.publishNow).toHaveBeenCalledTimes(1);
    });

    it('refuses a channel of another platform', async () => {
      await expect(
        service.publish({ ...bind('pub01'), ...publish, channels: ['ch_li', 'ch_x'] }),
      ).rejects.toThrow(POST_GATEWAY_MESSAGES.wrongPlatform('Acme on X', 'LinkedIn'));
      expect(posts.createGroup).not.toHaveBeenCalled();
    });

    it('passes the platform settings to each channel', async () => {
      await service.publish({
        ...bind('pub01'),
        ...content,
        provider: 'x',
        settings: { notAnXSetting: true },
      });
      // Unknown keys are dropped by the posts service, as for the composer.
      expect(posts.writes[0].channels[0].settings).toEqual({});
    });
  });

  describe('Get Post', () => {
    it('summarises a post by its group or a row id', async () => {
      await service.draft({
        ...bind('draft01'),
        ...content,
        text: 'One\n\nTwo',
        parts: 'splitOnBlankLines',
        mediaIds: [IMAGE_ID],
        tags: [TAG_ID],
      });
      const group = automationGroupId(RUN, 'draft01');

      const { output } = await service.get({ ...bind('get01'), post: group });
      expect(output).toEqual({
        id: posts.rows[0].id,
        group,
        state: State.DRAFT,
        text: 'One\n\nTwo',
        mediaCount: 1,
        media: [{ kind: 'media', id: IMAGE_ID, url: IMAGE.url, type: 'image' }],
        channels: [{ id: 'ch_x', name: 'Acme on X', provider: 'x' }],
        tags: ['launch'],
        publishDate: posts.rows[0].publishDate.toISOString(),
        releaseUrl: null,
      });
      const byRow = await service.get({ ...bind('get01'), post: posts.rows[1].id });
      expect(byRow.output.group).toBe(group);
      // Reading writes no effect.
      expect(db.effect(`${RUN}:get01`)).toBeUndefined();
    });

    it('says a missing post, or another workspace’s, no longer exists', async () => {
      for (const post of ['0b8f3f3e-8a1f-4c55-9a55-2f1f5d1c9e11', '{{ nothing }}', '']) {
        const refused = await service.get({ ...bind('get01'), post }).catch((error) => error);
        expect(refused).toBeInstanceOf(UnprocessableEntityException);
        expect(refused.message).toBe(POST_GATEWAY_MESSAGES.POST_GONE);
      }
    });
  });
});
