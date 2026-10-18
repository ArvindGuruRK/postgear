/**
 * The appearance routes: the read serves the effective themes, the write
 * validates against each mode's catalog and refuses a premium theme without a
 * plan, writing nothing at all when it does.
 */
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');

  return {
    ...actual,
    prisma: { user: { findUniqueOrThrow: jest.fn(), update: jest.fn() } },
  };
});

jest.mock('./appearance.entitlement', () => ({ hasPremiumThemes: jest.fn() }));

import { HttpStatus } from '@nestjs/common';
import { prisma } from '@postgear/db';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { THEMES } from './appearance.catalog';
import {
  AppearanceController,
  PREMIUM_THEME_REQUIRED_CODE,
  PremiumThemeRequiredException,
  updateAppearanceSchema,
} from './appearance.controller';
import { hasPremiumThemes } from './appearance.entitlement';

const db = prisma as unknown as { user: Record<'findUniqueOrThrow' | 'update', jest.Mock> };
const premium = hasPremiumThemes as jest.Mock;

const SELECT = { themeMode: true, lightTheme: true, darkTheme: true };

const current: AuthenticatedUser = {
  id: 'u1',
  email: 'demo@postgear.local',
  isSuperAdmin: false,
  onboardingCompletedAt: new Date(),
};

async function expectPremiumRefusal(attempt: Promise<unknown>) {
  await expect(attempt).rejects.toBeInstanceOf(PremiumThemeRequiredException);
  await attempt.catch((error: PremiumThemeRequiredException) => {
    expect(error.getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);
    expect(error.getResponse()).toMatchObject({ code: PREMIUM_THEME_REQUIRED_CODE });
  });
  expect(db.user.update).not.toHaveBeenCalled();
}

