/**
 * Route order and the internal token, through Nest's real router.
 *
 * `GET /clips/:clipId` would swallow `GET /clips/status`, `/clips/videos`,
 * `/clips/channels`, `/clips/layouts`, `/clips/library` and `/clips/stickers`
 * if it were registered before them. `ClipsModule`
 * imports `ClipItemModule` last for that reason; this spec boots the real
 * module graph (with the database-facing providers replaced) and asserts
 * every word route reaches its own controller, and a clip id reaches the
 * clip controller. It also checks the internal routes refuse a call without
 * the worker's token.
 */
import { Controller, Get, type INestApplication, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { ChannelsModule } from '../channels/channels.module';
import { ChannelsService } from '../channels/channels.service';
import { EntitlementResolver } from '../entitlements/entitlement-resolver';
import { UsageService } from '../entitlements/usage.service';
import { MediaService } from '../media/media.service';
import { PRIVATE_STORAGE } from '../media/storage/storage.interface';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';
import { PostsModule } from '../posts/posts.module';
import { PostsService } from '../posts/posts.service';
import { RedisService } from '../redis/redis.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { ClipChannelsModule } from './channels/clip-channels.module';
import { ClipEditsService } from './clip/clip-edits.service';
import { ClipExportsService } from './clip/clip-exports.service';
import { ClipItemService } from './clip/clip-item.service';
import { ClipSendService } from './clip/clip-send.service';
import { ClipsListService } from './clip/clips-list.service';
import { ClipsModule } from './clips.module';
import { ClipsCoreModule } from './clips-core.module';
import { ClipDownloadsRepository } from './downloads/clip-downloads.repository';
import { ClipDownloadsService } from './downloads/clip-downloads.service';
import { ClipReconcileService } from './internal/clip-reconcile.service';
import { ClipJobEventsService } from './jobs/clip-job-events.service';
import { ClipJobsRepository } from './jobs/clip-jobs.repository';
import { ClipJobsService } from './jobs/clip-jobs.service';
import { ClipLayoutsService } from './layouts/clip-layouts.service';
import { ClipLibraryService } from './library/clip-library.service';
import { ClipSoundUploadsService } from './library/clip-sound-uploads.service';
import { ClipStickerUploadsService } from './library/clip-sticker-uploads.service';
import { SOUND_PROVIDER } from './library/sound-provider';
import { STICKER_PROVIDER } from './library/sticker-provider';
import { ClipLimitsGuard } from './limits/clip-limits.guard';
import { ClipsCreateGuard } from './limits/clips-create.guard';
import { ClipLinksModule } from './links/clip-links.module';
import { CLIP_LINK_PROBER } from './links/clip-links.types';
import { ClipRetentionService } from './retention/clip-retention.service';
import { ClipsStatusService } from './status/clips-status.service';
import { ClipPlaybackService } from './videos/clip-playback.service';
import { ClipVideosRepository } from './videos/clip-videos.repository';
import { ClipVideosService } from './videos/clip-videos.service';

const TOKEN = 'test-internal-token';
const CLIP_ID = '55555555-5555-4555-8555-555555555555';

const fakeConfig = {
  get: (key: string) =>
    ({ AUTOMATION_INTERNAL_TOKEN: TOKEN, CLIPS_SIMULATION: 'true', CLIPS_PLATFORMS: ['twitch'] })[
      key
    ],
};

/** Every database or network facing provider, as an empty stand-in. */
const SHARED = [
  ClipJobsRepository,
  ClipJobsService,
  ClipLimitsGuard,
  ClipPlaybackService,
  ClipRetentionService,
  ClipVideosRepository,
  EntitlementResolver,
  UsageService,
  SchedulingService,
  MediaService,
  // Global in the app (RedisModule); the Module 19 sweep takes it.
  RedisService,
];

@Module({
  providers: [
    ...SHARED.filter((token) => token !== EntitlementResolver).map((token) => ({
      provide: token,
      useValue: {},
    })),
    // Module 19: ClipsEnabledGuard reads `clips.enabled` on every Clips route.
    { provide: EntitlementResolver, useValue: { assert: async () => true } },
    { provide: PRIVATE_STORAGE, useValue: {} },
    { provide: ConfigService, useValue: fakeConfig },
  ],
  exports: [...SHARED, PRIVATE_STORAGE, ConfigService],
})
class FakeCoreModule {}

@Module({
  providers: [{ provide: CLIP_LINK_PROBER, useValue: {} }],
  exports: [CLIP_LINK_PROBER],
})
class FakeLinksModule {}

@Controller('clips/channels')
class FakeChannelsController {
  @Get()
  list() {
    return { reached: 'channels' };
  }
}

@Module({ controllers: [FakeChannelsController] })
class FakeChannelsModule {}

@Module({
  providers: [{ provide: NotificationsService, useValue: {} }],
  exports: [NotificationsService],
})
class FakeNotificationsModule {}

/** Module 17: Send To Composer drafts through the posts and channels modules. */
@Module({
  providers: [{ provide: PostsService, useValue: {} }],
  exports: [PostsService],
})
class FakePostsModule {}

@Module({
  providers: [{ provide: ChannelsService, useValue: {} }],
  exports: [ChannelsService],
})
class FakeWorkspaceChannelsModule {}

describe('Clips routes', () => {
  let app: INestApplication;
  const reconcile = jest.fn(async () => ({ started: 0, failed: 0 }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ClipsModule] })
      // Module 19: the abuse limits have their own spec (clips-create.guard.spec.ts).
      .overrideGuard(ClipsCreateGuard)
      .useValue({ canActivate: () => true })
      .overrideModule(ClipsCoreModule)
      .useModule(FakeCoreModule)
      .overrideModule(ClipLinksModule)
      .useModule(FakeLinksModule)
      .overrideModule(ClipChannelsModule)
      .useModule(FakeChannelsModule)
      .overrideModule(NotificationsModule)
      .useModule(FakeNotificationsModule)
      .overrideModule(PostsModule)
      .useModule(FakePostsModule)
      .overrideModule(ChannelsModule)
      .useModule(FakeWorkspaceChannelsModule)
      .overrideProvider(ClipSendService)
      .useValue({
        send: async (_org: string, clipId: string, body: { channelIds: string[] }) => ({
          reached: 'send',
          clipId,
          channels: body.channelIds.length,
        }),
      })
      .overrideProvider(ClipsStatusService)
      .useValue({ status: async () => ({ reached: 'status' }) })
      .overrideProvider(ClipVideosService)
      .useValue({ list: async () => ({ reached: 'videos' }) })
      .overrideProvider(ClipDownloadsRepository)
      .useValue({})
      .overrideProvider(ClipDownloadsService)
      .useValue({
        start: async () => ({ reached: 'download-start', existing: false }),
        list: async () => ({ reached: 'downloads' }),
        fileUrl: async (_org: string, jobId: string) =>
          `http://localhost:3001/clips/files/signed-${jobId}`,
        saveToMedia: async (_org: string, jobId: string) => ({ reached: 'save-to-media', jobId }),
        remove: async (_org: string, jobId: string) => ({ reached: 'download-delete', jobId }),
        downloadOriginal: async (_org: string, videoId: string) => ({
          reached: 'download-original',
          videoId,
        }),
      })
      .overrideProvider(ClipItemService)
      .useValue({ get: async (_org: string, clipId: string) => ({ reached: 'clip', clipId }) })
      .overrideProvider(ClipEditsService)
      .useValue({
        patch: async (_org: string, clipId: string) => ({ reached: 'patch', clipId }),
        remove: async (_org: string, clipId: string) => ({ reached: 'delete', clipId }),
      })
      .overrideProvider(ClipsListService)
      .useValue({
        list: async () => ({ reached: 'clips' }),
        comingUp: async () => ({ reached: 'coming-up' }),
      })
      .overrideProvider(ClipExportsService)
      .useValue({
        start: async (_org: string, _user: string, clipId: string) => ({
          reached: 'export',
          clipId,
        }),
        history: async (_org: string, clipId: string) => ({ reached: 'export-history', clipId }),
        startPreview: async (_org: string, _user: string, clipId: string) => ({
          reached: 'preview',
          clipId,
        }),
        latestPreview: async (_org: string, clipId: string) => ({
          reached: 'preview-latest',
          clipId,
        }),
      })
      .overrideProvider(ClipLayoutsService)
      .useValue({
        list: async () => ({ reached: 'layouts' }),
        rename: async (_org: string, id: string) => ({ reached: 'layout-rename', id }),
        remove: async (_org: string, id: string) => ({ reached: 'layout-delete', id }),
      })
      .overrideProvider(ClipLibraryService)
      .useValue({
        search: async () => ({ reached: 'library-stickers' }),
        searchSounds: async () => ({ reached: 'library-sounds' }),
        categories: async () => ({ reached: 'library-categories' }),
        credits: async () => ({ reached: 'library-credits' }),
        unfavourite: async () => undefined,
      })
      .overrideProvider(ClipStickerUploadsService)
      .useValue({
        list: async () => ({ reached: 'sticker-uploads' }),
        files: async () => ({ reached: 'sticker-files' }),
        remove: async (_org: string, id: string) => ({ reached: 'sticker-delete', id }),
      })
      .overrideProvider(ClipSoundUploadsService)
      .useValue({
        list: async () => ({ reached: 'sound-uploads' }),
        files: async () => ({ reached: 'sound-files' }),
        remove: async (_org: string, id: string) => ({ reached: 'sound-delete', id }),
      })
      .overrideProvider(STICKER_PROVIDER)
      .useValue({})
      .overrideProvider(SOUND_PROVIDER)
      .useValue({})
      .overrideProvider(ClipJobEventsService)
      .useValue({})
      .overrideProvider(ClipReconcileService)
      .useValue({ reconcile })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { activeOrg: unknown }).activeOrg = { id: 'seed-demo-org', role: 'ADMIN' };
      (req as Request & { user: unknown }).user = { id: 'seed-demo-user' };
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('sends /clips/status to the status controller', async () => {
    const response = await request(app.getHttpServer()).get('/clips/status').expect(200);
    expect(response.body).toEqual({ status: { reached: 'status' } });
  });

  it('sends /clips/videos to the videos controller', async () => {
    const response = await request(app.getHttpServer()).get('/clips/videos').expect(200);
    expect(response.body).toEqual({ reached: 'videos' });
  });

  it('sends /clips/channels to the channels controller', async () => {
    const response = await request(app.getHttpServer()).get('/clips/channels').expect(200);
    expect(response.body).toEqual({ reached: 'channels' });
  });

  it('sends a clip id to the clip controller', async () => {
    const response = await request(app.getHttpServer()).get(`/clips/${CLIP_ID}`).expect(200);
    expect(response.body).toEqual({ reached: 'clip', clipId: CLIP_ID });
  });

  it('sends /clips/layouts to the layouts controller, not the clip controller', async () => {
    const list = await request(app.getHttpServer()).get('/clips/layouts').expect(200);
    expect(list.body).toEqual({ reached: 'layouts' });
    const rename = await request(app.getHttpServer())
      .patch(`/clips/layouts/${CLIP_ID}`)
      .send({ name: 'Mine' })
      .expect(200);
    expect(rename.body).toEqual({ reached: 'layout-rename', id: CLIP_ID });
    const removed = await request(app.getHttpServer())
      .delete(`/clips/layouts/${CLIP_ID}`)
      .expect(200);
    expect(removed.body).toEqual({ reached: 'layout-delete', id: CLIP_ID });
  });

  it('sends /clips/library and /clips/stickers to their own controllers, not the clip controller', async () => {
    const server = app.getHttpServer();
    expect((await request(server).get('/clips/library/stickers?q=fire').expect(200)).body).toEqual({
      reached: 'library-stickers',
    });
    expect((await request(server).get('/clips/library/categories').expect(200)).body).toEqual({
      reached: 'library-categories',
    });
    expect((await request(server).get('/clips/library/credits').expect(200)).body).toEqual({
      reached: 'library-credits',
    });
    await request(server).delete(`/clips/library/favourites/sticker/${CLIP_ID}`).expect(204);
    expect((await request(server).get('/clips/stickers/uploads').expect(200)).body).toEqual({
      reached: 'sticker-uploads',
    });
    expect(
      (await request(server).get(`/clips/stickers/files?library=${CLIP_ID}`).expect(200)).body,
    ).toEqual({
      reached: 'sticker-files',
    });
    expect(
      (await request(server).delete(`/clips/stickers/uploads/${CLIP_ID}`).expect(200)).body,
    ).toEqual({
      reached: 'sticker-delete',
      id: CLIP_ID,
    });
  });

  it('sends /clips/library/sounds and /clips/sounds to their own controllers, not the clip controller', async () => {
    const server = app.getHttpServer();
    expect(
      (await request(server).get('/clips/library/sounds?q=rain&kind=sfx').expect(200)).body,
    ).toEqual({
      reached: 'library-sounds',
    });
    expect(
      (await request(server).get('/clips/library/categories?type=sound&kind=music').expect(200))
        .body,
    ).toEqual({ reached: 'library-categories' });
    await request(server).delete(`/clips/library/favourites/sound/${CLIP_ID}`).expect(204);
    expect((await request(server).get('/clips/sounds/uploads').expect(200)).body).toEqual({
      reached: 'sound-uploads',
    });
    expect(
      (
        await request(server)
          .get(`/clips/sounds/files?library=${CLIP_ID}&asset=${CLIP_ID}`)
          .expect(200)
      ).body,
    ).toEqual({ reached: 'sound-files' });
    expect(
      (await request(server).delete(`/clips/sounds/uploads/${CLIP_ID}`).expect(200)).body,
    ).toEqual({
      reached: 'sound-delete',
      id: CLIP_ID,
    });
  });

  it('refuses a sound query it does not describe', async () => {
    const server = app.getHttpServer();
    await request(server).get('/clips/library/sounds?kind=animated').expect(400);
    await request(server).get('/clips/library/sounds?category=gaming-music').expect(400);
    await request(server).get('/clips/library/sounds?pageSize=61').expect(400);
    await request(server).get('/clips/library/categories?type=sound&kind=static').expect(400);
    await request(server).get('/clips/library/categories?type=sticker&kind=music').expect(400);
    await request(server).get('/clips/library/categories?type=song').expect(400);
    await request(server).delete(`/clips/library/favourites/song/${CLIP_ID}`).expect(400);
    await request(server).get('/clips/sounds/files?asset=not-an-id').expect(400);
  });

  it('refuses a library query it does not describe', async () => {
    const server = app.getHttpServer();
    await request(server).get('/clips/library/stickers?kind=video').expect(400);
    await request(server).get('/clips/library/stickers?pageSize=500').expect(400);
    await request(server).get('/clips/library/stickers?everything=1').expect(400);
    await request(server).get('/clips/stickers/files?library=not-an-id').expect(400);
    await request(server).delete('/clips/library/favourites/sticker/not-an-id').expect(400);
  });

  it('sends GET /clips to the library list, and PATCH and DELETE of a clip id to the clip controller', async () => {
    const list = await request(app.getHttpServer()).get('/clips?status=draft').expect(200);
    expect(list.body).toEqual({ reached: 'clips' });
    const patched = await request(app.getHttpServer())
      .patch(`/clips/${CLIP_ID}`)
      .send({ revision: 1, title: 'New name' })
      .expect(200);
    expect(patched.body).toEqual({ reached: 'patch', clipId: CLIP_ID });
    const removed = await request(app.getHttpServer()).delete(`/clips/${CLIP_ID}`).expect(200);
    expect(removed.body).toEqual({ reached: 'delete', clipId: CLIP_ID });
  });

  it('sends /clips/coming-up to Coming Up, not the clip controller, and a send to the sender (Module 17)', async () => {
    const server = app.getHttpServer();
    expect((await request(server).get('/clips/coming-up').expect(200)).body).toEqual({
      reached: 'coming-up',
    });
    expect(
      (
        await request(server)
          .post(`/clips/${CLIP_ID}/send`)
          .send({ channelIds: ['channel-1', 'channel-2'], caption: 'Hello' })
          .expect(201)
      ).body,
    ).toEqual({ reached: 'send', clipId: CLIP_ID, channels: 2 });
    // The picker's list options are described.
    await request(server).get('/clips?withExport=true&q=boss&sort=oldest').expect(200);
  });

  it('refuses a send body it does not describe (Module 17)', async () => {
    const server = app.getHttpServer();
    await request(server).post(`/clips/${CLIP_ID}/send`).send({ channelIds: [] }).expect(400);
    await request(server)
      .post(`/clips/${CLIP_ID}/send`)
      .send({ channelIds: ['a', 'a'] })
      .expect(400);
    await request(server)
      .post(`/clips/${CLIP_ID}/send`)
      .send({ channelIds: ['a'], publishDate: '2026-12-01' })
      .expect(400);
    await request(server)
      .post(`/clips/${CLIP_ID}/send`)
      .send({ channelIds: Array.from({ length: 21 }, (_, i) => `c${i}`) })
      .expect(400);
    await request(server).get('/clips?withExport=yes').expect(400);
  });

  it('refuses a list query or a patch body it does not describe', async () => {
    await request(app.getHttpServer()).get('/clips?status=everything').expect(400);
    await request(app.getHttpServer()).get('/clips?source=vimeo').expect(400);
    await request(app.getHttpServer()).patch(`/clips/${CLIP_ID}`).send({ revision: 1 }).expect(400);
    await request(app.getHttpServer())
      .patch(`/clips/${CLIP_ID}`)
      .send({ revision: 1, status: 'NEW' })
      .expect(400);
  });

  it('sends the export and preview routes of a clip id to the export service (Module 15)', async () => {
    const server = app.getHttpServer();
    expect(
      (
        await request(server)
          .post(`/clips/${CLIP_ID}/exports`)
          .send({ quality: '1080p', revision: 2 })
          .expect(202)
      ).body,
    ).toEqual({ reached: 'export', clipId: CLIP_ID });
    expect((await request(server).get(`/clips/${CLIP_ID}/exports`).expect(200)).body).toEqual({
      reached: 'export-history',
      clipId: CLIP_ID,
    });
    expect(
      (await request(server).post(`/clips/${CLIP_ID}/previews`).send({ revision: 2 }).expect(202))
        .body,
    ).toEqual({
      reached: 'preview',
      clipId: CLIP_ID,
    });
    // An empty body previews the current revision.
    await request(server).post(`/clips/${CLIP_ID}/previews`).expect(202);
    expect(
      (await request(server).get(`/clips/${CLIP_ID}/previews/latest`).expect(200)).body,
    ).toEqual({
      reached: 'preview-latest',
      clipId: CLIP_ID,
    });
  });

  it('refuses an export or preview body it does not describe', async () => {
    const server = app.getHttpServer();
    await request(server).post(`/clips/${CLIP_ID}/exports`).send({ quality: '4k' }).expect(400);
    await request(server)
      .post(`/clips/${CLIP_ID}/exports`)
      .send({ quality: '720p', revision: 0 })
      .expect(400);
    await request(server)
      .post(`/clips/${CLIP_ID}/exports`)
      .send({ quality: '720p', proof: true })
      .expect(400);
    await request(server).post(`/clips/${CLIP_ID}/previews`).send({ quality: '720p' }).expect(400);
    await request(server).post(`/clips/${CLIP_ID}/previews`).send({ revision: 'two' }).expect(400);
  });

  it('sends /clips/downloads to the downloads controller, not the clip controller (Module 18)', async () => {
    const server = app.getHttpServer();
    expect((await request(server).get('/clips/downloads').expect(200)).body).toEqual({
      reached: 'downloads',
    });
    expect(
      (
        await request(server)
          .post('/clips/downloads')
          .send({ url: 'https://www.youtube.com/watch?v=simtalk0001', formatId: 'h720' })
          .expect(202)
      ).body,
    ).toEqual({ reached: 'download-start', existing: false });
    // Save File answers the address as JSON, so a refusal reaches the row as its sentence.
    const file = await request(server).get(`/clips/downloads/${CLIP_ID}/file`).expect(200);
    expect(file.body).toEqual({ url: `http://localhost:3001/clips/files/signed-${CLIP_ID}` });
    expect(file.headers.location).toBeUndefined();
    expect(file.headers['cache-control']).toBe('no-store');
    expect(
      (await request(server).post(`/clips/downloads/${CLIP_ID}/save-to-media`).expect(202)).body,
    ).toEqual({ reached: 'save-to-media', jobId: CLIP_ID });
    expect((await request(server).delete(`/clips/downloads/${CLIP_ID}`).expect(200)).body).toEqual({
      reached: 'download-delete',
      jobId: CLIP_ID,
    });
    expect(
      (await request(server).post(`/clips/videos/${CLIP_ID}/download-original`).expect(200)).body,
    ).toEqual({ reached: 'download-original', videoId: CLIP_ID });
  });

  it('refuses a download body it does not describe (Module 18)', async () => {
    const server = app.getHttpServer();
    await request(server).post('/clips/downloads').send({ url: 'x' }).expect(400);
    await request(server)
      .post('/clips/downloads')
      .send({ url: 'https://example.com', formatId: 'bestvideo+bestaudio' })
      .expect(400);
    await request(server)
      .post('/clips/downloads')
      .send({ url: 'https://example.com', formatId: 'h720', quality: '4k' })
      .expect(400);
    await request(server)
      .post('/clips/downloads')
      .send({ url: '', formatId: 'h720', rightsConfirmed: true })
      .expect(400);
  });

  it('refuses an internal call without the worker token', async () => {
    await request(app.getHttpServer()).post('/internal/clips/reconcile').send({}).expect(401);
    await request(app.getHttpServer())
      .post('/internal/clips/reconcile')
      .set('X-PostGear-Internal', 'wrong-token-of-the-same-size')
      .send({})
      .expect(401);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('runs an internal call with the token, and refuses a body it does not describe', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/clips/reconcile')
      .set('X-PostGear-Internal', TOKEN)
      .expect(200);
    expect(response.body).toEqual({ started: 0, failed: 0 });

    await request(app.getHttpServer())
      .post('/internal/clips/reconcile')
      .set('X-PostGear-Internal', TOKEN)
      .send({ everything: true })
      .expect(400);
  });
});
