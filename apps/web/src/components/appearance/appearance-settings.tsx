'use client';

/**
 * Settings → Appearance: the colour mode, the light theme and the dark theme.
 *
 * Every change is applied to the page at once and saved in the background
 * (optimistic, like the notification toggles) and put back, with a toast, if
 * the save fails. The choice is the account's, so it follows the person to
 * other devices; `setAppearance` also mirrors it into the cookie the no-flash
 * script reads, so the next load paints in it from the first frame.
 *
 * ## One grid, following the mode
 *
 * Only the themes for the scheme on screen are shown (2026-10-18): Light
 * shows the light grid, Dark the dark one, and System whichever the device
 * is using right now, swapping live when the device changes. A theme can
 * only be seen in its own scheme, so a grid for the other one would let the
 * person pick something with no visible effect. Switching the mode is how
 * they reach the other grid.
 *
 * ## Premium themes
 *
 * Without a paid workspace a premium card is still clickable: it previews
 * the theme on the live page, in its own scheme (the body only: nothing is
 * saved or written to the cookie), and opens a dialog offering the upgrade.
 * "Keep current", closing the dialog, following the link or leaving the page
 * all put the real appearance back. The API enforces the same rule; a 402
 * coming back anyway (an entitlement that lapsed while the page was open)
 * opens the same dialog.
 */
import { MonitorIcon } from '@animateicons/react/lucide/monitor-icon';
import { MoonIcon } from '@animateicons/react/lucide/moon-icon';
import { SunIcon } from '@animateicons/react/lucide/sun-icon';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  type AnimatedIcon,
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  MotionIcon,
  Skeleton,
  Stack,
  toast,
} from '@postgear/ui';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import {
  APPEARANCE_EVENT,
  type Appearance,
  type AppearanceMode,
  type AppearanceResponse,
  type AppearanceTheme,
  applyAppearance,
  type ColorScheme,
  currentAppearance,
  PREMIUM_THEME_REQUIRED_CODE,
  previewTheme,
  setAppearance,
} from '@/lib/appearance';
import { ThemeCard } from './theme-card';

const PATH = '/users/me/appearance';

const MODES: Array<{ value: AppearanceMode; label: string; icon: AnimatedIcon }> = [
  { value: 'system', label: 'System', icon: MonitorIcon },
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
];

const SECTION_TITLE: Record<ColorScheme, string> = {
  light: 'Light themes',
  dark: 'Dark themes',
};

/** The number of themes per mode (six free, six premium), for the loading placeholders. */
const THEMES_PER_MODE = 12;

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * The scheme on screen for a mode. Explicit modes are known on the server;
 * System depends on the device, so it starts as light (matching what the
 * server rendered) and is corrected after mount, then follows the device.
 */
function useScheme(mode: AppearanceMode | undefined): ColorScheme {
  const [deviceScheme, setDeviceScheme] = useState<ColorScheme>('light');

  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const update = () => setDeviceScheme(query.matches ? 'dark' : 'light');
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  if (mode === 'light' || mode === 'dark') {
    return mode;
  }
  return deviceScheme;
}

type Change = Partial<Appearance>;

function describe(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function isPremiumRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.code === PREMIUM_THEME_REQUIRED_CODE;
}

function toAppearance({ appearance }: AppearanceResponse): Appearance {
  return {
    mode: appearance.mode,
    lightTheme: appearance.lightTheme,
    darkTheme: appearance.darkTheme,
  };
}

/** The theme id chosen for one scheme. */
function chosenIn(appearance: Appearance, scheme: ColorScheme): string {
  return scheme === 'light' ? appearance.lightTheme : appearance.darkTheme;
}

