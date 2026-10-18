/**
 * The OAuth signup photo (UI revamp, 2026-10-17): imported once, when an
 * account is first created through Google or Facebook, and never on a later
 * sign-in. The import itself (fetch, caps, storage) is covered in
 * `users/avatar.service.spec.ts`; here it is a mock.
 */
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');

  return {
    ...actual,
    prisma: {
      user: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
    },
  };
});

import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { Provider, prisma } from '@postgear/db';
import type { MailService } from '../mail/mail.service';
import type { AvatarService } from '../users/avatar.service';
import { AuthService } from './auth.service';
import type { LockoutService } from './lockout.service';
import type { PasswordService } from './password.service';
import type { TokenService } from './token.service';

const db = prisma as unknown as {
  user: Record<'findFirst' | 'create' | 'update' | 'findUniqueOrThrow', jest.Mock>;
};

const PHOTO = 'https://lh3.googleusercontent.com/a/photo=s96-c';

const created = {
  id: '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e',
  email: 'new@example.com',
  name: 'New Person',
  avatarUrl: null,
  avatarPreset: null,
};

describe('AuthService.findOrCreateFromOAuth: provider photo', () => {
  const avatars = { importFromUrl: jest.fn() };
  const config = {
    get: (_key: string, fallback?: unknown) => fallback,
  } as unknown as ConfigService;
  const service = new AuthService(
    {} as PasswordService,
    {} as TokenService,
    {} as LockoutService,
    {} as MailService,
    {} as JwtService,
    config,
    avatars as unknown as AvatarService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('imports the photo for a brand-new account and returns it as the avatar', async () => {
    db.user.findFirst.mockResolvedValue(null);
    db.user.create.mockResolvedValue(created);
    const stored = 'http://localhost:3001/uploads/avatars/x.webp';
    avatars.importFromUrl.mockResolvedValue({ kind: 'image', url: stored });

    const user = await service.findOrCreateFromOAuth(
      { providerId: 'g-1', email: created.email, name: created.name, picture: PHOTO },
      Provider.GOOGLE,
    );

    expect(avatars.importFromUrl).toHaveBeenCalledWith(created.id, PHOTO);
    expect(user.avatarUrl).toBe(stored);
  });

  it('signs the user in with initials when the import gives up', async () => {
    db.user.findFirst.mockResolvedValue(null);
    db.user.create.mockResolvedValue(created);
    // `importFromUrl` never throws; failure is a null avatar.
    avatars.importFromUrl.mockResolvedValue(null);

    const user = await service.findOrCreateFromOAuth(
      { providerId: 'fb-1', email: created.email, picture: PHOTO },
      Provider.FACEBOOK,
    );

    expect(user).toMatchObject({ id: created.id, avatarUrl: null, avatarPreset: null });
  });

  it('never touches the avatar of an existing account on a later sign-in', async () => {
    const existing = {
      ...created,
      providerId: 'g-1',
      activated: true,
      avatarPreset: 'notionists-02',
    };
    db.user.findFirst.mockResolvedValue(existing);
    db.user.findUniqueOrThrow.mockResolvedValue(existing);

    const user = await service.findOrCreateFromOAuth(
      { providerId: 'g-1', email: created.email, picture: PHOTO },
      Provider.GOOGLE,
    );

    expect(avatars.importFromUrl).not.toHaveBeenCalled();
    expect(user.avatarPreset).toBe('notionists-02');
  });
});
