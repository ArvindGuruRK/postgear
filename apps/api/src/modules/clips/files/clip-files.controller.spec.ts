/**
 * The files route against a real local binding in a temporary folder, behind
 * helmet exactly as `main.ts` mounts it. The web app is another origin, so a
 * served file must carry `Cross-Origin-Resource-Policy: cross-origin`, or the
 * browser refuses the player's video and the filmstrip's pictures.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { clipKeys, LocalPrivateStorage } from '@postgear/storage';
import helmet from 'helmet';
import request from 'supertest';
import { PRIVATE_STORAGE } from '../../media/storage/storage.interface';
import { ClipFilesController } from './clip-files.controller';

const org = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const video = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const secret = 'x'.repeat(48);

describe('ClipFilesController', () => {
  let root: string;
  let storage: LocalPrivateStorage;
  let app: INestApplication;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'postgear-files-route-'));
    storage = new LocalPrivateStorage(root, 'http://localhost:3001', secret);
    const moduleRef = await Test.createTestingModule({
      controllers: [ClipFilesController],
      providers: [{ provide: PRIVATE_STORAGE, useValue: storage }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(helmet({ contentSecurityPolicy: false }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  async function pathFor(key: string, downloadName?: string): Promise<string> {
    const url = await storage.signedUrl(key, { expiresInSeconds: 600, downloadName });
    return new URL(url).pathname;
  }

  it('serves a whole file that another origin may show, sandboxed', async () => {
    const key = clipKeys.videoFile(org, video, 'poster', 'jpg');
    await storage.put(key, Buffer.from('poster-bytes'), 'image/jpeg');

    const response = await request(app.getHttpServer()).get(await pathFor(key));

    expect(response.status).toBe(200);
    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(response.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-disposition']).toBeUndefined();
    expect(Buffer.from(response.body).toString()).toBe('poster-bytes');
  });

  it('answers a player range with 206, its range and the same cross-origin header', async () => {
    const key = clipKeys.videoFile(org, video, 'proxy', 'mp4');
    await storage.put(key, Buffer.from('0123456789'), 'video/mp4');

    const response = await request(app.getHttpServer())
      .get(await pathFor(key))
      .set('Range', 'bytes=2-5')
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(206);
    expect(response.headers['content-range']).toBe('bytes 2-5/10');
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect((response.body as Buffer).toString()).toBe('2345');
  });

  it('names a download when the link was made for one', async () => {
    const key = clipKeys.videoFile(org, video, 'poster', 'jpg');
    await storage.put(key, Buffer.from('poster-bytes'), 'image/jpeg');

    const response = await request(app.getHttpServer()).get(await pathFor(key, 'My Clip.jpg'));

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('attachment');
  });

  it('answers 416 for a range past the end', async () => {
    const key = clipKeys.videoFile(org, video, 'proxy', 'mp4');
    await storage.put(key, Buffer.from('0123456789'), 'video/mp4');

    const response = await request(app.getHttpServer())
      .get(await pathFor(key))
      .set('Range', 'bytes=50-60');

    expect(response.status).toBe(416);
    expect(response.headers['content-range']).toBe('bytes */10');
  });

  it('refuses a forged or malformed token the same way, and a missing file with 404', async () => {
    const key = clipKeys.videoFile(org, video, 'poster', 'jpg');
    await storage.put(key, Buffer.from('poster-bytes'), 'image/jpeg');
    const good = await pathFor(key);
    const forged = `${good.slice(0, -4)}AAAA`;

    const server = app.getHttpServer();
    const [forgedResponse, junkResponse] = await Promise.all([
      request(server).get(forged),
      request(server).get('/clips/files/not-a-token'),
    ]);
    expect(forgedResponse.status).toBe(403);
    expect(junkResponse.status).toBe(403);
    expect(forgedResponse.body).toEqual(junkResponse.body);
    expect(forgedResponse.headers['cross-origin-resource-policy']).not.toBe('cross-origin');

    const gone = clipKeys.videoFile(org, video, 'poster', 'webp');
    const missing = await request(server).get(await pathFor(gone));
    expect(missing.status).toBe(404);
  });
});
