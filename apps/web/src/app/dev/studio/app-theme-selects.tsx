'use client';

/**
 * The app theme check: a light theme and a dark theme for the page around the
 * slides, so a template can be seen against every ground the app has (Lilac's
 * frame colour, a near-white card, the dark page). The top bar's toggle picks
 * the mode, as everywhere else.
 *
 * The themes are put on `<body>` by `applyAppearance`, the app's own runtime
 * (`lib/appearance.ts`): the `data-light-theme` and `data-dark-theme`
 * attributes, both whatever the mode, so a theme for the other mode waits for
 * the toggle. Nothing is remembered: the `pg_appearance` cookie and the
 * account keep the person's own choice, and that choice comes back when the
 * page goes.
 */
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@postgear/ui';
import { useEffect, useId, useState } from 'react';
import {
  APPEARANCE_EVENT,
  type Appearance,
  applyAppearance,
  currentAppearance,
  DEFAULT_THEME,
} from '@/lib/appearance';
import { APP_DARK_THEMES, APP_LIGHT_THEMES, type AppTheme } from './playground-model';

interface AppThemes {
  light: string;
  dark: string;
}

/**
 * The page's own light and dark themes, worn over the person's choice until
 * the page unmounts.
 *
 * Starts from what the page is wearing. The top bar's toggle, and the device
 * switching while the mode is System, apply the cookie's appearance again,
 * themes included; the listener puts these themes back over it, so the mode
 * changes and the themes stay. On unmount the cookie's appearance is applied:
 * the person's themes, and whatever mode they toggled to here.
 */
function useAppThemes(): [AppThemes | null, (next: AppThemes) => void] {
  const [themes, setThemes] = useState<AppThemes | null>(null);

  useEffect(() => {
    const start = currentAppearance();
    setThemes({ light: start.lightTheme, dark: start.darkTheme });
  }, []);

  useEffect(() => {
    if (!themes) return;

    const wear = () =>
      applyAppearance({ ...currentAppearance(), lightTheme: themes.light, darkTheme: themes.dark });

    // `applyAppearance` announces every change, this one's own included; only
    // an appearance with other themes is answered, so the two never loop.
    const keep = (event: Event) => {
      const worn = (event as CustomEvent<Partial<Appearance>>).detail;
      if (worn?.lightTheme !== themes.light || worn?.darkTheme !== themes.dark) wear();
    };

    wear();
    window.addEventListener(APPEARANCE_EVENT, keep);

    return () => {
      window.removeEventListener(APPEARANCE_EVENT, keep);
      applyAppearance(currentAppearance());
    };
  }, [themes]);

  return [themes, setThemes];
}

export function AppThemeSelects() {
  const [themes, setThemes] = useAppThemes();

  return (
    <div className="grid w-full grid-cols-2 gap-3 sm:w-auto">
      <ThemeSelect
        label="Light theme"
        options={APP_LIGHT_THEMES}
        value={themes?.light}
        onChange={(light) => themes && setThemes({ ...themes, light })}
      />
      <ThemeSelect
        label="Dark theme"
        options={APP_DARK_THEMES}
        value={themes?.dark}
        onChange={(dark) => themes && setThemes({ ...themes, dark })}
      />
    </div>
  );
}

function ThemeSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly AppTheme[];
  /** Undefined until the page has read what it is wearing. */
  value: string | undefined;
  onChange: (id: string) => void;
}) {
  const id = useId();

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value ?? DEFAULT_THEME}
        onValueChange={onChange}
        disabled={value === undefined}
      >
        <SelectTrigger id={id} className="sm:w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((theme) => (
            <SelectItem key={theme.id} value={theme.id}>
              {theme.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
