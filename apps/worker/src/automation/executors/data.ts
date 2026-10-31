/**
 * Module 13: Google Sheets Append Row and HTTP Request, both through
 * `providerExecutor` (dry run, simulation markers, connection broken).
 *
 * Each run builds its provider with what only the run has: the Sheets one
 * gets a way to write a refreshed Google token back to the step's
 * connection, the HTTP one the body template as saved (so it is resolved in
 * JSON mode, not the text mode every other setting uses). Settings read
 * from the environment (the Google client, `WEBHOOK_ALLOW_PRIVATE_URLS`) are
 * read when a step runs; the worker validated them at boot.
 */
import type { UrlGuardOptions } from '@postgear/seo-engine';
import { safeHttpRequest } from '../../lib/safe-http';
import { type GoogleClient, googleClientFromEnv } from '../providers/google-auth';
import { type HttpConfig, httpProvider } from '../providers/http';
import { providerExecutor } from '../providers/provider-executor';
import { type SheetsConfig, sheetsProvider } from '../providers/sheets';
import type { ExecContext, Executor } from './types';

export interface DataExecutorOptions {
  http?: typeof safeHttpRequest;
  /** The Google OAuth client for token refreshes. */
  googleClient?: () => GoogleClient | null;
  /** WEBHOOK_ALLOW_PRIVATE_URLS. */
  allowPrivate?: () => boolean;
  /** The address guard's resolver (tests). */
  resolve?: UrlGuardOptions['resolve'];
}

export function createDataExecutors(options: DataExecutorOptions = {}): Executor[] {
  const http = options.http ?? safeHttpRequest;
  const googleClient = options.googleClient ?? (() => googleClientFromEnv(process.env));
  const allowPrivate =
    options.allowPrivate ??
    (() =>
      process.env.WEBHOOK_ALLOW_PRIVATE_URLS === 'true' && process.env.NODE_ENV !== 'production');

  const sheets: Executor<SheetsConfig> = {
    type: 'data.googleSheetsAppendRow',
    run(ctx) {
      const provider = sheetsProvider({
        http,
        client: googleClient,
        now: ctx.deps.now,
        saveCredentials: async (credentials) => {
          if (!ctx.connection) return;
          await ctx.deps.store.saveConnectionCredentials(
            ctx.run.organizationId,
            ctx.connection.id,
            credentials,
          );
          ctx.connection.credentials = credentials;
        },
      });
      return providerExecutor('data.googleSheetsAppendRow', provider).run(ctx);
    },
  };

  const request: Executor<HttpConfig> = {
    type: 'data.httpRequest',
    async run(ctx: ExecContext<HttpConfig>) {
      const provider = httpProvider({
        http,
        allowPrivate: allowPrivate(),
        rawBody: ctx.rawConfig.body,
        ...(options.resolve ? { resolve: options.resolve } : {}),
      });
      const result = await providerExecutor('data.httpRequest', provider).run(ctx);
      if (result.status !== 'dryRun') return result;
      // The dry run also shows the body it would have sent (redacted with the
      // run's other data before it is stored).
      const req = provider.build(ctx.config, {
        run: { id: ctx.run.id, automationName: ctx.run.automationName, mode: ctx.run.mode },
        node: { key: ctx.node.key, name: ctx.node.name, type: ctx.node.type },
        scope: ctx.scope,
        timeZone: ctx.timeZone,
        connection: ctx.connection ? { id: ctx.connection.id, name: ctx.connection.name } : null,
        idempotencyKey: ctx.idempotencyKey,
      });
      return req.preview === undefined
        ? result
        : { ...result, output: { ...(result.output as object), body: req.preview } };
    },
  };

  return [sheets as unknown as Executor, request as unknown as Executor];
}

export const DATA_EXECUTORS: Executor[] = createDataExecutors();
