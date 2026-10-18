/**
 * Appearance on the client: the colour mode, the light and dark themes, and
 * the `pg_appearance` cookie that carries all three to the no-flash script.
 *
 * ## Where the truth lives
 *
 * The account (`User.themeMode` / `User.lightTheme` / `User.darkTheme`,
 * served by `GET /users/me/appearance`) is the source of truth, so a choice
 * follows the person across devices. The cookie is this browser's mirror of
 * it, and it is a cookie rather than `localStorage` for one reason: it is the
 * one store the inline script and the server can both see, so a later
 * server-rendered theme needs no new storage. It is deliberately not
 * `httpOnly` (the script has to read it) and it carries nothing but three ids.
 *
 * ## The cookie
 *
 * `pg_appearance=<mode>.<lightTheme>.<darkTheme>`, e.g.
 * `system.classic.midnight`: path `/`, a year, `SameSite=Lax`. Written by
 * this module only: the Appearance page, the theme toggle, and
 * `AppearanceSync` (which corrects it from the account on the first dashboard
 * load on a new device).
 *
 * The older two-part `<mode>.<lightTheme>` is still read, as dark `classic`,
 * so a browser that has not seen a dashboard since the dark themes shipped
 * paints as before. In that form a light `cream` reads as `classic`: until
 * then Cream was the default, and the migration that added the dark themes
 * moved every account still on it to Classic, the same rule.
 *
 * ## Applying it
 *
 * `<body>` gets `light` or `dark` (colors.css scopes every token under one of
 * those, on body, not html), `data-light-theme="<id>"` for any light theme
 * but Classic and `data-dark-theme="<id>"` for any dark theme but Classic.
 * Both attributes are set whatever the mode (colors.css only reads each under
 * its own class), so switching modes needs no second write.
 */

export type AppearanceMode = 'system' | 'light' | 'dark';

/** The scheme a theme belongs to, and what a mode resolves to on the device. */
export type ColorScheme = 'light' | 'dark';

export interface Appearance {
  mode: AppearanceMode;
  lightTheme: string;
  darkTheme: string;
}

/** Mirrors `ThemeSwatch` in apps/api/src/modules/users/appearance.catalog.ts. */
export interface ThemeSwatch {
  page: string;
  chrome: string;
  card: string;
  field: string;
  ink: string;
  outline: string;
  accent: string;
}

/** Mirrors the API's `Theme`. The catalog itself is only ever read from the API. */
export interface AppearanceTheme {
  id: string;
  mode: ColorScheme;
  name: string;
  premium: boolean;
  swatch: ThemeSwatch;
}

/** `GET` / `PATCH /users/me/appearance`. */
export interface AppearanceResponse {
  appearance: Appearance & { storedLightTheme: string; storedDarkTheme: string };
  /** Light then dark, each entry tagged with its `mode`. */
  themes: AppearanceTheme[];
  premiumUnlocked: boolean;
}

/** The 402 code the API sends for a premium theme without a paid workspace. */
export const PREMIUM_THEME_REQUIRED_CODE = 'premium_theme_requires_plan';

export const APPEARANCE_COOKIE = 'pg_appearance';
/** The default theme in both modes, and the one with no body attribute. */
export const DEFAULT_THEME = 'classic';
export const LIGHT_THEME_ATTRIBUTE = 'data-light-theme';
export const DARK_THEME_ATTRIBUTE = 'data-dark-theme';
/** Fired on `window` whenever the applied appearance changes, so the toggle can follow. */
export const APPEARANCE_EVENT = 'postgear:appearance';

/** Before the account sync (Sprint 8 and earlier) the toggle wrote here. Read once, as a fallback. */
const LEGACY_THEME_KEY = 'postgear-theme';
/** What the two-part cookie's default light theme was called. */
const LEGACY_DEFAULT_LIGHT_THEME = 'cream';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const THEME_ID = /^[a-z]{1,32}$/;
const COOKIE_VALUE = /^(system|light|dark)\.([a-z]{1,32})(?:\.([a-z]{1,32}))?$/;

/**
 * The inline script `layout.tsx` and `global-error.tsx` render first thing in
 * `<body>`, so the browser runs it during parsing, before the first paint.
 * Plain ES5 and self-contained (no module, nothing from this file at runtime),
 * and every step tolerates a blocked cookie jar or storage. Its parsing must
 * agree with `COOKIE_VALUE`, `parseCookieValue` and `applyAppearance` below.
 *
 * No cookie: the legacy `localStorage` choice if one exists, else `system`
 * (follow the device), which is the default for a new account too.
 */
