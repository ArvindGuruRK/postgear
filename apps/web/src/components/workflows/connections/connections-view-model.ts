/**
 * Words and rules for the Connections page and the connection picker
 * (Sprint 10, Module 04). The API judges every link for real; the hints here
 * only save a round trip for the obvious mistakes.
 *
 * Plain words (blueprint section 12): a "link", never a "webhook URL".
 */
import { type ConnectionKind, connectionKindInfo } from '@postgear/automation';
import type { Connection, ConnectionStatus } from '@/types/workflows';

export const MAX_CONNECTION_NAME_LENGTH = 60;
export const MAX_SECRET_HEADERS = 10;

/** Apps whose details are typed into a form. Google connects by signing in. */
export const FORM_APPS = ['slack', 'teams', 'discord', 'http'] as const;
export type FormApp = (typeof FORM_APPS)[number];

/** Apps whose only real check is sending a message, so they always read "Saved, not checked". */
const SEND_CHECKED = new Set<ConnectionKind>(['slack', 'teams', 'discord']);

export function appTitle(kind: ConnectionKind): string {
  return connectionKindInfo(kind).title;
}

/** The app's name in a sentence: "Slack", "Microsoft Teams", "secret headers". */
export function appInSentence(kind: ConnectionKind): string {
  return kind === 'http' ? 'secret headers' : appTitle(kind);
}

export function appIcon(kind: ConnectionKind): string {
  return connectionKindInfo(kind).icon;
}

export function isFormApp(kind: ConnectionKind): kind is FormApp {
  return (FORM_APPS as readonly string[]).includes(kind);
}

export function isSendChecked(kind: ConnectionKind): boolean {
  return SEND_CHECKED.has(kind);
}

/** A stand-in connection for local testing (`AUTOMATION_SIMULATION`): it never calls the app. */
export function isSimulated(connection: Pick<Connection, 'meta'>): boolean {
  return connection.meta?.simulated === true;
}

/** What Google connecting offers: signing in when PostGear has Google keys, a stand-in when simulating. */
export interface GoogleSetup {
  simulation: boolean;
  googleReady: boolean;
}

/** The name a simulated Google connection gets. */
export const SIMULATED_GOOGLE_NAME = 'Simulated Google';

/** The sentence for a workspace where Google cannot be connected at all. */
export const GOOGLE_NOT_SET_UP = 'Ask a workspace admin to set up Google.';

/** Every app the Add Connection menu offers: the form apps, then Google. */
export const ADD_MENU_APPS: readonly ConnectionKind[] = [...FORM_APPS, 'google'];

export const STATUS_WORDS: Record<
  ConnectionStatus,
  { label: string; variant: 'success' | 'accent' | 'danger' }
> = {
  CONNECTED: { label: 'Connected', variant: 'success' },
  NEEDS_RECONNECT: { label: 'Needs Reconnect', variant: 'accent' },
  ERROR: { label: 'Error', variant: 'danger' },
};

/** Under a webhook-style connection that is not broken: honest about what was checked. */
export function checkNote(connection: Pick<Connection, 'provider' | 'status'>): string | null {
  return isSendChecked(connection.provider) && connection.status === 'CONNECTED'
    ? 'Saved, not checked'
    : null;
}

export function usedByText(count: number): string {
  if (count === 0) return 'Not used yet';
  return `Used by ${count} workflow${count === 1 ? '' : 's'}`;
}

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function lastCheckedText(connection: Pick<Connection, 'lastCheckedAt'>): string {
  return connection.lastCheckedAt ? DATE.format(new Date(connection.lastCheckedAt)) : 'Never';
}

/** What the delete confirmation says, naming the workflows that use the connection. */
export function deleteWarning(connection: Pick<Connection, 'usedBy'>): string {
  const live = connection.usedBy.filter((use) => use.live);
  if (live.length > 0) {
    return `It cannot be deleted while these workflows are on: ${live
      .map((use) => use.name)
      .join(', ')}. Pause them first.`;
  }
  if (connection.usedBy.length > 0) {
    return `These workflows will need another connection: ${connection.usedBy
      .map((use) => use.name)
      .join(', ')}. This cannot be undone.`;
  }
  return 'No workflow uses it. This cannot be undone.';
}

