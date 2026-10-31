/**
 * The save rules: what a draft tolerates, what the queue demands, and what no
 * save may reference.
 *
 * The repository, channels and media are fakes; the platform rules are the
 * real ones from `@postgear/social-core`, so a queue refusal here is the same
 * refusal the composer shows and the provider would make.
 */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { State } from '@postgear/db';
import { documentFromText } from '@postgear/social-core';
import type { ChannelsService, ChannelView } from '../channels/channels.service';
import type { MediaService, MediaView } from '../media/media.service';
import type { SchedulingService } from '../scheduling/scheduling.service';
import type { TagsService } from '../tags/tags.service';
import type { CreatePostInput } from './dto/posts.schema';
import type { PostRow, PostsRepository } from './posts.repository';
import {
  PostsService,
  parseCustomized,
  parseImageIds,
  parseProviderSettings,
} from './posts.service';

const GROUP = '0b8f3f3e-8a1f-4c55-9a55-2f1f5d1c9e11';
const IMAGE_ID = '6f1c2f7e-5d2b-4d0c-9a4e-3b8f0e2a1c11';
const future = () => new Date(Date.now() + 60 * 60 * 1_000).toISOString();

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
    postingTimes: [],
    additionalSettings: {},
    createdAt: new Date(),
    health: 'connected',
    providerName: 'X',
    color: 0,
    ...overrides,
  };
}

