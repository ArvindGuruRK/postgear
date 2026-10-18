import { Body, Controller, Get, HttpException, HttpStatus, Patch } from '@nestjs/common';
import { prisma } from '@postgear/db';
import { z } from 'zod';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import {
  effectiveTheme,
  isPremiumTheme,
  isThemeId,
  THEMES,
  type Theme,
} from './appearance.catalog';
import { hasPremiumThemes } from './appearance.entitlement';

/**
 * Appearance for the signed-in user: the colour mode, the light theme and
 * the dark theme.
 *
 * Stored on the user (`User.themeMode`, `User.lightTheme`, `User.darkTheme`),
 * so the choice follows the person across devices and workspaces. The web app
 * mirrors it in a `pg_appearance` cookie that its no-flash script reads before
 * paint; these routes are what that cookie is reconciled against.
 *
 * ## Premium is enforced here
 *
 * The settings page lets anyone *preview* a premium theme, but saving one
 * (light or dark) without a paid workspace is refused with a 402 carrying
 * `code: 'premium_theme_requires_plan'`, so the page can tell "needs a plan"
 * from any other failure without matching on copy. A request that sets a mode
 * *and* a refused theme writes nothing: the page sends the mode switch that
 * goes with picking a theme from the other scheme in the same request, and a
 * half-applied PATCH would leave it guessing which part landed.
 *
 * Reads never refuse: a premium id stored while a plan was live is kept when
 * the plan lapses and served back as Classic (`lightTheme` / `darkTheme` are
 * the effective ids, `storedLightTheme` / `storedDarkTheme` the raw ones), so
 * it returns by itself on re-subscribing.
 */

export const PREMIUM_THEME_REQUIRED_CODE = 'premium_theme_requires_plan';

export const PREMIUM_THEME_REQUIRED_MESSAGE =
  'That theme is part of the paid plans. Upgrade a workspace to use it.';

/** A 402 with a machine-readable code; the exception filter passes `code` through. */
export class PremiumThemeRequiredException extends HttpException {
  constructor() {
    super(
      { message: PREMIUM_THEME_REQUIRED_MESSAGE, code: PREMIUM_THEME_REQUIRED_CODE },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

const MODES = ['system', 'light', 'dark'] as const;

export type AppearanceMode = (typeof MODES)[number];

type StoredMode = 'SYSTEM' | 'LIGHT' | 'DARK';

const TO_STORED: Record<AppearanceMode, StoredMode> = {
  system: 'SYSTEM',
  light: 'LIGHT',
  dark: 'DARK',
};

/**
 * An id outside its mode's catalog is a 400 like any other malformed body
 * (the catalog is public, so a client has no reason to send one, and a dark id
 * sent as `lightTheme` is just as unknown); a known premium id is a valid body
 * and is refused later, on entitlement, with its own 402.
 */
export const updateAppearanceSchema = z
  .object({
    mode: z.enum(MODES).optional(),
    lightTheme: z
      .string()
      .max(32)
      .refine((id) => isThemeId('light', id))
      .optional(),
    darkTheme: z
      .string()
      .max(32)
      .refine((id) => isThemeId('dark', id))
      .optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.mode !== undefined || body.lightTheme !== undefined || body.darkTheme !== undefined,
  );

export type UpdateAppearanceInput = z.infer<typeof updateAppearanceSchema>;

export interface AppearanceResponse {
  appearance: {
    mode: AppearanceMode;
    /** The light theme to render: a premium id the user is not entitled to reads as `classic`. */
    lightTheme: string;
    /** The light id as stored, before entitlement. */
    storedLightTheme: string;
    /** The dark theme to render, by the same rule. */
    darkTheme: string;
    /** The dark id as stored, before entitlement. */
    storedDarkTheme: string;
  };
  /** Light then dark, each entry tagged with its `mode`. */
  themes: readonly Theme[];
  premiumUnlocked: boolean;
}

const APPEARANCE_SELECT = { themeMode: true, lightTheme: true, darkTheme: true } as const;

@Controller('users')
export class AppearanceController {
  @Get('me/appearance')
  async appearance(@CurrentUser() current: AuthenticatedUser): Promise<AppearanceResponse> {
    const [user, premiumUnlocked] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: current.id }, select: APPEARANCE_SELECT }),
      hasPremiumThemes(current.id),
    ]);

    return toResponse(user, premiumUnlocked);
  }

  @Patch('me/appearance')
  async updateAppearance(
    @CurrentUser() current: AuthenticatedUser,
    @Body(new ZodBody(updateAppearanceSchema, 'users/appearance'))
    dto: UpdateAppearanceInput,
  ): Promise<AppearanceResponse> {
    const premiumUnlocked = await hasPremiumThemes(current.id);
    const wantsPremium =
      (dto.lightTheme !== undefined && isPremiumTheme('light', dto.lightTheme)) ||
      (dto.darkTheme !== undefined && isPremiumTheme('dark', dto.darkTheme));

    if (wantsPremium && !premiumUnlocked) {
      throw new PremiumThemeRequiredException();
    }

    const user = await prisma.user.update({
      where: { id: current.id },
      data: {
        ...(dto.mode !== undefined ? { themeMode: TO_STORED[dto.mode] } : {}),
        ...(dto.lightTheme !== undefined ? { lightTheme: dto.lightTheme } : {}),
        ...(dto.darkTheme !== undefined ? { darkTheme: dto.darkTheme } : {}),
      },
      select: APPEARANCE_SELECT,
    });

    return toResponse(user, premiumUnlocked);
  }
}

function toResponse(
  user: { themeMode: StoredMode; lightTheme: string; darkTheme: string },
  premiumUnlocked: boolean,
): AppearanceResponse {
  return {
    appearance: {
      mode: user.themeMode.toLowerCase() as AppearanceMode,
      lightTheme: effectiveTheme('light', user.lightTheme, premiumUnlocked),
      storedLightTheme: user.lightTheme,
      darkTheme: effectiveTheme('dark', user.darkTheme, premiumUnlocked),
      storedDarkTheme: user.darkTheme,
    },
    themes: THEMES,
    premiumUnlocked,
  };
}