export const NO_FLASH_APPEARANCE_SCRIPT = String.raw`(function(){var b=document.body,m='system',t='${DEFAULT_THEME}',k='${DEFAULT_THEME}';try{var c=document.cookie.match(/(?:^|; )${APPEARANCE_COOKIE}=(system|light|dark)\.([a-z]{1,32})(?:\.([a-z]{1,32}))?(?:;|$)/);if(c){m=c[1];t=c[2];if(c[3]){k=c[3];}else if(t==='${LEGACY_DEFAULT_LIGHT_THEME}'){t='${DEFAULT_THEME}';}}else{var l=window.localStorage.getItem('${LEGACY_THEME_KEY}');if(l==='light'||l==='dark')m=l;}}catch(e){}var d=m==='dark';if(m==='system'){try{d=window.matchMedia('(prefers-color-scheme: dark)').matches;}catch(e){}}b.classList.remove('light','dark');b.classList.add(d?'dark':'light');if(t!=='${DEFAULT_THEME}')b.setAttribute('${LIGHT_THEME_ATTRIBUTE}',t);else b.removeAttribute('${LIGHT_THEME_ATTRIBUTE}');if(k!=='${DEFAULT_THEME}')b.setAttribute('${DARK_THEME_ATTRIBUTE}',k);else b.removeAttribute('${DARK_THEME_ATTRIBUTE}');})();`;

export function isAppearanceMode(value: unknown): value is AppearanceMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** One cookie value, three-part or the older two-part, or `null` if malformed. */
function parseCookieValue(raw: string): Appearance | null {
  const match = COOKIE_VALUE.exec(raw);

  if (!match) {
    return null;
  }

  const [, mode, light, dark] = match;

  if (dark === undefined) {
    return {
      mode: mode as AppearanceMode,
      lightTheme: light === LEGACY_DEFAULT_LIGHT_THEME ? DEFAULT_THEME : light,
      darkTheme: DEFAULT_THEME,
    };
  }

  return { mode: mode as AppearanceMode, lightTheme: light, darkTheme: dark };
}

/** The cookie's value, or `null` when there is none (or it is malformed). */
export function readAppearanceCookie(): Appearance | null {
  try {
    const raw = document.cookie
      .split('; ')
      .find((entry) => entry.startsWith(`${APPEARANCE_COOKIE}=`))
      ?.slice(APPEARANCE_COOKIE.length + 1);

    return raw ? parseCookieValue(raw) : null;
  } catch {
    return null;
  }
}

/** What this browser is set to: the cookie, else the legacy toggle's choice, else the default. */
export function currentAppearance(): Appearance {
  const cookie = readAppearanceCookie();

  if (cookie) {
    return cookie;
  }

  let mode: AppearanceMode = 'system';

  try {
    const legacy = window.localStorage.getItem(LEGACY_THEME_KEY);
    if (legacy === 'light' || legacy === 'dark') {
      mode = legacy;
    }
  } catch {
    // Storage blocked: the default stands.
  }

  return { mode, lightTheme: DEFAULT_THEME, darkTheme: DEFAULT_THEME };
}

export function prefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** The scheme a mode resolves to on this device right now. */
export function resolveScheme(mode: AppearanceMode): ColorScheme {
  if (mode === 'system') {
    return prefersDark() ? 'dark' : 'light';
  }

  return mode;
}

/**
 * The same shape the cookie allows, so the body can never hold an id the next
 * load's script would not reproduce.
 */
function setThemeAttribute(body: HTMLElement, attribute: string, id: string): void {
  if (THEME_ID.test(id) && id !== DEFAULT_THEME) {
    body.setAttribute(attribute, id);
  } else {
    body.removeAttribute(attribute);
  }
}

/** Puts the class and attributes on `<body>`: the runtime twin of the inline script. */
export function applyAppearance(appearance: Appearance): void {
  const body = document.body;
  const scheme = resolveScheme(appearance.mode);

  body.classList.toggle('dark', scheme === 'dark');
  body.classList.toggle('light', scheme === 'light');
  setThemeAttribute(body, LIGHT_THEME_ATTRIBUTE, appearance.lightTheme);
  setThemeAttribute(body, DARK_THEME_ATTRIBUTE, appearance.darkTheme);

  window.dispatchEvent(new CustomEvent(APPEARANCE_EVENT, { detail: { ...appearance, scheme } }));
}

function writeAppearanceCookie(appearance: Appearance): void {
  const value = `${appearance.mode}.${appearance.lightTheme}.${appearance.darkTheme}`;

  if (!COOKIE_VALUE.test(value)) {
    return;
  }

  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is not in every browser this app supports, and the no-flash script reads document.cookie
  document.cookie = `${APPEARANCE_COOKIE}=${value}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`;
}

/**
 * Bumped by every local choice. `AppearanceSync` reads it before its request
 * and again after, so a slow account read can never overwrite a choice the
 * person made while it was in flight.
 */
let revision = 0;

export function appearanceRevision(): number {
  return revision;
}

/** A choice made in this browser: remembered in the cookie and applied at once. */
export function setAppearance(appearance: Appearance): void {
  revision += 1;
  writeAppearanceCookie(appearance);
  applyAppearance(appearance);
}

/** The account's value arriving: the same write, without counting as a local choice. */
export function syncAppearance(appearance: Appearance): void {
  writeAppearanceCookie(appearance);
  applyAppearance(appearance);
}

/**
 * Applies a theme for a moment (the premium preview) without remembering it:
 * the current choice with that theme swapped in, shown in the theme's own
 * scheme so it is visible whatever the page was wearing.
 */
export function previewTheme(theme: Pick<AppearanceTheme, 'id' | 'mode'>): void {
  const current = currentAppearance();

  applyAppearance({
    ...current,
    mode: theme.mode,
    ...(theme.mode === 'light' ? { lightTheme: theme.id } : { darkTheme: theme.id }),
  });
}