export function AppearanceSettings({
  orgId,
  initial,
}: {
  orgId: string;
  /** Null when the server page could not load it; the island then loads for itself. */
  initial: AppearanceResponse | null;
}) {
  const [data, setData] = useState<AppearanceResponse | null>(initial);
  const [loading, setLoading] = useState(initial === null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState<AppearanceTheme | null>(null);
  const previewRef = useRef<AppearanceTheme | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<AppearanceResponse>(PATH));
      setLoadError(null);
    } catch (cause) {
      setLoadError(describe(cause, "Couldn't load your appearance settings."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initial === null) {
      void load();
    }
  }, [initial, load]);

  // The top bar's toggle changes the mode without this page: pick the new
  // mode up from the cookie it wrote, so the segmented control follows.
  useEffect(() => {
    const follow = () => {
      // A preview changes the body for a moment; it is not the person's choice.
      if (previewRef.current) {
        return;
      }
      const { mode: chosen } = currentAppearance();
      setData((previous) =>
        previous && previous.appearance.mode !== chosen
          ? { ...previous, appearance: { ...previous.appearance, mode: chosen } }
          : previous,
      );
    };
    window.addEventListener(APPEARANCE_EVENT, follow);
    return () => window.removeEventListener(APPEARANCE_EVENT, follow);
  }, []);

  const endPreview = useCallback(() => {
    if (previewRef.current) {
      previewRef.current = null;
      applyAppearance(currentAppearance());
    }
    setPreviewing(null);
  }, []);

  // Leaving the page mid-preview (a sidebar link) must not strand the
  // preview on the body.
  useEffect(() => endPreview, [endPreview]);

  const startPreview = useCallback((theme: AppearanceTheme) => {
    previewRef.current = theme;
    previewTheme(theme);
    setPreviewing(theme);
  }, []);

  const save = useCallback(
    async (change: Change, theme?: AppearanceTheme) => {
      if (!data) {
        return;
      }

      const before = data;
      const next: Appearance = { ...toAppearance(before), ...change };

      setData({
        ...before,
        appearance: {
          ...before.appearance,
          ...next,
          storedLightTheme: change.lightTheme ?? before.appearance.storedLightTheme,
          storedDarkTheme: change.darkTheme ?? before.appearance.storedDarkTheme,
        },
      });
      setAppearance(next);
      setSaving(true);

      try {
        const result = await api<AppearanceResponse>(PATH, { method: 'PATCH', body: change });
        setData(result);
        setAppearance(toAppearance(result));
      } catch (cause) {
        const refused = theme !== undefined && isPremiumRefusal(cause);
        // A refusal means the page's idea of the entitlement was stale; the
        // grids re-lock the premium cards with it.
        setData(refused ? { ...before, premiumUnlocked: false } : before);
        setAppearance(toAppearance(before));

        if (refused && theme) {
          startPreview(theme);
        } else {
          toast({
            title: "Couldn't save that",
            description: describe(cause, 'Your appearance was not changed. Please try again.'),
            variant: 'danger',
          });
        }
      } finally {
        setSaving(false);
      }
    },
    [data, startPreview],
  );

  const choose = useCallback(
    (theme: AppearanceTheme) => {
      if (!data || saving) {
        return;
      }

      if (theme.premium && !data.premiumUnlocked) {
        startPreview(theme);
        return;
      }

      // Only the grid for the scheme on screen is shown, so the pick always
      // shows straight away and never needs to change the mode.
      if (theme.id !== chosenIn(toAppearance(data), theme.mode)) {
        void save({ [theme.mode === 'light' ? 'lightTheme' : 'darkTheme']: theme.id }, theme);
      }
    },
    [data, saving, save, startPreview],
  );

  const mode = data?.appearance.mode;
  const scheme = useScheme(mode);

  return (
    <Stack gap="lg">
      {loadError ? (
        <Alert variant="danger" data-testid="appearance-error">
          <div className="flex flex-1 flex-col gap-1">
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </div>
          <Button size="sm" variant="secondary" onClick={() => void load()} disabled={loading}>
            Try Again
          </Button>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Mode</CardTitle>
          <CardDescription>
            System follows your device and switches with it. Saved to your account, so it follows
            you to other devices.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data ? (
            // biome-ignore lint/a11y/useSemanticElements: a div[role=group] of toggle buttons is the standard segmented-control pattern (see ViewSwitcher), not a form fieldset
            <div
              role="group"
              aria-label="Colour mode"
              className="inline-flex items-center gap-1 rounded-md border-2 border-outline bg-secondary p-1 shadow-brutalSm"
            >
              {MODES.map((option) => {
                const active = option.value === mode;

                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={active}
                    data-testid={`mode-${option.value}`}
                    disabled={saving}
                    onClick={() => {
                      if (!active) {
                        void save({ mode: option.value });
                      }
                    }}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-md px-4 py-2 type-ui text-xs outline-none transition-colors',
                      'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
                      'disabled:pointer-events-none',
                      active
                        ? 'bg-actionPrimary text-onActionPrimary'
                        : 'text-ink hover:bg-actionPrimary/10',
                    )}
                  >
                    <MotionIcon icon={option.icon} className="h-4 w-4" />
                    {option.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <Skeleton className="h-11 w-72" />
          )}
        </CardContent>
      </Card>

      {/* Keyed by scheme so switching modes swaps the whole grid cleanly. */}
      <Card key={scheme} data-testid={`themes-${scheme}`}>
        <CardHeader>
          <CardTitle>{SECTION_TITLE[scheme]}</CardTitle>
          <CardDescription>Premium themes come with any paid plan.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
            {data
              ? data.themes
                  .filter((theme) => theme.mode === scheme)
                  .map((theme) => (
                    <ThemeCard
                      key={theme.id}
                      theme={theme}
                      selected={theme.id === chosenIn(toAppearance(data), scheme)}
                      locked={theme.premium && !data.premiumUnlocked}
                      busy={saving}
                      onChoose={choose}
                    />
                  ))
              : Array.from({ length: THEMES_PER_MODE }, (_, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholders with no identity
                  <Skeleton key={index} className="h-[7.5rem] w-full" />
                ))}
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={previewing !== null}
        onOpenChange={(open) => {
          if (!open) {
            endPreview();
          }
        }}
      >
        <DialogContent data-testid="premium-theme-dialog">
          <DialogHeader>
            <DialogTitle>{previewing?.name} is a premium theme</DialogTitle>
            <DialogDescription>
              You're previewing it now. Premium themes come with every paid plan: upgrade any
              workspace you belong to and all twelve, six light and six dark, are yours on every
              device.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={endPreview}>
              Keep Current
            </Button>
            <Link
              href={`/${orgId}/settings/billing`}
              onClick={endPreview}
              className={buttonVariants({ variant: 'primary' })}
            >
              Upgrade
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Stack>
  );
}
