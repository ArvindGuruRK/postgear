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
import { EntitlementResolver } from '../entitlements/entitlement-resolver';
import { UsageService } from '../entitlements/usage.service';
import { MediaService } from '../media/media.service';
import { PRIVATE_STORAGE } from '../media/storage/storage.interface';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { ClipChannelsModule } from './channels/clip-channels.module';
import { ClipEditsService } from './clip/clip-edits.service';
import { ClipExportsService } from './clip/clip-exports.service';
import { ClipItemService } from './clip/clip-item.service';
import { ClipsListService } from './clip/clips-list.service';
import { ClipsModule } from './clips.module';
import { ClipsCoreModule } from './clips-core.module';
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
import { ClipLinksModule } from './links/clip-links.module';
import { CLIP_LINK_PROBER } from './links/clip-links.types';
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
  ClipVideosRepository,
  EntitlementResolver,
  UsageService,
  SchedulingService,
  MediaService,
];

@Module({
  providers: [
    ...SHARED.map((token) => ({ provide: token, useValue: {} })),
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

describe('Clips routes', () => {
  let app: INestApplication;
  const reconcile = jest.fn(async () => ({ started: 0, failed: 0 }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ClipsModule] })
      .overrideModule(ClipsCoreModule)
      .useModule(FakeCoreModule)
      .overrideModule(ClipLinksModule)
      .useModule(FakeLinksModule)
      .overrideModule(ClipChannelsModule)
      .useModule(FakeChannelsModule)
      .overrideModule(NotificationsModule)
      .useModule(FakeNotificationsModule)
      .overrideProvider(ClipsStatusService)
      .useValue({ status: async () => ({ reached: 'status' }) })
      .overrideProvider(ClipVideosService)
      .useValue({ list: async () => ({ reached: 'videos' }) })
      .overrideProvider(ClipItemService)
      .useValue({ get: async (_org: string, clipId: string) => ({ reached: 'clip', clipId }) })
      .overrideProvider(ClipEditsService)
      .useValue({
        patch: async (_org: string, clipId: string) => ({ reached: 'patch', clipId }),
        remove: async (_org: string, clipId: string) => ({ reached: 'delete', clipId }),
      })
      .overrideProvider(ClipsListService)
      .useValue({ list: async () => ({ reached: 'clips' }) })
      .overrideProvider(ClipExportsService)
      .useValue({
        start: async (_org: string, _user: string, clipId: string) => ({ reached: 'export', clipId }),
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
    expect((await request(server).get('/clips/library/sounds?q=rain&kind=sfx').expect(200)).body).toEqual({
      reached: 'library-sounds',
    });
    expect(
      (await request(server).get('/clips/library/categories?type=sound&kind=music').expect(200)).body,
    ).toEqual({ reached: 'library-categories' });
    await request(server).delete(`/clips/library/favourites/sound/${CLIP_ID}`).expect(204);
    expect((await request(server).get('/clips/sounds/uploads').expect(200)).body).toEqual({
      reached: 'sound-uploads',
    });
    expect(
      (await request(server).get(`/clips/sounds/files?library=${CLIP_ID}&asset=${CLIP_ID}`).expect(200)).body,
    ).toEqual({ reached: 'sound-files' });
    expect((await request(server).delete(`/clips/sounds/uploads/${CLIP_ID}`).expect(200)).body).toEqual({
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
      (await request(server).post(`/clips/${CLIP_ID}/exports`).send({ quality: '1080p', revision: 2 }).expect(202))
        .body,
    ).toEqual({ reached: 'export', clipId: CLIP_ID });
    expect((await request(server).get(`/clips/${CLIP_ID}/exports`).expect(200)).body).toEqual({
      reached: 'export-history',
      clipId: CLIP_ID,
    });
    expect((await request(server).post(`/clips/${CLIP_ID}/previews`).send({ revision: 2 }).expect(202)).body).toEqual({
      reached: 'preview',
      clipId: CLIP_ID,
    });
    // An empty body previews the current revision.
    await request(server).post(`/clips/${CLIP_ID}/previews`).expect(202);
    expect((await request(server).get(`/clips/${CLIP_ID}/previews/latest`).expect(200)).body).toEqual({
      reached: 'preview-latest',
      clipId: CLIP_ID,
    });
  });

  it('refuses an export or preview body it does not describe', async () => {
    const server = app.getHttpServer();
    await request(server).post(`/clips/${CLIP_ID}/exports`).send({ quality: '4k' }).expect(400);
    await request(server).post(`/clips/${CLIP_ID}/exports`).send({ quality: '720p', revision: 0 }).expect(400);
    await request(server).post(`/clips/${CLIP_ID}/exports`).send({ quality: '720p', proof: true }).expect(400);
    await request(server).post(`/clips/${CLIP_ID}/previews`).send({ quality: '720p' }).expect(400);
    await request(server).post(`/clips/${CLIP_ID}/previews`).send({ revision: 'two' }).expect(400);
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