export function searchConnections(list: readonly Connection[], search: string): Connection[] {
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...list];
  return list.filter((connection) => {
    const haystack = `${connection.name} ${appTitle(connection.provider)}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** "Where do I find this?" for each app with a link. */
export const HELP: Record<
  Exclude<FormApp, 'http'>,
  { steps: string[]; note?: string; docs: string; linkLabel: string }
> = {
  slack: {
    linkLabel: 'Slack link',
    steps: [
      'Go to api.slack.com/apps and create an app for your workspace.',
      'Open Incoming Webhooks and turn them on.',
      'Choose Add New Webhook and pick the channel to post in.',
      'Copy the link Slack shows (it starts with https://hooks.slack.com/services/).',
    ],
    docs: 'https://api.slack.com/messaging/webhooks',
  },
  discord: {
    linkLabel: 'Discord link',
    steps: [
      'Open the channel settings in Discord.',
      'Go to Integrations, then Webhooks.',
      'Choose New Webhook and give it a name.',
      'Choose Copy Webhook URL and paste it here.',
    ],
    docs: 'https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks',
  },
  teams: {
    linkLabel: 'Teams link',
    steps: [
      'In the Teams channel, open the Workflows app.',
      'Pick the template "Send webhook alerts to a channel".',
      'Finish its steps, choosing the team and channel.',
      'Copy the link it shows at the end and paste it here.',
    ],
    note: 'Messages appear as posted by the Workflows bot, not by PostGear. The flow belongs to the person who made it: if they leave, make a new one.',
    docs: 'https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook',
  },
};

export interface HeaderRow {
  name: string;
  value: string;
}

export interface ConnectionFormValues {
  name: string;
  link: string;
  headers: HeaderRow[];
}

export type ConnectionFormErrors = Partial<Record<'name' | 'link' | 'headers', string>>;

export function emptyConnectionForm(): ConnectionFormValues {
  return { name: '', link: '', headers: [{ name: 'Authorization', value: '' }] };
}

/**
 * The obvious mistakes, caught before a request. `details` is false for a
 * rename: only the name is checked then.
 */
export function validateConnectionForm(
  kind: FormApp,
  values: ConnectionFormValues,
  { details = true, name = true }: { details?: boolean; name?: boolean } = {},
): ConnectionFormErrors {
  const errors: ConnectionFormErrors = {};
  if (name) {
    const trimmed = values.name.trim();
    if (!trimmed) errors.name = 'Enter a name for this connection.';
    else if (trimmed.length > MAX_CONNECTION_NAME_LENGTH) {
      errors.name = `Names can be at most ${MAX_CONNECTION_NAME_LENGTH} characters.`;
    }
  }
  if (!details) return errors;

  if (kind === 'http') {
    const rows = values.headers.filter((row) => row.name.trim() || row.value.trim());
    if (rows.length === 0) errors.headers = 'Add at least one secret header.';
    else if (rows.length > MAX_SECRET_HEADERS) {
      errors.headers = `You can add at most ${MAX_SECRET_HEADERS} secret headers.`;
    } else if (rows.some((row) => !row.name.trim() || !row.value.trim())) {
      errors.headers = 'Give every header a name and a value.';
    }
    return errors;
  }

  const link = values.link.trim();
  if (!link) errors.link = `Enter your ${appTitle(kind)} link.`;
  else if (!/^https:\/\//i.test(link)) errors.link = 'Use a link that starts with https://.';
  return errors;
}

/** The credentials a form sends; the API judges them again. */
export function credentialsFrom(kind: FormApp, values: ConnectionFormValues) {
  if (kind === 'http') {
    return {
      headers: values.headers
        .filter((row) => row.name.trim() || row.value.trim())
        .map((row) => ({ name: row.name.trim(), value: row.value })),
    };
  }
  return { webhookUrl: values.link.trim() };
}

/** `?connectError=` from the OAuth callback, in words. */
export function connectErrorMessage(code: string | null): string | null {
  switch (code) {
    case null:
    case '':
      return null;
    case 'cancelled':
      return 'Connecting was cancelled. Nothing changed.';
    case 'not_admin':
      return 'Only workspace admins can connect apps.';
    case 'unavailable':
      return 'This app cannot be connected by signing in yet.';
    case 'expired':
      return 'That sign-in took too long or was already used. Try connecting again.';
    default:
      return 'The app did not finish connecting. Try again.';
  }
}
