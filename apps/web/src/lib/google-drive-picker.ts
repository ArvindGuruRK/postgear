/**
 * Google's own Drive picker (Sprint 13 Module 12, D13-09), for the Clips
 * **Pick From Google Drive** button when the real keys are set.
 *
 * Two of Google's scripts, loaded on first use only: Google Identity Services
 * asks the person for a short-lived access token with the `drive.file` scope
 * (only the files they pick, never their whole Drive), and the Picker shows
 * their videos. The answer is the picked file's id and that token, which go
 * straight to `POST /clips/videos/drive`; nothing is kept in the browser.
 *
 * Not run for real yet: it needs the Drive API, the Picker API and an OAuth
 * client in a Google Cloud project (see the keys guide).
 */

const IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
const PICKER_SCRIPT = 'https://apis.google.com/js/api.js';
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface DrivePickerKeys {
  apiKey: string;
  appId: string;
  clientId: string;
}

export interface DrivePick {
  fileId: string;
  accessToken: string;
}

// Google's globals, typed only as far as we use them.
interface GoogleGlobals {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (answer: { access_token?: string; error?: string }) => void;
        error_callback?: (error: { type?: string }) => void;
      }): { requestAccessToken(options?: { prompt?: string }): void };
    };
  };
  picker: {
    PickerBuilder: new () => PickerBuilder;
    DocsView: new (viewId: string) => { setMimeTypes(types: string): unknown };
    ViewId: { DOCS_VIDEOS: string };
    Action: { PICKED: string; CANCEL: string };
  };
}

interface PickerBuilder {
  addView(view: unknown): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(appId: string): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  setCallback(
    callback: (data: { action: string; docs?: Array<{ id: string }> }) => void,
  ): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
}

type WindowWithGoogle = Window & {
  google?: GoogleGlobals;
  gapi?: { load(name: string, done: () => void): void };
};

const loading = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  const known = loading.get(src);
  if (known) return known;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading.delete(src);
      reject(new Error('Google Drive could not be opened. Try again in a moment.'));
    };
    document.head.appendChild(script);
  });
  loading.set(src, promise);
  return promise;
}

function askForToken(google: GoogleGlobals, clientId: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_FILE_SCOPE,
      callback: (answer) => {
        if (answer.access_token) resolve(answer.access_token);
        else if (answer.error === 'access_denied') resolve(null);
        else reject(new Error('Google Drive did not let us in. Try again.'));
      },
      // The person closed Google's window: not an error.
      error_callback: () => resolve(null),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

/** Opens Google's picker. Null when the person closed it without picking. */
export async function pickFromGoogleDrive(keys: DrivePickerKeys): Promise<DrivePick | null> {
  await Promise.all([loadScript(IDENTITY_SCRIPT), loadScript(PICKER_SCRIPT)]);
  const win = window as WindowWithGoogle;
  const gapi = win.gapi;
  if (!gapi) throw new Error('Google Drive could not be opened. Try again in a moment.');
  await new Promise<void>((resolve) => gapi.load('picker', resolve));
  const google = win.google;
  if (!google) throw new Error('Google Drive could not be opened. Try again in a moment.');

  const accessToken = await askForToken(google, keys.clientId);
  if (!accessToken) return null;

  return new Promise((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS_VIDEOS);
    new google.picker.PickerBuilder()
      .addView(view)
      .setTitle('Pick A Video')
      .setOAuthToken(accessToken)
      .setDeveloperKey(keys.apiKey)
      .setAppId(keys.appId)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED && data.docs?.[0]) {
          resolve({ fileId: data.docs[0].id, accessToken });
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build()
      .setVisible(true);
  });
}