describe('AppearanceController', () => {
  const controller = new AppearanceController();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /users/me/appearance', () => {
    it('lowercases the mode and returns both catalogs with the entitlement', async () => {
      db.user.findUniqueOrThrow.mockResolvedValue({
        themeMode: 'SYSTEM',
        lightTheme: 'paper',
        darkTheme: 'forest',
      });
      premium.mockResolvedValue(false);

      await expect(controller.appearance(current)).resolves.toEqual({
        appearance: {
          mode: 'system',
          lightTheme: 'paper',
          storedLightTheme: 'paper',
          darkTheme: 'forest',
          storedDarkTheme: 'forest',
        },
        themes: THEMES,
        premiumUnlocked: false,
      });
      expect(db.user.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'u1' },
        select: SELECT,
      });
    });

    it('serves stored premium themes as Classic once the plan has lapsed, keeping the stored ids', async () => {
      db.user.findUniqueOrThrow.mockResolvedValue({
        themeMode: 'LIGHT',
        lightTheme: 'grape',
        darkTheme: 'nebula',
      });
      premium.mockResolvedValue(false);

      const { appearance } = await controller.appearance(current);

      expect(appearance).toEqual({
        mode: 'light',
        lightTheme: 'classic',
        storedLightTheme: 'grape',
        darkTheme: 'classic',
        storedDarkTheme: 'nebula',
      });
    });

    it('serves them as themselves while unlocked', async () => {
      db.user.findUniqueOrThrow.mockResolvedValue({
        themeMode: 'DARK',
        lightTheme: 'grape',
        darkTheme: 'nebula',
      });
      premium.mockResolvedValue(true);

      const result = await controller.appearance(current);

      expect(result.appearance.lightTheme).toBe('grape');
      expect(result.appearance.darkTheme).toBe('nebula');
      expect(result.premiumUnlocked).toBe(true);
    });
  });

  describe('PATCH /users/me/appearance', () => {
    it('writes only what was sent, mapping the mode to the stored enum', async () => {
      premium.mockResolvedValue(false);
      db.user.update.mockResolvedValue({
        themeMode: 'DARK',
        lightTheme: 'classic',
        darkTheme: 'classic',
      });

      const result = await controller.updateAppearance(current, { mode: 'dark' });

      expect(db.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { themeMode: 'DARK' },
        select: SELECT,
      });
      expect(result.appearance.mode).toBe('dark');
    });

    it('saves a free light theme without a plan', async () => {
      premium.mockResolvedValue(false);
      db.user.update.mockResolvedValue({
        themeMode: 'SYSTEM',
        lightTheme: 'lilac',
        darkTheme: 'classic',
      });

      const result = await controller.updateAppearance(current, { lightTheme: 'lilac' });

      expect(db.user.update.mock.calls[0][0].data).toEqual({ lightTheme: 'lilac' });
      expect(result.appearance.lightTheme).toBe('lilac');
    });

    it('saves a free dark theme together with the switch to dark, in one write', async () => {
      premium.mockResolvedValue(false);
      db.user.update.mockResolvedValue({
        themeMode: 'DARK',
        lightTheme: 'classic',
        darkTheme: 'ocean',
      });

      const result = await controller.updateAppearance(current, {
        mode: 'dark',
        darkTheme: 'ocean',
      });

      expect(db.user.update).toHaveBeenCalledTimes(1);
      expect(db.user.update.mock.calls[0][0].data).toEqual({
        themeMode: 'DARK',
        darkTheme: 'ocean',
      });
      expect(result.appearance).toMatchObject({ mode: 'dark', darkTheme: 'ocean' });
    });

    it('refuses a premium light theme without a plan with a 402 and its code, writing nothing', async () => {
      premium.mockResolvedValue(false);

      await expectPremiumRefusal(
        controller.updateAppearance(current, { mode: 'light', lightTheme: 'mint' }),
      );
    });

    it('refuses a premium dark theme the same way, mode switch included', async () => {
      premium.mockResolvedValue(false);

      await expectPremiumRefusal(
        controller.updateAppearance(current, { mode: 'dark', darkTheme: 'obsidian' }),
      );
    });

    it('refuses the whole request when only one of two themes is premium', async () => {
      premium.mockResolvedValue(false);

      await expectPremiumRefusal(
        controller.updateAppearance(current, { lightTheme: 'paper', darkTheme: 'ember' }),
      );
    });

    it('saves premium themes with a plan', async () => {
      premium.mockResolvedValue(true);
      db.user.update.mockResolvedValue({
        themeMode: 'SYSTEM',
        lightTheme: 'mint',
        darkTheme: 'aurora',
      });

      const result = await controller.updateAppearance(current, {
        lightTheme: 'mint',
        darkTheme: 'aurora',
      });

      expect(result.appearance).toEqual({
        mode: 'system',
        lightTheme: 'mint',
        storedLightTheme: 'mint',
        darkTheme: 'aurora',
        storedDarkTheme: 'aurora',
      });
      expect(result.premiumUnlocked).toBe(true);
    });
  });

  describe('the body schema', () => {
    const pipe = new ZodBody(updateAppearanceSchema, 'test');

    it('accepts a mode, a catalog id for either mode, or any combination', () => {
      expect(pipe.transform({ mode: 'system' })).toEqual({ mode: 'system' });
      expect(pipe.transform({ lightTheme: 'rose' })).toEqual({ lightTheme: 'rose' });
      expect(pipe.transform({ darkTheme: 'slate' })).toEqual({ darkTheme: 'slate' });
      expect(pipe.transform({ mode: 'light', lightTheme: 'classic' })).toEqual({
        mode: 'light',
        lightTheme: 'classic',
      });
      expect(pipe.transform({ mode: 'dark', lightTheme: 'cream', darkTheme: 'classic' })).toEqual({
        mode: 'dark',
        lightTheme: 'cream',
        darkTheme: 'classic',
      });
    });

    it.each([
      ['an empty body', {}],
      ['an unknown light theme', { lightTheme: 'neon' }],
      ['an unknown dark theme', { darkTheme: 'neon' }],
      ['a dark id sent as the light theme', { lightTheme: 'midnight' }],
      ['a light id sent as the dark theme', { darkTheme: 'paper' }],
      ['a theme id in the wrong case', { lightTheme: 'Classic' }],
      ['an unknown mode', { mode: 'auto' }],
      ['an extra field', { mode: 'dark', accent: '#ff0000' }],
    ])('refuses %s', (_label, body) => {
      expect(() => pipe.transform(body)).toThrow('Invalid input');
    });
  });
});
