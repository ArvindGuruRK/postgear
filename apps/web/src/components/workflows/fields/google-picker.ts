/**
 * Google's own file picker, loaded only when someone presses Pick A
 * Spreadsheet (Module 13). With the `drive.file` scope, PostGear can open a
 * spreadsheet only once the person picked it here (or PostGear created it),
 * which is why a pasted sheet link is never offered.
 *
 * The script comes from Google (`apis.google.com/js/api.js`), then
 * `gapi.load('picker')`. The picker gets the short-lived access token from
 * `GET /automation-connections/:id/picker-token` (never the refresh token),
 * the browser key and the project number, which lets Google grant access to
 * the picked file.
 */
import type { PickerToken } from '@/types/workflows';

export const GOOGLE_API_SCRIPT = 'https://apis.google.com/js/api.js';

interface PickerDocument {
  id: string;
  name?: string;
}

interface PickerResult {
  action: string;
  docs?: PickerDocument[];
}

interface PickerBuilderLike {
  addView(view: unknown): PickerBuilderLike;
  setOAuthToken(token: string): PickerBuilderLike;
  setDeveloperKey(key: string): PickerBuilderLike;
  setAppId(appId: string): PickerBuilderLike;
  setTitle(title: string): PickerBuilderLike;
  setCallback(callback: (result: PickerResult) => void): PickerBuilderLike;
  build(): { setVisible(visible: boolean): void };
}

interface GooglePickerApi {
  PickerBuilder: new () => PickerBuilderLike;
  DocsView: new (viewId?: unknown) => { setMode?: (mode: unknown) => unknown };
  ViewId: { SPREADSHEETS: unknown };
  Action: { PICKED: string; CANCEL: string };
}

interface GoogleWindow {
  gapi?: { load(name: string, options: { callback: () => void; onerror?: () => void }): void };
  google?: { picker?: GooglePickerApi };
}

let loading: Promise<GooglePickerApi> | null = null;

function injectScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GOOGLE_API_SCRIPT}"]`,
    );
    if (existing && (window as GoogleWindow).gapi) {
      resolve();
      return;
    }
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('script')), { once: true });
    if (!existing) {
      script.src = GOOGLE_API_SCRIPT;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

/** Loads Google's script and the picker module once per page. */
export function loadGooglePicker(): Promise<GooglePickerApi> {
  if (loading) return loading;
  loading = injectScript()
    .then(
      () =>
        new Promise<GooglePickerApi>((resolve, reject) => {
          const gapi = (window as GoogleWindow).gapi;
          if (!gapi) {
            reject(new Error('gapi'));
            return;
          }
          gapi.load('picker', {
            callback: () => {
              const picker = (window as GoogleWindow).google?.picker;
              if (picker) resolve(picker);
              else reject(new Error('picker'));
            },
            onerror: () => reject(new Error('picker')),
          });
        }),
    )
    .catch((cause: unknown) => {
      // A failed load may work on the next press (a blocked network, an ad blocker turned off).
      loading = null;
      throw cause;
    });
  return loading;
}

/**
 * Opens the picker on spreadsheets. Resolves with the picked file, or null
 * when the person closed it.
 */
export async function pickSpreadsheet(token: PickerToken): Promise<PickerDocument | null> {
  const picker = await loadGooglePicker();
  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.SPREADSHEETS);
    new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token.accessToken)
      .setDeveloperKey(token.apiKey)
      .setAppId(token.appId)
      .setTitle('Pick A Spreadsheet')
      .setCallback((result) => {
        if (result.action === picker.Action.PICKED) {
          const doc = result.docs?.[0];
          resolve(doc?.id ? { id: doc.id, name: doc.name } : null);
        } else if (result.action === picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build()
      .setVisible(true);
  });
}

/** What the field says when Google's script did not load. */
export const PICKER_LOAD_FAILED =
  "Google's file picker did not load. Check your connection or any blocker, then try again.";
