/**
 * The avatar routes' validation and wiring. The behaviour behind them is in
 * `avatar.service.spec.ts`.
 */
import { BadRequestException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { AvatarController, avatarPresetSchema } from './avatar.controller';
import type { AvatarService } from './avatar.service';

const current: AuthenticatedUser = {
  id: '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e',
  email: 'demo@postgear.local',
  isSuperAdmin: false,
  onboardingCompletedAt: null,
};

describe('PUT /users/me/avatar/preset body', () => {
  const pipe = new ZodBody(avatarPresetSchema, 'test');

  it('accepts a listed preset id', () => {
    expect(pipe.transform({ id: 'notionists-07' })).toEqual({ id: 'notionists-07' });
  });

  it.each([
    [{ id: 'notionists-99' }],
    [{ id: '../../etc/passwd' }],
    [{ id: 'notionists-01', url: 'https://x' }],
    [{ id: 7 }],
    [{}],
  ])('rejects %j', (body) => {
    expect(() => pipe.transform(body)).toThrow(BadRequestException);
  });
});

describe('AvatarController', () => {
  const avatars = {
    setPreset: jest.fn(async () => ({ kind: 'preset', id: 'notionists-02' })),
    upload: jest.fn(async () => ({ kind: 'image', url: 'http://x/avatars/a.webp' })),
    clear: jest.fn(async () => null),
  };
  const controller = new AvatarController(avatars as unknown as AvatarService);

  it('wraps every answer as { avatar }', async () => {
    await expect(controller.setPreset(current, { id: 'notionists-02' })).resolves.toEqual({
      avatar: { kind: 'preset', id: 'notionists-02' },
    });
    expect(avatars.setPreset).toHaveBeenCalledWith(current.id, 'notionists-02');

    const file = { buffer: Buffer.from('x'), size: 1 };
    await expect(controller.upload(current, file)).resolves.toEqual({
      avatar: { kind: 'image', url: 'http://x/avatars/a.webp' },
    });
    expect(avatars.upload).toHaveBeenCalledWith(current.id, file);

    await expect(controller.clear(current)).resolves.toEqual({ avatar: null });
  });
});
