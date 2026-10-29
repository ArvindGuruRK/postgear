/**
 * An outside app a step talks to (Slack, Teams, Discord, Sheets, HTTP),
 * shaped so the same code serves a real send, a simulated one and a dry
 * run. Modules 12 and 13 add the providers; `providerExecutor` turns one
 * into an executor.
 *
 * - `build` is pure: the request the step would send, from its resolved
 *   settings. A dry run stops here.
 * - `describe` is the plain-words line a dry run shows ("Slack message to
 *   Marketing Slack: 'New post on ...'"). It must never include a secret.
 * - `send` makes the real call with the decrypted credentials.
 * - `simulate` is the AUTOMATION_SIMULATION stand-in: a realistic success.
 *   Failure markers are handled before it is called.
 */
import type { ConnectionKind, GraphNode, RunScope } from '@postgear/automation';

export type ProviderResult =
  | { ok: true; output: unknown }
  | {
      ok: false;
      /** Worth trying again (a 429, a 5xx, a network error). */
      retryable: boolean;
      /** Short machine code stored on the step: `rate_limited`, `rejected`, ... */
      code: string;
      /** The one sentence the user sees. */
      message: string;
      /** The app refused the credentials: the connection needs a reconnect. */
      connectionBroken?: boolean;
      /** For support; redacted before it is stored. */
      details?: unknown;
    };

export interface ProviderBuildContext {
  run: { id: string; automationName: string; mode: 'test' | 'live' };
  node: Pick<GraphNode, 'key' | 'name' | 'type'>;
  scope: RunScope;
  timeZone: string;
  /** Name only: what a summary may say about the connection. */
  connection: { id: string; name: string } | null;
  idempotencyKey: string;
}

export interface ProviderSendOptions {
  /** `${runId}:${nodeKey}`: pass it to every app that accepts one. */
  idempotencyKey: string;
  /** Aborted when the run is cancelled or the attempt times out. */
  signal: AbortSignal;
  /** Call while waiting on a slow app. */
  heartbeat(): void;
}

export interface AutomationProvider<Req, C = Record<string, unknown>> {
  /** The connection the step needs; null for one that needs none (Email, through the API). */
  kind: ConnectionKind | null;
  build(config: C, ctx: ProviderBuildContext): Req;
  describe(req: Req): string;
  send(req: Req, credentials: unknown, opts: ProviderSendOptions): Promise<ProviderResult>;
  simulate(req: Req): Promise<ProviderResult>;
}
