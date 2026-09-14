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
import type { CreatePostInput } from './dto/posts.schema';
import type { PostRow, PostsRepository } from './posts.repository';
import { parseCustomized, parseImageIds, PostsService } from './posts.service';

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
      'createGroup' | 'replaceGroup' | 'findGroup' | 'deleteGroup' | 'listRecentGroups'
    >
  >;
  let channels: { list: jest.Mock };
  let media: { findViews: jest.Mock };
  let service: PostsService;

  beforeEach(() => {
    repository = {
      createGroup: jest.fn().mockResolvedValue(undefined),
      replaceGroup: jest.fn().mockResolvedValue('saved'),
      findGroup: jest.fn(),
      deleteGroup: jest.fn(),
      listRecentGroups: jest.fn(),
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
      ]),
    };
    media = { findViews: jest.fn().mockResolvedValue(new Map([[IMAGE_ID, image()]])) };

    service = new PostsService(
      repository as unknown as PostsRepository,
      channels as unknown as ChannelsService,
      media as unknown as MediaService,
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
      createdAt: new Date('2026-09-14T10:00:00Z'),
      updatedAt: new Date('2026-09-14T10:00:00Z'),
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
      // No URL is persisted — only the id, resolved again whenever it is read.
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
        'Acme on X: X allows 280 characters; this post has 281.',
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
  });
});
