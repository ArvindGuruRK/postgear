/**
 * The appearance cookie and the no-flash script: what the script paints from
 * a cookie (or its absence), and that `setAppearance` writes a cookie the
 * script reads back the same way. The two parse independently, so this is
 * what keeps them agreeing.
 */
import {
  APPEARANCE_COOKIE,
  APPEARANCE_EVENT,
  currentAppearance,
  NO_FLASH_APPEARANCE_SCRIPT,
  previewTheme,
  readAppearanceCookie,
  setAppearance,
} from './appearance';

function mockPrefersDark(dark: boolean) {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: dark && query === '(prefers-color-scheme: dark)',
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
}

function clearCookie() {
  // biome-ignore lint/suspicious/noDocumentCookie: test setup for the cookie under test
  document.cookie = `${APPEARANCE_COOKIE}=; Path=/; Max-Age=0`;
}

function setCookie(value: string) {
  // biome-ignore lint/suspicious/noDocumentCookie: test setup
  document.cookie = `${APPEARANCE_COOKIE}=${value}; Path=/`;
}

function resetBody() {
  document.body.className = '';
  document.body.removeAttribute('data-light-theme');
  document.body.removeAttribute('data-dark-theme');
}

function runScript() {
  // The exact string the layouts render, run the way the browser would.
  new Function(NO_FLASH_APPEARANCE_SCRIPT)();
}

beforeEach(() => {
  clearCookie();
  window.localStorage.clear();
  resetBody();
  mockPrefersDark(false);
});

describe('the no-flash script', () => {
  it('follows the device with no cookie and nothing stored, on Classic in both modes', () => {
    mockPrefersDark(true);
    runScript();
    expect(document.body.className).toBe('dark');
    expect(document.body.hasAttribute('data-light-theme')).toBe(false);
    expect(document.body.hasAttribute('data-dark-theme')).toBe(false);
  });

  it('falls back to the legacy localStorage choice when there is no cookie', () => {
    mockPrefersDark(true);
    window.localStorage.setItem('postgear-theme', 'light');
    runScript();
    expect(document.body.className).toBe('light');
  });

  it('paints the cookie: an explicit mode wins over the device, and both themes land as attributes', () => {
    mockPrefersDark(true);
    setCookie('light.mint.ember');
    runScript();
    expect(document.body.className).toBe('light');
    expect(document.body.getAttribute('data-light-theme')).toBe('mint');
    // Set in light mode too, so switching to dark needs no second write.
    expect(document.body.getAttribute('data-dark-theme')).toBe('ember');
  });

  it('resolves system against the device, and leaves Classic as no attribute', () => {
    setCookie('system.classic.classic');
    runScript();
    expect(document.body.className).toBe('light');
    expect(document.body.hasAttribute('data-light-theme')).toBe(false);
    expect(document.body.hasAttribute('data-dark-theme')).toBe(false);
  });

  it('keeps Cream as a theme of its own in the three-part cookie', () => {
    setCookie('light.cream.classic');
    runScript();
    expect(document.body.getAttribute('data-light-theme')).toBe('cream');
  });

  it('still reads the older two-part cookie, as dark Classic', () => {
    setCookie('dark.paper');
    runScript();
    expect(document.body.className).toBe('dark');
    expect(document.body.getAttribute('data-light-theme')).toBe('paper');
    expect(document.body.hasAttribute('data-dark-theme')).toBe(false);
    expect(readAppearanceCookie()).toEqual({
      mode: 'dark',
      lightTheme: 'paper',
      darkTheme: 'classic',
    });
  });

  it("reads the two-part cookie's Cream, the old default, as Classic", () => {
    setCookie('system.cream');
    runScript();
    expect(document.body.hasAttribute('data-light-theme')).toBe(false);
    expect(readAppearanceCookie()).toEqual({
      mode: 'system',
      lightTheme: 'classic',
      darkTheme: 'classic',
    });
  });

  it.each([['sepia.<x>'], ['light.mint.<x>'], ['light.mint.ember.extra']])(
    'ignores a malformed cookie (%s)',
    (value) => {
      setCookie(value);
      runScript();
      expect(document.body.className).toBe('light');
      expect(document.body.hasAttribute('data-light-theme')).toBe(false);
      expect(document.body.hasAttribute('data-dark-theme')).toBe(false);
      expect(readAppearanceCookie()).toBeNull();
    },
  );
});

describe('setAppearance', () => {
  it('writes a cookie the script and the reader both understand, and applies it at once', () => {
    const seen = jest.fn();
    window.addEventListener(APPEARANCE_EVENT, seen);

    setAppearance({ mode: 'dark', lightTheme: 'rose', darkTheme: 'midnight' });

    expect(readAppearanceCookie()).toEqual({
      mode: 'dark',
      lightTheme: 'rose',
      darkTheme: 'midnight',
    });
    expect(document.body.className).toBe('dark');
    expect(document.body.getAttribute('data-dark-theme')).toBe('midnight');
    // Kept in dark mode, so switching to light needs no second write.
    expect(document.body.getAttribute('data-light-theme')).toBe('rose');
    expect(seen).toHaveBeenCalledTimes(1);

    resetBody();
    runScript();
    expect(document.body.className).toBe('dark');
    expect(document.body.getAttribute('data-light-theme')).toBe('rose');
    expect(document.body.getAttribute('data-dark-theme')).toBe('midnight');

    window.removeEventListener(APPEARANCE_EVENT, seen);
  });

  it('refuses to write a value the script could not parse', () => {
    setAppearance({ mode: 'light', lightTheme: 'Not A Theme', darkTheme: 'classic' });
    expect(readAppearanceCookie()).toBeNull();
    expect(document.body.hasAttribute('data-light-theme')).toBe(false);
    expect(currentAppearance()).toEqual({
      mode: 'system',
      lightTheme: 'classic',
      darkTheme: 'classic',
    });

    setAppearance({ mode: 'light', lightTheme: 'paper', darkTheme: 'Night Owl' });
    expect(readAppearanceCookie()).toBeNull();
    expect(document.body.hasAttribute('data-dark-theme')).toBe(false);
  });
});

describe('previewTheme', () => {
  it('shows a theme in its own scheme without touching the cookie', () => {
    setAppearance({ mode: 'light', lightTheme: 'paper', darkTheme: 'classic' });

    previewTheme({ id: 'nebula', mode: 'dark' });

    expect(document.body.className).toBe('dark');
    expect(document.body.getAttribute('data-dark-theme')).toBe('nebula');
    expect(document.body.getAttribute('data-light-theme')).toBe('paper');
    expect(readAppearanceCookie()).toEqual({
      mode: 'light',
      lightTheme: 'paper',
      darkTheme: 'classic',
    });
  });
});
