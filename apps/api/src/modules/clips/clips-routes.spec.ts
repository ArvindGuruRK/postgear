/**
 * Route order and the internal token, through Nest's real router.
 *
 * `GET /clips/:clipId` would swallow `GET /clips/status`, `/clips/videos`
 * and `/clips/channels` if it were registered before them. `ClipsModule`
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
import { ClipItemService } from './clip/clip-item.service';
import { ClipsModule } from './clips.module';
import { ClipsCoreModule } from './clips-core.module';
import { ClipReconcileService } from './internal/clip-reconcile.service';
import { ClipJobEventsService } from './jobs/clip-job-events.service';
import { ClipJobsRepository } from './jobs/clip-jobs.repository';
import { ClipJobsService } from './jobs/clip-jobs.service';
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
      .overrideProvider(ClipJobEventsService)
      .useValue({})
      .overrideProvider(ClipReconcileService)
      .useValue({ reconcile })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { activeOrg: unknown }).activeOrg = { id: 'seed-demo-org', role: 'ADMIN' };
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
