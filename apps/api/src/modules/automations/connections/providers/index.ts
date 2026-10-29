/**
 * Every app a workspace can connect. The titles and icons live in
 * `CONNECTION_KINDS` in `@postgear/automation`, so the catalog, the web app
 * and this list agree; a spec checks both lists name the same kinds.
 */
import type { ConnectionKind } from '@postgear/automation';
import { discordProvider } from './discord.provider';
import { googleProvider } from './google.provider';
import { httpProvider } from './http.provider';
import type { ConnectionProvider } from './provider.types';
import { slackProvider } from './slack.provider';
import { teamsProvider } from './teams.provider';

export const CONNECTION_PROVIDERS: Record<ConnectionKind, ConnectionProvider> = {
  slack: slackProvider as ConnectionProvider,
  teams: teamsProvider as ConnectionProvider,
  discord: discordProvider as ConnectionProvider,
  http: httpProvider as ConnectionProvider,
  google: googleProvider as ConnectionProvider,
};

export const CONNECTION_PROVIDER_KINDS = Object.keys(CONNECTION_PROVIDERS) as [
  ConnectionKind,
  ...ConnectionKind[],
];

export function providerFor(kind: string): ConnectionProvider | null {
  return Object.hasOwn(CONNECTION_PROVIDERS, kind)
    ? CONNECTION_PROVIDERS[kind as ConnectionKind]
    : null;
}

export type { ConnectionProvider, JudgeOptions } from './provider.types';