function image(overrides: Partial<MediaView> = {}): MediaView {
  return {
    id: IMAGE_ID,
    name: 'photo.jpg',
    type: 'image',
    mimeType: 'image/jpeg',
    fileSize: 200_000,
    width: 1080,
    height: 1080,
    url: 'http://localhost:3001/uploads/2026/09/a.jpg',
    thumbnailUrl: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function input(overrides: Partial<CreatePostInput> = {}): CreatePostInput {
  return {
    state: 'DRAFT',
    publishDate: future(),
    shared: [{ content: documentFromText('Hello'), media: [] }],
    channels: [{ channelId: 'ch_x', customized: false }],
    ...overrides,
  };
}

describe('PostsService', () => {
  let repository: jest.Mocked<
    Pick<
      PostsRepository,
      | 'createGroup'
      | 'replaceGroup'
      | 'findGroup'
      | 'deleteGroup'
      | 'listRecentGroups'
      | 'findRoots'
      | 'listCalendar'
      | 'listQueue'
      | 'countQueueStates'
      | 'reschedule'
      | 'publishNow'
      | 'findPostRef'
      | 'listQueuedTimes'
    >
  >;
  let channels: { list: jest.Mock; colors: jest.Mock };
  let media: { findViews: jest.Mock };
  let scheduling: { schedulePublish: jest.Mock; cancelPublish: jest.Mock; publishNow: jest.Mock };
  let tags: { findLive: jest.Mock };
  let service: PostsService;

  beforeEach(() => {
    repository = {
      createGroup: jest.fn().mockResolvedValue(undefined),
      replaceGroup: jest.fn().mockResolvedValue('saved'),
      findGroup: jest.fn(),
      deleteGroup: jest.fn(),
      listRecentGroups: jest.fn(),
      findRoots: jest.fn().mockResolvedValue([]),
      listCalendar: jest.fn().mockResolvedValue([]),
      listQueue: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
      countQueueStates: jest
        .fn()
        .mockResolvedValue({ all: 0, QUEUE: 0, PUBLISHED: 0, ERROR: 0, DRAFT: 0 }),
      reschedule: jest.fn(),
      publishNow: jest.fn(),
      findPostRef: jest.fn(),
      listQueuedTimes: jest.fn().mockResolvedValue([]),
    };
    scheduling = {
      schedulePublish: jest.fn().mockResolvedValue(true),
      cancelPublish: jest.fn().mockResolvedValue(true),
      publishNow: jest.fn().mockResolvedValue(true),
    };
    channels = {
      list: jest.fn().mockResolvedValue([
        channel({}),
        channel({
          id: 'ch_li',
          providerIdentifier: 'linkedin',
          name: 'Acme Marketing',
          providerName: 'LinkedIn',
        }),
        channel({
          id: 'ch_ig',
          providerIdentifier: 'instagram',
          name: 'Acme Studio',
          providerName: 'Instagram',
        }),
        channel({
          id: 'ch_yt',
          providerIdentifier: 'youtube',
          name: 'Acme',
          providerName: 'YouTube',
        }),
      ]),
      colors: jest.fn().mockResolvedValue(
        new Map([
          ['ch_li', 0],
          ['ch_x', 1],
          ['ch_ig', 2],
        ]),
      ),
    };
    media = { findViews: jest.fn().mockResolvedValue(new Map([[IMAGE_ID, image()]])) };
    tags = {
      findLive: jest.fn(
        async (_orgId: string, ids: string[]) =>
          new Map(
            ids
              .filter((id) => id.startsWith('tag_'))
              .map((id) => [id, { id, name: id, color: 'teal' }]),
          ),
      ),
    };

    service = new PostsService(
      repository as unknown as PostsRepository,
      channels as unknown as ChannelsService,
      media as unknown as MediaService,
      scheduling as unknown as SchedulingService,
      tags as unknown as TagsService,
    );

    // `create` re-reads the group it wrote.
    repository.findGroup.mockImplementation(async (_orgId, group) => [row({ group })]);
  });

  function row(overrides: Partial<PostRow> = {}): PostRow {
    return {
      id: 'p1',
      group: GROUP,
      integrationId: 'ch_x',
      parentPostId: null,
      state: State.DRAFT,
      publishDate: new Date('2026-10-01T09:00:00Z'),
      content: JSON.stringify(documentFromText('Hello')),
      image: '[]',
      settings: '{"customized":false}',
      releaseId: null,
      releaseURL: null,
      error: null,
      intervalInDays: null,
      createdAt: new Date('2026-09-14T10:00:00Z'),
      updatedAt: new Date('2026-09-14T10:00:00Z'),
      tags: [],
      integration: {
        id: 'ch_x',
        name: 'Acme on X',
        providerIdentifier: 'x',
        picture: null,
        profile: 'acme',
        deletedAt: null,
      },
      ...overrides,
    };
  }

  describe('saving a draft', () => {
    it('mints one group id for the whole post and stores media as references only', async () => {
      await service.create(
        'org_1',
        input({
          shared: [{ content: documentFromText('Hi'), media: [{ id: IMAGE_ID }] }],
          channels: [
            { channelId: 'ch_x', customized: false },
            { channelId: 'ch_li', customized: false },
          ],
        }),
      );

      const write = repository.createGroup.mock.calls[0][0];
      expect(write.group).toMatch(/^[0-9a-f-]{36}$/);
      expect(write.channels.map((entry) => entry.integrationId)).toEqual(['ch_x', 'ch_li']);
      expect(write.channels[0].parts[0].image).toBe(JSON.stringify([{ id: IMAGE_ID }]));
      // No URL is persisted: only the id, resolved again whenever it is read.
      expect(write.channels[0].parts[0].image).not.toContain('http');
    });

    it('tolerates what unfinished work looks like', async () => {
      const tooLongForX = documentFromText('a'.repeat(400));

      await expect(
        service.create(
          'org_1',
          input({
            publishDate: '2020-01-01T00:00:00.000Z',
            shared: [{ content: tooLongForX, media: [] }],
            channels: [{ channelId: 'ch_ig', customized: false }],
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('uses a customized channel’s own parts and everyone else’s shared ones', async () => {
      await service.create(
        'org_1',
        input({
          shared: [{ content: documentFromText('shared'), media: [] }],
          channels: [
            {
              channelId: 'ch_x',
              customized: true,
              parts: [{ content: documentFromText('just for X'), media: [] }],
            },
            { channelId: 'ch_li', customized: false },
          ],
        }),
      );

      const [x, linkedin] = repository.createGroup.mock.calls[0][0].channels;
      expect(x).toMatchObject({ customized: true });
      expect(x.parts[0].content).toContain('just for X');
      expect(linkedin.parts[0].content).toContain('shared');
    });

    it('refuses a channel from another workspace', async () => {
      await expect(
        service.create(
          'org_1',
          input({ channels: [{ channelId: 'ch_other_org', customized: false }] }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.createGroup).not.toHaveBeenCalled();
    });

    it('refuses media that is not in this workspace’s library', async () => {
      media.findViews.mockResolvedValueOnce(new Map());

      await expect(
        service.create(
          'org_1',
          input({ shared: [{ content: documentFromText('x'), media: [{ id: IMAGE_ID }] }] }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.createGroup).not.toHaveBeenCalled();
    });
  });

  describe('adding to the queue', () => {
    const queue = (overrides: Partial<CreatePostInput> = {}) =>
      input({ state: 'QUEUE', ...overrides });

    it('accepts a valid post', async () => {
      await expect(service.create('org_1', queue())).resolves.toBeDefined();
      expect(repository.createGroup.mock.calls[0][0].state).toBe('QUEUE');
    });

    it('requires a time in the future', async () => {
      await expect(
        service.create('org_1', queue({ publishDate: new Date(Date.now() - 1_000).toISOString() })),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('holds each channel to its platform’s rules, naming the channel', async () => {
      const promise = service.create(
        'org_1',
        queue({
          shared: [{ content: documentFromText('a'.repeat(281)), media: [] }],
          channels: [
            { channelId: 'ch_li', customized: false },
            { channelId: 'ch_x', customized: false },
          ],
        }),
      );

      await expect(promise).rejects.toThrow(
        'Acme on X: Twitter / X allows 280 characters; this post has 281.',
      );
      expect(repository.createGroup).not.toHaveBeenCalled();
    });

    it('measures the rendered text, so Unicode bold counts double on X', async () => {
      const bold = {
        type: 'doc' as const,
        content: [
          {
            type: 'paragraph' as const,
            content: [
              { type: 'text' as const, text: 'a'.repeat(150), marks: [{ type: 'bold' as const }] },
            ],
          },
        ],
      };

      await expect(
        service.create('org_1', queue({ shared: [{ content: bold, media: [] }] })),
      ).rejects.toThrow(/has 300/);
    });

    it('checks attachments against what the library knows about them', async () => {
      media.findViews.mockResolvedValue(new Map([[IMAGE_ID, image({ mimeType: 'image/png' })]]));

      await expect(
        service.create(
          'org_1',
          queue({
            shared: [{ content: documentFromText('caption'), media: [{ id: IMAGE_ID }] }],
            channels: [{ channelId: 'ch_ig', customized: false }],
          }),
        ),
      ).rejects.toThrow('Acme Studio: Instagram only accepts JPEG images.');
    });

    it('refuses a channel that still needs setting up, but not one needing reconnection', async () => {
      channels.list.mockResolvedValue([
        channel({ id: 'ch_setup', inBetweenSteps: true, name: 'Half done' }),
        channel({ id: 'ch_expired', refreshNeeded: true, health: 'needs_reconnect' }),
      ]);

      await expect(
        service.create(
          'org_1',
          queue({ channels: [{ channelId: 'ch_setup', customized: false }] }),
        ),
      ).rejects.toThrow(/Finish setting up Half done/);
      await expect(
        service.create(
          'org_1',
          queue({ channels: [{ channelId: 'ch_expired', customized: false }] }),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('updating', () => {
    const expectedUpdatedAt = '2026-09-14T10:00:00.000Z';

    it('passes the loaded version through and maps each outcome to a response', async () => {
      await service.update('org_1', GROUP, { ...input(), expectedUpdatedAt });
      expect(repository.replaceGroup.mock.calls[0][0].expectedUpdatedAt).toEqual(
        new Date(expectedUpdatedAt),
      );

      repository.replaceGroup.mockResolvedValueOnce('conflict');
      await expect(
        service.update('org_1', GROUP, { ...input(), expectedUpdatedAt }),
      ).rejects.toBeInstanceOf(ConflictException);

      repository.replaceGroup.mockResolvedValueOnce('locked');
      await expect(
        service.update('org_1', GROUP, { ...input(), expectedUpdatedAt }),
      ).rejects.toThrow(/published/);

      repository.replaceGroup.mockResolvedValueOnce('not_found');
      await expect(
        service.update('org_1', GROUP, { ...input(), expectedUpdatedAt }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('treats a malformed group id as not found without querying', async () => {
      await expect(service.get('org_1', "g'; DROP TABLE")).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.findGroup).not.toHaveBeenCalled();
    });
  });

  describe('rescheduling and publishing now (Sprint 5)', () => {
    const root = (state: State) => ({ id: 'root_x', integrationId: 'ch_x', state });

    it('refuses to move a queued post into the past, and tells the person to use Post now', async () => {
      repository.findRoots.mockResolvedValue([root(State.QUEUE)]);

      await expect(
        service.reschedule('org_1', GROUP, new Date(Date.now() - 60_000)),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(repository.reschedule).not.toHaveBeenCalled();
    });

    it('lets a draft sit anywhere, and wakes the scheduler only for queued roots', async () => {
      repository.findRoots.mockResolvedValue([root(State.DRAFT)]);
      repository.reschedule.mockResolvedValue({ outcome: 'saved', roots: [root(State.DRAFT)] });

      await service.reschedule('org_1', GROUP, new Date('2020-01-01T09:00:00Z'));

      expect(repository.reschedule).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: 'org_1', group: GROUP }),
      );
      expect(scheduling.schedulePublish).toHaveBeenCalledWith([]);
      expect(scheduling.cancelPublish).toHaveBeenCalledWith(['root_x']);
    });

    it('re-queues a failed post at the new time and starts its workflow', async () => {
      repository.findRoots.mockResolvedValue([root(State.ERROR)]);
      repository.reschedule.mockResolvedValue({ outcome: 'saved', roots: [root(State.QUEUE)] });

      await service.reschedule('org_1', GROUP, new Date(future()));

      expect(scheduling.schedulePublish).toHaveBeenCalledWith([
        { postId: 'root_x', organizationId: 'org_1' },
      ]);
    });

    it('reports a fully published post as locked', async () => {
      repository.findRoots.mockResolvedValue([root(State.PUBLISHED)]);
      repository.reschedule.mockResolvedValue({ outcome: 'locked' });

      await expect(service.reschedule('org_1', GROUP, new Date(future()))).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('publishes now by re-queueing the pending channels and signalling each root', async () => {
      repository.publishNow.mockResolvedValue({
        outcome: 'saved',
        roots: [root(State.QUEUE), { id: 'root_li', integrationId: 'ch_li', state: State.QUEUE }],
      });

      await service.publishNow('org_1', GROUP);

      expect(scheduling.publishNow).toHaveBeenCalledWith([
        { postId: 'root_x', organizationId: 'org_1' },
        { postId: 'root_li', organizationId: 'org_1' },
      ]);
    });

    it('refuses to publish a draft now', async () => {
      repository.publishNow.mockResolvedValue({ outcome: 'not_queued' });

      await expect(service.publishNow('org_1', GROUP)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(scheduling.publishNow).not.toHaveBeenCalled();
    });

    it('cancels the workflows of channels a save drops, and of a deleted post', async () => {
      repository.findRoots
        .mockResolvedValueOnce([
          root(State.QUEUE),
          { id: 'root_li', integrationId: 'ch_li', state: State.QUEUE },
        ])
        .mockResolvedValueOnce([root(State.QUEUE)]);

      await service.update('org_1', GROUP, {
        ...input({ state: 'QUEUE' }),
        expectedUpdatedAt: new Date().toISOString(),
      });

      expect(scheduling.cancelPublish).toHaveBeenCalledWith(['root_li']);
      expect(scheduling.schedulePublish).toHaveBeenCalledWith([
        { postId: 'root_x', organizationId: 'org_1' },
      ]);

      repository.findRoots.mockResolvedValueOnce([root(State.QUEUE)]);
      repository.deleteGroup.mockResolvedValue('deleted');
      await service.remove('org_1', GROUP);
      expect(scheduling.cancelPublish).toHaveBeenLastCalledWith(['root_x']);
    });

    it('still saves when the scheduler cannot be reached', async () => {
      scheduling.schedulePublish.mockResolvedValue(false);
      repository.findRoots.mockResolvedValue([root(State.QUEUE)]);

      await expect(service.create('org_1', input({ state: 'QUEUE' }))).resolves.toMatchObject({
        group: expect.any(String),
      });
    });
  });

  describe('reopening', () => {
    it('rebuilds shared content from a channel that follows it, and each thread in order', async () => {
      repository.findGroup.mockResolvedValueOnce([
        row({
          id: 'x2',
          parentPostId: 'x1',
          content: JSON.stringify(documentFromText('custom 2')),
          settings: '{"customized":true}',
        }),
        row({
          id: 'x1',
          content: JSON.stringify(documentFromText('custom 1')),
          settings: '{"customized":true}',
        }),
        row({
          id: 'l1',
          integrationId: 'ch_li',
          content: JSON.stringify(documentFromText('shared 1')),
          integration: {
            id: 'ch_li',
            name: 'Acme Marketing',
            providerIdentifier: 'linkedin',
            picture: null,
            profile: null,
            deletedAt: null,
          },
        }),
      ]);

      const detail = await service.get('org_1', GROUP);

      expect(detail.shared.map((part) => part.content)).toEqual([documentFromText('shared 1')]);
      const x = detail.channels.find((entry) => entry.channelId === 'ch_x');
      expect(x?.customized).toBe(true);
      expect(x?.parts.map((part) => part.content)).toEqual([
        documentFromText('custom 1'),
        documentFromText('custom 2'),
      ]);
    });

    it('reports attachments deleted since saving, and channels disconnected since saving', async () => {
      media.findViews.mockResolvedValueOnce(new Map());
      repository.findGroup.mockResolvedValueOnce([
        row({
          image: JSON.stringify([{ id: IMAGE_ID }]),
          integration: {
            id: 'ch_x',
            name: 'Acme on X',
            providerIdentifier: 'x',
            picture: null,
            profile: null,
            deletedAt: new Date(),
          },
        }),
      ]);

      const detail = await service.get('org_1', GROUP);

      expect(detail.channels[0].disconnected).toBe(true);
      expect(detail.channels[0].parts[0]).toMatchObject({ media: [], removedMedia: 1 });
    });

    it('returns the newest row time as the version to save against', async () => {
      repository.findGroup.mockResolvedValueOnce([
        row({ id: 'a', updatedAt: new Date('2026-09-14T10:00:00Z') }),
        row({ id: 'b', parentPostId: 'a', updatedAt: new Date('2026-09-14T11:00:00Z') }),
      ]);

      expect((await service.get('org_1', GROUP)).updatedAt).toEqual(
        new Date('2026-09-14T11:00:00Z'),
      );
    });

    it('carries each channel’s avatar colour in details, the calendar and the queue', async () => {
      const rows = [
        row({ id: 'a', integrationId: 'ch_x' }),
        row({
          id: 'b',
          integrationId: 'ch_ig',
          integration: {
            id: 'ch_ig',
            name: 'Acme Studio',
            providerIdentifier: 'instagram',
            picture: null,
            profile: 'acme.studio',
            deletedAt: null,
          },
        }),
      ];
      repository.findGroup.mockResolvedValueOnce(rows);
      repository.listCalendar.mockResolvedValueOnce(rows);
      repository.listQueue.mockResolvedValueOnce({ rows, total: 1 });

      const colours = (channels: { channelId: string; color: number }[]) =>
        channels.map((channel) => [channel.channelId, channel.color]);
      const expected = [
        ['ch_x', 1],
        ['ch_ig', 2],
      ];

      expect(colours((await service.get('org_1', GROUP)).channels)).toEqual(expected);
      const [summary] = await service.calendar('org_1', {
        from: '2026-09-28T00:00:00.000Z',
        to: '2026-10-05T00:00:00.000Z',
      });
      expect(colours(summary.channels)).toEqual(expected);
      const page = await service.queue('org_1', { page: 1, sort: 'asc' });
      expect(colours(page.posts[0].channels)).toEqual(expected);
    });

    it('counts the state tabs under the same channel and dates as the list, but not its state', async () => {
      const counts = { all: 9, QUEUE: 3, PUBLISHED: 4, ERROR: 1, DRAFT: 2 };
      repository.countQueueStates.mockResolvedValueOnce(counts);

      const page = await service.queue('org_1', {
        page: 2,
        sort: 'desc',
        state: State.ERROR,
        channelId: 'ch_x',
        from: '2026-10-01T00:00:00.000Z',
      });

      expect(page.counts).toEqual(counts);
      expect(repository.countQueueStates).toHaveBeenCalledWith({
        orgId: 'org_1',
        channelId: 'ch_x',
        from: new Date('2026-10-01T00:00:00.000Z'),
        to: undefined,
      });
      expect(repository.listQueue.mock.calls[0][0]).toMatchObject({
        states: [State.ERROR],
        channelId: 'ch_x',
      });
    });
  });

  describe('settings, tags, repeat and post now (2026-10-19)', () => {
    const VIDEO_ID = '9e8d7c6b-5a49-4382-8170-6f5e4d3c2b1a';
    const video = () =>
      image({ id: VIDEO_ID, type: 'video', mimeType: 'video/mp4', width: null, height: null });

    it('keeps only the settings the channel’s provider reads, per channel', async () => {
      await service.create(
        'org_1',
        input({
          channels: [
            {
              channelId: 'ch_x',
              customized: false,
              settings: { replySettings: 'following', customized: true, premium: true },
            },
            { channelId: 'ch_li', customized: false, settings: { title: 'ignored' } },
          ],
        }),
      );

      const [x, linkedin] = repository.createGroup.mock.calls[0][0].channels;
      expect(x.settings).toEqual({ replySettings: 'following' });
      expect(linkedin.settings).toEqual({});
    });

    it('refuses a bad setting even in a draft, naming the platform, the channel and the field', async () => {
      const promise = service.create(
        'org_1',
        input({
          channels: [
            { channelId: 'ch_yt', customized: false, settings: { title: 'x'.repeat(101) } },
          ],
        }),
      );

      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toThrow(
        'YouTube (Acme): Title must be at most 100 characters.',
      );
      expect(repository.createGroup).not.toHaveBeenCalled();
    });

    it('holds an explicit YouTube title to YouTube’s title rules when queueing', async () => {
      media.findViews.mockResolvedValue(new Map([[VIDEO_ID, video()]]));

      await expect(
        service.create(
          'org_1',
          input({
            state: 'QUEUE',
            shared: [{ content: documentFromText('A fine first line'), media: [{ id: VIDEO_ID }] }],
            channels: [{ channelId: 'ch_yt', customized: false, settings: { title: 'a <b>' } }],
          }),
        ),
      ).rejects.toThrow('Acme: YouTube titles cannot contain < or > characters.');
    });

    it('stores this workspace’s live tags in the order sent, and refuses any other', async () => {
      await service.create('org_1', input({ tags: ['tag_b', 'tag_a'] }));
      expect(repository.createGroup.mock.calls[0][0].tagIds).toEqual(['tag_b', 'tag_a']);
      expect(tags.findLive).toHaveBeenCalledWith('org_1', ['tag_b', 'tag_a']);

      await expect(
        service.create('org_1', input({ tags: ['tag_a', 'someone_elses'] })),
      ).rejects.toThrow('One of the selected tags was deleted.');
      expect(repository.createGroup).toHaveBeenCalledTimes(1);
    });

    it('stores the repeat, and no repeat when none is sent', async () => {
      await service.create('org_1', input({ intervalInDays: 7 }));
      await service.create('org_1', input());

      expect(repository.createGroup.mock.calls.map(([write]) => write.intervalInDays)).toEqual([
        7,
        null,
      ]);
      expect(repository.createGroup.mock.calls[1][0].tagIds).toEqual([]);
    });

    it('posts now on save: today’s time, no future check, and the publish-now path', async () => {
      repository.publishNow.mockResolvedValue({
        outcome: 'saved',
        roots: [{ id: 'root_x', integrationId: 'ch_x', state: State.QUEUE }],
      });
      const before = Date.now();

      await service.create(
        'org_1',
        input({ state: 'QUEUE', publishNow: true, publishDate: '2020-01-01T00:00:00.000Z' }),
      );

      const write = repository.createGroup.mock.calls[0][0];
      expect(write.state).toBe('QUEUE');
      expect(write.publishDate.getTime()).toBeGreaterThanOrEqual(before);
      expect(repository.publishNow).toHaveBeenCalledWith({ orgId: 'org_1', group: write.group });
      expect(scheduling.publishNow).toHaveBeenCalledWith([
        { postId: 'root_x', organizationId: 'org_1' },
      ]);
      expect(scheduling.schedulePublish).not.toHaveBeenCalled();
    });

    it('posts now on an update too, after cancelling the channels it dropped', async () => {
      repository.findRoots.mockResolvedValueOnce([
        { id: 'root_x', integrationId: 'ch_x', state: State.QUEUE },
        { id: 'root_li', integrationId: 'ch_li', state: State.QUEUE },
      ]);
      repository.findRoots.mockResolvedValueOnce([
        { id: 'root_x', integrationId: 'ch_x', state: State.QUEUE },
      ]);
      repository.publishNow.mockResolvedValue({
        outcome: 'saved',
        roots: [{ id: 'root_x', integrationId: 'ch_x', state: State.QUEUE }],
      });

      await service.update('org_1', GROUP, {
        ...input({ state: 'QUEUE', publishNow: true }),
        expectedUpdatedAt: new Date().toISOString(),
      });

      expect(scheduling.cancelPublish).toHaveBeenCalledWith(['root_li']);
      expect(scheduling.publishNow).toHaveBeenCalledWith([
        { postId: 'root_x', organizationId: 'org_1' },
      ]);
    });

    it('returns settings, tags and the repeat in details, the calendar and the queue', async () => {
      const tagged = [
        row({
          id: 'y1',
          integrationId: 'ch_yt',
          settings: '{"customized":false,"title":"Launch","privacyStatus":"private","stale":1}',
          intervalInDays: 7,
          tags: [
            { tag: { id: 'tag_b', name: 'Beta', color: 'rose' } },
            { tag: { id: 'tag_a', name: 'Alpha', color: 'teal' } },
          ],
          integration: {
            id: 'ch_yt',
            name: 'Acme',
            providerIdentifier: 'youtube',
            picture: null,
            profile: null,
            deletedAt: null,
          },
        }),
      ];
      repository.findGroup.mockResolvedValueOnce(tagged);
      repository.listCalendar.mockResolvedValueOnce(tagged);
      repository.listQueue.mockResolvedValueOnce({ rows: tagged, total: 1 });

      const detail = await service.get('org_1', GROUP);
      expect(detail.channels[0].settings).toEqual({ title: 'Launch', privacyStatus: 'private' });
      expect(detail.tags).toEqual([
        { id: 'tag_b', name: 'Beta', color: 'rose' },
        { id: 'tag_a', name: 'Alpha', color: 'teal' },
      ]);
      expect(detail.intervalInDays).toBe(7);

      const [summary] = await service.calendar('org_1', {
        from: '2026-09-28T00:00:00.000Z',
        to: '2026-10-05T00:00:00.000Z',
      });
      expect(summary.tags.map((tag) => tag.id)).toEqual(['tag_b', 'tag_a']);
      expect(summary.intervalInDays).toBe(7);

      const page = await service.queue('org_1', { page: 1, sort: 'asc' });
      expect(page.posts[0]).toMatchObject({
        intervalInDays: 7,
        tags: [{ id: 'tag_b' }, { id: 'tag_a' }],
      });
    });
  });

  describe('internal callers: a known group and the origin (Sprint 10)', () => {
    const KNOWN = '5a8b6f1e-3c2d-5e4f-8a9b-0c1d2e3f4a5b';

    it('writes nothing for the composer beyond what it always did', async () => {
      await service.create('org_1', input());

      const write = repository.createGroup.mock.calls[0][0];
      expect(write).not.toHaveProperty('creationMethod');
      expect(write.group).not.toBe(KNOWN);
    });

    it('uses the caller’s group and origin when the group is new', async () => {
      repository.findGroup.mockResolvedValueOnce([]);

      const detail = await service.create('org_1', input(), {
        group: KNOWN,
        creationMethod: 'AUTOMATION',
      });

      expect(repository.findGroup).toHaveBeenNthCalledWith(1, 'org_1', KNOWN);
      expect(repository.createGroup.mock.calls[0][0]).toMatchObject({
        group: KNOWN,
        creationMethod: 'AUTOMATION',
      });
      expect(detail.group).toBe(KNOWN);
    });

    it('returns a known group as it is: no second row, no schedule, no publish', async () => {
      repository.findGroup.mockResolvedValue([row({ group: KNOWN, state: State.QUEUE })]);

      const detail = await service.create(
        'org_1',
        input({ state: 'QUEUE', publishNow: true, publishDate: '2020-01-01T00:00:00.000Z' }),
        { group: KNOWN, creationMethod: 'AUTOMATION' },
      );

      expect(detail).toMatchObject({ group: KNOWN, state: State.QUEUE });
      expect(repository.createGroup).not.toHaveBeenCalled();
      expect(repository.publishNow).not.toHaveBeenCalled();
      expect(scheduling.publishNow).not.toHaveBeenCalled();
      expect(scheduling.schedulePublish).not.toHaveBeenCalled();
      // Not even the channels and media are looked up again.
      expect(channels.list).not.toHaveBeenCalled();
    });

    it('publishes a new group now under the caller’s id', async () => {
      repository.findGroup.mockResolvedValueOnce([]);
      repository.publishNow.mockResolvedValue({
        outcome: 'saved',
        roots: [{ id: 'root_x', integrationId: 'ch_x', state: State.QUEUE }],
      });

      await service.create('org_1', input({ state: 'QUEUE', publishNow: true }), {
        group: KNOWN,
        creationMethod: 'AUTOMATION',
      });

      expect(repository.publishNow).toHaveBeenCalledWith({ orgId: 'org_1', group: KNOWN });
      expect(scheduling.publishNow).toHaveBeenCalledWith([
        { postId: 'root_x', organizationId: 'org_1' },
      ]);
    });

    it('refuses a malformed group as a bug, before reading anything', async () => {
      await expect(service.create('org_1', input(), { group: 'not-a-uuid' })).rejects.toThrow(
        'the group must be a UUID',
      );
      expect(repository.findGroup).not.toHaveBeenCalled();
    });

    it('finds a post by group or row id, and nothing for junk', async () => {
      repository.findPostRef.mockResolvedValue({ group: GROUP, rootId: 'p1' });

      await expect(service.findPostRef('org_1', GROUP)).resolves.toEqual({
        group: GROUP,
        rootId: 'p1',
      });
      await expect(service.findPostRef('org_1', '{{ oops }}')).resolves.toBeNull();
      expect(repository.findPostRef).toHaveBeenCalledTimes(1);
    });
  });
});

describe('stored JSON readers', () => {
  it('read media references, ignoring anything that is not one', () => {
    expect(parseImageIds('[{"id":"a"},{"path":"http://x"},{"id":1}]')).toEqual(['a']);
    expect(parseImageIds('not json')).toEqual([]);
    expect(parseImageIds(null)).toEqual([]);
  });

  it('read the customized flag, defaulting to shared', () => {
    expect(parseCustomized('{"customized":true}')).toBe(true);
    expect(parseCustomized('{"customized":"true"}')).toBe(false);
    expect(parseCustomized('garbage')).toBe(false);
    expect(parseCustomized(null)).toBe(false);
    // Provider settings beside the flag do not change it.
    expect(parseCustomized('{"customized":true,"title":"x"}')).toBe(true);
  });

  it('read provider settings without the flag, limited to the provider’s fields', () => {
    expect(
      parseProviderSettings('{"customized":true,"replySettings":"verified","x":1}', 'x'),
    ).toEqual({ replySettings: 'verified' });
    expect(parseProviderSettings('{"customized":false,"title":"t"}', 'linkedin')).toEqual({});
    expect(parseProviderSettings('[1]', 'x')).toEqual({});
    expect(parseProviderSettings('nope', 'x')).toEqual({});
    expect(parseProviderSettings(null, 'x')).toEqual({});
  });
});
