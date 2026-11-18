/**
 * The thumbnail route behind helmet, as `main.ts` mounts it. The link card
 * shows the picture with an `<img>` on the web app, another origin, so the
 * answer must say `Cross-Origin-Resource-Policy: cross-origin`.
 */
import { type INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import helmet from 'helmet';
import request from 'supertest';
import { ClipLinksController } from './clip-links.controller';
import { CLIP_LINK_PROBER } from './clip-links.types';
import { ClipThumbnailsService } from './clip-thumbnails.service';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

describe('ClipLinksController thumbnail', () => {
  let app: INestApplication;
  const fetchThumbnail = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ClipLinksController],
      providers: [
        { provide: CLIP_LINK_PROBER, useValue: {} },
        { provide: ClipThumbnailsService, useValue: { fetch: fetchThumbnail, linkFor: jest.fn() } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(helmet({ contentSecurityPolicy: false }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the picture so the web app may show it, and nothing else may run', async () => {
    fetchThumbnail.mockResolvedValue({ body: JPEG, contentType: 'image/jpeg' });

    const response = await request(app.getHttpServer()).get('/clips/links/thumbnail?u=token');

    expect(response.status).toBe(200);
    expect(fetchThumbnail).toHaveBeenCalledWith('token');
    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(response.headers['content-security-policy']).toBe("default-src 'none'");
    expect(response.headers['content-type']).toBe('image/jpeg');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(response.body).equals(JPEG)).toBe(true);
  });

  it('lets the page read a refusal as its real status, and never caches it', async () => {
    fetchThumbnail.mockRejectedValue(new NotFoundException('The picture is not there.'));

    const response = await request(app.getHttpServer()).get('/clips/links/thumbnail?u=token');

    expect(response.status).toBe(404);
    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(response.headers['cache-control'] ?? '').not.toContain('max-age=3600');
  });

  it('refuses a query it does not describe', async () => {
    const response = await request(app.getHttpServer()).get('/clips/links/thumbnail?u=t&x=1');
    expect(response.status).toBe(400);
  });
});
